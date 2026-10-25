//! Public-surface, effect-free contract tests for the bounded local-IPC transport. They exercise only
//! the public API and perform NO Windows call, create NO pipe, and resolve NO service principal. The
//! adapter's orchestration is proven separately by the crate's unit tests with a deterministic fake.

use projectos_host_windows_local_ipc as ipc;

use ipc::{
    EndpointSecurityDecision, FrameParseError, IpcFailure, MessageKind, PeerRole,
    ProjectOsHostPipeSecurityStatus, RetryPolicy, MAX_ATTEMPTS_CEILING, WIRE_PROTOCOL_VERSION,
};

#[test]
// The phase-state constants are deliberately asserted directly.
#[allow(clippy::assertions_on_constants)]
fn current_state_is_transport_implemented_compile_only_not_contract_only() {
    use ipc::LocalIpcTransportState;
    // Truthful: the Windows transport is implemented, but compile-only — NOT entirely contract-only.
    assert_eq!(
        ipc::LOCAL_IPC_TRANSPORT_STATE,
        LocalIpcTransportState::WindowsTransportImplementedCompileOnly
    );
    assert!(!ipc::LOCAL_IPC_IS_CONTRACT_ONLY);
    assert!(!ipc::LIVE_LOCAL_IPC_AUTHORISED);
}

#[test]
fn protocol_version_is_fixed() {
    assert_eq!(WIRE_PROTOCOL_VERSION, 1);
}

#[test]
fn message_kinds_are_closed_and_unknown_discriminants_are_refused() {
    for k in [
        MessageKind::ControllerHello,
        MessageKind::ServiceReady,
        MessageKind::ServiceEvidence,
        MessageKind::AuthorityOutcome,
        MessageKind::ShutdownRequest,
        MessageKind::ShutdownAcknowledged,
        MessageKind::TypedRefusal,
    ] {
        assert_eq!(MessageKind::from_discriminant(k.discriminant()), Some(k));
    }
    assert_eq!(MessageKind::from_discriminant(0), None);
    assert_eq!(MessageKind::from_discriminant(200), None);
}

#[test]
fn empty_and_truncated_buffers_fail_closed() {
    assert!(ipc::parse_single_frame(&[]).is_err());
    assert_eq!(
        ipc::parse_single_frame(&[0u8; 4]),
        Err(FrameParseError::TruncatedHeader)
    );
}

#[test]
fn security_is_fail_closed_and_only_ready_proceeds() {
    assert_eq!(
        ipc::evaluate_pipe_security(ProjectOsHostPipeSecurityStatus::Ready),
        EndpointSecurityDecision::Proceed
    );
    assert!(!ipc::evaluate_pipe_security(
        ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof
    )
    .permits_endpoint());
    for s in [
        ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable,
        ProjectOsHostPipeSecurityStatus::AccessDenied,
        ProjectOsHostPipeSecurityStatus::UnsupportedPlatform,
        ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed,
        ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure,
    ] {
        assert!(!ipc::evaluate_pipe_security(s).permits_endpoint());
    }
}

#[test]
fn win32_errors_redact_and_non_retryable_failures_are_flagged() {
    assert_eq!(ipc::classify_ipc_error(5), IpcFailure::AccessDenied);
    assert!(IpcFailure::SecurityPrincipalUnavailable.is_non_retryable());
    assert!(IpcFailure::AccessDenied.is_non_retryable());
}

#[test]
fn peer_role_mismatch_is_refused() {
    assert!(ipc::verify_peer_role(
        PeerRole::Controller,
        PeerRole::Controller
    ));
    assert!(!ipc::verify_peer_role(
        PeerRole::Controller,
        PeerRole::ServiceFixture
    ));
}

#[test]
fn a_bare_connection_is_unauthenticated_and_confirms_no_peer() {
    use ipc::{ConnectionState, HandshakeOutcome};
    // The transport state carries NO role — there is no accepted-role variant reachable from a connect.
    let connected = ConnectionState::TransportConnectedUnauthenticated;
    assert_ne!(
        connected,
        ConnectionState::ConnectFailed(IpcFailure::ConnectionTimedOut)
    );
    // Only the fully verified handshake outcome confirms the expected peer.
    assert!(!HandshakeOutcome::TransportConnectedUnauthenticated.is_peer_confirmed());
    for refused in [
        HandshakeOutcome::RefusedWrongMessageKind,
        HandshakeOutcome::RefusedNonceMismatch,
        HandshakeOutcome::RefusedReplay,
        HandshakeOutcome::RefusedStale,
        HandshakeOutcome::RefusedRole,
        HandshakeOutcome::Failed(IpcFailure::ReadTimedOut),
    ] {
        assert!(!refused.is_peer_confirmed());
    }
    assert!(HandshakeOutcome::ExpectedServiceFixturePeerConfirmed.is_peer_confirmed());
}

#[test]
fn peer_roles_have_closed_wire_encoding_and_unknown_fails_closed() {
    assert_eq!(
        PeerRole::from_wire(PeerRole::Controller.wire()),
        PeerRole::Controller
    );
    assert_eq!(
        PeerRole::from_wire(PeerRole::ServiceFixture.wire()),
        PeerRole::ServiceFixture
    );
    assert_eq!(PeerRole::from_wire(0), PeerRole::RefusedOrUnknown);
    assert_eq!(PeerRole::from_wire(200), PeerRole::RefusedOrUnknown);
}

#[test]
fn only_confirmed_terminal_cancellation_releases_resources() {
    use ipc::CancellationTerminalState as C;
    assert!(C::CompletedBeforeCancellation.is_terminal());
    assert!(C::CancelledConfirmed.is_terminal());
    assert!(C::FailedTerminally.is_terminal());
    // Unconfirmed terminalization must quarantine, never release.
    assert!(!C::CancellationTerminalizationTimedOut.is_terminal());
}

#[test]
fn waits_are_bounded() {
    assert_eq!(
        RetryPolicy::bounded(1_000_000).max_attempts(),
        MAX_ATTEMPTS_CEILING
    );
    assert!(ipc::default_wait_policy().max_attempts() <= MAX_ATTEMPTS_CEILING);
}
