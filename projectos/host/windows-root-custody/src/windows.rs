//! The single, minimal unsafe boundary: Win32 directory-handle acquisition, handle-derived identity,
//! and canonical-path derivation.
//!
//! This module is the ONLY place in the crate permitted to use `unsafe` (allowed at its `mod`
//! declaration in `lib.rs`). It opens the root with the LEAST authority required
//! (`FILE_READ_ATTRIBUTES` only — no read/write data, no delete access) using
//! `FILE_FLAG_BACKUP_SEMANTICS` (required for a directory handle) and `FILE_FLAG_OPEN_REPARSE_POINT`
//! so a reparse point is INSPECTED rather than silently followed. Delete/rename sharing is permitted so
//! realistic replacement-drift can be detected and tested. The raw handle is immediately adopted into
//! `std::os::windows::io::OwnedHandle`, which closes it exactly once on drop.

use std::path::{Path, PathBuf};

use crate::error::RootCustodyError;
use crate::identity::RootIdentity;

/// Directory attribute bit.
#[cfg(windows)]
pub(crate) const ATTR_DIRECTORY: u32 = 0x0000_0010;
/// Reparse-point attribute bit.
#[cfg(windows)]
pub(crate) const ATTR_REPARSE_POINT: u32 = 0x0000_0400;

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Open `path` as a directory handle with least authority, without following a reparse point.
///
/// # Errors
/// [`RootCustodyError::NotFound`] if the path does not exist; [`RootCustodyError::WindowsApiFailure`]
/// otherwise; [`RootCustodyError::UnsupportedPlatform`] off Windows.
#[cfg(windows)]
pub(crate) fn open_directory_handle(
    path: &Path,
) -> Result<std::os::windows::io::OwnedHandle, RootCustodyError> {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    let wide = to_wide(path);
    // SAFETY: `wide` is a valid NUL-terminated UTF-16 path living across the call. A null
    // security-attributes pointer and a null template handle are documented defaults. We request only
    // FILE_READ_ATTRIBUTES; BACKUP_SEMANTICS is required to obtain a DIRECTORY handle and
    // OPEN_REPARSE_POINT makes the call inspect the reparse object itself instead of following it. The
    // returned value is only compared to INVALID_HANDLE_VALUE and then adopted by OwnedHandle.
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        // SAFETY: reading the calling thread's last-error code has no preconditions.
        let code = unsafe { GetLastError() };
        return Err(match code {
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => RootCustodyError::NotFound,
            _ => RootCustodyError::WindowsApiFailure,
        });
    }
    // SAFETY: `raw` is a valid, exclusively-owned handle returned by CreateFileW and not owned
    // elsewhere; OwnedHandle takes sole ownership and closes it exactly once on drop.
    Ok(unsafe { OwnedHandle::from_raw_handle(raw as std::os::windows::io::RawHandle) })
}

/// Query the handle-derived identity (volume serial + 128-bit file id) and file attributes.
///
/// # Errors
/// [`RootCustodyError::HandleInvalid`] if the handle no longer yields information.
#[cfg(windows)]
pub(crate) fn query_identity(
    handle: &std::os::windows::io::OwnedHandle,
) -> Result<(RootIdentity, u32), RootCustodyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ID_INFO,
    };

    let raw = handle.as_raw_handle() as HANDLE;

    // Attributes (directory / reparse state) from the held handle.
    // SAFETY: `raw` is a live handle owned by `handle` for this call; `info` is a properly sized,
    // writable out-parameter that Windows fills; only the BOOL result gates our reads.
    let attributes = unsafe {
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        if GetFileInformationByHandle(raw, &mut info) == 0 {
            return Err(RootCustodyError::HandleInvalid);
        }
        info.dwFileAttributes
    };

    // Modern handle-derived identity: volume serial + 128-bit file id.
    // SAFETY: `raw` is live for this call; `id_info` is a correctly sized FILE_ID_INFO out-parameter
    // and we pass its exact byte size; only the BOOL result gates our reads.
    let identity = unsafe {
        let mut id_info: FILE_ID_INFO = std::mem::zeroed();
        let size = u32::try_from(std::mem::size_of::<FILE_ID_INFO>())
            .map_err(|_| RootCustodyError::WindowsApiFailure)?;
        if GetFileInformationByHandleEx(
            raw,
            FileIdInfo,
            std::ptr::addr_of_mut!(id_info).cast(),
            size,
        ) == 0
        {
            return Err(RootCustodyError::HandleInvalid);
        }
        RootIdentity::new(id_info.VolumeSerialNumber, id_info.FileId.Identifier)
    };

    Ok((identity, attributes))
}

/// Derive the canonical path FROM the held handle (never from the caller's spelling).
///
/// # Errors
/// [`RootCustodyError::WindowsApiFailure`] if the canonical path cannot be obtained.
#[cfg(windows)]
pub(crate) fn final_path(
    handle: &std::os::windows::io::OwnedHandle,
) -> Result<PathBuf, RootCustodyError> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };

    let raw = handle.as_raw_handle() as HANDLE;
    let flags = FILE_NAME_NORMALIZED | VOLUME_NAME_DOS;
    // SAFETY: a null buffer with length 0 is the documented size-probe form; Windows only returns the
    // required character count and writes nothing.
    let needed = unsafe { GetFinalPathNameByHandleW(raw, std::ptr::null_mut(), 0, flags) };
    if needed == 0 {
        return Err(RootCustodyError::WindowsApiFailure);
    }
    let mut buffer = vec![0u16; needed as usize];
    // SAFETY: `buffer` has exactly `needed` writable UTF-16 elements and we pass that same length;
    // Windows writes at most that many and returns the count actually written.
    let written = unsafe { GetFinalPathNameByHandleW(raw, buffer.as_mut_ptr(), needed, flags) };
    if written == 0 || written as usize > buffer.len() {
        return Err(RootCustodyError::WindowsApiFailure);
    }
    buffer.truncate(written as usize);
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&buffer)))
}

// ---- non-Windows fail-closed stubs (no emulation) ----

#[cfg(not(windows))]
pub(crate) const ATTR_DIRECTORY: u32 = 0x0000_0010;
#[cfg(not(windows))]
pub(crate) const ATTR_REPARSE_POINT: u32 = 0x0000_0400;

#[cfg(not(windows))]
pub(crate) struct UnsupportedHandle;

#[cfg(not(windows))]
pub(crate) fn open_directory_handle(_path: &Path) -> Result<UnsupportedHandle, RootCustodyError> {
    Err(RootCustodyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn query_identity(
    _handle: &UnsupportedHandle,
) -> Result<(RootIdentity, u32), RootCustodyError> {
    Err(RootCustodyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn final_path(_handle: &UnsupportedHandle) -> Result<PathBuf, RootCustodyError> {
    Err(RootCustodyError::UnsupportedPlatform)
}
