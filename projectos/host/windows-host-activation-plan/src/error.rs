//! Fieldless, redacted refusal and non-conformance classification.
//!
//! No variant carries a path, a machine identifier, an account name, a SID, a password, a token, a
//! handle, or a registry value. The classification IS the evidence.

use thiserror::Error;

/// Why a plan could not be constructed, composed, or advanced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ActivationPlanError {
    /// Production STATE was anchored somewhere other than ProgramData — Program Files holds the
    /// installed binary, never state (CD-B4-INSTALLER-READINESS1A).
    #[error("state anchored outside ProgramData")]
    StateAnchorNotProgramData,

    /// A root path segment was empty.
    #[error("empty segment")]
    EmptySegment,

    /// A segment contained a path separator, so it is not one segment.
    #[error("separator in segment")]
    SeparatorInSegment,

    /// A segment was `.` or `..`.
    #[error("traversal segment")]
    TraversalSegment,

    /// A segment used alternate-data-stream syntax.
    #[error("alternate data stream syntax")]
    AlternateDataStream,

    /// A segment used device-namespace syntax (`\\?\`, `\\.\`).
    #[error("device namespace syntax")]
    DeviceNamespace,

    /// A UNC root was supplied where it is not supported.
    #[error("unsupported unc root")]
    UnsupportedUncRoot,

    /// A segment used a reserved Windows device name (`CON`, `NUL`, `COM1`, …).
    #[error("reserved name")]
    ReservedName,

    /// A segment contained a character Windows forbids, or a trailing dot/space.
    #[error("invalid segment character")]
    InvalidSegmentCharacter,

    /// A segment exceeded the bounded length, or the plan exceeded its bounded depth.
    #[error("segment too long")]
    SegmentTooLong,

    /// The modelled root resolves to a location that may never hold production host state.
    #[error("forbidden root location")]
    ForbiddenRootLocation,

    /// Two subtrees, or two projects, claimed the same namespace.
    #[error("namespace collision")]
    NamespaceCollision,

    /// More than one production-root or activation authority was declared.
    #[error("duplicate authority")]
    DuplicateAuthority,

    /// The production service identity has not been decided by the owner, so no final ACL, no
    /// installation and no activation may be composed.
    #[error("service identity required")]
    ServiceIdentityRequired,

    /// The authoritative service SID is not yet available. It must be obtained at activation time
    /// through an approved Windows mechanism — it is never invented, derived by hand, or hardcoded.
    #[error("service sid unresolved")]
    ServiceSidUnresolved,

    /// An explicit owner decision is required before this may proceed.
    #[error("owner decision required")]
    OwnerDecisionRequired,

    /// The step is not authorised: no owner approval covers it.
    #[error("not authorised")]
    NotAuthorised,

    /// A prerequisite step has not reached `ConfirmedComplete`.
    #[error("prerequisite incomplete")]
    PrerequisiteIncomplete,

    /// An earlier step is in an uncertain or non-conforming state. Nothing may proceed, and nothing
    /// may be retried, until it has been reconciled under owner and gatekeeper review.
    #[error("reconciliation required")]
    ReconciliationRequired,

    /// A retry was attempted for an operation whose retry is forbidden after an uncertain effect.
    #[error("retry forbidden")]
    RetryForbidden,

    /// A credential, password or raw SID was offered to the plan. The plan never accepts one.
    #[error("credential material refused")]
    CredentialMaterialRefused,

    /// The recovery policy would permit an unbounded restart loop.
    #[error("unbounded restart policy")]
    UnboundedRestartPolicy,
}

/// A semantic non-conformance found when validating a plan. Names the defect, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ActivationViolation {
    /// The production root is unresolved or invalid.
    RootPlanInvalid,
    /// The service identity strategy has not been decided by the owner.
    ServiceIdentityUndecided,
    /// The chosen identity cannot support service-only custody.
    IdentityCannotSupportServiceOnlyCustody,
    /// The ACL composition still depends on an unresolved service SID.
    AclDependsOnUnresolvedSid,
    /// The composed ACL would grant a broad principal authority.
    AclGrantsBroadPrincipal,
    /// The composed ACL would permit inherited authority where the plan forbids it.
    AclPermitsInheritance,
    /// An activation step lacks the owner approval it requires.
    StepLacksOwnerApproval,
    /// An activation step was ordered before its prerequisite.
    StepOrderViolation,
    /// A mutating step declares neither confirmation evidence nor a reconciliation rule.
    StepLacksEffectClassification,
    /// The recovery policy is unbounded.
    RecoveryUnbounded,
}
