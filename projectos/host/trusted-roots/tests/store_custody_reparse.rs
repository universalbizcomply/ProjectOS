//! §10I — a reparse point where a store object belongs is refused, never followed.
//!
//! Integration test, because it needs `mklink` to build a junction and the crate's own sources may
//! not launch a process. Every object lives under `%TEMP%` and is removed here.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::{Path, PathBuf};

use projectos_host_trusted_roots::{HostStateStore, HostStoreCustody, StoreCustodyRefusal};

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pos-10i-reparse-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch");
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn junction(link: &Path, target: &Path) -> bool {
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .status();
    matches!(status, Ok(s) if s.success())
}

#[test]
fn a_junction_where_the_store_directory_belongs_is_refused_and_its_target_untouched() {
    let scratch = Scratch::new("leaf");
    let root = scratch.0.join("host");
    let elsewhere = scratch.0.join("elsewhere");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&elsewhere).unwrap();
    assert!(
        junction(&root.join("delegation-state"), &elsewhere),
        "fixture junction"
    );

    let err = HostStoreCustody::fixture(&root)
        .establish(HostStateStore::DelegationLifecycle)
        .expect_err("a junction is not a store");
    assert_eq!(err, StoreCustodyRefusal::UnexpectedObject);
    assert_eq!(
        std::fs::read_dir(&elsewhere).unwrap().count(),
        0,
        "the junction's target was written"
    );
}

#[test]
fn a_junction_inside_a_governed_store_refuses_it() {
    let scratch = Scratch::new("inner");
    let root = scratch.0.join("host");
    let elsewhere = scratch.0.join("elsewhere");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&elsewhere).unwrap();
    let custody = HostStoreCustody::fixture(&root);
    let store = custody.establish(HostStateStore::RequestReplay).unwrap();
    assert!(
        junction(&store.path().join("records"), &elsewhere),
        "fixture junction"
    );

    assert_eq!(
        custody
            .establish(HostStateStore::RequestReplay)
            .unwrap_err(),
        StoreCustodyRefusal::UnexpectedObject
    );
}
