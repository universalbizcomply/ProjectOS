//! API-sealing + error-discipline tests. Direct construction of sealed buffers and raw-byte getters
//! are proven unavailable by the `compile_fail` doctests in the crate docs; here we check the
//! runtime discipline: errors are fieldless and echo nothing, and Debug renders no bytes.

use projectos_host_windows_protection::{protect_machine_scope, ProtectionError};

#[test]
fn error_display_and_debug_are_fieldless() {
    // Trigger a pre-FFI error with a recognisable input pattern; the error must not echo it.
    let marked = b"SENSITIVE-MARKER-BYTES".to_vec();
    // Oversized so it is rejected before any FFI, regardless of platform.
    let big = [marked.clone(), vec![0u8; 5000]].concat();
    let err = protect_machine_scope(&big).unwrap_err();
    assert_eq!(err, ProtectionError::InputTooLarge);
    let (d, dbg) = (format!("{err}"), format!("{err:?}"));
    assert!(!d.contains("SENSITIVE-MARKER-BYTES"));
    assert!(!dbg.contains("SENSITIVE-MARKER-BYTES"));
    // Fieldless: Display is a short classification, Debug is the variant name only.
    assert_eq!(d, "input too large");
    assert_eq!(dbg, "InputTooLarge");
}

#[test]
fn empty_input_error_is_classification_only() {
    let err = protect_machine_scope(&[]).unwrap_err();
    assert_eq!(format!("{err}"), "empty input");
    assert_eq!(format!("{err:?}"), "EmptyInput");
}
