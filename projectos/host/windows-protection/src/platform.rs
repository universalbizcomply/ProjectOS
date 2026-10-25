//! The platform boundary. On Windows it dispatches to the real DPAPI wrapper; on any other platform
//! it fails closed (`UnsupportedPlatform`) with NO emulation and NO fake success. This module contains
//! NO `unsafe`.

use crate::buffer::{ProtectedBlob, UnprotectedOutput};
use crate::error::ProtectionError;
use crate::policy::validate_input_len;

/// Protect `input` under DPAPI machine scope (UI forbidden). Bounds are validated before any FFI, so
/// oversized/empty input is rejected on every platform without invoking DPAPI.
///
/// # Errors
/// [`ProtectionError::EmptyInput`] / [`ProtectionError::InputTooLarge`] on bounds;
/// [`ProtectionError::UnsupportedPlatform`] off Windows; a DPAPI error otherwise.
pub fn protect_machine_scope(input: &[u8]) -> Result<ProtectedBlob, ProtectionError> {
    validate_input_len(input.len())?;
    #[cfg(windows)]
    {
        crate::windows::dpapi_protect(input)
    }
    #[cfg(not(windows))]
    {
        let _ = input;
        Err(ProtectionError::UnsupportedPlatform)
    }
}

/// Unprotect a previously-protected blob (UI forbidden).
///
/// # Errors
/// [`ProtectionError::UnsupportedPlatform`] off Windows; a DPAPI error otherwise.
pub fn unprotect_machine_scope(blob: &ProtectedBlob) -> Result<UnprotectedOutput, ProtectionError> {
    #[cfg(windows)]
    {
        crate::windows::dpapi_unprotect(blob.as_bytes())
    }
    #[cfg(not(windows))]
    {
        let _ = blob;
        Err(ProtectionError::UnsupportedPlatform)
    }
}
