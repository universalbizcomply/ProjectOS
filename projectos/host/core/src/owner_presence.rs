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
//! The public [`verify_owner_presence`] is the FIXTURE/CONTRACT verifier: it mints a
//! [`VerifiedOwnerPresence`] from a caller-constructible [`OwnerPresenceObservation`] and yields NO
//! production authority. Production owner presence (CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A,
//! owner-approved Option C1) is minted ONLY by [`verify_production_owner_presence`], which consumes a
//! single-use [`ProductionOwnerPresenceBindingGrant`] issued ONLY by the sealed
//! [`ProductionOwnerPresenceCapability`] from `Production`-sourced, explicitly-confirmed evidence bound
//! to the exact operation, display summary, runtime instance, IPC session, provider identity, provider
//! epoch and validity window. Caller data, a renderer bool/enum, or fixture-sourced evidence can never
//! reach the production path. This phase wires NO capability-acquisition route (the trusted interactive
//! confirmation adapter is CARRY-FORWARD), so a default build has no way to obtain a capability and no
//! production activation route exists. `EXECUTION_READY` stays false; owner presence is NOT owner
//! approval, NOT elevation, and NOT effect authority.

#![allow(dead_code)]

use core::fmt;
use core::marker::PhantomData;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, OperationRef, ProjectId};

use crate::authority_time::VerifiedAuthorityTime;
use crate::error::RecordError;
use crate::facts::validate_bounded_id;
use crate::ipc_session::BoundIpcSession;
use crate::phase::PhaseId;
use crate::plan::ApprovedPlanBinding;
use crate::repository::{RepositoryAuthorityBinding, ValidatedRepositoryFact};
use crate::runtime_instance::VerifiedRuntimeInstance;

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
    /// The opaque proof digest (crate-internal joint-binding key for the elevation fact).
    pub(crate) fn proof_digest(&self) -> [u8; 32] {
        self.proof_digest
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
    /// The owner refused the displayed operation (production confirmation path).
    Refused,
    /// The owner cancelled/dismissed the displayed operation (production confirmation path).
    Cancelled,
    /// The evidence was fixture/synthetic-sourced and cannot mint production authority.
    FixtureSource,
    /// The live operation digest did not match the operation the owner confirmed.
    OperationMismatch,
    /// The live display-summary digest did not match the summary the owner saw.
    DisplaySummaryMismatch,
    /// The live runtime instance did not match the instance the grant was bound to.
    RuntimeMismatch,
    /// The live IPC session did not match the session the grant was bound to.
    IpcSessionMismatch,
}

impl From<RecordError> for OwnerPresenceError {
    fn from(_: RecordError) -> Self {
        OwnerPresenceError::Malformed
    }
}

/// Verify an untrusted owner-presence observation against a required policy, at the CURRENT trusted time
/// `now` obtained from a [`crate::authority_time::TrustedClock`] provider (never a caller-supplied
/// value). This is the FIXTURE/CONTRACT verifier — it mints a [`VerifiedOwnerPresence`] from
/// caller-constructible observation data and therefore yields NO production authority. Production owner
/// presence is minted ONLY by [`verify_production_owner_presence`] from a sealed
/// [`ProductionOwnerPresenceBindingGrant`]; caller observation data can never reach that path. The raw
/// proof id is hashed (domain-separated) into an opaque digest and never retained; the proof records the
/// provider identity + epoch so a later reading from a different provider/epoch is refused.
///
/// # Errors
/// [`OwnerPresenceError`] on the first failed invariant.
///
/// TEST/FIXTURE-GATED: this legacy fixture/contract mint is `#[cfg(any(test, feature =
/// "test-fixtures"))]`, so a default (production) build exposes NO observation-based mint of
/// `VerifiedOwnerPresence`. The ONLY production-eligible mint in a default build is
/// [`verify_production_owner_presence`], which requires a sealed
/// [`ProductionOwnerPresenceBindingGrant`]. This structurally prevents caller-constructible /
/// fixture observation data from entering any production owner-presence fact, permit or effect-grant
/// path — it is not a documentation-only control.
#[cfg(any(test, feature = "test-fixtures"))]
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
    /// The embedded proof digest — the joint-binding key an elevation fact records so an elevation proof
    /// cannot be combined with an owner-presence proof from a different context.
    pub(crate) fn presence_proof_digest(&self) -> [u8; 32] {
        self.presence.proof_digest()
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

// ---------------------------------------------------------------------------------------------
// Production owner-presence provider (Option C1) — sealed binding grant + production mint
// ---------------------------------------------------------------------------------------------
//
// [`verify_owner_presence`] above is the fixture/contract verifier (no production authority). Production
// owner presence closes the forgeability gap: production `VerifiedOwnerPresence` is minted ONLY by
// [`verify_production_owner_presence`], which move-consumes a [`ProductionOwnerPresenceBindingGrant`]
// issued ONLY by the sealed [`ProductionOwnerPresenceCapability`] from `Production`-sourced, confirmed
// evidence bound to the exact operation, display summary, runtime instance, IPC session, provider
// identity, provider epoch and validity window.

/// How an owner-presence evidence bundle was produced. The production capability accepts ONLY
/// [`OwnerPresenceEvidenceSource::Production`]; fixture/synthetic evidence is refused fail-closed so it
/// can never mint production authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerPresenceEvidenceSource {
    /// Produced by the trusted production confirmation adapter (future windows-owner-verification,
    /// invoked by the interactive host after a real Windows user-verification ceremony).
    Production,
    /// Deterministic fixture/synthetic evidence for tests. Never enters production verification.
    Fixture,
}

/// The owner's decision on the displayed operation, as reported by the confirmation producer. Only
/// [`OwnerConfirmationOutcome::Confirmed`] can lead to authority; refusal and cancellation are distinct
/// fail-closed refusals that mint nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerConfirmationOutcome {
    /// The owner actively confirmed the exact displayed operation.
    Confirmed,
    /// The owner refused.
    Refused,
    /// The owner cancelled / dismissed.
    Cancelled,
}

/// The still-UNTRUSTED evidence a production owner-presence confirmation producer reports for exactly one
/// pending confirmation. Nothing here is authority; every field is re-validated during grant issuance.
/// `confirmation_nonce` is the host-generated single-use anti-replay anchor; it and the observation
/// `proof_id` are folded into an opaque digest and never retained raw. `operation_digest` /
/// `display_summary_digest` bind the exact operation and the exact summary the owner saw.
#[derive(Clone)]
pub struct ProductionOwnerPresenceEvidence {
    /// Origin of this evidence. Production verification refuses anything but `Production`.
    pub source: OwnerPresenceEvidenceSource,
    /// The owner's decision. Only `Confirmed` can lead to authority.
    pub outcome: OwnerConfirmationOutcome,
    /// The untrusted presence observation (verifier identity, verifier-derived monotonic times,
    /// generation, bounded proof id).
    pub observation: OwnerPresenceObservation,
    /// Host-generated single-use confirmation nonce (bounded id; never rendered).
    pub confirmation_nonce: String,
    /// Digest of the exact operation the owner confirmed.
    pub operation_digest: [u8; 32],
    /// Digest of the exact display summary shown to the owner.
    pub display_summary_digest: [u8; 32],
}

impl fmt::Debug for ProductionOwnerPresenceEvidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never render the raw nonce, proof id, or digest bytes.
        write!(
            f,
            "ProductionOwnerPresenceEvidence(source={:?}, outcome={:?}, gen={}, [REDACTED])",
            self.source, self.outcome, self.observation.generation
        )
    }
}

/// A sealed production owner-presence confirmation capability. Possession is proof the holder is the
/// trusted production confirmation producer (the future interactive-host `windows-owner-verification`
/// adapter). It ALONE issues a [`ProductionOwnerPresenceBindingGrant`]. Opaque: no public constructor,
/// no `Default`, no `Clone`, no serde, redacted Debug, `!Send + !Sync`. The production constructor is
/// crate-internal (`new_internal`); this phase wires NO acquisition route, so no production capability
/// exists in a default build. `for_local_proof` is test/fixture-gated.
pub struct ProductionOwnerPresenceCapability {
    _thread_bound: PhantomData<*const ()>,
}

impl fmt::Debug for ProductionOwnerPresenceCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProductionOwnerPresenceCapability([REDACTED])")
    }
}

impl ProductionOwnerPresenceCapability {
    /// Crate-internal production constructor. A real acquisition path (future carry-forward seam) is the
    /// only way an out-of-crate producer could obtain this; it does not exist yet.
    pub(crate) fn new_internal() -> Self {
        Self {
            _thread_bound: PhantomData,
        }
    }

    /// TEST/FIXTURE-ONLY capability. Feature-gated; a live graph never enables it, so it can never mint
    /// production authority in a shipping build.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn for_local_proof() -> Self {
        Self {
            _thread_bound: PhantomData,
        }
    }

    /// Issue a single-use [`ProductionOwnerPresenceBindingGrant`] from confirmation evidence, binding it
    /// to the exact operation, display summary, current runtime instance, current IPC session, and the
    /// current trusted-clock provider identity + epoch + reading. The SOLE non-fixture constructor of a
    /// grant. Fail closed: fixture-sourced or non-confirmed evidence, a malformed identifier, a wrong
    /// verifier/generation, an invalid or expired window all refuse and mint nothing.
    ///
    /// # Errors
    /// [`OwnerPresenceError`] naming the first failed invariant.
    pub fn issue(
        &self,
        evidence: &ProductionOwnerPresenceEvidence,
        runtime: &VerifiedRuntimeInstance,
        ipc: &BoundIpcSession,
        now: &VerifiedAuthorityTime,
        required: &RequiredOwnerPresence,
    ) -> Result<ProductionOwnerPresenceBindingGrant, OwnerPresenceError> {
        if evidence.source != OwnerPresenceEvidenceSource::Production {
            return Err(OwnerPresenceError::FixtureSource);
        }
        match evidence.outcome {
            OwnerConfirmationOutcome::Confirmed => {}
            OwnerConfirmationOutcome::Refused => return Err(OwnerPresenceError::Refused),
            OwnerConfirmationOutcome::Cancelled => return Err(OwnerPresenceError::Cancelled),
        }
        let obs = &evidence.observation;
        validate_bounded_id(&obs.proof_id)?;
        validate_bounded_id(&obs.verifier)?;
        validate_bounded_id(&evidence.confirmation_nonce)?;
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
        // Opaque proof digest folds the single-use confirmation nonce + proof id; neither is retained raw.
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:PRODUCTION-OWNER-PRESENCE-PROOF:V1");
        h.update((evidence.confirmation_nonce.len() as u64).to_be_bytes());
        h.update(evidence.confirmation_nonce.as_bytes());
        h.update((obs.proof_id.len() as u64).to_be_bytes());
        h.update(obs.proof_id.as_bytes());
        let proof_digest: [u8; 32] = h.finalize().into();
        Ok(ProductionOwnerPresenceBindingGrant {
            proof_digest,
            verifier: obs.verifier.clone(),
            observed_at: obs.observed_at,
            valid_until: obs.valid_until,
            generation: obs.generation,
            operation_digest: evidence.operation_digest,
            display_summary_digest: evidence.display_summary_digest,
            runtime_instance_digest: runtime.instance_digest(),
            ipc_session_digest: ipc.session_digest(),
            provider_id: now.provider_id().to_string(),
            epoch: now.epoch(),
            issued_at: now.reading(),
            _thread_bound: PhantomData,
        })
    }
}

/// A single-use production owner-presence binding grant: opaque, move-consumed authority-to-mint. It is
/// evidence that the trusted confirmation producer completed the required ceremony for ONE pending
/// confirmation, bound to the exact operation, display summary, runtime instance, IPC session, provider
/// identity, provider epoch and validity window. It is NOT itself owner presence, approval, elevation,
/// installation, or effect authority — only [`verify_production_owner_presence`] turns it (once) into a
/// [`VerifiedOwnerPresence`], re-checking every binding against the LIVE context. No public constructor,
/// no `Default`, no `Clone`/`Copy`, no serde, redacted Debug, `!Send + !Sync`. Move-consumption makes a
/// replay a compile error.
pub struct ProductionOwnerPresenceBindingGrant {
    proof_digest: [u8; 32],
    verifier: String,
    observed_at: u64,
    valid_until: u64,
    generation: u64,
    operation_digest: [u8; 32],
    display_summary_digest: [u8; 32],
    runtime_instance_digest: [u8; 32],
    ipc_session_digest: [u8; 32],
    provider_id: String,
    epoch: u64,
    issued_at: u64,
    _thread_bound: PhantomData<*const ()>,
}

impl fmt::Debug for ProductionOwnerPresenceBindingGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ProductionOwnerPresenceBindingGrant(gen={}, [REDACTED])",
            self.generation
        )
    }
}

/// Consume a single-use [`ProductionOwnerPresenceBindingGrant`] and mint the corresponding
/// [`VerifiedOwnerPresence`], re-checking EVERY binding against the LIVE context: the operation digest,
/// the display-summary digest, the current runtime instance, the current IPC session, and the trusted
/// clock provider identity + epoch + validity window. The grant is MOVED — a second attempt is a compile
/// error (single-use). Caller-constructible observation data cannot reach this path. Fail closed.
///
/// # Errors
/// [`OwnerPresenceError`] naming the first failed binding.
pub fn verify_production_owner_presence(
    grant: ProductionOwnerPresenceBindingGrant,
    operation_digest: [u8; 32],
    display_summary_digest: [u8; 32],
    runtime: &VerifiedRuntimeInstance,
    ipc: &BoundIpcSession,
    now: &VerifiedAuthorityTime,
) -> Result<VerifiedOwnerPresence, OwnerPresenceError> {
    if grant.operation_digest != operation_digest {
        return Err(OwnerPresenceError::OperationMismatch);
    }
    if grant.display_summary_digest != display_summary_digest {
        return Err(OwnerPresenceError::DisplaySummaryMismatch);
    }
    if grant.runtime_instance_digest != runtime.instance_digest() {
        return Err(OwnerPresenceError::RuntimeMismatch);
    }
    if grant.ipc_session_digest != ipc.session_digest() {
        return Err(OwnerPresenceError::IpcSessionMismatch);
    }
    if grant.provider_id != now.provider_id() {
        return Err(OwnerPresenceError::ProviderMismatch);
    }
    if grant.epoch != now.epoch() {
        return Err(OwnerPresenceError::EpochMismatch);
    }
    if now.reading() >= grant.valid_until {
        return Err(OwnerPresenceError::Expired);
    }
    Ok(VerifiedOwnerPresence {
        proof_digest: grant.proof_digest,
        verifier: grant.verifier,
        observed_at: grant.observed_at,
        valid_until: grant.valid_until,
        generation: grant.generation,
        provider_id: grant.provider_id,
        epoch: grant.epoch,
    })
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
