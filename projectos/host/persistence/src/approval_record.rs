//! Approval-record DTO. A stored approval is NOT a live approval; conversion never yields authority.
//! No raw owner-authentication evidence is present.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id};
use crate::enums::RevocationStateDto;
use crate::error::PersistError;
use crate::version::{require_schema, APPROVAL_RECORD_SCHEMA};

/// Persisted approval record (bounded; no raw owner-auth evidence).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalRecordDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Approval-record identity.
    pub approval_id: String,
    /// Project binding.
    pub project: String,
    /// Optional repository binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// Environment binding.
    pub environment: String,
    /// Provider binding.
    pub provider: String,
    /// Operation binding.
    pub operation: String,
    /// Operation fingerprint binding.
    pub fingerprint: String,
    /// Release binding.
    pub release: String,
    /// Opaque approval expiry boundary.
    pub expiry: u64,
    /// Opaque replay-prevention identity (e.g. a consumed nonce id). Not a secret.
    pub replay_identity: String,
    /// Optional maximum operation count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_count: Option<u32>,
    /// Revocation state.
    pub revocation: RevocationStateDto,
}

impl ApprovalRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds + bindings.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, APPROVAL_RECORD_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        for id in [
            &self.approval_id,
            &self.project,
            &self.environment,
            &self.provider,
            &self.operation,
            &self.fingerprint,
            &self.release,
            &self.replay_identity,
        ] {
            validate_id(id)?;
        }
        if let Some(repo) = &self.repository {
            validate_id(repo)?;
        }
        if self.operation_count == Some(0) {
            return Err(PersistError::ScopeMismatch);
        }
        Ok(())
    }

    /// Serialise to JSON.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] if serialisation fails.
    pub fn to_json(&self) -> Result<String, PersistError> {
        serde_json::to_string(self).map_err(|_| PersistError::Malformed)
    }
}
