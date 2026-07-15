//! Library surface for the ProjectOS Control Center native crate.
//!
//! This exists for exactly one reason (PROJECTOS-WINDOWS-PROCESS-CREATION1A): the process-creation
//! foundation must be provable against a real synthetic child process, and only an INTEGRATION test
//! receives `CARGO_BIN_EXE_<name>` — the documented, robust way to locate a Cargo-built fixture.
//! Integration tests can only import a library target, so the `process` module is exposed here.
//!
//! The Tauri application itself is unchanged and still lives entirely in `main.rs`: the desktop
//! shell, the daemon sidecar startup, and the read-only commands are NOT moved, NOT rewired, and
//! NOT affected by this file.

// The native process-creation foundation is available ONLY under the non-default `test-fixtures`
// feature. In a default/release build this module does not exist at all: there is no ProcessSpec, no
// owner, no creator, no token, and therefore no way for any normal caller to obtain authority to
// launch an executable. The `SyntheticTest` label and the fixture token are NOT controls — this
// feature gate is the control.
#[cfg(feature = "test-fixtures")]
pub mod process;
