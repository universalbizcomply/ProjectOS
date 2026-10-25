//! Recovery-barrier + suspended-launch integration proofs (RECOVERY-BARRIER1B).
//!
//! Drives the REAL primitives — a real Job-bound fixture child as the "prior daemon", the real
//! `Win32RecoveryNative` (`OpenProcess` + `GetProcessTimes` + `WaitForSingleObject`), the real
//! atomic evidence store, and the real suspended creation + `ResumeThread` path — under the closed
//! `test-fixtures` surface. Deterministic failure classes (access denied, wait failure, scripted
//! resume counts) are covered by the in-module seam tests; what lives here is genuine OS behaviour.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use projectos_control_center::test_fixtures::{
    classify_resume, run_barrier, DaemonLifecycleState, DaemonStatus, EvidenceRecord,
    EvidenceState, EvidenceStore, FixtureMode, ProcessError, ProcessState, ReadOutcome,
    RecoveryConfig, ResumeApi, StartupPhase, SyntheticFixtureSpec, SyntheticProcessOwner,
    Win32RecoveryNative,
};

fn fixture_exe() -> String {
    env!("CARGO_BIN_EXE_projectos-test-child").to_string()
}

fn temp_store(tag: &str) -> EvidenceStore {
    let dir = std::env::temp_dir()
        .join("projectos-recovery-it")
        .join(format!("{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    EvidenceStore::at_dir(dir).expect("scope must resolve on this machine")
}

fn no_cancel() -> AtomicBool {
    AtomicBool::new(false)
}

fn cfg(total_ms: u64) -> RecoveryConfig {
    RecoveryConfig {
        total: Duration::from_millis(total_ms),
    }
}

fn start_prior_daemon() -> SyntheticProcessOwner {
    let spec = SyntheticFixtureSpec::new(fixture_exe(), FixtureMode::Wait)
        .expect("fixture spec")
        .with_graceful_shutdown(Duration::from_millis(300));
    SyntheticProcessOwner::start_fixture(&spec).expect("fixture start")
}

fn record_for(store: &EvidenceStore, owner: &SyntheticProcessOwner) -> EvidenceRecord {
    EvidenceRecord::starting(
        store.scope(),
        "it-host",
        "it-host-1",
        owner.process_id(),
        owner.process_creation_time(),
    )
}

/// A live evidenced prior process makes the barrier wait; while it stays alive the barrier times
/// out fail-closed; after it terminates the barrier proceeds and marks the record stopped.
#[test]
fn live_prior_process_blocks_then_recovery_succeeds_after_exit() {
    let store = temp_store("live-prior");
    let mut prior = start_prior_daemon();
    store.write(&record_for(&store, &prior)).unwrap();

    // Alive ⇒ bounded wait ⇒ timeout ⇒ fail closed, evidence preserved.
    let t0 = Instant::now();
    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(800)),
        Err(ProcessError::RecoveryTimeout)
    );
    assert!(
        t0.elapsed() >= Duration::from_millis(700),
        "must actually wait"
    );
    assert!(matches!(
        store.read(),
        ReadOutcome::Valid(EvidenceRecord {
            state: EvidenceState::Starting,
            ..
        })
    ));

    // Terminate the prior process (its own trusted owner), then the barrier proceeds.
    prior.shutdown();
    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(5_000)),
        Ok(())
    );
    assert!(matches!(
        store.read(),
        ReadOutcome::Valid(EvidenceRecord {
            state: EvidenceState::Stopped,
            ..
        })
    ));
}

/// The barrier can also observe the exit WHILE waiting (not only after): terminate the prior on a
/// side thread mid-wait and the same barrier call completes.
#[test]
fn barrier_observes_termination_mid_wait() {
    let store = temp_store("mid-wait");
    let prior = start_prior_daemon();
    let pid = prior.process_id();
    store.write(&record_for(&store, &prior)).unwrap();

    let killer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        let mut prior = prior; // moved in; its trusted owner terminates it
        prior.shutdown();
    });
    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(10_000)),
        Ok(())
    );
    killer.join().unwrap();
    assert!(pid != 0);
    assert!(matches!(
        store.read(),
        ReadOutcome::Valid(EvidenceRecord {
            state: EvidenceState::Stopped,
            ..
        })
    ));
}

/// A record whose pid no longer exists is proven stale through the kernel and startup proceeds.
#[test]
fn dead_prior_pid_is_proven_stale_and_proceeds() {
    let store = temp_store("dead-pid");
    let mut prior = start_prior_daemon();
    let record = record_for(&store, &prior);
    prior.shutdown(); // gone before the barrier runs
    store.write(&record).unwrap();
    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(2_000)),
        Ok(())
    );
}

/// PID reuse: a record claiming a LIVE pid with the WRONG creation time proves the recorded
/// process is gone. The unrelated live process is never touched.
#[test]
fn pid_reuse_wrong_creation_time_proceeds_and_never_touches_the_live_process() {
    let store = temp_store("pid-reuse");
    let mut bystander = start_prior_daemon(); // plays the "unrelated current pid holder"
    let mut record = record_for(&store, &bystander);
    record.creation_time_filetime = record.creation_time_filetime.map(|t| t + 1);
    store.write(&record).unwrap();

    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(2_000)),
        Ok(())
    );
    // The unrelated process must still be alive and healthy.
    assert_eq!(bystander.refresh_state(), ProcessState::RunningUntrusted);
    bystander.shutdown();
}

/// Deliberately corrupted evidence refuses startup (empirical corruption-refusal proof).
#[test]
fn corrupted_evidence_refuses_startup() {
    let store = temp_store("corrupt");
    store.write_raw_for_test(b"{\"schemaVersion\":1,").unwrap();
    assert_eq!(
        run_barrier(&store, &Win32RecoveryNative, &no_cancel(), &cfg(1_000)),
        Err(ProcessError::RecoveryEvidenceMalformed)
    );
}

/// RECOVERY-BARRIER1C, end-to-end through the REAL product path (`run_startup`, the same call the
/// application's startup worker makes): an ACTIVE record without a complete process-instance
/// identity must block daemon startup entirely — no daemon process, no readiness, no publication,
/// and the evidence is never silently converted to stopped.
#[test]
fn active_evidence_without_identity_blocks_the_real_startup_path() {
    for (tag, state) in [
        ("e2e-starting-no-claim", "starting"),
        ("e2e-running-no-claim", "running"),
    ] {
        let dir = std::env::temp_dir()
            .join("projectos-recovery-it")
            .join(format!("{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = EvidenceStore::at_dir(dir.clone()).expect("scope");

        // An active record whose identity halves are both absent.
        let seed = EvidenceRecord::starting(store.scope(), "it-host", "it-host-1", 4242, 999);
        let mut v: serde_json::Value = serde_json::to_value(&seed).unwrap();
        v["state"] = serde_json::Value::from(state);
        v.as_object_mut().unwrap().remove("pid");
        v.as_object_mut().unwrap().remove("creationTimeFiletime");
        store
            .write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();

        let st = DaemonLifecycleState::with_evidence_dir("it-host".into(), dir);
        let err = st.run_startup().expect_err("startup must fail closed");
        assert_eq!(err, ProcessError::RecoveryEvidenceMalformed, "{tag}");

        // Fail closed, safely, with the owner-facing blocked surface — and NO daemon.
        let status = st.safe_status();
        assert_eq!(status.state, DaemonStatus::Blocked, "{tag}");
        assert!(!status.read_only_available, "{tag}");
        assert!(status.protected_approvals_disabled, "{tag}");
        assert_eq!(st.startup_phase(), Some(StartupPhase::Failed), "{tag}");
        assert_eq!(
            st.request_snapshot(None),
            Err(ProcessError::DaemonNotReady),
            "{tag}: no daemon command may be accepted"
        );
        // The record was NOT rewritten to stopped: unverifiable evidence is preserved as-is.
        assert!(matches!(store.read(), ReadOutcome::Malformed), "{tag}");
    }
}

// ---------------------------------------------------------------------------------------------
// Suspended launch + ResumeThread contract against the REAL fixture child.
// ---------------------------------------------------------------------------------------------

/// A suspended child executes ZERO instructions: even in `WriteStdout` mode it produces no output
/// until resumed; after the real `ResumeThread` (count==1) output arrives.
#[test]
fn suspended_child_executes_nothing_until_real_resume() {
    let spec = SyntheticFixtureSpec::new(fixture_exe(), FixtureMode::WriteStdout)
        .expect("spec")
        .with_graceful_shutdown(Duration::from_millis(300));
    let mut owner = SyntheticProcessOwner::start_fixture_suspended(&spec).expect("suspended start");
    assert_eq!(owner.state(), ProcessState::CreatedSuspended);
    assert!(
        owner.is_contained().unwrap(),
        "job containment holds while suspended"
    );

    std::thread::sleep(Duration::from_millis(500));
    assert!(
        owner.stdout_text().is_empty(),
        "a suspended child must produce zero output: {:?}",
        owner.stdout_text()
    );

    owner
        .resume_with(&projectos_control_center::test_fixtures::RealResumeApi)
        .expect("real resume must be accepted (prior count exactly 1)");
    assert_eq!(owner.state(), ProcessState::RunningUntrusted);

    let deadline = Instant::now() + Duration::from_secs(5);
    while owner.stdout_text().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        !owner.stdout_text().is_empty(),
        "output must arrive after resume"
    );
    owner.shutdown();
}

/// Scripted resume seam returning 0 / 2 / DWORD(-1): each is refused, readiness is never entered,
/// and the trusted child is terminated through the retained handle.
struct ScriptedResume(u32);
impl ResumeApi for ScriptedResume {
    fn resume_thread(&self, _thread: &std::os::windows::io::OwnedHandle) -> u32 {
        self.0
    }
}

#[test]
fn rejected_resume_results_terminate_the_trusted_child() {
    for (scripted, expected) in [
        (0u32, ProcessError::DaemonUnexpectedSuspendCount),
        (2u32, ProcessError::DaemonUnexpectedSuspendCount),
        (u32::MAX, ProcessError::DaemonResumeFailed),
    ] {
        let spec = SyntheticFixtureSpec::new(fixture_exe(), FixtureMode::Wait)
            .expect("spec")
            .with_graceful_shutdown(Duration::from_millis(200));
        let mut owner =
            SyntheticProcessOwner::start_fixture_suspended(&spec).expect("suspended start");
        assert_eq!(
            owner.resume_with(&ScriptedResume(scripted)),
            Err(expected),
            "scripted {scripted}"
        );
        // The rejected result leaves the child un-run; the trusted termination path reaps it.
        let end = owner.shutdown();
        assert!(
            end.is_terminal(),
            "child must be terminated after {scripted}"
        );
        // A second resume attempt is structurally impossible (thread handle consumed).
        assert_eq!(
            owner.resume_with(&ScriptedResume(1)),
            Err(ProcessError::InvalidStateTransition)
        );
    }
}

#[test]
fn resume_classification_accepts_exactly_one() {
    assert_eq!(classify_resume(1), Ok(()));
    assert_eq!(
        classify_resume(0),
        Err(ProcessError::DaemonUnexpectedSuspendCount)
    );
    assert_eq!(
        classify_resume(2),
        Err(ProcessError::DaemonUnexpectedSuspendCount)
    );
    assert_eq!(
        classify_resume(17),
        Err(ProcessError::DaemonUnexpectedSuspendCount)
    );
    assert_eq!(
        classify_resume(u32::MAX),
        Err(ProcessError::DaemonResumeFailed)
    );
}

/// Abnormal "host death before record" equivalence: a suspended, Job-contained, UNRECORDED child
/// dies with its owner (job close) having executed nothing — the §7 ABSENT rule's foundation.
#[test]
fn dropping_the_owner_of_an_unrecorded_suspended_child_kills_it_silently() {
    let spec = SyntheticFixtureSpec::new(fixture_exe(), FixtureMode::WriteStdout)
        .expect("spec")
        .with_graceful_shutdown(Duration::from_millis(200));
    let owner = SyntheticProcessOwner::start_fixture_suspended(&spec).expect("suspended start");
    let pid = owner.process_id();
    drop(owner); // owner death ⇒ job close ⇒ kernel kills the suspended child

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let alive = pid_is_alive(pid);
        if !alive {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "suspended child must die with its job"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
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
