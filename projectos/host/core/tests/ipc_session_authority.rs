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
    BoundIpcSession, ChannelCapability, ConfirmedHandshakeEvidence, ExpectedChannel, ExpectedPeer,
    FixtureClock, FixtureIpcSessionVerifier, FixtureRuntimeInstanceVerifier, HostRole,
    IpcPeerObservation, IpcSessionError, IpcSessionVerifier, OperationFamily, PeerUserClass,
    RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock,
    VerifiedAuthorityTime, VerifiedRuntimeInstance,
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
