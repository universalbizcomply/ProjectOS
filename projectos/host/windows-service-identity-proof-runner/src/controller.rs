//! The bounded, compile-only proof controller.
//!
//! It owns the orchestration and NOTHING that could substitute for it: one immutable request, one
//! binding attempt, one SCM capability, one IPC capability, one confirmed handshake, one contributor,
//! one shutdown lifecycle, one residue assessment.
//!
//! It accepts no caller-created success boolean, no caller-created `Match`, no caller-created
//! corroboration, no raw process identity, no raw token and no caller-created handshake confirmation.
//! Every conclusion is obtained by driving the SIBLING FAÇADES — service-control for SCM-before and
//! SCM-after, local-ipc for the confirmed peer — never by calling an identity-proof transition
//! directly. There is exactly one positive path, and it runs to the end or refuses.
//!
//! Compiled only under `test-fixtures`, because the capabilities it needs exist only there. The
//! default build keeps no orchestration at all, so nothing here can run in a production graph.

#![cfg(feature = "test-fixtures")]

use projectos_host_windows_local_ipc as ipc;
use projectos_host_windows_service_control as sc;
use projectos_host_windows_service_identity_proof as idp;

use crate::corroboration::{map_binding, ProofRunnerInstanceRefusal};
use crate::fixture::{CompileOnlyServiceFixture, FixtureShutdownOutcome};
use crate::plan::ProofStage;

/// The immutable proof request.
///
/// It carries no evidence and no expectation: there is deliberately no field a caller could use to
/// assert an outcome, name a process, supply a nonce or pre-declare a role. The request says only
/// "run one compile-only proof".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct CompileOnlyProofRequest {
    _private: (),
}

impl CompileOnlyProofRequest {
    /// The only way to build a request. Takes nothing, so it can assert nothing.
    #[must_use]
    pub fn new() -> Self {
        Self { _private: () }
    }
}

impl Default for CompileOnlyProofRequest {
    fn default() -> Self {
        Self::new()
    }
}

/// The proof runner's own final outcome.
///
/// The positive value means EXACTLY: the compile-only orchestration completed, fake-backed IPC and SCM
/// evidence bound to one instance, shutdown was acknowledged, the transport disconnected and residue
/// was Zero. It is NOT a live proof, NOT service authority, NOT execution readiness and NOT
/// installation readiness — the name says compile-only so no report can imply otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CompileOnlyProofOutcome {
    /// Every required step completed and both sources described one running instance.
    CompileOnlySameInstanceCorroborated,
    /// The proof was refused, with the exact closed reason and the stage it reached.
    Refused {
        /// Why it was refused.
        reason: ProofRunnerInstanceRefusal,
        /// The furthest stage reached before refusal.
        stage: ProofStage,
    },
}

impl CompileOnlyProofOutcome {
    /// Whether the compile-only proof corroborated. Never implies a live proof.
    #[must_use]
    pub fn is_compile_only_corroborated(self) -> bool {
        matches!(self, Self::CompileOnlySameInstanceCorroborated)
    }

    /// The closed refusal reason, when refused.
    #[must_use]
    pub fn refusal(self) -> Option<ProofRunnerInstanceRefusal> {
        match self {
            Self::CompileOnlySameInstanceCorroborated => None,
            Self::Refused { reason, .. } => Some(reason),
        }
    }

    /// The furthest stage reached. Closed enum; carries no identity.
    #[must_use]
    pub fn stage(self) -> Option<ProofStage> {
        match self {
            Self::CompileOnlySameInstanceCorroborated => None,
            Self::Refused { stage, .. } => Some(stage),
        }
    }
}

/// Refuse at a stage, with a closed reason.
fn refuse(reason: ProofRunnerInstanceRefusal, stage: ProofStage) -> CompileOnlyProofOutcome {
    CompileOnlyProofOutcome::Refused { reason, stage }
}

/// Run ONE bounded, compile-only proof.
///
/// The ordering is the proof. SCM-before must precede the peer and the peer must precede SCM-after —
/// enforced by the attempt's typestate, not by checks here — and no earlier step establishes authority:
/// a connected transport, a completed handshake, a confirmed role and a running service are each
/// necessary and none is sufficient. Corroboration is decided only at finalisation, and even a
/// corroborated binding still has to survive shutdown, disconnect and residue before it confirms.
///
/// The `observation` parameter is the transcript the fixture peer presents; it is VALIDATED by
/// local-ipc's handshake state machine, so a caller cannot use it to assert success — a malformed or
/// replayed transcript simply fails to produce a confirmation.
#[must_use]
pub fn run_compile_only_proof(
    _request: CompileOnlyProofRequest,
    fixture: &CompileOnlyServiceFixture,
    observation: ipc::HandshakeObservation,
) -> CompileOnlyProofOutcome {
    use ProofRunnerInstanceRefusal as R;

    // 2-3. Fixture-only capabilities. Nothing here is live authority.
    let scm_cap = sc::LiveOperationCapability::synthetic_for_fixture();
    let ipc_cap = ipc::LiveIpcOperationCapability::synthetic_for_fixture();
    let obs_cap = idp::LiveInstanceObservationCapability::synthetic_for_fixture();

    // 4. Exactly one binding attempt for this proof.
    let attempt = idp::ServiceInstanceBindingAttempt::begin(&obs_cap);

    // 5. SCM-before, through the service-control façade.
    let attempt = match sc::contribute_scm_before(&scm_cap, attempt) {
        idp::AttemptOutcome::Continue(a) => a,
        idp::AttemptOutcome::Refused(binding) => {
            return refuse(
                map_binding(binding)
                    .refusal()
                    .unwrap_or(R::ScmInstanceEvidenceMissing),
                ProofStage::CorroborateScm,
            );
        }
    };

    // 6-10. ControllerHello, protocol version, expected ServiceFixture role, ServiceReady and replay
    // are ALL validated by local-ipc's state machine. A confirmation exists only if every check passed;
    // this controller cannot manufacture one.
    let transition = ipc::run_fixture_handshake(&ipc_cap, observation);
    let Some(confirmed) = transition.into_confirmed() else {
        // Transport may well have connected — that is precisely why it is not authority.
        return refuse(R::IpcInstanceEvidenceMissing, ProofStage::AwaitTypedIpc);
    };

    // 11. The contributor exists only because the handshake confirmed, and consumes the confirmation.
    let contributor = ipc::FixtureIpcPeerContributor::from_confirmed(confirmed);

    // 12. The confirmed peer's OS-derived instance, through the local-ipc façade.
    let attempt = match contributor.contribute_ipc_peer(&ipc_cap, attempt) {
        idp::AttemptOutcome::Continue(a) => a,
        idp::AttemptOutcome::Refused(binding) => {
            return refuse(
                map_binding(binding)
                    .refusal()
                    .unwrap_or(R::IpcInstanceEvidenceMissing),
                ProofStage::AwaitTypedIpc,
            );
        }
    };

    // 13. SCM-after — a FRESH observation, never the cached SCM-before result.
    let attempt = match sc::contribute_scm_after(&scm_cap, attempt) {
        idp::AttemptOutcome::Continue(a) => a,
        idp::AttemptOutcome::Refused(binding) => {
            return refuse(
                map_binding(binding)
                    .refusal()
                    .unwrap_or(R::ScmInstanceEvidenceMissing),
                ProofStage::CorroborateScm,
            );
        }
    };

    // 14-16. Finalise and translate into proof-runner vocabulary. The dependency verdict stops here.
    let corroboration = map_binding(attempt.finalise());
    if let Some(reason) = corroboration.refusal() {
        return refuse(reason, ProofStage::CorroborateScm);
    }

    // 17-18. Bounded shutdown. A corroborated binding is still not a proof until the peer stands down.
    if fixture.request_shutdown() != FixtureShutdownOutcome::Acknowledged {
        return refuse(R::ShutdownNotAcknowledged, ProofStage::StopService);
    }

    // 19. Disconnect.
    if !fixture.disconnected() {
        return refuse(R::DisconnectNotCompleted, ProofStage::StopService);
    }

    // 20-21. Residue must be exactly Zero; pending, quarantined, reserved, occupied, retained and
    // indeterminate all refuse.
    if !fixture.classify_residue().is_zero() {
        return refuse(R::ResidueNonZero, ProofStage::VerifyZeroResidue);
    }

    // 22. Only now.
    CompileOnlyProofOutcome::CompileOnlySameInstanceCorroborated
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixture::{FixtureDisconnectBehaviour, FixtureResidue, FixtureShutdownBehaviour};

    fn valid_transcript() -> ipc::HandshakeObservation {
        ipc::synthetic_controller_hello()
    }

    #[test]
    fn the_complete_ordered_sequence_corroborates() {
        let outcome = run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            valid_transcript(),
        );
        assert_eq!(
            outcome,
            CompileOnlyProofOutcome::CompileOnlySameInstanceCorroborated
        );
        assert!(outcome.is_compile_only_corroborated());
    }

    #[test]
    fn a_withheld_shutdown_acknowledgement_refuses() {
        let fixture = CompileOnlyServiceFixture::with_behaviour(
            FixtureShutdownBehaviour::WithholdAcknowledgement,
            FixtureDisconnectBehaviour::Disconnect,
            FixtureResidue::Zero,
        );
        let outcome =
            run_compile_only_proof(CompileOnlyProofRequest::new(), &fixture, valid_transcript());
        assert_eq!(
            outcome.refusal(),
            Some(ProofRunnerInstanceRefusal::ShutdownNotAcknowledged)
        );
        assert!(!outcome.is_compile_only_corroborated());
    }

    #[test]
    fn a_transport_that_never_disconnects_refuses() {
        let fixture = CompileOnlyServiceFixture::with_behaviour(
            FixtureShutdownBehaviour::Acknowledge,
            FixtureDisconnectBehaviour::RemainConnected,
            FixtureResidue::Zero,
        );
        assert_eq!(
            run_compile_only_proof(CompileOnlyProofRequest::new(), &fixture, valid_transcript())
                .refusal(),
            Some(ProofRunnerInstanceRefusal::DisconnectNotCompleted)
        );
    }

    #[test]
    fn every_non_zero_residue_refuses() {
        for residue in [
            FixtureResidue::PendingIo,
            FixtureResidue::QuarantinedIo,
            FixtureResidue::QuarantineReserved,
            FixtureResidue::QuarantineOccupied,
            FixtureResidue::ControllerResidue,
            FixtureResidue::FixtureResidue,
            FixtureResidue::Indeterminate,
        ] {
            let fixture = CompileOnlyServiceFixture::with_behaviour(
                FixtureShutdownBehaviour::Acknowledge,
                FixtureDisconnectBehaviour::Disconnect,
                residue,
            );
            assert_eq!(
                run_compile_only_proof(
                    CompileOnlyProofRequest::new(),
                    &fixture,
                    valid_transcript()
                )
                .refusal(),
                Some(ProofRunnerInstanceRefusal::ResidueNonZero),
                "residue {residue:?} must refuse"
            );
        }
    }

    #[test]
    fn a_wrong_role_transcript_never_corroborates() {
        // The peer declares Controller where ServiceFixture is expected: the handshake machine refuses,
        // so no confirmation exists and no contributor can be built.
        let mut obs = valid_transcript();
        obs.role = ipc::PeerRole::RefusedOrUnknown;
        let outcome = run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            obs,
        );
        assert_eq!(
            outcome.refusal(),
            Some(ProofRunnerInstanceRefusal::IpcInstanceEvidenceMissing)
        );
    }

    #[test]
    fn a_replayed_transcript_never_corroborates() {
        let mut obs = valid_transcript();
        obs.replay = ipc::ReplayClassification::ReplayRefused;
        assert_eq!(
            run_compile_only_proof(
                CompileOnlyProofRequest::new(),
                &CompileOnlyServiceFixture::cooperative(),
                obs
            )
            .refusal(),
            Some(ProofRunnerInstanceRefusal::IpcInstanceEvidenceMissing)
        );
    }

    #[test]
    fn a_stale_endpoint_never_corroborates() {
        let mut obs = valid_transcript();
        obs.freshness = ipc::EndpointFreshness::Stale;
        assert!(!run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            obs
        )
        .is_compile_only_corroborated());
    }

    #[test]
    fn a_nonce_mismatch_never_corroborates() {
        let mut obs = valid_transcript();
        obs.nonce_matches = false;
        assert!(!run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            obs
        )
        .is_compile_only_corroborated());
    }

    #[test]
    fn a_wrong_first_message_never_corroborates() {
        let mut obs = valid_transcript();
        obs.kind = ipc::MessageKind::ServiceReady;
        assert!(!run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            obs
        )
        .is_compile_only_corroborated());
    }

    #[test]
    fn the_request_cannot_assert_anything() {
        // The request has no public field, so a caller cannot pre-declare an outcome, a process, a
        // nonce or a role. Two requests are indistinguishable.
        assert_eq!(
            CompileOnlyProofRequest::new(),
            CompileOnlyProofRequest::default()
        );
        let rendered = format!("{:?}", CompileOnlyProofRequest::new());
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
    }

    #[test]
    fn outcome_output_carries_no_identity() {
        let outcome = run_compile_only_proof(
            CompileOnlyProofRequest::new(),
            &CompileOnlyServiceFixture::cooperative(),
            valid_transcript(),
        );
        let rendered = format!("{outcome:?}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        // And the dependency's own vocabulary never appears in the runner's evidence.
        assert!(!rendered.contains("ServiceInstanceBinding"));
        assert!(!rendered.contains("ServiceInstanceToken"));
    }
}
