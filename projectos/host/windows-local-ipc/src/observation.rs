//! The opaque SAME-CONNECTION IPC peer evidence bundle (CD-B4-PRODUCTION-IPC-PROVIDER1A).
//!
//! It pairs, for ONE controlled pipe connection, the confirmed transport handshake ([`ConfirmedIpcPeerHandshake`],
//! moved in as proof) with the co-observed peer process identity and the operational channel context, then
//! projects — move-consuming — into the two core evidence values the sealed core
//! `ProductionIpcSessionVerifier` consumes: [`IpcPeerObservation`] and [`ConfirmedHandshakeEvidence`]. Both
//! projections carry the SAME connection id and handshake generation.
//!
//! It is EVIDENCE, never authority: it cannot construct `BoundIpcSession`, mint a verifier, mint runtime
//! authority or mint trusted time. Its fields are private, its `Debug` is redacted, it has no `Default`,
//! no serde, and no public field mutation. Construction requires a [`ConfirmedIpcPeerHandshake`], which has
//! no public constructor in any non-fixture graph, so the bundle is unreachable in the default graph.

#![cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]

use projectos_host_core::{
    ChannelCapability, ConfirmedHandshakeEvidence, EnvironmentId, IpcPeerObservation,
    OperationFamily, PeerUserClass, ProjectId, SessionId,
};

use crate::adapter::ConfirmedIpcPeerHandshake;

/// Opaque same-connection IPC peer evidence. Private fields; redacted `Debug`; move-consumed on
/// projection. Cannot mint authority.
pub struct ConfirmedSameConnectionIpcPeerEvidence {
    /// The confirmed transport handshake — proof the peer was authenticated on THIS connection. Held (and
    /// dropped on projection) so one confirmation attests at most one bundle.
    handshake: ConfirmedIpcPeerHandshake,
    connection_id: u64,
    handshake_generation: u64,
    peer_pid: u32,
    peer_creation_tick: u64,
    user: PeerUserClass,
    session: Option<SessionId>,
    project: ProjectId,
    environment: EnvironmentId,
    phase_digest: [u8; 32],
    repository_identity: [u8; 32],
    repository_baseline: [u8; 32],
    observed_at: u64,
    valid_until: u64,
    capabilities: Vec<ChannelCapability>,
    operation_families: Vec<OperationFamily>,
}

impl core::fmt::Debug for ConfirmedSameConnectionIpcPeerEvidence {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ConfirmedSameConnectionIpcPeerEvidence([REDACTED])")
    }
}

impl ConfirmedSameConnectionIpcPeerEvidence {
    /// Assemble the bundle from a CONFIRMED handshake (moved in) plus the co-observed peer identity and
    /// channel context. Fail-closed: rejects the zero connection/handshake/peer non-identities. This is
    /// not "arbitrary primitives marked confirmed" — the confirmation is the moved, unforgeable
    /// [`ConfirmedIpcPeerHandshake`]; the connection id and handshake generation are re-checked against the
    /// sealed verifier at mint time, so a mismatched pairing cannot mint a session.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn observe(
        handshake: ConfirmedIpcPeerHandshake,
        connection_id: u64,
        handshake_generation: u64,
        peer_pid: u32,
        peer_creation_tick: u64,
        user: PeerUserClass,
        session: Option<SessionId>,
        project: ProjectId,
        environment: EnvironmentId,
        phase_digest: [u8; 32],
        repository_identity: [u8; 32],
        repository_baseline: [u8; 32],
        observed_at: u64,
        valid_until: u64,
        capabilities: Vec<ChannelCapability>,
        operation_families: Vec<OperationFamily>,
    ) -> Option<Self> {
        if connection_id == 0
            || handshake_generation == 0
            || peer_pid == 0
            || peer_creation_tick == 0
        {
            return None;
        }
        Some(Self {
            handshake,
            connection_id,
            handshake_generation,
            peer_pid,
            peer_creation_tick,
            user,
            session,
            project,
            environment,
            phase_digest,
            repository_identity,
            repository_baseline,
            observed_at,
            valid_until,
            capabilities,
            operation_families,
        })
    }

    /// The bound connection id (for pairing against the sealed verifier).
    #[must_use]
    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }
    /// The bound handshake generation.
    #[must_use]
    pub fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }

    /// Project — MOVE-CONSUMING — into the two core evidence values, both carrying the SAME connection id
    /// and handshake generation. Consumes the confirmed handshake. It does NOT construct `BoundIpcSession`
    /// and cannot alter runtime generation or provider identity/epoch (those come only from the
    /// `VerifiedRuntimeInstance` and `VerifiedAuthorityTime` the sealed verifier is given).
    #[must_use]
    pub fn into_core_evidence(self) -> (IpcPeerObservation, ConfirmedHandshakeEvidence) {
        // The confirmed handshake is consumed here (dropped): proof spent on exactly this projection.
        let ConfirmedSameConnectionIpcPeerEvidence {
            handshake,
            connection_id,
            handshake_generation,
            peer_pid,
            peer_creation_tick,
            user,
            session,
            project,
            environment,
            phase_digest,
            repository_identity,
            repository_baseline,
            observed_at,
            valid_until,
            capabilities,
            operation_families,
        } = self;
        // The confirmed handshake is consumed (moved out and ignored): proof spent on this projection.
        let _confirmed = handshake;
        let observation = IpcPeerObservation {
            connection_id,
            handshake_generation,
            client_pid: peer_pid,
            client_creation_tick: peer_creation_tick,
            user,
            session,
            project,
            environment,
            phase_digest,
            repository_identity,
            repository_baseline,
            observed_at,
            valid_until,
            capabilities,
            operation_families,
        };
        let handshake_evidence = ConfirmedHandshakeEvidence::confirmed(handshake_generation);
        (observation, handshake_evidence)
    }
}

#[cfg(all(test, feature = "test-fixtures"))]
mod tests {
    // Level-2 end-to-end proof: windows same-connection bundle → core projection → sealed production
    // verifier → BoundIpcSession → currentness + replay/refusal — with NO named pipe created.
    #![allow(clippy::too_many_arguments)]
    use crate::adapter::assemble_same_connection_ipc_peer_fixture;
    use crate::LiveIpcOperationCapability;
    use projectos_host_core::{
        bind_production_clock, fixture_production_clock_binding_grant, ChannelCapability,
        FixtureMonotonicTickSource, FixtureRuntimeInstanceVerifier, HostRole, IpcSessionError,
        IpcSessionVerifier, OperationFamily, PeerUserClass, ProductionIpcSessionVerifier,
        RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, SessionId,
        TrustedClock,
    };
    use projectos_host_core::{EnvironmentId, ProjectId};

    // PROJECTOSHOST-IPC-SESSION-VERIFIER1A (A7/S3): TWO INDEPENDENT, PARALLEL proofs of the same
    // peer-substitution threat model. The CANONICAL kernel-peer attempt refuses a substituted or
    // restarted (pid-reuse-modelled) peer with its closed verdict, and — separately — a session
    // minted through the sealed verifier refuses a substituted/pid-reused peer and a reconnected
    // verifier. The two layers share no data here: wiring the canonical verdict INTO session minting
    // is deliberately NOT claimed and remains the live-adapter phase's work (orchestration-level
    // today, disclosed in the phase report). Synthetic only: no pipe, no Windows call, no raw
    // process identity (opaque selectors).
    #[test]
    fn level2_canonical_peer_capture_and_session_refuse_substituted_and_stale_peers() {
        use projectos_host_windows_service_identity_proof::{
            synthetic_observation, LiveInstanceObservationCapability, ServiceInstanceBinding,
            ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
        };

        let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
        let stable = || synthetic_observation(SyntheticInstanceSelector::new(1, 1));

        // 1. A STABLE canonical instance across the whole attempt window binds: the orchestrator may
        //    proceed to session authority only on this verdict.
        let attempt = ServiceInstanceBindingAttempt::begin(&capability);
        let attempt = attempt
            .record_scm_before(stable())
            .into_attempt()
            .expect("scm-before advances");
        let attempt = attempt
            .record_ipc_peer(stable())
            .into_attempt()
            .expect("ipc peer advances");
        let attempt = attempt
            .record_scm_after(stable())
            .into_attempt()
            .expect("scm-after advances");
        assert_eq!(attempt.finalise(), ServiceInstanceBinding::Match);

        // 2. A SUBSTITUTED peer (different opaque instance) is refused by the canonical verdict.
        let substituted = ServiceInstanceBindingAttempt::begin(&capability);
        let substituted = substituted
            .record_scm_before(stable())
            .into_attempt()
            .expect("scm-before advances");
        let substituted = substituted
            .record_ipc_peer(synthetic_observation(SyntheticInstanceSelector::new(2, 1)))
            .into_attempt()
            .expect("ipc peer advances");
        let substituted = substituted
            .record_scm_after(stable())
            .into_attempt()
            .expect("scm-after advances");
        assert_eq!(substituted.finalise(), ServiceInstanceBinding::Mismatch);

        // 3. A RESTARTED instance (same opaque instance, new incarnation — the pid-reuse model) is a
        //    stale peer and is refused the same way.
        let restarted = ServiceInstanceBindingAttempt::begin(&capability);
        let restarted = restarted
            .record_scm_before(stable())
            .into_attempt()
            .expect("scm-before advances");
        let restarted = restarted
            .record_ipc_peer(synthetic_observation(SyntheticInstanceSelector::new(1, 2)))
            .into_attempt()
            .expect("ipc peer advances");
        let restarted = restarted
            .record_scm_after(stable())
            .into_attempt()
            .expect("scm-after advances");
        assert_eq!(restarted.finalise(), ServiceInstanceBinding::Mismatch);

        // 4. SESSION side of the same property: a session bound through the sealed production verifier
        //    refuses a substituted peer process and a stale (pid-reused) peer instance, independently
        //    of the canonical verdict above — neither layer trusts caller-declared identity.
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let now = clock.read_current();
        let rv = FixtureRuntimeInstanceVerifier::new();
        let runtime = rv
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
                &clock.read_current(),
            )
            .unwrap();
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let cap = LiveIpcOperationCapability::synthetic_for_fixture();
        let bundle = assemble_same_connection_ipc_peer_fixture(
            &cap,
            iv.connection_id(),
            iv.handshake_generation(),
            7000,
            321,
            PeerUserClass::Owner,
            Some(SessionId::new("peer-sess")),
            ProjectId::new("proj").unwrap(),
            EnvironmentId::new("staging").unwrap(),
            [3u8; 32],
            [4u8; 32],
            [5u8; 32],
            now.reading(),
            now.reading() + 5_000,
            vec![ChannelCapability::RecordMarker],
            vec![OperationFamily::RecordMarker],
        )
        .expect("fixture same-connection observation confirms");
        let (observation, handshake) = bundle.into_core_evidence();
        let session = iv
            .verify(&runtime, handshake, &observation, &clock.read_current())
            .expect("mint bound ipc session");
        // A substituted peer process is refused.
        assert_eq!(
            session
                .matches_peer(&projectos_host_core::ExpectedPeer {
                    pid: 7001,
                    creation_tick: 321,
                    user: PeerUserClass::Owner,
                    session: Some(SessionId::new("peer-sess")),
                })
                .unwrap_err(),
            IpcSessionError::PeerProcessMismatch
        );
        // A pid-reused (same pid, different creation tick) peer instance is refused.
        assert_eq!(
            session
                .matches_peer(&projectos_host_core::ExpectedPeer {
                    pid: 7000,
                    creation_tick: 322,
                    user: PeerUserClass::Owner,
                    session: Some(SessionId::new("peer-sess")),
                })
                .unwrap_err(),
            IpcSessionError::PeerProcessMismatch
        );
        // A reconnected verifier (new host-issued connection identity) refuses the prior session.
        let reconnected = ProductionIpcSessionVerifier::for_local_proof();
        assert_eq!(
            session
                .is_current(&reconnected, &runtime, &clock.read_current())
                .unwrap_err(),
            IpcSessionError::ConnectionMismatch
        );
    }

    #[test]
    fn level2_end_to_end_same_connection_proof() {
        // Real fixture clock, bound through a core grant (no named pipe, no live FFI).
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let now = clock.read_current();

        // A verified runtime instance to bind the session to.
        let rv = FixtureRuntimeInstanceVerifier::new();
        let runtime = rv
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
                &clock.read_current(),
            )
            .unwrap();

        // The sealed production IPC verifier owns the connection identity + handshake generation.
        let iv = ProductionIpcSessionVerifier::for_local_proof();

        // Drive the REAL fixture handshake order and assemble the opaque same-connection bundle.
        let cap = LiveIpcOperationCapability::synthetic_for_fixture();
        let bundle = assemble_same_connection_ipc_peer_fixture(
            &cap,
            iv.connection_id(),
            iv.handshake_generation(),
            7000,
            321,
            PeerUserClass::Owner,
            Some(SessionId::new("peer-sess")),
            ProjectId::new("proj").unwrap(),
            EnvironmentId::new("staging").unwrap(),
            [3u8; 32],
            [4u8; 32],
            [5u8; 32],
            now.reading(),
            now.reading() + 5_000,
            vec![ChannelCapability::RecordMarker],
            vec![OperationFamily::RecordMarker],
        )
        .expect("fixture same-connection observation confirms");

        // Project into the two core evidence values and mint through the sealed verifier.
        let (observation, handshake) = bundle.into_core_evidence();
        let session = iv
            .verify(&runtime, handshake, &observation, &clock.read_current())
            .expect("mint bound ipc session");
        session
            .is_current(&iv, &runtime, &clock.read_current())
            .expect("session is current");

        // Reconnection (a new verifier → new connection id) refuses the prior session.
        let iv2 = ProductionIpcSessionVerifier::for_local_proof();
        assert_eq!(
            session
                .is_current(&iv2, &runtime, &clock.read_current())
                .unwrap_err(),
            IpcSessionError::ConnectionMismatch
        );
        // Disconnect refuses currentness.
        iv.disconnect();
        assert_eq!(
            session
                .is_current(&iv, &runtime, &clock.read_current())
                .unwrap_err(),
            IpcSessionError::Disconnected
        );
    }
}
