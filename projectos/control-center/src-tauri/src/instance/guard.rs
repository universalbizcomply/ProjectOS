//! The instance object and its RAII guard (PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A).
//!
//! The mutex is an EXISTENCE TOKEN, never a lock. Ownership semantics are what create the
//! thread-affinity and abandonment hazards — a Windows mutex is owned by a THREAD, so if the owning
//! thread dies while the process lives the mutex is abandoned and another process's wait is GRANTED
//! ownership, which would let a second host start a second daemon while the first is still alive.
//!
//! This design is immune because it never takes ownership: `dwFlags = 0` (no
//! CREATE_MUTEX_INITIAL_OWNER), no `WaitForSingleObject`, no `ReleaseMutex`, no signaled-state or
//! abandoned-state logic. Object lifetime is bound to the HANDLE, and handles are PROCESS-owned, so
//! no thread can release the authority and the OS reclaims it on any form of process death.

#![cfg(windows)]

use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, SetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS,
    ERROR_INVALID_HANDLE, ERROR_SUCCESS, HANDLE,
};
use windows::Win32::System::Threading::CreateMutexExW;

use super::security::{InstanceSecurity, MUTEX_ACCESS_SYNCHRONIZE};
use super::{InstanceFailure, InstanceOutcome};

/// Holds the single authoritative instance object for this host.
///
/// Deliberately NOT `Clone`, NOT `Copy`, NOT `Serialize`: exactly one logical authority must exist,
/// and a copy would make a second one representable. Never Tauri managed state, never React- or
/// command-visible, never passed to `host.mjs`. The raw handle, object name, user hash, install
/// hash, SID and path are all unreachable from outside this module.
pub struct ProjectOsInstanceGuard {
    handle: HANDLE,
}

impl Drop for ProjectOsInstanceGuard {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            // SAFETY: `handle` came from a successful `CreateMutexExW` and has not been closed;
            // `Drop` runs exactly once and the type is not `Clone`/`Copy`, so no double close.
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }
}

/// Atomically create-or-open the instance object and classify the result.
///
/// `CreateMutexExW` is a SINGLE ATOMIC kernel create-or-open — not check-then-create — so there is
/// no TOCTOU window and two callers can never both be classified `Acquired`: exactly one creates,
/// every other receives a valid handle plus `ERROR_ALREADY_EXISTS`.
pub fn create_instance_object(name: &str, security: &InstanceSecurity) -> InstanceOutcome {
    // Build EVERY input before the adjacency block below: no allocation may occur between
    // `SetLastError` and `GetLastError`.
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let sa = security.security_attributes();

    // ---------------------------------------------------------------------------------------------
    // LAST-ERROR ADJACENCY — LOAD-BEARING. DO NOT INSERT ANYTHING INTO THIS BLOCK.
    //
    // `ERROR_ALREADY_EXISTS` is the ONLY signal that separates "we created it" from "someone else
    // already had it", and Windows only ever SETS it — it never clears it. A stale value left by an
    // unrelated earlier call would therefore be misread as a duplicate and this host would refuse to
    // start. Hence `SetLastError(ERROR_SUCCESS)` immediately before.
    //
    // Reading it immediately after is equally load-bearing: any intervening logging, formatting,
    // allocation, helper call or Windows API call could overwrite the thread's last error.
    //
    // Verified against the locked windows-0.61.3 wrapper: its SUCCESS path performs no Win32 call
    // (`then_some` is a plain Option method; `Error::from_win32` runs only via `ok_or_else` on the
    // failure path, and reading GetLastError does not modify it), so the value observed here is the
    // one CreateMutexExW set.
    //
    // SAFETY: `sa` borrows `security`, so the descriptor it points at outlives this call; `wide` is a
    // NUL-terminated wide string alive for the call; `SetLastError`/`GetLastError` only touch the
    // calling thread's error slot. Any handle returned is taken under exclusive ownership below and
    // closed exactly once.
    // ---------------------------------------------------------------------------------------------
    let (result, last) = unsafe {
        SetLastError(ERROR_SUCCESS);
        let result = CreateMutexExW(
            Some(&sa as *const _),
            PCWSTR(wide.as_ptr()),
            0, // dwFlags: no CREATE_MUTEX_INITIAL_OWNER — ownership is never taken.
            MUTEX_ACCESS_SYNCHRONIZE,
        );
        let last = GetLastError();
        (result, last)
    };

    match result {
        Ok(handle) if last == ERROR_ALREADY_EXISTS => {
            // A valid handle was still returned. Close it immediately: a refused process must retain
            // no native authority, and leaving it open would keep the object alive past our exit.
            // SAFETY: `handle` is valid, owned here, and closed exactly once.
            unsafe {
                let _ = CloseHandle(handle);
            }
            InstanceOutcome::AlreadyRunning
        }
        Ok(handle) => InstanceOutcome::Acquired(ProjectOsInstanceGuard { handle }),
        Err(_) => InstanceOutcome::Failed(classify_failure(last)),
    }
}

/// Classify a native creation failure.
///
/// ACCESS_DENIED is deliberately NOT reported as "already running": the object may have been
/// pre-created by a different account or by a hostile same-user process with a restrictive DACL.
/// Reporting that as a legitimate running instance would be a false statement about the system, so
/// it fails closed under its own distinct classification instead — and no other process is ever
/// opened, inspected or killed.
fn classify_failure(last: windows::Win32::Foundation::WIN32_ERROR) -> InstanceFailure {
    match last {
        ERROR_ACCESS_DENIED => InstanceFailure::AccessDenied,
        // The name exists as a DIFFERENT kernel-object type (event, semaphore, …).
        ERROR_INVALID_HANDLE => InstanceFailure::ScopeCollision,
        _ => InstanceFailure::AuthorityUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::security::{current_account_sid, InstanceSecurity};

    fn unique_name(tag: &str) -> String {
        // Test-only object name. Distinct from the production name so tests can never collide with a
        // real Control Centre instance on this machine.
        format!(
            "Global\\ProjectOS.Control.test.{}.{}",
            tag,
            std::process::id()
        )
    }

    fn security() -> InstanceSecurity {
        InstanceSecurity::build(&current_account_sid().unwrap()).unwrap()
    }

    #[test]
    fn first_acquisition_is_acquired_and_second_is_already_running() {
        let sec = security();
        let name = unique_name("first-second");

        let first = create_instance_object(&name, &sec);
        assert!(
            matches!(first, InstanceOutcome::Acquired(_)),
            "first must acquire"
        );

        let second = create_instance_object(&name, &sec);
        assert!(
            matches!(second, InstanceOutcome::AlreadyRunning),
            "second must be refused"
        );
    }

    /// Proves the guard's Drop actually releases the object — i.e. no stale authority after a normal
    /// release, with no file to delete and no manual cleanup.
    #[test]
    fn dropping_the_guard_permits_a_subsequent_acquisition() {
        let sec = security();
        let name = unique_name("drop-reacquire");

        let first = create_instance_object(&name, &sec);
        assert!(matches!(first, InstanceOutcome::Acquired(_)));
        drop(first);

        let again = create_instance_object(&name, &sec);
        assert!(
            matches!(again, InstanceOutcome::Acquired(_)),
            "authority must be reacquirable after release"
        );
    }

    /// Pins the fresh-versus-existing classification, which is exactly what the last-error adjacency
    /// protects: a stale ERROR_ALREADY_EXISTS would make this fail.
    #[test]
    fn a_fresh_name_is_never_misclassified_as_already_running() {
        let sec = security();
        // Deliberately dirty the thread's last error before acquiring.
        // SAFETY: `SetLastError` only writes the calling thread's error slot; no pointers involved.
        unsafe { SetLastError(ERROR_ALREADY_EXISTS) };
        let outcome = create_instance_object(&unique_name("fresh-after-dirty"), &sec);
        assert!(
            matches!(outcome, InstanceOutcome::Acquired(_)),
            "a stale last-error must not fake a duplicate"
        );
    }

    #[test]
    fn repeated_acquire_release_cycles_are_stable() {
        let sec = security();
        let name = unique_name("cycles");
        for i in 0..25 {
            let g = create_instance_object(&name, &sec);
            assert!(matches!(g, InstanceOutcome::Acquired(_)), "cycle {i}");
            drop(g);
        }
    }

    #[test]
    fn access_denied_is_classified_separately_from_already_running() {
        assert_eq!(
            classify_failure(ERROR_ACCESS_DENIED),
            InstanceFailure::AccessDenied
        );
        assert_ne!(
            classify_failure(ERROR_ACCESS_DENIED),
            InstanceFailure::AuthorityUnavailable
        );
    }

    #[test]
    fn wrong_object_type_is_classified_as_scope_collision() {
        assert_eq!(
            classify_failure(ERROR_INVALID_HANDLE),
            InstanceFailure::ScopeCollision
        );
    }

    #[test]
    fn unknown_native_failure_is_authority_unavailable() {
        assert_eq!(
            classify_failure(windows::Win32::Foundation::WIN32_ERROR(1234)),
            InstanceFailure::AuthorityUnavailable
        );
    }
}
