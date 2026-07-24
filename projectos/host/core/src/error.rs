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
}

/// The category of a missing verified fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum MissingFact {
    /// Validated approved-plan fact (a plan-governed operation had no active approved plan).
    ApprovedPlan,
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
