//! THE MANIFEST MUST DESCRIBE REAL BYTES — and these prove it against real bytes.
//!
//! The positive proofs assemble an actual payload: the SHA-256-pinned `node.exe` and the real
//! daemon bundle, in a temporary directory. Nothing here needs a signing key. The point is to
//! establish that the SUBJECT we will later ask an owner to sign is real, closed and reproducible,
//! before anybody signs anything.
//!
//! The negative proofs are the more important half. A generator that produces a manifest is easy;
//! what matters is everything it REFUSES to produce.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use projectos_host_identity::verify_against_embedded_anchor;
use projectos_host_identity::{
    canonical_bytes, evaluate_packaged_authority, sha256_hex, DaemonArtefactFormat, EvalContext,
    IdentityError, IdentityState, InstallationIdentity, InstallationModel, Policy,
    ProductionEs256Verifier, RealFs, TrustManifest,
};
use projectos_packaged_manifest_generator::{
    assemble::AssembleInputs, assemble_payload, closure::ClosureFinding,
    generate_unsigned_manifest, verify_closure, AssembleError, GeneratorError, ManifestInputs,
};
use projectos_packaged_runtime_contract as contract;

/// THE application id is the packaging contract's, not a value this test chooses.
const APP_ID: &str = contract::PACKAGED_APPLICATION_ID;
const APP_VERSION: &str = "0.1.0";
const BUILD_ID: &str = "build-fixture-1";
const KEY_ID: &str = "projectos-signing-unprovisioned";
const GENERATED_AT: &str = "2026-08-12T00:00:00.000Z";

// ---- fixtures ---------------------------------------------------------------------------------

fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("projectos-payload-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// The real pinned runtime on this build machine.
///
/// Deliberately taken from the packaging contract's recorded provenance rather than found on PATH:
/// searching for it would be the exact ambient resolution this increment exists to remove. If it is
/// absent the tests FAIL rather than skip — a proof that quietly opts out is not a proof.
fn pinned_node() -> &'static Path {
    Path::new(contract::PACKAGED_NODE_PROVENANCE)
}

/// The real daemon bundle from `npm run build:daemon-bundle`, if it has been built.
fn real_daemon_bundle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../control-center/dist-daemon/projectos-daemon.mjs")
}

/// A stand-in daemon bundle: real bytes, closed by construction. Used wherever the test is about the
/// manifest itself rather than about the real daemon, which has its own proofs below and is now
/// closed — this one keeps the manifest proofs independent of whether the bundle has been built.
const CLOSED_DAEMON: &[u8] =
    b"import { readFileSync } from \"node:fs\";\nexport const daemon = 1;\n";

/// ONE real payload per test binary. Assembling copies 91 MB, so it is done once and shared.
fn real_payload() -> &'static PathBuf {
    static PAYLOAD: OnceLock<PathBuf> = OnceLock::new();
    PAYLOAD.get_or_init(|| {
        let root = temp_root("real");
        let daemon = root.parent().unwrap().join("projectos-closed-daemon.mjs");
        std::fs::write(&daemon, CLOSED_DAEMON).unwrap();
        assemble_payload(&AssembleInputs {
            node_exe: pinned_node(),
            daemon_bundle: &daemon,
            payload_root: &root,
        })
        .unwrap_or_else(|e| {
            panic!(
                "cannot assemble a real payload from the pinned runtime at {}: {e:?}",
                contract::PACKAGED_NODE_PROVENANCE
            )
        });
        root
    })
}

/// Stand-in bytes for the three EXECUTION-CLOSURE artefacts.
///
/// Distinct on purpose: three files hashing to one digest would let a copy-paste in the generator
/// attest the same artefact three times while every assertion still passed.
const BROKER_SOURCE: &[u8] = b"// stand-in gatekeeper transport broker\n";
const ALLOWLIST_SOURCE: &[u8] = b"{\"projects\":[]}\n";
const ADAPTER_SOURCE: &[u8] = b"# stand-in windows credential store adapter\n";

fn closure_source(rel: &str) -> &'static [u8] {
    match rel {
        r if r == contract::BROKER_REPOSITORY_RELATIVE_PATH => BROKER_SOURCE,
        r if r == contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH => ALLOWLIST_SOURCE,
        _ => ADAPTER_SOURCE,
    }
}

/// A synthetic ProjectOS INSTALLATION root carrying the three committed execution-closure artefacts.
///
/// SYNTHETIC, NOT THE REAL REPOSITORY, so these proofs stay hermetic and can express the negative
/// cases — a missing broker, a directory where a file should be — without touching the real tree.
/// The real repository gets its own proof further down, where reproducibility against the actual
/// bytes is what is being established.
fn fake_install_root() -> &'static PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let root = temp_root("install");
        for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
            let path = root.join(Path::new(rel));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, closure_source(rel)).unwrap();
        }
        root
    })
}

/// An installation root that is missing, or has replaced, exactly one closure artefact.
fn install_root_without(name: &str, omit: &str, replace_with_dir: bool) -> PathBuf {
    let root = temp_root(name);
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        let path = root.join(Path::new(rel));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        if rel == omit {
            if replace_with_dir {
                std::fs::create_dir_all(&path).unwrap();
            }
            continue;
        }
        std::fs::write(&path, closure_source(rel)).unwrap();
    }
    root
}

fn inputs(root: &Path) -> ManifestInputs<'_> {
    ManifestInputs {
        payload_root: root,
        install_root: fake_install_root(),
        application_version: APP_VERSION,
        build_id: BUILD_ID,
        signing_key_id: KEY_ID,
        generated_at: GENERATED_AT,
        admitted_review_cost_micro_usd: 250_000,
        model_policy: "openai/gpt-5.6-terra",
        credential_ref: "PROJECTOS_GATEKEEPER_OPENAI_KEY",
    }
}

/// A payload whose runtime is NOT the pinned one, for tests about everything except the pin.
fn unpinned_payload(name: &str) -> PathBuf {
    let root = temp_root(name);
    let runtime = root.join(Path::new(contract::RUNTIME_RELATIVE_PATH));
    let daemon = root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    std::fs::create_dir_all(runtime.parent().unwrap()).unwrap();
    std::fs::create_dir_all(daemon.parent().unwrap()).unwrap();
    std::fs::write(&runtime, b"not-the-pinned-node").unwrap();
    std::fs::write(&daemon, CLOSED_DAEMON).unwrap();
    root
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let dst = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &dst);
        } else {
            std::fs::copy(entry.path(), &dst).unwrap();
        }
    }
}

/// Strip Rust comments before a "this token must be absent" scan.
///
/// Without this the scan reads the prose ABOUT PATH resolution as evidence OF it, and the test
/// either fails for the wrong reason or gets quietly weakened until it passes.
fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let bytes: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == '/' && bytes.get(i + 1) == Some(&'/') {
            while i < bytes.len() && bytes[i] != '\n' {
                i += 1;
            }
        } else if bytes[i] == '/' && bytes.get(i + 1) == Some(&'*') {
            i += 2;
            while i < bytes.len() && !(bytes[i] == '*' && bytes.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 2;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

fn library_sources() -> Vec<(&'static str, String)> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    ["assemble.rs", "closure.rs", "manifest.rs", "lib.rs"]
        .into_iter()
        .map(|f| {
            (
                f,
                strip_comments(&std::fs::read_to_string(src.join(f)).unwrap()),
            )
        })
        .collect()
}

// ================================================================================================
// §8 NEGATIVE PROOF
// ================================================================================================

/// [§8.1a] The packaged runtime cannot be satisfied by an ambient PATH `node`.
///
/// The premise is asserted, not assumed: this machine really does resolve `node` on PATH. With that
/// established, a payload that lacks the runtime is still refused — the ambient interpreter on PATH
/// does nothing at all for the packaged contract.
#[test]
fn an_ambient_path_node_cannot_satisfy_the_packaged_runtime() {
    let on_path = std::process::Command::new("node").arg("--version").output();
    assert!(
        on_path.map(|o| o.status.success()).unwrap_or(false),
        "premise failed: this test only means something when `node` IS resolvable on PATH"
    );

    let root = temp_root("path-cannot-substitute");
    let daemon = root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    std::fs::create_dir_all(daemon.parent().unwrap()).unwrap();
    std::fs::write(&daemon, CLOSED_DAEMON).unwrap();
    // No runtime in the payload — and PATH is not consulted to make up the difference.
    assert!(matches!(
        generate_unsigned_manifest(&inputs(&root)),
        Err(GeneratorError::RuntimeMissing(_))
    ));
}

/// [§8.1b] The structural half: the packaging library reads no environment variable and launches no
/// process, so there is no code path along which PATH could be consulted.
#[test]
fn the_packaging_library_has_no_environment_or_process_lookup() {
    for (file, src) in library_sources() {
        for forbidden in ["env::var", "env!(", "option_env!", "Command::new"] {
            assert!(
                !src.contains(forbidden),
                "{file} must not contain {forbidden}: a packaged runtime is bound by the contract, \
                 never discovered from the environment"
            );
        }
    }
}

/// [§8.2a] A runtime that is not the pinned bytes is refused at assembly. This is what makes "pinned"
/// mean something rather than being a label beside a version number.
#[test]
fn a_runtime_that_is_not_the_pinned_bytes_is_refused() {
    let root = temp_root("wrong-runtime");
    let _ = std::fs::remove_dir_all(&root);
    let fake = std::env::temp_dir().join("projectos-not-node.exe");
    std::fs::write(&fake, vec![0u8; 1024]).unwrap();
    let daemon = std::env::temp_dir().join("projectos-daemon-for-wrong-runtime.mjs");
    std::fs::write(&daemon, CLOSED_DAEMON).unwrap();

    let err = assemble_payload(&AssembleInputs {
        node_exe: &fake,
        daemon_bundle: &daemon,
        payload_root: &root,
    })
    .unwrap_err();
    // Refused on size before 91 MB are hashed — the cheap check runs first by design.
    assert!(
        matches!(err, AssembleError::RuntimeSizeMismatch { .. }),
        "{err:?}"
    );
}

/// [§8.2b] And a payload carrying an unpinned runtime cannot be DESCRIBED either, even if some other
/// route assembled it. The generator refuses to attest a runtime nobody pinned.
#[test]
fn an_unpinned_runtime_cannot_be_described_by_a_manifest() {
    let root = unpinned_payload("unpinned-describe");
    assert!(matches!(
        generate_unsigned_manifest(&inputs(&root)),
        Err(GeneratorError::RuntimeNotPinned { .. })
    ));
}

/// [§8.2c] End to end: a manifest declaring a runtime version other than the packaged one does not
/// satisfy the application. The version the generator writes comes from the same contract constant
/// the Control Centre compiles in, so this can only fail if someone edits one of the two.
#[test]
fn a_manifest_declaring_another_runtime_version_is_refused_by_the_application() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();
    assert_eq!(
        g.manifest.runtime.expected_version,
        contract::PACKAGED_NODE_VERSION
    );

    let mut drifted = g.manifest.clone();
    drifted.runtime.expected_version = "22.11.0".into();
    let raw = serde_json::to_vec(&drifted).unwrap();

    let verifier = ProductionEs256Verifier::from_embedded();
    let outcome = *evaluate_packaged_authority(
        &raw,
        &EvalContext {
            policy: Policy::Production,
            payload_root: root,
            expected_application_id: APP_ID,
            expected_application_version: APP_VERSION,
            expected_architecture: contract::PACKAGED_ARCHITECTURE,
            expected_runtime_version: contract::PACKAGED_NODE_VERSION,
            verifier: Some(&verifier),
            observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
        },
        &RealFs,
    )
    .expect_err("a drifted runtime version must never mint packaged identity");
    assert_eq!(outcome.state, IdentityState::IdentityBlocked);
    assert_eq!(outcome.failure, Some(IdentityError::RuntimeVersionMismatch));
}

/// [§8.3] A runtime missing from the payload is detected at generation, not discovered at launch.
#[test]
fn a_missing_runtime_is_detected() {
    let root = temp_root("no-runtime");
    let daemon = root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    std::fs::create_dir_all(daemon.parent().unwrap()).unwrap();
    std::fs::write(&daemon, CLOSED_DAEMON).unwrap();
    assert!(matches!(
        generate_unsigned_manifest(&inputs(&root)),
        Err(GeneratorError::RuntimeMissing(_))
    ));
}

/// [§8.4] A DIRECTORY of loose modules cannot be presented as a single bundle — at assembly, and again
/// at generation. Hashing one file of a tree would attest to a fraction of what actually executes.
#[test]
fn a_loose_module_tree_cannot_be_presented_as_a_single_bundle() {
    // At assembly.
    let root = temp_root("loose-assemble");
    let _ = std::fs::remove_dir_all(&root);
    let loose = std::env::temp_dir().join("projectos-loose-daemon");
    std::fs::create_dir_all(&loose).unwrap();
    std::fs::write(loose.join("index.mjs"), b"loose").unwrap();
    assert!(matches!(
        assemble_payload(&AssembleInputs {
            node_exe: pinned_node(),
            daemon_bundle: &loose,
            payload_root: &root,
        }),
        Err(AssembleError::DaemonBundleNotSingleFile(_))
    ));

    // And at generation, for a payload assembled some other way.
    let root2 = temp_root("loose-generate");
    let runtime = root2.join(Path::new(contract::RUNTIME_RELATIVE_PATH));
    std::fs::create_dir_all(runtime.parent().unwrap()).unwrap();
    std::fs::copy(pinned_node(), &runtime).unwrap();
    let dir = root2.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.mjs"), b"loose").unwrap();
    assert!(matches!(
        generate_unsigned_manifest(&inputs(&root2)),
        Err(GeneratorError::DaemonArtefactNotSingleFile(_))
    ));
}

/// [§8.5] One changed byte in the daemon bundle changes the recorded hash AND the bytes that get
/// signed — otherwise a signature would cover a bundle that could be swapped underneath it.
#[test]
fn one_mutated_payload_byte_changes_the_hash_and_the_signing_bytes() {
    let root = temp_root("mutation");
    copy_tree(real_payload(), &root);
    let before = generate_unsigned_manifest(&inputs(&root)).unwrap();

    let daemon = root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    let mut bytes = std::fs::read(&daemon).unwrap();
    bytes[0] ^= 0x01;
    std::fs::write(&daemon, &bytes).unwrap();

    let after = generate_unsigned_manifest(&inputs(&root)).unwrap();
    assert_ne!(
        before.manifest.daemon_artefact.sha256,
        after.manifest.daemon_artefact.sha256
    );
    assert_ne!(
        before.canonical_signing_bytes,
        after.canonical_signing_bytes
    );
}

/// [§8.6] The same payload generates byte-identical output. Without this a re-generated manifest would
/// need re-signing for no reason, and "deterministic" would be a claim rather than a property.
#[test]
fn the_same_payload_generates_byte_identical_output() {
    let root = real_payload();
    let a = generate_unsigned_manifest(&inputs(root)).unwrap();
    let b = generate_unsigned_manifest(&inputs(root)).unwrap();
    assert_eq!(a.canonical_signing_bytes, b.canonical_signing_bytes);
    assert_eq!(a.manifest_json, b.manifest_json);
}

/// [§8.7] Changing any signed field changes the canonical bytes.
#[test]
fn changing_a_signed_field_changes_the_canonical_bytes() {
    let g = generate_unsigned_manifest(&inputs(real_payload())).unwrap();

    let mut m = g.manifest.clone();
    m.application_version = "0.1.1".into();
    assert_ne!(canonical_bytes(&m), g.canonical_signing_bytes);

    let mut m2 = g.manifest.clone();
    m2.signing_key_id = "another-key".into();
    assert_ne!(canonical_bytes(&m2), g.canonical_signing_bytes);

    let mut m3 = g.manifest.clone();
    m3.daemon_artefact.sha256 = "0".repeat(64);
    assert_ne!(canonical_bytes(&m3), g.canonical_signing_bytes);
}

/// [§8.8] The signature is not part of what it covers. If it were, signing would invalidate its own
/// input and no signature could ever verify.
#[test]
fn the_signature_field_is_not_part_of_the_signing_bytes() {
    let g = generate_unsigned_manifest(&inputs(real_payload())).unwrap();
    let mut signed = g.manifest.clone();
    signed.signature = "deadbeef".repeat(16);
    assert_eq!(canonical_bytes(&signed), g.canonical_signing_bytes);
}

/// [§8.9] Alternative JSON layouts — different whitespace, and different KEY ORDER — cannot change the
/// canonical bytes. Canonicalisation parses into a typed struct first, so source formatting
/// collapses; a signature is therefore over content, never over a text layout.
#[test]
fn alternative_json_formatting_and_key_order_cannot_change_the_canonical_bytes() {
    let g = generate_unsigned_manifest(&inputs(real_payload())).unwrap();

    let compact = serde_json::to_string(&g.manifest).unwrap();
    assert_ne!(compact, g.manifest_json, "layouts must actually differ");
    let reparsed: TrustManifest = serde_json::from_str(&compact).unwrap();
    assert_eq!(canonical_bytes(&reparsed), g.canonical_signing_bytes);

    // The same manifest with its top-level keys emitted in a deliberately different order.
    let v: serde_json::Value = serde_json::from_str(&g.manifest_json).unwrap();
    let obj = v.as_object().unwrap();
    let mut keys: Vec<&String> = obj.keys().collect();
    keys.reverse();
    let reordered = format!(
        "{{{}}}",
        keys.iter()
            .map(|k| format!(
                "{}:{}",
                serde_json::to_string(k).unwrap(),
                serde_json::to_string(&obj[*k]).unwrap()
            ))
            .collect::<Vec<_>>()
            .join(",")
    );
    assert_ne!(reordered, compact, "key order must actually differ");
    let from_reordered: TrustManifest = serde_json::from_str(&reordered).unwrap();
    assert_eq!(
        canonical_bytes(&from_reordered),
        g.canonical_signing_bytes,
        "key order must not change what gets signed"
    );
}

/// THE test vector for the canonical signing bytes.
///
/// Everything else here compares canonical bytes against other canonical bytes, so a change to the
/// canonicalisation format would move both sides together and pass. This pins the format itself: a
/// fixed manifest, and the exact bytes an owner-held key would sign over it. Field order, compact
/// separators, the absent `signature` key and the enum spellings are all frozen here.
///
/// If this fails, the meaning of every signature ever produced has changed. That is not a test to
/// update — it is a decision to make deliberately.
#[test]
fn the_canonical_signing_bytes_match_the_frozen_test_vector() {
    use projectos_host_identity::{DaemonArtefactManifest, RuntimeManifest};

    let m = TrustManifest {
        schema_version: 1,
        manifest_version: 1,
        application_id: "app".into(),
        application_version: "1.2.3".into(),
        build_id: "b".into(),
        installation_model: InstallationModel::PerMachine,
        runtime: RuntimeManifest {
            relative_path: "runtime/node.exe".into(),
            sha256: "a".repeat(64),
            expected_version: "24.14.1".into(),
            platform: "windows".into(),
            architecture: "x86_64".into(),
        },
        daemon_artefact: DaemonArtefactManifest {
            relative_path: "daemon/projectos-daemon.mjs".into(),
            sha256: "b".repeat(64),
            format: DaemonArtefactFormat::SingleBundle,
            build_id: "b".into(),
        },
        generated_at: "2026-08-12T00:00:00.000Z".into(),
        minimum_protocol_version: 1,
        signature_algorithm: "es256".into(),
        signing_key_id: "k".into(),
        // THE VECTOR STAYS AT VERSION 1 WITH NO CLOSURE, and the bytes below are unchanged from
        // before the execution closure existed. That is the point: it proves the v1 subject was not
        // disturbed, so every signature already made over a v1 manifest still verifies and none of
        // them silently starts covering a closure it never signed.
        execution_closure: None,
        // Deliberately non-empty: the vector must prove the signature is EXCLUDED, not merely that
        // an empty string serialises to nothing much.
        signature: "ff".repeat(64),
    };

    const EXPECTED: &str = concat!(
        r#"{"schemaVersion":1,"manifestVersion":1,"applicationId":"app","applicationVersion":"1.2.3","#,
        r#""buildId":"b","installationModel":"PER_MACHINE","runtime":{"relativePath":"runtime/node.exe","#,
        r#""sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","#,
        r#""expectedVersion":"24.14.1","platform":"windows","architecture":"x86_64"},"#,
        r#""daemonArtefact":{"relativePath":"daemon/projectos-daemon.mjs","#,
        r#""sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","#,
        r#""format":"single-bundle","buildId":"b"},"generatedAt":"2026-08-12T00:00:00.000Z","#,
        r#""minimumProtocolVersion":1,"signatureAlgorithm":"es256","signingKeyId":"k"}"#,
    );

    assert_eq!(
        String::from_utf8(canonical_bytes(&m)).unwrap(),
        EXPECTED,
        "the canonical signing format changed"
    );
}

/// [§8.10 & 11] A caller cannot override a derived hash, and cannot override the runtime identity the
/// build already knows. `ManifestInputs` has no field for a digest, a runtime version, an
/// architecture, a platform or either payload path — so this is a compile-time property. What is
/// checked here is that the emitted values really are the derived ones rather than something echoed
/// from an input that happens to look right.
#[test]
fn derived_runtime_identity_and_hashes_cannot_be_supplied_by_a_caller() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();

    // Runtime identity comes from the packaging contract, verbatim.
    assert_eq!(
        g.manifest.runtime.expected_version,
        contract::PACKAGED_NODE_VERSION
    );
    assert_eq!(g.manifest.runtime.platform, contract::PACKAGED_PLATFORM);
    assert_eq!(
        g.manifest.runtime.architecture,
        contract::PACKAGED_ARCHITECTURE
    );
    assert_eq!(
        g.manifest.runtime.relative_path,
        contract::RUNTIME_RELATIVE_PATH
    );
    assert_eq!(
        g.manifest.daemon_artefact.relative_path,
        contract::DAEMON_RELATIVE_PATH
    );
    // The runtime digest is the pin, and the daemon digest is of the bytes on disk.
    assert_eq!(g.manifest.runtime.sha256, contract::PACKAGED_NODE_SHA256);
    assert_eq!(
        g.manifest.daemon_artefact.sha256,
        sha256_hex(&std::fs::read(root.join(Path::new(contract::DAEMON_RELATIVE_PATH))).unwrap())
    );
    // No caller-supplied string is being passed off as a digest.
    let i = inputs(root);
    for supplied in [
        i.application_version,
        i.build_id,
        i.signing_key_id,
        i.generated_at,
    ] {
        assert_ne!(supplied, g.manifest.runtime.sha256);
        assert_ne!(supplied, g.manifest.daemon_artefact.sha256);
    }
}

/// [§8.12] The manifest carries NO installation corroboration. It may DECLARE a model; it must not
/// carry the evidence that would confirm it, because the manifest is the thing under suspicion and
/// cannot also be the witness.
#[test]
fn the_manifest_carries_no_installation_corroboration() {
    let g = generate_unsigned_manifest(&inputs(real_payload())).unwrap();
    let json = g.manifest_json.to_lowercase();
    for forbidden in [
        "verifiedinstallation",
        "installertrusted",
        "observedpath",
        "installationverified",
        "observedinstallation",
        "installerevidence",
    ] {
        assert!(
            !json.contains(forbidden),
            "manifest must not carry {forbidden}"
        );
    }
    // It declares the model, and that is all.
    assert!(g.manifest_json.contains("installationModel"));
    assert_eq!(g.manifest.installation_model, InstallationModel::PerMachine);
}

/// [§8.13a] A source-tree dependency in an otherwise well-formed payload is detected.
#[test]
fn a_source_tree_dependency_in_the_payload_is_detected() {
    let root = temp_root("open-closure");
    copy_tree(real_payload(), &root);
    let daemon = root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    std::fs::write(
        &daemon,
        b"import { createRequire } from \"node:module\";\n\
          const require_ = createRequire(import.meta.url);\n\
          export const engine = require_(\"../../validators/plan-governance-engine.cjs\");\n",
    )
    .unwrap();

    let report = verify_closure(&root);
    assert!(!report.is_closed());
    assert!(
        report
            .findings
            .iter()
            .any(|f| matches!(f, ClosureFinding::SourceTreeEscape { .. })),
        "{:?}",
        report.findings
    );
}

/// [§8.13b] An unattested file cannot ride along in the payload. It would install present at run time,
/// covered by no digest and named by no signature.
#[test]
fn a_file_the_manifest_does_not_describe_is_reported() {
    let root = temp_root("stowaway");
    copy_tree(real_payload(), &root);
    std::fs::write(root.join("extra-tool.exe"), b"stowaway").unwrap();

    let report = verify_closure(&root);
    assert!(report.findings.iter().any(
        |f| matches!(f, ClosureFinding::UnattestedFile(p) if p == Path::new("extra-tool.exe"))
    ));
}

/// [§8.13c] THE REAL DAEMON IS CLOSED, measured rather than assumed.
///
/// This assertion used to run the other way. The real bundle resolved `../../validators/*.cjs` and
/// `../../schemas/*.json` at run time through `createRequire`, from inside linked dependencies as
/// well as from the entry file, and this test asserted the validator SAW that. The daemon has since
/// been closed — the engines are linked INTO the artefact rather than fetched from a checkout — so
/// the same measurement, against the same real bytes, now asserts the opposite.
///
/// Skipped only when the bundle has not been built, and it says so loudly rather than passing
/// quietly.
#[test]
fn the_real_daemon_bundle_is_closed() {
    let bundle = real_daemon_bundle();
    if !bundle.is_file() {
        eprintln!(
            "SKIPPED: real daemon bundle absent at {}. Run `npm run build:daemon-bundle` in \
             projectos/control-center to measure the real artefact.",
            bundle.display()
        );
        return;
    }
    let root = temp_root("real-daemon-closure");
    copy_tree(real_payload(), &root);
    std::fs::copy(
        &bundle,
        root.join(Path::new(contract::DAEMON_RELATIVE_PATH)),
    )
    .unwrap();

    let report = verify_closure(&root);
    assert!(
        report.is_closed(),
        "the real daemon bundle must not reach outside the payload: {:?}",
        report.findings
    );
}

/// [§8.13d] And the real bundle carries no development-tree reference at all.
///
/// A second, independent reading of the same artefact. Closure is a judgement assembled from rules,
/// and a rule can be wrong; this is the blunt version — the literal strings that used to be there,
/// absent. If the rules ever drift, these two disagree and someone has to look.
#[test]
fn the_real_daemon_bundle_carries_no_development_tree_reference() {
    let bundle = real_daemon_bundle();
    if !bundle.is_file() {
        eprintln!("SKIPPED: real daemon bundle absent at {}", bundle.display());
        return;
    }
    let text = std::fs::read_to_string(&bundle).expect("the bundle is text");
    for forbidden in [
        "../../validators",
        "../../schemas",
        "process.cwd()",
        "NODE_PATH",
        r"C:\dev",
        "bridge.config.json",
    ] {
        assert!(
            !text.contains(forbidden),
            "the packaged daemon must not contain {forbidden}"
        );
    }
}

/// [§8.14] An unsigned manifest cannot establish production identity.
///
/// Every OTHER reason to fail is deliberately removed first — real payload, matching application
/// id and version, matching architecture and runtime version, and an observed installation that
/// genuinely corroborates per-machine. What remains is the missing signature, and it is enough on
/// its own. No sealed identity is minted.
#[test]
fn an_unsigned_manifest_cannot_establish_production_identity() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();
    assert_eq!(g.manifest.signature, "", "the manifest must be unsigned");
    let raw = g.manifest_json.as_bytes();

    let verifier = ProductionEs256Verifier::from_embedded();
    let ctx = EvalContext {
        policy: Policy::Production,
        payload_root: root,
        expected_application_id: APP_ID,
        expected_application_version: APP_VERSION,
        expected_architecture: contract::PACKAGED_ARCHITECTURE,
        expected_runtime_version: contract::PACKAGED_NODE_VERSION,
        verifier: Some(&verifier),
        observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
    };

    // No sealed proof of packaged identity is produced, and the reason is the signature.
    let outcome = *evaluate_packaged_authority(raw, &ctx, &RealFs)
        .expect_err("an unsigned manifest must never mint packaged identity");
    assert_ne!(outcome.state, IdentityState::PackagedIdentityVerified);
    assert_eq!(
        outcome.failure,
        Some(IdentityError::ManifestSignatureRequired),
        "the ONLY remaining reason to refuse must be the absent signature"
    );
}

/// [§8.15] A manifest DECLARING PerMachine is refused when the independent observation does not
/// corroborate it — which is the state of a copied tree under a Program Files-looking path, and of
/// any installation whose installer evidence is missing.
///
/// The manifest is the thing under suspicion; it cannot also be the witness. Every other reason to
/// fail is removed, so what is being measured is the corroboration check alone.
#[test]
fn a_declared_per_machine_installation_is_refused_without_corroboration() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();
    assert_eq!(g.manifest.installation_model, InstallationModel::PerMachine);
    let raw = g.manifest_json.as_bytes();
    let verifier = ProductionEs256Verifier::from_embedded();

    // Everything a real machine can currently observe, none of which corroborates per-machine:
    // a copied tree, a per-user install, a Program Files path with no installer evidence, and the
    // "could not establish it at all" answer.
    for observed in [
        InstallationIdentity::PortableOrCopied,
        InstallationIdentity::PerUser,
        InstallationIdentity::PerMachineUnverified,
        InstallationIdentity::Unknown,
        InstallationIdentity::Development,
    ] {
        let ctx = EvalContext {
            policy: Policy::Production,
            payload_root: root,
            expected_application_id: APP_ID,
            expected_application_version: APP_VERSION,
            expected_architecture: contract::PACKAGED_ARCHITECTURE,
            expected_runtime_version: contract::PACKAGED_NODE_VERSION,
            verifier: Some(&verifier),
            observed_installation: observed,
        };
        let outcome = *evaluate_packaged_authority(raw, &ctx, &RealFs)
            .expect_err("an uncorroborated per-machine claim must never mint packaged identity");
        assert_eq!(
            outcome.failure,
            Some(IdentityError::InstallationModelUncorroborated),
            "observed {observed:?} must refuse for want of corroboration"
        );
    }
}

/// [§10.1] ...and a corroborated observation DOES progress past the installation-identity gate.
///
/// Without this the check above would be satisfied by a gate that refuses everything. The run still
/// ends in refusal — there is no signature and no anchor — but it gets PAST installation identity
/// and fails for the next reason instead, which is what "progressed past the gate" means.
#[test]
fn a_corroborated_per_machine_installation_progresses_past_the_installation_gate() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();
    let verifier = ProductionEs256Verifier::from_embedded();

    for observed in [
        InstallationIdentity::PerMachineEvidenceMatched,
        InstallationIdentity::PerMachineVerified,
    ] {
        let ctx = EvalContext {
            policy: Policy::Production,
            payload_root: root,
            expected_application_id: APP_ID,
            expected_application_version: APP_VERSION,
            expected_architecture: contract::PACKAGED_ARCHITECTURE,
            expected_runtime_version: contract::PACKAGED_NODE_VERSION,
            verifier: Some(&verifier),
            observed_installation: observed,
        };
        let outcome = *evaluate_packaged_authority(g.manifest_json.as_bytes(), &ctx, &RealFs)
            .expect_err("unsigned, so it still refuses — but not here");
        assert_eq!(
            outcome.failure,
            Some(IdentityError::ManifestSignatureRequired),
            "observed {observed:?} corroborates, so the refusal must come from the signature"
        );
    }
}

// ================================================================================================
// §9 POSITIVE PROOF — from a real assembled payload
// ================================================================================================

/// [§9.1-5] Generate from the real payload, then INDEPENDENTLY recompute both digests and prove the
/// manifest describes the bytes actually on disk.
#[test]
fn the_manifest_describes_the_real_payload_bytes() {
    let root = real_payload();
    let g = generate_unsigned_manifest(&inputs(root)).unwrap();

    let runtime_actual =
        sha256_hex(&std::fs::read(root.join(Path::new(contract::RUNTIME_RELATIVE_PATH))).unwrap());
    let daemon_actual =
        sha256_hex(&std::fs::read(root.join(Path::new(contract::DAEMON_RELATIVE_PATH))).unwrap());

    assert_eq!(g.manifest.runtime.sha256, runtime_actual);
    assert_eq!(g.manifest.daemon_artefact.sha256, daemon_actual);
    assert_eq!(
        g.manifest.daemon_artefact.format,
        DaemonArtefactFormat::SingleBundle
    );
    assert_eq!(g.manifest.signature, "");
    assert!(!g.canonical_signing_bytes.is_empty());

    // The canonical bytes really are the manifest minus its signature, and are valid JSON.
    let canonical: serde_json::Value =
        serde_json::from_slice(&g.canonical_signing_bytes).expect("canonical bytes are JSON");
    assert!(canonical.get("signature").is_none());
    assert_eq!(canonical["runtime"]["sha256"], runtime_actual);
}

/// [§9.6] Copying the payload elsewhere must not change the signing bytes: the manifest attests to
/// CONTENT, and install location is a runtime observation, not a signed fact. If this failed, a
/// signature would break merely by installing to a different directory.
#[test]
fn canonical_bytes_do_not_depend_on_where_the_payload_sits() {
    let a = real_payload();
    let b = temp_root("relocated");
    copy_tree(a, &b);
    assert_ne!(a, &b);

    let from_a = generate_unsigned_manifest(&inputs(a)).unwrap();
    let from_b = generate_unsigned_manifest(&inputs(&b)).unwrap();
    assert_eq!(
        from_a.canonical_signing_bytes,
        from_b.canonical_signing_bytes
    );
    assert_eq!(from_a.manifest_json, from_b.manifest_json);
}

/// [§9.7] A closed payload passes closure. Without this the validator could be vacuously strict — a
/// gate that refuses everything proves nothing about the things it lets through.
#[test]
fn a_closed_payload_passes_dependency_closure() {
    let root = temp_root("closed");
    copy_tree(real_payload(), &root);
    let report = verify_closure(&root);
    assert!(report.is_closed(), "{:?}", report.findings);
    assert_eq!(report.files.len(), 2, "runtime and daemon, nothing else");
}

/// The payload the assembler wrote really is the pinned runtime, byte for byte.
#[test]
fn the_assembled_runtime_is_the_pinned_runtime() {
    let root = real_payload();
    let written = std::fs::read(root.join(Path::new(contract::RUNTIME_RELATIVE_PATH))).unwrap();
    assert_eq!(written.len() as u64, contract::PACKAGED_NODE_BYTES);
    assert_eq!(sha256_hex(&written), contract::PACKAGED_NODE_SHA256);
}

/// Assembling into a directory that already has contents is refused: stale files would ship
/// unattested alongside the two the manifest describes.
#[test]
fn a_payload_root_that_is_not_empty_is_refused() {
    let root = temp_root("dirty-root");
    std::fs::write(root.join("leftover.txt"), b"from a previous build").unwrap();
    let daemon = std::env::temp_dir().join("projectos-daemon-for-dirty.mjs");
    std::fs::write(&daemon, CLOSED_DAEMON).unwrap();
    assert!(matches!(
        assemble_payload(&AssembleInputs {
            node_exe: pinned_node(),
            daemon_bundle: &daemon,
            payload_root: &root,
        }),
        Err(AssembleError::PayloadRootNotEmpty(_))
    ));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXECUTION CLOSURE — attested from the installation, never copied into the payload.
// RUN-TO-COMPLETION HOST ATTESTATION.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/// The generated manifest is version 2 and describes the REAL bytes of all three closure artefacts.
#[test]
fn the_manifest_attests_the_installations_execution_closure() {
    let generated = generate_unsigned_manifest(&inputs(real_payload())).expect("generation");
    assert_eq!(
        generated.manifest.manifest_version,
        projectos_host_identity::EXECUTION_CLOSURE_MANIFEST_VERSION
    );
    let closure = generated
        .manifest
        .execution_closure
        .as_ref()
        .expect("a version 2 manifest carries a closure");

    for (artefact, rel, bytes) in [
        (
            &closure.gatekeeper_broker,
            contract::BROKER_REPOSITORY_RELATIVE_PATH,
            BROKER_SOURCE,
        ),
        (
            &closure.installation_project_allowlist,
            contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
            ALLOWLIST_SOURCE,
        ),
        (
            &closure.credential_adapter,
            contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
            ADAPTER_SOURCE,
        ),
    ] {
        assert_eq!(artefact.repository_relative_path, rel);
        assert_eq!(
            artefact.sha256,
            sha256_hex(bytes),
            "{rel} must be described by the bytes actually on disk"
        );
    }
}

/// The declared paths are the CONTRACT'S spelling, not the host filesystem's.
///
/// They are handed to `git show HEAD:./<rel>` at run time and compared for equality by the verifier.
/// A Windows-separator spelling produced by joining and re-deriving would compare unequal and name
/// an object git cannot resolve — a refusal that would look like tampering.
#[test]
fn the_attested_paths_are_forward_slashed_contract_pathspecs() {
    let generated = generate_unsigned_manifest(&inputs(real_payload())).expect("generation");
    let closure = generated.manifest.execution_closure.as_ref().unwrap();
    for artefact in [
        &closure.gatekeeper_broker,
        &closure.installation_project_allowlist,
        &closure.credential_adapter,
    ] {
        assert!(
            !artefact.repository_relative_path.contains('\\'),
            "{} must stay a git pathspec",
            artefact.repository_relative_path
        );
        assert!(contract::EXECUTION_CLOSURE_REPOSITORY_PATHS
            .contains(&artefact.repository_relative_path.as_str()));
    }
}

/// A missing closure artefact is refused, and refused BY NAME.
///
/// A generator that shrugged and emitted a manifest without one would produce a release whose
/// signature covered two of the three inputs that decide whether the credential may be used.
#[test]
fn a_missing_execution_closure_artefact_is_refused() {
    for (i, rel) in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS
        .iter()
        .enumerate()
    {
        let root = install_root_without(&format!("missing-{i}"), rel, false);
        let mut ins = inputs(real_payload());
        ins.install_root = &root;
        assert_eq!(
            generate_unsigned_manifest(&ins).err(),
            Some(GeneratorError::ExecutionClosureArtefactMissing(rel)),
            "{rel} missing must be refused and named"
        );
    }
}

/// A DIRECTORY where a closure artefact should be is refused explicitly.
///
/// Refused as its own case rather than falling through to "missing", because the two have different
/// causes and different fixes — and because a directory has no committed bytes to hash at all.
#[test]
fn a_directory_in_place_of_an_execution_closure_artefact_is_refused() {
    for (i, rel) in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS
        .iter()
        .enumerate()
    {
        let root = install_root_without(&format!("dir-{i}"), rel, true);
        let mut ins = inputs(real_payload());
        ins.install_root = &root;
        assert_eq!(
            generate_unsigned_manifest(&ins).err(),
            Some(GeneratorError::ExecutionClosureArtefactNotSingleFile(rel)),
            "{rel} as a directory must be refused and named"
        );
    }
}

/// ATTESTING IS NOT PACKAGING, and the payload proves it.
///
/// Nothing is copied. After generation the payload still holds exactly the four files it always
/// held, and dependency closure still passes — so the manifest cannot be read as claiming the
/// installation carries files it does not.
#[test]
fn the_execution_closure_is_not_copied_into_the_payload() {
    let _ = generate_unsigned_manifest(&inputs(real_payload())).expect("generation");
    let report = verify_closure(real_payload());
    assert!(
        report.is_closed(),
        "attesting the closure must not add unattested payload files: {:?}",
        report.findings
    );
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        assert!(
            !real_payload().join(Path::new(rel)).exists(),
            "{rel} must NOT have been copied into the payload"
        );
    }
}

/// END TO END: WHAT THE GENERATOR EMITS IS UNSIGNED, AND THE VERIFIER SAYS SO.
///
/// This is the join between the two halves of the change, and the answer is a refusal — which is the
/// correct answer. `verify_execution_closure` establishes the owner signature over the whole subject
/// before it compares any digest, and this generator deliberately never signs. So a freshly
/// generated manifest cannot authorise a provider call no matter how perfectly its digests match:
/// only an owner signing ceremony can turn this candidate into something that verifies.
///
/// The digest agreement itself is proven separately, above, against the bytes on disk.
#[test]
fn a_generated_manifest_is_unsigned_and_therefore_cannot_authorise_a_provider_call() {
    use projectos_host_identity::{verify_execution_closure, CommittedClosureBytes};

    let generated = generate_unsigned_manifest(&inputs(real_payload())).expect("generation");
    assert!(
        generated.manifest.signature.is_empty(),
        "this generator must never emit a signature"
    );
    let honest = CommittedClosureBytes {
        gatekeeper_broker: Some(BROKER_SOURCE),
        installation_project_allowlist: Some(ALLOWLIST_SOURCE),
        credential_adapter: Some(ADAPTER_SOURCE),
    };
    assert_eq!(
        verify_execution_closure(
            &generated.manifest,
            Policy::Production,
            &ProductionEs256Verifier::from_embedded(),
            &honest
        ),
        Err(IdentityError::ManifestSignatureRequired),
        "an unsigned candidate must be refused before any digest is consulted"
    );
}

/// THE COMMITTED BLOB AND THE WORKING-TREE FILE ARE THE SAME BYTES for all three closure artefacts.
///
/// The generator hashes the working tree; the run-time reader hashes what `git show HEAD:./<rel>`
/// returns. Those are equal here only because the repository sets `core.autocrlf=false` and declares
/// no `.gitattributes` for these paths — an assumption the security review rightly refused to leave
/// unguarded. If someone ever adds an attribute that rewrites these files on checkout, the two
/// witnesses would disagree and every provider call would refuse for a reason nobody could
/// reproduce. This is the guard, and it runs git in the TEST rather than in the packaging library,
/// which must stay free of process lookup.
#[test]
fn the_committed_blob_matches_the_working_tree_for_every_closure_artefact() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .arg("cat-file")
            .arg("blob")
            .arg(format!("HEAD:{rel}"))
            .output()
            .unwrap_or_else(|e| {
                panic!("git must be available to prove blob parity for {rel}: {e}")
            });
        assert!(
            out.status.success(),
            "{rel} must be committed at HEAD: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let on_disk = std::fs::read(repo.join(Path::new(rel)))
            .unwrap_or_else(|e| panic!("{rel} must be readable: {e}"));
        assert_eq!(
            sha256_hex(&out.stdout),
            sha256_hex(&on_disk),
            "{rel}: the committed blob and the working-tree file must be the same bytes, or the              attested digest is not the digest the run-time reader will compute"
        );
    }
}

/// THE CONTRACT'S PATHS ARE REAL PATHS IN THIS REPOSITORY.
///
/// Every other proof here uses a synthetic installation, so all of them would keep passing if a
/// contract path drifted away from where the artefact actually lives — and the first sign of it
/// would be a packaging run that refused for a reason nobody could reproduce. This is the one check
/// that looks at the real tree.
#[test]
fn the_execution_closure_paths_name_real_files_in_this_repository() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for rel in contract::EXECUTION_CLOSURE_REPOSITORY_PATHS {
        let path = repo.join(Path::new(rel));
        assert!(
            path.is_file(),
            "the packaging contract names {rel}, which is not a file in this repository"
        );
    }
}

/// THE REAL, ALREADY-SIGNED VERSION 1 MANIFEST STILL CANONICALISES TO EXACTLY THE BYTES THAT WERE
/// SIGNED.
///
/// Every other compatibility proof here uses fixtures built by this test, so all of them would keep
/// passing if the v1 subject had shifted in a way only real material exposes. This one takes a real
/// version 1 document carrying a real owner signature, parses it with TODAY'S struct, and re-derives
/// the subject.
///
/// FROM A COMMITTED FIXTURE, NOT FROM `dist-payload`. It read the shipped payload directly at
/// first, and that was a proof that only worked here: `dist-payload/` is gitignored build output,
/// so on a fresh checkout the file is simply absent and the proof either fails for an unrelated
/// reason or gets quietly relaxed into skipping. The bytes are committed beside this test — the same
/// pattern the packaging contract uses for the upstream Node checksums — so the check runs OFFLINE
/// and FOREVER, on any machine, without a build.
///
/// The fixture carries no secret. A manifest is public build metadata and a detached signature is
/// verification data; neither is key material, and both ship inside the installer already.
///
/// If these ever differ, the owner's existing signature has stopped being a statement about the
/// bytes it was made over. That is not a test to update.
#[test]
fn the_shipped_version_1_manifest_still_produces_its_original_signing_bytes() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let raw = std::fs::read(fixtures.join("shipped-v1-trust-manifest.json"))
        .expect("the committed v1 manifest fixture must be readable");
    let original = std::fs::read(fixtures.join("shipped-v1-trust-manifest.canonical"))
        .expect("the committed v1 canonical fixture must be readable");

    let m = TrustManifest::parse(&raw).expect("the shipped manifest must still parse");
    assert_eq!(m.manifest_version, 1, "the fixture is a version 1 manifest");
    assert!(
        m.execution_closure.is_none(),
        "a version 1 manifest must carry no closure"
    );

    let derived = canonical_bytes(&m);

    // THE SIGNATURE IS THE ANCHOR, not the second fixture file.
    //
    // Comparing the derived bytes only against a committed `.canonical` file would have proved
    // nothing an attacker or a bad merge could not also satisfy: edit that file, or change
    // `canonical_bytes` and regenerate it, and the comparison keeps passing while the meaning of
    // every existing signature has quietly moved. That is the exact regression this proof exists to
    // catch, and it was the one place in this change not applying the standard the rest of it is
    // built on. So the derived bytes are put to the owner's REAL detached signature, against the
    // embedded production anchor — the one thing in this file nobody can forge.
    assert!(
        verify_against_embedded_anchor(
            &derived,
            &m.signature_algorithm,
            &m.signing_key_id,
            &m.signature
        ),
        "the owner's existing v1 signature no longer verifies over the bytes today's \
         `canonical_bytes` derives — the meaning of every signature ever produced has changed. \
         That is a decision to make deliberately, not a test to update."
    );

    // AND THE ANCHOR ACTUALLY DISCRIMINATES. A verifier that returned true for everything would
    // make the assertion above pass forever and prove nothing at all — the same vacuity the fixture
    // comparison had. One flipped byte must be refused.
    let mut tampered = derived.clone();
    tampered[0] ^= 0x01;
    assert!(
        !verify_against_embedded_anchor(
            &tampered,
            &m.signature_algorithm,
            &m.signing_key_id,
            &m.signature
        ),
        "the embedded anchor accepted bytes the owner never signed"
    );

    // And the committed canonical fixture must still be those same bytes. Kept as a SECOND check,
    // not the primary one: if that file were ever corrupted the signature check above still holds,
    // so this failing points at the fixture rather than at the canonicalisation.
    assert_eq!(
        derived, original,
        "the committed canonical fixture is no longer the derived v1 subject"
    );
}
