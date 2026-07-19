//! Collected observations — COLLECTED BUT NOT YET TRUSTED, and now strongly typed per category.
//!
//! Each category is its own type with a bounded meaning; there is NO generic `Collected(String)` and
//! no unrestricted/arbitrary payload shared across categories. A process observation cannot be
//! substituted for a credential observation. A reducer NEVER consumes observations directly — a
//! verification adapter must turn them into [`crate::facts`] values first. No observation carries a
//! boolean implying verification, and none carries raw credentials, passwords, tokens, cookies, JWTs,
//! connection strings, owner-authentication evidence, certificate material, or unbounded process
//! output.

use crate::facts::{InstallationId, ReleaseId, RepositoryRef};
use projectos_trust_contract::{
    ApprovalEvidenceRef, CredentialRef, EnvironmentId, OperationName, ProjectId,
};

/// Reported credential availability (untrusted, coarse).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReportedAvailability {
    /// Reported not present.
    #[default]
    Absent,
    /// Reported present.
    Present,
}

/// Reported emergency-stop state as observed (untrusted). `Unknown` when it could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReportedStop {
    /// Could not be read.
    #[default]
    Unknown,
    /// Reported clear.
    Clear,
    /// Reported stopped.
    Stopped,
}

/// Client-process observation. Bounded metadata only; not a fact.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProcessObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported process metadata (untrusted).
    Reported {
        /// Reported process id.
        pid: u32,
        /// Reported process creation tick.
        creation_tick: u64,
    },
}

/// Client-executable observation (presence marker only; verification is the adapter's job).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExecutableObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// An executable was observed.
    Reported,
}

/// Release observation (untrusted opaque release id).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ReleaseObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported release identity (untrusted).
    Reported(ReleaseId),
}

/// Installation observation (untrusted opaque installation id).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum InstallationObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported installation identity (untrusted).
    Reported(InstallationId),
}

/// Authenticated-connection observation (presence marker only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConnectionObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// A connection was observed.
    Reported,
}

/// Project observation (untrusted project id).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProjectObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported project identity (untrusted).
    Reported(ProjectId),
}

/// Repository observation (untrusted repository reference).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RepositoryObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported repository reference (untrusted).
    Reported(RepositoryRef),
}

/// Environment observation (untrusted environment id).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum EnvironmentObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported environment identity (untrusted).
    Reported(EnvironmentId),
}

/// Publisher-policy observation (presence marker only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PublisherPolicyObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// A publisher-policy signal was observed.
    Reported,
}

/// Freshness observation (untrusted release the observer believes current).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum FreshnessObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported release (untrusted).
    Reported(ReleaseId),
}

/// Owner-approval observation (opaque evidence reference only — never approval authority).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ApprovalObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// An opaque approval-evidence reference was observed (untrusted; not an approval).
    Reported(ApprovalEvidenceRef),
}

/// Credential-availability observation: metadata ONLY. Never the credential value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialObservation {
    /// Opaque credential reference (never a value).
    pub credential: CredentialRef,
    /// Expected project.
    pub project: ProjectId,
    /// Expected environment.
    pub environment: EnvironmentId,
    /// Provider.
    pub provider: projectos_trust_contract::ProviderId,
    /// Required operation scope.
    pub required_operation: OperationName,
    /// Reported availability.
    pub availability: ReportedAvailability,
}

/// Credential-availability observation wrapper.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum CredentialAvailabilityObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported credential metadata (untrusted; never a value).
    Reported(CredentialObservation),
}

/// Emergency-stop observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EmergencyStopObservation {
    /// Nothing collected.
    #[default]
    NotCollected,
    /// Reported emergency-stop signal (untrusted).
    Reported(ReportedStop),
}

/// The full set of typed observations a future service adapter may gather for one candidate
/// connection + requested operation. None of these fields is a verified fact.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CollectedObservations {
    /// Client-process observation.
    pub process: ProcessObservation,
    /// Client-executable observation.
    pub executable: ExecutableObservation,
    /// Release observation.
    pub release: ReleaseObservation,
    /// Installation observation.
    pub installation: InstallationObservation,
    /// Authenticated-connection observation.
    pub connection: ConnectionObservation,
    /// Project observation.
    pub project: ProjectObservation,
    /// Repository observation.
    pub repository: RepositoryObservation,
    /// Environment observation.
    pub environment: EnvironmentObservation,
    /// Publisher-policy observation.
    pub publisher_policy: PublisherPolicyObservation,
    /// Freshness observation.
    pub freshness: FreshnessObservation,
    /// Owner-approval observation.
    pub approval: ApprovalObservation,
    /// Credential-availability observation.
    pub credential: CredentialAvailabilityObservation,
    /// Emergency-stop observation.
    pub emergency_stop: EmergencyStopObservation,
}
