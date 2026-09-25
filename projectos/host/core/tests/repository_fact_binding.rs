//! Operation-bound repository-fact refusals that need the `test-fixtures` surface: the approved-plan
//! journal (for the plan cross-binding dimension) and the fact's cached-scalar test mutators (for the
//! fact↔baseline generation/freshness consistency checks). Gated on `test-fixtures`; a production graph
//! never builds these. Synthetic observations only — no Git, no product repository.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_lines)]

use projectos_host_core::{
    reduce, verify_repository_baseline, ApprovalOutcome, ApprovedPlanJournal, ApprovedPlanStatus,
    AuthoritySnapshot, BranchPolicy, CredentialOutcome, DenialReason, Disposition,
    DivergencePolicy, EffectPolicy, EmergencyStateRevision, EmergencyStopState, ExecutableIdentity,
    ExpiryBoundary, GitRepositoryObservation, InstallationId, InternalOperationRecord,
    OperationInputs, PhaseDefinitionCandidate, PhaseType, PolicyFloor, PolicyId, PolicyOutcome,
    PolicyRevision, ProviderPolicy, PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId,
    RepositoryBinding, RepositoryFreshness, RepositoryPolicy, RepositoryRef,
    RequestedOperationPolicy, RequiredFreshness, RequiredRepository, ResidueRequirement,
    ResumePolicy, RevocationRevision, RevocationStatus, ServiceValidatedFacts, SessionId,
    ValidatedApprovedPlan, ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness,
    ValidatedInstallation, ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy,
    ValidatedRelease, ValidatedRepositoryFact, ValidatedSession, ValidityStatus,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const OID: &str = "0123456789abcdef0123456789abcdef01234567";

fn observation() -> GitRepositoryObservation {
    GitRepositoryObservation {
        canonical_root: "C:/repo".into(),
        common_dir: "C:/repo/.git".into(),
        is_worktree: true,
        head_oid: OID.into(),
        branch: Some("main".into()),
        staged: 0,
        unstaged: 0,
        untracked: 0,
        tracking_present: false,
        ahead: None,
        behind: None,
        submodule_dirty: false,
        generation: 1,
    }
}

fn required() -> RequiredRepository {
    RequiredRepository {
        expected_root: "C:/repo".into(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: OID.into(),
        branch_policy: BranchPolicy::Exact("main".into()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    }
}

fn baseline() -> projectos_host_core::VerifiedRepositoryBaseline {
    verify_repository_baseline(&observation(), &required()).unwrap()
}

fn candidate() -> PhaseDefinitionCandidate {
    PhaseDefinitionCandidate {
        phase_id: "phase-x".into(),
        phase_type: PhaseType::SourceOnly,
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        scope: vec!["a".into()],
        path_boundary: vec!["src/x".into()],
        allowed_actions: vec!["read".into()],
        prohibited_actions: vec!["write".into()],
        dependencies: vec!["dep-1".into()],
        predecessors: vec!["pre-1".into()],
        repository_policy: RepositoryPolicy::ReadOnly,
        provider_policy: ProviderPolicy::None,
        effect_policy: EffectPolicy::ObservationOnly,
        rollback_required: true,
        shutdown_required: true,
        disconnect_required: true,
        residue: ResidueRequirement::ExactlyZero,
        approved_baseline: None,
    }
}

fn conforming_policy() -> RequestedOperationPolicy {
    RequestedOperationPolicy {
        requested_action: "read".into(),
        requested_scope: vec!["a".into()],
        requested_paths: vec!["src/x/file".into()],
        completed_dependencies: vec!["dep-1".into()],
        closed_predecessors: vec!["pre-1".into()],
    }
}

fn active_plan_fact() -> ValidatedApprovedPlan {
    ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
    )
}

fn new_record() -> InternalOperationRecord {
    InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &projectos_host_core::PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
}

/// A repository-governed record, optionally also plan-governed.
fn record(
    plan: Option<(&ValidatedApprovedPlan, RequestedOperationPolicy)>,
) -> InternalOperationRecord {
    let mut r = new_record();
    if let Some((fact, policy)) = plan {
        r = r.bind_approved_plan(fact, policy);
    }
    r = r.bind_repository(required());
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn bind_fact(record: &InternalOperationRecord) -> ValidatedRepositoryFact {
    ValidatedRepositoryFact::bind(
        baseline(),
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
    )
}

fn full_facts(
    record: &InternalOperationRecord,
    fact: ValidatedRepositoryFact,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: Some(fact),
        owner_presence: None,
        elevation: None,
        session: Some(ValidatedSession {
            session: sid.clone(),
        }),
        process: Some(ValidatedProcess { session: sid }),
        executable: Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-1"),
            installation: inst.clone(),
        }),
        release: Some(ValidatedRelease {
            release: ReleaseId::new("rel-1"),
        }),
        installation: Some(ValidatedInstallation {
            installation: inst.clone(),
        }),
        project: Some(ValidatedProjectContext {
            project: ProjectId::new("proj").unwrap(),
            repository: RepositoryRef::new("repo-1"),
        }),
        environment: Some(ValidatedEnvironment {
            environment: EnvironmentId::new("staging").unwrap(),
        }),
        publisher_policy: Some(ValidatedPublisherPolicy {
            policy_id: PolicyId::new("pol-1"),
            policy_revision: PolicyRevision(1),
            publisher: PublisherIdentity::new("pub-1"),
            installation: inst.clone(),
            outcome: PolicyOutcome::Accepted,
            revocation_revision: RevocationRevision(1),
        }),
        freshness: Some(ValidatedFreshness {
            release: ReleaseId::new("rel-1"),
            release_floor: ReleaseFloor(1),
            policy_revision: PolicyRevision(1),
            policy_floor: PolicyFloor(1),
            emergency_revocation_floor: RevocationRevision(1),
        }),
        authority: Some(AuthoritySnapshot {
            authority_expiry: ExpiryBoundary(1000),
            operation_expiry: Some(ExpiryBoundary(1000)),
            validity: ValidityStatus::Valid,
            revocation: RevocationStatus::Active(RevocationRevision(1)),
            emergency_state_revision: EmergencyStateRevision(1),
        }),
        approval: ApprovalOutcome::NotRequired,
        credential: CredentialOutcome::NotRequired,
        emergency_stop: EmergencyStopState::Clear,
    }
}

#[test]
fn a_fact_bound_to_a_plan_governed_operation_is_refused_for_a_non_plan_operation() {
    // The fact carries a plan binding (bound to a plan-governed operation); the reduced operation is not
    // plan-governed, so `fact.plan_binding() = Some != required_plan = None` → Plan mismatch. Phase is
    // unchanged (the plan folds only the fingerprint), so the Plan check — not Phase — fires.
    let plan = active_plan_fact();
    let plan_owner = record(Some((&plan, conforming_policy())));
    let fact = bind_fact(&plan_owner);

    let reduced = record(None);
    assert_eq!(
        reduce(&reduced.to_request(), &full_facts(&reduced, fact)),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Plan
        ))
    );
}

#[test]
fn a_fact_whose_cached_generation_diverges_from_its_baseline_is_refused() {
    let reduced = record(None);
    let inconsistent = bind_fact(&reduced).with_generation_for_test(999);
    assert_eq!(
        reduce(&reduced.to_request(), &full_facts(&reduced, inconsistent)),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Generation
        ))
    );
}

#[test]
fn a_fact_whose_cached_freshness_diverges_from_its_baseline_is_refused() {
    let reduced = record(None);
    let inconsistent =
        bind_fact(&reduced).with_freshness_for_test(RepositoryFreshness::LiveNotVerified);
    assert_eq!(
        reduce(&reduced.to_request(), &full_facts(&reduced, inconsistent)),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Freshness
        ))
    );
}

#[test]
fn the_exact_fact_is_eligible() {
    let reduced = record(None);
    let fact = bind_fact(&reduced);
    assert!(matches!(
        reduce(&reduced.to_request(), &full_facts(&reduced, fact)),
        Disposition::EligibleForServiceExecution(_)
    ));
}
