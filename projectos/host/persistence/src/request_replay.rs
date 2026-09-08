//! Durable REQUEST-REPLAY record DTO.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10C.
//!
//! ## What this family is, and what it is deliberately not
//!
//! It records ONE thing about ONE governed request identity: that the Host has already CONSUMED it.
//! It is not a copy of the request, not a log of what happened, and not a result. It carries no
//! correlation, no sequence, no connection, no session, no service epoch, no parameters, no prompt
//! text, no provider answer and no cost — a governed request identity and the word `CONSUMED` is
//! the complete answer to the only question this family exists to answer.
//!
//! ## Why the identity is a digest and not its parts
//!
//! The parts are resolved by the Host from its own trusted sources and hashed there
//! (`projectos-host-windows-local-ipc`). Storing them separately would put the Host's resolved plan,
//! phase, candidate and credential policy on disk in a second place, to no purpose: nothing here
//! ever needs to read a part back, only to compare an identity for equality. A fixed-width digest
//! compares exactly and reveals nothing.
//!
//! ## CONSUMED IS NOT EXECUTED
//!
//! The one state word means the Host took authority for this identity once. It does NOT claim a
//! provider ran, succeeded or was billed. Those are different records in different families, and
//! conflating them here would be how a crashed call comes to look like a completed one.
//!
//! ## Non-authoritative
//!
//! Like every other DTO in this crate, this is UNTRUSTED DATA. Deserialising one yields no
//! authority. It cannot mark anything fresh either: the family has exactly one state, so there is no
//! value an editor could write into `state` that means "not consumed" — the only way to say that is
//! for the record not to exist, and a record that does not exist is not one this DTO can express.

use serde::{Deserialize, Serialize};

use crate::common::validate_hex;
use crate::error::PersistError;
use crate::version::{require_schema, REQUEST_REPLAY_SCHEMA};

/// The exact character length of a request-identity hex encoding (32 bytes, lowercase hex).
pub const REQUEST_IDENTITY_HEX_LEN: usize = 64;

/// Persisted request-replay state.
///
/// ONE VARIANT, AND THAT IS THE DESIGN. A record exists only to say the identity was consumed, so
/// there is deliberately no `FRESH`, no `PENDING` and no `RELEASED` word: a state vocabulary that
/// could express "not consumed any more" would be a durable route back to fresh, which is the one
/// thing §10C exists to prevent. Freshness is the ABSENCE of a record, and absence is not a value
/// anyone can write. An unknown string here is a parse failure, never a tolerated value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequestReplayStateDto {
    /// The Host has taken authority for this governed request identity. TERMINAL.
    ///
    /// It does NOT assert that a provider ran, completed or was billed.
    Consumed,
}

/// Persisted durable request-replay record. Strict, bounded, and tiny by design.
///
/// `request_identity_hex` is carried INSIDE the record as well as being the storage key, so a record
/// that was moved, copied or substituted under another key answers about the identity it actually
/// describes rather than the one it was filed under. The reader compares the two and refuses on any
/// difference — otherwise one consumed request's record could be renamed to satisfy a different one,
/// or, worse, be moved OFF a key to make that key look fresh while still looking like a valid store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RequestReplayRecordDto {
    /// Family schema version (must equal [`REQUEST_REPLAY_SCHEMA`]).
    pub schema_version: u32,
    /// Monotonic record revision (observation only; non-zero).
    pub record_revision: u64,
    /// The governed request identity this record is about: exactly 64 LOWERCASE hex characters.
    pub request_identity_hex: String,
    /// The replay state. Only ever `Consumed`.
    pub state: RequestReplayStateDto,
}

impl RequestReplayRecordDto {
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
        require_schema(self.schema_version, REQUEST_REPLAY_SCHEMA)?;
        crate::common::require_nonzero_revision(self.record_revision)?;
        // EXACT length and LOWERCASE, not merely "hex within a bound": two spellings of one identity
        // would be two storage keys for one governed request, and the second key would read back
        // absent — which is precisely how a consumed request becomes fresh again.
        validate_hex(&self.request_identity_hex, REQUEST_IDENTITY_HEX_LEN)?;
        if self.request_identity_hex.len() != REQUEST_IDENTITY_HEX_LEN
            || self
                .request_identity_hex
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
