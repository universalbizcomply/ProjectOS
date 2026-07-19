//! The Windows DPAPI master-key protection backend that implements the accepted crypto SPI by
//! delegating to `projectos-host-windows-protection`. It mints no handle, allocates no operation id,
//! mutates no lifecycle, and contains NO direct Windows FFI and NO `unsafe` (the crate forbids it).

use std::fmt;

use projectos_host_crypto::{
    BackendError, BackendSecret, MasterKeyProtectionBackend, KEY_SIZE_BYTES,
};
use projectos_host_windows_protection::{
    protect_machine_scope, unprotect_machine_scope, ProtectedBlob, ProtectionError,
    UnprotectedOutput,
};

use crate::material_source::{MasterKeyMaterialSource, MaterialSourceError};

/// A sealed, backend-owned protected master-key record. Wraps ONE opaque DPAPI [`ProtectedBlob`]. It
/// exposes no raw protected bytes, no byte constructor, no mutation, no serialization, no `Clone`, and
/// no `Display`; `Debug` is redacted (bounded length only). It is in-memory only — NOT a persistence
/// DTO, NOT a credential envelope, NOT a service-master-key handle.
pub struct WindowsDpapiProtectedRecord {
    blob: ProtectedBlob,
}

impl WindowsDpapiProtectedRecord {
    /// The protected-record length (non-secret metadata).
    #[must_use]
    pub fn len(&self) -> usize {
        self.blob.len()
    }
    /// Whether empty (never true for a constructed value).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blob.is_empty()
    }
}

impl fmt::Debug for WindowsDpapiProtectedRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WindowsDpapiProtectedRecord")
            .field("len", &self.blob.len())
            .finish()
    }
}

/// A sealed, backend-owned unprotected master-key material. Wraps ONE zeroising DPAPI
/// [`UnprotectedOutput`] and forwards [`BackendSecret::with_secret`] through its closure-scoped
/// `with_bytes` — adding NO second plaintext copy. No raw getter, no byte constructor, no `Vec`/
/// `String` conversion, no serialization, no `Clone`/`Copy`, redacted `Debug`; zeroises on drop via
/// the underlying accepted buffer.
pub struct WindowsDpapiUnprotectedMaterial {
    output: UnprotectedOutput,
}

impl BackendSecret for WindowsDpapiUnprotectedMaterial {
    fn with_secret<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        // Forward straight through the accepted closure-scoped borrow; no copy is made here.
        self.output.with_bytes(f)
    }
    fn len(&self) -> usize {
        self.output.len()
    }
}

impl fmt::Debug for WindowsDpapiUnprotectedMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WindowsDpapiUnprotectedMaterial")
            .field("len", &self.output.len())
            .finish()
    }
}

/// Map a lower-level protect-path [`ProtectionError`] to the accepted [`BackendError`]. Every arm is
/// known-before-effect: a protect failure means no usable protected record was produced. Size bounds
/// map to [`BackendError::ResourceLimit`]; hard/invalid failures map to
/// [`BackendError::ProtectFailedBeforeEffect`]; the foreign `#[non_exhaustive]` enum's wildcard fails
/// closed before effect. No lower-level text or source chain is carried.
fn map_protect_error(err: ProtectionError) -> BackendError {
    match err {
        ProtectionError::UnsupportedPlatform => BackendError::UnsupportedPlatform,
        ProtectionError::InputTooLarge
        | ProtectionError::ProtectedOutputTooLarge
        | ProtectionError::PlaintextOutputTooLarge => BackendError::ResourceLimit,
        ProtectionError::EmptyInput
        | ProtectionError::ProtectFailed
        | ProtectionError::UnprotectFailed
        | ProtectionError::WindowsOutputInvalid => BackendError::ProtectFailedBeforeEffect,
        _ => BackendError::ProtectFailedBeforeEffect,
    }
}

/// Map a lower-level unprotect-path [`ProtectionError`] to the accepted [`BackendError`]. Unprotect is
/// read-only: size bounds map to [`BackendError::ResourceLimit`]; every other failure maps to
/// [`BackendError::UnprotectFailed`]; the foreign wildcard fails closed. No lower-level text is
/// carried.
fn map_unprotect_error(err: ProtectionError) -> BackendError {
    match err {
        ProtectionError::UnsupportedPlatform => BackendError::UnsupportedPlatform,
        ProtectionError::InputTooLarge
        | ProtectionError::ProtectedOutputTooLarge
        | ProtectionError::PlaintextOutputTooLarge => BackendError::ResourceLimit,
        ProtectionError::EmptyInput
        | ProtectionError::ProtectFailed
        | ProtectionError::UnprotectFailed
        | ProtectionError::WindowsOutputInvalid => BackendError::UnprotectFailed,
        _ => BackendError::UnprotectFailed,
    }
}

/// Map a [`MaterialSourceError`] to the accepted [`BackendError`]. Every arm is known-before-effect:
/// DPAPI was NOT invoked. Resource limits map to [`BackendError::ResourceLimit`]; generation/length
/// failures map to [`BackendError::ProtectFailedBeforeEffect`]; the wildcard fails closed. Never a
/// reconciliation outcome.
fn map_source_error(err: MaterialSourceError) -> BackendError {
    match err {
        MaterialSourceError::ResourceLimit => BackendError::ResourceLimit,
        MaterialSourceError::GenerationFailed | MaterialSourceError::InvalidLength => {
            BackendError::ProtectFailedBeforeEffect
        }
    }
}

/// The Windows DPAPI master-key protection backend, generic over a bounded material source `S`. It
/// OWNS the source, implements [`MasterKeyProtectionBackend`], and delegates all protection to
/// `projectos-host-windows-protection`. It creates no [`projectos_host_crypto::ServiceMasterKeyHandle`],
/// allocates no operation id, mutates no lifecycle, retains no plaintext, and persists nothing. There
/// is deliberately NO production default source in this phase.
pub struct WindowsDpapiMasterKeyBackend<S: MasterKeyMaterialSource> {
    source: S,
}

impl<S: MasterKeyMaterialSource> WindowsDpapiMasterKeyBackend<S> {
    /// Wrap a bounded material source.
    #[must_use]
    pub fn new(source: S) -> Self {
        Self { source }
    }
}

impl<S: MasterKeyMaterialSource> MasterKeyProtectionBackend for WindowsDpapiMasterKeyBackend<S> {
    type ProtectedRecord = WindowsDpapiProtectedRecord;
    type UnprotectedMaterial = WindowsDpapiUnprotectedMaterial;

    fn protect_new(&mut self) -> Result<Self::ProtectedRecord, BackendError> {
        // Call the source EXACTLY once; inside its closure-scoped borrow, validate the exact accepted
        // master-key length BEFORE DPAPI, then protect exactly once. The source zeroises its material
        // after the closure returns; nothing plaintext is retained here.
        let protected = self.source.with_new_material(|material| {
            if material.len() != KEY_SIZE_BYTES {
                // Invalid length: known-before-effect refusal; DPAPI is NOT called.
                return Err(BackendError::ProtectFailedBeforeEffect);
            }
            match protect_machine_scope(material) {
                Ok(blob) => Ok(WindowsDpapiProtectedRecord { blob }),
                Err(err) => Err(map_protect_error(err)),
            }
        });
        match protected {
            Ok(inner) => inner,
            // Source failed before any effect (DPAPI not reached).
            Err(source_err) => Err(map_source_error(source_err)),
        }
    }

    fn unprotect(
        &mut self,
        record: &Self::ProtectedRecord,
    ) -> Result<Self::UnprotectedMaterial, BackendError> {
        match unprotect_machine_scope(&record.blob) {
            Ok(output) => Ok(WindowsDpapiUnprotectedMaterial { output }),
            Err(err) => Err(map_unprotect_error(err)),
        }
    }
}
