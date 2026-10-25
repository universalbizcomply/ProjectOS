//! Error and Debug leakage proof: `StoreError` text is fieldless and never echoes synthetic record
//! content, and the redacted `Debug` of Store/Snapshot/Transaction never renders DTO fields.

mod common;

use projectos_host_persistence::CredentialLifecycleDto;
use projectos_host_store::{Store, StoredRecord};

#[test]
fn error_text_does_not_echo_ciphertext_or_scope() {
    let mut store = Store::new();
    let mut env = common::envelope_dto("cred-1");
    env.ciphertext = "cafef00dsynthetic".to_string();
    env.project = "other-project".to_string(); // forces a consistency failure
    let mut tx = store.begin().expect("begin");
    tx.insert("cred-1", common::metadata("cred-1"))
        .expect("stage meta");
    tx.insert("cred-1", StoredRecord::CredentialEnvelope(env))
        .expect("stage env");
    let err = store.commit(&mut tx).expect_err("must fail");

    let display = format!("{err}");
    let debug = format!("{err:?}");
    for needle in ["cafef00dsynthetic", "other-project", "cred-1"] {
        assert!(!display.contains(needle), "display leaked {needle}");
        assert!(!debug.contains(needle), "debug leaked {needle}");
    }
}

#[test]
fn error_text_does_not_echo_operation_ref() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    // Staged under a key that does not match the record's own operationRef.
    tx.insert("wrongkey", common::operation("opsecretref"))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("must fail");
    assert!(!format!("{err}").contains("opsecretref"));
    assert!(!format!("{err:?}").contains("opsecretref"));
}

#[test]
fn store_and_snapshot_debug_redact_dto_contents() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("opsecretref", common::operation("opsecretref"))
        .expect("stage");
    store.commit(&mut tx).expect("commit");

    let store_debug = format!("{store:?}");
    let snap_debug = format!("{:?}", store.snapshot());
    assert!(
        !store_debug.contains("opsecretref"),
        "store debug leaked ref"
    );
    assert!(
        !snap_debug.contains("opsecretref"),
        "snapshot debug leaked ref"
    );
    // Redacted debug still surfaces non-sensitive structure (a revision label).
    assert!(store_debug.contains("revision"));
}

#[test]
fn ambiguous_binding_error_does_not_echo_fingerprint() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op-1");
    tx.insert("op-2", common::operation("op-2"))
        .expect("stage op-2");
    tx.insert(
        "appr-1",
        StoredRecord::Approval(common::approval_dto("appr-1")),
    )
    .expect("stage approval");
    let err = store.commit(&mut tx).expect_err("ambiguous");
    // Fixture fingerprint is fp-1; it must not appear in the error text.
    assert!(!format!("{err}").contains("fp-1"));
    assert!(!format!("{err:?}").contains("fp-1"));
}

#[test]
fn lifecycle_violation_error_does_not_echo_credential_ref() {
    let mut store = Store::new();
    let mut dto = common::metadata_dto("credsecretref");
    dto.lifecycle = CredentialLifecycleDto::Active;
    let mut tx = store.begin().expect("begin");
    tx.insert("credsecretref", StoredRecord::CredentialMetadata(dto))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("lifecycle violation");
    assert!(!format!("{err}").contains("credsecretref"));
    assert!(!format!("{err:?}").contains("credsecretref"));
}

#[test]
fn transaction_debug_redacts_staged_records() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("opsecretref", common::operation("opsecretref"))
        .expect("stage");
    let tx_debug = format!("{tx:?}");
    assert!(
        !tx_debug.contains("opsecretref"),
        "transaction debug leaked staged record"
    );
    assert!(tx_debug.contains("staged"));
}
