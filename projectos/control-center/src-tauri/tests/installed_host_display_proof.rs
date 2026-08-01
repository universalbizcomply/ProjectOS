//! LIVE proof that the Control Centre displays the GENUINE state the installed host returned.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! This drives the EXACT function the Tauri command calls, so what it asserts is what the Mission
//! Control panel renders. It is `#[ignore]`d because it needs the real installed service:
//!
//! ```text
//! cargo test --test installed_host_display_proof -- --ignored --nocapture
//! ```
//!
//! Read-only: it starts, stops, configures and writes nothing.

#![cfg(windows)]

use projectos_control_center::host_status::read_installed_host_status;

#[test]
#[ignore = "requires the installed ProjectOSHost service to be running"]
fn the_control_centre_displays_the_genuine_installed_host_state() {
    // The service serves one exchange per iteration, so allow a bounded number of attempts.
    let mut view = read_installed_host_status();
    for _ in 0..24 {
        if view.read_succeeded {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
        view = read_installed_host_status();
    }
    assert!(
        view.read_succeeded,
        "the Control Centre could not read the installed host: {}",
        view.next_safe_action
    );

    assert_eq!(view.service_state, "RUNNING");
    assert_eq!(view.identity_verification, "VERIFIED");
    // The Control Centre must display the DEGRADED the host actually returned, never READY.
    assert_eq!(view.readiness, "DEGRADED");
    assert_ne!(view.readiness, "READY");
    assert_eq!(view.protected_operations, "REFUSED");
    assert_ne!(view.protected_operations, "AUTHORISED");
    assert_eq!(view.build_prefix.len(), 8);
    assert_eq!(view.manifest_prefix.len(), 8);
    assert_ne!(view.build_prefix, "00000000");
    assert_ne!(view.manifest_prefix, "00000000");

    // Nothing forbidden is displayed: no full identifier, no path, no separator that a path or a
    // 32-character identifier would need.
    for field in [
        &view.service_state,
        &view.identity_verification,
        &view.channel,
        &view.build_prefix,
        &view.manifest_prefix,
        &view.readiness,
        &view.protected_operations,
    ] {
        assert!(field.len() <= 16, "a displayed value is short: {field}");
        assert!(!field.contains('\\'), "no path is displayed: {field}");
        assert!(!field.contains('/'), "no path is displayed: {field}");
        assert!(!field.contains(':'), "no path is displayed: {field}");
    }

    println!(
        "LIVE DISPLAY: service={} identity={} channel={} build={} manifest={} readiness={} protected={}",
        view.service_state,
        view.identity_verification,
        view.channel,
        view.build_prefix,
        view.manifest_prefix,
        view.readiness,
        view.protected_operations,
    );
}
