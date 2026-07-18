//! Native job-bound process-creation foundation (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! This slice proves a REUSABLE Windows process-creation foundation against a synthetic test child.
//! It deliberately does NOT touch the real ProjectOS sidecar: `main.rs` still launches the Bridge
//! Daemon exactly as before. Wiring this creator into the real sidecar is WINDOWS-PROCESS-OWNERSHIP1B.
//!
//! What it establishes:
//!  - a Job Object armed with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` BEFORE any child exists;
//!  - a child assigned to that job BY THE KERNEL during creation (`PROC_THREAD_ATTRIBUTE_JOB_LIST`),
//!    so no unowned-child window exists at all;
//!  - inheritance restricted to exactly three stdio handles (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`);
//!  - retained process/job handles, PID and creation time (PID reuse cannot forge identity);
//!  - liveness derived from the process handle, never a sticky boolean;
//!  - bounded, redacted stdout/stderr capture drained from process start.
//!
//! What it deliberately does NOT do: mint trust, expose a Tauri command, provide a generic command
//! runner, run a shell, resolve PATH, inherit the environment, or reach `TRUST_ELIGIBLE` (a state
//! that does not exist in this phase's model).
//!
//! The foundation is exercised by the synthetic-child tests and consumed by the later wiring phase
//! (WINDOWS-PROCESS-OWNERSHIP1B); the bin entry deliberately does not call it yet — this slice must
//! not touch the real sidecar — so `dead_code` is allowed module-wide.
#![allow(dead_code)]

pub(crate) mod authority;
pub(crate) mod command_line;
pub(crate) mod dev_runtime;
pub mod diagnostics;
pub(crate) mod environment;
pub mod errors;
pub(crate) mod readiness;
pub mod state;

#[cfg(windows)]
pub(crate) mod create;
#[cfg(windows)]
pub(crate) mod evidence;
#[cfg(windows)]
pub(crate) mod handles;
#[cfg(windows)]
pub(crate) mod job;
#[cfg(windows)]
pub(crate) mod lifecycle;
#[cfg(windows)]
pub mod owner;
#[cfg(windows)]
pub(crate) mod pipes;
#[cfg(windows)]
pub(crate) mod recovery;

/// Argv token the synthetic test child requires before it will do anything. It exists so the fixture
/// cannot be repurposed: without this exact token the child exits non-zero immediately.
pub(crate) const SYNTHETIC_CHILD_TOKEN: &str = "--projectos-synthetic-test-child";

/// Non-Windows callers get a closed typed result rather than a partial stub.
#[cfg(not(windows))]
pub fn native_ownership_available() -> Result<(), errors::ProcessError> {
    Err(errors::ProcessError::UnsupportedPlatform)
}

/// Windows is the supported native-ownership target.
#[cfg(windows)]
pub fn native_ownership_available() -> Result<(), errors::ProcessError> {
    Ok(())
}
