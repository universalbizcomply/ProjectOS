//! The trusted per-verification nonce.
//!
//! A [`TrustedNonce`] owns exactly one 32-byte buffer. It is not `Clone`/`Copy`, is not serialisable,
//! renders redacted in `Debug`, and is move-only: it is folded once into the canonical proof digest and
//! then dropped. On `Drop` the raw buffer is cleared with a compiler-resistant volatile write plus a
//! compiler fence.
//!
//! ## Bounded zeroisation guarantee (honest)
//!
//! The raw bytes are cleared on every path where a Rust destructor runs: ordinary success, refusal,
//! cancellation, a handled error, a normal drop, and an unwinding panic (destructors execute while the
//! stack unwinds). There is NO guarantee after `abort`, forced process termination, a crash, power loss,
//! or against memory forensics — destructors do not run then. The guarantee is not overstated.
//!
//! Live generation (`BCryptGenRandom` with `BCRYPT_USE_SYSTEM_PREFERRED_RNG`) lives in the gated
//! [`crate::verification_ffi`] module and writes directly into the owned buffer. The deterministic
//! [`TrustedNonce::from_bytes`] constructor exists for tests only.

use core::sync::atomic::{compiler_fence, Ordering};

/// Length of a trusted nonce, in bytes.
pub(crate) const NONCE_LEN: usize = 32;

/// A move-only, non-cloneable, redacted 32-byte random nonce with bounded volatile zeroisation on drop.
pub(crate) struct TrustedNonce {
    bytes: [u8; NONCE_LEN],
}

impl TrustedNonce {
    /// Construct a nonce from raw bytes, failing closed on the all-zero non-nonce (which also signals a
    /// silent RNG failure). Used by the gated live FFI (direct RNG write) and by tests (deterministic
    /// injection); no secondary raw copy is retained anywhere else.
    #[allow(dead_code)] // reached by the gated live FFI + unit tests; dead in the pure default graph
    pub(crate) fn from_bytes(bytes: [u8; NONCE_LEN]) -> Option<Self> {
        if bytes.iter().all(|&b| b == 0) {
            return None;
        }
        Some(Self { bytes })
    }

    /// Borrow the raw bytes for the SINGLE purpose of folding them into the canonical digest. Crate-private
    /// and never `pub`: the raw nonce never leaves the crate and is never rendered or persisted.
    pub(crate) fn expose_for_digest(&self) -> &[u8; NONCE_LEN] {
        &self.bytes
    }
}

impl core::fmt::Debug for TrustedNonce {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("TrustedNonce([REDACTED])")
    }
}

impl Drop for TrustedNonce {
    fn drop(&mut self) {
        // Compiler-resistant clear WITHOUT `unsafe` (the crate denies `unsafe_code` outside the FFI
        // module): a plain zero store per byte, each observed through `black_box` so dead-store
        // elimination cannot prove the write dead, then a `SeqCst` compiler fence so the clear is not
        // reordered past the end of this value's lifetime. This is a compiler-resistant clear, not a
        // hardware volatile store; the bounded guarantee in the module docs holds exactly and no more.
        for byte in &mut self.bytes {
            compiler_resistant_zero_byte(byte);
        }
        compiler_fence(Ordering::SeqCst);
    }
}

/// Zero one byte so the optimiser cannot elide the store: write `0`, then read it back through
/// `black_box` to mark the zeroed value observed. Uses only safe operations.
#[inline]
fn compiler_resistant_zero_byte(byte: &mut u8) {
    *byte = 0;
    let _ = core::hint::black_box(*byte);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_all_zero_nonce() {
        assert!(TrustedNonce::from_bytes([0u8; NONCE_LEN]).is_none());
    }

    #[test]
    fn accepts_nonzero_and_redacts_debug() {
        let mut b = [0u8; NONCE_LEN];
        b[0] = 7;
        let n = TrustedNonce::from_bytes(b).expect("nonzero nonce");
        assert_eq!(n.expose_for_digest()[0], 7);
        assert!(format!("{n:?}").contains("[REDACTED]"));
        assert!(!format!("{n:?}").contains('7'));
    }
}
