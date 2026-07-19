//! Service-private adapter CONTRACTS (traits) for the accepted key hierarchy, plus rotation result
//! contracts. These are contracts ONLY — this crate ships NO Windows/DPAPI/CNG/TPM implementation and
//! performs NO real cryptography. A deterministic synthetic implementation exists solely under
//! `#[cfg(test)]`.

use projectos_trust_contract::ProjectId;

use crate::aad::AssociatedData;
use crate::error::CryptoError;
use crate::handle::{
    CryptoOperationId, KeyLifecycle, KeyRole, ProjectDekHandle, ServiceMasterKeyHandle,
};
use crate::material::{
    EncryptedCredentialMaterial, EncryptionArtifact, PlaintextCredential, WrappedProjectDek,
};
use crate::scope::CredentialScope;

/// Redacted metadata about a protected key. Contains NO key bytes and no secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MasterKeyMetadata {
    /// The key role.
    pub key_role: KeyRole,
    /// The key lifecycle.
    pub lifecycle: KeyLifecycle,
}

/// The kind of protected crypto operation a [`CryptoOperationId`] correlates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoOperationKind {
    /// Master-key rotation.
    MasterRotation,
    /// Project-DEK rotation.
    ProjectDekRotation,
    /// Project-DEK rewrap under a replacement master.
    ProjectDekRewrap,
    /// Credential re-encryption under a new DEK version.
    CredentialReencryption,
}

/// The terminal-or-pending state of a previously uncertain protected operation, as resolved by a
/// read-only reconciliation query. `Refused`/unknown-identity is an error, not a variant here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReconcileResult {
    /// The operation is known to have taken effect.
    Succeeded,
    /// The operation is known NOT to have taken effect; the prior key is intact.
    FailedBeforeEffect,
    /// The outcome is still unknown; the caller must not assume any effect and must not retry.
    StillUnknown,
}

/// The result of a rotation / rewrapping / re-encryption operation. Distinguishes success from the
/// three non-success outcomes so a caller can never treat a partial or uncertain result as success.
/// There is NO silent partial success.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RotationOutcome<H> {
    /// The replacement is fully in effect; `new_handle` supersedes the old.
    Success {
        /// The replacement handle/material.
        new_handle: H,
        /// The correlation id for this operation.
        operation: CryptoOperationId,
    },
    /// The operation was refused by policy; nothing changed and no operation began.
    Refused,
    /// The operation failed before any effect; the prior state is intact (old key retained). No
    /// operation began, so no correlation id is issued (documented absence).
    FailedBeforeEffect,
    /// The outcome is uncertain (e.g. a protected-key external result). The caller MUST reconcile via
    /// [`CryptoReconciler`] before trusting it, MUST NOT retry, and MUST NOT destroy the old key.
    ReconciliationRequired {
        /// The correlation id to reconcile with.
        operation: CryptoOperationId,
    },
}

/// A read-only contract for resolving an uncertain protected-operation outcome. Querying NEVER repeats
/// the protected operation, generates no key, destroys no key, and (in the synthetic model) is
/// idempotent. A fabricated id or a wrong-kind id fails closed.
pub trait CryptoReconciler {
    /// Resolve the outcome of the operation correlated by `operation_id`, asserting its `kind`.
    ///
    /// # Errors
    /// [`CryptoError::UnknownOperation`] if the id was not issued by this adapter or was issued for a
    /// different operation kind.
    fn reconcile(
        &self,
        operation_id: CryptoOperationId,
        kind: CryptoOperationKind,
    ) -> Result<ReconcileResult, CryptoError>;
}

/// Level-1: master-key protection contract. NO Windows implementation is authorised here.
pub trait MasterKeyProtector {
    /// Provision fresh protected master-key state and return an opaque handle.
    ///
    /// # Errors
    /// A [`CryptoError`] on refusal or synthetic failure.
    fn provision(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError>;

    /// Open the existing protected master-key state.
    ///
    /// # Errors
    /// [`CryptoError::SecretUnavailable`] if no master state exists.
    fn open(&mut self) -> Result<ServiceMasterKeyHandle, CryptoError>;

    /// Rotate/replace the master-key wrapping, returning a rotation outcome.
    ///
    /// # Errors
    /// [`CryptoError::UnknownHandle`]/[`CryptoError::WrongKeyRole`] for an invalid handle.
    fn rotate(
        &mut self,
        current: &ServiceMasterKeyHandle,
    ) -> Result<RotationOutcome<ServiceMasterKeyHandle>, CryptoError>;

    /// Report redacted metadata only.
    ///
    /// # Errors
    /// [`CryptoError::UnknownHandle`] for an unknown handle.
    fn metadata(&self, handle: &ServiceMasterKeyHandle) -> Result<MasterKeyMetadata, CryptoError>;
}

/// Level-2: project-DEK management contract.
pub trait ProjectDekManager {
    /// Create a new project-scoped DEK handle under a master handle.
    ///
    /// # Errors
    /// [`CryptoError`] for an invalid master handle or a limit.
    fn create_dek(
        &mut self,
        master: &ServiceMasterKeyHandle,
        project: &ProjectId,
    ) -> Result<ProjectDekHandle, CryptoError>;

    /// Wrap a project DEK under the master handle (opaque wrapped bytes; plaintext never leaves).
    ///
    /// # Errors
    /// [`CryptoError`] for an invalid handle or wrong role.
    fn wrap(
        &mut self,
        master: &ServiceMasterKeyHandle,
        dek: &ProjectDekHandle,
    ) -> Result<WrappedProjectDek, CryptoError>;

    /// Unwrap a wrapped DEK into an ephemeral handle for exactly `project`.
    ///
    /// # Errors
    /// [`CryptoError::ScopeMismatch`] if the wrapped DEK is not for `project`;
    /// [`CryptoError::KeyVersionMismatch`] / [`CryptoError::UnsupportedAlgorithm`] on policy failure.
    fn unwrap(
        &mut self,
        master: &ServiceMasterKeyHandle,
        wrapped: &WrappedProjectDek,
        project: &ProjectId,
    ) -> Result<ProjectDekHandle, CryptoError>;

    /// Rotate the project DEK to a new version. The old key is retained until success is proven.
    ///
    /// # Errors
    /// [`CryptoError`] for an invalid handle.
    fn rotate_dek(
        &mut self,
        master: &ServiceMasterKeyHandle,
        current: &ProjectDekHandle,
    ) -> Result<RotationOutcome<ProjectDekHandle>, CryptoError>;

    /// Rewrap a project DEK under a replacement master key without exposing plaintext.
    ///
    /// # Errors
    /// [`CryptoError`] for invalid handles or policy failure.
    fn rewrap(
        &mut self,
        old_master: &ServiceMasterKeyHandle,
        new_master: &ServiceMasterKeyHandle,
        wrapped: &WrappedProjectDek,
        project: &ProjectId,
    ) -> Result<RotationOutcome<WrappedProjectDek>, CryptoError>;

    /// Revoke a DEK handle; subsequent use is refused.
    ///
    /// # Errors
    /// [`CryptoError::UnknownHandle`] for an unknown handle.
    fn revoke(&mut self, dek: &ProjectDekHandle) -> Result<(), CryptoError>;
}

/// Level-3: credential-material protection contract.
pub trait CredentialCipher {
    /// Encrypt plaintext credential material under a DEK, bound to `scope` + `aad`. Returns a SEALED
    /// [`EncryptionArtifact`] bundling the material, the scope, and the adapter-produced binding — a
    /// caller cannot manufacture a successful result.
    ///
    /// # Errors
    /// [`CryptoError::ScopeMismatch`] if the DEK is not for the scope's project;
    /// [`CryptoError::RevokedHandle`]/[`CryptoError::RetiredHandle`] per lifecycle;
    /// [`CryptoError::InvalidAssociatedData`] for empty/invalid AAD.
    fn encrypt(
        &mut self,
        dek: &ProjectDekHandle,
        scope: &CredentialScope,
        plaintext: &PlaintextCredential,
        aad: &AssociatedData,
    ) -> Result<EncryptionArtifact, CryptoError>;

    /// Decrypt encrypted credential material, returning service-private plaintext ownership. A
    /// successful decryption does NOT authorise use of the credential.
    ///
    /// # Errors
    /// [`CryptoError::KeyVersionMismatch`], [`CryptoError::ScopeMismatch`],
    /// [`CryptoError::InvalidAssociatedData`], or a shape/lifecycle error.
    fn decrypt(
        &mut self,
        dek: &ProjectDekHandle,
        scope: &CredentialScope,
        material: &EncryptedCredentialMaterial,
        aad: &AssociatedData,
    ) -> Result<PlaintextCredential, CryptoError>;

    /// Re-encrypt existing material under a new DEK version (rotation), returning a rotation outcome.
    ///
    /// # Errors
    /// [`CryptoError`] per handle/scope/aad validation.
    fn reencrypt(
        &mut self,
        old_dek: &ProjectDekHandle,
        new_dek: &ProjectDekHandle,
        scope: &CredentialScope,
        material: &EncryptedCredentialMaterial,
        old_aad: &AssociatedData,
        new_aad: &AssociatedData,
    ) -> Result<RotationOutcome<EncryptionArtifact>, CryptoError>;
}
