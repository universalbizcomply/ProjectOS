//! The single, minimal unsafe boundary: HANDLE-based security-descriptor read and write.
//!
//! This module is the ONLY place in the crate permitted to use `unsafe` (allowed at its `mod`
//! declaration in `lib.rs`).
//!
//! ## Why handle-based, not name-based
//!
//! `GetNamedSecurityInfoW` / `SetNamedSecurityInfoW` re-resolve the pathname inside the call and
//! FOLLOW reparse points, so a junction swapped in after admission would silently redirect the
//! operation to another directory. Every security operation here is therefore performed on a HANDLE
//! opened with `FILE_FLAG_OPEN_REPARSE_POINT` (so a reparse point is inspected, never followed) and
//! re-checked on that same handle before use. The object the descriptor is read from or written to is
//! the object that was admitted.
//!
//! ## Windows-owned memory
//!
//! `GetSecurityInfo` returns one `LocalAlloc` security descriptor; the owner SID and the DACL point
//! INSIDE it. Both are copied into owned Rust values immediately, and the descriptor is released
//! exactly once by an RAII guard on every path — success, refusal, or early return. No borrowed SID or
//! ACL pointer outlives the descriptor, and no pointer is ever returned to a caller.

use std::path::Path;

use crate::descriptor::RawDacl;
use crate::error::AclPolicyError;
use crate::principal::OwnedSid;

/// Directory attribute bit.
#[cfg(windows)]
const ATTR_DIRECTORY: u32 = 0x0000_0010;
/// Reparse-point attribute bit.
#[cfg(windows)]
const ATTR_REPARSE_POINT: u32 = 0x0000_0400;

/// Upper bound for a `TOKEN_USER` buffer; anything larger is malformed rather than allocated.
#[cfg(windows)]
const MAX_TOKEN_USER_BYTES: usize = 4096;

/// Access required to READ a security descriptor.
#[cfg(windows)]
pub(crate) const ACCESS_READ_SECURITY: u32 = 0x0002_0000; // READ_CONTROL
/// Access required to WRITE owner and DACL.
#[cfg(windows)]
pub(crate) const ACCESS_WRITE_SECURITY: u32 = 0x0002_0000 | 0x0004_0000 | 0x0008_0000;

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Copy bytes into 4-byte-aligned storage.
///
/// `SID` and `ACL` both contain `u32` fields and must be DWORD-aligned; a `Vec<u8>` has alignment 1,
/// so casting one to `*const ACL` would be undefined behaviour even though it usually appears to work.
#[cfg(windows)]
fn aligned(bytes: &[u8]) -> Vec<u32> {
    let mut words = vec![0u32; bytes.len().div_ceil(4)];
    let dst = unsafe {
        // SAFETY: `words` owns `words.len() * 4 >= bytes.len()` initialised bytes; reinterpreting an
        // exclusively-borrowed `[u32]` as `[u8]` is sound (u8 has weaker alignment, same provenance).
        std::slice::from_raw_parts_mut(words.as_mut_ptr().cast::<u8>(), words.len() * 4)
    };
    dst[..bytes.len()].copy_from_slice(bytes);
    words
}

#[cfg(windows)]
fn last_error() -> AclPolicyError {
    use windows_sys::Win32::Foundation::GetLastError;
    // SAFETY: reading the calling thread's last-error code has no preconditions.
    classify(unsafe { GetLastError() })
}

/// Map a Windows status to a redacted classification. The Windows error TEXT is never captured.
#[cfg(windows)]
fn classify(code: u32) -> AclPolicyError {
    use windows_sys::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND,
    };
    match code {
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => AclPolicyError::NotFound,
        ERROR_ACCESS_DENIED => AclPolicyError::AccessDenied,
        _ => AclPolicyError::WindowsApiFailure,
    }
}

/// Which object kind a security operation is admitted against. The assertion is made on the OPENED
/// handle, never on the pathname's spelling, and a mismatch is refused rather than coerced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SecuredObjectKind {
    Directory,
    File,
}

/// Open the object for a security operation WITHOUT following a reparse point, then re-check on the
/// returned handle that it really is a non-reparse object of the required kind.
#[cfg(windows)]
fn open_secure_handle(
    path: &Path,
    access: u32,
    expected: SecuredObjectKind,
) -> Result<std::os::windows::io::OwnedHandle, AclPolicyError> {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    let wide = to_wide(path);
    // SAFETY: `wide` is a valid NUL-terminated UTF-16 path alive across the call; a null
    // security-attributes pointer and null template handle are the documented defaults.
    // BACKUP_SEMANTICS is required for a DIRECTORY handle; OPEN_REPARSE_POINT makes the call open the
    // reparse object itself rather than its target. The result is only compared with
    // INVALID_HANDLE_VALUE before being adopted by `OwnedHandle`, which closes it exactly once.
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(last_error());
    }
    // SAFETY: `raw` is a valid handle returned by CreateFileW and owned nowhere else.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw as std::os::windows::io::RawHandle) };

    let attributes = file_attributes(&handle)?;
    if attributes & ATTR_REPARSE_POINT != 0 {
        return Err(AclPolicyError::ReparsePointRefused);
    }
    match expected {
        SecuredObjectKind::Directory if attributes & ATTR_DIRECTORY == 0 => {
            return Err(AclPolicyError::NotADirectory)
        }
        SecuredObjectKind::File if attributes & ATTR_DIRECTORY != 0 => {
            return Err(AclPolicyError::NotAFile)
        }
        _ => {}
    }
    Ok(handle)
}

/// Read the file attributes of the OPENED object (not of a re-resolved pathname).
#[cfg(windows)]
fn file_attributes(handle: &std::os::windows::io::OwnedHandle) -> Result<u32, AclPolicyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let raw = handle.as_raw_handle() as HANDLE;
    // SAFETY: `raw` is live for this call and `info` is a properly sized writable out-parameter;
    // only the BOOL result gates the read.
    unsafe {
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        if GetFileInformationByHandle(raw, &mut info) == 0 {
            return Err(last_error());
        }
        Ok(info.dwFileAttributes)
    }
}

/// Releases the one `LocalAlloc` security descriptor exactly once, on every path.
#[cfg(windows)]
struct OwnedDescriptor(windows_sys::Win32::Security::PSECURITY_DESCRIPTOR);

#[cfg(windows)]
impl Drop for OwnedDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: allocated by `GetSecurityInfo`, which documents `LocalFree` as the matching
            // deallocator; `Drop` runs once, so no double free.
            unsafe {
                windows_sys::Win32::Foundation::LocalFree(self.0.cast());
            }
        }
    }
}

/// Read the owner, control bits and DACL of the object behind `path`.
///
/// Returns copied, owned values only; the Windows descriptor is released before returning.
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal.
#[cfg(windows)]
pub(crate) fn read_security(
    path: &Path,
    expected: SecuredObjectKind,
) -> Result<(Option<Vec<u8>>, u16, RawDacl), AclPolicyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, IsValidSid, ACL,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    };

    let handle = open_secure_handle(path, ACCESS_READ_SECURITY, expected)?;
    let raw = handle.as_raw_handle() as HANDLE;

    let mut owner_ptr: PSID = std::ptr::null_mut();
    let mut dacl_ptr: *mut ACL = std::ptr::null_mut();
    let mut psd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();

    // SAFETY: `raw` is a live handle; every out-parameter is a valid writable slot. On success the
    // single descriptor allocation is immediately adopted by `OwnedDescriptor` for RAII release.
    let status = unsafe {
        GetSecurityInfo(
            raw,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner_ptr,
            std::ptr::null_mut(),
            &mut dacl_ptr,
            std::ptr::null_mut(),
            &mut psd,
        )
    };
    let _descriptor = OwnedDescriptor(psd);
    if status != ERROR_SUCCESS {
        return Err(classify(status));
    }
    if psd.is_null() {
        return Err(AclPolicyError::SecurityDescriptorUnavailable);
    }

    // ---- owner: copy out of the descriptor immediately ----
    let owner = if owner_ptr.is_null() {
        None
    } else {
        // SAFETY: `owner_ptr` points inside the descriptor still owned by `_descriptor`.
        if unsafe { IsValidSid(owner_ptr) } == 0 {
            return Err(AclPolicyError::InvalidSid);
        }
        // SAFETY: validated by `IsValidSid` on the line above.
        let len = unsafe { GetLengthSid(owner_ptr) } as usize;
        if len == 0 || len > 68 {
            return Err(AclPolicyError::InvalidSid);
        }
        // SAFETY: `owner_ptr` points at `len` readable bytes inside the live descriptor; the slice is
        // copied into an owned Vec on this line and never escapes.
        Some(unsafe { std::slice::from_raw_parts(owner_ptr.cast::<u8>(), len) }.to_vec())
    };

    // ---- control bits ----
    let mut control: u16 = 0;
    let mut revision: u32 = 0;
    // SAFETY: the descriptor is live and both out-parameters are valid writable slots.
    if unsafe { GetSecurityDescriptorControl(psd, &mut control, &mut revision) } == 0 {
        return Err(last_error());
    }

    // ---- DACL: absent, null and present are kept distinct ----
    let mut present: i32 = 0;
    let mut defaulted: i32 = 0;
    let mut acl_ptr: *mut ACL = std::ptr::null_mut();
    // SAFETY: the descriptor is live and every out-parameter is a valid writable slot.
    if unsafe { GetSecurityDescriptorDacl(psd, &mut present, &mut acl_ptr, &mut defaulted) } == 0 {
        return Err(last_error());
    }
    let dacl = if present == 0 {
        RawDacl::Absent
    } else if acl_ptr.is_null() {
        RawDacl::Null
    } else {
        // The ACL's own header states its total size; copy exactly that many bytes.
        // SAFETY: `acl_ptr` points at a live `ACL` inside the descriptor.
        let size = usize::from(unsafe { (*acl_ptr).AclSize });
        if size < 8 {
            return Err(AclPolicyError::MalformedDescriptor);
        }
        // SAFETY: the ACL declares `size` readable bytes at `acl_ptr` inside the live descriptor; the
        // slice is copied into an owned Vec on this line and never escapes.
        RawDacl::Acl(unsafe { std::slice::from_raw_parts(acl_ptr.cast::<u8>(), size) }.to_vec())
    };

    // `_descriptor` drops here, releasing the ONE Windows allocation. Every value returned is owned.
    Ok((owner, control, dacl))
}

/// Apply an explicit owner and protected DACL to the object behind `path`.
///
/// The ACL image is validated by Windows (`IsValidAcl`) before it is applied, and the DACL is always
/// marked PROTECTED so no parent authority is inherited.
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal. A refusal returned before `SetSecurityInfo` means the
/// ACL was NOT changed.
#[cfg(windows)]
pub(crate) fn apply_security(
    path: &Path,
    owner: &OwnedSid,
    acl_bytes: &[u8],
    expected: SecuredObjectKind,
) -> Result<(), AclPolicyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{SetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        IsValidAcl, IsValidSid, ACL, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION,
    };

    // Aligned owned copies. Both outlive the call and neither is a Windows allocation.
    let owner_words = aligned(owner.as_bytes());
    let acl_words = aligned(acl_bytes);
    let owner_ptr = owner_words.as_ptr().cast_mut().cast();
    let acl_ptr = acl_words.as_ptr().cast::<ACL>();

    // SAFETY: `owner_ptr` points at an aligned, owned, well-formed binary SID alive for this call.
    if unsafe { IsValidSid(owner_ptr) } == 0 {
        return Err(AclPolicyError::InvalidSid);
    }
    // SAFETY: `acl_ptr` points at an aligned, owned ACL image alive for this call. Windows validates
    // the structure; a malformed image is refused BEFORE any effect.
    if unsafe { IsValidAcl(acl_ptr) } == 0 {
        return Err(AclPolicyError::MalformedDescriptor);
    }

    // Opened AFTER validation, so the object is held for the shortest possible window, and opened
    // without following reparse points so the write cannot be redirected.
    let handle = open_secure_handle(path, ACCESS_WRITE_SECURITY, expected)?;
    let raw = handle.as_raw_handle() as HANDLE;

    // SAFETY: `raw` is a live handle opened with WRITE_DAC|WRITE_OWNER; the owner and ACL pointers are
    // aligned, owned and alive across the call; no SACL is supplied.
    let status = unsafe {
        SetSecurityInfo(
            raw,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            owner_ptr,
            std::ptr::null_mut(),
            acl_ptr,
            std::ptr::null(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(classify(status));
    }
    Ok(())
}

/// Resolve the CURRENT ACCOUNT SID (`TokenUser`) of the calling process.
///
/// Used only as a test-fixture principal. No account-name lookup, no domain traffic, no credential.
///
/// # Errors
/// [`AclPolicyError::WindowsApiFailure`] or [`AclPolicyError::InvalidSid`].
#[cfg(windows)]
pub(crate) fn current_account_sid() -> Result<OwnedSid, AclPolicyError> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::{
        GetLengthSid, GetTokenInformation, IsValidSid, TokenUser, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut raw_token: HANDLE = std::ptr::null_mut();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle valid for the calling process (and must not
    // be closed); `raw_token` is a valid writable slot whose handle is adopted for RAII closure.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw_token) } == 0 {
        return Err(last_error());
    }
    // SAFETY: `raw_token` is a valid token handle owned nowhere else.
    let token =
        unsafe { OwnedHandle::from_raw_handle(raw_token as std::os::windows::io::RawHandle) };
    let token_raw = token.as_raw_handle() as HANDLE;

    // Size probe: this call is EXPECTED to fail with ERROR_INSUFFICIENT_BUFFER; only `needed` matters.
    let mut needed: u32 = 0;
    // SAFETY: a null buffer with length 0 is the documented size-query form; `needed` is writable.
    unsafe { GetTokenInformation(token_raw, TokenUser, std::ptr::null_mut(), 0, &mut needed) };

    let needed_usize = needed as usize;
    if needed_usize < std::mem::size_of::<TOKEN_USER>() || needed_usize > MAX_TOKEN_USER_BYTES {
        return Err(AclPolicyError::WindowsApiFailure);
    }
    // `Vec<u64>`: `TOKEN_USER` contains a pointer and requires 8-byte alignment.
    let mut buf: Vec<u64> = vec![0; needed_usize.div_ceil(8)];
    let mut written: u32 = 0;
    // SAFETY: `buf` is at least `needed` bytes, correctly aligned, and exclusively borrowed here.
    if unsafe {
        GetTokenInformation(
            token_raw,
            TokenUser,
            buf.as_mut_ptr().cast(),
            needed,
            &mut written,
        )
    } == 0
    {
        return Err(last_error());
    }

    // SAFETY: `buf` is 8-byte aligned and was filled by the successful call above, so it holds a
    // `TOKEN_USER` whose `User.Sid` points inside the same allocation.
    let sid_ptr = unsafe { (*buf.as_ptr().cast::<TOKEN_USER>()).User.Sid };
    if sid_ptr.is_null() {
        return Err(AclPolicyError::InvalidSid);
    }
    // SAFETY: `sid_ptr` points inside `buf`, filled by the successful call above.
    if unsafe { IsValidSid(sid_ptr) } == 0 {
        return Err(AclPolicyError::InvalidSid);
    }
    // SAFETY: validated by `IsValidSid` on the line above.
    let len = unsafe { GetLengthSid(sid_ptr) } as usize;
    if len == 0 || len > 68 {
        return Err(AclPolicyError::InvalidSid);
    }
    // SAFETY: `sid_ptr` points at `len` readable bytes inside `buf`, which is still alive; the slice
    // is copied into an owned value on this line and never escapes.
    let bytes = unsafe { std::slice::from_raw_parts(sid_ptr.cast::<u8>(), len) };
    OwnedSid::from_bytes(bytes)
}

// ---- non-Windows fail-closed stubs (no emulation) ----

#[cfg(not(windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SecuredObjectKind {
    Directory,
    File,
}

#[cfg(not(windows))]
pub(crate) fn read_security(
    _path: &Path,
    _expected: SecuredObjectKind,
) -> Result<(Option<Vec<u8>>, u16, RawDacl), AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn apply_security(
    _path: &Path,
    _owner: &OwnedSid,
    _acl_bytes: &[u8],
    _expected: SecuredObjectKind,
) -> Result<(), AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn current_account_sid() -> Result<OwnedSid, AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

/// The largest SID this resolver will accept, in bytes. A SID is at most 68 bytes
/// (`SECURITY_MAX_SID_SIZE`); anything larger is refused rather than trusted.
#[cfg(windows)]
const MAX_RESOLVED_SID_BYTES: usize = 68;

/// The largest referenced-domain buffer accepted, in UTF-16 units. Generous, and bounded.
#[cfg(windows)]
const MAX_DOMAIN_CHARS: usize = 1024;

/// Resolve an account NAME to its SID through `LookupAccountNameW` on the local machine.
///
/// This is the approved activation-time mechanism for a principal whose SID cannot be known in
/// advance — notably a virtual service account (`NT SERVICE\<name>`), whose per-service SID exists
/// only once the service is installed. It resolves and returns a SID; it grants nothing, applies
/// nothing and never manufactures a SID it did not receive from Windows.
///
/// # Errors
/// [`AclPolicyError::WindowsApiFailure`] if the lookup fails, or [`AclPolicyError::InvalidSid`] if
/// the returned SID is malformed or implausibly sized.
#[cfg(windows)]
pub fn resolve_account_sid(account: &str) -> Result<OwnedSid, AclPolicyError> {
    use windows_sys::Win32::Security::{IsValidSid, LookupAccountNameW, SID_NAME_USE};

    if account.is_empty() || account.len() > 256 {
        return Err(AclPolicyError::InvalidSid);
    }
    let name: Vec<u16> = account.encode_utf16().chain(std::iter::once(0)).collect();

    // Size probe. This call is EXPECTED to fail; only the two size out-params matter.
    let mut sid_len: u32 = 0;
    let mut domain_len: u32 = 0;
    let mut use_kind: SID_NAME_USE = 0;
    // SAFETY: `name` is NUL-terminated and alive for the call. Null buffers with zero lengths are the
    // documented size-query form; all three out-params are valid writable slots.
    unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut sid_len,
            std::ptr::null_mut(),
            &mut domain_len,
            &mut use_kind,
        )
    };

    let sid_bytes = sid_len as usize;
    let domain_chars = domain_len as usize;
    if sid_bytes == 0 || sid_bytes > MAX_RESOLVED_SID_BYTES || domain_chars > MAX_DOMAIN_CHARS {
        return Err(AclPolicyError::WindowsApiFailure);
    }

    // `Vec<u64>` so the SID buffer is 8-byte aligned.
    let mut sid_buf: Vec<u64> = vec![0; sid_bytes.div_ceil(8)];
    let mut domain_buf: Vec<u16> = vec![0; domain_chars.max(1)];
    // SAFETY: both buffers are at least the sizes Windows just reported and are exclusively borrowed
    // here; `name` is still alive and NUL-terminated; every out-param is a valid writable slot.
    let ok = unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            sid_buf.as_mut_ptr().cast(),
            &mut sid_len,
            domain_buf.as_mut_ptr(),
            &mut domain_len,
            &mut use_kind,
        )
    };
    if ok == 0 {
        return Err(last_error());
    }

    let sid_ptr: *mut core::ffi::c_void = sid_buf.as_mut_ptr().cast();
    // SAFETY: `sid_ptr` points at the buffer Windows filled on the successful call above.
    if unsafe { IsValidSid(sid_ptr) } == 0 {
        return Err(AclPolicyError::InvalidSid);
    }
    let len = sid_len as usize;
    if len == 0 || len > MAX_RESOLVED_SID_BYTES {
        return Err(AclPolicyError::InvalidSid);
    }
    // SAFETY: `sid_ptr` points at `len` readable bytes inside `sid_buf`, which is still alive; the
    // bytes are copied into an owned value here and the pointer never escapes.
    let bytes = unsafe { std::slice::from_raw_parts(sid_ptr.cast::<u8>(), len) };
    OwnedSid::from_bytes(bytes)
}

/// Non-Windows: there is no account database to consult, so resolution fails closed.
#[cfg(not(windows))]
pub fn resolve_account_sid(_account: &str) -> Result<OwnedSid, AclPolicyError> {
    Err(AclPolicyError::WindowsApiFailure)
}
