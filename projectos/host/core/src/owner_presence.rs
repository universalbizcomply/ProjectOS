//! Owner-presence authority (CD-B4-OWNER-PRESENCE-VALIDATED-FACT-INTEGRATION1A, Pattern C).
//!
//! Owner PRESENCE is DISTINCT from owner APPROVAL ([`crate::approval`]): approval is the owner's
//! *decision* to authorise one operation; presence is a *verified liveness/presence signal*, bound to
//! the same operation context and time-bounded, that an operation may additionally require. A Boolean
//! (`owner_present = true`), a report, a caller, a config file, or an unrestricted constructor can never
//! stand in for it: the only owner-presence authority values here are the opaque
//! [`VerifiedOwnerPresence`] and the operation-bound [`ValidatedOwnerPresenceFact`], and both are minted
//! ONLY by the crate-controlled functions below from an UNTRUSTED [`OwnerPresenceObservation`] a future
//! verifier adapter measured. Every opaque type has private fields, no public constructor, no `Default`,
//! no serde-as-authority, no broad `From`, and a redacted `Debug` that never renders the raw proof id.
//!
//! ## Production readiness
//!
//! This phase selects NO owner-presence mechanism and ships NO production verifier — only the authority
//! contract and a fixture verifier ([`OwnerPresenceObservation`] is adapter-supplied; the fixture path
//! is test-gated). A trustworthy production presence producer is CARRY-FORWARD. `EXECUTION_READY` stays
//! false; owner presence is NOT owner approval, NOT elevation, and NOT effect authority.

#![allow(dead_code)]

use core::fmt;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, OperationRef, ProjectId};

use crate::error::RecordError;
use crate::facts::validate_bounded_id;
use crate::phase::PhaseId;
use crate::plan::ApprovedPlanBinding;
use crate::repository::{RepositoryAuthorityBinding, ValidatedRepositoryFact};

// ---------------------------------------------------------------------------------------------
// Untrusted observation (what an owner-presence verifier adapter measured)
// ---------------------------------------------------------------------------------------------

/// The parsed, still-UNTRUSTED result an owner-presence verifier reports. Every field is
/// adapter-supplied and re-validated by [`verify_owner_presence`]; nothing here is authority. The
/// `observed_at`/`valid_until`/`generation` are VERIFIER-derived monotonic values, never caller-chosen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerPresenceObservation {
    /// Bounded proof/nonce identifier (single-use where the verifier enforces it). Never rendered.
    pub proof_id: String,
    /// Bounded verifier/provider identity that established presence.
    pub verifier: String,
    /// Monotonic tick at which presence was observed (verifier clock).
    pub observed_at: u64,
    /// Monotonic tick after which the proof is no longer valid (verifier-derived).
    pub valid_until: u64,
    /// Proof generation (bumped when presence is re-established). Independently context-compared.
    pub generation: u64,
}

/// The owner-presence policy an operation requires. `None` on the operation means "not required" (a
/// policy type, never a bare Boolean). Folded into the operation fingerprint, so changing it changes the
/// fingerprint and invalidates prior approval/permit authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredOwnerPresence {
    /// The exact verifier identity that must have established presence.
    pub required_verifier: String,
    /// The minimum acceptable proof generation.
    pub min_generation: u64,
}

impl RequiredOwnerPresence {
    fn fingerprint_material(&self) -> [u8; 32] {
        fn seg(h: &mut Sha256, s: &str) {
            h.update((s.len() as u64).to_be_bytes());
            h.update(s.as_bytes());
        }
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:OWNER-PRESENCE-POLICY:V1");
        seg(&mut h, &self.required_verifier);
        h.update(self.min_generation.to_be_bytes());
        h.finalize().into()
    }
}

/// Fold a required owner-presence policy into an already-bound operation fingerprint. Changing the
/// required verifier or minimum generation changes the fingerprint (so approval, which is
/// fingerprint-bound, is transitively owner-presence-policy bound).
#[must_use]
pub fn fold_owner_presence_fingerprint(
    base: &OperationFingerprint,
    required: &RequiredOwnerPresence,
) -> OperationFingerprint {
    let mut h = Sha256::new();
    h.update(base.as_str().as_bytes());
    h.update(b"PROJECTOS:OPERATION-OWNER-PRESENCE-BINDING:V1");
    h.update(required.fingerprint_material());
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    OperationFingerprint::new(hex).expect("a 64-hex-digit token is a valid OperationFingerprint")
}

// ---------------------------------------------------------------------------------------------
// Opaque verified owner-presence (the sole presence authority value)
// ---------------------------------------------------------------------------------------------

/// A verified owner-presence proof. Opaque: private fields, no public constructor, no `Default`, no
/// serde-as-authority, redacted Debug (never renders the raw proof id). Minted ONLY by
/// [`verify_owner_presence`]. Content equality excludes `generation` AND `valid_until` so a
/// generation-only or validity-boundary-only change is reported as its own distinct execution-context
/// field (`OwnerPresenceGeneration` / `OwnerPresenceValidUntil`) rather than as a proof-identity change.
#[derive(Clone)]
pub struct VerifiedOwnerPresence {
    proof_digest: [u8; 32],
    verifier: String,
    observed_at: u64,
    valid_until: u64,
    generation: u64,
    /// The trusted-clock provider identity + epoch this proof was established under. Evaluation refuses a
    /// current reading from a different provider or an earlier epoch.
    provider_id: String,
    epoch: u64,
}

impl fmt::Debug for VerifiedOwnerPresence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never render the raw proof id / digest.
        write!(
            f,
            "VerifiedOwnerPresence(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl PartialEq for VerifiedOwnerPresence {
    fn eq(&self, other: &Self) -> bool {
        self.proof_digest == other.proof_digest
            && self.verifier == other.verifier
            && self.observed_at == other.observed_at
    }
}
impl Eq for VerifiedOwnerPresence {}

impl VerifiedOwnerPresence {
    /// The verifier identity that established presence.
    pub(crate) fn verifier(&self) -> &str {
        &self.verifier
    }
    /// The proof generation.
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    /// The proof validity boundary.
    pub(crate) fn valid_until(&self) -> u64 {
        self.valid_until
    }
    /// The trusted-clock provider identity this proof was established under.
    pub(crate) fn provider_id(&self) -> &str {
        &self.provider_id
    }
    /// The provider epoch this proof was established under.
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }

    /// Re-check this ALREADY-VERIFIED presence against a required policy. A proof verified for one
    /// policy fails when presented to an operation requiring a different one. Fail closed.
    ///
    /// # Errors
    /// [`OwnerPresenceError`] naming the first mismatch.
    pub(crate) fn satisfies(&self, r: &RequiredOwnerPresence) -> Result<(), OwnerPresenceError> {
        if self.verifier != r.required_verifier {
            return Err(OwnerPresenceError::VerifierMismatch);
        }
        if self.generation < r.min_generation {
            return Err(OwnerPresenceError::StaleGeneration);
        }
        Ok(())
    }
}

/// Why owner-presence verification failed. Fail closed; every variant is payload-free (no raw proof id,
/// verifier secret, or authentication material).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OwnerPresenceError {
    /// A bounded identifier was empty/over-long/illegal.
    Malformed,
    /// The verifier identity did not match the required policy.
    VerifierMismatch,
    /// The proof generation was below the required minimum.
    StaleGeneration,
    /// The proof validity window was invalid (`valid_until <= observed_at`).
    ProofWindowInvalid,
    /// The proof had expired at verification time (`now >= valid_until`).
    Expired,
    /// The current trusted-clock reading came from a DIFFERENT provider than the proof was established
    /// under (temporal provider identity substitution).
    ProviderMismatch,
    /// The current trusted-clock reading came from an EARLIER/DIFFERENT provider epoch than the proof was
    /// established under (provider restart / epoch rollover).
    EpochMismatch,
}

impl From<RecordError> for OwnerPresenceError {
    fn from(_: RecordError) -> Self {
        OwnerPresenceError::Malformed
    }
}

/// Verify an untrusted owner-presence observation against a required policy, at the CURRENT trusted time
/// `now` obtained from a [`crate::authority_time::TrustedClock`] provider (never a caller-supplied
/// value). The SOLE mint of a [`VerifiedOwnerPresence`]. The raw proof id is hashed (domain-separated)
/// into an opaque digest and never retained; the proof records the provider identity + epoch so a later
/// reading from a different provider/epoch is refused.
///
/// # Errors
/// [`OwnerPresenceError`] on the first failed invariant.
pub fn verify_owner_presence(
    obs: &OwnerPresenceObservation,
    required: &RequiredOwnerPresence,
    now: &crate::authority_time::VerifiedAuthorityTime,
) -> Result<VerifiedOwnerPresence, OwnerPresenceError> {
    validate_bounded_id(&obs.proof_id)?;
    validate_bounded_id(&obs.verifier)?;
    validate_bounded_id(&required.required_verifier)?;
    if obs.verifier != required.required_verifier {
        return Err(OwnerPresenceError::VerifierMismatch);
    }
    if obs.generation < required.min_generation {
        return Err(OwnerPresenceError::StaleGeneration);
    }
    if obs.valid_until <= obs.observed_at {
        return Err(OwnerPresenceError::ProofWindowInvalid);
    }
    if now.reading() >= obs.valid_until {
        return Err(OwnerPresenceError::Expired);
    }
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:OWNER-PRESENCE-PROOF:V1");
    h.update(obs.proof_id.as_bytes());
    Ok(VerifiedOwnerPresence {
        proof_digest: h.finalize().into(),
        verifier: obs.verifier.clone(),
        observed_at: obs.observed_at,
        valid_until: obs.valid_until,
        generation: obs.generation,
        provider_id: now.provider_id().to_string(),
        epoch: now.epoch(),
    })
}

// ---------------------------------------------------------------------------------------------
// Operation-bound owner-presence fact
// ---------------------------------------------------------------------------------------------

/// An owner-presence fact BOUND to exactly one operation. A bare [`VerifiedOwnerPresence`] proves the
/// owner was present, but says nothing about WHICH operation may consume it; presenting the same
/// verified presence through a fact bound to a different operation must be refused. This wrapper binds
/// the presence to the operation's project, environment, phase, approved-plan binding, operation
/// reference, (owner-presence-policy-folded) fingerprint and repository-context identity, plus the
/// proof's own generation and validity boundary (cached so the reducer can prove fact↔presence
/// consistency).
///
/// Authority: the ONLY constructor is [`ValidatedOwnerPresenceFact::bind`], which CONSUMES a real
/// `VerifiedOwnerPresence` (mintable only by [`verify_owner_presence`]). No `Default`, no public field,
/// no serde, no `From<OwnerPresenceObservation>`/`From<&str>`/`From<bool>`, redacted `Debug`. Fields are
/// immutable after binding, so a report or caller cannot rebind an existing fact to another operation.
#[derive(Clone, PartialEq, Eq)]
pub struct ValidatedOwnerPresenceFact {
    presence: VerifiedOwnerPresence,
    project: ProjectId,
    environment: EnvironmentId,
    phase: PhaseId,
    plan_binding: Option<ApprovedPlanBinding>,
    operation: OperationRef,
    fingerprint: OperationFingerprint,
    repository_binding: Option<RepositoryAuthorityBinding>,
    generation: u64,
    valid_until: u64,
}

impl fmt::Debug for ValidatedOwnerPresenceFact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ValidatedOwnerPresenceFact(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl ValidatedOwnerPresenceFact {
    /// Bind a verified presence to exactly one operation. The generation and validity boundary are
    /// copied from the presence (never caller-supplied). Consumes the presence: an owned
    /// `VerifiedOwnerPresence` is the authority gate — it cannot be forged.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn bind(
        presence: VerifiedOwnerPresence,
        project: &ProjectId,
        environment: &EnvironmentId,
        phase: &PhaseId,
        plan_binding: Option<&ApprovedPlanBinding>,
        operation: &OperationRef,
        fingerprint: &OperationFingerprint,
        repository: Option<&ValidatedRepositoryFact>,
    ) -> Self {
        let generation = presence.generation();
        let valid_until = presence.valid_until();
        // The repository AUTHORITY-STATE binding is DERIVED from the already-validated repository fact
        // (baseline content + generation) — never a caller-supplied identity/token — so the presence
        // proof cannot be replayed after the repository changes state.
        let repository_binding = repository.map(ValidatedRepositoryFact::authority_binding);
        Self {
            presence,
            project: project.clone(),
            environment: environment.clone(),
            phase: phase.clone(),
            plan_binding: plan_binding.cloned(),
            operation: operation.clone(),
            fingerprint: fingerprint.clone(),
            repository_binding,
            generation,
            valid_until,
        }
    }

    /// The verified presence (crate-internal; re-checked against the required policy by the reducer).
    pub(crate) fn presence(&self) -> &VerifiedOwnerPresence {
        &self.presence
    }
    pub(crate) fn project(&self) -> &ProjectId {
        &self.project
    }
    pub(crate) fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    pub(crate) fn phase(&self) -> &PhaseId {
        &self.phase
    }
    pub(crate) fn plan_binding(&self) -> Option<&ApprovedPlanBinding> {
        self.plan_binding.as_ref()
    }
    pub(crate) fn operation(&self) -> &OperationRef {
        &self.operation
    }
    pub(crate) fn fingerprint(&self) -> &OperationFingerprint {
        &self.fingerprint
    }
    pub(crate) fn repository_binding(&self) -> Option<&RepositoryAuthorityBinding> {
        self.repository_binding.as_ref()
    }
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn valid_until(&self) -> u64 {
        self.valid_until
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl ValidatedOwnerPresenceFact {
    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `generation` scalar, leaving the embedded
    /// presence untouched — an intentionally inconsistent fact used to prove the reducer's
    /// fact↔presence generation-consistency check is load-bearing. Feature-gated; mints no authority.
    #[must_use]
    pub fn with_generation_for_test(&self, generation: u64) -> Self {
        Self {
            generation,
            ..self.clone()
        }
    }

    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `valid_until` scalar. As above, isolates
    /// the reducer's fact↔presence validity-boundary consistency check.
    #[must_use]
    pub fn with_valid_until_for_test(&self, valid_until: u64) -> Self {
        Self {
            valid_until,
            ..self.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority_time::{FixtureClock, TrustedClock};

    fn clk(reading: u64) -> crate::authority_time::VerifiedAuthorityTime {
        FixtureClock::new(reading).read_current()
    }

    fn obs() -> OwnerPresenceObservation {
        OwnerPresenceObservation {
            proof_id: "proof-1".into(),
            verifier: "hello".into(),
            observed_at: 100,
            valid_until: 200,
            generation: 5,
        }
    }

    fn required() -> RequiredOwnerPresence {
        RequiredOwnerPresence {
            required_verifier: "hello".into(),
            min_generation: 5,
        }
    }

    #[test]
    fn a_valid_observation_verifies() {
        let p = verify_owner_presence(&obs(), &required(), &clk(150)).unwrap();
        assert_eq!(p.generation(), 5);
        assert_eq!(p.valid_until(), 200);
        p.satisfies(&required()).unwrap();
    }

    #[test]
    fn a_wrong_verifier_is_refused() {
        let mut o = obs();
        o.verifier = "webauthn".into();
        assert_eq!(
            verify_owner_presence(&o, &required(), &clk(150)),
            Err(OwnerPresenceError::VerifierMismatch)
        );
    }

    #[test]
    fn a_below_minimum_generation_is_refused() {
        let mut r = required();
        r.min_generation = 6;
        assert_eq!(
            verify_owner_presence(&obs(), &r, &clk(150)),
            Err(OwnerPresenceError::StaleGeneration)
        );
    }

    #[test]
    fn an_invalid_window_is_refused() {
        let mut o = obs();
        o.valid_until = 100; // == observed_at
        assert_eq!(
            verify_owner_presence(&o, &required(), &clk(50)),
            Err(OwnerPresenceError::ProofWindowInvalid)
        );
    }

    #[test]
    fn an_expired_proof_is_refused() {
        assert_eq!(
            verify_owner_presence(&obs(), &required(), &clk(200)), // now == valid_until
            Err(OwnerPresenceError::Expired)
        );
        assert_eq!(
            verify_owner_presence(&obs(), &required(), &clk(250)),
            Err(OwnerPresenceError::Expired)
        );
    }

    #[test]
    fn a_malformed_identifier_is_refused() {
        let mut o = obs();
        o.proof_id = String::new();
        assert_eq!(
            verify_owner_presence(&o, &required(), &clk(150)),
            Err(OwnerPresenceError::Malformed)
        );
        let mut o = obs();
        o.verifier = "has space".into();
        assert_eq!(
            verify_owner_presence(&o, &required(), &clk(150)),
            Err(OwnerPresenceError::Malformed)
        );
    }

    #[test]
    fn satisfies_re_checks_verifier_and_generation() {
        let p = verify_owner_presence(&obs(), &required(), &clk(150)).unwrap();
        let mut wrong = required();
        wrong.required_verifier = "other".into();
        assert_eq!(
            p.satisfies(&wrong),
            Err(OwnerPresenceError::VerifierMismatch)
        );
        let mut higher = required();
        higher.min_generation = 6;
        assert_eq!(
            p.satisfies(&higher),
            Err(OwnerPresenceError::StaleGeneration)
        );
    }

    #[test]
    fn a_different_policy_changes_the_fingerprint() {
        let base = OperationFingerprint::new("fp").unwrap();
        let f1 = fold_owner_presence_fingerprint(&base, &required());
        let mut r2 = required();
        r2.required_verifier = "webauthn".into();
        assert_ne!(f1, fold_owner_presence_fingerprint(&base, &r2));
        let mut r3 = required();
        r3.min_generation = 9;
        assert_ne!(f1, fold_owner_presence_fingerprint(&base, &r3));
    }

    #[test]
    fn debug_never_renders_the_raw_proof() {
        let p = verify_owner_presence(&obs(), &required(), &clk(150)).unwrap();
        let s = format!("{p:?}");
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains("proof-1"));
    }
}
