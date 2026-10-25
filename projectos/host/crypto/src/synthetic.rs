//! TEST-ONLY deterministic synthetic adapter + the adversarial suite. This module is `#[cfg(test)]`:
//! it does NOT exist in a non-test build, so it cannot enter a production path. It implements the
//! contracts with UNMISTAKABLY synthetic, non-cryptographic outputs (marker bytes + a non-crypto
//! fold). It makes NO confidentiality or integrity claim, performs NO real encryption, and does NOT
//! retain plaintext after an operation.

use std::collections::BTreeMap;

use projectos_trust_contract::{CredentialRef, EnvironmentId, ProjectId, ProviderId};

use crate::aad::{build_associated_data, AssociatedData};
use crate::adapter::{
    CredentialCipher, CryptoOperationKind, CryptoReconciler, MasterKeyMetadata, MasterKeyProtector,
    ProjectDekManager, ReconcileResult, RotationOutcome,
};
use crate::error::CryptoError;
use crate::handle::{
    CryptoOperationId, KeyLifecycle, KeyRole, ProjectDekHandle, ServiceMasterKeyHandle,
};
use crate::material::{
    AadBinding, AuthenticationTag, EncryptedCredentialMaterial, EncryptionArtifact, NonceMaterial,
    PlaintextCredential, WrappedProjectDek,
};
use crate::policy::{CryptoAlgorithm, KeyVersion, NONCE_SIZE_BYTES};
use crate::scope::CredentialScope;

const MAX_ACTIVE_HANDLES: usize = 64;
const MAX_RETAINED_VERSIONS_PER_PROJECT: usize = 16;
const WRAP_MARKER: u8 = 0xDD;

/// A deterministic, non-cryptographic 64-bit fold (FNV-1a-style). NOT collision-resistant against an
/// adversary; models a binding token only.
fn fold(seed: u64, data: &[u8]) -> u64 {
    let mut h = seed;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// A synthetic 16-byte "tag" binding the AAD and key version. NON-CRYPTOGRAPHIC.
fn synth_tag(aad: &[u8], key_version: KeyVersion) -> [u8; 16] {
    let a = fold(0xcbf2_9ce4_8422_2325, aad);
    let b = fold(0x8422_2325_cbf2_9ce4 ^ key_version.value(), aad);
    let mut out = [0u8; 16];
    out[..8].copy_from_slice(&a.to_be_bytes());
    out[8..].copy_from_slice(&b.to_be_bytes());
    out
}

/// The adapter's synthetic associated-data BINDING (8 bytes). NON-CRYPTOGRAPHIC; a real adapter would
/// produce a real MAC/digest here. This generator exists ONLY in this `#[cfg(test)]` module.
fn synth_aad_binding(aad: &[u8]) -> Vec<u8> {
    fold(0x1000_0000_0000_01b3, aad).to_be_bytes().to_vec()
}

struct DekEntry {
    project: ProjectId,
    version: KeyVersion,
    lifecycle: KeyLifecycle,
}

struct MasterEntry {
    lifecycle: KeyLifecycle,
}

/// The resolved-or-pending state of a protected operation, recorded for read-only reconciliation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconState {
    Succeeded,
    FailedBeforeEffect,
    Unknown,
}

/// The synthetic adapter. `epoch` models process/adapter lifetime: a restart bumps the epoch and
/// clears ephemeral DEK handles, so handles from before a restart are refused. Masters are keyed by
/// id so an old (retiring) master and a new master can coexist during a rewrap. `op_counter` is a
/// SEPARATE monotonic counter for crypto-operation ids (never reused as a handle id). `reconciliations`
/// records the outcome of protected operations for read-only reconciliation queries.
struct SyntheticCrypto {
    epoch: u64,
    next_id: u64,
    op_counter: u64,
    masters: BTreeMap<u64, MasterEntry>,
    current_master: Option<u64>,
    deks: BTreeMap<u64, DekEntry>,
    reconciliations: BTreeMap<u64, (CryptoOperationKind, ReconState)>,
    inject: Option<Inject>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Inject {
    EncryptFailure,
    RotateFailedBeforeEffect,
    RotateReconciliationRequired,
}

impl SyntheticCrypto {
    fn new() -> Self {
        Self {
            epoch: 1,
            next_id: 1,
            op_counter: 0,
            masters: BTreeMap::new(),
            current_master: None,
            deks: BTreeMap::new(),
            reconciliations: BTreeMap::new(),
            inject: None,
        }
    }

    fn simulate_restart(&mut self) {
        self.epoch += 1;
        self.deks.clear(); // ephemeral DEK handles do not survive a restart
                           // The protected master state survives but must be re-opened for a handle at the new epoch.
    }

    /// Reserve a fresh crypto-operation id from the checked counter (distinct from handle ids).
    fn alloc_op(&mut self) -> Result<u64, CryptoError> {
        let next = self
            .op_counter
            .checked_add(1)
            .ok_or(CryptoError::ResourceLimit)?;
        self.op_counter = next;
        Ok(next)
    }

    /// Reserve an id and record its outcome for later reconciliation.
    fn record_op(
        &mut self,
        kind: CryptoOperationKind,
        state: ReconState,
    ) -> Result<CryptoOperationId, CryptoError> {
        let id = self.alloc_op()?;
        self.reconciliations.insert(id, (kind, state));
        CryptoOperationId::new(id)
    }

    /// TEST-ONLY: drive the operation-id counter (to exercise checked overflow).
    fn set_op_counter_for_test(&mut self, value: u64) {
        self.op_counter = value;
    }

    /// TEST-ONLY: model an external governed resolution of a previously-unknown operation. A
    /// reconciliation QUERY is read-only; this seam is the separate action that resolves the state.
    fn resolve_reconciliation_for_test(&mut self, id: CryptoOperationId, state: ReconState) {
        if let Some(entry) = self.reconciliations.get_mut(&id.value()) {
            entry.1 = state;
        }
    }

    fn master_lifecycle(&self, h: &ServiceMasterKeyHandle) -> Result<KeyLifecycle, CryptoError> {
        if h.epoch() != self.epoch {
            return Err(CryptoError::UnknownHandle);
        }
        self.masters
            .get(&h.id())
            .map(|m| m.lifecycle)
            .ok_or(CryptoError::UnknownHandle)
    }

    fn master_active(&self, h: &ServiceMasterKeyHandle) -> Result<(), CryptoError> {
        match self.master_lifecycle(h)? {
            KeyLifecycle::Active => Ok(()),
            KeyLifecycle::Retiring => Err(CryptoError::RetiredHandle),
            KeyLifecycle::Revoked => Err(CryptoError::RevokedHandle),
        }
    }

    fn master_usable(&self, h: &ServiceMasterKeyHandle) -> Result<(), CryptoError> {
        match self.master_lifecycle(h)? {
            KeyLifecycle::Active | KeyLifecycle::Retiring => Ok(()),
            KeyLifecycle::Revoked => Err(CryptoError::RevokedHandle),
        }
    }

    fn dek_lifecycle(&self, h: &ProjectDekHandle) -> Result<KeyLifecycle, CryptoError> {
        if h.epoch() != self.epoch {
            return Err(CryptoError::UnknownHandle);
        }
        let entry = self.deks.get(&h.id()).ok_or(CryptoError::UnknownHandle)?;
        if &entry.project != h.project() || entry.version != h.key_version() {
            return Err(CryptoError::UnknownHandle);
        }
        Ok(entry.lifecycle)
    }

    fn require_encrypt(&self, h: &ProjectDekHandle) -> Result<(), CryptoError> {
        match self.dek_lifecycle(h)? {
            KeyLifecycle::Active => Ok(()),
            KeyLifecycle::Retiring => Err(CryptoError::RetiredHandle),
            KeyLifecycle::Revoked => Err(CryptoError::RevokedHandle),
        }
    }

    fn require_decrypt(&self, h: &ProjectDekHandle) -> Result<(), CryptoError> {
        match self.dek_lifecycle(h)? {
            KeyLifecycle::Active | KeyLifecycle::Retiring => Ok(()),
            KeyLifecycle::Revoked => Err(CryptoError::RevokedHandle),
        }
    }

    fn insert_dek(
        &mut self,
        project: ProjectId,
        version: KeyVersion,
        lifecycle: KeyLifecycle,
    ) -> Result<ProjectDekHandle, CryptoError> {
        if self.deks.len() >= MAX_ACTIVE_HANDLES {
            return Err(CryptoError::ResourceLimit);
        }
        let per_project = self.deks.values().filter(|e| e.project == project).count();
        if per_project >= MAX_RETAINED_VERSIONS_PER_PROJECT {
            return Err(CryptoError::ResourceLimit);
        }
        let id = self.next_id;
        self.next_id += 1;
        self.deks.insert(
            id,
            DekEntry {
                project: project.clone(),
                version,
                lifecycle,
            },
        );
        Ok(ProjectDekHandle::new(id, self.epoch, project, version))
    }
}

impl MasterKeyProtector for SyntheticCrypto {
    fn provision(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError> {
        let id = self.next_id;
        self.next_id += 1;
        self.masters.insert(
            id,
            MasterEntry {
                lifecycle: KeyLifecycle::Active,
            },
        );
        self.current_master = Some(id);
        Ok(ServiceMasterKeyHandle::new(id, self.epoch))
    }

    fn open(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError> {
        let id = self.current_master.ok_or(CryptoError::SecretUnavailable)?;
        Ok(ServiceMasterKeyHandle::new(id, self.epoch))
    }

    fn rotate(
        &mut self,
        current: &ServiceMasterKeyHandle,
    ) -> Result<RotationOutcome<ServiceMasterKeyHandle>, CryptoError> {
        self.master_active(current)?;
        let new_id = self.next_id;
        self.next_id += 1;
        // Old master retained (retiring) until the replacement is in effect.
        if let Some(old) = self.masters.get_mut(&current.id()) {
            old.lifecycle = KeyLifecycle::Retiring;
        }
        self.masters.insert(
            new_id,
            MasterEntry {
                lifecycle: KeyLifecycle::Active,
            },
        );
        self.current_master = Some(new_id);
        let operation =
            self.record_op(CryptoOperationKind::MasterRotation, ReconState::Succeeded)?;
        Ok(RotationOutcome::Success {
            new_handle: ServiceMasterKeyHandle::new(new_id, self.epoch),
            operation,
        })
    }

    fn metadata(&self, handle: &ServiceMasterKeyHandle) -> Result<MasterKeyMetadata, CryptoError> {
        let lifecycle = self.master_lifecycle(handle)?;
        Ok(MasterKeyMetadata {
            key_role: KeyRole::Master,
            lifecycle,
        })
    }
}

impl ProjectDekManager for SyntheticCrypto {
    fn create_dek(
        &mut self,
        master: &ServiceMasterKeyHandle,
        project: &ProjectId,
    ) -> Result<ProjectDekHandle, CryptoError> {
        self.master_active(master)?;
        let version = KeyVersion::new(1)?;
        self.insert_dek(project.clone(), version, KeyLifecycle::Active)
    }

    fn wrap(
        &mut self,
        master: &ServiceMasterKeyHandle,
        dek: &ProjectDekHandle,
    ) -> Result<WrappedProjectDek, CryptoError> {
        // Wrapping a NEW project key requires an Active master and a non-revoked DEK.
        self.master_active(master)?;
        if self.dek_lifecycle(dek)? == KeyLifecycle::Revoked {
            return Err(CryptoError::RevokedHandle);
        }
        // Synthetic opaque wrapped token that encodes the project + version binding.
        let project_bytes = dek.project().as_str().as_bytes();
        let len = u16::try_from(project_bytes.len()).map_err(|_| CryptoError::InvalidIdentity)?;
        let mut bytes = vec![WRAP_MARKER];
        bytes.extend_from_slice(&len.to_be_bytes());
        bytes.extend_from_slice(project_bytes);
        bytes.extend_from_slice(&dek.key_version().value().to_be_bytes());
        WrappedProjectDek::new(bytes, dek.key_version(), CryptoAlgorithm::Aes256Gcm)
    }

    fn unwrap(
        &mut self,
        master: &ServiceMasterKeyHandle,
        wrapped: &WrappedProjectDek,
        project: &ProjectId,
    ) -> Result<ProjectDekHandle, CryptoError> {
        // Unwrapping (a decrypt-like operation) is permitted under a retiring master.
        self.master_usable(master)?;
        if wrapped.algorithm() != CryptoAlgorithm::Aes256Gcm {
            return Err(CryptoError::UnsupportedAlgorithm);
        }
        let (parsed_project, parsed_version) = parse_wrapped(wrapped.wrapped_bytes())?;
        if parsed_project.as_str() != project.as_str() {
            return Err(CryptoError::ScopeMismatch);
        }
        if parsed_version != wrapped.key_version().value() {
            return Err(CryptoError::KeyVersionMismatch);
        }
        let version = KeyVersion::new(parsed_version)?;
        self.insert_dek(project.clone(), version, KeyLifecycle::Active)
    }

    fn rotate_dek(
        &mut self,
        master: &ServiceMasterKeyHandle,
        current: &ProjectDekHandle,
    ) -> Result<RotationOutcome<ProjectDekHandle>, CryptoError> {
        self.master_active(master)?;
        self.dek_lifecycle(current)?;
        match self.inject {
            Some(Inject::RotateFailedBeforeEffect) => {
                return Ok(RotationOutcome::FailedBeforeEffect)
            }
            Some(Inject::RotateReconciliationRequired) => {
                let operation =
                    self.record_op(CryptoOperationKind::ProjectDekRotation, ReconState::Unknown)?;
                return Ok(RotationOutcome::ReconciliationRequired { operation });
            }
            _ => {}
        }
        let new_version = current.key_version().next()?;
        // Old key retained as Retiring (not destroyed) until the new key is proven created.
        let new_handle =
            self.insert_dek(current.project().clone(), new_version, KeyLifecycle::Active)?;
        if let Some(entry) = self.deks.get_mut(&current.id()) {
            entry.lifecycle = KeyLifecycle::Retiring;
        }
        let operation = self.record_op(
            CryptoOperationKind::ProjectDekRotation,
            ReconState::Succeeded,
        )?;
        Ok(RotationOutcome::Success {
            new_handle,
            operation,
        })
    }

    fn rewrap(
        &mut self,
        old_master: &ServiceMasterKeyHandle,
        new_master: &ServiceMasterKeyHandle,
        wrapped: &WrappedProjectDek,
        project: &ProjectId,
    ) -> Result<RotationOutcome<WrappedProjectDek>, CryptoError> {
        self.master_usable(old_master)?;
        self.master_active(new_master)?;
        let (parsed_project, parsed_version) = parse_wrapped(wrapped.wrapped_bytes())?;
        if parsed_project.as_str() != project.as_str() {
            return Err(CryptoError::ScopeMismatch);
        }
        match self.inject {
            Some(Inject::RotateFailedBeforeEffect) => {
                return Ok(RotationOutcome::FailedBeforeEffect)
            }
            Some(Inject::RotateReconciliationRequired) => {
                let operation =
                    self.record_op(CryptoOperationKind::ProjectDekRewrap, ReconState::Unknown)?;
                return Ok(RotationOutcome::ReconciliationRequired { operation });
            }
            _ => {}
        }
        // New opaque wrapped token under the new master (synthetic).
        let version = KeyVersion::new(parsed_version)?;
        let project_bytes = project.as_str().as_bytes();
        let len = u16::try_from(project_bytes.len()).map_err(|_| CryptoError::InvalidIdentity)?;
        let mut bytes = vec![WRAP_MARKER];
        bytes.extend_from_slice(&len.to_be_bytes());
        bytes.extend_from_slice(project_bytes);
        bytes.extend_from_slice(&version.value().to_be_bytes());
        let new_handle = WrappedProjectDek::new(bytes, version, CryptoAlgorithm::Aes256Gcm)?;
        let operation =
            self.record_op(CryptoOperationKind::ProjectDekRewrap, ReconState::Succeeded)?;
        Ok(RotationOutcome::Success {
            new_handle,
            operation,
        })
    }

    fn revoke(&mut self, dek: &ProjectDekHandle) -> Result<(), CryptoError> {
        if dek.epoch() != self.epoch {
            return Err(CryptoError::UnknownHandle);
        }
        let entry = self
            .deks
            .get_mut(&dek.id())
            .ok_or(CryptoError::UnknownHandle)?;
        entry.lifecycle = KeyLifecycle::Revoked;
        Ok(())
    }
}

impl CredentialCipher for SyntheticCrypto {
    fn encrypt(
        &mut self,
        dek: &ProjectDekHandle,
        scope: &CredentialScope,
        plaintext: &PlaintextCredential,
        aad: &AssociatedData,
    ) -> Result<EncryptionArtifact, CryptoError> {
        if self.inject == Some(Inject::EncryptFailure) {
            return Err(CryptoError::SyntheticFailure);
        }
        self.require_encrypt(dek)?;
        if dek.project() != scope.project() {
            return Err(CryptoError::ScopeMismatch);
        }
        if aad.is_empty() {
            return Err(CryptoError::InvalidAssociatedData);
        }
        // Synthetic, CONTENT-INDEPENDENT ciphertext: a marker byte repeated to the plaintext length
        // (length is observable, exactly as GCM would reveal it). The plaintext is NOT stored.
        let ciphertext = vec![0xEE; plaintext.len()];
        let nonce = NonceMaterial::from_bytes(&[0xAB; NONCE_SIZE_BYTES])?;
        let tag = AuthenticationTag::from_bytes(&synth_tag(aad.as_bytes(), dek.key_version()))?;
        let material = EncryptedCredentialMaterial::new(
            nonce,
            ciphertext,
            tag,
            dek.key_version(),
            CryptoAlgorithm::Aes256Gcm,
        )?;
        let binding = AadBinding::new(synth_aad_binding(aad.as_bytes()))?;
        Ok(EncryptionArtifact::new(material, scope.clone(), binding))
    }

    fn decrypt(
        &mut self,
        dek: &ProjectDekHandle,
        scope: &CredentialScope,
        material: &EncryptedCredentialMaterial,
        aad: &AssociatedData,
    ) -> Result<PlaintextCredential, CryptoError> {
        self.require_decrypt(dek)?;
        if dek.project() != scope.project() {
            return Err(CryptoError::ScopeMismatch);
        }
        if material.algorithm() != CryptoAlgorithm::Aes256Gcm {
            return Err(CryptoError::UnsupportedAlgorithm);
        }
        if material.key_version() != dek.key_version() {
            return Err(CryptoError::KeyVersionMismatch);
        }
        // Synthetic AAD authentication: the tag must match the recomputed AAD/version binding.
        let expected = synth_tag(aad.as_bytes(), dek.key_version());
        if material.tag().as_bytes() != expected {
            return Err(CryptoError::InvalidAssociatedData);
        }
        // Synthetic recovered plaintext PLACEHOLDER (NOT the original bytes). No plaintext is retained.
        PlaintextCredential::from_bytes(vec![0x5A; material.ciphertext().len()])
    }

    fn reencrypt(
        &mut self,
        old_dek: &ProjectDekHandle,
        new_dek: &ProjectDekHandle,
        scope: &CredentialScope,
        material: &EncryptedCredentialMaterial,
        old_aad: &AssociatedData,
        new_aad: &AssociatedData,
    ) -> Result<RotationOutcome<EncryptionArtifact>, CryptoError> {
        self.require_decrypt(old_dek)?;
        self.require_encrypt(new_dek)?;
        if old_dek.project() != scope.project() || new_dek.project() != scope.project() {
            return Err(CryptoError::ScopeMismatch);
        }
        if material.key_version() != old_dek.key_version() {
            return Err(CryptoError::KeyVersionMismatch);
        }
        let expected = synth_tag(old_aad.as_bytes(), old_dek.key_version());
        if material.tag().as_bytes() != expected {
            return Err(CryptoError::InvalidAssociatedData);
        }
        if let Some(Inject::RotateReconciliationRequired) = self.inject {
            let operation = self.record_op(
                CryptoOperationKind::CredentialReencryption,
                ReconState::Unknown,
            )?;
            return Ok(RotationOutcome::ReconciliationRequired { operation });
        }
        let ciphertext = vec![0xEE; material.ciphertext().len()];
        let nonce = NonceMaterial::from_bytes(&[0xAB; NONCE_SIZE_BYTES])?;
        let tag =
            AuthenticationTag::from_bytes(&synth_tag(new_aad.as_bytes(), new_dek.key_version()))?;
        let new_material = EncryptedCredentialMaterial::new(
            nonce,
            ciphertext,
            tag,
            new_dek.key_version(),
            CryptoAlgorithm::Aes256Gcm,
        )?;
        let binding = AadBinding::new(synth_aad_binding(new_aad.as_bytes()))?;
        let operation = self.record_op(
            CryptoOperationKind::CredentialReencryption,
            ReconState::Succeeded,
        )?;
        Ok(RotationOutcome::Success {
            new_handle: EncryptionArtifact::new(new_material, scope.clone(), binding),
            operation,
        })
    }
}

impl CryptoReconciler for SyntheticCrypto {
    fn reconcile(
        &self,
        operation_id: CryptoOperationId,
        kind: CryptoOperationKind,
    ) -> Result<ReconcileResult, CryptoError> {
        let (recorded_kind, state) = self
            .reconciliations
            .get(&operation_id.value())
            .ok_or(CryptoError::UnknownOperation)?;
        if *recorded_kind != kind {
            return Err(CryptoError::UnknownOperation);
        }
        Ok(match state {
            ReconState::Succeeded => ReconcileResult::Succeeded,
            ReconState::FailedBeforeEffect => ReconcileResult::FailedBeforeEffect,
            ReconState::Unknown => ReconcileResult::StillUnknown,
        })
    }
}

fn parse_wrapped(bytes: &[u8]) -> Result<(ProjectId, u64), CryptoError> {
    if bytes.first() != Some(&WRAP_MARKER) || bytes.len() < 3 {
        return Err(CryptoError::InvalidIdentity);
    }
    let len = usize::from(u16::from_be_bytes([bytes[1], bytes[2]]));
    let project_end = 3 + len;
    if bytes.len() != project_end + 8 {
        return Err(CryptoError::InvalidIdentity);
    }
    let project_str =
        std::str::from_utf8(&bytes[3..project_end]).map_err(|_| CryptoError::InvalidIdentity)?;
    let project = ProjectId::new(project_str).map_err(|_| CryptoError::InvalidIdentity)?;
    let version = u64::from_be_bytes(
        bytes[project_end..]
            .try_into()
            .map_err(|_| CryptoError::InvalidIdentity)?,
    );
    Ok((project, version))
}

// ============================ ADVERSARIAL SUITE ============================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{KEY_SIZE_BYTES, TAG_SIZE_BYTES};

    fn pid(s: &str) -> ProjectId {
        ProjectId::new(s).unwrap()
    }
    fn scope(project: &str, provider: &str, env: &str, cref: &str) -> CredentialScope {
        CredentialScope::new(
            pid(project),
            ProviderId::new(provider).unwrap(),
            EnvironmentId::new(env).unwrap(),
            CredentialRef::new(cref).unwrap(),
        )
    }
    fn aad_for(scope: &CredentialScope, version: KeyVersion) -> AssociatedData {
        build_associated_data(scope, 1, 7, version, CryptoAlgorithm::Aes256Gcm).unwrap()
    }
    fn plaintext() -> PlaintextCredential {
        PlaintextCredential::from_bytes(b"supersecretsyntheticbytes".to_vec()).unwrap()
    }

    /// Master + one Active DEK for `project`.
    fn bootstrap(project: &str) -> (SyntheticCrypto, ServiceMasterKeyHandle, ProjectDekHandle) {
        let mut c = SyntheticCrypto::new();
        let master = c.provision().unwrap();
        let dek = c.create_dek(&master, &pid(project)).unwrap();
        (c, master, dek)
    }

    // ---- type safety / policy ----

    #[test]
    fn algorithm_policy_is_closed() {
        assert_eq!(
            CryptoAlgorithm::from_identifier("AES-256-GCM").unwrap(),
            CryptoAlgorithm::Aes256Gcm
        );
        for bad in ["AES-128-GCM", "AES-256-CBC", "ECB", "XOR", "chacha20", ""] {
            assert_eq!(
                CryptoAlgorithm::from_identifier(bad).unwrap_err(),
                CryptoError::UnsupportedAlgorithm
            );
        }
    }

    #[test]
    fn key_version_zero_rejected() {
        assert_eq!(
            KeyVersion::new(0).unwrap_err(),
            CryptoError::InvalidRevision
        );
        assert_eq!(KeyVersion::new(1).unwrap().value(), 1);
    }

    #[test]
    fn nonce_and_tag_sizes_enforced() {
        assert!(NonceMaterial::from_bytes(&[0u8; NONCE_SIZE_BYTES]).is_ok());
        assert_eq!(
            NonceMaterial::from_bytes(&[0u8; 8]).unwrap_err(),
            CryptoError::InvalidNonceSize
        );
        assert!(AuthenticationTag::from_bytes(&[0u8; TAG_SIZE_BYTES]).is_ok());
        assert_eq!(
            AuthenticationTag::from_bytes(&[0u8; 8]).unwrap_err(),
            CryptoError::InvalidTagSize
        );
    }

    #[test]
    fn secret_types_debug_is_redacted() {
        let pt = PlaintextCredential::from_bytes(b"supersecretbytes".to_vec()).unwrap();
        let dbg = format!("{pt:?}");
        assert!(!dbg.contains("supersecret"), "plaintext debug leaked");
        assert!(dbg.contains("len"));

        let (mut c, _m, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        let mdbg = format!("{material:?}");
        assert!(mdbg.contains("ciphertext_len"));
        // Wrapped debug shows only lengths/version.
        let master = c.open().unwrap();
        let wrapped = c.wrap(&master, &dek).unwrap();
        let wdbg = format!("{wrapped:?}");
        assert!(wdbg.contains("len"));
        assert!(wdbg.contains("key_version"));
    }

    #[test]
    fn plaintext_bounds_enforced() {
        assert_eq!(
            PlaintextCredential::from_bytes(vec![]).unwrap_err(),
            CryptoError::SecretUnavailable
        );
        assert_eq!(
            PlaintextCredential::from_bytes(vec![0u8; crate::material::MAX_PLAINTEXT_BYTES + 1])
                .unwrap_err(),
            CryptoError::ResourceLimit
        );
    }

    // ---- key roles & scope ----

    #[test]
    fn handle_roles_are_distinct() {
        let (c, master, dek) = bootstrap("polygo");
        assert_eq!(master.role(), KeyRole::Master);
        assert_eq!(dek.role(), KeyRole::ProjectDek);
        // A master handle CANNOT be passed where a ProjectDekHandle is required — that is a
        // compile-time type error, not a runtime check. (See adapter trait signatures.)
        let _ = c;
    }

    #[test]
    fn cross_project_encrypt_refused() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let other = scope("other-project", "supabase", "staging", "cred-1");
        let err = c
            .encrypt(
                &dek,
                &other,
                &plaintext(),
                &aad_for(&other, dek.key_version()),
            )
            .unwrap_err();
        assert_eq!(err, CryptoError::ScopeMismatch);
    }

    #[test]
    fn cross_project_unwrap_refused() {
        let (mut c, master, dek) = bootstrap("polygo");
        let wrapped = c.wrap(&master, &dek).unwrap();
        let err = c
            .unwrap(&master, &wrapped, &pid("other-project"))
            .unwrap_err();
        assert_eq!(err, CryptoError::ScopeMismatch);
    }

    #[test]
    fn decrypt_provider_mismatch_refused() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let enc_scope = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(
                &dek,
                &enc_scope,
                &plaintext(),
                &aad_for(&enc_scope, dek.key_version()),
            )
            .unwrap();
        // Decrypt claiming a different provider → different AAD → tag mismatch.
        let dec_scope = scope("polygo", "vercel", "staging", "cred-1");
        let err = c
            .decrypt(
                &dek,
                &dec_scope,
                material.material(),
                &aad_for(&dec_scope, dek.key_version()),
            )
            .unwrap_err();
        assert_eq!(err, CryptoError::InvalidAssociatedData);
    }

    #[test]
    fn decrypt_environment_and_ref_mismatch_refused() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let enc = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(&dek, &enc, &plaintext(), &aad_for(&enc, dek.key_version()))
            .unwrap();
        for dec in [
            scope("polygo", "supabase", "production", "cred-1"),
            scope("polygo", "supabase", "staging", "cred-2"),
        ] {
            let err = c
                .decrypt(
                    &dek,
                    &dec,
                    material.material(),
                    &aad_for(&dec, dek.key_version()),
                )
                .unwrap_err();
            assert_eq!(err, CryptoError::InvalidAssociatedData);
        }
    }

    #[test]
    fn key_version_mismatch_refused() {
        let (mut c, master, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        // Rotate to obtain a v2 handle, then decrypt v1 material with the v2 handle.
        let RotationOutcome::Success { new_handle, .. } = c.rotate_dek(&master, &dek).unwrap()
        else {
            panic!("rotate should succeed");
        };
        let err = c
            .decrypt(
                &new_handle,
                &s,
                material.material(),
                &aad_for(&s, new_handle.key_version()),
            )
            .unwrap_err();
        assert_eq!(err, CryptoError::KeyVersionMismatch);
    }

    // ---- handles ----

    #[test]
    fn revoked_handle_cannot_encrypt() {
        let (mut c, _m, dek) = bootstrap("polygo");
        c.revoke(&dek).unwrap();
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let err = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap_err();
        assert_eq!(err, CryptoError::RevokedHandle);
    }

    #[test]
    fn retiring_handle_decrypts_but_cannot_encrypt() {
        let (mut c, master, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        // Rotate: old dek becomes Retiring.
        let _ = c.rotate_dek(&master, &dek).unwrap();
        // Encrypt with retiring old handle → refused.
        assert_eq!(
            c.encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
                .unwrap_err(),
            CryptoError::RetiredHandle
        );
        // Decrypt with retiring old handle → allowed.
        assert!(c
            .decrypt(
                &dek,
                &s,
                material.material(),
                &aad_for(&s, dek.key_version())
            )
            .is_ok());
    }

    #[test]
    fn copied_handle_after_restart_is_unknown() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let copied = dek.clone(); // copying the opaque handle grants nothing
        c.simulate_restart();
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let err = c
            .encrypt(
                &copied,
                &s,
                &plaintext(),
                &aad_for(&s, copied.key_version()),
            )
            .unwrap_err();
        assert_eq!(err, CryptoError::UnknownHandle);
    }

    #[test]
    fn unknown_handle_refused() {
        let (mut c, master, _dek) = bootstrap("polygo");
        // A fabricated handle (id never issued by this adapter) is unknown.
        let bogus =
            ProjectDekHandle::new(999_999, c.epoch, pid("polygo"), KeyVersion::new(1).unwrap());
        let err = c.wrap(&master, &bogus).unwrap_err();
        assert_eq!(err, CryptoError::UnknownHandle);
    }

    // ---- rotation ----

    #[test]
    fn rotate_success_retains_old_until_new_created() {
        let (mut c, master, dek) = bootstrap("polygo");
        let out = c.rotate_dek(&master, &dek).unwrap();
        let RotationOutcome::Success { new_handle, .. } = out else {
            panic!("expected success");
        };
        assert_eq!(new_handle.key_version().value(), 2);
        // Old handle still exists (Retiring), can still decrypt.
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Retiring);
    }

    #[test]
    fn rotate_failed_before_effect_leaves_old_active() {
        let (mut c, master, dek) = bootstrap("polygo");
        c.inject = Some(Inject::RotateFailedBeforeEffect);
        assert_eq!(
            c.rotate_dek(&master, &dek).unwrap(),
            RotationOutcome::FailedBeforeEffect
        );
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn rotate_reconciliation_required_does_not_destroy_old() {
        let (mut c, master, dek) = bootstrap("polygo");
        c.inject = Some(Inject::RotateReconciliationRequired);
        let out = c.rotate_dek(&master, &dek).unwrap();
        assert!(matches!(
            out,
            RotationOutcome::ReconciliationRequired { .. }
        ));
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn revoked_old_key_cannot_encrypt_after_rotation() {
        let (mut c, master, dek) = bootstrap("polygo");
        let _ = c.rotate_dek(&master, &dek).unwrap();
        c.revoke(&dek).unwrap();
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            c.encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
                .unwrap_err(),
            CryptoError::RevokedHandle
        );
    }

    #[test]
    fn no_silent_partial_success_outcomes_are_distinct() {
        // Distinct outcomes cannot be confused for one another.
        let (mut c, master, dek) = bootstrap("polygo");
        c.inject = Some(Inject::RotateFailedBeforeEffect);
        let a = c.rotate_dek(&master, &dek).unwrap();
        assert!(matches!(a, RotationOutcome::FailedBeforeEffect));
        assert!(!matches!(a, RotationOutcome::Success { .. }));
    }

    #[test]
    fn master_rotation_succeeds() {
        let (mut c, master, _dek) = bootstrap("polygo");
        let out = c.rotate(&master).unwrap();
        assert!(matches!(out, RotationOutcome::Success { .. }));
    }

    #[test]
    fn rewrap_success_and_failed_before_effect() {
        let (mut c, master, dek) = bootstrap("polygo");
        let wrapped = c.wrap(&master, &dek).unwrap();
        let RotationOutcome::Success {
            new_handle: new_master,
            ..
        } = c.rotate(&master).unwrap()
        else {
            panic!("master rotate");
        };
        let out = c
            .rewrap(&master, &new_master, &wrapped, &pid("polygo"))
            .unwrap();
        assert!(matches!(out, RotationOutcome::Success { .. }));
        c.inject = Some(Inject::RotateFailedBeforeEffect);
        let out2 = c
            .rewrap(&master, &new_master, &wrapped, &pid("polygo"))
            .unwrap();
        assert!(matches!(out2, RotationOutcome::FailedBeforeEffect));
    }

    #[test]
    fn reencrypt_success_and_reconciliation() {
        let (mut c, master, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let material = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        let RotationOutcome::Success {
            new_handle: new_dek,
            ..
        } = c.rotate_dek(&master, &dek).unwrap()
        else {
            panic!("dek rotate");
        };
        let old_aad = aad_for(&s, dek.key_version());
        let new_aad = aad_for(&s, new_dek.key_version());
        let out = c
            .reencrypt(&dek, &new_dek, &s, material.material(), &old_aad, &new_aad)
            .unwrap();
        assert!(matches!(out, RotationOutcome::Success { .. }));

        c.inject = Some(Inject::RotateReconciliationRequired);
        let out2 = c
            .reencrypt(&dek, &new_dek, &s, material.material(), &old_aad, &new_aad)
            .unwrap();
        assert!(matches!(
            out2,
            RotationOutcome::ReconciliationRequired { .. }
        ));
    }

    // ---- plaintext / errors / projection / authority / resources ----

    #[test]
    fn error_paths_do_not_echo_secret_bytes() {
        let (mut c, _m, dek) = bootstrap("polygo");
        c.revoke(&dek).unwrap();
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let err = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap_err();
        let (d, dbg) = (format!("{err}"), format!("{err:?}"));
        for needle in ["supersecret", "cred-1", "polygo", "supabase"] {
            assert!(!d.contains(needle));
            assert!(!dbg.contains(needle));
        }
    }

    #[test]
    fn encrypt_result_projects_to_valid_envelope_dto() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let aad = aad_for(&s, dek.key_version());
        let artifact = c.encrypt(&dek, &s, &plaintext(), &aad).unwrap();
        let dto = crate::projection::project_to_envelope_dto(&artifact, 7, 7).unwrap();
        dto.validate().expect("valid dto");
        assert_eq!(dto.algorithm, "AES-256-GCM");
        // Scope/key-version/algorithm in the DTO come from the artifact — a caller cannot swap them.
        assert_eq!(dto.project, "polygo");
        assert_eq!(dto.provider, "supabase");
        assert_eq!(dto.environment, "staging");
        assert_eq!(dto.credential_ref, "cred-1");
        assert_eq!(dto.key_version, 1);
        // The digest is the adapter binding, not a projection-computed value.
        assert_eq!(dto.associated_data_digest, {
            let mut h = String::new();
            for b in artifact.aad_binding().as_bytes() {
                h.push_str(&format!("{b:02x}"));
            }
            h
        });
    }

    #[test]
    fn projection_refuses_malformed_revisions() {
        let (mut c, _m, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let artifact = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        assert_eq!(
            crate::projection::project_to_envelope_dto(&artifact, 0, 0).unwrap_err(),
            CryptoError::ProjectionInvalid
        );
        assert_eq!(
            crate::projection::project_to_envelope_dto(&artifact, 5, 9).unwrap_err(),
            CryptoError::ProjectionInvalid
        );
    }

    #[test]
    fn synthetic_ciphertext_is_content_independent() {
        // Two different plaintexts of equal length yield identical synthetic ciphertext (the model
        // does not encode content). Proves it is NOT reversible fake encryption.
        let (mut c, _m, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let aad = aad_for(&s, dek.key_version());
        let p1 = PlaintextCredential::from_bytes(vec![0x11; 16]).unwrap();
        let p2 = PlaintextCredential::from_bytes(vec![0x22; 16]).unwrap();
        let m1 = c.encrypt(&dek, &s, &p1, &aad).unwrap();
        let m2 = c.encrypt(&dek, &s, &p2, &aad).unwrap();
        assert_eq!(m1.material().ciphertext(), m2.material().ciphertext());
    }

    #[test]
    fn decryption_result_is_not_authority() {
        // The return type is PlaintextCredential ONLY — there is no permit/session/lease type here.
        let (mut c, _m, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let aad = aad_for(&s, dek.key_version());
        let artifact = c.encrypt(&dek, &s, &plaintext(), &aad).unwrap();
        let recovered = c.decrypt(&dek, &s, artifact.material(), &aad).unwrap();
        assert!(!recovered.is_empty());
    }

    #[test]
    fn handle_exhaustion_fails_closed() {
        let mut c = SyntheticCrypto::new();
        let master = c.provision().unwrap();
        // Distinct projects so per-project cap is not the first limit.
        let mut last = Ok(());
        for i in 0..(MAX_ACTIVE_HANDLES + 1) {
            match c.create_dek(&master, &pid(&format!("proj-{i}"))) {
                Ok(_) => {}
                Err(e) => {
                    last = Err(e);
                    break;
                }
            }
        }
        assert_eq!(last.unwrap_err(), CryptoError::ResourceLimit);
    }

    #[test]
    fn synthetic_key_material_size_is_policy_sized() {
        // Documented: synthetic model uses policy-sized markers; keys never exposed. Sanity only.
        assert_eq!(KEY_SIZE_BYTES, 32);
    }

    #[test]
    fn encrypt_injected_failure_before_output() {
        let (mut c, _m, dek) = bootstrap("polygo");
        c.inject = Some(Inject::EncryptFailure);
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            c.encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
                .unwrap_err(),
            CryptoError::SyntheticFailure
        );
    }

    #[test]
    fn open_without_provision_is_unavailable() {
        let mut c = SyntheticCrypto::new();
        assert_eq!(c.open().unwrap_err(), CryptoError::SecretUnavailable);
    }

    // ---- lifecycle: master retiring, destroyed/restart ----

    #[test]
    fn retiring_master_may_unwrap_but_not_wrap() {
        let (mut c, master, dek) = bootstrap("polygo");
        let wrapped = c.wrap(&master, &dek).unwrap();
        let _ = c.rotate(&master).unwrap(); // old master → Retiring
        assert_eq!(
            c.wrap(&master, &dek).unwrap_err(),
            CryptoError::RetiredHandle
        );
        assert!(c.unwrap(&master, &wrapped, &pid("polygo")).is_ok());
    }

    #[test]
    fn restart_invalidates_handles_and_reopen_recreates() {
        let (mut c, master, dek) = bootstrap("polygo");
        let wrapped = c.wrap(&master, &dek).unwrap();
        c.simulate_restart();
        // Stale master + ephemeral DEK handles are refused.
        assert_eq!(
            c.unwrap(&master, &wrapped, &pid("polygo")).unwrap_err(),
            CryptoError::UnknownHandle
        );
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            c.encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
                .unwrap_err(),
            CryptoError::UnknownHandle
        );
        // Reopening the master at the new epoch works; the durable wrapped material re-unwraps.
        let m2 = c.open().unwrap();
        assert!(c.unwrap(&m2, &wrapped, &pid("polygo")).is_ok());
    }

    #[test]
    fn revoked_handle_rejected_for_decrypt_and_wrap() {
        let (mut c, master, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let artifact = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        c.revoke(&dek).unwrap();
        assert_eq!(
            c.decrypt(
                &dek,
                &s,
                artifact.material(),
                &aad_for(&s, dek.key_version())
            )
            .unwrap_err(),
            CryptoError::RevokedHandle
        );
        assert_eq!(
            c.wrap(&master, &dek).unwrap_err(),
            CryptoError::RevokedHandle
        );
    }

    // ---- resource bounds: exact + boundary-plus-one ----

    #[test]
    fn plaintext_exact_boundary_accepted() {
        assert!(
            PlaintextCredential::from_bytes(vec![0u8; crate::material::MAX_PLAINTEXT_BYTES])
                .is_ok()
        );
    }

    #[test]
    fn wrapped_dek_bounds_enforced() {
        let v = KeyVersion::new(1).unwrap();
        assert!(WrappedProjectDek::new(
            vec![0u8; crate::material::MAX_WRAPPED_DEK_BYTES],
            v,
            CryptoAlgorithm::Aes256Gcm
        )
        .is_ok());
        assert_eq!(
            WrappedProjectDek::new(
                vec![0u8; crate::material::MAX_WRAPPED_DEK_BYTES + 1],
                v,
                CryptoAlgorithm::Aes256Gcm
            )
            .unwrap_err(),
            CryptoError::ResourceLimit
        );
    }

    #[test]
    fn ciphertext_bounds_enforced() {
        let n = NonceMaterial::from_bytes(&[0u8; NONCE_SIZE_BYTES]).unwrap();
        let t = AuthenticationTag::from_bytes(&[0u8; TAG_SIZE_BYTES]).unwrap();
        let v = KeyVersion::new(1).unwrap();
        assert!(EncryptedCredentialMaterial::new(
            n.clone(),
            vec![0u8; crate::material::MAX_CIPHERTEXT_BYTES],
            t.clone(),
            v,
            CryptoAlgorithm::Aes256Gcm
        )
        .is_ok());
        assert_eq!(
            EncryptedCredentialMaterial::new(
                n,
                vec![0u8; crate::material::MAX_CIPHERTEXT_BYTES + 1],
                t,
                v,
                CryptoAlgorithm::Aes256Gcm
            )
            .unwrap_err(),
            CryptoError::ResourceLimit
        );
    }

    #[test]
    fn retained_version_limit_enforced() {
        let (mut c, master, dek) = bootstrap("polygo"); // v1 → 1 entry
        let mut current = dek;
        for _ in 0..(MAX_RETAINED_VERSIONS_PER_PROJECT - 1) {
            let RotationOutcome::Success { new_handle, .. } =
                c.rotate_dek(&master, &current).unwrap()
            else {
                panic!("rotate should succeed");
            };
            current = new_handle;
        }
        // The project now holds the maximum retained versions; the next rotation fails closed and
        // leaves the current key active.
        assert_eq!(
            c.rotate_dek(&master, &current).unwrap_err(),
            CryptoError::ResourceLimit
        );
        assert_eq!(c.dek_lifecycle(&current).unwrap(), KeyLifecycle::Active);
    }

    // ---- reconciliation identity ----

    fn recon_op(
        c: &mut SyntheticCrypto,
        master: &ServiceMasterKeyHandle,
        dek: &ProjectDekHandle,
    ) -> CryptoOperationId {
        c.inject = Some(Inject::RotateReconciliationRequired);
        let out = c.rotate_dek(master, dek).unwrap();
        c.inject = None;
        match out {
            RotationOutcome::ReconciliationRequired { operation } => operation,
            _ => panic!("expected reconciliation-required"),
        }
    }

    #[test]
    fn rotation_reconciliation_carries_operation_id() {
        let (mut c, master, dek) = bootstrap("polygo");
        let op = recon_op(&mut c, &master, &dek);
        assert!(op.value() > 0);
        assert_eq!(
            c.reconcile(op, CryptoOperationKind::ProjectDekRotation)
                .unwrap(),
            ReconcileResult::StillUnknown
        );
        // Old key untouched.
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn rewrap_reconciliation_carries_operation_id() {
        let (mut c, master, dek) = bootstrap("polygo");
        let wrapped = c.wrap(&master, &dek).unwrap();
        let RotationOutcome::Success {
            new_handle: new_master,
            ..
        } = c.rotate(&master).unwrap()
        else {
            panic!("master rotate");
        };
        c.inject = Some(Inject::RotateReconciliationRequired);
        let out = c
            .rewrap(&master, &new_master, &wrapped, &pid("polygo"))
            .unwrap();
        c.inject = None;
        let RotationOutcome::ReconciliationRequired { operation } = out else {
            panic!("expected reconciliation-required");
        };
        assert_eq!(
            c.reconcile(operation, CryptoOperationKind::ProjectDekRewrap)
                .unwrap(),
            ReconcileResult::StillUnknown
        );
    }

    #[test]
    fn reencryption_reconciliation_carries_operation_id() {
        let (mut c, master, dek) = bootstrap("polygo");
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let artifact = c
            .encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
            .unwrap();
        let RotationOutcome::Success {
            new_handle: new_dek,
            ..
        } = c.rotate_dek(&master, &dek).unwrap()
        else {
            panic!("dek rotate");
        };
        let old_aad = aad_for(&s, dek.key_version());
        let new_aad = aad_for(&s, new_dek.key_version());
        c.inject = Some(Inject::RotateReconciliationRequired);
        let out = c
            .reencrypt(&dek, &new_dek, &s, artifact.material(), &old_aad, &new_aad)
            .unwrap();
        c.inject = None;
        let RotationOutcome::ReconciliationRequired { operation } = out else {
            panic!("expected reconciliation-required");
        };
        assert_eq!(
            c.reconcile(operation, CryptoOperationKind::CredentialReencryption)
                .unwrap(),
            ReconcileResult::StillUnknown
        );
    }

    #[test]
    fn success_and_reconcile_use_same_id() {
        let (mut c, master, dek) = bootstrap("polygo");
        let RotationOutcome::Success { operation, .. } = c.rotate_dek(&master, &dek).unwrap()
        else {
            panic!("rotate success");
        };
        assert_eq!(
            c.reconcile(operation, CryptoOperationKind::ProjectDekRotation)
                .unwrap(),
            ReconcileResult::Succeeded
        );
    }

    #[test]
    fn fabricated_operation_id_refused() {
        let (c, _m, _dek) = bootstrap("polygo");
        let fake = CryptoOperationId::new(999_999).unwrap();
        assert_eq!(
            c.reconcile(fake, CryptoOperationKind::ProjectDekRotation)
                .unwrap_err(),
            CryptoError::UnknownOperation
        );
    }

    #[test]
    fn wrong_operation_kind_refused() {
        let (mut c, master, dek) = bootstrap("polygo");
        let op = recon_op(&mut c, &master, &dek); // ProjectDekRotation
        assert_eq!(
            c.reconcile(op, CryptoOperationKind::CredentialReencryption)
                .unwrap_err(),
            CryptoError::UnknownOperation
        );
    }

    #[test]
    fn reconcile_query_is_read_only_and_stable() {
        let (mut c, master, dek) = bootstrap("polygo");
        let op = recon_op(&mut c, &master, &dek);
        // Repeated query is stable and does not mutate key lifecycle (no operation repeat).
        assert_eq!(
            c.reconcile(op, CryptoOperationKind::ProjectDekRotation)
                .unwrap(),
            ReconcileResult::StillUnknown
        );
        assert_eq!(
            c.reconcile(op, CryptoOperationKind::ProjectDekRotation)
                .unwrap(),
            ReconcileResult::StillUnknown
        );
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn resolved_terminal_reconciliation_is_stable() {
        let (mut c, master, dek) = bootstrap("polygo");
        let op = recon_op(&mut c, &master, &dek);
        // A separate governed action resolves the unknown to FailedBeforeEffect.
        c.resolve_reconciliation_for_test(op, ReconState::FailedBeforeEffect);
        for _ in 0..3 {
            assert_eq!(
                c.reconcile(op, CryptoOperationKind::ProjectDekRotation)
                    .unwrap(),
                ReconcileResult::FailedBeforeEffect
            );
        }
        // Old key never destroyed.
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn operation_id_counter_overflow_fails_closed() {
        let (mut c, master, dek) = bootstrap("polygo");
        c.set_op_counter_for_test(u64::MAX);
        c.inject = Some(Inject::RotateReconciliationRequired);
        assert_eq!(
            c.rotate_dek(&master, &dek).unwrap_err(),
            CryptoError::ResourceLimit
        );
        // No effect: old key still Active.
        assert_eq!(c.dek_lifecycle(&dek).unwrap(), KeyLifecycle::Active);
    }

    #[test]
    fn reconcile_error_does_not_echo() {
        let (c, _m, _dek) = bootstrap("polygo");
        let fake = CryptoOperationId::new(42).unwrap();
        let err = c
            .reconcile(fake, CryptoOperationKind::ProjectDekRewrap)
            .unwrap_err();
        for needle in ["polygo", "cred-1", "supabase"] {
            assert!(!format!("{err}").contains(needle));
            assert!(!format!("{err:?}").contains(needle));
        }
    }

    // ---- handle-destruction: Option B (explicit deferral) ----

    #[test]
    fn only_revocation_and_restart_invalidate_handles() {
        // Phase 3H supports Active/Retiring/Revoked + restart-invalidation only. There is no
        // Destroyed lifecycle and no destroy method; deliberate destruction/secure-erasure is a
        // later governed phase. Revoked stays revoked; a restart-stale handle stays UnknownHandle.
        let (mut c, master, dek) = bootstrap("polygo");
        c.revoke(&dek).unwrap();
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            c.encrypt(&dek, &s, &plaintext(), &aad_for(&s, dek.key_version()))
                .unwrap_err(),
            CryptoError::RevokedHandle
        );
        c.simulate_restart();
        assert_eq!(
            c.wrap(&master, &dek).unwrap_err(),
            CryptoError::UnknownHandle
        );
    }
}
