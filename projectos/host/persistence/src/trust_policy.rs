//! Trust-policy DTO (approved publishers, signing policy, floors). A stored floor/revision is an
//! observation validated only by future store-integrity checks; this DTO makes no anti-rollback claim.

use serde::{Deserialize, Serialize};

use crate::common::{require_nonzero_revision, validate_id, validate_id_collection};
use crate::error::PersistError;
use crate::version::{require_schema, TRUST_POLICY_SCHEMA};

/// Persisted trust-policy record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TrustPolicyDto {
    /// Family schema version.
    pub schema_version: u32,
    /// Monotonic record revision (non-zero).
    pub record_revision: u64,
    /// Approved publisher identities (bounded, deduplicated).
    #[serde(default)]
    pub approved_publishers: Vec<String>,
    /// Signing-policy identity.
    pub signing_policy_id: String,
    /// Publisher-policy revision.
    pub policy_revision: u64,
    /// Approved installation identity.
    pub approved_installation: String,
    /// Approved release identity.
    pub approved_release: String,
    /// Minimum accepted release floor.
    pub min_release_floor: u64,
    /// Minimum accepted policy revision.
    pub min_policy_revision: u64,
    /// Emergency revocation floor.
    pub emergency_revocation_floor: u64,
    /// Trust-root version.
    pub trust_root_version: u64,
}

impl TrustPolicyDto {
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
        require_schema(self.schema_version, TRUST_POLICY_SCHEMA)?;
        require_nonzero_revision(self.record_revision)?;
        validate_id_collection(&self.approved_publishers)?;
        for id in [
            &self.signing_policy_id,
            &self.approved_installation,
            &self.approved_release,
        ] {
            validate_id(id)?;
        }
        if self.policy_revision < self.min_policy_revision {
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
