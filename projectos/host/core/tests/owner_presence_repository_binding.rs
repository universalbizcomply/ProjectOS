//! Proof that an owner-presence fact is bound to the repository's actual VALIDATED AUTHORITY STATE
//! (baseline content + generation), not merely its identity — so it cannot be replayed after the SAME
//! repository changes state (CD-B4-OWNER-PRESENCE-TEMPORAL-BASELINE-BINDING-AMENDMENT1A, Blocker B).

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    reduce, verify_owner_presence, verify_repository_baseline, ApprovalOutcome, AuthoritySnapshot,
    BranchPolicy, ContextComparison, ContextField, CredentialOutcome, DenialReason, Disposition,
    DivergencePolicy, EmergencyStateRevision, EmergencyStopState, ExecutableIdentity,
    ExpiryBoundary, FixtureClock, GitRepositoryObservation, InstallationId,
    InternalOperationRecord, OperationInputs, OwnerPresenceBinding, OwnerPresenceObservation,
    PhaseReference, PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision, PublisherIdentity,
    RecordPolicy, ReleaseFloor, ReleaseId, RepositoryRef, RequiredFreshness, RequiredOwnerPresence,
    RequiredRepository, ResumePolicy, RevocationRevision, RevocationStatus, ServiceValidatedFacts,
    SessionId, TrustedClock, ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness,
    ValidatedInstallation, ValidatedOwnerPresenceFact, ValidatedProcess, ValidatedProjectContext,
    ValidatedPublisherPolicy, ValidatedRelease, ValidatedRepositoryFact, ValidatedSession,
    ValidityStatus, VerifiedRepositoryBaseline,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
const OID_B: &str = "89abcdef0123456789abcdef0123456789abcdef";

fn clock() -> FixtureClock {
    FixtureClock::new(150)
}

fn presence(clock: &FixtureClock) -> projectos_host_core::VerifiedOwnerPresence {
    let r = RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: 5,
    };
    verify_owner_presence(
        &OwnerPresenceObservation {
            proof_id: "proof-1".into(),
            verifier: "hello".into(),
            observed_at: 100,
            valid_until: 200,
            generation: 5,
        },
        &r,
        &clock.read_current(),
    )
    .unwrap()
}

fn required_presence() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: 5,
    }
}

fn repo_required(root: &str, commit: &str) -> RequiredRepository {
    RequiredRepository {
        expected_root: root.into(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: commit.into(),
        branch_policy: BranchPolicy::Exact("main".into()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    }
}

fn repo_baseline(root: &str, commit: &str, gen: u64) -> VerifiedRepositoryBaseline {
    let obs = GitRepositoryObservation {
        canonical_root: root.into(),
        common_dir: format!("{root}/.git"),
        is_worktree: true,
        head_oid: commit.into(),
        branch: Some("main".into()),
        staged: 0,
        unstaged: 0,
        untracked: 0,
        tracking_present: false,
        ahead: None,
        behind: None,
        submodule_dirty: false,
        generation: gen,
    };
    verify_repository_baseline(&obs, &repo_required(root, commit)).unwrap()
}

/// An operation governed by BOTH a repository policy (root/commit) and owner presence.
fn op(root: &str, commit: &str) -> InternalOperationRecord {
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
    .bind_repository(repo_required(root, commit))
    .bind_owner_presence(required_presence());
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

/// A repository fact bound to `op` carrying the given baseline state.
fn repo_fact(
    op: &InternalOperationRecord,
    root: &str,
    commit: &str,
    gen: u64,
) -> ValidatedRepositoryFact {
    ValidatedRepositoryFact::bind(
        repo_baseline(root, commit, gen),
        &op.binding.project,
        &op.binding.environment,
        op.binding.phase(),
        op.required_plan.as_ref(),
        &op.operation_ref,
        &op.binding.fingerprint,
    )
}

/// An owner-presence fact bound to `op` and the given repository state.
fn op_fact(
    op: &InternalOperationRecord,
    repo: &ValidatedRepositoryFact,
    clock: &FixtureClock,
) -> ValidatedOwnerPresenceFact {
    ValidatedOwnerPresenceFact::bind(
        presence(clock),
        &op.binding.project,
        &op.binding.environment,
        op.binding.phase(),
        op.required_plan.as_ref(),
        &op.operation_ref,
        &op.binding.fingerprint,
        Some(repo),
    )
}

fn facts(
    op: &InternalOperationRecord,
    repo: ValidatedRepositoryFact,
    presence_fact: ValidatedOwnerPresenceFact,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(op.binding.phase().clone()),
        approved_plan: None,
        repository: Some(repo),
        owner_presence: Some(presence_fact),
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

// R1: presence bound to baseline A, current repo fact A → eligible.
#[test]
fn r1_presence_bound_to_the_current_repository_state_is_eligible() {
    let clk = clock();
    let o = op("C:/repo", OID_A);
    let cur = repo_fact(&o, "C:/repo", OID_A, 1);
    let pf = op_fact(&o, &repo_fact(&o, "C:/repo", OID_A, 1), &clk);
    assert!(matches!(
        reduce(&o.to_request_with_clock(&clk), &facts(&o, cur, pf)),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// R2/R4: presence bound to baseline A, current repo fact B (SAME identity, different commit) → refused.
#[test]
fn r2_same_repository_different_baseline_is_refused() {
    let clk = clock();
    let o = op("C:/repo", OID_B); // operation governed by commit B; current repo fact satisfies B
    let old_presence = op_fact(&o, &repo_fact(&o, "C:/repo", OID_A, 1), &clk); // bound to baseline A
    let cur_b = repo_fact(&o, "C:/repo", OID_B, 1);
    assert_eq!(
        reduce(
            &o.to_request_with_clock(&clk),
            &facts(&o, cur_b, old_presence)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::RepositoryBaseline
        ))
    );
}

// R3: same baseline, different generation → refused (generation is authoritative in the binding).
#[test]
fn r3_same_baseline_different_generation_is_refused() {
    let clk = clock();
    let o = op("C:/repo", OID_A);
    let old_presence = op_fact(&o, &repo_fact(&o, "C:/repo", OID_A, 1), &clk); // gen 1
    let cur = repo_fact(&o, "C:/repo", OID_A, 2); // gen 2
    assert_eq!(
        reduce(
            &o.to_request_with_clock(&clk),
            &facts(&o, cur, old_presence)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::RepositoryBaseline
        ))
    );
}

// R6: cross-repository identity substitution → refused.
#[test]
fn r6_cross_repository_identity_is_refused() {
    let clk = clock();
    let o = op("C:/repo", OID_A);
    // owner-presence fact bound to a DIFFERENT repository root (different identity).
    let foreign = ValidatedRepositoryFact::bind(
        repo_baseline("C:/other", OID_A, 1),
        &o.binding.project,
        &o.binding.environment,
        o.binding.phase(),
        o.required_plan.as_ref(),
        &o.operation_ref,
        &o.binding.fingerprint,
    );
    let old_presence = op_fact(&o, &foreign, &clk);
    let cur = repo_fact(&o, "C:/repo", OID_A, 1);
    assert_eq!(
        reduce(
            &o.to_request_with_clock(&clk),
            &facts(&o, cur, old_presence)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::RepositoryBaseline
        ))
    );
}

// R5: a permit minted under repository A is invalid under repository B (repository context field).
#[test]
fn r5_a_permit_minted_under_repository_a_is_invalid_under_repository_b() {
    let clk = clock();
    let oa = op("C:/repo", OID_A);
    let permit = match reduce(
        &oa.to_request_with_clock(&clk),
        &facts(
            &oa,
            repo_fact(&oa, "C:/repo", OID_A, 1),
            op_fact(&oa, &repo_fact(&oa, "C:/repo", OID_A, 1), &clk),
        ),
    ) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    };
    let ob = op("C:/repo", OID_B);
    let ctx_b = match reduce(
        &ob.to_request_with_clock(&clk),
        &facts(
            &ob,
            repo_fact(&ob, "C:/repo", OID_B, 1),
            op_fact(&ob, &repo_fact(&ob, "C:/repo", OID_B, 1), &clk),
        ),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert!(!permit.is_valid_for(&ctx_b));
    assert_eq!(
        permit.compare_context(&ctx_b),
        ContextComparison::Mismatch(ContextField::RepositoryBaseline)
    );
}
