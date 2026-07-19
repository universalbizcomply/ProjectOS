//! Journal / transaction-record DTO — the two-phase intent→commit records the accepted architecture
//! needs for crash-safe atomicity. A stored journal record is data only; it grants no authority and
//! is trusted only after future store-integrity validation.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id};
use crate::enums::{JournalPhaseDto, TargetFamilyDto};
use crate::error::PersistError;
use crate::version::{require_schema, JOURNAL_RECORD_SCHEMA};

/// Persisted journal/transaction record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JournalRecordDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Monotonic journal sequence.
    pub sequence: u64,
    /// Intent identity (bounded).
    pub intent_id: String,
    /// Phase (intent → commit).
    pub phase: JournalPhaseDto,
    /// Target store family.
    pub target_family: TargetFamilyDto,
    /// Target revision this record advances the family to.
    pub target_revision: u64,
    /// The previous journal sequence, absent only for the first record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_sequence: Option<u64>,
}

impl JournalRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds + sequence chaining.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, JOURNAL_RECORD_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        require_nonzero_revision(self.target_revision)?;
        validate_id(&self.intent_id)?;
        // Sequence chaining: the first record (sequence 0) has no previous; later records must chain
        // to a strictly-earlier sequence.
        match self.prev_sequence {
            None => {
                if self.sequence != 0 {
                    return Err(PersistError::InvalidChainReference);
                }
            }
            Some(prev) => {
                if self.sequence == 0 || prev >= self.sequence {
                    return Err(PersistError::InvalidChainReference);
                }
            }
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
