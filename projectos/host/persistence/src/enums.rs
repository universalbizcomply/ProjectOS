//! Closed serde enums used across DTO families. An unknown variant fails strict deserialisation
//! (fail closed). These are persistence projections; the authoritative meaning lives in
//! `projectos-host-core` (whose domain types remain non-serializable).

use serde::{Deserialize, Serialize};

/// Persisted revocation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RevocationStateDto {
    /// Active.
    Active,
    /// Revoked.
    Revoked,
    /// Unresolved (fail-closed; never treated as active).
    Unknown,
}

/// Persisted payload-free revocation reason (mirrors the core enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RevocationReasonDto {
    /// Owner-revoked.
    OwnerRevoked,
    /// Policy-revoked.
    PolicyRevoked,
    /// Credential-revoked.
    CredentialRevoked,
    /// Approval-revoked.
    ApprovalRevoked,
    /// Release-revoked.
    ReleaseRevoked,
    /// Installation-revoked.
    InstallationRevoked,
    /// Project disabled.
    ProjectDisabled,
    /// Environment disabled.
    EnvironmentDisabled,
    /// Emergency stop.
    EmergencyStop,
    /// Security incident.
    SecurityIncident,
    /// Superseded.
    Superseded,
    /// Administrative.
    Administrative,
    /// A protected reason exists; raw detail not exposed.
    UnknownProtectedReason,
}

/// Persisted operation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationStateDto {
    /// Created.
    Created,
    /// Setup required.
    SetupRequired,
    /// Approval required.
    ApprovalRequired,
    /// Ready for revalidation.
    ReadyForRevalidation,
    /// Eligible for execution.
    EligibleForExecution,
    /// Executing.
    Executing,
    /// Needs revalidation.
    NeedsRevalidation,
    /// Completed.
    Completed,
    /// Failed.
    Failed,
    /// Revoked.
    Revoked,
    /// Expired.
    Expired,
}

/// Persisted resume policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResumePolicyDto {
    /// May not resume.
    NoResume,
    /// May resume only after fresh revalidation.
    ResumeAfterRevalidation,
}

/// Persisted credential lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CredentialLifecycleDto {
    /// Active.
    Active,
    /// Expired.
    Expired,
    /// Revoked.
    Revoked,
}

/// Persisted project status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectStatusDto {
    /// Active.
    Active,
    /// Frozen.
    Frozen,
    /// Archived.
    Archived,
}

/// Journal record phase (two-phase intent → commit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JournalPhaseDto {
    /// Intent recorded.
    Intent,
    /// Commit recorded.
    Commit,
}

/// The store family a journal record targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TargetFamilyDto {
    /// Trust policy.
    TrustPolicy,
    /// Project registry.
    ProjectRegistry,
    /// Operation records.
    Operation,
    /// Approval records.
    Approval,
    /// Credential metadata.
    CredentialMetadata,
    /// Credential envelope.
    CredentialEnvelope,
    /// Emergency stop.
    EmergencyStop,
    /// Audit.
    Audit,
    /// Approved-plan records.
    Plan,
    /// Durable owner-delegation lifecycle records.
    DelegationLifecycle,
    /// Durable governed-request replay records.
    RequestReplay,
}

/// Governance audit event class (bounded — never free text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuditEventClassDto {
    /// An operation was requested.
    OperationRequested,
    /// Setup was required.
    SetupRequired,
    /// Approval was requested.
    ApprovalRequested,
    /// An approval was decided.
    ApprovalDecided,
    /// A credential was added/rotated/revoked.
    CredentialChanged,
    /// A permit was issued.
    PermitIssued,
    /// Provider execution started.
    ProviderExecutionStarted,
    /// A result was reconciled.
    ResultReconciled,
    /// An operation concluded (completed/failed/revoked).
    OperationConcluded,
}
