//! Startup/exit interlock proofs (RECOVERY-BARRIER1B §5/§9/§10/§11).
//!
//! Proves, against the real `DaemonLifecycleState`, that:
//!  - the startup worker is retained and joined — never detached, even on panic;
//!  - exactly one shutdown claimant exists under concurrent close events;
//!  - after the launch gate closes, no creation and no resume can begin;
//!  - owner-absence is only trusted after the worker is proven terminal;
//!  - a full startup racing an immediate shutdown always converges to zero daemons, with the
//!    final evidence state terminal (`stopped`) or no evidence at all.
//!
//! Real-daemon paths skip gracefully when node/sidecar are unavailable, exactly like the other
//! real-sidecar proofs; on this machine they run for real.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use projectos_control_center::test_fixtures::{
    DaemonLifecycleState, DaemonStatus, EvidenceState, EvidenceStore, ProcessError, ReadOutcome,
    StartupPhase,
};

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("projectos-interlock-it")
        .join(format!("{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// Read-only pid liveness probe (SYNCHRONIZE only; terminates nothing).
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
            Err(_) => false,
        }
    }
}

/// After `run_shutdown` (gate closed + cancellation), `run_startup` refuses BEFORE any creation:
/// no evidence file is ever produced and the phase is `Cancelled`.
#[test]
fn no_creation_after_the_gate_closes() {
    let dir = temp_dir("gate");
    let st = DaemonLifecycleState::with_evidence_dir("ih-gate".into(), dir.clone());
    st.claim_shutdown();
    st.run_shutdown();
    assert_eq!(
        st.run_startup().unwrap_err(),
        ProcessError::RecoveryCancelled
    );
    assert_eq!(st.startup_phase(), Some(StartupPhase::Cancelled));
    assert_eq!(
        std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0),
        0,
        "no evidence may exist: cancellation preceded any creation"
    );
}

/// Exactly one shutdown claimant, and every close event after the first is a loser.
#[test]
fn repeated_close_events_have_exactly_one_claimant() {
    let st = Arc::new(DaemonLifecycleState::with_evidence_dir(
        "ih-claims".into(),
        temp_dir("claims"),
    ));
    let wins = Arc::new(AtomicUsize::new(0));
    let handles: Vec<_> = (0..12)
        .map(|_| {
            let st = st.clone();
            let wins = wins.clone();
            std::thread::spawn(move || {
                if st.claim_shutdown() {
                    wins.fetch_add(1, Ordering::SeqCst);
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(wins.load(Ordering::SeqCst), 1);
}

/// The shutdown claimant joins the retained worker before trusting owner-absence: a worker that
/// only terminates on cancellation is provably joined, never detached.
#[test]
fn shutdown_joins_the_retained_worker() {
    let st = Arc::new(DaemonLifecycleState::with_evidence_dir(
        "ih-join".into(),
        temp_dir("join"),
    ));
    let finished = Arc::new(AtomicUsize::new(0));
    let worker_state = st.clone();
    let worker_done = finished.clone();
    // Simulates a startup worker at a cancellation checkpoint: it terminates only once shutdown
    // has signalled cancellation, exactly like the real worker's bounded waits.
    let worker = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !worker_state.cancellation_requested() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        worker_done.fetch_add(1, Ordering::SeqCst);
    });
    st.store_startup_worker(worker);
    st.claim_shutdown();
    st.run_shutdown();
    assert_eq!(
        finished.load(Ordering::SeqCst),
        1,
        "run_shutdown returned before the worker was terminal"
    );
    assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
}

/// A panicking worker is detected through join and classified; shutdown still completes.
#[test]
fn worker_panic_is_joined_and_classified() {
    let st = DaemonLifecycleState::with_evidence_dir("ih-panic".into(), temp_dir("panic"));
    st.store_startup_worker(std::thread::spawn(|| panic!("worker panic (test)")));
    st.claim_shutdown();
    st.run_shutdown();
    assert_eq!(st.startup_phase(), Some(StartupPhase::Failed));
    assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
}

/// THE race proof: a real startup (recovery → suspended create → evidence → resume → readiness →
/// transfer) racing an almost-immediate close. Whatever the interleaving, after `run_shutdown`
/// returns there is no live daemon, the worker is terminal, and any evidence is terminal.
///
/// Runs the full matrix of close delays so the close lands in different startup stages across
/// iterations (before recovery, during launch, around resume/readiness, after transfer).
#[test]
fn close_racing_every_startup_stage_leaves_no_daemon() {
    for (i, delay_ms) in [0u64, 5, 20, 50, 120, 300, 800, 2_000].iter().enumerate() {
        let dir = temp_dir(&format!("race-{i}"));
        let st = Arc::new(DaemonLifecycleState::with_evidence_dir(
            format!("ih-race-{i}"),
            dir.clone(),
        ));
        let worker_state = st.clone();
        let worker = std::thread::spawn(move || {
            // Success and every typed fail-closed outcome are all acceptable here — the assertion
            // is the post-shutdown invariant, not the startup result.
            let _ = worker_state.run_startup();
        });
        st.store_startup_worker(worker);

        std::thread::sleep(Duration::from_millis(*delay_ms));
        assert!(st.claim_shutdown(), "iteration {i}: claim must win");
        st.run_shutdown();

        // Terminal: no owner, no readiness, worker joined.
        let status = st.safe_status();
        assert_eq!(status.state, DaemonStatus::Stopped, "iteration {i}");
        assert!(!status.read_only_available, "iteration {i}");
        assert_eq!(
            st.request_snapshot(None),
            Err(ProcessError::DaemonNotReady),
            "iteration {i}: no command may be accepted after shutdown"
        );

        // Evidence, if any exists, is terminal — and any recorded pid is dead.
        let store = EvidenceStore::at_dir(dir).expect("scope");
        match store.read() {
            ReadOutcome::Absent => {} // cancelled before creation — nothing may exist
            ReadOutcome::Valid(r) => {
                assert_eq!(
                    r.state,
                    EvidenceState::Stopped,
                    "iteration {i}: evidence must be terminal, got {r:?}"
                );
                if let Some(pid) = r.pid {
                    assert!(!pid_is_alive(pid), "iteration {i}: daemon pid survived");
                }
            }
            other => panic!("iteration {i}: unexpected evidence {other:?}"),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// EMPIRICAL HOST ROLES (§16). Ignored by default; the abnormal-kill harness runs them explicitly
// as REAL host processes and then kills them without cooperation. Killing this process closes the
// Job handle held inside the lifecycle state, so the kernel terminates the daemon — exactly the
// production abnormal-host-death path.
// -------------------------------------------------------------------------------------------------

/// Real host role: full startup pipeline, then hold. The harness kills this process abnormally.
#[test]
#[ignore = "empirical host role — run only by the abnormal-kill harness"]
fn empirical_host_role() {
    let dir = std::env::var("PROJECTOS_EMPIRICAL_EVIDENCE_DIR")
        .expect("harness must set PROJECTOS_EMPIRICAL_EVIDENCE_DIR");
    let st = DaemonLifecycleState::with_evidence_dir("emp-host".into(), dir.into());
    match st.run_startup() {
        Ok((_rx, _instance)) => {
            // Hold as a live authoritative host until the harness kills us abnormally.
            std::thread::sleep(Duration::from_secs(120));
            st.claim_shutdown();
            st.run_shutdown(); // clean fallback if the harness never kills us
        }
        Err(e) => {
            // Surfaced through the evidence file's absence/state; also printed for the harness log.
            eprintln!("empirical host startup failed closed: {e:?}");
        }
    }
}

/// Suspended-unrecorded-child role: creates a suspended fixture child (which would write stdout if
/// it ever ran), records its pid for the harness, writes NO evidence, and holds. The harness kills
/// this host and proves the never-executed child dies with the Job.
#[test]
#[ignore = "empirical suspended role — run only by the abnormal-kill harness"]
fn empirical_suspended_unrecorded_child_role() {
    use projectos_control_center::test_fixtures::{
        FixtureMode, SyntheticFixtureSpec, SyntheticProcessOwner,
    };
    let pidfile = std::env::var("PROJECTOS_EMPIRICAL_PIDFILE")
        .expect("harness must set PROJECTOS_EMPIRICAL_PIDFILE");
    let spec = SyntheticFixtureSpec::new(
        env!("CARGO_BIN_EXE_projectos-test-child").to_string(),
        FixtureMode::WriteStdout,
    )
    .expect("spec");
    let owner = SyntheticProcessOwner::start_fixture_suspended(&spec).expect("suspended start");
    std::fs::write(&pidfile, owner.process_id().to_string()).expect("pidfile");
    // Hold with the suspended, unrecorded, Job-contained child until killed abnormally.
    std::thread::sleep(Duration::from_secs(120));
    drop(owner);
}

/// After a completed shutdown the startup phase is terminal and a fresh startup attempt cannot
/// create anything (the gate stays closed for the life of this state).
#[test]
fn no_second_startup_worker_can_exist() {
    let st = DaemonLifecycleState::with_evidence_dir("ih-single".into(), temp_dir("single"));
    // Consume the one startup claim.
    {
        // Force the claim through the public path by immediately cancelling it.
        st.claim_shutdown();
        st.run_shutdown();
    }
    assert_eq!(
        st.run_startup().unwrap_err(),
        ProcessError::RecoveryCancelled
    );
    // The phase is now terminal; a second claim is impossible.
    assert_eq!(
        st.run_startup().unwrap_err(),
        ProcessError::InvalidStateTransition
    );
}
