// ProjectOS Mission Control Fixture — TEST-ONLY isolated desktop shell.
//
// Loads the prebuilt synthetic fixture frontend (../fixture-dist) in a genuine Tauri window.
// It spawns NO sidecar, opens NO daemon/IPC/Supabase/network connection, and registers NO
// commands. It exists solely to render the REAL Mission Control components against synthetic
// fixture data for desktop automation. It is a separate crate under test-desktop/ and is never
// referenced by the production application build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running ProjectOS Mission Control Fixture");
}
