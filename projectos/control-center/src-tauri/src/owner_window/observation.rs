//! The Control Centre window-observation producer.
//!
//! It resolves the ONE designated owner window labelled `"main"`, marshals native-handle capture onto the
//! Tauri main thread, waits on a bounded channel on the trusted caller thread, applies early fail-closed
//! window/process checks, and produces an UNTRUSTED
//! [`UntrustedControlCentreWindowObservation`](projectos_host_windows_owner_verification::UntrustedControlCentreWindowObservation).
//! It mints NO trusted binding — only the adapter's sealed `ControlCentreWindowVerifier` (a later
//! composition phase) may do that, re-checking every fact. The producer is `pub(crate)` and is never a
//! Tauri command, so the renderer cannot invoke it or supply any window fact.

// The producer surface (capture + context + pure selection rule) is intentionally UNTRIGGERED in this
// phase — there is no owner-decision command yet and the runtime composition that consumes it is a later
// phase. It is exercised by this crate's tests and reserved for that composition; allow dead_code so the
// untriggered-but-complete surface does not warn in the default build.
#![allow(dead_code)]

use std::sync::mpsc::sync_channel;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};

use projectos_host_windows_owner_verification::{
    OwnerWindowObservationInput, UntrustedControlCentreWindowObservation,
    UntrustedOwnerWindowHandle, DESIGNATED_WINDOW_LABEL,
};

use super::lifecycle::OwnerWindowLifecycleState;

/// Bounded wait for the main-thread native-handle capture. A timeout yields no observation.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);

/// Fail-closed reasons the producer can report. None grants authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationError {
    /// The host is shutting down.
    ShuttingDown,
    /// The designated `"main"` window is not present.
    MissingWindow,
    /// A second owner-capable window is present (ambiguity).
    SecondOwnerWindow,
    /// The main-thread dispatch failed.
    MainThreadDispatch,
    /// The bounded capture wait timed out or the channel closed.
    Timeout,
    /// The native handle was null / `IsWindow` failed.
    InvalidWindow,
    /// `GetWindowThreadProcessId` returned no owning thread/process.
    NoWindowOwner,
    /// The window is not owned by the trusted host process.
    WrongProcess,
    /// The lifecycle epoch changed during capture (close/destroy/recreate).
    LifecycleChanged,
}

/// The trust-context digests + session facts a trusted caller supplies alongside the live window facts.
/// Their authoritative sourcing (runtime instance, IPC session, project/repo/env/phase) is the later
/// composition phase; the producer copies them verbatim into the UNTRUSTED observation, where the sealed
/// verifier will re-check them.
#[derive(Debug, Clone, Copy)]
pub struct OwnerWindowContext {
    pub session: u32,
    pub client_protocol_type: u32,
    pub active_console_session: u32,
    pub runtime_instance_digest: [u8; 32],
    pub ipc_session_digest: [u8; 32],
    pub project_digest: [u8; 32],
    pub repository_digest: [u8; 32],
    pub environment_digest: [u8; 32],
    pub phase_digest: [u8; 32],
}

/// PURE designated-window policy over the current set of window labels: exactly the single `"main"`
/// window. Missing → `MissingWindow`; any additional window → `SecondOwnerWindow`.
pub fn resolve_designated_label(labels: &[String]) -> Result<(), ObservationError> {
    if !labels.iter().any(|l| l == DESIGNATED_WINDOW_LABEL) {
        return Err(ObservationError::MissingWindow);
    }
    if labels.len() != 1 {
        return Err(ObservationError::SecondOwnerWindow);
    }
    Ok(())
}

/// The native facts captured on the Tauri main thread. Carries only a raw handle value (`isize`) and
/// bounded booleans/ids — never a `WebviewWindow` or a live handle object.
struct MainThreadCapture {
    handle_raw: isize,
    is_window: bool,
    is_visible: bool,
    is_minimized: bool,
    is_focused: bool,
    thread_id: u32,
    process_id: u32,
}

/// Read the native window facts. Runs on the Tauri main thread.
fn capture_on_main_thread(window: &WebviewWindow) -> Result<MainThreadCapture, ObservationError> {
    let hwnd: HWND = window.hwnd().map_err(|_| ObservationError::InvalidWindow)?;
    if hwnd.0.is_null() {
        return Err(ObservationError::InvalidWindow);
    }
    // SAFETY: `hwnd` was just returned by Tauri for this live window; `IsWindow` only reads it.
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err(ObservationError::InvalidWindow);
    }
    let is_visible = window
        .is_visible()
        .map_err(|_| ObservationError::InvalidWindow)?;
    let is_minimized = window
        .is_minimized()
        .map_err(|_| ObservationError::InvalidWindow)?;
    let is_focused = window.is_focused().unwrap_or(false);
    let mut pid = 0u32;
    // SAFETY: `hwnd` is a live window handle; `pid` is a valid out-parameter. Returns the owning thread.
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if thread_id == 0 || pid == 0 {
        return Err(ObservationError::NoWindowOwner);
    }
    Ok(MainThreadCapture {
        handle_raw: hwnd.0 as isize,
        is_window: true,
        is_visible,
        is_minimized,
        is_focused,
        thread_id,
        process_id: pid,
    })
}

/// Seconds since the Unix epoch (observation time; evidence only).
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Produce an UNTRUSTED observation of the designated Control Centre window. `pub(crate)`; never a Tauri
/// command. Fails closed at every step and mints nothing.
pub(crate) fn capture_owner_window_observation(
    app: &AppHandle,
    lifecycle: &OwnerWindowLifecycleState,
    ctx: OwnerWindowContext,
) -> Result<UntrustedControlCentreWindowObservation, ObservationError> {
    if lifecycle.is_shutting_down() {
        return Err(ObservationError::ShuttingDown);
    }
    let windows = app.webview_windows();
    let labels: Vec<String> = windows.keys().cloned().collect();
    resolve_designated_label(&labels)?;
    let window = windows
        .get(DESIGNATED_WINDOW_LABEL)
        .ok_or(ObservationError::MissingWindow)?
        .clone();

    let epoch_before = lifecycle.current_epoch();
    let capture_generation = lifecycle.next_capture_generation();

    // Bounded main-thread capture: dispatch to the Tauri main thread, wait on the caller thread only.
    let (tx, rx) = sync_channel::<Result<MainThreadCapture, ObservationError>>(1);
    let capture_window = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(capture_on_main_thread(&capture_window));
        })
        .map_err(|_| ObservationError::MainThreadDispatch)?;
    let capture = match rx.recv_timeout(CAPTURE_TIMEOUT) {
        Ok(result) => result?,
        Err(_) => return Err(ObservationError::Timeout),
    };

    // Post-capture currentness: a close/destroy/recreate or shutdown during capture fails closed.
    if lifecycle.is_shutting_down() {
        return Err(ObservationError::ShuttingDown);
    }
    if lifecycle.current_epoch() != epoch_before {
        return Err(ObservationError::LifecycleChanged);
    }
    if capture.process_id != std::process::id() {
        return Err(ObservationError::WrongProcess);
    }

    Ok(UntrustedControlCentreWindowObservation::new(
        OwnerWindowObservationInput {
            label: DESIGNATED_WINDOW_LABEL.to_string(),
            handle: UntrustedOwnerWindowHandle::from_raw(capture.handle_raw),
            is_window: capture.is_window,
            is_visible: capture.is_visible,
            is_minimized: capture.is_minimized,
            is_focused: capture.is_focused,
            eligible: capture.is_window && !capture.is_minimized,
            process_id: capture.process_id,
            thread_id: capture.thread_id,
            session: ctx.session,
            client_protocol_type: ctx.client_protocol_type,
            active_console_session: ctx.active_console_session,
            runtime_instance_digest: ctx.runtime_instance_digest,
            ipc_session_digest: ctx.ipc_session_digest,
            project_digest: ctx.project_digest,
            repository_digest: ctx.repository_digest,
            environment_digest: ctx.environment_digest,
            phase_digest: ctx.phase_digest,
            lifecycle_epoch: epoch_before,
            capture_generation,
            observed_at: now_secs(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_exactly_the_single_main_window() {
        assert!(resolve_designated_label(&labels(&["main"])).is_ok());
    }

    #[test]
    fn rejects_missing_main() {
        assert_eq!(
            resolve_designated_label(&labels(&[])).unwrap_err(),
            ObservationError::MissingWindow
        );
        assert_eq!(
            resolve_designated_label(&labels(&["other"])).unwrap_err(),
            ObservationError::MissingWindow
        );
    }

    #[test]
    fn rejects_a_second_owner_capable_window() {
        assert_eq!(
            resolve_designated_label(&labels(&["main", "utility"])).unwrap_err(),
            ObservationError::SecondOwnerWindow
        );
    }
}
