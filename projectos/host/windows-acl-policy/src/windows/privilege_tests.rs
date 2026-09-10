//! §10G-PRIV — the `SeRestorePrivilege` window, proved two ways.
//!
//! * A SCRIPTED token proves the ordering and failure semantics a real token cannot be made to show
//!   on demand: a refused or failed enable, a failed restore, a re-read that disagrees, a panic.
//! * The REAL process token proves both initial states — DISABLED (what an elevated PowerShell launch
//!   hands a process) and ENABLED (what an elevated Git Bash launch hands it) — each set explicitly
//!   here, so the proof does not depend on which shell ran `cargo test`.
//!
//! Every real ACL effect lands on a disposable directory under `%TEMP%` created and deleted here. The
//! real-token tests need a token that HOLDS `SeRestorePrivilege` (an elevated administrator); on one
//! that does not they FAIL, loudly, rather than pass vacuously.

use std::cell::RefCell;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_INVALID_OWNER, ERROR_SUCCESS, LUID,
};
use windows_sys::Win32::Security::{LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_PRIVILEGES};

use super::*;
use crate::descriptor::{build_allow_acl, AllowEntry};
use crate::policy::RightsClass;

// ------------------------------------------------------------------------- scripted token

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Call {
    Enable,
    Effect,
    Restore(PriorPrivilege),
    Read,
}

/// A token whose every answer is scripted, and which logs every call into a log the effect shares.
struct Scripted<'a> {
    log: &'a RefCell<Vec<Call>>,
    enable: Result<PriorPrivilege, AclPolicyError>,
    restore: Result<(), AclPolicyError>,
    enabled_after_restore: bool,
}

impl RestorePrivilegeToken for Scripted<'_> {
    fn enable(&mut self) -> Result<PriorPrivilege, AclPolicyError> {
        self.log.borrow_mut().push(Call::Enable);
        self.enable
    }
    fn restore(&mut self, prior: PriorPrivilege) -> Result<(), AclPolicyError> {
        self.log.borrow_mut().push(Call::Restore(prior));
        self.restore
    }
    fn is_enabled(&self) -> Result<bool, AclPolicyError> {
        self.log.borrow_mut().push(Call::Read);
        Ok(self.enabled_after_restore)
    }
}

/// Run one window over a scripted token whose effect returns `status`.
fn scripted(
    enable: Result<PriorPrivilege, AclPolicyError>,
    restore: Result<(), AclPolicyError>,
    enabled_after_restore: bool,
    status: u32,
) -> (Result<(), AclPolicyError>, Vec<Call>) {
    let log = RefCell::new(Vec::new());
    let lock = Mutex::new(());
    let serialised = admit_privilege_window(&lock).expect("a fresh lock admits");
    let mut token = Scripted {
        log: &log,
        enable,
        restore,
        enabled_after_restore,
    };
    let result = run_in_restore_privilege_window(&serialised, &mut token, || {
        log.borrow_mut().push(Call::Effect);
        status
    });
    (result, log.into_inner())
}

const DISABLED: PriorPrivilege = PriorPrivilege::Changed(0);

#[test]
fn initially_disabled_is_enabled_for_the_effect_and_written_back_disabled() {
    let (result, calls) = scripted(Ok(DISABLED), Ok(()), false, ERROR_SUCCESS);
    assert_eq!(result, Ok(()));
    assert_eq!(
        calls,
        vec![
            Call::Enable,
            Call::Effect,
            Call::Restore(DISABLED),
            Call::Read
        ]
    );
}

#[test]
fn initially_enabled_stays_enabled_and_is_confirmed_enabled() {
    let (result, calls) = scripted(
        Ok(PriorPrivilege::AlreadyEnabled),
        Ok(()),
        true,
        ERROR_SUCCESS,
    );
    assert_eq!(result, Ok(()));
    assert_eq!(
        calls,
        vec![
            Call::Enable,
            Call::Effect,
            Call::Restore(PriorPrivilege::AlreadyEnabled),
            Call::Read
        ]
    );
}

#[test]
fn an_unassigned_privilege_refuses_before_the_effect() {
    let (result, calls) = scripted(
        Err(AclPolicyError::PrivilegeUnavailable),
        Ok(()),
        false,
        ERROR_SUCCESS,
    );
    assert_eq!(result, Err(AclPolicyError::PrivilegeUnavailable));
    assert_eq!(
        calls,
        vec![Call::Enable],
        "no effect and nothing to restore"
    );
}

#[test]
fn a_failed_enable_refuses_before_the_effect() {
    for class in [
        AclPolicyError::WindowsApiFailure,
        AclPolicyError::AccessDenied,
        AclPolicyError::PrivilegeRestoreFailed,
    ] {
        let (result, calls) = scripted(Err(class), Ok(()), false, ERROR_SUCCESS);
        assert_eq!(result, Err(class));
        assert_eq!(calls, vec![Call::Enable], "{class:?}");
    }
}

#[test]
fn a_failed_write_still_restores_the_prior_state_and_reports_the_write() {
    for (status, class) in [
        (ERROR_INVALID_OWNER, AclPolicyError::WindowsApiFailure),
        (ERROR_ACCESS_DENIED, AclPolicyError::AccessDenied),
    ] {
        let (result, calls) = scripted(Ok(DISABLED), Ok(()), false, status);
        assert_eq!(result, Err(class));
        assert_eq!(
            calls,
            vec![
                Call::Enable,
                Call::Effect,
                Call::Restore(DISABLED),
                Call::Read
            ]
        );
    }
}

#[test]
fn a_failed_restore_is_never_success_even_when_the_write_succeeded() {
    let (result, calls) = scripted(
        Ok(DISABLED),
        Err(AclPolicyError::PrivilegeRestoreFailed),
        false,
        ERROR_SUCCESS,
    );
    assert_eq!(result, Err(AclPolicyError::PrivilegeRestoreFailed));
    // Nothing is retried, and a restore that failed is not "confirmed" by a read.
    assert_eq!(
        calls,
        vec![Call::Enable, Call::Effect, Call::Restore(DISABLED)]
    );
}

#[test]
fn a_restore_the_re_read_does_not_confirm_is_never_success() {
    // Windows accepted the write-back, but the token still reads ENABLED.
    let (result, _) = scripted(Ok(DISABLED), Ok(()), true, ERROR_SUCCESS);
    assert_eq!(result, Err(AclPolicyError::PrivilegeRestoreFailed));
    // ...and an already-enabled privilege that reads DISABLED afterwards was not restored either.
    let (result, _) = scripted(
        Ok(PriorPrivilege::AlreadyEnabled),
        Ok(()),
        false,
        ERROR_SUCCESS,
    );
    assert_eq!(result, Err(AclPolicyError::PrivilegeRestoreFailed));
}

#[test]
fn restore_failure_outranks_a_failed_write() {
    let (result, _) = scripted(
        Ok(DISABLED),
        Err(AclPolicyError::PrivilegeRestoreFailed),
        false,
        ERROR_INVALID_OWNER,
    );
    assert_eq!(result, Err(AclPolicyError::PrivilegeRestoreFailed));
}

#[test]
fn a_panicking_effect_still_writes_the_prior_state_back() {
    let log = RefCell::new(Vec::new());
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let lock = Mutex::new(());
        let serialised = admit_privilege_window(&lock).expect("a fresh lock admits");
        let mut token = Scripted {
            log: &log,
            enable: Ok(DISABLED),
            restore: Ok(()),
            enabled_after_restore: false,
        };
        let _ = run_in_restore_privilege_window(&serialised, &mut token, || {
            panic!("the effect panicked inside the window")
        });
    }));
    assert!(outcome.is_err());
    assert_eq!(
        log.into_inner(),
        vec![Call::Enable, Call::Restore(DISABLED)]
    );
}

#[test]
fn exactly_one_effect_runs_per_window() {
    let log = RefCell::new(Vec::new());
    let lock = Mutex::new(());
    let serialised = admit_privilege_window(&lock).expect("a fresh lock admits");
    let mut token = Scripted {
        log: &log,
        enable: Ok(DISABLED),
        restore: Ok(()),
        enabled_after_restore: false,
    };
    let mut effects = 0;
    let result = run_in_restore_privilege_window(&serialised, &mut token, || {
        effects += 1;
        ERROR_SUCCESS
    });
    assert_eq!(result, Ok(()));
    assert_eq!(effects, 1);
}

#[test]
fn a_poisoned_window_lock_refuses_every_later_window() {
    let lock = Mutex::new(());
    let _ = catch_unwind(|| {
        let _held = lock.lock().expect("unpoisoned");
        panic!("a window panicked while holding the lock");
    });
    assert_eq!(
        admit_privilege_window(&lock).err(),
        Some(AclPolicyError::PrivilegeUnavailable)
    );
}

// ------------------------------------------------------------------ PreviousState decoding

fn previous(count: u32, low: u32, attributes: u32) -> TOKEN_PRIVILEGES {
    TOKEN_PRIVILEGES {
        PrivilegeCount: count,
        Privileges: [LUID_AND_ATTRIBUTES {
            Luid: LUID {
                LowPart: low,
                HighPart: 0,
            },
            Attributes: attributes,
        }],
    }
}

#[test]
fn previous_state_is_decoded_only_when_windows_describes_exactly_this_privilege() {
    let luid = LUID {
        LowPart: 18,
        HighPart: 0,
    };
    // Windows lists only what it CHANGED: nothing means it was already enabled.
    assert_eq!(
        decode_previous(&previous(0, 0, 0), luid),
        Some(PriorPrivilege::AlreadyEnabled)
    );
    // One entry for THIS privilege carries the exact attributes it replaced.
    assert_eq!(
        decode_previous(&previous(1, 18, 0), luid),
        Some(PriorPrivilege::Changed(0))
    );
    // Another privilege, or more than was requested, is not a state this window can restore.
    assert_eq!(decode_previous(&previous(1, 17, 0), luid), None);
    assert_eq!(decode_previous(&previous(2, 18, 0), luid), None);
}

// ------------------------------------------------------------------------ source shape

#[test]
fn the_only_ownership_write_is_inside_the_window_and_the_privilege_is_fixed() {
    let source = include_str!("../windows.rs");
    let production: String = source[..source
        .find("mod privilege_tests;")
        .expect("the test module is declared at the end")]
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(production.matches("SetSecurityInfo(").count(), 1);
    let window = production
        .find("run_in_restore_privilege_window(&serialised, &mut privilege")
        .expect("apply_security opens a window");
    let write = production
        .find("SetSecurityInfo(")
        .expect("the write exists");
    assert!(window < write, "the write is the window's effect");

    // One privilege, named by the Windows constant; never a caller-supplied string.
    assert_eq!(production.matches("LookupPrivilegeValueW(").count(), 1);
    assert!(
        production.contains("LookupPrivilegeValueW(std::ptr::null(), SE_RESTORE_NAME, &mut luid)")
    );
    for other in ["SE_BACKUP_NAME", "SE_TAKE_OWNERSHIP_NAME", "std::env::"] {
        assert!(!production.contains(other), "{other}");
    }
}

// --------------------------------------------------------------------- REAL process token

/// Serialises the REAL-token tests in this binary across the whole test — initial state, window,
/// observation, put-back. Production windows nest inside it through `PRIVILEGE_WINDOW`.
static REAL_TOKEN_TESTS: Mutex<()> = Mutex::new(());

fn real_token_test() -> MutexGuard<'static, ()> {
    REAL_TOKEN_TESTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn open_real() -> ProcessRestorePrivilege {
    ProcessRestorePrivilege::open()
        .expect("the process token opens and SeRestorePrivilege resolves")
}

/// Force the real token's initial state. Requires the token to HOLD the privilege.
fn force(token: &mut ProcessRestorePrivilege, enabled: bool) {
    token
        .write(if enabled { SE_PRIVILEGE_ENABLED } else { 0 })
        .expect("the token must HOLD SeRestorePrivilege — run these tests elevated");
    assert_eq!(token.is_enabled(), Ok(enabled));
}

fn render(enabled: bool) -> &'static str {
    if enabled {
        "Enabled"
    } else {
        "Disabled"
    }
}

/// One real window from `initial`: returns (result, DURING, AFTER), and whether EVERY privilege of
/// the token — this one and all others — reads back as it was before.
fn real_window(initial: bool, status: u32) -> (Result<(), AclPolicyError>, bool, bool, bool) {
    let _serial = real_token_test();
    let mut token = open_real();
    let original = token.is_enabled().expect("readable");
    force(&mut token, initial);
    let before = token.snapshot().expect("readable");

    let probe = open_real();
    let mut during = None;
    let result = {
        let serialised = admit_privilege_window(&PRIVILEGE_WINDOW).expect("unpoisoned");
        run_in_restore_privilege_window(&serialised, &mut token, || {
            during = Some(probe.is_enabled());
            status
        })
    };
    let after = token.snapshot().expect("readable");
    let after_enabled = token.is_enabled().expect("readable");
    force(&mut token, original);

    println!(
        "REAL TOKEN: BEFORE={} DURING={} AFTER={} result={result:?}",
        render(initial),
        during.map_or("not observed", |d| render(d == Ok(true))),
        render(after_enabled)
    );
    (
        result,
        during == Some(Ok(true)),
        after_enabled,
        after == before,
    )
}

#[test]
fn real_token_initially_disabled_is_enabled_only_during_the_effect() {
    let (result, during, after, unchanged) = real_window(false, ERROR_SUCCESS);
    assert_eq!(result, Ok(()));
    assert!(during, "enabled DURING the effect");
    assert!(!after, "DISABLED again AFTER");
    assert!(unchanged, "no privilege differs after the window");
}

#[test]
fn real_token_initially_enabled_remains_enabled() {
    let (result, during, after, unchanged) = real_window(true, ERROR_SUCCESS);
    assert_eq!(result, Ok(()));
    assert!(during);
    assert!(after, "still ENABLED after — never blindly disabled");
    assert!(unchanged);
}

#[test]
fn real_token_failed_write_restores_the_prior_state() {
    let (result, during, after, unchanged) = real_window(false, ERROR_INVALID_OWNER);
    assert_eq!(result, Err(AclPolicyError::WindowsApiFailure));
    assert!(during);
    assert!(!after);
    assert!(unchanged);
}

/// A disposable directory under `%TEMP%`, created here and removed by the caller.
fn disposable(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-aclpriv-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the disposable directory is created");
    dir
}

/// Apply a SYSTEM-owned protected DACL through the production `apply_security`, from `initial`.
fn system_owned_from(initial: bool) {
    let _serial = real_token_test();
    let mut token = open_real();
    let original = token.is_enabled().expect("readable");
    force(&mut token, initial);
    let before = token.snapshot().expect("readable");

    let dir = disposable(if initial { "enabled" } else { "disabled" });
    let system = OwnedSid::local_system();
    let me = current_account_sid().expect("the current account resolves");
    let full = RightsClass::FullControl.mask();
    let acl = build_allow_acl(&[
        AllowEntry {
            sid: &system,
            mask: full,
        },
        AllowEntry {
            sid: &me,
            mask: full,
        },
    ])
    .expect("a well-formed ACL");

    // Every observation is taken BEFORE any assertion, so the fixture is always removed.
    let applied = apply_security(&dir, &system, &acl, SecuredObjectKind::Directory);
    let owner = read_security(&dir, SecuredObjectKind::Directory).map(|(owner, _, _)| owner);
    let after = token.snapshot().expect("readable");
    let after_enabled = token.is_enabled().expect("readable");
    force(&mut token, original);
    let _ = std::fs::remove_dir_all(&dir);

    println!(
        "SYSTEM OWNER via apply_security: BEFORE={} AFTER={} applied={applied:?}",
        render(initial),
        render(after_enabled)
    );
    assert_eq!(
        applied,
        Ok(()),
        "SYSTEM ownership applies from {}",
        render(initial)
    );
    assert_eq!(
        owner,
        Ok(Some(system.as_bytes().to_vec())),
        "Windows reads SYSTEM back"
    );
    assert_eq!(after_enabled, initial, "AFTER == BEFORE");
    assert_eq!(after, before, "no privilege differs after the write");
}

#[test]
fn system_ownership_applies_from_an_initially_disabled_privilege() {
    system_owned_from(false);
}

#[test]
fn system_ownership_applies_from_an_initially_enabled_privilege() {
    system_owned_from(true);
}

/// The handle is admitted BEFORE the window, by design: nothing but the one write runs privileged. So
/// for a target whose DACL withholds `WRITE_OWNER` from the caller, the OPEN is decided by the state
/// the process already had — refused pre-effect from DISABLED, admitted through backup semantics from
/// ENABLED. Every accepted target grants Administrators `FullControl`, so neither state reaches this
/// branch there. This pins the residual so it cannot drift silently.
#[test]
fn a_target_withholding_write_owner_is_decided_at_the_open_by_the_prior_state() {
    use crate::descriptor::AclInspection;

    let _serial = real_token_test();
    let mut token = open_real();
    let original = token.is_enabled().expect("readable");

    let system = OwnedSid::local_system();
    let me = current_account_sid().expect("the current account resolves");
    let full = RightsClass::FullControl.mask();
    let withheld = build_allow_acl(&[
        AllowEntry {
            sid: &system,
            mask: full,
        },
        AllowEntry {
            sid: &me,
            mask: RightsClass::Read.mask(),
        },
    ])
    .expect("a well-formed ACL");
    let granted = build_allow_acl(&[
        AllowEntry {
            sid: &system,
            mask: full,
        },
        AllowEntry {
            sid: &me,
            mask: full,
        },
    ])
    .expect("a well-formed ACL");
    let inspect = |dir: &Path| {
        read_security(dir, SecuredObjectKind::Directory).and_then(|(owner, control, dacl)| {
            AclInspection::from_raw(owner.as_deref(), control, dacl)
        })
    };

    let mut outcomes = Vec::new();
    for initial in [false, true] {
        let dir = disposable(if initial {
            "withheld-enabled"
        } else {
            "withheld-disabled"
        });
        // SYSTEM owns it and the caller may only READ: WRITE_OWNER is withheld by the DACL.
        let setup = apply_security(&dir, &system, &withheld, SecuredObjectKind::Directory);
        force(&mut token, initial);
        let before = inspect(&dir);
        let second = apply_security(&dir, &system, &granted, SecuredObjectKind::Directory);
        let after_enabled = token.is_enabled();
        let unchanged = inspect(&dir) == before;
        // Empty, and the %TEMP% parent grants the caller DELETE_CHILD, so this removes it either way.
        let _ = std::fs::remove_dir(&dir);
        outcomes.push((initial, setup, second, after_enabled, unchanged));
    }
    force(&mut token, original);

    for (initial, setup, second, after_enabled, unchanged) in &outcomes {
        println!(
            "WITHHELD WRITE_OWNER: prior={} setup={setup:?} second={second:?} AFTER={after_enabled:?} descriptor_unchanged={unchanged}",
            render(*initial)
        );
    }
    let (_, setup, second, after, unchanged) = outcomes[0];
    assert_eq!(setup, Ok(()));
    assert_eq!(
        second,
        Err(AclPolicyError::AccessDenied),
        "refused at the OPEN"
    );
    assert_eq!(after, Ok(false), "DISABLED AFTER == BEFORE");
    assert!(unchanged, "pre-effect: the descriptor is untouched");
    let (_, setup, second, after, _) = outcomes[1];
    assert_eq!(setup, Ok(()));
    assert_eq!(
        second,
        Ok(()),
        "the ambient-enabled residual: backup semantics admit the open"
    );
    assert_eq!(after, Ok(true), "ENABLED AFTER == BEFORE");
}

#[test]
fn an_impersonating_thread_is_refused_before_anything_is_enabled() {
    use windows_sys::Win32::Security::{ImpersonateSelf, RevertToSelf, SecurityImpersonation};

    let refused = std::thread::spawn(|| {
        // SAFETY: impersonates on THIS spawned thread only, and reverts before the thread returns.
        assert_ne!(unsafe { ImpersonateSelf(SecurityImpersonation) }, 0);
        let opened = ProcessRestorePrivilege::open().map(|_| ());
        // SAFETY: ends this thread's impersonation; no preconditions.
        assert_ne!(unsafe { RevertToSelf() }, 0);
        opened
    })
    .join()
    .expect("the probe thread completes");
    assert_eq!(refused, Err(AclPolicyError::PrivilegeUnavailable));
}
