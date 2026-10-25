//! PROJECTOS-HOST-REVIEW-PATH1B — GENUINE SELF service-runtime corroboration.
//!
//! # Why this module exists
//!
//! The production acquisition facade originally took `Option<ConfirmedPeer>` from its caller. That was
//! wrong: `ConfirmedPeer::ServiceRuntime` is an ordinary public enum variant, so a production caller
//! could have obtained machine-wide Host authority by *selecting a value*. Authority must come from a
//! fact about the running process, never from an assertion a caller chose to make.
//!
//! So the corroboration is DERIVED here, inside the crate that already owns the ProjectOSHost service
//! principal, and the facade no longer accepts one.
//!
//! # The fact being established
//!
//! Windows injects the PER-SERVICE SID (`NT SERVICE\ProjectOSHost`) into the token of a process the
//! SCM started for that service. An ordinary process cannot add that SID to its own token: group
//! membership is fixed at token creation by the kernel, and adding one would require creating a new
//! token, which needs `SeCreateTokenPrivilege` — not held by ordinary or even elevated users by
//! default.
//!
//! So "the per-service SID for ProjectOSHost is present and enabled in MY token" is a genuine,
//! non-forgeable self proof that this process IS the ProjectOSHost service runtime.
//!
//! # What it deliberately does not do
//!
//! - It resolves the expected SID through the EXISTING
//!   [`crate::service_principal::resolve_projectos_host_service`] — no second service-identity
//!   vocabulary, no name-to-SID route of its own, and no caller-supplied name.
//! - It reads only its OWN token, for membership only. It opens no other process, enumerates no other
//!   token, resolves no SID to a name, and returns no SID, handle or identifier — only one bool.
//! - It does NOT consult integrity, elevation or session. An elevated non-service process is still not
//!   the service; a Medium-integrity service still is.
//! - It establishes identity ONLY. It is not authority by itself: the frozen
//!   [`crate::model::ConfirmedAuthorityGuard::confirm`] rule still requires a FRESH token acquisition
//!   as well, so a second ProjectOSHost that passes this check still cannot confirm.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows::Win32::Security::{CheckTokenMembership, PSID};

use crate::service_principal::resolve_projectos_host_service;

/// A `LocalAlloc`-backed SID, freed exactly once on drop.
///
/// `ConvertStringSidToSidW` allocates with `LocalAlloc`; the caller must `LocalFree` it. Wrapping it
/// in RAII means the free happens on every path, including early return and panic.
struct LocalSid(PSID);

impl Drop for LocalSid {
    fn drop(&mut self) {
        if !self.0 .0.is_null() {
            // SAFETY: `self.0` came from a SUCCESSFUL `ConvertStringSidToSidW`, which allocates with
            // `LocalAlloc`, and this is the single owner, so it is freed exactly once here.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0)));
            }
            self.0 = PSID::default();
        }
    }
}

/// Whether THIS process's token carries the enabled per-service SID of the ProjectOSHost service.
///
/// Fail-closed: an unresolvable service principal, a SID string the OS refuses to parse, or a failed
/// membership check all answer `false`. There is no branch that answers `true` without the kernel
/// having said the SID is present and enabled.
///
/// Returns ONE bool. No SID, token handle, process id or account name leaves this function.
pub(crate) fn running_as_projectos_host_service() -> bool {
    // The EXISTING resolution. This crate has exactly one route to the service principal and this is
    // it; nothing here accepts a service name from a caller.
    let (_resolution, principal) = resolve_projectos_host_service();
    let Some(principal) = principal else {
        return false;
    };

    let wide: Vec<u16> = principal
        .sid_string()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut raw = PSID::default();
    // SAFETY: `wide` is a NUL-terminated wide string alive for the call, and `raw` is a valid
    // out-parameter. On success the allocation is adopted into `LocalSid` on the next line, which
    // frees it exactly once.
    let converted = unsafe { ConvertStringSidToSidW(PCWSTR(wide.as_ptr()), &mut raw) };
    if converted.is_err() || raw.0.is_null() {
        return false;
    }
    let sid = LocalSid(raw);

    let mut is_member = windows::core::BOOL(0);
    // SAFETY: `sid.0` is a valid SID for the duration of this call (owned by `sid`), and `is_member`
    // is a valid out-parameter. Passing `None` for the token makes the kernel evaluate the calling
    // thread's effective token — the process token when not impersonating — which is exactly the
    // question being asked, and it honours enabled/deny-only group semantics.
    let checked = unsafe { CheckTokenMembership(None, sid.0, &mut is_member) };
    // `sid` drops here, freeing the allocation on every path below.
    checked.is_ok() && is_member.as_bool()
}
