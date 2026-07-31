//! # ProjectOS Host Windows Master-Key Source (production CNG RNG candidate generator)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-C.
//!
//! One production implementation of the accepted
//! [`projectos_host_windows_crypto_adapter::MasterKeyMaterialSource`] contract. It generates exactly
//! one fresh 32-byte service-master-key CANDIDATE using the Windows system-preferred CNG RNG
//! (`BCryptGenRandom` + `BCRYPT_USE_SYSTEM_PREFERRED_RNG`), yields it ONLY through the accepted
//! closure-scoped borrow, and zeroises it on every exit path.
//!
//! ## What this crate does NOT do / claim
//!
//! It generates CANDIDATE material only: it does NOT protect (no DPAPI), persist, register, rotate, or
//! activate a real service master key; it creates no `ServiceMasterKeyHandle`, no `CryptoOperationId`,
//! and no lifecycle/authority. It has NO deterministic/pseudo-random/caller-supplied/environment/
//! configuration fallback, NO retry, NO owned-byte return, and touches NO filesystem, registry,
//! service, IPC, or credential. It now contains NO `unsafe` at all: the CSPRNG call was relocated to
//! the authority-free leaf primitive `projectos_windows_runtime_primitives::system_random`
//! (CLOSEOUT1B), so exactly one `BCryptGenRandom` implementation serves this dependency route.
//!
//! **Zeroisation limitation:** zeroising clears THIS crate's owned buffer on drop; it cannot remove
//! prior allocator copies, OS paging, crash dumps, hibernation images, or a privileged process reading
//! the address space. No secure physical-memory erasure or credential-custody claim is made.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! The production source has no arbitrary-byte constructor:
//! ```compile_fail
//! use projectos_host_windows_master_key_source::WindowsCngMasterKeyMaterialSource;
//! let _ = WindowsCngMasterKeyMaterialSource::from_bytes(vec![0u8; 32]);
//! ```
//! The production source exposes no raw-material getter:
//! ```compile_fail
//! fn f(s: &projectos_host_windows_master_key_source::WindowsCngMasterKeyMaterialSource) -> &[u8] {
//!     s.material() // no such method
//! }
//! ```
//! A material borrow cannot escape the accepted closure:
//! ```compile_fail
//! use projectos_host_windows_crypto_adapter::MasterKeyMaterialSource;
//! fn f(s: &mut impl MasterKeyMaterialSource) -> &[u8] {
//!     s.with_new_material(|b| b).unwrap()
//! }
//! ```

use std::fmt;

use projectos_host_windows_crypto_adapter::{MasterKeyMaterialSource, MaterialSourceError};
use zeroize::Zeroizing;

/// Delegate to the single canonical system-preferred CSPRNG primitive and map its fieldless error into
/// the accepted contract error. This crate no longer names `BCryptGenRandom`, a CNG flag or an
/// `NTSTATUS`: the behaviour is unchanged, the implementation is simply no longer duplicated here.
fn system_preferred_fill(buf: &mut [u8]) -> Result<(), MaterialSourceError> {
    projectos_windows_runtime_primitives::system_random::system_preferred_fill(buf)
        .map_err(|_| MaterialSourceError::GenerationFailed)
}

/// The exact accepted service-master-key candidate length in bytes (matches the accepted
/// `projectos_host_crypto` `KEY_SIZE_BYTES` policy). No other length is produced or accepted.
const MASTER_KEY_CANDIDATE_LEN: usize = 32;

/// A fill primitive: fill the buffer with fresh randomness, or fail before effect. Production uses the
/// Windows system-preferred CNG RNG; a private `#[cfg(test)]` seam injects deterministic control flow.
type FillFn = fn(&mut [u8]) -> Result<(), MaterialSourceError>;

/// The production Windows CNG master-key material source. Minimal and stateless between calls: it holds
/// no generated material, requires no credential/configuration, mints no handle/operation-id, mutates
/// no lifecycle, and writes no registry/filesystem state. Each accepted invocation generates ONE fresh
/// 32-byte candidate, borrows it for the closure, and zeroises it. `Debug` is fieldless.
pub struct WindowsCngMasterKeyMaterialSource {
    fill: FillFn,
}

impl WindowsCngMasterKeyMaterialSource {
    /// Construct the production source backed by the Windows system-preferred CNG RNG.
    #[must_use]
    pub fn new() -> Self {
        Self {
            fill: system_preferred_fill,
        }
    }

    /// TEST-ONLY private seam: construct with an injected fill primitive to prove control flow without
    /// the real RNG. `pub(crate)` + `#[cfg(test)]` — never public, never in a release build.
    #[cfg(test)]
    pub(crate) fn with_filler_for_test(fill: FillFn) -> Self {
        Self { fill }
    }
}

impl Default for WindowsCngMasterKeyMaterialSource {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for WindowsCngMasterKeyMaterialSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Fieldless: no material is held, and the fill pointer is never disclosed.
        f.debug_struct("WindowsCngMasterKeyMaterialSource").finish()
    }
}

impl MasterKeyMaterialSource for WindowsCngMasterKeyMaterialSource {
    fn with_new_material<R>(
        &mut self,
        f: impl FnOnce(&[u8]) -> R,
    ) -> Result<R, MaterialSourceError> {
        // One fixed-size zeroising buffer. `Zeroizing` clears it on EVERY exit path, including panic
        // unwinding, via Drop. No Vec/String/boxed/static/thread-local copy is made.
        let mut candidate = Zeroizing::new([0u8; MASTER_KEY_CANDIDATE_LEN]);
        // Generate fresh randomness. On failure `?` returns BEFORE the closure runs — no retry, no
        // fallback, and no material reaches `f`.
        (self.fill)(candidate.as_mut_slice())?;
        // Borrow the candidate for the closure only; the borrow never escapes and nothing owned is
        // returned. `candidate` is zeroised when it drops at end of scope.
        Ok(f(candidate.as_slice()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::atomic::{AtomicU32, Ordering::SeqCst};

    // Distinct per-test fill counters (statics shared across parallel tests → one static per fill fn).
    static OK_FILL_CALLS: AtomicU32 = AtomicU32::new(0);
    static FAIL_FILL_CALLS: AtomicU32 = AtomicU32::new(0);
    static PANIC_FILL_CALLS: AtomicU32 = AtomicU32::new(0);

    const TEST_PATTERN: u8 = 0xC3;

    fn ok_fill(buf: &mut [u8]) -> Result<(), MaterialSourceError> {
        OK_FILL_CALLS.fetch_add(1, SeqCst);
        for b in buf.iter_mut() {
            *b = TEST_PATTERN;
        }
        Ok(())
    }
    fn failing_fill(_buf: &mut [u8]) -> Result<(), MaterialSourceError> {
        FAIL_FILL_CALLS.fetch_add(1, SeqCst);
        Err(MaterialSourceError::GenerationFailed)
    }
    fn panic_ok_fill(buf: &mut [u8]) -> Result<(), MaterialSourceError> {
        PANIC_FILL_CALLS.fetch_add(1, SeqCst);
        for b in buf.iter_mut() {
            *b = TEST_PATTERN;
        }
        Ok(())
    }

    #[test]
    fn success_invokes_closure_once_with_exact_length() {
        OK_FILL_CALLS.store(0, SeqCst);
        let mut s = WindowsCngMasterKeyMaterialSource::with_filler_for_test(ok_fill);
        let mut closure_calls = 0u32;
        let len = s
            .with_new_material(|b| {
                closure_calls += 1;
                b.len()
            })
            .expect("fill ok");
        assert_eq!(len, MASTER_KEY_CANDIDATE_LEN); // exactly 32 bytes
        assert_eq!(closure_calls, 1); // closure invoked exactly once
        assert_eq!(OK_FILL_CALLS.load(SeqCst), 1); // one fill, no retry
    }

    #[test]
    fn closure_result_is_returned() {
        let mut s = WindowsCngMasterKeyMaterialSource::with_filler_for_test(ok_fill);
        // The closure observes the requested pattern and its result propagates out.
        let all_pattern = s
            .with_new_material(|b| b.iter().all(|&x| x == TEST_PATTERN))
            .expect("fill ok");
        assert!(all_pattern);
    }

    #[test]
    fn failure_invokes_closure_zero_times_without_retry() {
        FAIL_FILL_CALLS.store(0, SeqCst);
        let mut s = WindowsCngMasterKeyMaterialSource::with_filler_for_test(failing_fill);
        let mut closure_calls = 0u32;
        let r = s.with_new_material(|_b| {
            closure_calls += 1;
        });
        assert!(matches!(r, Err(MaterialSourceError::GenerationFailed)));
        assert_eq!(closure_calls, 0); // closure NOT invoked on generation failure
        assert_eq!(FAIL_FILL_CALLS.load(SeqCst), 1); // one fill attempt, no automatic retry
    }

    #[test]
    fn source_retains_no_material_between_calls() {
        // Stateless: two successive successful calls both succeed and each yields a fresh 32-byte view.
        let mut s = WindowsCngMasterKeyMaterialSource::with_filler_for_test(ok_fill);
        let a = s.with_new_material(|b| b.len()).unwrap();
        let b = s.with_new_material(|b| b.len()).unwrap();
        assert_eq!(a, MASTER_KEY_CANDIDATE_LEN);
        assert_eq!(b, MASTER_KEY_CANDIDATE_LEN);
    }

    #[test]
    fn panic_in_closure_unwinds_and_drops_zeroising_buffer() {
        PANIC_FILL_CALLS.store(0, SeqCst);
        let mut s = WindowsCngMasterKeyMaterialSource::with_filler_for_test(panic_ok_fill);
        // A panic inside the closure unwinds through `with_new_material`; the `Zeroizing` buffer's Drop
        // runs during unwinding (structural guarantee of `Zeroizing`). We can only observe that the
        // unwind occurred — the buffer is gone by the time control returns.
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _ = s.with_new_material(|_b| panic!("closure panic"));
        }));
        assert!(result.is_err());
        assert_eq!(PANIC_FILL_CALLS.load(SeqCst), 1); // one fill, no retry after panic
    }

    #[test]
    fn debug_is_fieldless_and_holds_no_material() {
        let s = WindowsCngMasterKeyMaterialSource::new();
        assert_eq!(format!("{s:?}"), "WindowsCngMasterKeyMaterialSource");
    }
}
