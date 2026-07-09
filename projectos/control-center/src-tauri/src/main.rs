// ProjectOS Control Center — Tauri desktop shell + Bridge Daemon IPC host.
//
// The window loads the built Vite frontend. On startup the host spawns the Node daemon sidecar
// (`sidecar/host.mjs`, which runs the real Bridge Daemon) and forwards each JSON line it prints
// to the webview over the `daemon://message` event channel. The frontend's TauriIPCTransport
// consumes that channel. Two read-only commands are exposed: request a fresh snapshot, and read
// liveness. Nothing here edits code, runs git/shell for the user, deploys, or mutates anything —
// it is a read-only bridge; governance stays in the daemon/CLI/core.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{Emitter, Manager, State};

/// Shared handle to the spawned sidecar. `stdin` sends read-only commands; `alive` reflects
/// whether the sidecar was launched. `ChildStdin`/`ChildStdout` are independent owned pipe
/// handles, so the `Child` itself need not be retained.
struct DaemonHost {
    stdin: Mutex<Option<ChildStdin>>,
    alive: Mutex<bool>,
}

/// Ask the sidecar/daemon to re-emit a full snapshot (read-only).
#[tauri::command]
fn daemon_request_snapshot(state: State<DaemonHost>) -> Result<(), String> {
    let mut guard = state.stdin.lock().map_err(|e| e.to_string())?;
    match guard.as_mut() {
        Some(stdin) => {
            stdin
                .write_all(b"{\"cmd\":\"snapshot\"}\n")
                .map_err(|e| e.to_string())?;
            let _ = stdin.flush();
            Ok(())
        }
        None => Err("daemon sidecar not running".into()),
    }
}

/// Whether the sidecar was launched (read-only liveness).
#[tauri::command]
fn daemon_status(state: State<DaemonHost>) -> bool {
    state.alive.lock().map(|g| *g).unwrap_or(false)
}

/// Resolve the sidecar entry: prefer the bundled resource, else common dev locations.
fn resolve_host_script(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("sidecar").join("host.mjs");
        if bundled.exists() {
            return bundled;
        }
    }
    for candidate in ["sidecar/host.mjs", "../sidecar/host.mjs"] {
        let p = std::path::PathBuf::from(candidate);
        if p.exists() {
            return p;
        }
    }
    std::path::PathBuf::from("sidecar/host.mjs")
}

/// Spawn the Node sidecar, stream its stdout to the webview, and register the process + stdin
/// in managed state. Read-only: it only reads the sidecar's stdout and writes snapshot requests.
fn spawn_and_register(app: &tauri::AppHandle) {
    let script = resolve_host_script(app);
    let spawned = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child: Child = match spawned {
        Ok(c) => c,
        Err(_) => return, // node not available / sidecar missing — UI shows Disconnected + retries.
    };

    if let Some(stdout) = child.stdout.take() {
        let handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = handle.emit("daemon://message", l);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let stdin = child.stdin.take();
    // Drop `child` after taking its pipe handles: the stdin/stdout handles remain valid, and
    // Rust's Child drop does not kill the process, so the sidecar keeps running.
    drop(child);
    let host = app.state::<DaemonHost>();
    // Single-statement locks: the MutexGuard temporary drops at the `;`, before `host`.
    if let Ok(mut g) = host.stdin.lock() {
        *g = stdin;
    };
    if let Ok(mut g) = host.alive.lock() {
        *g = true;
    };
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DaemonHost {
            stdin: Mutex::new(None),
            alive: Mutex::new(false),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            spawn_and_register(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_request_snapshot,
            daemon_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProjectOS Control Center");
}
