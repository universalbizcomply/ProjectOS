//! Production trusted clock ↔ existing currentness compatibility (CD-B4-PRODUCTION-TRUSTED-CLOCK1A).
//!
//! A `ProductionTrustedClock` (driven by a fixture monotonic tick source) is a drop-in sealed
//! `TrustedClock`: the existing runtime-instance and IPC-session currentness contracts mint and
//! revalidate under it exactly as under the fixture clock, and a different provider lineage (epoch) is
//! refused. The clock's fail-closed fault logic is proven by the core unit tests; type-forgery and
//! fixture/default-graph exclusion are proven by the validator.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    fixture_bind_production_clock, BoundIpcSession, ChannelCapability, ConfirmedHandshakeEvidence,
    FixtureIpcSessionVerifier, FixtureMonotonicTickSource, FixtureRuntimeInstanceVerifier,
    HostRole, IpcPeerObservation, IpcSessionError, IpcSessionVerifier, OperationFamily,
    PeerUserClass, ProductionTrustedClock, RuntimeInstanceError, RuntimeInstanceObservation,
    RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock, VerifiedRuntimeInstance,
};
use projectos_trust_contract::{EnvironmentId, ProjectId};

fn prod(seed: u64) -> ProductionTrustedClock<FixtureMonotonicTickSource> {
    fixture_bind_production_clock(FixtureMonotonicTickSource::new(1_000, seed), 1_000_000)
}

fn runtime(
    c: &ProductionTrustedClock<FixtureMonotonicTickSource>,
    rv: &FixtureRuntimeInstanceVerifier,
) -> VerifiedRuntimeInstance {
    rv.verify(
        &RuntimeInstanceObservation {
            role: HostRole::InteractiveFallback,
            source: RuntimeSource::InteractiveFallback,
            pid: 4242,
            creation_tick: 999,
            session: Some(SessionId::new("host-sess")),
            observed_at: 0,
            valid_until: 9_000,
            service_evidence: None,
        },
        &c.read_current(),
    )
    .unwrap()
}

// T24 — the runtime-instance currentness contract mints and revalidates under the production clock.
#[test]
fn t24_runtime_currentness_under_production_clock() {
    let clock = prod(7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let ri = runtime(&clock, &rv);
    ri.is_current(&rv, &clock.read_current()).unwrap();
}

// A different provider lineage (epoch) is refused by the existing currentness check.
#[test]
fn different_provider_epoch_refused() {
    let clock_a = prod(7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let ri = runtime(&clock_a, &rv);
    // A second production clock is a different lineage (different opaque epoch), same provider identity.
    let clock_b = prod(999);
    assert_eq!(
        ri.is_current(&rv, &clock_b.read_current()).unwrap_err(),
        RuntimeInstanceError::ProviderEpochMismatch
    );
}

// T25 — the IPC-session currentness contract mints and revalidates under the production clock.
#[test]
fn t25_ipc_currentness_under_production_clock() {
    let clock = prod(7);
    let rv = FixtureRuntimeInstanceVerifier::new();
    let rt = runtime(&clock, &rv);
    let iv = FixtureIpcSessionVerifier::new();
    let obs = IpcPeerObservation {
        connection_id: iv.connection_id(),
        handshake_generation: iv.handshake_generation(),
        client_pid: 6000,
        client_creation_tick: 222,
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
    };
    let session: BoundIpcSession = iv
        .verify(
            &rt,
            ConfirmedHandshakeEvidence::confirmed(iv.handshake_generation()),
            &obs,
            &clock.read_current(),
        )
        .unwrap();
    session.is_current(&iv, &rt, &clock.read_current()).unwrap();
    // A different provider lineage is refused.
    let clock_b = prod(999);
    assert_eq!(
        session
            .is_current(&iv, &rt, &clock_b.read_current())
            .unwrap_err(),
        IpcSessionError::ProviderEpochMismatch
    );
}
