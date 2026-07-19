//! Audit-record DTO — append-only governance events, hash-chained. Redacted; no raw secret or
//! unrestricted provider output.

use serde::{Deserialize, Serialize};

use crate::common::{
    require_nonzero_revision, validate_hex, validate_id, validate_id_collection,
    validate_redacted_text, MAX_HEX_META_LEN,
};
use crate::enums::AuditEventClassDto;
use crate::error::PersistError;
use crate::version::{require_schema, AUDIT_RECORD_SCHEMA};

/// Persisted audit record (metadata-only, hash-chained).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuditRecordDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Monotonic append sequence.
    pub sequence: u64,
    /// Bounded event class (never free text).
    pub event_class: AuditEventClassDto,
    /// Optional operation reference this event concerns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_ref: Option<String>,
    /// Bounded, deduplicated evidence references.
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    /// Optional previous-record hash (hex) for chaining; absent only for the first record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_hash: Option<String>,
    /// This record's hash (hex).
    pub this_hash: String,
    /// Redacted human summary (bounded; secrets already scrubbed by the service).
    pub redacted_summary: String,
}

impl AuditRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds + chain fields.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, AUDIT_RECORD_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        validate_hex(&self.this_hash, MAX_HEX_META_LEN)
            .map_err(|_| PersistError::InvalidChainReference)?;
        if let Some(prev) = &self.prev_hash {
            validate_hex(prev, MAX_HEX_META_LEN)
                .map_err(|_| PersistError::InvalidChainReference)?;
        }
        // The first record (sequence 0) has no previous hash; a later record must chain.
        if self.sequence == 0 {
            if self.prev_hash.is_some() {
                return Err(PersistError::InvalidChainReference);
            }
        } else if self.prev_hash.is_none() {
            return Err(PersistError::InvalidChainReference);
        }
        if let Some(op) = &self.operation_ref {
            validate_id(op)?;
        }
        validate_id_collection(&self.evidence_refs)?;
        validate_redacted_text(&self.redacted_summary)?;
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
