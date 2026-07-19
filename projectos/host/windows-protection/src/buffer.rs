//! Sealed, bounded owned buffers. Secret-bearing buffers zeroise on drop, expose no public raw-byte
//! getter, are non-serializable/non-cloneable/non-displayable, and render a redacted `Debug`.

use std::fmt;

use zeroize::ZeroizeOnDrop;

use crate::error::ProtectionError;
use crate::policy::{validate_protected_len, validate_unprotected_len};

/// An opaque, bounded DPAPI protected blob. Not plaintext; still never logged and has no public byte
/// getter. `Debug` shows only the length.
pub struct ProtectedBlob {
    bytes: Vec<u8>,
}

impl ProtectedBlob {
    pub(crate) fn new(bytes: Vec<u8>) -> Result<Self, ProtectionError> {
        validate_protected_len(bytes.len())?;
        Ok(Self { bytes })
    }
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
    /// The protected blob length (non-secret metadata).
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

impl fmt::Debug for ProtectedBlob {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProtectedBlob")
            .field("len", &self.bytes.len())
            .finish()
    }
}

/// A bounded, owned DPAPI unprotected-output buffer. Cleared on drop; no public raw-byte getter —
/// access is closure-scoped and never returns the slice.
#[derive(ZeroizeOnDrop)]
pub struct UnprotectedOutput {
    bytes: Vec<u8>,
}

impl UnprotectedOutput {
    pub(crate) fn new(bytes: Vec<u8>) -> Result<Self, ProtectionError> {
        validate_unprotected_len(bytes.len())?;
        Ok(Self { bytes })
    }
    /// Run `f` against a read-only view of the owned bytes; the borrow is scoped to the closure and is
    /// NEVER returned to the caller.
    pub fn with_bytes<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(&self.bytes)
    }
    /// The output length (non-secret metadata).
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

impl fmt::Debug for UnprotectedOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UnprotectedOutput")
            .field("len", &self.bytes.len())
            .finish()
    }
}
