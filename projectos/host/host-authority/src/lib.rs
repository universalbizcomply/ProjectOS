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
//! let _ = AuthorityGuard::contract_placeholder();
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

#![forbid(unsafe_code)]

pub mod model;

pub use model::{
    AuthorityChannel, AuthorityDiagnosticCode, AuthorityEvidence, AuthorityGuard,
    AuthorityHandoverState, AuthorityKey, AuthorityPeerState, AuthorityRefusal,
    AuthoritySchemaVersion, AuthorityScope, AuthoritySecurityProfile, AuthorityTokenOutcome,
    CanonicalInstallationIdentity, ConfirmedPeer, FallbackEligibility, FallbackPolicy,
    HostRuntimeClient, IntendedPrincipal, IntendedRight, InteractiveFallbackAuthority,
    ServiceActivationState, ServiceObservation, ServiceRuntimeAuthority, ServiceSidResolution,
};

/// This crate is an effect-free authority CONTRACT only — no live acquisition exists.
pub const AUTHORITY_IMPLEMENTATION_IS_CONTRACT_ONLY: bool = true;

/// The machine-wide authority mechanism is not implemented in this phase (deferred to 3K-I-D-C).
pub const AUTHORITY_ACQUISITION_DEFERRED_TO_3KIDC: bool = true;
