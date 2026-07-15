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

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager, RunEvent, State};

use crate::identity;
use crate::process::lifecycle::{DaemonLifecycleState, SafeDaemonStatus};

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

/// Read-only identity classification. No production verifier is wired, so this reports
/// DEVELOPMENT_UNVERIFIED — never production trust. Mints nothing.
#[tauri::command]
fn identity_status() -> String {
    let outcome = identity::development_identity();
    serde_json::to_string(&outcome).unwrap_or_else(|_| {
        "{\"state\":\"IDENTITY_BLOCKED\",\"failure\":\"INTERNAL_ERROR_REDACTED\"}".to_string()
    })
}

/// Start the daemon and route its stdout to the webview.
///
/// Ordinary output produced BEFORE readiness is dropped (the incidental startup snapshot is stale by
/// the time the UI exists); a fresh snapshot is requested after readiness instead.
fn start_and_route(app: &tauri::AppHandle) {
    let state = app.state::<Arc<DaemonLifecycleState>>().inner().clone();
    let (rx, instance) = match state.start_daemon() {
        Ok(v) => v,
        // Fail closed: status already records the typed failure; the UI shows one safe action.
        Err(_) => return,
    };

    let handle = app.clone();
    let routing_state = state.clone();
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
    let _ = state.request_snapshot(None);
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

pub fn run() {
    let state = Arc::new(DaemonLifecycleState::new(new_host_instance_id()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            start_and_route(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_request_snapshot,
            daemon_status,
            identity_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building ProjectOS Control Center");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
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
