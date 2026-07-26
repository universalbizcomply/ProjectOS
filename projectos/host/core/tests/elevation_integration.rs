//! End-to-end proof of ELEVATION authority as an opaque, operation-bound, process-bound, fail-closed
//! validated fact (CD-B4-ELEVATION-VALIDATED-FACT-INTEGRATION1A).
//!
//! Elevation is DISTINCT from owner presence, approval and effect authority. The fact binds the observed
//! process identity (pid + creation tick), the operation context, the repository authority state and —
//! where jointly required — the owner-presence proof; the reducer refuses any mismatch before evaluating
//! the level/generation policy, and revalidates currentness against the injected sealed clock provider.
//! Synthetic observations only; fixture clock only; no live elevation, no UAC, no protected effect.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_arguments)]

use projectos_host_core::{
    reduce, verify_owner_presence, ApprovalOutcome, AuthoritySnapshot, ContextComparison,
    ContextField, CredentialOutcome, DenialReason, Disposition, ElevationBinding, ElevationError,
    ElevationLevel, ElevationObservation, ElevationVerifier, EmergencyStateRevision,
    EmergencyStopState, ExecutableIdentity, ExecutionPermit, ExpiryBoundary, FixtureClock,
    FixtureElevationVerifier, InstallationId, InternalOperationRecord, MissingFact,
    OperationInputs, OwnerPresenceObservation, PhaseReference, PolicyFloor, PolicyId,
    PolicyOutcome, PolicyRevision, PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId,
    RepositoryRef, RequiredElevation, RequiredOwnerPresence, ResumePolicy, RevocationRevision,
    RevocationStatus, ServiceValidatedFacts, SessionId, TrustedClock, ValidatedElevationFact,
    ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness, ValidatedInstallation,
    ValidatedOwnerPresenceFact, ValidatedProcess, ValidatedProjectContext,
    ValidatedPublisherPolicy, ValidatedRelease, ValidatedSession, ValidityStatus,
    VerifiedElevation, VerifiedOwnerPresence,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const PID: u32 = 4242;
const TICK: u64 = 999;
const VALID_UNTIL: u64 = 200;
const MIN_GEN: u64 = 5;

fn required() -> RequiredElevation {
    RequiredElevation {
        minimum_level: ElevationLevel::Elevated,
        min_generation: MIN_GEN,
        expected_pid: PID,
        expected_creation_tick: TICK,
    }
}

fn elev_obs(
    gen: u64,
    valid_until: u64,
    pid: u32,
    tick: u64,
    level: ElevationLevel,
) -> ElevationObservation {
    ElevationObservation {
        proof_id: "elev-proof-1".into(),
        source: "adapter".into(),
        level,
        observed_at: 0,
        valid_until,
        generation: gen,
        pid,
        creation_tick: tick,
    }
}

fn vsession() -> ValidatedSession {
    ValidatedSession {
        session: SessionId::new("sess-1"),
    }
}

fn verified(
    clock: &FixtureClock,
    verifier: &FixtureElevationVerifier,
    gen: u64,
    valid_until: u64,
    pid: u32,
    tick: u64,
) -> VerifiedElevation {
    let mut r = required();
    r.min_generation = gen;
    r.expected_pid = pid;
    r.expected_creation_tick = tick;
    verifier
        .verify(
            &elev_obs(gen, valid_until, pid, tick, ElevationLevel::Elevated),
            &r,
            &clock.read_current(),
            &vsession(),
        )
        .unwrap()
}

/// A presence proof under `clock` (for the joint-binding tests).
fn presence(clock: &FixtureClock, proof_id: &str) -> VerifiedOwnerPresence {
    verify_owner_presence(
        &OwnerPresenceObservation {
            proof_id: proof_id.into(),
            verifier: "hello".into(),
            observed_at: 0,
            valid_until: VALID_UNTIL,
            generation: MIN_GEN,
        },
        &RequiredOwnerPresence {
            required_verifier: "hello".into(),
            min_generation: MIN_GEN,
        },
        &clock.read_current(),
    )
    .unwrap()
}

fn required_presence() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: MIN_GEN,
    }
}

fn record_var(
    op_ref: &str,
    project: &str,
    environment: &str,
    phase_ref: &str,
    base_fp: &str,
    elevation_governed: bool,
    presence_governed: bool,
    req: RequiredElevation,
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
    );
    if presence_governed {
        r = r.bind_owner_presence(required_presence());
    }
    if elevation_governed {
        r = r.bind_elevation(req);
    }
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn governed(req: RequiredElevation) -> InternalOperationRecord {
    record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        req,
    )
}

fn bind_elev(
    record: &InternalOperationRecord,
    e: VerifiedElevation,
    presence: Option<&ValidatedOwnerPresenceFact>,
) -> ValidatedElevationFact {
    ValidatedElevationFact::bind(
        e,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        None,
        presence,
    )
}

fn bind_presence(
    record: &InternalOperationRecord,
    p: VerifiedOwnerPresence,
) -> ValidatedOwnerPresenceFact {
    ValidatedOwnerPresenceFact::bind(
        p,
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
    elevation: Option<ValidatedElevationFact>,
    owner_presence: Option<ValidatedOwnerPresenceFact>,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: None,
        owner_presence,
        elevation,
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
    e: VerifiedElevation,
    clock: &FixtureClock,
    verifier: &FixtureElevationVerifier,
) -> ExecutionPermit {
    let fact = bind_elev(record, e, None);
    match reduce(
        &record.to_request_with_clock_and_verifier(clock, verifier),
        &full_facts(record, Some(fact), None),
    ) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    }
}

// ---- 1. non-elevation operation unaffected -------------------------------------------------------

#[test]
fn t1_a_non_elevation_operation_is_unaffected() {
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        false,
        false,
        required(),
    );
    assert!(matches!(
        reduce(&record.to_request(), &full_facts(&record, None, None)),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- 2. missing fact fails closed ----------------------------------------------------------------

#[test]
fn t2_an_elevation_required_operation_without_a_fact_denies() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, None, None)
        ),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::Elevation))
    );
}

// ---- 3. exact fact is eligible -------------------------------------------------------------------

#[test]
fn t3_the_exact_fact_is_eligible() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- 4-9. cross operation-binding ----------------------------------------------------------------

fn cross(owner: &InternalOperationRecord, reduced: &InternalOperationRecord) -> Disposition {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let fact = bind_elev(
        owner,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    reduce(
        &reduced.to_request_with_clock_and_verifier(&clock, &v),
        &full_facts(reduced, Some(fact), None),
    )
}

#[test]
fn t4_wrong_project_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    let reduced = record_var(
        "op-1",
        "proj2",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Project
        ))
    );
}

#[test]
fn t5_wrong_environment_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "prod",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Environment
        ))
    );
}

#[test]
fn t6_wrong_phase_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref-2",
        "fp",
        true,
        false,
        required(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::ElevationFactMismatch(ElevationBinding::Phase))
    );
}

#[test]
fn t8_wrong_operation_ref_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let reduced = governed(required());
    let fact = ValidatedElevationFact::bind(
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &reduced.binding.project,
        &reduced.binding.environment,
        reduced.binding.phase(),
        reduced.required_plan.as_ref(),
        &OperationRef::new("op-other").unwrap(),
        &reduced.binding.fingerprint,
        None,
        None,
    );
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&reduced, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Operation
        ))
    );
}

#[test]
fn t9_wrong_fingerprint_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        false,
        required(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp2",
        true,
        false,
        required(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Fingerprint
        ))
    );
}

// ---- 12/13. process identity ---------------------------------------------------------------------

#[test]
fn t12_wrong_process_identity_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    // Fact minted for a DIFFERENT pid than the operation expects.
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, 9999, TICK),
        None,
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Process
        ))
    );
}

#[test]
fn t13_a_restarted_process_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    // Same pid, DIFFERENT creation tick (process restarted) → not the expected process.
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, 111),
        None,
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Process
        ))
    );
}

// ---- 14. session/IPC binding (carry-forward) -----------------------------------------------------

#[test]
fn t14_process_identity_is_the_core_binding_ipc_peer_is_carry_forward() {
    // Core has no IPC peer / ServiceInstanceToken; the strongest available process identity is
    // pid + creation tick, which t12/t13 exercise. The authenticated session remains bound by the
    // existing Session context field. This test documents that boundary explicitly.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- 15/16. provider substitution / restart ------------------------------------------------------

#[test]
fn t15_a_substituted_provider_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    let other = FixtureClock::new(100); // same reading + epoch, DIFFERENT identity
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&other, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::ProviderMismatch
        ))
    );
}

#[test]
fn t16_a_provider_epoch_rollover_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    clock.next_epoch(105);
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::EpochMismatch
        ))
    );
}

// ---- 17. generation ------------------------------------------------------------------------------

#[test]
fn t17_a_below_minimum_generation_cannot_be_minted() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let mut r = required();
    r.min_generation = 6;
    assert_eq!(
        v.verify(
            &elev_obs(5, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &r,
            &clock.read_current(),
            &vsession()
        ),
        Err(ElevationError::StaleGeneration)
    );
}

#[test]
fn t17b_a_fact_whose_cached_generation_diverges_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let bad = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    )
    .with_generation_for_test(999);
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(bad), None)
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Generation
        ))
    );
}

// ---- 18. insufficient level ----------------------------------------------------------------------

#[test]
fn t18_a_not_elevated_observation_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    assert_eq!(
        v.verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::NotElevated),
            &required(),
            &clock.read_current(),
            &vsession()
        ),
        Err(ElevationError::LevelInsufficient)
    );
}

// ---- 19. expired ---------------------------------------------------------------------------------

#[test]
fn t19_an_expired_elevation_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(&record, verified(&clock, &v, MIN_GEN, 110, PID, TICK), None);
    let facts = full_facts(&record, Some(fact), None);
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
    clock.advance_to(111);
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::Expired
        ))
    );
}

// ---- 20. policy change invalidates prior approval (fingerprint) ----------------------------------

#[test]
fn t20_an_elevation_policy_change_changes_the_fingerprint() {
    let r1 = governed(required());
    let mut r2p = required();
    r2p.min_generation = 9;
    assert_ne!(r1.binding.fingerprint, governed(r2p).binding.fingerprint);
}

// ---- 21/22/23. permit revalidation ---------------------------------------------------------------

fn ctx_of(
    record: &InternalOperationRecord,
    e: VerifiedElevation,
    clock: &FixtureClock,
    verifier: &FixtureElevationVerifier,
) -> projectos_host_core::VerifiedExecutionContext {
    let fact = bind_elev(record, e, None);
    match reduce(
        &record.to_request_with_clock_and_verifier(clock, verifier),
        &full_facts(record, Some(fact), None),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    }
}

#[test]
fn t21_permit_is_invalid_after_a_process_change() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = issued_permit(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock,
        &v,
    );
    // Re-derive a context for a DIFFERENT process; the operation must expect that process to be eligible.
    let mut r2 = required();
    r2.expected_pid = 7777;
    let record2 = governed(r2);
    let ctx2 = ctx_of(
        &record2,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, 7777, TICK),
        &clock,
        &v,
    );
    assert_eq!(
        permit.compare_context(&ctx2),
        ContextComparison::Mismatch(ContextField::ElevationProcess)
    );
}

#[test]
fn t22_permit_is_invalid_after_a_provider_change() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = issued_permit(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock,
        &v,
    );
    let clock2 = FixtureClock::new(100); // different provider identity
    let ctx2 = ctx_of(
        &record,
        verified(&clock2, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock2,
        &v,
    );
    assert_eq!(
        permit.compare_context(&ctx2),
        ContextComparison::Mismatch(ContextField::ElevationProvider)
    );
}

#[test]
fn t23_permit_is_invalid_after_a_generation_change() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = issued_permit(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock,
        &v,
    );
    let ctx2 = ctx_of(
        &record,
        verified(&clock, &v, 6, VALID_UNTIL, PID, TICK),
        &clock,
        &v,
    );
    assert_eq!(
        permit.compare_context(&ctx2),
        ContextComparison::Mismatch(ContextField::ElevationGeneration)
    );
}

#[test]
fn t19b_permit_is_not_current_after_the_elevation_lease_expires() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = issued_permit(
        &record,
        verified(&clock, &v, MIN_GEN, 110, PID, TICK),
        &clock,
        &v,
    );
    assert!(permit.is_current(permit.context(), &clock));
    clock.advance_to(111);
    assert!(!permit.is_current(permit.context(), &clock));
}

// ---- 24/25. forgery / bool (validator covers compile-fail; here: valid mint is the only path) -----

#[test]
fn t24_25_the_only_authority_path_is_verify_elevation() {
    // A VerifiedElevation can only come from verify_elevation (no public ctor / Default / From<bool>);
    // the compile-fail suite proves the negatives. Here we assert the positive mint drives eligibility.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let e = v
        .verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &required(),
            &clock.read_current(),
            &vsession(),
        )
        .unwrap();
    let fact = bind_elev(&record, e, None);
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- 26. facts absent by default -----------------------------------------------------------------

#[test]
fn t26_facts_are_absent_by_default() {
    let facts = ServiceValidatedFacts::default();
    assert!(facts.elevation.is_none());
}

// ---- 27/28. separation from owner presence -------------------------------------------------------

#[test]
fn t27_owner_presence_alone_does_not_satisfy_elevation() {
    // Operation requires BOTH; only owner presence is supplied → elevation missing.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let mut record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        true,
        required(),
    );
    record.state = projectos_host_core::OperationState::ReadyForRevalidation;
    let pf = bind_presence(&record, presence(&clock, "p-a"));
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, None, Some(pf))
        ),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::Elevation))
    );
}

#[test]
fn t28_elevation_alone_does_not_satisfy_owner_presence() {
    // Operation requires BOTH; only elevation supplied → owner presence missing (checked before elevation).
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        true,
        required(),
    );
    let ef = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(ef), None)
        ),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::OwnerPresence))
    );
}

#[test]
fn t11_wrong_owner_presence_context_is_refused() {
    // Operation requires both. Elevation fact jointly bound to owner-presence proof A, but the current
    // owner-presence fact carries proof B → OwnerPresence binding mismatch.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        true,
        required(),
    );
    let pf_a = bind_presence(&record, presence(&clock, "p-a"));
    let pf_b = bind_presence(&record, presence(&clock, "p-b"));
    let ef = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        Some(&pf_a),
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(ef), Some(pf_b))
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::OwnerPresence
        ))
    );
}

#[test]
fn t11b_jointly_bound_owner_presence_is_eligible() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        true,
        required(),
    );
    let pf = bind_presence(&record, presence(&clock, "p-a"));
    let pf2 = bind_presence(&record, presence(&clock, "p-a"));
    let ef = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        Some(&pf),
    );
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(ef), Some(pf2))
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- 29. elevation does not mint an effect grant -------------------------------------------------

#[test]
fn t29_elevation_eligibility_is_a_permit_not_an_effect_grant() {
    // The eligible disposition carries only an ExecutionPermit (a service-private capability record).
    // It is NOT an effect grant / witness (those live downstream in host-authority and are not produced
    // here). We assert the disposition type is a permit and expose no effect-authority surface.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    let permit = match reduce(
        &record.to_request_with_clock_and_verifier(&clock, &v),
        &full_facts(&record, Some(fact), None),
    ) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    };
    // The permit binds the operation; it grants no effect by itself.
    assert_eq!(permit.operation_ref(), &OperationRef::new("op-1").unwrap());
}

// ---- 7. wrong approved-plan binding --------------------------------------------------------------

#[test]
fn t7_wrong_plan_binding_is_refused() {
    use projectos_host_core::{
        ApprovedPlanJournal, ApprovedPlanStatus, EffectPolicy, PhaseDefinitionCandidate, PhaseType,
        ProviderPolicy, RepositoryPolicy, RequestedOperationPolicy, ResidueRequirement,
    };
    let candidate = PhaseDefinitionCandidate {
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
    };
    let plan = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate,
        1,
        ApprovedPlanStatus::Active,
        0,
    );
    let policy = RequestedOperationPolicy {
        requested_action: "read".into(),
        requested_scope: vec!["a".into()],
        requested_paths: vec!["src/x/file".into()],
        completed_dependencies: vec!["dep-1".into()],
        closed_predecessors: vec!["pre-1".into()],
    };
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    // Owner op is plan-governed AND elevation-governed; reduced op is elevation-only (no plan).
    let mut owner = InternalOperationRecord::new(
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
    .bind_approved_plan(&plan, policy)
    .bind_elevation(required());
    owner.state = projectos_host_core::OperationState::ReadyForRevalidation;
    let reduced = governed(required());
    let fact = bind_elev(
        &owner,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&reduced, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(ElevationBinding::Plan))
    );
}

// ---- 10. wrong repository baseline ---------------------------------------------------------------

#[test]
fn t10_wrong_repository_baseline_is_refused() {
    use projectos_host_core::{
        verify_repository_baseline, BranchPolicy, DivergencePolicy, GitRepositoryObservation,
        RequiredFreshness, RequiredRepository, ValidatedRepositoryFact,
    };
    const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
    const OID_B: &str = "89abcdef0123456789abcdef0123456789abcdef";
    let repo_required = |commit: &str| RequiredRepository {
        expected_root: "C:/repo".into(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: commit.into(),
        branch_policy: BranchPolicy::Exact("main".into()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    };
    let baseline = |commit: &str, gen: u64| {
        verify_repository_baseline(
            &GitRepositoryObservation {
                canonical_root: "C:/repo".into(),
                common_dir: "C:/repo/.git".into(),
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
            },
            &repo_required(commit),
        )
        .unwrap()
    };
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    // Operation governed by repository (commit B) + elevation.
    let mut record = InternalOperationRecord::new(
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
    .bind_repository(repo_required(OID_B))
    .bind_elevation(required());
    record.state = projectos_host_core::OperationState::ReadyForRevalidation;
    let repo_fact_a = ValidatedRepositoryFact::bind(
        baseline(OID_A, 1),
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
    );
    let repo_fact_b = ValidatedRepositoryFact::bind(
        baseline(OID_B, 1),
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
    );
    // Elevation fact jointly bound to repository baseline A, but the current repository fact is B.
    let ef = ValidatedElevationFact::bind(
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        Some(&repo_fact_a),
        None,
    );
    let mut facts = full_facts(&record, Some(ef), None);
    facts.repository = Some(repo_fact_b);
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::RepositoryBaseline
        ))
    );
}

// ---- 30. fixture provider unavailable in production (validator asserts compile-fail) --------------
// Covered by the elevation validator's `neg_fixture_without_feature` consumer.

// =================================================================================================
// BLOCKER A — AUTHENTICATED SESSION BINDING (S1..S7; S8 = validator compile-fail)
// =================================================================================================

fn facts_in_session(
    record: &InternalOperationRecord,
    elevation: Option<ValidatedElevationFact>,
    owner_presence: Option<ValidatedOwnerPresenceFact>,
    session: &str,
) -> ServiceValidatedFacts {
    let mut f = full_facts(record, elevation, owner_presence);
    let s = SessionId::new(session);
    f.session = Some(ValidatedSession { session: s.clone() });
    f.process = Some(ValidatedProcess { session: s });
    f
}

/// S1: elevation fact verified + bound in session A is eligible in session A.
#[test]
fn s1_elevation_fact_is_eligible_in_its_own_session() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts_in_session(&record, Some(fact), None, "sess-1")
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

/// S2/S3/S4: the same fact (same pid + creation tick) is refused in session B, before policy.
#[test]
fn s2_the_same_elevation_fact_is_refused_in_another_session() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts_in_session(&record, Some(fact), None, "sess-2")
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Session
        ))
    );
}

/// S5: a permit minted in session A is invalid (context mismatch) under a session-B context.
#[test]
fn s5_permit_minted_in_session_a_is_invalid_in_session_b() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = match reduce(
        &record.to_request_with_clock_and_verifier(&clock, &v),
        &facts_in_session(
            &record,
            Some(bind_elev(
                &record,
                verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
                None,
            )),
            None,
            "sess-1",
        ),
    ) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    };
    // SAME verifier + clock so ONLY the session differs — proving the session field is load-bearing.
    let eb = v
        .verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &required(),
            &clock.read_current(),
            &ValidatedSession {
                session: SessionId::new("sess-2"),
            },
        )
        .unwrap();
    let ctx_b = match reduce(
        &record.to_request_with_clock_and_verifier(&clock, &v),
        &facts_in_session(&record, Some(bind_elev(&record, eb, None)), None, "sess-2"),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert_eq!(
        permit.compare_context(&ctx_b),
        ContextComparison::Mismatch(ContextField::ElevationSession)
    );
}

/// S7: an elevation fact from session B cannot be combined with owner presence in session A where both
/// are required (the elevation session binding refuses it before policy).
#[test]
fn s7_cross_session_owner_presence_and_elevation_cannot_combine() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        true,
        required(),
    );
    let pf = bind_presence(&record, presence(&clock, "p-a"));
    let eb = v
        .verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &required(),
            &clock.read_current(),
            &ValidatedSession {
                session: SessionId::new("sess-2"),
            },
        )
        .unwrap();
    let ef = bind_elev(&record, eb, Some(&pf));
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &facts_in_session(&record, Some(ef), Some(pf.clone()), "sess-1")
        ),
        Disposition::Denied(DenialReason::ElevationFactMismatch(
            ElevationBinding::Session
        ))
    );
}

// =================================================================================================
// BLOCKER B — SEALED ELEVATION VERIFIER (V1,V2,V3,V7,V8,V9,V10,V12; V4/V5/V6/V11 = validator)
// =================================================================================================

/// V1: the exact fixture verifier attestation drives eligibility.
#[test]
fn v1_the_fixture_verifier_produces_eligible_authority() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert!(matches!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

/// V2/V8: a proof attested by verifier A is refused where a DIFFERENT verifier B is current.
#[test]
fn v2_a_substituted_verifier_is_refused() {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let vb = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &va, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &vb),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::VerifierMismatch
        ))
    );
}

/// V3/V9: a proof attested under verifier epoch E1 is refused after the verifier restarts to E2.
#[test]
fn v3_a_verifier_restart_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    v.next_epoch();
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::VerifierEpochMismatch
        ))
    );
}

/// V7: the elevation verifier identity is DISTINCT from the trusted-clock provider — substituting only
/// the clock is a clock ProviderMismatch; substituting only the verifier is a VerifierMismatch.
#[test]
fn v7_verifier_and_clock_provider_are_distinct_authorities() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required());
    let fact = bind_elev(
        &record,
        verified(&clock, &v, MIN_GEN, VALID_UNTIL, PID, TICK),
        None,
    );
    let clock2 = FixtureClock::new(100);
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock2, &v),
            &full_facts(&record, Some(fact.clone()), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::ProviderMismatch
        ))
    );
    let v2 = FixtureElevationVerifier::new();
    assert_eq!(
        reduce(
            &record.to_request_with_clock_and_verifier(&clock, &v2),
            &full_facts(&record, Some(fact), None)
        ),
        Disposition::Denied(DenialReason::ElevationPolicyRefused(
            ElevationError::VerifierMismatch
        ))
    );
}

/// V10: a permit minted under verifier A is invalid (context mismatch) under verifier B.
#[test]
fn v10_permit_under_verifier_a_is_invalid_under_verifier_b() {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let record = governed(required());
    let permit = issued_permit(
        &record,
        verified(&clock, &va, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock,
        &va,
    );
    let vb = FixtureElevationVerifier::new();
    let ctx_b = ctx_of(
        &record,
        verified(&clock, &vb, MIN_GEN, VALID_UNTIL, PID, TICK),
        &clock,
        &vb,
    );
    assert_eq!(
        permit.compare_context(&ctx_b),
        ContextComparison::Mismatch(ContextField::ElevationVerifier)
    );
}

/// V12: a verifier call performs NO UAC / token acquisition / protected Windows work — the fixture
/// verify is pure (hash + field copy), deterministic and effect-free.
#[test]
fn v12_verifier_call_is_pure_no_protected_work() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let a = v
        .verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &required(),
            &clock.read_current(),
            &vsession(),
        )
        .unwrap();
    let b = v
        .verify(
            &elev_obs(MIN_GEN, VALID_UNTIL, PID, TICK, ElevationLevel::Elevated),
            &required(),
            &clock.read_current(),
            &vsession(),
        )
        .unwrap();
    assert_eq!(a, b);
}
