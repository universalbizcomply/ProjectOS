//! Fieldless, redacted refusal and non-conformance classification.
//!
//! No variant carries a service name, account name, SID, ACL byte, executable path, machine
//! identifier, credential or secret. The classification IS the evidence.

use thiserror::Error;

/// Why a contract step refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ServiceInstallationContractError {
    /// The consumed owner decision does not name the one approved service.
    #[error("service name not owner approved")]
    ServiceNameNotOwnerApproved,

    /// The consumed identity decision is not the one approved strategy.
    #[error("identity strategy not owner approved")]
    IdentityStrategyNotOwnerApproved,

    /// A required metadata decision (display name, description, startup, recovery) is unresolved.
    #[error("metadata decision unresolved")]
    MetadataDecisionUnresolved,

    /// The packaged executable path is unresolved.
    #[error("executable path unresolved")]
    ExecutablePathUnresolved,

    /// The installation directory is unresolved.
    #[error("installation directory unresolved")]
    InstallationDirectoryUnresolved,

    /// An SCM/service access mask was broader than the operation requires (for example an
    /// all-access mask).
    #[error("access mask too broad")]
    AccessMaskTooBroad,

    /// A pre-effect check failed or is indeterminate; no installation effect may proceed.
    #[error("pre effect check failed")]
    PreEffectCheckFailed,

    /// Installation effect authority is absent. It cannot be manufactured in this crate.
    #[error("installation effect not authorised")]
    InstallationEffectNotAuthorised,

    /// The approved service name is already taken; installation must stop, never substitute.
    #[error("service name collision")]
    ServiceNameCollision,

    /// A fallback or alternative service name was requested. Never permitted.
    #[error("fallback name refused")]
    FallbackNameRefused,

    /// A retry was attempted while the previous effect is uncertain or unreconciled.
    #[error("retry blocked pending reconciliation")]
    RetryBlockedPendingReconciliation,

    /// A rollback or destructive cleanup was requested without its own separate approval.
    #[error("rollback approval required")]
    RollbackApprovalRequired,

    /// Authoritative post-effect re-read was skipped; success cannot be claimed.
    #[error("authoritative reread required")]
    AuthoritativeRereadRequired,
}

/// A semantic non-conformance found while validating the frozen contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ContractViolation {
    /// The contract names a service other than the one approved.
    WrongServiceName,
    /// The contract uses an identity strategy other than the one approved.
    WrongIdentityStrategy,
    /// An access mask carries broad (all-access or DAC/owner-writing) authority.
    BroadAccessMask,
    /// The contract exposes a plaintext credential field.
    PlaintextCredentialPresent,
    /// The contract exposes an arbitrary command line or launch route.
    ArbitraryLaunchRoutePresent,
    /// The contract admits a fallback or alternative service name.
    FallbackNameAdmitted,
    /// An unresolved metadata value is treated as approved.
    UnresolvedTreatedAsApproved,
    /// The contract permits an installation effect.
    EffectAuthorised,
    /// The contract permits success without an authoritative re-read.
    SuccessWithoutReread,
    /// The contract permits automatic rollback, retry, or duplicate creation.
    UnsafeAutomaticRecovery,
}
