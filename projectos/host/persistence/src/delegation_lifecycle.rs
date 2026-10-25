//! Durable OWNER-DELEGATION LIFECYCLE record DTO.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10B.
//!
//! ## What this family is, and what it is deliberately not
//!
//! It records ONE thing about ONE delegation: the lifecycle state the HOST ITSELF has recorded for
//! it. It is not a second copy of the owner's signed delegation, and it must never become one — the
//! signed record carries the owner's authority and lives in the caller's hands, while this carries
//! the host's own word about whether that authority has ended. Storing the signed body here would
//! create a second place a delegation could be read from, and the whole point of the host-local
//! state is that it OVERRIDES the signed copy.
//!
//! There is therefore no signature, no key id, no budget, no phase list, no expiry, no project and
//! no repository in this DTO. A delegation id and a state is the complete answer to the only
//! question this family exists to answer.
//!
//! ## Non-authoritative
//!
//! Like every other DTO in this crate, this is UNTRUSTED DATA. Deserialising one yields no
//! authority: the sealed `HostDelegationStatus` that verification consumes is minted inside
//! `projectos-host-windows-local-ipc` from a sealed store, and a caller who edits `state` to
//! `ACTIVE` on disk still has to get past the owner's signature, the programme binding, the record's
//! own liveness flag and its expiry — none of which this file can influence.

use serde::{Deserialize, Serialize};

use crate::common::validate_hex;
use crate::error::PersistError;
use crate::version::{require_schema, DELEGATION_LIFECYCLE_SCHEMA};

/// The exact character length of a delegation-id hex encoding (32 bytes, lowercase hex).
pub const DELEGATION_ID_HEX_LEN: usize = 64;

/// Persisted host-local delegation lifecycle state (mirrors the sealed `DelegationLocalState`).
///
/// THREE VARIANTS, AND NO MORE. An unknown string in this position is a parse failure, never a
/// tolerated value, so a future writer cannot introduce a fourth meaning that an older reader
/// silently treats as live.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DelegationLifecycleStateDto {
    /// The host has not ended this delegation.
    Active,
    /// The host recorded this delegation as revoked. TERMINAL.
    Revoked,
    /// The host recorded this delegation as completed. TERMINAL.
    Completed,
}

/// Persisted durable delegation-lifecycle record. Strict, bounded, and tiny by design.
///
/// `delegation_id_hex` is carried INSIDE the record as well as being the storage key, so a record
/// that was moved, copied or substituted under another key answers about the delegation it actually
/// describes rather than the one it was filed under. The reader compares the two and refuses on any
/// difference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DelegationLifecycleRecordDto {
    /// Family schema version (must equal [`DELEGATION_LIFECYCLE_SCHEMA`]).
    pub schema_version: u32,
    /// Monotonic record revision (observation only; non-zero).
    pub record_revision: u64,
    /// The delegation this record is about: exactly 64 LOWERCASE hex characters.
    pub delegation_id_hex: String,
    /// The host-recorded lifecycle state.
    pub state: DelegationLifecycleStateDto,
}

impl DelegationLifecycleRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON (bad JSON, unknown/missing/duplicate field,
    /// unknown enum variant), [`PersistError::DocumentTooLarge`] above the intake bound.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate structural bounds.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, DELEGATION_LIFECYCLE_SCHEMA)?;
        crate::common::require_nonzero_revision(self.record_revision)?;
        // EXACT length and LOWERCASE, not merely "hex within a bound": two spellings of one
        // delegation id would be two storage keys for one delegation, which is precisely how a
        // terminal record gets bypassed by a second record that says ACTIVE.
        validate_hex(&self.delegation_id_hex, DELEGATION_ID_HEX_LEN)?;
        if self.delegation_id_hex.len() != DELEGATION_ID_HEX_LEN
            || self
                .delegation_id_hex
                .bytes()
                .any(|b| b.is_ascii_uppercase())
        {
            return Err(PersistError::InvalidHex);
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
