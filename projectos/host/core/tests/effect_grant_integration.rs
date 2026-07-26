//! End-to-end proof of the PERMIT → BOUNDED-EFFECT-GRANT → SYNTHETIC-EFFECT → EFFECT-WITNESS boundary
//! with single-ISSUANCE, canonical lease bound, execution-time currentness and rollback policy
//! (CD-B4-PERMIT-TO-EFFECT-GRANT-ISSUANCE-CURRENTNESS-AMENDMENT1A).
//!
//! An eligible permit does NOT authorise an effect; it mints AT MOST ONE grant per effect policy; the
//! grant's validity never exceeds the canonical upstream deadline; the adapter re-checks currentness
//! against the sealed clock before any (synthetic, no-OS-mutation) effect; and the rollback outcome is
//! recorded in the witness. Fixture clock/verifier only; no real effect.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_arguments)]

use projectos_host_core::{
    mint_effect_grant, reduce, ApprovalOutcome, AuthoritySnapshot, CredentialOutcome, Disposition,
    EffectFamily, EffectGrantError, EffectGrantLedger, EffectOutcome, EffectTarget, ElevationLevel,
    ElevationObservation, ElevationVerifier, EmergencyStateRevision, EmergencyStopState,
    ExecutableIdentity, ExecutionPermit, ExpiryBoundary, FixtureClock, FixtureElevationVerifier,
    InstallationId, InternalOperationRecord, OperationInputs, PhaseReference, PolicyFloor,
    PolicyId, PolicyOutcome, PolicyRevision, PublisherIdentity, RecordPolicy, ReleaseFloor,
    ReleaseId, RepositoryRef, RequiredEffect, RequiredElevation, ResumePolicy, RevocationRevision,
    RevocationStatus, RollbackOutcome, RollbackRequirement, RollbackStrategyId,
    ServiceValidatedFacts, SessionId, SyntheticEffectAdapter, SyntheticEffectScript, TrustedClock,
    ValidatedElevationFact, ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness,
    ValidatedInstallation, ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy,
    ValidatedRelease, ValidatedSession, ValidityStatus, VerifiedExecutionContext,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const PID: u32 = 4242;
const TICK: u64 = 999;
const LEASE: u64 = 200;
const MIN_GEN: u64 = 5;

fn required_elevation(pid: u32) -> RequiredElevation {
    RequiredElevation {
        minimum_level: ElevationLevel::Elevated,
        min_generation: MIN_GEN,
        expected_pid: pid,
        expected_creation_tick: TICK,
    }
}

fn effect(
    family: EffectFamily,
    target: &str,
    argument: &str,
    rollback: RollbackRequirement,
) -> RequiredEffect {
    RequiredEffect {
        family,
        target: EffectTarget::new(target),
        argument: argument.into(),
        rollback,
    }
}

fn required_effect() -> RequiredEffect {
    effect(
        EffectFamily::RecordMarker,
        "marker-1",
        "arg-a",
        RollbackRequirement::NotRequired,
    )
}

/// Facts with tunable authority-expiry / operation-expiry (for lease-bound tests) and elevation lease.
struct Tuning {
    project: &'static str,
    environment: &'static str,
    session: &'static str,
    elev_proof: &'static str,
    pid: u32,
    elevation_lease: u64,
    authority_expiry: u64,
    operation_expiry: u64,
}
impl Default for Tuning {
    fn default() -> Self {
        Self {
            project: "proj",
            environment: "staging",
            session: "sess-1",
            elev_proof: "elev-proof-1",
            pid: PID,
            elevation_lease: LEASE,
            authority_expiry: 1000,
            operation_expiry: 1000,
        }
    }
}

fn governed(effect: RequiredEffect, t: &Tuning) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new(t.project).unwrap(),
            environment: EnvironmentId::new(t.environment).unwrap(),
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
            operation_expiry: ExpiryBoundary(t.operation_expiry),
        },
    )
    .bind_elevation(required_elevation(t.pid))
    .bind_effect(effect);
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn elev_fact(
    record: &InternalOperationRecord,
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
    t: &Tuning,
) -> ValidatedElevationFact {
    let e = v
        .verify(
            &ElevationObservation {
                proof_id: t.elev_proof.into(),
                source: "adapter".into(),
                level: ElevationLevel::Elevated,
                observed_at: 0,
                valid_until: t.elevation_lease,
                generation: MIN_GEN,
                pid: t.pid,
                creation_tick: TICK,
            },
            &required_elevation(t.pid),
            &clock.read_current(),
            &ValidatedSession {
                session: SessionId::new(t.session),
            },
        )
        .unwrap();
    ValidatedElevationFact::bind(
        e,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        None,
        None,
    )
}

fn full_facts(
    record: &InternalOperationRecord,
    elevation: ValidatedElevationFact,
    t: &Tuning,
) -> ServiceValidatedFacts {
    let sid = SessionId::new(t.session);
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: None,
        owner_presence: None,
        elevation: Some(elevation),
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
            project: record.binding.project.clone(),
            repository: RepositoryRef::new("repo-1"),
        }),
        environment: Some(ValidatedEnvironment {
            environment: EnvironmentId::new(t.environment).unwrap(),
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
            authority_expiry: ExpiryBoundary(t.authority_expiry),
            operation_expiry: Some(ExpiryBoundary(t.operation_expiry)),
            validity: ValidityStatus::Valid,
            revocation: RevocationStatus::Active(RevocationRevision(1)),
            emergency_state_revision: EmergencyStateRevision(1),
        }),
        approval: ApprovalOutcome::NotRequired,
        credential: CredentialOutcome::NotRequired,
        emergency_stop: EmergencyStopState::Clear,
    }
}

fn permit_ctx(
    record: &InternalOperationRecord,
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
    t: &Tuning,
) -> (ExecutionPermit, VerifiedExecutionContext) {
    let mk = || match reduce(
        &record.to_request_with_clock_and_verifier(clock, v),
        &full_facts(record, elev_fact(record, clock, v, t), t),
    ) {
        Disposition::EligibleForServiceExecution(p) => p,
        other => panic!("expected eligible, got {other:?}"),
    };
    let permit = mk();
    let current = mk().context().clone();
    (permit, current)
}

fn setup() -> (
    FixtureClock,
    FixtureElevationVerifier,
    InternalOperationRecord,
    Tuning,
) {
    (
        FixtureClock::new(100),
        FixtureElevationVerifier::new(),
        governed(required_effect(), &Tuning::default()),
        Tuning::default(),
    )
}

// ---- I1..I8 permit-level issuance ----------------------------------------------------------------

#[test]
fn i1_a_permit_mints_at_most_one_grant() {
    let (clock, v, record, t) = setup();
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    assert!(mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).is_ok());
    // Second mint from the SAME permit + policy + ledger is refused (single issuance).
    assert_eq!(
        mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}

#[test]
fn i3_another_permit_may_mint_its_own_grant() {
    let (clock, v, record, t) = setup();
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    assert!(mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).is_ok());
    // A DIFFERENT operation/permit (different session -> different context digest) may issue its own.
    let t2 = Tuning {
        session: "sess-2",
        project: "proj2",
        ..Tuning::default()
    };
    let record2 = governed(required_effect(), &t2);
    let (permit2, ctx2) = permit_ctx(&record2, &clock, &v, &t2);
    assert!(mint_effect_grant(&permit2, &ctx2, &clock, &required_effect(), LEASE, &ledger).is_ok());
}

#[test]
fn i4_issuance_policy_change_changes_the_fingerprint() {
    let a = governed(required_effect(), &Tuning::default());
    let b = governed(
        effect(
            EffectFamily::RecordMarker,
            "marker-1",
            "arg-b",
            RollbackRequirement::NotRequired,
        ),
        &Tuning::default(),
    );
    assert_ne!(a.binding.fingerprint, b.binding.fingerprint);
}

#[test]
fn i7_cloning_a_permit_does_not_bypass_issuance() {
    let (clock, v, record, t) = setup();
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    assert!(mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).is_ok());
    let cloned = permit.clone(); // permit is Clone, but issuance is keyed by context, not identity
    assert_eq!(
        mint_effect_grant(&cloned, &ctx, &clock, &required_effect(), LEASE, &ledger).unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}

// ---- L1..L7 canonical upstream lease bound -------------------------------------------------------

fn lease_case(t: Tuning, expected_bound: u64) {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let record = governed(required_effect(), &t);
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    // At the bound: ok. Beyond: refused.
    assert!(mint_effect_grant(
        &permit,
        &ctx,
        &clock,
        &required_effect(),
        expected_bound,
        &EffectGrantLedger::new()
    )
    .is_ok());
    assert_eq!(
        mint_effect_grant(
            &permit,
            &ctx,
            &clock,
            &required_effect(),
            expected_bound + 1,
            &ledger
        )
        .unwrap_err(),
        EffectGrantError::ExpiryBeyondUpstream
    );
}

#[test]
fn l1_authority_expiry_can_be_the_narrowest_bound() {
    lease_case(
        Tuning {
            authority_expiry: 140,
            elevation_lease: 200,
            operation_expiry: 1000,
            ..Tuning::default()
        },
        140,
    );
}

#[test]
fn l3_elevation_expiry_can_be_the_narrowest_bound() {
    lease_case(
        Tuning {
            elevation_lease: 160,
            authority_expiry: 1000,
            operation_expiry: 1000,
            ..Tuning::default()
        },
        160,
    );
}

#[test]
fn l4_operation_expiry_can_be_the_narrowest_bound() {
    lease_case(
        Tuning {
            operation_expiry: 150,
            authority_expiry: 1000,
            elevation_lease: 200,
            ..Tuning::default()
        },
        150,
    );
}

// ---- C1..C9 execution-time currentness -----------------------------------------------------------

fn mint_grant(
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
) -> (projectos_host_core::BoundedEffectGrant, EffectGrantLedger) {
    let t = Tuning::default();
    let record = governed(required_effect(), &t);
    let (permit, ctx) = permit_ctx(&record, clock, v, &t);
    let ledger = EffectGrantLedger::new();
    let g = mint_effect_grant(&permit, &ctx, clock, &required_effect(), 110, &ledger).unwrap();
    (g, ledger)
}

#[test]
fn c1_a_current_grant_executes() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    clock.advance_to(109);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &clock,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(w.outcome(), EffectOutcome::Success);
}

#[test]
fn c2_c3_an_expired_grant_is_refused_at_execution() {
    for reading in [110u64, 111] {
        let clock = FixtureClock::new(100);
        let v = FixtureElevationVerifier::new();
        let (grant, ledger) = mint_grant(&clock, &v);
        clock.advance_to(reading);
        let w = SyntheticEffectAdapter::new().perform(
            grant,
            &EffectTarget::new("marker-1"),
            &ledger,
            &clock,
            SyntheticEffectScript::Succeed,
        );
        assert_eq!(
            w.outcome(),
            EffectOutcome::Refused(EffectGrantError::GrantExpired)
        );
    }
}

#[test]
fn c4_a_substituted_clock_is_refused_at_execution() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    let other = FixtureClock::new(105); // same reading window, different provider identity
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &other,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::ClockProviderMismatch)
    );
}

#[test]
fn c5_a_restarted_clock_epoch_is_refused_at_execution() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    clock.next_epoch(105);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &clock,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::ClockEpochMismatch)
    );
}

#[test]
fn c7_c8_expiry_refusal_precedes_any_effect_and_is_not_success() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    clock.advance_to(110);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &clock,
        SyntheticEffectScript::Succeed,
    );
    // Refused (expiry), not Success — the currentness check precedes any synthetic effect.
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::GrantExpired)
    );
}

// ---- R1..R10 rollback policy ---------------------------------------------------------------------

#[test]
fn r3_rollback_required_but_unavailable_is_refused_at_mint() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let e = effect(
        EffectFamily::RecordMarker,
        "marker-1",
        "arg-a",
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Unavailable,
        },
    );
    let t = Tuning::default();
    let record = governed(e.clone(), &t);
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    assert_eq!(
        mint_effect_grant(&permit, &ctx, &clock, &e, 110, &ledger).unwrap_err(),
        EffectGrantError::RollbackUnavailable
    );
}

fn rollback_case(
    script: SyntheticEffectScript,
    rollback: RollbackRequirement,
    expected: RollbackOutcome,
) {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let e = effect(EffectFamily::RecordMarker, "marker-1", "arg-a", rollback);
    let t = Tuning::default();
    let record = governed(e.clone(), &t);
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let ledger = EffectGrantLedger::new();
    let grant = mint_effect_grant(&permit, &ctx, &clock, &e, 110, &ledger).unwrap();
    clock.advance_to(109);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &clock,
        script,
    );
    assert_eq!(w.rollback_outcome(), expected);
}

#[test]
fn r4_success_does_not_invoke_rollback() {
    rollback_case(
        SyntheticEffectScript::Succeed,
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Restore,
        },
        RollbackOutcome::NotAttempted,
    );
}

#[test]
fn r5_failure_with_rollback_succeeds() {
    rollback_case(
        SyntheticEffectScript::FailRollbackSucceeds,
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Restore,
        },
        RollbackOutcome::Succeeded,
    );
}

#[test]
fn r6_failure_with_rollback_fails() {
    rollback_case(
        SyntheticEffectScript::FailRollbackFails,
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::DeleteVerify,
        },
        RollbackOutcome::Failed,
    );
}

#[test]
fn r7_crash_leaves_rollback_indeterminate() {
    rollback_case(
        SyntheticEffectScript::Crash,
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Restore,
        },
        RollbackOutcome::Indeterminate,
    );
}

#[test]
fn r8_rollback_policy_change_changes_the_fingerprint() {
    let a = governed(
        effect(
            EffectFamily::RecordMarker,
            "m",
            "a",
            RollbackRequirement::NotRequired,
        ),
        &Tuning::default(),
    );
    let b = governed(
        effect(
            EffectFamily::RecordMarker,
            "m",
            "a",
            RollbackRequirement::Required {
                strategy: RollbackStrategyId::Restore,
            },
        ),
        &Tuning::default(),
    );
    assert_ne!(a.binding.fingerprint, b.binding.fingerprint);
}

// ---- B-dimension binding: ISOLATED single-dimension proofs via fixture_take ----------------------
// Each case starts from ONE canonical context A, and re-derives `current` by swapping EXACTLY ONE
// dimension from a maximally-different canonical context B — every other compared dimension stays A's.
// The mint returns the EXACT differing ContextField, so each dimension is independently distinguishable
// (and each compare-array row is independently mutation-removable — see the G3A..G9D campaign).

use projectos_host_core::{ContextField, FixtureDimension};

/// The maximally-different "B" tuning: every tunable dimension differs from the default "A".
fn alt_tuning() -> Tuning {
    Tuning {
        project: "proj2",
        environment: "prod",
        session: "sess-2",
        elev_proof: "elev-proof-2",
        pid: 7777,
        elevation_lease: 150,
        authority_expiry: 900,
        operation_expiry: 900,
    }
}

/// Build A (default) and B (all-different) contexts, each with its OWN verifier, sharing one clock.
fn ab_contexts(
    clock: &FixtureClock,
) -> (
    ExecutionPermit,
    VerifiedExecutionContext,
    VerifiedExecutionContext,
) {
    let va = FixtureElevationVerifier::new();
    let vb = FixtureElevationVerifier::new();
    let ta = Tuning::default();
    let tb = alt_tuning();
    let (permit_a, ctx_a) = permit_ctx(&governed(required_effect(), &ta), clock, &va, &ta);
    let (_, ctx_b) = permit_ctx(
        &governed(
            effect(
                EffectFamily::RecordMarker,
                "marker-2",
                "arg-b",
                RollbackRequirement::NotRequired,
            ),
            &tb,
        ),
        clock,
        &vb,
        &tb,
    );
    (permit_a, ctx_a, ctx_b)
}

/// Swap exactly `dim` into A's context and assert the mint refuses on exactly `expected`.
fn dim_case(dim: FixtureDimension, expected: ContextField) {
    let clock = FixtureClock::new(100);
    let (permit_a, ctx_a, ctx_b) = ab_contexts(&clock);
    let current = ctx_a.fixture_take(&ctx_b, dim);
    assert_eq!(
        mint_effect_grant(
            &permit_a,
            &current,
            &clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(expected)
    );
}

#[test]
fn b1_project_is_independently_bound() {
    dim_case(FixtureDimension::Project, ContextField::Project);
}
#[test]
fn b2_environment_is_independently_bound() {
    dim_case(FixtureDimension::Environment, ContextField::Environment);
}
#[test]
fn b3_phase_is_independently_bound() {
    dim_case(FixtureDimension::Phase, ContextField::Phase);
}
#[test]
fn b6_operation_fingerprint_is_independently_bound() {
    dim_case(FixtureDimension::Fingerprint, ContextField::Fingerprint);
}
#[test]
fn b9_session_is_independently_bound() {
    dim_case(FixtureDimension::Session, ContextField::Session);
}
#[test]
fn b10_process_is_independently_bound() {
    dim_case(FixtureDimension::Process, ContextField::ElevationProcess);
}
#[test]
fn b12_elevation_is_independently_bound() {
    dim_case(FixtureDimension::Elevation, ContextField::ElevationProof);
}
#[test]
fn b14_elevation_verifier_is_independently_bound() {
    dim_case(
        FixtureDimension::ElevationVerifier,
        ContextField::ElevationVerifier,
    );
}
#[test]
fn b15_effect_policy_is_independently_bound() {
    dim_case(FixtureDimension::EffectPolicy, ContextField::EffectPolicy);
}
#[test]
fn b16_authority_lease_bound_is_independently_bound() {
    dim_case(
        FixtureDimension::AuthorityLeaseBound,
        ContextField::AuthorityLeaseBound,
    );
}

// ---- eligibility is not effect authority + witness -----------------------------------------------

#[test]
fn eligibility_is_not_effect_authority() {
    let (clock, v, record, t) = setup();
    let (permit, ctx) = permit_ctx(&record, &clock, &v, &t);
    let mismatched = effect(
        EffectFamily::RecordMarker,
        "other",
        "z",
        RollbackRequirement::NotRequired,
    );
    assert_eq!(
        mint_effect_grant(
            &permit,
            &ctx,
            &clock,
            &mismatched,
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::EffectPolicyMismatch
    );
}

#[test]
fn a_grant_yields_a_witness_matching_the_grant() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    clock.advance_to(105);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("marker-1"),
        &ledger,
        &clock,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(w.outcome(), EffectOutcome::Success);
    assert_eq!(w.operation(), &OperationRef::new("op-1").unwrap());
    assert_eq!(w.family(), EffectFamily::RecordMarker);
}

#[test]
fn a_wrong_target_at_the_adapter_is_refused() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (grant, ledger) = mint_grant(&clock, &v);
    clock.advance_to(105);
    let w = SyntheticEffectAdapter::new().perform(
        grant,
        &EffectTarget::new("other"),
        &ledger,
        &clock,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::WrongEffect)
    );
}

#[test]
fn effect_policy_is_absent_by_default() {
    let record = InternalOperationRecord::new(
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
    );
    assert!(record.required_effect.is_none());
}

// =================================================================================================
// FINAL SIX-DIMENSION PROOF (CD-B4-EFFECT-GRANT-FINAL-SIX-DIMENSION-PROOF-AMENDMENT1A)
// B4 approved-plan, B7 repository-baseline, B8 repository-generation, B11 owner-presence,
// B14 verifier-epoch (all isolatable via fixture_take), and B5 operation-reference (Path B:
// operation_ref is NOT a VerifiedExecutionContext field; it binds the permit identity through
// ExecutionPermit::context_digest, so it is proven inseparable-yet-independent via the issuance key).
//
// A MAXIMALLY-GOVERNED canonical context (approved-plan + repository[baseline+generation] +
// owner-presence + elevation + effect) is built, proven eligible + mints one grant, then a second
// context differing in EXACTLY the tested dimension (same identity where the gate requires it) is
// fixture_take'd into A's context so removing one compare row fails ONLY that dimension's proof.
// =================================================================================================

use projectos_host_core::{
    verify_owner_presence, verify_repository_baseline, ApprovedPlanJournal, ApprovedPlanStatus,
    BranchPolicy, DivergencePolicy, EffectPolicy, GitRepositoryObservation,
    OwnerPresenceObservation, PhaseDefinitionCandidate, PhaseType, ProviderPolicy,
    RepositoryPolicy, RequestedOperationPolicy, RequiredFreshness, RequiredOwnerPresence,
    RequiredRepository, ResidueRequirement, ValidatedApprovedPlan, ValidatedOwnerPresenceFact,
    ValidatedRepositoryFact,
};

const OID_X: &str = "0123456789abcdef0123456789abcdef01234567";
const OID_Y: &str = "89abcdef0123456789abcdef0123456789abcdef";

/// Tuning for the FULLY-governed canonical context. `project`/`session`/`op_ref` are held fixed so the
/// single-dimension variant differs in EXACTLY the tested dimension (identity preserved where required).
struct GovTune {
    op_ref: &'static str,
    op_proof: &'static str,
    op_gen: u64,
    repo_commit: &'static str,
    repo_gen: u64,
    plan_version: u64,
}
impl Default for GovTune {
    fn default() -> Self {
        Self {
            op_ref: "op-1",
            op_proof: "op-proof-1",
            op_gen: MIN_GEN,
            repo_commit: OID_X,
            repo_gen: 1,
            plan_version: 1,
        }
    }
}

fn req_repo(commit: &str) -> RequiredRepository {
    RequiredRepository {
        expected_root: "C:/repo".into(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: commit.into(),
        branch_policy: BranchPolicy::Exact("main".into()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    }
}

fn req_presence() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: MIN_GEN,
    }
}

fn candidate(v: u64) -> PhaseDefinitionCandidate {
    PhaseDefinitionCandidate {
        phase_id: "phase-x".into(),
        phase_type: PhaseType::SourceOnly,
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        scope: vec!["a".into()],
        path_boundary: vec!["src/x".into()],
        allowed_actions: vec!["read".into()],
        // Distinct per plan version so a version bump changes the definition digest.
        prohibited_actions: vec![format!("write-{v}")],
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

/// A fully-governed operation: approved-plan + repository + owner-presence + elevation + effect.
fn gov_record(g: &GovTune) -> (InternalOperationRecord, ValidatedApprovedPlan) {
    let plan = ApprovedPlanJournal::new().commit_approved_for_test(
        &candidate(g.plan_version),
        g.plan_version,
        ApprovedPlanStatus::Active,
        0,
    );
    let mut r = InternalOperationRecord::new(
        OperationRef::new(g.op_ref).unwrap(),
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
    .bind_approved_plan(&plan, conforming_policy())
    .bind_repository(req_repo(g.repo_commit))
    .bind_owner_presence(req_presence())
    .bind_elevation(required_elevation(PID))
    .bind_effect(required_effect());
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    (r, plan)
}

fn gov_repo_fact(
    record: &InternalOperationRecord,
    commit: &str,
    gen: u64,
) -> ValidatedRepositoryFact {
    let baseline = verify_repository_baseline(
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
        &req_repo(commit),
    )
    .unwrap();
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

fn gov_presence_fact(
    record: &InternalOperationRecord,
    clock: &FixtureClock,
    proof: &str,
    gen: u64,
    repo: &ValidatedRepositoryFact,
) -> ValidatedOwnerPresenceFact {
    let p = verify_owner_presence(
        &OwnerPresenceObservation {
            proof_id: proof.into(),
            verifier: "hello".into(),
            observed_at: 0,
            valid_until: LEASE,
            generation: gen,
        },
        &req_presence(),
        &clock.read_current(),
    )
    .unwrap();
    ValidatedOwnerPresenceFact::bind(
        p,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        Some(repo),
    )
}

fn gov_elev_fact(
    record: &InternalOperationRecord,
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
    repo: &ValidatedRepositoryFact,
    presence: &ValidatedOwnerPresenceFact,
) -> ValidatedElevationFact {
    let e = v
        .verify(
            &ElevationObservation {
                proof_id: "elev-proof-1".into(),
                source: "adapter".into(),
                level: ElevationLevel::Elevated,
                observed_at: 0,
                valid_until: LEASE,
                generation: MIN_GEN,
                pid: PID,
                creation_tick: TICK,
            },
            &required_elevation(PID),
            &clock.read_current(),
            &ValidatedSession {
                session: SessionId::new("sess-1"),
            },
        )
        .unwrap();
    ValidatedElevationFact::bind(
        e,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        Some(repo),
        Some(presence),
    )
}

fn gov_facts(
    record: &InternalOperationRecord,
    plan: ValidatedApprovedPlan,
    repo: ValidatedRepositoryFact,
    presence: ValidatedOwnerPresenceFact,
    elevation: ValidatedElevationFact,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: Some(plan),
        repository: Some(repo),
        owner_presence: Some(presence),
        elevation: Some(elevation),
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
            project: record.binding.project.clone(),
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

fn gov_permit_ctx(
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
    g: &GovTune,
) -> (ExecutionPermit, VerifiedExecutionContext) {
    let (record, plan) = gov_record(g);
    let repo = gov_repo_fact(&record, g.repo_commit, g.repo_gen);
    let presence = gov_presence_fact(&record, clock, g.op_proof, g.op_gen, &repo);
    let elevation = gov_elev_fact(&record, clock, v, &repo, &presence);
    let mk = || {
        let repo = gov_repo_fact(&record, g.repo_commit, g.repo_gen);
        let presence = gov_presence_fact(&record, clock, g.op_proof, g.op_gen, &repo);
        let elevation = gov_elev_fact(&record, clock, v, &repo, &presence);
        match reduce(
            &record.to_request_with_clock_and_verifier(clock, v),
            &gov_facts(&record, plan.clone(), repo, presence, elevation),
        ) {
            Disposition::EligibleForServiceExecution(p) => p,
            other => panic!("expected eligible, got {other:?}"),
        }
    };
    let _ = (repo, presence, elevation);
    (mk(), mk().context().clone())
}

/// §3/§8 — the fully-governed baseline is eligible and mints exactly one grant before any mutation.
#[test]
fn gov_baseline_is_eligible_and_mints_one_grant() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit, ctx) = gov_permit_ctx(&clock, &v, &GovTune::default());
    let ledger = EffectGrantLedger::new();
    assert!(mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).is_ok());
    // Single-issuance: a second mint against the same ledger for the same policy is refused.
    assert_eq!(
        mint_effect_grant(&permit, &ctx, &clock, &required_effect(), LEASE, &ledger).unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}

/// Swap exactly `dim` from a single-dimension-different context into A's context, assert exact refusal.
fn gov_dim_case(dim: FixtureDimension, expected: ContextField, alt: GovTune) {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &va, &GovTune::default());
    let vb = FixtureElevationVerifier::new();
    let (_, ctx_other) = gov_permit_ctx(&clock, &vb, &alt);
    let current = ctx_a.fixture_take(&ctx_other, dim);
    assert_eq!(
        mint_effect_grant(
            &permit_a,
            &current,
            &clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(expected)
    );
}

#[test]
fn b4_approved_plan_is_independently_bound() {
    gov_dim_case(
        FixtureDimension::ApprovedPlan,
        ContextField::ApprovedPlan,
        GovTune {
            plan_version: 2,
            ..GovTune::default()
        },
    );
}

#[test]
fn b7_repository_baseline_is_independently_bound() {
    // Same repository IDENTITY (root/project), DIFFERENT commit only — generation held equal.
    gov_dim_case(
        FixtureDimension::RepositoryBaseline,
        ContextField::RepositoryBaseline,
        GovTune {
            repo_commit: OID_Y,
            ..GovTune::default()
        },
    );
}

#[test]
fn b8_repository_generation_is_independently_bound() {
    // Same baseline content (commit), DIFFERENT generation only.
    gov_dim_case(
        FixtureDimension::RepositoryGeneration,
        ContextField::RepositoryGeneration,
        GovTune {
            repo_gen: 2,
            ..GovTune::default()
        },
    );
}

#[test]
fn b11_owner_presence_is_independently_bound() {
    // Same generation / validity, DIFFERENT proof identity only.
    gov_dim_case(
        FixtureDimension::OwnerPresence,
        ContextField::OwnerPresenceProof,
        GovTune {
            op_proof: "op-proof-2",
            ..GovTune::default()
        },
    );
}

/// §7 (B14 verifier epoch): SAME verifier IDENTITY, DIFFERENT verifier epoch only. The variant context
/// is built with the SAME verifier handle after `next_epoch()`, so identity is preserved and only the
/// epoch field differs.
#[test]
fn b14_elevation_verifier_epoch_is_independently_bound() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &v, &GovTune::default());
    v.next_epoch();
    let (_, ctx_other) = gov_permit_ctx(&clock, &v, &GovTune::default());
    let current = ctx_a.fixture_take(&ctx_other, FixtureDimension::ElevationVerifierEpoch);
    assert_eq!(
        mint_effect_grant(
            &permit_a,
            &current,
            &clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(ContextField::ElevationVerifierEpoch)
    );
}

/// §5 (B5 operation reference — PATH B, genuinely inseparable). `operation_ref` is NOT a standalone
/// `VerifiedExecutionContext` field. `InternalOperationRecord::new` folds it into the canonical
/// `PhaseId` (`PhaseId::mint(project, environment, phase_reference, operation_ref)`), and that phase is
/// folded into the operation fingerprint. So `operation_ref` cannot vary without changing BOTH the
/// context phase and the fingerprint — the private `operation_ref` field plus the single record
/// constructor make an inconsistent `(operation_ref, phase, fingerprint)` tuple unconstructable.
///
/// Isolation: two records identical EXCEPT `operation_ref` (SAME clock and SAME verifier handle, so no
/// other dimension moves) yield contexts that differ in phase; the permit therefore refuses the mint on
/// exactly `ContextField::Phase`. Removing `&operation_ref` from `PhaseId::mint` (the operation-reference
/// fold) collapses the two phases and this refusal disappears — the op-ref fold mutation (G5-invariant).
///
/// NOTE: this does NOT claim B3 (phase) or B6 (fingerprint) alone prove B5. B3/B6 vary the phase/base
/// fingerprint directly; here the phase MOVES BECAUSE the operation reference moved, with every other
/// input pinned — that is the operation-reference relationship, not the phase or fingerprint dimension.
#[test]
fn b5_operation_reference_is_bound_through_phase_and_fingerprint() {
    let clock = FixtureClock::new(100);
    // ONE shared verifier handle: the ONLY difference between the two reductions is the operation ref.
    let v = FixtureElevationVerifier::new();
    let (permit_a, _ctx_a) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-alpha",
            ..GovTune::default()
        },
    );
    let (_permit_b, ctx_b) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-beta",
            ..GovTune::default()
        },
    );

    // Changing ONLY operation_ref moves the canonical phase (and, transitively, the fingerprint), so the
    // permit refuses the mint on exactly Phase. operation_ref is inseparable from — yet independently
    // bound through — the phase/fingerprint it authoritatively derives.
    assert_eq!(
        mint_effect_grant(
            &permit_a,
            &ctx_b,
            &clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(ContextField::Phase)
    );
}

// =================================================================================================
// DIGEST & FIXTURE-EXCLUSION FINAL (CD-B4-EFFECT-GRANT-DIGEST-FIXTURE-EXCLUSION-FINAL1A)
// K-matrix (issuance-key identity/separation) + D-matrix (permit-context-digest isolation).
//
// The issuance key is sha256(permit_context_digest || effect_policy_digest). Two authority contexts
// with distinct STABLE IDENTITY must yield distinct issuance keys (independent single-issuance state);
// pure LIVENESS/temporal dimensions are intentionally EXCLUDED from the digest (folding them would tie
// issuance identity to transient re-authorization and let a benign re-observation mint a SECOND grant)
// and are enforced instead by compare_context at mint + sealed-clock currentness at execution.
// =================================================================================================

use projectos_host_core::fixture_issuance_key;

/// (base_digest, swapped_digest): the permit-context digest of `ctx_a`, and of `ctx_a` with exactly
/// `dim` swapped from `ctx_b`, both under `permit`'s operation reference.
fn dig_pair(
    permit: &ExecutionPermit,
    ctx_a: &VerifiedExecutionContext,
    ctx_b: &VerifiedExecutionContext,
    dim: FixtureDimension,
) -> ([u8; 32], [u8; 32]) {
    let base = permit.fixture_context_digest_with(ctx_a);
    let swapped = permit.fixture_context_digest_with(&ctx_a.fixture_take(ctx_b, dim));
    (base, swapped)
}

/// The real single-issuance key for `(permit context under ctx, effect policy)`.
fn key_of(
    permit: &ExecutionPermit,
    ctx: &VerifiedExecutionContext,
    eff: &RequiredEffect,
) -> [u8; 32] {
    fixture_issuance_key(permit.fixture_context_digest_with(ctx), eff.policy_digest())
}

/// Isolation pair from the ORIGINAL all-different ab_contexts fixture (covers the always-present dims).
fn ab_iso(dim: FixtureDimension) -> ([u8; 32], [u8; 32]) {
    let clock = FixtureClock::new(100);
    let (p, a, b) = ab_contexts(&clock);
    dig_pair(&p, &a, &b, dim)
}

/// Isolation pair from the maximally-governed fixture, varying exactly the tested dimension.
fn gov_iso(dim: FixtureDimension, alt: GovTune) -> ([u8; 32], [u8; 32]) {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &va, &GovTune::default());
    let vb = FixtureElevationVerifier::new();
    let (_, ctx_o) = gov_permit_ctx(&clock, &vb, &alt);
    dig_pair(&permit_a, &ctx_a, &ctx_o, dim)
}

// ---- D-matrix: permit-context digest isolation -------------------------------------------------
// Included IDENTITY dimensions: swapping the field changes the digest. Excluded LIVENESS dimensions:
// the digest is unchanged (compare_context/currentness still refuse the change at mint).

#[test]
fn d1_project_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Project);
    assert_ne!(a, b);
}
#[test]
fn d2_environment_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Environment);
    assert_ne!(a, b);
}
#[test]
fn d3_phase_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Phase);
    assert_ne!(a, b);
}
#[test]
fn d4_approved_plan_changes_digest() {
    let (a, b) = gov_iso(
        FixtureDimension::ApprovedPlan,
        GovTune {
            plan_version: 2,
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn d5_operation_reference_changes_digest() {
    // op_ref is not a context field and is NOT folded directly; it is bound TRANSITIVELY through the
    // canonical phase (PhaseId::mint folds op_ref) which the digest folds as phase.digest() + fingerprint.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit_alpha, _) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-alpha",
            ..GovTune::default()
        },
    );
    let (permit_beta, _) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-beta",
            ..GovTune::default()
        },
    );
    assert_ne!(
        permit_alpha.fixture_context_digest(),
        permit_beta.fixture_context_digest()
    );
}
#[test]
fn d6_fingerprint_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Fingerprint);
    assert_ne!(a, b);
}
#[test]
fn d7_repository_baseline_changes_digest() {
    let (a, b) = gov_iso(
        FixtureDimension::RepositoryBaseline,
        GovTune {
            repo_commit: OID_Y,
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn d8_repository_generation_excluded_from_digest() {
    let (a, b) = gov_iso(
        FixtureDimension::RepositoryGeneration,
        GovTune {
            repo_gen: 2,
            ..GovTune::default()
        },
    );
    assert_eq!(a, b, "repository generation is a liveness scalar, excluded");
}
#[test]
fn d9_session_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Session);
    assert_ne!(a, b);
}
#[test]
fn d10_process_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Process);
    assert_ne!(a, b);
}
#[test]
fn d11_owner_presence_changes_digest() {
    let (a, b) = gov_iso(
        FixtureDimension::OwnerPresence,
        GovTune {
            op_proof: "op-proof-2",
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn d12_elevation_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::Elevation);
    assert_ne!(a, b);
}
#[test]
fn d13_clock_provider_and_epoch_excluded_from_digest() {
    // Two governed contexts under DISTINCT clock providers/epochs; swapping either leaves the digest
    // unchanged (currentness is enforced by the sealed clock at execution, never by issuance identity).
    let clock_a = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock_a, &va, &GovTune::default());
    let clock_b = FixtureClock::new(100);
    clock_b.next_epoch(100);
    let vb = FixtureElevationVerifier::new();
    let (_, ctx_b) = gov_permit_ctx(&clock_b, &vb, &GovTune::default());
    let (base, prov) = dig_pair(
        &permit_a,
        &ctx_a,
        &ctx_b,
        FixtureDimension::ElevationClockProvider,
    );
    assert_eq!(base, prov, "clock provider excluded");
    let (base, ep) = dig_pair(
        &permit_a,
        &ctx_a,
        &ctx_b,
        FixtureDimension::ElevationClockEpoch,
    );
    assert_eq!(base, ep, "clock epoch excluded");
}
#[test]
fn d14_verifier_identity_changes_digest_but_epoch_excluded() {
    // Identity: included.
    let (a, b) = ab_iso(FixtureDimension::ElevationVerifier);
    assert_ne!(a, b, "verifier identity is included");
    // Epoch: excluded. Same verifier handle, next_epoch → only the epoch scalar differs.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &v, &GovTune::default());
    v.next_epoch();
    let (_, ctx_e) = gov_permit_ctx(&clock, &v, &GovTune::default());
    let (base, ep) = dig_pair(
        &permit_a,
        &ctx_a,
        &ctx_e,
        FixtureDimension::ElevationVerifierEpoch,
    );
    assert_eq!(base, ep, "verifier epoch is excluded");
}
#[test]
fn d15_effect_policy_changes_digest() {
    let (a, b) = ab_iso(FixtureDimension::EffectPolicy);
    assert_ne!(a, b);
}
#[test]
fn d16_authority_lease_bound_excluded_from_digest() {
    let (a, b) = ab_iso(FixtureDimension::AuthorityLeaseBound);
    assert_eq!(a, b, "authority lease bound is a temporal scalar, excluded");
}
#[test]
fn d17_rollback_policy_changes_digest_via_effect_policy() {
    // Rollback is folded into the effect policy digest, which is a digest identity dimension.
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &v, &GovTune::default());
    let eff_no = required_effect();
    let eff_rb = effect(
        EffectFamily::RecordMarker,
        "marker-1",
        "arg-a",
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Restore,
        },
    );
    assert_ne!(eff_no.policy_digest(), eff_rb.policy_digest());
    // And the issuance key therefore differs (K18).
    assert_ne!(
        key_of(&permit_a, &ctx_a, &eff_no),
        key_of(&permit_a, &ctx_a, &eff_rb)
    );
}

// ---- K-matrix: single-issuance key ------------------------------------------------------------

fn ab_keys(dim: FixtureDimension) -> ([u8; 32], [u8; 32]) {
    let clock = FixtureClock::new(100);
    let (p, a, b) = ab_contexts(&clock);
    let swapped = a.fixture_take(&b, dim);
    (
        key_of(&p, &a, &required_effect()),
        key_of(&p, &swapped, &required_effect()),
    )
}
fn gov_keys(dim: FixtureDimension, alt: GovTune) -> ([u8; 32], [u8; 32]) {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &va, &GovTune::default());
    let vb = FixtureElevationVerifier::new();
    let (_, ctx_o) = gov_permit_ctx(&clock, &vb, &alt);
    let swapped = ctx_a.fixture_take(&ctx_o, dim);
    (
        key_of(&permit_a, &ctx_a, &required_effect()),
        key_of(&permit_a, &swapped, &required_effect()),
    )
}

#[test]
fn k1_identical_permit_and_policy_same_key() {
    let clock = FixtureClock::new(100);
    let (p, a, _) = ab_contexts(&clock);
    assert_eq!(
        key_of(&p, &a, &required_effect()),
        key_of(&p, &a, &required_effect())
    );
}
#[test]
fn k2_project_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Project);
    assert_ne!(a, b);
}
#[test]
fn k3_environment_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Environment);
    assert_ne!(a, b);
}
#[test]
fn k4_phase_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Phase);
    assert_ne!(a, b);
}
#[test]
fn k5_approved_plan_differs_key() {
    let (a, b) = gov_keys(
        FixtureDimension::ApprovedPlan,
        GovTune {
            plan_version: 2,
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn k6_operation_reference_differs_key() {
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (pa, ca) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-alpha",
            ..GovTune::default()
        },
    );
    let (pb, cb) = gov_permit_ctx(
        &clock,
        &v,
        &GovTune {
            op_ref: "op-beta",
            ..GovTune::default()
        },
    );
    assert_ne!(
        key_of(&pa, &ca, &required_effect()),
        key_of(&pb, &cb, &required_effect())
    );
}
#[test]
fn k7_fingerprint_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Fingerprint);
    assert_ne!(a, b);
}
#[test]
fn k8_repository_baseline_differs_key() {
    let (a, b) = gov_keys(
        FixtureDimension::RepositoryBaseline,
        GovTune {
            repo_commit: OID_Y,
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn k9_repository_generation_shares_key_excluded() {
    let (a, b) = gov_keys(
        FixtureDimension::RepositoryGeneration,
        GovTune {
            repo_gen: 2,
            ..GovTune::default()
        },
    );
    assert_eq!(
        a, b,
        "repo generation excluded; compare_context refuses the change at mint"
    );
}
#[test]
fn k10_session_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Session);
    assert_ne!(a, b);
}
#[test]
fn k11_process_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Process);
    assert_ne!(a, b);
}
#[test]
fn k12_owner_presence_proof_differs_key() {
    let (a, b) = gov_keys(
        FixtureDimension::OwnerPresence,
        GovTune {
            op_proof: "op-proof-2",
            ..GovTune::default()
        },
    );
    assert_ne!(a, b);
}
#[test]
fn k13_elevation_proof_differs_key() {
    let (a, b) = ab_keys(FixtureDimension::Elevation);
    assert_ne!(a, b);
}
#[test]
fn k14_clock_provider_epoch_shares_key_excluded() {
    let clock_a = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock_a, &va, &GovTune::default());
    let clock_b = FixtureClock::new(100);
    clock_b.next_epoch(100);
    let vb = FixtureElevationVerifier::new();
    let (_, ctx_b) = gov_permit_ctx(&clock_b, &vb, &GovTune::default());
    let prov = ctx_a.fixture_take(&ctx_b, FixtureDimension::ElevationClockProvider);
    let ep = ctx_a.fixture_take(&ctx_b, FixtureDimension::ElevationClockEpoch);
    assert_eq!(
        key_of(&permit_a, &ctx_a, &required_effect()),
        key_of(&permit_a, &prov, &required_effect())
    );
    assert_eq!(
        key_of(&permit_a, &ctx_a, &required_effect()),
        key_of(&permit_a, &ep, &required_effect())
    );
}
#[test]
fn k15_verifier_identity_differs_epoch_shares_key() {
    let (a, b) = ab_keys(FixtureDimension::ElevationVerifier);
    assert_ne!(a, b, "verifier identity included");
    let clock = FixtureClock::new(100);
    let v = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &v, &GovTune::default());
    v.next_epoch();
    let (_, ctx_e) = gov_permit_ctx(&clock, &v, &GovTune::default());
    let ep = ctx_a.fixture_take(&ctx_e, FixtureDimension::ElevationVerifierEpoch);
    assert_eq!(
        key_of(&permit_a, &ctx_a, &required_effect()),
        key_of(&permit_a, &ep, &required_effect()),
        "verifier epoch excluded"
    );
}
#[test]
fn k16_effect_policy_differs_key() {
    let clock = FixtureClock::new(100);
    let (p, a, _) = ab_contexts(&clock);
    let other = effect(
        EffectFamily::RecordMarker,
        "marker-zzz",
        "arg-zzz",
        RollbackRequirement::NotRequired,
    );
    assert_ne!(key_of(&p, &a, &required_effect()), key_of(&p, &a, &other));
}
#[test]
fn k17_authority_lease_bound_shares_key_excluded() {
    let (a, b) = ab_keys(FixtureDimension::AuthorityLeaseBound);
    assert_eq!(
        a, b,
        "authority lease bound excluded; compare_context refuses at mint"
    );
}
#[test]
fn k18_rollback_policy_differs_key() {
    let clock = FixtureClock::new(100);
    let (p, a, _) = ab_contexts(&clock);
    let eff_rb = effect(
        EffectFamily::RecordMarker,
        "marker-1",
        "arg-a",
        RollbackRequirement::Required {
            strategy: RollbackStrategyId::Restore,
        },
    );
    assert_ne!(key_of(&p, &a, &required_effect()), key_of(&p, &a, &eff_rb));
}

/// Issuance-bypass safety for EXCLUDED dimensions: after an excluded dimension changes, the issuance key
/// is UNCHANGED, so a prior Issued/Consumed state is NOT reset — a second grant cannot be minted.
/// (compare_context independently refuses the changed context at mint; this proves the ledger cannot be
/// bypassed even if compare_context were somehow satisfied.)
#[test]
fn excluded_dimension_change_cannot_reset_already_issued() {
    let clock = FixtureClock::new(100);
    let va = FixtureElevationVerifier::new();
    let (permit_a, ctx_a) = gov_permit_ctx(&clock, &va, &GovTune::default());
    let ledger = EffectGrantLedger::new();
    assert!(mint_effect_grant(
        &permit_a,
        &ctx_a,
        &clock,
        &required_effect(),
        LEASE,
        &ledger
    )
    .is_ok());
    // A permit whose repository generation (excluded) differs — but SAME verifier identity so only the
    // excluded scalar moves — shares the issuance key → AlreadyIssued (state not reset).
    let (permit_b, ctx_b) = gov_permit_ctx(
        &clock,
        &va,
        &GovTune {
            repo_gen: 2,
            ..GovTune::default()
        },
    );
    assert_eq!(
        mint_effect_grant(
            &permit_b,
            &ctx_b,
            &clock,
            &required_effect(),
            LEASE,
            &ledger
        )
        .unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}
