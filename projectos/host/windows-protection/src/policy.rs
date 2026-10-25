//! DPAPI capability policy: proof bounds and the exact (machine-scope + UI-forbidden) flag values.
//! These are PROOF bounds, not final production capacity values. The live-probe gate + synthetic
//! canary are NOT here — they exist only in the `#[cfg(test)]` platform tests.

use crate::error::ProtectionError;

/// Maximum input (bytes).
pub const MAX_INPUT_BYTES: usize = 4096;
/// Maximum accepted protected output (bytes).
pub const MAX_PROTECTED_BYTES: usize = 65536;
/// Maximum accepted unprotected output (bytes).
pub const MAX_UNPROTECTED_BYTES: usize = 4096;

/// `CRYPTPROTECT_UI_FORBIDDEN` value (no interactive UI, ever).
pub const FLAG_UI_FORBIDDEN: u32 = 0x1;
/// `CRYPTPROTECT_LOCAL_MACHINE` value (machine scope).
pub const FLAG_LOCAL_MACHINE: u32 = 0x4;
/// The exact protect flag set: machine scope + UI forbidden. No user-scope fallback, no prompt.
pub const PROTECT_FLAGS: u32 = FLAG_LOCAL_MACHINE | FLAG_UI_FORBIDDEN;

/// Validate input length (non-empty, within [`MAX_INPUT_BYTES`]).
///
/// # Errors
/// [`ProtectionError::EmptyInput`] / [`ProtectionError::InputTooLarge`].
pub(crate) fn validate_input_len(len: usize) -> Result<(), ProtectionError> {
    if len == 0 {
        return Err(ProtectionError::EmptyInput);
    }
    if len > MAX_INPUT_BYTES {
        return Err(ProtectionError::InputTooLarge);
    }
    Ok(())
}

/// Validate a protected-output length.
///
/// # Errors
/// [`ProtectionError::WindowsOutputInvalid`] if zero;
/// [`ProtectionError::ProtectedOutputTooLarge`] if over bound.
pub(crate) fn validate_protected_len(len: usize) -> Result<(), ProtectionError> {
    if len == 0 {
        return Err(ProtectionError::WindowsOutputInvalid);
    }
    if len > MAX_PROTECTED_BYTES {
        return Err(ProtectionError::ProtectedOutputTooLarge);
    }
    Ok(())
}

/// Validate an unprotected-output length.
///
/// # Errors
/// [`ProtectionError::WindowsOutputInvalid`] if zero;
/// [`ProtectionError::PlaintextOutputTooLarge`] if over bound.
pub(crate) fn validate_unprotected_len(len: usize) -> Result<(), ProtectionError> {
    if len == 0 {
        return Err(ProtectionError::WindowsOutputInvalid);
    }
    if len > MAX_UNPROTECTED_BYTES {
        return Err(ProtectionError::PlaintextOutputTooLarge);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_bounds_exact_and_over() {
        assert!(validate_input_len(MAX_INPUT_BYTES).is_ok());
        assert_eq!(
            validate_input_len(MAX_INPUT_BYTES + 1),
            Err(ProtectionError::InputTooLarge)
        );
        assert_eq!(validate_input_len(0), Err(ProtectionError::EmptyInput));
        assert!(validate_input_len(1).is_ok());
    }

    #[test]
    fn protected_bounds_exact_and_over() {
        assert!(validate_protected_len(MAX_PROTECTED_BYTES).is_ok());
        assert_eq!(
            validate_protected_len(MAX_PROTECTED_BYTES + 1),
            Err(ProtectionError::ProtectedOutputTooLarge)
        );
        assert_eq!(
            validate_protected_len(0),
            Err(ProtectionError::WindowsOutputInvalid)
        );
    }

    #[test]
    fn unprotected_bounds_exact_and_over() {
        assert!(validate_unprotected_len(MAX_UNPROTECTED_BYTES).is_ok());
        assert_eq!(
            validate_unprotected_len(MAX_UNPROTECTED_BYTES + 1),
            Err(ProtectionError::PlaintextOutputTooLarge)
        );
        assert_eq!(
            validate_unprotected_len(0),
            Err(ProtectionError::WindowsOutputInvalid)
        );
    }

    #[test]
    fn flags_are_exact_machine_scope_ui_forbidden() {
        assert_eq!(PROTECT_FLAGS, 0x4 | 0x1);
        assert_eq!(FLAG_LOCAL_MACHINE, 0x4);
        assert_eq!(FLAG_UI_FORBIDDEN, 0x1);
    }
}
