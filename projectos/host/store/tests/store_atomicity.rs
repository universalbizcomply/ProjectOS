//! Atomicity under failure: an injected failure at any commit stage, a mid-batch conflict, and a
//! mid-batch validation failure must all leave the store byte-for-byte unchanged (no partial commit).

mod common;

use projectos_host_store::{InjectStage, Store, StoreError, StoredRecord, TxState};

fn seed_one_operation(store: &mut Store) {
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("seed commit");
}

#[test]
fn injected_failure_before_validation_is_atomic() {
    let mut store = Store::new();
    seed_one_operation(&mut store);
    let before = store.snapshot();

    let mut tx = store.begin().expect("begin");
    tx.insert("op-2", common::operation("op-2")).expect("stage");
    tx.inject_failure_for_test(InjectStage::BeforeValidation);
    let err = store.commit(&mut tx).expect_err("must fail");

    assert_eq!(err, StoreError::InjectedFailure);
    assert_eq!(tx.state(), TxState::Failed);
    assert_eq!(store.revision().value(), before.revision().value());
    assert!(store.snapshot().operation("op-2").is_none());
    assert_eq!(store.snapshot().journal_len(), before.journal_len());
}

#[test]
fn injected_failure_after_validation_is_atomic() {
    let mut store = Store::new();
    seed_one_operation(&mut store);

    let mut tx = store.begin().expect("begin");
    tx.insert("op-2", common::operation("op-2")).expect("stage");
    tx.inject_failure_for_test(InjectStage::AfterValidation);
    let err = store.commit(&mut tx).expect_err("must fail");

    assert_eq!(err, StoreError::InjectedFailure);
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().operation("op-2").is_none());
}

#[test]
fn injected_failure_before_swap_discards_fully_prepared_state() {
    let mut store = Store::new();
    seed_one_operation(&mut store);
    let before_rev = store.revision().value();
    let before_journal = store.snapshot().journal_len();

    let mut tx = store.begin().expect("begin");
    tx.insert("op-2", common::operation("op-2")).expect("stage");
    // The candidate state (record + advanced revisions + journal + manifest) is fully built, then
    // discarded at the last instant before the swap.
    tx.inject_failure_for_test(InjectStage::BeforeSwap);
    let err = store.commit(&mut tx).expect_err("must fail");

    assert_eq!(err, StoreError::InjectedFailure);
    assert_eq!(tx.state(), TxState::Failed);
    assert_eq!(store.revision().value(), before_rev);
    assert!(store.snapshot().operation("op-2").is_none());
    assert_eq!(store.snapshot().journal_len(), before_journal);
    assert_eq!(store.snapshot().family_revisions().operation, 1);
}

#[test]
fn conflict_in_batch_rolls_back_the_whole_batch() {
    let mut store = Store::new();
    seed_one_operation(&mut store);

    let mut tx = store.begin().expect("begin");
    // A good insert followed by a duplicate — the batch must fail as a unit.
    tx.insert("op-2", common::operation("op-2"))
        .expect("stage good");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage dup");
    let err = store.commit(&mut tx).expect_err("batch must fail");

    assert_eq!(err, StoreError::DuplicateRecord);
    assert_eq!(store.revision().value(), 1);
    // Neither the good insert nor the conflicting one landed.
    assert!(store.snapshot().operation("op-2").is_none());
    assert!(store.snapshot().operation("op-1").is_some());
}

#[test]
fn invalid_record_in_batch_rolls_back_the_whole_batch() {
    let mut store = Store::new();

    let mut tx = store.begin().expect("begin");
    tx.insert("pol-a", common::trust("pol-a"))
        .expect("stage good");
    // A structurally invalid operation (unsupported schema version) must fail per-record validation.
    let mut bad = common::operation_dto("op-2");
    bad.schema_version = 9;
    tx.insert("op-2", StoredRecord::Operation(bad))
        .expect("stage bad");
    let err = store.commit(&mut tx).expect_err("invalid record must fail");

    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 0);
    // The valid record in the same batch also did not land.
    assert!(store.snapshot().manifest().is_none());
}
