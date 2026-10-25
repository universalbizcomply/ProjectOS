//! Credential-metadata DTO — scope/lifecycle metadata ONLY. No secret value exists in this type.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id, validate_id_collection};
use crate::enums::CredentialLifecycleDto;
use crate::error::PersistError;
use crate::version::{require_schema, CREDENTIAL_METADATA_SCHEMA};

/// Persisted credential metadata (never the value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CredentialMetadataDto {
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
    /// Permitted operation scopes (bounded, deduplicated).
    #[serde(default)]
    pub permitted_operations: Vec<String>,
    /// Lifecycle state.
    pub lifecycle: CredentialLifecycleDto,
    /// Opaque expiry boundary.
    pub expiry: u64,
    /// Protected revocation revision.
    pub revocation_revision: u64,
    /// Whether rotation is required.
    pub rotation_required: bool,
    /// Revision at which the credential was last validated.
    pub last_validated_revision: u64,
}

impl CredentialMetadataDto {
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
        require_schema(self.schema_version, CREDENTIAL_METADATA_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        for id in [
            &self.credential_ref,
            &self.project,
            &self.provider,
            &self.environment,
        ] {
            validate_id(id)?;
        }
        validate_id_collection(&self.permitted_operations)?;
        // A revoked credential must not be reported as active-usable elsewhere; the lifecycle carries
        // the authority meaning and is validated as a closed enum by deserialisation.
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
