//! Conflict and refusal behaviour: stale-write refusal, duplicate/missing keys, identity mismatch,
//! invalid transaction state, cross-record scope mismatch, and resource bounds.

mod common;

use projectos_host_store::{RecordFamily, Store, StoreError, TxState, MAX_STAGED_OPS};

#[test]
fn stale_base_is_refused_and_store_unchanged() {
    let mut store = Store::new();
    // Two transactions opened against revision 0.
    let mut first = store.begin().expect("begin");
    let mut second = store.begin().expect("begin");
    first
        .insert("op-1", common::operation("op-1"))
        .expect("stage");
    second
        .insert("op-2", common::operation("op-2"))
        .expect("stage");

    store.commit(&mut first).expect("first commit");
    assert_eq!(store.revision().value(), 1);

    let err = store.commit(&mut second).expect_err("stale must fail");
    assert_eq!(err, StoreError::StaleBase);
    assert_eq!(second.state(), TxState::Failed);
    // The losing transaction changed nothing.
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().operation("op-2").is_none());
}

#[test]
fn duplicate_insert_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    let mut dup = store.begin().expect("begin");
    dup.insert("op-1", common::operation("op-1"))
        .expect("stage");
    let err = store.commit(&mut dup).expect_err("duplicate must fail");
    assert_eq!(err, StoreError::DuplicateRecord);
    assert_eq!(store.revision().value(), 1);
}

#[test]
fn replace_missing_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.replace("op-x", common::operation("op-x"))
        .expect("stage");
    let err = store
        .commit(&mut tx)
        .expect_err("replace-missing must fail");
    assert_eq!(err, StoreError::MissingRecord);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn remove_missing_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.remove(RecordFamily::Operation, "op-x").expect("stage");
    let err = store.commit(&mut tx).expect_err("remove-missing must fail");
    assert_eq!(err, StoreError::MissingRecord);
}

#[test]
fn identity_mismatch_between_key_and_record_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    // Record's own key is "op-1" but it is staged under "wrong-key".
    tx.insert("wrong-key", common::operation("op-1"))
        .expect("stage");
    let err = store
        .commit(&mut tx)
        .expect_err("identity mismatch must fail");
    assert_eq!(err, StoreError::IdentityMismatch);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn commit_after_commit_is_invalid_state() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");
    let err = store.commit(&mut tx).expect_err("double commit must fail");
    assert_eq!(err, StoreError::InvalidTransactionState);
    // Still committed — the terminal state is not reclassified.
    assert_eq!(tx.state(), TxState::Committed);
}

#[test]
fn staging_after_terminal_state_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    store.rollback(&mut tx).expect("rollback");
    let err = tx
        .insert("op-1", common::operation("op-1"))
        .expect_err("stage after rollback must fail");
    assert_eq!(err, StoreError::InvalidTransactionState);
}

#[test]
fn commit_after_rollback_is_invalid_state() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    store.rollback(&mut tx).expect("rollback");
    let err = store
        .commit(&mut tx)
        .expect_err("commit after rollback must fail");
    assert_eq!(err, StoreError::InvalidTransactionState);
    assert_eq!(tx.state(), TxState::RolledBack);
}

#[test]
fn envelope_metadata_scope_mismatch_is_refused() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("cred-1", common::metadata("cred-1"))
        .expect("stage");
    // Same credential key, but a different project — an incoherent pairing.
    let mut env = common::envelope_dto("cred-1");
    env.project = "other-project".to_string();
    tx.insert(
        "cred-1",
        projectos_host_store::StoredRecord::CredentialEnvelope(env),
    )
    .expect("stage");
    let err = store.commit(&mut tx).expect_err("scope mismatch must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn staged_operation_bound_is_enforced() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    for i in 0..MAX_STAGED_OPS {
        let key = format!("op-{i}");
        tx.insert(&key, common::operation(&key))
            .expect("stage within bound");
    }
    let over = format!("op-{MAX_STAGED_OPS}");
    let err = tx
        .insert(&over, common::operation(&over))
        .expect_err("over-bound stage must fail");
    assert_eq!(err, StoreError::ResourceLimit);
}
