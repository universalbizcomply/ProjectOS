//! §10I — the Host's durable store custody, proven on disposable trees.
//!
//! Every tree is a temporary directory this test owns. The custody is the FIXTURE custody — the
//! calling account in place of `NT SERVICE\ProjectOSHost` — because a creation may only name the
//! calling account as owner; the composition, the creation primitive and the verifier are the
//! production ones. Descriptors are read back from Windows, never assumed.

#![cfg(windows)]

use projectos_host_windows_acl_policy::{AclPrincipal, AclViolation, WindowsAclPolicyService};

use super::TempTree;
use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};
use crate::{
    ActivatedHostStateRoot, FixtureInstallationAnchor, HostStateStore, HostStoreCustody,
    ProtectedInstallationBoundaryAcceptance, StoreCustodyRefusal, TrustedHostStateRoot,
};

fn custody(tree: &TempTree) -> HostStoreCustody {
    HostStoreCustody::fixture(tree.path())
}

#[test]
fn a_first_establish_creates_the_store_directory_with_the_committed_descriptor() {
    let tree = TempTree::new("custody-first");
    let store = custody(&tree)
        .establish(HostStateStore::DelegationLifecycle)
        .expect("established");
    assert_eq!(store.path(), tree.path().join("delegation-state"));

    let seen = WindowsAclPolicyService::new()
        .inspect_directory(store.path())
        .unwrap();
    assert_eq!(
        seen.owner,
        Some(AclPrincipal::CurrentInteractiveUser.resolve().unwrap()),
        "the owner is the committed one, not the token's default owner"
    );
    assert!(seen.dacl_protected);
    assert_eq!(
        seen.aces.len(),
        4,
        "service, OWNER RIGHTS, Administrators, SYSTEM"
    );
    assert!(seen.aces.iter().all(|a| !a.inherited), "nothing inherited");
    let owner_rights = AclPrincipal::OwnerRights.resolve().unwrap();
    assert!(seen
        .aces
        .iter()
        .any(|a| a.sid.as_ref() == Some(&owner_rights)));
}

#[test]
fn the_two_stores_are_separate_directories_under_one_committed_policy() {
    let tree = TempTree::new("custody-two");
    let c = custody(&tree);
    let delegation = c.establish(HostStateStore::DelegationLifecycle).unwrap();
    let replay = c.establish(HostStateStore::RequestReplay).unwrap();
    assert_ne!(delegation.path(), replay.path());
    assert_eq!(
        HostStateStore::DelegationLifecycle.segment(),
        "delegation-state"
    );
    assert_eq!(HostStateStore::RequestReplay.segment(), "request-replay");
    delegation.verify_contents().unwrap();
    replay.verify_contents().unwrap();
}

#[test]
fn a_second_establish_over_a_conforming_store_changes_nothing() {
    let tree = TempTree::new("custody-again");
    let c = custody(&tree);
    let store = c.establish(HostStateStore::RequestReplay).unwrap();
    let svc = WindowsAclPolicyService::new();
    let before = svc.inspect_directory(store.path()).unwrap();
    c.establish(HostStateStore::RequestReplay)
        .expect("a conforming store re-establishes");
    assert_eq!(svc.inspect_directory(store.path()).unwrap(), before);
}

#[test]
fn an_existing_store_directory_with_an_ambient_descriptor_is_refused_and_left_as_found() {
    let tree = TempTree::new("custody-ambient-leaf");
    let leaf = tree.path().join("delegation-state");
    // What a pre-§10I first start would have left behind.
    std::fs::create_dir(&leaf).unwrap();
    let svc = WindowsAclPolicyService::new();
    let before = svc.inspect_directory(&leaf).unwrap();

    let err = custody(&tree)
        .establish(HostStateStore::DelegationLifecycle)
        .expect_err("an ambient store is not governed state");
    assert!(
        matches!(err, StoreCustodyRefusal::NonConforming(_)),
        "{err:?}"
    );
    assert_eq!(
        svc.inspect_directory(&leaf).unwrap(),
        before,
        "the refused store was re-secured"
    );
}

#[test]
fn an_ambient_object_planted_inside_a_governed_store_refuses_the_store() {
    let tree = TempTree::new("custody-planted");
    let c = custody(&tree);
    let store = c.establish(HostStateStore::RequestReplay).unwrap();
    let records = store.path().join("records");
    store.create_directory(&records).unwrap();
    let planted = records.join("planted.rec");
    std::fs::write(&planted, b"x").unwrap();

    match store.verify_contents() {
        // The token-default descriptor is unprotected and names principals the policy does not.
        Err(StoreCustodyRefusal::NonConforming(v)) => {
            assert!(v.contains(&AclViolation::DaclNotProtected), "{v:?}");
        }
        other => panic!("expected NonConforming, got {other:?}"),
    }
    assert!(matches!(
        c.establish(HostStateStore::RequestReplay),
        Err(StoreCustodyRefusal::NonConforming(_))
    ));
    assert!(
        planted.exists(),
        "a refusal must not remove what it refused"
    );
}

#[test]
fn a_directory_below_the_fixed_level_is_an_unexpected_object() {
    let tree = TempTree::new("custody-nested");
    let store = custody(&tree)
        .establish(HostStateStore::DelegationLifecycle)
        .unwrap();
    let records = store.path().join("records");
    store.create_directory(&records).unwrap();
    store.create_directory(&records.join("nested")).unwrap();
    assert_eq!(
        store.verify_contents(),
        Err(StoreCustodyRefusal::UnexpectedObject)
    );
}

#[test]
fn governed_creation_is_confined_to_its_store() {
    let tree = TempTree::new("custody-contain");
    let store = custody(&tree)
        .establish(HostStateStore::DelegationLifecycle)
        .unwrap();
    let denied = |r: std::io::Result<()>| matches!(r, Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied);

    let outside = tree.path().join("outside.tmp");
    assert!(denied(store.create_file(&outside).map(drop)));
    assert!(!outside.exists());
    assert!(denied(store.create_directory(store.path())));
    let escape = store
        .path()
        .join("records")
        .join("..")
        .join("..")
        .join("escape");
    assert!(denied(store.create_directory(&escape)));
    assert!(!tree.path().join("escape").exists());
    assert!(denied(
        store
            .create_file(&store.path().join("x.tmp:stream"))
            .map(drop)
    ));

    // The verbatim spelling the engine uses is the same store, and is admitted.
    let inside = std::path::PathBuf::from(format!(
        r"\\?\{}",
        store.path().join("inside.tmp").display()
    ));
    drop(store.create_file(&inside).expect("inside the store"));
    let again = store.create_file(&inside).map(drop).unwrap_err();
    assert_eq!(again.kind(), std::io::ErrorKind::AlreadyExists);
    store
        .verify_contents()
        .expect("a governed creation conforms");
}

#[test]
fn a_state_root_that_is_not_a_directory_refuses() {
    let tree = TempTree::new("custody-no-root");
    let absent = HostStoreCustody::fixture(&tree.path().join("absent"));
    assert_eq!(
        absent
            .establish(HostStateStore::DelegationLifecycle)
            .unwrap_err(),
        StoreCustodyRefusal::StateRootUnusable
    );
    assert!(!tree.path().join("absent").exists());
}

#[test]
fn a_root_resolved_beneath_a_disposable_anchor_is_custodied_for_the_calling_account() {
    let tree = TempTree::new("custody-activated");
    let host = tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"));
    let trusted = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("host state root");
    let activated = ActivatedHostStateRoot::activate(
        trusted,
        &ProtectedInstallationBoundaryAcceptance::fixture(),
    );
    let store = activated
        .store_custody()
        .establish(HostStateStore::RequestReplay)
        .expect("the calling account may create beneath a disposable root");
    assert!(host.join("request-replay").is_dir());
    store.verify_contents().unwrap();
}

#[test]
fn custody_values_do_not_print_a_location() {
    let tree = TempTree::new("custody-debug");
    let c = custody(&tree);
    assert_eq!(format!("{c:?}"), "HostStoreCustody(redacted)");
    let store = c.establish(HostStateStore::RequestReplay).unwrap();
    assert_eq!(format!("{store:?}"), "GovernedHostStore(redacted)");
}
