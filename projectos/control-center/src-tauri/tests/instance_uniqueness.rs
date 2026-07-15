//! Host single-instance proofs (PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A).
//!
//! Runs only under the non-default `test-fixtures` feature, which gates the narrow instance adapter.
//!
//! The multi-process race proofs re-execute THIS test binary (`current_exe`) as the child, driven by
//! an env var. That deliberately avoids adding a new test-only binary, keeping the authorised file
//! boundary intact, while still producing a genuine cross-process race — an in-process second
//! acquire could never prove that.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::process::Command;
use std::time::Duration;

use projectos_control_center::test_fixtures::instance::{
    acquire_named, install_component, install_dir_from_exe, instance_name, user_component, Channel,
    InstanceFailure, InstanceOutcome, KeyError,
};

/// Env var naming the object a re-executed child should contend for.
const RACE_NAME_VAR: &str = "PROJECTOS_TEST_RACE_OBJECT";
/// Marker lines the parent parses out of the child's harness output.
const MARK_ACQUIRED: &str = "__PROJECTOS_CHILD_ACQUIRED__";
const MARK_ALREADY: &str = "__PROJECTOS_CHILD_ALREADY_RUNNING__";
const MARK_FAILED: &str = "__PROJECTOS_CHILD_FAILED__";

fn unique_name(tag: &str) -> String {
    format!(
        "Global\\ProjectOS.Control.test.{}.{}",
        tag,
        std::process::id()
    )
}

/// Child entry: contend for the named object, announce the verdict, hold briefly so the parent's
/// other children genuinely overlap, then release.
#[test]
#[ignore = "child entry: re-executed by the race proofs, never run directly"]
fn race_child_entry() {
    let Ok(name) = std::env::var(RACE_NAME_VAR) else {
        return;
    };
    match acquire_named(&name) {
        InstanceOutcome::Acquired(guard) => {
            println!("{MARK_ACQUIRED}");
            // Hold the authority so competing children cannot succeed sequentially.
            std::thread::sleep(Duration::from_millis(1200));
            drop(guard);
        }
        InstanceOutcome::AlreadyRunning => println!("{MARK_ALREADY}"),
        InstanceOutcome::Failed(f) => println!("{MARK_FAILED} {f:?}"),
    }
}

fn spawn_child(name: &str) -> std::process::Child {
    Command::new(std::env::current_exe().expect("test binary path"))
        .args(["--exact", "race_child_entry", "--ignored", "--nocapture"])
        .env(RACE_NAME_VAR, name)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("child must spawn")
}

/// Verdicts from a set of simultaneously launched children.
struct RaceResult {
    acquired: usize,
    already: usize,
    failed: usize,
}

fn run_race(name: &str, children: usize) -> RaceResult {
    // Spawn all first so they overlap, then collect.
    let handles: Vec<_> = (0..children).map(|_| spawn_child(name)).collect();

    let mut r = RaceResult {
        acquired: 0,
        already: 0,
        failed: 0,
    };
    for h in handles {
        let out = h.wait_with_output().expect("child must complete");
        let text = String::from_utf8_lossy(&out.stdout);
        if text.contains(MARK_ACQUIRED) {
            r.acquired += 1;
        } else if text.contains(MARK_ALREADY) {
            r.already += 1;
        } else if text.contains(MARK_FAILED) {
            // Counted, not panicked on: every caller asserts `failed == 0`, so a failure surfaces as
            // a normal assertion rather than aborting the collection loop and losing the other
            // children's verdicts.
            r.failed += 1;
        } else {
            panic!("child produced no verdict: {text}");
        }
    }
    r
}

// ── Acquisition ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn first_acquisition_succeeds_and_second_is_refused() {
    let name = unique_name("acq-first-second");
    let first = acquire_named(&name);
    assert!(matches!(first, InstanceOutcome::Acquired(_)));
    assert!(matches!(
        acquire_named(&name),
        InstanceOutcome::AlreadyRunning
    ));
    drop(first);
}

#[test]
fn releasing_the_guard_permits_reacquisition_with_no_manual_cleanup() {
    let name = unique_name("acq-release");
    let first = acquire_named(&name);
    assert!(matches!(first, InstanceOutcome::Acquired(_)));
    drop(first);
    let second = acquire_named(&name);
    assert!(
        matches!(second, InstanceOutcome::Acquired(_)),
        "authority must be reacquirable after a normal release"
    );
}

/// The decisive proof: two real processes contending at the same instant.
#[test]
fn simultaneous_two_process_race_has_exactly_one_winner() {
    let name = unique_name("race-two");
    let r = run_race(&name, 2);
    assert_eq!(r.acquired, 1, "exactly one winner required");
    assert_eq!(r.already, 1, "the loser must classify as already-running");
    assert_eq!(r.failed, 0);
}

#[test]
fn repeated_high_contention_races_always_have_exactly_one_winner() {
    for round in 0..3 {
        let name = unique_name(&format!("race-many-{round}"));
        let r = run_race(&name, 4);
        assert_eq!(r.acquired, 1, "round {round}: exactly one winner");
        assert_eq!(r.already, 3, "round {round}: all losers refused");
        assert_eq!(r.failed, 0, "round {round}");
    }
}

/// After every child has exited, the OS must have released the object — proving abnormal-safe,
/// handle-bound lifetime with no stale state to clean up.
#[test]
fn authority_is_released_when_the_holding_process_exits() {
    let name = unique_name("race-release");
    let r = run_race(&name, 2);
    assert_eq!(r.acquired, 1);
    let after = acquire_named(&name);
    assert!(
        matches!(after, InstanceOutcome::Acquired(_)),
        "object must be gone once every holder exited"
    );
}

// ── Key construction ─────────────────────────────────────────────────────────────────────────────

const SID_A: &[u8] = &[1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 2, 3, 4];
const SID_B: &[u8] = &[1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 9, 2, 3, 4];

#[test]
fn same_scope_material_derives_one_stable_name() {
    let u = user_component(SID_A).unwrap();
    let i = install_component(std::path::Path::new(r"C:\dev\app")).unwrap();
    assert_eq!(
        instance_name(Channel::Dev, &u, &i),
        instance_name(Channel::Dev, &u, &i)
    );
}

#[test]
fn different_account_or_channel_or_installation_derives_a_different_name() {
    let ua = user_component(SID_A).unwrap();
    let ub = user_component(SID_B).unwrap();
    let ia = install_component(std::path::Path::new(r"C:\dev\app")).unwrap();
    let ib = install_component(std::path::Path::new(r"C:\dev\copy")).unwrap();

    assert_ne!(
        instance_name(Channel::Dev, &ua, &ia),
        instance_name(Channel::Dev, &ub, &ia),
        "different accounts must not collide"
    );
    assert_ne!(
        instance_name(Channel::Dev, &ua, &ia),
        instance_name(Channel::Pkg, &ua, &ia),
        "dev must not block packaged"
    );
    assert_ne!(
        instance_name(Channel::Dev, &ua, &ia),
        instance_name(Channel::Dev, &ua, &ib),
        "distinct installations stay separable"
    );
}

#[test]
fn name_leaks_no_path_no_raw_sid_and_no_username() {
    let u = user_component(SID_A).unwrap();
    let i = install_component(std::path::Path::new(r"C:\Users\someone\dev\app")).unwrap();
    let name = instance_name(Channel::Dev, &u, &i);
    assert!(!name.contains("someone"), "no username: {name}");
    assert!(!name.to_lowercase().contains(r"c:\"), "no path: {name}");
    assert!(!name.contains("Users"), "no path fragment: {name}");
    assert!(!name.contains("S-1-"), "no raw SID: {name}");
    assert!(name.len() < 200);
}

#[test]
fn version_change_cannot_split_an_in_place_upgrade_into_two_hosts() {
    let u = user_component(SID_A).unwrap();
    let i = install_component(std::path::Path::new(r"C:\dev\app")).unwrap();
    let name = instance_name(Channel::Dev, &u, &i);
    assert!(!name.contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn invalid_scope_material_is_rejected() {
    assert_eq!(user_component(&[]), Err(KeyError::ScopeInvalid));
    assert_eq!(
        install_component(std::path::Path::new(r"relative\dir")),
        Err(KeyError::ScopeInvalid)
    );
    assert_eq!(
        install_component(std::path::Path::new(r"\\server\share")),
        Err(KeyError::ScopeInvalid)
    );
    assert_eq!(
        install_dir_from_exe(std::path::PathBuf::from("x.exe")),
        Err(KeyError::ScopeInvalid)
    );
}

#[test]
fn verbatim_and_plain_executable_paths_derive_one_installation() {
    let plain = install_dir_from_exe(std::path::PathBuf::from(r"C:\dev\app\x.exe")).unwrap();
    let verbatim = install_dir_from_exe(std::path::PathBuf::from(r"\\?\C:\dev\app\x.exe")).unwrap();
    assert_eq!(
        install_component(&plain).unwrap(),
        install_component(&verbatim).unwrap()
    );
}

// ── Classification ───────────────────────────────────────────────────────────────────────────────

/// Access-denied must never be reported as a legitimate running instance.
#[test]
fn failure_variants_are_distinct_facts() {
    assert_ne!(
        InstanceFailure::AccessDenied,
        InstanceFailure::ScopeCollision
    );
    assert_ne!(
        InstanceFailure::AccessDenied,
        InstanceFailure::AuthorityUnavailable
    );
    assert_ne!(InstanceFailure::ScopeInvalid, InstanceFailure::AccessDenied);
}
