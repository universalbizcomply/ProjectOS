//! # ProjectOS host authority — EFFECT-FREE typed contract (3K-I-D-B)
//!
//! Freezes the public shape of the future machine-wide, cross-identity ProjectOS host authority and
//! NOTHING ELSE. It performs no Windows call, creates/opens no kernel object, derives no `Global\…`
//! name, builds no security descriptor, resolves no SID, queries no SCM, binds no IPC, and launches
//! no process. Zero dependencies; `#![forbid(unsafe_code)]`.
//!
//! ## The no-trust rule
//!
//! A named object is an EXCLUSIVITY TOKEN only. An [`AuthorityTokenOutcome::ExistingToken`] never, on
//! its own, means trusted ProjectOS ownership: corroboration through typed peer evidence is
//! mandatory, and an uncorroborated existing token becomes [`AuthorityPeerState::AuthorityUncertain`]
//! → startup refused.
//!
//! ```
//! use projectos_host_authority::{AuthorityTokenOutcome, AuthorityPeerState};
//!
//! // An existing token is not confirmed authority, and without corroboration it is uncertain.
//! assert!(!AuthorityTokenOutcome::ExistingToken.is_confirmed_authority());
//! let peer = AuthorityPeerState::corroborate(AuthorityTokenOutcome::ExistingToken, None);
//! assert_eq!(peer, AuthorityPeerState::AuthorityUncertain);
//! assert!(!peer.permits_startup());
//! ```
//!
//! Authority cannot be selected by a bool — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::InteractiveFallbackAuthority;
//! let _: InteractiveFallbackAuthority = true.into();
//! ```
//!
//! Authority cannot be selected by a string — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::ServiceRuntimeAuthority;
//! let _: ServiceRuntimeAuthority = "service".parse().unwrap();
//! ```
//!
//! An [`AuthorityKey`] has no arbitrary-string constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::AuthorityKey;
//! let _ = AuthorityKey::from("Global\\ProjectOS.HostAuthority.v1.dev.iXXXX");
//! ```
//!
//! An [`AuthorityGuard`] has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::AuthorityGuard;
//! let _ = AuthorityGuard::default();
//! ```
//!
//! A [`FallbackPolicy`] has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::FallbackPolicy;
//! let _ = FallbackPolicy::default();
//! ```
//!
//! The client exposes no authority-acquisition method — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::HostRuntimeClient;
//! let c = HostRuntimeClient::contract();
//! let _ = c.acquire();
//! ```
//!
//! The proof-pipe policy has no SDDL/descriptor builder — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::ProjectOsHostPipeSecurityPolicy;
//! let _ = ProjectOsHostPipeSecurityPolicy::from_sddl("D:P");
//! ```
//!
//! A pipe allow-principal has no SID/name constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_authority::ProjectOsHostPipeAllowPrincipal;
//! let _ = ProjectOsHostPipeAllowPrincipal::from_sid("S-1-5-18");
//! ```

// Not crate-level `forbid(unsafe_code)`: the Windows FFI modules (token/security/service_principal)
// require unsafe. Unsafe is CONFINED to those three named files — model.rs and key.rs contain none —
// and every unsafe operation is an explicit block with a SAFETY comment. The confinement is enforced
// by validate-host-authority-windows-boundary.cjs.
#![deny(unsafe_op_in_unsafe_fn)]

// The OPAQUE EFFECT-WITNESS CONTRACT. Pure types: no Windows API, no token query, no machine effect,
// and NO production producer for any witness — real owner approval, elevation, repository and
// executable verification are all deferred to separately-authorised phases.
pub mod acquisition;
#[cfg(all(windows, feature = "windows-host-authority-observer"))]
mod acquisition_win32;
pub mod effect_grant;
pub mod effect_witness;

// INTERNAL current-process elevation observation engine. Private: no dependent may reach it. Gated to
// Windows + the non-default feature; the real backend is compiled to prove it builds, never executed.
#[cfg(all(windows, feature = "windows-elevation-observation"))]
mod elevation;

// A real elevation observer and a synthetic witness minter must never coexist in one build: it would
// place a genuine machine-observation path beside a fixture path for the same opaque authority. Refuse
// the combination at compile time rather than rely on discipline.
#[cfg(all(
    feature = "windows-elevation-observation",
    feature = "effect-witness-fixtures"
))]
compile_error!(
    "features `windows-elevation-observation` and `effect-witness-fixtures` are mutually exclusive: \
     the real elevation observer must not share a build with the synthetic witness fixtures"
);

pub mod model;

// The FIXED ProjectOSHost proof-pipe security POLICY: safe, portable, effect-free typed contract
// (3K-I-D-E-C-CAPABILITY-B3-SECURITY-PRINCIPAL-CONTRACT1A). Always compiled — it contains no unsafe and
// no Windows call. The live service-SID-backed descriptor + borrowed lease that satisfy this policy are
// owned by the `security` FFI module and compiled ONLY under `test-fixtures` on Windows.
pub mod pipe_security;

// The synthetic authority mechanism (object-name derivation + Windows FFI) is compiled ONLY under the
// `test-fixtures` feature on Windows. The default and release artifacts therefore contain NO
// acquisition surface at all — they remain the pure typed contract (model only). This is the same
// "fixtures excluded from release" posture as the prior host phases.
//
// Pure object-name derivation (no unsafe). The production name is implemented but never acquired this
// phase; tests use the separate test-only name.
// PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A): also compiled for the PRODUCTION acquisition graph. The
// production name derivation was already implemented here and already validated; it simply had no
// build that could reach it. `windows-authority-acquisition` does NOT enable `test-fixtures`, so the
// TEST object-name route stays out of a production build.
#[cfg(all(
    windows,
    any(feature = "test-fixtures", feature = "windows-authority-acquisition")
))]
mod key;
// Windows FFI: machine-wide security descriptor + read-only DACL inspection, the OPAQUE ProjectOSHost
// pipe-security runtime descriptor, and read-only service-SID resolution. Gated to the NON-fixture
// `windows-pipe-security-runtime` feature so normal Windows library consumers (windows-local-ipc) can
// obtain the opaque runtime contract WITHOUT enabling synthetic fixtures. Unsafe is confined here.
#[cfg(all(windows, feature = "windows-pipe-security-runtime"))]
mod security;
#[cfg(all(windows, feature = "windows-pipe-security-runtime"))]
mod service_principal;
// Named `existence` (not `token`) because the repo `.gitignore` ignores `*token*` for secret-token
// files; the module implements the existence-token acquisition.
// PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A): also compiled for the PRODUCTION acquisition graph, so a
// release service-host can actually acquire the machine-wide authority. Unchanged code; only the gate
// moved. The synthetic helper inside it (`create_colliding_event`) stays on `test-fixtures` alone.
#[cfg(all(
    windows,
    any(feature = "test-fixtures", feature = "windows-authority-acquisition")
))]
mod existence;
// THE PRODUCTION SERVICE-RUNTIME ACQUISITION FACADE. The ONLY production route to a machine-wide
// authority, and deliberately the minimum surface service-host needs: it takes no object name, no
// security descriptor and no caller-chosen scope.
// The GENUINE self service-runtime corroboration the facade derives instead of accepting. Unsafe is
// confined to it exactly as it is to `security.rs`, `existence.rs` and `service_principal.rs`.
#[cfg(all(windows, feature = "windows-authority-acquisition"))]
mod self_service_runtime;
#[cfg(all(windows, feature = "windows-authority-acquisition"))]
mod service_runtime_acquisition;

// TEST-ONLY synthetic authority surface, present only under the `test-fixtures` feature. It exposes
// the Windows helpers to the integration tests using TEST-ONLY object names; it is never compiled into
// a default/release build, so no live-acquisition surface ships.
#[cfg(all(windows, feature = "test-fixtures"))]
pub mod windows_proof;

// PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A): the ONE production acquisition entry point. It takes no
// object name, no security descriptor, no scope and no channel, so there is no generic
// `acquire(any_name, any_security)` for a dependent crate to reach.
#[cfg(all(windows, feature = "windows-authority-acquisition"))]
pub use service_runtime_acquisition::acquire_service_runtime_authority;

pub use model::{
    AuthorityChannel, AuthorityDiagnosticCode, AuthorityEvidence, AuthorityGuard,
    AuthorityHandoverState, AuthorityKey, AuthorityPeerState, AuthorityRefusal,
    AuthoritySchemaVersion, AuthorityScope, AuthoritySecurityProfile, AuthorityTokenOutcome,
    CanonicalInstallationIdentity, ConfirmedPeer, FallbackEligibility, FallbackPolicy,
    HostRuntimeClient, IntendedPrincipal, IntendedRight, InteractiveFallbackAuthority,
    ServiceActivationState, ServiceObservation, ServiceRuntimeAuthority, ServiceSidResolution,
};

// The portable proof-pipe security POLICY types — always available (no unsafe, no Windows).
pub use pipe_security::{
    ProjectOsHostPipeAllowPrincipal, ProjectOsHostPipeBroadPrincipal,
    ProjectOsHostPipeSecurityPolicy, ProjectOsHostPipeSecurityRefusal,
    ProjectOsHostPipeSecurityStatus, PIPE_PROOF_RIGHTS,
};

// The opaque, service-SID-backed proof-pipe descriptor and its borrowed Windows security-attributes
// lease live in the `security` FFI owner and ship under the NON-fixture `windows-pipe-security-runtime`
// feature on Windows — never in a default/release build, and available WITHOUT enabling synthetic
// fixtures. Compiled but never invoked in this phase.
#[cfg(all(windows, feature = "windows-pipe-security-runtime"))]
pub use security::{BorrowedPipeSecurityAttributes, ProjectOsHostPipeSecurity};

/// The synthetic Windows existence-token authority is implemented in this phase (3K-I-D-C).
pub const AUTHORITY_SYNTHETIC_WINDOWS_IMPLEMENTED: bool = true;

/// The PRODUCTION authority object name is derived but NEVER acquired in this phase — synthetic proofs
/// use TEST-ONLY names, and live cross-session/service acquisition is deferred to later gates.
pub const AUTHORITY_PRODUCTION_NAME_ACQUIRED_THIS_PHASE: bool = false;
