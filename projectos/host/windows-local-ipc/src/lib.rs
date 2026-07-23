//! # ProjectOS host — bounded Windows local named-pipe transport (3K-I-D-E-C-CAPABILITY-B3)
//!
//! The DEFAULT build is the effect-free CD-B1 contract plus the safe transport adapter, protocol,
//! security-decision and verification logic — it performs NO Windows call. The live Windows named-pipe
//! backend compiles ONLY under the `windows-live-ipc` feature and even then invokes nothing without a
//! sealed [`adapter::LiveIpcOperationCapability`], which has no public/feature/test constructor. Compiled
//! capability is never runtime authority.
//!
//! Unsafe is confined to `windows_ffi.rs` (crate lint `unsafe_code = "deny"`, re-allowed only there).
//! The adapter/protocol/security/verification modules contain no Windows call. Win32 errors are redacted
//! immediately to closed classifications; no raw handle/endpoint/SID/SDDL/name/error escapes. This crate
//! resolves NO SID and builds NO ACL/SDDL — it consumes host-authority's opaque pipe-security contract.
//! IPC alone never confirms authority; SCM corroboration remains independently required.
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     LocalOnlyTransport, LocalIpcTransportState, LOCAL_IPC_TRANSPORT_STATE,
//!     LIVE_LOCAL_IPC_AUTHORISED,
//! };
//! // The Windows transport is IMPLEMENTED but compile-only — no live IPC is authorised or reachable.
//! assert_eq!(
//!     LOCAL_IPC_TRANSPORT_STATE,
//!     LocalIpcTransportState::WindowsTransportImplementedCompileOnly
//! );
//! assert!(!LIVE_LOCAL_IPC_AUTHORISED);
//! assert_eq!(LocalOnlyTransport::policy(), LocalOnlyTransport::NamedPipeLocalOnly);
//! ```
//!
//! The sealed live-IPC capability has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::LiveIpcOperationCapability;
//! let _ = LiveIpcOperationCapability { _sealed: () };
//! ```
//!
//! …and there is no factory either — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::LiveIpcOperationCapability;
//! let _ = LiveIpcOperationCapability::new();
//! ```
//!
//! There is no public arbitrary-bytes nonce constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::Nonce;
//! let _ = Nonce::from_fixed_bytes([0u8; 32]);
//! ```

mod adapter;
mod contracts;
mod protocol;
mod security;
mod verification;

// The live Windows named-pipe backend — the ONLY module with unsafe. Compiled only under the feature.
#[cfg(all(windows, feature = "windows-live-ipc"))]
mod windows_ffi;

pub use contracts::{
    EndpointFreshness, FirstInstanceRequired, IpcAllowPrincipal, IpcBroadPrincipal,
    IpcCorroboration, IpcEvidence, IpcRefusal, IpcResidue, IpcSecurityPolicy, IpcShutdownResult,
    LocalOnlyTransport, PeerRoleClass, ProtocolVersion, ReadinessClass, ReplayClassification,
    SingleUseNonceState, PROTOCOL_V1,
};

pub use adapter::{
    ConnectionState, EndpointOutcome, HandshakeObservation, HandshakeOutcome, HandshakeReceipt,
    IpcBackend, LiveIpcOperationCapability, LocalIpcAdapter, ReceivedFrame, SendOutcome,
    ServerPreparation,
};

pub use protocol::{
    parse_single_frame, FrameHeader, FrameParseError, MessageKind, Nonce, FRAME_MAGIC,
    MAX_FRAME_SIZE, NONCE_LEN, WIRE_PROTOCOL_VERSION,
};

pub use security::{evaluate_pipe_security, EndpointSecurityDecision};

pub use verification::{
    classify_ipc_error, default_wait_policy, verify_clean_shutdown, verify_endpoint_fresh,
    verify_not_replayed, verify_peer_role, verify_zero_residue, CancellationTerminalState,
    IpcFailure, PeerRole, RetryPolicy, MAX_ATTEMPTS_CEILING,
};

// Re-export the redacted evidence + canonical no-trust authority types the IPC payload carries.
pub use projectos_host_windows_service_identity_proof::{
    AuthorityTokenOutcome, ConfirmedPeer, ServiceIdentityEvidence, ServiceIdentityProofClass,
};

// Re-export the CANONICAL cross-source service-instance identity, owned by the identity-proof crate.
// A confirmed handshake proves only that the PEER holds the nonce; the opaque token is what later ties
// that peer to the SCM-observed service instance. Nothing here can construct or inspect a token.
pub use projectos_host_windows_service_identity_proof::{
    LiveInstanceObservationCapability, ServiceInstanceBinding, ServiceInstanceRefusal,
    ServiceInstanceToken,
};
// The attempt state machine, available only where an observation could occur.
#[cfg(all(windows, feature = "windows-live-ipc"))]
pub use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved, ScmBeforeObserved,
    ServiceInstanceBindingAttempt,
};

// Re-export the OPAQUE host-authority pipe-security status this transport consumes (it never resolves a
// SID or builds an ACL/SDDL of its own).
pub use projectos_host_authority::{
    ProjectOsHostPipeSecurityPolicy, ProjectOsHostPipeSecurityStatus,
};

/// The truthful current state of this crate. CD-B1 was contract-only; the bounded Windows named-pipe
/// transport is now IMPLEMENTED but compile-only — the implementation exists yet no runtime capability
/// is reachable (no sealed [`adapter::LiveIpcOperationCapability`] is constructible).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LocalIpcTransportState {
    /// Only the CD-B1 effect-free contract exists (the frozen B1 state).
    ContractOnly,
    /// The bounded Windows named-pipe transport is implemented, compiled behind `windows-live-ipc`, but
    /// no live pipe is reachable and no live IPC has been proven.
    WindowsTransportImplementedCompileOnly,
}

/// The current state: the Windows transport is implemented, compile-only. NOT entirely contract-only.
pub const LOCAL_IPC_TRANSPORT_STATE: LocalIpcTransportState =
    LocalIpcTransportState::WindowsTransportImplementedCompileOnly;

/// The crate is no longer entirely contract-only — a Windows transport implementation now exists (but is
/// compile-only). Retained (false) for callers that checked the CD-B1 boolean; consult
/// [`LOCAL_IPC_TRANSPORT_STATE`] for the truthful state.
pub const LOCAL_IPC_IS_CONTRACT_ONLY: bool = false;

/// No live IPC endpoint has been created or authorised in this phase.
pub const LIVE_LOCAL_IPC_AUTHORISED: bool = false;
