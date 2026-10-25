//! Backend bridge tests. Pure tests (cross-platform, non-gated) exercise the material-source and
//! length refusals that short-circuit BEFORE DPAPI. Live tests (Windows + `#[ignore]` + exact env
//! gate) exercise the real DPAPI round trip and the crypto wrapper. The synthetic source, its
//! counters, and every fixture live ONLY in this test crate and never enter a release artefact.

use std::cell::Cell;
use std::rc::Rc;

use projectos_host_crypto::{
    KeyLifecycle, KeyRole, MasterKeyProtector, MasterKeyProtectorService, RotationOutcome,
    KEY_SIZE_BYTES,
};
use projectos_host_windows_crypto_adapter::{
    MasterKeyMaterialSource, MaterialSourceError, WindowsDpapiMasterKeyBackend,
};

/// Exact env gate for live owner-machine DPAPI probes.
const PROBE_GATE: &str = "PROJECTOS_RUN_WINDOWS_MASTER_KEY_BACKEND_PROBE";

/// First clearly-synthetic non-secret master-key byte pattern (test-only; never a credential/prod key).
const SYNTH_A: u8 = 0xA5;
/// Second synthetic pattern, used to prove rotation draws fresh material per operation.
const SYNTH_B: u8 = 0x5A;

#[derive(Clone, Copy)]
enum Mode {
    Success,             // 32 bytes of SYNTH_A every call
    Sequence,            // SYNTH_A on call 1, SYNTH_B on call 2 (provision then rotation)
    GenerationFailed,    // source returns GenerationFailed
    ResourceLimit,       // source returns ResourceLimit
    ReportInvalidLength, // source returns InvalidLength
    ShortLength,         // yields 31 bytes (backend rejects before DPAPI)
    LongLength,          // yields 33 bytes (backend rejects before DPAPI)
}

/// TEST-ONLY synthetic source. Deterministic, fixed patterns; not random; not a credential; not a
/// production key. Zeroises its scratch buffer after the closure returns.
struct SyntheticSource {
    mode: Mode,
    calls: Rc<Cell<u32>>,
}

impl SyntheticSource {
    fn new(mode: Mode) -> Self {
        Self {
            mode,
            calls: Rc::new(Cell::new(0)),
        }
    }
    fn counter(&self) -> Rc<Cell<u32>> {
        self.calls.clone()
    }
}

impl MasterKeyMaterialSource for SyntheticSource {
    fn with_new_material<R>(
        &mut self,
        f: impl FnOnce(&[u8]) -> R,
    ) -> Result<R, MaterialSourceError> {
        let n = self.calls.get() + 1;
        self.calls.set(n);
        match self.mode {
            Mode::GenerationFailed => return Err(MaterialSourceError::GenerationFailed),
            Mode::ResourceLimit => return Err(MaterialSourceError::ResourceLimit),
            Mode::ReportInvalidLength => return Err(MaterialSourceError::InvalidLength),
            _ => {}
        }
        let mut buf = match self.mode {
            Mode::Success => vec![SYNTH_A; KEY_SIZE_BYTES],
            Mode::Sequence => {
                if n == 1 {
                    vec![SYNTH_A; KEY_SIZE_BYTES]
                } else {
                    vec![SYNTH_B; KEY_SIZE_BYTES]
                }
            }
            Mode::ShortLength => vec![SYNTH_A; KEY_SIZE_BYTES - 1],
            Mode::LongLength => vec![SYNTH_A; KEY_SIZE_BYTES + 1],
            Mode::GenerationFailed | Mode::ResourceLimit | Mode::ReportInvalidLength => {
                unreachable!()
            }
        };
        let out = f(&buf);
        for b in buf.iter_mut() {
            *b = 0; // zeroise scratch material after the closure returns
        }
        Ok(out)
    }
}

fn backend(mode: Mode) -> (WindowsDpapiMasterKeyBackend<SyntheticSource>, Rc<Cell<u32>>) {
    let source = SyntheticSource::new(mode);
    let counter = source.counter();
    (WindowsDpapiMasterKeyBackend::new(source), counter)
}

fn probe_enabled() -> bool {
    std::env::var(PROBE_GATE).as_deref() == Ok("1")
}

// ---- pure tests (any platform; these short-circuit BEFORE DPAPI) ----

use projectos_host_crypto::{BackendError, MasterKeyProtectionBackend};

#[test]
fn source_generation_failure_maps_before_effect_no_retry() {
    let (mut b, calls) = backend(Mode::GenerationFailed);
    assert_eq!(
        b.protect_new().unwrap_err(),
        BackendError::ProtectFailedBeforeEffect
    );
    assert_eq!(calls.get(), 1); // called once, no automatic retry
}

#[test]
fn source_resource_limit_maps_to_resource_limit() {
    let (mut b, calls) = backend(Mode::ResourceLimit);
    assert_eq!(b.protect_new().unwrap_err(), BackendError::ResourceLimit);
    assert_eq!(calls.get(), 1);
}

#[test]
fn source_reported_invalid_length_maps_before_effect() {
    let (mut b, calls) = backend(Mode::ReportInvalidLength);
    assert_eq!(
        b.protect_new().unwrap_err(),
        BackendError::ProtectFailedBeforeEffect
    );
    assert_eq!(calls.get(), 1);
}

#[test]
fn short_material_rejected_before_dpapi() {
    let (mut b, calls) = backend(Mode::ShortLength);
    assert_eq!(
        b.protect_new().unwrap_err(),
        BackendError::ProtectFailedBeforeEffect
    );
    assert_eq!(calls.get(), 1); // source consulted once, DPAPI never reached
}

#[test]
fn long_material_rejected_before_dpapi() {
    let (mut b, calls) = backend(Mode::LongLength);
    assert_eq!(
        b.protect_new().unwrap_err(),
        BackendError::ProtectFailedBeforeEffect
    );
    assert_eq!(calls.get(), 1);
}

// ---- live owner-machine DPAPI proofs (Windows + ignore + exact env gate) ----

#[cfg(windows)]
#[test]
#[ignore = "owner-machine DPAPI probe; set PROJECTOS_RUN_WINDOWS_MASTER_KEY_BACKEND_PROBE=1"]
fn live_direct_backend_round_trip() {
    use projectos_host_crypto::BackendSecret;
    if !probe_enabled() {
        return; // refuse safely without the exact gate
    }
    let (mut b, calls) = backend(Mode::Success);
    let record = b.protect_new().expect("protect_new");
    assert_eq!(calls.get(), 1); // exactly one source call
    assert!(!record.is_empty());

    let material = b.unprotect(&record).expect("unprotect");
    assert_eq!(calls.get(), 1); // unprotect did NOT consult the source
    assert_eq!(material.len(), KEY_SIZE_BYTES);
    // Compare internally through the closure-scoped borrow; no raw bytes are returned or printed.
    let round_trip_ok = material.with_secret(|b| b == [SYNTH_A; KEY_SIZE_BYTES].as_slice());
    assert!(round_trip_ok);
    drop(material);
}

#[cfg(windows)]
#[test]
#[ignore = "owner-machine DPAPI probe; set PROJECTOS_RUN_WINDOWS_MASTER_KEY_BACKEND_PROBE=1"]
fn live_wrapper_provision_open_and_duplicate() {
    if !probe_enabled() {
        return;
    }
    let (b, calls) = backend(Mode::Success);
    let mut svc = MasterKeyProtectorService::new(b);

    let handle = svc.provision().expect("provision");
    assert_eq!(handle.role(), KeyRole::Master);
    assert_eq!(calls.get(), 1);
    assert_eq!(
        svc.metadata(&handle).unwrap().lifecycle,
        KeyLifecycle::Active
    );

    let opened = svc.open().expect("open");
    assert_eq!(opened.role(), KeyRole::Master);

    // Duplicate provision is refused before any effect: source + DPAPI untouched.
    let before = calls.get();
    assert_eq!(
        svc.provision().unwrap_err(),
        projectos_host_crypto::CryptoError::MasterKeyAlreadyProvisioned
    );
    assert_eq!(calls.get(), before);
}

#[cfg(windows)]
#[test]
#[ignore = "owner-machine DPAPI probe; set PROJECTOS_RUN_WINDOWS_MASTER_KEY_BACKEND_PROBE=1"]
fn live_wrapper_rotation() {
    if !probe_enabled() {
        return;
    }
    let (b, calls) = backend(Mode::Sequence);
    let mut svc = MasterKeyProtectorService::new(b);

    let old = svc.provision().expect("provision"); // source call 1
    let out = svc.rotate(&old).expect("rotate"); // source call 2
    let RotationOutcome::Success { new_handle, .. } = out else {
        panic!("expected rotation success");
    };
    assert_eq!(
        svc.metadata(&old).unwrap().lifecycle,
        KeyLifecycle::Retiring
    );
    assert_eq!(
        svc.metadata(&new_handle).unwrap().lifecycle,
        KeyLifecycle::Active
    );
    // Open succeeds after rotation (new current master unprotects).
    let opened = svc.open().expect("open after rotation");
    assert_eq!(opened.role(), KeyRole::Master);
    assert_eq!(calls.get(), 2); // exactly one source call per successful protection, no retry
}
