//! Denial reasons and state-transition errors. Coarse and service-private.

use crate::operation::OperationState;

/// A closed, stable, service-private revocation reason. No free-text payload, no arbitrary string, no
/// raw provider/exception/SQL text, no secret. `UnknownProtectedReason` means a protected reason
/// exists but this pure core does not expose the raw detail — it is NOT a fail-open default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RevocationReason {
    /// Revoked by the owner.
    OwnerRevoked,
    /// Revoked by publisher/trust policy.
    PolicyRevoked,
    /// The bound credential was revoked.
    CredentialRevoked,
    /// The bound approval was revoked.
    ApprovalRevoked,
    /// The bound release was revoked.
    ReleaseRevoked,
    /// The bound installation was revoked.
    InstallationRevoked,
    /// The project was disabled.
    ProjectDisabled,
    /// The environment was disabled.
    EnvironmentDisabled,
    /// Emergency stop.
    EmergencyStop,
    /// A security incident.
    SecurityIncident,
    /// Superseded by a newer operation.
    Superseded,
    /// An administrative revocation.
    Administrative,
    /// A protected reason exists; the raw detail is not exposed by this core.
    UnknownProtectedReason,
}

/// A validation error for durable, bounded record metadata. Service-private; coarse; no raw detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum RecordError {
    /// A bounded identifier was empty.
    #[error("empty identifier")]
    EmptyIdentifier,
    /// A bounded identifier exceeded its length bound.
    #[error("identifier too long")]
    IdentifierTooLong,
    /// A bounded identifier contained an illegal character (control, whitespace, path/URL separator).
    #[error("illegal identifier character")]
    IllegalCharacter,
    /// More evidence references than the bound allows.
    #[error("too many evidence references")]
    TooManyEvidenceReferences,
    /// A duplicate evidence reference.
    #[error("duplicate evidence reference")]
    DuplicateEvidenceReference,
    /// A revoked record is missing its required typed reason.
    #[error("revoked record requires a revocation reason")]
    RevocationReasonMissing,
    /// A non-revoked record carries a revocation reason.
    #[error("non-revoked record must not carry a revocation reason")]
    RevocationReasonUnexpected,
}

/// Why the reducer refused to grant eligibility. Every variant is a fail-closed outcome; no variant
/// implies any external side effect occurred.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum DenialReason {
    /// Emergency stop is engaged.
    EmergencyStopped,
    /// The emergency-stop state could not be confirmed (unknown/unavailable). Fail closed.
    EmergencyStopUnverified,
    /// The operation record is expired.
    Expired,
    /// The operation record is revoked.
    Revoked,
    /// A required verified fact was absent.
    MissingFact(MissingFact),
    /// A verified fact did not match the requested binding.
    Mismatch(BindingKind),
    /// The credential's permitted scope did not match the requested binding.
    CredentialScopeMismatch,
    /// A verified approval did not bind to the requested operation.
    ApprovalBindingMismatch,
    /// The approval is expired.
    ApprovalExpired,
    /// The approval is revoked.
    ApprovalRevoked,
    /// A validated fact was too old for the current floors.
    Stale,
    /// The publisher policy evaluated to refused.
    PublisherPolicyRefused,
    /// The authority is past its expiry boundary.
    AuthorityExpired,
    /// The protected revocation status could not be confirmed as active.
    RevocationUnknown,
    /// The operation state cannot yield eligibility (e.g. a terminal state).
    UnusableState(OperationState),
    /// The requested operation violated the approved plan definition (scope / path boundary / allowed
    /// or prohibited action / dependency / predecessor). The precise cause is carried, distinctly.
    PlanPolicyRefused(crate::plan::PlanPolicyRefusal),
    /// The verified repository baseline did not satisfy the operation's approved repository policy
    /// (identity / root / commit / branch / cleanliness / divergence / freshness / submodule). The
    /// precise cause is carried, distinctly and payload-free.
    RepositoryPolicyRefused(crate::repository::RepositoryError),
    /// The operation-bound repository fact was not bound to THIS operation, or was inconsistent with its
    /// own embedded baseline. The precise binding dimension is carried, distinctly and payload-free. This
    /// is checked BEFORE the repository policy, so a baseline verified for one operation can never be
    /// replayed through a fact bound to another.
    RepositoryFactMismatch(RepositoryBinding),
    /// The operation-bound owner-presence fact was not bound to THIS operation, or was inconsistent with
    /// its own embedded proof. Checked BEFORE the owner-presence policy, so a presence proof verified for
    /// one operation can never be replayed through a fact bound to another.
    OwnerPresenceFactMismatch(OwnerPresenceBinding),
    /// The verified owner-presence proof did not satisfy the operation's required owner-presence policy
    /// (verifier identity / minimum generation). Payload-free, distinct cause carried.
    OwnerPresencePolicyRefused(crate::owner_presence::OwnerPresenceError),
    /// The operation-bound elevation fact was not bound to THIS operation/process, or was inconsistent
    /// with its own embedded proof. Checked BEFORE the elevation policy, so an elevation proof verified for
    /// one operation or process can never be replayed through a fact bound to another.
    ElevationFactMismatch(ElevationBinding),
    /// The verified elevation proof did not satisfy the operation's required elevation policy (level /
    /// minimum generation), or the current trusted-clock reading refused it (provider / epoch / expiry).
    /// Payload-free, distinct cause carried.
    ElevationPolicyRefused(crate::elevation::ElevationError),
}

/// The binding dimension on which an operation-bound owner-presence fact failed. Fail-closed; no
/// free-text payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OwnerPresenceBinding {
    /// The fact's project did not match the operation.
    Project,
    /// The fact's environment did not match the operation.
    Environment,
    /// The fact's phase identity did not match the operation.
    Phase,
    /// The fact's approved-plan binding did not match the operation's required plan.
    Plan,
    /// The fact's operation reference did not match the operation.
    Operation,
    /// The fact's bound fingerprint did not match the operation's fingerprint.
    Fingerprint,
    /// The fact's bound repository AUTHORITY STATE (baseline content + generation) did not match the
    /// operation's current validated repository fact — a same-identity baseline change, a generation
    /// change, or a cross-repository substitution. Distinct from a mere identity check.
    RepositoryBaseline,
    /// The fact's cached generation did not match its embedded proof.
    Generation,
    /// The fact's cached validity boundary did not match its embedded proof.
    ValidUntil,
}

/// The binding dimension on which an operation-bound elevation fact failed. Fail-closed; no free-text
/// payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ElevationBinding {
    /// The fact's project did not match the operation.
    Project,
    /// The fact's environment did not match the operation.
    Environment,
    /// The fact's phase identity did not match the operation.
    Phase,
    /// The fact's approved-plan binding did not match the operation's required plan.
    Plan,
    /// The fact's operation reference did not match the operation.
    Operation,
    /// The fact's bound fingerprint did not match the operation's fingerprint.
    Fingerprint,
    /// The fact's bound repository AUTHORITY STATE (baseline content + generation) did not match the
    /// operation's current validated repository fact.
    RepositoryBaseline,
    /// The fact's jointly-bound owner-presence proof did not match the operation's current owner-presence
    /// fact (an elevation proof from one context combined with owner presence from another).
    OwnerPresence,
    /// The fact's bound authenticated session did not match the operation's current session — an elevation
    /// proof verified in session S1 presented in session S2. Checked before the elevation policy.
    Session,
    /// The fact's bound process identity (pid + creation tick) did not match the operation's expected
    /// process — a cross-process proof, or a replay after the process restarted (new creation tick).
    Process,
    /// The fact's cached generation did not match its embedded proof.
    Generation,
    /// The fact's cached validity boundary did not match its embedded proof.
    ValidUntil,
}

/// The binding dimension on which an operation-bound repository fact failed. Every variant is a
/// fail-closed refusal with no free-text payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RepositoryBinding {
    /// The fact's project did not match the operation.
    Project,
    /// The fact's environment did not match the operation.
    Environment,
    /// The fact's phase identity did not match the operation.
    Phase,
    /// The fact's approved-plan binding did not match the operation's required plan.
    Plan,
    /// The fact's operation reference did not match the operation.
    Operation,
    /// The fact's bound fingerprint did not match the operation's fingerprint.
    Fingerprint,
    /// The fact's cached generation did not match its embedded baseline.
    Generation,
    /// The fact's cached freshness did not match its embedded baseline.
    Freshness,
}

/// The category of a missing verified fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum MissingFact {
    /// Validated approved-plan fact (a plan-governed operation had no active approved plan).
    ApprovedPlan,
    /// Verified repository baseline (a repository-governed operation had no repository fact).
    Repository,
    /// Verified owner-presence proof (an owner-presence-governed operation had no owner-presence fact).
    OwnerPresence,
    /// Trusted authority-time reading (an owner-presence-governed operation had no verified clock to
    /// prove the presence lease is still current at evaluation time).
    AuthorityTime,
    /// Verified elevation proof (an elevation-governed operation had no elevation fact).
    Elevation,
    /// Validated phase-binding proof (the facts were not bound to any phase).
    Phase,
    /// Validated process identity.
    Process,
    /// Validated executable identity.
    Executable,
    /// Validated release identity.
    Release,
    /// Validated installation identity.
    Installation,
    /// Validated authenticated-session identity.
    Session,
    /// Validated project/repository identity.
    Project,
    /// Validated environment identity.
    Environment,
    /// Validated publisher-policy result.
    PublisherPolicy,
    /// Validated freshness result.
    Freshness,
    /// Authority-validity/revocation/emergency-revision snapshot.
    Authority,
}

/// The binding dimension that failed to match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BindingKind {
    /// Approved-plan mismatch: the validated plan fact was not active or not bound to the operation's
    /// required approved plan (reference/version/definition-digest/project/environment/phase).
    ApprovedPlan,
    /// Phase mismatch: the validated phase-binding proof did not match the operation's authoritative
    /// phase identity.
    Phase,
    /// Project mismatch.
    Project,
    /// Environment mismatch.
    Environment,
    /// Provider mismatch.
    Provider,
    /// Operation-name mismatch.
    Operation,
    /// Operation-fingerprint mismatch.
    Fingerprint,
    /// Release mismatch.
    Release,
    /// Installation mismatch.
    Installation,
    /// Repository mismatch.
    Repository,
    /// Executable/installation consistency mismatch.
    Executable,
    /// Authenticated-session mismatch.
    Session,
}

/// An invalid operation-state transition. Unknown/disallowed transitions fail closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid operation-state transition from {from:?} to {to:?}")]
pub struct TransitionError {
    /// The source state.
    pub from: OperationState,
    /// The rejected target state.
    pub to: OperationState,
}
