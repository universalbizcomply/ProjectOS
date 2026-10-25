//! Encrypted credential-envelope DTO — metadata about encrypted material ONLY. It contains no
//! plaintext, secret, password, token, private key, or decrypted value: such fields do not exist, so
//! `deny_unknown_fields` rejects any injected one. No encryption or decryption happens in this crate.

use serde::{Deserialize, Serialize};

use crate::common::{
    require_nonzero_revision, validate_hex, validate_id, MAX_HEX_CIPHERTEXT_LEN, MAX_HEX_META_LEN,
};
use crate::enums::RevocationStateDto;
use crate::error::PersistError;
use crate::version::{require_schema, CREDENTIAL_ENVELOPE_SCHEMA};

/// Persisted encrypted credential envelope (metadata over ciphertext; never the value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CredentialEnvelopeDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Credential reference (opaque; not a value).
    pub credential_ref: String,
    /// Project binding.
    pub project: String,
    /// Provider binding.
    pub provider: String,
    /// Environment binding.
    pub environment: String,
    /// Wrapping-key version.
    pub key_version: u64,
    /// Algorithm identifier (bounded id, e.g. `AES-256-GCM`).
    pub algorithm: String,
    /// Nonce (hex).
    pub nonce: String,
    /// Ciphertext (hex) — opaque encrypted bytes, bounded.
    pub ciphertext: String,
    /// Authentication tag (hex).
    pub auth_tag: String,
    /// Associated-data digest (hex) binding project/provider/environment/ref/revision.
    pub associated_data_digest: String,
    /// Revision at which this envelope was created.
    pub created_revision: u64,
    /// Revocation state of the material.
    pub revocation: RevocationStateDto,
}

impl CredentialEnvelopeDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate all bounds + bindings. Never inspects or exposes a secret (there is none here).
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, CREDENTIAL_ENVELOPE_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        require_nonzero_revision(self.created_revision)?;
        for id in [
            &self.credential_ref,
            &self.project,
            &self.provider,
            &self.environment,
            &self.algorithm,
        ] {
            validate_id(id)?;
        }
        validate_hex(&self.nonce, MAX_HEX_META_LEN)?;
        validate_hex(&self.auth_tag, MAX_HEX_META_LEN)?;
        validate_hex(&self.associated_data_digest, MAX_HEX_META_LEN)?;
        validate_hex(&self.ciphertext, MAX_HEX_CIPHERTEXT_LEN)?;
        // A newly-created envelope revision cannot post-date the record revision.
        if self.created_revision > self.record_revision {
            return Err(PersistError::InvalidRevision);
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
