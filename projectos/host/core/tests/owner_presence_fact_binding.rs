//! Owner-presence fact-binding refusals that need the `test-fixtures` surface: the approved-plan
//! journal (plan cross-binding) and the fact's cached-scalar test mutators (fact↔proof
//! generation/valid_until consistency). Gated on `test-fixtures`; a production graph never builds these.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_lines)]

use projectos_host_core::{
    reduce, verify_owner_presence, ApprovalOutcome, ApprovedPlanJournal, ApprovedPlanStatus,
    AuthoritySnapshot, CredentialOutcome, DenialReason, Disposition, EffectPolicy,
    EmergencyStateRevision, EmergencyStopState, ExecutableIdentity, ExpiryBoundary, FixtureClock,
    InstallationId, InternalOperationRecord, OperationInputs, OwnerPresenceBinding,
    OwnerPresenceObservation, PhaseDefinitionCandidate, PhaseType, PolicyFloor, PolicyId,
    PolicyOutcome, PolicyRevision, ProviderPolicy, PublisherIdentity, RecordPolicy, ReleaseFloor,
    ReleaseId, RepositoryPolicy, RepositoryRef, RequestedOperationPolicy, RequiredOwnerPresence,
    ResidueRequirement, ResumePolicy, RevocationRevision, RevocationStatus, ServiceValidatedFacts,
    SessionId, TrustedClock, ValidatedApprovedPlan, ValidatedEnvironment, ValidatedExecutable,
    ValidatedFreshness, ValidatedInstallation, ValidatedOwnerPresenceFact, ValidatedProcess,
    ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease, ValidatedSession,
    ValidityStatus, VerifiedOwnerPresence,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

fn required_presence() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: 5,
    }
}

fn presence(clock: &FixtureClock) -> VerifiedOwnerPresence {
    let obs = OwnerPresenceObservation {
        proof_id: "proof-1".into(),
        verifier: "hello".into(),
        observed_at: 100,
        valid_until: 200,
        generation: 5,
    };
    verify_owner_presence(&obs, &required_presence(), &clock.read_current()).unwrap()
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

fn active_plan() -> ValidatedApprovedPlan {
    ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
    )
}

fn record(
    plan: Option<(&ValidatedApprovedPlan, RequestedOperationPolicy)>,
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
        &projectos_host_core::PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    );
    if let Some((fact, policy)) = plan {
        r = r.bind_approved_plan(fact, policy);
    }
    r = r.bind_owner_presence(required_presence());
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn bind_fact(record: &InternalOperationRecord, clock: &FixtureClock) -> ValidatedOwnerPresenceFact {
    ValidatedOwnerPresenceFact::bind(
        presence(clock),
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        None,
    )
}

fn full_facts(
    record: &InternalOperationRecord,
    fact: ValidatedOwnerPresenceFact,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: None,
        owner_presence: Some(fact),
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
    let clock = FixtureClock::new(100);
    let plan = active_plan();
    let plan_owner = record(Some((&plan, conforming_policy())));
    let fact = bind_fact(&plan_owner, &clock);
    let reduced = record(None);
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock(&clock),
            &full_facts(&reduced, fact)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Plan
        ))
    );
}

#[test]
fn a_fact_whose_cached_generation_diverges_from_its_proof_is_refused() {
    let clock = FixtureClock::new(100);
    let reduced = record(None);
    let bad = bind_fact(&reduced, &clock).with_generation_for_test(999);
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock(&clock),
            &full_facts(&reduced, bad)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Generation
        ))
    );
}

#[test]
fn a_fact_whose_cached_valid_until_diverges_from_its_proof_is_refused() {
    let clock = FixtureClock::new(100);
    let reduced = record(None);
    let bad = bind_fact(&reduced, &clock).with_valid_until_for_test(999);
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock(&clock),
            &full_facts(&reduced, bad)
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::ValidUntil
        ))
    );
}

#[test]
fn the_exact_fact_is_eligible() {
    let clock = FixtureClock::new(100);
    let reduced = record(None);
    let fact = bind_fact(&reduced, &clock);
    assert!(matches!(
        reduce(
            &reduced.to_request_with_clock(&clock),
            &full_facts(&reduced, fact)
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}
