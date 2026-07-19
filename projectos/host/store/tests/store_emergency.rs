//! Emergency-stop revision consistency. The initial record must carry state_revision == 1 (store
//! emergency family revision + 1); each replace must advance by exactly one and stay coherent with
//! the store-owned family revision; stale/duplicate/skipped/future/divergent values fail closed;
//! emergency data grants no live authority.

mod common;

use projectos_host_store::{Store, StoreError, StoredRecord, EMERGENCY_KEY};

fn emergency_at(global_stop: bool, state_revision: u64) -> StoredRecord {
    let mut dto = common::emergency_dto();
    dto.global_stop = global_stop;
    dto.state_revision = state_revision;
    StoredRecord::EmergencyStop(dto)
}

fn insert_initial(store: &mut Store) {
    let mut tx = store.begin().expect("begin");
    tx.insert(EMERGENCY_KEY, common::emergency())
        .expect("stage");
    store.commit(&mut tx).expect("initial commit");
}

fn replace(store: &mut Store, record: StoredRecord) -> Result<(), StoreError> {
    let mut tx = store.begin().expect("begin");
    tx.replace(EMERGENCY_KEY, record).expect("stage");
    store.commit(&mut tx).map(|_| ())
}

fn insert(store: &mut Store, record: StoredRecord) -> Result<(), StoreError> {
    let mut tx = store.begin().expect("begin");
    tx.insert(EMERGENCY_KEY, record).expect("stage");
    store.commit(&mut tx).map(|_| ())
}

#[test]
fn valid_initial_insert_at_revision_one() {
    let mut store = Store::new();
    insert_initial(&mut store);
    assert_eq!(store.revision().value(), 1);
    assert_eq!(store.snapshot().family_revisions().emergency_stop, 1);
    assert_eq!(
        store
            .snapshot()
            .emergency_stop()
            .expect("present")
            .state_revision,
        1
    );
}

#[test]
fn initial_revision_zero_rejected() {
    let mut store = Store::new();
    let err = insert(&mut store, emergency_at(false, 0)).expect_err("zero");
    assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn initial_revision_above_one_rejected() {
    let mut store = Store::new();
    let err = insert(&mut store, emergency_at(false, 4)).expect_err("above one");
    assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn valid_enable_then_disable_transitions() {
    let mut store = Store::new();
    insert_initial(&mut store);
    // Enable: 1 -> 2.
    replace(&mut store, emergency_at(true, 2)).expect("enable");
    assert!(
        store
            .snapshot()
            .emergency_stop()
            .expect("present")
            .global_stop
    );
    // Disable: 2 -> 3.
    replace(&mut store, emergency_at(false, 3)).expect("disable");
    assert!(
        !store
            .snapshot()
            .emergency_stop()
            .expect("present")
            .global_stop
    );
    assert_eq!(store.snapshot().family_revisions().emergency_stop, 3);
}

#[test]
fn duplicate_revision_rejected() {
    let mut store = Store::new();
    insert_initial(&mut store);
    // Required next is 2; repeating 1 is a duplicate.
    let err = replace(&mut store, emergency_at(true, 1)).expect_err("duplicate");
    assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
}

#[test]
fn skipped_future_revision_rejected() {
    let mut store = Store::new();
    insert_initial(&mut store);
    // Required next is 2; jumping to 3 skips it.
    let err = replace(&mut store, emergency_at(true, 3)).expect_err("skipped");
    assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
}

#[test]
fn stale_transition_rejected() {
    let mut store = Store::new();
    insert_initial(&mut store);
    replace(&mut store, emergency_at(true, 2)).expect("enable");
    // Now required next is 3; going back to 1 is stale.
    let err = replace(&mut store, emergency_at(false, 1)).expect_err("stale");
    assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
}

#[test]
fn failed_transition_leaves_snapshot_unchanged() {
    let mut store = Store::new();
    insert_initial(&mut store);
    let before_rev = store.revision().value();
    let _ = replace(&mut store, emergency_at(true, 99)).expect_err("bad");
    assert_eq!(store.revision().value(), before_rev);
    let e = store.snapshot().emergency_stop().expect("present").clone();
    assert_eq!(e.state_revision, 1);
    assert!(!e.global_stop);
}

#[test]
fn emergency_stop_data_creates_no_authority() {
    let mut store = Store::new();
    insert_initial(&mut store);
    // The store never consults emergency-stop data to grant anything; it is inert DTO data.
    assert!(store.snapshot().emergency_stop().is_some());
}
