//! # ProjectOS host identity — the canonical identity and publisher-trust crate
//!
//! The complete identity implementation relocated unchanged from the Control Center
//! (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B): running-executable identity, canonical paths,
//! installation-root classification, hashing, trust-manifest parsing, Authenticode evidence
//! collection, publisher-policy evaluation and composite identity classification.
//!
//! ## Guarantees
//!
//! * CLASSIFICATION ONLY — nothing here mints trust, approves a publisher, signs, or reaches any
//!   protected authority. The production publisher policy is EMPTY and fail-closed; an unsigned
//!   release artifact can never become `Verified`.
//! * Bounded Windows FFI is confined to `identity/authenticode.rs` and
//!   `identity/running_executable.rs`; every unsafe operation carries SAFETY reasoning and
//!   `unsafe_op_in_unsafe_fn` is denied crate-wide.
//! * `serde_json` is internal (canonical JSON + manifest parsing). No JSON type crosses this crate's
//!   public facade.
//! * No process launch, IPC, instance/host authority, service management, registry/ProgramData
//!   mutation, credential/GCM/PAT access, or signing-key access.
//!
//! ## Public facade
//!
//! The safe production surface is deliberately tiny: [`capture_startup_identity`] (Windows), the
//! composite identity's safe projection types, and [`sha256_hex`]. Everything else stays private;
//! the closed test surface is only available under the non-default `test-fixtures` feature.

#![deny(unsafe_op_in_unsafe_fn)]

// The relocated implementation, unchanged. Internal module — nothing inside is reachable except
// through the explicit facade below, so no caller can inject a verifier, mutate a publisher
// allowlist, or manufacture a trusted outcome.
mod identity;

/// Capture the immutable composite identity once at startup. Classification only — on a real
/// machine protected eligibility always derives to Disabled.
#[cfg(windows)]
pub use identity::capture_startup_identity;

/// The composite identity and its safe, redacted projection. Constructors classify; none yields a
/// verified/production identity.
pub use identity::composite::{CompositeIdentity, IdentityStatusView};

/// SHA-256 content hashing used for identity binding (also consumed by the Control Center instance
/// key derivation through the shared runtime's facade).
pub use identity::hash::sha256_hex;

/// Closed identity test-fixture surface (WINDOWS-PACKAGED-RUNTIME-IDENTITY1B/2B), relocated
/// verbatim from the Control Center. Only exists under the non-default `test-fixtures` feature —
/// absent from every default and release build. Exposes no verifier, no key, no manifest bytes, and
/// no path to protected authority (eligibility always derives Disabled).
#[cfg(all(windows, feature = "test-fixtures"))]
pub mod test_fixtures {
    /// The composite identity model, its safe projection, the startup capture, and the native
    /// verification mechanism surface. Verification only — no publisher policy is configured, so no
    /// path reaches production Verified or eligibility.
    pub mod identity {
        pub use crate::identity::authenticode::{
            derive_cc_signature, verify_bound, AuthenticodeFacts, AuthenticodeVerifier,
            CertificateChain, Revocation, SignatureCryptography, SignaturePresence,
            Win32Authenticode,
        };
        pub use crate::identity::capture_startup_identity;
        pub use crate::identity::composite::{
            CcSignature, CompositeIdentity, ExecutionMode, IdentityStatusView,
            InstallationIdentity, ProtectedEligibility, ReleaseChannel, ReleaseFileIntegrity,
            ReleaseFreshness, ReleaseManifest,
        };
        pub use crate::identity::install_root::{
            classify_installation, classify_path, InstallationEvidence,
            InstallationEvidenceProvider, KnownRoots, NoInstallerEvidence,
        };
        pub use crate::identity::publisher_policy::{
            PublisherKey, PublisherOutcome, PublisherPolicy, PublisherPolicyStatus,
        };
        pub use crate::identity::running_executable::{
            pre_verify_ok, FileIdentity, ReparseState, RunningExecutable,
        };
    }
}
