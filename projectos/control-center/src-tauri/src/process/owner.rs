//! Move-only owner of a job-contained synthetic process (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! Every handle has exactly one owner here. `Drop` performs best-effort cleanup, but it is NEVER the
//! guarantee — dropping the `JobObject` closes the last job handle and the kernel kills every member.
//! That is what survives a panic, an abort, or a force-kill.
//!
//! Liveness is DERIVED from the retained process handle (`WaitForSingleObject` / `GetExitCodeProcess`),
//! never from a boolean set once at startup. Output EOF may corroborate exit but can never
//! independently establish liveness.
//!
//! This phase's ceiling is `RUNNING_UNTRUSTED`. Nothing here mints, asserts, or implies trust.

#![cfg(windows)]

use std::io::Write;
use std::os::windows::io::OwnedHandle;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, TerminateProcess, WaitForSingleObject,
};

use super::create::{create_in_job, CreatedProcess, ProcessSpec, SpecClassification};
use super::diagnostics::{drain, BoundedOutput};
use super::errors::ProcessError;
use super::handles::win32;
use super::job::JobObject;
use super::state::ProcessState;

/// Exit code used when we force-terminate an uncooperative child.
const FORCE_TERMINATION_EXIT_CODE: u32 = 0x5000_0001;
/// Upper bound on joining a drain thread, so shutdown can never hang indefinitely.
const DRAIN_JOIN_GRACE: Duration = Duration::from_secs(2);

/// Force-terminate a process via a retained handle. Best-effort: the Job Object remains the backstop.
pub(super) fn force_terminate(process: &OwnedHandle) {
    // SAFETY: `process` is a valid handle we own; TerminateProcess does not consume it.
    let _ = unsafe { TerminateProcess(win32(process), FORCE_TERMINATION_EXIT_CODE) };
}

/// Whether the process has exited, without blocking.
fn has_exited(process: &OwnedHandle) -> bool {
    // SAFETY: `process` is a valid owned handle; a 0ms wait polls without blocking.
    let r = unsafe { WaitForSingleObject(win32(process), 0) };
    r == WAIT_OBJECT_0
}

/// Block until exit or timeout. Returns true if the process exited.
fn wait_for_exit(process: &OwnedHandle, timeout: Duration) -> bool {
    let ms = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
    // SAFETY: `process` is a valid owned handle; `ms` is a bounded timeout.
    let r = unsafe { WaitForSingleObject(win32(process), ms) };
    if r == WAIT_TIMEOUT {
        return false;
    }
    r == WAIT_OBJECT_0
}

/// Read the exit code of an exited process.
fn exit_code(process: &OwnedHandle) -> Result<u32, ProcessError> {
    let mut code = 0u32;
    // SAFETY: `process` is a valid owned handle; `code` is a live local.
    unsafe { GetExitCodeProcess(win32(process), &mut code) }
        .map_err(|_| ProcessError::ProcessExitCodeUnavailable)?;
    Ok(code)
}

/// The only executable this crate will ever launch. Anything else is refused — so even inside the
/// `test-fixtures` boundary there is no path to node.exe, a shell, the real Bridge Daemon, or any
/// other application.
const EXPECTED_FIXTURE_FILE_NAME: &str = "projectos-test-child.exe";

/// Closed set of synthetic fixture behaviours. A caller selects a MODE, never a command line — there
/// is deliberately no way to express "run this executable with these arguments".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureMode {
    Wait,
    ExitImmediately,
    ExitCode42,
    WriteStdout,
    WriteStderr,
    Flood,
    IgnoreShutdown,
    SpawnGrandchild,
}

impl FixtureMode {
    /// The fixed argument the fixture binary understands. Not caller-supplied.
    const fn arg(self) -> &'static str {
        match self {
            FixtureMode::Wait => "wait",
            FixtureMode::ExitImmediately => "exit-immediately",
            FixtureMode::ExitCode42 => "exit-code",
            FixtureMode::WriteStdout => "write-stdout",
            FixtureMode::WriteStderr => "write-stderr",
            FixtureMode::Flood => "flood",
            FixtureMode::IgnoreShutdown => "ignore-shutdown",
            FixtureMode::SpawnGrandchild => "spawn-grandchild",
        }
    }
}

/// The ONLY publicly constructible process specification, and it cannot describe an arbitrary
/// process. The adapter — not the caller — supplies the token, the arguments, the working directory
/// and the environment. The caller may choose only a closed `FixtureMode`.
#[derive(Debug, Clone)]
pub struct SyntheticFixtureSpec {
    fixture_exe: String,
    mode: FixtureMode,
    graceful_shutdown: Duration,
}

impl SyntheticFixtureSpec {
    /// Build a fixture spec. `fixture_exe` must be the Cargo-built synthetic child — integration
    /// tests pass `env!("CARGO_BIN_EXE_projectos-test-child")`. Any other executable is refused by
    /// file name, so this constructor cannot be turned into a general launcher.
    pub fn new(fixture_exe: impl Into<String>, mode: FixtureMode) -> Result<Self, ProcessError> {
        let exe = fixture_exe.into();
        let is_fixture = std::path::Path::new(&exe)
            .file_name()
            .and_then(|f| f.to_str())
            .map(|f| f.eq_ignore_ascii_case(EXPECTED_FIXTURE_FILE_NAME))
            .unwrap_or(false);
        if !is_fixture {
            return Err(ProcessError::FixtureExecutableRejected);
        }
        Ok(SyntheticFixtureSpec {
            fixture_exe: exe,
            mode,
            graceful_shutdown: Duration::from_secs(3),
        })
    }

    /// Override the bounded cooperative-shutdown grace (tests keep this short).
    pub fn with_graceful_shutdown(mut self, d: Duration) -> Self {
        self.graceful_shutdown = d;
        self
    }

    /// Translate to the crate-private generic spec. The token, argument order, working directory and
    /// environment are injected HERE — never accepted from a caller.
    fn to_process_spec(&self) -> ProcessSpec {
        ProcessSpec {
            executable: self.fixture_exe.clone(),
            args: vec![
                super::SYNTHETIC_CHILD_TOKEN.to_string(),
                self.mode.arg().to_string(),
            ],
            current_dir: std::env::temp_dir().to_string_lossy().to_string(),
            // Minimum proven-sufficient environment; no PATH, no host inheritance, no secrets.
            env: super::environment::collect_system_vars(&["SystemRoot"]),
            graceful_shutdown: self.graceful_shutdown,
            classification: SpecClassification::SyntheticTest,
        }
    }
}

/// The authoritative owner. Move-only: no `Clone`, no `Copy`.
pub struct SyntheticProcessOwner {
    state: ProcessState,
    job: JobObject,
    process: OwnedHandle,
    process_id: u32,
    process_creation_time: u64,
    /// Safe `File` view of the stdin pipe. Dropping it (via `= None` in shutdown) closes the pipe —
    /// which is why it must NOT be dropped before the graceful wait completes.
    stdin_writer: Option<std::fs::File>,
    stdout: Arc<Mutex<BoundedOutput>>,
    stderr: Arc<Mutex<BoundedOutput>>,
    stdout_thread: Option<JoinHandle<()>>,
    stderr_thread: Option<JoinHandle<()>>,
    graceful_shutdown: Duration,
    last_exit_code: Option<u32>,
    last_failure: Option<ProcessError>,
}

impl SyntheticProcessOwner {
    /// The ONLY public way to create a process in this crate. It accepts a closed fixture spec, not
    /// an executable path — so no caller, even under `test-fixtures`, can launch anything except the
    /// Cargo-built synthetic child in one of its fixed modes.
    pub fn start_fixture(
        spec: &SyntheticFixtureSpec,
    ) -> Result<SyntheticProcessOwner, ProcessError> {
        Self::start(&spec.to_process_spec())
    }

    /// Start a synthetic child already contained in a fresh kill-on-close job.
    ///
    /// Order is load-bearing: job created and ARMED first, then pipes, then atomic creation. Any
    /// failure before success leaves no process — and the job (dropped on the error path) would kill
    /// one anyway.
    pub(crate) fn start(spec: &ProcessSpec) -> Result<SyntheticProcessOwner, ProcessError> {
        let job = JobObject::create_kill_on_close()?;
        let CreatedProcess {
            process,
            process_id,
            creation_time,
            stdin_writer,
            stdout_reader,
            stderr_reader,
        } = create_in_job(spec, &job)?;

        let stdout = Arc::new(Mutex::new(BoundedOutput::default()));
        let stderr = Arc::new(Mutex::new(BoundedOutput::default()));

        // Drain from process start: an undrained pipe would block the child once full.
        let so = stdout.clone();
        let stdout_thread = std::thread::spawn(move || {
            let f = std::fs::File::from(stdout_reader);
            drain(f, so);
        });
        let se = stderr.clone();
        let stderr_thread = std::thread::spawn(move || {
            let f = std::fs::File::from(stderr_reader);
            drain(f, se);
        });

        Ok(SyntheticProcessOwner {
            state: ProcessState::RunningUntrusted,
            job,
            process,
            process_id,
            process_creation_time: creation_time,
            // SAFE conversion: OwnedHandle -> File transfers ownership, no unsafe needed.
            stdin_writer: Some(std::fs::File::from(stdin_writer)),
            stdout,
            stderr,
            stdout_thread: Some(stdout_thread),
            stderr_thread: Some(stderr_thread),
            graceful_shutdown: spec.graceful_shutdown,
            last_exit_code: None,
            last_failure: None,
        })
    }

    pub fn process_id(&self) -> u32 {
        self.process_id
    }

    pub fn process_creation_time(&self) -> u64 {
        self.process_creation_time
    }

    pub fn last_exit_code(&self) -> Option<u32> {
        self.last_exit_code
    }

    pub fn last_failure(&self) -> Option<ProcessError> {
        self.last_failure
    }

    /// Confirm containment in this owner's job. Verification, never assumption.
    pub fn is_contained(&self) -> Result<bool, ProcessError> {
        self.job.contains(&self.process)
    }

    /// Refresh state from the OS. This is the ONLY liveness authority: a boolean that merely
    /// remembers a successful start can never be true here.
    pub fn refresh_state(&mut self) -> ProcessState {
        if self.state.is_terminal() {
            return self.state;
        }
        if has_exited(&self.process) {
            let code = exit_code(&self.process).ok();
            self.last_exit_code = code;
            self.state = match (self.state, code) {
                (ProcessState::ShutdownRequested | ProcessState::Terminating, _) => {
                    ProcessState::Terminated
                }
                (_, Some(0)) => ProcessState::Terminated,
                _ => ProcessState::Crashed,
            };
        }
        self.state
    }

    pub fn state(&self) -> ProcessState {
        self.state
    }

    /// Owner-facing status. Never reports "secure" — this phase establishes no trust.
    pub fn owner_status(&mut self) -> &'static str {
        self.refresh_state().owner_status()
    }

    /// Send a cooperative shutdown line while stdin is still open.
    ///
    /// The writer is a plain `File` (obtained by the SAFE `File::from(OwnedHandle)` conversion), so
    /// writing needs no unsafe code and dropping it — which happens exactly once, when
    /// `stdin_writer` is set to `None` during shutdown — closes the pipe.
    pub fn send_cooperative_shutdown(&mut self) -> Result<(), ProcessError> {
        let Some(w) = self.stdin_writer.as_mut() else {
            return Ok(());
        };
        // A closed/broken pipe here is not fatal: the child may already be gone, and shutdown
        // proceeds to the bounded wait and then force-termination regardless.
        let _ = w.write_all(b"shutdown\n");
        let _ = w.flush();
        Ok(())
    }

    pub fn stdout_text(&self) -> String {
        self.stdout.lock().map(|g| g.render()).unwrap_or_default()
    }

    pub fn stderr_text(&self) -> String {
        self.stderr.lock().map(|g| g.render()).unwrap_or_default()
    }

    /// Idempotent bounded shutdown.
    ///
    /// Ordering correction carried from DESIGN1B: stdin stays OPEN across the graceful wait —
    /// closing it first destroys the very channel the shutdown request travels on and forfeits any
    /// chance of cooperative exit.
    pub fn shutdown(&mut self) -> ProcessState {
        if self.state.is_terminal() {
            return self.state;
        }
        self.state = ProcessState::ShutdownRequested;

        // 1. Cooperative request, stdin still open.
        let _ = self.send_cooperative_shutdown();

        // 2. Bounded grace.
        let exited = wait_for_exit(&self.process, self.graceful_shutdown);

        // 3. Force if still alive.
        if !exited {
            self.state = ProcessState::Terminating;
            force_terminate(&self.process);
            if !wait_for_exit(&self.process, Duration::from_secs(2)) {
                self.last_failure = Some(ProcessError::ForceTerminationFailed);
            }
        }

        self.last_exit_code = exit_code(&self.process).ok();

        // 4. Only now close stdin, so the child saw EOF only after its chance to exit cleanly.
        self.stdin_writer = None;

        // 5. Join drains with a bound — never an indefinite join.
        self.join_drains();

        self.state = ProcessState::Terminated;
        self.state
    }

    /// Join drain threads without hanging. The pipes reach EOF once the child is gone and the
    /// parent's child-side copies are closed (done at creation), so this normally returns at once.
    fn join_drains(&mut self) {
        let deadline = Instant::now() + DRAIN_JOIN_GRACE;
        for t in [self.stdout_thread.take(), self.stderr_thread.take()]
            .into_iter()
            .flatten()
        {
            while !t.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            if t.is_finished() {
                let _ = t.join();
            }
            // If still unfinished, the thread is blocked on a pipe that must already be closed;
            // detaching is safe because the buffer is Arc-owned and bounded.
        }
    }
}

impl Drop for SyntheticProcessOwner {
    fn drop(&mut self) {
        // Best-effort only. The real guarantee is the JobObject field dropping right after this,
        // which closes the last job handle → kill-on-close → every member dies, even on panic.
        if !self.state.is_terminal() {
            let _ = self.shutdown();
        }
    }
}
