//! # ProjectOS host — effect-free service-control CONTRACT (3K-I-D-E-C-CAPABILITY-B1)
//!
//! Freezes the closed shape a later, separately-approved SCM adapter must obey for the SINGLE bounded
//! ProjectOSHost proof service. It performs NO Windows call, opens NO SCM, creates/configures/starts/
//! stops/deletes NO service, resolves NO SID, and launches NO process. `#![forbid(unsafe_code)]`, no
//! `windows` dependency.
//!
//! The five gate states — compiled capability, owner approval, administrator elevation, live proof,
//! production activation — are SEPARATE and can never collapse into one boolean. Every mutating
//! operation is owner-gated; elevation never substitutes for owner approval; compiled capability never
//! substitutes for runtime authority; deletion is verified, never assumed. In this phase the effect
//! authority is unconditionally [`ServiceOperationAuthority::NotAuthorised`].
//!
//! ```
//! use projectos_host_windows_service_control::{
//!     ProofServiceIdentity, ServiceOperationAuthority, SERVICE_CONTROL_IS_CONTRACT_ONLY,
//! };
//! assert!(SERVICE_CONTROL_IS_CONTRACT_ONLY);
//! // The proof service identity is fixed; there is no arbitrary-name constructor.
//! assert_eq!(ProofServiceIdentity::projectos_host().approved_name(), "ProjectOSHost");
//! assert_eq!(ServiceOperationAuthority::default_phase(), ServiceOperationAuthority::NotAuthorised);
//! ```

#![forbid(unsafe_code)]

mod contracts;

pub use contracts::{
    ElevationRequirement, GateOutcome, OperationGate, ProofServiceAccountPolicy,
    ProofServiceIdentity, ProofServiceSidPolicy, ProofServiceStartPolicy,
    ServiceApprovalRequirement, ServiceEffectClass, ServiceLifecycleOperation,
    ServiceOperationAuthority, ServiceOperationRefusal, ServicePostEffectRequirement,
    ServiceRollbackRequirement,
};

// Re-export the accepted canonical post-effect verification set the future adapter must satisfy.
pub use projectos_host_windows_service_installation_contract::{
    PostEffectVerification, APPROVED_SERVICE_NAME,
};

/// This crate is an effect-free service-control CONTRACT only — no live SCM adapter exists here.
pub const SERVICE_CONTROL_IS_CONTRACT_ONLY: bool = true;

/// No live service-control operation has been implemented or authorised in this phase.
pub const LIVE_SERVICE_CONTROL_AUTHORISED: bool = false;
