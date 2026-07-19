//! The master-key protection BACKEND service-provider interface (SPI).
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-A (dependency inversion).
//!
//! A platform-specific EXTERNAL crate (e.g. a future Windows DPAPI backend) implements this SPI to
//! perform master-key MATERIAL protection ONLY. The backend NEVER mints, inspects, or reconstructs a
//! [`crate::ServiceMasterKeyHandle`]; it never touches lifecycle, epoch, or operation identity; and it
//! creates no ProjectOS authority. Handle issuance and the authoritative registry stay crypto-owned
//! (see [`crate::MasterKeyProtectorService`]). The backend OWNS its concrete protected + unprotected
//! representations, so no raw secret `Vec`/`String` crosses this API.

use crate::error::CryptoError;

/// A narrow, fieldless backend-primitive error with OPERATION-SPECIFIC semantics. Carries no buffer
/// contents, no protected record, no plaintext, no platform message, no identifier, and no path.
///
/// Every variant is KNOWN-BEFORE-EFFECT or a read-only failure — there is NO "uncertain external
/// effect" variant. A successful `protect_new` returns the WHOLE successful effect in the opaque
/// returned record (nothing durable or externally unresolved is created on the side), and a
/// `protect_new` error means protection did NOT take effect. A durable/side-effecting backend that
/// could leave an unresolved external effect would require a SEPARATELY reviewed reconciliation-capable
/// SPI (not this one).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum BackendError {
    /// The backend platform primitive is unavailable here (e.g. non-Windows). No effect.
    #[error("backend unsupported platform")]
    UnsupportedPlatform,
    /// `protect_new` was refused BEFORE any effect; the caller's prior state is intact.
    #[error("backend protect failed before effect")]
    ProtectFailedBeforeEffect,
    /// `unprotect` (read-only) failed.
    #[error("backend unprotect failed")]
    UnprotectFailed,
    /// A backend resource bound was exceeded (before effect for protect; invalid/oversized for
    /// unprotect). Never an uncertain effect.
    #[error("backend resource limit")]
    ResourceLimit,
}

impl BackendError {
    /// Map a backend-primitive error to the accepted [`CryptoError`] (reusing existing semantics; no
    /// duplicate variant is introduced). No variant maps to an uncertain/reconciliation outcome.
    pub(crate) fn to_crypto(self) -> CryptoError {
        match self {
            BackendError::UnsupportedPlatform
            | BackendError::ProtectFailedBeforeEffect
            | BackendError::UnprotectFailed => CryptoError::SecretUnavailable,
            BackendError::ResourceLimit => CryptoError::ResourceLimit,
        }
    }
}

/// Closure-scoped access to unprotected master-key bytes.
///
/// **What this guarantees:** the borrow passed to `with_secret` cannot ESCAPE — the returned `R` is
/// chosen by the caller independently of the inner borrow's lifetime, so a closure cannot return the
/// slice (proven by a compile-fail doctest). The crypto-owned wrapper's closure does NOT clone, log,
/// or retain the borrowed bytes.
///
/// **What this does NOT guarantee:** the Rust type system does NOT prevent a MALICIOUS backend
/// implementation from copying the bytes into its own owned memory inside its own methods. A backend
/// is TRUSTED secret-handling code; the future Phase 3J-B Windows backend requires direct security
/// review. Backend trust grants NO ProjectOS operation authority and NO handle-minting authority.
///
/// No raw-byte getter, no `Vec`/`String` conversion, and no `Clone`/`Copy`/`Display`/`Serialize`
/// requirement.
pub trait BackendSecret {
    /// Run `f` against a read-only view of the unprotected bytes; the borrow never escapes.
    fn with_secret<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R;
    /// The unprotected length (non-secret metadata).
    fn len(&self) -> usize;
    /// Whether empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The backend SPI. Implement in a platform-specific crate; do NOT implement
/// [`crate::adapter::MasterKeyProtector`] directly (it is crypto-owned).
pub trait MasterKeyProtectionBackend {
    /// The backend's opaque protected-master-key record. No `Serialize`/`Clone`/`Debug` bound is
    /// required, so an implementor keeps it fully encapsulated and non-serializable.
    type ProtectedRecord;
    /// The backend's zeroising unprotected material (closure-scoped access via [`BackendSecret`]).
    type UnprotectedMaterial: BackendSecret;

    /// Generate and protect FRESH master-key material, returning an opaque protected record. The
    /// backend owns material generation (a real backend uses OS randomness + DPAPI; a synthetic test
    /// backend uses a fixed synthetic value). No plaintext crosses this boundary.
    ///
    /// # Errors
    /// A [`BackendError`] classifying the primitive failure.
    fn protect_new(&mut self) -> Result<Self::ProtectedRecord, BackendError>;

    /// Unprotect a previously-produced protected record into backend-owned zeroising material.
    ///
    /// # Errors
    /// [`BackendError::UnprotectFailed`] (or another primitive error).
    fn unprotect(
        &mut self,
        record: &Self::ProtectedRecord,
    ) -> Result<Self::UnprotectedMaterial, BackendError>;
}
