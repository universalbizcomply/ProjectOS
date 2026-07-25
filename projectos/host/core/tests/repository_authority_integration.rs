//! End-to-end proof of repository authority in the reducer/permit path
//! (CD-B4-REPOSITORY-AUTHORITY-EXECUTION-INTEGRATION1A).
//!
//! GitRepositoryObservation → verify_repository_baseline → VerifiedRepositoryBaseline →
//! ServiceValidatedFacts → fail-closed reducer → VerifiedExecutionContext → ExecutionPermit →
//! pre-use revalidation. A repository-governed operation cannot obtain or retain a permit unless the
//! exact verified baseline satisfies its approved repository policy. Synthetic observations only (no
//! Git, no product repository).

use projectos_host_core::ExecutionPermit;
use projectos_host_core::{
    reduce, verify_repository_baseline, ApprovalOutcome, AuthoritySnapshot, BranchPolicy,
    ContextComparison, ContextField, CredentialOutcome, DenialReason, Disposition,
    DivergencePolicy, EmergencyStateRevision, EmergencyStopState, ExecutableIdentity,
    ExpiryBoundary, GitRepositoryObservation, InstallationId, InternalOperationRecord, MissingFact,
    OperationInputs, PhaseReference, PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision,
    PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId, RepositoryBinding, RepositoryError,
    RepositoryRef, RequiredFreshness, RequiredRepository, ResumePolicy, RevocationRevision,
    RevocationStatus, ServiceValidatedFacts, SessionId, ValidatedEnvironment, ValidatedExecutable,
    ValidatedFreshness, ValidatedInstallation, ValidatedProcess, ValidatedProjectContext,
    ValidatedPublisherPolicy, ValidatedRelease, ValidatedRepositoryFact, ValidatedSession,
    ValidityStatus, VerifiedExecutionContext, VerifiedRepositoryBaseline,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const OID: &str = "0123456789abcdef0123456789abcdef01234567";

fn observation(commit: &str, branch: Option<&str>) -> GitRepositoryObservation {
    GitRepositoryObservation {
        canonical_root: "C:/repo".into(),
        common_dir: "C:/repo/.git".into(),
        is_worktree: true,
        head_oid: commit.into(),
        branch: branch.map(String::from),
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

/// A legitimately-verified baseline (verified against a policy MATCHING the observation), so it can be
/// presented to an operation whose required policy may differ.
fn baseline(commit: &str, branch: Option<&str>) -> VerifiedRepositoryBaseline {
    let mut req = required();
    req.expected_commit = commit.into();
    req.branch_policy = match branch {
        Some(b) => BranchPolicy::Exact(b.into()),
        None => BranchPolicy::AllowDetached,
    };
    verify_repository_baseline(&observation(commit, branch), &req).unwrap()
}

fn governed_record(req: RequiredRepository) -> InternalOperationRecord {
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
    .bind_repository(req);
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

/// Bind a verified baseline to `record` as an operation-bound repository fact.
fn bind_fact(
    record: &InternalOperationRecord,
    baseline: VerifiedRepositoryBaseline,
) -> ValidatedRepositoryFact {
    ValidatedRepositoryFact::bind(
        baseline,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
    )
}

/// Facts whose repository fact is bound to `record` (the common positive path).
fn full_facts(
    record: &InternalOperationRecord,
    repo: Option<VerifiedRepositoryBaseline>,
) -> ServiceValidatedFacts {
    full_facts_with(record, repo.map(|b| bind_fact(record, b)))
}

/// Facts with an EXPLICIT repository fact (which may be bound to a DIFFERENT operation, for cross-binding
/// refusal tests).
fn full_facts_with(
    record: &InternalOperationRecord,
    fact: Option<ValidatedRepositoryFact>,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: fact,
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

fn issued_permit(
    record: &InternalOperationRecord,
    repo: VerifiedRepositoryBaseline,
) -> ExecutionPermit {
    match reduce(&record.to_request(), &full_facts(record, Some(repo))) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    }
}

fn issued_context(
    record: &InternalOperationRecord,
    repo: VerifiedRepositoryBaseline,
) -> VerifiedExecutionContext {
    issued_permit(record, repo).context().clone()
}

/// A repository-governed record varying the operation identity (for cross-binding refusal tests). The
/// required repository policy is `required()` (project "proj") unless overridden by the caller.
#[allow(clippy::too_many_arguments)]
fn record_var(
    op_ref: &str,
    project: &str,
    environment: &str,
    phase_ref: &str,
    base_fp: &str,
    req: RequiredRepository,
) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new(op_ref).unwrap(),
        OperationInputs {
            project: ProjectId::new(project).unwrap(),
            environment: EnvironmentId::new(environment).unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new(base_fp).unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &PhaseReference::new(phase_ref).unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
    .bind_repository(req);
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

// ---- CROSS-BINDING REFUSALS -------------------------------------------------------------------
// A baseline verified for operation A, presented through a fact bound to A, is refused when reduced for
// operation B differing in exactly one binding dimension. Each dimension yields its own distinct refusal.

/// Reduce `reduced` with a repository fact that was bound to `owner`; expect a fact-binding refusal.
fn cross_binding_denial(
    owner: &InternalOperationRecord,
    reduced: &InternalOperationRecord,
) -> Disposition {
    let fact = bind_fact(owner, baseline(OID, Some("main")));
    reduce(&reduced.to_request(), &full_facts_with(reduced, Some(fact)))
}

#[test]
fn a_fact_bound_to_another_project_is_refused() {
    let owner = record_var("op-1", "proj", "staging", "phase-ref", "fp", required());
    let reduced = record_var("op-1", "proj2", "staging", "phase-ref", "fp", required());
    assert_eq!(
        cross_binding_denial(&owner, &reduced),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Project
        ))
    );
}

#[test]
fn a_fact_bound_to_another_environment_is_refused() {
    let owner = record_var("op-1", "proj", "staging", "phase-ref", "fp", required());
    let reduced = record_var("op-1", "proj", "prod", "phase-ref", "fp", required());
    assert_eq!(
        cross_binding_denial(&owner, &reduced),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Environment
        ))
    );
}

#[test]
fn a_fact_bound_to_another_phase_is_refused() {
    let owner = record_var("op-1", "proj", "staging", "phase-ref", "fp", required());
    let reduced = record_var("op-1", "proj", "staging", "phase-ref-2", "fp", required());
    assert_eq!(
        cross_binding_denial(&owner, &reduced),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Phase
        ))
    );
}

#[test]
fn a_fact_bound_to_another_operation_ref_is_refused() {
    // OperationRef is folded into the PhaseId, so a record-level op-ref change also changes the phase.
    // To isolate the Operation binding check, bind the fact with the reduced operation's exact
    // phase/project/environment/fingerprint but a DIFFERENT operation reference.
    let reduced = record_var("op-1", "proj", "staging", "phase-ref", "fp", required());
    let fact = ValidatedRepositoryFact::bind(
        baseline(OID, Some("main")),
        &reduced.binding.project,
        &reduced.binding.environment,
        reduced.binding.phase(),
        reduced.required_plan.as_ref(),
        &OperationRef::new("op-other").unwrap(),
        &reduced.binding.fingerprint,
    );
    assert_eq!(
        reduce(
            &reduced.to_request(),
            &full_facts_with(&reduced, Some(fact))
        ),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Operation
        ))
    );
}

#[test]
fn a_fact_bound_to_another_fingerprint_is_refused() {
    let owner = record_var("op-1", "proj", "staging", "phase-ref", "fp", required());
    let reduced = record_var("op-1", "proj", "staging", "phase-ref", "fp2", required());
    assert_eq!(
        cross_binding_denial(&owner, &reduced),
        Disposition::Denied(DenialReason::RepositoryFactMismatch(
            RepositoryBinding::Fingerprint
        ))
    );
}

// ---- PERMIT REVALIDATION (M22) ----------------------------------------------------------------

#[test]
fn a_permit_is_invalid_at_revalidation_after_a_repository_change() {
    let record = governed_record(required());
    let permit = issued_permit(&record, baseline(OID, Some("main")));
    // The permit revalidates against its own unchanged context.
    assert!(permit.is_valid_for(permit.context()));

    // A freshly observed baseline at a new generation → context differs → the permit is invalid at the
    // permit-revalidation layer (ExecutionPermit::is_valid_for), not only at context construction.
    let mut o = observation(OID, Some("main"));
    o.generation = 2;
    let fresh = verify_repository_baseline(&o, &required()).unwrap();
    let record2 = governed_record(required());
    let ctx2 = issued_context(&record2, fresh);
    assert!(!permit.is_valid_for(&ctx2));
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn a_governed_operation_with_the_exact_baseline_is_eligible() {
    let record = governed_record(required());
    let facts = full_facts(&record, Some(baseline(OID, Some("main"))));
    assert!(matches!(
        reduce(&record.to_request(), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- REFUSAL ----------------------------------------------------------------------------------

#[test]
fn a_missing_repository_fact_denies() {
    let record = governed_record(required());
    assert_eq!(
        reduce(&record.to_request(), &full_facts(&record, None)),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::Repository))
    );
}

#[test]
fn a_wrong_commit_or_branch_baseline_denies_precisely() {
    let record = governed_record(required());
    // Wrong commit.
    let other = "89abcdef0123456789abcdef0123456789abcdef";
    let facts = full_facts(&record, Some(baseline(other, Some("main"))));
    assert_eq!(
        reduce(&record.to_request(), &facts),
        Disposition::Denied(DenialReason::RepositoryPolicyRefused(
            RepositoryError::CommitMismatch
        ))
    );
    // Wrong branch.
    let facts = full_facts(&record, Some(baseline(OID, Some("dev"))));
    assert_eq!(
        reduce(&record.to_request(), &facts),
        Disposition::Denied(DenialReason::RepositoryPolicyRefused(
            RepositoryError::BranchMismatch
        ))
    );
}

#[test]
fn a_cross_project_baseline_denies() {
    // A required policy bound to another project; the baseline (project "proj") does not satisfy it.
    let mut req = required();
    req.expected_project = ProjectId::new("other").unwrap();
    let record = governed_record(req);
    let facts = full_facts(&record, Some(baseline(OID, Some("main"))));
    assert_eq!(
        reduce(&record.to_request(), &facts),
        Disposition::Denied(DenialReason::RepositoryPolicyRefused(
            RepositoryError::ProjectMismatch
        ))
    );
}

// ---- FINGERPRINT SENSITIVITY (M19) ------------------------------------------------------------

#[test]
fn a_different_repository_policy_changes_the_operation_fingerprint() {
    let r1 = governed_record(required());
    let mut req2 = required();
    req2.expected_commit = "89abcdef0123456789abcdef0123456789abcdef".into();
    let r2 = governed_record(req2);
    assert_ne!(r1.binding.fingerprint, r2.binding.fingerprint);

    let mut req3 = required();
    req3.branch_policy = BranchPolicy::AllowDetached;
    let r3 = governed_record(req3);
    assert_ne!(r1.binding.fingerprint, r3.binding.fingerprint);

    let mut req4 = required();
    req4.require_clean = false;
    let r4 = governed_record(req4);
    assert_ne!(r1.binding.fingerprint, r4.binding.fingerprint);
}

// ---- PERMIT INVALIDATION (M20/M21/M22) --------------------------------------------------------

#[test]
fn a_permit_is_invalid_after_the_repository_baseline_changes() {
    let record = governed_record(required());
    let issued = issued_context(&record, baseline(OID, Some("main")));
    assert!(issued.compare(&issued).is_match());

    // A later observation at a NEW generation yields a different baseline → permit invalidated. The
    // generation differs first (RepositoryGeneration), proving generation is compared.
    let mut o = observation(OID, Some("main"));
    o.generation = 2;
    let fresh_same = verify_repository_baseline(&o, &required()).unwrap();
    let record2 = governed_record(required());
    let ctx2 = issued_context(&record2, fresh_same);
    assert_eq!(
        issued.compare(&ctx2),
        ContextComparison::Mismatch(ContextField::RepositoryGeneration)
    );
}

#[test]
fn a_permit_context_is_invalidated_by_a_different_repository_identity_and_baseline() {
    let record = governed_record(required());
    let issued = issued_context(&record, baseline(OID, Some("main")));

    // A baseline over a DIFFERENT root (different identity) — build via a policy/observation whose root
    // differs; the required policy must match so the fact verifies, then compare against the issued.
    let mut o = observation(OID, Some("main"));
    o.canonical_root = "C:/other".into();
    o.common_dir = "C:/other/.git".into();
    o.generation = 1;
    let mut req = required();
    req.expected_root = "C:/other".into();
    let other_baseline = verify_repository_baseline(&o, &req).unwrap();
    let mut record2 = governed_record(req);
    // Align generation so identity is the first differing field.
    record2.state = projectos_host_core::OperationState::ReadyForRevalidation;
    let ctx2 = issued_context(&record2, other_baseline);
    assert_eq!(
        issued.compare(&ctx2),
        ContextComparison::Mismatch(ContextField::RepositoryIdentity)
    );
}

#[test]
fn a_permit_context_is_invalidated_by_a_different_commit_baseline() {
    // Two operations over the SAME root but DIFFERENT required commits each issue a permit; their
    // contexts share identity but differ in baseline content → Mismatch(RepositoryBaseline).
    let record1 = governed_record(required());
    let issued = issued_context(&record1, baseline(OID, Some("main")));

    let other = "89abcdef0123456789abcdef0123456789abcdef";
    let mut req2 = required();
    req2.expected_commit = other.into();
    let record2 = governed_record(req2);
    let ctx2 = issued_context(&record2, baseline(other, Some("main")));

    assert_eq!(
        issued.compare(&ctx2),
        ContextComparison::Mismatch(ContextField::RepositoryBaseline)
    );
}

// ---- REDACTION --------------------------------------------------------------------------------

#[test]
fn no_repository_path_or_oid_leaks_in_the_context() {
    let record = governed_record(required());
    let ctx = issued_context(&record, baseline(OID, Some("main")));
    let rendered = format!("{ctx:?}");
    assert!(!rendered.contains("C:/repo"));
    assert!(!rendered.contains(OID));
}
