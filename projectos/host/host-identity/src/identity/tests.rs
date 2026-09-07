//! Tests for PACKAGED-SIDECAR-IDENTITY1A. They prove PATH and loose-module identity are rejected,
//! production fails closed without an authentic signature, dev/env/CLI/cwd can never select
//! production, and no capability is minted. All filesystem access is a deterministic FakeFs — no
//! real disk, no PATH, no node execution.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::composite::InstallationIdentity;
use super::errors::IdentityError;
use super::hash::sha256_hex;
use super::manifest::{
    DaemonArtefactFormat, DaemonArtefactManifest, RuntimeManifest, TrustManifest,
};
use super::mode::Policy;
use super::types::{IdentityState, InstallationModel};
use super::verifier::{
    DeterministicTestVerifier, SignatureInput, TrustManifestSignatureVerifier, TEST_ALGORITHM,
};
use super::{canonical, development_identity, evaluate, EvalContext, IdentityFs};

const APP_ID: &str = "com.universalbizcomply.projectos.control";
const APP_VER: &str = "0.1.0";
const ARCH: &str = "x86_64";
const RT_VER: &str = "v20.0.0";
const TEST_KEY: &str = "TEST-ONLY-key-1";

fn root() -> PathBuf {
    PathBuf::from("C:/ProgramData/ProjectOS")
}

const RUNTIME_REL: &str = "runtime/node.exe";
const ARTEFACT_REL: &str = "daemon/daemon-bundle.mjs";
const RUNTIME_BYTES: &[u8] = b"fake-pinned-node-runtime-bytes";
const ARTEFACT_BYTES: &[u8] = b"fake-rolled-up-daemon-artefact-bytes";

/// Deterministic in-memory filesystem — the only source of "files"; no real disk touched.
struct FakeFs {
    files: HashMap<PathBuf, Vec<u8>>,
}
impl FakeFs {
    fn with_runtime_and_artefact() -> FakeFs {
        let mut files = HashMap::new();
        files.insert(root().join(RUNTIME_REL), RUNTIME_BYTES.to_vec());
        files.insert(root().join(ARTEFACT_REL), ARTEFACT_BYTES.to_vec());
        FakeFs { files }
    }
    fn empty() -> FakeFs {
        FakeFs {
            files: HashMap::new(),
        }
    }
}
impl IdentityFs for FakeFs {
    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        self.files.get(path).cloned()
    }
}

/// A production-grade verifier stub. It reports production and would accept a genuine (non-test)
/// signer; production policy rejects test signers BEFORE calling it, so it is used to prove that.
struct FakeProdVerifier;
impl TrustManifestSignatureVerifier for FakeProdVerifier {
    fn verify(
        &self,
        _input: &SignatureInput<'_>,
    ) -> Result<super::types::VerifiedSigner, IdentityError> {
        Ok(super::types::VerifiedSigner {
            signer_id: "prod-signer".into(),
            verified_at: "1970-01-01T00:00:00.000Z".into(),
            verifier_impl_id: "fake-prod".into(),
            signature_algorithm: "es256".into(),
            evidence_ref: "prod".into(),
            production_grade: true,
        })
    }
    fn is_production(&self) -> bool {
        true
    }
}

/// Build a manifest that is valid apart from its (yet-unset) signature.
fn base_manifest() -> TrustManifest {
    TrustManifest {
        schema_version: 1,
        manifest_version: 1,
        application_id: APP_ID.into(),
        application_version: APP_VER.into(),
        build_id: "build-123".into(),
        installation_model: InstallationModel::PerMachine,
        runtime: RuntimeManifest {
            relative_path: RUNTIME_REL.into(),
            sha256: sha256_hex(RUNTIME_BYTES),
            expected_version: RT_VER.into(),
            platform: "windows".into(),
            architecture: ARCH.into(),
        },
        daemon_artefact: DaemonArtefactManifest {
            relative_path: ARTEFACT_REL.into(),
            sha256: sha256_hex(ARTEFACT_BYTES),
            format: DaemonArtefactFormat::SingleBundle,
            build_id: "build-123".into(),
        },
        generated_at: "1970-01-01T00:00:00.000Z".into(),
        minimum_protocol_version: 1,
        signature_algorithm: TEST_ALGORITHM.into(),
        signing_key_id: TEST_KEY.into(),
        // The base fixture stays a VERSION 1 manifest with no closure, so every existing proof in
        // this file keeps testing exactly what it tested before. The closure proofs build on it
        // explicitly rather than changing what "a valid manifest" means for the rest of the suite.
        execution_closure: None,
        signature: String::new(),
    }
}

/// Apply the deterministic TEST signature over the canonical bytes.
fn sign_test(m: &mut TrustManifest) {
    let canonical = canonical::canonical_bytes(m);
    m.signature = DeterministicTestVerifier::expected_signature(&canonical, &m.signing_key_id);
}

fn raw(m: &TrustManifest) -> Vec<u8> {
    serde_json::to_vec(m).unwrap()
}

fn test_ctx<'a>(v: &'a dyn TrustManifestSignatureVerifier) -> EvalContext<'a> {
    EvalContext {
        policy: Policy::Test,
        payload_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: Some(v),
        // Test policy never reaches the corroboration check; a per-machine observation keeps the
        // fixture honest about what a real installation would look like.
        observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
    }
}

fn prod_ctx<'a>(v: Option<&'a dyn TrustManifestSignatureVerifier>) -> EvalContext<'a> {
    EvalContext {
        policy: Policy::Production,
        payload_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: v,
        observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
    }
}

// ---- happy paths ---------------------------------------------------------------------------------

#[test]
fn valid_test_manifest_reaches_test_identity_verified() {
    let mut m = base_manifest();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.state, IdentityState::TestIdentityVerified);
    assert!(out.failure.is_none());
    assert!(
        out.protected_approvals_disabled,
        "test identity must never grant production approvals"
    );
}

#[test]
fn development_identity_is_never_production() {
    let out = development_identity();
    assert_eq!(out.state, IdentityState::DevelopmentUnverified);
    assert!(out.protected_approvals_disabled);
    assert!(out.read_only_operation_safe);
}

// ---- runtime -------------------------------------------------------------------------------------

#[test]
fn absolute_runtime_path_rejected() {
    let mut m = base_manifest();
    m.runtime.relative_path = "C:/Windows/System32/node.exe".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::RuntimePathInvalid));
}

#[test]
fn traversing_runtime_path_rejected() {
    let mut m = base_manifest();
    m.runtime.relative_path = "../../Windows/node.exe".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::RuntimeOutsideInstallRoot));
}

#[test]
fn missing_runtime_reports_not_provisioned() {
    let mut m = base_manifest();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::empty(),
    );
    assert_eq!(out.failure, Some(IdentityError::RuntimeNotProvisioned));
}

#[test]
fn wrong_runtime_hash_rejected() {
    let mut m = base_manifest();
    m.runtime.sha256 = sha256_hex(b"different-bytes");
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::RuntimeHashMismatch));
}

#[test]
fn wrong_runtime_version_rejected() {
    let mut m = base_manifest();
    m.runtime.expected_version = "v18.0.0".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::RuntimeVersionMismatch));
}

#[test]
fn wrong_architecture_rejected() {
    let mut m = base_manifest();
    m.runtime.architecture = "arm64".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::RuntimeArchitectureMismatch)
    );
}

#[test]
fn non_windows_platform_rejected() {
    let mut m = base_manifest();
    m.runtime.platform = "linux".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::RuntimeArchitectureMismatch)
    );
}

// ---- daemon artefact -----------------------------------------------------------------------------

#[test]
fn loose_module_format_forbidden_in_production() {
    let mut m = base_manifest();
    m.installation_model = InstallationModel::PerMachine;
    m.daemon_artefact.format = DaemonArtefactFormat::LooseModules;
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    m.signature = "sig".into(); // non-empty; we should fail on loose-modules before signature
    let out = evaluate(
        &raw(&m),
        &prod_ctx(Some(&FakeProdVerifier)),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::LooseModuleIdentityForbidden)
    );
}

#[test]
fn missing_artefact_reported() {
    let mut m = base_manifest();
    sign_test(&mut m);
    let mut fs = FakeFs::with_runtime_and_artefact();
    fs.files.remove(&root().join(ARTEFACT_REL));
    let out = evaluate(&raw(&m), &test_ctx(&DeterministicTestVerifier), &fs);
    assert_eq!(out.failure, Some(IdentityError::DaemonArtefactNotFound));
}

#[test]
fn modified_artefact_hash_rejected() {
    let mut m = base_manifest();
    m.daemon_artefact.sha256 = sha256_hex(b"tampered");
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::DaemonArtefactHashMismatch));
}

// ---- manifest ------------------------------------------------------------------------------------

#[test]
fn malformed_manifest_rejected() {
    let out = evaluate(
        b"{ not json",
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestMalformed));
}

#[test]
fn unknown_field_rejected() {
    // A manifest injecting its own public key (or any extra field) must fail to parse.
    let json = format!(
        r#"{{"schemaVersion":1,"manifestVersion":1,"applicationId":"{APP_ID}","applicationVersion":"{APP_VER}","buildId":"b","installationModel":"PER_MACHINE","runtime":{{"relativePath":"{RUNTIME_REL}","sha256":"{}","expectedVersion":"{RT_VER}","platform":"windows","architecture":"{ARCH}"}},"daemonArtefact":{{"relativePath":"{ARTEFACT_REL}","sha256":"{}","format":"single-bundle","buildId":"b"}},"generatedAt":"t","minimumProtocolVersion":1,"signatureAlgorithm":"{TEST_ALGORITHM}","signingKeyId":"{TEST_KEY}","signature":"x","publicKey":"ATTACKER-SUPPLIED"}}"#,
        sha256_hex(RUNTIME_BYTES),
        sha256_hex(ARTEFACT_BYTES)
    );
    let out = evaluate(
        json.as_bytes(),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::ManifestMalformed),
        "self-supplied manifest public key must be rejected"
    );
}

#[test]
fn unsupported_schema_rejected() {
    let mut m = base_manifest();
    m.schema_version = 2;
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestVersionUnsupported));
}

#[test]
fn wrong_app_id_rejected() {
    let mut m = base_manifest();
    m.application_id = "com.evil.clone".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ApplicationIdMismatch));
}

#[test]
fn wrong_app_version_rejected() {
    let mut m = base_manifest();
    m.application_version = "9.9.9".into();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ApplicationVersionMismatch));
}

#[test]
fn canonical_serialization_is_order_independent() {
    let j1 = r#"{"schemaVersion":1,"manifestVersion":1,"applicationId":"a","applicationVersion":"1","buildId":"b","installationModel":"PER_MACHINE","runtime":{"relativePath":"r","sha256":"h","expectedVersion":"v","platform":"windows","architecture":"x"},"daemonArtefact":{"relativePath":"d","sha256":"h2","format":"single-bundle","buildId":"b"},"generatedAt":"t","minimumProtocolVersion":1,"signatureAlgorithm":"alg","signingKeyId":"k","signature":"SIG-A"}"#;
    // Same fields, different top-level order + different signature value (excluded from canonical).
    let j2 = r#"{"applicationId":"a","schemaVersion":1,"manifestVersion":1,"applicationVersion":"1","installationModel":"PER_MACHINE","buildId":"b","daemonArtefact":{"buildId":"b","relativePath":"d","sha256":"h2","format":"single-bundle"},"runtime":{"architecture":"x","relativePath":"r","sha256":"h","expectedVersion":"v","platform":"windows"},"minimumProtocolVersion":1,"generatedAt":"t","signingKeyId":"k","signatureAlgorithm":"alg","signature":"SIG-B-DIFFERENT"}"#;
    let m1 = TrustManifest::parse(j1.as_bytes()).unwrap();
    let m2 = TrustManifest::parse(j2.as_bytes()).unwrap();
    assert_eq!(
        canonical::canonical_bytes(&m1),
        canonical::canonical_bytes(&m2)
    );
}

// ---- signature -----------------------------------------------------------------------------------

#[test]
fn unsigned_production_manifest_rejected() {
    let mut m = base_manifest();
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    m.signature = String::new();
    let out = evaluate(
        &raw(&m),
        &prod_ctx(Some(&FakeProdVerifier)),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureRequired));
}

#[test]
fn test_signer_rejected_in_production() {
    let mut m = base_manifest(); // uses TEST-ONLY key
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &prod_ctx(Some(&FakeProdVerifier)),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::TestSignerRejectedInProduction)
    );
}

#[test]
fn no_production_verifier_is_unavailable() {
    let mut m = base_manifest();
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    sign_test(&mut m); // signature value irrelevant; verifier is None
    let out = evaluate(
        &raw(&m),
        &prod_ctx(None),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.failure,
        Some(IdentityError::ProductionIdentityUnavailable)
    );
    assert_eq!(out.state, IdentityState::ProductionIdentityUnavailable);
}

#[test]
fn changed_runtime_hash_invalidates_signature() {
    let mut m = base_manifest();
    sign_test(&mut m);
    m.runtime.sha256 = sha256_hex(RUNTIME_BYTES); // unchanged so hash passes...
                                                  // now tamper a signed field WITHOUT re-signing → signature no longer matches canonical
    m.build_id = "tampered-after-signing".into();
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureInvalid));
}

#[test]
fn unknown_algorithm_rejected_by_test_verifier() {
    let mut m = base_manifest();
    m.signature_algorithm = "es256".into(); // test verifier only accepts its own label
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureInvalid));
}

// ---- mode separation -----------------------------------------------------------------------------

#[test]
fn test_policy_never_yields_packaged_identity_verified() {
    let mut m = base_manifest();
    sign_test(&mut m);
    let out = evaluate(
        &raw(&m),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_ne!(out.state, IdentityState::PackagedIdentityVerified);
}

#[test]
fn per_user_install_cannot_anchor_production() {
    let mut m = base_manifest();
    m.installation_model = InstallationModel::PerUser;
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    m.signature = "sig".into();
    let out = evaluate(
        &raw(&m),
        &prod_ctx(Some(&FakeProdVerifier)),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::InstallationModelUnsafe));
}

#[test]
fn installation_model_helper_only_permits_per_machine() {
    assert!(InstallationModel::PerMachine.can_anchor_production());
    assert!(!InstallationModel::PerUser.can_anchor_production());
    assert!(!InstallationModel::Development.can_anchor_production());
}

// ---- no ambient production selection --------------------------------------------------------------
// Structural guarantee: `evaluate` takes Policy explicitly and reads no env/argv/cwd. These tests
// document that only an explicit Production policy + PerMachine + production verifier can ever reach
// PACKAGED_IDENTITY_VERIFIED — nothing ambient does.

#[test]
fn full_production_chain_with_production_verifier_and_non_test_signer_verifies() {
    let mut m = base_manifest();
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    m.signature = "genuine-sig".into(); // FakeProdVerifier accepts any non-test signer
    let out = evaluate(
        &raw(&m),
        &prod_ctx(Some(&FakeProdVerifier)),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        out.state,
        IdentityState::PackagedIdentityVerified,
        "{:?}",
        out.failure
    );
    assert!(
        !out.protected_approvals_disabled,
        "verified production identity may enable approvals downstream"
    );
}

// ---- installation corroboration (PROJECTOS-RECOVERY-INSTALLED-APP1A) -----------------------------

/// A production context whose OBSERVED installation is whatever the caller says it saw.
fn prod_ctx_observing<'a>(
    v: Option<&'a dyn TrustManifestSignatureVerifier>,
    observed: InstallationIdentity,
) -> EvalContext<'a> {
    EvalContext {
        policy: Policy::Production,
        payload_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: v,
        observed_installation: observed,
    }
}

/// A manifest that is entirely well-formed and declares the strongest installation model.
fn per_machine_manifest() -> TrustManifest {
    let mut m = base_manifest();
    m.installation_model = InstallationModel::PerMachine;
    m.signing_key_id = "prod-key".into();
    m.signature_algorithm = "es256".into();
    m.signature = "sig".into();
    m
}

/// The defect: step 5 read the manifest's own declaration and nothing else, so any copied tree
/// carrying a manifest that said "PerMachine" cleared the check that exists to establish it was
/// per-machine. The manifest is the thing under suspicion; it cannot also be the witness.
#[test]
fn manifest_cannot_self_attest_a_per_machine_installation() {
    let m = per_machine_manifest();
    for observed in [
        InstallationIdentity::Unknown,
        InstallationIdentity::PortableOrCopied,
        InstallationIdentity::PerUser,
        InstallationIdentity::Development,
        InstallationIdentity::TestFixture,
        // "Looks like Program Files" is NOT corroboration — a copied tree satisfies it.
        InstallationIdentity::PerMachineUnverified,
    ] {
        let out = evaluate(
            &raw(&m),
            &prod_ctx_observing(Some(&FakeProdVerifier), observed),
            &FakeFs::with_runtime_and_artefact(),
        );
        assert_eq!(
            out.failure,
            Some(IdentityError::InstallationModelUncorroborated),
            "observed {observed:?} must not corroborate a per-machine claim"
        );
        assert_ne!(out.state, IdentityState::PackagedIdentityVerified);
    }
}

#[test]
fn corroborated_per_machine_installation_proceeds_past_step_five() {
    let m = per_machine_manifest();
    for observed in [
        InstallationIdentity::PerMachineEvidenceMatched,
        InstallationIdentity::PerMachineVerified,
    ] {
        let out = evaluate(
            &raw(&m),
            &prod_ctx_observing(Some(&FakeProdVerifier), observed),
            &FakeFs::with_runtime_and_artefact(),
        );
        // It gets past corroboration; whatever it fails on afterwards, it is not this.
        assert_ne!(
            out.failure,
            Some(IdentityError::InstallationModelUncorroborated),
            "observed {observed:?} corroborates per-machine"
        );
    }
}

/// Corroboration must never RESCUE a model that can never anchor production — the two checks are
/// independent, and the weaker declaration still loses.
#[test]
fn a_corroborated_observation_does_not_rescue_an_unsafe_declared_model() {
    for declared in [InstallationModel::PerUser, InstallationModel::Development] {
        let mut m = per_machine_manifest();
        m.installation_model = declared;
        let out = evaluate(
            &raw(&m),
            &prod_ctx_observing(
                Some(&FakeProdVerifier),
                InstallationIdentity::PerMachineVerified,
            ),
            &FakeFs::with_runtime_and_artefact(),
        );
        assert_eq!(out.failure, Some(IdentityError::InstallationModelUnsafe));
    }
}

/// Test policy is not production and must not acquire a new way to fail.
#[test]
fn corroboration_is_a_production_rule_only() {
    let mut m = base_manifest();
    m.installation_model = InstallationModel::PerUser;
    sign_test(&mut m);
    let ctx = EvalContext {
        policy: Policy::Test,
        payload_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: Some(&DeterministicTestVerifier),
        observed_installation: InstallationIdentity::PortableOrCopied,
    };
    let out = evaluate(&raw(&m), &ctx, &FakeFs::with_runtime_and_artefact());
    assert_eq!(out.state, IdentityState::TestIdentityVerified);
}

// ---- closed artefact format ---------------------------------------------------------------------

/// The format was a free `String` checked against ONE denylist entry, so any format nobody thought
/// to forbid was accepted as production identity by default. It is now an enum: an unrecognised
/// value cannot be represented and dies at PARSE, before any trust decision is reached.
#[test]
fn an_unrecognised_artefact_format_fails_to_parse() {
    for bogus in [
        "\"loose-modules-v2\"",
        "\"single-bundle-ish\"",
        "\"\"",
        "\"LooseModules\"",
        "null",
        "1",
    ] {
        let mut m = per_machine_manifest();
        m.daemon_artefact.format = DaemonArtefactFormat::SingleBundle;
        let text = String::from_utf8(raw(&m)).unwrap();
        let tampered = text.replace("\"single-bundle\"", bogus);
        assert_ne!(
            tampered, text,
            "the fixture must actually contain the format"
        );
        let out = evaluate(
            tampered.as_bytes(),
            &prod_ctx_observing(
                Some(&FakeProdVerifier),
                InstallationIdentity::PerMachineEvidenceMatched,
            ),
            &FakeFs::with_runtime_and_artefact(),
        );
        assert_eq!(
            out.failure,
            Some(IdentityError::ManifestMalformed),
            "format {bogus} must not parse"
        );
    }
}

#[test]
fn only_a_single_bundle_may_anchor_production() {
    assert!(DaemonArtefactFormat::SingleBundle.can_anchor_production());
    assert!(!DaemonArtefactFormat::LooseModules.can_anchor_production());
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE GATEKEEPER EXECUTION CLOSURE — RUN-TO-COMPLETION HOST ATTESTATION.
//
// These prove the SECOND witness. The first — the committed-bytes reader that pulls the broker out
// of the installation's git object store and executes exactly what it read — is untouched and stays
// exactly as it was; nothing here replaces it, and nothing here would work if it were removed. What
// is added is the question git cannot answer: were the committed bytes the ones an owner approved?
// ═════════════════════════════════════════════════════════════════════════════════════════════════

use super::manifest::{
    CommittedArtefactManifest, ExecutionClosureManifest, EXECUTION_CLOSURE_MANIFEST_VERSION,
};
use super::{verify_execution_closure, CommittedClosureBytes};
use projectos_packaged_runtime_contract as contract;

/// Boxed mutations, aliased so the tables below stay readable and clippy stays quiet about the
/// type. Each table exists because the SAME proof must hold for all three closure artefacts, and
/// writing it out three times is how one of them silently stops being checked.
type ClosureDigestMutation = Box<dyn Fn(&mut ExecutionClosureManifest, String)>;
type ClosureMutation = Box<dyn Fn(&mut ExecutionClosureManifest)>;
type ManifestMutation = Box<dyn Fn(&mut TrustManifest)>;

const BROKER_BYTES: &[u8] = b"fake-committed-gatekeeper-transport-broker-source";
const ALLOWLIST_BYTES: &[u8] = b"fake-committed-installation-project-allowlist";
const ADAPTER_BYTES: &[u8] = b"fake-committed-windows-credential-store-adapter";

fn committed(path: &str, bytes: &[u8]) -> CommittedArtefactManifest {
    CommittedArtefactManifest {
        repository_relative_path: path.to_string(),
        sha256: sha256_hex(bytes),
    }
}

/// A closure that matches the fixture bytes exactly.
fn honest_closure() -> ExecutionClosureManifest {
    ExecutionClosureManifest {
        gatekeeper_broker: committed(contract::BROKER_REPOSITORY_RELATIVE_PATH, BROKER_BYTES),
        installation_project_allowlist: committed(
            contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
            ALLOWLIST_BYTES,
        ),
        credential_adapter: committed(
            contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
            ADAPTER_BYTES,
        ),
    }
}

/// A version 2 manifest carrying an honest closure, SIGNED by the deterministic test signer.
///
/// Signed by default because `verify_execution_closure` now establishes the owner signature over the
/// whole subject before it compares a single digest — an unsigned fixture would fail every closure
/// proof for the wrong reason and hide whatever the proof was actually about.
fn v2_manifest() -> TrustManifest {
    let mut m = unsigned_v2_manifest();
    sign_test(&mut m);
    m
}

/// The same manifest with its signature deliberately absent.
fn unsigned_v2_manifest() -> TrustManifest {
    let mut m = base_manifest();
    m.manifest_version = EXECUTION_CLOSURE_MANIFEST_VERSION;
    m.execution_closure = Some(honest_closure());
    m
}

/// Re-sign after a mutation, so a closure proof fails on the thing it is testing rather than on the
/// signature that mutation invalidated.
fn resigned(mut m: TrustManifest) -> TrustManifest {
    m.signature = String::new();
    sign_test(&mut m);
    m
}

/// The closure check under TEST policy with the deterministic test signer.
fn closure_verdict(
    m: &TrustManifest,
    committed: &CommittedClosureBytes<'_>,
) -> Result<(), IdentityError> {
    verify_execution_closure(m, Policy::Test, &DeterministicTestVerifier, committed)
}

/// The committed bytes as a caller would have read them from the object store.
fn all_committed() -> CommittedClosureBytes<'static> {
    CommittedClosureBytes {
        gatekeeper_broker: Some(BROKER_BYTES),
        installation_project_allowlist: Some(ALLOWLIST_BYTES),
        credential_adapter: Some(ADAPTER_BYTES),
    }
}

#[test]
fn the_honest_closure_is_trusted() {
    assert_eq!(closure_verdict(&v2_manifest(), &all_committed()), Ok(()));
}

/// (1)(4)(7) THE COMMITTED BYTES CHANGED. Someone edited and committed a new broker, allowlist or
/// adapter; git is perfectly happy — it is committed and it is clean — and the owner never approved
/// it. This is the case the second witness exists for, so it is tested for each artefact separately.
#[test]
fn a_modified_committed_artefact_is_refused() {
    let m = v2_manifest();
    let cases: [(CommittedClosureBytes<'static>, IdentityError); 3] = [
        (
            CommittedClosureBytes {
                gatekeeper_broker: Some(b"tampered"),
                ..all_committed()
            },
            IdentityError::BrokerArtefactHashMismatch,
        ),
        (
            CommittedClosureBytes {
                installation_project_allowlist: Some(b"tampered"),
                ..all_committed()
            },
            IdentityError::InstallationAllowlistHashMismatch,
        ),
        (
            CommittedClosureBytes {
                credential_adapter: Some(b"tampered"),
                ..all_committed()
            },
            IdentityError::CredentialAdapterHashMismatch,
        ),
    ];
    for (bytes, expected) in cases {
        assert_eq!(closure_verdict(&m, &bytes), Err(expected));
    }
}

/// (2)(5)(8) THE BYTES COULD NOT BE ESTABLISHED. Not a repository, no git, uncommitted, dirty tree —
/// every one of those arrives here as `None`, and "I could not ask" must never read as "it is fine".
/// Each artefact reports its own absence, so an operator is not sent to look at the wrong file.
#[test]
fn committed_bytes_that_could_not_be_established_are_refused() {
    let m = v2_manifest();
    let cases: [(CommittedClosureBytes<'static>, IdentityError); 3] = [
        (
            CommittedClosureBytes {
                gatekeeper_broker: None,
                ..all_committed()
            },
            IdentityError::BrokerArtefactNotReadable,
        ),
        (
            CommittedClosureBytes {
                installation_project_allowlist: None,
                ..all_committed()
            },
            IdentityError::InstallationAllowlistNotReadable,
        ),
        (
            CommittedClosureBytes {
                credential_adapter: None,
                ..all_committed()
            },
            IdentityError::CredentialAdapterNotReadable,
        ),
    ];
    for (bytes, expected) in cases {
        assert_eq!(closure_verdict(&m, &bytes), Err(expected));
    }
}

/// (3)(6)(9) THE MANIFEST'S DIGEST IS WRONG. The mirror image of the case above: the committed bytes
/// are the real ones and the manifest attests something else. It must fail from this side too —
/// otherwise the check would only ever be as good as whoever generated the manifest.
#[test]
fn a_manifest_digest_that_does_not_match_the_committed_bytes_is_refused() {
    let wrong = "0".repeat(64);
    let mutations: [(ClosureDigestMutation, IdentityError); 3] = [
        (
            Box::new(|c, d| c.gatekeeper_broker.sha256 = d),
            IdentityError::BrokerArtefactHashMismatch,
        ),
        (
            Box::new(|c, d| c.installation_project_allowlist.sha256 = d),
            IdentityError::InstallationAllowlistHashMismatch,
        ),
        (
            Box::new(|c, d| c.credential_adapter.sha256 = d),
            IdentityError::CredentialAdapterHashMismatch,
        ),
    ];
    for (mutate, expected) in mutations {
        let mut m = v2_manifest();
        mutate(m.execution_closure.as_mut().unwrap(), wrong.clone());
        // Re-signed, so the refusal below is the digest check rather than the signature the
        // mutation just invalidated.
        let m = resigned(m);
        assert_eq!(closure_verdict(&m, &all_committed()), Err(expected));
    }
}

/// (10) PATH SUBSTITUTION. A manifest that attests three harmless files would satisfy every digest
/// check while the real broker, allowlist and adapter went entirely unbound. The expected paths come
/// from the packaging contract, never from the manifest under test and never from a caller — so
/// naming a different file is refused before any digest is even computed.
#[test]
fn a_manifest_naming_a_different_file_is_refused_before_any_digest_is_checked() {
    let mutations: [(ClosureMutation, IdentityError); 3] = [
        (
            Box::new(|c| c.gatekeeper_broker.repository_relative_path = "docs/harmless.md".into()),
            IdentityError::BrokerArtefactPathMismatch,
        ),
        (
            Box::new(|c| {
                c.installation_project_allowlist.repository_relative_path =
                    "docs/harmless.md".into()
            }),
            IdentityError::InstallationAllowlistPathMismatch,
        ),
        (
            Box::new(|c| c.credential_adapter.repository_relative_path = "docs/harmless.md".into()),
            IdentityError::CredentialAdapterPathMismatch,
        ),
    ];
    for (mutate, expected) in mutations {
        let mut m = v2_manifest();
        mutate(m.execution_closure.as_mut().unwrap());
        // Re-signed, and the digests still match the real bytes, so ONLY the path check can be
        // refusing here.
        let m = resigned(m);
        assert_eq!(closure_verdict(&m, &all_committed()), Err(expected));
    }
}

/// A Windows-style spelling of the right file is still the wrong pathspec.
///
/// The path is handed to `git show HEAD:./<rel>`, which does not accept backslashes as separators,
/// so accepting this here would attest a path the run-time reader can never resolve.
#[test]
fn a_backslash_spelling_of_the_declared_path_is_refused() {
    let mut m = v2_manifest();
    let backslashed = contract::BROKER_REPOSITORY_RELATIVE_PATH.replace('/', "\\");
    m.execution_closure
        .as_mut()
        .unwrap()
        .gatekeeper_broker
        .repository_relative_path = backslashed;
    let m = resigned(m);
    assert_eq!(
        closure_verdict(&m, &all_committed()),
        Err(IdentityError::BrokerArtefactPathMismatch)
    );
}

/// (11) A VERSION 1 MANIFEST CAN NEVER SATISFY THE CLOSURE. It is not broken and it is not being
/// called untrustworthy — it simply never signed these bytes, and no amount of them matching would
/// make its signature a statement about them.
#[test]
fn a_version_1_manifest_cannot_satisfy_the_execution_closure() {
    // GENUINELY SIGNED, so the refusal below is unambiguously about the VERSION rather than about a
    // missing signature. A perfectly valid, owner-signed v1 release still cannot authorise a
    // provider call, because its signature was never a statement about the broker.
    let mut m = base_manifest();
    sign_test(&mut m);
    assert_eq!(m.manifest_version, 1);
    assert!(!m.signature.is_empty());
    assert_eq!(
        closure_verdict(&m, &all_committed()),
        Err(IdentityError::ExecutionClosureManifestVersionTooLow)
    );
}

/// A version 2 manifest without a closure is refused, and refused by BOTH gates.
///
/// `check_versions` catches it at parse time, and `verify_execution_closure` catches it again on its
/// own — because a closure check whose safety depends on another function having been called first
/// is a closure check with a bypass.
#[test]
fn a_version_2_manifest_without_a_closure_is_refused_twice_over() {
    let mut m = v2_manifest();
    m.execution_closure = None;
    assert_eq!(
        m.check_versions(),
        Err(IdentityError::ExecutionClosureMissing)
    );
    assert_eq!(
        closure_verdict(&m, &all_committed()),
        Err(IdentityError::ExecutionClosureMissing)
    );
}

/// A version 1 manifest carrying closure fields is refused.
///
/// THIS DIRECTION MATTERS JUST AS MUCH. At version 1 the canonical bytes omit the field, so such a
/// document would carry closure digests that no signature covers — free for anyone to edit, and
/// indistinguishable to the eye from a real attestation. Refusing the SHAPE is what stops decoration
/// being mistaken for evidence.
#[test]
fn a_version_1_manifest_carrying_a_closure_is_refused() {
    let mut m = base_manifest();
    m.execution_closure = Some(honest_closure());
    assert_eq!(
        m.check_versions(),
        Err(IdentityError::ExecutionClosureUnexpected)
    );
}

/// V1 CANONICAL BYTES ARE UNCHANGED, so every signature ever made over a v1 manifest still verifies.
///
/// This is the whole reason the field is appended last and skipped when absent. If this fails, the
/// meaning of every existing signature has changed — which is a decision to make deliberately, not a
/// test to update.
#[test]
fn version_1_canonical_bytes_do_not_mention_the_execution_closure() {
    let canonical = canonical::canonical_bytes(&base_manifest());
    let text = String::from_utf8(canonical).expect("canonical bytes are JSON text");
    assert!(!text.contains("executionClosure"));
    assert!(text.ends_with("\"signingKeyId\":\"TEST-ONLY-key-1\"}"));
}

/// The v2 subject genuinely covers the closure, and covers every part of it.
///
/// Each mutation must move the bytes. A field that is in the struct but not in the canonical view
/// would be attested in appearance only, and every one of the digest tests above would still pass.
#[test]
fn every_closure_field_changes_the_canonical_signing_subject() {
    let base = canonical::canonical_bytes(&v2_manifest());
    assert_ne!(
        base,
        canonical::canonical_bytes(&base_manifest()),
        "a v2 subject must differ from the v1 subject"
    );

    let mutations: [ManifestMutation; 7] = [
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .gatekeeper_broker
                .sha256 = "1".repeat(64)
        }),
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .gatekeeper_broker
                .repository_relative_path = "other/path.cjs".into()
        }),
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .installation_project_allowlist
                .sha256 = "2".repeat(64)
        }),
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .installation_project_allowlist
                .repository_relative_path = "other/allow.json".into()
        }),
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .credential_adapter
                .sha256 = "3".repeat(64)
        }),
        Box::new(|m| {
            m.execution_closure
                .as_mut()
                .unwrap()
                .credential_adapter
                .repository_relative_path = "other/adapter.ps1".into()
        }),
        // The runtime is part of the same signed subject and must remain so.
        Box::new(|m| m.runtime.sha256 = "4".repeat(64)),
    ];
    for mutate in mutations {
        let mut m = v2_manifest();
        mutate(&mut m);
        assert_ne!(
            canonical::canonical_bytes(&m),
            base,
            "a change to signed closure material must change the signing subject"
        );
    }
}

/// Canonicalisation is deterministic: repeated generation over equal material is byte-identical, and
/// source formatting collapses away because the subject is built from the parsed struct.
#[test]
fn the_v2_canonical_subject_is_deterministic() {
    let a = canonical::canonical_bytes(&v2_manifest());
    let b = canonical::canonical_bytes(&v2_manifest());
    assert_eq!(a, b);

    // Same manifest, deliberately pretty-printed JSON: whitespace and layout must not survive into
    // the subject, or two honest builds of the same material would sign different bytes.
    let mut m = v2_manifest();
    m.signature = "ff".repeat(64);
    let pretty = serde_json::to_string_pretty(&m).expect("the manifest serialises");
    let reparsed = TrustManifest::parse(pretty.as_bytes()).expect("pretty JSON must parse");
    assert_eq!(canonical::canonical_bytes(&reparsed), a);
}

/// (12)(13) AN UNSIGNED V2 MANIFEST ESTABLISHES NOTHING, and a signature does not survive an edit to
/// the closure it covered. The second half is the point of putting the closure in the subject at
/// all: change the attested broker digest after signing and the signature stops verifying.
#[test]
fn a_v2_manifest_must_be_signed_and_its_signature_covers_the_closure() {
    let unsigned = unsigned_v2_manifest();
    let out = evaluate(
        &raw(&unsigned),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureRequired));

    let signed = v2_manifest();
    let ok = evaluate(
        &raw(&signed),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(
        ok.failure, None,
        "an honestly signed v2 manifest must verify"
    );
    assert_eq!(ok.state, IdentityState::TestIdentityVerified);

    // Now change the closure WITHOUT re-signing — exactly what an attacker who can edit the manifest
    // but not hold the key would do.
    let mut tampered = signed;
    tampered
        .execution_closure
        .as_mut()
        .unwrap()
        .gatekeeper_broker
        .sha256 = "9".repeat(64);
    let out = evaluate(
        &raw(&tampered),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureInvalid));
}

/// A v1 signature cannot be carried across onto v2 material.
///
/// Sign the v1 manifest, then present that signature on a manifest that claims v2 and attests a
/// closure. It must fail: the bytes signed were the v1 subject, and they said nothing about a broker.
#[test]
fn a_version_1_signature_cannot_validate_version_2_material() {
    let mut v1 = base_manifest();
    sign_test(&mut v1);

    let mut forged = v2_manifest();
    forged.signature = v1.signature.clone();
    let out = evaluate(
        &raw(&forged),
        &test_ctx(&DeterministicTestVerifier),
        &FakeFs::with_runtime_and_artefact(),
    );
    assert_eq!(out.failure, Some(IdentityError::ManifestSignatureInvalid));
}

/// (15) THE EXISTING DAEMON AND RUNTIME VERIFICATION IS UNCHANGED under a v2 manifest: the closure is
/// added ALONGSIDE those checks, never instead of them.
#[test]
fn v2_still_refuses_a_bad_runtime_and_a_bad_daemon() {
    let mutations: [(ManifestMutation, IdentityError); 2] = [
        (
            Box::new(|m| m.runtime.sha256 = "5".repeat(64)),
            IdentityError::RuntimeHashMismatch,
        ),
        (
            Box::new(|m| m.daemon_artefact.sha256 = "6".repeat(64)),
            IdentityError::DaemonArtefactHashMismatch,
        ),
    ];
    for (mutate, expected) in mutations {
        let mut m = v2_manifest();
        mutate(&mut m);
        sign_test(&mut m);
        let out = evaluate(
            &raw(&m),
            &test_ctx(&DeterministicTestVerifier),
            &FakeFs::with_runtime_and_artefact(),
        );
        assert_eq!(out.failure, Some(expected));
    }
}

/// A manifest version above the supported maximum still fails closed, so a future v3 cannot be
/// accepted by a build that does not understand what it signs.
#[test]
fn a_manifest_version_beyond_the_supported_maximum_is_refused() {
    let mut m = v2_manifest();
    m.manifest_version = EXECUTION_CLOSURE_MANIFEST_VERSION + 1;
    assert_eq!(
        m.check_versions(),
        Err(IdentityError::ManifestVersionUnsupported)
    );
}

/// THE CLOSURE CHECK ESTABLISHES THE OWNER SIGNATURE ITSELF — it does not trust a caller to have
/// done it first.
///
/// Raised by the security review, and it is the difference between a control and a convention. A
/// future integration that parsed a manifest and passed it straight to the closure check would,
/// without this, let anyone who can commit write a manifest whose digests match their own committed
/// bytes: every digest would agree and no signature would ever be consulted. Here the whole subject
/// is proven signed before a single digest is compared.
#[test]
fn an_unsigned_manifest_can_never_satisfy_the_execution_closure() {
    let unsigned = unsigned_v2_manifest();
    assert!(unsigned.signature.is_empty());
    assert_eq!(
        closure_verdict(&unsigned, &all_committed()),
        Err(IdentityError::ManifestSignatureRequired),
        "the closure must refuse before it compares any digest"
    );
}

/// And a manifest whose closure was edited after signing is refused BY THE SIGNATURE, not merely by
/// the digest comparison — so the refusal holds even against an attacker who also controls the
/// committed bytes and could make the digests agree.
#[test]
fn a_closure_edited_after_signing_is_refused_by_the_signature() {
    let mut m = v2_manifest();
    // The attacker commits their own broker AND writes its real digest into the manifest.
    let theirs: &[u8] = b"a broker somebody else committed";
    m.execution_closure
        .as_mut()
        .unwrap()
        .gatekeeper_broker
        .sha256 = sha256_hex(theirs);
    let theirs_committed = CommittedClosureBytes {
        gatekeeper_broker: Some(theirs),
        ..all_committed()
    };
    // Every digest now agrees. Only the missing owner signature stands in the way — and it does.
    assert_eq!(
        closure_verdict(&m, &theirs_committed),
        Err(IdentityError::ManifestSignatureInvalid)
    );
}

/// Under PRODUCTION policy the deterministic TEST signer is refused, exactly as it is for identity
/// evaluation. A test key must never authorise a real provider call.
#[test]
fn a_test_signer_cannot_authorise_the_execution_closure_in_production() {
    let m = v2_manifest();
    assert_eq!(
        verify_execution_closure(
            &m,
            Policy::Production,
            &DeterministicTestVerifier,
            &all_committed()
        ),
        Err(IdentityError::TestSignerRejectedInProduction)
    );
}

/// Equivalent-looking spellings of the declared path are refused too.
///
/// The comparison is exact against a compile-time constant, so none of these can pass today. They
/// are pinned because a future "helpful" normalisation would silently widen what counts as the
/// attested file, and `./x` and `x//y` do not name the same object to git either.
#[test]
fn equivalent_looking_path_spellings_are_still_refused() {
    let declared = contract::BROKER_REPOSITORY_RELATIVE_PATH;
    for spelling in [
        format!("./{declared}"),
        format!("{declared}/"),
        declared.replace('/', "//"),
        format!("/{declared}"),
        format!(" {declared}"),
        declared.to_uppercase(),
    ] {
        let mut m = v2_manifest();
        m.execution_closure
            .as_mut()
            .unwrap()
            .gatekeeper_broker
            .repository_relative_path = spelling.clone();
        let m = resigned(m);
        assert_eq!(
            closure_verdict(&m, &all_committed()),
            Err(IdentityError::BrokerArtefactPathMismatch),
            "{spelling} must not be accepted as the declared path"
        );
    }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// RUN-TO-COMPLETION HOST ATTESTATION §10A — THE TRUSTED INSTALLATION PROGRAMME
//
// The selection rules are proven beside the parser they belong to. What is proven HERE is the one
// thing that needs the real signed-closure fixtures: THE ORDER. The owner's signature over the whole
// closure is established before a single allowlist byte is interpreted, and a closure that does not
// verify refuses without the allowlist ever being consulted — however perfect that allowlist is.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

use super::installation_programme::{
    attest_under_policy, HostGovernedRoot, ProgrammeAttestationError,
};

/// A real allowlist document whose bytes the closure will attest.
const REAL_ALLOWLIST: &str = concat!(
    r#"{"projects":[{"projectId":"projectos","#,
    r#""repository":"github.com/universalbizcomply/ProjectOS","#,
    r#""governedRoot":"C:/dev/ProjectOS"}]}"#
);

/// A v2 manifest + committed bytes in which the allowlist artefact is the real document above.
fn programme_fixture() -> (TrustManifest, &'static [u8]) {
    let allowlist: &'static [u8] = REAL_ALLOWLIST.as_bytes();
    let mut m = base_manifest();
    m.manifest_version = EXECUTION_CLOSURE_MANIFEST_VERSION;
    m.execution_closure = Some(ExecutionClosureManifest {
        gatekeeper_broker: committed(contract::BROKER_REPOSITORY_RELATIVE_PATH, BROKER_BYTES),
        installation_project_allowlist: committed(
            contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
            allowlist,
        ),
        credential_adapter: committed(
            contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
            ADAPTER_BYTES,
        ),
    });
    sign_test(&mut m);
    (m, allowlist)
}

fn programme_committed(allowlist: &[u8]) -> CommittedClosureBytes<'_> {
    CommittedClosureBytes {
        gatekeeper_broker: Some(BROKER_BYTES),
        installation_project_allowlist: Some(allowlist),
        credential_adapter: Some(ADAPTER_BYTES),
    }
}

fn governed_root() -> HostGovernedRoot {
    HostGovernedRoot::from_installation_root(r"C:\dev\ProjectOS").expect("valid root")
}

/// THE POSITIVE CASE, through the identical verification order the production facade runs. Only the
/// policy and the verifier differ, and neither is reachable from outside this crate.
#[test]
fn a_signed_execution_closure_attests_this_installations_programme() {
    let (m, allowlist) = programme_fixture();
    let attested = attest_under_policy(
        &m,
        Policy::Test,
        &DeterministicTestVerifier,
        &programme_committed(allowlist),
        &governed_root(),
    )
    .expect("the closure verifies and the installation is listed");
    // Digests, not names — and the two fields are genuinely different values.
    assert_ne!(attested.project(), attested.repository());
}

/// THE ORDER. An UNSIGNED manifest refuses with a closure refusal even though the allowlist beneath
/// it is perfect — so no governance document is ever read on behalf of bytes nobody signed.
#[test]
fn an_unsigned_manifest_refuses_before_the_allowlist_is_read() {
    let (mut m, allowlist) = programme_fixture();
    m.signature = String::new();
    assert!(matches!(
        attest_under_policy(
            &m,
            Policy::Test,
            &DeterministicTestVerifier,
            &programme_committed(allowlist),
            &governed_root(),
        ),
        Err(ProgrammeAttestationError::ClosureRefused(_))
    ));
}

/// SUBSTITUTED ALLOWLIST BYTES ARE REFUSED BY THE CLOSURE, not by the parser. An attacker who can
/// write the working tree — or hand the Host any bytes at all — cannot introduce a programme, because
/// the bytes must first hash to what the owner signed.
#[test]
fn substituted_allowlist_bytes_never_reach_the_parser() {
    let (m, _) = programme_fixture();
    let hostile = br#"{"projects":[{"projectId":"attacker","repository":"r","governedRoot":"C:/dev/ProjectOS"}]}"#;
    assert!(matches!(
        attest_under_policy(
            &m,
            Policy::Test,
            &DeterministicTestVerifier,
            &programme_committed(hostile),
            &governed_root(),
        ),
        Err(ProgrammeAttestationError::ClosureRefused(
            IdentityError::InstallationAllowlistHashMismatch
        ))
    ));
}

/// A GENUINELY SIGNED CLOSURE STILL REFUSES AN INSTALLATION IT DOES NOT LIST. Provenance is not
/// relevance: the owner signing an allowlist says nothing about whether THIS root is in it.
#[test]
fn a_signed_closure_still_refuses_an_unlisted_installation() {
    let (m, allowlist) = programme_fixture();
    assert_eq!(
        attest_under_policy(
            &m,
            Policy::Test,
            &DeterministicTestVerifier,
            &programme_committed(allowlist),
            &HostGovernedRoot::from_installation_root(r"D:\elsewhere").expect("valid root"),
        ),
        Err(ProgrammeAttestationError::ProgrammeNotListed)
    );
}

/// A VERSION 1 MANIFEST CANNOT ATTEST A PROGRAMME. It signed no closure, so it can satisfy none.
#[test]
fn a_version_1_manifest_cannot_attest_a_programme() {
    let (_, allowlist) = programme_fixture();
    let mut m = base_manifest();
    m.execution_closure = None;
    sign_test(&mut m);
    assert!(matches!(
        attest_under_policy(
            &m,
            Policy::Test,
            &DeterministicTestVerifier,
            &programme_committed(allowlist),
            &governed_root(),
        ),
        Err(ProgrammeAttestationError::ClosureRefused(
            IdentityError::ExecutionClosureManifestVersionTooLow
        ))
    ));
}
