//! Cross-record consistency validators. These check SEMANTIC agreement between related persisted
//! records (not mere identifier syntax). They are pure data checks — they never construct authority,
//! never treat a stored approval as live, and never treat a stored revision as the authoritative
//! current state; they only reject records that could not coherently belong to the same protected
//! state.

use crate::approval_record::ApprovalRecordDto;
use crate::credential_envelope::CredentialEnvelopeDto;
use crate::credential_metadata::CredentialMetadataDto;
use crate::enums::TargetFamilyDto;
use crate::error::PersistError;
use crate::journal::JournalRecordDto;
use crate::manifest::ProtectedStateManifestDto;
use crate::operation_record::OperationRecordDto;

/// A credential envelope and its metadata must describe the SAME credential/project/provider/
/// environment. A mismatch means one record was substituted from another scope.
///
/// # Errors
/// [`PersistError::ScopeMismatch`] on any binding difference.
pub fn validate_envelope_metadata(
    env: &CredentialEnvelopeDto,
    meta: &CredentialMetadataDto,
) -> Result<(), PersistError> {
    if env.credential_ref != meta.credential_ref
        || env.project != meta.project
        || env.provider != meta.provider
        || env.environment != meta.environment
    {
        return Err(PersistError::ScopeMismatch);
    }
    Ok(())
}

/// A stored approval must bind to the exact operation it would authorise, and must not expire before
/// the operation's own expiry boundary. (This is a data-coherence check; the live authority decision
/// remains the future service reducer's — a stored approval is never treated as live here.)
///
/// # Errors
/// [`PersistError::ScopeMismatch`] on a binding difference; [`PersistError::ExpiryContradiction`] if
/// the approval expires before the operation boundary.
pub fn validate_approval_for_operation(
    approval: &ApprovalRecordDto,
    op: &OperationRecordDto,
) -> Result<(), PersistError> {
    if approval.project != op.project
        || approval.environment != op.environment
        || approval.provider != op.provider
        || approval.operation != op.operation
        || approval.fingerprint != op.fingerprint
        || approval.release != op.required_release
    {
        return Err(PersistError::ScopeMismatch);
    }
    if approval.expiry < op.operation_expiry {
        return Err(PersistError::ExpiryContradiction);
    }
    Ok(())
}

/// An operation record must not claim a revision ahead of the manifest's recorded operation-family
/// revision (a record ahead of the manifest is a dangling/forward reference).
///
/// # Errors
/// [`PersistError::InvalidChainReference`] if the record revision exceeds the manifest's.
pub fn validate_manifest_covers_operation(
    manifest: &ProtectedStateManifestDto,
    op: &OperationRecordDto,
) -> Result<(), PersistError> {
    if op.record_revision > manifest.family_revisions.operation {
        return Err(PersistError::InvalidChainReference);
    }
    Ok(())
}

/// A journal commit must advance its target family FORWARD relative to the manifest's current
/// revision for that family; a target at or below the current revision is a stale/rollback reference.
///
/// # Errors
/// [`PersistError::InvalidChainReference`] if the target revision does not advance the family.
pub fn validate_journal_targets_manifest(
    journal: &JournalRecordDto,
    manifest: &ProtectedStateManifestDto,
) -> Result<(), PersistError> {
    let fr = &manifest.family_revisions;
    let current = match journal.target_family {
        TargetFamilyDto::TrustPolicy => fr.trust_policy,
        TargetFamilyDto::ProjectRegistry => fr.project_registry,
        TargetFamilyDto::Operation => fr.operation,
        TargetFamilyDto::Approval => fr.approval,
        TargetFamilyDto::CredentialMetadata => fr.credential_metadata,
        TargetFamilyDto::CredentialEnvelope => fr.credential_envelope,
        TargetFamilyDto::EmergencyStop => fr.emergency_stop,
        TargetFamilyDto::Audit => fr.audit,
        // Plan records track the manifest's generic record revision (no dedicated family field; the
        // durable store advances all family revisions uniformly with the store revision).
        // Delegation-lifecycle records track the manifest's generic record revision for the same
        // reason plan records do: the durable store advances all family revisions uniformly.
        TargetFamilyDto::Plan | TargetFamilyDto::DelegationLifecycle => manifest.record_revision,
    };
    if journal.target_revision <= current {
        return Err(PersistError::InvalidChainReference);
    }
    Ok(())
}
