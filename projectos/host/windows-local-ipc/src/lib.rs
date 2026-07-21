//! # ProjectOS host — effect-free local-IPC transport CONTRACT (3K-I-D-E-C-CAPABILITY-B1)
//!
//! Freezes the closed shape a later, separately-approved named-pipe transport must obey for the
//! ProjectOSHost service-identity proof. It performs NO Windows call, creates NO pipe, binds NO
//! endpoint and opens NO handle. `#![forbid(unsafe_code)]`, no `windows` dependency.
//!
//! Guarantees: local-only (remote clients refused), first-instance required, a bounded protocol
//! version, a single-use per-run nonce with replay refusal, stale-endpoint refusal, a PROTECTED
//! allowlist security policy (expected service SID + LocalSystem + Builtin Administrators only; broad
//! principals get no allow ACE and no explicit deny ACE is required), and a closed IPC payload that
//! carries only the redacted service-identity proof evidence — no arbitrary pipe name, byte payload,
//! metadata, diagnostic text, or any raw username/SID/machine/session/credential.
//!
//! ```
//! use projectos_host_windows_local_ipc::{LocalOnlyTransport, LOCAL_IPC_IS_CONTRACT_ONLY};
//! assert!(LOCAL_IPC_IS_CONTRACT_ONLY);
//! assert_eq!(LocalOnlyTransport::policy(), LocalOnlyTransport::NamedPipeLocalOnly);
//! ```

#![forbid(unsafe_code)]

mod contracts;

pub use contracts::{
    EndpointFreshness, FirstInstanceRequired, IpcAllowPrincipal, IpcBroadPrincipal,
    IpcCorroboration, IpcEvidence, IpcRefusal, IpcResidue, IpcSecurityPolicy, IpcShutdownResult,
    LocalOnlyTransport, PeerRoleClass, ProtocolVersion, ReadinessClass, ReplayClassification,
    SingleUseNonceState, PROTOCOL_V1,
};

// Re-export the redacted evidence + canonical no-trust authority types the IPC payload carries.
pub use projectos_host_windows_service_identity_proof::{
    AuthorityTokenOutcome, ConfirmedPeer, ServiceIdentityEvidence, ServiceIdentityProofClass,
};

/// This crate is an effect-free local-IPC transport CONTRACT only — no live pipe transport exists.
pub const LOCAL_IPC_IS_CONTRACT_ONLY: bool = true;

/// No live IPC endpoint has been created or authorised in this phase.
pub const LIVE_LOCAL_IPC_AUTHORISED: bool = false;
