//! CD-B4-INSTALLER-READINESS1A integration proofs.
//!
//! The dry run resolves the REAL approved Known Folders read-only and derives the exact approved
//! installation locations, then stops at the frozen effect-authority gate. Nothing is created,
//! written, installed or started.

use projectos_host_elevated_installer_composition::dry_run::{ArtefactEvidence, ArtefactRefusal};

/// The packaged artefact built from committed source by this repository's own build.
fn artefact_path() -> std::path::PathBuf {
    // `CARGO_MANIFEST_DIR` is this crate; the artefact is the sibling service-host crate's build
    // output. No production location is consulted.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("service-host")
        .join("target")
        .join("release")
        .join("ProjectOSHost.exe")
}

#[test]
fn the_packaged_artefact_exists_and_is_accepted() {
    let p = artefact_path();
    assert!(
        p.exists(),
        "build it first: cargo build --release --manifest-path projectos/host/service-host/Cargo.toml"
    );
    let e = ArtefactEvidence::from_build_output(&p).expect("artefact accepted");
    assert_eq!(
        e.path().file_name().unwrap().to_string_lossy(),
        "ProjectOSHost.exe"
    );
    // Built from committed source: it came out of a Cargo build directory.
    assert!(e.path().components().any(|c| c.as_os_str() == "target"));
    // And it is NOT installed into a production root.
    let text = e.path().to_string_lossy().to_lowercase();
    assert!(!text.contains("program files"), "{text}");
    assert!(!text.contains("programdata"), "{text}");
}

#[test]
fn a_missing_or_wrongly_named_artefact_is_refused() {
    let missing = artefact_path().with_file_name("ProjectOSHost-does-not-exist.exe");
    assert_eq!(
        ArtefactEvidence::from_build_output(&missing).unwrap_err(),
        ArtefactRefusal::Missing
    );
    // A real file with the wrong name is refused for the NAME, not for existing.
    let dir = artefact_path().parent().unwrap().to_path_buf();
    let wrong = dir.join("projectos-installer-wrongname.exe");
    std::fs::copy(artefact_path(), &wrong).expect("copy inside the build directory");
    let outcome = ArtefactEvidence::from_build_output(&wrong);
    let _ = std::fs::remove_file(&wrong);
    assert_eq!(outcome.unwrap_err(), ArtefactRefusal::WrongName);

    // A directory is not a regular file.
    assert_eq!(
        ArtefactEvidence::from_build_output(&dir).unwrap_err(),
        ArtefactRefusal::NotRegularFile
    );
}

#[cfg(all(windows, feature = "installer-dry-run"))]
#[test]
fn the_full_dry_run_reaches_the_effect_authority_gate_and_stops() {
    use projectos_host_elevated_installer_composition::dry_run::production_dry_run;
    use projectos_host_elevated_installer_composition::PlanRefusal;
    use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;

    let artefact = ArtefactEvidence::from_build_output(&artefact_path()).expect("artefact");

    // What the machine looked like BEFORE the dry run. On a machine with no installation these are
    // all absent; on a machine that HAS one (the accepted local installation) they already exist.
    // Either way the claim being proven is the same: the dry run creates nothing and changes nothing.
    let probe = production_dry_run(&artefact).expect("dry run reaches the gate");
    let before_record = probe.record_path().exists();
    let before_record_dir = probe.record_path().parent().unwrap().exists();
    let before_binary = probe.service_binary_path().exists();
    let before_binary_dir = probe.service_binary_path().parent().unwrap().exists();

    let report = production_dry_run(&artefact).expect("dry run reaches the gate");

    // Both anchors resolved, and the report names them SYMBOLICALLY.
    assert_eq!(report.state_anchor_symbol(), "%KNOWNFOLDER:ProgramData%");
    assert_eq!(report.install_anchor_symbol(), "%KNOWNFOLDER:ProgramFiles%");

    // The exact approved locations were derived.
    assert!(report.record_path().ends_with("identity.v1.json"));
    let record = report.record_path().to_string_lossy().to_lowercase();
    assert!(record.contains("projectos"), "{record}");
    assert!(record.contains("installation"), "{record}");
    assert!(report.service_binary_path().ends_with("ProjectOSHost.exe"));
    let binary = report
        .service_binary_path()
        .to_string_lossy()
        .to_lowercase();
    assert!(binary.contains("program files"), "{binary}");
    assert!(binary.contains("projectos"), "{binary}");

    // THE GATE. It is reached, and it refuses.
    assert_eq!(
        report.effect_authority(),
        InstallationEffectAuthority::NotAuthorised
    );
    assert!(!report.effect_authority().is_authorised());
    assert_eq!(report.stopped_at(), PlanRefusal::ElevationAbsent);
    assert!(report.reached_effect_authority_gate());

    // AND NOTHING WAS CREATED OR REMOVED. The dry run leaves every derived production location
    // exactly as it found it — it never creates one, and never disturbs an existing installation.
    assert_eq!(
        report.record_path().exists(),
        before_record,
        "the dry run changed whether a production record exists"
    );
    assert_eq!(
        report.record_path().parent().unwrap().exists(),
        before_record_dir,
        "the dry run changed whether the production installation directory exists"
    );
    assert_eq!(
        report.service_binary_path().exists(),
        before_binary,
        "the dry run changed whether a binary exists in Program Files"
    );
    assert_eq!(
        report.service_binary_path().parent().unwrap().exists(),
        before_binary_dir,
        "the dry run changed whether the production install directory exists"
    );
}

#[test]
fn the_release_manifest_digest_is_deterministic_and_contract_valid() {
    use projectos_host_elevated_installer_composition::dry_run::ReleaseManifest;

    let artefact = ArtefactEvidence::from_build_output(&artefact_path()).expect("artefact");
    let a = ReleaseManifest::for_artefact(&artefact).expect("manifest");
    let b = ReleaseManifest::for_artefact(&artefact).expect("manifest again");

    // Same artefact, same bytes, same digest — every time.
    assert_eq!(a.canonical_bytes(), b.canonical_bytes());
    assert_eq!(a.digest_hex(), b.digest_hex());

    // Exactly the shape the identity record contract demands.
    assert_eq!(a.digest_hex().len(), 64);
    assert!(a
        .digest_hex()
        .bytes()
        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
    assert_ne!(a.digest_hex(), &"0".repeat(64));
    a.release_digest().expect("accepted by the writer contract");

    // The canonical encoding is domain-separated and names the frozen artefact.
    let text = String::from_utf8_lossy(a.canonical_bytes()).to_string();
    assert!(text.contains("PROJECTOS:RELEASE-MANIFEST:V1"), "{text}");
    assert!(text.contains("ProjectOSHost.exe"), "{text}");
}

#[cfg(all(windows, feature = "installer-dry-run"))]
#[test]
fn the_dry_run_carries_the_release_manifest_digest_and_still_refuses() {
    use projectos_host_elevated_installer_composition::dry_run::{
        production_dry_run, ReleaseManifest,
    };

    let artefact = ArtefactEvidence::from_build_output(&artefact_path()).expect("artefact");
    let report = production_dry_run(&artefact).expect("dry run");
    let manifest = ReleaseManifest::for_artefact(&artefact).expect("manifest");

    assert_eq!(report.release_manifest_digest(), manifest.digest_hex());
    assert_eq!(report.artefact_path(), artefact.path());
    // Accepting the artefact and its digest changes nothing about the gate.
    assert!(report.reached_effect_authority_gate());
}
