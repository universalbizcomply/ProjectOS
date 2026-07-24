//! Durable approved-plan record DTO. Non-authoritative: converting this DTO NEVER yields a
//! `ValidatedApprovedPlan`, `ExecutionPermit`, or any authority. The `storedDigestHex` is retained for
//! comparison ONLY — the accepted `projectos-host-core` reload path RECOMPUTES the SHA-256 from the
//! re-normalized candidate and rejects any mismatch. An uncommitted (Intent-only) record is never
//! authority. A stored status/revision is data; a caller editing the status string restores nothing,
//! because core re-derives authority from the recomputed digest, the exact required binding and the
//! active status.

use serde::{Deserialize, Serialize};

use crate::common::{
    validate_hex, validate_id, validate_id_collection, MAX_COLLECTION, MAX_TEXT_LEN,
};
use crate::error::PersistError;
use crate::version::{require_schema, PLAN_RECORD_SCHEMA};

/// Persisted approved-plan status (mirrors the core `ApprovedPlanStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlanStatusDto {
    /// Active and current.
    Active,
    /// A newer approved version exists.
    Superseded,
    /// Explicitly revoked.
    Revoked,
    /// Past its validity window.
    Stale,
}

/// Persisted phase type (mirrors the core `PhaseType`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PhaseTypeDto {
    /// Read-only source inspection.
    SourceOnly,
    /// Read-only observation.
    Observation,
    /// Observation plus a temporary, fully-rolled-back service lifecycle.
    TemporaryServiceLifecycle,
}

/// Persisted repository policy (mirrors the core `RepositoryPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepositoryPolicyDto {
    /// Read-only.
    ReadOnly,
    /// Pinned baseline.
    PinnedBaseline,
}

/// Persisted provider policy (mirrors the core `ProviderPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderPolicyDto {
    /// No provider access.
    None,
    /// Read-only provider access.
    ReadOnly,
}

/// Persisted effect policy (mirrors the core `EffectPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectPolicyDto {
    /// No effect.
    None,
    /// Observation only.
    ObservationOnly,
    /// Temporary lifecycle with mandatory rollback.
    TemporaryLifecycle,
}

/// Persisted residue obligation (mirrors the core `ResidueRequirement`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResidueDto {
    /// Residue must be exactly zero.
    ExactlyZero,
}

/// The untrusted candidate inputs required to RE-NORMALIZE and RE-DIGEST the plan definition on reload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanCandidateDto {
    /// Stable phase identifier.
    pub phase_id: String,
    /// Phase type.
    pub phase_type: PhaseTypeDto,
    /// Project.
    pub project: String,
    /// Environment.
    pub environment: String,
    /// Authorised scope tokens.
    #[serde(default)]
    pub scope: Vec<String>,
    /// Exact authorised path boundary (order preserved).
    #[serde(default)]
    pub path_boundary: Vec<String>,
    /// Allowed actions.
    #[serde(default)]
    pub allowed_actions: Vec<String>,
    /// Prohibited actions.
    #[serde(default)]
    pub prohibited_actions: Vec<String>,
    /// Dependency phase ids.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Predecessor phase ids (order preserved).
    #[serde(default)]
    pub predecessors: Vec<String>,
    /// Repository policy.
    pub repository_policy: RepositoryPolicyDto,
    /// Provider policy.
    pub provider_policy: ProviderPolicyDto,
    /// Effect policy.
    pub effect_policy: EffectPolicyDto,
    /// Rollback required.
    pub rollback_required: bool,
    /// Shutdown acknowledgement required.
    pub shutdown_required: bool,
    /// Disconnect required.
    pub disconnect_required: bool,
    /// Residue obligation.
    pub residue: ResidueDto,
}

/// A bounded path-boundary entry: non-empty, ≤512, no control chars, no backslash (paths use `/`).
fn validate_path_entry(s: &str) -> Result<(), PersistError> {
    if s.is_empty()
        || s.len() > MAX_TEXT_LEN
        || s.contains('\\')
        || s.chars().any(|c| c.is_control())
    {
        return Err(PersistError::InvalidText);
    }
    Ok(())
}

impl PlanCandidateDto {
    fn validate(&self) -> Result<(), PersistError> {
        validate_id(&self.phase_id)?;
        validate_id(&self.project)?;
        validate_id(&self.environment)?;
        validate_id_collection(&self.scope)?;
        validate_id_collection(&self.allowed_actions)?;
        validate_id_collection(&self.prohibited_actions)?;
        validate_id_collection(&self.dependencies)?;
        validate_id_collection(&self.predecessors)?;
        if self.path_boundary.len() > MAX_COLLECTION {
            return Err(PersistError::InvalidCollection);
        }
        for p in &self.path_boundary {
            validate_path_entry(p)?;
        }
        Ok(())
    }
}

/// Persisted durable approved-plan record. Strict + bounded; carries no authority object, no permit, no
/// secret. The reload path in `projectos-host-core` treats every field as untrusted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanRecordDto {
    /// Family schema version (must equal [`PLAN_RECORD_SCHEMA`]).
    pub schema_version: u32,
    /// Monotonic record revision (observation only; non-zero).
    pub record_revision: u64,
    /// Project.
    pub project: String,
    /// Environment.
    pub environment: String,
    /// Approved plan reference.
    pub plan_ref: String,
    /// Stable phase reference.
    pub phase_reference: String,
    /// Approved plan version.
    pub plan_version: u64,
    /// The untrusted candidate inputs (re-normalized + re-digested on reload).
    pub candidate: PlanCandidateDto,
    /// The stored digest, lowercase hex — for comparison ONLY, never trusted as authority.
    pub stored_digest_hex: String,
    /// Approval-binding reference (bounded, non-authoritative).
    pub approval_binding_ref: String,
    /// Stored status.
    pub status: PlanStatusDto,
    /// Stored monotonic status revision.
    pub status_revision: u64,
    /// The version that superseded this one, where applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<u64>,
    /// Journal identity (bounded).
    pub journal_identity: String,
    /// Whether the record reached Commit. An uncommitted (Intent-only) record is never authority.
    pub committed: bool,
}

impl PlanRecordDto {
    /// Strictly parse from JSON bytes.
    ///
    /// # Errors
    /// [`PersistError::Malformed`] for non-strict JSON (bad JSON, unknown/missing/duplicate field,
    /// unknown enum variant).
    pub fn parse_json(bytes: &[u8]) -> Result<Self, PersistError> {
        crate::common::check_intake(bytes)?;
        serde_json::from_slice(bytes).map_err(|_| PersistError::Malformed)
    }

    /// Validate structural bounds. Deep plan semantics (normalization, digest recomputation, active
    /// binding) are the accepted core reload path's job — this only enforces the DTO is well-formed.
    ///
    /// # Errors
    /// A [`PersistError`] naming the first violated rule.
    pub fn validate(&self) -> Result<(), PersistError> {
        require_schema(self.schema_version, PLAN_RECORD_SCHEMA)?;
        crate::common::require_nonzero_revision(self.record_revision)?;
        validate_id(&self.project)?;
        validate_id(&self.environment)?;
        validate_id(&self.plan_ref)?;
        validate_id(&self.phase_reference)?;
        validate_id(&self.approval_binding_ref)?;
        validate_id(&self.journal_identity)?;
        // Digest is a 64-char lowercase SHA-256 hex, retained for comparison only.
        validate_hex(&self.stored_digest_hex, 64)?;
        if self.stored_digest_hex.len() != 64
            || self
                .stored_digest_hex
                .bytes()
                .any(|b| b.is_ascii_uppercase())
        {
            return Err(PersistError::InvalidHex);
        }
        self.candidate.validate()?;
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
