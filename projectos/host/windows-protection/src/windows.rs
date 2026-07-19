//! The ONLY module containing `unsafe`. Real Windows DPAPI FFI: `CryptProtectData` /
//! `CryptUnprotectData` with EXACT machine-scope + UI-forbidden flags, plus exactly-once `LocalFree`
//! of the Windows-owned output through a single RAII guard. Every Windows-owned allocation is released
//! on every success and failure path; no pointer escapes; no slice is built before validation; no
//! panic crosses the FFI boundary. The env-gated live probe + synthetic canary live in the
//! `#[cfg(test)]` submodule only.

use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
    CRYPT_INTEGER_BLOB,
};

use crate::buffer::{ProtectedBlob, UnprotectedOutput};
use crate::error::ProtectionError;
use crate::policy::{
    validate_protected_len, validate_unprotected_len, MAX_INPUT_BYTES, MAX_PROTECTED_BYTES,
};

/// Releases a Windows-owned output allocation. Production uses `LocalFree`; tests inject a counting
/// releaser so the common validate/copy/release path is deterministically testable WITHOUT DPAPI.
trait Releaser {
    /// Release a non-null Windows-owned pointer exactly once.
    fn release(&self, ptr: *mut u8);
}

/// The production releaser: `LocalFree`.
struct LocalFreeReleaser;

impl Releaser for LocalFreeReleaser {
    fn release(&self, ptr: *mut u8) {
        // SAFETY: `ptr` was returned by DPAPI via `LocalAlloc` and is freed exactly once here (the
        // guard calls this at most once, only for a non-null pointer). LocalFree's return value is a
        // non-null handle only on failure; a non-actionable free failure during teardown is ignored
        // deliberately (we do NOT claim secure erasure), and no panic crosses the boundary.
        unsafe {
            LocalFree(ptr.cast());
        }
    }
}

/// Frees a Windows-owned allocation exactly once on drop (only when non-null), then tombstones the
/// pointer. Never cloned or copied; the pointer is private.
struct FreeGuard<'r, R: Releaser> {
    ptr: *mut u8,
    releaser: &'r R,
}

impl<R: Releaser> Drop for FreeGuard<'_, R> {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            self.releaser.release(self.ptr);
            self.ptr = core::ptr::null_mut();
        }
    }
}

/// The common post-DPAPI ownership path: reject a null/invalid pointer, validate the declared length,
/// copy the bytes exactly once into an owned `Vec`, and release the Windows-owned allocation exactly
/// once on EVERY path. A null pointer means nothing was allocated (no release).
fn finalize_output<R: Releaser>(
    ptr: *mut u8,
    cb: u32,
    validate: fn(usize) -> Result<(), ProtectionError>,
    releaser: &R,
) -> Result<Vec<u8>, ProtectionError> {
    if ptr.is_null() {
        // No allocation to release; do not construct a slice from null.
        return Err(ProtectionError::WindowsOutputInvalid);
    }
    let guard = FreeGuard { ptr, releaser };
    let len = cb as usize;
    validate(len)?; // `guard` releases the allocation on this early return
                    // SAFETY: `ptr` is non-null and points to `len` (== `cb`) initialised bytes owned by DPAPI, valid
                    // to read. The copy is immediate; the pointer is not retained after `guard` releases it.
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) }.to_vec();
    drop(guard); // releases exactly once
    Ok(bytes)
}

pub(crate) fn dpapi_protect(input: &[u8]) -> Result<ProtectedBlob, ProtectionError> {
    // Defensive bound so the `as u32` conversion below is always lossless (input is already bounded
    // by the platform entry point).
    if input.is_empty() {
        return Err(ProtectionError::EmptyInput);
    }
    if input.len() > MAX_INPUT_BYTES {
        return Err(ProtectionError::InputTooLarge);
    }
    let cb = input.len() as u32;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: cb,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: core::ptr::null_mut(),
    };
    let flags = CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN;
    // SAFETY: `in_blob` describes `input`, valid for `cb` reads and not mutated by DPAPI. The
    // description/entropy/reserved/prompt pointers are all null (no UI, no user-scope fallback).
    // `out_blob` receives a fresh LocalAlloc buffer that `finalize_output` frees; no pointer is
    // retained across the call.
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            core::ptr::null(),
            core::ptr::null(),
            core::ptr::null(),
            core::ptr::null(),
            flags,
            &mut out_blob,
        )
    };
    if ok == 0 {
        return Err(ProtectionError::ProtectFailed);
    }
    let bytes = finalize_output(
        out_blob.pbData,
        out_blob.cbData,
        validate_protected_len,
        &LocalFreeReleaser,
    )?;
    ProtectedBlob::new(bytes)
}

pub(crate) fn dpapi_unprotect(blob: &[u8]) -> Result<UnprotectedOutput, ProtectionError> {
    if blob.is_empty() {
        return Err(ProtectionError::UnprotectFailed);
    }
    if blob.len() > MAX_PROTECTED_BYTES {
        return Err(ProtectionError::ProtectedOutputTooLarge);
    }
    let cb = blob.len() as u32;
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: cb,
        pbData: blob.as_ptr().cast_mut(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: core::ptr::null_mut(),
    };
    // UI forbidden. The description out-parameter is null, so no Windows-owned description is returned
    // and there is nothing extra to free or log.
    let flags = CRYPTPROTECT_UI_FORBIDDEN;
    // SAFETY: `in_blob` describes `blob`, valid for `cb` reads. `ppszdatadescr` is null (no
    // description). Entropy/reserved/prompt pointers are null. `out_blob` receives a fresh LocalAlloc
    // buffer freed by `finalize_output`.
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            core::ptr::null_mut(),
            core::ptr::null(),
            core::ptr::null(),
            core::ptr::null(),
            flags,
            &mut out_blob,
        )
    };
    if ok == 0 {
        return Err(ProtectionError::UnprotectFailed);
    }
    let bytes = finalize_output(
        out_blob.pbData,
        out_blob.cbData,
        validate_unprotected_len,
        &LocalFreeReleaser,
    )?;
    UnprotectedOutput::new(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// The env gate for the live owner-machine probes (test-only; absent from production).
    const PROBE_GATE_ENV: &str = "PROJECTOS_RUN_WINDOWS_DPAPI_MACHINE_PROBE";
    /// The synthetic, clearly non-secret canary — test-only; never compiled into the library/release.
    const CANARY: &[u8] = b"PROJECTOS-SYNTHETIC-DPAPI-CANARY-3I-DO-NOT-USE";

    fn gate_set() -> bool {
        std::env::var(PROBE_GATE_ENV).as_deref() == Ok("1")
    }

    /// A test-only releaser that counts releases instead of calling `LocalFree`.
    struct CountingReleaser {
        count: Cell<u32>,
    }
    impl CountingReleaser {
        fn new() -> Self {
            Self {
                count: Cell::new(0),
            }
        }
        fn count(&self) -> u32 {
            self.count.get()
        }
    }
    impl Releaser for CountingReleaser {
        fn release(&self, _ptr: *mut u8) {
            self.count.set(self.count.get() + 1);
        }
    }

    // ---- finalize_output ownership seam (no DPAPI) ----

    #[test]
    fn valid_output_copied_and_released_once() {
        let mut buf = vec![0xAAu8; 32];
        let releaser = CountingReleaser::new();
        let out = finalize_output(buf.as_mut_ptr(), 32, validate_protected_len, &releaser).unwrap();
        assert_eq!(out, vec![0xAAu8; 32]);
        assert_eq!(releaser.count(), 1);
    }

    #[test]
    fn valid_plaintext_output_copied_and_released_once() {
        let mut buf = vec![0x5Au8; 16];
        let releaser = CountingReleaser::new();
        let out =
            finalize_output(buf.as_mut_ptr(), 16, validate_unprotected_len, &releaser).unwrap();
        assert_eq!(out.len(), 16);
        assert_eq!(releaser.count(), 1);
    }

    #[test]
    fn null_pointer_rejected_without_slice_and_no_release() {
        let releaser = CountingReleaser::new();
        let err = finalize_output(core::ptr::null_mut(), 16, validate_protected_len, &releaser)
            .unwrap_err();
        assert_eq!(err, ProtectionError::WindowsOutputInvalid);
        assert_eq!(releaser.count(), 0); // nothing was allocated to free
    }

    #[test]
    fn zero_length_rejected_and_released_once() {
        let mut buf = vec![0u8; 4];
        let releaser = CountingReleaser::new();
        let err =
            finalize_output(buf.as_mut_ptr(), 0, validate_protected_len, &releaser).unwrap_err();
        assert_eq!(err, ProtectionError::WindowsOutputInvalid);
        assert_eq!(releaser.count(), 1); // the (non-null) allocation is still released
    }

    #[test]
    fn oversized_protected_output_rejected_and_released_once() {
        let mut buf = vec![0u8; MAX_PROTECTED_BYTES + 1];
        let releaser = CountingReleaser::new();
        let over = u32::try_from(MAX_PROTECTED_BYTES + 1).unwrap();
        let err =
            finalize_output(buf.as_mut_ptr(), over, validate_protected_len, &releaser).unwrap_err();
        assert_eq!(err, ProtectionError::ProtectedOutputTooLarge);
        assert_eq!(releaser.count(), 1);
    }

    #[test]
    fn oversized_plaintext_output_rejected_and_released_once() {
        let mut buf = vec![0u8; MAX_UNPROTECTED_BYTES + 1];
        let releaser = CountingReleaser::new();
        let over = u32::try_from(MAX_UNPROTECTED_BYTES + 1).unwrap();
        let err = finalize_output(buf.as_mut_ptr(), over, validate_unprotected_len, &releaser)
            .unwrap_err();
        assert_eq!(err, ProtectionError::PlaintextOutputTooLarge);
        assert_eq!(releaser.count(), 1);
    }

    use crate::policy::MAX_UNPROTECTED_BYTES;

    // ---- gated live owner-machine probes (real DPAPI) ----

    #[test]
    #[ignore = "live DPAPI machine-scope success probe; run with the env gate set"]
    fn machine_scope_live_probe() {
        if !gate_set() {
            eprintln!("[skip] {PROBE_GATE_ENV} not set to 1; no DPAPI performed");
            return;
        }
        let blob = dpapi_protect(CANARY).expect("protect");
        let protected_differs = blob.as_bytes() != CANARY;
        let output = dpapi_unprotect(blob.as_bytes()).expect("unprotect");
        let round_trip_ok = output.with_bytes(|bytes| bytes == CANARY);

        // Redacted metadata only — never the canary/blob/plaintext bytes.
        eprintln!("platform=windows");
        eprintln!("architecture={}", std::env::consts::ARCH);
        eprintln!("flags=CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN");
        eprintln!("input_len={}", CANARY.len());
        eprintln!("protected_len={}", blob.len());
        eprintln!("unprotected_len={}", output.len());
        eprintln!("round_trip_ok={round_trip_ok}");
        eprintln!("protected_differs={protected_differs}");

        assert!(round_trip_ok, "round-trip must reproduce the input");
        assert!(
            protected_differs,
            "protected blob must differ from plaintext"
        );
        assert_eq!(output.len(), CANARY.len());
        assert!(!blob.is_empty());
    }

    #[test]
    #[ignore = "live DPAPI malformed-blob failure probe; run with the env gate set"]
    fn machine_scope_malformed_blob_probe() {
        if !gate_set() {
            eprintln!("[skip] {PROBE_GATE_ENV} not set to 1; no DPAPI performed");
            return;
        }
        // Clearly synthetic, never a real protected blob or credential.
        let malformed: &[u8] = b"PROJECTOS-SYNTHETIC-NOT-A-DPAPI-BLOB-3I";
        let err = dpapi_unprotect(malformed).unwrap_err();
        eprintln!("input_len={}", malformed.len());
        eprintln!("error={err:?}");
        eprintln!("no_output_returned=true");
        assert_eq!(err, ProtectionError::UnprotectFailed);
    }
}
