//! Project-registry DTO (canonical repository/remote, permitted root, environments, provider
//! bindings, freeze/status). Registry DATA — not a candidate-controlled authoritative storage path.

use serde::{Deserialize, Serialize};

use crate::common::{
    require_nonzero_revision, validate_id, validate_id_collection, validate_local_root,
    validate_repository_remote,
};
use crate::enums::ProjectStatusDto;
use crate::error::PersistError;
use crate::version::{require_schema, PROJECT_REGISTRY_SCHEMA};

/// Persisted project-registry record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectRegistryDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Project identity.
    pub project: String,
    /// Canonical repository identity.
    pub repository_identity: String,
    /// Approved remote identity (bounded text — may contain URL-like characters as data).
    pub approved_remote: String,
    /// Permitted local root (bounded text — a path is legitimate registry data, never authoritative).
    pub permitted_local_root: String,
    /// Allowed environments (bounded, deduplicated).
    #[serde(default)]
    pub allowed_environments: Vec<String>,
    /// Provider bindings (bounded, deduplicated).
    #[serde(default)]
    pub provider_bindings: Vec<String>,
    /// Production-freeze flag.
    pub production_freeze: bool,
    /// Project status.
    pub project_status: ProjectStatusDto,
    /// Approved project-configuration version.
    pub approved_config_version: u64,
}

impl ProjectRegistryDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, PROJECT_REGISTRY_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        validate_id(&self.project)?;
        validate_id(&self.repository_identity)?;
        // Remote + local root use dedicated identity validators (NOT redacted-narrative validation):
        // a repository-remote-syntax boundary and a Windows absolute-path boundary. Neither performs
        // live repository or filesystem verification (future service-adapter duties).
        validate_repository_remote(&self.approved_remote)?;
        validate_local_root(&self.permitted_local_root)?;
        validate_id_collection(&self.allowed_environments)?;
        validate_id_collection(&self.provider_bindings)?;
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
