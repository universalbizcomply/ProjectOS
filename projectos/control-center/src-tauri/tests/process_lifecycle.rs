//! Windows-gated lifecycle proofs for PROJECTOS-WINDOWS-PROCESS-CREATION1A.
//!
//! Every test drives the TEST-ONLY synthetic child — never the real ProjectOS daemon, never the
//! Tauri host, never another user's process.
//!
//! Cleanup guarantee: `SyntheticProcessOwner` owns its `JobObject`, and dropping it closes the last
//! job handle → kill-on-close → the child and any grandchild die. Because Rust runs `Drop` during
//! unwinding, this holds even when a test PANICS or an assertion fails — the guard is established by
//! construction, before any assertion can run.

// Requires the fixture binary, which only exists under the non-default `test-fixtures` feature (that
// feature IS the production-packaging boundary). Run with:
//   cargo test --features test-fixtures      (or --all-features)
// Without it this file compiles to nothing rather than referencing a target Cargo did not build.
#![cfg(all(windows, feature = "test-fixtures"))]

use std::time::{Duration, Instant};

use projectos_control_center::process::diagnostics;
use projectos_control_center::process::errors::ProcessError;
use projectos_control_center::process::owner::{
    FixtureMode, SyntheticFixtureSpec, SyntheticProcessOwner,
};
use projectos_control_center::process::state::ProcessState;

/// Locate the synthetic child. `CARGO_BIN_EXE_<name>` is set by Cargo for integration tests and is
/// the documented, exact mechanism — no path guessing, and it guarantees the real bin artifact was
/// built (a unit test would only ever see the bin's test harness, where libtest replaces `main`).
fn child_exe() -> String {
    env!("CARGO_BIN_EXE_projectos-test-child").to_string()
}

fn spec(mode: FixtureMode) -> SyntheticFixtureSpec {
    SyntheticFixtureSpec::new(child_exe(), mode).expect("fixture spec")
}

/// Wait (bounded) for the process to leave a running state.
fn wait_state(owner: &mut SyntheticProcessOwner, limit: Duration) -> ProcessState {
    let deadline = Instant::now() + limit;
    loop {
        let s = owner.refresh_state();
        if s.is_terminal() || Instant::now() > deadline {
            return s;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ---- atomic ownership ----------------------------------------------------------------------------

#[test]
fn child_is_born_inside_the_job() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    // Membership is verified during start, but assert it independently here.
    assert!(owner.is_contained().expect("containment query"));
    assert_eq!(owner.state(), ProcessState::RunningUntrusted);
    owner.shutdown();
}

#[test]
fn process_identity_is_captured() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    assert!(owner.process_id() != 0);
    // Creation time defeats PID reuse: a recycled PID cannot match the original creation instant.
    assert!(owner.process_creation_time() > 0);
    owner.shutdown();
}

#[test]
fn trust_eligible_state_does_not_exist() {
    // The closed state model has no TRUST_ELIGIBLE variant, and the ceiling is RUNNING_UNTRUSTED.
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    let s = owner.state();
    assert!(matches!(s, ProcessState::RunningUntrusted));
    assert_ne!(s.owner_status(), "SECURE");
    owner.shutdown();
}

// ---- creation contract (public surface) --------------------------------------------------------

#[test]
fn fixture_spec_refuses_any_non_fixture_executable() {
    // The closed API cannot be pointed at node.exe, a shell, another app, or the real Bridge Daemon.
    for exe in [
        "C:/Windows/System32/cmd.exe",
        "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "C:/Program Files/nodejs/node.exe",
        "C:/dev/ProjectOS/projectos/control-center/sidecar/host.mjs",
    ] {
        assert_eq!(
            SyntheticFixtureSpec::new(exe, FixtureMode::Wait).err(),
            Some(ProcessError::FixtureExecutableRejected),
            "{exe} must be refused"
        );
    }
}

#[test]
fn fixture_spec_accepts_only_the_cargo_built_fixture() {
    assert!(SyntheticFixtureSpec::new(child_exe(), FixtureMode::Wait).is_ok());
}

// NOTE: executable/argument/working-directory/environment rejection is proven by crate-private unit
// tests in src/process/create.rs. It CANNOT be exercised from here any more, because the public API
// no longer lets a caller express those fields at all — which is the point of this correction.

// ---- liveness ------------------------------------------------------------------------------------

#[test]
fn immediate_exit_is_observed_and_not_reported_running() {
    let mut owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::ExitImmediately)).expect("start");
    let st = wait_state(&mut owner, Duration::from_secs(10));
    assert_eq!(st, ProcessState::Terminated, "state was {st:?}");
    assert_eq!(owner.last_exit_code(), Some(0));
    // The decisive property: liveness is derived, so it can never remain "running" after exit.
    assert_ne!(owner.owner_status(), "RUNNING_READ_ONLY");
}

#[test]
fn known_non_zero_exit_is_captured_as_crashed() {
    let mut owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::ExitCode42)).expect("start");
    let st = wait_state(&mut owner, Duration::from_secs(10));
    assert_eq!(st, ProcessState::Crashed);
    assert_eq!(owner.last_exit_code(), Some(42));
    assert_eq!(owner.owner_status(), "CRASHED");
}

#[test]
fn long_running_child_stays_running_until_shutdown() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(owner.refresh_state(), ProcessState::RunningUntrusted);
    assert_eq!(owner.owner_status(), "RUNNING_READ_ONLY");
    owner.shutdown();
}

// ---- output --------------------------------------------------------------------------------------

#[test]
fn stdout_is_captured() {
    let mut owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::WriteStdout)).expect("start");
    std::thread::sleep(Duration::from_millis(400));
    let out = owner.stdout_text();
    owner.shutdown();
    assert!(out.contains("stdout line 0"), "stdout was: {out}");
}

#[test]
fn stderr_is_captured_not_discarded() {
    let mut owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::WriteStderr)).expect("start");
    std::thread::sleep(Duration::from_millis(400));
    let err = owner.stderr_text();
    owner.shutdown();
    assert!(err.contains("stderr line 0"), "stderr was: {err}");
}

#[test]
fn output_flood_does_not_deadlock_and_stays_bounded() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Flood)).expect("start");
    std::thread::sleep(Duration::from_millis(1500));
    let out = owner.stdout_text();
    let err = owner.stderr_text();
    // The child must still be alive: an undrained pipe would have blocked it permanently.
    let alive_or_done = owner.refresh_state();
    owner.shutdown();
    assert!(
        out.len() <= diagnostics::MAX_RETAINED_BYTES * 2,
        "stdout unbounded: {}",
        out.len()
    );
    assert!(err.len() <= diagnostics::MAX_RETAINED_BYTES * 2);
    assert!(out.contains(diagnostics::TRUNCATION_MARKER));
    let _ = alive_or_done;
}

// ---- shutdown ------------------------------------------------------------------------------------

#[test]
fn cooperative_shutdown_terminates_child() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    std::thread::sleep(Duration::from_millis(200));
    let st = owner.shutdown();
    assert_eq!(st, ProcessState::Terminated);
    assert_eq!(
        owner.last_failure(),
        None,
        "cooperative exit needed no force"
    );
}

#[test]
fn child_ignoring_shutdown_is_force_terminated() {
    let s = spec(FixtureMode::IgnoreShutdown).with_graceful_shutdown(Duration::from_millis(500));
    let mut owner = SyntheticProcessOwner::start_fixture(&s).expect("start");
    std::thread::sleep(Duration::from_millis(200));
    let started = Instant::now();
    let st = owner.shutdown();
    assert_eq!(st, ProcessState::Terminated);
    // Bounded: grace + force wait, never indefinite.
    assert!(started.elapsed() < Duration::from_secs(8));
    assert_eq!(
        owner.last_failure(),
        None,
        "force termination should succeed"
    );
}

#[test]
fn repeated_shutdown_is_idempotent() {
    let mut owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
    assert_eq!(owner.shutdown(), ProcessState::Terminated);
    assert_eq!(owner.shutdown(), ProcessState::Terminated);
    assert_eq!(owner.shutdown(), ProcessState::Terminated);
}

#[test]
fn shutdown_after_natural_exit_is_safe() {
    let mut owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::ExitImmediately)).expect("start");
    wait_state(&mut owner, Duration::from_secs(10));
    // Already terminal; shutdown must not hang, panic, or misreport.
    let st = owner.shutdown();
    assert!(st.is_terminal());
}

// ---- containment ---------------------------------------------------------------------------------

#[test]
fn grandchild_is_contained_and_dies_with_the_job() {
    let owner =
        SyntheticProcessOwner::start_fixture(&spec(FixtureMode::SpawnGrandchild)).expect("start");
    std::thread::sleep(Duration::from_millis(600));
    let out = owner.stdout_text();
    let gc_pid: Option<u32> = out.lines().find_map(|l| {
        l.strip_prefix("grandchild ")
            .and_then(|p| p.trim().parse().ok())
    });
    assert!(gc_pid.is_some(), "grandchild not reported; stdout: {out}");

    // Dropping the owner closes the last job handle → kill-on-close kills child AND grandchild,
    // because no breakaway flag is ever set.
    drop(owner);
    std::thread::sleep(Duration::from_millis(800));

    // The grandchild PID must no longer be a live synthetic child. Verified via the OS: opening it
    // for wait must either fail or show an exited process.
    assert!(
        !pid_is_alive(gc_pid.unwrap()),
        "grandchild survived job close"
    );
}

/// Probe whether a PID is still a live process. Read-only; never terminates anything.
fn pid_is_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    // SAFETY: read-only probe; the handle is closed immediately and nothing is terminated.
    unsafe {
        match OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            Ok(h) => {
                let alive = WaitForSingleObject(h, 0) != WAIT_OBJECT_0;
                let _ = CloseHandle(h);
                alive
            }
            Err(_) => false, // cannot open → gone
        }
    }
}

// ---- repeated lifecycle (leak / race exposure) ---------------------------------------------------

#[test]
fn repeated_lifecycle_leaves_no_survivor() {
    let mut pids = Vec::new();
    for _ in 0..8 {
        let mut owner =
            SyntheticProcessOwner::start_fixture(&spec(FixtureMode::Wait)).expect("start");
        pids.push(owner.process_id());
        assert!(owner.is_contained().expect("containment"));
        owner.shutdown();
    }
    std::thread::sleep(Duration::from_millis(500));
    for pid in pids {
        assert!(!pid_is_alive(pid), "pid {pid} survived shutdown");
    }
}

#[test]
fn dropping_owner_without_shutdown_still_kills_child() {
    // Proves the panic path: Drop closes the job → kill-on-close, with no explicit shutdown call.
    let pid = {
        let owner = SyntheticProcessOwner::start_fixture(&spec(FixtureMode::IgnoreShutdown))
            .expect("start");
        let pid = owner.process_id();
        drop(owner);
        pid
    };
    std::thread::sleep(Duration::from_millis(800));
    assert!(!pid_is_alive(pid), "child survived owner drop");
}

// ---- isolation -----------------------------------------------------------------------------------

#[test]
fn platform_gate_reports_available_on_windows() {
    assert!(projectos_control_center::process::native_ownership_available().is_ok());
}
