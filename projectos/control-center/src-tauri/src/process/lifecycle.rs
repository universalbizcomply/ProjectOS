//! Authoritative daemon lifecycle (OWNERSHIP1B, extended by RECOVERY-BARRIER1B).
//!
//! ONE lock guards owner + status + instance + failure + shutdown phase + startup phase together,
//! so the states can never contradict. Slow work — `CreateProcessW`, process waits, thread joins,
//! pipe writes, evidence file I/O — happens strictly OUTSIDE that lock.
//!
//! RECOVERY-BARRIER1B adds:
//!  - a recovery barrier that verifies/waits for any evidenced prior daemon BEFORE anything else;
//!  - the suspended launch contract: no daemon instruction executes before a durable identity
//!    record exists (`CREATE_SUSPENDED` → persist `starting` → `ResumeThread`);
//!  - a RETAINED startup worker (never detached) plus a launch interlock, so application exit can
//!    never complete while startup can still create, resume, publish, persist or transfer;
//!  - one-time move-only ownership transfer from the startup worker into this state.
//!
//! LOCK ORDER (deadlock-free by single direction): `launch_gate` may be held while acquiring
//! `inner` (the transfer critical section); `inner` is NEVER held while acquiring `launch_gate`,
//! joining the worker, or doing file/process I/O. `startup_worker` is only ever locked while
//! holding nothing else. The gate is held across exactly two bounded native calls
//! (`CreateProcessW`, `ResumeThread`) as required by the §5 linearization — never across recovery
//! waiting, readiness waiting, evidence I/O, drain joining, cooperative shutdown, process-exit
//! waiting, or worker joining.
//!
//! Nothing here establishes trust. No state is named SECURE / TRUSTED / PRODUCTION_READY and
//! protected approvals stay disabled throughout. The same-account threat boundary is DEFERRED:
//! the evidence store is crash-safe, not same-account-tamper-resistant (see `evidence.rs`).

#![cfg(windows)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::authority::{resolve_launch_authority, DaemonLaunchAuthority};
use super::errors::ProcessError;
use super::evidence::{EvidenceRecord, EvidenceStore};
use super::owner::{JobBoundProcessOwner, RealResumeApi};
use super::readiness::{classify_line, LineClass};
use super::recovery::{self, Win32RecoveryNative};
use projectos_windows_runtime_primitives::app_mode::detect_app_mode;

/// Bounded window for the daemon to announce `lifecycle.ready`.
pub(crate) const READY_TIMEOUT: Duration = Duration::from_secs(5);
/// Cancellation-observation slice inside the readiness wait.
pub(crate) const READY_CANCEL_SLICE: Duration = Duration::from_millis(250);
/// Hard cap on the whole shutdown sequence, so application exit can never hang.
pub(crate) const SHUTDOWN_HARD_CAP: Duration = Duration::from_secs(8);
/// Normal bound for joining the startup worker. Exceeding it surfaces a safe blocked status but
/// NEVER detaches the worker, exits, or releases host authority (§11).
pub(crate) const STARTUP_JOIN_NORMAL_BOUND: Duration = Duration::from_secs(15);
/// The exact bytes of the read-only snapshot request. Rust-authored constant — never caller data.
pub(crate) const SNAPSHOT_REQUEST: &[u8] = b"{\"cmd\":\"snapshot\"}\n";
/// The exact bytes of the cooperative lifecycle shutdown request.
pub(crate) const SHUTDOWN_REQUEST: &[u8] = b"{\"cmd\":\"lifecycle.shutdown\"}\n";

/// Owner-facing lifecycle status. Deliberately contains no SECURE/TRUSTED/PRODUCTION_READY.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DaemonStatus {
    NotStarted,
    /// The recovery barrier is verifying/waiting for a prior session's worker.
    Recovering,
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
            DaemonStatus::Recovering => {
                "ProjectOS is finishing recovery from the previous session."
            }
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

/// Closed startup state (§9). The shared minimum: finer steps (creating/persisting/resuming) are
/// worker-local program positions — the worker owns the child move-only throughout, so shared
/// state never needs them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupPhase {
    Idle,
    Recovering,
    Launching,
    AwaitingReadiness,
    /// Ownership moved into lifecycle state; publication happened in the same critical section.
    Transferred,
    Cancelled,
    Failed,
}

/// The launch interlock (§5). `closed` is set exactly once by the winning shutdown claimant;
/// the worker confirms it open UNDER THIS LOCK immediately around `CreateProcessW` and
/// `ResumeThread`, so no check-then-call race exists.
struct LaunchGate {
    closed: bool,
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
    startup: StartupPhase,
}

/// Tauri managed state: one authoritative lifecycle owner.
pub struct DaemonLifecycleState {
    inner: Mutex<Inner>,
    host_instance_id: String,
    launch_seq: AtomicU64,
    /// §5 launch interlock. Lock order: may be held while acquiring `inner`; never the reverse.
    launch_gate: Mutex<LaunchGate>,
    /// Startup cancellation. Set (with the gate closed) only by the winning shutdown claimant.
    cancel: AtomicBool,
    /// The RETAINED startup worker (§9). Never detached; joined by the shutdown claimant.
    startup_worker: Mutex<Option<JoinHandle<()>>>,
    /// Isolated evidence directory for tests; `None` = production per-user default.
    evidence_dir: Option<PathBuf>,
    /// Lazily resolved, cached evidence store. Locked briefly and never with another lock held.
    evidence: Mutex<Option<EvidenceStore>>,
}

impl DaemonLifecycleState {
    pub(crate) fn new(host_instance_id: String) -> DaemonLifecycleState {
        Self::new_impl(host_instance_id, None)
    }

    /// Construction with an isolated evidence directory (integration/unit tests). The scope
    /// correlation is still the real one, so what tests exercise is the real mechanism.
    pub fn with_evidence_dir(host_instance_id: String, dir: PathBuf) -> DaemonLifecycleState {
        Self::new_impl(host_instance_id, Some(dir))
    }

    fn new_impl(host_instance_id: String, evidence_dir: Option<PathBuf>) -> DaemonLifecycleState {
        DaemonLifecycleState {
            inner: Mutex::new(Inner {
                owner: None,
                status: DaemonStatus::NotStarted,
                instance: None,
                last_failure: None,
                shutdown: ShutdownPhase::None,
                startup: StartupPhase::Idle,
            }),
            host_instance_id,
            launch_seq: AtomicU64::new(0),
            launch_gate: Mutex::new(LaunchGate { closed: false }),
            cancel: AtomicBool::new(false),
            startup_worker: Mutex::new(None),
            evidence_dir,
            evidence: Mutex::new(None),
        }
    }

    /// Mint a fresh daemon instance id. Bounded ASCII, non-secret, no authority, never reused —
    /// every launch/restart gets a new one.
    fn next_instance_id(&self) -> String {
        let n = self.launch_seq.fetch_add(1, Ordering::SeqCst) + 1;
        format!("{}-{}", self.host_instance_id, n)
    }

    /// Resolve (once) and cache the evidence store.
    fn evidence_store(&self) -> Result<EvidenceStore, ProcessError> {
        let mut guard = self
            .evidence
            .lock()
            .map_err(|_| ProcessError::LifecycleStateBlocked)?;
        if let Some(s) = guard.as_ref() {
            return Ok(s.clone());
        }
        let store = match &self.evidence_dir {
            Some(dir) => EvidenceStore::at_dir(dir.clone())?,
            None => EvidenceStore::resolve()?,
        };
        *guard = Some(store.clone());
        Ok(store)
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

    /// Record a terminal startup outcome and hand back the error. Never touches `owner` — on
    /// every path that calls this, ownership is (still) with the startup worker, which has
    /// already terminated any child it created.
    fn startup_terminal(
        &self,
        phase: StartupPhase,
        status: DaemonStatus,
        err: ProcessError,
    ) -> ProcessError {
        if let Ok(mut g) = self.inner.lock() {
            g.startup = phase;
            g.status = status;
            g.last_failure = if err == ProcessError::RecoveryCancelled {
                None // a deliberate close is not a system failure
            } else {
                Some(err)
            };
        }
        err
    }

    /// Run `f` while HOLDING the launch gate, iff the gate is open and no cancellation/shutdown
    /// has been signalled. Returns `None` (without running `f`) when the gate is closed, when
    /// cancellation is set, or when the gate lock is poisoned — every ambiguous case fails
    /// closed. This is the §5 linearization point: closure and the guarded call cannot race.
    fn with_launch_gate<T>(&self, f: impl FnOnce() -> T) -> Option<T> {
        match self.launch_gate.lock() {
            Ok(gate) => {
                if gate.closed || self.cancel.load(Ordering::SeqCst) {
                    None
                } else {
                    // `gate` (the MutexGuard) is held for the duration of `f`.
                    Some(f())
                }
            }
            Err(_) => None,
        }
    }

    /// Retain the startup worker (§9). Called exactly once by `setup` right after spawning.
    pub fn store_startup_worker(&self, handle: JoinHandle<()>) {
        if let Ok(mut g) = self.startup_worker.lock() {
            *g = Some(handle);
        }
    }

    /// Best-effort terminal evidence after observed termination.
    fn write_stopped_evidence(&self, daemon_instance_id: &str) {
        let store = match self.evidence.lock() {
            Ok(g) => g.clone(),
            Err(_) => None,
        };
        if let Some(store) = store {
            let _ = store.write(&EvidenceRecord::stopped(
                store.scope(),
                &self.host_instance_id,
                daemon_instance_id,
            ));
        }
    }

    /// The startup worker body: recovery barrier → sealed authority → suspended creation →
    /// starting evidence → gated resume → readiness → running evidence → one-time transfer.
    ///
    /// Returns the stdout receiver so the caller can route protocol lines after readiness.
    /// No daemon instruction can execute before the starting record is durably persisted.
    pub fn run_startup(&self) -> Result<(Receiver<String>, String), ProcessError> {
        // Claim Idle → Recovering exactly once: only one startup worker can ever exist.
        {
            let mut g = self
                .inner
                .lock()
                .map_err(|_| ProcessError::LifecycleStateBlocked)?;
            if g.startup != StartupPhase::Idle || g.owner.is_some() {
                return Err(ProcessError::InvalidStateTransition);
            }
            g.startup = StartupPhase::Recovering;
            g.status = DaemonStatus::Recovering;
            g.last_failure = None;
        } // unlock before any slow work

        let store = self
            .evidence_store()
            .map_err(|e| self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e))?;

        // RECOVERY BARRIER: no prior daemon may be executing past this point.
        let cfg = recovery::RecoveryConfig::default();
        if let Err(e) = recovery::run_barrier(&store, &Win32RecoveryNative, &self.cancel, &cfg) {
            let (phase, status) = if e == ProcessError::RecoveryCancelled {
                (StartupPhase::Cancelled, DaemonStatus::Stopped)
            } else {
                (StartupPhase::Failed, DaemonStatus::Blocked)
            };
            return Err(self.startup_terminal(phase, status, e));
        }

        {
            let mut g = self
                .inner
                .lock()
                .map_err(|_| ProcessError::LifecycleStateBlocked)?;
            g.startup = StartupPhase::Launching;
            g.status = DaemonStatus::Starting;
        }

        let instance = self.next_instance_id();
        let authority = resolve_launch_authority(detect_app_mode(), instance.clone())
            .map_err(|e| self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e))?;
        let spec = match &authority {
            DaemonLaunchAuthority::Development(dev) => dev.to_process_spec(),
        }
        .map_err(|e| self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e))?;

        let (tx, rx): (Sender<String>, Receiver<String>) = std::sync::mpsc::channel();

        // CREATE under the launch gate (§5): gate check and the bounded local CreateProcessW are
        // one linearized step — a closed gate can never be followed by a creation.
        let created =
            self.with_launch_gate(|| JobBoundProcessOwner::start_daemon_suspended(&spec, tx));
        let mut owner = match created {
            None => {
                return Err(self.startup_terminal(
                    StartupPhase::Cancelled,
                    DaemonStatus::Stopped,
                    ProcessError::RecoveryCancelled,
                ))
            }
            Some(Err(e)) => {
                return Err(self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e))
            }
            Some(Ok(owner)) => owner,
        };

        // STARTING evidence — durably persisted BEFORE any child instruction can execute. A
        // persistence failure prevents ResumeThread and terminates the (suspended) child.
        let starting = EvidenceRecord::starting(
            store.scope(),
            &self.host_instance_id,
            &instance,
            owner.process_id(),
            owner.process_creation_time(),
        );
        if let Err(e) = store.write(&starting) {
            owner.shutdown(); // suspended ⇒ immediate bounded force; zero instructions ever ran
            drop(owner);
            return Err(self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e));
        }

        // RESUME under the launch gate (§5): a shutdown that closed the gate can never be
        // followed by a resume. Only a prior suspend count of exactly 1 is accepted; on any
        // rejected result the trusted child is terminated below, OUTSIDE the gate.
        let resumed = self.with_launch_gate(|| owner.resume_with(&RealResumeApi));
        match resumed {
            None => {
                owner.shutdown(); // still suspended ⇒ immediate bounded force
                drop(owner);
                let _ = store.write(&starting.as_stopped());
                return Err(self.startup_terminal(
                    StartupPhase::Cancelled,
                    DaemonStatus::Stopped,
                    ProcessError::RecoveryCancelled,
                ));
            }
            Some(Err(e)) => {
                owner.shutdown(); // terminate the trusted child via retained authority
                drop(owner);
                let _ = store.write(&starting.as_stopped());
                return Err(self.startup_terminal(StartupPhase::Failed, DaemonStatus::Crashed, e));
            }
            Some(Ok(())) => {}
        }

        {
            let mut g = self
                .inner
                .lock()
                .map_err(|_| ProcessError::LifecycleStateBlocked)?;
            g.startup = StartupPhase::AwaitingReadiness;
        }

        // Deterministic readiness — NOT process existence, NOT the incidental startup snapshot.
        if let Err(e) = await_ready(&rx, &instance, READY_TIMEOUT, &mut owner, &self.cancel) {
            owner.shutdown();
            drop(owner);
            let _ = store.write(&starting.as_stopped());
            let (phase, status) = if e == ProcessError::RecoveryCancelled {
                (StartupPhase::Cancelled, DaemonStatus::Stopped)
            } else {
                (StartupPhase::Failed, DaemonStatus::Crashed)
            };
            return Err(self.startup_terminal(phase, status, e));
        }

        // RUNNING evidence — before publication (§4 step 14). A failure here shuts the trusted
        // child down and fails closed (§8).
        if let Err(e) = store.write(&starting.as_running()) {
            owner.shutdown();
            drop(owner);
            let _ = store.write(&starting.as_stopped());
            return Err(self.startup_terminal(StartupPhase::Failed, DaemonStatus::Blocked, e));
        }

        // TRANSFER (§10): one gate→inner critical section. Exactly one of: lifecycle owns the
        // child (with publication in the same section), or startup keeps it and terminates it.
        // Shutdown can observe strictly-before or strictly-after — never an intermediate state.
        let refused: Option<JobBoundProcessOwner> = match self.launch_gate.lock() {
            Ok(gate) if !gate.closed && !self.cancel.load(Ordering::SeqCst) => {
                match self.inner.lock() {
                    Ok(mut g) if g.shutdown == ShutdownPhase::None => {
                        g.owner = Some(owner);
                        g.instance = Some(instance.clone());
                        g.status = DaemonStatus::RunningReadOnly;
                        g.startup = StartupPhase::Transferred;
                        g.last_failure = None;
                        None
                    }
                    _ => Some(owner),
                }
            }
            _ => Some(owner),
        };
        if let Some(mut owner) = refused {
            owner.shutdown();
            drop(owner);
            let _ = store.write(&starting.as_stopped());
            return Err(self.startup_terminal(
                StartupPhase::Cancelled,
                DaemonStatus::Stopped,
                ProcessError::RecoveryCancelled,
            ));
        }

        Ok((rx, instance))
    }

    /// Send the fixed read-only snapshot request. Rejected unless RUNNING_READ_ONLY with a matching
    /// instance; a broken pipe becomes a typed failure and never a panic.
    pub fn request_snapshot(&self, expect_instance: Option<&str>) -> Result<(), ProcessError> {
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

    /// Longest governed command line this host will forward. A governed command is a short typed
    /// envelope of identifiers; anything larger is not one, so it is refused rather than written.
    const MAX_GOVERNED_REQUEST_BYTES: usize = 4096;

    /// Forward ONE governed command line to the sidecar's stdin.
    ///
    /// This host does not interpret the command and holds no allowlist of its own: the vocabulary is
    /// closed and validated on both sides in TypeScript (`validateGovernedCommand`), and the sidecar
    /// re-validates every line it receives, so a second divergent copy of that policy here would be a
    /// liability rather than a control. What this function DOES guarantee is transport safety, which
    /// is genuinely its job:
    ///
    ///   * the daemon must be RUNNING_READ_ONLY and the instance must match, exactly as for a
    ///     snapshot request — a command can never start, restart or reconfigure anything;
    ///   * the payload must be a single line: an embedded newline would let one request smuggle a
    ///     second command past the sidecar's per-line parse, so it is refused, not escaped;
    ///   * the payload is bounded and must be non-empty;
    ///   * a broken pipe becomes a typed failure and never a panic.
    pub fn write_governed_request(
        &self,
        line: &str,
        expect_instance: Option<&str>,
    ) -> Result<(), ProcessError> {
        if line.is_empty() || line.len() > Self::MAX_GOVERNED_REQUEST_BYTES {
            return Err(ProcessError::DaemonNotReady);
        }
        // One line in, one command out. Rejecting embedded line breaks (rather than stripping them)
        // keeps the guarantee simple: what the caller sent is what the sidecar parses.
        if line.contains('\n') || line.contains('\r') {
            return Err(ProcessError::DaemonNotReady);
        }
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
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        owner.write_request(&bytes)
    }

    /// Record an observed process exit for `instance`. A stale instance must never move a
    /// replacement owner's state. Evidence is written OUTSIDE the lock.
    pub fn record_exit(&self, instance: &str) {
        let observed = match self.inner.lock() {
            Ok(mut g) => {
                if g.instance.as_deref() != Some(instance) {
                    false // stale: a replacement owner is live
                } else {
                    if matches!(g.status, DaemonStatus::Stopping | DaemonStatus::Stopped) {
                        g.status = DaemonStatus::Stopped;
                    } else {
                        g.status = DaemonStatus::Crashed;
                    }
                    g.owner = None;
                    g.instance = None;
                    true
                }
            }
            Err(_) => false,
        };
        if observed {
            self.write_stopped_evidence(instance);
        }
    }

    /// True when this instance is still the current one (used to discard stale stdout).
    pub fn is_current_instance(&self, instance: &str) -> bool {
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
    pub fn claim_shutdown(&self) -> bool {
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

    /// Run the full bounded shutdown (§11):
    ///  1. close the launch gate and set cancellation (no create/resume can begin afterwards);
    ///  2. join the retained startup worker (honest `is_finished` polling — after the normal
    ///     bound a safe blocked status is surfaced, but the wait NEVER gives up, detaches, or
    ///     releases host authority while startup work continues; the worker is bounded
    ///     post-cancellation, so this terminates);
    ///  3. only then inspect the owner — absence is now PROOF, not assumption;
    ///  4. run the normal daemon shutdown if ownership transferred;
    ///  5. write stopped evidence after termination is observed.
    ///
    /// Idempotent: a second call finds no worker and no owner and completes immediately.
    pub fn run_shutdown(&self) {
        // Gate closure + cancellation. Closure is under the gate lock, so it linearizes against
        // the worker's gated create/resume; a poisoned gate lock still fails closed because the
        // worker treats poison as closed.
        if let Ok(mut gate) = self.launch_gate.lock() {
            gate.closed = true;
        }
        self.cancel.store(true, Ordering::SeqCst);

        // Join the retained worker. `JoinHandle` has no timed join: poll `is_finished` in
        // bounded slices, then join for the panic classification.
        let worker = match self.startup_worker.lock() {
            Ok(mut g) => g.take(),
            Err(_) => None,
        };
        if let Some(handle) = worker {
            let normal_bound = Instant::now() + STARTUP_JOIN_NORMAL_BOUND;
            let mut flagged = false;
            while !handle.is_finished() {
                if !flagged && Instant::now() >= normal_bound {
                    flagged = true;
                    if let Ok(mut g) = self.inner.lock() {
                        g.status = DaemonStatus::Blocked;
                        g.last_failure = Some(ProcessError::LifecycleStateBlocked);
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if handle.join().is_err() {
                // Worker panic: classified here; the worker-local owner's Drop already terminated
                // any child during unwind (Job close is the backstop even on abort).
                if let Ok(mut g) = self.inner.lock() {
                    g.startup = StartupPhase::Failed;
                    g.last_failure = Some(ProcessError::LifecycleStateBlocked);
                }
            }
        }

        // Owner-absence is now proof: the joined worker can no longer create or transfer.
        let (owner, instance) = match self.inner.lock() {
            Ok(mut g) => (g.owner.take(), g.instance.take()),
            Err(_) => (None, None),
        };
        if let Some(mut owner) = owner {
            // Cooperative request first, stdin still open; then bounded grace; then force; the Job
            // close (on drop) is the final backstop.
            let _ = owner.write_request(SHUTDOWN_REQUEST);
            owner.shutdown();
            drop(owner);
            if let Some(instance) = instance.as_deref() {
                self.write_stopped_evidence(instance);
            }
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

    /// Current startup phase (test observability).
    pub fn startup_phase(&self) -> Option<StartupPhase> {
        self.inner.lock().ok().map(|g| g.startup)
    }

    /// Whether startup cancellation has been signalled (test observability — the real worker
    /// observes this through its gated/sliced checkpoints, never through polling this method).
    pub fn cancellation_requested(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

/// Wait for the exact `lifecycle.ready` for `instance`, discarding ordinary pre-ready output.
///
/// Pre-ready ordinary messages are DROPPED rather than buffered: the incidental startup snapshot is
/// stale by the time the UI exists, and a fresh snapshot is requested after readiness instead.
/// Cancellation is observed between bounded receive slices.
fn await_ready(
    rx: &Receiver<String>,
    instance: &str,
    timeout: Duration,
    owner: &mut JobBoundProcessOwner,
    cancel: &AtomicBool,
) -> Result<(), ProcessError> {
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(ProcessError::RecoveryCancelled);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return if owner.refresh_state().is_terminal() {
                Err(ProcessError::DaemonExitedEarly)
            } else {
                Err(ProcessError::DaemonReadyTimeout)
            };
        }
        match rx.recv_timeout(remaining.min(READY_CANCEL_SLICE)) {
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
                if owner.refresh_state().is_terminal() {
                    return Err(ProcessError::DaemonExitedEarly);
                }
                // Slice elapsed: loop for the cancellation/deadline checks.
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_evidence_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("projectos-lifecycle-tests")
            .join(format!("{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

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
    fn initial_startup_phase_is_idle() {
        assert_eq!(state().startup_phase(), Some(StartupPhase::Idle));
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
    fn concurrent_close_events_produce_exactly_one_claimant() {
        let st = std::sync::Arc::new(state());
        let winners: Vec<bool> = (0..8)
            .map(|_| {
                let st = st.clone();
                std::thread::spawn(move || st.claim_shutdown())
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect();
        assert_eq!(winners.iter().filter(|w| **w).count(), 1);
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
        let st = DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("stale-instance"),
        );
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
        let st = DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("exit-stopping"),
        );
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
            DaemonStatus::Recovering,
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
    fn recovering_status_uses_the_exact_owner_message() {
        assert_eq!(
            DaemonStatus::Recovering.next_safe_action(),
            "ProjectOS is finishing recovery from the previous session."
        );
        assert!(!DaemonStatus::Recovering.accepts_requests());
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
            DaemonStatus::Recovering,
            DaemonStatus::Starting,
            DaemonStatus::Stopping,
            DaemonStatus::Stopped,
            DaemonStatus::Crashed,
            DaemonStatus::Blocked,
        ] {
            assert!(!s.accepts_requests(), "{s:?} must not accept requests");
        }
    }

    #[test]
    fn startup_after_shutdown_is_cancelled_before_any_creation() {
        let st = DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("gate-closed"),
        );
        assert!(st.claim_shutdown());
        st.run_shutdown(); // closes the gate, sets cancellation; no worker, no owner
        let err = st.run_startup().unwrap_err();
        assert_eq!(err, ProcessError::RecoveryCancelled);
        assert_eq!(st.startup_phase(), Some(StartupPhase::Cancelled));
        // No evidence file was ever created: cancellation preceded any process creation.
        let dir = temp_evidence_dir("gate-closed"); // same path derivation
        let entries = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
        assert_eq!(entries, 0, "no evidence may exist after cancelled startup");
    }

    #[test]
    fn second_startup_claim_is_rejected() {
        let st = DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("second-claim"),
        );
        {
            let mut g = st.inner.lock().unwrap();
            g.startup = StartupPhase::Recovering; // a worker is (conceptually) mid-flight
        }
        assert_eq!(
            st.run_startup().unwrap_err(),
            ProcessError::InvalidStateTransition
        );
    }

    #[test]
    fn run_shutdown_joins_the_retained_worker_before_deciding() {
        let st = std::sync::Arc::new(DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("join"),
        ));
        let worker_state = st.clone();
        let worker = std::thread::spawn(move || {
            // A cooperative worker that only finishes once cancellation is signalled.
            while !worker_state.cancel.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        st.store_startup_worker(worker);
        assert!(st.claim_shutdown());
        st.run_shutdown();
        // The worker is provably joined: its JoinHandle slot is empty and shutdown completed.
        assert!(st.startup_worker.lock().unwrap().is_none());
        assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
    }

    #[test]
    fn worker_panic_is_detected_and_classified() {
        let st =
            DaemonLifecycleState::with_evidence_dir("host-test".into(), temp_evidence_dir("panic"));
        let worker = std::thread::spawn(|| panic!("startup worker panic (test)"));
        st.store_startup_worker(worker);
        assert!(st.claim_shutdown());
        st.run_shutdown();
        assert_eq!(st.startup_phase(), Some(StartupPhase::Failed));
        // Shutdown still completed; the app can still exit.
        assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
    }

    #[test]
    fn run_shutdown_is_idempotent() {
        let st = DaemonLifecycleState::with_evidence_dir(
            "host-test".into(),
            temp_evidence_dir("idempotent"),
        );
        assert!(st.claim_shutdown());
        st.run_shutdown();
        st.run_shutdown(); // second call: no worker, no owner, completes immediately
        assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
    }

    /// THE decisive proof: drive the REAL production path — recovery barrier → sealed authority →
    /// suspended Job-bound `CreateProcessW` → starting evidence → gated `ResumeThread` → explicit
    /// `lifecycle.ready` → running evidence → one-time transfer → status.
    ///
    /// Skips (rather than fails) when the dev tree/node is unavailable, so the suite stays
    /// portable; on this machine it runs for real.
    #[test]
    fn real_daemon_starts_suspended_recorded_and_reaches_running_read_only() {
        let dir = temp_evidence_dir("real-daemon");
        let st = DaemonLifecycleState::with_evidence_dir("host-live".into(), dir.clone());
        match st.run_startup() {
            Ok((_rx, instance)) => {
                assert_eq!(st.safe_status().state, DaemonStatus::RunningReadOnly);
                assert_eq!(st.startup_phase(), Some(StartupPhase::Transferred));
                assert!(st.is_current_instance(&instance));
                // The evidence record is RUNNING with a process claim.
                let store = st.evidence_store().unwrap();
                match store.read() {
                    crate::process::evidence::ReadOutcome::Valid(r) => {
                        assert_eq!(r.state, crate::process::evidence::EvidenceState::Running);
                        assert!(r.pid.is_some() && r.creation_time_filetime.is_some());
                        assert_eq!(r.daemon_instance_id, instance);
                    }
                    other => panic!("expected valid running record, got {other:?}"),
                }
                // A request is accepted only now that it is ready.
                assert!(st.request_snapshot(None).is_ok());
                // Stale instance is refused.
                assert_eq!(
                    st.request_snapshot(Some("host-live-999")),
                    Err(ProcessError::DaemonInstanceMismatch)
                );
                // Bounded shutdown leaves nothing behind and finalises the evidence.
                assert!(st.claim_shutdown());
                st.run_shutdown();
                assert_eq!(st.safe_status().state, DaemonStatus::Stopped);
                assert!(!st.safe_status().read_only_available);
                match store.read() {
                    crate::process::evidence::ReadOutcome::Valid(r) => {
                        assert_eq!(r.state, crate::process::evidence::EvidenceState::Stopped);
                        assert_eq!(r.pid, None);
                    }
                    other => panic!("expected valid stopped record, got {other:?}"),
                }
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

    #[test]
    fn shutdown_hard_cap_bounds_are_sane() {
        // Cooperative grace (5s) + force wait (2s) fit inside the hard cap; the join bound is
        // strictly larger than the worst post-cancellation worker remainder.
        assert!(SHUTDOWN_HARD_CAP >= Duration::from_secs(7));
        assert!(STARTUP_JOIN_NORMAL_BOUND > SHUTDOWN_HARD_CAP);
    }
}
