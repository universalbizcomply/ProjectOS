//! Real Windows ACL evidence, on ISOLATED SYNTHETIC temporary directories only.
//!
//! No ProgramData, no repository directory, no user-profile root, no service installation directory,
//! and no administrator privilege is required. Every fixture directory is created by the test, is
//! deleted by the test, and is the only object whose ACL is ever touched.
//!
//! `mklink` and `icacls` appear ONLY as fixture builders — to create a junction and to introduce a
//! broad-principal ACE that this crate must then refuse. Neither is used as an implementation
//! primitive: inspection, verification and application all go through the crate's public API.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use projectos_host_windows_acl_policy::{
    AclPolicy, AclPolicyError, AclPrincipal, AclViolation, AllowedPrincipal, ApplyOutcome,
    DaclState, RightsClass, WindowsAclPolicyService,
};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A fresh, isolated synthetic directory under the system temp root.
fn unique_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "projectos-aclpolicy-{tag}-{}-{n}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("synthetic fixture directory must be creatable");
    path
}

fn cleanup(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

/// Create a directory junction (a reparse point) at `link` pointing at `target`.
fn make_junction(link: &Path, target: &Path) -> bool {
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .status();
    matches!(status, Ok(s) if s.success()) && link.exists()
}

/// FIXTURE ONLY: introduce a broad-principal ACE that this crate must then refuse.
fn grant_everyone_modify(path: &Path) -> bool {
    let status = std::process::Command::new("icacls")
        .arg(path)
        .args(["/grant", "*S-1-1-0:(OI)(CI)M"])
        .status();
    matches!(status, Ok(s) if s.success())
}

/// The policy under test: the calling account owns the root and is the only principal with authority.
fn current_user_policy(rights: RightsClass) -> AclPolicy {
    AclPolicy::strict(
        AclPrincipal::CurrentInteractiveUser,
        vec![AllowedPrincipal {
            principal: AclPrincipal::CurrentInteractiveUser,
            rights,
        }],
    )
}

/// Live process handle count, for deterministic resource-lifecycle evidence. TEST ONLY.
#[allow(unsafe_code)]
fn process_handle_count() -> u32 {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
    let mut count: u32 = 0;
    // SAFETY: the current-process pseudo-handle is always valid and `count` is a writable slot.
    let ok = unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) };
    assert_ne!(ok, 0, "handle count must be observable");
    count
}

// ------------------------------------------- PUBLIC-SURFACE CONTAINMENT (dependent-crate view)

/// This file IS a dependent crate: it can only reach the public API. Compile-fail proofs for the
/// items that must NOT be reachable live in `lib.rs`; this test proves the positive half — that the
/// containment left real, distinguishable semantic evidence in their place.
#[test]
fn a_dependent_crate_receives_semantic_evidence_and_no_raw_material() {
    let dir = unique_dir("containment");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);
    svc.apply_and_verify(&dir, &policy).unwrap();

    let inspection = svc.inspect_directory(&dir).unwrap();

    // The DACL evidence a dependent crate receives is a fieldless three-way state. There is no
    // variant carrying bytes, so no ACL image can be pattern-matched, cloned or converted out of it.
    let state = inspection.dacl;
    assert_eq!(state, DaclState::Present);
    assert_ne!(DaclState::Absent, DaclState::Null);
    assert_ne!(DaclState::Null, DaclState::Present);
    assert_ne!(DaclState::Absent, DaclState::Present);

    // Semantic ACE evidence survives containment.
    assert!(!inspection.aces.is_empty());
    assert!(inspection.aces.iter().all(|a| !a.inherited));
    assert!(inspection.owner.is_some());
    assert!(inspection.dacl_protected);

    // The owner is an opaque principal: comparable and classifiable, never readable.
    let owner = inspection.owner.clone().unwrap();
    assert_eq!(
        owner,
        AclPrincipal::CurrentInteractiveUser.resolve().unwrap(),
        "opaque SIDs remain comparable"
    );
    assert_eq!(
        projectos_host_windows_acl_policy::BroadPrincipal::classify(&owner),
        None,
        "well-known classification remains available without exposing bytes"
    );

    // No rendering of any public value discloses ACL or SID material.
    let rendered = format!("{inspection:?}|{state:?}|{owner:?}");
    assert!(rendered.contains("OwnedSid(redacted)"));
    assert!(rendered.contains("Present"));
    assert!(!rendered.contains("S-1-"));

    cleanup(&dir);
}

// ---------------------------------------------------------------- A. INSPECTION

#[test]
fn a_real_directory_descriptor_is_read_into_an_owned_model() {
    let dir = unique_dir("inspect");
    let svc = WindowsAclPolicyService::new();

    let inspection = svc
        .inspect_directory(&dir)
        .expect("inspection must succeed");
    assert!(inspection.owner.is_some(), "owner must be present");
    assert!(
        inspection.dacl == DaclState::Present,
        "a real temp directory must have a present, non-null DACL"
    );
    assert!(
        !inspection.aces.is_empty(),
        "ACEs must be converted into owned records"
    );

    // The Windows buffer was released inside the call; the owned result stays usable afterwards.
    let again = svc.inspect_directory(&dir).unwrap();
    assert_eq!(again.owner, inspection.owner, "owner must be stable");
    assert_eq!(again.aces.len(), inspection.aces.len());

    cleanup(&dir);
}

// -------------------------------------------------- B. SAFE SYNTHETIC POLICY

#[test]
fn applying_a_safe_policy_is_confirmed_only_by_an_authoritative_re_read() {
    let dir = unique_dir("apply");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);

    // Before: a fresh temp directory inherits its parent's authority and is not protected.
    let before = svc.verify_directory(&dir, &policy).unwrap();
    assert!(
        !before.is_conforming(),
        "an inherited, unprotected directory must not pass the strict policy"
    );

    let outcome = svc
        .apply_and_verify(&dir, &policy)
        .expect("apply must succeed");
    assert_eq!(outcome, ApplyOutcome::Confirmed);

    // Independently re-read and assert every required property of the applied state.
    let after = svc.inspect_directory(&dir).unwrap();
    assert_eq!(
        after.owner,
        Some(AclPrincipal::CurrentInteractiveUser.resolve().unwrap()),
        "owner must match the policy"
    );
    assert!(after.dacl == DaclState::Present, "DACL must be present");
    assert_ne!(after.dacl, DaclState::Null, "DACL must never be null");
    assert_ne!(after.dacl, DaclState::Absent, "DACL must never be absent");
    assert!(after.dacl_protected, "DACL must be protected");
    assert!(
        after.aces.iter().all(|a| !a.inherited),
        "no inherited ACE may survive"
    );
    assert!(svc.verify_directory(&dir, &policy).unwrap().is_conforming());

    cleanup(&dir);
}

// ------------------------------------------------------------ C. OWNER MISMATCH

#[test]
fn a_policy_expecting_a_different_owner_reports_owner_mismatch() {
    let dir = unique_dir("owner");
    let svc = WindowsAclPolicyService::new();
    svc.apply_and_verify(&dir, &current_user_policy(RightsClass::FullControl))
        .unwrap();

    // Same object, different expected owner.
    let foreign = AclPolicy::strict(
        AclPrincipal::LocalSystem,
        vec![AllowedPrincipal {
            principal: AclPrincipal::CurrentInteractiveUser,
            rights: RightsClass::FullControl,
        }],
    );
    let v = svc.verify_directory(&dir, &foreign).unwrap();
    assert!(v.has(AclViolation::OwnerMismatch));

    cleanup(&dir);
}

// -------------------------------------------------- D. BROAD-PRINCIPAL REFUSALS

/// Observed on a REAL descriptor: a broad principal holding modify authority is refused.
#[test]
fn an_observed_everyone_modify_ace_is_refused() {
    let dir = unique_dir("everyone");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);
    svc.apply_and_verify(&dir, &policy).unwrap();
    assert!(svc.verify_directory(&dir, &policy).unwrap().is_conforming());

    if !grant_everyone_modify(&dir) {
        cleanup(&dir);
        panic!("fixture: Everyone ACE could not be introduced");
    }

    let v = svc.verify_directory(&dir, &policy).unwrap();
    assert!(
        v.has(AclViolation::BroadPrincipalWrite),
        "Everyone with modify authority must be refused: {:?}",
        v.violations()
    );
    assert!(v.has(AclViolation::BroadPrincipalAccess));
    assert!(v.has(AclViolation::UnknownPrincipal));

    cleanup(&dir);
}

/// Refused BEFORE any effect: a policy that would itself grant a broad principal authority.
#[test]
fn a_policy_granting_a_broad_principal_is_refused_before_any_effect() {
    let dir = unique_dir("broadpolicy");
    let svc = WindowsAclPolicyService::new();
    let safe = current_user_policy(RightsClass::FullControl);
    svc.apply_and_verify(&dir, &safe).unwrap();
    let before = svc.inspect_directory(&dir).unwrap();

    for (principal, rights) in [
        (
            projectos_host_windows_acl_policy::OwnedSid::everyone(),
            RightsClass::Modify,
        ),
        (
            projectos_host_windows_acl_policy::OwnedSid::authenticated_users(),
            RightsClass::FullControl,
        ),
        (
            projectos_host_windows_acl_policy::OwnedSid::builtin_users(),
            RightsClass::Modify,
        ),
        (
            projectos_host_windows_acl_policy::OwnedSid::builtin_guests(),
            RightsClass::Read,
        ),
        (
            projectos_host_windows_acl_policy::OwnedSid::anonymous_logon(),
            RightsClass::Read,
        ),
    ] {
        let unsafe_policy = AclPolicy::strict(
            AclPrincipal::CurrentInteractiveUser,
            vec![
                AllowedPrincipal {
                    principal: AclPrincipal::CurrentInteractiveUser,
                    rights: RightsClass::FullControl,
                },
                AllowedPrincipal {
                    principal: AclPrincipal::ExplicitSid(principal),
                    rights,
                },
            ],
        );
        assert_eq!(
            svc.apply_directory_policy(&dir, &unsafe_policy)
                .unwrap_err(),
            AclPolicyError::PolicyRefused
        );
    }

    // PRE-EFFECT means exactly that: the descriptor is byte-for-byte unchanged.
    assert_eq!(svc.inspect_directory(&dir).unwrap(), before);
    cleanup(&dir);
}

// ----------------------------------------------------- E/F. INHERITANCE STATES

#[test]
fn inherited_and_unprotected_state_is_identified_and_then_removed() {
    let dir = unique_dir("inherit");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);

    let before = svc.inspect_directory(&dir).unwrap();
    assert!(
        !before.dacl_protected,
        "a fresh temp directory inherits from its parent"
    );
    assert!(
        before.aces.iter().any(|a| a.inherited),
        "inherited ACEs must be identified"
    );
    let v = svc.verify_directory(&dir, &policy).unwrap();
    assert!(v.has(AclViolation::UnexpectedInheritedAce));
    assert!(v.has(AclViolation::DaclNotProtected));

    // A policy that permits inheritance must not report those two findings.
    let mut permissive = policy.clone();
    permissive.allow_inherited_aces = true;
    permissive.require_protected_dacl = false;
    let v2 = svc.verify_directory(&dir, &permissive).unwrap();
    assert!(!v2.has(AclViolation::UnexpectedInheritedAce));
    assert!(!v2.has(AclViolation::DaclNotProtected));

    svc.apply_and_verify(&dir, &policy).unwrap();
    let after = svc.inspect_directory(&dir).unwrap();
    assert!(after.dacl_protected);
    assert!(after.aces.iter().all(|a| !a.inherited));

    cleanup(&dir);
}

// ------------------------------------------------------- G. UNKNOWN PRINCIPALS

#[test]
fn a_real_unknown_principal_is_refused_and_can_be_explicitly_permitted() {
    let dir = unique_dir("unknown");
    let svc = WindowsAclPolicyService::new();
    // A fresh temp directory carries inherited SYSTEM/Administrators authority, which a policy naming
    // only the current account does not list.
    let policy = current_user_policy(RightsClass::FullControl);
    let v = svc.verify_directory(&dir, &policy).unwrap();
    assert!(v.has(AclViolation::UnknownPrincipal));

    let mut permissive = policy.clone();
    permissive.allow_unknown_principals = true;
    assert!(!svc
        .verify_directory(&dir, &permissive)
        .unwrap()
        .has(AclViolation::UnknownPrincipal));

    cleanup(&dir);
}

// ---------------------------------------------------------- H. REPARSE DEFENCE

#[test]
fn a_junction_root_is_refused_for_inspection_verification_and_application() {
    let target = unique_dir("junction-target");
    let link = unique_dir("junction-link");
    // The link path must not exist for mklink.
    std::fs::remove_dir(&link).unwrap();
    if !make_junction(&link, &target) {
        cleanup(&target);
        panic!("fixture: junction could not be created");
    }

    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);
    let before = svc.inspect_directory(&target).unwrap();

    assert_eq!(
        svc.inspect_directory(&link).unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );
    assert_eq!(
        svc.verify_directory(&link, &policy).unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );
    assert_eq!(
        svc.apply_directory_policy(&link, &policy).unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );
    assert_eq!(
        svc.apply_and_verify(&link, &policy).unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );

    // The junction TARGET must be untouched: refusal is not partial application.
    assert_eq!(svc.inspect_directory(&target).unwrap(), before);

    let _ = std::fs::remove_dir(&link);
    cleanup(&target);
    cleanup(&link);
}

#[test]
fn a_root_replaced_by_a_junction_before_application_is_refused() {
    let real = unique_dir("swap-real");
    let target = unique_dir("swap-target");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);

    svc.apply_and_verify(&real, &policy).unwrap();
    let target_before = svc.inspect_directory(&target).unwrap();

    // Replace the admitted pathname with a junction pointing somewhere else.
    std::fs::remove_dir_all(&real).unwrap();
    if !make_junction(&real, &target) {
        cleanup(&target);
        panic!("fixture: junction could not be created");
    }

    assert_eq!(
        svc.apply_directory_policy(&real, &policy).unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );
    // The junction's TARGET must not have been written through the link.
    assert_eq!(svc.inspect_directory(&target).unwrap(), target_before);

    let _ = std::fs::remove_dir(&real);
    cleanup(&target);
    cleanup(&real);
}

/// A DIRECTORY SYMLINK requires SeCreateSymbolicLinkPrivilege, which is unavailable to a standard
/// account on this host. The junction cases above carry the real reparse evidence. This probe is
/// environment-gated and is NOT counted as passing.
#[test]
#[ignore = "requires SeCreateSymbolicLinkPrivilege (unavailable to a standard account)"]
fn a_directory_symlink_root_is_refused() {
    let target = unique_dir("symlink-target");
    let link = unique_dir("symlink-link");
    std::fs::remove_dir(&link).unwrap();
    let created = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/D"])
        .arg(&link)
        .arg(&target)
        .status();
    assert!(
        matches!(created, Ok(s) if s.success()),
        "symlink creation privilege is required for this probe"
    );
    assert_eq!(
        WindowsAclPolicyService::new()
            .inspect_directory(&link)
            .unwrap_err(),
        AclPolicyError::ReparsePointRefused
    );
    let _ = std::fs::remove_dir(&link);
    cleanup(&target);
}

// --------------------------------------------------------- PATH ADMISSION

#[test]
fn refused_path_shapes_are_classified_exactly() {
    let svc = WindowsAclPolicyService::new();
    let dir = unique_dir("shapes");
    let file = dir.join("regular.txt");
    std::fs::write(&file, b"x").unwrap();

    for (path, expected) in [
        (PathBuf::from(""), AclPolicyError::EmptyPath),
        (
            PathBuf::from("relative\\path"),
            AclPolicyError::RelativePath,
        ),
        (
            PathBuf::from("\\\\server\\share"),
            AclPolicyError::UnsupportedNamespace,
        ),
        (
            PathBuf::from("\\\\?\\C:\\x"),
            AclPolicyError::UnsupportedNamespace,
        ),
        (
            PathBuf::from("C:/forward/slash"),
            AclPolicyError::UnsupportedNamespace,
        ),
        (
            PathBuf::from("C:\\a\\..\\b"),
            AclPolicyError::UnsupportedNamespace,
        ),
        (
            PathBuf::from("C:\\a\\stream:ads"),
            AclPolicyError::UnsupportedNamespace,
        ),
        (dir.join("does-not-exist"), AclPolicyError::NotFound),
        (file.clone(), AclPolicyError::NotADirectory),
    ] {
        assert_eq!(
            svc.inspect_directory(&path).unwrap_err(),
            expected,
            "path shape must be classified exactly"
        );
    }

    cleanup(&dir);
}

// ------------------------------------------- I. NON-CONFORMING EFFECT HANDLING

/// An applied state that does not satisfy a STRICTER policy is reported as a populated verification,
/// never as success and never as an error — and nothing is retried or broadened.
#[test]
fn an_applied_state_is_judged_against_the_policy_not_against_the_write() {
    let dir = unique_dir("reconcile");
    let svc = WindowsAclPolicyService::new();

    svc.apply_and_verify(&dir, &current_user_policy(RightsClass::FullControl))
        .unwrap();
    let applied = svc.inspect_directory(&dir).unwrap();

    // A stricter policy: the same principal, but far less authority than was written.
    let stricter = current_user_policy(RightsClass::ReadAttributes);
    let v = svc.verify_directory(&dir, &stricter).unwrap();
    assert!(v.has(AclViolation::RightsBroaderThanPolicy));
    assert!(!v.is_conforming());

    // Judging did not mutate anything, and no automatic retry or broadening occurred.
    assert_eq!(svc.inspect_directory(&dir).unwrap(), applied);

    cleanup(&dir);
}

// ------------------------------------------------------ J. RESOURCE LIFECYCLE

#[test]
fn repeated_inspect_apply_and_verify_does_not_materially_leak_handles() {
    /// Absolute tolerance for unrelated runtime activity. Growth PROPORTIONAL to the iteration count
    /// is what this test exists to disprove.
    const TOLERANCE: u32 = 32;
    const CYCLES: u32 = 256;

    let dir = unique_dir("lifecycle");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);

    // Warm up so first-call allocations are not counted.
    svc.apply_and_verify(&dir, &policy).unwrap();
    let baseline = process_handle_count();

    for _ in 0..CYCLES {
        let _ = svc.inspect_directory(&dir).unwrap();
        let _ = svc.verify_directory(&dir, &policy).unwrap();
        assert_eq!(
            svc.apply_and_verify(&dir, &policy).unwrap(),
            ApplyOutcome::Confirmed
        );
    }

    let growth = process_handle_count().saturating_sub(baseline);
    assert!(
        growth <= TOLERANCE,
        "handle growth {growth} over {CYCLES} cycles indicates a leak"
    );

    cleanup(&dir);
}

// ------------------------------------------------------- K. ERROR REDACTION

#[test]
fn errors_and_debug_output_disclose_nothing_sensitive() {
    let dir = unique_dir("redaction");
    let svc = WindowsAclPolicyService::new();
    let policy = current_user_policy(RightsClass::FullControl);
    svc.apply_and_verify(&dir, &policy).unwrap();

    let dir_text = dir.to_string_lossy().to_string();
    let leaf = dir.file_name().unwrap().to_string_lossy().to_string();

    let inspection = svc.inspect_directory(&dir).unwrap();
    let verification = svc.verify_directory(&dir, &policy).unwrap();
    let err = svc.inspect_directory(&dir.join("missing")).unwrap_err();

    let rendered = format!(
        "{inspection:?}|{verification:?}|{err:?}|{err}|{:?}",
        AclPolicyError::AccessDenied
    );

    assert!(!rendered.contains(&dir_text), "no absolute path may appear");
    assert!(
        !rendered.contains(&leaf),
        "no fixture directory name may appear"
    );
    assert!(!rendered.contains("S-1-"), "no SID string may appear");
    assert!(
        !rendered.contains("0x"),
        "no raw pointer or handle may appear"
    );
    assert!(
        !rendered.contains("Administrator") && !rendered.contains("SYSTEM"),
        "no account name may appear"
    );
    // Every SID in the owned model renders as a redacted placeholder.
    assert!(rendered.contains("OwnedSid(redacted)"));

    cleanup(&dir);
}

// ---------------------------------------------------------------------------------------------
// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A — the FILE ACL path.
//
// The canonical identity record is a FILE beneath directories whose protected DACLs carry
// non-inheritable ACEs. Nothing is inherited, so the policy must be applied to the file itself.
// Every fixture here is a synthetic temp file this test creates and deletes.
// ---------------------------------------------------------------------------------------------

/// The exact bytes a canonical record would have. Their content is irrelevant; that they are
/// UNCHANGED by an ACL application is the point.
const FIXTURE_RECORD: &[u8] = br#"{"schema_version":1,"product":"ProjectOS"}"#;

fn unique_record_file(tag: &str) -> (PathBuf, PathBuf) {
    let dir = unique_dir(tag);
    let file = dir.join("identity.v1.json");
    std::fs::write(&file, FIXTURE_RECORD).expect("the fixture record must be writable");
    (dir, file)
}

/// The shape of the approved record-file policy: the service read-only, SYSTEM and Administrators
/// full, the installing account as owner, nothing else. `CurrentInteractiveUser` stands in for the
/// per-service SID, which exists only on a machine with the service installed.
fn record_file_policy(service_stand_in: AclPrincipal) -> AclPolicy {
    AclPolicy::strict(
        AclPrincipal::CurrentInteractiveUser,
        vec![
            AllowedPrincipal {
                principal: service_stand_in,
                rights: RightsClass::Read,
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

#[test]
fn a_file_policy_applies_and_verifies_and_leaves_the_record_bytes_untouched() {
    let (dir, file) = unique_record_file("recordfile");
    let service = WindowsAclPolicyService::new();
    let policy = record_file_policy(AclPrincipal::CurrentInteractiveUser);

    let before = std::fs::read(&file).expect("the fixture record is readable");

    // Every observation is collected BEFORE anything can panic, so the fixture is always cleaned up.
    // A panic between applying a protected DACL and removing the directory would leak a temp fixture
    // whose own ACL then makes it awkward to delete — so no assertion runs before cleanup.
    let outcome = service.apply_and_verify_file(&file, &policy);
    let confirmed = matches!(outcome, Ok(ApplyOutcome::Confirmed));
    let conforming = service
        .verify_file(&file, &policy)
        .map(|v| v.is_conforming())
        .unwrap_or(false);
    let dacl = service.inspect_file(&file).map(|i| i.dacl).ok();
    let after = std::fs::read(&file).ok();
    cleanup(&dir);

    // An environment that refuses ownership assignment is reported, never silently passed.
    assert!(
        confirmed,
        "the record-file policy did not apply cleanly: {outcome:?}"
    );
    // AUTHORITATIVE re-read, not the value written.
    assert!(
        conforming,
        "the applied file does not verify against its own policy"
    );
    assert_eq!(dacl, Some(DaclState::Present));
    // THE POINT: an ACL application must never touch the record's contents.
    assert_eq!(
        after.as_deref(),
        Some(before.as_slice()),
        "the record bytes changed during ACL application"
    );
    assert_eq!(after.as_deref(), Some(FIXTURE_RECORD));
}

#[test]
fn a_file_policy_granting_a_broad_principal_is_refused_before_any_effect() {
    let (dir, file) = unique_record_file("recordbroad");
    let service = WindowsAclPolicyService::new();
    let before = std::fs::read(&file).expect("the fixture record is readable");

    // `Everyone` with read access. The policy must be refused BEFORE any descriptor is written.
    let broad = AclPolicy::strict(
        AclPrincipal::CurrentInteractiveUser,
        vec![AllowedPrincipal {
            principal: AclPrincipal::ExplicitSid(
                projectos_host_windows_acl_policy::OwnedSid::from_bytes(&[
                    1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
                ])
                .expect("S-1-1-0 is a well-formed SID"),
            ),
            rights: RightsClass::Read,
        }],
    );
    let outcome = service.apply_file_policy(&file, &broad);
    let after = std::fs::read(&file).ok();
    cleanup(&dir);

    assert!(
        matches!(outcome, Err(AclPolicyError::PolicyRefused)),
        "a broad principal must be refused pre-effect, got {outcome:?}"
    );
    assert_eq!(
        after.as_deref(),
        Some(before.as_slice()),
        "a refused policy must not touch the record"
    );
}

#[test]
fn a_directory_is_refused_by_the_file_path_and_a_file_by_the_directory_path() {
    let (dir, file) = unique_record_file("recordtype");
    let service = WindowsAclPolicyService::new();
    let as_directory = service.inspect_directory(&file);
    let as_file = service.inspect_file(&dir);
    cleanup(&dir);

    // A file is not a directory.
    assert!(matches!(as_directory, Err(AclPolicyError::NotADirectory)));
    // A directory is not a file.
    assert!(matches!(as_file, Err(AclPolicyError::NotAFile)));
}
