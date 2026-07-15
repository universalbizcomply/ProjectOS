//! Safe handle ownership boundary (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! Every Win32 HANDLE produced by this module is immediately wrapped in `std::os::windows::io::
//! OwnedHandle`, which closes it exactly once on drop. Raw `HANDLE` values never escape the native
//! layer: callers outside `process::` see only `OwnedHandle` / borrowed handles.
//!
//! This is what makes partial-construction cleanup provable — if any step fails, every handle
//! created so far is dropped by unwinding/early-return, with no manual close path to get wrong.

#![cfg(windows)]

use std::os::windows::io::{AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle};

use windows::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};

/// Adopt a raw Win32 HANDLE into RAII ownership.
///
/// # Safety
/// The caller must guarantee:
///  - `h` was returned by a Win32 API that transfers ownership to us (e.g. `CreateJobObjectW`,
///    `CreatePipe`, `CreateProcessW`'s `hProcess`/`hThread`);
///  - `h` is not `INVALID_HANDLE_VALUE` and not null (checked below; caller must still not pass a
///    handle it does not own);
///  - no other owner exists for `h`, so exactly one `CloseHandle` will occur (on drop).
pub unsafe fn adopt(h: HANDLE) -> Option<OwnedHandle> {
    if h.is_invalid() || h == INVALID_HANDLE_VALUE {
        return None;
    }
    // SAFETY: per this function's contract, `h` is an owned, valid handle with no other owner, so
    // transferring it to OwnedHandle yields exactly one CloseHandle on drop.
    Some(unsafe { OwnedHandle::from_raw_handle(h.0) })
}

/// Borrow an `OwnedHandle` as a Win32 `HANDLE` for the duration of a call.
///
/// The returned `HANDLE` is a plain copy of the underlying value and confers NO ownership — it must
/// never be closed by the receiver and must not outlive `h`.
pub fn win32(h: &OwnedHandle) -> HANDLE {
    HANDLE(h.as_raw_handle() as isize as *mut core::ffi::c_void)
}

/// Borrow a `BorrowedHandle` as a Win32 `HANDLE`. Same non-ownership rules as [`win32`].
pub fn win32_borrowed(h: BorrowedHandle<'_>) -> HANDLE {
    HANDLE(h.as_raw_handle() as isize as *mut core::ffi::c_void)
}
