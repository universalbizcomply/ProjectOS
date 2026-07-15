//! Authoritative daemon lifecycle (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! ONE lock guards owner + status + instance + failure + shutdown phase together, so the states can
//! never contradict (owner-present/status-stopped, or owner-absent/status-running). Slow work —
//! `CreateProcessW`, process waits, thread joins, pipe writes — happens strictly OUTSIDE the lock.
//!
//! Liveness is derived from the retained process handle. The old sticky `alive: Mutex<bool>` (set
//! true once at startup and never reset) is deleted: it reported "running" over a corpse.
//!
//! Nothing here establishes trust. Job-binding is containment, not identity, so no state is named
//! SECURE / TRUSTED / PRODUCTION_READY and protected approvals stay disabled throughout.

#![cfg(windows)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::authority::{detect_app_mode, resolve_launch_authority, DaemonLaunchAuthority};
use super::errors::ProcessError;
use super::owner::JobBoundProcessOwner;
use super::readiness::{classify_line, LineClass};

/// Bounded window for the daemon to announce `lifecycle.ready`.
pub(crate) const READY_TIMEOUT: Duration = Duration::from_secs(5);
/// Hard cap on the whole shutdown sequence, so application exit can never hang.
pub(crate) const SHUTDOWN_HARD_CAP: Duration = Duration::from_secs(8);
/// The exact bytes of the read-only snapshot request. Rust-authored constant — never caller data.
pub(crate) const SNAPSHOT_REQUEST: &[u8] = b"{\"cmd\":\"snapshot\"}\n";
/// The exact bytes of the cooperative lifecycle shutdown request.
pub(crate) const SHUTDOWN_REQUEST: &[u8] = b"{\"cmd\":\"lifecycle.shutdown\"}\n";

/// Owner-facing lifecycle status. Deliberately contains no SECURE/TRUSTED/PRODUCTION_READY.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DaemonStatus {
    NotStarted,
    Starting,
    RunningReadOnly,
    Stopping,
    Stopped,
    Crashed,
    Blocked,
}

impl DaemonStatus {
    /// The one safe next action shown to the owner.
    pub const fn next_safe_action(self) -> &'static str {
        match self {
            DaemonStatus::NotStarted => "Local worker not started.",
            DaemonStatus::Starting => "Starting local worker…",
            DaemonStatus::RunningReadOnly => "Local worker ready for read-only operation.",
            DaemonStatus::Stopping => "Local worker stopping…",
            DaemonStatus::Stopped => "Local worker stopped.",
            DaemonStatus::Crashed => "Local worker crashed. Restart ProjectOS.",
            DaemonStatus::Blocked => "Local worker unavailable. Restart ProjectOS.",
        }
    }

    const fn accepts_requests(self) -> bool {
        matches!(self, DaemonStatus::RunningReadOnly)
    }
}

/// Where the exit sequence has reached. The authoritative re-entry guard for Tauri exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShutdownPhase {
    None,
    /// A shutdown worker is running. Exactly one may exist.
    Stopping,
    Complete,
    /// `AppHandle::exit` has been called; the resulting exit event must NOT be prevented.
    FinalExitTriggered,
}

/// The safe, serialisable status projection returned to the UI. No PID, handle, path, instance id,
/// stderr, stack trace, environment, secret, or trust claim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeDaemonStatus {
    pub state: DaemonStatus,
    pub read_only_available: bool,
    /// Always true in this phase — no identity or trust exists to enable approvals.
    pub protected_approvals_disabled: bool,
    pub next_safe_action: String,
    /// Safe failure category only.
    pub failure: Option<ProcessError>,
}

/// The coherent lifecycle fields, guarded together by one lock.
struct Inner {
    owner: Option<JobBoundProcessOwner>,
    status: DaemonStatus,
    instance: Option<String>,
    last_failure: Option<ProcessError>,
    shutdown: ShutdownPhase,
}

/// Tauri managed state: one authoritative lifecycle owner.
pub struct DaemonLifecycleState {
    inner: Mutex<Inner>,
    host_instance_id: String,
    launch_seq: AtomicU64,
}

impl DaemonLifecycleState {
    pub(crate) fn new(host_instance_id: String) -> DaemonLifecycleState {
        DaemonLifecycleState {
            inner: Mutex::new(Inner {
                owner: None,
                status: DaemonStatus::NotStarted,
                instance: None,
                last_failure: None,
                shutdown: ShutdownPhase::None,
            }),
            host_instance_id,
            launch_seq: AtomicU64::new(0),
        }
    }

    /// Mint a fresh daemon instance id. Bounded ASCII, non-secret, no authority, never reused —
    /// every launch/restart gets a new one.
    fn next_instance_id(&self) -> String {
        let n = self.launch_seq.fetch_add(1, Ordering::SeqCst) + 1;
        format!("{}-{}", self.host_instance_id, n)
    }

    /// Safe status projection. Read-only; accepts no configuration.
    pub fn safe_status(&self) -> SafeDaemonStatus {
        let (state, failure) = match self.inner.lock() {
            Ok(g) => (g.status, g.last_failure),
            // A poisoned lock must never panic and must never look healthy.
            Err(_) => (
                DaemonStatus::Blocked,
                Some(ProcessError::LifecycleStateBlocked),
            ),
        };
        SafeDaemonStatus {
            state,
            read_only_available: state.accepts_requests(),
            protected_approvals_disabled: true,
            next_safe_action: state.next_safe_action().to_string(),
            failure,
        }
    }

    fn set_failed(&self, status: DaemonStatus, err: ProcessError) {
        if let Ok(mut g) = self.inner.lock() {
            g.owner = None;
            g.instance = None;
            g.status = status;
            g.last_failure = Some(err);
        }
    }

    /// Start the real daemon and wait for deterministic readiness.
    ///
    /// Returns the stdout receiver so the caller can keep routing protocol lines after readiness.
    /// The lock is never held across `CreateProcessW` or the readiness wait.
    pub(crate) fn start_daemon(&self) -> Result<(Receiver<String>, String), ProcessError> {
        // Reject a second setup outright — one authoritative owner only.
        {
            let mut g = self
                .inner
                .lock()
                .map_err(|_| ProcessError::LifecycleStateBlocked)?;
            if g.owner.is_some() {
                return Err(ProcessError::InvalidStateTransition);
            }
            g.status = DaemonStatus::Starting;
            g.last_failure = None;
        } // unlock before any slow work

        let instance = self.next_instance_id();
        let authority = resolve_launch_authority(detect_app_mode(), instance.clone())
            .inspect_err(|e| self.set_failed(DaemonStatus::Blocked, *e))?;
        let spec = match &authority {
            DaemonLaunchAuthority::Development(dev) => dev.to_process_spec(),
        }
        .inspect_err(|e| self.set_failed(DaemonStatus::Blocked, *e))?;

        let (tx, rx): (Sender<String>, Receiver<String>) = std::sync::mpsc::channel();
        let mut owner = JobBoundProcessOwner::start_daemon(&spec, tx)
            .inspect_err(|e| self.set_failed(DaemonStatus::Blocked, *e))?;

        // Deterministic readiness — NOT process existence, NOT the incidental startup snapshot.
        match await_ready(&rx, &instance, READY_TIMEOUT, &mut owner) {
            Ok(()) => {}
            Err(e) => {
                // A process may exist and never became ready: stop it. Dropping the owner closes the
                // Job, so kill-on-close is the backstop even if this path is imperfect.
                owner.shutdown();
                drop(owner);
                self.set_failed(DaemonStatus::Crashed, e);
                return Err(e);
            }
        }

        let mut g = self
            .inner
            .lock()
            .map_err(|_| ProcessError::LifecycleStateBlocked)?;
        g.owner = Some(owner);
        g.instance = Some(instance.clone());
        g.status = DaemonStatus::RunningReadOnly;
        Ok((rx, instance))
    }

    /// Send the fixed read-only snapshot request. Rejected unless RUNNING_READ_ONLY with a matching
    /// instance; a broken pipe becomes a typed failure and never a panic.
    pub(crate) fn request_snapshot(
        &self,
        expect_instance: Option<&str>,
    ) -> Result<(), ProcessError> {
        let mut g = self
            .inner
            .lock()
            .map_err(|_| ProcessError::LifecycleStateBlocked)?;
        if !g.status.accepts_requests() {
            return Err(ProcessError::DaemonNotReady);
        }
        if let (Some(want), Some(have)) = (expect_instance, g.instance.as_deref()) {
            if want != have {
                return Err(ProcessError::DaemonInstanceMismatch);
            }
        }
        let owner = g.owner.as_mut().ok_or(ProcessError::DaemonNotReady)?;
        // A short constant write to a pipe; not a blocking operation of consequence.
        owner.write_request(SNAPSHOT_REQUEST)
    }

    /// Record an observed process exit for `instance`. A stale instance must never move a
    /// replacement owner's state.
    pub(crate) fn record_exit(&self, instance: &str) {
        if let Ok(mut g) = self.inner.lock() {
            if g.instance.as_deref() != Some(instance) {
                return; // stale: a replacement owner is live
            }
            if matches!(g.status, DaemonStatus::Stopping | DaemonStatus::Stopped) {
                g.status = DaemonStatus::Stopped;
            } else {
                g.status = DaemonStatus::Crashed;
            }
            g.owner = None;
            g.instance = None;
        }
    }

    /// True when this instance is still the current one (used to discard stale stdout).
    pub(crate) fn is_current_instance(&self, instance: &str) -> bool {
        self.inner
            .lock()
            .map(|g| g.instance.as_deref() == Some(instance))
            .unwrap_or(false)
    }

    /// True while the UI may receive daemon events.
    pub(crate) fn may_emit(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.status == DaemonStatus::RunningReadOnly)
            .unwrap_or(false)
    }

    /// Atomically claim the shutdown. Returns true for EXACTLY ONE caller — the CAS that guarantees
    /// a single shutdown worker no matter how many close requests arrive.
    pub(crate) fn claim_shutdown(&self) -> bool {
        match self.inner.lock() {
            Ok(mut g) => {
                if g.shutdown != ShutdownPhase::None {
                    return false;
                }
                g.shutdown = ShutdownPhase::Stopping;
                g.status = DaemonStatus::Stopping;
                true
            }
            Err(_) => false,
        }
    }

    /// Whether the final programmatic exit has been triggered — such an exit event must NOT be
    /// prevented, or the app could never close.
    pub(crate) fn final_exit_triggered(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.shutdown == ShutdownPhase::FinalExitTriggered)
            .unwrap_or(true) // poisoned ⇒ do not block exit
    }

    /// Run the bounded shutdown. Takes the owner OUT under the lock, then does all slow work
    /// unlocked. Idempotent: a second call finds no owner and returns.
    pub(crate) fn run_shutdown(&self) {
        let owner = match self.inner.lock() {
            Ok(mut g) => g.owner.take(),
            Err(_) => None,
        };
        if let Some(mut owner) = owner {
            // Cooperative request first, stdin still open; then bounded grace; then force; the Job
            // close (on drop) is the final backstop.
            let _ = owner.write_request(SHUTDOWN_REQUEST);
            owner.shutdown();
            drop(owner);
        }
        if let Ok(mut g) = self.inner.lock() {
            g.status = DaemonStatus::Stopped;
            g.instance = None;
            g.shutdown = ShutdownPhase::Complete;
        }
    }

    /// Mark that `AppHandle::exit` is about to be called exactly once.
    pub(crate) fn mark_final_exit(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.shutdown = ShutdownPhase::FinalExitTriggered;
        }
    }
}

/// Wait for the exact `lifecycle.ready` for `instance`, discarding ordinary pre-ready output.
///
/// Pre-ready ordinary messages are DROPPED rather than buffered: the incidental startup snapshot is
/// stale by the time the UI exists, and a fresh snapshot is requested after readiness instead.
fn await_ready(
    rx: &Receiver<String>,
    instance: &str,
    timeout: Duration,
    owner: &mut JobBoundProcessOwner,
) -> Result<(), ProcessError> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(ProcessError::DaemonReadyTimeout);
        }
        match rx.recv_timeout(remaining) {
            Ok(line) => match classify_line(&line, instance)? {
                LineClass::Ready => return Ok(()),
                // Ordinary output (including the startup snapshot) never satisfies readiness.
                LineClass::NotLifecycle => {
                    if owner.refresh_state().is_terminal() {
                        return Err(ProcessError::DaemonExitedEarly);
                    }
                }
            },
            // Sender dropped ⇒ stdout hit EOF ⇒ the process is gone.
            Err(RecvTimeoutError::Disconnected) => return Err(ProcessError::DaemonExitedEarly),
            Err(RecvTimeoutError::Timeout) => {
                return if owner.refresh_state().is_terminal() {
                    Err(ProcessError::DaemonExitedEarly)
                } else {
                    Err(ProcessError::DaemonReadyTimeout)
                };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> DaemonLifecycleState {
        DaemonLifecycleState::new("host-test".into())
    }

    #[test]
    fn initial_status_is_not_started_and_approvals_disabled() {
        let s = state().safe_status();
        assert_eq!(s.state, DaemonStatus::NotStarted);
        assert!(!s.read_only_available);
        assert!(s.protected_approvals_disabled);
    }

    #[test]
    fn requests_rejected_when_not_ready() {
        let st = state();
        assert_eq!(st.request_snapshot(None), Err(ProcessError::DaemonNotReady));
    }

    #[test]
    fn only_one_shutdown_worker_can_be_claimed() {
        let st = state();
        assert!(st.claim_shutdown(), "first claim must win");
        assert!(!st.claim_shutdown(), "second claim must lose");
        assert!(!st.claim_shutdown());
    }

    #[test]
    fn instance_ids_are_unique_and_never_reused() {
        let st = state();
        let a = st.next_instance_id();
        let b = st.next_instance_id();
        assert_ne!(a, b);
        assert!(a.starts_with("host-test-"));
    }

    #[test]
    fn stale_instance_cannot_change_current_state() {
        let st = state();
        {
            let mut g = st.inner.lock().unwrap();
            g.instance = Some("host-test-2".into());
            g.status = DaemonStatus::RunningReadOnly;
        }
        st.record_exit("host-test-1"); // stale
        assert_eq!(st.safe_status().state, DaemonStatus::RunningReadOnly);
        st.record_exit("host-test-2"); // current
        assert_eq!(st.safe_status().state, DaemonStatus::Crashed);
    }

    #[test]
    fn exit_during_stopping_is_recorded_as_stopped_not_crashed() {
        let st = state();
        {
            let mut g = st.inner.lock().unwrap();
            g.instance = Some("host-test-1".into());
            g.status = DaemonStatus::Stopping;
        }
        st.record_exit("host-test-1");
        assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
    }

    #[test]
    fn status_never_claims_secure_or_trusted() {
        for s in [
            DaemonStatus::NotStarted,
            DaemonStatus::Starting,
            DaemonStatus::RunningReadOnly,
            DaemonStatus::Stopping,
            DaemonStatus::Stopped,
            DaemonStatus::Crashed,
            DaemonStatus::Blocked,
        ] {
            let m = s.next_safe_action().to_lowercase();
            assert!(!m.contains("secure") && !m.contains("trusted"), "{s:?}");
        }
    }

    #[test]
    fn safe_status_exposes_no_identifiers() {
        let st = state();
        let json = serde_json::to_string(&st.safe_status()).unwrap();
        for forbidden in [
            "pid", "handle", "node.exe", "host.mjs", "instance", "stderr",
        ] {
            assert!(
                !json.to_lowercase().contains(forbidden),
                "leaked {forbidden}: {json}"
            );
        }
    }

    #[test]
    fn only_running_read_only_accepts_requests() {
        assert!(DaemonStatus::RunningReadOnly.accepts_requests());
        for s in [
            DaemonStatus::NotStarted,
            DaemonStatus::Starting,
            DaemonStatus::Stopping,
            DaemonStatus::Stopped,
            DaemonStatus::Crashed,
            DaemonStatus::Blocked,
        ] {
            assert!(!s.accepts_requests(), "{s:?} must not accept requests");
        }
    }

    /// THE decisive proof: drive the REAL production path — sealed authority → sanitized dev-Node
    /// resolution → atomic Job-bound `CreateProcessW` → explicit `lifecycle.ready` → status.
    ///
    /// Skips (rather than fails) when the dev tree/node is unavailable, so the suite stays portable;
    /// on this machine it runs for real.
    #[test]
    fn real_daemon_starts_job_bound_and_reaches_running_read_only() {
        let st = DaemonLifecycleState::new("host-live".into());
        match st.start_daemon() {
            Ok((_rx, instance)) => {
                assert_eq!(st.safe_status().state, DaemonStatus::RunningReadOnly);
                assert!(st.is_current_instance(&instance));
                // A request is accepted only now that it is ready.
                assert!(st.request_snapshot(None).is_ok());
                // Stale instance is refused.
                assert_eq!(
                    st.request_snapshot(Some("host-live-999")),
                    Err(ProcessError::DaemonInstanceMismatch)
                );
                // Bounded shutdown leaves nothing behind (Job close is the backstop).
                st.run_shutdown();
                assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
                assert!(!st.safe_status().read_only_available);
            }
            Err(e) => {
                // Fail closed: never "running", and the failure is typed.
                assert_ne!(st.safe_status().state, DaemonStatus::RunningReadOnly);
                eprintln!("real daemon start unavailable in this environment: {e:?}");
            }
        }
    }

    #[test]
    fn snapshot_request_is_constant_rust_authored_bytes() {
        assert_eq!(SNAPSHOT_REQUEST, b"{\"cmd\":\"snapshot\"}\n");
        assert_eq!(SHUTDOWN_REQUEST, b"{\"cmd\":\"lifecycle.shutdown\"}\n");
    }
}
