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
    ///
    /// CRATE-PRIVATE since PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A. It was public, which
    /// left an UNGUARDED route to core evidence: a caller could project a bundle straight into the
    /// sealed verifier without any canonical service-instance verdict ever being taken. Narrowing it
    /// makes [`bind_canonical_peer_to_session_evidence`] the ONLY route out of this crate, so the
    /// guarded crossing is exclusive rather than merely available.
    #[must_use]
    pub(crate) fn into_core_evidence(self) -> (IpcPeerObservation, ConfirmedHandshakeEvidence) {
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

// ---------------------------------------------------------------------------------------------
// PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A — the ONE guarded crossing from the canonical
// kernel-peer attempt to the core session evidence.
// ---------------------------------------------------------------------------------------------

/// Why the canonical→session crossing refused. Closed and payload-free except for the canonical
/// crate's own closed verdict; carries no identity, no pid, no SID, no handle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CanonicalSessionCrossingRefusal {
    /// The bundle names a different connection than the sealed verifier's live connection.
    ConnectionMismatch,
    /// The bundle names a different handshake generation than the verifier's current one.
    HandshakeGenerationMismatch,
    /// The canonical attempt did not finalise to [`ServiceInstanceBinding::Match`]; the closed
    /// verdict is carried verbatim (it is already redacted by the canonical crate).
    ServiceInstanceRefused(projectos_host_windows_service_identity_proof::ServiceInstanceBinding),
}

/// The guarded crossing: consume a COMPLETED canonical peer attempt and the same-connection bundle,
/// and yield the two core evidence values ONLY when
///  1. the bundle names the sealed verifier's live connection,
///  2. the bundle names the verifier's current handshake generation, and
///  3. the canonical attempt finalises to [`ServiceInstanceBinding::Match`] **for that same
///     host-issued connection and handshake generation** — the verdict is produced HERE by consuming
///     the attempt, so a caller can neither supply a forged `Match` nor pair one connection's
///     attempt with another connection's bundle.
///
/// The full chain is therefore: the pair the ATTEMPT stored when its IPC peer was captured ==
/// the BUNDLE's pair == the sealed VERIFIER's live pair. `finalise_for_connection` compares the
/// first two inside the canonical crate (it has no accessor, so the stored values are never read
/// out), and this function compares the second two — no link is left to caller-side discipline.
///
/// Fail closed on the first violated relationship: NO evidence leaves this function, so nothing can
/// reach the sealed session verifier. This duplicates NO verifier check that matters after the
/// crossing — runtime, provider, epoch, expiry, staleness and liveness remain the sealed verifier's
/// sole authority at mint and currentness — and the connection/generation checks the verifier also
/// performs are re-checked there regardless (defence in depth, not a substitute).
///
/// It is EVIDENCE plumbing, never authority: it cannot construct `BoundIpcSession`, and a success
/// still requires the sealed verifier, a real `VerifiedRuntimeInstance` and a real
/// `VerifiedAuthorityTime` to mint anything.
///
/// # Errors
/// [`CanonicalSessionCrossingRefusal`] naming the first violated relationship.
pub fn bind_canonical_peer_to_session_evidence<V: projectos_host_core::IpcSessionVerifier>(
    attempt: projectos_host_windows_service_identity_proof::ServiceInstanceBindingAttempt<
        projectos_host_windows_service_identity_proof::ScmAfterObserved,
    >,
    bundle: ConfirmedSameConnectionIpcPeerEvidence,
    verifier: &V,
) -> Result<(IpcPeerObservation, ConfirmedHandshakeEvidence), CanonicalSessionCrossingRefusal> {
    use projectos_host_windows_service_identity_proof::ServiceInstanceBinding;

    // §7 order: connection (4), handshake generation (5), service-instance binding (6).
    if bundle.connection_id() != verifier.connection_id() {
        return Err(CanonicalSessionCrossingRefusal::ConnectionMismatch);
    }
    if bundle.handshake_generation() != verifier.handshake_generation() {
        return Err(CanonicalSessionCrossingRefusal::HandshakeGenerationMismatch);
    }
    // The verdict is derived by CONSUMING the attempt — single-use, never caller-supplied — and is
    // Match only when the attempt's OWN captured connection/generation are these ones.
    match attempt.finalise_for_connection(bundle.connection_id(), bundle.handshake_generation()) {
        ServiceInstanceBinding::Match => Ok(bundle.into_core_evidence()),
        refused => Err(CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
            refused,
        )),
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

    // ------------------------------------------------------------------------------------------
    // PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A — the guarded crossing, proven on the REAL
    // sealed production verifier with synthetic inputs. No pipe, no Windows call, no raw identity.
    // ------------------------------------------------------------------------------------------

    use super::bind_canonical_peer_to_session_evidence;
    use super::CanonicalSessionCrossingRefusal;
    use projectos_host_windows_service_identity_proof::{
        synthetic_observation, LiveInstanceObservationCapability, ScmAfterObserved,
        ServiceInstanceBinding, ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
    };

    /// Drive the canonical fixture attempt to its completed (pre-finalise) state with the given
    /// opaque before/peer/after selectors, CAPTURING the peer on the given host-issued connection
    /// and handshake generation. This is the route a real transport takes: the identifiers are
    /// supplied at capture, not at finalisation.
    fn completed_attempt_on(
        before: (u8, u8),
        peer: (u8, u8),
        after: (u8, u8),
        connection_id: u64,
        handshake_generation: u64,
    ) -> ServiceInstanceBindingAttempt<ScmAfterObserved> {
        let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
        let sel =
            |(i, inc): (u8, u8)| synthetic_observation(SyntheticInstanceSelector::new(i, inc));
        ServiceInstanceBindingAttempt::begin(&capability)
            .record_scm_before(sel(before))
            .into_attempt()
            .expect("scm-before advances")
            .record_ipc_peer_on_connection(sel(peer), connection_id, handshake_generation)
            .into_attempt()
            .expect("ipc peer advances")
            .record_scm_after(sel(after))
            .into_attempt()
            .expect("scm-after advances")
    }

    /// The identity-free capture route, retained so the fail-closed proof can show an attempt with
    /// NO stored host-issued pair cannot cross.
    fn completed_attempt_without_connection(
        before: (u8, u8),
        peer: (u8, u8),
        after: (u8, u8),
    ) -> ServiceInstanceBindingAttempt<ScmAfterObserved> {
        let capability = LiveInstanceObservationCapability::synthetic_for_fixture();
        let sel =
            |(i, inc): (u8, u8)| synthetic_observation(SyntheticInstanceSelector::new(i, inc));
        ServiceInstanceBindingAttempt::begin(&capability)
            .record_scm_before(sel(before))
            .into_attempt()
            .expect("scm-before advances")
            .record_ipc_peer(sel(peer))
            .into_attempt()
            .expect("ipc peer advances")
            .record_scm_after(sel(after))
            .into_attempt()
            .expect("scm-after advances")
    }

    /// Assemble the fixture same-connection bundle for the given host-issued identifiers.
    fn bundle_for(
        connection_id: u64,
        handshake_generation: u64,
        now_reading: u64,
    ) -> crate::observation::ConfirmedSameConnectionIpcPeerEvidence {
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

    // T1 + T9: the ONLY successful path — Match verdict + matching connection + matching generation
    // reaches the REAL sealed production verifier and mints a session that is current; a reconnected
    // verifier (new host-issued connection) then refuses the prior session.
    #[test]
    fn integration_match_and_correlation_mint_a_current_session() {
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
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
        let attempt = completed_attempt_on(
            (1, 1),
            (1, 1),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        let (observation, handshake) =
            bind_canonical_peer_to_session_evidence(attempt, bundle, &iv)
                .expect("Match + correlation must cross");
        let session = iv
            .verify(&runtime, handshake, &observation, &clock.read_current())
            .expect("the sealed verifier mints on crossed evidence");
        session
            .is_current(&iv, &runtime, &clock.read_current())
            .expect("the integrated session is current");
        // T9: a reconnected verifier refuses the prior session.
        let reconnected = ProductionIpcSessionVerifier::for_local_proof();
        assert_eq!(
            session
                .is_current(&reconnected, &runtime, &clock.read_current())
                .unwrap_err(),
            IpcSessionError::ConnectionMismatch
        );
    }

    // T2 + T5 + T11: a canonically REFUSED peer (substitution, and restart/pid-reuse model) never
    // yields evidence — and the refusal carries no identity material.
    #[test]
    fn integration_canonical_refusal_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        // Substituted peer (different opaque instance).
        let substituted = completed_attempt_on(
            (1, 1),
            (2, 1),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        let refusal = bind_canonical_peer_to_session_evidence(substituted, bundle, &iv)
            .expect_err("a substituted peer must not cross");
        assert_eq!(
            refusal,
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
                ServiceInstanceBinding::Mismatch
            )
        );
        // T11: the refusal renders no identity material (no digits at all).
        let rendered = format!("{refusal:?}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        // Restarted instance (same opaque instance, new incarnation — the pid-reuse model).
        let restarted = completed_attempt_on(
            (1, 1),
            (1, 2),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle2 = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(restarted, bundle2, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
                ServiceInstanceBinding::Mismatch
            )
        );
    }

    // T6: a non-Match verdict that is NOT a peer mismatch (an unstable service across the window —
    // Stale) equally refuses: the guard demands exactly Match, not merely "not Mismatch".
    #[test]
    fn integration_unstable_service_instance_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        // scm-before and scm-after disagree: the service was not ONE stable instance.
        let unstable = completed_attempt_on(
            (1, 1),
            (1, 1),
            (2, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(unstable, bundle, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(ServiceInstanceBinding::Stale)
        );
    }

    // ------------------------------------------------------------------------------------------
    // ATTEMPT↔BUNDLE PAIRING (the amendment). The attempt must prove which host-issued connection
    // and handshake generation ITS OWN capture belongs to — pairing an attempt from one connection
    // with another connection's bundle refuses even when the bundle and verifier agree perfectly.
    // ------------------------------------------------------------------------------------------

    // AT2: attempt captured on connection A, bundle + verifier both on connection B → REFUSE.
    // Both this connection's evidence and the canonical verdict are individually valid; only the
    // pairing is wrong, so nothing but the new rule can catch it.
    #[test]
    fn integration_attempt_from_another_connection_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        // A perfectly good attempt — but captured on a DIFFERENT connection.
        let foreign = completed_attempt_on(
            (1, 1),
            (1, 1),
            (1, 1),
            iv.connection_id().wrapping_sub(7),
            iv.handshake_generation(),
        );
        // The bundle and the verifier agree exactly, so the first two checks pass.
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(foreign, bundle, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
                ServiceInstanceBinding::CrossAttemptObservation
            )
        );
    }

    // AT3: attempt captured on generation G1, bundle + verifier on the CURRENT generation → REFUSE.
    // A re-handshake must not let a prior generation's canonical verdict be reused.
    #[test]
    fn integration_attempt_from_a_prior_handshake_generation_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let stale = completed_attempt_on(
            (1, 1),
            (1, 1),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation().wrapping_sub(1),
        );
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(stale, bundle, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
                ServiceInstanceBinding::CrossAttemptObservation
            )
        );
    }

    // AT5: an attempt captured through the identity-free route stored NO host-issued pair, so it
    // cannot be paired at all — fail closed rather than accept an unpaired Match.
    #[test]
    fn integration_attempt_without_a_captured_connection_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let unpaired = completed_attempt_without_connection((1, 1), (1, 1), (1, 1));
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        let refusal = bind_canonical_peer_to_session_evidence(unpaired, bundle, &iv)
            .expect_err("an unpaired attempt must not cross");
        assert_eq!(
            refusal,
            CanonicalSessionCrossingRefusal::ServiceInstanceRefused(
                ServiceInstanceBinding::MissingIpcObservation
            )
        );
        // The pairing refusals disclose neither stored value (no digits at all).
        assert!(!format!("{refusal:?}").chars().any(|c| c.is_ascii_digit()));
    }

    // T3: a bundle for a DIFFERENT connection cannot cross against this verifier.
    #[test]
    fn integration_wrong_connection_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let attempt = completed_attempt_on(
            (1, 1),
            (1, 1),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle = bundle_for(
            iv.connection_id().wrapping_add(1),
            iv.handshake_generation(),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(attempt, bundle, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::ConnectionMismatch
        );
    }

    // T4: a bundle from a PRIOR handshake generation cannot cross after the generation changed.
    #[test]
    fn integration_stale_handshake_generation_prevents_session_evidence() {
        let iv = ProductionIpcSessionVerifier::for_local_proof();
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(1_000, 7),
            1_000_000,
        );
        let attempt = completed_attempt_on(
            (1, 1),
            (1, 1),
            (1, 1),
            iv.connection_id(),
            iv.handshake_generation(),
        );
        let bundle = bundle_for(
            iv.connection_id(),
            iv.handshake_generation().wrapping_sub(1),
            clock.read_current().reading(),
        );
        assert_eq!(
            bind_canonical_peer_to_session_evidence(attempt, bundle, &iv).unwrap_err(),
            CanonicalSessionCrossingRefusal::HandshakeGenerationMismatch
        );
    }

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
