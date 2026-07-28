//! The ONLY unsafe module in this crate: read-only Windows monotonic time + process creation time.
//! Gated `all(windows, feature = "windows-live-clock")`. No handle escapes, no pointer escapes, no
//! process/service/registry/ACL mutation, no network. Every `unsafe` block carries a `// SAFETY:` note.

#![cfg(all(windows, feature = "windows-live-clock"))]

use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

/// The current BIASED monotonic tick count in milliseconds since boot. `GetTickCount64` counts elapsed
/// real time INCLUDING suspend/sleep, is monotonic, cannot regress within a boot, resets at boot, and is
/// immune to administrative system-time (wall-clock) adjustment — the required security-currentness property.
/// `u64` milliseconds cannot overflow in any realistic uptime.
pub(crate) fn biased_monotonic_ticks() -> u64 {
    // SAFETY: `GetTickCount64` takes no arguments, reads no caller memory, returns a plain `u64`, and has
    // no failure mode or out-parameter. There is nothing to invalidate and nothing to free.
    unsafe { GetTickCount64() }
}

/// The current host process creation time folded into one `u64` (FILETIME high/low), used ONLY as the
/// per-start lineage seed for the opaque provider epoch. A restart yields a new process with a new
/// creation time → a different seed → a different epoch. Returns `None` if the OS read fails.
pub(crate) fn process_creation_seed() -> Option<u64> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle that need not be closed. The four `FILETIME`
    // out-pointers are all valid, aligned, initialised locals that outlive the call; `GetProcessTimes`
    // only writes through them and retains no reference. We read `creation` only after a success return.
    let ok = unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    ok.ok()?;
    let seed = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    if seed == 0 {
        return None;
    }
    Some(seed)
}
