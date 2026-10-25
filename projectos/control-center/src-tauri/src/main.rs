// ProjectOS Control Center — thin binary entry point.
//
// The authoritative application runner lives in the library (`lib.rs` → `run()`), so the native
// process layer can stay crate-private and no other crate can reach the generic process launcher.
// This file deliberately contains no lifecycle logic.
//
// `run()` returns `ExitCode` rather than calling `std::process::exit` anywhere: `exit` terminates
// without running Rust destructors, which would skip the instance guard and the daemon owner.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    projectos_control_center::run()
}
