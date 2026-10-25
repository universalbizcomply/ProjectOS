//! Production IPC-provider behaviour (CD-B4-PRODUCTION-IPC-PROVIDER1A).
//!
//! Exercises the sealed [`ProductionIpcSessionVerifier`] with FIXTURE evidence built directly in-crate
//! (no Windows transport): the I-matrix. The cross-crate Level-2 end-to-end proof (windows same-connection
//! bundle → core projection → this verifier → `BoundIpcSession`) lives in the `windows-local-ipc` crate.
//! The compile-failure half (verifier/bundle construction, evidence→authority, fixture/default-graph
//! exclusion, `mint` privacy) is proven by `val-cd-b4-production-ipc-provider1a.cjs`.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    bind_production_clock, fixture_production_clock_binding_grant, ChannelCapability,
    ConfirmedHandshakeEvidence, FixtureMonotonicTickSource, FixtureRuntimeInstanceVerifier,
    HostRole, IpcPeerObservation, IpcSessionError, IpcSessionVerifier, OperationFamily,
    PeerUserClass, ProductionIpcSessionVerifier, ProductionTrustedClock,
    RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock,
    VerifiedRuntimeInstance,
};
use projectos_trust_contract::{EnvironmentId, ProjectId};

fn clock(start: u64, seed: u64) -> ProductionTrustedClock<FixtureMonotonicTickSource> {
    bind_production_clock(
        fixture_production_clock_binding_grant(),
        FixtureMonotonicTickSource::new(start, seed),
        1_000_000,
    )
}

fn runtime(
    c: &ProductionTrustedClock<FixtureMonotonicTickSource>,
    rv: &FixtureRuntimeInstanceVerifier,
    pid: u32,
    creation: u64,
) -> VerifiedRuntimeInstance {
    rv.verify(
        &RuntimeInstanceObservation {
            role: HostRole::InteractiveFallback,
            source: RuntimeSource::InteractiveFallback,
            pid,
            creation_tick: creation,
            session: Some(SessionId::new("host-sess")),
            observed_at: 0,
            valid_until: 9_000,
            service_evidence: None,
        },
        &c.read_current(),
    )
    .unwrap()
}

/// A valid observation naming the verifier's live connection, observed now, valid within the window.
fn obs(iv: &ProductionIpcSessionVerifier, peer_pid: u32, peer_creation: u64) -> IpcPeerObservation {
    IpcPeerObservation {
        connection_id: iv.connection_id(),
        handshake_generation: iv.handshake_generation(),
        client_pid: peer_pid,
        client_creation_tick: peer_creation,
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        phase_digest: [3u8; 32],
        repository_identity: [4u8; 32],
        repository_baseline: [5u8; 32],
        observed_at: 0,
        valid_until: 8_000,
        capabilities: vec![ChannelCapability::RecordMarker],
        operation_families: vec![OperationFamily::RecordMarker],
    }
}

fn hs(iv: &ProductionIpcSessionVerifier) -> ConfirmedHandshakeEvidence {
    ConfirmedHandshakeEvidence::confirmed(iv.handshake_generation())
}

// I1 — a valid runtime-bound IPC observation mints and revalidates.
#[test]
fn i1_valid_runtime_bound_observation_mints() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    session.is_current(&iv, &rt, &c.read_current()).unwrap();
}

// I2 / I18 — a wrong (restarted) runtime instance is refused by currentness.
#[test]
fn i2_wrong_runtime_generation_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    // A different runtime instance (new verifier → new generation, different digest).
    let rv2 = FixtureRuntimeInstanceVerifier::new();
    let rt2 = runtime(&c, &rv2, 4242, 999);
    assert_eq!(
        session
            .is_current(&iv, &rt2, &c.read_current())
            .unwrap_err(),
        IpcSessionError::RuntimeInstanceMismatch
    );
}

// I5 / I6 — a wrong host runtime identity (different host pid or creation → different runtime digest) is
// refused: the session is bound to the exact runtime instance's digest.
#[test]
fn i5_i6_wrong_host_runtime_identity_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    // Same verifier/generation, but a runtime instance for a DIFFERENT host process (different digest).
    let rt_other_pid = runtime(&c, &rv, 5555, 999);
    assert_eq!(
        session
            .is_current(&iv, &rt_other_pid, &c.read_current())
            .unwrap_err(),
        IpcSessionError::RuntimeInstanceMismatch
    );
    let rt_other_creation = runtime(&c, &rv, 4242, 111);
    assert_eq!(
        session
            .is_current(&iv, &rt_other_creation, &c.read_current())
            .unwrap_err(),
        IpcSessionError::RuntimeInstanceMismatch
    );
}

// I3 — a different trusted-clock provider is refused.
#[test]
fn i3_wrong_provider_identity_is_refused() {
    use projectos_host_core::FixtureClock;
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    let other = FixtureClock::new(1_000);
    // Same runtime instance, but a DIFFERENT clock provider → refused as ProviderMismatch.
    assert_eq!(
        session
            .is_current(&iv, &rt, &other.read_current())
            .unwrap_err(),
        IpcSessionError::ProviderMismatch
    );
}

// I4 — a provider epoch restart (new lineage) is refused.
#[test]
fn i4_wrong_provider_epoch_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    // A second clock lineage under which the SAME runtime instance is re-presented is refused: the
    // runtime instance is bound to the first lineage's provider epoch.
    let c2 = clock(1_000, 999);
    let rt2 = runtime(&c2, &FixtureRuntimeInstanceVerifier::new(), 4242, 999);
    // rt2 belongs to c2's lineage; presenting the original session against rt2/c2 fails on runtime first.
    assert_eq!(
        session
            .is_current(&iv, &rt2, &c2.read_current())
            .unwrap_err(),
        IpcSessionError::RuntimeInstanceMismatch
    );
    // And a provider-epoch mismatch is directly observable on the runtime authority itself.
    assert_eq!(
        rt.is_current(&rv, &c2.read_current()).unwrap_err(),
        projectos_host_core::RuntimeInstanceError::ProviderEpochMismatch
    );
}

// I7 — peer identity is pid + creation time: the SAME pid with a different creation does not match
// (pid reuse alone never grants a peer match).
#[test]
fn i7_peer_pid_reuse_does_not_match() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    // Same pid, original creation: matches.
    session
        .matches_peer(&projectos_host_core::ExpectedPeer {
            pid: 6000,
            creation_tick: 222,
            user: PeerUserClass::Owner,
            session: Some(SessionId::new("peer-sess")),
        })
        .unwrap();
    // Same pid, reused with a different creation: refused.
    assert_eq!(
        session
            .matches_peer(&projectos_host_core::ExpectedPeer {
                pid: 6000,
                creation_tick: 777,
                user: PeerUserClass::Owner,
                session: Some(SessionId::new("peer-sess")),
            })
            .unwrap_err(),
        IpcSessionError::PeerProcessMismatch
    );
}

// I8 — a peer process-creation mismatch is refused by matches_peer.
#[test]
fn i8_peer_creation_mismatch_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    let expected = projectos_host_core::ExpectedPeer {
        pid: 6000,
        creation_tick: 999, // different creation
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
    };
    assert_eq!(
        session.matches_peer(&expected).unwrap_err(),
        IpcSessionError::PeerProcessMismatch
    );
}

// I9 — a stale observation is refused.
#[test]
fn i9_stale_observation_is_refused() {
    let c = clock(20_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    // runtime must still be current at now=20_000: give it a large-enough window via a fresh clock read.
    let rt = rv
        .verify(
            &RuntimeInstanceObservation {
                role: HostRole::InteractiveFallback,
                source: RuntimeSource::InteractiveFallback,
                pid: 4242,
                creation_tick: 999,
                session: None,
                observed_at: 20_000,
                valid_until: 29_000,
                service_evidence: None,
            },
            &c.read_current(),
        )
        .unwrap();
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let mut o = obs(&iv, 6000, 222);
    o.observed_at = 1_000; // now=20_000 → staleness 19_000 > 10_000 bound
    o.valid_until = 25_000;
    assert_eq!(
        iv.verify(&rt, hs(&iv), &o, &c.read_current()).unwrap_err(),
        IpcSessionError::StaleObservation
    );
}

// I10 — an excessive requested validity is refused.
#[test]
fn i10_excessive_validity_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let mut o = obs(&iv, 6000, 222);
    o.valid_until = 1_000 + 40_000; // exceeds now + max_window(30_000)
    assert_eq!(
        iv.verify(&rt, hs(&iv), &o, &c.read_current()).unwrap_err(),
        IpcSessionError::ExpiryBeyondBound
    );
}

// I11 — a handshake/connection mismatch is refused.
#[test]
fn i11_handshake_connection_mismatch_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    // Wrong connection id in the observation.
    let mut o = obs(&iv, 6000, 222);
    o.connection_id = iv.connection_id().wrapping_add(1);
    assert_eq!(
        iv.verify(&rt, hs(&iv), &o, &c.read_current()).unwrap_err(),
        IpcSessionError::ConnectionMismatch
    );
    // Wrong handshake generation in the confirmed evidence.
    let wrong_hs = ConfirmedHandshakeEvidence::confirmed(iv.handshake_generation().wrapping_add(1));
    assert_eq!(
        iv.verify(&rt, wrong_hs, &obs(&iv, 6000, 222), &c.read_current())
            .unwrap_err(),
        IpcSessionError::HandshakeGenerationMismatch
    );
    // Unconfirmed handshake evidence.
    let unconf = ConfirmedHandshakeEvidence::unconfirmed(iv.handshake_generation());
    assert_eq!(
        iv.verify(&rt, unconf, &obs(&iv, 6000, 222), &c.read_current())
            .unwrap_err(),
        IpcSessionError::HandshakeNotConfirmed
    );
}

// I12 — a disconnected or revoked verifier refuses minting and currentness.
#[test]
fn i12_disconnected_or_revoked_refuses() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    iv.disconnect();
    assert_eq!(
        session.is_current(&iv, &rt, &c.read_current()).unwrap_err(),
        IpcSessionError::Disconnected
    );
    assert_eq!(
        iv.verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
            .unwrap_err(),
        IpcSessionError::Disconnected
    );
    let iv2 = ProductionIpcSessionVerifier::for_local_proof();
    let _ = iv2
        .verify(&rt, hs(&iv2), &obs(&iv2, 6000, 222), &c.read_current())
        .unwrap();
    iv2.revoke();
    assert_eq!(
        iv2.verify(&rt, hs(&iv2), &obs(&iv2, 6000, 222), &c.read_current())
            .unwrap_err(),
        IpcSessionError::Revoked
    );
}

// I16 — a bound session and the verifier render redacted Debug.
#[test]
fn i16_debug_is_redacted() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    let dbg = format!("{session:?}");
    assert!(dbg.contains("[REDACTED]"));
    assert!(!dbg.contains("6000"));
    assert!(format!("{iv:?}").contains("[REDACTED]"));
}

// I4b — the IPC session's own provider-epoch binding: same runtime instance, same provider identity, but
// a DIFFERENT clock lineage (epoch) is refused as ProviderEpochMismatch (makes the epoch check
// independently load-bearing at the IPC layer).
#[test]
fn i4b_ipc_session_provider_epoch_is_refused() {
    let c = clock(1_000, 7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&c, &rv, 4242, 999);
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let session = iv
        .verify(&rt, hs(&iv), &obs(&iv, 6000, 222), &c.read_current())
        .unwrap();
    // A second production clock: SAME provider const, DIFFERENT opaque epoch (per-start nonce).
    let c2 = clock(1_000, 7);
    // Present the SAME runtime instance (so the runtime check passes) with the new lineage's reading.
    assert_eq!(
        session
            .is_current(&iv, &rt, &c2.read_current())
            .unwrap_err(),
        IpcSessionError::ProviderEpochMismatch
    );
}
