//! Atomic acquisition of the Windows named-mutex EXISTENCE TOKEN, and a read-only reopen probe.
//!
//! The mutex is an existence token, never a lock. Ownership is what creates thread-affinity and
//! abandonment hazards, so this design NEVER takes ownership: `dwFlags = 0` (no
//! `CREATE_MUTEX_INITIAL_OWNER`), no `WaitForSingleObject`, no `ReleaseMutex`. Object lifetime is bound
//! to the HANDLE, and handles are PROCESS-owned, so the authority is released ONLY when the owning
//! handle closes — on explicit drop or on any form of process death. `CreateMutexExW` is a single
//! atomic create-or-open, so two callers can never both be classified as the creator.
//!
//! No trust is derived from a name: [`WindowsTokenAcquisition::Existing`] means only that an object of
//! that name already exists — corroboration (a later gate) decides what it represents.

#![cfg(windows)]

use std::os::windows::io::OwnedHandle;

use projectos_windows_runtime_primitives::handles;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    GetLastError, SetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_INVALID_HANDLE,
    ERROR_SUCCESS, HANDLE, WIN32_ERROR,
};
use windows::Win32::System::Threading::{
    CreateMutexExW, OpenMutexW, SYNCHRONIZATION_ACCESS_RIGHTS,
};

use crate::model::{AuthorityGuard, AuthorityRefusal, AuthorityTokenOutcome};
use crate::security::{MachineWideAuthoritySecurity, AUTHORITY_DETECTION_RIGHTS};

/// The result of a create-or-open attempt on the existence token.
#[derive(Debug)]
pub enum WindowsTokenAcquisition {
    /// This process newly created the token; the guard owns the sole handle.
    Acquired(AuthorityGuard),
    /// A token of this name already existed. The transient handle was closed; this is NOT trust.
    Existing,
    /// The kernel refused, with a fieldless reason.
    Refused(AuthorityRefusal),
}

impl WindowsTokenAcquisition {
    /// The raw, trust-free outcome classification for evidence.
    #[must_use]
    pub fn outcome(&self) -> AuthorityTokenOutcome {
        match self {
            WindowsTokenAcquisition::Acquired(_) => AuthorityTokenOutcome::AcquiredToken,
            WindowsTokenAcquisition::Existing => AuthorityTokenOutcome::ExistingToken,
            WindowsTokenAcquisition::Refused(_) => AuthorityTokenOutcome::Refused,
        }
    }
}

/// Atomically create-or-open the existence token named `name`, secured by `security`.
///
/// Requests `SYNCHRONIZE | READ_CONTROL` only, so the creator can later inspect its own DACL but can
/// never modify the object. On a fresh create the returned guard adopts the handle; on an existing
/// object the transient handle is closed immediately (a refused/duplicate process retains no native
/// authority).
#[must_use]
pub fn acquire_existence_token(
    name: &str,
    security: &MachineWideAuthoritySecurity,
) -> WindowsTokenAcquisition {
    // Build every input before the adjacency block: no allocation between Set/GetLastError.
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let sa = security.security_attributes();

    // ---------------------------------------------------------------------------------------------
    // LAST-ERROR ADJACENCY — LOAD-BEARING. Do not insert anything into this block.
    // `ERROR_ALREADY_EXISTS` is the only signal separating "we created it" from "it already existed";
    // Windows only ever SETS it, so a stale value must be cleared first with SetLastError(ERROR_SUCCESS)
    // and read immediately after, before any call that could overwrite the thread's last error.
    // SAFETY: `sa` borrows `security`, so its descriptor outlives the call; `wide` is a NUL-terminated
    // wide string alive for the call; Set/GetLastError touch only the calling thread's error slot. Any
    // returned handle is taken under exclusive ownership below and closed exactly once.
    // ---------------------------------------------------------------------------------------------
    let (result, last) = unsafe {
        SetLastError(ERROR_SUCCESS);
        let result = CreateMutexExW(
            Some(&sa as *const _),
            PCWSTR(wide.as_ptr()),
            0, // dwFlags: no CREATE_MUTEX_INITIAL_OWNER — ownership is never taken.
            AUTHORITY_DETECTION_RIGHTS,
        );
        let last = GetLastError();
        (result, last)
    };

    match result {
        Ok(handle) if last == ERROR_ALREADY_EXISTS => {
            // Valid handle, but the object pre-existed. Adopt it into the canonical owned handle and
            // drop it at once — a refused/duplicate process retains no native authority, and the
            // primitive performs the single close.
            // SAFETY: `handle` is a valid, exclusively-owned handle from a successful CreateMutexExW
            // with no other owner; `handles::adopt` transfers it once and its drop closes it once.
            let _released = unsafe { handles::adopt(handle) };
            WindowsTokenAcquisition::Existing
        }
        Ok(handle) => {
            // Fresh create. Adopt through the canonical primitive: from now on the authority is
            // released solely by this handle closing (drop or process death).
            // SAFETY: `handle` is a valid, exclusively-owned handle from a successful CreateMutexExW
            // with no other owner; `handles::adopt` transfers it exactly once into the OwnedHandle whose
            // drop performs the single CloseHandle.
            match unsafe { handles::adopt(handle) } {
                Some(owned) => WindowsTokenAcquisition::Acquired(AuthorityGuard::from_owned(owned)),
                // adopt rejects only null/INVALID_HANDLE_VALUE; a successful create never yields those,
                // so this is an unreachable fail-closed guard rather than a real path.
                None => WindowsTokenAcquisition::Refused(AuthorityRefusal::AuthorityUnavailable),
            }
        }
        Err(_) => WindowsTokenAcquisition::Refused(classify_failure(last)),
    }
}

/// Classify a native creation failure. `ACCESS_DENIED` is NOT reported as "already running": the
/// object may have been pre-created with a restrictive DACL, so it fails closed distinctly. No other
/// process is opened, inspected or killed.
fn classify_failure(last: WIN32_ERROR) -> AuthorityRefusal {
    match last {
        ERROR_ACCESS_DENIED => AuthorityRefusal::AccessDenied,
        // The name exists as a DIFFERENT kernel-object type (event, semaphore, …).
        ERROR_INVALID_HANDLE => AuthorityRefusal::ScopeCollision,
        _ => AuthorityRefusal::AuthorityUnavailable,
    }
}

/// Read-only reopen probe: attempt to OPEN an existing object with `desired_access`.
///
/// Used by the OWNER_RIGHTS suppression proof — requesting `WRITE_DAC` must be refused
/// (`AccessDenied`) while requesting the detection rights succeeds. The returned handle is owned for
/// RAII and closed on drop; nothing is modified.
pub fn try_open(name: &str, desired_access: u32) -> Result<OwnedHandle, AuthorityRefusal> {
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated wide string alive for the call; `OpenMutexW` opens (never
    // creates) the named object with exactly `desired_access`. Any returned handle is adopted below.
    let result = unsafe {
        OpenMutexW(
            SYNCHRONIZATION_ACCESS_RIGHTS(desired_access),
            false,
            PCWSTR(wide.as_ptr()),
        )
    };
    match result {
        Ok(handle) => {
            // SAFETY: `handle` is a valid, exclusively-owned handle from a successful OpenMutexW with
            // no other owner; `handles::adopt` transfers it once into the OwnedHandle whose drop closes
            // it once.
            match unsafe { handles::adopt(handle) } {
                Some(owned) => Ok(owned),
                None => Err(AuthorityRefusal::AuthorityUnavailable),
            }
        }
        Err(e) => {
            let code = WIN32_ERROR(e.code().0 as u32 & 0xFFFF);
            Err(classify_failure(code))
        }
    }
}

/// Borrow a guard's handle as a non-owning raw `HANDLE` for a bounded in-crate read-only call (DACL
/// inspection), through the canonical `handles::win32`. The borrow is tied to `guard`, so the handle
/// cannot outlive it, and it confers no ownership.
#[must_use]
pub fn guard_handle(guard: &AuthorityGuard) -> HANDLE {
    handles::win32(guard.owned())
}

/// TEST-ONLY: create a colliding EVENT object of the same name, to prove wrong-object-type detection.
/// A later mutex create-or-open of that name then fails with `ERROR_INVALID_HANDLE` → `ScopeCollision`.
/// The returned handle is adopted through the canonical primitive and closed on drop.
#[cfg(feature = "test-fixtures")]
pub fn create_colliding_event(name: &str) -> Option<OwnedHandle> {
    use windows::Win32::System::Threading::CreateEventW;
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated wide string alive for the call; a returned handle is a valid,
    // exclusively-owned handle transferred once through `handles::adopt` whose drop closes it once.
    let result = unsafe { CreateEventW(None, false, false, PCWSTR(wide.as_ptr())) };
    match result {
        Ok(handle) => unsafe { handles::adopt(handle) },
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key::test_object_name;
    use crate::security::MachineWideAuthoritySecurity;

    fn security() -> MachineWideAuthoritySecurity {
        MachineWideAuthoritySecurity::build_v1(None).expect("descriptor builds")
    }

    fn unique(tag: &str) -> String {
        test_object_name(std::process::id(), tag)
    }

    #[test]
    fn first_acquire_is_acquired_second_same_process_is_existing() {
        let sec = security();
        let name = unique("first-second");
        let first = acquire_existence_token(&name, &sec);
        assert!(matches!(first, WindowsTokenAcquisition::Acquired(_)));
        let second = acquire_existence_token(&name, &sec);
        assert!(matches!(second, WindowsTokenAcquisition::Existing));
        assert_eq!(second.outcome(), AuthorityTokenOutcome::ExistingToken);
    }

    #[test]
    fn dropping_the_guard_releases_and_permits_reacquisition() {
        let sec = security();
        let name = unique("drop-reacquire");
        let first = acquire_existence_token(&name, &sec);
        assert!(matches!(first, WindowsTokenAcquisition::Acquired(_)));
        drop(first);
        let again = acquire_existence_token(&name, &sec);
        assert!(
            matches!(again, WindowsTokenAcquisition::Acquired(_)),
            "handle-close release must permit reacquisition"
        );
    }

    #[test]
    fn an_existing_token_is_never_confirmed_authority() {
        let sec = security();
        let name = unique("no-trust");
        let _held = acquire_existence_token(&name, &sec);
        let existing = acquire_existence_token(&name, &sec);
        assert_eq!(existing.outcome(), AuthorityTokenOutcome::ExistingToken);
        assert!(!existing.outcome().is_confirmed_authority());
    }

    #[test]
    fn classify_failure_maps_known_errors() {
        assert_eq!(
            classify_failure(ERROR_ACCESS_DENIED),
            AuthorityRefusal::AccessDenied
        );
        assert_eq!(
            classify_failure(ERROR_INVALID_HANDLE),
            AuthorityRefusal::ScopeCollision
        );
        assert_eq!(
            classify_failure(WIN32_ERROR(1234)),
            AuthorityRefusal::AuthorityUnavailable
        );
    }
}
