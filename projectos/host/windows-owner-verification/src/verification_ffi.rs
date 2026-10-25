//! The ONLY unsafe module in this crate: the LIVE Windows owner-verification FFI.
//!
//! It is compiled only under `all(windows, feature = "windows-live-owner-verification")`, is never invoked
//! by any test, and exposes NO public entrypoint — [`live_verify`] is `pub(crate)` and has no caller in
//! this phase (the window bridge and runtime composition are separate, later phases). Compiling this
//! module is therefore NOT authority to run a verification.
//!
//! Threading (§4 Model A): the real ceremony runs on a dedicated MTA worker
//! (`RoInitialize(RO_INIT_MULTITHREADED)`) and completes with the blocking `IAsyncOperation::get()`
//! (message-pump-free); the caller's UI/event loop is never blocked and the MTA has no dispatcher to
//! starve. This function is the body such a worker would run.
//!
//! No raw HWND, SID, nonce, token handle or Win32 error leaves this module: it returns only the opaque
//! [`VerifiedWindowsOwnerEvidence`] or a typed [`OwnerVerificationError`]. Every `unsafe` block carries a
//! `// SAFETY:` note.

#![cfg(all(windows, feature = "windows-live-owner-verification"))]
#![allow(unsafe_code)]

use core::ffi::c_void;

use windows::core::HSTRING;
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
use windows::Win32::Security::{
    EqualSid, GetTokenInformation, IsValidSid, TokenUser, PSID, TOKEN_QUERY, TOKEN_USER,
};
use windows::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTSClientProtocolType, WTSFreeMemory, WTSGetActiveConsoleSessionId,
    WTSQuerySessionInformationW, WTS_CURRENT_SERVER_HANDLE,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::System::WinRT::{
    IUserConsentVerifierInterop, RoInitialize, RO_INIT_MULTITHREADED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, GWL_EXSTYLE,
    WS_EX_TOOLWINDOW,
};
use windows_future::IAsyncOperation;

use crate::nonce::NONCE_LEN;
use crate::session::{IdentityTuple, SessionObservation, WTS_PROTOCOL_CONSOLE};
use crate::sid::OwnerSidObservation;
use crate::window::{ControlCentreWindowVerifier, WindowObservation};
use crate::{
    nonce_from_rng_bytes, run_inert_verification, ConsentAvailability, ConsentResult,
    InertVerificationInput, MtaWorkerRequest, OwnerVerificationError, VerifiedWindowsOwnerEvidence,
};

/// Map the WinRT availability enum to the crate's typed availability. Any unrecognised value becomes
/// `Unknown` so it fails closed.
fn map_availability(a: UserConsentVerifierAvailability) -> ConsentAvailability {
    match a {
        UserConsentVerifierAvailability::Available => ConsentAvailability::Available,
        UserConsentVerifierAvailability::DeviceNotPresent => ConsentAvailability::DeviceNotPresent,
        UserConsentVerifierAvailability::NotConfiguredForUser => {
            ConsentAvailability::NotConfiguredForUser
        }
        UserConsentVerifierAvailability::DisabledByPolicy => ConsentAvailability::DisabledByPolicy,
        UserConsentVerifierAvailability::DeviceBusy => ConsentAvailability::DeviceBusy,
        other => ConsentAvailability::Unknown(other.0 as u32),
    }
}

/// Map the WinRT verification result to the crate's typed result. Any unrecognised value becomes
/// `Unknown` so it fails closed.
fn map_result(r: UserConsentVerificationResult) -> ConsentResult {
    match r {
        UserConsentVerificationResult::Verified => ConsentResult::Verified,
        UserConsentVerificationResult::DeviceNotPresent => ConsentResult::DeviceNotPresent,
        UserConsentVerificationResult::NotConfiguredForUser => ConsentResult::NotConfiguredForUser,
        UserConsentVerificationResult::DisabledByPolicy => ConsentResult::DisabledByPolicy,
        UserConsentVerificationResult::DeviceBusy => ConsentResult::DeviceBusy,
        UserConsentVerificationResult::RetriesExhausted => ConsentResult::RetriesExhausted,
        UserConsentVerificationResult::Canceled => ConsentResult::Canceled,
        other => ConsentResult::Unknown(other.0 as u32),
    }
}

/// Read 32 CSPRNG bytes directly into an owned buffer via `BCryptGenRandom` with the system-preferred RNG.
fn generate_nonce_bytes() -> Option<[u8; NONCE_LEN]> {
    let mut buf = [0u8; NONCE_LEN];
    // SAFETY: `buf` is a valid, aligned, fully-owned 32-byte buffer that outlives the call; passing the
    // system-preferred-RNG flag means no algorithm handle is required. `BCryptGenRandom` writes only into
    // `buf` and returns an `NTSTATUS`.
    let status = unsafe { BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status.is_ok() {
        Some(buf)
    } else {
        None
    }
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
    let mut ppbuffer = windows::core::PWSTR::null();
    let mut bytes = 0u32;
    // SAFETY: the out-pointers are valid, aligned locals; the buffer they receive is owned by WTS and is
    // freed below with `WTSFreeMemory`. `WTS_CURRENT_SERVER_HANDLE` is the documented local-server handle.
    let ok = unsafe {
        WTSQuerySessionInformationW(
            Some(WTS_CURRENT_SERVER_HANDLE),
            session,
            WTSClientProtocolType,
            &mut ppbuffer,
            &mut bytes,
        )
    };
    if ok.is_err() || ppbuffer.is_null() || (bytes as usize) < core::mem::size_of::<u16>() {
        if !ppbuffer.is_null() {
            // SAFETY: `ppbuffer` was allocated by the successful/partial WTS call and must be freed once.
            unsafe { WTSFreeMemory(ppbuffer.as_ptr() as *mut c_void) };
        }
        return None;
    }
    // SAFETY: WTS returned at least a `u16` in `ppbuffer`; we read exactly that `u16` and never retain the
    // pointer past the free below.
    let protocol = unsafe { core::ptr::read_unaligned(ppbuffer.as_ptr() as *const u16) };
    // SAFETY: `ppbuffer` was allocated by WTS and is freed exactly once here.
    unsafe { WTSFreeMemory(ppbuffer.as_ptr() as *mut c_void) };
    Some(u32::from(protocol))
}

/// Observe the candidate window fail-closed into a typed [`WindowObservation`]. `identifies_designated_cc`
/// is provisionally `true` here; the authoritative Control-Centre designation is supplied by the future
/// window-bridge phase and is deliberately not established in this inert adapter.
fn observe_window(hwnd: HWND) -> WindowObservation {
    // SAFETY: `hwnd` is passed by value; these query-only calls read no caller memory and manage no handle.
    let is_window = unsafe { IsWindow(Some(hwnd)) }.as_bool();
    let is_visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
    // SAFETY: query-only read of the window's extended style.
    let exstyle = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let eligible = (exstyle & (WS_EX_TOOLWINDOW.0 as isize)) == 0;
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid, aligned local out-parameter; the function also returns the owning thread.
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    WindowObservation {
        is_window,
        is_visible,
        eligible,
        identifies_designated_cc: true,
        thread_id,
        process_id: pid,
    }
}

/// Compare the CURRENT process's token SID against the configured owner SID, fail-closed into booleans. No
/// raw SID bytes leave this function.
fn observe_owner_sid(configured_owner_sid: PSID) -> OwnerSidObservation {
    let mut token = HANDLE::default();
    // SAFETY: `GetCurrentProcess` is a pseudo-handle valid for the current process; `token` is a valid
    // out-parameter. The window policy requires the window be owned by THIS process, so its token is ours.
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) };
    if opened.is_err() {
        return OwnerSidObservation {
            token_query_ok: false,
            sid_valid: false,
            equals_configured_owner: false,
        };
    }
    let mut needed = 0u32;
    // SAFETY: first call intentionally undersized to learn the required length; writes only `needed`.
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut needed) };
    let mut buf = vec![0u8; needed as usize];
    // SAFETY: `buf` is sized to `needed`; the call writes at most `needed` bytes into it and updates
    // `needed`. `token` is a valid query token.
    let got = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buf.as_mut_ptr() as *mut c_void),
            needed,
            &mut needed,
        )
    };
    let observation = if got.is_ok() && buf.len() >= core::mem::size_of::<TOKEN_USER>() {
        // SAFETY: `buf` holds a `TOKEN_USER` written by the OS; we read its `User.Sid` pointer, which is
        // valid for the lifetime of `buf`.
        let sid = unsafe { (*(buf.as_ptr() as *const TOKEN_USER)).User.Sid };
        // SAFETY: `sid` points into `buf` (still alive); `configured_owner_sid` is supplied by the caller.
        let sid_valid = unsafe { IsValidSid(sid) }.as_bool();
        let equals = unsafe { EqualSid(sid, configured_owner_sid) }.is_ok();
        OwnerSidObservation {
            token_query_ok: true,
            sid_valid,
            equals_configured_owner: equals,
        }
    } else {
        OwnerSidObservation {
            token_query_ok: false,
            sid_valid: false,
            equals_configured_owner: false,
        }
    };
    // SAFETY: `token` is a valid handle opened above and closed exactly once here.
    let _ = unsafe { CloseHandle(token) };
    observation
}

/// The body a dedicated MTA worker runs to perform one live owner verification. `pub(crate)`, with NO
/// caller in this phase; never invoked by tests. Returns only opaque evidence or a typed error.
///
/// `verifier` is an EXISTING sealed [`ControlCentreWindowVerifier`] supplied by the caller — this module
/// never constructs one and never mints a binding itself.
#[allow(clippy::too_many_arguments)]
pub(crate) fn live_verify(
    verifier: &ControlCentreWindowVerifier,
    hwnd: HWND,
    message: &HSTRING,
    configured_owner_sid: PSID,
    proof_id: &[u8],
    verifier_identity: &[u8],
    operation_digest: [u8; 32],
    display_summary_digest: [u8; 32],
    runtime_instance_digest: [u8; 32],
    ipc_session_digest: [u8; 32],
    provider_id: &[u8],
    provider_epoch: u64,
    observed_at: u64,
    valid_until: u64,
    generation: u64,
    trusted_window_binding_digest: [u8; 32],
    trusted_session_digest: [u8; 32],
    now: u64,
) -> Result<VerifiedWindowsOwnerEvidence, OwnerVerificationError> {
    // MTA apartment for this worker; a benign already-initialised result is not fatal.
    // SAFETY: `RoInitialize` takes an init-type by value and initialises the calling thread's apartment.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };

    // Availability (blocking get on the MTA worker).
    let availability_op: IAsyncOperation<UserConsentVerifierAvailability> =
        UserConsentVerifier::CheckAvailabilityAsync()
            .map_err(|_| OwnerVerificationError::UnsupportedApi)?;
    let availability = availability_op
        .get()
        .map(map_availability)
        .map_err(|_| OwnerVerificationError::UnsupportedApi)?;

    // The consent ceremony, parented to the trusted window; completion via blocking get().
    let interop: IUserConsentVerifierInterop =
        windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
            .map_err(|_| OwnerVerificationError::MissingInterop)?;
    let worker = MtaWorkerRequest::new(generation);
    // SAFETY: `hwnd` and `message` are valid for the call; the returned async op is owned locally.
    let op: IAsyncOperation<UserConsentVerificationResult> =
        unsafe { interop.RequestVerificationForWindowAsync(hwnd, message) }
            .map_err(|_| OwnerVerificationError::UnsupportedApi)?;
    match op.get() {
        Ok(r) => {
            worker.complete(generation, map_result(r));
        }
        Err(_) => {
            worker.invalidate(crate::WorkerInvalidation::Cancelled);
        }
    }

    // Window / process observation + pre-tuple.
    let window = observe_window(hwnd);
    let host_session = process_session_id(std::process::id()).unwrap_or(u32::MAX);
    let window_session = process_session_id(window.process_id).unwrap_or(u32::MAX);
    let protocol = session_protocol_type(window_session);
    // SAFETY: no unsafe — pure syscall wrapper.
    let active_console = unsafe { WTSGetActiveConsoleSessionId() };
    let pre = IdentityTuple {
        process_id: window.process_id,
        thread_id: window.thread_id,
        session: window_session,
    };

    // The bare binding mint is module-private, so this module cannot mint. It does not construct a verifier
    // either: the sealed verifier is SUPPLIED by the caller, and only that verifier reaches the mint. One
    // minting authority, and this module is not it.
    let binding = verifier.mint_from_window_observation(window, trusted_window_binding_digest);
    let session = SessionObservation {
        session_query_ok: protocol.is_some(),
        window_session,
        host_session,
        client_protocol_type: protocol.unwrap_or(u32::MAX ^ WTS_PROTOCOL_CONSOLE),
        active_console_session: active_console,
    };
    let sid = observe_owner_sid(configured_owner_sid);

    // CSPRNG nonce.
    let nonce =
        nonce_from_rng_bytes(generate_nonce_bytes().ok_or(OwnerVerificationError::RngFailure)?)?;

    // Post-tuple recheck.
    let post_window = observe_window(hwnd);
    let post_session = process_session_id(post_window.process_id).unwrap_or(u32::MAX);
    let post = IdentityTuple {
        process_id: post_window.process_id,
        thread_id: post_window.thread_id,
        session: post_session,
    };

    run_inert_verification(InertVerificationInput {
        binding: &binding,
        trusted_host_pid: std::process::id(),
        availability,
        worker: &worker,
        session,
        sid,
        pre,
        post,
        nonce,
        proof_id,
        verifier_identity,
        operation_digest,
        display_summary_digest,
        runtime_instance_digest,
        ipc_session_digest,
        provider_id,
        provider_epoch,
        observed_at,
        valid_until,
        generation,
        trusted_session_digest,
        now,
    })
}
