//! # ProjectOS host — bounded Windows service-control adapter (3K-I-D-E-C-CAPABILITY-B2)
//!
//! The DEFAULT build is the effect-free CD-B1 contract. The live SCM adapter compiles ONLY under the
//! `windows-live-scm` feature and even then invokes nothing without a sealed
//! [`adapter::LiveOperationCapability`] — which has no public/feature/test constructor, so no live SCM
//! operation is reachable in this phase. Compiled capability is never runtime authority.
//!
//! Unsafe is confined to `windows_ffi.rs` (crate lint `unsafe_code = "deny"`, re-allowed only there).
//! The safe adapter, contracts and verification contain no Windows call. Win32 errors are redacted
//! immediately to closed classifications; no raw handle/SID/name/path/error escapes.
//!
//! ```
//! use projectos_host_windows_service_control::{
//!     ProofServiceIdentity, SERVICE_CONTROL_IS_CONTRACT_ONLY,
//! };
//! assert!(SERVICE_CONTROL_IS_CONTRACT_ONLY);
//! assert_eq!(ProofServiceIdentity::projectos_host().approved_name(), "ProjectOSHost");
//! ```
//!
//! The sealed live-operation capability has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_service_control::LiveOperationCapability;
//! let _ = LiveOperationCapability { _sealed: () };
//! ```
//!
//! …and there is no factory either — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_service_control::LiveOperationCapability;
//! let _ = LiveOperationCapability::new();
//! ```

mod adapter;
mod contracts;
mod verification;

// The live Windows SCM backend — the ONLY module with unsafe. Compiled only under the feature.
#[cfg(all(windows, feature = "windows-live-scm"))]
mod windows_ffi;

pub use contracts::{
    Compiled, Elevation, ElevationRequirement, GateOutcome, LiveProof, OperationGate,
    OwnerApproval, ProductionActivation, ProofServiceAccountPolicy, ProofServiceIdentity,
    ProofServiceSidPolicy, ProofServiceStartPolicy, ServiceApprovalRequirement, ServiceEffectClass,
    ServiceLifecycleOperation, ServiceOperationAuthority, ServiceOperationRefusal,
    ServicePostEffectRequirement, ServiceRollbackRequirement,
};

pub use adapter::{
    LifecycleOutcome, LifecycleRefusal, LiveOperationCapability, ScmBackend, ScmServiceAdapter,
};

pub use verification::{
    classify_action_error, classify_open_error, classify_sid_query_error, classify_sid_type,
    default_wait_policy, verify_created_present, verify_deleted, verify_sid_policy, verify_started,
    verify_stopped, ExactNameState, PostEffectRefusal, PostEffectVerdict, RetryPolicy,
    RunStateObservation, ScmActionOutcome, SidPolicyObservation, MAX_ATTEMPTS_CEILING,
};

// Re-export the accepted canonical post-effect verification set + approved name.
pub use projectos_host_windows_service_installation_contract::{
    PostEffectVerification, APPROVED_SERVICE_NAME,
};

// Re-export the CANONICAL cross-source service-instance identity, owned by the identity-proof crate.
// Consumers read the SCM-derived observation through this crate without gaining any way to construct
// or inspect a token: there is no public constructor and no accessor anywhere in the re-exported set.
//
// Gated with the live adapter that produces it, so the DEFAULT contract-only build pulls no extra
// dependency edge at all — that keeps every downstream lockfile (including the frozen proof-runner's)
// byte-identical until a consumer actually opts into the live SCM adapter.
#[cfg(feature = "windows-live-scm")]
pub use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, LiveInstanceObservationCapability, Prepared, ScmAfterObserved,
    ScmBeforeObserved, ServiceInstanceBinding, ServiceInstanceBindingAttempt,
    ServiceInstanceRefusal, ServiceInstanceToken,
};

/// The DEFAULT build remains the effect-free service-control contract (no live SCM adapter reachable).
pub const SERVICE_CONTROL_IS_CONTRACT_ONLY: bool = true;

/// No live service-control operation is authorised or reachable in this phase.
pub const LIVE_SERVICE_CONTROL_AUTHORISED: bool = false;
