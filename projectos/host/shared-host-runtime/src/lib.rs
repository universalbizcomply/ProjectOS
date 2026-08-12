//! # ProjectOS shared host runtime — PUBLIC CONTRACT SCAFFOLD (3K-I-B)
//!
//! This crate freezes the public API SHAPE of the future canonical, headless ProjectOS host runtime.
//! It is contract-only:
//!
//! * it contains NO identity, process or instance implementation; the canonical identity and
//!   publisher-trust implementation lives in `projectos-host-identity` and is consumed here ONLY
//!   through its safe facade (see [`identity`]);
//! * it depends on NO UI/adapter framework, no `windows` crate, and no process/network/credential
//!   crate — its only dependency is the internal canonical identity crate;
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
    ImplementationState, LifecycleState, PublisherPolicyClass,
};

/// Safe, read-only identity facade (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B).
///
/// Backed ENTIRELY by the canonical `projectos-host-identity` crate: pure re-exports, no copied
/// implementation, no unsafe code, no serde_json, no Windows FFI in this crate. Exposes exactly the
/// safe items existing Control Center callers and future shared orchestration need — the startup
/// identity capture, the safe status projection, and content hashing. Nothing here can approve a
/// publisher, manufacture a Verified outcome, or reach protected authority.
#[cfg(windows)]
pub mod identity {
    pub use projectos_host_identity::capture_startup_identity;

    /// The composite identity's safe, redacted projection type.
    pub mod composite {
        pub use projectos_host_identity::IdentityStatusView;
    }

    /// SHA-256 content hashing (identity binding; also used by the Control Center instance key).
    pub mod hash {
        pub use projectos_host_identity::sha256_hex;
    }

    /// The packaged-identity evaluation entry point and its SEALED success proof
    /// (PROJECTOS-RECOVERY-INSTALLED-APP1A).
    ///
    /// Exposed because packaged launch authority must be a CONSEQUENCE of verification, and the
    /// crate that owns launch authority therefore has to be able to demand the proof. Re-exporting
    /// it hands over no new power: `VerifiedPackagedIdentity` has a private seal, so a consumer can
    /// receive one and read it but can never construct one. The only way to obtain it is to run the
    /// real evaluation and have it succeed under production policy against an embedded anchor.
    ///
    /// The test-only minting function is deliberately NOT re-exported here — see `packaged_fixture`.
    pub mod packaged {
        pub use projectos_host_identity::{
            evaluate_packaged_authority, EvalContext, IdentityError, IdentityFs, IdentityOutcome,
            IdentityState, InstallationIdentity, InstallationModel, Policy,
            ProductionEs256Verifier, RealFs, VerifiedPackagedIdentity,
        };

        /// PROJECTOS-RECOVERY-INSTALLED-APP1A: the INDEPENDENT installation observation, so the
        /// Control Centre can observe its own installation through THE existing classifier instead
        /// of passing a placeholder or growing a second one. Read-only classification; the
        /// production evidence provider reports `Unavailable`, so this cannot manufacture
        /// corroboration.
        #[cfg(windows)]
        pub use projectos_host_identity::{
            classify_installation, InstallationEvidence, InstallationEvidenceProvider,
            NoInstallerEvidence, RunningExecutable,
        };

        /// PROJECTOS-RECOVERY-INSTALLED-APP1A: installer-owned installation evidence and the
        /// governed system root it names. Facts an installer wrote, verified against the running
        /// installation — never inferred from where the executable happens to sit.
        #[cfg(windows)]
        pub use projectos_host_identity::{
            read_canonical_application_record, ApplicationRecordError,
            InstalledApplicationEvidence, VerifiedInstalledApplication,
        };
    }

    /// TEST-ONLY proof minting, behind this crate's `test-fixtures` feature.
    ///
    /// Kept in a separate module from `packaged` so the production surface and the fixture surface
    /// are not one import away from each other. A normal build compiles neither this module nor the
    /// function it re-exports, so no production path can reach fixture identity.
    #[cfg(feature = "test-fixtures")]
    pub mod packaged_fixture {
        pub use projectos_host_identity::test_only_verified_identity;
    }
}

/// Safe, effect-free host-authority contract facade (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-B).
///
/// Re-exports the typed authority CONTRACT from the dependency-free `projectos-host-authority` crate:
/// scope/key contract, existence-token outcomes, mandatory peer corroboration, sealed fallback/roles,
/// the release-before-acquire handover, and the security-profile intent. No live acquisition, no
/// Windows call, no object name, no SID, no DACL — the implementation is deferred to 3K-I-D-C.
pub mod authority {
    pub use projectos_host_authority::{
        AuthorityChannel, AuthorityDiagnosticCode, AuthorityEvidence, AuthorityGuard,
        AuthorityHandoverState, AuthorityKey, AuthorityPeerState, AuthorityRefusal,
        AuthoritySchemaVersion, AuthorityScope, AuthoritySecurityProfile, AuthorityTokenOutcome,
        CanonicalInstallationIdentity, ConfirmedPeer, FallbackEligibility, FallbackPolicy,
        HostRuntimeClient, IntendedPrincipal, IntendedRight, InteractiveFallbackAuthority,
        ServiceActivationState, ServiceObservation, ServiceRuntimeAuthority, ServiceSidResolution,
    };
}

/// This crate is a contract scaffold only — no live runtime behaviour exists.
pub const RUNTIME_IMPLEMENTATION_IS_CONTRACT_ONLY: bool = true;

/// Execution readiness is unconditionally `false` in this phase.
pub const EXECUTION_READY: bool = false;

/// The machine-wide cross-identity authority mechanism is deferred to gate 3K-I-D.
pub const MACHINE_WIDE_AUTHORITY_DEFERRED: bool = true;
