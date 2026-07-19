//! The single, minimal unsafe boundary: the Windows system-preferred CNG RNG fill primitive.
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-C.
//!
//! This module is the ONLY place in the crate permitted to use `unsafe` (allowed at its `mod`
//! declaration in `lib.rs`; the rest of the crate denies unsafe). It fills a caller-owned buffer with
//! system-preferred cryptographic randomness via `BCryptGenRandom` and reports success/failure ONLY —
//! it exposes no raw `NTSTATUS`, no Windows message, no provider internals, no pointer, and no bytes.

use projectos_host_windows_crypto_adapter::MaterialSourceError;

/// Fill `buf` with system-preferred cryptographic randomness. Returns `Ok(())` on success and a
/// fieldless [`MaterialSourceError::GenerationFailed`] on ANY non-success Windows status — no retry, no
/// fallback, no partial-output acceptance. On non-Windows it fails closed (no emulation).
#[cfg(windows)]
pub(crate) fn system_preferred_fill(buf: &mut [u8]) -> Result<(), MaterialSourceError> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };

    // SAFETY: `buf` is a valid, non-null, writable slice of `buf.len()` bytes owned by the caller. A
    // null algorithm handle combined with `BCRYPT_USE_SYSTEM_PREFERRED_RNG` selects the OS
    // system-preferred RNG (no handle to open/close). `BCryptGenRandom` writes exactly `cbBuffer`
    // bytes on success and touches nothing else; the length fits `u32` (fixed 32-byte candidate). We
    // read only the returned status, never a pointer or byte content.
    let status = unsafe {
        BCryptGenRandom(
            core::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };

    // STATUS_SUCCESS is 0; any other NTSTATUS is a known-before-effect generation failure. No raw
    // status value is propagated.
    if status == 0 {
        Ok(())
    } else {
        Err(MaterialSourceError::GenerationFailed)
    }
}

/// Non-Windows fallible stub: DPAPI/CNG is unavailable, so generation fails closed with no emulation.
#[cfg(not(windows))]
pub(crate) fn system_preferred_fill(_buf: &mut [u8]) -> Result<(), MaterialSourceError> {
    Err(MaterialSourceError::GenerationFailed)
}
