//! Emergency-stop / freeze DTO. Anti-rollback of this record is a future store-integrity duty; the
//! DTO carries a monotonic `state_revision` for that purpose but makes no rollback-protection claim.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id, validate_id_collection};
use crate::error::PersistError;
use crate::version::{require_schema, EMERGENCY_STOP_SCHEMA};

/// Persisted emergency-stop / freeze state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EmergencyStopDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Global emergency stop.
    pub global_stop: bool,
    /// Project-scoped stops (bounded, deduplicated).
    #[serde(default)]
    pub project_stops: Vec<String>,
    /// Provider-scoped stops (bounded, deduplicated).
    #[serde(default)]
    pub provider_stops: Vec<String>,
    /// Environment-scoped stops (bounded, deduplicated).
    #[serde(default)]
    pub environment_stops: Vec<String>,
    /// Staging lock.
    pub staging_lock: bool,
    /// Production lock.
    pub production_lock: bool,
    /// Monotonic state revision.
    pub state_revision: u64,
    /// Owner-decision provenance reference (bounded id; not a secret).
    pub owner_decision_provenance: String,
}

impl EmergencyStopDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate bounds + revision.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, EMERGENCY_STOP_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        require_nonzero_revision(self.state_revision)
            .map_err(|_| PersistError::EmergencyInconsistency)?;
        validate_id(&self.owner_decision_provenance)?;
        validate_id_collection(&self.project_stops)?;
        validate_id_collection(&self.provider_stops)?;
        validate_id_collection(&self.environment_stops)?;
        // All-clear (no global/scoped stop, no lock) is a valid state; the locks/stops are typed
        // booleans/collections, so no cross-field contradiction check is required.
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
