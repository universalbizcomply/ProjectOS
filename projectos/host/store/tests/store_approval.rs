//! Approval-to-operation transactional consistency. A committed approval must bind to a committed
//! operation (by fingerprint + full scope + expiry); it never becomes live authority.

mod common;

use projectos_host_store::{Store, StoreError, StoredRecord};

fn commit_op_and_approval(
    store: &mut Store,
    approval: projectos_host_persistence::ApprovalRecordDto,
) -> Result<(), StoreError> {
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op");
    tx.insert(
        approval.approval_id.clone(),
        StoredRecord::Approval(approval),
    )
    .expect("stage approval");
    store.commit(&mut tx).map(|_| ())
}

#[test]
fn valid_operation_and_matching_approval_accepted() {
    let mut store = Store::new();
    // Fixture approval already matches the fixture operation (fingerprint fp-1, same scope, expiry ok).
    commit_op_and_approval(&mut store, common::approval_dto("appr-1")).expect("commit");
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().approval("appr-1").is_some());
}

#[test]
fn approval_without_operation_rejected() {
    let mut store = Store::new();
    // Approval binds to a fingerprint that no committed operation has.
    let mut approval = common::approval_dto("appr-1");
    approval.fingerprint = "fp-absent".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op");
    tx.insert("appr-1", StoredRecord::Approval(approval))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("must fail");
    assert_eq!(err, StoreError::MissingRecord);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn approval_referencing_absent_operation_rejected() {
    let mut store = Store::new();
    // Only an approval, no operation at all.
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "appr-1",
        StoredRecord::Approval(common::approval_dto("appr-1")),
    )
    .expect("stage");
    let err = store.commit(&mut tx).expect_err("must fail");
    assert_eq!(err, StoreError::MissingRecord);
}

#[test]
fn project_mismatch_rejected() {
    let mut store = Store::new();
    let mut approval = common::approval_dto("appr-1");
    approval.project = "other-project".to_string();
    let err = commit_op_and_approval(&mut store, approval).expect_err("must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn environment_mismatch_rejected() {
    let mut store = Store::new();
    let mut approval = common::approval_dto("appr-1");
    approval.environment = "production".to_string();
    let err = commit_op_and_approval(&mut store, approval).expect_err("must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
}

#[test]
fn action_scope_mismatch_rejected() {
    let mut store = Store::new();
    let mut approval = common::approval_dto("appr-1");
    approval.operation = "destructive-apply".to_string();
    let err = commit_op_and_approval(&mut store, approval).expect_err("must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
}

#[test]
fn expiry_contradiction_rejected() {
    let mut store = Store::new();
    let mut approval = common::approval_dto("appr-1");
    // Operation expiry boundary is 1000; an approval that expires earlier is contradictory.
    approval.expiry = 500;
    let err = commit_op_and_approval(&mut store, approval).expect_err("must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
}

#[test]
fn one_bad_approval_aborts_multi_record_transaction() {
    let mut store = Store::new();
    let mut approval = common::approval_dto("appr-1");
    approval.project = "other-project".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op");
    tx.insert("polygo", common::registry("polygo"))
        .expect("stage registry");
    tx.insert("appr-1", StoredRecord::Approval(approval))
        .expect("stage approval");
    let err = store.commit(&mut tx).expect_err("must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);
    // Nothing advanced.
    assert_eq!(store.revision().value(), 0);
    assert!(store.snapshot().operation("op-1").is_none());
    assert_eq!(store.snapshot().journal_len(), 0);
    assert_eq!(store.snapshot().family_revisions().operation, 0);
}

#[test]
fn stored_approval_creates_no_live_authority() {
    let mut store = Store::new();
    commit_op_and_approval(&mut store, common::approval_dto("appr-1")).expect("commit");
    // The read path returns the approval DTO only — there is no permit/session/lease API.
    let snap = store.snapshot();
    let approval = snap.approval("appr-1").expect("approval");
    assert_eq!(approval.approval_id, "appr-1");
}

#[test]
fn two_operations_sharing_a_fingerprint_make_approval_ambiguous() {
    let mut store = Store::new();
    // op-1 and op-2 both carry fingerprint fp-1 (the fixture default); the approval binds to fp-1.
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
    // No first-match selection — the ambiguity is refused deterministically.
    assert_eq!(err, StoreError::AmbiguousOperationBinding);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn cross_project_fingerprint_collision_is_ambiguous() {
    let mut store = Store::new();
    // Same fingerprint fp-1 on operations in different projects: still an ambiguous bind.
    let mut other = common::operation_dto("op-2");
    other.project = "other-project".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op-1");
    tx.insert("op-2", StoredRecord::Operation(other))
        .expect("stage op-2");
    tx.insert(
        "appr-1",
        StoredRecord::Approval(common::approval_dto("appr-1")),
    )
    .expect("stage approval");
    let err = store.commit(&mut tx).expect_err("ambiguous");
    assert_eq!(err, StoreError::AmbiguousOperationBinding);
}

#[test]
fn ambiguous_approval_aborts_multi_record_transaction() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op-1");
    tx.insert("op-2", common::operation("op-2"))
        .expect("stage op-2");
    tx.insert("polygo", common::registry("polygo"))
        .expect("stage registry");
    tx.insert(
        "appr-1",
        StoredRecord::Approval(common::approval_dto("appr-1")),
    )
    .expect("stage approval");
    let err = store.commit(&mut tx).expect_err("ambiguous");
    assert_eq!(err, StoreError::AmbiguousOperationBinding);
    assert_eq!(store.revision().value(), 0);
    assert!(store.snapshot().operation("op-1").is_none());
    assert_eq!(store.snapshot().journal_len(), 0);
}
