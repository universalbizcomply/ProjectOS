//! The bounded, injected master-key MATERIAL SOURCE contract.
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-B.
//!
//! Phase 3J-B introduces NO production key generator. The Windows backend obtains fresh master-key
//! material ONLY through this injected source, which yields the material through a closure-scoped
//! borrowed slice and returns no owned byte container. The source creates no ProjectOS handle, no
//! [`projectos_host_crypto::ServiceMasterKeyHandle`], and no authority of any kind.

/// A narrow, fieldless material-source error. Every variant is KNOWN-BEFORE-EFFECT: it means DPAPI
/// protection did NOT run. Carries no material, no identifier, no path, no platform message, and no
/// machine/user information.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum MaterialSourceError {
    /// Fresh-material generation failed before any protection effect.
    #[error("material generation failed before effect")]
    GenerationFailed,
    /// A source resource bound was exceeded before any protection effect.
    #[error("material source resource limit")]
    ResourceLimit,
    /// The generated material length was invalid (before DPAPI was invoked).
    #[error("generated material length invalid")]
    InvalidLength,
}

/// A bounded source of FRESH service-master-key material.
///
/// **What this guarantees:** material is generated internally and handed to `f` as a read-only borrow
/// that cannot ESCAPE (the returned `R` is chosen independently of the inner borrow's lifetime, proven
/// by a compile-fail doctest). There is no owned-byte return: no `Vec`, no `String`, no getter, no
/// public constructor exposing material, and no serialization.
///
/// **What this does NOT guarantee:** the Rust type system does NOT prevent a MALICIOUS source
/// implementation from copying or logging the bytes inside its own method body. A material source is
/// TRUSTED secret-handling code; a production source (out of scope for Phase 3J-B) requires direct
/// security review. Source trust grants NO ProjectOS operation authority and NO handle-minting
/// authority.
pub trait MasterKeyMaterialSource {
    /// Generate fresh master-key material and run `f` against a read-only, closure-scoped view of it,
    /// returning the closure's result. The borrow never escapes; no owned buffer is returned.
    ///
    /// # Errors
    /// A [`MaterialSourceError`] classifying a known-before-effect generation failure (no protection
    /// effect occurred).
    fn with_new_material<R>(
        &mut self,
        f: impl FnOnce(&[u8]) -> R,
    ) -> Result<R, MaterialSourceError>;
}
