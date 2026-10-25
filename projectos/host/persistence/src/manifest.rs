//! Protected-state manifest DTO — records the current revision of each store family + a MAC over the
//! manifest. Uses a FIXED per-family revision struct (no unbounded arbitrary authority-bearing map).
//! The MAC is opaque hex here; verification is a future store-integrity duty (no crypto in this crate).

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_hex, MAX_HEX_META_LEN};
use crate::error::PersistError;
use crate::version::{require_schema, MANIFEST_SCHEMA};

/// Fixed per-family current revisions (no arbitrary map).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FamilyRevisionsDto {
    /// Trust-policy current revision.
    pub trust_policy: u64,
    /// Project-registry current revision.
    pub project_registry: u64,
    /// Operation current revision.
    pub operation: u64,
    /// Approval current revision.
    pub approval: u64,
    /// Credential-metadata current revision.
    pub credential_metadata: u64,
    /// Credential-envelope current revision.
    pub credential_envelope: u64,
    /// Emergency-stop current revision.
    pub emergency_stop: u64,
    /// Audit current revision.
    pub audit: u64,
}

/// Persisted protected-state manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProtectedStateManifestDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic store revision (non-zero).
    pub store_revision: u64,
    /// Fixed per-family revisions.
    pub family_revisions: FamilyRevisionsDto,
    /// Manifest MAC (hex) — opaque; verified by a future store-integrity phase.
    pub manifest_mac: String,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
}

impl ProtectedStateManifestDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds + MAC encoding. Does NOT verify the MAC (no crypto here).
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, MANIFEST_SCHEMA)?;
        require_nonzero_revision(self.store_revision)?;
        require_nonzero_revision(self.record_revision)?;
        validate_hex(&self.manifest_mac, MAX_HEX_META_LEN)
            .map_err(|_| PersistError::InvalidChainReference)?;
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
