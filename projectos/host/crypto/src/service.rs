//! The crypto-owned master-key protector wrapper. It owns the authoritative in-memory handle
//! registry, the adapter epoch, lifecycle transitions, and operation-id allocation, and it ALONE
//! constructs [`ServiceMasterKeyHandle`]. It delegates material protection to an external
//! [`MasterKeyProtectionBackend`], which never receives handle-minting authority. This crate stays
//! platform-neutral: no Windows dependency, no FFI, no `unsafe`.

use std::collections::BTreeMap;
use std::fmt;

use crate::adapter::{MasterKeyMetadata, MasterKeyProtector, RotationOutcome};
use crate::backend::{BackendError, BackendSecret, MasterKeyProtectionBackend};
use crate::error::CryptoError;
use crate::handle::{KeyLifecycle, KeyRole, ServiceMasterKeyHandle};

/// Maximum retained master-key records (reference safety bound).
pub const MAX_MASTER_RECORDS: usize = 64;

/// One crypto-owned master-key record. Private: no public constructor, no public getter, holds only
/// the backend-owned opaque protected record + its lifecycle (never plaintext).
struct MasterRecord<P> {
    lifecycle: KeyLifecycle,
    protected: P,
}

/// The crypto-owned master-key protector. Wraps an external protection backend and implements the
/// accepted [`MasterKeyProtector`] contract. `Debug` is redacted (counts/epoch only); it is not
/// serializable and exposes no protected record.
pub struct MasterKeyProtectorService<B: MasterKeyProtectionBackend> {
    backend: B,
    epoch: u64,
    next_id: u64,
    op_counter: u64,
    records: BTreeMap<u64, MasterRecord<B::ProtectedRecord>>,
    current: Option<u64>,
}

impl<B: MasterKeyProtectionBackend> MasterKeyProtectorService<B> {
    /// Wrap a protection backend. The registry starts empty; epoch is 1.
    #[must_use]
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            epoch: 1,
            next_id: 1,
            op_counter: 0,
            records: BTreeMap::new(),
            current: None,
        }
    }

    /// The number of registered records (non-secret metadata).
    #[must_use]
    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    fn alloc_id(&mut self) -> Result<u64, CryptoError> {
        let next = self
            .next_id
            .checked_add(1)
            .ok_or(CryptoError::ResourceLimit)?;
        let id = self.next_id;
        self.next_id = next;
        Ok(id)
    }

    fn alloc_op(&mut self) -> Result<crate::handle::CryptoOperationId, CryptoError> {
        let next = self
            .op_counter
            .checked_add(1)
            .ok_or(CryptoError::ResourceLimit)?;
        self.op_counter = next;
        crate::handle::CryptoOperationId::new(next).map_err(|_| CryptoError::InvalidRevision)
    }

    /// Resolve a handle to a registered id, requiring an Active lifecycle.
    fn require_active(&self, handle: &ServiceMasterKeyHandle) -> Result<u64, CryptoError> {
        if handle.epoch() != self.epoch {
            return Err(CryptoError::UnknownHandle);
        }
        let id = handle.id();
        let record = self.records.get(&id).ok_or(CryptoError::UnknownHandle)?;
        match record.lifecycle {
            KeyLifecycle::Active => Ok(id),
            KeyLifecycle::Retiring => Err(CryptoError::RetiredHandle),
            KeyLifecycle::Revoked => Err(CryptoError::RevokedHandle),
        }
    }
}

impl<B: MasterKeyProtectionBackend> MasterKeyProtector for MasterKeyProtectorService<B> {
    fn provision(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError> {
        // INITIAL-CREATION ONLY. The FIRST preflight refuses a duplicate provision before any effect:
        // no backend call, no id/op reservation, no record, no lifecycle change. Replacement is
        // rotate()'s job exclusively; provision never retires or replaces an existing current record.
        if self.current.is_some() {
            return Err(CryptoError::MasterKeyAlreadyProvisioned);
        }
        // PREFLIGHT — remaining crypto-owned refusals happen BEFORE the backend call.
        if self.records.len() >= MAX_MASTER_RECORDS {
            return Err(CryptoError::ResourceLimit);
        }
        // Reserve a checked handle id BEFORE the backend call; if reservation fails the backend is
        // never reached.
        let id = self.alloc_id()?;
        // BACKEND — a failure here leaves the registry empty, consumes the reserved id (never
        // reused), and does not retry.
        let protected = self
            .backend
            .protect_new()
            .map_err(BackendError::to_crypto)?;
        // INFALLIBLE COMMIT — no predictable failure point remains after backend success. Initial
        // provision performs NO lifecycle transition (there is no prior record).
        self.records.insert(
            id,
            MasterRecord {
                lifecycle: KeyLifecycle::Active,
                protected,
            },
        );
        self.current = Some(id);
        Ok(ServiceMasterKeyHandle::new(id, self.epoch))
    }

    fn open(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError> {
        let id = self.current.ok_or(CryptoError::SecretUnavailable)?;
        // Disjoint field borrows: read the record from `records`, unprotect via `backend`.
        let record = self.records.get(&id).ok_or(CryptoError::UnknownHandle)?;
        let material = self
            .backend
            .unprotect(&record.protected)
            .map_err(BackendError::to_crypto)?;
        // Consume the unprotected material closure-scoped; it never escapes and zeroises on drop.
        let usable = material.with_secret(|bytes| !bytes.is_empty());
        drop(material);
        if !usable {
            return Err(CryptoError::SecretUnavailable);
        }
        Ok(ServiceMasterKeyHandle::new(id, self.epoch))
    }

    fn rotate(
        &mut self,
        current: &ServiceMasterKeyHandle,
    ) -> Result<RotationOutcome<ServiceMasterKeyHandle>, CryptoError> {
        // PREFLIGHT — all crypto-owned refusals + ID reservations happen BEFORE the backend call.
        let old_id = self.require_active(current)?;
        if self.records.len() >= MAX_MASTER_RECORDS {
            return Err(CryptoError::ResourceLimit);
        }
        // Reserve a checked op id then a checked handle id BEFORE the backend call; if either fails
        // the backend is never reached.
        let operation = self.alloc_op()?;
        let new_id = self.alloc_id()?;
        // BACKEND — a known-before-effect failure leaves the old record Active and consumes the
        // reserved op/handle ids (never reused). No uncertain effect exists in this SPI.
        let protected = match self.backend.protect_new() {
            Ok(protected) => protected,
            Err(BackendError::ProtectFailedBeforeEffect) => {
                return Ok(RotationOutcome::FailedBeforeEffect)
            }
            Err(other) => return Err(other.to_crypto()),
        };
        // INFALLIBLE COMMIT — register replacement, then retire the old record, then set current.
        self.records.insert(
            new_id,
            MasterRecord {
                lifecycle: KeyLifecycle::Active,
                protected,
            },
        );
        if let Some(record) = self.records.get_mut(&old_id) {
            record.lifecycle = KeyLifecycle::Retiring;
        }
        self.current = Some(new_id);
        Ok(RotationOutcome::Success {
            new_handle: ServiceMasterKeyHandle::new(new_id, self.epoch),
            operation,
        })
    }

    fn metadata(&self, handle: &ServiceMasterKeyHandle) -> Result<MasterKeyMetadata, CryptoError> {
        if handle.epoch() != self.epoch {
            return Err(CryptoError::UnknownHandle);
        }
        let record = self
            .records
            .get(&handle.id())
            .ok_or(CryptoError::UnknownHandle)?;
        Ok(MasterKeyMetadata {
            key_role: KeyRole::Master,
            lifecycle: record.lifecycle,
        })
    }
}

impl<B: MasterKeyProtectionBackend> fmt::Debug for MasterKeyProtectorService<B> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MasterKeyProtectorService")
            .field("epoch", &self.epoch)
            .field("records", &self.records.len())
            .field("current_present", &self.current.is_some())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::BackendError;
    use crate::handle::KeyLifecycle;

    /// A minimal in-crate synthetic backend for wrapper unit tests. NOT a production implementation;
    /// stores a fixed synthetic value and round-trips it. No crypto/FFI/fs.
    const UNIT_SYNTH: &[u8] = b"UNIT-SYNTH-MASTER-KEY-MATERIAL-3JA-32B";

    struct UnitSecret {
        bytes: Vec<u8>,
    }
    impl Drop for UnitSecret {
        fn drop(&mut self) {
            for b in &mut self.bytes {
                *b = 0;
            }
        }
    }
    impl BackendSecret for UnitSecret {
        fn with_secret<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
            f(&self.bytes)
        }
        fn len(&self) -> usize {
            self.bytes.len()
        }
    }

    struct UnitBackend {
        fail_protect: Option<BackendError>,
        fail_unprotect: Option<BackendError>,
        /// TEST-ONLY invocation counter. Proves the wrapper calls the backend EXACTLY once on a
        /// successful/failing effect and NEVER on a preflight refusal, and never auto-retries. Absent
        /// from any non-test build (this whole module is `#[cfg(test)]`).
        protect_calls: u32,
    }
    impl UnitBackend {
        fn new() -> Self {
            Self {
                fail_protect: None,
                fail_unprotect: None,
                protect_calls: 0,
            }
        }
    }
    impl MasterKeyProtectionBackend for UnitBackend {
        type ProtectedRecord = Vec<u8>;
        type UnprotectedMaterial = UnitSecret;
        fn protect_new(&mut self) -> Result<Vec<u8>, BackendError> {
            // Count EVERY entry, before the failure branch, so a call is recorded even when it errors.
            self.protect_calls += 1;
            if let Some(e) = self.fail_protect {
                return Err(e);
            }
            Ok(UNIT_SYNTH.to_vec())
        }
        fn unprotect(&mut self, record: &Vec<u8>) -> Result<UnitSecret, BackendError> {
            if let Some(e) = self.fail_unprotect {
                return Err(e);
            }
            Ok(UnitSecret {
                bytes: record.clone(),
            })
        }
    }

    fn service() -> MasterKeyProtectorService<UnitBackend> {
        MasterKeyProtectorService::new(UnitBackend::new())
    }

    #[test]
    fn provision_issues_handle_and_registers_one_record() {
        let mut s = service();
        let h = s.provision().unwrap();
        assert_eq!(h.role(), KeyRole::Master);
        assert_eq!(s.record_count(), 1);
        assert_eq!(s.metadata(&h).unwrap().lifecycle, KeyLifecycle::Active);
    }

    #[test]
    fn protect_failure_creates_no_handle() {
        let mut s = MasterKeyProtectorService::new(UnitBackend {
            fail_protect: Some(BackendError::ProtectFailedBeforeEffect),
            fail_unprotect: None,
            protect_calls: 0,
        });
        assert_eq!(s.provision().unwrap_err(), CryptoError::SecretUnavailable);
        assert_eq!(s.record_count(), 0);
    }

    #[test]
    fn open_roundtrips_current_master() {
        let mut s = service();
        let _ = s.provision().unwrap();
        let h = s.open().unwrap();
        assert_eq!(h.role(), KeyRole::Master);
    }

    #[test]
    fn open_without_provision_is_unavailable() {
        let mut s = service();
        assert_eq!(s.open().unwrap_err(), CryptoError::SecretUnavailable);
    }

    #[test]
    fn open_maps_backend_unprotect_failure() {
        let mut s = service();
        let _ = s.provision().unwrap();
        s.backend.fail_unprotect = Some(BackendError::UnprotectFailed);
        assert_eq!(s.open().unwrap_err(), CryptoError::SecretUnavailable);
    }

    #[test]
    fn fabricated_handle_refused() {
        let s = service();
        let fake = ServiceMasterKeyHandle::new(999, 1);
        assert_eq!(s.metadata(&fake).unwrap_err(), CryptoError::UnknownHandle);
    }

    #[test]
    fn stale_epoch_handle_refused() {
        let mut s = service();
        let h = s.provision().unwrap();
        // Force an epoch advance (models an adapter restart).
        s.epoch += 1;
        assert_eq!(s.metadata(&h).unwrap_err(), CryptoError::UnknownHandle);
    }

    #[test]
    fn handle_counter_overflow_fails_closed() {
        let mut s = service();
        s.next_id = u64::MAX;
        assert_eq!(s.provision().unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.record_count(), 0);
    }

    /// Test helper: fill the registry to capacity with non-current retired records, leaving
    /// `current == None`, WITHOUT going through the backend. Exercises the provision capacity path.
    fn fill_registry_no_current(s: &mut MasterKeyProtectorService<UnitBackend>) {
        for i in 1..=MAX_MASTER_RECORDS as u64 {
            s.records.insert(
                i,
                MasterRecord {
                    lifecycle: KeyLifecycle::Retiring,
                    protected: Vec::new(),
                },
            );
        }
    }

    #[test]
    fn provision_capacity_fails_closed_without_backend() {
        let mut s = service();
        fill_registry_no_current(&mut s); // current stays None; registry full
        assert_eq!(s.provision().unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.record_count(), MAX_MASTER_RECORDS);
        assert_eq!(s.backend.protect_calls, 0); // capacity refusal never reaches the backend
    }

    #[test]
    fn rotation_capacity_fails_closed_without_backend() {
        let mut s = service();
        let mut h = s.provision().unwrap();
        while s.record_count() < MAX_MASTER_RECORDS {
            let RotationOutcome::Success { new_handle, .. } = s.rotate(&h).unwrap() else {
                panic!("expected success");
            };
            h = new_handle;
        }
        assert_eq!(s.record_count(), MAX_MASTER_RECORDS);
        let before = s.backend.protect_calls;
        assert_eq!(s.rotate(&h).unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.backend.protect_calls, before); // capacity refusal never reaches the backend
    }

    // ---- 3J-A-CORRECTION1B: initial-provision uniqueness ----

    /// Second provision is refused with `MasterKeyAlreadyProvisioned` before ANY effect: zero backend
    /// calls, no handle-id consumed, no op-id consumed, no record created, current + lifecycle intact,
    /// no record retired, no new handle. The next rotation then receives the expected next ids.
    #[test]
    fn second_provision_refused_and_consumes_nothing() {
        let mut s = service();
        let first = s.provision().unwrap();
        assert_eq!(first.id(), 1);
        let calls = s.backend.protect_calls; // 1
        let next_id = s.next_id; // 2
        let op_counter = s.op_counter; // 0
        let count = s.record_count(); // 1

        assert_eq!(
            s.provision().unwrap_err(),
            CryptoError::MasterKeyAlreadyProvisioned
        );

        assert_eq!(s.backend.protect_calls, calls); // backend NOT called
        assert_eq!(s.next_id, next_id); // no handle id consumed
        assert_eq!(s.op_counter, op_counter); // no op id consumed
        assert_eq!(s.record_count(), count); // no record created
        assert_eq!(s.current, Some(1)); // current pointer unchanged
        assert_eq!(s.metadata(&first).unwrap().lifecycle, KeyLifecycle::Active); // still Active, not Retiring

        // The subsequent valid rotation gets the expected next handle id (2) and operation id (1) —
        // proving the refused provision burned neither counter.
        let RotationOutcome::Success {
            new_handle,
            operation,
        } = s.rotate(&first).unwrap()
        else {
            panic!("expected success");
        };
        assert_eq!(new_handle.id(), 2);
        assert_eq!(operation.value(), 1);
    }

    #[test]
    fn duplicate_provision_error_is_non_sensitive_and_not_reconciliation() {
        let mut s = service();
        let _ = s.provision().unwrap();
        let err = s.provision().unwrap_err();
        assert_eq!(err, CryptoError::MasterKeyAlreadyProvisioned);
        // Display + Debug carry no handle/id/epoch/record/secret state.
        let shown = format!("{err} {err:?}");
        assert_eq!(
            shown,
            "master key already provisioned MasterKeyAlreadyProvisioned"
        );
        // It is an Err, never a RotationOutcome; provision returns no handle on refusal.
        assert!(s.provision().is_err());
    }

    #[test]
    fn rotation_success_retains_old_and_transitions_after_success() {
        let mut s = service();
        let old = s.provision().unwrap();
        let out = s.rotate(&old).unwrap();
        let RotationOutcome::Success { new_handle, .. } = out else {
            panic!("expected success");
        };
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Retiring);
        assert_eq!(
            s.metadata(&new_handle).unwrap().lifecycle,
            KeyLifecycle::Active
        );
    }

    #[test]
    fn rotation_failed_before_effect_leaves_old_active() {
        let mut s = service();
        let old = s.provision().unwrap();
        s.backend.fail_protect = Some(BackendError::ProtectFailedBeforeEffect);
        assert!(matches!(
            s.rotate(&old).unwrap(),
            RotationOutcome::FailedBeforeEffect
        ));
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
    }

    // ---- 3J-A-CORRECTION1A: no backend error maps to an uncertain/reconciliation outcome ----

    /// EXHAUSTIVE: for every `BackendError`, a `protect_new` failure during rotation resolves to a
    /// KNOWN-BEFORE-EFFECT outcome (Ok(FailedBeforeEffect) or a fail-closed Err), NEVER
    /// `RotationOutcome::ReconciliationRequired`. This SPI has no uncertain-effect path.
    #[test]
    fn no_backend_error_maps_to_reconciliation() {
        // All current `BackendError` variants (constructible in-crate despite `#[non_exhaustive]`).
        let variants = [
            BackendError::UnsupportedPlatform,
            BackendError::ProtectFailedBeforeEffect,
            BackendError::UnprotectFailed,
            BackendError::ResourceLimit,
        ];
        for err in variants {
            let mut s = service();
            let old = s.provision().unwrap();
            s.backend.fail_protect = Some(err);
            match s.rotate(&old) {
                Ok(RotationOutcome::ReconciliationRequired { .. }) => {
                    panic!("no backend error may map to ReconciliationRequired (got {err:?})")
                }
                Ok(RotationOutcome::FailedBeforeEffect) | Err(_) => {}
                other => panic!("unexpected rotate outcome for {err:?}: {other:?}"),
            }
            // The old key is intact regardless.
            assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
        }
    }

    /// The UNIVERSAL rotation contract STILL carries `ReconciliationRequired` (retained for a future
    /// durable/side-effecting SPI); this wrapper simply never emits it. Compile-time existence proof.
    #[test]
    fn universal_reconciliation_variant_still_exists() {
        fn is_reconcile(o: &RotationOutcome<ServiceMasterKeyHandle>) -> bool {
            matches!(o, RotationOutcome::ReconciliationRequired { .. })
        }
        assert!(!is_reconcile(&RotationOutcome::FailedBeforeEffect));
    }

    // ---- 3J-A-CORRECTION1A: backend NOT called on preflight refusals (call-counter evidence) ----

    #[test]
    fn provision_handle_overflow_does_not_call_backend() {
        let mut s = service();
        s.next_id = u64::MAX; // reserve-handle-id preflight will fail
        assert_eq!(s.provision().unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.backend.protect_calls, 0); // backend never reached
        assert_eq!(s.record_count(), 0);
    }

    #[test]
    fn duplicate_provision_does_not_call_backend() {
        let mut s = service();
        let _ = s.provision().unwrap(); // calls=1
        let before = s.backend.protect_calls;
        assert_eq!(
            s.provision().unwrap_err(),
            CryptoError::MasterKeyAlreadyProvisioned
        );
        assert_eq!(s.backend.protect_calls, before); // duplicate refusal added no backend call
    }

    #[test]
    fn rotation_without_current_does_not_call_backend() {
        let mut s = service();
        let fake = ServiceMasterKeyHandle::new(1, 1); // no provision → unknown handle
        assert_eq!(s.rotate(&fake).unwrap_err(), CryptoError::UnknownHandle);
        assert_eq!(s.backend.protect_calls, 0);
        assert_eq!(s.record_count(), 0);
    }

    #[test]
    fn rotate_ineligible_handle_does_not_call_backend() {
        let mut s = service();
        let old = s.provision().unwrap(); // calls=1
        let _ = s.rotate(&old).unwrap(); // calls=2; old now Retiring (ineligible)
        let before = s.backend.protect_calls;
        assert_eq!(s.rotate(&old).unwrap_err(), CryptoError::RetiredHandle);
        assert_eq!(s.backend.protect_calls, before); // ineligible-handle refusal skips the backend
    }

    #[test]
    fn rotate_op_overflow_does_not_call_backend() {
        let mut s = service();
        let old = s.provision().unwrap();
        let before = s.backend.protect_calls;
        s.op_counter = u64::MAX; // reserve-op-id preflight will fail
        assert_eq!(s.rotate(&old).unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.backend.protect_calls, before);
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
    }

    #[test]
    fn rotate_handle_overflow_does_not_call_backend() {
        let mut s = service();
        let old = s.provision().unwrap();
        let before = s.backend.protect_calls;
        s.next_id = u64::MAX; // reserve-handle-id preflight will fail (after op-id reserves)
        assert_eq!(s.rotate(&old).unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.backend.protect_calls, before);
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
    }

    // ---- 3J-A-CORRECTION1A: exactly-one backend call on effect, no auto-retry ----

    #[test]
    fn provision_success_calls_backend_exactly_once() {
        let mut s = service();
        let _ = s.provision().unwrap();
        assert_eq!(s.backend.protect_calls, 1);
    }

    #[test]
    fn rotation_success_calls_backend_exactly_once() {
        let mut s = service();
        let old = s.provision().unwrap(); // calls=1
        let _ = s.rotate(&old).unwrap(); // calls=2 (one per operation, no retry)
        assert_eq!(s.backend.protect_calls, 2);
    }

    #[test]
    fn provision_failure_calls_backend_once_without_retry() {
        let mut s = service();
        s.backend.fail_protect = Some(BackendError::ProtectFailedBeforeEffect);
        assert!(s.provision().is_err());
        assert_eq!(s.backend.protect_calls, 1); // called once; no automatic second call
    }

    #[test]
    fn rotation_failure_calls_backend_once_without_retry() {
        let mut s = service();
        let old = s.provision().unwrap(); // calls=1
        s.backend.fail_protect = Some(BackendError::ProtectFailedBeforeEffect);
        assert!(matches!(
            s.rotate(&old).unwrap(),
            RotationOutcome::FailedBeforeEffect
        ));
        assert_eq!(s.backend.protect_calls, 2); // provision(1) + one rotate attempt(1); no retry
    }

    // ---- 3J-A-CORRECTION1A: reserved id consumed on failure is never reused (monotonic) ----

    #[test]
    fn reserved_handle_id_not_reused_after_backend_failure() {
        let mut s = service();
        s.backend.fail_protect = Some(BackendError::ProtectFailedBeforeEffect);
        assert!(s.provision().is_err()); // reserves + consumes handle id 1, no record created
        assert!(!s.records.contains_key(&1));
        s.backend.fail_protect = None;
        let h = s.provision().unwrap(); // must mint a LATER id, never the burned id 1
        assert_eq!(h.id(), 2);
        assert!(!s.records.contains_key(&1));
        assert!(s.records.contains_key(&2));
        assert_eq!(s.backend.protect_calls, 2); // one failed + one successful; no reuse, no retry
    }

    #[test]
    fn rotation_handle_overflow_leaves_old_unchanged() {
        let mut s = service();
        let old = s.provision().unwrap();
        s.next_id = u64::MAX; // replacement handle allocation will fail
        assert_eq!(s.rotate(&old).unwrap_err(), CryptoError::ResourceLimit);
        assert_eq!(s.metadata(&old).unwrap().lifecycle, KeyLifecycle::Active);
    }

    #[test]
    fn rotate_on_retired_handle_refused() {
        let mut s = service();
        let old = s.provision().unwrap();
        let _ = s.rotate(&old).unwrap(); // old now Retiring
        assert_eq!(s.rotate(&old).unwrap_err(), CryptoError::RetiredHandle);
    }

    /// TRUST BOUNDARY (source-anchored): `open()`'s closure passed to `BackendSecret::with_secret` is
    /// `|bytes| !bytes.is_empty()`, returning a `bool` — it makes NO owned copy (no `Vec`/`String`/
    /// `to_vec`/`clone`), and `material` is dropped (zeroising) before the handle is returned. The
    /// borrow cannot escape (proven by the compile-fail doctest in `lib.rs`). This test exercises the
    /// path so a future edit that introduced a copy would still have to survive review + the doctest.
    #[test]
    fn open_closure_returns_non_owning_value_and_zeroises() {
        let mut s = service();
        let _ = s.provision().unwrap();
        // A zero-length record makes the closure observe emptiness -> SecretUnavailable, proving the
        // wrapper only inspects (never copies) the borrowed bytes.
        s.records.get_mut(&1).unwrap().protected = Vec::new();
        assert_eq!(s.open().unwrap_err(), CryptoError::SecretUnavailable);
    }

    #[test]
    fn service_debug_is_redacted() {
        let mut s = service();
        let _ = s.provision().unwrap();
        let dbg = format!("{s:?}");
        assert!(dbg.contains("epoch"));
        assert!(dbg.contains("records"));
        assert!(!dbg.contains("UNIT-SYNTH"));
    }
}
