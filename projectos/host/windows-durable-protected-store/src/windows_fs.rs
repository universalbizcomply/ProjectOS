//! The single, minimal unsafe boundary: the Win32 primitives for single-writer locking, durable
//! write-through replacement, and best-effort directory flushing.
//!
//! This module is the ONLY place in the crate permitted to use `unsafe` (allowed at its `mod`
//! declaration in `lib.rs`). Durability primitive: `MoveFileExW` with
//! `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH` (NO `MOVEFILE_COPY_ALLOWED`, so no cross-volume
//! copy fallback) — Windows documents WRITE_THROUGH as "does not return until the file is moved on the
//! disk". File CONTENT is flushed (`FlushFileBuffers` via `sync_all`) before the replace.
//!
//! **Directory-flush honesty:** Windows does NOT document a directory-entry `fsync` guarantee via
//! `FlushFileBuffers` on a directory handle (it commonly returns `ERROR_ACCESS_DENIED`). [`flush_dir`]
//! attempts it best-effort and never claims a metadata-durability guarantee; the documented durability
//! for the replace comes from `MOVEFILE_WRITE_THROUGH`, not the directory flush.

use std::path::Path;

use crate::error::DurableStoreError;

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Try to take an exclusive advisory lock on `file` without blocking. The OS releases it when the
/// handle closes (including on process crash).
///
/// # Errors
/// [`DurableStoreError::LockContention`] if held; [`DurableStoreError::UnsupportedPlatform`] off Windows.
#[cfg(windows)]
pub(crate) fn try_lock_exclusive(file: &std::fs::File) -> Result<(), DurableStoreError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    let handle = file.as_raw_handle() as HANDLE;
    // SAFETY: `handle` is a live file handle owned by `file` for this call. A zeroed `OVERLAPPED`
    // (offset 0) is the documented way to lock from the file start; we lock the full 64-bit range and
    // read only the BOOL result.
    let ok = unsafe {
        let mut overlapped: OVERLAPPED = std::mem::zeroed();
        LockFileEx(
            handle,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if ok != 0 {
        Ok(())
    } else {
        Err(DurableStoreError::LockContention)
    }
}

/// Atomically replace `final_path` with `temp_path` on the SAME volume, write-through. `fs::rename` is
/// NOT used here so the exact `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH` flags apply and no
/// cross-volume copy fallback is possible.
///
/// # Errors
/// [`DurableStoreError::WriteRefusedBeforeEffect`] if the atomic replace fails (no effect);
/// [`DurableStoreError::UnsupportedPlatform`] off Windows.
#[cfg(windows)]
pub(crate) fn durable_replace(
    temp_path: &Path,
    final_path: &Path,
) -> Result<(), DurableStoreError> {
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from = to_wide(temp_path);
    let to = to_wide(final_path);
    // SAFETY: `from`/`to` are valid NUL-terminated UTF-16 strings living for the call. The flags select
    // replace-existing + write-through with no copy fallback; only the BOOL result is read.
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok != 0 {
        Ok(())
    } else {
        // The move is atomic: a failure means it did not take effect.
        Err(DurableStoreError::WriteRefusedBeforeEffect)
    }
}

/// Directory flush — deliberately a NO-OP.
///
/// **Honest investigation:** Windows does NOT document a directory-entry `fsync`/durability guarantee.
/// `FlushFileBuffers` on a directory handle is undocumented for metadata durability and commonly
/// returns `ERROR_ACCESS_DENIED`. Rather than call an unsupported primitive and imply a guarantee it
/// does not provide, this crate relies on `MOVEFILE_WRITE_THROUGH` (documented: the move does not
/// return until the file is on disk) for the record/manifest durability of the REPLACE, and makes no
/// directory-metadata durability claim.
#[cfg(windows)]
pub(crate) fn flush_dir(_dir: &Path) {}

/// Non-Windows fail-closed stubs.
#[cfg(not(windows))]
pub(crate) fn try_lock_exclusive(_file: &std::fs::File) -> Result<(), DurableStoreError> {
    Err(DurableStoreError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn durable_replace(_temp: &Path, _final_: &Path) -> Result<(), DurableStoreError> {
    Err(DurableStoreError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn flush_dir(_dir: &Path) {}
