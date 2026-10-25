//! Durable operation-record DTO. Non-authoritative: converting this DTO NEVER yields an
//! `ExecutionPermit`, `AuthenticatedSession`, or `CredentialLease`; a stored revision is an
//! observation, not the current authoritative revision; a copied `operationRef` grants nothing.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id, validate_id_collection};
use crate::enums::{OperationStateDto, ResumePolicyDto, RevocationReasonDto, RevocationStateDto};
use crate::error::PersistError;
use crate::version::{require_schema, OPERATION_RECORD_SCHEMA};

/// Persisted durable operation record. Strict + bounded; no plaintext or authority field exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OperationRecordDto {
    /// Family schema version (must equal [`OPERATION_RECORD_SCHEMA`]).
    pub schema_version: u32,
    /// Monotonic record revision (observation only; non-zero).
    pub record_revision: u64,
    /// Durable lookup reference (non-authoritative).
    pub operation_ref: String,
    /// Project.
    pub project: String,
    /// Repository.
    pub repository: String,
    /// Environment.
    pub environment: String,
    /// Provider.
    pub provider: String,
    /// Operation name.
    pub operation: String,
    /// Operation fingerprint.
    pub fingerprint: String,
    /// Required release.
    pub required_release: String,
    /// Required installation.
    pub required_installation: String,
    /// Current state.
    pub state: OperationStateDto,
    /// Whether approval is required.
    pub approval_required: bool,
    /// Whether a credential is required.
    pub credential_required: bool,
    /// Opaque operation expiry boundary.
    pub operation_expiry: u64,
    /// Revocation state.
    pub revocation: RevocationStateDto,
    /// Typed revocation reason — present iff revoked; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revocation_reason: Option<RevocationReasonDto>,
    /// Resume policy.
    pub resume_policy: ResumePolicyDto,
    /// Bounded, deduplicated evidence references.
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

impl OperationRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON (bad JSON, unknown/missing/duplicate field,
    /// unknown enum variant).
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Fully validate the record: version, identifiers, revision, evidence bounds, and revocation
    /// consistency.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, OPERATION_RECORD_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        for id in [
            &self.operation_ref,
            &self.project,
            &self.repository,
            &self.environment,
            &self.provider,
            &self.operation,
            &self.fingerprint,
            &self.required_release,
            &self.required_installation,
        ] {
            validate_id(id)?;
        }
        validate_id_collection(&self.evidence_refs)?;
        match self.revocation {
            RevocationStateDto::Active => {
                if self.revocation_reason.is_some() {
                    return Err(PersistError::RevocationInconsistency);
                }
            }
            RevocationStateDto::Revoked => {
                if self.revocation_reason.is_none() {
                    return Err(PersistError::RevocationInconsistency);
                }
            }
            RevocationStateDto::Unknown => {}
        }
        Ok(())
    }

    /// Serialise to JSON.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] if serialisation fails (should not occur for valid data).
    pub fn to_json(&self) -> Result<String, PersistError> {
        serde_json::to_string(self).map_err(|_| PersistError::Malformed)
    }
}
