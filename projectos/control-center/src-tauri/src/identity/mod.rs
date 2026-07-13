//! Packaged sidecar identity foundation (PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A).
//!
//! Replaces ambient PATH-based runtime selection and loose, unverifiable daemon-module identity with
//! a bounded identity foundation: strict trust-manifest parsing, canonical serialization, SHA-256
//! verification of the pinned runtime and daemon artefact, application/version/architecture binding,
//! a signature-verifier abstraction (production fails closed — no production verifier this phase),
//! and closed identity states + typed failures.
//!
//! This module MINTS NOTHING: no VerifiedStoreProtection / VerifiedSecureNonceGenerator /
//! VerifiedKeyProtectionEvidence / trusted actor / approval / execution authority. It only
//! *classifies* identity. On a real machine without a production signing ceremony or protected
//! install, the terminal result is `PRODUCTION_IDENTITY_UNAVAILABLE`.
//!
//! Much of this foundation is exercised by the identity tests and consumed by later trust phases
//! (WINDOWS-PROCESS-OWNERSHIP1A / WINDOWS-TRUST-PROTOCOL1A / WINDOWS-STORE-PROTECTION1A); the bin
//! entry uses only `development_identity` this phase, so `dead_code` is allowed module-wide.
#![allow(dead_code)]

pub mod canonical;
pub mod errors;
pub mod hash;
pub mod manifest;
pub mod mode;
pub mod paths;
pub mod types;
pub mod verifier;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use errors::IdentityError;
use manifest::TrustManifest;
use mode::Policy;
use types::{IdentityOutcome, IdentityState};
use verifier::{TrustManifestSignatureVerifier, TEST_KEY_ID_PREFIX};

/// Filesystem read port — injected so tests never touch the real disk and evaluation is deterministic.
pub trait IdentityFs {
    /// Read the bytes of a bound absolute path, or None if it does not exist / cannot be read.
    fn read(&self, path: &Path) -> Option<Vec<u8>>;
}

/// Real filesystem implementation used at runtime.
pub struct RealFs;
impl IdentityFs for RealFs {
    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }
}

/// Everything an evaluation needs from the trusted application build — never from the manifest,
/// env, argv, cwd, React, or a caller-supplied path.
pub struct EvalContext<'a> {
    pub policy: Policy,
    pub install_root: &'a Path,
    pub expected_application_id: &'a str,
    pub expected_application_version: &'a str,
    pub expected_architecture: &'a str,
    pub expected_runtime_version: &'a str,
    /// Signature verifier. Production requires `Some` and `is_production() == true`.
    pub verifier: Option<&'a dyn TrustManifestSignatureVerifier>,
}

const WINDOWS_PLATFORM: &str = "windows";

/// The development classification: a local dev tree is never a production trust anchor.
pub fn development_identity() -> IdentityOutcome {
    IdentityOutcome {
        state: IdentityState::DevelopmentUnverified,
        application_id: None,
        application_version: None,
        installation_model: None,
        signer: None,
        failure: None,
        read_only_operation_safe: true,
        protected_approvals_disabled: true,
        next_safe_action:
            "Development mode: read-only snapshot only; production trust unavailable.".to_string(),
    }
}

fn blocked(err: IdentityError) -> IdentityOutcome {
    let production_unavailable = matches!(err, IdentityError::ProductionIdentityUnavailable);
    IdentityOutcome {
        state: if production_unavailable {
            IdentityState::ProductionIdentityUnavailable
        } else {
            IdentityState::IdentityBlocked
        },
        application_id: None,
        application_version: None,
        installation_model: None,
        signer: None,
        failure: Some(err),
        read_only_operation_safe: err.read_only_operation_safe(),
        protected_approvals_disabled: err.protected_approvals_disabled(),
        next_safe_action: err.next_safe_action().to_string(),
    }
}

/// Evaluate packaged identity from raw manifest bytes under the given context. Returns a closed,
/// serialisable outcome. Never mints a capability; never returns production identity in dev.
pub fn evaluate(
    raw_manifest: &[u8],
    ctx: &EvalContext<'_>,
    fs: &dyn IdentityFs,
) -> IdentityOutcome {
    // 1. Parse (strict, unknown-field-rejecting).
    let m = match TrustManifest::parse(raw_manifest) {
        Ok(m) => m,
        Err(e) => return blocked(e),
    };
    // 2. Versions.
    if let Err(e) = m.check_versions() {
        return blocked(e);
    }
    // 3/4. Application binding.
    if m.application_id != ctx.expected_application_id {
        return blocked(IdentityError::ApplicationIdMismatch);
    }
    if m.application_version != ctx.expected_application_version {
        return blocked(IdentityError::ApplicationVersionMismatch);
    }
    // 5. Installation model — only PerMachine can anchor production.
    if ctx.policy.is_production() && !m.installation_model.can_anchor_production() {
        return blocked(IdentityError::InstallationModelUnsafe);
    }
    // 6. Platform + architecture binding (platform-not-windows and arch mismatch both close here).
    if m.runtime.platform != WINDOWS_PLATFORM || m.runtime.architecture != ctx.expected_architecture
    {
        return blocked(IdentityError::RuntimeArchitectureMismatch);
    }
    // 7. Runtime path: bind the manifest RELATIVE path beneath the install root (absolute/traversal
    //    rejected). This is the ONLY way a runtime path is produced — PATH lookup is structurally
    //    impossible because no code reads PATH or a caller-supplied path.
    let runtime_path = match bind_runtime(ctx.install_root, &m.runtime.relative_path) {
        Ok(p) => p,
        Err(e) => return blocked(e),
    };
    // 8. Runtime must be provisioned.
    let runtime_bytes = match fs.read(&runtime_path) {
        Some(b) => b,
        None => return blocked(IdentityError::RuntimeNotProvisioned),
    };
    // 9. Runtime hash.
    if !hash::hash_matches(&runtime_bytes, &m.runtime.sha256) {
        return blocked(IdentityError::RuntimeHashMismatch);
    }
    // 10. Runtime version binding (manifest's declared runtime version vs the trusted app build's
    //     expectation — we never execute node to read its version).
    if m.runtime.expected_version != ctx.expected_runtime_version {
        return blocked(IdentityError::RuntimeVersionMismatch);
    }
    // 11. Daemon artefact: loose modules are forbidden as production identity.
    if ctx.policy.is_production() && m.daemon_artefact.format == "loose-modules" {
        return blocked(IdentityError::LooseModuleIdentityForbidden);
    }
    let artefact_path =
        match paths::bind_relative(ctx.install_root, &m.daemon_artefact.relative_path) {
            Some(p) => p,
            None => return blocked(IdentityError::DaemonArtefactNotFound),
        };
    let artefact_bytes = match fs.read(&artefact_path) {
        Some(b) => b,
        None => return blocked(IdentityError::DaemonArtefactNotFound),
    };
    if !hash::hash_matches(&artefact_bytes, &m.daemon_artefact.sha256) {
        return blocked(IdentityError::DaemonArtefactHashMismatch);
    }
    // -- hashes verified (partial; NOT yet identity-verified) --
    let hashes_state = IdentityState::PackagedHashesVerified;

    // 12. Signature.
    let verifier = match ctx.verifier {
        Some(v) => v,
        None => {
            // No verifier configured. Production has nothing to trust → unavailable.
            return blocked(IdentityError::ProductionIdentityUnavailable);
        }
    };
    let signer = match verify_signature(&m, ctx.policy, verifier) {
        Ok(s) => s,
        Err(e) => return blocked(e),
    };
    let _ = hashes_state; // hashes verified precedes signature; retained for clarity of the pipeline.

    // 13. Terminal success — differs by policy. Test never yields production identity.
    let state = if ctx.policy.is_production() {
        IdentityState::PackagedIdentityVerified
    } else {
        IdentityState::TestIdentityVerified
    };
    IdentityOutcome {
        state,
        application_id: Some(m.application_id.clone()),
        application_version: Some(m.application_version.clone()),
        installation_model: Some(m.installation_model),
        signer: Some(signer),
        failure: None,
        read_only_operation_safe: true,
        protected_approvals_disabled: !ctx.policy.is_production(),
        next_safe_action: if ctx.policy.is_production() {
            "Packaged identity verified.".to_string()
        } else {
            "Test identity verified (never production).".to_string()
        },
    }
}

/// Bind a runtime path, rejecting absolute manifest paths (would bypass the install root) and
/// traversal. A bare name (no separator) still binds beneath the root — it can never resolve via
/// PATH because we only ever `join` under the install root.
fn bind_runtime(root: &Path, relative: &str) -> Result<PathBuf, IdentityError> {
    if Path::new(relative).is_absolute() {
        return Err(IdentityError::RuntimePathInvalid);
    }
    match paths::bind_relative(root, relative) {
        Some(p) => Ok(p),
        None => Err(IdentityError::RuntimeOutsideInstallRoot),
    }
}

/// Verify the manifest signature under policy. Production rejects test signers and non-production
/// verifiers; test policy requires the test-signer prefix and a non-production verifier.
fn verify_signature(
    m: &TrustManifest,
    policy: Policy,
    verifier: &dyn TrustManifestSignatureVerifier,
) -> Result<types::VerifiedSigner, IdentityError> {
    if m.signature.is_empty() {
        return Err(IdentityError::ManifestSignatureRequired);
    }
    let is_test_signer = m.signing_key_id.starts_with(TEST_KEY_ID_PREFIX);
    if policy.is_production() {
        if is_test_signer || !verifier.is_production() {
            return Err(IdentityError::TestSignerRejectedInProduction);
        }
    } else {
        // Test policy: only the deterministic test signer is acceptable.
        if !is_test_signer || verifier.is_production() {
            return Err(IdentityError::ManifestSignerUnknown);
        }
    }
    let canonical = canonical::canonical_bytes(m);
    let input = verifier::SignatureInput {
        canonical: &canonical,
        algorithm: &m.signature_algorithm,
        signing_key_id: &m.signing_key_id,
        signature: &m.signature,
    };
    verifier.verify(&input)
}
