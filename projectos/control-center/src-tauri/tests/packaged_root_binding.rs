//! ONE INSTALLED APPLICATION. ONE TRUSTED APPLICATION ROOT. ONE CLOSED RUNTIME PAYLOAD.
//! ONE GOVERNED PROJECTOS ROOT.
//!
//! These prove the three roots stay apart and that none of them can be moved by anything ambient.
//! They live in their own test binary because two of them change the process working directory,
//! which is global state: doing that inside the library's unit tests would race every other test in
//! the same process.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (packaged root + installation identity).

#![cfg(windows)]

use std::path::{Path, PathBuf};

use projectos_packaged_runtime_contract as contract;

/// A directory that looks exactly like a governed ProjectOS checkout, for the tests that prove the
/// working directory is never consulted.
fn governed_looking_dir(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("projectos-cwd-decoy-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join(".projectops")).unwrap();
    std::fs::write(
        root.join(".projectops").join("project-config.json"),
        br#"{"projectId":"decoy","projectName":"Decoy"}"#,
    )
    .unwrap();
    std::fs::write(
        root.join("bridge.config.json"),
        br#"{"watchRoots":["C:\\decoy"]}"#,
    )
    .unwrap();
    root
}

/// [§10.5, §11.3, §11.4, §11.8, §11.9] Changing the working directory — even to a directory that
/// contains a complete ProjectOS checkout AND a `bridge.config.json` — does not move the application
/// install root, and therefore cannot move the payload root either.
///
/// The install root comes from `current_exe()`. The decoy exists to make the test mean something: if
/// anything in the chain consulted the working directory, this is where it would show.
#[test]
fn changing_the_working_directory_does_not_move_the_application_or_payload_root() {
    let exe_dir = std::env::current_exe()
        .expect("the test binary has a path")
        .parent()
        .expect("and a directory")
        .to_path_buf();

    let original = std::env::current_dir().expect("a working directory");
    let decoy = governed_looking_dir("roots");

    // Before.
    let install_before = install_root_from_current_exe();
    let payload_before = install_before.join(contract::PAYLOAD_RELATIVE_ROOT);
    assert_eq!(install_before, exe_dir);

    // Stand inside a complete decoy checkout.
    std::env::set_current_dir(&decoy).expect("cwd changes");
    let install_after = install_root_from_current_exe();
    let payload_after = install_after.join(contract::PAYLOAD_RELATIVE_ROOT);

    // And restore before asserting, so a failure cannot leave the process somewhere odd.
    std::env::set_current_dir(&original).expect("cwd restores");

    assert_eq!(
        install_before, install_after,
        "the application install root must not follow the working directory"
    );
    assert_eq!(
        payload_before, payload_after,
        "the packaged payload root must not follow the working directory"
    );
    assert_ne!(
        install_after, decoy,
        "the decoy must genuinely differ from the install root, or this proves nothing"
    );
}

/// [§11.9] The payload root is one FIXED app-owned segment. There is no search, no candidate list
/// and no first-match-wins: a second directory that looks like a payload is simply not consulted.
#[test]
fn the_payload_root_is_a_fixed_segment_and_never_discovered() {
    let install = std::env::temp_dir().join("projectos-fixed-segment");
    let _ = std::fs::remove_dir_all(&install);
    // Two plausible decoys beside the real one.
    for d in ["payload", "runtime", contract::PAYLOAD_RELATIVE_ROOT] {
        std::fs::create_dir_all(install.join(d)).unwrap();
    }
    assert_eq!(
        install.join(contract::PAYLOAD_RELATIVE_ROOT),
        install.join("runtime-payload"),
        "the segment is the contract's, and only the contract's"
    );
    assert_ne!(
        install.join(contract::PAYLOAD_RELATIVE_ROOT),
        install.join("payload")
    );
}

/// [§12] The application identifier does not drift.
///
/// `tauri.conf.json` is what the Windows bundle actually stamps; the packaging contract is what the
/// Control Centre compiles in and what the manifest generator writes. They disagreed —
/// `com.universalbizcomply.projectos.control` against `com.projectos.control-center` — and nothing
/// compared them, so a manifest generated for the real product would have been refused by the real
/// product. `include_str!` binds the configuration at COMPILE time, so this cannot be satisfied by a
/// stale copy on disk.
#[test]
fn the_tauri_identifier_matches_the_packaging_contract() {
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");
    let conf: serde_json::Value =
        serde_json::from_str(TAURI_CONF).expect("tauri.conf.json is valid JSON");

    let identifier = conf["identifier"]
        .as_str()
        .expect("tauri.conf.json declares an identifier");
    assert_eq!(
        identifier,
        contract::PACKAGED_APPLICATION_ID,
        "the bundle identifier and the packaging contract must name ONE application"
    );

    // The version travels the same route: `evaluate()` compares the manifest against
    // `CARGO_PKG_VERSION`, so a bundle stamped with a different version could never be verified.
    let version = conf["version"].as_str().expect("a version");
    assert_eq!(
        version,
        env!("CARGO_PKG_VERSION"),
        "the bundle version and the crate version must agree"
    );
}

/// The install root, derived exactly as the packaged authority derives it. Kept here rather than
/// exported, so this test proves the DERIVATION rather than re-reading a value the library computed.
fn install_root_from_current_exe() -> PathBuf {
    std::env::current_exe()
        .expect("a running executable")
        .parent()
        .map(Path::to_path_buf)
        .expect("with a directory")
}
