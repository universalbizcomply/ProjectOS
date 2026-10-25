//! Integration proofs for the owner-window bridge foundation (CD-B4-CONTROL-CENTRE-WINDOW-OBSERVATION-
//! BRIDGE1A). Runs only under `--features test-fixtures` (the whole crate is cfg'd out otherwise), and
//! drives the PURE lifecycle/selection surface plus the adapter-consumer inertness. It never constructs a
//! live Tauri app, never resolves a real HWND, and never mints a binding.

#![cfg(all(windows, feature = "test-fixtures"))]

use projectos_control_center::test_fixtures::owner_window::{
    resolve_designated_label, ObservationError, OwnerWindowLifecycleState,
};
use projectos_host_windows_owner_verification as owner;

fn labels(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn designated_label_requires_exactly_one_main() {
    assert!(resolve_designated_label(&labels(&["main"])).is_ok());
    assert_eq!(
        resolve_designated_label(&labels(&[])).unwrap_err(),
        ObservationError::MissingWindow
    );
    assert_eq!(
        resolve_designated_label(&labels(&["other"])).unwrap_err(),
        ObservationError::MissingWindow
    );
    assert_eq!(
        resolve_designated_label(&labels(&["main", "utility"])).unwrap_err(),
        ObservationError::SecondOwnerWindow
    );
}

#[test]
fn lifecycle_epoch_invalidates_on_every_transition() {
    let s = OwnerWindowLifecycleState::new();
    s.on_window_created();
    let e = s.current_epoch();
    assert!(s.is_current(e));

    // close request invalidates without clearing presence
    s.on_close_requested();
    assert!(!s.is_current(e));
    assert!(s.is_main_present());

    // destroy advances epoch and clears presence
    let e2 = s.current_epoch();
    s.on_destroyed();
    assert!(!s.is_current(e2));
    assert!(!s.is_main_present());

    // recreate cannot reuse a prior epoch
    s.on_window_created();
    assert_ne!(s.current_epoch(), e);
}

#[test]
fn shutdown_refuses_currentness() {
    let s = OwnerWindowLifecycleState::new();
    s.on_window_created();
    let e = s.current_epoch();
    s.begin_shutdown();
    assert!(!s.is_current(e));
    assert!(s.is_shutting_down());
}

#[test]
fn consumer_can_build_untrusted_observation_but_mints_nothing() {
    // The Control Centre crate depends on the adapter; a downstream consumer may build an UNTRUSTED
    // observation, but there is no reachable verifier or binding constructor — it carries no authority.
    let obs =
        owner::UntrustedControlCentreWindowObservation::new(owner::OwnerWindowObservationInput {
            label: owner::DESIGNATED_WINDOW_LABEL.to_string(),
            handle: owner::UntrustedOwnerWindowHandle::from_raw(0x2222),
            is_window: true,
            is_visible: true,
            is_minimized: false,
            is_focused: true,
            eligible: true,
            process_id: std::process::id(),
            thread_id: 1,
            session: 1,
            client_protocol_type: 0,
            active_console_session: 1,
            runtime_instance_digest: [0u8; 32],
            ipc_session_digest: [0u8; 32],
            project_digest: [0u8; 32],
            repository_digest: [0u8; 32],
            environment_digest: [0u8; 32],
            phase_digest: [0u8; 32],
            lifecycle_epoch: 1,
            capture_generation: 1,
            observed_at: 1,
        });
    let _d: [u8; 32] = obs.observation_digest();
    assert!(format!("{obs:?}").contains("[REDACTED]"));
    assert!(!format!("{obs:?}").contains("2222"));
}
