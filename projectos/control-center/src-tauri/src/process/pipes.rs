//! Explicit anonymous stdio pipes (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! Three anonymous pipe pairs. For each pair exactly one end is handed to the child and the other is
//! retained by the host. Anonymous pipes are sufficient here; named pipes would add a namespace and
//! ACL surface for no benefit, so they are not used.
//!
//! Inheritance discipline (the part that must not be got wrong):
//!  - each pipe is created with `bInheritHandle = TRUE`, so BOTH ends start inheritable;
//!  - the PARENT-side end then has its inherit flag cleared via `SetHandleInformation`;
//!  - only the three CHILD-side ends therefore remain inheritable, and only those three go in the
//!    `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`.
//!
//! The parent's copies of the child-side ends MUST be closed immediately after process creation —
//! otherwise the pipe never reaches EOF (the parent itself holds a writer open) and the drain
//! threads would block forever.

#![cfg(windows)]

use std::os::windows::io::OwnedHandle;

use windows::Win32::Foundation::{SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::System::Pipes::CreatePipe;

use super::errors::ProcessError;
use projectos_windows_runtime_primitives::handles::{adopt, win32};

/// One anonymous pipe pair, split into the end the child receives and the end the host keeps.
pub struct PipePair {
    pub child_end: OwnedHandle,
    pub parent_end: OwnedHandle,
}

impl PipePair {
    /// Borrow the child-side end as a Win32 `HANDLE` for `STARTUPINFOW`/`HANDLE_LIST`. Confers no
    /// ownership; the value must not outlive `self`.
    pub fn child_end_handle(&self) -> HANDLE {
        win32(&self.child_end)
    }
}

/// Create an anonymous pipe and assign the ends according to `child_gets_read`.
fn create_pipe(child_gets_read: bool) -> Result<PipePair, ProcessError> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: core::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: core::ptr::null_mut(),
        bInheritHandle: true.into(),
    };
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: `read`/`write` point to live locals; `sa` outlives the call and is correctly sized.
    // Both returned handles are owned by us.
    unsafe { CreatePipe(&mut read, &mut write, Some(&sa), 0) }
        .map_err(|_| ProcessError::PipeCreateFailed)?;

    // SAFETY: both handles were just returned by CreatePipe, are valid, and have no other owner.
    let read = unsafe { adopt(read) }.ok_or(ProcessError::PipeCreateFailed)?;
    let write = unsafe { adopt(write) }.ok_or(ProcessError::PipeCreateFailed)?;
    // If either adopt fails the other drops here — no leak on the partial path.

    let (child_end, parent_end) = if child_gets_read {
        (read, write)
    } else {
        (write, read)
    };

    // Clear inheritance on the PARENT end only. The child end stays inheritable and will be named
    // explicitly in the HANDLE_LIST.
    // SAFETY: `parent_end` is a valid handle we own; clearing HANDLE_FLAG_INHERIT does not affect
    // ownership or validity.
    unsafe { SetHandleInformation(win32(&parent_end), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) }
        .map_err(|_| ProcessError::PipeInheritanceConfigurationFailed)?;

    Ok(PipePair {
        child_end,
        parent_end,
    })
}

/// The three stdio pipes for a child process.
pub struct StdioPipes {
    /// Child reads stdin; host writes.
    pub stdin: PipePair,
    /// Child writes stdout; host reads.
    pub stdout: PipePair,
    /// Child writes stderr; host reads.
    pub stderr: PipePair,
}

impl StdioPipes {
    pub fn create() -> Result<StdioPipes, ProcessError> {
        Ok(StdioPipes {
            stdin: create_pipe(true)?,
            stdout: create_pipe(false)?,
            stderr: create_pipe(false)?,
        })
        // Any `?` here drops the pipes already created — partial construction cleans itself up.
    }

    /// The exact set of handles the child may inherit. Nothing else — not the job handle, not a
    /// mutex, not any unrelated Tauri handle — appears in this list.
    pub fn child_handle_list(&self) -> [HANDLE; 3] {
        [
            win32(&self.stdin.child_end),
            win32(&self.stdout.child_end),
            win32(&self.stderr.child_end),
        ]
    }
}
