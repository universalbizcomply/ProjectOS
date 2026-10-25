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
//!
//! ## One privilege, one write (§10G-PRIV)
//!
//! Assigning an owner other than the caller (SYSTEM, for every accepted policy) needs
//! `SeRestorePrivilege` ENABLED. An elevated token HOLDS it but, launched from PowerShell, has it
//! disabled; launched from Git Bash, enabled. So the ownership write never relies on that ambient
//! state: [`apply_security`] enables it explicitly for its single `SetSecurityInfo` call, restores the
//! exact prior state Windows reported, and confirms the restoration by re-reading the token. The
//! privilege is a Windows constant — no caller, environment variable or shell can select another.

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
    use std::os::windows::io::AsHandle;
    let handle = open_secure_handle(path, ACCESS_READ_SECURITY, expected)?;
    read_security_of(handle.as_handle())
}

/// Read the owner, control bits and DACL of a FILE this process already holds open (§10I).
///
/// For an object this process has just CREATED: the observation is taken from the very handle the
/// creation returned, so no pathname is re-resolved between creating the object and judging it.
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal.
#[cfg(windows)]
pub(crate) fn read_file_security(
    file: &std::fs::File,
) -> Result<(Option<Vec<u8>>, u16, RawDacl), AclPolicyError> {
    use std::os::windows::io::AsHandle;
    read_security_of(file.as_handle())
}

/// The descriptor read itself, on an already-admitted handle.
#[cfg(windows)]
fn read_security_of(
    handle: std::os::windows::io::BorrowedHandle<'_>,
) -> Result<(Option<Vec<u8>>, u16, RawDacl), AclPolicyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        GetLengthSid, GetSecurityDescriptorControl, GetSecurityDescriptorDacl, IsValidSid, ACL,
        DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    };

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
/// The write runs inside ONE `SeRestorePrivilege` window (see [`run_in_restore_privilege_window`]), so
/// assigning an owner other than the caller does not depend on the privilege state the process
/// happened to inherit from whatever launched it.
///
/// The target handle is admitted BEFORE the window, deliberately: nothing but the one write runs
/// privileged. The open therefore still sees whatever privilege state the process already had, and
/// with `FILE_FLAG_BACKUP_SEMANTICS` an ALREADY-enabled `SeRestorePrivilege` can grant
/// `WRITE_DAC`/`WRITE_OWNER` that the DACL withholds. Every accepted policy — and the real state root it
/// repairs — grants Administrators `FullControl`, so for those targets the open is DACL-granted either
/// way. A target whose DACL withholds `WRITE_OWNER` from the caller is refused `AccessDenied`, before
/// any effect, unless the process arrived with the privilege enabled (pinned by
/// `a_target_withholding_write_owner_is_decided_at_the_open_by_the_prior_state`).
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal. A refusal returned before `SetSecurityInfo` means the
/// ACL was NOT changed — including [`AclPolicyError::PrivilegeUnavailable`].
/// [`AclPolicyError::PrivilegeRestoreFailed`] is returned after it and is never a success.
#[cfg(windows)]
pub(crate) fn apply_security(
    path: &Path,
    owner: &OwnedSid,
    acl_bytes: &[u8],
    expected: SecuredObjectKind,
) -> Result<(), AclPolicyError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
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

    // Privilege admission PREREQUISITES, all pre-effect and none of them enabling anything: serialise
    // this process's privilege windows, refuse an impersonating thread, open the process token and
    // resolve the privilege.
    let serialised = admit_privilege_window(&PRIVILEGE_WINDOW)?;
    let mut privilege = ProcessRestorePrivilege::open()?;

    // Opened AFTER validation, so the object is held for the shortest possible window, and opened
    // without following reparse points so the write cannot be redirected.
    let handle = open_secure_handle(path, ACCESS_WRITE_SECURITY, expected)?;
    let raw = handle.as_raw_handle() as HANDLE;

    // THE WINDOW: enable → exactly this one write → restore the prior state and confirm it.
    run_in_restore_privilege_window(&serialised, &mut privilege, || {
        // SAFETY: `raw` is a live handle opened with WRITE_DAC|WRITE_OWNER; the owner and ACL
        // pointers are aligned, owned and alive across the call; no SACL is supplied.
        unsafe {
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
        }
    })
}

// ---- §10I: creation with a stated descriptor — no privilege, no later re-securing ----

/// `SECURITY_DESCRIPTOR_REVISION`. Stated here rather than pulling a `SystemServices` feature for one
/// constant Windows has never changed.
#[cfg(windows)]
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;

/// An ABSOLUTE-format security descriptor carrying exactly one owner and one PROTECTED DACL, for
/// handing to a creation call.
///
/// The descriptor's owner and DACL fields point INTO the two aligned buffers this value owns; both
/// are heap allocations that do not move when the value does, and the descriptor itself is boxed for
/// the same reason. No group, no SACL: a creation call given none assigns the defaults Windows always
/// assigns, and neither one is authority over the object's contents.
#[cfg(windows)]
struct CreationDescriptor {
    _owner: Vec<u32>,
    _acl: Vec<u32>,
    descriptor: Box<windows_sys::Win32::Security::SECURITY_DESCRIPTOR>,
}

#[cfg(windows)]
impl CreationDescriptor {
    fn new(owner: &OwnedSid, acl_bytes: &[u8]) -> Result<Self, AclPolicyError> {
        use windows_sys::Win32::Security::{
            InitializeSecurityDescriptor, IsValidAcl, IsValidSid, SetSecurityDescriptorControl,
            SetSecurityDescriptorDacl, SetSecurityDescriptorOwner, ACL, SECURITY_DESCRIPTOR,
            SE_DACL_PROTECTED,
        };

        let owner_words = aligned(owner.as_bytes());
        let acl_words = aligned(acl_bytes);
        let owner_ptr = owner_words.as_ptr().cast_mut().cast();
        let acl_ptr = acl_words.as_ptr().cast::<ACL>();
        // SAFETY: `owner_ptr` points at an aligned, owned, well-formed binary SID alive for this call.
        if unsafe { IsValidSid(owner_ptr) } == 0 {
            return Err(AclPolicyError::InvalidSid);
        }
        // SAFETY: `acl_ptr` points at an aligned, owned ACL image alive for this call.
        if unsafe { IsValidAcl(acl_ptr) } == 0 {
            return Err(AclPolicyError::MalformedDescriptor);
        }

        // SAFETY: an all-zero SECURITY_DESCRIPTOR is plain data; `InitializeSecurityDescriptor`
        // overwrites it before any other call reads it.
        let mut descriptor: Box<SECURITY_DESCRIPTOR> = Box::new(unsafe { std::mem::zeroed() });
        let psd = std::ptr::addr_of_mut!(*descriptor).cast();
        // SAFETY: `psd` points at a boxed, writable SECURITY_DESCRIPTOR owned by this value. The owner
        // and DACL pointers stored into it point into `owner_words` / `acl_words`, which this value
        // also owns and which outlive every use of the descriptor. Each call's BOOL gates the next.
        let ok = unsafe {
            InitializeSecurityDescriptor(psd, SECURITY_DESCRIPTOR_REVISION) != 0
                && SetSecurityDescriptorOwner(psd, owner_ptr, 0) != 0
                && SetSecurityDescriptorDacl(psd, 1, acl_ptr, 0) != 0
                && SetSecurityDescriptorControl(psd, SE_DACL_PROTECTED, SE_DACL_PROTECTED) != 0
        };
        if !ok {
            return Err(last_error());
        }
        Ok(Self {
            _owner: owner_words,
            _acl: acl_words,
            descriptor,
        })
    }

    /// Creation attributes pointing at this descriptor. Non-inheritable handle. Valid only while
    /// `self` is.
    fn attributes(&mut self) -> windows_sys::Win32::Security::SECURITY_ATTRIBUTES {
        windows_sys::Win32::Security::SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<windows_sys::Win32::Security::SECURITY_ATTRIBUTES>()
                as u32,
            lpSecurityDescriptor: std::ptr::addr_of_mut!(*self.descriptor).cast(),
            bInheritHandle: 0,
        }
    }
}

/// Whether a failed creation failed because SOMETHING ALREADY EXISTS at the path.
#[cfg(windows)]
fn exists_status(code: u32) -> bool {
    use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS};
    code == ERROR_ALREADY_EXISTS || code == ERROR_FILE_EXISTS
}

/// Create ONE new directory whose descriptor is exactly `owner` plus the PROTECTED `acl`.
///
/// The object comes into existence WITH that descriptor: there is no moment at which it exists
/// under an inherited or token-default DACL, so nothing has to be re-secured afterwards and no
/// `WRITE_DAC` is needed. Protection means the parent's inheritable ACEs are not merged in.
///
/// Returns `Ok(false)` — and touches nothing — when anything already exists at `path`: this creates,
/// it never adopts or rewrites.
///
/// NO PRIVILEGE IS ENABLED. Windows accepts an owner the caller's token may assign (its own account
/// or an owner-flagged group) and refuses any other with `ERROR_INVALID_OWNER`; that refusal is
/// reported, never worked around.
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal.
#[cfg(windows)]
pub(crate) fn create_directory_with_security(
    path: &Path,
    owner: &OwnedSid,
    acl_bytes: &[u8],
) -> Result<bool, AclPolicyError> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;

    let mut descriptor = CreationDescriptor::new(owner, acl_bytes)?;
    let attributes = descriptor.attributes();
    let wide = to_wide(path);
    // SAFETY: `wide` is a valid NUL-terminated UTF-16 path and `attributes` points at a descriptor
    // `descriptor` keeps alive across the call; only the BOOL result and last-error are read.
    let (ok, status) = unsafe {
        let ok = CreateDirectoryW(wide.as_ptr(), &attributes);
        (ok, GetLastError())
    };
    if ok != 0 {
        return Ok(true);
    }
    if exists_status(status) {
        return Ok(false);
    }
    Err(classify(status))
}

/// Create ONE new FILE, opened for read and write, whose descriptor is exactly `owner` plus the
/// PROTECTED `acl`.
///
/// `CREATE_NEW`, deliberately. With `CREATE_ALWAYS`/`OPEN_ALWAYS` Windows IGNORES the supplied
/// descriptor when the file already exists, so a planted file would be adopted with whatever
/// descriptor its planter chose. Here an existing object is `Ok(None)` and is not opened at all.
///
/// # Errors
/// [`AclPolicyError`] classifying the refusal.
#[cfg(windows)]
pub(crate) fn create_file_with_security(
    path: &Path,
    owner: &OwnedSid,
    acl_bytes: &[u8],
) -> Result<Option<std::fs::File>, AclPolicyError> {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        GetLastError, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };

    let mut descriptor = CreationDescriptor::new(owner, acl_bytes)?;
    let attributes = descriptor.attributes();
    let wide = to_wide(path);
    // SAFETY: `wide` is a valid NUL-terminated UTF-16 path and `attributes` points at a descriptor
    // `descriptor` keeps alive across the call; a null template handle is the documented default.
    // The share mode is the one `std::fs::File` uses, so the file behaves exactly like one opened
    // by the standard library once it exists. The result is only compared with
    // INVALID_HANDLE_VALUE before being adopted by `OwnedHandle`, which closes it exactly once.
    let (raw, status) = unsafe {
        let raw = CreateFileW(
            wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        (raw, GetLastError())
    };
    if raw == INVALID_HANDLE_VALUE {
        if exists_status(status) {
            return Ok(None);
        }
        return Err(classify(status));
    }
    // SAFETY: `raw` is a valid handle returned by CreateFileW and owned nowhere else.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw as std::os::windows::io::RawHandle) };
    Ok(Some(std::fs::File::from(handle)))
}

/// Refuse a governed creation on an IMPERSONATING thread (§10I).
///
/// A creation's owner check reads the PROCESS token, while Windows assigns and access-checks the new
/// object under the THREAD's token when there is one; judging one identity and acting as another is
/// refused before anything is created.
#[cfg(windows)]
pub(crate) fn refuse_impersonation() -> Result<(), AclPolicyError> {
    refuse_impersonating_thread().map_err(|_| AclPolicyError::PolicyRefused)
}

// ---- §10G-PRIV: SeRestorePrivilege, enabled for exactly one ownership write ----

/// Serialises every privilege window in this process.
///
/// Privilege state lives on the PROCESS token. Two overlapping windows would each capture the other's
/// enabled state as "prior", and whichever restored last would leave the privilege enabled. Holding
/// this lock from admission to confirmed restoration makes windows strictly sequential. It cannot
/// bind code outside this crate that adjusts the same token; nothing in ProjectOS does.
#[cfg(windows)]
static PRIVILEGE_WINDOW: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Upper bound for a `TOKEN_PRIVILEGES` buffer; anything larger is malformed rather than allocated.
#[cfg(windows)]
const MAX_TOKEN_PRIVILEGES_BYTES: usize = 4096;

/// The token's `SeRestorePrivilege` state before a window, exactly as Windows reported it.
#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PriorPrivilege {
    /// Already enabled. Windows changed nothing, so restoration writes nothing.
    AlreadyEnabled,
    /// Held but not enabled. Windows returned these exact prior attributes; they are written back.
    Changed(u32),
}

#[cfg(windows)]
impl PriorPrivilege {
    fn was_enabled(self) -> bool {
        use windows_sys::Win32::Security::SE_PRIVILEGE_ENABLED;
        match self {
            Self::AlreadyEnabled => true,
            Self::Changed(attributes) => attributes & SE_PRIVILEGE_ENABLED != 0,
        }
    }
}

/// The three token operations a window performs.
///
/// Private to this module. The process token is the only production implementation; the only other
/// is a scripted test double. The privilege is not a parameter of any method.
#[cfg(windows)]
trait RestorePrivilegeToken {
    /// Request `SeRestorePrivilege` ENABLED and return the state Windows says it replaced.
    fn enable(&mut self) -> Result<PriorPrivilege, AclPolicyError>;
    /// Write the prior state back. `AlreadyEnabled` writes nothing.
    fn restore(&mut self, prior: PriorPrivilege) -> Result<(), AclPolicyError>;
    /// Re-read from Windows whether the privilege is enabled now.
    fn is_enabled(&self) -> Result<bool, AclPolicyError>;
}

/// Take the window lock. A POISONED lock means an earlier window panicked part-way; the token state it
/// left is not trusted, so every later window in this process is refused before any effect.
#[cfg(windows)]
fn admit_privilege_window(
    lock: &std::sync::Mutex<()>,
) -> Result<std::sync::MutexGuard<'_, ()>, AclPolicyError> {
    lock.lock()
        .map_err(|_| AclPolicyError::PrivilegeUnavailable)
}

/// Run exactly ONE effect with `SeRestorePrivilege` enabled, then restore the prior state and confirm
/// it by re-reading the token.
///
/// `_serialised` is the caller's hold on the window lock. `effect` is `FnOnce`, so it runs at most once
/// per window; it returns the raw Win32 status of the one ownership write.
///
/// * a failure to ENABLE returns before `effect` runs: nothing was written;
/// * once `effect` has run, restoration is attempted on every path, and a restoration that fails — or
///   that the re-read does not confirm — is [`AclPolicyError::PrivilegeRestoreFailed`] even when the
///   write succeeded. Success is never reported with the token left altered.
#[cfg(windows)]
fn run_in_restore_privilege_window<T: RestorePrivilegeToken>(
    _serialised: &std::sync::MutexGuard<'_, ()>,
    token: &mut T,
    effect: impl FnOnce() -> u32,
) -> Result<(), AclPolicyError> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;

    let prior = token.enable()?;
    let window = PrivilegeWindow {
        token,
        prior: Some(prior),
    };
    let status = effect();
    window.close()?;
    if status != ERROR_SUCCESS {
        return Err(classify(status));
    }
    Ok(())
}

/// An OPEN window: the privilege is enabled and `prior` has not yet been written back.
///
/// [`Self::close`] is the only success path: it restores, re-reads and RETURNS the result. `Drop` is a
/// best-effort backstop for an unwinding panic only — it cannot report failure, so no success path
/// relies on it.
#[cfg(windows)]
struct PrivilegeWindow<'a, T: RestorePrivilegeToken> {
    token: &'a mut T,
    prior: Option<PriorPrivilege>,
}

#[cfg(windows)]
impl<T: RestorePrivilegeToken> PrivilegeWindow<'_, T> {
    fn close(mut self) -> Result<(), AclPolicyError> {
        let Some(prior) = self.prior.take() else {
            return Err(AclPolicyError::PrivilegeRestoreFailed);
        };
        match self
            .token
            .restore(prior)
            .and_then(|()| self.token.is_enabled())
        {
            Ok(now) if now == prior.was_enabled() => Ok(()),
            _ => Err(AclPolicyError::PrivilegeRestoreFailed),
        }
    }
}

#[cfg(windows)]
impl<T: RestorePrivilegeToken> Drop for PrivilegeWindow<'_, T> {
    fn drop(&mut self) {
        if let Some(prior) = self.prior.take() {
            // Unwinding: there is no caller to return a result to. The write-back is still attempted
            // so a panic never deliberately leaves the privilege enabled.
            let _ = self.token.restore(prior);
        }
    }
}

/// Interpret the `PreviousState` Windows returned for a one-privilege request.
///
/// Windows lists only the privileges it CHANGED: none means it was already enabled; one entry for this
/// LUID carries the exact attributes it replaced. Anything else is not a state this window can restore
/// faithfully, and is `None`.
#[cfg(windows)]
fn decode_previous(
    previous: &windows_sys::Win32::Security::TOKEN_PRIVILEGES,
    luid: windows_sys::Win32::Foundation::LUID,
) -> Option<PriorPrivilege> {
    match previous.PrivilegeCount {
        0 => Some(PriorPrivilege::AlreadyEnabled),
        1 => {
            let entry = previous.Privileges[0];
            (entry.Luid.LowPart == luid.LowPart && entry.Luid.HighPart == luid.HighPart)
                .then_some(PriorPrivilege::Changed(entry.Attributes))
        }
        _ => None,
    }
}

/// Refuse when the calling THREAD is impersonating.
///
/// `SetSecurityInfo` checks privileges against the thread's impersonation token when there is one,
/// while a window adjusts the PROCESS token. Enabling on one token and writing under another is the
/// wrong-token adjustment, so the window is refused before anything is enabled.
#[cfg(windows)]
fn refuse_impersonating_thread() -> Result<(), AclPolicyError> {
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NO_TOKEN, HANDLE};
    use windows_sys::Win32::Security::TOKEN_QUERY;
    use windows_sys::Win32::System::Threading::{GetCurrentThread, OpenThreadToken};

    let mut raw: HANDLE = std::ptr::null_mut();
    // SAFETY: the current-thread pseudo-handle is always valid and never closed; `raw` is a writable
    // slot. OpenAsSelf=TRUE checks access as the process, so an impersonation level too low to open
    // the token still cannot hide that one exists (that case fails with an error other than NO_TOKEN).
    let opened = unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut raw) };
    if opened != 0 {
        // SAFETY: `raw` is a valid token handle owned nowhere else; adopting it closes it here.
        drop(unsafe { OwnedHandle::from_raw_handle(raw as std::os::windows::io::RawHandle) });
        return Err(AclPolicyError::PrivilegeUnavailable);
    }
    // SAFETY: reading the calling thread's last-error code has no preconditions.
    match unsafe { GetLastError() } {
        ERROR_NO_TOKEN => Ok(()),
        _ => Err(AclPolicyError::PrivilegeUnavailable),
    }
}

/// The CURRENT PROCESS token, admitted for exactly one privilege: `SeRestorePrivilege`.
///
/// Opened with `TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY` only — adjust, and read the state back. The
/// privilege is the Windows constant `SE_RESTORE_NAME`; no caller, environment variable or shell can
/// select another. The handle is closed by `OwnedHandle` on every path.
#[cfg(windows)]
struct ProcessRestorePrivilege {
    token: std::os::windows::io::OwnedHandle,
    luid: windows_sys::Win32::Foundation::LUID,
}

#[cfg(windows)]
impl ProcessRestorePrivilege {
    /// Every step is PRE-EFFECT and changes nothing.
    fn open() -> Result<Self, AclPolicyError> {
        use std::os::windows::io::{FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::{HANDLE, LUID};
        use windows_sys::Win32::Security::{
            LookupPrivilegeValueW, SE_RESTORE_NAME, TOKEN_ADJUST_PRIVILEGES, TOKEN_QUERY,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        refuse_impersonating_thread()?;

        let mut raw: HANDLE = std::ptr::null_mut();
        // SAFETY: the current-process pseudo-handle is always valid and never closed; `raw` is a
        // writable slot whose handle is adopted for RAII closure immediately below.
        let opened = unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                &mut raw,
            )
        };
        if opened == 0 {
            return Err(AclPolicyError::PrivilegeUnavailable);
        }
        // SAFETY: `raw` is a valid token handle owned nowhere else.
        let token = unsafe { OwnedHandle::from_raw_handle(raw as std::os::windows::io::RawHandle) };

        let mut luid = LUID {
            LowPart: 0,
            HighPart: 0,
        };
        // SAFETY: a null system name means the local system; `SE_RESTORE_NAME` is a static
        // NUL-terminated UTF-16 constant; `luid` is a writable slot.
        if unsafe { LookupPrivilegeValueW(std::ptr::null(), SE_RESTORE_NAME, &mut luid) } == 0 {
            return Err(AclPolicyError::PrivilegeUnavailable);
        }
        Ok(Self { token, luid })
    }

    fn raw(&self) -> windows_sys::Win32::Foundation::HANDLE {
        use std::os::windows::io::AsRawHandle;
        self.token.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE
    }

    /// Write ONE attribute set for this privilege. `DisableAllPrivileges` is FALSE and the state names
    /// only this LUID, so no other privilege can be touched. `SE_PRIVILEGE_REMOVED` — which would
    /// delete the privilege from the token for good — is refused.
    fn write(&mut self, attributes: u32) -> Result<(), AclPolicyError> {
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, ERROR_SUCCESS};
        use windows_sys::Win32::Security::{
            AdjustTokenPrivileges, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_REMOVED, TOKEN_PRIVILEGES,
        };

        if attributes & SE_PRIVILEGE_REMOVED != 0 {
            return Err(AclPolicyError::PrivilegeRestoreFailed);
        }
        let state = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: self.luid,
                Attributes: attributes,
            }],
        };
        // SAFETY: the token handle is live and holds TOKEN_ADJUST_PRIVILEGES; `state` is a complete
        // one-entry TOKEN_PRIVILEGES alive across the call; no previous state is requested (null
        // buffer, zero length). The last-error code is cleared first and read immediately after, so
        // a stale value cannot be mistaken for this call's result.
        let (ok, status) = unsafe {
            SetLastError(ERROR_SUCCESS);
            let ok = AdjustTokenPrivileges(
                self.raw(),
                0,
                &state,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            (ok, GetLastError())
        };
        if ok == 0 || status != ERROR_SUCCESS {
            return Err(AclPolicyError::PrivilegeRestoreFailed);
        }
        Ok(())
    }

    /// Every privilege the token holds, as `(LUID low, LUID high, attributes)`, re-read from Windows.
    fn snapshot(&self) -> Result<Vec<(u32, i32, u32)>, AclPolicyError> {
        use windows_sys::Win32::Security::{
            GetTokenInformation, TokenPrivileges, LUID_AND_ATTRIBUTES, TOKEN_PRIVILEGES,
        };

        // Size probe: this call is EXPECTED to fail with ERROR_INSUFFICIENT_BUFFER; only `needed`
        // matters.
        let mut needed: u32 = 0;
        // SAFETY: a null buffer with length 0 is the documented size-query form; `needed` is writable.
        unsafe {
            GetTokenInformation(
                self.raw(),
                TokenPrivileges,
                std::ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        let needed_usize = needed as usize;
        if needed_usize < std::mem::size_of::<u32>() || needed_usize > MAX_TOKEN_PRIVILEGES_BYTES {
            return Err(AclPolicyError::WindowsApiFailure);
        }
        // `Vec<u64>`: 8-byte aligned, which satisfies TOKEN_PRIVILEGES' 4-byte alignment.
        let mut buf: Vec<u64> = vec![0; needed_usize.div_ceil(8)];
        let mut written: u32 = 0;
        // SAFETY: `buf` is at least `needed` bytes, aligned, and exclusively borrowed for the call.
        if unsafe {
            GetTokenInformation(
                self.raw(),
                TokenPrivileges,
                buf.as_mut_ptr().cast(),
                needed,
                &mut written,
            )
        } == 0
        {
            return Err(last_error());
        }

        let header = buf.as_ptr().cast::<TOKEN_PRIVILEGES>();
        // SAFETY: `buf` holds at least the 4-byte count, written by the successful call above.
        let count = unsafe { (*header).PrivilegeCount } as usize;
        // SAFETY: `addr_of!` on a raw-pointer place creates no reference, so the resulting pointer
        // keeps the provenance of the WHOLE buffer rather than of the one-element declared array.
        let first =
            unsafe { std::ptr::addr_of!((*header).Privileges) }.cast::<LUID_AND_ATTRIBUTES>();
        let offset = first as usize - header as usize;
        let fits = count
            .checked_mul(std::mem::size_of::<LUID_AND_ATTRIBUTES>())
            .and_then(|bytes| bytes.checked_add(offset))
            .is_some_and(|end| end <= written as usize);
        if !fits {
            return Err(AclPolicyError::WindowsApiFailure);
        }
        // SAFETY: bounds proven on the lines above: `count` entries starting at `first` lie inside the
        // bytes Windows wrote into `buf`, which outlives the slice; entries are copied out here.
        let entries = unsafe { std::slice::from_raw_parts(first, count) };
        Ok(entries
            .iter()
            .map(|e| (e.Luid.LowPart, e.Luid.HighPart, e.Attributes))
            .collect())
    }
}

#[cfg(windows)]
impl RestorePrivilegeToken for ProcessRestorePrivilege {
    fn enable(&mut self) -> Result<PriorPrivilege, AclPolicyError> {
        use windows_sys::Win32::Foundation::{
            GetLastError, SetLastError, ERROR_NOT_ALL_ASSIGNED, ERROR_SUCCESS, LUID,
        };
        use windows_sys::Win32::Security::{
            AdjustTokenPrivileges, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_PRIVILEGES,
        };

        let requested = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: self.luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        let mut previous = TOKEN_PRIVILEGES {
            PrivilegeCount: 0,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: LUID {
                    LowPart: 0,
                    HighPart: 0,
                },
                Attributes: 0,
            }],
        };
        let mut returned: u32 = 0;
        // SAFETY: the token handle is live and holds TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY (the latter
        // is required for PreviousState); `requested` is a complete one-entry TOKEN_PRIVILEGES;
        // `previous` is a writable buffer of exactly the length passed, which fits the one entry a
        // one-privilege request can change. The last-error code is cleared first and read
        // immediately after: a successful BOOL alone does NOT mean the privilege was assigned.
        let (ok, status) = unsafe {
            SetLastError(ERROR_SUCCESS);
            let ok = AdjustTokenPrivileges(
                self.raw(),
                0,
                &requested,
                std::mem::size_of::<TOKEN_PRIVILEGES>() as u32,
                &mut previous,
                &mut returned,
            );
            (ok, GetLastError())
        };
        if ok == 0 {
            // The call failed as a whole; Windows adjusted nothing.
            return Err(AclPolicyError::PrivilegeUnavailable);
        }
        match (status, decode_previous(&previous, self.luid)) {
            (ERROR_SUCCESS, Some(prior)) => Ok(prior),
            // The token does not HOLD the privilege. Windows changed nothing.
            (ERROR_NOT_ALL_ASSIGNED, Some(PriorPrivilege::AlreadyEnabled)) => {
                Err(AclPolicyError::PrivilegeUnavailable)
            }
            // Any other status with a change Windows DID report: put back exactly what it replaced,
            // then refuse. Still pre-effect.
            (_, Some(changed @ PriorPrivilege::Changed(_))) => {
                self.restore(changed)?;
                Err(AclPolicyError::PrivilegeUnavailable)
            }
            (_, Some(PriorPrivilege::AlreadyEnabled)) => Err(AclPolicyError::PrivilegeUnavailable),
            // Windows reported a previous state this window cannot restore faithfully. The exact prior
            // is unknowable, so it fails closed to LEAST privilege and reports the restoration failed.
            (_, None) => {
                let _ = self.write(0);
                Err(AclPolicyError::PrivilegeRestoreFailed)
            }
        }
    }

    fn restore(&mut self, prior: PriorPrivilege) -> Result<(), AclPolicyError> {
        match prior {
            PriorPrivilege::AlreadyEnabled => Ok(()),
            PriorPrivilege::Changed(attributes) => self.write(attributes),
        }
    }

    fn is_enabled(&self) -> Result<bool, AclPolicyError> {
        use windows_sys::Win32::Security::SE_PRIVILEGE_ENABLED;
        let luid = self.luid;
        Ok(self.snapshot()?.iter().any(|&(low, high, attributes)| {
            low == luid.LowPart && high == luid.HighPart && attributes & SE_PRIVILEGE_ENABLED != 0
        }))
    }
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

#[cfg(not(windows))]
pub(crate) fn read_file_security(
    _file: &std::fs::File,
) -> Result<(Option<Vec<u8>>, u16, RawDacl), AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn create_directory_with_security(
    _path: &Path,
    _owner: &OwnedSid,
    _acl_bytes: &[u8],
) -> Result<bool, AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn create_file_with_security(
    _path: &Path,
    _owner: &OwnedSid,
    _acl_bytes: &[u8],
) -> Result<Option<std::fs::File>, AclPolicyError> {
    Err(AclPolicyError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn refuse_impersonation() -> Result<(), AclPolicyError> {
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

#[cfg(all(test, windows))]
mod privilege_tests;

#[cfg(all(test, windows))]
mod governed_creation_tests;
