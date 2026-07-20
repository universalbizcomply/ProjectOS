//! Prior-daemon recovery barrier (WINDOWS-HOST-ABNORMAL-OVERLAP-RECOVERY-BARRIER1B).
//!
//! Runs after authoritative mutex acquisition and BEFORE authority resolution, Job creation,
//! daemon creation, readiness, or any future write/protected authority. It reads the persisted
//! lifecycle evidence and, when a prior daemon is claimed, verifies the EXACT process (pid +
//! creation time — PID reuse cannot forge identity) through the narrowest possible access
//! (`PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`) and waits boundedly for its termination.
//!
//! Fail-closed doctrine: access denied, unverifiable identity, malformed/unsupported/wrong-scope
//! evidence, wait failure and timeout all REFUSE startup. Nothing here can terminate any process:
//! the module contains no termination API at all, so an unrelated process is unreachable harm.
//!
//! The barrier proceeds on ABSENT evidence by construction, not by luck: under the suspended
//! launch contract the only process that can exist without a record is a suspended, Job-contained
//! child that has executed zero instructions and is already being killed by its dead host's Job.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use std::os::windows::io::OwnedHandle;

use windows::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, FILETIME, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE,
};

use super::errors::ProcessError;
use super::evidence::{EvidenceRecord, EvidenceState, EvidenceStore, ReadOutcome};
use projectos_windows_runtime_primitives::handles::{adopt, win32};

/// One bounded wait slice. Cancellation is observed between slices.
pub const RECOVERY_WAIT_SLICE: Duration = Duration::from_millis(250);
/// Default total termination-observation bound.
pub const RECOVERY_DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
/// Hard internal ceiling. Not owner-exposed; no bypass exists.
pub const RECOVERY_TIMEOUT_CEILING: Duration = Duration::from_secs(30);

/// Bounded recovery configuration. `total` is clamped to the ceiling at use.
#[derive(Debug, Clone, Copy)]
pub struct RecoveryConfig {
    pub total: Duration,
}

impl Default for RecoveryConfig {
    fn default() -> Self {
        RecoveryConfig {
            total: RECOVERY_DEFAULT_TIMEOUT,
        }
    }
}

/// One wait slice against the prior process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitSlice {
    Exited,
    StillRunning,
    Failed,
}

/// A verified-openable prior process, queried through the narrowest rights.
pub trait PriorProcess {
    /// Creation time in FILETIME ticks, or `None` when the query fails.
    fn creation_time(&self) -> Option<u64>;
    /// Wait one bounded slice for termination.
    fn wait_slice(&self, timeout: Duration) -> WaitSlice;
}

/// Result of attempting to open the recorded pid.
pub enum ProbeOutcome {
    /// No process with that pid exists — the prior daemon is proven gone.
    NoSuchProcess,
    /// A process exists but this account may not open it. NEVER read as termination.
    AccessDenied,
    /// Any other native failure. Unverifiable ⇒ fail closed.
    ProbeFailed,
    /// Opened for verification.
    Opened(Box<dyn PriorProcess>),
}

/// Native seam. The production implementation is [`Win32RecoveryNative`]; deterministic tests
/// script every failure class without depending on live system processes.
pub trait RecoveryNative {
    fn probe(&self, pid: u32) -> ProbeOutcome;
}

/// The production Win32 implementation.
pub struct Win32RecoveryNative;

struct Win32PriorProcess {
    handle: OwnedHandle,
}

impl PriorProcess for Win32PriorProcess {
    fn creation_time(&self) -> Option<u64> {
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        // SAFETY: `handle` is a valid owned handle opened with PROCESS_QUERY_LIMITED_INFORMATION
        // (sufficient for GetProcessTimes); all four FILETIME outs are live locals.
        let ok = unsafe {
            GetProcessTimes(
                win32(&self.handle),
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        };
        ok.ok()
            .map(|_| ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
    }

    fn wait_slice(&self, timeout: Duration) -> WaitSlice {
        let ms = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
        // SAFETY: `handle` is a valid owned handle opened with SYNCHRONIZE; `ms` is bounded.
        let r = unsafe { WaitForSingleObject(win32(&self.handle), ms) };
        if r == WAIT_OBJECT_0 {
            WaitSlice::Exited
        } else if r == WAIT_TIMEOUT {
            WaitSlice::StillRunning
        } else {
            WaitSlice::Failed
        }
    }
}

impl RecoveryNative for Win32RecoveryNative {
    fn probe(&self, pid: u32) -> ProbeOutcome {
        // SAFETY: read-only open with the narrowest rights that permit identity + wait; the
        // returned handle (if any) is adopted into RAII ownership and closed exactly once. No
        // termination right is ever requested and no inheritance occurs (bInheritHandle=false).
        let result = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        };
        match result {
            Ok(raw) => {
                // SAFETY: freshly returned by OpenProcess, owned, no other owner.
                match unsafe { adopt(raw) } {
                    Some(handle) => ProbeOutcome::Opened(Box::new(Win32PriorProcess { handle })),
                    None => ProbeOutcome::ProbeFailed,
                }
            }
            Err(e) => {
                if e.code() == ERROR_INVALID_PARAMETER.to_hresult() {
                    ProbeOutcome::NoSuchProcess
                } else if e.code() == ERROR_ACCESS_DENIED.to_hresult() {
                    ProbeOutcome::AccessDenied
                } else {
                    ProbeOutcome::ProbeFailed
                }
            }
        }
    }
}

/// Mark a prior record stopped, then proceed. Reachable ONLY once the recorded process has been
/// PROVEN terminated — no such pid, a creation-time mismatch (PID reuse), or an observed exit.
/// An unverifiable or incomplete claim never reaches here (it fails closed instead). A failure to
/// persist the stale-marking fails closed: startup must not continue with live-looking evidence
/// it could not correct.
fn mark_stopped_and_proceed(
    store: &EvidenceStore,
    record: &EvidenceRecord,
) -> Result<(), ProcessError> {
    store.write(&record.as_stopped())
}

/// Run the recovery barrier. `Ok(())` means: no prior daemon can be executing.
///
/// Every error is a fail-closed refusal — the caller must not create, resume, publish or transfer
/// anything.
pub fn run_barrier(
    store: &EvidenceStore,
    native: &dyn RecoveryNative,
    cancel: &AtomicBool,
    config: &RecoveryConfig,
) -> Result<(), ProcessError> {
    store.sweep_temps();
    if cancel.load(Ordering::SeqCst) {
        return Err(ProcessError::RecoveryCancelled);
    }
    let record = match store.read() {
        ReadOutcome::Absent => return Ok(()),
        ReadOutcome::Malformed | ReadOutcome::WrongScope => {
            return Err(ProcessError::RecoveryEvidenceMalformed)
        }
        ReadOutcome::UnsupportedSchema => {
            return Err(ProcessError::RecoveryEvidenceUnsupportedSchema)
        }
        ReadOutcome::Valid(r) => r,
    };
    if record.state == EvidenceState::Stopped {
        // Termination was observed or independently proven, and validation guarantees a stopped
        // record carries no identity claim: there is nothing to verify.
        return Ok(());
    }
    // STARTING and RUNNING are treated identically: both demand exact kernel verification.
    //
    // DEFENSIVE (RECOVERY-BARRIER1C §4): `EvidenceStore::read` already rejects an active record
    // without a complete pid + creation-time pair, so this branch is unreachable through the
    // canonical reader. It is retained as an independent second gate — an incomplete active claim
    // is UNVERIFIABLE, so it must never be marked stale, rewritten to stopped, probed, or allowed
    // to launch a daemon. Fail closed, exactly as if the record were malformed.
    let (Some(pid), Some(recorded_ctime)) = (record.pid, record.creation_time_filetime) else {
        return Err(ProcessError::RecoveryEvidenceMalformed);
    };
    match native.probe(pid) {
        ProbeOutcome::NoSuchProcess => mark_stopped_and_proceed(store, &record),
        ProbeOutcome::AccessDenied => Err(ProcessError::RecoveryAccessDenied),
        ProbeOutcome::ProbeFailed => Err(ProcessError::RecoveryIdentityUnverifiable),
        ProbeOutcome::Opened(prior) => {
            let Some(actual_ctime) = prior.creation_time() else {
                return Err(ProcessError::RecoveryIdentityUnverifiable);
            };
            if actual_ctime != recorded_ctime {
                // PID reuse: the recorded process is proven gone. The unrelated current holder of
                // the pid is never touched (this module cannot terminate anything).
                return mark_stopped_and_proceed(store, &record);
            }
            // The exact prior process is still alive (suspended, terminating, or executing).
            // Wait boundedly in slices, observing cancellation between slices.
            let total = config.total.min(RECOVERY_TIMEOUT_CEILING);
            let deadline = Instant::now() + total;
            loop {
                if cancel.load(Ordering::SeqCst) {
                    return Err(ProcessError::RecoveryCancelled);
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(ProcessError::RecoveryTimeout);
                }
                match prior.wait_slice(remaining.min(RECOVERY_WAIT_SLICE)) {
                    WaitSlice::Exited => return mark_stopped_and_proceed(store, &record),
                    WaitSlice::StillRunning => continue,
                    WaitSlice::Failed => return Err(ProcessError::RecoveryIdentityUnverifiable),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::evidence::EvidenceRecord;
    use std::sync::atomic::AtomicUsize;

    fn temp_store(tag: &str) -> EvidenceStore {
        let dir = std::env::temp_dir()
            .join("projectos-recovery-tests")
            .join(format!("{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        EvidenceStore::at_dir(dir).expect("scope must resolve")
    }

    fn starting(store: &EvidenceStore, pid: u32, ctime: u64) -> EvidenceRecord {
        EvidenceRecord::starting(store.scope(), "host-t", "host-t-1", pid, ctime)
    }

    fn no_cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    fn cfg_short() -> RecoveryConfig {
        RecoveryConfig {
            total: Duration::from_millis(600),
        }
    }

    /// Scripted native seam.
    struct FakeNative {
        outcome: fn() -> ProbeOutcome,
    }
    impl RecoveryNative for FakeNative {
        fn probe(&self, _pid: u32) -> ProbeOutcome {
            (self.outcome)()
        }
    }

    /// Scripted prior process.
    struct FakePrior {
        ctime: Option<u64>,
        slices: &'static [WaitSlice],
        cursor: AtomicUsize,
    }
    impl PriorProcess for FakePrior {
        fn creation_time(&self) -> Option<u64> {
            self.ctime
        }
        fn wait_slice(&self, _t: Duration) -> WaitSlice {
            let i = self
                .cursor
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *self
                .slices
                .get(i)
                .unwrap_or_else(|| self.slices.last().unwrap())
        }
    }

    fn fake_opened(ctime: Option<u64>, slices: &'static [WaitSlice]) -> Box<dyn PriorProcess> {
        Box::new(FakePrior {
            ctime,
            slices,
            cursor: AtomicUsize::new(0),
        })
    }

    #[test]
    fn absent_record_proceeds() {
        let s = temp_store("absent");
        let n = FakeNative {
            outcome: || panic!("must not probe with no record"),
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));
    }

    #[test]
    fn stopped_record_proceeds_without_probe() {
        let s = temp_store("stopped");
        s.write(&starting(&s, 1, 2).as_stopped()).unwrap();
        let n = FakeNative {
            outcome: || panic!("must not probe a stopped record"),
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));
    }

    #[test]
    fn no_such_process_marks_stale_and_proceeds() {
        let s = temp_store("gone");
        s.write(&starting(&s, 55555, 1)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::NoSuchProcess,
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Stopped,
                ..
            })
        ));
    }

    #[test]
    fn access_denied_fails_closed_and_is_never_termination() {
        let s = temp_store("denied");
        s.write(&starting(&s, 4, 1)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::AccessDenied,
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryAccessDenied)
        );
        // Evidence untouched: never marked stopped on access denied.
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Starting,
                ..
            })
        ));
    }

    #[test]
    fn probe_failure_fails_closed() {
        let s = temp_store("probe-fail");
        s.write(&starting(&s, 4, 1)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::ProbeFailed,
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryIdentityUnverifiable)
        );
    }

    #[test]
    fn creation_time_query_failure_fails_closed() {
        let s = temp_store("ctime-fail");
        s.write(&starting(&s, 4, 1)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::Opened(fake_opened(None, &[WaitSlice::StillRunning])),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryIdentityUnverifiable)
        );
    }

    #[test]
    fn pid_reuse_marks_stale_proceeds_and_touches_nothing() {
        let s = temp_store("reuse");
        s.write(&starting(&s, 4, 111)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::Opened(fake_opened(Some(999), &[WaitSlice::StillRunning])),
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Stopped,
                ..
            })
        ));
    }

    #[test]
    fn live_exact_prior_waits_then_proceeds_on_exit() {
        let s = temp_store("waits");
        s.write(&starting(&s, 4, 111)).unwrap();
        let n = FakeNative {
            outcome: || {
                ProbeOutcome::Opened(fake_opened(
                    Some(111),
                    &[
                        WaitSlice::StillRunning,
                        WaitSlice::StillRunning,
                        WaitSlice::Exited,
                    ],
                ))
            },
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Stopped,
                ..
            })
        ));
    }

    #[test]
    fn timeout_fails_closed_and_preserves_evidence() {
        let s = temp_store("timeout");
        s.write(&starting(&s, 4, 111).as_running()).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::Opened(fake_opened(Some(111), &[WaitSlice::StillRunning])),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryTimeout)
        );
        assert!(matches!(
            s.read(),
            ReadOutcome::Valid(EvidenceRecord {
                state: EvidenceState::Running,
                ..
            })
        ));
    }

    #[test]
    fn wait_failure_fails_closed() {
        let s = temp_store("wait-fail");
        s.write(&starting(&s, 4, 111)).unwrap();
        let n = FakeNative {
            outcome: || ProbeOutcome::Opened(fake_opened(Some(111), &[WaitSlice::Failed])),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryIdentityUnverifiable)
        );
    }

    #[test]
    fn cancellation_between_slices_fails_closed_quickly() {
        let s = temp_store("cancel");
        s.write(&starting(&s, 4, 111)).unwrap();
        let cancel = AtomicBool::new(true);
        let n = FakeNative {
            outcome: || ProbeOutcome::Opened(fake_opened(Some(111), &[WaitSlice::StillRunning])),
        };
        assert_eq!(
            run_barrier(&s, &n, &cancel, &cfg_short()),
            Err(ProcessError::RecoveryCancelled)
        );
    }

    #[test]
    fn malformed_and_unsupported_and_wrong_scope_fail_closed() {
        let s = temp_store("malformed");
        s.write_raw_for_test(b"{ nope").unwrap();
        let n = FakeNative {
            outcome: || panic!("must not probe malformed evidence"),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceMalformed)
        );

        let s2 = temp_store("unsupported");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s2, 4, 1)).unwrap();
        v["schemaVersion"] = serde_json::Value::from(9u32);
        s2.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert_eq!(
            run_barrier(&s2, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceUnsupportedSchema)
        );

        let s3 = temp_store("wrong-scope");
        let mut r = starting(&s3, 4, 1);
        r.install16 = "ffffffffffffffff".into();
        s3.write_raw_for_test(serde_json::to_string(&r).unwrap().as_bytes())
            .unwrap();
        assert_eq!(
            run_barrier(&s3, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceMalformed)
        );
    }

    /// Strip both identity halves from a record and persist it raw.
    fn write_without_claim(s: &EvidenceStore, r: &EvidenceRecord) {
        let mut v: serde_json::Value = serde_json::to_value(r).unwrap();
        v.as_object_mut().unwrap().remove("pid");
        v.as_object_mut().unwrap().remove("creationTimeFiletime");
        s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
    }

    /// THE corrected invariant (RECOVERY-BARRIER1C): an active record without a complete
    /// process-instance identity can never be verified, so it must never permit startup. It
    /// replaces `starting_without_process_claim_is_marked_stale_and_proceeds`, which proceeded.
    #[test]
    fn starting_without_process_claim_fails_closed() {
        let s = temp_store("no-claim-starting");
        write_without_claim(&s, &starting(&s, 4, 1));
        let n = FakeNative {
            outcome: || panic!("an unverifiable claim must never be probed"),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceMalformed)
        );
        // Never silently converted to stopped: the evidence is left exactly as found.
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn running_without_process_claim_fails_closed() {
        let s = temp_store("no-claim-running");
        write_without_claim(&s, &starting(&s, 4, 1).as_running());
        let n = FakeNative {
            outcome: || panic!("an unverifiable claim must never be probed"),
        };
        assert_eq!(
            run_barrier(&s, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceMalformed)
        );
        assert!(matches!(s.read(), ReadOutcome::Malformed));
    }

    #[test]
    fn active_record_with_only_one_identity_half_fails_closed() {
        for (tag, drop_field) in [("pid-only", "creationTimeFiletime"), ("ctime-only", "pid")] {
            for (state_tag, rec) in [
                ("starting", starting(&temp_store(tag), 4, 1)),
                ("running", starting(&temp_store(tag), 4, 1).as_running()),
            ] {
                let s = temp_store(&format!("{tag}-{state_tag}"));
                let mut v: serde_json::Value = serde_json::to_value(&rec).unwrap();
                v.as_object_mut().unwrap().remove(drop_field);
                s.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
                    .unwrap();
                let n = FakeNative {
                    outcome: || panic!("an incomplete claim must never be probed"),
                };
                assert_eq!(
                    run_barrier(&s, &n, &no_cancel(), &cfg_short()),
                    Err(ProcessError::RecoveryEvidenceMalformed),
                    "{state_tag} with {tag} must fail closed"
                );
            }
        }
    }

    #[test]
    fn stopped_without_claim_proceeds_and_stopped_with_claim_fails_closed() {
        // Stopped carries no claim: valid, proceeds, nothing probed.
        let s = temp_store("stopped-clean");
        s.write(&starting(&s, 4, 1).as_stopped()).unwrap();
        let n = FakeNative {
            outcome: || panic!("a stopped record must never be probed"),
        };
        assert_eq!(run_barrier(&s, &n, &no_cancel(), &cfg_short()), Ok(()));

        // Stopped WITH a claim is inconsistent evidence (no writer path emits it) ⇒ fail closed.
        let s2 = temp_store("stopped-with-claim");
        let mut v: serde_json::Value = serde_json::to_value(starting(&s2, 4, 1)).unwrap();
        v["state"] = serde_json::Value::from("stopped"); // keeps pid + creationTimeFiletime
        s2.write_raw_for_test(serde_json::to_string(&v).unwrap().as_bytes())
            .unwrap();
        assert_eq!(
            run_barrier(&s2, &n, &no_cancel(), &cfg_short()),
            Err(ProcessError::RecoveryEvidenceMalformed)
        );
    }

    #[test]
    fn config_total_is_clamped_to_the_ceiling() {
        assert!(RECOVERY_DEFAULT_TIMEOUT <= RECOVERY_TIMEOUT_CEILING);
        let huge = RecoveryConfig {
            total: Duration::from_secs(9999),
        };
        assert_eq!(
            huge.total.min(RECOVERY_TIMEOUT_CEILING),
            RECOVERY_TIMEOUT_CEILING
        );
    }
}
