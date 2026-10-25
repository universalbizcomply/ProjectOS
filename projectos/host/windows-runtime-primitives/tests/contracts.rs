//! Black-box public-API contract tests for the Windows runtime primitives.
//!
//! Handle-ownership behaviour is proved by the in-module unit tests in `handles.rs` (they need the
//! Win32 `HANDLE` type, kept internal). Here we prove the public app-mode classifier is present,
//! classification-only, and grants no authority.

use projectos_windows_runtime_primitives::app_mode::{detect_app_mode, AppMode};

#[test]
fn detect_app_mode_is_build_derived() {
    // Classification is exactly the build-derived value — Development for a debug test binary,
    // PackagedCandidate for a release test binary. No authority is returned; only an AppMode label.
    let expected = if cfg!(debug_assertions) {
        AppMode::Development
    } else {
        AppMode::PackagedCandidate
    };
    let mode: AppMode = detect_app_mode();
    assert_eq!(mode, expected);
}

#[test]
fn app_mode_is_a_plain_classification() {
    // Two distinct classifications, each Copy/Eq, carrying no capability.
    let a = AppMode::Development;
    let b = AppMode::PackagedCandidate;
    assert_ne!(a, b);
    // Copy semantics — using `a` twice must compile.
    let _c = a;
    let _d = a;
}
