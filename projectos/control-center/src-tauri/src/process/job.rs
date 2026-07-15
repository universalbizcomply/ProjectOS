//! Windows Job Object with kill-on-close (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! This is the OS-enforced parent-death mechanism. When every handle to the job closes — including
//! when the OS closes the host's handles because the host exited, panicked, or was force-killed —
//! the kernel terminates every process in the job. That is why it is the ONLY acceptable guarantee:
//! no in-memory callback, Drop impl, signal handler, or stdin-EOF path survives a force-kill.
//!
//! Two properties are load-bearing and easy to get silently wrong:
//!  1. The job handle MUST be non-inheritable (`lpJobAttributes = NULL`). If the child inherited a
//!     handle to the job, the job's handle count would never reach zero and kill-on-close would
//!     never fire — the protection would be silently dead.
//!  2. `JOB_OBJECT_LIMIT_BREAKAWAY_OK` / `SILENT_BREAKAWAY_OK` must NEVER be set. Their absence is
//!     what keeps grandchildren contained.

#![cfg(windows)]

use std::os::windows::io::OwnedHandle;

use windows::core::BOOL;
use windows::Win32::System::JobObjects::{
    CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

use super::errors::ProcessError;
use super::handles::{adopt, win32};

/// An owned Job Object configured to kill its members when the last handle closes.
pub struct JobObject {
    handle: OwnedHandle,
}

impl JobObject {
    /// Create and configure the job. Configuration happens BEFORE any process creation, so the job
    /// is fully armed the instant a child can exist. A configuration failure returns an error and
    /// drops the handle — no process is ever created against an unarmed job.
    pub fn create_kill_on_close() -> Result<JobObject, ProcessError> {
        // SAFETY: lpJobAttributes = None yields a NON-INHERITABLE handle (required, see module doc);
        // lpName = None creates an unnamed job. The call returns an owned HANDLE or an error.
        let raw = unsafe { CreateJobObjectW(None, None) }
            .map_err(|_| ProcessError::JobObjectCreateFailed)?;
        // SAFETY: `raw` is an owned handle freshly returned by CreateJobObjectW with no other owner.
        let handle = unsafe { adopt(raw) }.ok_or(ProcessError::JobObjectCreateFailed)?;

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // NOTE: BREAKAWAY_OK / SILENT_BREAKAWAY_OK are deliberately NOT set — that is what contains
        // grandchildren.

        // SAFETY: `handle` is a valid job handle we own; `&info` points to a correctly initialised
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION that outlives the call; the length matches the type.
        unsafe {
            SetInformationJobObject(
                win32(&handle),
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|_| ProcessError::JobObjectConfigurationFailed)?;
        // On error, `handle` drops here → CloseHandle → job destroyed. No unarmed job survives.

        Ok(JobObject { handle })
    }

    pub fn handle(&self) -> &OwnedHandle {
        &self.handle
    }

    /// Confirm the process is a member of THIS job. Verification, never assumption: a `true` from
    /// `IsProcessInJob` with an explicit job handle is the only accepted proof of containment.
    pub fn contains(&self, process: &OwnedHandle) -> Result<bool, ProcessError> {
        let mut result = BOOL(0);
        // SAFETY: both handles are valid and owned by us for the duration of the call; `result`
        // points to a live local BOOL.
        unsafe { IsProcessInJob(win32(process), Some(win32(&self.handle)), &mut result) }
            .map_err(|_| ProcessError::JobMembershipUnverified)?;
        Ok(result.as_bool())
    }
}

// Dropping `JobObject` closes the last handle we hold → kill-on-close terminates every member.
// This is intentional and is the backstop relied on by shutdown and by host crash.
