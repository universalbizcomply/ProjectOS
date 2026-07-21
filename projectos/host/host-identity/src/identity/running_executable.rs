//! Handle-based running-executable identity (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B).
//!
//! `current_exe()` is a lookup HINT, never trust evidence. This opens the executable with a
//! restrictive retained handle (read + read-attributes, `FILE_SHARE_READ` only — no write, no
//! delete sharing), captures a stable file identity (volume + file index + size) and reparse state
//! from that handle, and derives the canonical path FROM the handle. The handle is held open across
//! Authenticode verification (`authenticode.rs` passes it as `WINTRUST_FILE_INFO.hFile`) and the
//! identity is re-confirmed afterwards, so a same-account process cannot open the file for write,
//! delete it, or replace the resolved file object during verification.
//!
//! Honest limits: (1) `FILE_FLAG_OPEN_REPARSE_POINT` classifies a reparse point ON THE FINAL FILE
//! but does not, by itself, cover reparse points in PARENT directory components — those are handled
//! conservatively by the installation classifier, not here. (2) Verifying the on-disk file does not
//! prove its bytes equal every page already mapped into the running process; Authenticode remains
//! necessary, not sufficient — see the phase design.

#![cfg(windows)]

use std::os::windows::io::OwnedHandle;
use std::path::PathBuf;

use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetFileInformationByHandle, GetFinalPathNameByHandleW, BY_HANDLE_FILE_INFORMATION,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_NAME_NORMALIZED, FILE_SHARE_READ, GETFINALPATHNAMEBYHANDLE_FLAGS, OPEN_EXISTING,
    VOLUME_NAME_DOS,
};

use projectos_windows_runtime_primitives::handles::{adopt, win32};

/// Minimum access: read the bytes + attributes. Never write/delete/execute rights.
const FILE_GENERIC_READ_MIN: u32 = 0x8000_0000; // GENERIC_READ

/// A stable identity for a file object. Volume serial + 64-bit file index defeat path games; size
/// is a cheap additional change signal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileIdentity {
    pub volume_serial: u32,
    pub file_index: u64,
    pub size: u64,
}

/// Final-file reparse classification. A reparse point on the executable itself is rejected before
/// any verified classification (the target is NOT followed and described as trusted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReparseState {
    None,
    Present,
}

/// A retained, restrictively-opened running executable.
pub struct RunningExecutable {
    handle: OwnedHandle,
    canonical_wide: Vec<u16>,
    canonical_path: PathBuf,
    identity: FileIdentity,
    reparse: ReparseState,
}

fn to_wide_nul(p: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    p.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn info_to_identity(info: &BY_HANDLE_FILE_INFORMATION) -> FileIdentity {
    FileIdentity {
        volume_serial: info.dwVolumeSerialNumber,
        file_index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        size: ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
    }
}

fn reparse_of(info: &BY_HANDLE_FILE_INFORMATION) -> ReparseState {
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        ReparseState::Present
    } else {
        ReparseState::None
    }
}

/// Query `BY_HANDLE_FILE_INFORMATION` from an owned handle.
fn query_info(handle: &OwnedHandle) -> Option<BY_HANDLE_FILE_INFORMATION> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: `handle` is a valid owned handle opened for read; `info` is a live local written by
    // the call. No pointer escapes.
    let ok = unsafe { GetFileInformationByHandle(win32(handle), &mut info) };
    ok.ok().map(|_| info)
}

impl RunningExecutable {
    /// Open the CURRENT process executable. `None` on any failure — the caller fails closed.
    pub fn open_current() -> Option<RunningExecutable> {
        let hint = std::env::current_exe().ok()?;
        Self::open_path_internal(&hint)
    }

    /// TEST-ONLY: open an explicit path (used to exercise the native path against an already-signed
    /// system binary, and against the unsigned test binary — no signing is ever performed).
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn open_path_for_test(path: &std::path::Path) -> Option<RunningExecutable> {
        Self::open_path_internal(path)
    }

    fn open_path_internal(path: &std::path::Path) -> Option<RunningExecutable> {
        let wide = to_wide_nul(path);
        // SAFETY: `wide` is a live NUL-terminated buffer; NULL security attributes and template;
        // FILE_SHARE_READ only (no write/delete share); OPEN_EXISTING; OPEN_REPARSE_POINT classifies
        // rather than follows. The returned handle is adopted into RAII ownership.
        let raw = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_GENERIC_READ_MIN,
                FILE_SHARE_READ,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(FILE_FLAG_OPEN_REPARSE_POINT.0),
                None,
            )
        }
        .ok()?;
        // SAFETY: `raw` is an owned handle freshly returned by CreateFileW, no other owner.
        let handle = unsafe { adopt(raw) }?;

        let info = query_info(&handle)?;
        let identity = info_to_identity(&info);
        let reparse = reparse_of(&info);

        let canonical_wide = final_path_wide(&handle)?;
        let canonical_path = PathBuf::from(String::from_utf16_lossy(
            &canonical_wide[..canonical_wide.len().saturating_sub(1)],
        ));

        Some(RunningExecutable {
            handle,
            canonical_wide,
            canonical_path,
            identity,
            reparse,
        })
    }

    /// The canonical path as a NUL-terminated wide buffer, for `WINTRUST_FILE_INFO.pcwszFilePath`.
    pub fn canonical_wide_ptr(&self) -> PCWSTR {
        PCWSTR(self.canonical_wide.as_ptr())
    }

    /// The retained handle, passed as `WINTRUST_FILE_INFO.hFile` so verification reads THIS file
    /// object, not a re-opened path.
    pub fn handle(&self) -> &OwnedHandle {
        &self.handle
    }

    pub fn identity(&self) -> FileIdentity {
        self.identity
    }

    pub fn reparse(&self) -> ReparseState {
        self.reparse
    }

    pub fn canonical_path(&self) -> &std::path::Path {
        &self.canonical_path
    }

    /// Re-query identity from the still-open handle and confirm it is unchanged. A mismatch (or a
    /// failed query) means the file object changed under us — fail closed.
    pub fn reconfirm(&self) -> bool {
        match query_info(&self.handle) {
            Some(info) => info_to_identity(&info) == self.identity,
            None => false,
        }
    }
}

/// Canonical, normalised DOS path resolved FROM the handle (two-call sizing).
fn final_path_wide(handle: &OwnedHandle) -> Option<Vec<u16>> {
    // Both flags are 0 (normalised name + DOS volume) — the value we want; combine via the inner.
    let flags = GETFINALPATHNAMEBYHANDLE_FLAGS(FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0);
    // First call: required length WITHOUT the NUL.
    // SAFETY: empty slice is the documented size-probe form; `handle` is valid.
    let needed = unsafe { GetFinalPathNameByHandleW(win32(handle), &mut [], flags) };
    if needed == 0 {
        return None;
    }
    let mut buf = vec![0u16; needed as usize + 1];
    // SAFETY: `buf` has `needed + 1` slots; `handle` is valid. Returns chars written (no NUL).
    let written = unsafe { GetFinalPathNameByHandleW(win32(handle), &mut buf, flags) };
    if written == 0 || written as usize >= buf.len() {
        return None;
    }
    buf.truncate(written as usize + 1); // keep the NUL
    Some(buf)
}

/// The conservative pre-verify gate: a reparse point on the executable itself is never verified.
pub fn pre_verify_ok(reparse: ReparseState) -> bool {
    matches!(reparse, ReparseState::None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reparse_present_is_rejected() {
        assert!(pre_verify_ok(ReparseState::None));
        assert!(!pre_verify_ok(ReparseState::Present));
    }

    #[test]
    fn file_identity_change_is_detected() {
        let a = FileIdentity {
            volume_serial: 1,
            file_index: 2,
            size: 3,
        };
        assert_eq!(a, a);
        assert_ne!(a, FileIdentity { size: 4, ..a });
        assert_ne!(a, FileIdentity { file_index: 9, ..a });
    }

    #[test]
    fn open_current_test_binary_has_stable_identity_and_no_reparse() {
        // The running unit-test binary is a real on-disk PE; open it and prove identity is stable
        // and re-confirmable (the handle stays open).
        let exe = std::env::current_exe().unwrap();
        let re = RunningExecutable::open_path_for_test(&exe).expect("open test exe");
        assert_eq!(re.reparse(), ReparseState::None);
        assert!(re.reconfirm(), "identity must re-confirm on a stable file");
        assert!(re.canonical_path().is_absolute());
        assert!(re.identity().size > 0);
    }
}
