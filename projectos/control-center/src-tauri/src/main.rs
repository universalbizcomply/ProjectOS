// ProjectOS Control Center — Tauri desktop shell.
// The window loads the built Vite frontend. The desktop app is a viewer/orchestrator; it
// never edits code and performs nothing gated — governance stays in the `projectos` CLI/core.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running ProjectOS Control Center");
}
