//! THE canonical Windows system-preferred CSPRNG fill primitive.
//!
//! Relocated here (CD-B4-INSTALLER-CANONICAL-IDENTITY-RECORD-WRITER1A-CLOSEOUT1B) from
//! `windows-master-key-source`, which kept it `pub(crate)` behind a MASTER-KEY capability whose
//! dependency graph reaches `host-core` and `host-authority`. Any crate needing OS randomness had to
//! take that authority graph, or write a second `BCryptGenRandom`. Now there is exactly one
//! implementation, on a leaf that owns no authority at all.
//!
//! This primitive grants NOTHING. It fills a caller-owned buffer and reports success or failure. It
//! exposes no `NTSTATUS`, no Windows message, no provider internals, no algorithm handle, no pointer,
//! and no key, credential, master-key or identity semantics of any kind. What the bytes are used for is
//! entirely the caller's contract, not this module's.

/// Why a fill could not be produced. Fieldless on purpose: no OS status escapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SystemRandomError {
    /// The OS RNG did not report success. No retry, no fallback, no partial-output acceptance.
    GenerationFailed,
    /// The requested length is one this primitive refuses to serve: empty, or larger than the Windows
    /// API can represent. Refused BEFORE any OS call.
    UnsupportedLength,
}

/// Fill `destination` with system-preferred cryptographic randomness.
///
/// Uses `BCryptGenRandom` with `BCRYPT_USE_SYSTEM_PREFERRED_RNG`, so no algorithm handle is opened or
/// closed. There is no second entropy source: on any failure this returns an error rather than
/// substituting a timestamp, PID, pseudo-random generator or partially-written buffer.
///
/// An empty destination is refused rather than trivially succeeded: a caller that asked for zero bytes
/// and then treats the buffer as random is a bug, and returning `Ok` would hide it.
///
/// # Errors
/// [`SystemRandomError::UnsupportedLength`] for an empty or unrepresentable length (checked before any
/// OS call); [`SystemRandomError::GenerationFailed`] on any non-success Windows status.
#[cfg(windows)]
pub fn system_preferred_fill(destination: &mut [u8]) -> Result<(), SystemRandomError> {
    use windows::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };

    if destination.is_empty() {
        return Err(SystemRandomError::UnsupportedLength);
    }
    // The Windows API counts bytes in a `u32`. Checked explicitly here: a silent `as u32` truncation
    // would fill only part of a large buffer and still report success.
    if u32::try_from(destination.len()).is_err() {
        return Err(SystemRandomError::UnsupportedLength);
    }

    // SAFETY: `destination` is a valid, non-empty, writable slice owned by the caller, and its length
    // is known to fit `u32` (checked above). A `None` algorithm handle combined with
    // `BCRYPT_USE_SYSTEM_PREFERRED_RNG` selects the OS system-preferred RNG, so no handle is opened or
    // leaked. `BCryptGenRandom` writes exactly `destination.len()` bytes on success and touches nothing
    // else. Only the returned status is read — never a pointer or byte content.
    let status = unsafe { BCryptGenRandom(None, destination, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };

    if status.is_ok() {
        Ok(())
    } else {
        Err(SystemRandomError::GenerationFailed)
    }
}

/// Non-Windows: CNG does not exist, so this fails closed. It never emulates randomness.
#[cfg(not(windows))]
pub fn system_preferred_fill(destination: &mut [u8]) -> Result<(), SystemRandomError> {
    if destination.is_empty() {
        return Err(SystemRandomError::UnsupportedLength);
    }
    Err(SystemRandomError::GenerationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Refusals that are decided BEFORE the OS call, so no CSPRNG is executed by the test suite.
    #[test]
    fn an_empty_destination_is_refused_without_calling_the_os() {
        let mut empty: [u8; 0] = [];
        assert_eq!(
            system_preferred_fill(&mut empty),
            Err(SystemRandomError::UnsupportedLength)
        );
    }

    #[test]
    fn the_error_type_carries_no_os_detail() {
        // Fieldless variants: matching them cannot yield an NTSTATUS or message.
        assert_ne!(
            SystemRandomError::GenerationFailed,
            SystemRandomError::UnsupportedLength
        );
        assert_eq!(
            format!("{:?}", SystemRandomError::GenerationFailed),
            "GenerationFailed"
        );
    }
}
