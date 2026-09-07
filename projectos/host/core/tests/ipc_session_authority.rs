//! Authenticated IPC-session authority proof (CD-B4-IPC-SESSION-AUTHORITY1A).
//!
//! One authenticated connection mints exactly one opaque [`BoundIpcSession`] through the sealed fixture
//! verifier, bound to the trusted runtime instance, the confirmed peer, the channel and the repository.
//! Reconnection, re-handshake, runtime restart, provider substitution/epoch restart, PID reuse, wrong
//! user/session/project/environment/phase/repository, expiry, disconnect, revocation, and expanded
//! capability/family are all refused fail-closed. A confirmed handshake alone is never authority. No
//! permit/grant integration exists in this phase. Type-forgery properties are proven by the validator.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    AdmittedRequest, BoundIpcSession, ChannelCapability, ConfirmedHandshakeEvidence,
    ExpectedChannel, ExpectedPeer, FixtureClock, FixtureIpcSessionVerifier,
    FixtureRuntimeInstanceVerifier, HostRole, InMemoryRequestAdmissionStore, IpcPeerObservation,
    IpcSessionError, IpcSessionVerifier, OperationFamily, PeerUserClass, RequestAdmissionError,
    RequestAdmissionStore, RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource,
    SessionId, TrustedClock, VerifiedAuthorityTime, VerifiedRuntimeInstance,
    MAX_REMEMBERED_CORRELATIONS, REQUEST_CORRELATION_LEN,
};
use projectos_trust_contract::{EnvironmentId, ProjectId};

const PID: u32 = 7000;
const TICK: u64 = 123;
const PHASE: [u8; 32] = [7u8; 32];
const REPO_ID: [u8; 32] = [9u8; 32];
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

fn obs_for(v: &FixtureIpcSessionVerifier) -> IpcPeerObservation {
    IpcPeerObservation {
        connection_id: v.connection_id(),
        handshake_generation: v.handshake_generation(),
        client_pid: PID,
        client_creation_tick: TICK,
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
    }
}

fn hs(v: &FixtureIpcSessionVerifier) -> ConfirmedHandshakeEvidence {
    ConfirmedHandshakeEvidence::confirmed(v.handshake_generation())
}

fn mint(
    c: &FixtureClock,
    rv: &FixtureRuntimeInstanceVerifier,
    v: &FixtureIpcSessionVerifier,
) -> BoundIpcSession {
    let rt = runtime(c, rv);
    v.verify(&rt, hs(v), &obs_for(v), &now(c)).unwrap()
}

fn peer_ok() -> ExpectedPeer {
    ExpectedPeer {
        pid: PID,
        creation_tick: TICK,
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
    }
}
fn channel_ok() -> ExpectedChannel {
    ExpectedChannel {
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        phase_digest: PHASE,
        repository_identity: REPO_ID,
        repository_baseline: REPO_BASE,
    }
}

// I1 — valid handshake + observation mints one session.
#[test]
fn i1_valid_mints_one_session() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let rt = runtime(&c, &rv);
    // runtime rebuilt from same verifier -> same generation/digest -> current.
    s.is_current(&v, &rt, &now(&c)).unwrap();
}

// I3 — ConfirmedIpcPeerHandshake evidence, if unconfirmed, is not authority.
#[test]
fn i3_unconfirmed_handshake_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let unconfirmed = ConfirmedHandshakeEvidence::unconfirmed(v.handshake_generation());
    assert_eq!(
        v.verify(&rt, unconfirmed, &obs_for(&v), &now(&c))
            .unwrap_err(),
        IpcSessionError::HandshakeNotConfirmed
    );
}

// I4 — same live connection + current verifier accepted.
#[test]
fn i4_same_connection_current() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    assert!(s.is_current(&v, &runtime(&c, &rv), &now(&c)).is_ok());
}

// I5 — a different connection is refused.
#[test]
fn i5_different_connection_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let other = FixtureIpcSessionVerifier::new();
    assert_eq!(
        s.is_current(&other, &runtime(&c, &rv), &now(&c))
            .unwrap_err(),
        IpcSessionError::ConnectionMismatch
    );
}

// I6 — reconnect cannot reuse the prior session.
#[test]
fn i6_reconnect_cannot_reuse() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    v.reconnect();
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::ConnectionMismatch
    );
}

// I7 — handshake generation mismatch refused (re-handshake on the same connection).
#[test]
fn i7_handshake_generation_mismatch_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    v.advance_handshake();
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::HandshakeGenerationMismatch
    );
}

// I8 — runtime-instance generation mismatch refused.
#[test]
fn i8_runtime_mismatch_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    rv.restart();
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::RuntimeInstanceMismatch
    );
}

// I9 — IPC-provider identity substitution refused.
#[test]
fn i9_provider_substitution_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let other_clock = FixtureClock::new(150);
    // runtime must match the session; rebuild it under the SAME runtime verifier but the substituted
    // clock still fails on provider identity first.
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&other_clock))
            .unwrap_err(),
        IpcSessionError::ProviderMismatch
    );
}

// I10 — IPC-provider epoch restart refused.
#[test]
fn i10_provider_epoch_restart_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    c.next_epoch(150);
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::ProviderEpochMismatch
    );
}

// I11/I12 — peer process mismatch / pid reuse (different creation tick) refused.
#[test]
fn i11_i12_peer_process_mismatch_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    s.matches_peer(&peer_ok()).unwrap();
    let mut wrong_pid = peer_ok();
    wrong_pid.pid = PID + 1;
    assert_eq!(
        s.matches_peer(&wrong_pid).unwrap_err(),
        IpcSessionError::PeerProcessMismatch
    );
    let mut reused = peer_ok();
    reused.creation_tick = TICK + 1;
    assert_eq!(
        s.matches_peer(&reused).unwrap_err(),
        IpcSessionError::PeerProcessMismatch
    );
}

// I13 — wrong peer user refused.
#[test]
fn i13_wrong_user_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut wrong = peer_ok();
    wrong.user = PeerUserClass::Other;
    assert_eq!(
        s.matches_peer(&wrong).unwrap_err(),
        IpcSessionError::PeerUserMismatch
    );
}

// I14 — wrong session refused.
#[test]
fn i14_wrong_session_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut wrong = peer_ok();
    wrong.session = Some(SessionId::new("other-sess"));
    assert_eq!(
        s.matches_peer(&wrong).unwrap_err(),
        IpcSessionError::PeerSessionMismatch
    );
}

// I15/I16/I17 — wrong project / environment / phase refused.
#[test]
fn i15_i16_i17_channel_mismatch_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    s.matches_channel(&channel_ok()).unwrap();
    let mut wp = channel_ok();
    wp.project = ProjectId::new("proj2").unwrap();
    assert_eq!(
        s.matches_channel(&wp).unwrap_err(),
        IpcSessionError::ProjectMismatch
    );
    let mut we = channel_ok();
    we.environment = EnvironmentId::new("prod").unwrap();
    assert_eq!(
        s.matches_channel(&we).unwrap_err(),
        IpcSessionError::EnvironmentMismatch
    );
    let mut wph = channel_ok();
    wph.phase_digest = [0u8; 32];
    assert_eq!(
        s.matches_channel(&wph).unwrap_err(),
        IpcSessionError::PhaseMismatch
    );
}

// I18/I19 — wrong repository identity / baseline refused.
#[test]
fn i18_i19_repository_mismatch_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut wi = channel_ok();
    wi.repository_identity = [0u8; 32];
    assert_eq!(
        s.matches_channel(&wi).unwrap_err(),
        IpcSessionError::RepositoryIdentityMismatch
    );
    let mut wb = channel_ok();
    wb.repository_baseline = [0u8; 32];
    assert_eq!(
        s.matches_channel(&wb).unwrap_err(),
        IpcSessionError::RepositoryBaselineMismatch
    );
}

// I20 — expired session refused.
#[test]
fn i20_expired_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    c.advance_to(5_000);
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::Expired
    );
}

// I21 — disconnected session refused.
#[test]
fn i21_disconnected_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    v.disconnect();
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::Disconnected
    );
}

// I22 — revoked session refused.
#[test]
fn i22_revoked_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    v.revoke();
    assert_eq!(
        s.is_current(&v, &runtime(&c, &rv), &now(&c)).unwrap_err(),
        IpcSessionError::Revoked
    );
}

// I23 — excessive requested validity refused at mint.
#[test]
fn i23_excessive_validity_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let mut o = obs_for(&v);
    o.valid_until = 150 + 10_001; // > now + max_window
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::ExpiryBeyondBound
    );
}

// I24 — an expanded channel capability is refused.
#[test]
fn i24_capability_not_permitted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v); // bound to RecordMarker only
    s.permits_capability(ChannelCapability::RecordMarker)
        .unwrap();
    assert_eq!(
        s.permits_capability(ChannelCapability::ObserveOnly)
            .unwrap_err(),
        IpcSessionError::CapabilityNotPermitted
    );
}

// I25 — an expanded operation family is refused.
#[test]
fn i25_family_not_permitted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    s.permits_family(OperationFamily::RecordMarker).unwrap();
    assert_eq!(
        s.permits_family(OperationFamily::ReservedNoAdapter)
            .unwrap_err(),
        IpcSessionError::OperationFamilyNotPermitted
    );
}

// A requested capability outside the verifier bound is refused at mint.
#[test]
fn unbounded_capability_refused_at_mint() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let mut o = obs_for(&v);
    o.operation_families = vec![OperationFamily::ReservedNoAdapter]; // verifier permits only RecordMarker
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::OperationFamilyUnbounded
    );
}

// PROJECTOSHOST-IPC-SESSION-VERIFIER1A — mint-level currentness refusals that only had
// is_current-level proofs before this phase. No new primitive: these pin the EXISTING mint checks.

// A runtime instance whose own validity window has elapsed cannot anchor a NEW session, even though
// its generation and digest still match (distinct from I8's restart/mismatch case).
#[test]
fn sv1_expired_runtime_instance_refuses_mint() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv); // valid_until = 9_000
    c.advance_to(9_000); // exactly at runtime expiry — inclusive refusal
    let mut o = obs_for(&v);
    o.observed_at = 9_000;
    o.valid_until = 9_500;
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::RuntimeNotCurrent
    );
}

// An inverted or empty validity window never mints (valid_until <= observed_at).
#[test]
fn sv2_invalid_proof_window_refuses_mint() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    let mut o = obs_for(&v);
    o.valid_until = o.observed_at; // empty window
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::ProofWindowInvalid
    );
    o.valid_until = o.observed_at - 1; // inverted window
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::ProofWindowInvalid
    );
}

// An observation whose validity already elapsed refuses at MINT (distinct from I20, which proves the
// same fact for an already-minted session's currentness).
#[test]
fn sv3_already_expired_observation_refuses_mint() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let rt = runtime(&c, &rv);
    c.advance_to(5_000); // observation window (valid_until = 5_000) has elapsed — inclusive refusal
    let mut o = obs_for(&v);
    o.observed_at = 4_999;
    assert_eq!(
        v.verify(&rt, hs(&v), &o, &now(&c)).unwrap_err(),
        IpcSessionError::Expired
    );
}

// I29 — Debug never leaks sensitive peer evidence.
#[test]
fn i29_debug_redacted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let out = format!("{s:?}");
    assert!(out.contains("[REDACTED]"));
    assert!(!out.contains("peer-sess"));
    assert!(!out.contains("7000"));
    // handshake evidence is redacted too.
    let ev = ConfirmedHandshakeEvidence::confirmed(1);
    assert!(format!("{ev:?}").contains("[REDACTED]"));
}

// ---------------------------------------------------------------------------------------------
// REQUEST ADMISSION (RUN-TO-COMPLETION HOST ATTESTATION - OPERATION AUTHORITY + REQUEST BINDING)
//
// The session already refuses a wrong connection, a re-handshake and a restart above. These prove
// the per-REQUEST layer: the sequence must advance, a correlation is admitted once, the store
// belongs to one session, and the bound is a refusal rather than an eviction.
// ---------------------------------------------------------------------------------------------

fn corr(tag: u8) -> [u8; REQUEST_CORRELATION_LEN] {
    [tag; REQUEST_CORRELATION_LEN]
}

#[test]
fn an_advancing_sequence_with_a_fresh_correlation_is_admitted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    let first = s.admit_request(&mut store, corr(1), 1).unwrap();
    assert!(first.answers(&corr(1), v.connection_id(), v.handshake_generation()));
    assert_eq!(first.sequence(), 1);

    // A later request on the same session is admitted too.
    let second = s.admit_request(&mut store, corr(2), 2).unwrap();
    assert_eq!(second.sequence(), 2);
}

#[test]
fn a_repeated_sequence_is_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    s.admit_request(&mut store, corr(1), 5).unwrap();
    // Same sequence, DIFFERENT correlation: the sequence rule alone must refuse it.
    assert_eq!(
        s.admit_request(&mut store, corr(2), 5).unwrap_err(),
        RequestAdmissionError::SequenceNotAdvancing
    );
}

#[test]
fn a_stale_sequence_is_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    s.admit_request(&mut store, corr(1), 10).unwrap();
    assert_eq!(
        s.admit_request(&mut store, corr(2), 9).unwrap_err(),
        RequestAdmissionError::SequenceNotAdvancing
    );
}

#[test]
fn a_replayed_correlation_is_refused_even_with_an_advancing_sequence() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    s.admit_request(&mut store, corr(7), 1).unwrap();
    assert_eq!(
        s.admit_request(&mut store, corr(7), 2).unwrap_err(),
        RequestAdmissionError::CorrelationReplayed
    );
}

#[test]
fn a_store_from_another_session_is_refused() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v1 = FixtureIpcSessionVerifier::new();
    let v2 = FixtureIpcSessionVerifier::new();
    let s1 = mint(&c, &rv, &v1);
    let s2 = mint(&c, &rv, &v2);

    let mut foreign = InMemoryRequestAdmissionStore::for_session(&s2);
    assert_eq!(
        s1.admit_request(&mut foreign, corr(1), 1).unwrap_err(),
        RequestAdmissionError::StoreNotBoundToSession
    );
}

#[test]
fn a_refused_request_records_nothing() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    s.admit_request(&mut store, corr(1), 5).unwrap();
    // Refused on the sequence rule.
    assert!(s.admit_request(&mut store, corr(3), 4).is_err());
    // The refused correlation was NOT remembered, so the same tag still works later. A refusal that
    // recorded its subject would let a hostile caller burn a correlation the legitimate one needs.
    assert!(s.admit_request(&mut store, corr(3), 6).is_ok());
}

#[test]
fn the_correlation_bound_refuses_rather_than_forgetting() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    for i in 0..MAX_REMEMBERED_CORRELATIONS {
        let mut tag = [0u8; REQUEST_CORRELATION_LEN];
        tag[0..8].copy_from_slice(&(i as u64).to_be_bytes());
        s.admit_request(&mut store, tag, i as u64 + 1).unwrap();
    }
    let mut over = [0xFFu8; REQUEST_CORRELATION_LEN];
    over[0] = 1;
    assert_eq!(
        s.admit_request(&mut store, over, MAX_REMEMBERED_CORRELATIONS as u64 + 1)
            .unwrap_err(),
        RequestAdmissionError::AdmissionCapacityExhausted
    );
    // And the earliest correlation is still remembered - the bound did not evict a replay window open.
    let mut first = [0u8; REQUEST_CORRELATION_LEN];
    first[0..8].copy_from_slice(&0u64.to_be_bytes());
    assert!(store.is_correlation_seen(&first));
}

#[test]
fn an_admission_does_not_answer_another_connection() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    let a = s.admit_request(&mut store, corr(1), 1).unwrap();
    assert!(!a.answers(&corr(1), v.connection_id() + 1, v.handshake_generation()));
    assert!(!a.answers(&corr(1), v.connection_id(), v.handshake_generation() + 1));
    assert!(!a.answers(&corr(2), v.connection_id(), v.handshake_generation()));
}

#[test]
fn the_admission_mint_takes_no_connection_identity_from_the_caller() {
    // Pinning the exact signature IS the proof: there is no parameter through which a caller could
    // hand in a connection id or a handshake generation, so the identity stamped on an admission can
    // only ever be the session's own private one. Adding such a parameter fails this line.
    let _mint: fn(
        &BoundIpcSession,
        &mut InMemoryRequestAdmissionStore,
        [u8; REQUEST_CORRELATION_LEN],
        u64,
    ) -> Result<AdmittedRequest, RequestAdmissionError> =
        BoundIpcSession::admit_request::<InMemoryRequestAdmissionStore>;
}

#[test]
fn an_admission_grants_no_operation_authority() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v); // bound to RecordMarker capability + family only
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    let admitted = s.admit_request(&mut store, corr(1), 1).unwrap();
    assert!(admitted.answers(&corr(1), v.connection_id(), v.handshake_generation()));

    // Every gate the session enforces answers EXACTLY as it did before the admission. A capability
    // and a family the session never bound are still refused; an admission did not widen either.
    assert_eq!(
        s.permits_capability(ChannelCapability::ObserveOnly)
            .unwrap_err(),
        IpcSessionError::CapabilityNotPermitted
    );
    assert_eq!(
        s.permits_family(OperationFamily::ReservedNoAdapter)
            .unwrap_err(),
        IpcSessionError::OperationFamilyNotPermitted
    );
    // And currentness is untouched: once the connection is gone, the session is refused regardless
    // of how many requests it admitted while alive. The admission is not a substitute for the check.
    v.reconnect();
    let rt = runtime(&c, &rv);
    assert!(s.is_current(&v, &rt, &now(&c)).is_err());
}

#[test]
fn a_direct_store_write_cannot_rewind_the_sequence_or_repeat_a_correlation() {
    // `record` is public on a public trait, so it is reachable without the mint. It must refuse the
    // same things the mint refuses - otherwise a direct write with a lower number would rewind the
    // watermark and reopen every sequence beneath it.
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    s.admit_request(&mut store, corr(1), 5).unwrap();
    assert_eq!(
        store.record(4, corr(9)).unwrap_err(),
        RequestAdmissionError::SequenceNotAdvancing
    );
    assert_eq!(
        store.record(5, corr(9)).unwrap_err(),
        RequestAdmissionError::SequenceNotAdvancing
    );
    assert_eq!(
        store.record(6, corr(1)).unwrap_err(),
        RequestAdmissionError::CorrelationReplayed
    );
    // Nothing moved, and the refused tag was not remembered.
    assert_eq!(store.last_sequence(), 5);
    assert!(!store.is_correlation_seen(&corr(9)));
    // The watermark still stands for the mint too.
    assert_eq!(
        s.admit_request(&mut store, corr(2), 5).unwrap_err(),
        RequestAdmissionError::SequenceNotAdvancing
    );
}

#[test]
fn an_admission_debug_is_redacted() {
    let c = FixtureClock::new(150);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let v = FixtureIpcSessionVerifier::new();
    let s = mint(&c, &rv, &v);
    let mut store = InMemoryRequestAdmissionStore::for_session(&s);

    let admitted = s.admit_request(&mut store, corr(1), 1).unwrap();
    let shown = format!("{admitted:?}");
    assert!(shown.contains("[REDACTED]"));
    assert!(!shown.contains(&v.connection_id().to_string()));
    // The store redacts too: no digest, no remembered tag - only counts.
    let store_shown = format!("{store:?}");
    assert!(store_shown.contains("[REDACTED]"));
    assert!(store_shown.contains("remembered=1"));
    assert!(!store_shown.contains("[1, 1, 1"));
}
