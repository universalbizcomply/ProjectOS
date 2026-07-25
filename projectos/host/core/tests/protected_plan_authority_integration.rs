//! End-to-end proof of the Tier-2 approved-plan authority chain
//! (CD-B4-PROTECTED-PLAN-REDUCER-PERMIT-INTEGRATION1A).
//!
//! Candidate → normalize → SHA-256 digest → synthetic owner approval → journal Intent/Commit → reload +
//! recompute + revalidate → ValidatedApprovedPlan → ServiceValidatedFacts → fail-closed reducer →
//! VerifiedExecutionContext → ExecutionPermit → pre-use revalidation. A plan-governed operation cannot
//! obtain or retain a permit without one exact active approved-plan binding.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_lines)]

use projectos_host_core::{
    reduce, ApprovalOutcome, ApprovalRecordId, ApprovedPlanJournal, ApprovedPlanStatus,
    AuthoritySnapshot, BindingKind, ContextComparison, ContextField, CredentialOutcome,
    DenialReason, Disposition, EffectPolicy, EmergencyStateRevision, EmergencyStopState,
    ExecutableIdentity, ExpiryBoundary, InstallationId, InternalOperationRecord, MissingFact,
    OperationInputs, PhaseDefinitionCandidate, PhaseReference, PhaseType, PlanPolicyRefusal,
    PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision, ProviderPolicy, PublisherIdentity,
    RecordPolicy, ReleaseFloor, ReleaseId, ReplayEvidenceId, RepositoryPolicy, RepositoryRef,
    RequestedOperationPolicy, ResidueRequirement, ResumePolicy, RevocationRevision,
    RevocationStatus, ServiceValidatedFacts, SessionId, ValidatedApprovedPlan,
    ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness, ValidatedInstallation,
    ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease,
    ValidatedSession, ValidityStatus, VerifiedApproval, VerifiedExecutionContext,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

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

/// Commit an active approved plan (v1) and return its validated fact.
fn active_fact() -> ValidatedApprovedPlan {
    ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
    )
}

fn full_facts(fact: Option<ValidatedApprovedPlan>) -> ServiceValidatedFacts {
    let b = candidate();
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: None, // set by the caller to the operation phase
        approved_plan: fact,
        repository: None,
        owner_presence: None,
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
            project: b.project.clone(),
            repository: RepositoryRef::new("repo-1"),
        }),
        environment: Some(ValidatedEnvironment {
            environment: b.environment.clone(),
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

/// A plan-governed record whose release/project/env/installation match the fact set, bound to the given
/// validated plan and policy.
fn governed_record(
    fact: &ValidatedApprovedPlan,
    policy: RequestedOperationPolicy,
) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
    .bind_approved_plan(fact, policy);
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

/// As [`governed_record`], but the operation additionally requires owner approval, so the reducer runs
/// its fingerprint-bound approval check.
fn governed_record_requiring_approval(
    fact: &ValidatedApprovedPlan,
    policy: RequestedOperationPolicy,
) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: true,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
    .bind_approved_plan(fact, policy);
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn facts_for(
    record: &InternalOperationRecord,
    fact: Option<ValidatedApprovedPlan>,
) -> ServiceValidatedFacts {
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        ..full_facts(fact)
    }
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn a_governed_operation_with_the_exact_active_plan_is_eligible() {
    let fact = active_fact();
    let record = governed_record(&fact, conforming_policy());
    let facts = facts_for(&record, Some(fact));
    assert!(matches!(
        reduce(&record.to_request(), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- REFUSAL ----------------------------------------------------------------------------------

#[test]
fn a_missing_plan_fact_denies() {
    let fact = active_fact();
    let record = governed_record(&fact, conforming_policy());
    let facts = facts_for(&record, None);
    assert_eq!(
        reduce(&record.to_request(), &facts),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::ApprovedPlan))
    );
}

#[test]
fn a_prohibited_or_out_of_boundary_request_denies_precisely() {
    let fact = active_fact();
    // Prohibited action.
    let mut p = conforming_policy();
    p.requested_action = "write".into();
    let rec = governed_record(&fact, p);
    assert_eq!(
        reduce(&rec.to_request(), &facts_for(&rec, Some(fact.clone()))),
        Disposition::Denied(DenialReason::PlanPolicyRefused(
            PlanPolicyRefusal::ProhibitedAction
        ))
    );
    // Path outside boundary.
    let mut p = conforming_policy();
    p.requested_paths = vec!["src/other/f".into()];
    let rec = governed_record(&fact, p);
    assert_eq!(
        reduce(&rec.to_request(), &facts_for(&rec, Some(fact.clone()))),
        Disposition::Denied(DenialReason::PlanPolicyRefused(
            PlanPolicyRefusal::PathBoundaryMismatch
        ))
    );
    // Incomplete dependency.
    let mut p = conforming_policy();
    p.completed_dependencies = vec![];
    let rec = governed_record(&fact, p);
    assert_eq!(
        reduce(&rec.to_request(), &facts_for(&rec, Some(fact))),
        Disposition::Denied(DenialReason::PlanPolicyRefused(
            PlanPolicyRefusal::DependencyIncomplete
        ))
    );
}

#[test]
fn a_wrong_plan_fact_denies_with_binding_kind_approved_plan() {
    let fact = active_fact();
    let record = governed_record(&fact, conforming_policy());
    // A fact for a DIFFERENT version does not match the required binding.
    let other = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        2,
        ApprovedPlanStatus::Active,
        0,
    );
    let facts = facts_for(&record, Some(other));
    assert_eq!(
        reduce(&record.to_request(), &facts),
        Disposition::Denied(DenialReason::Mismatch(BindingKind::ApprovedPlan))
    );
}

// ---- PERMIT INVALIDATION ----------------------------------------------------------------------

#[test]
fn a_permit_is_invalid_after_the_plan_status_revision_changes() {
    let fact = active_fact();
    let record = governed_record(&fact, conforming_policy());
    let ctx_issued = match reduce(
        &record.to_request(),
        &facts_for(&record, Some(fact.clone())),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    // The same context re-derived validates.
    assert!(ctx_issued.compare(&ctx_issued).is_match());
    // A later status revision (e.g. a revocation bump) yields a fresh fact whose revision differs; the
    // permit's stored context no longer matches → invalidated.
    let bumped = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        5,
    );
    let record2 = governed_record(&bumped, conforming_policy());
    let ctx_fresh = match reduce(&record2.to_request(), &facts_for(&record2, Some(bumped))) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert_eq!(
        ctx_issued.compare(&ctx_fresh),
        ContextComparison::Mismatch(ContextField::ApprovedPlanStatusRevision)
    );
}

// ---- REDACTION --------------------------------------------------------------------------------

#[test]
fn no_plan_digest_or_definition_leaks_in_the_context() {
    let fact = active_fact();
    let record = governed_record(&fact, conforming_policy());
    let ctx: VerifiedExecutionContext =
        match reduce(&record.to_request(), &facts_for(&record, Some(fact))) {
            Disposition::EligibleForServiceExecution(p) => p.context().clone(),
            other => panic!("{other:?}"),
        };
    let rendered = format!("{ctx:?}");
    assert!(!rendered.contains("phase-x"));
    assert!(!rendered.contains("src/x"));
}

// ---- APPROVAL TRANSITIVE PLAN BINDING + FINGERPRINT SENSITIVITY --------------------------------
//
// Approved-plan authority is bound into VerifiedApproval TRANSITIVELY through the operation
// fingerprint: the plan reference/version/definition-digest and the requested policy are folded into
// the fingerprint, and approval is bound by fingerprint. These prove that route is load-bearing.

/// A different approved plan (v1 vs v2) yields a different operation fingerprint — the plan
/// reference/version/definition-digest are folded in. (Load-bearing for M18.)
#[test]
fn a_different_plan_changes_the_operation_fingerprint() {
    let f1 = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
    );
    let f2 = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        2,
        ApprovedPlanStatus::Active,
        0,
    );
    let r1 = governed_record(&f1, conforming_policy());
    let r2 = governed_record(&f2, conforming_policy());
    assert_ne!(r1.binding.fingerprint, r2.binding.fingerprint);
}

/// A different requested policy yields a different operation fingerprint — the policy is folded in.
/// (Load-bearing for M8.)
#[test]
fn a_different_policy_changes_the_operation_fingerprint() {
    let f = active_fact();
    let r1 = governed_record(&f, conforming_policy());
    let mut p2 = conforming_policy();
    p2.requested_paths = vec!["src/x".into()]; // still within boundary, but a different folded value
    let r2 = governed_record(&f, p2);
    assert_ne!(r1.binding.fingerprint, r2.binding.fingerprint);
}

/// Approval is bound by fingerprint; an approval carrying a DIFFERENT plan's operation fingerprint
/// (every other binding identical) is refused. Drop the plan fields from the fingerprint, or the
/// reducer's fingerprint check, and the two fingerprints coincide and the approval is wrongly accepted.
/// (Load-bearing for M5 and M18.)
#[test]
fn an_approval_bound_to_another_plan_is_refused_by_fingerprint() {
    let f1 = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
    );
    let f2 = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        2,
        ApprovedPlanStatus::Active,
        0,
    );
    let r1 = governed_record_requiring_approval(&f1, conforming_policy());
    let r2 = governed_record(&f2, conforming_policy());
    // Same operation in every dimension the approval binds — except it carries plan v2's folded
    // fingerprint while the operation is governed by plan v1.
    let approval = VerifiedApproval {
        approval_id: ApprovalRecordId::new("appr-1").unwrap(),
        phase: r1.binding.phase().clone(),
        project: r1.binding.project.clone(),
        repository: Some(RepositoryRef::new("repo-1")),
        environment: r1.binding.environment.clone(),
        provider: r1.binding.provider.clone(),
        operation: r1.binding.operation.clone(),
        fingerprint: r2.binding.fingerprint.clone(),
        release: r1.binding.release.clone(),
        expiry: ExpiryBoundary(1000),
        replay_identity: ReplayEvidenceId::new("nonce-1").unwrap(),
        operation_count: None,
        revocation: RevocationStatus::Active(RevocationRevision(1)),
    };
    let facts = ServiceValidatedFacts {
        phase: Some(r1.binding.phase().clone()),
        approval: ApprovalOutcome::Verified(approval),
        ..full_facts(Some(f1))
    };
    assert_eq!(
        reduce(&r1.to_request(), &facts),
        Disposition::Denied(DenialReason::ApprovalBindingMismatch)
    );
}

/// A permit's stored context is invalidated when the operation is governed by a DIFFERENT plan: the
/// re-derived context's approved-plan binding differs. (Load-bearing for M19.)
#[test]
fn a_permit_context_is_invalidated_by_a_different_plan() {
    let f1 = active_fact();
    let r1 = governed_record(&f1, conforming_policy());
    let issued = match reduce(&r1.to_request(), &facts_for(&r1, Some(f1))) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    let f2 = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        2,
        ApprovedPlanStatus::Active,
        0,
    );
    let r2 = governed_record(&f2, conforming_policy());
    let fresh = match reduce(&r2.to_request(), &facts_for(&r2, Some(f2))) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert_eq!(
        issued.compare(&fresh),
        ContextComparison::Mismatch(ContextField::ApprovedPlan)
    );
}
