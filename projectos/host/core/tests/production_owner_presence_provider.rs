//! Production owner-presence provider proof (CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A, Option C1).
//!
//! Production `VerifiedOwnerPresence` is minted ONLY by `verify_production_owner_presence`, which
//! move-consumes a `ProductionOwnerPresenceBindingGrant` issued ONLY by the sealed
//! `ProductionOwnerPresenceCapability` from `Production`-sourced, confirmed evidence bound to the exact
//! operation, display summary, runtime instance, IPC session, provider identity, provider epoch and
//! validity window. Fixture-sourced evidence, refusal, cancellation, a wrong operation/summary/runtime/
//! IPC/provider/epoch, an invalid or expired window, and a malformed identifier are all refused
//! fail-closed. Single-use (replay) and no-public-construction/no-caller-mint/no-elevation/no-effect
//! properties are proven at compile time by the validator. No machine or protected effect occurs.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    verify_owner_presence, verify_production_owner_presence, BoundIpcSession, ChannelCapability,
    ConfirmedHandshakeEvidence, ExpiryBoundary, FixtureClock, FixtureIpcSessionVerifier,
    FixtureRuntimeInstanceVerifier, HostRole, InstallationId, InternalOperationRecord,
    IpcPeerObservation, IpcSessionVerifier, OperationFamily, OperationInputs,
    OwnerConfirmationOutcome, OwnerPresenceError, OwnerPresenceEvidenceSource,
    OwnerPresenceObservation, PeerUserClass, PhaseReference, ProductionOwnerPresenceBindingGrant,
    ProductionOwnerPresenceCapability, ProductionOwnerPresenceEvidence, RecordPolicy, ReleaseId,
    RepositoryRef, RequiredOwnerPresence, ResumePolicy, RuntimeInstanceObservation,
    RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock, ValidatedOwnerPresenceFact,
    VerifiedAuthorityTime, VerifiedRuntimeInstance,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const OP: [u8; 32] = [1u8; 32];
const SUMMARY: [u8; 32] = [2u8; 32];
const OTHER: [u8; 32] = [9u8; 32];
const PHASE: [u8; 32] = [7u8; 32];
const REPO_ID: [u8; 32] = [10u8; 32];
const REPO_BASE: [u8; 32] = [11u8; 32];

fn now(c: &FixtureClock) -> VerifiedAuthorityTime {
    c.read_current()
}

fn runtime(c: &FixtureClock, rv: &FixtureRuntimeInstanceVerifier) -> VerifiedRuntimeInstance {
    let obs = RuntimeInstanceObservation {
        role: HostRole::InteractiveFallback,
        source: RuntimeSource::InteractiveFallback,
        pid: 4242,
        creation_tick: 999,
        session: Some(SessionId::new("host-sess")),
        observed_at: 50,
        valid_until: 9_000,
        service_evidence: None,
    };
    rv.verify(&obs, &now(c)).unwrap()
}

fn ipc(
    c: &FixtureClock,
    rv: &FixtureRuntimeInstanceVerifier,
    v: &FixtureIpcSessionVerifier,
) -> BoundIpcSession {
    let rt = runtime(c, rv);
    let obs = IpcPeerObservation {
        connection_id: v.connection_id(),
        handshake_generation: v.handshake_generation(),
        client_pid: 7000,
        client_creation_tick: 123,
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        phase_digest: PHASE,
        repository_identity: REPO_ID,
        repository_baseline: REPO_BASE,
        observed_at: 100,
        valid_until: 5_000,
        capabilities: vec![ChannelCapability::RecordMarker],
        operation_families: vec![OperationFamily::RecordMarker],
    };
    let hs = ConfirmedHandshakeEvidence::confirmed(v.handshake_generation());
    v.verify(&rt, hs, &obs, &now(c)).unwrap()
}

fn required() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "hello".into(),
        min_generation: 5,
    }
}

fn evidence(
    source: OwnerPresenceEvidenceSource,
    outcome: OwnerConfirmationOutcome,
) -> ProductionOwnerPresenceEvidence {
    ProductionOwnerPresenceEvidence {
        source,
        outcome,
        observation: OwnerPresenceObservation {
            proof_id: "proof-secret-1".into(),
            verifier: "hello".into(),
            observed_at: 100,
            valid_until: 5_000,
            generation: 5,
        },
        confirmation_nonce: "nonce-secret-1".into(),
        operation_digest: OP,
        display_summary_digest: SUMMARY,
    }
}

fn confirmed() -> ProductionOwnerPresenceEvidence {
    evidence(
        OwnerPresenceEvidenceSource::Production,
        OwnerConfirmationOutcome::Confirmed,
    )
}

/// Issue a valid production grant bound to the given clock/runtime/ipc.
fn grant(
    c: &FixtureClock,
    rv: &FixtureRuntimeInstanceVerifier,
    v: &FixtureIpcSessionVerifier,
) -> ProductionOwnerPresenceBindingGrant {
    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    cap.issue(
        &confirmed(),
        &runtime(c, rv),
        &ipc(c, rv, v),
        &now(c),
        &required(),
    )
    .unwrap()
}

// T1 — a confirmed, Production-sourced, fully-bound evidence issues a grant that mints presence.
#[test]
fn t1_valid_production_flow_mints_presence() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    assert!(
        verify_production_owner_presence(
            g,
            OP,
            SUMMARY,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c)
        )
        .is_ok(),
        "a fully-bound, confirmed, Production-sourced grant must mint presence"
    );
}

// T2 — owner refusal issues no grant.
#[test]
fn t2_refusal_mints_nothing() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    let ev = evidence(
        OwnerPresenceEvidenceSource::Production,
        OwnerConfirmationOutcome::Refused,
    );
    assert_eq!(
        cap.issue(
            &ev,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c),
            &required()
        )
        .err(),
        Some(OwnerPresenceError::Refused)
    );
}

// T3 — owner cancellation issues no grant.
#[test]
fn t3_cancellation_mints_nothing() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    let ev = evidence(
        OwnerPresenceEvidenceSource::Production,
        OwnerConfirmationOutcome::Cancelled,
    );
    assert_eq!(
        cap.issue(
            &ev,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c),
            &required()
        )
        .err(),
        Some(OwnerPresenceError::Cancelled)
    );
}

// T4 — an expired validity window at mint time refuses.
#[test]
fn t4_expired_at_mint_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let ip = ipc(&c, &rv, &v);
    let g = grant(&c, &rv, &v);
    c.advance_to(5_000); // now == grant.valid_until
    assert_eq!(
        verify_production_owner_presence(g, OP, SUMMARY, &rt, &ip, &now(&c)).err(),
        Some(OwnerPresenceError::Expired)
    );
}

// T7 — a changed operation digest after confirmation refuses.
#[test]
fn t7_wrong_operation_digest_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    assert_eq!(
        verify_production_owner_presence(
            g,
            OTHER,
            SUMMARY,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c)
        )
        .err(),
        Some(OwnerPresenceError::OperationMismatch)
    );
}

// T8 — a changed display-summary digest after confirmation refuses.
#[test]
fn t8_wrong_display_summary_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    assert_eq!(
        verify_production_owner_presence(
            g,
            OP,
            OTHER,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c)
        )
        .err(),
        Some(OwnerPresenceError::DisplaySummaryMismatch)
    );
}

// T9 — a different runtime instance at mint refuses (cross-runtime replay).
#[test]
fn t9_wrong_runtime_instance_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    let rv_other = FixtureRuntimeInstanceVerifier::new();
    let runtime_other = runtime(&c, &rv_other);
    assert_eq!(
        verify_production_owner_presence(
            g,
            OP,
            SUMMARY,
            &runtime_other,
            &ipc(&c, &rv, &v),
            &now(&c)
        )
        .err(),
        Some(OwnerPresenceError::RuntimeMismatch)
    );
}

// T10 — a different IPC session at mint refuses (cross-session replay).
#[test]
fn t10_wrong_ipc_session_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    let v_other = FixtureIpcSessionVerifier::new();
    let ipc_other = ipc(&c, &rv, &v_other);
    assert_eq!(
        verify_production_owner_presence(g, OP, SUMMARY, &runtime(&c, &rv), &ipc_other, &now(&c))
            .err(),
        Some(OwnerPresenceError::IpcSessionMismatch)
    );
}

// T11 — a current reading from a DIFFERENT clock provider refuses (provider substitution).
#[test]
fn t11_provider_mismatch_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let ip = ipc(&c, &rv, &v);
    let g = grant(&c, &rv, &v);
    let c_other = FixtureClock::new(150); // distinct, non-caller-selectable provider identity
    assert_eq!(
        verify_production_owner_presence(g, OP, SUMMARY, &rt, &ip, &now(&c_other)).err(),
        Some(OwnerPresenceError::ProviderMismatch)
    );
}

// T12 — a later provider epoch (restart / rollover) refuses.
#[test]
fn t12_epoch_mismatch_refuses() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let ip = ipc(&c, &rv, &v);
    let g = grant(&c, &rv, &v);
    c.next_epoch(150); // same provider, next epoch
    assert_eq!(
        verify_production_owner_presence(g, OP, SUMMARY, &rt, &ip, &now(&c)).err(),
        Some(OwnerPresenceError::EpochMismatch)
    );
}

// OP4 / T23 (runtime side) — fixture-sourced evidence never issues a production grant.
#[test]
fn fixture_sourced_evidence_is_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    let ev = evidence(
        OwnerPresenceEvidenceSource::Fixture,
        OwnerConfirmationOutcome::Confirmed,
    );
    assert_eq!(
        cap.issue(
            &ev,
            &runtime(&c, &rv),
            &ipc(&c, &rv, &v),
            &now(&c),
            &required()
        )
        .err(),
        Some(OwnerPresenceError::FixtureSource)
    );
}

// Policy re-checks at issuance: wrong verifier, stale generation, invalid/expired window, malformed id.
#[test]
fn issuance_policy_refusals() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    let rt = runtime(&c, &rv);
    let ip = ipc(&c, &rv, &v);

    // Wrong verifier.
    let mut ev = confirmed();
    ev.observation.verifier = "webauthn".into();
    assert_eq!(
        cap.issue(&ev, &rt, &ip, &now(&c), &required()).err(),
        Some(OwnerPresenceError::VerifierMismatch)
    );

    // Stale generation.
    let mut hi = required();
    hi.min_generation = 6;
    assert_eq!(
        cap.issue(&confirmed(), &rt, &ip, &now(&c), &hi).err(),
        Some(OwnerPresenceError::StaleGeneration)
    );

    // Invalid window (valid_until <= observed_at).
    let mut ev = confirmed();
    ev.observation.valid_until = ev.observation.observed_at;
    assert_eq!(
        cap.issue(&ev, &rt, &ip, &now(&c), &required()).err(),
        Some(OwnerPresenceError::ProofWindowInvalid)
    );

    // Expired at issuance (now >= valid_until).
    let c_late = FixtureClock::new(5_000);
    assert_eq!(
        cap.issue(&confirmed(), &rt, &ip, &now(&c_late), &required())
            .err(),
        Some(OwnerPresenceError::Expired)
    );

    // Malformed nonce.
    let mut ev = confirmed();
    ev.confirmation_nonce = String::new();
    assert_eq!(
        cap.issue(&ev, &rt, &ip, &now(&c), &required()).err(),
        Some(OwnerPresenceError::Malformed)
    );
}

// T16 — Debug of the grant and evidence never renders the raw nonce / proof id / digest bytes.
#[test]
fn t16_debug_is_redacted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    let gs = format!("{g:?}");
    assert!(gs.contains("[REDACTED]"));
    assert!(!gs.contains("proof-secret-1"));
    assert!(!gs.contains("nonce-secret-1"));

    let es = format!("{:?}", confirmed());
    assert!(es.contains("[REDACTED]"));
    assert!(!es.contains("proof-secret-1"));
    assert!(!es.contains("nonce-secret-1"));

    let cap = ProductionOwnerPresenceCapability::for_local_proof();
    assert!(format!("{cap:?}").contains("[REDACTED]"));
}

// T17 — refusal errors are payload-free (no secret material in Debug).
#[test]
fn t17_errors_are_payload_free() {
    for e in [
        OwnerPresenceError::Refused,
        OwnerPresenceError::Cancelled,
        OwnerPresenceError::FixtureSource,
        OwnerPresenceError::OperationMismatch,
        OwnerPresenceError::DisplaySummaryMismatch,
        OwnerPresenceError::RuntimeMismatch,
        OwnerPresenceError::IpcSessionMismatch,
        OwnerPresenceError::ProviderMismatch,
        OwnerPresenceError::EpochMismatch,
        OwnerPresenceError::Expired,
    ] {
        let s = format!("{e:?}");
        assert!(!s.contains("proof-secret-1"));
        assert!(!s.contains("nonce-secret-1"));
        assert!(!s.is_empty());
    }
}

// T18 — the pre-existing fixture/contract verifier still mints (no regression to the closed contract).
#[test]
fn t18_fixture_contract_verifier_still_works() {
    let c = FixtureClock::new(150);
    let obs = OwnerPresenceObservation {
        proof_id: "proof-1".into(),
        verifier: "hello".into(),
        observed_at: 100,
        valid_until: 200,
        generation: 5,
    };
    assert!(verify_owner_presence(&obs, &required(), &now(&c)).is_ok());
}

// A minimal operation record — the only public source of an operation-bound `PhaseId` (its mint is
// crate-private), used to bind a production presence through the real fact constructor.
fn op_record() -> InternalOperationRecord {
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
}

// PT2 — a production-minted (grant-gated) presence is accepted by the operation-bound fact constructor.
#[test]
fn pt2_production_presence_binds_to_a_fact() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let g = grant(&c, &rv, &v);
    let presence = verify_production_owner_presence(
        g,
        OP,
        SUMMARY,
        &runtime(&c, &rv),
        &ipc(&c, &rv, &v),
        &now(&c),
    )
    .unwrap();
    let r = op_record();
    let _fact: ValidatedOwnerPresenceFact = ValidatedOwnerPresenceFact::bind(
        presence,
        &r.binding.project,
        &r.binding.environment,
        r.binding.phase(),
        r.required_plan.as_ref(),
        &r.operation_ref,
        &r.binding.fingerprint,
        None,
    );
}
