//! The single, minimal unsafe boundary: READ-ONLY OS-version and Service Control Manager access.
//!
//! This module is the ONLY place in the crate permitted to use `unsafe` (allowed at its `mod`
//! declaration in `lib.rs`).
//!
//! ## Read-only by construction
//!
//! The SCM is opened with exactly `SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE`. No
//! mutation-capable right is requested anywhere: `SC_MANAGER_CREATE_SERVICE`, `SERVICE_CHANGE_CONFIG`,
//! `SERVICE_START`, `SERVICE_STOP`, `DELETE`, `WRITE_DAC` and `WRITE_OWNER` do not appear in this
//! crate at all, and neither does any service-creating, -configuring, -starting or -deleting entry
//! point. The mask is a named constant so a test can assert exactly which bits it contains.
//!
//! ## Handle ownership
//!
//! The SCM handle is wrapped in an RAII guard that calls `CloseServiceHandle` exactly once, on every
//! path — success, refusal or early return. No raw handle is stored beyond the guard, none is
//! returned, and no accessor exposes one.

#[cfg(windows)]
use crate::error::HostPreflightError;
#[cfg(windows)]
use crate::host::{HostArchitecture, WindowsClientProfile};

/// `SC_MANAGER_CONNECT`.
pub(crate) const SC_MANAGER_CONNECT: u32 = 0x0001;
/// `SC_MANAGER_ENUMERATE_SERVICE`.
pub(crate) const SC_MANAGER_ENUMERATE_SERVICE: u32 = 0x0004;

/// The EXACT access mask this crate requests. Read-only: connect + enumerate, nothing else.
///
/// Deliberately a named constant so the read-only contract is asserted by test rather than trusted.
pub(crate) const READ_ONLY_SCM_ACCESS: u32 = SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE;

/// Upper bound on enumerated services, so a hostile or broken namespace cannot exhaust memory.
#[cfg(windows)]
const MAX_ENUMERATED_SERVICES: usize = 8192;

/// Owns the SCM handle and closes it exactly once. No accessor exposes the raw value.
#[cfg(windows)]
struct OwnedScmHandle(windows_sys::Win32::System::Services::SC_HANDLE);

#[cfg(windows)]
impl Drop for OwnedScmHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: `self.0` is a handle returned by `OpenSCManagerW` and not owned elsewhere;
            // `Drop` runs exactly once, so no double close is possible.
            unsafe {
                windows_sys::Win32::System::Services::CloseServiceHandle(self.0);
            }
        }
    }
}

/// Map a Windows status to a redacted classification. The Windows error TEXT is never captured.
#[cfg(windows)]
fn classify_scm(code: u32) -> HostPreflightError {
    use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;
    if code == ERROR_ACCESS_DENIED {
        HostPreflightError::ScmAccessDenied
    } else {
        HostPreflightError::ScmConnectFailed
    }
}

/// Collect the OS profile through `RtlGetVersion`, `GetProductInfo` and `GetNativeSystemInfo`.
///
/// `RtlGetVersion` is resolved dynamically because the documented `GetVersionEx` path is subject to
/// application-compatibility shimming and would report a manifest-dependent answer rather than the
/// real build.
///
/// # Errors
/// [`HostPreflightError::VersionApiUnavailable`] if the version entry point cannot be resolved or
/// fails; the profile is then reported as indeterminate rather than guessed.
#[cfg(windows)]
pub(crate) fn collect_profile() -> Result<WindowsClientProfile, HostPreflightError> {
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::System::SystemInformation::{
        GetNativeSystemInfo, GetProductInfo, OSVERSIONINFOEXW, SYSTEM_INFO,
    };

    // ---- version, via ntdll!RtlGetVersion ----
    let module_name: Vec<u16> = "ntdll.dll"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let proc_name = b"RtlGetVersion\0";

    // SAFETY: `module_name` is a NUL-terminated UTF-16 string alive across the call.
    // `GetModuleHandleW` returns a borrowed module handle that must NOT be freed.
    let ntdll = unsafe { GetModuleHandleW(module_name.as_ptr()) };
    if ntdll.is_null() {
        return Err(HostPreflightError::VersionApiUnavailable);
    }
    // SAFETY: `ntdll` is a live module handle and `proc_name` is a NUL-terminated ASCII name.
    let proc = unsafe { GetProcAddress(ntdll, proc_name.as_ptr()) };
    let Some(proc) = proc else {
        return Err(HostPreflightError::VersionApiUnavailable);
    };

    // `RtlGetVersion(POSVERSIONINFOEXW) -> NTSTATUS`.
    type RtlGetVersionFn = unsafe extern "system" fn(*mut OSVERSIONINFOEXW) -> i32;
    // SAFETY: the resolved symbol is documented with exactly this signature.
    let rtl_get_version: RtlGetVersionFn = unsafe { std::mem::transmute(proc) };

    let mut info: OSVERSIONINFOEXW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = u32::try_from(std::mem::size_of::<OSVERSIONINFOEXW>())
        .map_err(|_| HostPreflightError::VersionApiUnavailable)?;
    // SAFETY: `info` is a correctly sized, writable out-parameter whose size field is set as the
    // API requires; only a zero NTSTATUS gates our reads.
    let status = unsafe { rtl_get_version(&mut info) };
    if status != 0 {
        return Err(HostPreflightError::VersionApiUnavailable);
    }

    let (major, minor, build, product_type) = (
        info.dwMajorVersion,
        info.dwMinorVersion,
        info.dwBuildNumber,
        info.wProductType,
    );

    // ---- edition, via GetProductInfo ----
    let mut product: u32 = 0;
    // SAFETY: all four inputs are plain integers and `product` is a valid writable slot; a zero
    // return means the API declined, which we model as "no answer" rather than a value.
    let ok = unsafe { GetProductInfo(major, minor, 0, 0, &mut product) };
    let product_info = if ok == 0 { None } else { Some(product) };

    // ---- architecture, via GetNativeSystemInfo ----
    // SAFETY: `sys` is a properly sized writable out-parameter; the call cannot fail.
    let arch_raw = unsafe {
        let mut sys: SYSTEM_INFO = std::mem::zeroed();
        GetNativeSystemInfo(&mut sys);
        sys.Anonymous.Anonymous.wProcessorArchitecture
    };

    Ok(WindowsClientProfile::classify(
        major,
        minor,
        build,
        product_type,
        product_info,
        HostArchitecture::from_raw(arch_raw),
    ))
}

/// Enumerate existing service names using READ-ONLY access.
///
/// The returned names stay crate-internal: they exist only so collisions can be detected, and the
/// public contract never exposes the list.
///
/// # Errors
/// [`HostPreflightError::ScmAccessDenied`] / [`HostPreflightError::ScmConnectFailed`] if the SCM
/// cannot be opened read-only; [`HostPreflightError::ServiceEnumerationFailed`] if enumeration fails.
#[cfg(windows)]
pub(crate) fn enumerate_service_names() -> Result<Vec<String>, HostPreflightError> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_MORE_DATA};
    use windows_sys::Win32::System::Services::{
        EnumServicesStatusExW, OpenSCManagerW, ENUM_SERVICE_STATUS_PROCESSW, SC_ENUM_PROCESS_INFO,
        SERVICE_STATE_ALL, SERVICE_WIN32,
    };

    // SAFETY: null machine name = the local computer; null database name = the active database;
    // the mask is READ-ONLY (connect + enumerate). The handle is adopted immediately for RAII close.
    let raw = unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), READ_ONLY_SCM_ACCESS) };
    if raw.is_null() {
        // SAFETY: reading the calling thread's last-error code has no preconditions.
        return Err(classify_scm(unsafe { GetLastError() }));
    }
    let scm = OwnedScmHandle(raw);

    let mut names = Vec::new();
    let mut buffer: Vec<u8> = vec![0; 64 * 1024];
    let mut resume: u32 = 0;

    loop {
        let mut needed: u32 = 0;
        let mut returned: u32 = 0;
        // SAFETY: `scm.0` is a live read-only SCM handle; `buffer` is a writable allocation whose
        // exact length is passed; every out-parameter is a valid slot. On ERROR_MORE_DATA the call
        // writes nothing we read until the buffer has been grown.
        let ok = unsafe {
            EnumServicesStatusExW(
                scm.0,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_STATE_ALL,
                buffer.as_mut_ptr(),
                u32::try_from(buffer.len())
                    .map_err(|_| HostPreflightError::ServiceEnumerationFailed)?,
                &mut needed,
                &mut returned,
                &mut resume,
                std::ptr::null(),
            )
        };

        if ok == 0 {
            // SAFETY: reading the calling thread's last-error code has no preconditions.
            let code = unsafe { GetLastError() };
            if code == ERROR_MORE_DATA && needed as usize > buffer.len() {
                buffer.resize(needed as usize, 0);
                continue;
            }
            return Err(HostPreflightError::ServiceEnumerationFailed);
        }

        let count = returned as usize;
        if count > 0 {
            // SAFETY: on success Windows wrote `returned` contiguous ENUM_SERVICE_STATUS_PROCESSW
            // records at the start of `buffer`, which is correctly aligned for the struct because it
            // is a fresh allocation of at least that size and the API defines this layout.
            let entries = unsafe {
                std::slice::from_raw_parts(
                    buffer.as_ptr().cast::<ENUM_SERVICE_STATUS_PROCESSW>(),
                    count,
                )
            };
            for entry in entries {
                if entry.lpServiceName.is_null() {
                    continue;
                }
                // SAFETY: `lpServiceName` points at a NUL-terminated UTF-16 string inside `buffer`,
                // which is alive here; the value is copied into an owned String on this line.
                let name = unsafe { wide_to_string(entry.lpServiceName) };
                names.push(name);
                if names.len() > MAX_ENUMERATED_SERVICES {
                    return Err(HostPreflightError::ServiceEnumerationFailed);
                }
            }
        }

        if resume == 0 {
            break;
        }
    }

    // `scm` drops here, closing the handle exactly once.
    Ok(names)
}

/// Copy a NUL-terminated UTF-16 string into an owned `String`.
///
/// # Safety
/// `ptr` must point at a NUL-terminated UTF-16 string that stays alive for the call.
#[cfg(windows)]
unsafe fn wide_to_string(ptr: *const u16) -> String {
    let mut len = 0usize;
    // SAFETY: the caller guarantees a NUL-terminated string, so the scan terminates in bounds.
    while unsafe { *ptr.add(len) } != 0 {
        len += 1;
    }
    // SAFETY: `len` units before the terminator are readable per the caller's guarantee.
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    String::from_utf16_lossy(slice)
}

// ---- non-Windows fail-closed stubs (no emulation) ----

#[cfg(not(windows))]
pub(crate) fn collect_profile(
) -> Result<crate::host::WindowsClientProfile, crate::error::HostPreflightError> {
    Err(crate::error::HostPreflightError::UnsupportedPlatform)
}

#[cfg(not(windows))]
pub(crate) fn enumerate_service_names() -> Result<Vec<String>, crate::error::HostPreflightError> {
    Err(crate::error::HostPreflightError::UnsupportedPlatform)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mutation-capable masks, defined ONLY so these tests can prove they are absent from the
    // requested mask. They live inside the test module so they cannot reach a release build.
    /// `SC_MANAGER_CREATE_SERVICE`.
    const SC_MANAGER_CREATE_SERVICE: u32 = 0x0002;
    /// `SERVICE_CHANGE_CONFIG`.
    const SERVICE_CHANGE_CONFIG: u32 = 0x0002;
    /// `SERVICE_START`.
    const SERVICE_START: u32 = 0x0010;
    /// `SERVICE_STOP`.
    const SERVICE_STOP: u32 = 0x0020;
    /// `DELETE`.
    const STANDARD_DELETE: u32 = 0x0001_0000;
    /// `WRITE_DAC`.
    const STANDARD_WRITE_DAC: u32 = 0x0004_0000;
    /// `WRITE_OWNER`.
    const STANDARD_WRITE_OWNER: u32 = 0x0008_0000;

    /// The read-only contract, asserted bit by bit rather than trusted.
    #[test]
    fn the_requested_scm_mask_is_exactly_connect_plus_enumerate() {
        assert_eq!(
            READ_ONLY_SCM_ACCESS,
            SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE
        );
        assert_eq!(READ_ONLY_SCM_ACCESS, 0x0005);
    }

    #[test]
    fn the_requested_mask_contains_no_mutation_authority() {
        for (name, bit) in [
            ("SC_MANAGER_CREATE_SERVICE", SC_MANAGER_CREATE_SERVICE),
            ("SERVICE_CHANGE_CONFIG", SERVICE_CHANGE_CONFIG),
            ("SERVICE_START", SERVICE_START),
            ("SERVICE_STOP", SERVICE_STOP),
            ("DELETE", STANDARD_DELETE),
            ("WRITE_DAC", STANDARD_WRITE_DAC),
            ("WRITE_OWNER", STANDARD_WRITE_OWNER),
        ] {
            assert_eq!(
                READ_ONLY_SCM_ACCESS & bit,
                0,
                "{name} must not be requested"
            );
        }
    }
}
