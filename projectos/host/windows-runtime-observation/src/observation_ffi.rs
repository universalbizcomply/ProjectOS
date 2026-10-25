//! The ONLY unsafe module in this crate: read-only observation of the CURRENT process's own identity.
//!
//! It reads the host's OWN process id and OWN creation time — never another process, never a peer, never
//! a service. It opens no separate process handle (the current-process pseudo-handle is used directly and
//! never closed), touches no SCM, no pipe, no token, no registry, no ACL, no network, and performs no
//! process/privilege mutation. No raw process id, creation time, handle or Win32 error leaves this
//! module: the callers receive a plain `u32` / `Option<u64>`. Every `unsafe` block carries a `// SAFETY:`
//! note.
//!
//! Compiling this module is NOT authority to mint anything: it produces evidence, and only the sealed
//! core `ProductionRuntimeInstanceVerifier` turns an observation into a `VerifiedRuntimeInstance`.

#![cfg(all(windows, feature = "windows-live-runtime-observation"))]
#![allow(unsafe_code)]

use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId, GetProcessTimes};

/// The current process's own process id. Non-zero for any running process.
pub(crate) fn current_process_id() -> u32 {
    // SAFETY: `GetCurrentProcessId` takes no arguments, reads no caller memory, returns a plain `u32`,
    // and has no failure mode or handle to manage.
    unsafe { GetCurrentProcessId() }
}

/// The current process's own OS-observed CREATION time as a `u64` (FILETIME high<<32 | low). This is
/// what defeats process-id reuse. Returns `None` on query failure or a zero (non-identity) value.
pub(crate) fn current_process_creation_time() -> Option<u64> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle that is always valid for the current process
    // and must NOT be closed. All four `FILETIME` out-pointers are valid, aligned, initialised locals
    // that outlive the call. `GetProcessTimes` writes only through those out-pointers.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    if ok.is_err() {
        return None;
    }
    let value = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    if value == 0 {
        return None;
    }
    Some(value)
}
