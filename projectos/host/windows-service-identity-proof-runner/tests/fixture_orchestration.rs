//! EXTERNAL-consumer proof of the compile-only proof-runner orchestration
//! (3K-I-D-E-C-CAPABILITY-B4-PROOF-RUNNER-INTEGRATION1A-REENTRY2).
//!
//! This file is an external consumer of the crate, so it exercises exactly the public surface a future
//! caller sees. It drives the runner through the SIBLING FAÇADES only; it never calls
//! `record_scm_before`, `record_ipc_peer`, `record_scm_after`, `synthetic_observation`, a token
//! constructor, `windows_ffi` or any Win32 function — none of which it can even name.
//!
//! Nothing here creates a pipe, queries the SCM, opens or launches a process, or touches a service.

#![cfg(feature = "test-fixtures")]

use projectos_host_windows_local_ipc as ipc;
use projectos_host_windows_service_identity_proof_runner::{
    run_compile_only_proof, CompileOnlyProofOutcome, CompileOnlyProofRequest,
    CompileOnlyServiceFixture, FixtureDisconnectBehaviour, FixtureResidue,
    FixtureShutdownBehaviour, ProofRunnerInstanceRefusal, EXECUTION_READY,
    LIVE_PROOF_ORCHESTRATION_AUTHORISED, PROOF_RUNNER_IS_CONTRACT_ONLY,
};

/// A valid ControllerHello transcript, built by the local-ipc fixture surface.
fn valid_transcript() -> ipc::HandshakeObservation {
    ipc::synthetic_controller_hello()
}

fn run(
    fixture: &CompileOnlyServiceFixture,
    obs: ipc::HandshakeObservation,
) -> CompileOnlyProofOutcome {
    run_compile_only_proof(CompileOnlyProofRequest::new(), fixture, obs)
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn the_complete_fixture_sequence_corroborates_compile_only() {
    let outcome = run(
        &CompileOnlyServiceFixture::cooperative(),
        valid_transcript(),
    );
    assert_eq!(
        outcome,
        CompileOnlyProofOutcome::CompileOnlySameInstanceCorroborated
    );
    assert!(outcome.is_compile_only_corroborated());
    assert!(outcome.refusal().is_none());
}

// ---- NEGATIVE: no earlier step is authority ----------------------------------------------------

#[test]
fn a_confirmed_handshake_alone_is_not_authority() {
    // The transcript is perfectly valid — the handshake WILL confirm — yet the proof still refuses,
    // because the peer never stands down. Handshake success is necessary, never sufficient.
    let fixture = CompileOnlyServiceFixture::with_behaviour(
        FixtureShutdownBehaviour::WithholdAcknowledgement,
        FixtureDisconnectBehaviour::Disconnect,
        FixtureResidue::Zero,
    );
    assert_eq!(
        run(&fixture, valid_transcript()).refusal(),
        Some(ProofRunnerInstanceRefusal::ShutdownNotAcknowledged)
    );
}

#[test]
fn a_corroborated_binding_is_not_authority_until_the_transport_closes() {
    let fixture = CompileOnlyServiceFixture::with_behaviour(
        FixtureShutdownBehaviour::Acknowledge,
        FixtureDisconnectBehaviour::RemainConnected,
        FixtureResidue::Zero,
    );
    assert_eq!(
        run(&fixture, valid_transcript()).refusal(),
        Some(ProofRunnerInstanceRefusal::DisconnectNotCompleted)
    );
}

#[test]
fn every_unclean_residue_refuses_confirmation() {
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
            run(&fixture, valid_transcript()).refusal(),
            Some(ProofRunnerInstanceRefusal::ResidueNonZero),
            "{residue:?} must refuse"
        );
    }
}

// ---- NEGATIVE: the handshake transcript cannot be used to assert success ------------------------

#[test]
fn a_wrong_role_transcript_yields_no_ipc_evidence() {
    let mut obs = valid_transcript();
    obs.role = ipc::PeerRole::RefusedOrUnknown;
    assert_eq!(
        run(&CompileOnlyServiceFixture::cooperative(), obs).refusal(),
        Some(ProofRunnerInstanceRefusal::IpcInstanceEvidenceMissing)
    );
}

#[test]
fn a_replayed_transcript_yields_no_ipc_evidence() {
    let mut obs = valid_transcript();
    obs.replay = ipc::ReplayClassification::ReplayRefused;
    assert_eq!(
        run(&CompileOnlyServiceFixture::cooperative(), obs).refusal(),
        Some(ProofRunnerInstanceRefusal::IpcInstanceEvidenceMissing)
    );
}

#[test]
fn a_stale_endpoint_yields_no_ipc_evidence() {
    let mut obs = valid_transcript();
    obs.freshness = ipc::EndpointFreshness::Stale;
    assert!(!run(&CompileOnlyServiceFixture::cooperative(), obs).is_compile_only_corroborated());
}

#[test]
fn a_nonce_mismatch_yields_no_ipc_evidence() {
    let mut obs = valid_transcript();
    obs.nonce_matches = false;
    assert!(!run(&CompileOnlyServiceFixture::cooperative(), obs).is_compile_only_corroborated());
}

#[test]
fn a_wrong_first_message_yields_no_ipc_evidence() {
    let mut obs = valid_transcript();
    obs.kind = ipc::MessageKind::ServiceReady;
    assert!(!run(&CompileOnlyServiceFixture::cooperative(), obs).is_compile_only_corroborated());
}

// ---- EVIDENCE OWNERSHIP AND REDACTION ----------------------------------------------------------

#[test]
fn the_runner_never_exposes_dependency_identity_in_its_evidence() {
    // The outcome is the runner's own vocabulary. No dependency type name and no numeric identity
    // (process id, creation time, attempt id, timestamp) may appear.
    for outcome in [
        run(
            &CompileOnlyServiceFixture::cooperative(),
            valid_transcript(),
        ),
        run(
            &CompileOnlyServiceFixture::with_behaviour(
                FixtureShutdownBehaviour::Acknowledge,
                FixtureDisconnectBehaviour::Disconnect,
                FixtureResidue::QuarantinedIo,
            ),
            valid_transcript(),
        ),
    ] {
        let rendered = format!("{outcome:?}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        for forbidden in [
            "ServiceInstanceBinding",
            "ServiceInstanceToken",
            "ServiceInstanceObservation",
            "ConfirmedIpcPeerHandshake",
            "SyntheticInstanceSelector",
        ] {
            assert!(
                !rendered.contains(forbidden),
                "{forbidden} leaked: {rendered}"
            );
        }
    }
}

#[test]
fn the_request_carries_no_caller_supplied_evidence() {
    // No public field exists, so a caller cannot assert an outcome, a process, a nonce or a role.
    let rendered = format!("{:?}", CompileOnlyProofRequest::new());
    assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
    assert_eq!(
        CompileOnlyProofRequest::new(),
        CompileOnlyProofRequest::default()
    );
}

// ---- TRUTHFUL PHASE STATE ----------------------------------------------------------------------

#[test]
// The point of the assertion IS that these consts still hold their frozen values.
#[allow(clippy::assertions_on_constants)]
fn a_compile_only_corroboration_never_implies_a_live_proof() {
    assert!(PROOF_RUNNER_IS_CONTRACT_ONLY);
    assert!(!LIVE_PROOF_ORCHESTRATION_AUTHORISED);
    assert!(!EXECUTION_READY);
    // Even after a successful compile-only run, nothing became execution-ready.
    assert!(run(
        &CompileOnlyServiceFixture::cooperative(),
        valid_transcript()
    )
    .is_compile_only_corroborated());
    assert!(!EXECUTION_READY);
}
