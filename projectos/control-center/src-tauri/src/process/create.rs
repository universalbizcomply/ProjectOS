//! Atomic job-bound process creation (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! The child is assigned to its controlling Job Object BY THE KERNEL, as part of process creation,
//! via `PROC_THREAD_ATTRIBUTE_JOB_LIST`. It is therefore in the job before its first instruction
//! executes, and if the assignment cannot be honoured `CreateProcessW` FAILS and no process exists.
//! There is no interval in which an unowned child can survive host death.
//!
//! Permanently rejected alternatives (do not reintroduce):
//!  - `Command::spawn()` then `AssignProcessToJobObject` — the host can die in between, leaving a
//!    live unowned daemon. Gating trust afterwards does not fix a lifetime defect.
//!  - `CREATE_SUSPENDED` then assign — the process already exists; host death in that window leaves
//!    a suspended orphan that never exits. A suspended orphan is still an orphan.
//!  - host-joins-job — captures WebView2 and the updater, and aims kill-on-close at the host itself.

#![cfg(windows)]

use std::os::windows::io::OwnedHandle;
use std::path::Path;
use std::time::Duration;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{FILETIME, HANDLE};
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetProcessTimes,
    InitializeProcThreadAttributeList, UpdateProcThreadAttribute, CREATE_NO_WINDOW,
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW,
};

use super::command_line::{build_command_line, to_wide_nul};
use super::environment::build_environment_block;
use super::errors::ProcessError;
use super::handles::{adopt, win32};
use super::job::JobObject;
use super::pipes::StdioPipes;

/// What a spec is for. Only synthetic tests exist in this phase — there is deliberately no variant a
/// caller could use to request a production or trusted process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpecClassification {
    SyntheticTest,
}

/// A closed, bounded process specification. It carries no shell text, no raw command line, no PATH
/// lookup, no environment-inheritance toggle, and no trust or production selector.
#[derive(Debug, Clone)]
pub(crate) struct ProcessSpec {
    /// Absolute path to the executable. Passed as `lpApplicationName`, so PATH is never searched.
    pub(crate) executable: String,
    /// Fixed, validated arguments. Never a raw command line.
    pub(crate) args: Vec<String>,
    /// Explicit absolute working directory. Ambient cwd is never inherited.
    pub(crate) current_dir: String,
    /// Explicit allowlisted environment. The host environment is never inherited.
    pub(crate) env: Vec<(String, String)>,
    /// Bounded cooperative-shutdown grace period.
    pub(crate) graceful_shutdown: Duration,
    pub(crate) classification: SpecClassification,
}

impl ProcessSpec {
    fn validate(&self) -> Result<(), ProcessError> {
        let exe = Path::new(&self.executable);
        if self.executable.is_empty() {
            return Err(ProcessError::ExecutablePathInvalid);
        }
        if !exe.is_absolute() {
            return Err(ProcessError::ExecutablePathNotAbsolute);
        }
        if !exe.is_file() {
            return Err(ProcessError::ExecutablePathInvalid);
        }
        let dir = Path::new(&self.current_dir);
        if !dir.is_absolute() || !dir.is_dir() {
            return Err(ProcessError::CurrentDirectoryInvalid);
        }
        Ok(())
    }
}

/// RAII owner of a PROC_THREAD attribute list. `Drop` deletes the list exactly once, so every
/// early-return path (including a failed `UpdateProcThreadAttribute`) cleans up correctly.
struct AttributeList {
    buf: Vec<u8>,
    initialized: bool,
}

impl AttributeList {
    /// Documented two-call size pattern: the first call is EXPECTED to fail while reporting the
    /// required size.
    fn new(count: u32) -> Result<AttributeList, ProcessError> {
        let mut size: usize = 0;
        // SAFETY: passing None for the list is the documented size-query form; `size` is a live
        // local. The call is expected to return an error (ERROR_INSUFFICIENT_BUFFER) and set `size`.
        let _ = unsafe { InitializeProcThreadAttributeList(None, count, None, &mut size) };
        if size == 0 {
            return Err(ProcessError::AttributeListSizeQueryFailed);
        }
        // Bounded allocation: the list for 2 attributes is tens of bytes; reject anything absurd.
        if size > 64 * 1024 {
            return Err(ProcessError::AttributeListSizeQueryFailed);
        }
        let mut list = AttributeList {
            buf: vec![0u8; size],
            initialized: false,
        };
        let p = LPPROC_THREAD_ATTRIBUTE_LIST(list.buf.as_mut_ptr() as *mut core::ffi::c_void);
        // SAFETY: `p` points to a `size`-byte allocation owned by `list.buf` which outlives this
        // call; `size` is exactly what the size query reported.
        unsafe { InitializeProcThreadAttributeList(Some(p), count, None, &mut size) }
            .map_err(|_| ProcessError::AttributeListInitFailed)?;
        list.initialized = true;
        Ok(list)
    }

    fn as_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        LPPROC_THREAD_ATTRIBUTE_LIST(self.buf.as_mut_ptr() as *mut core::ffi::c_void)
    }

    /// Attach one attribute.
    ///
    /// # Safety
    /// `value` must point to storage that stays valid and unmoved until `CreateProcessW` returns —
    /// the list stores the POINTER, not a copy. This is the classic lifetime bug here.
    unsafe fn update(
        &mut self,
        attribute: usize,
        value: *const core::ffi::c_void,
        size: usize,
    ) -> Result<(), ProcessError> {
        let p = self.as_ptr();
        // SAFETY: `p` is an initialised attribute list; `value`/`size` describe caller-guaranteed
        // live storage (see this function's contract).
        unsafe { UpdateProcThreadAttribute(p, 0, attribute, Some(value), size, None, None) }
            .map_err(|_| ProcessError::AttributeListUpdateFailed)
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        if self.initialized {
            let p = LPPROC_THREAD_ATTRIBUTE_LIST(self.buf.as_mut_ptr() as *mut core::ffi::c_void);
            // SAFETY: the list was successfully initialised and has not been deleted; this runs
            // exactly once because `initialized` gates it and Drop runs once.
            unsafe { DeleteProcThreadAttributeList(p) };
            self.initialized = false;
        }
    }
}

/// A successfully created, job-contained process plus the host-side pipe ends.
pub(crate) struct CreatedProcess {
    pub(crate) process: OwnedHandle,
    /// The primary-thread handle. For a suspended launch it is the ONLY authority that can make
    /// the child runnable (`ResumeThread`), so it is retained and consumed exactly once by the
    /// owner; for a non-suspended launch the owner drops it immediately (nothing to resume).
    pub(crate) thread: OwnedHandle,
    pub(crate) process_id: u32,
    pub(crate) creation_time: u64,
    pub(crate) stdin_writer: OwnedHandle,
    pub(crate) stdout_reader: OwnedHandle,
    pub(crate) stderr_reader: OwnedHandle,
}

/// Read the process creation time (100ns FILETIME ticks). Together with the PID this defeats PID
/// reuse: a recycled PID cannot match the original creation instant.
fn creation_time(process: &OwnedHandle) -> Result<u64, ProcessError> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: `process` is a valid handle we own; all four FILETIME outs are live locals.
    unsafe {
        GetProcessTimes(
            win32(process),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    }
    .map_err(|_| ProcessError::ProcessCreationTimeUnavailable)?;
    Ok(((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64)
}

/// Create the child process already inside `job`.
///
/// Ordering is the whole point: the job is created and armed by the caller BEFORE this runs, and the
/// kernel performs the assignment during creation. On any failure no usable process is left behind.
///
/// `suspended` adds `CREATE_SUSPENDED` (RECOVERY-BARRIER1B): the primary thread is never scheduled,
/// so the child executes ZERO instructions until an explicit `ResumeThread`. Job assignment via
/// `PROC_THREAD_ATTRIBUTE_JOB_LIST` is a creation-time kernel action and remains atomic with the
/// suspension — the child is contained before it exists as a runnable entity. It is a separate
/// parameter (not a `ProcessSpec` field) so the sealed authority (`authority.rs`) stays untouched.
pub(crate) fn create_in_job(
    spec: &ProcessSpec,
    job: &JobObject,
    suspended: bool,
) -> Result<CreatedProcess, ProcessError> {
    spec.validate()?;

    let mut command_line = build_command_line(&spec.executable, &spec.args)?;
    let application = to_wide_nul(&spec.executable)?;
    let current_dir = to_wide_nul(&spec.current_dir)?;
    let environment = build_environment_block(&spec.env)?;

    let pipes = StdioPipes::create()?;

    // These two arrays are referenced BY POINTER from the attribute list; they must outlive the
    // CreateProcessW call below. They are declared here, in the same scope, and explicitly kept
    // alive after the call.
    let job_handles: [HANDLE; 1] = [win32(job.handle())];
    let handle_list: [HANDLE; 3] = pipes.child_handle_list();

    let mut attrs = AttributeList::new(2)?;
    // SAFETY: `job_handles` lives in this scope until after CreateProcessW returns (see the explicit
    // keep-alive below); size matches the array.
    unsafe {
        attrs.update(
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            job_handles.as_ptr() as *const core::ffi::c_void,
            core::mem::size_of_val(&job_handles),
        )?;
    }
    // SAFETY: `handle_list` lives in this scope until after CreateProcessW returns; size matches.
    unsafe {
        attrs.update(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            handle_list.as_ptr() as *const core::ffi::c_void,
            core::mem::size_of_val(&handle_list),
        )?;
    }

    let si = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            // cb MUST be the EXTENDED size, not size_of::<STARTUPINFOW>().
            cb: core::mem::size_of::<STARTUPINFOEXW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: pipes.stdin.child_end_handle(),
            hStdOutput: pipes.stdout.child_end_handle(),
            hStdError: pipes.stderr.child_end_handle(),
            ..Default::default()
        },
        lpAttributeList: attrs.as_ptr(),
    };

    let mut pi = PROCESS_INFORMATION::default();

    let mut flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
    if suspended {
        flags |= CREATE_SUSPENDED;
    }

    // SAFETY: application/current_dir/environment are NUL-terminated live buffers; `command_line` is
    // a live MUTABLE buffer (CreateProcessW may write to it); `si` is correctly sized with cb set to
    // the extended size and holds a live attribute list; `pi` is a live local. bInheritHandles=TRUE
    // is required for HANDLE_LIST, which restricts inheritance to exactly the three stdio handles.
    let created = unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()),
            Some(PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            true,
            flags,
            Some(environment.as_ptr() as *const core::ffi::c_void),
            PCWSTR(current_dir.as_ptr()),
            &si as *const STARTUPINFOEXW as *const STARTUPINFOW,
            &mut pi,
        )
    };

    // Explicit keep-alive: the attribute list held raw pointers into these until the call returned.
    // Referencing them here prevents any future refactor from dropping them early.
    let _ = (&job_handles, &handle_list, &si, &command_line, &environment);

    created.map_err(|_| ProcessError::ProcessCreateFailed)?;

    // SAFETY: both handles are owned, freshly returned by CreateProcessW, with no other owner.
    let process = unsafe { adopt(pi.hProcess) }.ok_or(ProcessError::ProcessHandleUnavailable)?;
    // The primary-thread handle is RETAINED (RECOVERY-BARRIER1B): for a suspended launch it is the
    // only path to `ResumeThread`. Without it a suspended child could never run — terminate the
    // child via the retained process handle and fail closed rather than leak a frozen process.
    // SAFETY: freshly returned by CreateProcessW, owned, no other owner.
    let Some(thread) = (unsafe { adopt(pi.hThread) }) else {
        super::owner::force_terminate(&process);
        return Err(ProcessError::ThreadHandleUnavailable);
    };

    // The job MUST already contain the process — verify rather than assume. A false here means the
    // kernel did not honour the JOB_LIST, so the child is unowned: terminate via the retained handle
    // and fail closed.
    if !job.contains(&process)? {
        // Dropping `job` (caller-owned) would kill it anyway, but be explicit and immediate.
        super::owner::force_terminate(&process);
        return Err(ProcessError::JobMembershipUnverified);
    }

    let creation_time = match creation_time(&process) {
        Ok(t) => t,
        Err(e) => {
            super::owner::force_terminate(&process);
            return Err(e);
        }
    };

    // Close the parent's copies of the child-side pipe ends NOW. Without this the pipes never reach
    // EOF and the drain threads would block forever.
    drop(pipes.stdin.child_end);
    drop(pipes.stdout.child_end);
    drop(pipes.stderr.child_end);

    // Guard against a silently-mutated startup struct in future refactors: `cb` MUST be the
    // EXTENDED size, otherwise the kernel ignores the attribute list and the job assignment is
    // silently skipped — the exact failure this whole slice exists to prevent.
    debug_assert_eq!(
        si.StartupInfo.cb,
        core::mem::size_of::<STARTUPINFOEXW>() as u32
    );

    Ok(CreatedProcess {
        process,
        thread,
        process_id: pi.dwProcessId,
        creation_time,
        stdin_writer: pipes.stdin.parent_end,
        stdout_reader: pipes.stdout.parent_end,
        stderr_reader: pipes.stderr.parent_end,
    })
}

#[cfg(test)]
mod tests {
    //! Crate-private proofs of the creation contract. These live here because the PUBLIC API
    //! (`SyntheticFixtureSpec`) deliberately cannot express an arbitrary executable, argument set,
    //! working directory, or environment — so these rejections are unreachable from an integration
    //! test by design. Every case fails BEFORE any process could exist.

    use super::*;

    fn base() -> ProcessSpec {
        ProcessSpec {
            executable: String::from("C:/Windows/System32/notepad.exe"),
            args: vec![],
            current_dir: std::env::temp_dir().to_string_lossy().to_string(),
            env: vec![(String::from("SystemRoot"), String::from("C:/Windows"))],
            graceful_shutdown: Duration::from_secs(1),
            classification: SpecClassification::SyntheticTest,
        }
    }

    #[test]
    fn relative_executable_rejected() {
        let mut s = base();
        s.executable = String::from("node.exe"); // would be a PATH lookup
        assert_eq!(s.validate(), Err(ProcessError::ExecutablePathNotAbsolute));
    }

    #[test]
    fn empty_executable_rejected() {
        let mut s = base();
        s.executable = String::new();
        assert_eq!(s.validate(), Err(ProcessError::ExecutablePathInvalid));
    }

    #[test]
    fn missing_executable_rejected() {
        let mut s = base();
        s.executable = format!(
            "{}/projectos-absent-fixture.exe",
            std::env::temp_dir().to_string_lossy()
        );
        assert_eq!(s.validate(), Err(ProcessError::ExecutablePathInvalid));
    }

    #[test]
    fn relative_current_dir_rejected() {
        let mut s = base();
        s.current_dir = String::from("relative/dir");
        assert_eq!(s.validate(), Err(ProcessError::CurrentDirectoryInvalid));
    }

    #[test]
    fn missing_current_dir_rejected() {
        let mut s = base();
        s.current_dir = format!(
            "{}/projectos-absent-dir-xyz",
            std::env::temp_dir().to_string_lossy()
        );
        assert_eq!(s.validate(), Err(ProcessError::CurrentDirectoryInvalid));
    }

    #[test]
    fn secret_shaped_environment_rejected_before_creation() {
        // The env block is built before CreateProcessW, so a secret-shaped variable fails closed
        // with no process in existence.
        let err = super::super::environment::build_environment_block(&[(
            String::from("GITHUB_TOKEN"),
            String::from("ghp_x"),
        )])
        .unwrap_err();
        assert_eq!(err, ProcessError::EnvironmentVariableInvalid);
        assert!(!err.process_may_exist());
    }

    #[test]
    fn a_valid_spec_passes_validation() {
        assert!(base().validate().is_ok());
    }
}
