//! PROJECTOS-HOST-REVIEW-PATH1B — the PRODUCTION client crossing, proven on the REAL sealed verifier
//! and the REAL canonical client-admission attempt with synthetic inputs.
//!
//! No pipe, no Windows call, no raw identity. Gated on the LIVE graph because client admission is a
//! live kernel observation; the canonical crate's synthetic driver lets the ORDERING be proven
//! without one, exactly as the service-instance crossing proofs do.

use crate::adapter::assemble_same_connection_ipc_peer_fixture;
use crate::observation::{
    bind_canonical_client_to_session_evidence, CanonicalSessionCrossingRefusal,
    ConfirmedSameConnectionIpcPeerEvidence,
};
use crate::operation_contract::TrustedPeerContext;
use crate::LiveIpcOperationCapability;
use projectos_host_core::{
    bind_production_clock, fixture_production_clock_binding_grant, ChannelCapability, EnvironmentId,
    FixtureMonotonicTickSource, FixtureRuntimeInstanceVerifier, HostRole, IpcSessionVerifier,
    OperationFamily, PeerUserClass, ProductionIpcSessionVerifier, ProjectId,
    RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock,
};
use projectos_host_windows_service_identity_proof::{
    ClientAdmissionObservationCapability, ClientAdmissionVerdict, ClientObserved,
    ClientPeerAdmissionAttempt, EnrolledOwnerPrincipal, SyntheticOwnerSelector,
};

/// The opaque label standing for the enrolled configured owner in these proofs.
const OWNER: u8 = 9;
/// A DIFFERENT principal. Same synthetic account shape, different exact user.
const NOT_OWNER: u8 = 10;

/// Drive the canonical CLIENT-ADMISSION attempt to its completed state for the given host-issued
/// pair, with the given ACTUAL client principal. Every gate taken is the production one.
fn admitted_client_attempt(
    expected_owner: u8,
    actual_client: u8,
    connection_id: u64,
    handshake_generation: u64,
) -> Option<ClientPeerAdmissionAttempt<ClientObserved>> {
    let cap = ClientAdmissionObservationCapability::synthetic_for_fixture();
    let owner =
        EnrolledOwnerPrincipal::synthetic_for_fixture(SyntheticOwnerSelector::new(expected_owner));
    ClientPeerAdmissionAttempt::begin(&cap, &owner)
        .record_synthetic_client(
            SyntheticOwnerSelector::new(actual_client),
            3,
            1,
            connection_id,
            handshake_generation,
        )
        .into_attempt()
}

/// The same fixture bundle the service-instance crossing proofs use.
fn bundle_for(
    connection_id: u64,
    handshake_generation: u64,
    now_reading: u64,
) -> ConfirmedSameConnectionIpcPeerEvidence {
    let cap = LiveIpcOperationCapability::synthetic_for_fixture();
    assemble_same_connection_ipc_peer_fixture(
        &cap,
        connection_id,
        handshake_generation,
        7000,
        321,
        PeerUserClass::Owner,
        Some(SessionId::new("peer-sess")),
        ProjectId::new("proj").unwrap(),
        EnvironmentId::new("staging").unwrap(),
        [3u8; 32],
        [4u8; 32],
        [5u8; 32],
        now_reading,
        now_reading + 5_000,
        vec![ChannelCapability::RecordMarker],
        vec![OperationFamily::RecordMarker],
    )
    .expect("fixture same-connection observation confirms")
}

/// A real trusted clock through its own sealed binding route.
fn clock() -> impl TrustedClock {
    bind_production_clock(
        fixture_production_clock_binding_grant(),
        FixtureMonotonicTickSource::new(1_000, 7),
        1_000_000,
    )
}

/// CRITERION 18, THE WHOLE POINT: for ONE legitimate Agent connection the production Host can now
/// obtain BOTH a `BoundIpcSession` AND a `TrustedPeerContext`.
///
/// Before this route existed the Host could obtain NEITHER, because the only path to both ran through
/// a service-instance `Match` that a Host observing its own CLIENT can never produce.
#[test]
fn one_client_connection_yields_both_a_bound_session_and_a_trusted_peer_context() {
    // The host-issued identity comes from the SEALED verifier's own counter. The test cannot choose
    // it.
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let connection_id = iv.connection_id();
    let handshake_generation = iv.handshake_generation();
    assert_ne!(connection_id, 0);
    assert_ne!(handshake_generation, 0);

    let clk = clock();
    let runtime = FixtureRuntimeInstanceVerifier::new()
        .verify(
            &RuntimeInstanceObservation {
                role: HostRole::InteractiveFallback,
                source: RuntimeSource::InteractiveFallback,
                pid: 4242,
                creation_tick: 999,
                session: None,
                observed_at: 0,
                valid_until: 9_000,
                service_evidence: None,
            },
            &clk.read_current(),
        )
        .expect("the runtime instance verifies through its own sealed verifier");

    // The canonical CLIENT-ADMISSION attempt: the client IS the enrolled configured owner.
    let attempt = admitted_client_attempt(OWNER, OWNER, connection_id, handshake_generation)
        .expect("the exact configured owner is captured");
    let bundle = bundle_for(connection_id, handshake_generation, clk.read_current().reading());

    // ONE consuming admission, TWO outputs.
    let (observation, handshake, admission) =
        bind_canonical_client_to_session_evidence(attempt, bundle, &iv)
            .expect("a legitimate owner client must cross")
            .into_parts();

    // (a) the EXISTING sealed session mint, unchanged.
    let session = iv
        .verify(&runtime, handshake, &observation, &clk.read_current())
        .expect("the sealed verifier mints the bound session");
    session
        .is_current(&iv, &runtime, &clk.read_current())
        .expect("the freshly minted session is current");

    // (b) the EXISTING sealed peer mint, unchanged — the ONE O7-allowlisted constructor.
    let peer = TrustedPeerContext::from_verified_peer_admission(&admission);
    assert!(
        peer.is_bound_to(connection_id, handshake_generation),
        "the peer context must belong to the same host-issued connection as the session"
    );
}

/// A client that is NOT the enrolled configured owner crosses nothing, so neither mint is reachable.
/// It refuses at CAPTURE, before any crossing is even possible.
#[test]
fn a_client_that_is_not_the_configured_owner_cannot_cross() {
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    assert!(
        admitted_client_attempt(
            OWNER,
            NOT_OWNER,
            iv.connection_id(),
            iv.handshake_generation()
        )
        .is_none(),
        "a non-owner client must not yield a completed attempt"
    );
}

/// An owner client captured on ANOTHER connection cannot be paired with this bundle, and the
/// canonical verdict is carried verbatim rather than being folded into the service-instance reason.
#[test]
fn a_client_admission_from_another_connection_cannot_cross() {
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let clk = clock();
    let attempt = admitted_client_attempt(
        OWNER,
        OWNER,
        iv.connection_id().wrapping_add(1),
        iv.handshake_generation(),
    )
    .expect("captured on a different connection");
    let bundle = bundle_for(
        iv.connection_id(),
        iv.handshake_generation(),
        clk.read_current().reading(),
    );
    assert_eq!(
        bind_canonical_client_to_session_evidence(attempt, bundle, &iv).unwrap_err(),
        CanonicalSessionCrossingRefusal::ClientAdmissionRefused(
            ClientAdmissionVerdict::CrossConnectionPresentation
        )
    );
}

/// The bundle must name the sealed verifier's live connection — checked BEFORE the attempt is
/// consumed, exactly as in the service-instance crossing.
#[test]
fn a_bundle_naming_another_connection_refuses() {
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let clk = clock();
    let attempt =
        admitted_client_attempt(OWNER, OWNER, iv.connection_id(), iv.handshake_generation())
            .expect("captured");
    let bundle = bundle_for(
        iv.connection_id().wrapping_add(1),
        iv.handshake_generation(),
        clk.read_current().reading(),
    );
    assert_eq!(
        bind_canonical_client_to_session_evidence(attempt, bundle, &iv).unwrap_err(),
        CanonicalSessionCrossingRefusal::ConnectionMismatch
    );
}

/// The bundle must name the verifier's CURRENT handshake generation.
#[test]
fn a_bundle_from_a_prior_handshake_generation_refuses() {
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let clk = clock();
    let attempt =
        admitted_client_attempt(OWNER, OWNER, iv.connection_id(), iv.handshake_generation())
            .expect("captured");
    let bundle = bundle_for(
        iv.connection_id(),
        iv.handshake_generation().wrapping_sub(1),
        clk.read_current().reading(),
    );
    assert_eq!(
        bind_canonical_client_to_session_evidence(attempt, bundle, &iv).unwrap_err(),
        CanonicalSessionCrossingRefusal::HandshakeGenerationMismatch
    );
}

/// ONE attempt, ONE crossing. The attempt is consumed, so a second crossing needs a NEW capture —
/// there is no way to fan one admission into two.
#[test]
fn a_client_attempt_crosses_at_most_once() {
    let iv = ProductionIpcSessionVerifier::for_local_proof();
    let clk = clock();
    let attempt =
        admitted_client_attempt(OWNER, OWNER, iv.connection_id(), iv.handshake_generation())
            .expect("captured");
    let bundle = bundle_for(
        iv.connection_id(),
        iv.handshake_generation(),
        clk.read_current().reading(),
    );
    assert!(bind_canonical_client_to_session_evidence(attempt, bundle, &iv).is_ok());
    // `attempt` and `bundle` are both moved; a second call here is a compile error. The only way to
    // cross again is a fresh capture AND a fresh bundle, each of which re-runs every gate.
}
