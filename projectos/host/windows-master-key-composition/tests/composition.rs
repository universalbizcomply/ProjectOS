//! Composition boundary tests. Pure tests (cross-platform) prove construction is side-effect free and
//! exposes only the accepted crypto service operations. The live test (Windows + `#[ignore]` + exact
//! env gate) drives the FULL production path — real Windows CNG RNG + real machine-scope DPAPI —
//! through the canonical constructor, then drops all state. No candidate bytes, hashes, or fingerprints
//! are returned or printed anywhere.

use projectos_host_crypto::MasterKeyProtector;
use projectos_host_windows_master_key_composition::new_windows_production_master_key_protector;

/// Exact env gate for the live owner-machine ephemeral composition probe.
const PROBE_GATE: &str = "PROJECTOS_RUN_WINDOWS_MASTER_KEY_COMPOSITION_PROBE";

fn probe_enabled() -> bool {
    std::env::var(PROBE_GATE).as_deref() == Ok("1")
}

// ---- pure tests (any platform) ----

#[test]
fn construction_is_side_effect_free_no_auto_provision() {
    let protector = new_windows_production_master_key_protector();
    // Construction registered nothing: no RNG/DPAPI/provision ran.
    assert_eq!(protector.record_count(), 0);
}

#[test]
fn exposes_accepted_service_and_debug_is_redacted() {
    let protector = new_windows_production_master_key_protector();
    // The value IS the accepted crypto service: its inherent + trait API is available and Debug is
    // redacted (counts/epoch only, no component internals or material).
    assert_eq!(protector.record_count(), 0);
    let shown = format!("{protector:?}");
    assert!(shown.contains("MasterKeyProtectorService"));
    assert!(shown.contains("records"));
}

#[cfg(not(windows))]
#[test]
fn provision_off_windows_fails_closed_and_registers_nothing() {
    // Exercising the accepted service on a non-Windows host reaches the CNG stub → fail-closed, with
    // no record created — proving no authority is minted without a real protection effect.
    let mut protector = new_windows_production_master_key_protector();
    assert!(protector.provision().is_err());
    assert_eq!(protector.record_count(), 0);
}

// ---- gated owner-machine ephemeral production proof (Windows + ignore + exact env gate) ----

#[cfg(windows)]
#[test]
#[ignore = "owner-machine ephemeral composition probe; set PROJECTOS_RUN_WINDOWS_MASTER_KEY_COMPOSITION_PROBE=1"]
fn live_production_composition_provision_open_duplicate_rotate() {
    use projectos_host_crypto::{CryptoError, KeyLifecycle, KeyRole, RotationOutcome};

    if !probe_enabled() {
        return; // refuse safely without the exact gate
    }

    // A. Construction does not auto-provision.
    let mut protector = new_windows_production_master_key_protector();
    assert_eq!(protector.record_count(), 0);

    // B. Explicit provision + open through the accepted crypto service (real CNG + real DPAPI). The
    // crypto layer mints the handle; plaintext never leaves the service (open returns a handle only).
    let handle = protector.provision().expect("provision");
    assert_eq!(handle.role(), KeyRole::Master);
    assert_eq!(protector.record_count(), 1);
    assert_eq!(
        protector.metadata(&handle).unwrap().lifecycle,
        KeyLifecycle::Active
    );
    let opened = protector.open().expect("open");
    assert_eq!(opened.role(), KeyRole::Master);

    // C. Duplicate provision is refused before effect; no second handle, no retry.
    let before = protector.record_count();
    assert_eq!(
        protector.provision().unwrap_err(),
        CryptoError::MasterKeyAlreadyProvisioned
    );
    assert_eq!(protector.record_count(), before);

    // D. Explicit rotation through the crypto-owned API: replacement minted by crypto, old -> Retiring,
    // new -> Active, replacement opens; old record stays governed by the accepted service.
    let RotationOutcome::Success { new_handle, .. } = protector.rotate(&handle).expect("rotate")
    else {
        panic!("expected rotation success");
    };
    assert_eq!(
        protector.metadata(&handle).unwrap().lifecycle,
        KeyLifecycle::Retiring
    );
    assert_eq!(
        protector.metadata(&new_handle).unwrap().lifecycle,
        KeyLifecycle::Active
    );
    let reopened = protector.open().expect("open after rotation");
    assert_eq!(reopened.role(), KeyRole::Master);

    // E. Teardown: everything is in-process and dropped here; nothing persisted, nothing printed.
    drop(protector);
}
