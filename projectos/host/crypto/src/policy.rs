//! Algorithm, key-size, nonce, tag, and version policy. This crate represents ONLY the algorithm the
//! accepted architecture uses (AES-256-GCM) and executes NONE of it. There is no fallback: an
//! unsupported algorithm or a malformed size fails closed.

use crate::error::CryptoError;

/// The single supported credential-envelope algorithm identifier.
pub const AES_256_GCM: &str = "AES-256-GCM";
/// Required symmetric key size (bytes) — 256-bit.
pub const KEY_SIZE_BYTES: usize = 32;
/// Required GCM nonce size (bytes) — 96-bit.
pub const NONCE_SIZE_BYTES: usize = 12;
/// Required GCM authentication-tag size (bytes) — 128-bit.
pub const TAG_SIZE_BYTES: usize = 16;
/// The algorithm-policy version. A bump signals a policy change, never a silent fallback.
pub const ALGORITHM_POLICY_VERSION: u32 = 1;

/// The closed set of supported algorithms (exactly one). No untrusted candidate string can add a
/// member; `from_identifier` fails closed for anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CryptoAlgorithm {
    /// AES-256-GCM (authenticated). Represented here; NOT executed here.
    Aes256Gcm,
}

impl CryptoAlgorithm {
    /// The stable identifier string.
    #[must_use]
    pub fn identifier(self) -> &'static str {
        match self {
            CryptoAlgorithm::Aes256Gcm => AES_256_GCM,
        }
    }

    /// Resolve an identifier to the supported algorithm; fail closed otherwise.
    ///
    /// # Errors
    /// [`CryptoError::UnsupportedAlgorithm`] for any non-policy identifier.
    pub fn from_identifier(identifier: &str) -> Result<Self, CryptoError> {
        if identifier == AES_256_GCM {
            Ok(CryptoAlgorithm::Aes256Gcm)
        } else {
            Err(CryptoError::UnsupportedAlgorithm)
        }
    }

    /// Required key size for this algorithm.
    #[must_use]
    pub fn key_size(self) -> usize {
        KEY_SIZE_BYTES
    }
    /// Required nonce size for this algorithm.
    #[must_use]
    pub fn nonce_size(self) -> usize {
        NONCE_SIZE_BYTES
    }
    /// Required tag size for this algorithm.
    #[must_use]
    pub fn tag_size(self) -> usize {
        TAG_SIZE_BYTES
    }
}

/// A non-zero, monotonic wrapping-key version. The caller cannot use zero; an unknown version is
/// refused by the adapter, never silently accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyVersion(u64);

impl KeyVersion {
    /// Construct a non-zero key version.
    ///
    /// # Errors
    /// [`CryptoError::InvalidRevision`] if `value` is zero.
    pub fn new(value: u64) -> Result<Self, CryptoError> {
        if value == 0 {
            return Err(CryptoError::InvalidRevision);
        }
        Ok(Self(value))
    }

    /// The version value.
    #[must_use]
    pub fn value(self) -> u64 {
        self.0
    }

    /// The next version (fails closed on overflow).
    ///
    /// # Errors
    /// [`CryptoError::InvalidRevision`] on overflow.
    pub fn next(self) -> Result<Self, CryptoError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(CryptoError::InvalidRevision)
    }
}
