//! THE INSTALLER-OWNED EVIDENCE, proven against the record the MSI actually ships.
//!
//! These read the SAME `application.v1.json` bytes the installer packages — not a hand-made
//! fixture — and drive them through the real reader, the real classifier and the real sealed
//! governed-root boundary. Nothing is installed: the record is read from the build output, and the
//! installation it describes is presented to the reader as an observation rather than created.
//!
//! WHAT THIS CANNOT PROVE, and does not claim to: that Windows Installer really places the file at
//! the canonical ProgramData path. That is an installation, which is owner-gated. It is proven
//! instead from the MSI database — the Directory, File and RemoveFile tables — and recorded in
//! packaging/INSTALLER-EFFECT-MANIFEST.txt.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (MSI installation record writer).

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::{Path, PathBuf};

use projectos_packaged_runtime_contract as contract;
use projectos_shared_host_runtime::identity::packaged::{
    classify_installation, compute_application_record_digest, verify_application_record,
    verify_application_record_bytes, ApplicationRecordError, InstallationEvidence,
    InstallationIdentity, InstalledApplicationRecordV1, PER_MACHINE_SCOPE,
};

/// The Control Centre package directory, without a `..` component.
fn control_center() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

/// The record the MSI installs, as produced by `npm run release:payload`.
fn shipped_record_path() -> PathBuf {
    control_center()
        .join("dist-installer")
        .join("application.v1.json")
}

fn shipped_record_bytes() -> Option<Vec<u8>> {
    std::fs::read(shipped_record_path()).ok()
}

/// The install root the shipped record describes — the MSI's default INSTALLDIR.
fn declared_install_root(raw: &[u8]) -> PathBuf {
    let record: InstalledApplicationRecordV1 =
        serde_json::from_slice(raw).expect("the shipped record parses");
    PathBuf::from(record.install_root)
}

/// Skip a proof whose build output is absent — or REFUSE TO SKIP, when the caller says these proofs
/// are the point of the run.
///
/// WHY THIS IS NOT JUST AN `eprintln!`. `dist-payload/` is build output and is gitignored, so on a
/// fresh clone or a CI runner that has not run `npm run release:payload` and the signing ceremony,
/// every test in this file returns early and the suite reports "ok". A green suite would then be
/// entirely compatible with the production trust chain never having been exercised once — the
/// strongest claims in this file, silently proving nothing. A skipped proof protects nothing.
///
/// Setting `PROJECTOS_REQUIRE_SIGNED_PAYLOAD=1` turns every skip into a failure, so a release gate
/// can demand that these proofs actually ran. It is opt-in because a developer working on unrelated
/// code should not be forced to perform a signing ceremony to run the test suite.
fn skip(reason: &str) {
    let required = std::env::var("PROJECTOS_REQUIRE_SIGNED_PAYLOAD")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    assert!(
        !required,
        "PROJECTOS_REQUIRE_SIGNED_PAYLOAD is set, so this proof may not be skipped: {reason}. \
         Run `npm run release:payload` with the release signing inputs first.",
    );
    eprintln!("SKIPPED: {reason}. Run `npm run release:payload` in projectos/control-center.");
}

// ================================================================================================
// POSITIVE PROOF
// ================================================================================================

/// [§12.7, §12.8, §12.9] The SHIPPED record verifies, corroborates a per-machine installation, and
/// names the governed ProjectOS system root.
///
/// The whole chain, on the real bytes: reader → evidence → existing classifier → the governed root.
#[test]
fn the_shipped_record_corroborates_per_machine_and_names_the_governed_root() {
    let Some(raw) = shipped_record_bytes() else {
        return skip("the shipped installation record is absent");
    };
    let install_root = declared_install_root(&raw);

    // 1. The real reader accepts it, against the installation it describes.
    let verified = verify_application_record_bytes(
        &raw,
        contract::PACKAGED_APPLICATION_ID,
        env!("CARGO_PKG_VERSION"),
        &install_root,
    )
    .expect("the shipped record must verify against the installation it describes");

    // 2. It names a governed system root, and that root is NOT inside the installation.
    let governed = verified.governed_system_root();
    assert!(governed.is_absolute());
    assert!(
        !governed.starts_with(&install_root),
        "the governed system root must be independent of the installation"
    );

    // 3. Verified evidence, fed to the EXISTING classifier, corroborates per-machine — and only
    //    because the evidence is Matched.
    use projectos_shared_host_runtime::identity::packaged_fixture::{
        classify_path, KnownRoots, ReparseState,
    };
    let roots = KnownRoots::for_test(vec![r"C:\Program Files"], vec![r"C:\Users\x\AppData"]);
    let exe = format!("{}\\projectos-control-center.exe", install_root.display()).to_lowercase();
    assert_eq!(
        classify_path(
            &exe.replace('/', "\\"),
            ReparseState::None,
            InstallationEvidence::Matched,
            &roots
        ),
        InstallationIdentity::PerMachineEvidenceMatched
    );
}

/// [PRODUCTION MANIFEST TRUST2A] THE WHOLE CHAIN, through real components, end to end.
///
/// REPLACES `with_installer_evidence_the_remaining_refusal_is_the_absent_signature`. That test
/// asserted the remaining blocker was the missing owner signature — true right up until the owner
/// signed. It did not stop being meaningful; it was overtaken by the event it was waiting for, and
/// it failed loudly the moment the signature arrived, which is what a fail-closed assertion is
/// supposed to do. What it proved — that installation evidence is no longer the blocker — is now
/// proved more strongly: the evaluation SUCCEEDS.
///
/// NOTHING HERE IS A FIXTURE. The manifest is the one the owner actually signed, read from the
/// payload the installer packages. The verifier is `from_embedded()` — the shipping verifier bound
/// to the anchor compiled into this build, not a test verifier and not a caller-supplied key. The
/// policy is Production. A successful return is a `VerifiedPackagedIdentity`, which is sealed and
/// has no public constructor, so holding one IS the proof that evaluation succeeded.
#[test]
fn the_owner_signed_manifest_mints_verified_packaged_identity() {
    use projectos_shared_host_runtime::identity::packaged::{
        evaluate_packaged_authority, EvalContext, InstallationModel, Policy,
        ProductionEs256Verifier, RealFs,
    };

    let payload = control_center().join("dist-payload");
    let Ok(raw_manifest) = std::fs::read(payload.join(contract::TRUST_MANIFEST_FILENAME)) else {
        return skip("the generated trust manifest is absent");
    };
    // Only meaningful against a SIGNED manifest. A developer payload is unsigned by design, and
    // this proof is about the production ceremony rather than about local builds.
    let parsed: serde_json::Value =
        serde_json::from_slice(&raw_manifest).expect("the manifest parses");
    if parsed["signature"].as_str().unwrap_or("").is_empty() {
        return skip("the payload manifest is unsigned");
    }

    let verifier = ProductionEs256Verifier::from_embedded();
    let identity = evaluate_packaged_authority(
        &raw_manifest,
        &EvalContext {
            policy: Policy::Production,
            payload_root: &payload,
            expected_application_id: contract::PACKAGED_APPLICATION_ID,
            expected_application_version: env!("CARGO_PKG_VERSION"),
            expected_architecture: contract::PACKAGED_ARCHITECTURE,
            expected_runtime_version: contract::PACKAGED_NODE_VERSION,
            verifier: Some(&verifier),
            observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
        },
        &RealFs,
    )
    .expect("the owner-signed manifest must mint packaged identity");

    assert_eq!(identity.application_id(), contract::PACKAGED_APPLICATION_ID);
    assert_eq!(identity.application_version(), env!("CARGO_PKG_VERSION"));
    // The signer is the EMBEDDED anchor's key id, reported by the verifier rather than copied out
    // of the manifest — a manifest naming another signer never reaches this point at all.
    assert_eq!(
        identity.signer_id(),
        "projectos-signing-20260812",
        "identity must be attributed to the owner signing key",
    );
    assert_eq!(identity.installation_model(), InstallationModel::PerMachine);
}

/// The same evaluation, refused for every way the signed material can be wrong.
///
/// Each case starts from the REAL signed manifest and changes exactly one thing, so a refusal is
/// attributable to that change and to nothing else. Only the fact of refusal is asserted, never
/// which check refused: a caller that learns which check rejected its forgery is being handed an
/// oracle one bit at a time, which is why the production path answers uniformly.
#[test]
fn the_production_path_refuses_every_way_the_signed_material_can_be_wrong() {
    use projectos_shared_host_runtime::identity::packaged::{
        evaluate_packaged_authority, EvalContext, Policy, ProductionEs256Verifier, RealFs,
    };

    let payload = control_center().join("dist-payload");
    let Ok(raw_manifest) = std::fs::read(payload.join(contract::TRUST_MANIFEST_FILENAME)) else {
        return skip("the generated trust manifest is absent");
    };
    let base: serde_json::Value =
        serde_json::from_slice(&raw_manifest).expect("the manifest parses");
    if base["signature"].as_str().unwrap_or("").is_empty() {
        return skip("the payload manifest is unsigned");
    }
    let verifier = ProductionEs256Verifier::from_embedded();

    let refuses = |bytes: &[u8]| {
        evaluate_packaged_authority(
            bytes,
            &EvalContext {
                policy: Policy::Production,
                payload_root: &payload,
                expected_application_id: contract::PACKAGED_APPLICATION_ID,
                expected_application_version: env!("CARGO_PKG_VERSION"),
                expected_architecture: contract::PACKAGED_ARCHITECTURE,
                expected_runtime_version: contract::PACKAGED_NODE_VERSION,
                verifier: Some(&verifier),
                observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
            },
            &RealFs,
        )
        .is_err()
    };

    let mutate = |f: &dyn Fn(&mut serde_json::Value)| {
        let mut m = base.clone();
        f(&mut m);
        serde_json::to_vec(&m).expect("the mutated manifest serialises")
    };
    let text = |v: &str| serde_json::Value::String(v.to_string());

    // A flipped signature byte.
    let flipped = mutate(&|m| {
        let s = m["signature"]
            .as_str()
            .expect("signature present")
            .to_string();
        let first = if s.starts_with('a') { "b" } else { "a" };
        m["signature"] = text(&format!("{first}{}", &s[1..]));
    });
    assert!(refuses(&flipped), "a changed signature must refuse");

    // No signature at all.
    assert!(
        refuses(&mutate(&|m| m["signature"] = text(""))),
        "a missing signature must refuse",
    );

    // Right idea, wrong shape.
    assert!(
        refuses(&mutate(&|m| m["signature"] = text("not-hex"))),
        "a malformed signature must refuse",
    );

    // Another signer. `signingKeyId` is INSIDE the canonical bytes, so changing it invalidates the
    // very signature that covers it — and it no longer names the embedded anchor either.
    assert!(
        refuses(&mutate(
            &|m| m["signingKeyId"] = text("projectos-signing-somebody-else")
        )),
        "another signer must refuse",
    );

    // A test identity must never buy production trust.
    assert!(
        refuses(&mutate(&|m| m["signingKeyId"] = text("TEST-ONLY-key-1"))),
        "a TEST-ONLY signer must refuse under production policy",
    );

    // The application owns the algorithm; the manifest does not get to choose it.
    assert!(
        refuses(&mutate(&|m| m["signatureAlgorithm"] = text("rs256"))),
        "a non-es256 algorithm must refuse",
    );

    // A signed-over field. `buildId` has no counterpart on disk, so nothing else in the pipeline
    // can object to it — the ONLY thing that can refuse this manifest is the signature no longer
    // matching. That makes this case, and not the artefact cases below, the proof that the
    // signature genuinely covers the manifest's declarative fields.
    assert!(
        refuses(&mutate(&|m| m["buildId"] = text("000000000000"))),
        "a changed signed field must refuse",
    );

    // THE ATTESTED ARTEFACTS — and precisely what these two do NOT prove.
    //
    // Each declares a hash that no longer matches the bytes on disk, so `evaluate` refuses at the
    // artefact hash comparison, which runs BEFORE signature verification. They are therefore proof
    // that the declared hashes are checked against the real files, and NOT proof that the signature
    // covers those fields — the signature check is never reached. An earlier version of this
    // comment claimed the latter; it would have kept passing even if the canonical view had stopped
    // covering `runtime` and `daemonArtefact` entirely, which is exactly the regression it appeared
    // to guard. Signature coverage of the declarative fields is proven by the `buildId` case above;
    // that these two fields are inside the signed view is fixed in `canonical.rs`.
    let zeros = "0".repeat(64);
    assert!(
        refuses(&mutate(&|m| m["daemonArtefact"]["sha256"] = text(&zeros))),
        "a daemon hash that does not match the bytes on disk must refuse",
    );
    assert!(
        refuses(&mutate(&|m| m["runtime"]["sha256"] = text(&zeros))),
        "a runtime hash that does not match the bytes on disk must refuse",
    );
}

// ================================================================================================
// NEGATIVE PROOF — the record is evidence, not authority
// ================================================================================================

/// Mutate one field of the SHIPPED record and prove the reader refuses it.
fn mutated(raw: &[u8], f: impl Fn(&mut InstalledApplicationRecordV1)) -> Vec<u8> {
    let mut record: InstalledApplicationRecordV1 = serde_json::from_slice(raw).unwrap();
    f(&mut record);
    // Re-digest, so each case tests the FIELD rule rather than merely breaking the digest.
    record.record_digest = compute_application_record_digest(&record);
    serde_json::to_vec(&record).unwrap()
}

/// [§11.2–§11.10] Every way a record can be wrong is a refusal, on the real shipped bytes.
#[test]
fn a_wrong_record_is_refused_in_every_documented_way() {
    let Some(raw) = shipped_record_bytes() else {
        return skip("the shipped installation record is absent");
    };
    let root = declared_install_root(&raw);
    let check = |bytes: &[u8]| {
        verify_application_record_bytes(
            bytes,
            contract::PACKAGED_APPLICATION_ID,
            env!("CARGO_PKG_VERSION"),
            &root,
        )
    };

    // [§11.2] malformed
    assert_eq!(
        check(b"{ not json").unwrap_err(),
        ApplicationRecordError::Malformed
    );

    // [§11.3] wrong application id
    assert_eq!(
        check(&mutated(&raw, |r| r.application_id = "com.example.other".into())).unwrap_err(),
        ApplicationRecordError::WrongApplicationId
    );
    // [§11.4] wrong version
    assert_eq!(
        check(&mutated(&raw, |r| r.application_version = "9.9.9".into())).unwrap_err(),
        ApplicationRecordError::WrongApplicationVersion
    );
    // [§11.5] wrong scope
    assert_eq!(
        check(&mutated(&raw, |r| r.installation_scope = "per-user".into())).unwrap_err(),
        ApplicationRecordError::WrongInstallationScope
    );
    // [§11.6, §11.7] wrong install root — which is ALSO the copied-tree case: a record beside a
    // copy describes an installation that is not the one running.
    assert_eq!(
        check(&mutated(&raw, |r| r.install_root =
            r"C:\Program Files\Somewhere Else".into()))
        .unwrap_err(),
        ApplicationRecordError::InstallRootMismatch
    );
    // [§11.8] relative governed root
    assert_eq!(
        check(&mutated(&raw, |r| r.governed_system_root = "relative\\system".into())).unwrap_err(),
        ApplicationRecordError::GovernedRootNotAbsolute
    );
    // [§11.9] traversing governed root
    assert_eq!(
        check(&mutated(&raw, |r| r.governed_system_root =
            r"C:\dev\..\..\Windows".into()))
        .unwrap_err(),
        ApplicationRecordError::GovernedRootTraversal
    );
    // [§11.10] governed root inside the installation
    assert_eq!(
        check(&mutated(&raw, |r| {
            r.governed_system_root =
                format!(r"{}\{}", r.install_root, contract::PAYLOAD_RELATIVE_ROOT)
        }))
        .unwrap_err(),
        ApplicationRecordError::GovernedRootInsideInstallation
    );
    // An edited field WITHOUT re-digesting is a digest failure.
    let mut tampered: InstalledApplicationRecordV1 = serde_json::from_slice(&raw).unwrap();
    tampered.governed_system_root = r"C:\attacker".into();
    assert_eq!(
        check(&serde_json::to_vec(&tampered).unwrap()).unwrap_err(),
        ApplicationRecordError::DigestMismatch
    );
}

/// [§11.1, §11.14] NO RECORD = NO AUTHORITY. A Program Files-looking tree with no installer record
/// produces evidence that does not corroborate, so the installation identity stays unverified.
#[test]
fn no_record_means_no_corroborating_evidence() {
    use projectos_shared_host_runtime::identity::packaged_fixture::{
        classify_path, KnownRoots, ReparseState,
    };
    let roots = KnownRoots::for_test(vec![r"C:\Program Files"], vec![r"C:\Users\x\AppData"]);
    let exe = r"c:\program files\projectos control center\projectos-control-center.exe";
    for absent in [
        InstallationEvidence::Missing,
        InstallationEvidence::Unavailable,
        InstallationEvidence::Mismatched,
    ] {
        assert_eq!(
            classify_path(exe, ReparseState::None, absent, &roots),
            InstallationIdentity::PerMachineUnverified,
            "{absent:?} must not corroborate"
        );
    }
}

/// [§11.11] A record somewhere OTHER than the canonical path is never consulted, because the reader
/// resolves exactly one location and reads exactly that. There is no search to redirect.
#[test]
fn a_record_at_a_noncanonical_location_is_not_consulted() {
    use projectos_shared_host_runtime::identity::packaged::canonical_application_record_path;
    let canonical = canonical_application_record_path().expect("ProgramData resolves");

    // Write a perfectly valid record somewhere else entirely, and prove the canonical path is
    // unaffected by its existence.
    let decoy_dir = std::env::temp_dir().join("projectos-decoy-record");
    let _ = std::fs::remove_dir_all(&decoy_dir);
    std::fs::create_dir_all(&decoy_dir).unwrap();
    if let Some(raw) = shipped_record_bytes() {
        std::fs::write(decoy_dir.join("application.v1.json"), &raw).unwrap();
    }
    assert_ne!(canonical.parent().unwrap(), decoy_dir.as_path());
    assert!(
        canonical
            .to_string_lossy()
            .to_lowercase()
            .contains("\\projectos\\host\\installation\\"),
        "the canonical path is fixed: {}",
        canonical.display()
    );
}

/// The generator cannot emit a record its own reader would reject — it self-verifies before writing.
/// Proven here by reconstructing what it emits and checking the same rule holds.
#[test]
fn the_shipped_record_is_internally_consistent() {
    let Some(raw) = shipped_record_bytes() else {
        return skip("the shipped installation record is absent");
    };
    let record: InstalledApplicationRecordV1 = serde_json::from_slice(&raw).unwrap();
    assert_eq!(
        record.record_digest,
        compute_application_record_digest(&record)
    );
    assert_eq!(record.application_id, contract::PACKAGED_APPLICATION_ID);
    assert_eq!(record.installation_scope, PER_MACHINE_SCOPE);
    assert_eq!(record.application_version, env!("CARGO_PKG_VERSION"));

    // And it carries nothing it must not: no secret, no key material, no anchor, no algorithm.
    let text = String::from_utf8(raw).unwrap().to_lowercase();
    for forbidden in [
        "privatekey",
        "secret",
        "password",
        "anchor",
        "publickey",
        "signature",
        "es256",
    ] {
        assert!(
            !text.contains(forbidden),
            "the record must not carry {forbidden}"
        );
    }

    // The reader's own verification is the same one the generator ran before writing.
    assert!(verify_application_record(
        &record,
        contract::PACKAGED_APPLICATION_ID,
        env!("CARGO_PKG_VERSION"),
        Path::new(&record.install_root),
    )
    .is_ok());

    let _ = classify_installation; // the production path uses this; referenced so it stays imported
}

// ================================================================================================
// THE FIXED INSTALL ROOT
// ================================================================================================

/// [MSI FIXED INSTALL ROOT1A] The record names the ONE directory the MSI can install into.
///
/// The runtime compares the record's `installRoot` against the directory the executable actually
/// runs from and refuses a mismatch. That check is only safe to ship if the installer cannot
/// install anywhere else — otherwise the product offers a choice it then refuses, which is a defect
/// dressed as governance. The installer side of the invariant is enforced in the WiX template and
/// read back from the built MSI's Dialog, Control, Feature and AppSearch tables (see
/// packaging/INSTALLER-EFFECT-MANIFEST.txt). This is the RECORD side: the value the installer
/// writes must be exactly `<Program Files>\<ProductName>`, composed the same way WiX composes
/// INSTALLDIR from ProgramFiles64Folder and the product name.
///
/// WHAT THIS DOES NOT CLAIM. Not that the root can never be overridden — an administrator may pass
/// `INSTALLDIR=...` to msiexec and Windows Installer will honour it. That override is out of scope
/// deliberately, and it is not silent: the installation records one root, installs to another, and
/// the runtime refuses to launch it. Loud and closed, rather than quietly wrong.
#[test]
fn the_record_names_the_one_directory_the_installer_can_use() {
    let Some(raw) = shipped_record_bytes() else {
        return skip("the shipped record has not been generated");
    };
    let declared = declared_install_root(&raw);

    // The product name is the installer's, not this test's: read it from the Tauri configuration
    // the WiX build consumes, so a rename cannot leave this proof asserting a stale directory.
    let conf: serde_json::Value = serde_json::from_slice(
        &std::fs::read(control_center().join("src-tauri/tauri.conf.json"))
            .expect("tauri.conf.json is readable"),
    )
    .expect("tauri.conf.json parses");
    let product = conf["productName"].as_str().expect("productName is set");

    let expected = Path::new(r"C:\Program Files").join(product);
    assert_eq!(
        declared, expected,
        "the record must name the MSI's fixed install root; \
         a divergence here ships an installation the runtime will refuse",
    );

    // And the parent must be Program Files itself — a per-machine location that requires
    // elevation to write, which is what makes the installed bytes worth verifying at all.
    assert_eq!(
        declared.parent().expect("the install root has a parent"),
        Path::new(r"C:\Program Files"),
        "the install root must sit directly beneath Program Files",
    );
}
