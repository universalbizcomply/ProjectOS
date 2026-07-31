//! THE LIVE WINDOWS HOST-AUTHORITY OBSERVER.
//!
//! Supplies the committed acquisition policy with trusted context obtained INTERNALLY:
//!
//! ```text
//! GetCurrentProcessId + ProcessIdToSessionId   -> host process + session
//! WTSGetActiveConsoleSessionId                 -> active console session
//! WTSQuerySessionInformationW(ClientProtocol)  -> local console vs remote
//! GetProcessWindowStation + GetUserObjectInformationW(UOI_FLAGS) -> interactive station
//! canonical_record::production_canonical_identity()             -> installation identity
//!   -> HostAuthorityObservation -> local_console_authority_permits(..)
//! ```
//!
//! **No caller may supply any of these facts.** Every value is read here; the observation type is
//! crate-private and is never accepted as a parameter.
//!
//! **Facts only.** This module acquires NO machine-wide token, constructs NO `ConfirmedAuthorityGuard`,
//! creates no provider capability or owner-presence grant, and performs no protected effect. It is
//! compiled only under `windows-host-authority-observer` and has NO caller in this phase — compiling it
//! is not authority to run it.
//!
//! **Every Windows failure refuses.** A failed session query, an unavailable protocol, an unreadable
//! station or an unverifiable identity all produce a refusal, never a permissive default.

#![cfg(all(windows, feature = "windows-host-authority-observer"))]

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSClientProtocolType, WTSFreeMemory, WTSGetActiveConsoleSessionId,
    WTSQuerySessionInformationW, WTS_CURRENT_SERVER_HANDLE,
};
use windows::Win32::System::StationsAndDesktops::{
    GetProcessWindowStation, GetUserObjectInformationW, UOI_FLAGS, USEROBJECTFLAGS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;

use crate::acquisition::{
    local_console_authority_permits, HostAuthorityAcquisitionRefusal, HostAuthorityObservation,
    LOCAL_CONSOLE_PROTOCOL,
};
use crate::model::{AuthorityPeerState, AuthorityTokenOutcome, ConfirmedPeer};

/// `WSF_VISIBLE` — the window station is visible/interactive.
const WSF_VISIBLE: u32 = 0x0001;

/// Why the live observation could not be completed. Distinct from a POLICY refusal: this means a fact
/// could not be obtained at all, which is itself fail-closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ObserverError {
    /// `ProcessIdToSessionId` failed.
    SessionQueryFailed,
    /// The WTS client-protocol query failed or returned too few bytes.
    ProtocolQueryFailed,
    /// The window station could not be read.
    StationQueryFailed,
    /// The canonical installation identity could not be verified (includes the expected
    /// `ProtectedEvidenceUnavailable` until an installer writes the record).
    IdentityUnavailable,
}

/// The session id of a process, or `None` on failure.
fn process_session_id(pid: u32) -> Option<u32> {
    let mut session = 0u32;
    // SAFETY: `session` is a valid, aligned local `u32` out-parameter that outlives the call.
    let ok = unsafe { ProcessIdToSessionId(pid, &mut session) };
    ok.is_ok().then_some(session)
}

/// The `WTSClientProtocolType` for a session (0 = local console), or `None` on failure.
fn session_protocol_type(session: u32) -> Option<u32> {
    let mut buffer = windows::core::PWSTR::null();
    let mut bytes = 0u32;
    // SAFETY: the out-pointers are valid, aligned locals; the buffer they receive is owned by WTS and is
    // freed below with `WTSFreeMemory`. `WTS_CURRENT_SERVER_HANDLE` is the documented local-server handle.
    let ok = unsafe {
        WTSQuerySessionInformationW(
            Some(WTS_CURRENT_SERVER_HANDLE),
            session,
            WTSClientProtocolType,
            &mut buffer,
            &mut bytes,
        )
    };
    if ok.is_err() || buffer.is_null() || (bytes as usize) < core::mem::size_of::<u16>() {
        if !buffer.is_null() {
            // SAFETY: `buffer` was allocated by the (possibly partial) WTS call and is freed once.
            unsafe { WTSFreeMemory(buffer.as_ptr() as *mut core::ffi::c_void) };
        }
        return None;
    }
    // SAFETY: WTS returned at least a `u16`; we read exactly that and never retain the pointer past
    // the free below.
    let protocol = unsafe { core::ptr::read_unaligned(buffer.as_ptr() as *const u16) };
    // SAFETY: allocated by WTS, freed exactly once here.
    unsafe { WTSFreeMemory(buffer.as_ptr() as *mut core::ffi::c_void) };
    Some(u32::from(protocol))
}

/// Whether this process runs on a VISIBLE (interactive) window station. `None` on query failure.
fn is_interactive_station() -> Option<bool> {
    // SAFETY: returns a non-owning pseudo-handle to the calling process's window station; not closed.
    let station = unsafe { GetProcessWindowStation() }.ok()?;
    let mut flags = USEROBJECTFLAGS::default();
    let mut needed = 0u32;
    // SAFETY: `flags` is a valid, aligned local of exactly the size passed; `needed` is a valid
    // out-parameter. The call only writes into them.
    let ok = unsafe {
        GetUserObjectInformationW(
            HANDLE(station.0),
            UOI_FLAGS,
            Some(&mut flags as *mut _ as *mut core::ffi::c_void),
            core::mem::size_of::<USEROBJECTFLAGS>() as u32,
            Some(&mut needed),
        )
    };
    ok.ok()?;
    Some(flags.dwFlags & WSF_VISIBLE != 0)
}

/// Whether the running installation matches the canonical record.
///
/// Uses ONLY the closed canonical installation identity contract. Until an installer writes the approved
/// record this is `Err`, which refuses — the expected fail-closed reality, never a permissive default.
fn identity_matches() -> Result<bool, ObserverError> {
    match projectos_host_identity::canonical_record::production_canonical_identity() {
        Ok(_verified) => Ok(true),
        Err(_) => Err(ObserverError::IdentityUnavailable),
    }
}

/// Observe the live host context. Every fact is read here; nothing is accepted from a caller.
///
/// # Errors
/// [`ObserverError`] naming the first fact that could not be obtained.
pub(crate) fn observe_host_context(
    token_outcome: AuthorityTokenOutcome,
    confirmed_peer: Option<ConfirmedPeer>,
) -> Result<HostAuthorityObservation, ObserverError> {
    // SAFETY: no parameters, no memory touched; returns the current process id.
    let pid = unsafe { GetCurrentProcessId() };
    let process_session = process_session_id(pid).ok_or(ObserverError::SessionQueryFailed)?;
    // SAFETY: no parameters; returns the active console session id.
    let active_console_session = unsafe { WTSGetActiveConsoleSessionId() };
    let client_protocol_type =
        session_protocol_type(process_session).ok_or(ObserverError::ProtocolQueryFailed)?;
    let interactive = is_interactive_station().ok_or(ObserverError::StationQueryFailed)?;
    let identity = identity_matches()?;

    Ok(HostAuthorityObservation {
        interactive,
        client_protocol_type,
        process_session,
        active_console_session,
        identity_matches: identity,
        token_outcome,
        confirmed_peer,
    })
}

/// Observe the live context and run the committed acquisition policy over it.
///
/// Returns ONLY the corroborated peer state. It deliberately does NOT construct a
/// `ConfirmedAuthorityGuard` and does not acquire the machine-wide token: this is the fact-producing
/// half, and confirmation remains a separate, later gate.
///
/// No caller exists in this phase.
///
/// # Errors
/// `Err(Ok(refusal))` when the policy refused; `Err(Err(observer))` when a fact could not be obtained.
#[allow(clippy::result_large_err, dead_code)]
pub(crate) fn observe_and_decide(
    token_outcome: AuthorityTokenOutcome,
    confirmed_peer: Option<ConfirmedPeer>,
) -> Result<AuthorityPeerState, Result<HostAuthorityAcquisitionRefusal, ObserverError>> {
    let obs = observe_host_context(token_outcome, confirmed_peer).map_err(Err)?;
    local_console_authority_permits(&obs).map_err(Ok)
}

/// The local-console protocol value this observer treats as non-remote, re-exported for the validator's
/// benefit so the constant cannot drift from the policy's.
#[allow(dead_code)] // Exercised by the drift test below; the observer itself has no caller yet.
pub(crate) const OBSERVER_LOCAL_CONSOLE_PROTOCOL: u32 = LOCAL_CONSOLE_PROTOCOL;

#[cfg(test)]
mod tests {
    use super::*;

    /// PROOF 6: the canonical identity route refuses today, because no installer has written the
    /// approved record. This is the expected fail-closed production reality — the observer must NEVER
    /// substitute a permissive default for it.
    #[test]
    fn the_identity_route_refuses_until_an_installer_writes_the_record() {
        assert_eq!(identity_matches(), Err(ObserverError::IdentityUnavailable));
    }

    /// PROOF 7: a failed Windows observation is a refusal, never a success. Since identity is the last
    /// fact gathered and it currently refuses, the whole observation refuses regardless of session
    /// state — so no live context can yield a permissive observation in this phase.
    #[test]
    fn a_failed_observation_refuses_and_never_yields_facts() {
        let outcome = observe_host_context(
            AuthorityTokenOutcome::AcquiredToken,
            Some(ConfirmedPeer::InteractiveFallback),
        );
        assert!(
            outcome.is_err(),
            "no live observation may succeed in this phase"
        );
    }

    /// The observer's local-console constant cannot drift from the policy's.
    #[test]
    fn the_local_console_constant_matches_the_policy() {
        assert_eq!(OBSERVER_LOCAL_CONSOLE_PROTOCOL, LOCAL_CONSOLE_PROTOCOL);
        assert_eq!(OBSERVER_LOCAL_CONSOLE_PROTOCOL, 0);
    }
}
