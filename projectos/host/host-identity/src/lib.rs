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

/// CD-B4-CANONICAL-INSTALLATION-IDENTITY-WIRING1A: the versioned canonical installation identity
/// record, its deterministic digest and the read-only production provider. Publicly re-exported because
/// the future Windows host-authority observer must verify a record; the module itself grants nothing.
pub use identity::canonical_record;

/// The composite identity and its safe, redacted projection. Constructors classify; none yields a
/// verified/production identity.
pub use identity::composite::{CompositeIdentity, IdentityStatusView};

/// SHA-256 content hashing used for identity binding (also consumed by the Control Center instance
/// key derivation through the shared runtime's facade).
pub use identity::hash::sha256_hex;

/// PROJECTOS-RECOVERY-INSTALLED-APP1A: packaged-identity evaluation and its SEALED success proof.
///
/// Added to the facade because packaged launch authority must be a CONSEQUENCE of verification, so
/// the crate owning launch authority has to be able to DEMAND the proof. This grants no new power:
/// `VerifiedPackagedIdentity` carries a private seal and has no public constructor, so a consumer
/// can receive and read one but can never build one. Obtaining it means running the real evaluation
/// and having it succeed under production policy against an embedded anchor — which, with no anchor
/// provisioned, cannot happen at all.
pub use identity::packaged_authority::{evaluate_packaged_authority, VerifiedPackagedIdentity};

/// The production ES256 verifier and the evaluation inputs a caller must assemble. The verifier
/// reports `is_production()` only when a well-formed anchor genuinely exists.
pub use identity::production_verifier::ProductionEs256Verifier;
pub use identity::{EvalContext, IdentityFs, RealFs};

/// The manifest model and THE canonical signing-byte function.
///
/// Re-exported so the manifest GENERATOR consumes the very same canonicalisation the verifier does.
/// Two implementations of "which bytes are signed" is the classic way a signature scheme becomes
/// decorative: they agree on every case anyone tested and disagree on the one that matters. There is
/// one implementation, and this is it.
pub use identity::canonical::canonical_bytes;
pub use identity::manifest::{
    CommittedArtefactManifest, DaemonArtefactFormat, DaemonArtefactManifest,
    ExecutionClosureManifest, RuntimeManifest, TrustManifest, EXECUTION_CLOSURE_MANIFEST_VERSION,
};

/// RUN-TO-COMPLETION HOST ATTESTATION: the second integrity witness over a provider call.
///
/// `verify_execution_closure` is exported beside the manifest types because the two travel together
/// — a consumer that can build a v2 manifest must be able to ask whether the committed bytes still
/// match it, and a consumer that cannot ask would have a manifest field it is unable to enforce.
pub use identity::{verify_execution_closure, CommittedClosureBytes};

/// RUN-TO-COMPLETION HOST ATTESTATION §10A — THE TRUSTED INSTALLATION PROGRAMME.
///
/// Exported beside the closure it is derived from. `attest_installation_programme` is the ONLY route
/// to an `AttestedInstallationProgramme`, it fixes the production policy and the embedded anchor
/// internally, and the sealed value it returns is what the Host composition turns into the
/// `ExpectedProgramme` a delegation is checked against — so an installation can never be told what
/// programme it is by the record under test, by a request, or by anything in the working tree.
pub use identity::installation_programme::{
    attest_installation_programme, project_identity_digest, repository_identity_digest,
    AttestedInstallationProgramme, HostGovernedRoot, ProgrammeAttestationError,
    MAX_ALLOWLIST_BYTES, MAX_ALLOWLIST_ENTRIES, PROGRAMME_IDENTITY_DIGEST_LEN,
    PROGRAMME_IDENTITY_DOMAIN,
};

/// Verify a manifest's detached signature AGAINST THE EMBEDDED PRODUCTION ANCHOR, and nothing else.
///
/// WHY THIS IS A FUNCTION AND NOT THE TRAIT. Re-exporting `TrustManifestSignatureVerifier` and
/// `SignatureInput` would have been the obvious way to let a proof anchor itself to a real
/// signature — and it would have widened the facade in exactly the way this crate exists to prevent.
/// `EvalContext::verifier` is caller-supplied, and `evaluate_packaged_authority` mints the SEALED
/// `VerifiedPackagedIdentity` from a successful evaluation. With the trait public, any consumer
/// could implement a verifier whose `is_production()` returns true and whose `verify()` accepts
/// anything, hand it to an `EvalContext`, and obtain the very proof that is documented as having no
/// public constructor. Before, no outside crate could name the trait, so `ctx.verifier` could only
/// be `None` or the real `ProductionEs256Verifier`.
///
/// This grants none of that. There is no verifier parameter: the anchor is the embedded one, so a
/// caller can ASK whether the owner's key signed some bytes and can never answer the question for
/// itself. It mints nothing, and there is still no signing counterpart.
pub use identity::verify_against_embedded_anchor;

/// PROJECTOS-RECOVERY-INSTALLED-APP1A: the INDEPENDENT installation observation.
///
/// `EvalContext::observed_installation` is the half of the corroboration check the manifest is not
/// allowed to supply, and the Control Centre was passing `Unknown` — a placeholder that refused
/// every packaged manifest for a reason unrelated to the manifest. Classification is re-exported so
/// the Control Centre can make the real observation through THE existing classifier rather than
/// growing a second one.
///
/// It grants nothing. `classify_installation` reads the running executable's canonical path and an
/// evidence provider and returns a classification; the production provider reports `Unavailable`,
/// so a Program Files location alone still yields `PerMachineUnverified`, which does NOT corroborate
/// per-machine. `PerMachineVerified` is unreachable by construction.
#[cfg(windows)]
pub use identity::install_root::{
    classify_installation, InstallationEvidence, InstallationEvidenceProvider, NoInstallerEvidence,
};
#[cfg(windows)]
pub use identity::running_executable::RunningExecutable;

/// PROJECTOS-RECOVERY-INSTALLED-APP1A: the installer-owned installed-application record.
///
/// Re-exported so the Control Centre can obtain INSTALLATION EVIDENCE and the governed system root
/// from facts an installer wrote, rather than inferring either from where it happens to be running.
/// It confers no cryptographic trust: the record cannot select a verifier, name an anchor or carry
/// key material, and the strongest identity it can corroborate is `PerMachineEvidenceMatched`.
#[cfg(windows)]
pub use identity::installed_application::{
    canonical_application_record_path, compute_application_record_digest,
    read_canonical_application_record, strongest_corroborated_identity, verify_application_record,
    verify_application_record_bytes, ApplicationRecordError, InstalledApplicationEvidence,
    InstalledApplicationRecordV1, VerifiedInstalledApplication, APPLICATION_RECORD_FILE_NAME,
    APPLICATION_RECORD_SCHEMA_VERSION, PER_MACHINE_SCOPE,
};

/// PROJECTOS-RECOVERY-INSTALLED-APP1A: the ES256 VERIFICATION primitive and the formats it demands.
///
/// Re-exported so the owner signing tooling can CHECK a detached signature before it is attached to
/// a manifest, using the very function the production verifier uses. Verification is not authority:
/// this proves a signature matches a public key over some bytes, and decides nothing about whether
/// that key is trusted — that judgement stays with the embedded anchor and `evaluate()`.
///
/// There is no signing counterpart here, and there must not be. ProjectOS never holds the owner's
/// private key.
pub use identity::anchor::{
    PRODUCTION_ALGORITHM, RAW_P256_SIGNATURE_LEN, UNCOMPRESSED_P256_POINT_LEN,
};
pub use identity::es256::{decode_hex, verify_es256};

/// The identity vocabulary a caller needs to assemble an `EvalContext` and read an outcome.
pub use identity::composite::InstallationIdentity;
pub use identity::errors::IdentityError;
pub use identity::mode::Policy;
pub use identity::types::{IdentityOutcome, IdentityState, InstallationModel};

/// TEST-ONLY proof minting, so a downstream authority boundary can be exercised without a signing
/// ceremony. Absent from every default and release build.
#[cfg(feature = "test-fixtures")]
pub use identity::packaged_authority::test_only_verified_identity;

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
