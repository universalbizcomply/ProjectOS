//! Service-private material types. Secret-bearing values are non-serializable, non-cloneable,
//! non-displayable, expose no raw-byte getter publicly, and clear their owned bytes on drop via the
//! `zeroize` crate. Honest limits (see crate docs): zeroisation clears THIS crate's owned buffer only.

// Crate-private constructors (`new`, `wrapped_bytes`) are consumed by the adapter implementation.
// This phase ships only the `#[cfg(test)]` synthetic adapter, so they are unused in a pure lib build.
#![cfg_attr(not(test), allow(dead_code))]

use std::fmt;

use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::CryptoError;
use crate::policy::{CryptoAlgorithm, KeyVersion, NONCE_SIZE_BYTES, TAG_SIZE_BYTES};
use crate::scope::CredentialScope;

/// Maximum plaintext credential size (bytes). Reference safety bound, not a production capacity.
pub const MAX_PLAINTEXT_BYTES: usize = 8192;
/// Maximum wrapped-DEK size (bytes).
pub const MAX_WRAPPED_DEK_BYTES: usize = 4096;
/// Maximum encrypted credential-material ciphertext size (bytes).
pub const MAX_CIPHERTEXT_BYTES: usize = 65536;

/// Owned plaintext credential BYTES (never text). Cleared on drop. No `Serialize`/`Deserialize`,
/// `Clone`, `Copy`, or `Display`; `Debug` is redacted.
#[derive(ZeroizeOnDrop)]
pub struct PlaintextCredential {
    bytes: Vec<u8>,
}

impl PlaintextCredential {
    /// Take ownership of plaintext bytes (bounded, non-empty).
    ///
    /// # Errors
    /// [`CryptoError::SecretUnavailable`] if empty; [`CryptoError::ResourceLimit`] if over bound.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, CryptoError> {
        if bytes.is_empty() {
            return Err(CryptoError::SecretUnavailable);
        }
        if bytes.len() > MAX_PLAINTEXT_BYTES {
            return Err(CryptoError::ResourceLimit);
        }
        Ok(Self { bytes })
    }

    /// The plaintext length in bytes (metadata only, not the value).
    #[must_use]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }
    /// Whether the plaintext is empty (never true for a constructed value).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    /// The smallest borrowing interface: run `f` against a read-only view of the owned bytes. The
    /// borrow is scoped to the closure and is NEVER returned to the caller — there is no public
    /// `&[u8]`, `&mut [u8]`, `Vec`, or `String` getter. Future service code obtains bounded access
    /// only through this closure.
    pub fn with_bytes<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(&self.bytes)
    }
}

impl fmt::Debug for PlaintextCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PlaintextCredential")
            .field("len", &self.bytes.len())
            .finish()
    }
}

/// A GCM nonce (exactly [`NONCE_SIZE_BYTES`]). Non-secret binding material; `Debug` shows the length.
#[derive(Clone, PartialEq, Eq)]
pub struct NonceMaterial([u8; NONCE_SIZE_BYTES]);

impl NonceMaterial {
    /// Build from exactly [`NONCE_SIZE_BYTES`] bytes.
    ///
    /// # Errors
    /// [`CryptoError::InvalidNonceSize`] on any other length.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        let arr: [u8; NONCE_SIZE_BYTES] = bytes
            .try_into()
            .map_err(|_| CryptoError::InvalidNonceSize)?;
        Ok(Self(arr))
    }
    /// The nonce bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for NonceMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NonceMaterial")
            .field("len", &self.0.len())
            .finish()
    }
}

/// A GCM authentication tag (exactly [`TAG_SIZE_BYTES`]). Non-secret; `Debug` shows the length.
#[derive(Clone, PartialEq, Eq)]
pub struct AuthenticationTag([u8; TAG_SIZE_BYTES]);

impl AuthenticationTag {
    /// Build from exactly [`TAG_SIZE_BYTES`] bytes.
    ///
    /// # Errors
    /// [`CryptoError::InvalidTagSize`] on any other length.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        let arr: [u8; TAG_SIZE_BYTES] =
            bytes.try_into().map_err(|_| CryptoError::InvalidTagSize)?;
        Ok(Self(arr))
    }
    /// The tag bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for AuthenticationTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthenticationTag")
            .field("len", &self.0.len())
            .finish()
    }
}

/// A project DEK wrapped under the service master key. Opaque, sensitive; cleared on drop. No
/// `Serialize`/`Clone`/`Copy`/`Display`; `Debug` redacted; raw bytes are crate-private.
pub struct WrappedProjectDek {
    bytes: Vec<u8>,
    key_version: KeyVersion,
    algorithm: CryptoAlgorithm,
}

impl WrappedProjectDek {
    pub(crate) fn new(
        bytes: Vec<u8>,
        key_version: KeyVersion,
        algorithm: CryptoAlgorithm,
    ) -> Result<Self, CryptoError> {
        if bytes.is_empty() || bytes.len() > MAX_WRAPPED_DEK_BYTES {
            return Err(CryptoError::ResourceLimit);
        }
        Ok(Self {
            bytes,
            key_version,
            algorithm,
        })
    }
    pub(crate) fn wrapped_bytes(&self) -> &[u8] {
        &self.bytes
    }
    /// The wrapping-key version.
    #[must_use]
    pub fn key_version(&self) -> KeyVersion {
        self.key_version
    }
    /// The algorithm the DEK is used with.
    #[must_use]
    pub fn algorithm(&self) -> CryptoAlgorithm {
        self.algorithm
    }
    /// The wrapped length (metadata only).
    #[must_use]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }
    /// Whether empty (never true for a constructed value).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
}

impl Drop for WrappedProjectDek {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl fmt::Debug for WrappedProjectDek {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WrappedProjectDek")
            .field("len", &self.bytes.len())
            .field("key_version", &self.key_version.value())
            .finish()
    }
}

/// Encrypted credential material: nonce + opaque ciphertext + tag + key version + algorithm. The
/// ciphertext is opaque bytes (never plaintext). No `Clone`, no `Serialize`, redacted `Debug`. The
/// constructor and the nonce/ciphertext/tag getters are crate-private: a caller can NEVER fabricate a
/// successful encrypted result, and raw ciphertext/nonce/tag reach a DTO ONLY via the sealed
/// projection.
pub struct EncryptedCredentialMaterial {
    nonce: NonceMaterial,
    ciphertext: Vec<u8>,
    tag: AuthenticationTag,
    key_version: KeyVersion,
    algorithm: CryptoAlgorithm,
}

impl EncryptedCredentialMaterial {
    pub(crate) fn new(
        nonce: NonceMaterial,
        ciphertext: Vec<u8>,
        tag: AuthenticationTag,
        key_version: KeyVersion,
        algorithm: CryptoAlgorithm,
    ) -> Result<Self, CryptoError> {
        if ciphertext.is_empty() || ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            return Err(CryptoError::ResourceLimit);
        }
        Ok(Self {
            nonce,
            ciphertext,
            tag,
            key_version,
            algorithm,
        })
    }
    pub(crate) fn nonce(&self) -> &NonceMaterial {
        &self.nonce
    }
    pub(crate) fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }
    pub(crate) fn tag(&self) -> &AuthenticationTag {
        &self.tag
    }
    /// The key version this material was produced under (non-secret metadata).
    #[must_use]
    pub fn key_version(&self) -> KeyVersion {
        self.key_version
    }
    /// The algorithm (non-secret metadata).
    #[must_use]
    pub fn algorithm(&self) -> CryptoAlgorithm {
        self.algorithm
    }
    /// The ciphertext length (non-secret metadata).
    #[must_use]
    pub fn ciphertext_len(&self) -> usize {
        self.ciphertext.len()
    }
}

impl fmt::Debug for EncryptedCredentialMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EncryptedCredentialMaterial")
            .field("ciphertext_len", &self.ciphertext.len())
            .field("key_version", &self.key_version.value())
            .finish()
    }
}

/// An opaque associated-data binding produced by the adapter during encryption. In this phase it is a
/// synthetic NON-CRYPTOGRAPHIC token (the adapter computes it); a future real adapter would produce
/// and verify a real MAC/digest. Not constructible by an external caller.
#[derive(Clone, PartialEq, Eq)]
pub struct AadBinding(Vec<u8>);

impl AadBinding {
    pub(crate) fn new(bytes: Vec<u8>) -> Result<Self, CryptoError> {
        if bytes.is_empty() || bytes.len() > 64 {
            return Err(CryptoError::ResourceLimit);
        }
        Ok(Self(bytes))
    }
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    /// The binding length (non-secret metadata).
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// Whether empty (never true for a constructed value).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for AadBinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AadBinding")
            .field("len", &self.0.len())
            .finish()
    }
}

/// A SEALED, adapter-produced successful-encryption artifact. It bundles the encrypted material, the
/// validated scope it was bound to, and the adapter-produced associated-data binding. Its constructor
/// is crate-private, so ONLY an in-crate `CredentialCipher` implementation (in this phase, the
/// `#[cfg(test)]` synthetic adapter) can create one — a caller cannot manufacture a "successful"
/// encryption. The projection consumes exactly this artifact.
pub struct EncryptionArtifact {
    material: EncryptedCredentialMaterial,
    scope: CredentialScope,
    aad_binding: AadBinding,
}

impl EncryptionArtifact {
    pub(crate) fn new(
        material: EncryptedCredentialMaterial,
        scope: CredentialScope,
        aad_binding: AadBinding,
    ) -> Self {
        Self {
            material,
            scope,
            aad_binding,
        }
    }
    /// The encrypted material (its raw bytes remain crate-private).
    #[must_use]
    pub fn material(&self) -> &EncryptedCredentialMaterial {
        &self.material
    }
    /// The validated scope the material is bound to.
    #[must_use]
    pub fn scope(&self) -> &CredentialScope {
        &self.scope
    }
    /// The adapter-produced associated-data binding (opaque metadata).
    #[must_use]
    pub fn aad_binding(&self) -> &AadBinding {
        &self.aad_binding
    }
}

impl fmt::Debug for EncryptionArtifact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EncryptionArtifact")
            .field("ciphertext_len", &self.material.ciphertext.len())
            .field("key_version", &self.material.key_version.value())
            .finish()
    }
}
