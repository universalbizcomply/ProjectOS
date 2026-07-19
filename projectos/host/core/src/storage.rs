//! Protected-storage interfaces — traits ONLY. No concrete filesystem, database, or registry
//! implementation and no I/O in this crate. Implementations belong to a later protected-storage
//! phase. Traits expose typed service-private records/outcomes; they never expose candidate-controlled
//! filesystem paths, untyped JSON, raw credential values, or raw trust-root private material.

use crate::facts::{
    CredentialOutcome, EmergencyStopState, RepositoryRef, ValidatedFreshness,
    ValidatedPublisherPolicy,
};
use crate::operation::InternalOperationRecord;
use projectos_trust_contract::{EnvironmentId, OperationRef, ProjectId, ProviderId};

/// Loads and stores durable operation records, keyed by the authority-free [`OperationRef`].
pub trait OperationRecordRepository {
    /// Load a durable record, if one exists for this reference.
    fn load(&self, operation_ref: &OperationRef) -> Option<InternalOperationRecord>;
    /// Persist a durable record. (No implementation in this phase.)
    fn store(&self, record: &InternalOperationRecord);
}

/// Reads the protected project registry.
pub trait ProjectRegistryReader {
    /// The verified repository bound to a project, if registered.
    fn repository_for(&self, project: &ProjectId) -> Option<RepositoryRef>;
    /// Whether an environment is permitted for a project.
    fn environment_allowed(&self, project: &ProjectId, environment: &EnvironmentId) -> bool;
    /// Whether a project is production-frozen.
    fn is_production_frozen(&self, project: &ProjectId) -> bool;
}

/// Reads protected trust policy (publisher/manifest roots, floors, revocation, freshness).
pub trait TrustPolicyReader {
    /// The validated publisher-policy result for the current installation, if satisfied.
    fn publisher_policy(&self) -> Option<ValidatedPublisherPolicy>;
    /// The validated freshness result for the given release, if it satisfies the floor.
    fn freshness_for(&self, release_satisfies_floor: bool) -> Option<ValidatedFreshness>;
}

/// Reads authoritative approval records.
pub trait ApprovalRecordReader {
    /// The approval outcome for an operation. Returns a fail-closed outcome, never a bare boolean.
    fn approval_for(&self, operation_ref: &OperationRef) -> crate::approval::ApprovalOutcome;
}

/// Reads credential availability metadata (never values).
pub trait CredentialMetadataReader {
    /// The credential-availability outcome for a project/environment/provider.
    fn credential_for(
        &self,
        project: &ProjectId,
        environment: &EnvironmentId,
        provider: &ProviderId,
    ) -> CredentialOutcome;
}

/// Reads the emergency-stop state from protected state.
pub trait EmergencyStopReader {
    /// The current emergency-stop state. A reader that cannot confirm must return
    /// [`EmergencyStopState::Stopped`] (fail closed).
    fn emergency_stop_state(&self) -> EmergencyStopState;
}
