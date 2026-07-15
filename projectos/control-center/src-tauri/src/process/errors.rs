//! Typed, closed process-creation failures (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! Every failure is fail-closed: no partial ownership survives, and no caller may interpret a
//! failure as "running". Errors never carry raw handles, PIDs, full local paths, environment
//! contents, or stack traces.

use serde::Serialize;

/// Closed set of native process-creation / ownership failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProcessError {
    /// The native ownership architecture is Windows-only; other platforms get a closed result.
    UnsupportedPlatform,
    JobObjectCreateFailed,
    JobObjectConfigurationFailed,
    JobMembershipUnverified,
    PipeCreateFailed,
    PipeInheritanceConfigurationFailed,
    AttributeListSizeQueryFailed,
    AttributeListInitFailed,
    AttributeListUpdateFailed,
    /// The supplied executable is not the Cargo-built synthetic fixture. This crate launches nothing
    /// else — not node.exe, not a shell, not the Bridge Daemon.
    FixtureExecutableRejected,
    ExecutablePathInvalid,
    ExecutablePathNotAbsolute,
    CurrentDirectoryInvalid,
    CommandLineInvalid,
    CommandLineTooLong,
    EnvironmentVariableInvalid,
    ProcessCreateFailed,
    ProcessHandleUnavailable,
    ProcessCreationTimeUnavailable,
    ProcessExitCodeUnavailable,
    ShutdownTimeout,
    ForceTerminationFailed,
    InvalidStateTransition,
    InternalErrorRedacted,
}

impl ProcessError {
    /// Whether a process may still exist after this failure. `false` for every pre-creation
    /// failure — the invariant that makes cleanup provable.
    pub const fn process_may_exist(self) -> bool {
        matches!(
            self,
            ProcessError::JobMembershipUnverified
                | ProcessError::ProcessHandleUnavailable
                | ProcessError::ProcessCreationTimeUnavailable
                | ProcessError::ShutdownTimeout
                | ProcessError::ForceTerminationFailed
        )
    }

    /// Short, safe operator hint. No paths, handles, PIDs, env, or stack content.
    pub const fn next_safe_action(self) -> &'static str {
        match self {
            ProcessError::UnsupportedPlatform => {
                "Native process ownership is available on Windows only."
            }
            ProcessError::JobObjectCreateFailed
            | ProcessError::JobObjectConfigurationFailed
            | ProcessError::JobMembershipUnverified => {
                "The secure worker container could not be established; no worker was started."
            }
            ProcessError::PipeCreateFailed
            | ProcessError::PipeInheritanceConfigurationFailed
            | ProcessError::AttributeListSizeQueryFailed
            | ProcessError::AttributeListInitFailed
            | ProcessError::AttributeListUpdateFailed => {
                "The secure worker channel could not be prepared; no worker was started."
            }
            ProcessError::FixtureExecutableRejected
            | ProcessError::ExecutablePathInvalid
            | ProcessError::ExecutablePathNotAbsolute
            | ProcessError::CurrentDirectoryInvalid
            | ProcessError::CommandLineInvalid
            | ProcessError::CommandLineTooLong
            | ProcessError::EnvironmentVariableInvalid => {
                "The secure worker launch specification was rejected; no worker was started."
            }
            ProcessError::ProcessCreateFailed => {
                "The secure worker could not start; no worker process exists."
            }
            ProcessError::ProcessHandleUnavailable
            | ProcessError::ProcessCreationTimeUnavailable
            | ProcessError::ProcessExitCodeUnavailable => {
                "The secure worker could not be observed reliably and was stopped."
            }
            ProcessError::ShutdownTimeout | ProcessError::ForceTerminationFailed => {
                "The secure worker did not stop cooperatively and was force-stopped."
            }
            ProcessError::InvalidStateTransition | ProcessError::InternalErrorRedacted => {
                "Restart ProjectOS; the secure worker was left stopped."
            }
        }
    }
}
