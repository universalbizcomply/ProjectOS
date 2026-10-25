//! Gated owner-machine live proof that the PRODUCTION source draws from the real Windows
//! system-preferred CNG RNG. Windows-only, `#[ignore]` by default, and additionally guarded by the
//! exact env gate, so no RNG call happens in an ordinary run. It returns only a non-secret structural
//! result (length + that the closure ran) — never candidate bytes, a hash, or a fingerprint.

use projectos_host_windows_crypto_adapter::MasterKeyMaterialSource;
use projectos_host_windows_master_key_source::WindowsCngMasterKeyMaterialSource;

/// Exact env gate for the live owner-machine RNG probe.
const PROBE_GATE: &str = "PROJECTOS_RUN_WINDOWS_MASTER_KEY_SOURCE_PROBE";

fn probe_enabled() -> bool {
    std::env::var(PROBE_GATE).as_deref() == Ok("1")
}

#[cfg(windows)]
#[test]
#[ignore = "owner-machine RNG probe; set PROJECTOS_RUN_WINDOWS_MASTER_KEY_SOURCE_PROBE=1"]
fn live_system_preferred_rng_generates_exact_length() {
    if !probe_enabled() {
        return; // refuse safely without the exact gate
    }
    let mut source = WindowsCngMasterKeyMaterialSource::new();
    let mut closure_calls = 0u32;
    // The closure returns ONLY a non-secret structural result (observed length). No candidate bytes,
    // hash, or fingerprint leave the closure, and nothing is printed or compared across calls.
    let observed_len = source
        .with_new_material(|bytes| {
            closure_calls += 1;
            bytes.len()
        })
        .expect("system-preferred RNG generation");
    assert_eq!(observed_len, 32); // BCryptGenRandom filled exactly 32 bytes
    assert_eq!(closure_calls, 1); // closure invoked exactly once, no retry
}
