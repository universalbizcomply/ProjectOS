//! Tauri application runner (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! Replaces the previous `main.rs` lifecycle, which: launched `node` via PATH, dropped the `Child`
//! (leaving a permanent orphan), set an `alive` boolean true and never reset it (reporting "running"
//! over a corpse), discarded stderr, and had no teardown at all.
//!
//! Now: one sealed development authority launches the daemon job-bound at creation; one authoritative
//! lock owns it; readiness is an explicit `lifecycle.ready`; status derives from the process handle;
//! stdout is instance-correlated and only forwarded after readiness; exit is bounded and cannot
//! re-enter. The Job's kill-on-close remains the hard containment guarantee.
//!
//! No trust is minted and protected approvals stay disabled — job-binding is containment, not identity.

#![cfg(windows)]

use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use projectos_host_windows_owner_verification::DESIGNATED_WINDOW_LABEL;
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use windows::core::PCWSTR;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND,
};

use crate::identity::{self, composite::IdentityStatusView};
use crate::instance::{self, InstanceOutcome};
use crate::owner_window::OwnerWindowLifecycleState;
use crate::process::lifecycle::{DaemonLifecycleState, SafeDaemonStatus};

/// Returned when another host already owns this account/installation/channel.
const EXIT_ALREADY_RUNNING: u8 = 2;
/// Returned when instance authority could not be established at all (access denied, scope
/// collision, invalid scope material, or any other native failure). Distinct from
/// `EXIT_ALREADY_RUNNING` so a refusal is never confused with a working duplicate.
const EXIT_AUTHORITY_UNAVAILABLE: u8 = 3;

/// Monotonic counter making each host instance id unique within a boot.
static HOST_SEQ: AtomicU64 = AtomicU64::new(0);

/// Non-secret host instance id. Bounded ASCII; carries no authority and is never sent to React.
fn new_host_instance_id() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let n = HOST_SEQ.fetch_add(1, Ordering::SeqCst);
    format!("h{secs:x}{n:x}")
}

/// Ask the daemon to re-emit a full snapshot (read-only, fixed Rust-authored bytes).
///
/// Rejected unless the lifecycle is RUNNING_READ_ONLY. Accepts no configuration, launches nothing,
/// restarts nothing, and never panics on a broken pipe.
#[tauri::command]
fn daemon_request_snapshot(state: State<Arc<DaemonLifecycleState>>) -> Result<(), String> {
    state
        .request_snapshot(None)
        .map_err(|e| e.next_safe_action().to_string())
}

/// Read-only lifecycle status. Returns only the safe projection — no PID, handle, path, instance id,
/// stderr, or trust claim.
#[tauri::command]
fn daemon_status(state: State<Arc<DaemonLifecycleState>>) -> SafeDaemonStatus {
    state.safe_status()
}

/// Read-only identity classification (WINDOWS-PACKAGED-RUNTIME-IDENTITY1B).
///
/// Returns the IMMUTABLE composite identity captured once at startup — never re-evaluated per
/// request: no filesystem hashing, no manifest read, no env/CLI inspection, no native trust call,
/// no state mutation. No production verifier is wired, so a real machine is only ever
/// DEVELOPMENT / TEST_FIXTURE / PACKAGED_CANDIDATE and protected eligibility is always DISABLED.
#[tauri::command]
fn identity_status(view: State<Arc<IdentityStatusView>>) -> String {
    serde_json::to_string(view.inner().as_ref()).unwrap_or_else(|_| {
        "{\"executionMode\":\"PACKAGED_CANDIDATE\",\"protectedEligibility\":\"DISABLED\"}"
            .to_string()
    })
}

/// Start the daemon on a RETAINED startup worker and route its stdout to the webview.
///
/// RECOVERY-BARRIER1B: the recovery barrier + suspended launch run on a spawned worker whose
/// `JoinHandle` is stored in the lifecycle state (never detached), so `setup` returns immediately,
/// the UI loads and polls status (`RECOVERING` → `STARTING` → `RUNNING_READ_ONLY`), and the
/// shutdown interlock can always join the worker before any exit decision.
///
/// Ordinary output produced BEFORE readiness is dropped (the incidental startup snapshot is stale by
/// the time the UI exists); a fresh snapshot is requested after readiness instead.
fn start_and_route(app: &tauri::AppHandle) {
    let state = app.state::<Arc<DaemonLifecycleState>>().inner().clone();
    let handle = app.clone();
    let worker_state = state.clone();
    let worker = std::thread::spawn(move || {
        let (rx, instance) = match worker_state.run_startup() {
            Ok(v) => v,
            // Fail closed: status already records the typed failure; the UI shows one safe action.
            Err(_) => return,
        };

        // The router is the pre-existing stdout consumer, not startup work: the startup worker is
        // terminal right after spawning it, so the shutdown join is never held open by routing.
        let routing_state = worker_state.clone();
        std::thread::spawn(move || {
            for line in rx {
                // Stale output from a replaced process must never reach the current UI.
                if !routing_state.is_current_instance(&instance) {
                    break;
                }
                // Stop emitting the moment shutdown begins.
                if !routing_state.may_emit() {
                    continue;
                }
                let _ = handle.emit("daemon://message", line);
            }
            // stdout EOF ⇒ the process is gone. Record it against THIS instance only.
            routing_state.record_exit(&instance);
        });

        // The daemon is ready; ask for a fresh snapshot now that the UI is listening.
        let _ = worker_state.request_snapshot(None);
    });
    // Retain the worker (§9): exit is unreachable until this handle is joined.
    state.store_startup_worker(worker);
}

/// Run the bounded shutdown on a dedicated thread, then trigger the one final exit.
fn spawn_shutdown_worker(app: &tauri::AppHandle, code: Option<i32>) {
    let state = app.state::<Arc<DaemonLifecycleState>>().inner().clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        // Bounded: cooperative request → grace → force → Job close (drop) → readers joined.
        state.run_shutdown();
        // Mark BEFORE exiting so the resulting exit event is not prevented.
        state.mark_final_exit();
        handle.exit(code.unwrap_or(0));
    });
}

/// Show one safe modal. Never carries an object name, SID, hash, path, PID, HANDLE or native error
/// code — a duplicate launch is an ordinary, controlled refusal, not a crash to be diagnosed by the
/// owner.
///
/// `MessageBoxW` is used because release builds set `windows_subsystem = "windows"` and therefore
/// have no console: `eprintln!` would be invisible and the refusal silent. There is no parent window
/// because no window exists yet — instance authority is decided before any Tauri construction.
fn show_safe_message(text: &str) {
    let wide_text: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_title: Vec<u16> = "ProjectOS"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: both buffers are NUL-terminated and live for the duration of the call; a null parent
    // HWND is the documented way to show an owner-less modal. The return value is deliberately
    // ignored — see `run()`: a failed dialog must never allow startup.
    unsafe {
        MessageBoxW(
            None,
            PCWSTR(wide_text.as_ptr()),
            PCWSTR(wide_title.as_ptr()),
            MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND,
        );
    }
}

/// The application entry.
///
/// Instance authority is established FIRST — before the Tauri builder, managed state, any window,
/// Node resolution, `host.mjs` resolution, Job creation, daemon launch, readiness, or any ProjectOS
/// state mutation. A duplicate therefore cannot reach any of them: it returns from here.
pub fn run() -> ExitCode {
    let guard = match instance::acquire() {
        InstanceOutcome::Acquired(guard) => guard,
        InstanceOutcome::AlreadyRunning => {
            show_safe_message(
                "ProjectOS is already running.\nUse the existing Control Centre window.",
            );
            // Returned whether or not the dialog succeeded: the refusal is the contract, the message
            // is only a courtesy.
            return ExitCode::from(EXIT_ALREADY_RUNNING);
        }
        InstanceOutcome::Failed(_) => {
            // Deliberately does NOT claim another instance is running — authority failure and a real
            // duplicate are different facts, and only one of them is true here.
            show_safe_message(
                "ProjectOS could not establish its local startup guard.\n\
                 Close other ProjectOS windows and try again.",
            );
            return ExitCode::from(EXIT_AUTHORITY_UNAVAILABLE);
        }
    };

    run_inner();

    // Dropped only AFTER the Tauri run loop has returned, which happens only after the daemon has
    // been shut down. Explicit rather than implicit because the ordering is load-bearing: releasing
    // the authority earlier would let a second host start while this daemon was still alive.
    drop(guard);
    ExitCode::SUCCESS
}

/// The authoritative Tauri runner. Only ever reached by a host holding instance authority.
fn run_inner() {
    let state = Arc::new(DaemonLifecycleState::new(new_host_instance_id()));

    // Capture the immutable Phase-1B identity ONCE, before the UI can request it. Classification
    // only — never re-evaluated per request, never upgraded by readiness, recovery or lifecycle.
    let identity_view = Arc::new(identity::capture_startup_identity().to_status_view());

    // Deterministic owner-window lifecycle (CD-B4-CONTROL-CENTRE-WINDOW-OBSERVATION-BRIDGE1A). Advanced by
    // the run-loop window events below; consulted by the (not-yet-triggered) observation producer so a
    // stale window can never yield a current observation.
    let owner_lifecycle = Arc::new(OwnerWindowLifecycleState::new());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .manage(identity_view)
        .manage(owner_lifecycle)
        .setup(|app| {
            let handle = app.handle().clone();
            start_and_route(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_request_snapshot,
            daemon_status,
            identity_status,
            crate::host_status::installed_host_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building ProjectOS Control Center");

    app.run(|handle, event| {
        // Owner-window lifecycle transitions. A single monotonic epoch is advanced on creation, a
        // (possibly prevented) close request, and destruction, so any transition invalidates an
        // outstanding observation.
        let owner_lifecycle = handle
            .state::<Arc<OwnerWindowLifecycleState>>()
            .inner()
            .clone();
        match &event {
            RunEvent::Ready => owner_lifecycle.on_window_created(),
            RunEvent::WindowEvent {
                label,
                event: window_event,
                ..
            } if label.as_str() == DESIGNATED_WINDOW_LABEL => match window_event {
                WindowEvent::CloseRequested { .. } => owner_lifecycle.on_close_requested(),
                WindowEvent::Destroyed => owner_lifecycle.on_destroyed(),
                _ => {}
            },
            _ => {}
        }

        if let RunEvent::ExitRequested { code, api, .. } = event {
            // Late capture results are refused once shutdown begins.
            owner_lifecycle.begin_shutdown();
            let state = handle.state::<Arc<DaemonLifecycleState>>().inner().clone();
            // `AppHandle::exit` raises this same event. If the final exit is already underway we must
            // NOT prevent it, or the application could never close. State is the authoritative guard;
            // `code` is corroborating evidence (Some ⇒ programmatic exit).
            if state.final_exit_triggered() {
                return;
            }
            // Exactly one shutdown worker, whatever the number of close requests (atomic claim).
            if state.claim_shutdown() {
                api.prevent_exit();
                spawn_shutdown_worker(handle, code);
            } else {
                // A worker is already stopping; keep the app alive until it triggers the final exit.
                api.prevent_exit();
            }
        }
    });
}
