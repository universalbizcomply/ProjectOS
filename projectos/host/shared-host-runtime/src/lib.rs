//! # ProjectOS shared host runtime — PUBLIC CONTRACT SCAFFOLD (3K-I-B)
//!
//! This crate freezes the public API SHAPE of the future canonical, headless ProjectOS host runtime.
//! It is contract-only:
//!
//! * it moves NO identity, process or instance code from the Control Center;
//! * it depends on NO UI/adapter framework, no `windows` crate, and no process/network/credential
//!   crate — it has ZERO external runtime dependencies;
//! * it launches no process, opens no IPC, creates no mutex or security descriptor, resolves no SID,
//!   and touches no service, registry, credential, key or network;
//! * every operational method fails closed; no authoritative runtime handle can be produced.
//!
//! ## Authority cannot be forged
//!
//! The two authoritative roles are gated behind capability tokens ([`FallbackPolicy`],
//! [`ServiceActivationProof`]) that have NO public constructor in this phase. Authority is never
//! selected by a `bool`, string, integer, environment variable, configuration value, prompt or
//! report. The Control Center client is explicitly non-authoritative with no route to authority. The
//! machine-wide cross-identity authority mechanism is DEFERRED to gate 3K-I-D.
//!
//! ```
//! use projectos_shared_host_runtime::{HostRuntimeClient, HostRuntimeConfiguration};
//!
//! // The Control Center client is a non-authoritative contract value; its operational methods fail
//! // closed and it starts nothing.
//! let client = HostRuntimeClient::connect(HostRuntimeConfiguration::contract_default()).unwrap();
//! assert!(!client.is_authoritative());
//! assert!(!client.status().is_execution_ready());
//! assert!(client.request_snapshot().is_err());
//! ```
//!
//! A `bool` cannot select an authoritative role — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_shared_host_runtime::InstalledServiceRole;
//! let _: InstalledServiceRole = true.into();
//! ```
//!
//! A string cannot select an authoritative role — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_shared_host_runtime::InteractiveFallbackRole;
//! let _: InteractiveFallbackRole = "fallback".parse().unwrap();
//! ```
//!
//! A [`FallbackPolicy`] has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_shared_host_runtime::FallbackPolicy;
//! let _ = FallbackPolicy::new();
//! ```
//!
//! A [`ServiceActivationProof`] has no public constructor and no `Default` — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_shared_host_runtime::ServiceActivationProof;
//! let _ = ServiceActivationProof::default();
//! ```
//!
//! A Control Center client cannot convert into an authoritative role — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_shared_host_runtime::{ControlCenterClientRole, InstalledServiceRole};
//! let client = ControlCenterClientRole::new();
//! let _: InstalledServiceRole = client.into();
//! ```

#![forbid(unsafe_code)]

pub mod events;
pub mod role;
pub mod runtime;

pub use events::{DiagnosticCode, EventClass, HostRuntimeEvent, RedactedRuntimeMessage, RoleClass};
pub use role::{
    AuthoritativeRuntimeHandle, AuthorityError, ControlCenterClientRole, FallbackPolicy,
    HostRuntimeClient, InstalledServiceRole, InteractiveFallbackAuthority, InteractiveFallbackRole,
    ServiceActivationProof, ServiceRuntimeAuthority,
};
pub use runtime::{
    AuthorityState, HealthClass, HostRuntimeConfiguration, HostRuntimeError, HostRuntimeStatus,
    ImplementationState, LifecycleState,
};

/// This crate is a contract scaffold only — no live runtime behaviour exists.
pub const RUNTIME_IMPLEMENTATION_IS_CONTRACT_ONLY: bool = true;

/// Execution readiness is unconditionally `false` in this phase.
pub const EXECUTION_READY: bool = false;

/// The machine-wide cross-identity authority mechanism is deferred to gate 3K-I-D.
pub const MACHINE_WIDE_AUTHORITY_DEFERRED: bool = true;
