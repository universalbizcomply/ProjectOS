//! Happy-path store behaviour: atomic multi-record commits, service-owned monotonic revisions,
//! read-only commits, explicit rollback, replace/remove, and stable snapshots.

mod common;

use projectos_host_store::{RecordFamily, Store, TxState};

#[test]
fn empty_store_starts_at_revision_zero() {
    let store = Store::new();
    assert_eq!(store.revision().value(), 0);
    let snap = store.snapshot();
    assert_eq!(snap.journal_len(), 0);
    assert_eq!(snap.audit_len(), 0);
    assert!(snap.manifest().is_none());
    assert_eq!(snap.family_revisions().operation, 0);
}

#[test]
fn single_insert_commit_advances_revision_and_writes_bookkeeping() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    assert_eq!(tx.base_revision().value(), 0);
    tx.insert("op-1", common::operation("op-1")).expect("stage");

    let outcome = store.commit(&mut tx).expect("commit");
    assert_eq!(outcome.revision.value(), 1);
    assert_eq!(outcome.journal_first_seq, Some(0));
    assert_eq!(outcome.journal_records, 1);
    assert_eq!(tx.state(), TxState::Committed);

    let snap = store.snapshot();
    assert_eq!(snap.revision().value(), 1);
    assert!(snap.operation("op-1").is_some());
    assert_eq!(snap.family_revisions().operation, 1);
    assert_eq!(snap.family_revisions().approval, 0);
    assert_eq!(snap.journal_len(), 1);
    let manifest = snap.manifest().expect("manifest");
    assert_eq!(manifest.store_revision, 1);
    assert_eq!(manifest.family_revisions.operation, 1);
}

#[test]
fn multi_record_commit_is_atomic_across_families() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("pol-a", common::trust("pol-a")).expect("stage");
    tx.insert("polygo", common::registry("polygo"))
        .expect("stage");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    tx.insert("0", common::audit(0)).expect("stage");

    let outcome = store.commit(&mut tx).expect("commit");
    assert_eq!(outcome.revision.value(), 1);
    // One journal record per touched family (4 families).
    assert_eq!(outcome.journal_records, 4);

    let snap = store.snapshot();
    assert_eq!(snap.approval("appr-x"), None);
    assert!(snap.operation("op-1").is_some());
    assert_eq!(snap.audit_len(), 1);
    assert_eq!(snap.journal_len(), 4);
    let fr = snap.family_revisions();
    assert_eq!(fr.trust_policy, 1);
    assert_eq!(fr.project_registry, 1);
    assert_eq!(fr.operation, 1);
    assert_eq!(fr.audit, 1);
    assert_eq!(fr.credential_metadata, 0);
}

#[test]
fn read_only_commit_does_not_advance_revision() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");
    assert_eq!(store.revision().value(), 1);

    let mut ro = store.begin().expect("begin");
    let outcome = store.commit(&mut ro).expect("read-only commit");
    assert_eq!(outcome.revision.value(), 1);
    assert_eq!(outcome.journal_first_seq, None);
    assert_eq!(outcome.journal_records, 0);
    assert_eq!(ro.state(), TxState::Committed);
    assert_eq!(store.revision().value(), 1);
    assert_eq!(store.snapshot().journal_len(), 1);
}

#[test]
fn rollback_leaves_store_unchanged() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.rollback(&mut tx).expect("rollback");
    assert_eq!(tx.state(), TxState::RolledBack);
    assert_eq!(store.revision().value(), 0);
    assert!(store.snapshot().operation("op-1").is_none());
}

#[test]
fn revision_is_monotonic_across_commits() {
    let mut store = Store::new();
    for (idx, key) in ["op-1", "op-2", "op-3"].iter().enumerate() {
        let mut tx = store.begin().expect("begin");
        tx.insert(*key, common::operation(key)).expect("stage");
        let outcome = store.commit(&mut tx).expect("commit");
        assert_eq!(outcome.revision.value(), (idx + 1) as u64);
    }
    let snap = store.snapshot();
    assert_eq!(snap.revision().value(), 3);
    assert_eq!(snap.family_revisions().operation, 3);
    assert_eq!(snap.journal_len(), 3);
}

#[test]
fn replace_then_remove_round_trip() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    let mut tx = store.begin().expect("begin");
    tx.replace("op-1", common::operation("op-1"))
        .expect("stage");
    store.commit(&mut tx).expect("commit replace");
    assert_eq!(store.revision().value(), 2);
    assert!(store.snapshot().operation("op-1").is_some());

    let mut tx = store.begin().expect("begin");
    tx.remove(RecordFamily::Operation, "op-1").expect("stage");
    store.commit(&mut tx).expect("commit remove");
    assert_eq!(store.revision().value(), 3);
    assert!(store.snapshot().operation("op-1").is_none());
    assert_eq!(store.snapshot().family_revisions().operation, 3);
}

#[test]
fn emergency_stop_is_a_singleton() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert(projectos_host_store::EMERGENCY_KEY, common::emergency())
        .expect("stage");
    store.commit(&mut tx).expect("commit");
    assert!(store.snapshot().emergency_stop().is_some());
    assert_eq!(store.snapshot().family_revisions().emergency_stop, 1);
}
