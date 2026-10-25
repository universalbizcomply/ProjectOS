//! Elevation authority (CD-B4-ELEVATION-VALIDATED-FACT-INTEGRATION1A, Pattern C).
//!
//! Elevation is DISTINCT from owner APPROVAL, owner PRESENCE ([`crate::owner_presence`]) and downstream
//! EFFECT authority. A compiled ability to *observe* elevation is not authority; neither is a Boolean
//! `is_elevated`, a report, administrator-group membership, caller-supplied process metadata, or an
//! unrestricted Windows token read. The only elevation authority values here are the opaque
//! [`VerifiedElevation`] and the operation-bound [`ValidatedElevationFact`], both minted ONLY by the
//! crate-controlled functions below from an UNTRUSTED [`ElevationObservation`] a future adapter measured.
//! Every opaque type has private fields, no public constructor, no `Default`, no serde-as-authority, no
//! broad `From`, and a redacted `Debug`.
//!
//! Elevation is PROCESS-SPECIFIC: a proof that process A is elevated must never authorise process B. The
//! fact binds the observed process identity (pid + creation tick); the reducer refuses a fact whose bound
//! process differs from the operation's expected process, so a proof cannot be replayed across a process
//! restart (same pid, new creation tick) or a different process.
//!
//! ## Production readiness
//!
//! This phase ships NO production elevation producer. The host-authority current-process elevation
//! OBSERVATION engine is compiled-but-never-executed and mints no witness; a production adapter that
//! feeds [`ElevationObservation`] is CARRY-FORWARD. The fixture path is test-gated. `EXECUTION_READY`
//! stays false; elevation is NOT approval, NOT owner presence, and NOT effect authority, and it never
//! itself performs a protected action.

#![allow(dead_code)]

use core::fmt;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, OperationRef, ProjectId};

use crate::error::RecordError;
use crate::facts::{validate_bounded_id, SessionId, ValidatedSession};
use crate::owner_presence::ValidatedOwnerPresenceFact;
use crate::phase::PhaseId;
use crate::plan::ApprovedPlanBinding;
use crate::repository::{RepositoryAuthorityBinding, ValidatedRepositoryFact};

// ---------------------------------------------------------------------------------------------
// Elevation level (bounded; never a bare Boolean)
// ---------------------------------------------------------------------------------------------

/// The bounded elevation level an observation reports / a policy requires. A closed enum, never a bare
/// `bool`: administrator-group membership is deliberately NOT a level (membership is not elevation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ElevationLevel {
    /// The process is not running with a genuinely elevated token.
    NotElevated,
    /// The process is running with a genuinely elevated token (`TokenIsElevated`, type-consistent).
    Elevated,
}

impl ElevationLevel {
    /// Monotonic rank so a policy can require "at least" a level. Only `Elevated` satisfies `Elevated`.
    fn rank(self) -> u8 {
        match self {
            ElevationLevel::NotElevated => 0,
            ElevationLevel::Elevated => 1,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Untrusted observation (what an elevation adapter measured)
// ---------------------------------------------------------------------------------------------

/// The parsed, still-UNTRUSTED result an elevation adapter reports for ONE process. Every field is
/// adapter-supplied and re-validated by [`verify_elevation`]; nothing here is authority. `pid` +
/// `creation_tick` identify the observed process (pid alone is reusable and insufficient).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElevationObservation {
    /// Bounded proof/nonce identifier for this attestation. Never rendered.
    pub proof_id: String,
    /// Bounded attestation-source identity that produced the reading (folded into the proof digest, so a
    /// different source yields a distinct proof identity).
    pub source: String,
    /// The observed elevation level.
    pub level: ElevationLevel,
    /// Monotonic tick at which elevation was observed (adapter clock).
    pub observed_at: u64,
    /// Monotonic tick after which the observation is no longer valid.
    pub valid_until: u64,
    /// Observation generation (bumped when re-observed). Independently context-compared.
    pub generation: u64,
    /// Observed process id.
    pub pid: u32,
    /// Observed process creation tick (with `pid`, the process identity; defeats pid reuse / restart).
    pub creation_tick: u64,
}

/// The elevation policy an operation requires. `None` on the operation means "not required" (a policy
/// type, never a bare Boolean). Folded into the operation fingerprint, so changing the required level or
/// minimum generation changes the fingerprint and invalidates prior approval/permit authority. The
/// expected process identity is carried as a binding (checked distinctly), not folded, because it is a
/// runtime identity rather than an operation-policy value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredElevation {
    /// The minimum acceptable elevation level.
    pub minimum_level: ElevationLevel,
    /// The minimum acceptable observation generation.
    pub min_generation: u64,
    /// The pid the operation expects to execute in (the elevated process).
    pub expected_pid: u32,
    /// The creation tick of the expected process (with `expected_pid`, its full identity).
    pub expected_creation_tick: u64,
}

impl RequiredElevation {
    fn fingerprint_material(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:ELEVATION-POLICY:V1");
        h.update([self.minimum_level.rank()]);
        h.update(self.min_generation.to_be_bytes());
        h.finalize().into()
    }
}

/// Fold a required elevation policy into an already-bound operation fingerprint. Changing the required
/// level or minimum generation changes the fingerprint (so approval, which is fingerprint-bound, is
/// transitively elevation-policy bound).
#[must_use]
pub fn fold_elevation_fingerprint(
    base: &OperationFingerprint,
    required: &RequiredElevation,
) -> OperationFingerprint {
    let mut h = Sha256::new();
    h.update(base.as_str().as_bytes());
    h.update(b"PROJECTOS:OPERATION-ELEVATION-BINDING:V1");
    h.update(required.fingerprint_material());
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    OperationFingerprint::new(hex).expect("a 64-hex-digit token is a valid OperationFingerprint")
}

// ---------------------------------------------------------------------------------------------
// Opaque verified elevation (the sole elevation authority value)
// ---------------------------------------------------------------------------------------------

/// A verified elevation proof. Opaque: private fields, no public constructor, no `Default`, no
/// serde-as-authority, redacted Debug. Minted ONLY by [`verify_elevation`]. Content equality excludes
/// `generation`, `valid_until` and the process identity so each surfaces as its own distinct
/// execution-context field rather than as a proof-identity change.
#[derive(Clone)]
pub struct VerifiedElevation {
    proof_digest: [u8; 32],
    level: ElevationLevel,
    observed_at: u64,
    valid_until: u64,
    generation: u64,
    /// The trusted-clock provider identity + epoch this proof was established under. Evaluation refuses a
    /// current reading from a different provider or an earlier epoch. DISTINCT from the elevation verifier.
    provider_id: String,
    epoch: u64,
    /// The ELEVATION VERIFIER identity + epoch that attested the observation. This is NOT the trusted-clock
    /// provider: the clock authenticates time, the verifier authenticates the elevation reading. Evaluation
    /// refuses a proof whose verifier differs (substitution) or whose verifier epoch is stale (restart).
    verifier_id: String,
    verifier_epoch: u64,
    /// The authenticated session the proof was verified under. A proof from session S1 is refused in S2.
    session: SessionId,
    /// The observed process identity (pid + creation tick).
    pid: u32,
    creation_tick: u64,
}

impl fmt::Debug for VerifiedElevation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "VerifiedElevation(gen={}, [REDACTED])", self.generation)
    }
}

impl PartialEq for VerifiedElevation {
    fn eq(&self, other: &Self) -> bool {
        self.proof_digest == other.proof_digest
            && self.level == other.level
            && self.observed_at == other.observed_at
    }
}
impl Eq for VerifiedElevation {}

impl VerifiedElevation {
    pub(crate) fn level(&self) -> ElevationLevel {
        self.level
    }
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn valid_until(&self) -> u64 {
        self.valid_until
    }
    pub(crate) fn provider_id(&self) -> &str {
        &self.provider_id
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }
    pub(crate) fn verifier_id(&self) -> &str {
        &self.verifier_id
    }
    pub(crate) fn verifier_epoch(&self) -> u64 {
        self.verifier_epoch
    }
    pub(crate) fn session(&self) -> &SessionId {
        &self.session
    }
    pub(crate) fn pid(&self) -> u32 {
        self.pid
    }
    pub(crate) fn creation_tick(&self) -> u64 {
        self.creation_tick
    }
    pub(crate) fn proof_digest(&self) -> [u8; 32] {
        self.proof_digest
    }

    /// Re-check this ALREADY-VERIFIED elevation against a required policy. A proof verified for one policy
    /// fails when presented to an operation requiring a stronger level or higher generation. Fail closed.
    ///
    /// # Errors
    /// [`ElevationError`] naming the first mismatch.
    pub(crate) fn satisfies(&self, r: &RequiredElevation) -> Result<(), ElevationError> {
        if self.level.rank() < r.minimum_level.rank() {
            return Err(ElevationError::LevelInsufficient);
        }
        if self.generation < r.min_generation {
            return Err(ElevationError::StaleGeneration);
        }
        Ok(())
    }
}

/// Why elevation verification failed. Fail closed; every variant is payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ElevationError {
    /// A bounded identifier was empty/over-long/illegal.
    Malformed,
    /// The observed level was below the required minimum (e.g. not elevated).
    LevelInsufficient,
    /// The observation generation was below the required minimum.
    StaleGeneration,
    /// The validity window was invalid (`valid_until <= observed_at`).
    ProofWindowInvalid,
    /// The proof had expired at evaluation time (`now >= valid_until`).
    Expired,
    /// The current trusted-clock reading came from a DIFFERENT provider than the proof was established
    /// under (temporal provider identity substitution).
    ProviderMismatch,
    /// The current trusted-clock reading came from an EARLIER/DIFFERENT provider epoch (provider restart).
    EpochMismatch,
    /// The proof was attested by a DIFFERENT elevation verifier than the current one (verifier
    /// substitution). DISTINCT from the trusted-clock `ProviderMismatch`.
    VerifierMismatch,
    /// The elevation verifier epoch differed (verifier restart / rollover). DISTINCT from the clock
    /// `EpochMismatch`.
    VerifierEpochMismatch,
}

impl From<RecordError> for ElevationError {
    fn from(_: RecordError) -> Self {
        ElevationError::Malformed
    }
}

/// Crate-private sealing marker for [`ElevationVerifier`]. `sealed` is a PRIVATE module, so no external
/// crate can name `Sealed` and therefore none can implement the verifier: a caller cannot substitute a
/// fake elevation attestation source. Only crate-controlled verifiers (the fixture now; a production
/// adapter later, added by an explicit core change) may implement it.
mod sealed {
    pub trait Sealed {}
}

/// The crate-internal mint. Validates an untrusted observation and stamps the verifier identity + epoch,
/// the authenticated session, the trusted-clock provider identity + epoch, and the process identity into
/// an opaque [`VerifiedElevation`]. `VerifiedElevation::new`-equivalent construction lives ONLY here, so a
/// verified elevation can be produced only through a sealed verifier's [`ElevationVerifier::verify`].
fn mint(
    verifier_id: &str,
    verifier_epoch: u64,
    obs: &ElevationObservation,
    required: &RequiredElevation,
    now: &crate::authority_time::VerifiedAuthorityTime,
    session: &ValidatedSession,
) -> Result<VerifiedElevation, ElevationError> {
    validate_bounded_id(&obs.proof_id)?;
    validate_bounded_id(&obs.source)?;
    if obs.level.rank() < required.minimum_level.rank() {
        return Err(ElevationError::LevelInsufficient);
    }
    if obs.generation < required.min_generation {
        return Err(ElevationError::StaleGeneration);
    }
    if obs.valid_until <= obs.observed_at {
        return Err(ElevationError::ProofWindowInvalid);
    }
    if now.reading() >= obs.valid_until {
        return Err(ElevationError::Expired);
    }
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:ELEVATION-PROOF:V1");
    h.update((obs.proof_id.len() as u64).to_be_bytes());
    h.update(obs.proof_id.as_bytes());
    h.update(obs.source.as_bytes());
    Ok(VerifiedElevation {
        proof_digest: h.finalize().into(),
        level: obs.level,
        observed_at: obs.observed_at,
        valid_until: obs.valid_until,
        generation: obs.generation,
        provider_id: now.provider_id().to_string(),
        epoch: now.epoch(),
        verifier_id: verifier_id.to_string(),
        verifier_epoch,
        session: session.session.clone(),
        pid: obs.pid,
        creation_tick: obs.creation_tick,
    })
}

/// The sealed elevation VERIFIER contract. A verifier is the crate-controlled authority that decides
/// whether and how an UNTRUSTED [`ElevationObservation`] becomes a [`VerifiedElevation`]. A caller may
/// supply observation data, but only a sealed verifier may attest it — there is no free public mint, and
/// no external crate can implement this trait. The verifier is DISTINCT from the trusted clock: the clock
/// authenticates time; the verifier authenticates the elevation reading.
pub trait ElevationVerifier: sealed::Sealed {
    /// The verifier's opaque authority identity (not caller-selectable).
    fn verifier_id(&self) -> &str;
    /// The verifier's epoch (bumped on restart / rollover; not caller-selectable).
    fn verifier_epoch(&self) -> u64;
    /// Attest an untrusted observation into an opaque [`VerifiedElevation`], stamping this verifier's
    /// identity + epoch, the authenticated session, and the current trusted-clock reading.
    ///
    /// # Errors
    /// [`ElevationError`] on the first failed invariant.
    fn verify(
        &self,
        obs: &ElevationObservation,
        required: &RequiredElevation,
        now: &crate::authority_time::VerifiedAuthorityTime,
        session: &ValidatedSession,
    ) -> Result<VerifiedElevation, ElevationError> {
        mint(
            self.verifier_id(),
            self.verifier_epoch(),
            obs,
            required,
            now,
            session,
        )
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture::FixtureElevationVerifier;

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture {
    use super::{sealed, ElevationVerifier};
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering};
    use std::rc::Rc;

    struct VerifierState {
        verifier_id: String,
        epoch: Cell<u64>,
    }

    /// TEST-ONLY sealed elevation verifier. Its identity is NOT caller-selectable — a unique instance id
    /// is crate-assigned at construction; `next_epoch` simulates a verifier restart. Every handle/clone
    /// shares the same authoritative state. A production graph never builds it.
    #[derive(Clone)]
    pub struct FixtureElevationVerifier {
        state: Rc<VerifierState>,
    }

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    impl FixtureElevationVerifier {
        /// A fresh verifier with a UNIQUE, non-caller-selectable identity, at epoch 1.
        #[must_use]
        pub fn new() -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            Self {
                state: Rc::new(VerifierState {
                    verifier_id: format!("fixture-elev-verifier-{id}"),
                    epoch: Cell::new(1),
                }),
            }
        }

        /// Another handle to the SAME authoritative verifier state.
        #[must_use]
        pub fn handle(&self) -> Self {
            Self {
                state: Rc::clone(&self.state),
            }
        }

        /// Simulate a verifier restart / epoch rollover on the shared state.
        pub fn next_epoch(&self) {
            self.state.epoch.set(self.state.epoch.get() + 1);
        }
    }

    impl Default for FixtureElevationVerifier {
        fn default() -> Self {
            Self::new()
        }
    }

    impl sealed::Sealed for FixtureElevationVerifier {}
    impl ElevationVerifier for FixtureElevationVerifier {
        fn verifier_id(&self) -> &str {
            &self.state.verifier_id
        }
        fn verifier_epoch(&self) -> u64 {
            self.state.epoch.get()
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Operation-bound elevation fact
// ---------------------------------------------------------------------------------------------

/// An elevation fact BOUND to exactly one operation. A bare [`VerifiedElevation`] proves a process was
/// elevated but says nothing about WHICH operation may consume it; presenting the same verified elevation
/// through a fact bound to a different operation must be refused. This wrapper binds the elevation to the
/// operation's project, environment, phase, approved-plan binding, operation reference,
/// (elevation-policy-folded) fingerprint, repository authority state, and — where the operation requires
/// both — the owner-presence proof identity, plus the proof's own generation and validity boundary.
///
/// Authority: the ONLY constructor is [`ValidatedElevationFact::bind`], which CONSUMES a real
/// `VerifiedElevation` (mintable only by [`verify_elevation`]). No `Default`, no public field, no serde,
/// no `From<ElevationObservation>`/`From<bool>`, redacted `Debug`. Fields are immutable after binding.
#[derive(Clone, PartialEq, Eq)]
pub struct ValidatedElevationFact {
    elevation: VerifiedElevation,
    project: ProjectId,
    environment: EnvironmentId,
    phase: PhaseId,
    plan_binding: Option<ApprovedPlanBinding>,
    operation: OperationRef,
    fingerprint: OperationFingerprint,
    repository_binding: Option<RepositoryAuthorityBinding>,
    /// The owner-presence proof digest this elevation is jointly bound to, where the operation requires
    /// both. `None` when the operation does not require owner presence.
    owner_presence_binding: Option<[u8; 32]>,
    generation: u64,
    valid_until: u64,
}

impl fmt::Debug for ValidatedElevationFact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ValidatedElevationFact(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl ValidatedElevationFact {
    /// Bind a verified elevation to exactly one operation. The generation and validity boundary are copied
    /// from the elevation (never caller-supplied). The repository authority-state binding and the
    /// owner-presence binding are DERIVED from the already-validated facts, never caller-supplied.
    /// Consumes the elevation: an owned `VerifiedElevation` is the un-forgeable authority gate.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn bind(
        elevation: VerifiedElevation,
        project: &ProjectId,
        environment: &EnvironmentId,
        phase: &PhaseId,
        plan_binding: Option<&ApprovedPlanBinding>,
        operation: &OperationRef,
        fingerprint: &OperationFingerprint,
        repository: Option<&ValidatedRepositoryFact>,
        owner_presence: Option<&ValidatedOwnerPresenceFact>,
    ) -> Self {
        let generation = elevation.generation();
        let valid_until = elevation.valid_until();
        let repository_binding = repository.map(ValidatedRepositoryFact::authority_binding);
        let owner_presence_binding =
            owner_presence.map(ValidatedOwnerPresenceFact::presence_proof_digest);
        Self {
            elevation,
            project: project.clone(),
            environment: environment.clone(),
            phase: phase.clone(),
            plan_binding: plan_binding.cloned(),
            operation: operation.clone(),
            fingerprint: fingerprint.clone(),
            repository_binding,
            owner_presence_binding,
            generation,
            valid_until,
        }
    }

    pub(crate) fn elevation(&self) -> &VerifiedElevation {
        &self.elevation
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
    pub(crate) fn owner_presence_binding(&self) -> Option<[u8; 32]> {
        self.owner_presence_binding
    }
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn valid_until(&self) -> u64 {
        self.valid_until
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl ValidatedElevationFact {
    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `generation` scalar, leaving the embedded
    /// elevation untouched — an intentionally inconsistent fact used to prove the reducer's fact↔proof
    /// generation-consistency check is load-bearing. Feature-gated; mints no authority.
    #[must_use]
    pub fn with_generation_for_test(&self, generation: u64) -> Self {
        Self {
            generation,
            ..self.clone()
        }
    }

    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `valid_until` scalar.
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

    fn session() -> ValidatedSession {
        ValidatedSession {
            session: SessionId::new("sess-1"),
        }
    }

    fn obs() -> ElevationObservation {
        ElevationObservation {
            proof_id: "proof-1".into(),
            source: "adapter".into(),
            level: ElevationLevel::Elevated,
            observed_at: 100,
            valid_until: 200,
            generation: 5,
            pid: 4242,
            creation_tick: 999,
        }
    }

    fn required() -> RequiredElevation {
        RequiredElevation {
            minimum_level: ElevationLevel::Elevated,
            min_generation: 5,
            expected_pid: 4242,
            expected_creation_tick: 999,
        }
    }

    /// Mint through the sealed fixture verifier (the only in-crate authority path).
    fn mint_e(
        o: &ElevationObservation,
        r: &RequiredElevation,
        now: &crate::authority_time::VerifiedAuthorityTime,
    ) -> Result<VerifiedElevation, ElevationError> {
        FixtureElevationVerifier::new().verify(o, r, now, &session())
    }

    #[test]
    fn a_valid_observation_verifies() {
        let e = mint_e(&obs(), &required(), &clk(150)).unwrap();
        assert_eq!(e.generation(), 5);
        assert_eq!(e.valid_until(), 200);
        assert_eq!(e.pid(), 4242);
        assert_eq!(e.creation_tick(), 999);
        e.satisfies(&required()).unwrap();
    }

    #[test]
    fn a_not_elevated_observation_is_refused() {
        let mut o = obs();
        o.level = ElevationLevel::NotElevated;
        assert_eq!(
            mint_e(&o, &required(), &clk(150)),
            Err(ElevationError::LevelInsufficient)
        );
    }

    #[test]
    fn a_below_minimum_generation_is_refused() {
        let mut r = required();
        r.min_generation = 6;
        assert_eq!(
            mint_e(&obs(), &r, &clk(150)),
            Err(ElevationError::StaleGeneration)
        );
    }

    #[test]
    fn an_invalid_window_is_refused() {
        let mut o = obs();
        o.valid_until = 100;
        assert_eq!(
            mint_e(&o, &required(), &clk(50)),
            Err(ElevationError::ProofWindowInvalid)
        );
    }

    #[test]
    fn an_expired_proof_is_refused() {
        assert_eq!(
            mint_e(&obs(), &required(), &clk(200)),
            Err(ElevationError::Expired)
        );
    }

    #[test]
    fn a_malformed_identifier_is_refused() {
        let mut o = obs();
        o.proof_id = String::new();
        assert_eq!(
            mint_e(&o, &required(), &clk(150)),
            Err(ElevationError::Malformed)
        );
        let mut o = obs();
        o.source = "has space".into();
        assert_eq!(
            mint_e(&o, &required(), &clk(150)),
            Err(ElevationError::Malformed)
        );
    }

    #[test]
    fn satisfies_re_checks_level_and_generation() {
        let e = mint_e(&obs(), &required(), &clk(150)).unwrap();
        let mut higher = required();
        higher.min_generation = 6;
        assert_eq!(e.satisfies(&higher), Err(ElevationError::StaleGeneration));
    }

    #[test]
    fn a_different_policy_changes_the_fingerprint() {
        let base = OperationFingerprint::new("fp").unwrap();
        let f1 = fold_elevation_fingerprint(&base, &required());
        let mut r2 = required();
        r2.min_generation = 9;
        assert_ne!(f1, fold_elevation_fingerprint(&base, &r2));
        let mut r3 = required();
        r3.expected_pid = 1;
        assert_eq!(f1, fold_elevation_fingerprint(&base, &r3));
    }

    #[test]
    fn debug_never_renders_the_raw_proof() {
        let e = mint_e(&obs(), &required(), &clk(150)).unwrap();
        let s = format!("{e:?}");
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains("proof-1"));
    }

    #[test]
    fn the_verifier_identity_is_distinct_from_the_clock_provider() {
        // V7: the elevation verifier identity is NOT the trusted-clock provider identity.
        let now = clk(150);
        let e = mint_e(&obs(), &required(), &now).unwrap();
        assert!(e.verifier_id().starts_with("fixture-elev-verifier-"));
        assert_ne!(e.verifier_id(), e.provider_id());
    }

    #[test]
    fn every_verifier_has_a_distinct_identity_and_restart_bumps_epoch() {
        let a = FixtureElevationVerifier::new();
        let b = FixtureElevationVerifier::new();
        assert_ne!(a.verifier_id(), b.verifier_id());
        assert_eq!(a.verifier_epoch(), 1);
        a.next_epoch();
        assert_eq!(a.verifier_epoch(), 2);
        // A handle shares the same state.
        assert_eq!(a.handle().verifier_epoch(), 2);
    }

    #[test]
    fn the_session_is_bound_into_the_proof() {
        let e = mint_e(&obs(), &required(), &clk(150)).unwrap();
        assert_eq!(e.session(), &SessionId::new("sess-1"));
    }
}
