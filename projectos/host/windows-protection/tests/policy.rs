//! Pure (no-DPAPI) public-surface tests: bounds rejection happens before any FFI, and the flag/bound
//! constants are exactly as policy dictates.

use projectos_host_windows_protection::{
    protect_machine_scope, ProtectionError, MAX_INPUT_BYTES, MAX_PROTECTED_BYTES,
    MAX_UNPROTECTED_BYTES, PROTECT_FLAGS,
};

#[test]
fn empty_input_rejected_before_ffi() {
    assert_eq!(
        protect_machine_scope(&[]).unwrap_err(),
        ProtectionError::EmptyInput
    );
}

#[test]
fn oversized_input_rejected_before_ffi() {
    let big = vec![0u8; MAX_INPUT_BYTES + 1];
    assert_eq!(
        protect_machine_scope(&big).unwrap_err(),
        ProtectionError::InputTooLarge
    );
}

#[test]
fn flags_and_bounds_are_exact() {
    assert_eq!(PROTECT_FLAGS, 0x4 | 0x1);
    assert_eq!(MAX_INPUT_BYTES, 4096);
    assert_eq!(MAX_PROTECTED_BYTES, 65536);
    assert_eq!(MAX_UNPROTECTED_BYTES, 4096);
}
