//! Closed, redacted classification of local-IPC outcomes: Win32 errors → closed [`IpcFailure`], bounded
//! retry policy, peer-role validation, and shutdown/residue classification. No raw numeric error, error
//! text, endpoint, handle, PID/TID, machine identity or descriptor detail is ever representable here.

use crate::contracts::{EndpointFreshness, IpcResidue, IpcShutdownResult, ReplayClassification};

/// The absolute ceiling on retry attempts for ANY bounded wait. A policy can request fewer, never more.
pub const MAX_ATTEMPTS_CEILING: u32 = 50;

/// The closed, redacted classification of a Windows local-IPC failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcFailure {
    /// Access was denied.
    AccessDenied,
    /// The endpoint already exists (a squatting or non-first instance).
    EndpointAlreadyExists,
    /// The endpoint was unavailable.
    EndpointUnavailable,
    /// The first-instance flag could not be honoured (an instance already exists).
    FirstInstanceUnavailable,
    /// A connection wait timed out.
    ConnectionTimedOut,
    /// A read timed out.
    ReadTimedOut,
    /// A write timed out.
    WriteTimedOut,
    /// A shutdown acknowledgement timed out.
    ShutdownTimedOut,
    /// The peer broke the connection.
    BrokenPeer,
    /// The operation was cancelled (bounded cancellation).
    OperationCancelled,
    /// The security principal was unavailable (host-authority not Ready).
    SecurityPrincipalUnavailable,
    /// No fixed-capacity quarantine admission permit was available, so the operation was NEVER issued.
    /// Fail-closed, non-authoritative and never retried automatically — a caller may retry only after a
    /// bounded drain confirms capacity became available.
    QuarantineCapacityUnavailable,
    /// The platform is unsupported (non-Windows).
    UnsupportedPlatform,
    /// Any other failure — fail closed.
    UnexpectedFailure,
}

impl IpcFailure {
    /// Whether this failure is NON-retryable: a security, protocol, endpoint-identity or peer decision
    /// that must never be silently retried.
    #[must_use]
    pub fn is_non_retryable(self) -> bool {
        matches!(
            self,
            Self::AccessDenied
                | Self::EndpointAlreadyExists
                | Self::FirstInstanceUnavailable
                | Self::BrokenPeer
                | Self::OperationCancelled
                | Self::SecurityPrincipalUnavailable
                | Self::QuarantineCapacityUnavailable
                | Self::UnsupportedPlatform
        )
    }
}

/// Redact a raw Win32 error code into a closed [`IpcFailure`] immediately at the FFI boundary. The raw
/// code never leaves this function.
#[must_use]
pub fn classify_ipc_error(win32: u32) -> IpcFailure {
    match win32 {
        5 => IpcFailure::AccessDenied,            // ERROR_ACCESS_DENIED
        183 => IpcFailure::EndpointAlreadyExists, // ERROR_ALREADY_EXISTS
        231 => IpcFailure::EndpointUnavailable,   // ERROR_PIPE_BUSY
        2 | 3 => IpcFailure::EndpointUnavailable, // ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND
        109 | 232 => IpcFailure::BrokenPeer,      // ERROR_BROKEN_PIPE / ERROR_NO_DATA
        121 => IpcFailure::ReadTimedOut,          // ERROR_SEM_TIMEOUT
        995 => IpcFailure::OperationCancelled,    // ERROR_OPERATION_ABORTED
        _ => IpcFailure::UnexpectedFailure,
    }
}

/// A bounded retry policy. The attempt count is CLAMPED to [`MAX_ATTEMPTS_CEILING`]; there is no
/// unbounded loop and no infinite retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    max_attempts: u32,
}

impl RetryPolicy {
    /// A bounded policy; `requested` is clamped to `[1, MAX_ATTEMPTS_CEILING]`.
    #[must_use]
    pub fn bounded(requested: u32) -> Self {
        Self {
            max_attempts: requested.clamp(1, MAX_ATTEMPTS_CEILING),
        }
    }

    /// The clamped maximum attempts.
    #[must_use]
    pub fn max_attempts(self) -> u32 {
        self.max_attempts
    }
}

/// The default bounded wait policy.
#[must_use]
pub fn default_wait_policy() -> RetryPolicy {
    RetryPolicy::bounded(20)
}

/// The closed, expected peer roles on the proof channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PeerRole {
    /// The controller endpoint.
    Controller,
    /// The service fixture endpoint.
    ServiceFixture,
    /// A refused or unknown peer.
    RefusedOrUnknown,
}

impl PeerRole {
    /// The closed wire discriminant carried in the handshake control byte.
    #[must_use]
    pub fn wire(self) -> u8 {
        match self {
            Self::Controller => 1,
            Self::ServiceFixture => 2,
            Self::RefusedOrUnknown => 0,
        }
    }

    /// Decode a wire discriminant. Anything unknown decodes to `RefusedOrUnknown` (fail closed).
    #[must_use]
    pub fn from_wire(value: u8) -> Self {
        match value {
            1 => Self::Controller,
            2 => Self::ServiceFixture,
            _ => Self::RefusedOrUnknown,
        }
    }
}

/// Validate an observed peer role against the expected role. A mismatch (or unknown peer) is refused;
/// it is NEVER retried.
#[must_use]
pub fn verify_peer_role(expected: PeerRole, observed: PeerRole) -> bool {
    expected != PeerRole::RefusedOrUnknown && expected == observed
}

/// The closed terminal classification of a cancelled overlapped operation. Cancellation is only ever
/// CONFIRMED by a bounded terminal completion query — `CancelIoEx` returning success proves nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CancellationTerminalState {
    /// The operation completed successfully before the cancellation took effect.
    CompletedBeforeCancellation,
    /// The cancellation reached a confirmed terminal state.
    CancelledConfirmed,
    /// The operation terminated with a failure.
    FailedTerminally,
    /// Terminal completion could not be confirmed within the bounded cancellation grace — the operation
    /// and everything it references MUST be quarantined, never dropped.
    CancellationTerminalizationTimedOut,
}

impl CancellationTerminalState {
    /// Whether the operation reached a terminal state, so its OVERLAPPED/event/buffer/handle may be
    /// released. A terminalization timeout is NOT terminal.
    #[must_use]
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::CancellationTerminalizationTimedOut)
    }
}

/// Classify endpoint freshness: only a first-instance endpoint is fresh; a pre-existing one is stale
/// and refused.
#[must_use]
pub fn verify_endpoint_fresh(freshness: EndpointFreshness) -> bool {
    matches!(freshness, EndpointFreshness::Fresh)
}

/// Classify a replay: only a fresh single-use nonce is accepted.
#[must_use]
pub fn verify_not_replayed(replay: ReplayClassification) -> bool {
    matches!(replay, ReplayClassification::FreshAccepted)
}

/// A shutdown is confirmed only when it is clean.
#[must_use]
pub fn verify_clean_shutdown(result: IpcShutdownResult) -> bool {
    matches!(result, IpcShutdownResult::CleanShutdown)
}

/// Residue is acceptable only when it is exactly zero; non-zero and indeterminate fail closed.
#[must_use]
pub fn verify_zero_residue(residue: IpcResidue) -> bool {
    matches!(residue, IpcResidue::Zero)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win32_errors_redact_to_closed_failures() {
        assert_eq!(classify_ipc_error(5), IpcFailure::AccessDenied);
        assert_eq!(classify_ipc_error(183), IpcFailure::EndpointAlreadyExists);
        assert_eq!(classify_ipc_error(109), IpcFailure::BrokenPeer);
        assert_eq!(classify_ipc_error(995), IpcFailure::OperationCancelled);
        assert_eq!(classify_ipc_error(4242), IpcFailure::UnexpectedFailure);
    }

    #[test]
    fn security_and_endpoint_failures_are_non_retryable() {
        for f in [
            IpcFailure::AccessDenied,
            IpcFailure::EndpointAlreadyExists,
            IpcFailure::FirstInstanceUnavailable,
            IpcFailure::BrokenPeer,
            IpcFailure::OperationCancelled,
            IpcFailure::SecurityPrincipalUnavailable,
            IpcFailure::UnsupportedPlatform,
        ] {
            assert!(f.is_non_retryable());
        }
        assert!(!IpcFailure::ConnectionTimedOut.is_non_retryable());
    }

    #[test]
    fn retry_policy_is_bounded() {
        assert_eq!(
            RetryPolicy::bounded(10_000).max_attempts(),
            MAX_ATTEMPTS_CEILING
        );
        assert_eq!(RetryPolicy::bounded(0).max_attempts(), 1);
        assert!(default_wait_policy().max_attempts() <= MAX_ATTEMPTS_CEILING);
    }

    #[test]
    fn peer_role_mismatch_and_unknown_are_refused() {
        assert!(verify_peer_role(PeerRole::Controller, PeerRole::Controller));
        assert!(!verify_peer_role(
            PeerRole::Controller,
            PeerRole::ServiceFixture
        ));
        assert!(!verify_peer_role(
            PeerRole::RefusedOrUnknown,
            PeerRole::RefusedOrUnknown
        ));
    }

    #[test]
    fn only_a_confirmed_terminal_state_permits_release() {
        for s in [
            CancellationTerminalState::CompletedBeforeCancellation,
            CancellationTerminalState::CancelledConfirmed,
            CancellationTerminalState::FailedTerminally,
        ] {
            assert!(
                s.is_terminal(),
                "confirmed terminal states release resources"
            );
        }
        // An unconfirmed terminalization is NOT terminal — the operation must be quarantined.
        assert!(!CancellationTerminalState::CancellationTerminalizationTimedOut.is_terminal());
    }

    #[test]
    fn peer_roles_round_trip_and_unknown_wire_fails_closed() {
        for r in [PeerRole::Controller, PeerRole::ServiceFixture] {
            assert_eq!(PeerRole::from_wire(r.wire()), r);
        }
        assert_eq!(PeerRole::from_wire(0), PeerRole::RefusedOrUnknown);
        assert_eq!(PeerRole::from_wire(99), PeerRole::RefusedOrUnknown);
    }

    #[test]
    fn freshness_replay_shutdown_residue_fail_closed() {
        assert!(verify_endpoint_fresh(EndpointFreshness::Fresh));
        assert!(!verify_endpoint_fresh(EndpointFreshness::Stale));
        assert!(verify_not_replayed(ReplayClassification::FreshAccepted));
        assert!(!verify_not_replayed(ReplayClassification::ReplayRefused));
        assert!(verify_clean_shutdown(IpcShutdownResult::CleanShutdown));
        assert!(!verify_clean_shutdown(IpcShutdownResult::ShutdownFailed));
        assert!(verify_zero_residue(IpcResidue::Zero));
        assert!(!verify_zero_residue(IpcResidue::NonZero));
        assert!(!verify_zero_residue(IpcResidue::Indeterminate));
    }
}
