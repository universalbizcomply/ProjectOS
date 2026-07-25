//! End-to-end proof of owner-presence authority with PROVIDER-CONTROLLED trusted time
//! (CD-B4-OWNER-PRESENCE-AUTHORITY-TIME-REPLAY-AMENDMENT1A).
//!
//! Evaluation reads the CURRENT time from an injected [`FixtureClock`] provider — never a caller-supplied
//! value — so a retained historical reading cannot be replayed. A presence lease is refused once the
//! provider advances beyond it, or when the provider identity/epoch differs from the one the proof was
//! established under. Synthetic observations only; fixture clock only.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    reduce, verify_owner_presence, ApprovalOutcome, AuthoritySnapshot, ContextComparison,
    ContextField, CredentialOutcome, DenialReason, Disposition, EmergencyStateRevision,
    EmergencyStopState, ExecutableIdentity, ExecutionPermit, ExpiryBoundary, FixtureClock,
    InstallationId, InternalOperationRecord, MissingFact, OperationInputs, OwnerPresenceBinding,
    OwnerPresenceError, OwnerPresenceObservation, PhaseReference, PolicyFloor, PolicyId,
    PolicyOutcome, PolicyRevision, PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId,
    RepositoryRef, RequiredOwnerPresence, ResumePolicy, RevocationRevision, RevocationStatus,
    ServiceValidatedFacts, SessionId, TrustedClock, ValidatedEnvironment, ValidatedExecutable,
    ValidatedFreshness, ValidatedInstallation, ValidatedOwnerPresenceFact, ValidatedProcess,
    ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease, ValidatedRepositoryFact,
    ValidatedSession, ValidityStatus, VerifiedOwnerPresence,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const VALID_UNTIL: u64 = 200;

fn required_presence() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: 5,
    }
}

/// A presence proof established under `clock` at its current reading, for the given generation + lease.
fn presence(gen: u64, valid_until: u64, clock: &FixtureClock) -> VerifiedOwnerPresence {
    let mut r = required_presence();
    r.min_generation = gen;
    verify_owner_presence(
        &OwnerPresenceObservation {
            proof_id: "proof-1".into(),
            verifier: "hello".into(),
            observed_at: 0,
            valid_until,
            generation: gen,
        },
        &r,
        &clock.read_current(),
    )
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
fn record_var(
    op_ref: &str,
    project: &str,
    environment: &str,
    phase_ref: &str,
    base_fp: &str,
    presence_governed: bool,
    req: RequiredOwnerPresence,
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
        r = r.bind_owner_presence(req);
    }
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn governed_record(req: RequiredOwnerPresence) -> InternalOperationRecord {
    record_var("op-1", "proj", "staging", "phase-ref", "fp", true, req)
}

fn bind_fact(
    record: &InternalOperationRecord,
    p: VerifiedOwnerPresence,
    repo: Option<&ValidatedRepositoryFact>,
) -> ValidatedOwnerPresenceFact {
    ValidatedOwnerPresenceFact::bind(
        p,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        repo,
    )
}

fn full_facts(
    record: &InternalOperationRecord,
    fact: Option<ValidatedOwnerPresenceFact>,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: None,
        owner_presence: fact,
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
    p: VerifiedOwnerPresence,
    clock: &FixtureClock,
) -> ExecutionPermit {
    let fact = bind_fact(record, p, None);
    match reduce(
        &record.to_request_with_clock(clock),
        &full_facts(record, Some(fact)),
    ) {
        Disposition::EligibleForServiceExecution(permit) => permit,
        other => panic!("expected eligible, got {other:?}"),
    }
}

// ---- basic ---------------------------------------------------------------------------------------

#[test]
fn a10_an_operation_not_requiring_owner_presence_is_independent_of_the_clock() {
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        false,
        required_presence(),
    );
    // No clock supplied — a non-presence op is unaffected.
    assert!(matches!(
        reduce(&record.to_request(), &full_facts(&record, None)),
        Disposition::EligibleForServiceExecution(_)
    ));
}

#[test]
fn a_missing_clock_denies() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    // to_request (no clock) → cannot read current time → fail closed.
    assert_eq!(
        reduce(&record.to_request(), &full_facts(&record, Some(fact))),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::AuthorityTime))
    );
}

#[test]
fn a_missing_owner_presence_fact_denies() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, None)
        ),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::OwnerPresence))
    );
}

#[test]
fn the_exact_bound_fact_is_eligible() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    assert!(matches!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, Some(fact))
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- cross-binding -------------------------------------------------------------------------------

fn cross(owner: &InternalOperationRecord, reduced: &InternalOperationRecord) -> Disposition {
    let clock = FixtureClock::new(100);
    let fact = bind_fact(owner, presence(5, VALID_UNTIL, &clock), None);
    reduce(
        &reduced.to_request_with_clock(&clock),
        &full_facts(reduced, Some(fact)),
    )
}

#[test]
fn a_fact_bound_to_another_project_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    let reduced = record_var(
        "op-1",
        "proj2",
        "staging",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Project
        ))
    );
}

#[test]
fn a_fact_bound_to_another_environment_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "prod",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Environment
        ))
    );
}

#[test]
fn a_fact_bound_to_another_phase_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref-2",
        "fp",
        true,
        required_presence(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Phase
        ))
    );
}

#[test]
fn a_fact_bound_to_another_operation_ref_is_refused() {
    let clock = FixtureClock::new(100);
    let reduced = governed_record(required_presence());
    let fact = ValidatedOwnerPresenceFact::bind(
        presence(5, VALID_UNTIL, &clock),
        &reduced.binding.project,
        &reduced.binding.environment,
        reduced.binding.phase(),
        reduced.required_plan.as_ref(),
        &OperationRef::new("op-other").unwrap(),
        &reduced.binding.fingerprint,
        None,
    );
    assert_eq!(
        reduce(
            &reduced.to_request_with_clock(&clock),
            &full_facts(&reduced, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Operation
        ))
    );
}

#[test]
fn a_fact_bound_to_another_fingerprint_is_refused() {
    let owner = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        true,
        required_presence(),
    );
    let reduced = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp2",
        true,
        required_presence(),
    );
    assert_eq!(
        cross(&owner, &reduced),
        Disposition::Denied(DenialReason::OwnerPresenceFactMismatch(
            OwnerPresenceBinding::Fingerprint
        ))
    );
}

#[test]
fn a_proof_below_the_required_generation_is_refused() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(3, VALID_UNTIL, &clock), None);
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::StaleGeneration
        ))
    );
}

#[test]
fn a_changed_owner_presence_policy_changes_the_fingerprint() {
    let r1 = governed_record(required_presence());
    let mut r2p = required_presence();
    r2p.required_verifier = "webauthn".into();
    assert_ne!(
        r1.binding.fingerprint,
        governed_record(r2p).binding.fingerprint
    );
    let mut r3p = required_presence();
    r3p.min_generation = 9;
    assert_ne!(
        r1.binding.fingerprint,
        governed_record(r3p).binding.fingerprint
    );
}

// ---- TEMPORAL REPLAY: A1/A2/A3/A4/A11 ------------------------------------------------------------

#[test]
fn a1_reducer_refuses_the_lease_after_the_provider_advances_past_it() {
    // Proof established at reading 100, lease until 110. Provider advances to 111. There is NO retained
    // token — the reducer reads the CURRENT provider reading (111) and refuses the expired lease.
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &clock), None);
    let facts = full_facts(&record, Some(fact));
    // still current → eligible
    assert!(matches!(
        reduce(&record.to_request_with_clock(&clock), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
    clock.advance_to(111);
    assert_eq!(
        reduce(&record.to_request_with_clock(&clock), &facts),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::Expired
        ))
    );
}

#[test]
fn a2_a9_permit_refuses_after_the_provider_advances_past_the_lease() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, 110, &clock), &clock);
    // The SAME (stale) context revalidated against the CURRENT provider: current at 100, invalid at 111.
    assert!(permit.is_current(permit.context(), &clock));
    clock.advance_to(111);
    assert!(!permit.is_current(permit.context(), &clock));
    // Boundary: reading == valid_until is expired. A SEPARATE permit on its OWN provider (so provider
    // identity matches) advanced to exactly the lease bound proves the boundary, not a provider mismatch.
    let bclock = FixtureClock::new(100);
    let brecord = governed_record(required_presence());
    let bpermit = issued_permit(&brecord, presence(5, 110, &bclock), &bclock);
    assert!(bpermit.is_current(bpermit.context(), &bclock));
    bclock.advance_to(110);
    assert!(!bpermit.is_current(bpermit.context(), &bclock));
}

#[test]
fn a3_a_current_reading_reports_the_lease_expired() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &clock), None);
    clock.advance_to(110); // reading == valid_until → expired
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::Expired
        ))
    );
}

#[test]
fn a4_a12_a_provider_epoch_rollover_fails_closed() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    let facts = full_facts(&record, Some(fact));
    clock.next_epoch(105); // provider restart: epoch 1 -> 2, reading 105 (< valid_until)
    assert_eq!(
        reduce(&record.to_request_with_clock(&clock), &facts),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::EpochMismatch
        ))
    );
}

#[test]
fn a11_provider_identity_substitution_is_refused() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    let other_provider = FixtureClock::new(105);
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&other_provider),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::ProviderMismatch
        ))
    );
}

// ---- permit context revalidation (generation / proof identity) ----------------------------------

#[test]
fn a_permit_is_invalid_when_the_proof_generation_changes() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, VALID_UNTIL, &clock), &clock);
    let record2 = governed_record(required_presence());
    let ctx2 = match reduce(
        &record2.to_request_with_clock(&clock),
        &full_facts(
            &record2,
            Some(bind_fact(&record2, presence(6, VALID_UNTIL, &clock), None)),
        ),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert_eq!(
        permit.compare_context(&ctx2),
        ContextComparison::Mismatch(ContextField::OwnerPresenceGeneration)
    );
}

#[test]
fn a_permit_is_invalid_when_the_proof_identity_changes() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, VALID_UNTIL, &clock), &clock);
    let other = verify_owner_presence(
        &OwnerPresenceObservation {
            proof_id: "proof-2".into(),
            verifier: "hello".into(),
            observed_at: 0,
            valid_until: VALID_UNTIL,
            generation: 5,
        },
        &required_presence(),
        &clock.read_current(),
    )
    .unwrap();
    let record2 = governed_record(required_presence());
    let ctx2 = match reduce(
        &record2.to_request_with_clock(&clock),
        &full_facts(&record2, Some(bind_fact(&record2, other, None))),
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    };
    assert_eq!(
        permit.compare_context(&ctx2),
        ContextComparison::Mismatch(ContextField::OwnerPresenceProof)
    );
}

#[test]
fn no_owner_presence_proof_material_leaks_in_the_context() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, VALID_UNTIL, &clock), &clock);
    let s = format!("{:?}", permit.context());
    assert!(!s.contains("proof-1"));
}

// ---- CLOCK-TRAIT SEALING: S1..S10 (CD-B4-OWNER-PRESENCE-CLOCK-TRAIT-SEALING1A) --------------------
// S1  external impl of TrustedClock fails to compile        -> validator neg_external_impl_trusted_clock
// S2  a legitimate FixtureClock satisfies TrustedClock      -> s2_a_legitimate_fixture_clock_is_a_trusted_clock (below)
// S3  two handles share current state                       -> p1_two_handles_share_one_authoritative_reading
//                                                              + unit every_handle_shares_the_same_authoritative_state
// S4  retained handle observes the advance                  -> unit every_handle_shares_the_same_authoritative_state
// S5  reducer refuses expired lease via retained handle     -> p2_a_retained_handle_cannot_replay_an_expired_lease
// S6  permit revalidation fails via retained handle         -> p3_a_retained_handle_fails_permit_revalidation_after_advance
// S7  different legitimate provider -> ProviderMismatch      -> p5_substituting_a_different_provider_at_the_same_reading_is_refused
// S8  epoch rollover -> EpochMismatch                        -> a4_a12_a_provider_epoch_rollover_fails_closed / p6_...
// S9  no external type can forward/cache/return a reading    -> validator neg_external_replay_clock / neg_external_forwarding_wrapper
// S10 non-owner-presence op unaffected                       -> p9_a_non_owner_presence_operation_is_unaffected_by_the_provider

/// S2: a legitimate crate-controlled provider still satisfies the sealed trait and drives evaluation.
#[test]
fn s2_a_legitimate_fixture_clock_is_a_trusted_clock() {
    let clock = FixtureClock::new(100);
    let dynamic: &dyn TrustedClock = &clock; // still usable behind the sealed trait object
    let _ = dynamic;
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    assert!(matches!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, Some(fact))
        ),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- PROVIDER CURRENTNESS: P1..P9 (Model A — canonical shared provider) --------------------------
// The fixture provider is ONE authoritative shared state per identity. Every handle/clone reads that
// state, so a retained handle cannot lag; a provider identity is not caller-selectable, so no caller
// can fabricate a second provider with the same identity/epoch.

/// P1: two handles observe ONE authoritative reading — an advance through H2 is visible to H1, proven
/// through authority: a lease that is current under H1 flips to expired once H2 advances the state.
/// (The raw-value form — H1 reads 111 after H2 advances — is the in-crate unit test
/// `every_handle_shares_the_same_authoritative_state`; the `reading()` accessor is crate-private.)
#[test]
fn p1_two_handles_share_one_authoritative_reading() {
    let h1 = FixtureClock::new(100);
    let h2 = h1.handle();
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &h1), None);
    let facts = full_facts(&record, Some(fact));
    // Current under H1.
    assert!(matches!(
        reduce(&record.to_request_with_clock(&h1), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
    // Advance through H2; H1 (same shared state) now evaluates against the advanced reading.
    h2.advance_to(111);
    assert_eq!(
        reduce(&record.to_request_with_clock(&h1), &facts),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::Expired
        ))
    );
}

/// P2: a retained handle cannot replay a lease after another handle advances the shared state past it.
#[test]
fn p2_a_retained_handle_cannot_replay_an_expired_lease() {
    let h1 = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &h1), None);
    let facts = full_facts(&record, Some(fact));
    assert!(matches!(
        reduce(&record.to_request_with_clock(&h1), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
    // Advance the shared state through a DIFFERENT handle; the retained H1 observes it.
    h1.handle().advance_to(111);
    assert_eq!(
        reduce(&record.to_request_with_clock(&h1), &facts),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::Expired
        ))
    );
}

/// P3: permit revalidation through a retained handle fails once another handle advances the state.
#[test]
fn p3_a_retained_handle_fails_permit_revalidation_after_advance() {
    let h1 = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, 110, &h1), &h1);
    assert!(permit.is_current(permit.context(), &h1));
    h1.handle().advance_to(111);
    assert!(!permit.is_current(permit.context(), &h1));
}

/// P4: two independent providers cannot share an identity, so a duplicate (identity, epoch) is
/// structurally impossible — a proof minted under one is refused under another even at the same epoch.
#[test]
fn p4_two_providers_cannot_share_an_identity_or_epoch() {
    // Both are fresh providers at reading 100, epoch 1 — identical STATE but distinct identities
    // (identity is not caller-selectable). Distinctness is proven behaviorally: a proof minted under
    // `a` is refused under `b` on provider identity even though b's reading + epoch match. The
    // in-crate unit test `distinct_providers_have_distinct_identities` asserts the raw id inequality.
    let a = FixtureClock::new(100);
    let b = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &a), None);
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&b),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::ProviderMismatch
        ))
    );
}

/// P5: substituting a different provider reading the SAME value/epoch is refused on provider identity.
#[test]
fn p5_substituting_a_different_provider_at_the_same_reading_is_refused() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    let twin = FixtureClock::new(100); // same reading + epoch, different identity
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&twin),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::ProviderMismatch
        ))
    );
}

/// P5b: a permit revalidated through a SUBSTITUTED provider (different identity, same reading/epoch)
/// is not current — the permit binds the provider it was minted under.
#[test]
fn p5b_a_permit_is_not_current_under_a_substituted_provider() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let permit = issued_permit(&record, presence(5, VALID_UNTIL, &clock), &clock);
    assert!(permit.is_current(permit.context(), &clock));
    let twin = FixtureClock::new(100); // same reading + epoch, different identity
    assert!(!permit.is_current(permit.context(), &twin));
}

/// P6: a provider restart (epoch rollover) invalidates BOTH an old proof (reducer) and an old permit.
#[test]
fn p6_a_provider_restart_epoch_invalidates_proof_and_permit() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, VALID_UNTIL, &clock), None);
    let permit = issued_permit(&record, presence(5, VALID_UNTIL, &clock), &clock);
    clock.next_epoch(105); // restart: epoch 1 -> 2, reading 105 (still < valid_until)
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&clock),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::EpochMismatch
        ))
    );
    assert!(!permit.is_current(permit.context(), &clock));
}

/// P7: a request-scoped caller cannot select their own trusted provider to rescue an expired lease —
/// the substituted provider is a distinct identity and is refused before any reading is consulted.
#[test]
fn p7_a_caller_supplied_provider_cannot_rescue_an_expired_lease() {
    let clock = FixtureClock::new(100);
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &clock), None);
    clock.advance_to(115); // lease expired under the real provider
    let attacker = FixtureClock::new(100); // attacker's own provider, reading within the lease
    assert_eq!(
        reduce(
            &record.to_request_with_clock(&attacker),
            &full_facts(&record, Some(fact))
        ),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::ProviderMismatch
        ))
    );
}

/// P8: a cloned provider shares the SAME authoritative state, so a "stale" clone cannot preserve an
/// old lease — it observes the advance the same as every other handle.
#[test]
fn p8_a_cloned_provider_shares_state_and_cannot_preserve_authority() {
    let clock = FixtureClock::new(100);
    let stale = clock.clone(); // Clone shares the SAME Rc<ClockState>
    let record = governed_record(required_presence());
    let fact = bind_fact(&record, presence(5, 110, &clock), None);
    let facts = full_facts(&record, Some(fact));
    assert!(matches!(
        reduce(&record.to_request_with_clock(&stale), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
    clock.advance_to(111);
    assert_eq!(
        reduce(&record.to_request_with_clock(&stale), &facts),
        Disposition::Denied(DenialReason::OwnerPresencePolicyRefused(
            OwnerPresenceError::Expired
        ))
    );
}

/// P9: an operation that does not require owner presence is unaffected by the provider entirely.
#[test]
fn p9_a_non_owner_presence_operation_is_unaffected_by_the_provider() {
    let record = record_var(
        "op-1",
        "proj",
        "staging",
        "phase-ref",
        "fp",
        false,
        required_presence(),
    );
    // No clock supplied at all — still eligible.
    assert!(matches!(
        reduce(&record.to_request(), &full_facts(&record, None)),
        Disposition::EligibleForServiceExecution(_)
    ));
}
