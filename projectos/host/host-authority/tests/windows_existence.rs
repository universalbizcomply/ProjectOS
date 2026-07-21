//! Synthetic Windows existence-token proofs (feature `test-fixtures`, Windows only).
//!
//! Every object name is a TEST-ONLY name — never the production authority name. Same-process proofs:
//! atomic create-or-open exclusivity, handle-close release, wrong-object-type, and empty-DACL
//! AccessDenied. Same-user MULTIPROCESS proofs (§7–§9): a controlled child process — the SAME
//! integration-test executable re-invoked in an explicit child mode via `--exact` — proves (a) a
//! contender sees `ExistingToken` and is non-authoritative, and (b) forcibly terminating a child
//! OWNER releases the token purely by kernel handle lifetime, so the parent reacquires.
//!
//! This is the ONLY file authorised to launch a process, and it launches ONLY the test executable in
//! child mode. No production executable, no service, no cross-user/cross-session proof, no IPC, no
//! shell interpolation. Every child is always reaped (a `Drop` guard force-terminates + reaps even on
//! panic), so no orphan process and no stale object survives.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use projectos_host_authority::windows_proof as wp;
use projectos_host_authority::AuthorityTokenOutcome;
use wp::{
    acquire_existence_token, create_colliding_event, is_test_object_name, synthetic_object_name,
    MachineWideAuthoritySecurity, WindowsTokenAcquisition,
};

// Child-mode contract (env-only; no shell, no positional interpolation).
const ENV_MODE: &str = "HOSTAUTH_CHILD_MODE";
const ENV_NAME: &str = "HOSTAUTH_TEST_OBJECT_NAME";
const MODE_CONTENDER: &str = "contender";
const MODE_OWNER: &str = "owner";

// Distinct child exit codes → a closed, typed result the parent can classify.
const EXIT_OK: i32 = 0;
const EXIT_BAD_NAME: i32 = 11; // parent-supplied name failed the child's independent test-prefix check
const EXIT_TRUSTED_BUG: i32 = 12; // an ExistingToken was (wrongly) reported as confirmed authority
const EXIT_UNEXPECTED_ACQUIRE: i32 = 13; // contender acquired when the parent should hold the token
const EXIT_REFUSED: i32 = 14; // contender was refused
const EXIT_OWNER_NOT_ACQUIRED: i32 = 15; // owner child failed to acquire a fresh token
const EXIT_BAD_MODE: i32 = 16;

fn machine_wide_security() -> MachineWideAuthoritySecurity {
    MachineWideAuthoritySecurity::build_v1(None).expect("machine-wide descriptor builds")
}

/// If invoked as a child (the mode env var is set), run the child behaviour and NEVER return — the
/// process exits with a typed code. In the parent (no env var) this returns immediately.
fn maybe_run_as_child() {
    let mode = match std::env::var(ENV_MODE) {
        Ok(m) => m,
        Err(_) => return, // parent
    };
    let name = std::env::var(ENV_NAME).unwrap_or_default();

    // The child INDEPENDENTLY validates the test prefix before touching any object — it never trusts
    // the parent-supplied name, and can never reach a production authority name.
    if !is_test_object_name(&name) {
        std::process::exit(EXIT_BAD_NAME);
    }
    let sec = machine_wide_security();

    match mode.as_str() {
        MODE_CONTENDER => {
            let acq = acquire_existence_token(&name, &sec);
            let outcome = acq.outcome();
            match acq {
                WindowsTokenAcquisition::Existing => {
                    // Confirm the existing token is NOT confirmed authority (no guard, no trust).
                    if outcome.is_confirmed_authority() {
                        std::process::exit(EXIT_TRUSTED_BUG);
                    }
                    std::process::exit(EXIT_OK);
                }
                WindowsTokenAcquisition::Acquired(_) => std::process::exit(EXIT_UNEXPECTED_ACQUIRE),
                WindowsTokenAcquisition::Refused(_) => std::process::exit(EXIT_REFUSED),
            }
        }
        MODE_OWNER => {
            // Acquire a FRESH token and HOLD it (bounded) until the parent forcibly terminates us.
            match acquire_existence_token(&name, &sec) {
                WindowsTokenAcquisition::Acquired(_guard) => {
                    // Hold the guard alive. The parent detects readiness by observing ExistingToken and
                    // then kills us. The bounded loop is only a safety net so an abandoned child (parent
                    // failure) can never linger indefinitely.
                    let deadline = Instant::now() + Duration::from_secs(60);
                    while Instant::now() < deadline {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    std::process::exit(EXIT_OK);
                }
                _ => std::process::exit(EXIT_OWNER_NOT_ACQUIRED),
            }
        }
        _ => std::process::exit(EXIT_BAD_MODE),
    }
}

/// A child test process that is ALWAYS force-terminated and reaped — on explicit call or on drop
/// (including panic unwinding) — so no orphan process survives.
struct ChildGuard {
    child: Child,
    reaped: bool,
}

impl ChildGuard {
    /// Launch the SAME integration-test executable in `mode`, running only `test_name` (`--exact`), with
    /// the object name passed via environment (no shell, no positional interpolation).
    fn spawn(test_name: &str, mode: &str, obj_name: &str) -> Self {
        let exe = std::env::current_exe().expect("current test executable path");
        let child = Command::new(exe)
            .arg(test_name)
            .arg("--exact")
            .arg("--test-threads=1")
            .env(ENV_MODE, mode)
            .env(ENV_NAME, obj_name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .expect("spawn child test process");
        ChildGuard {
            child,
            reaped: false,
        }
    }

    /// Wait up to `timeout` for the child to exit on its own; `None` on timeout.
    fn wait_bounded(&mut self, timeout: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            match self.child.try_wait().expect("try_wait on child") {
                Some(status) => {
                    self.reaped = true;
                    return Some(status);
                }
                None => {
                    if Instant::now() >= deadline {
                        return None;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        }
    }

    /// Forcibly terminate the child and reap it (bounded). Idempotent.
    fn kill_and_reap(&mut self) {
        let _ = self.child.kill();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    self.reaped = true;
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        // Last resort: blocking wait so we never leave an orphan.
                        let _ = self.child.wait();
                        self.reaped = true;
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => {
                    self.reaped = true;
                    return;
                }
            }
        }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        // Guarantee no orphan even on panic: kill (harmless if already exited) then reap.
        if !self.reaped {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// Poll acquisition until an `ExistingToken` is observed (i.e. the child owner holds it), without the
/// parent ever retaining the token: any `Acquired` result is dropped immediately and polling continues.
fn poll_until_existing(name: &str, sec: &MachineWideAuthoritySecurity, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match acquire_existence_token(name, sec) {
            WindowsTokenAcquisition::Existing => return true,
            WindowsTokenAcquisition::Acquired(_guard) => { /* drop, release, keep polling */ }
            WindowsTokenAcquisition::Refused(_) => {}
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// Poll acquisition until `AcquiredToken` (the object is gone → reacquirable). Any acquired guard is
/// dropped immediately so nothing leaks.
fn poll_until_acquired(name: &str, sec: &MachineWideAuthoritySecurity, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let WindowsTokenAcquisition::Acquired(_guard) = acquire_existence_token(name, sec) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn first_create_acquires_and_second_same_process_is_existing_and_untrusted() {
    let sec = machine_wide_security();
    let name = synthetic_object_name("first-second");

    let first = acquire_existence_token(&name, &sec);
    assert!(
        matches!(first, WindowsTokenAcquisition::Acquired(_)),
        "first must acquire"
    );

    let second = acquire_existence_token(&name, &sec);
    assert!(
        matches!(second, WindowsTokenAcquisition::Existing),
        "second must be existing"
    );
    assert_eq!(second.outcome(), AuthorityTokenOutcome::ExistingToken);
    // The core no-trust rule: an existing token is never, on its own, confirmed authority.
    assert!(!second.outcome().is_confirmed_authority());
}

#[test]
fn closing_the_handle_releases_authority_and_permits_reacquisition() {
    // Release is purely handle-close (no ReleaseMutex); handles are process-owned. Here we exercise the
    // same path via an explicit drop; the cross-process crash variant is proven below.
    let sec = machine_wide_security();
    let name = synthetic_object_name("drop-reacquire");

    let first = acquire_existence_token(&name, &sec);
    assert!(matches!(first, WindowsTokenAcquisition::Acquired(_)));
    drop(first);

    let again = acquire_existence_token(&name, &sec);
    assert!(
        matches!(again, WindowsTokenAcquisition::Acquired(_)),
        "authority must be reacquirable after the handle closes"
    );
}

#[test]
fn a_name_held_by_a_different_object_type_is_a_scope_collision() {
    let sec = machine_wide_security();
    let name = synthetic_object_name("wrong-type");

    let event = create_colliding_event(&name).expect("colliding event must create");
    let outcome = acquire_existence_token(&name, &sec);
    assert!(
        matches!(
            outcome,
            WindowsTokenAcquisition::Refused(
                projectos_host_authority::AuthorityRefusal::ScopeCollision
            )
        ),
        "a wrong-object-type name must be a ScopeCollision, got {outcome:?}"
    );
    drop(event);
}

#[test]
fn an_empty_dacl_denies_a_second_acquisition() {
    // An empty (protected) DACL grants nobody anything; the owner's implicit rights do not include
    // SYNCHRONIZE, so a second create-or-open is denied while the first holder keeps the object alive.
    let deny_all =
        MachineWideAuthoritySecurity::build_empty_dacl_for_test().expect("empty DACL builds");
    let name = synthetic_object_name("empty-dacl-denied");

    let held = acquire_existence_token(&name, &deny_all);
    assert!(
        matches!(held, WindowsTokenAcquisition::Acquired(_)),
        "creator acquires"
    );

    let second = acquire_existence_token(&name, &deny_all);
    assert!(
        matches!(
            second,
            WindowsTokenAcquisition::Refused(
                projectos_host_authority::AuthorityRefusal::AccessDenied
            )
        ),
        "an empty DACL must deny the second acquisition, got {second:?}"
    );
    drop(held);
}

#[test]
fn same_user_multiprocess_contention_sees_existing_and_non_authoritative() {
    // §8 SAME_USER_MULTIPROCESS_CONTENTION_PROVEN.
    maybe_run_as_child(); // no-op in the parent; the child branch never returns here.

    let sec = machine_wide_security();
    let name = synthetic_object_name("mp-contention");

    // 1–2. Parent holds the sole token.
    let held = acquire_existence_token(&name, &sec);
    assert!(
        matches!(held, WindowsTokenAcquisition::Acquired(_)),
        "parent must acquire the sole token"
    );

    // 3–8. Child contender attempts the same name → must report ExistingToken, no guard, not
    // authoritative, then exit 0 (encoded by the child).
    let mut child = ChildGuard::spawn(
        "same_user_multiprocess_contention_sees_existing_and_non_authoritative",
        MODE_CONTENDER,
        &name,
    );
    let status = child
        .wait_bounded(Duration::from_secs(30))
        .expect("child contender must complete within the bound");
    assert_eq!(
        status.code(),
        Some(EXIT_OK),
        "contender must confirm ExistingToken + non-authoritative (exit 0), got {status:?}"
    );

    // 9–12. Reap (already reaped), release, reacquire; object then disappears.
    drop(child);
    drop(held);
    let again = acquire_existence_token(&name, &sec);
    assert!(
        matches!(again, WindowsTokenAcquisition::Acquired(_)),
        "parent must reacquire after releasing"
    );
}

#[test]
fn same_user_child_crash_release_frees_the_token_by_handle_lifetime() {
    // §9 SAME_USER_CHILD_CRASH_RELEASE_PROVEN. Relies solely on kernel handle lifetime — no
    // ReleaseMutex, no WaitForSingleObject ownership, no thread ownership.
    maybe_run_as_child(); // no-op in the parent.

    let sec = machine_wide_security();
    let name = synthetic_object_name("mp-crash");

    // 1–4. Child OWNER acquires and holds. Readiness = the parent observing ExistingToken.
    let mut child = ChildGuard::spawn(
        "same_user_child_crash_release_frees_the_token_by_handle_lifetime",
        MODE_OWNER,
        &name,
    );
    let ready = poll_until_existing(&name, &sec, Duration::from_secs(15));
    assert!(
        ready,
        "child owner must acquire the token (parent observes ExistingToken) within the bound"
    );

    // 5–8. Forcibly terminate the child WITHOUT graceful release, then confirm reaping.
    child.kill_and_reap();

    // 9–12. The kernel releases the object on child death → parent reacquires; no stale object, no
    // orphan process.
    let reacquired = poll_until_acquired(&name, &sec, Duration::from_secs(15));
    assert!(
        reacquired,
        "kernel must release the token on child death → parent reacquires"
    );
    drop(child); // idempotent reap; guarantees no orphan.
}
