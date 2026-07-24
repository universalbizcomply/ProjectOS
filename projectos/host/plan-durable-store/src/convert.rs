//! Map the untrusted persisted [`PlanRecordDto`] into the accepted core [`PlanDurableDto`] the reload
//! path consumes. This performs NO validation of authority — it only reshapes bytes into the core's
//! untrusted-DTO type; every gate (committed, schema, re-normalize, SHA-256 recompute, active binding)
//! runs inside `projectos_host_core::validate_durable_plan`. An unmappable identity or enum yields a
//! bounded refusal, never a partial or fabricated authority.

use projectos_host_core::{
    ApprovedPlanRef, ApprovedPlanStatus, ApprovedPlanVersion, EffectPolicy, EnvironmentId,
    PhaseDefinitionCandidate, PhaseType, PlanDurableDto, ProjectId, ProviderPolicy,
    RepositoryPolicy, ResidueRequirement,
};
use projectos_host_persistence::{
    EffectPolicyDto, PhaseTypeDto, PlanCandidateDto, PlanRecordDto, PlanStatusDto,
    ProviderPolicyDto, RepositoryPolicyDto, ResidueDto,
};

use crate::error::PlanStoreError;

fn phase_type(d: PhaseTypeDto) -> PhaseType {
    match d {
        PhaseTypeDto::SourceOnly => PhaseType::SourceOnly,
        PhaseTypeDto::Observation => PhaseType::Observation,
        PhaseTypeDto::TemporaryServiceLifecycle => PhaseType::TemporaryServiceLifecycle,
    }
}

fn repository_policy(d: RepositoryPolicyDto) -> RepositoryPolicy {
    match d {
        RepositoryPolicyDto::ReadOnly => RepositoryPolicy::ReadOnly,
        RepositoryPolicyDto::PinnedBaseline => RepositoryPolicy::PinnedBaseline,
    }
}

fn provider_policy(d: ProviderPolicyDto) -> ProviderPolicy {
    match d {
        ProviderPolicyDto::None => ProviderPolicy::None,
        ProviderPolicyDto::ReadOnly => ProviderPolicy::ReadOnly,
    }
}

fn effect_policy(d: EffectPolicyDto) -> EffectPolicy {
    match d {
        EffectPolicyDto::None => EffectPolicy::None,
        EffectPolicyDto::ObservationOnly => EffectPolicy::ObservationOnly,
        EffectPolicyDto::TemporaryLifecycle => EffectPolicy::TemporaryLifecycle,
    }
}

fn residue(d: ResidueDto) -> ResidueRequirement {
    match d {
        ResidueDto::ExactlyZero => ResidueRequirement::ExactlyZero,
    }
}

/// Core status projection. The stored status is UNTRUSTED — it only tells the reload path what to check
/// against; a non-active status can never resolve active.
pub(crate) fn status(d: PlanStatusDto) -> ApprovedPlanStatus {
    match d {
        PlanStatusDto::Active => ApprovedPlanStatus::Active,
        PlanStatusDto::Superseded => ApprovedPlanStatus::Superseded,
        PlanStatusDto::Revoked => ApprovedPlanStatus::Revoked,
        PlanStatusDto::Stale => ApprovedPlanStatus::Stale,
    }
}

fn candidate(c: &PlanCandidateDto) -> Result<PhaseDefinitionCandidate, PlanStoreError> {
    let un = |_| PlanStoreError::Unconvertible;
    Ok(PhaseDefinitionCandidate {
        phase_id: c.phase_id.clone(),
        phase_type: phase_type(c.phase_type),
        project: ProjectId::new(c.project.clone()).map_err(un)?,
        environment: EnvironmentId::new(c.environment.clone()).map_err(un)?,
        scope: c.scope.clone(),
        path_boundary: c.path_boundary.clone(),
        allowed_actions: c.allowed_actions.clone(),
        prohibited_actions: c.prohibited_actions.clone(),
        dependencies: c.dependencies.clone(),
        predecessors: c.predecessors.clone(),
        repository_policy: repository_policy(c.repository_policy),
        provider_policy: provider_policy(c.provider_policy),
        effect_policy: effect_policy(c.effect_policy),
        rollback_required: c.rollback_required,
        shutdown_required: c.shutdown_required,
        disconnect_required: c.disconnect_required,
        residue: residue(c.residue),
    })
}

/// Reshape a persisted plan record into the core untrusted reload DTO.
///
/// # Errors
/// [`PlanStoreError::Unconvertible`] if an identity cannot be reconstructed.
pub(crate) fn to_core_dto(dto: &PlanRecordDto) -> Result<PlanDurableDto, PlanStoreError> {
    Ok(PlanDurableDto {
        schema_version: dto.schema_version,
        plan_ref: ApprovedPlanRef::new(dto.plan_ref.clone())
            .map_err(|_| PlanStoreError::Unconvertible)?,
        version: ApprovedPlanVersion(dto.plan_version),
        candidate: candidate(&dto.candidate)?,
        stored_digest_hex: dto.stored_digest_hex.clone(),
        status: status(dto.status),
        status_revision: dto.status_revision,
        committed: dto.committed,
    })
}
