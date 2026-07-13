//! Tests for PACKAGED-SIDECAR-IDENTITY1A. They prove PATH and loose-module identity are rejected,
//! production fails closed without an authentic signature, dev/env/CLI/cwd can never select
//! production, and no capability is minted. All filesystem access is a deterministic FakeFs — no
//! real disk, no PATH, no node execution.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::errors::IdentityError;
use super::hash::sha256_hex;
use super::manifest::{DaemonArtefactManifest, RuntimeManifest, TrustManifest};
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
            format: "single-bundle".into(),
            build_id: "build-123".into(),
        },
        generated_at: "1970-01-01T00:00:00.000Z".into(),
        minimum_protocol_version: 1,
        signature_algorithm: TEST_ALGORITHM.into(),
        signing_key_id: TEST_KEY.into(),
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
        install_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: Some(v),
    }
}

fn prod_ctx<'a>(v: Option<&'a dyn TrustManifestSignatureVerifier>) -> EvalContext<'a> {
    EvalContext {
        policy: Policy::Production,
        install_root: Box::leak(Box::new(root())).as_path(),
        expected_application_id: APP_ID,
        expected_application_version: APP_VER,
        expected_architecture: ARCH,
        expected_runtime_version: RT_VER,
        verifier: v,
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
    m.daemon_artefact.format = "loose-modules".into();
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
