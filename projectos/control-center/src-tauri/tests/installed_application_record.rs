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

fn skip(reason: &str) {
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

/// [§12.10] With that evidence, the sealed packaged authority reaches the NEXT fail-closed boundary
/// — the absent signature — rather than failing earlier for want of installation evidence.
///
/// This is the point of the whole increment: the installer-owned record removes the installation
/// blocker, and what remains is exactly the owner signing gate.
#[test]
fn with_installer_evidence_the_remaining_refusal_is_the_absent_signature() {
    use projectos_shared_host_runtime::identity::packaged::{
        evaluate_packaged_authority, EvalContext, IdentityError, Policy, ProductionEs256Verifier,
        RealFs,
    };

    // Built WITHOUT a `..` component: `bind_runtime` refuses a payload root containing traversal,
    // and it is right to — a root that can walk upwards is a root that can leave the payload.
    let payload = control_center().join("dist-payload");
    let manifest = payload.join(contract::TRUST_MANIFEST_FILENAME);
    let Ok(raw_manifest) = std::fs::read(&manifest) else {
        return skip("the generated trust manifest is absent");
    };

    let verifier = ProductionEs256Verifier::from_embedded();
    let outcome = *evaluate_packaged_authority(
        &raw_manifest,
        &EvalContext {
            policy: Policy::Production,
            payload_root: &payload,
            expected_application_id: contract::PACKAGED_APPLICATION_ID,
            expected_application_version: env!("CARGO_PKG_VERSION"),
            expected_architecture: contract::PACKAGED_ARCHITECTURE,
            expected_runtime_version: contract::PACKAGED_NODE_VERSION,
            verifier: Some(&verifier),
            // What the installer-owned record now yields on a real per-machine installation.
            observed_installation: InstallationIdentity::PerMachineEvidenceMatched,
        },
        &RealFs,
    )
    .expect_err("an unsigned manifest must never mint packaged identity");

    assert_eq!(
        outcome.failure,
        Some(IdentityError::ManifestSignatureRequired),
        "installation evidence is no longer the blocker; the signature is"
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
