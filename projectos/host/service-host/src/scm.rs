//! The Windows Service Control Manager boundary.
//!
//! This is the ONLY module in the crate permitted to use `unsafe`, and it holds exactly three Windows
//! calls: register the dispatcher, register the control handler, and report status. It creates no
//! service, opens no SCM handle for management, touches no registry, ACL, ProgramData or SID, and
//! performs no protected effect. Installing this service remains the installer's job, gated elsewhere.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use windows::core::PCWSTR;
use windows::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SetServiceStatus, StartServiceCtrlDispatcherW,
    SERVICE_ACCEPT_SHUTDOWN, SERVICE_ACCEPT_STOP, SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP,
    SERVICE_RUNNING, SERVICE_START_PENDING, SERVICE_STATUS, SERVICE_STATUS_HANDLE, SERVICE_STOPPED,
    SERVICE_STOP_PENDING, SERVICE_TABLE_ENTRYW, SERVICE_WIN32_OWN_PROCESS,
};

use crate::lifecycle::{ServiceLifecycle, ServiceRunState, StatusSink};
use crate::SERVICE_NAME;

/// Why the service could not run under the SCM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScmError {
    /// `StartServiceCtrlDispatcherW` refused. The usual cause is being launched outside the SCM.
    DispatcherRefused,
    /// The control handler could not be registered, so the SCM could never reach this process.
    HandlerRegistrationFailed,
}

/// Set once the SCM hands us a status handle. `SERVICE_STATUS_HANDLE` is a plain handle value, so it
/// is stored as its numeric form rather than as a raw pointer.
static STATUS_HANDLE: OnceLock<isize> = OnceLock::new();

/// Set by the control handler; read by the inert runtime loop.
static STOP_SIGNALLED: AtomicBool = AtomicBool::new(false);

/// Set by `service_main` when the control handler could not be registered. The dispatcher itself
/// still returns success in that case, so without this flag an unreachable service would look like a
/// clean run.
static HANDLER_FAILED: AtomicBool = AtomicBool::new(false);

/// The AUTHORITATIVE status sink: it holds the SCM's status handle.
///
/// Constructible only inside [`service_main`], after the SCM has registered this process. Console mode
/// therefore cannot obtain one, and cannot report a state the SCM would believe.
pub struct ScmStatusReporter {
    handle: SERVICE_STATUS_HANDLE,
}

impl StatusSink for ScmStatusReporter {
    fn publish(&mut self, state: ServiceRunState) -> bool {
        let (current, accepted, checkpoint, wait_hint) = match state {
            // Nothing may be accepted while starting: the service is not ready to act on a control.
            ServiceRunState::StartPending => (SERVICE_START_PENDING, 0, 1, 10_000),
            // Once running, stop and shutdown are both accepted.
            ServiceRunState::Running => (
                SERVICE_RUNNING,
                SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN,
                0,
                0,
            ),
            // While stopping, no further control is accepted; a checkpoint shows progress.
            ServiceRunState::StopPending => (SERVICE_STOP_PENDING, 0, 2, 10_000),
            ServiceRunState::Stopped => (SERVICE_STOPPED, 0, 0, 0),
        };

        let status = SERVICE_STATUS {
            dwServiceType: SERVICE_WIN32_OWN_PROCESS,
            dwCurrentState: current,
            dwControlsAccepted: accepted,
            // A clean stop. No error is reported, and no service-specific code is invented.
            dwWin32ExitCode: 0,
            dwServiceSpecificExitCode: 0,
            dwCheckPoint: checkpoint,
            dwWaitHint: wait_hint,
        };

        // SAFETY: `self.handle` is the status handle the SCM returned for THIS service and is valid
        // for the process lifetime. `status` is a fully initialised owned value that outlives the
        // call. `SetServiceStatus` only reads it and returns a BOOL; it retains no reference.
        unsafe { SetServiceStatus(self.handle, &status) }.is_ok()
    }

    fn is_scm_authoritative(&self) -> bool {
        true
    }
}

/// The SCM control handler. Called on the SCM's thread.
///
/// It does the minimum a handler may do: record that a stop was asked for. The state transition and
/// the wind-down happen on the service thread, so no work is performed on the SCM's thread.
unsafe extern "system" fn control_handler(
    control: u32,
    _event_type: u32,
    _event_data: *mut core::ffi::c_void,
    _context: *mut core::ffi::c_void,
) -> u32 {
    if control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN {
        STOP_SIGNALLED.store(true, Ordering::SeqCst);
    }
    // NO_ERROR. Unrecognised controls are ignored rather than refused, which is what the SCM expects.
    0
}

/// The SCM's entry point for this service.
///
/// # Safety
/// Called by the SCM with the argument vector it owns. Neither argument is dereferenced here.
unsafe extern "system" fn service_main(_argc: u32, _argv: *mut windows::core::PWSTR) {
    let name = wide(SERVICE_NAME);

    // SAFETY: `name` is a NUL-terminated wide string that outlives the call. `control_handler` is a
    // valid `extern "system"` function with the required signature, and the context pointer is null
    // because the handler uses only statics. The returned handle is checked before use.
    let handle = unsafe {
        RegisterServiceCtrlHandlerExW(PCWSTR(name.as_ptr()), Some(control_handler), None)
    };
    let Ok(handle) = handle else {
        // Without a handler the SCM can never reach this process. There is no status handle to report
        // through, so the failure is recorded for `run_under_scm` to surface after the dispatcher
        // returns, and this service does nothing further.
        HANDLER_FAILED.store(true, Ordering::SeqCst);
        return;
    };
    let _ = STATUS_HANDLE.set(handle.0 as isize);

    let mut lifecycle = ServiceLifecycle::begin(ScmStatusReporter { handle });
    if lifecycle.running().is_err() {
        // Refuse rather than serve from an unexpected state.
        let _ = lifecycle.request_stop();
        let _ = lifecycle.stopped();
        return;
    }

    run_inert_loop(&mut lifecycle, &STOP_SIGNALLED);

    let _ = lifecycle.request_stop();
    let _ = lifecycle.stopped();
}

/// The minimal inert runtime loop.
///
/// It waits for a stop and does nothing else: no file, registry, network, IPC, SCM or ProgramData
/// access, no authority acquisition, no timer-driven work. Generic over the sink so the loop itself is
/// provable without an SCM.
pub fn run_inert_loop<S: StatusSink>(lifecycle: &mut ServiceLifecycle<S>, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        // A bounded sleep, not a spin: the service consumes no CPU while idle and reacts promptly.
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let _ = lifecycle;
}

/// Hand this process to the SCM.
///
/// # Errors
/// [`ScmError::DispatcherRefused`] when the process was not started by the SCM — the expected result
/// of running the executable interactively.
pub fn run_under_scm() -> Result<(), ScmError> {
    let mut name = wide(SERVICE_NAME);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: windows::core::PWSTR(name.as_mut_ptr()),
            lpServiceProc: Some(service_main),
        },
        // The table must be NUL-terminated.
        SERVICE_TABLE_ENTRYW {
            lpServiceName: windows::core::PWSTR::null(),
            lpServiceProc: None,
        },
    ];

    // SAFETY: `table` is a correctly NUL-terminated `SERVICE_TABLE_ENTRYW` array whose name buffer
    // (`name`) outlives the call, and `service_main` matches the required signature. The call blocks
    // until the service ends when it succeeds, and returns an error when this process was not started
    // by the SCM.
    let started = unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) };
    if started.is_ok() {
        // The dispatcher succeeded, but the service may still have been unreachable.
        if HANDLER_FAILED.load(Ordering::SeqCst) {
            return Err(ScmError::HandlerRegistrationFailed);
        }
        Ok(())
    } else {
        Err(ScmError::DispatcherRefused)
    }
}

/// A NUL-terminated UTF-16 copy of `s`.
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wide_service_name_is_nul_terminated_and_exact() {
        let w = wide(SERVICE_NAME);
        assert_eq!(*w.last().unwrap(), 0);
        assert_eq!(String::from_utf16_lossy(&w[..w.len() - 1]), "ProjectOSHost");
    }

    #[test]
    fn the_inert_loop_returns_as_soon_as_a_stop_is_signalled() {
        use crate::lifecycle::ServiceLifecycle;

        struct Recorder(Vec<ServiceRunState>);
        impl StatusSink for Recorder {
            fn publish(&mut self, s: ServiceRunState) -> bool {
                self.0.push(s);
                true
            }
            fn is_scm_authoritative(&self) -> bool {
                false
            }
        }

        let mut l = ServiceLifecycle::begin(Recorder(Vec::new()));
        l.running().unwrap();
        // Already signalled, so the loop must not block at all.
        let stop = AtomicBool::new(true);
        run_inert_loop(&mut l, &stop);
        l.request_stop().unwrap();
        l.stopped().unwrap();
        assert_eq!(l.state(), ServiceRunState::Stopped);
    }
}
