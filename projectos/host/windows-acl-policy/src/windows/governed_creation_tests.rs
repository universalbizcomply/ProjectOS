//! §10I — governed creation, judged by REAL Windows access checks with the test process's
//! privileges and Administrators membership taken AWAY.
//!
//! The test process is normally an elevated administrator, and from Git Bash it even arrives with
//! `SeBackupPrivilege` / `SeRestorePrivilege` ENABLED — either of which would let it through any
//! DACL and make every "denied" below pass for the wrong reason, or every "allowed" pass without
//! proving the grant is enough. So each proof runs on a thread IMPERSONATING a restricted copy of
//! the process token: every privilege removed (`DISABLE_MAX_PRIVILEGE`) and the Administrators
//! group made deny-only. Two identities are built that way:
//!
//! * THE SERVICE — the account the store policy names as owner and grants `Modify`. It stands in for
//!   `NT SERVICE\ProjectOSHost`: an ordinary, non-administrative, unprivileged account.
//! * AN ORDINARY LOCAL USER — the same token with the ACCOUNT ITSELF also deny-only, so what is left
//!   is exactly what every local account carries: Everyone, BUILTIN\Users, Authenticated Users,
//!   INTERACTIVE, LOCAL.
//!
//! Each impersonation is proven to be in force (the thread holds a token, and an Administrators-only
//! object refuses it), so no assertion here can pass because impersonation silently did not happen.
//! Every object is created under `%TEMP%` and removed here.

use std::io::{Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::{
    CreateRestrictedToken, DuplicateToken, RevertToSelf, SecurityImpersonation,
    DISABLE_MAX_PRIVILEGE, SID_AND_ATTRIBUTES, TOKEN_DUPLICATE, TOKEN_QUERY,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken, SetThreadToken};

use super::*;
use crate::descriptor::{build_allow_acl, AclInspection, AllowEntry};
use crate::policy::{AclPolicy, AllowedPrincipal, RightsClass};
use crate::principal::AclPrincipal;

static NEXT: AtomicU32 = AtomicU32::new(0);

/// A disposable directory under `%TEMP%`, removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("pos-10i-governed-{tag}-{}-{n}", std::process::id()));
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

/// The §10I store shape with the calling account standing in for the service: owner = the account,
/// the account `Modify`, OWNER RIGHTS `ReadAttributes`, Administrators and SYSTEM `FullControl`.
fn store_policy(owner_rights: bool) -> AclPolicy {
    let mut allowed = vec![AllowedPrincipal {
        principal: AclPrincipal::CurrentInteractiveUser,
        rights: RightsClass::Modify,
    }];
    if owner_rights {
        allowed.push(AllowedPrincipal {
            principal: AclPrincipal::OwnerRights,
            rights: RightsClass::ReadAttributes,
        });
    }
    allowed.push(AllowedPrincipal {
        principal: AclPrincipal::BuiltinAdministrators,
        rights: RightsClass::FullControl,
    });
    allowed.push(AllowedPrincipal {
        principal: AclPrincipal::LocalSystem,
        rights: RightsClass::FullControl,
    });
    AclPolicy::strict(AclPrincipal::CurrentInteractiveUser, allowed)
}

/// The (owner, ACL image) a policy encodes — the same encoding the public creation path writes.
fn encoded(policy: &AclPolicy) -> (OwnedSid, Vec<u8>) {
    let owner = policy.expected_owner.resolve().unwrap();
    let sids: Vec<(OwnedSid, u32)> = policy
        .allowed
        .iter()
        .map(|a| (a.principal.resolve().unwrap(), a.rights.mask()))
        .collect();
    let entries: Vec<AllowEntry<'_>> = sids
        .iter()
        .map(|(sid, mask)| AllowEntry { sid, mask: *mask })
        .collect();
    (owner, build_allow_acl(&entries).unwrap())
}

fn conforms(path: &Path, kind: SecuredObjectKind, policy: &AclPolicy) -> bool {
    let (owner, control, dacl) = read_security(path, kind).expect("descriptor readable");
    let observed = AclInspection::from_raw(owner.as_deref(), control, dacl).unwrap();
    crate::verify::verify(&observed, policy)
        .unwrap()
        .is_conforming()
}

#[derive(Clone, Copy)]
enum Who {
    TheService,
    AnOrdinaryUser,
}

/// A restricted IMPERSONATION copy of the process token: no privileges, Administrators deny-only,
/// and — for an ordinary user — the account deny-only too.
fn restricted_token(who: Who) -> OwnedHandle {
    let mut process: HANDLE = std::ptr::null_mut();
    // SAFETY: the pseudo-handle is always valid; `process` is a writable slot adopted below.
    assert_ne!(
        unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY,
                &mut process,
            )
        },
        0
    );
    // SAFETY: a valid token handle owned nowhere else.
    let process = unsafe { OwnedHandle::from_raw_handle(process as _) };

    let account = aligned(current_account_sid().unwrap().as_bytes());
    let admins = aligned(OwnedSid::builtin_administrators().as_bytes());
    let mut disable = vec![SID_AND_ATTRIBUTES {
        Sid: admins.as_ptr().cast_mut().cast(),
        Attributes: 0,
    }];
    if matches!(who, Who::AnOrdinaryUser) {
        disable.push(SID_AND_ATTRIBUTES {
            Sid: account.as_ptr().cast_mut().cast(),
            Attributes: 0,
        });
    }
    let mut restricted: HANDLE = std::ptr::null_mut();
    // SAFETY: `process` holds TOKEN_DUPLICATE; `disable` points at `disable.len()` entries whose SIDs
    // live in `account` / `admins` for the call; no privileges or restricting SIDs are listed.
    let ok = unsafe {
        CreateRestrictedToken(
            process.as_raw_handle() as HANDLE,
            DISABLE_MAX_PRIVILEGE,
            disable.len() as u32,
            disable.as_ptr(),
            0,
            std::ptr::null(),
            0,
            std::ptr::null(),
            &mut restricted,
        )
    };
    assert_ne!(ok, 0, "restricted token");
    // SAFETY: a valid token handle owned nowhere else.
    let restricted = unsafe { OwnedHandle::from_raw_handle(restricted as _) };
    let mut impersonation: HANDLE = std::ptr::null_mut();
    // SAFETY: `restricted` is a live primary token; the result slot is writable and adopted below.
    assert_ne!(
        unsafe {
            DuplicateToken(
                restricted.as_raw_handle() as HANDLE,
                SecurityImpersonation,
                &mut impersonation,
            )
        },
        0,
        "impersonation token"
    );
    // SAFETY: a valid token handle owned nowhere else.
    unsafe { OwnedHandle::from_raw_handle(impersonation as _) }
}

/// Reverts the calling thread to the process token, on every path including an assertion panic.
struct Revert;

impl Drop for Revert {
    fn drop(&mut self) {
        // SAFETY: no preconditions; reverting a non-impersonating thread is a no-op.
        unsafe { RevertToSelf() };
    }
}

/// Run `f` on this thread as `who`, and PROVE the impersonation is in force first.
fn as_identity<R>(who: Who, admins_only: &Path, f: impl FnOnce() -> R) -> R {
    let token = restricted_token(who);
    // SAFETY: a null thread pointer means the calling thread; `token` is a live impersonation token.
    assert_ne!(
        unsafe { SetThreadToken(std::ptr::null(), token.as_raw_handle() as HANDLE) },
        0,
        "impersonate"
    );
    let _revert = Revert;
    assert!(
        refuse_impersonating_thread().is_err(),
        "the thread must now hold the restricted token"
    );
    assert!(
        std::fs::write(admins_only.join("probe"), b"x").is_err(),
        "an Administrators-only directory admitted the restricted token: impersonation is not in force"
    );
    f()
}

/// A directory only Administrators and SYSTEM may write: the impersonation probe target.
fn admins_only_dir(scratch: &Scratch) -> PathBuf {
    let path = scratch.0.join("admins-only");
    let owner = OwnedSid::builtin_administrators();
    let sy = OwnedSid::local_system();
    let acl = build_allow_acl(&[
        AllowEntry {
            sid: &owner,
            mask: RightsClass::FullControl.mask(),
        },
        AllowEntry {
            sid: &sy,
            mask: RightsClass::FullControl.mask(),
        },
    ])
    .unwrap();
    // Owner = the account (assignable without privilege); the DACL grants the account nothing.
    let account = current_account_sid().unwrap();
    assert!(create_directory_with_security(&path, &account, &acl).unwrap());
    path
}

fn denied(path: &Path, access: u32, kind: SecuredObjectKind) -> bool {
    matches!(
        open_secure_handle(path, access, kind),
        Err(AclPolicyError::AccessDenied)
    )
}

const WRITE_DAC: u32 = 0x0004_0000;
const WRITE_OWNER: u32 = 0x0008_0000;

#[test]
fn the_service_account_runs_the_whole_store_lifecycle_on_modify_alone_and_cannot_re_secure() {
    let scratch = Scratch::new("service");
    let probe = admins_only_dir(&scratch);
    let policy = store_policy(true);
    let (owner, acl) = encoded(&policy);
    let leaf = scratch.0.join("leaf");
    assert!(create_directory_with_security(&leaf, &owner, &acl).unwrap());

    as_identity(Who::TheService, &probe, || {
        // The exact object set the durable engine creates, created the way §10I creates it.
        for sub in ["records", "temp", "journal"] {
            assert!(create_directory_with_security(&leaf.join(sub), &owner, &acl).unwrap());
        }
        let lock = create_file_with_security(&leaf.join("store.lock"), &owner, &acl)
            .unwrap()
            .expect("a new lock file");
        lock.try_lock().expect("the single-writer lock");

        // Write-through publish: stage in temp/, flush, rename over the final name.
        let record = leaf.join("records").join("a.rec");
        for (n, body) in [(1u32, b"first".as_slice()), (2, b"second".as_slice())] {
            let staged = leaf.join("temp").join(format!("a.{n}.tmp"));
            let mut f = create_file_with_security(&staged, &owner, &acl)
                .unwrap()
                .expect("a new temp");
            f.write_all(body).unwrap();
            f.sync_all().unwrap();
            drop(f);
            // The second pass REPLACES an existing record: DELETE on the target is required.
            std::fs::rename(&staged, &record).expect("rename-replace under Modify");
        }
        let mut read_back = String::new();
        std::fs::File::open(&record)
            .unwrap()
            .read_to_string(&mut read_back)
            .unwrap();
        assert_eq!(read_back, "second");
        assert_eq!(std::fs::read_dir(leaf.join("records")).unwrap().count(), 1);

        // Stale-temp cleanup.
        let stale = leaf.join("temp").join("stale.tmp");
        drop(
            create_file_with_security(&stale, &owner, &acl)
                .unwrap()
                .unwrap(),
        );
        std::fs::remove_file(&stale).expect("remove under Modify");

        // The replaced record still carries the governed descriptor.
        assert!(conforms(&record, SecuredObjectKind::File, &policy));

        // AND IT CANNOT RE-SECURE ITS OWN STATE: not the leaf, not a directory, not a record —
        // even though it OWNS every one of them. OWNER RIGHTS took the owner's implicit WRITE_DAC.
        for (path, kind) in [
            (leaf.as_path(), SecuredObjectKind::Directory),
            (leaf.join("records").as_path(), SecuredObjectKind::Directory),
            (record.as_path(), SecuredObjectKind::File),
        ] {
            assert!(
                denied(path, WRITE_DAC, kind),
                "WRITE_DAC granted on {kind:?}"
            );
            assert!(
                denied(path, WRITE_OWNER, kind),
                "WRITE_OWNER granted on {kind:?}"
            );
        }
        drop(lock);
    });
}

#[test]
fn without_the_owner_rights_ace_the_owning_service_could_re_secure_its_state() {
    // The CONTROL for the proof above: the same shape minus OWNER RIGHTS. Ownership alone hands the
    // owner WRITE_DAC whatever the DACL says — which is why the store policy names OWNER RIGHTS.
    let scratch = Scratch::new("no-owner-rights");
    let probe = admins_only_dir(&scratch);
    let with = store_policy(true);
    let without = store_policy(false);
    let governed = scratch.0.join("with");
    let bare = scratch.0.join("without");
    let (o1, a1) = encoded(&with);
    let (o2, a2) = encoded(&without);
    assert!(create_directory_with_security(&governed, &o1, &a1).unwrap());
    assert!(create_directory_with_security(&bare, &o2, &a2).unwrap());

    as_identity(Who::TheService, &probe, || {
        assert!(denied(&governed, WRITE_DAC, SecuredObjectKind::Directory));
        assert!(
            open_secure_handle(&bare, WRITE_DAC, SecuredObjectKind::Directory).is_ok(),
            "the owner's implicit WRITE_DAC is what OWNER RIGHTS removes"
        );
    });
}

#[test]
fn an_ordinary_local_user_can_neither_write_delete_rename_inject_nor_re_secure_store_state() {
    let scratch = Scratch::new("ordinary");
    let probe = admins_only_dir(&scratch);
    let policy = store_policy(true);
    let (owner, acl) = encoded(&policy);
    let leaf = scratch.0.join("leaf");
    assert!(create_directory_with_security(&leaf, &owner, &acl).unwrap());
    let records = leaf.join("records");
    assert!(create_directory_with_security(&records, &owner, &acl).unwrap());
    let record = records.join("a.rec");
    let mut f = create_file_with_security(&record, &owner, &acl)
        .unwrap()
        .unwrap();
    f.write_all(b"consumed").unwrap();
    drop(f);

    as_identity(Who::AnOrdinaryUser, &probe, || {
        // Write / truncate the record.
        assert!(std::fs::OpenOptions::new()
            .write(true)
            .open(&record)
            .is_err());
        // Delete it (the replay-resurrection attack).
        assert!(std::fs::remove_file(&record).is_err());
        // Rename it away, or rename something over it.
        assert!(std::fs::rename(&record, records.join("moved.rec")).is_err());
        // Inject a sibling authority object, or a subdirectory.
        assert!(std::fs::write(records.join("planted.rec"), b"x").is_err());
        assert!(std::fs::write(leaf.join("planted"), b"x").is_err());
        assert!(std::fs::create_dir(leaf.join("planted-dir")).is_err());
        // Re-secure or take ownership of any of it.
        for (path, kind) in [
            (leaf.as_path(), SecuredObjectKind::Directory),
            (records.as_path(), SecuredObjectKind::Directory),
            (record.as_path(), SecuredObjectKind::File),
        ] {
            assert!(
                denied(path, WRITE_DAC, kind),
                "WRITE_DAC granted on {kind:?}"
            );
            assert!(
                denied(path, WRITE_OWNER, kind),
                "WRITE_OWNER granted on {kind:?}"
            );
        }
    });
    assert_eq!(std::fs::read(&record).unwrap(), b"consumed");
    assert!(!records.join("planted.rec").exists());
}

#[test]
fn a_governed_file_is_never_created_over_an_existing_object() {
    let scratch = Scratch::new("create-new");
    let policy = store_policy(true);
    let (owner, acl) = encoded(&policy);
    let existing = scratch.0.join("existing.tmp");
    std::fs::write(&existing, b"planted").unwrap();
    assert!(create_file_with_security(&existing, &owner, &acl)
        .unwrap()
        .is_none());
    assert_eq!(std::fs::read(&existing).unwrap(), b"planted");
    assert!(
        !conforms(&existing, SecuredObjectKind::File, &policy),
        "the planted file was adopted or re-secured"
    );
}
