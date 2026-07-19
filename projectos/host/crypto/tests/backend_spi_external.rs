//! External-crate proof that `MasterKeyProtectionBackend` is implementable OUTSIDE the crypto crate
//! WITHOUT constructing a `ServiceMasterKeyHandle`, reading handle internals, constructing a
//! `PlaintextCredential`, or obtaining a raw secret slice. This file compiles as a separate crate.

use std::cell::Cell;
use std::rc::Rc;

use projectos_host_crypto::{
    BackendError, BackendSecret, KeyLifecycle, KeyRole, MasterKeyProtectionBackend,
    MasterKeyProtector, MasterKeyProtectorService, RotationOutcome,
};

/// Clearly-synthetic non-secret master-key fixture (test-only; never in the library/release).
const EXT_SYNTH: &[u8] = b"EXTERNAL-SYNTHETIC-MASTER-KEY-3JA-32BYTES";

/// Backend-owned zeroising unprotected material. `Drop` clears the owned buffer (test-only; ad-hoc
/// zero is acceptable here since this is not the production secret path).
struct ExtSecret {
    bytes: Vec<u8>,
}
impl Drop for ExtSecret {
    fn drop(&mut self) {
        for b in &mut self.bytes {
            *b = 0;
        }
    }
}
impl BackendSecret for ExtSecret {
    fn with_secret<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(&self.bytes)
    }
    fn len(&self) -> usize {
        self.bytes.len()
    }
}

/// An external synthetic backend. Self-generates a fixed synthetic value and round-trips it. No
/// Windows API, no filesystem, no network, no real credentials, no persistence, no fake-encryption
/// claim.
///
/// `fail_protect_at_call` deterministically fails the Nth (1-based) `protect_new` call and every call
/// after it, WITHOUT any post-construction mutation (the service owns the backend privately). This
/// lets one construction succeed a provision (call 1) yet fail a later rotate (call 2).
struct ExternalBackend {
    fail_protect_at_call: Option<(u32, BackendError)>,
    fail_unprotect: Option<BackendError>,
    /// Shared test-only `protect_new` call counter (survives the move into the service wrapper).
    protect_calls: Rc<Cell<u32>>,
}
impl ExternalBackend {
    fn new() -> Self {
        Self {
            fail_protect_at_call: None,
            fail_unprotect: None,
            protect_calls: Rc::new(Cell::new(0)),
        }
    }

    /// Fail `protect_new` starting at (and after) the 1-based `call` index.
    fn failing_from(call: u32, err: BackendError) -> Self {
        Self {
            fail_protect_at_call: Some((call, err)),
            fail_unprotect: None,
            protect_calls: Rc::new(Cell::new(0)),
        }
    }
}
impl MasterKeyProtectionBackend for ExternalBackend {
    type ProtectedRecord = Vec<u8>; // opaque to the wrapper
    type UnprotectedMaterial = ExtSecret;

    fn protect_new(&mut self) -> Result<Vec<u8>, BackendError> {
        let n = self.protect_calls.get() + 1;
        self.protect_calls.set(n);
        if let Some((at, err)) = self.fail_protect_at_call {
            if n >= at {
                return Err(err);
            }
        }
        Ok(EXT_SYNTH.to_vec())
    }
    fn unprotect(&mut self, record: &Vec<u8>) -> Result<ExtSecret, BackendError> {
        if let Some(e) = self.fail_unprotect {
            return Err(e);
        }
        Ok(ExtSecret {
            bytes: record.clone(),
        })
    }
}

fn service() -> MasterKeyProtectorService<ExternalBackend> {
    MasterKeyProtectorService::new(ExternalBackend::new())
}

#[test]
fn external_backend_provisions_and_opens() {
    let mut s = service();
    let handle = s.provision().expect("provision");
    // The wrapper minted a valid master-key handle; the backend never touched handle construction.
    assert_eq!(handle.role(), KeyRole::Master);
    assert_eq!(s.metadata(&handle).unwrap().lifecycle, KeyLifecycle::Active);
    let opened = s.open().expect("open");
    assert_eq!(opened.role(), KeyRole::Master);
}

#[test]
fn external_backend_protect_failure_creates_no_handle() {
    let mut s = MasterKeyProtectorService::new(ExternalBackend::failing_from(
        1,
        BackendError::ProtectFailedBeforeEffect,
    ));
    assert!(s.provision().is_err());
    assert_eq!(s.record_count(), 0);
}

#[test]
fn external_backend_rotation_success() {
    let mut s = service();
    let old = s.provision().expect("provision");
    let out = s.rotate(&old).expect("rotate");
    assert!(matches!(out, RotationOutcome::Success { .. }));
    assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Retiring);
}

#[test]
fn external_backend_creates_no_authority_only_metadata_and_handles() {
    // The only externally-observable outputs are opaque handles + redacted metadata; there is no
    // ExecutionPermit / AuthenticatedSession / CredentialLease / plaintext returned by this API.
    let mut s = service();
    let h = s.provision().unwrap();
    let meta = s.metadata(&h).unwrap();
    assert_eq!(meta.key_role, KeyRole::Master);
}

// ---- 3J-A-CORRECTION1A external proofs ----

/// A successful provision + rotation calls the external backend EXACTLY once each — no auto-retry —
/// observed from OUTSIDE the crate via a shared counter.
#[test]
fn external_backend_called_exactly_once_per_effect() {
    let backend = ExternalBackend::new();
    let counter = backend.protect_calls.clone();
    let mut s = MasterKeyProtectorService::new(backend);
    let old = s.provision().expect("provision");
    assert_eq!(counter.get(), 1);
    let _ = s.rotate(&old).expect("rotate");
    assert_eq!(counter.get(), 2);
}

/// A preflight refusal (retired handle) never reaches the external backend.
#[test]
fn external_backend_not_called_on_preflight_refusal() {
    let backend = ExternalBackend::new();
    let counter = backend.protect_calls.clone();
    let mut s = MasterKeyProtectorService::new(backend);
    let old = s.provision().expect("provision"); // call 1
    let _ = s.rotate(&old).expect("rotate"); // call 2; old now Retiring
    let before = counter.get();
    assert!(s.rotate(&old).is_err()); // retired-handle refusal
    assert_eq!(counter.get(), before); // backend untouched by the refusal
}

/// No external backend `protect_new` error resolves to `ReconciliationRequired` from this SPI. The
/// backend succeeds the provision (call 1) then fails the rotate (call 2) with each variant.
#[test]
fn external_backend_error_never_reconciliation() {
    for err in [
        BackendError::UnsupportedPlatform,
        BackendError::ProtectFailedBeforeEffect,
        BackendError::UnprotectFailed,
        BackendError::ResourceLimit,
    ] {
        let mut s = MasterKeyProtectorService::new(ExternalBackend::failing_from(2, err));
        let old = s.provision().expect("provision"); // call 1 succeeds
        match s.rotate(&old) {
            Ok(RotationOutcome::ReconciliationRequired { .. }) => {
                panic!("external backend error mapped to ReconciliationRequired for {err:?}")
            }
            Ok(RotationOutcome::FailedBeforeEffect) | Err(_) => {}
            other => panic!("unexpected outcome for {err:?}: {other:?}"),
        }
        // Old key intact after a known-before-effect rotate failure.
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
    }
}
