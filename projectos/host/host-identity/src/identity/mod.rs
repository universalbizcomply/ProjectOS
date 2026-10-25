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

pub mod anchor;
pub mod canonical;
pub mod composite;
pub mod errors;
pub mod es256;
pub mod hash;
/// RUN-TO-COMPLETION HOST ATTESTATION §10A: the owner-signed source of the installation's own
/// programme identity. Portable pure logic - no Windows gate, no filesystem.
pub mod committed_candidate;
pub mod installation_programme;
pub mod manifest;
pub mod mode;
pub mod packaged_authority;
pub mod paths;
pub mod production_verifier;
pub mod types;
pub mod verifier;

// PACKAGED-RUNTIME-IDENTITY2B native verifier mechanism (Windows-only).
#[cfg(windows)]
pub mod authenticode;
#[cfg(windows)]
pub mod canonical_record;
pub mod install_root;
/// PROJECTOS-RECOVERY-INSTALLED-APP1A: the installer-owned installed-application record.
#[cfg(windows)]
pub mod installed_application;
#[cfg(windows)]
pub mod publisher_policy;
#[cfg(windows)]
pub mod running_executable;

#[cfg(test)]
mod tests;

use composite::CompositeIdentity;

/// Capture the immutable composite identity ONCE at startup (WINDOWS-PACKAGED-RUNTIME-IDENTITY1B,
/// extended by 2B). The execution mode comes from the SAME structural build-fact source as the
/// daemon launch authority — `process::authority::detect_app_mode()` — never from a second detector.
/// The `test-fixtures` feature is the only signal that additionally distinguishes a test-fixture
/// build.
///
/// 2B: for a PackagedCandidate, the Control Centre executable is classified via the native
/// Authenticode + installation mechanism (`classify_packaged_candidate`). No approved production
/// publisher exists, so a real build's signature is `Unsigned` or `PublisherPolicyUnavailable`,
/// installation is at most `PerMachineEvidenceMatched`, and protected eligibility still derives to
/// `Disabled`. Development and TestFixture perform NO native verification.
#[cfg(windows)]
pub fn capture_startup_identity() -> CompositeIdentity {
    use projectos_windows_runtime_primitives::app_mode::{detect_app_mode, AppMode};

    // The `test-fixtures` feature is the explicit TestFixture classification (design §4). It never
    // ships in a normal release/packaged build, so a real installation can never be TestFixture.
    if cfg!(feature = "test-fixtures") {
        return CompositeIdentity::test_fixture(false, false);
    }
    match detect_app_mode() {
        AppMode::Development => CompositeIdentity::development(),
        AppMode::PackagedCandidate => classify_packaged_candidate(
            &authenticode::Win32Authenticode,
            &install_root::NoInstallerEvidence,
        ),
    }
}

/// Classify a packaged candidate: open the running executable, verify its Authenticode signature,
/// evaluate the (production = unavailable) publisher policy, and classify the installation. Any
/// failure to even establish the running-executable identity fails closed to `packaged_unverified`.
#[cfg(windows)]
pub fn classify_packaged_candidate(
    verifier: &dyn authenticode::AuthenticodeVerifier,
    evidence: &dyn install_root::InstallationEvidenceProvider,
) -> CompositeIdentity {
    let Some(exe) = running_executable::RunningExecutable::open_current() else {
        return CompositeIdentity::packaged_unverified();
    };
    let facts = authenticode::verify_bound(verifier, &exe);
    // No approved production publisher is configured this phase → the outcome is `Unavailable`.
    let policy = publisher_policy::PublisherPolicy::production();
    let publisher = policy.evaluate(facts.signer_spki_sha256);
    let signature = authenticode::derive_cc_signature(&facts, publisher);
    let installation = install_root::classify_installation(&exe, evidence);
    CompositeIdentity::packaged(signature, installation)
}

use std::path::{Path, PathBuf};

use projectos_packaged_runtime_contract as contract;

use composite::InstallationIdentity;
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
    /// The PACKAGED RUNTIME PAYLOAD root — the closed subject this manifest attests, and the root
    /// the manifest's relative paths bind beneath.
    ///
    /// It was called `install_root`, and the name was doing real damage. The application install
    /// root also holds the executable, the Tauri runtime DLLs and whatever the installer owns; the
    /// manifest describes none of those and must not appear to. Binding manifest paths beneath the
    /// install directory also put the payload and the application's own files in one namespace, so
    /// "everything here is attested" could never be true and dependency closure had nothing it could
    /// enumerate. They are separate roots because they are separate things: the payload root is an
    /// app-owned subdirectory OF the install root, named once by the packaging contract.
    pub payload_root: &'a Path,
    pub expected_application_id: &'a str,
    pub expected_application_version: &'a str,
    pub expected_architecture: &'a str,
    pub expected_runtime_version: &'a str,
    /// Signature verifier. Production requires `Some` and `is_production() == true`.
    pub verifier: Option<&'a dyn TrustManifestSignatureVerifier>,
    /// What was INDEPENDENTLY OBSERVED of this installation, from the running executable's real
    /// location and installer evidence. The manifest's `installationModel` is compared against it;
    /// a manifest may declare, but it may not be its own witness. Never derived from the manifest.
    pub observed_installation: InstallationIdentity,
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
    // 5. Installation model — only PerMachine can anchor production, AND the manifest's claim must
    //    be corroborated by what was independently OBSERVED of this installation.
    //
    //    The check used to read the manifest's own declaration and nothing else, so a manifest
    //    self-attested its installation safety: any copied tree carrying a manifest that said
    //    "PerMachine" cleared the step that exists to establish it was per-machine. The manifest is
    //    the thing under suspicion; it cannot also be the witness. Corroboration comes from
    //    `classify_installation`, which reads the running executable's real location and installer
    //    evidence.
    //
    //    Required by the gatekeeper's PROJECTOS-RECOVERY-INSTALLED-APP1A preflight ruling.
    if ctx.policy.is_production() {
        if !m.installation_model.can_anchor_production() {
            return blocked(IdentityError::InstallationModelUnsafe);
        }
        if !ctx.observed_installation.corroborates_per_machine() {
            return blocked(IdentityError::InstallationModelUncorroborated);
        }
    }
    // 6. Platform + architecture binding (platform-not-windows and arch mismatch both close here).
    if m.runtime.platform != WINDOWS_PLATFORM || m.runtime.architecture != ctx.expected_architecture
    {
        return blocked(IdentityError::RuntimeArchitectureMismatch);
    }
    // 7. Runtime path: bind the manifest RELATIVE path beneath the install root (absolute/traversal
    //    rejected). This is the ONLY way a runtime path is produced — PATH lookup is structurally
    //    impossible because no code reads PATH or a caller-supplied path.
    let runtime_path = match bind_runtime(ctx.payload_root, &m.runtime.relative_path) {
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
    // 11. Daemon artefact: only a single hashed bundle may anchor production. The format is now a
    //     closed enum, so an unrecognised shape cannot reach this check at all — it fails at parse.
    if ctx.policy.is_production() && !m.daemon_artefact.format.can_anchor_production() {
        return blocked(IdentityError::LooseModuleIdentityForbidden);
    }
    let artefact_path =
        match paths::bind_relative(ctx.payload_root, &m.daemon_artefact.relative_path) {
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

/// Ask whether the OWNER'S EMBEDDED PRODUCTION KEY signed these exact bytes.
///
/// A QUESTION, NOT AN AUTHORITY. There is deliberately no verifier parameter and no policy
/// parameter: the anchor is the embedded one, so a caller can ask the question and can never answer
/// it for itself. It mints nothing — no capability, no identity, no sealed proof — and a `true` here
/// says only "this signature matches the embedded key over these bytes". Whether an installation may
/// be trusted remains `evaluate()`'s judgement, and whether a provider call may happen remains
/// `verify_execution_closure`'s.
///
/// It exists so a PROOF can anchor itself to a real signature instead of to a second committed file
/// — which is the difference between establishing that canonicalisation still means what it meant
/// and merely establishing that two files agree.
#[must_use]
pub fn verify_against_embedded_anchor(
    canonical: &[u8],
    algorithm: &str,
    signing_key_id: &str,
    signature: &str,
) -> bool {
    let v = production_verifier::ProductionEs256Verifier::from_embedded();
    // A verifier with no anchor is not a verifier. Refuse rather than report a vacuous success.
    if !v.is_production() {
        return false;
    }
    v.verify(&verifier::SignatureInput {
        canonical,
        algorithm,
        signing_key_id,
        signature,
    })
    .is_ok()
}

/// The committed bytes of the gatekeeper execution closure, as the caller established them.
///
/// `None` MEANS "COULD NOT BE ESTABLISHED", AND IT IS NOT THE SAME AS EMPTY. The bytes come from the
/// installation's git object store, and every step of that read can fail for reasons that have
/// nothing to do with the file: no git, not a repository, the path uncommitted, the working tree
/// dirty. Collapsing those into an empty slice would hash to a real digest and compare unequal,
/// which is the right OUTCOME reached by the wrong reasoning — and one day it would be reached with
/// a digest that happened to match. `None` makes "I could not ask" a distinct, named refusal.
pub struct CommittedClosureBytes<'a> {
    pub gatekeeper_broker: Option<&'a [u8]>,
    pub installation_project_allowlist: Option<&'a [u8]>,
    pub credential_adapter: Option<&'a [u8]>,
}

/// The three artefact-specific refusals for one closure member, so no artefact borrows another's.
struct ClosureErrors {
    path_mismatch: IdentityError,
    not_readable: IdentityError,
    hash_mismatch: IdentityError,
}

fn check_committed(
    declared: &manifest::CommittedArtefactManifest,
    expected_path: &str,
    committed: Option<&[u8]>,
    errors: ClosureErrors,
) -> Result<(), IdentityError> {
    // PATH FIRST. A manifest that named a different file would otherwise be judged only on a digest
    // — and an attacker who can choose WHICH file is attested does not need to forge one.
    if declared.repository_relative_path != expected_path {
        return Err(errors.path_mismatch);
    }
    let bytes = committed.ok_or(errors.not_readable)?;
    if !hash::hash_matches(bytes, &declared.sha256) {
        return Err(errors.hash_mismatch);
    }
    Ok(())
}

/// Verify that the gatekeeper EXECUTION CLOSURE the owner signed is the closure that is committed.
///
/// THE SECOND WITNESS, NOT A REPLACEMENT FOR THE FIRST. The caller already proves these bytes are
/// the installation's committed bytes, by reading them out of the git object store and executing
/// exactly what it read. Git can establish that a file is committed and unmodified; it cannot
/// establish that the commit was one an owner approved — anyone who can commit can satisfy it. This
/// adds that second, independent question, answered by an owner-held key over a subject the running
/// code cannot alter. Neither witness is sufficient alone and neither is weakened by the other.
///
/// EXPECTED PATHS COME FROM THE PACKAGING CONTRACT, NEVER FROM A CALLER AND NEVER FROM THE MANIFEST.
/// A verifier that accepted the manifest's own idea of which files matter would let a manifest
/// attest three harmless files and satisfy every digest check while the real broker went unbound.
///
/// SEPARATE FROM `evaluate()` ON PURPOSE. `evaluate()` answers "is this installation what it claims
/// to be", from bytes in the payload; this answers "may a provider call happen", from bytes in the
/// repository. Folding the second into the first would have forced every existing caller — none of
/// which is making a provider call — to supply committed bytes it has no reason to hold, and a
/// parameter that most callers pass as `None` becomes a check most callers skip.
///
/// IT VERIFIES THE SIGNATURE ITSELF RATHER THAN TRUSTING THE CALLER TO HAVE DONE SO. Taking a bare
/// `&TrustManifest` was a real hazard raised by the security review: nothing stopped a future
/// integration parsing a manifest and passing it straight here, and an attacker who can commit —
/// but cannot sign — would then only need to write a manifest whose digests match their own
/// committed bytes. Every digest check would pass and no signature would ever be consulted. Taking
/// the policy and the verifier makes the ordering impossible to get wrong: the owner's signature is
/// established over the whole subject BEFORE any digest is compared, so the digests being checked
/// are always ones an owner key actually vouched for.
pub fn verify_execution_closure(
    m: &TrustManifest,
    policy: Policy,
    verifier: &dyn TrustManifestSignatureVerifier,
    committed: &CommittedClosureBytes<'_>,
) -> Result<VerifiedExecutionClosure, IdentityError> {
    // Shape first. `check_versions` is repeated here rather than assumed, because this function is
    // reachable on its own and a check whose safety depends on another one having run first is a
    // check with a bypass.
    m.check_versions()?;
    // A version 1 manifest is not broken and is not being rejected as a manifest; it simply never
    // signed a closure, so it can never satisfy one. Stated as its own refusal rather than as
    // "closure missing", because the operator's action differs: install a release that has one.
    if m.manifest_version < manifest::EXECUTION_CLOSURE_MANIFEST_VERSION {
        return Err(IdentityError::ExecutionClosureManifestVersionTooLow);
    }
    // THE SIGNATURE, BEFORE ANY DIGEST. Everything below compares the manifest's numbers against
    // real bytes; without this, those numbers would be whatever the manifest's author chose.
    verify_signature(m, policy, verifier)?;
    let closure = m
        .execution_closure
        .as_ref()
        .ok_or(IdentityError::ExecutionClosureMissing)?;

    check_committed(
        &closure.gatekeeper_broker,
        contract::BROKER_REPOSITORY_RELATIVE_PATH,
        committed.gatekeeper_broker,
        ClosureErrors {
            path_mismatch: IdentityError::BrokerArtefactPathMismatch,
            not_readable: IdentityError::BrokerArtefactNotReadable,
            hash_mismatch: IdentityError::BrokerArtefactHashMismatch,
        },
    )?;
    check_committed(
        &closure.installation_project_allowlist,
        contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
        committed.installation_project_allowlist,
        ClosureErrors {
            path_mismatch: IdentityError::InstallationAllowlistPathMismatch,
            not_readable: IdentityError::InstallationAllowlistNotReadable,
            hash_mismatch: IdentityError::InstallationAllowlistHashMismatch,
        },
    )?;
    check_committed(
        &closure.credential_adapter,
        contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
        committed.credential_adapter,
        ClosureErrors {
            path_mismatch: IdentityError::CredentialAdapterPathMismatch,
            not_readable: IdentityError::CredentialAdapterNotReadable,
            hash_mismatch: IdentityError::CredentialAdapterHashMismatch,
        },
    )?;

    // THE SIGNED POLICY FACTS (PROJECTOS-HOST-REVIEW-PATH1B). Read only now - after the owner's
    // signature over the whole subject and after every committed artefact matched - and refused,
    // never defaulted, when any of the three is unusable.
    closure.check_policy_facts()?;
    Ok(VerifiedExecutionClosure {
        admitted_review_cost_micro_usd: closure.cost_policy.admitted_review_cost_micro_usd,
        model_policy: closure.model_policy.clone(),
        credential_ref: closure.credential_ref.clone(),
    })
}

/// THE POLICY FACTS OF A VERIFIED EXECUTION CLOSURE. PROJECTOS-HOST-REVIEW-PATH1B.
///
/// SEALED BY CONSTRUCTION: the fields are private and [`verify_execution_closure`] is the only place
/// one is built, so a value of this type exists only after the owner's signature was established over
/// the whole manifest, every closure artefact matched its committed bytes, and all three policy facts
/// were present and usable. There is no way to obtain one from unsigned bytes and no default.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedExecutionClosure {
    admitted_review_cost_micro_usd: u64,
    model_policy: String,
    credential_ref: String,
}

impl VerifiedExecutionClosure {
    /// What the owner signed that one review may be ADMITTED to cost, in micro-USD. A reservation
    /// figure - never an actual or provider-billed cost.
    #[must_use]
    pub fn admitted_review_cost_micro_usd(&self) -> u64 {
        self.admitted_review_cost_micro_usd
    }

    /// The model-policy identity digest, DERIVED FROM THE OWNER-SIGNED TEXT.
    #[must_use]
    pub fn model_policy_digest(&self) -> [u8; 32] {
        installation_programme::model_policy_identity_digest(&self.model_policy)
    }

    /// The provider the owner's signed model policy names.
    #[must_use]
    pub fn review_provider(&self) -> &str {
        manifest::parse_model_policy(&self.model_policy).map_or("", |(provider, _)| provider)
    }

    /// THE EXACT MODEL ID the owner's signed model policy names. Non-empty by construction: a closure
    /// whose policy does not resolve is refused before a value of this type can exist.
    #[must_use]
    pub fn review_model(&self) -> &str {
        manifest::parse_model_policy(&self.model_policy).map_or("", |(_, model)| model)
    }

    /// The credential REFERENCE the owner signed: the name the trusted broker resolves. Never a secret.
    #[must_use]
    pub fn credential_ref_text(&self) -> &str {
        &self.credential_ref
    }

    /// The credential-reference identity digest, DERIVED FROM THE OWNER-SIGNED TEXT.
    #[must_use]
    pub fn credential_ref_digest(&self) -> [u8; 32] {
        installation_programme::credential_ref_identity_digest(&self.credential_ref)
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
