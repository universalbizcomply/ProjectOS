//! # ProjectOS host — bounded Windows local named-pipe transport (3K-I-D-E-C-CAPABILITY-B3)
//!
//! The DEFAULT build is the effect-free CD-B1 contract plus the safe transport adapter, protocol,
//! security-decision and verification logic — it performs NO Windows call. The live Windows named-pipe
//! backend compiles ONLY under the `windows-live-ipc` feature and even then invokes nothing without a
//! sealed [`adapter::LiveIpcOperationCapability`]. That capability has exactly ONE production route —
//! `owner-approved-status-read`, which consumes an exact-phrase owner approval and authorises only the
//! READ-ONLY installed-host status read (CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A). It is non-default and
//! is not implied by `windows-live-ipc`, so compiled capability is still never runtime authority.
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
mod operation_contract;
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
    ServerPreparation, StatusReceipt,
};

pub use protocol::{
    parse_single_frame, FrameHeader, FrameParseError, MessageKind, Nonce, FRAME_MAGIC,
    MAX_FRAME_SIZE, NONCE_LEN, WIRE_PROTOCOL_VERSION,
};

// The OWNER-APPROVED read-only status capability surface. Present only under the non-default feature
// that gates it, so a default or merely-live build exposes no route to a capability at all.
#[cfg(feature = "owner-approved-status-read")]
pub use adapter::{CapabilityScope, OwnerStatusReadApproval, StatusApprovalRefused};

// The ONE read-only status response added by CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A: a fixed-width
// closed record, its canonical encoder and its strict decoder. No generic payload accessor is exported.
pub use protocol::{
    decode_installed_host_status, encode_installed_host_status, ChannelReport,
    IdentityVerificationReport, InstalledHostStatus, ProtectedOperationsReport, ReadinessReport,
    ServiceStateReport, INSTALLED_HOST_STATUS_LEN, INSTALLED_HOST_STATUS_RUN_ID, STATUS_PREFIX_LEN,
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
#[cfg(any(feature = "test-fixtures", all(windows, feature = "windows-live-ipc")))]
pub use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved, ScmBeforeObserved,
    ServiceInstanceBindingAttempt,
};

// Re-export the OPAQUE host-authority pipe-security status this transport consumes (it never resolves a
// SID or builds an ACL/SDDL of its own).
pub use projectos_host_authority::{
    ProjectOsHostPipeSecurityPolicy, ProjectOsHostPipeSecurityStatus,
};

// NARROW CONTRIBUTION FAÇADE. Only this opaque wrapper is re-exported; `windows_ffi`, the pipe backend
// and every Win32 function stay private, and the wrapper has no public constructor, so a production
// caller can name it but never obtain one.
#[cfg(all(windows, feature = "windows-live-ipc"))]
pub use windows_ffi::LiveIpcPeerContributor;
// The CLIENT half of the read-only status workflow. Present only when the owner-approved feature is
// enabled too, and every method still demands the sealed capability: naming the type grants nothing.
#[cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read"
))]
pub use windows_ffi::{
    ClientStatusReadOutcome, ServeStatusOutcome, WindowsInstalledHostStatusClient,
    WindowsInstalledHostStatusServer,
};
// PROOF-ONLY refusal probes. `test-fixtures` is non-default and is enabled by NEITHER the installed
// service nor the Control Centre, so no production graph can reach them.
#[cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read",
    feature = "test-fixtures"
))]
pub use windows_ffi::RefusalProbe;

// The PROTECTED-OPERATION contract (PROJECTOSHOST-IPC-OPERATION-CONTRACT1A). Types and validation
// only: no transport, no channel, no effect. `OwnerPresenceGate` cannot report closed, so no protected
// operation can be accepted — an admitted peer still reaches only the C4 refusal.
//
// PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A RETIRED THIS CRATE'S DUPLICATE PEER-IDENTITY MODEL.
// Raw SID storage, raw Windows session identity, bounded integrity levels, the observed-evidence input
// model, peer classification and both authentication entry points are GONE, with no replacement and no
// successor here. Peer identity is owned end-to-end by the canonical identity-proof crate's bounded
// attempt: it is captured there, compared there, and never crosses into this crate in any form.
// `TrustedPeerContext` therefore carries only the two HOST-ISSUED identifiers and has no production
// constructor at all, so `evaluate_protected_operation` receives `None` on every shipped path.
pub use operation_contract::{
    decode_protected_operation_request, decode_protected_operation_response,
    encode_protected_operation_request, encode_protected_operation_response,
    evaluate_protected_operation, AuthorisedProtectedOperation, OperationClass, OwnerPresenceGate,
    ProtectedOperationRequest, ProtectedOperationResponse, RejectionReason, ResponseState,
    ResultClass, TerminalStatus, TrustedPeerContext, APPROVAL_REF_LEN, BINDING_DIGEST_LEN,
    CORRELATION_LEN, EVIDENCE_REF_LEN, SESSION_REF_LEN,
};
/// Resolve the ProjectOSHost pipe security STATUS, read-only.
///
/// The installed service needs the status to gate `prepare_server`, and the descriptor itself is
/// resolved independently inside the transport when the endpoint is created. Since
/// PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A the installed-host exchange lives on the single
/// fixed production endpoint, so this gate reports the PRODUCTION resolution — four principals,
/// failing closed (`ConfiguredOwnerUnavailable`) when no owner is enrolled — matching the exact
/// descriptor the transport will build. Only the closed status crosses this boundary: no descriptor,
/// SID or SDDL is ever returned.
#[cfg(all(windows, feature = "windows-live-ipc"))]
#[must_use]
pub fn resolve_installed_host_pipe_security() -> ProjectOsHostPipeSecurityStatus {
    projectos_host_authority::ProjectOsHostPipeSecurity::resolve_production().0
}
// The opaque confirmed-handshake proof and its transition object. A consumer can hold and consume
// them but can never construct one; only this crate's verification path mints a confirmation.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub use adapter::{ConfirmedIpcPeerHandshake, HandshakeTransition};
// FIXTURE-ONLY handshake runner and peer contributor: explicit, non-default, no pipe, no Win32.
#[cfg(feature = "test-fixtures")]
pub use adapter::{
    assemble_same_connection_ipc_peer_fixture, outcome_is_confirmed, run_fixture_handshake,
    synthetic_controller_hello, FixtureIpcPeerContributor,
};

// The opaque same-connection IPC peer evidence bundle (CD-B4-PRODUCTION-IPC-PROVIDER1A): pairs the
// confirmed handshake with the co-observed peer identity for ONE connection and projects into the core
// evidence the sealed core ProductionIpcSessionVerifier consumes. Gated with the confirmed handshake it
// requires, so it is unreachable in the default graph.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
mod observation;
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub use observation::ConfirmedSameConnectionIpcPeerEvidence;

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
