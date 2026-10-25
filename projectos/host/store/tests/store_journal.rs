//! Multi-family journal completeness: one ordered transition per touched family, exactly once,
//! matching the final manifest, with no partial batch after failure injection.

mod common;

use projectos_host_persistence::TargetFamilyDto;
use projectos_host_store::{InjectStage, Store};

fn targets(store: &Store) -> Vec<TargetFamilyDto> {
    store
        .snapshot()
        .journal()
        .iter()
        .map(|j| j.target_family)
        .collect()
}

#[test]
fn two_family_commit_writes_two_ordered_transitions() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    tx.insert("0", common::audit(0)).expect("stage");
    let outcome = store.commit(&mut tx).expect("commit");

    assert_eq!(outcome.journal_records, 2);
    assert_eq!(outcome.journal_first_seq, Some(0));
    let snap = store.snapshot();
    assert_eq!(snap.journal_len(), 2);
    // Fixed family order: Operation precedes Audit.
    assert_eq!(
        targets(&store),
        vec![TargetFamilyDto::Operation, TargetFamilyDto::Audit]
    );
    let seqs: Vec<u64> = snap.journal().iter().map(|j| j.sequence).collect();
    assert_eq!(seqs, vec![0, 1]);
    assert_eq!(snap.journal()[0].prev_sequence, None);
    assert_eq!(snap.journal()[1].prev_sequence, Some(0));
}

#[test]
fn three_family_commit_writes_three_ordered_transitions() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("pol-a", common::trust("pol-a")).expect("stage");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    tx.insert("0", common::audit(0)).expect("stage");
    let outcome = store.commit(&mut tx).expect("commit");

    assert_eq!(outcome.journal_records, 3);
    assert_eq!(
        targets(&store),
        vec![
            TargetFamilyDto::TrustPolicy,
            TargetFamilyDto::Operation,
            TargetFamilyDto::Audit,
        ]
    );
    let seqs: Vec<u64> = store
        .snapshot()
        .journal()
        .iter()
        .map(|j| j.sequence)
        .collect();
    assert_eq!(seqs, vec![0, 1, 2]);
}

#[test]
fn each_touched_family_appears_once_untouched_absent() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("pol-a", common::trust("pol-a")).expect("stage");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    let _ = store.commit(&mut tx).expect("commit");

    let t = targets(&store);
    assert_eq!(
        t.iter()
            .filter(|f| **f == TargetFamilyDto::TrustPolicy)
            .count(),
        1
    );
    assert_eq!(
        t.iter()
            .filter(|f| **f == TargetFamilyDto::Operation)
            .count(),
        1
    );
    // An untouched family never appears.
    assert_eq!(
        t.iter()
            .filter(|f| **f == TargetFamilyDto::Approval)
            .count(),
        0
    );
    assert_eq!(
        t.iter().filter(|f| **f == TargetFamilyDto::Audit).count(),
        0
    );
}

#[test]
fn journal_transitions_match_final_manifest() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    tx.insert("0", common::audit(0)).expect("stage");
    store.commit(&mut tx).expect("commit");

    let snap = store.snapshot();
    let manifest = snap.manifest().expect("manifest");
    for journal in snap.journal() {
        assert_eq!(journal.record_revision, manifest.store_revision);
        let fam_rev = match journal.target_family {
            TargetFamilyDto::Operation => manifest.family_revisions.operation,
            TargetFamilyDto::Audit => manifest.family_revisions.audit,
            other => panic!("unexpected family {other:?}"),
        };
        assert_eq!(journal.target_revision, fam_rev);
    }
}

#[test]
fn failure_injection_leaves_no_partial_journal_batch() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    tx.insert("0", common::audit(0)).expect("stage");
    tx.inject_failure_for_test(InjectStage::BeforeSwap);
    let err = store.commit(&mut tx).expect_err("must fail");

    assert_eq!(err, projectos_host_store::StoreError::InjectedFailure);
    // No partial batch: the store journal is untouched.
    assert_eq!(store.snapshot().journal_len(), 0);
    assert_eq!(store.revision().value(), 0);
    assert!(store.snapshot().manifest().is_none());
}
