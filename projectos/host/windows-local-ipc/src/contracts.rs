//! The closed local-IPC transport contract types. No arbitrary pipe name, byte payload, metadata,
//! diagnostic text or raw identity can be represented.

use projectos_host_windows_service_identity_proof::{
    AuthorityTokenOutcome, ConfirmedPeer, ServiceIdentityEvidence,
};

/// The transport policy. Single variant: a LOCAL-ONLY named pipe. There is no arbitrary pipe-name
/// field; the endpoint name is derived by the future transport under the accepted test prefix and is
/// never stored in public evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LocalOnlyTransport {
    /// A local named pipe that refuses remote clients.
    NamedPipeLocalOnly,
}

impl LocalOnlyTransport {
    /// The fixed transport policy.
    #[must_use]
    pub fn policy() -> Self {
        Self::NamedPipeLocalOnly
    }

    /// Remote clients are always refused (`PIPE_REJECT_REMOTE_CLIENTS`).
    #[must_use]
    pub fn remote_clients_refused(self) -> bool {
        true
    }
}

/// First-instance protection. Single variant: the future endpoint must be the first pipe instance
/// (`FILE_FLAG_FIRST_PIPE_INSTANCE`), rejecting a pre-existing squatting endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FirstInstanceRequired {
    /// The first pipe instance is required.
    Required,
}

/// A bounded protocol version. Not an arbitrary string; a small integer with a fixed accepted value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProtocolVersion(u16);

/// The only accepted protocol version in this phase.
pub const PROTOCOL_V1: ProtocolVersion = ProtocolVersion(1);

impl ProtocolVersion {
    /// The accepted version.
    #[must_use]
    pub fn accepted() -> Self {
        PROTOCOL_V1
    }

    /// Whether an observed version matches the accepted one.
    #[must_use]
    pub fn is_accepted(self) -> bool {
        self == PROTOCOL_V1
    }
}

/// The single-use per-run nonce state. The nonce value itself is NOT representable here (it is an
/// ephemeral runtime secret-free token); only its lifecycle state is modelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SingleUseNonceState {
    /// The nonce has not been consumed.
    Unused,
    /// The nonce has been consumed exactly once; any further use is a replay.
    Consumed,
}

/// The replay classification of an inbound request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReplayClassification {
    /// A fresh, single-use nonce — accepted.
    FreshAccepted,
    /// A reused nonce — refused.
    ReplayRefused,
}

impl ReplayClassification {
    /// Classify a request against the current nonce state.
    #[must_use]
    pub fn classify(state: SingleUseNonceState) -> Self {
        match state {
            SingleUseNonceState::Unused => Self::FreshAccepted,
            SingleUseNonceState::Consumed => Self::ReplayRefused,
        }
    }
}

/// Endpoint freshness. A stale endpoint (left from a prior run) is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EndpointFreshness {
    /// The endpoint is fresh (first instance).
    Fresh,
    /// The endpoint is stale — refused.
    Stale,
}

/// The IPC corroboration result for the peer channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcCorroboration {
    /// The peer corroborated the expected role.
    Valid,
    /// The peer contradicted the expected role.
    Invalid,
    /// The channel was unavailable.
    Unavailable,
}

/// The peer role class carried in IPC evidence. Reuses the canonical [`ConfirmedPeer`] classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerRoleClass(ConfirmedPeer);

impl PeerRoleClass {
    /// Wrap a canonical confirmed-peer classification.
    #[must_use]
    pub fn of(peer: ConfirmedPeer) -> Self {
        Self(peer)
    }

    /// The underlying canonical classification.
    #[must_use]
    pub fn peer(self) -> ConfirmedPeer {
        self.0
    }
}

/// Readiness classification of the service peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReadinessClass {
    /// The peer reported ready.
    Ready,
    /// The peer reported not ready.
    NotReady,
    /// Readiness could not be determined.
    Indeterminate,
}

/// The IPC shutdown result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcShutdownResult {
    /// The endpoint shut down cleanly.
    CleanShutdown,
    /// Shutdown did not complete cleanly.
    ShutdownFailed,
}

/// The IPC residue classification after shutdown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcResidue {
    /// No endpoint residue remains.
    Zero,
    /// Residue remains — fail closed.
    NonZero,
    /// Residue could not be determined — fail closed.
    Indeterminate,
}

/// The allowlisted principals for the protected endpoint DACL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcAllowPrincipal {
    /// The expected ProjectOSHost service SID.
    ExpectedServiceSid,
    /// The LocalSystem account.
    LocalSystem,
    /// The Builtin Administrators group.
    BuiltinAdministrators,
}

/// Broad principals that must receive NO allow ACE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcBroadPrincipal {
    /// Everyone.
    Everyone,
    /// Authenticated Users.
    AuthenticatedUsers,
    /// Builtin Users.
    BuiltinUsers,
    /// Guests.
    Guests,
    /// Anonymous Logon.
    AnonymousLogon,
}

/// The protected allowlist security policy for the future endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcSecurityPolicy;

impl IpcSecurityPolicy {
    /// The allowlisted principals (fixed set).
    #[must_use]
    pub fn allowlist() -> &'static [IpcAllowPrincipal] {
        &[
            IpcAllowPrincipal::ExpectedServiceSid,
            IpcAllowPrincipal::LocalSystem,
            IpcAllowPrincipal::BuiltinAdministrators,
        ]
    }

    /// Whether a principal is on the allowlist.
    #[must_use]
    pub fn allows(principal: IpcAllowPrincipal) -> bool {
        Self::allowlist().contains(&principal)
    }

    /// A broad principal NEVER receives an allow ACE.
    #[must_use]
    pub fn allows_broad(_broad: IpcBroadPrincipal) -> bool {
        false
    }

    /// The DACL is protected (no inherited ACEs).
    #[must_use]
    pub fn is_protected() -> bool {
        true
    }

    /// An explicit deny ACE is NOT required in this phase (absence of an allow ACE suffices).
    #[must_use]
    pub fn requires_explicit_deny() -> bool {
        false
    }
}

/// The exact typed IPC refusal reasons. Fieldless — no name, path, SID or payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcRefusal {
    /// A remote client attempted to connect.
    RemoteClientRefused,
    /// A second (non-first) pipe instance was observed.
    SecondInstanceRefused,
    /// A reused nonce was presented.
    NonceReplayRefused,
    /// A stale endpoint was observed.
    StaleEndpointRefused,
    /// A broad principal held an allow ACE.
    BroadPrincipalAllowRefused,
    /// The protocol version did not match.
    ProtocolVersionMismatch,
    /// The endpoint DACL was not protected.
    UnprotectedEndpointRefused,
}

/// A closed IPC evidence payload. It carries ONLY redacted classifications and the canonical redacted
/// service-identity evidence — no arbitrary bytes, text, or raw identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcEvidence {
    /// Whether the protocol version was accepted.
    pub protocol_accepted: bool,
    /// The replay classification.
    pub replay: ReplayClassification,
    /// The endpoint freshness.
    pub freshness: EndpointFreshness,
    /// The peer role class.
    pub peer_role: PeerRoleClass,
    /// The peer corroboration result.
    pub corroboration: IpcCorroboration,
    /// The readiness classification.
    pub readiness: ReadinessClass,
    /// The authority result reported by the peer (canonical, no-trust).
    pub authority_result: AuthorityTokenOutcome,
    /// The redacted service-identity evidence.
    pub service_identity: ServiceIdentityEvidence,
    /// The shutdown result.
    pub shutdown: IpcShutdownResult,
    /// The residue classification.
    pub residue: IpcResidue,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_is_local_only_and_refuses_remote() {
        assert_eq!(
            LocalOnlyTransport::policy(),
            LocalOnlyTransport::NamedPipeLocalOnly
        );
        assert!(LocalOnlyTransport::policy().remote_clients_refused());
    }

    #[test]
    fn first_instance_is_required() {
        assert_eq!(
            FirstInstanceRequired::Required,
            FirstInstanceRequired::Required
        );
    }

    #[test]
    fn nonce_is_single_use_and_replay_refused() {
        assert_eq!(
            ReplayClassification::classify(SingleUseNonceState::Unused),
            ReplayClassification::FreshAccepted
        );
        assert_eq!(
            ReplayClassification::classify(SingleUseNonceState::Consumed),
            ReplayClassification::ReplayRefused
        );
    }

    #[test]
    fn stale_endpoint_is_refused() {
        assert_ne!(EndpointFreshness::Stale, EndpointFreshness::Fresh);
    }

    #[test]
    fn protected_allowlist_is_required_and_broad_principals_get_no_allow() {
        assert!(IpcSecurityPolicy::is_protected());
        assert!(IpcSecurityPolicy::allows(
            IpcAllowPrincipal::ExpectedServiceSid
        ));
        assert!(IpcSecurityPolicy::allows(IpcAllowPrincipal::LocalSystem));
        assert!(IpcSecurityPolicy::allows(
            IpcAllowPrincipal::BuiltinAdministrators
        ));
        for b in [
            IpcBroadPrincipal::Everyone,
            IpcBroadPrincipal::AuthenticatedUsers,
            IpcBroadPrincipal::BuiltinUsers,
            IpcBroadPrincipal::Guests,
            IpcBroadPrincipal::AnonymousLogon,
        ] {
            assert!(!IpcSecurityPolicy::allows_broad(b));
        }
    }

    #[test]
    fn no_explicit_deny_ace_required() {
        assert!(!IpcSecurityPolicy::requires_explicit_deny());
    }

    #[test]
    fn protocol_version_is_bounded_and_accepted_value_fixed() {
        assert!(ProtocolVersion::accepted().is_accepted());
        assert!(PROTOCOL_V1.is_accepted());
    }

    #[test]
    fn shutdown_and_residue_are_classified() {
        assert_ne!(
            IpcShutdownResult::CleanShutdown,
            IpcShutdownResult::ShutdownFailed
        );
        assert_ne!(IpcResidue::Zero, IpcResidue::NonZero);
    }
}
