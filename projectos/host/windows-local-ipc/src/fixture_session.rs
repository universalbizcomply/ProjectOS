//! TEST-ONLY: one live canonical `BoundIpcSession` on a fixture verifier's host-issued connection.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION - §9B. The request-binding evaluator consumes the §9A
//! `AdmittedRequest` as its freshness proof, and only a real session can mint one, so the proofs in
//! `operation_contract` need a session. This lives in its own `cfg(test)`-only module because the
//! two modules that could otherwise host it are each scanned by an accepted validator for exactly
//! the vocabulary it must use: the operation contract must not name core's peer classification, and
//! the observation bundle must never construct or return a `BoundIpcSession`. It ships in no graph.

use projectos_host_core::{
    BoundIpcSession, ChannelCapability, ConfirmedHandshakeEvidence, EnvironmentId, FixtureClock,
    FixtureIpcSessionVerifier, FixtureRuntimeInstanceVerifier, HostRole, IpcPeerObservation,
    IpcSessionVerifier, OperationFamily, PeerUserClass, ProjectId, RuntimeInstanceObservation,
    RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock,
};

/// Mint one live canonical session bound to `verifier`'s host-issued connection and handshake
/// generation, through the REAL sealed core verification order with synthetic inputs.
pub(crate) fn fixture_bound_session(
    clock: &FixtureClock,
    verifier: &FixtureIpcSessionVerifier,
) -> BoundIpcSession {
    let runtime = FixtureRuntimeInstanceVerifier::new()
        .verify(
            &RuntimeInstanceObservation {
                role: HostRole::InteractiveFallback,
                source: RuntimeSource::InteractiveFallback,
                pid: 4242,
                creation_tick: 999,
                session: Some(SessionId::new("host-sess")),
                observed_at: 50,
                valid_until: 9_000,
                service_evidence: None,
            },
            &clock.read_current(),
        )
        .expect("fixture runtime instance");
    let observation = IpcPeerObservation {
        connection_id: verifier.connection_id(),
        handshake_generation: verifier.handshake_generation(),
        client_pid: 7000,
        client_creation_tick: 123,
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
        project: ProjectId::new("proj").expect("bounded id"),
        environment: EnvironmentId::new("staging").expect("bounded id"),
        phase_digest: [7u8; 32],
        repository_identity: [9u8; 32],
        repository_baseline: [11u8; 32],
        observed_at: 100,
        valid_until: 5_000,
        capabilities: vec![ChannelCapability::RecordMarker],
        operation_families: vec![OperationFamily::RecordMarker],
    };
    verifier
        .verify(
            &runtime,
            ConfirmedHandshakeEvidence::confirmed(verifier.handshake_generation()),
            &observation,
            &clock.read_current(),
        )
        .expect("fixture session")
}
