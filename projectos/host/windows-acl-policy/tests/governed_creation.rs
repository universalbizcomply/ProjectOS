//! §10I — governed creation through the PUBLIC API, on isolated synthetic directories only.
//!
//! No ProgramData, no repository, no user-profile root. Every directory is created under `%TEMP%` by
//! the test and removed by it. `icacls` appears ONLY as a fixture builder, to give a PARENT an
//! inheritable broad-principal ACE that a governed child must then prove it did not take.
//!
//! The policy under test is the §10I store shape with the calling account standing in for the
//! service, because a creation may only name the CALLING account as owner (that is what keeps it
//! privilege-free); the production composition itself is proven in the activation-plan crate.

#![cfg(windows)]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use projectos_host_windows_acl_policy::{
    AclPolicy, AclPolicyError, AclPrincipal, AclViolation, AllowedPrincipal, GovernedCreation,
    RightsClass, WindowsAclPolicyService,
};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "projectos-10i-creation-{tag}-{}-{n}",
            std::process::id()
        ));
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

fn store_policy() -> AclPolicy {
    AclPolicy::strict(
        AclPrincipal::CurrentInteractiveUser,
        vec![
            AllowedPrincipal {
                principal: AclPrincipal::CurrentInteractiveUser,
                rights: RightsClass::Modify,
            },
            AllowedPrincipal {
                principal: AclPrincipal::OwnerRights,
                rights: RightsClass::ReadAttributes,
            },
            AllowedPrincipal {
                principal: AclPrincipal::BuiltinAdministrators,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            },
        ],
    )
}

fn grant_everyone_inheritable_modify(path: &Path) -> bool {
    let status = std::process::Command::new("icacls")
        .arg(path)
        .args(["/grant", "*S-1-1-0:(OI)(CI)M"])
        .status();
    matches!(status, Ok(s) if s.success())
}

#[test]
fn a_governed_directory_is_born_with_exactly_the_policy_descriptor() {
    let scratch = Scratch::new("born");
    let svc = WindowsAclPolicyService::new();
    let policy = store_policy();
    let dir = scratch.0.join("store");

    assert_eq!(
        svc.create_directory_governed(&dir, &policy).unwrap(),
        GovernedCreation::Created
    );
    let seen = svc.inspect_directory(&dir).unwrap();
    assert_eq!(
        seen.owner,
        Some(AclPrincipal::CurrentInteractiveUser.resolve().unwrap()),
        "the owner is the one the policy states, not the token's default owner"
    );
    assert!(seen.dacl_protected, "protected from inheritance");
    assert_eq!(seen.aces.len(), 4, "exactly the four stated principals");
    assert!(seen.aces.iter().all(|a| !a.inherited), "nothing inherited");
    assert!(svc.verify_directory(&dir, &policy).unwrap().is_conforming());
}

#[test]
fn the_ambient_behaviour_this_phase_replaces_does_not_conform() {
    // THE DEFECT, measured. Under a parent whose ACEs are NOT inheritable — exactly the accepted
    // state root's shape — a plain `create_dir` takes the TOKEN's default owner and default DACL.
    let scratch = Scratch::new("ambient");
    let svc = WindowsAclPolicyService::new();
    let policy = store_policy();
    let parent = scratch.0.join("no-inheritance");
    svc.create_directory_governed(&parent, &policy).unwrap();
    let ambient = parent.join("ambient-child");
    std::fs::create_dir(&ambient).unwrap();

    let verdict = svc.verify_directory(&ambient, &policy).unwrap();
    assert!(
        !verdict.is_conforming(),
        "a token-default child happened to match the store policy"
    );
    let seen = svc.inspect_directory(&ambient).unwrap();
    assert!(
        !seen.dacl_protected,
        "the ambient child's DACL is unprotected"
    );
    // And the governed route, beside it, under the same parent, conforms.
    let governed = parent.join("governed-child");
    svc.create_directory_governed(&governed, &policy).unwrap();
    assert!(svc
        .verify_directory(&governed, &policy)
        .unwrap()
        .is_conforming());
}

#[test]
fn a_governed_child_takes_nothing_from_an_inheritable_broad_parent() {
    let scratch = Scratch::new("inherit");
    let svc = WindowsAclPolicyService::new();
    let policy = store_policy();
    let parent = scratch.0.join("broad-parent");
    std::fs::create_dir(&parent).unwrap();
    assert!(
        grant_everyone_inheritable_modify(&parent),
        "fixture: Everyone:(OI)(CI)M"
    );

    let governed = parent.join("governed");
    svc.create_directory_governed(&governed, &policy).unwrap();
    let seen = svc.inspect_directory(&governed).unwrap();
    assert!(seen.aces.iter().all(|a| !a.inherited));
    assert!(svc
        .verify_directory(&governed, &policy)
        .unwrap()
        .is_conforming());

    // The control: an ordinary child of the same parent DOES take the broad grant.
    let ordinary = parent.join("ordinary");
    std::fs::create_dir(&ordinary).unwrap();
    let verdict = svc.verify_directory(&ordinary, &policy).unwrap();
    assert!(verdict.has(AclViolation::UnexpectedInheritedAce));
    assert!(verdict.has(AclViolation::BroadPrincipalWrite));
}

#[test]
fn an_existing_directory_is_reported_and_never_adopted_or_re_secured() {
    let scratch = Scratch::new("existing");
    let svc = WindowsAclPolicyService::new();
    let policy = store_policy();
    let parent = scratch.0.join("parent");
    svc.create_directory_governed(&parent, &policy).unwrap();
    let existing = parent.join("already-here");
    std::fs::create_dir(&existing).unwrap();
    let before = svc.inspect_directory(&existing).unwrap();

    assert_eq!(
        svc.create_directory_governed(&existing, &policy).unwrap(),
        GovernedCreation::AlreadyExists
    );
    assert_eq!(
        svc.inspect_directory(&existing).unwrap(),
        before,
        "an existing object's descriptor changed"
    );
    // A FILE in the way is also "already exists", not a directory created beside it.
    let file = parent.join("a-file");
    std::fs::write(&file, b"x").unwrap();
    assert_eq!(
        svc.create_directory_governed(&file, &policy).unwrap(),
        GovernedCreation::AlreadyExists
    );
    assert!(file.is_file());
}

#[test]
fn an_owner_other_than_the_calling_account_is_refused_before_anything_exists() {
    // From an elevated Git Bash `SeRestorePrivilege` arrives ENABLED, and Windows would then accept
    // SYSTEM as the owner of a new object. Refusing it here is what makes the outcome the same in
    // every shell and keeps any ambient privilege from being what made a creation succeed.
    let scratch = Scratch::new("stranger-owner");
    let svc = WindowsAclPolicyService::new();
    let mut policy = store_policy();
    policy.expected_owner = AclPrincipal::LocalSystem;
    let dir = scratch.0.join("never");
    assert_eq!(
        svc.create_directory_governed(&dir, &policy),
        Err(AclPolicyError::PolicyRefused)
    );
    assert!(!dir.exists(), "a refused creation left an object behind");
    assert!(matches!(
        svc.create_file_governed(&dir, &policy),
        Err(AclPolicyError::PolicyRefused)
    ));
    assert!(!dir.exists());
}

#[test]
fn a_policy_that_would_not_verify_or_a_relative_path_is_refused_pre_effect() {
    let scratch = Scratch::new("pre-effect");
    let svc = WindowsAclPolicyService::new();
    let mut broad = store_policy();
    broad.allowed.push(AllowedPrincipal {
        principal: AclPrincipal::BuiltinUsers,
        rights: RightsClass::Modify,
    });
    let dir = scratch.0.join("never");
    assert_eq!(
        svc.create_directory_governed(&dir, &broad),
        Err(AclPolicyError::PolicyRefused)
    );
    assert!(!dir.exists());
    assert_eq!(
        svc.create_directory_governed(Path::new("relative\\dir"), &store_policy()),
        Err(AclPolicyError::RelativePath)
    );
}

#[test]
fn a_governed_file_is_create_new_and_carries_its_descriptor_through_a_replace() {
    let scratch = Scratch::new("file");
    let svc = WindowsAclPolicyService::new();
    let policy = store_policy();
    let dir = scratch.0.join("store");
    svc.create_directory_governed(&dir, &policy).unwrap();

    // A destination that exists with an AMBIENT descriptor — what every record, manifest and
    // journal entry would have been before this phase.
    let destination = dir.join("record.rec");
    std::fs::write(&destination, b"old").unwrap();
    assert!(!svc
        .verify_file(&destination, &policy)
        .unwrap()
        .is_conforming());

    let staged = dir.join("record.tmp");
    let mut file = svc
        .create_file_governed(&staged, &policy)
        .unwrap()
        .expect("created");
    file.write_all(b"new").unwrap();
    file.sync_all().unwrap();
    drop(file);
    assert!(
        svc.create_file_governed(&staged, &policy)
            .unwrap()
            .is_none(),
        "CREATE_NEW: an existing object is never opened"
    );

    // `std::fs::rename` is `MoveFileExW(REPLACE_EXISTING)`: the moved file keeps ITS descriptor and
    // the replaced file's is discarded. So the governed staging file is what makes the result
    // governed — the replacement cannot weaken custody, it can only carry it.
    std::fs::rename(&staged, &destination).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"new");
    assert!(svc
        .verify_file(&destination, &policy)
        .unwrap()
        .is_conforming());
}
