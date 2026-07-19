//! Authority-exclusion behaviour: the store returns inert DTO data only, never a live permit/session/
//! lease/eligibility; snapshots are stable; revisions are service-owned; and a stored revision is an
//! observation — never treated as the authoritative current state.

mod common;

use projectos_host_persistence::{JournalPhaseDto, JournalRecordDto, TargetFamilyDto};
use projectos_host_store::{Store, StoreError};

#[test]
fn snapshot_returns_stored_dto_data_only() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    let dto = common::operation_dto("op-1");
    tx.insert(
        "op-1",
        projectos_host_store::StoredRecord::Operation(dto.clone()),
    )
    .expect("stage");
    store.commit(&mut tx).expect("commit");

    // The read path yields exactly the stored DTO — plain data, no authority object.
    let snap = store.snapshot();
    assert_eq!(snap.operation("op-1"), Some(&dto));
    // A stored operation carries a high recordRevision (5) but that grants nothing; the store's own
    // service-owned family revision is 1.
    assert_eq!(dto.record_revision, 5);
    assert_eq!(snap.family_revisions().operation, 1);
}

#[test]
fn old_snapshot_is_stable_after_later_commits() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    let early = store.snapshot();
    assert_eq!(early.revision().value(), 1);

    // Commit more; the earlier snapshot must NOT observe it (no live recomputation).
    let mut tx = store.begin().expect("begin");
    tx.insert("op-2", common::operation("op-2")).expect("stage");
    store.commit(&mut tx).expect("commit");

    assert_eq!(early.revision().value(), 1);
    assert!(early.operation("op-2").is_none());
    assert_eq!(store.snapshot().revision().value(), 2);
    assert!(store.snapshot().operation("op-2").is_some());
}

#[test]
fn transaction_base_is_service_assigned_from_current_revision() {
    let mut store = Store::new();
    let first = store.begin().expect("begin");
    assert_eq!(first.base_revision().value(), 0);
    drop(first);

    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    // A later transaction is anchored to the advanced revision — the caller cannot choose the base.
    let next = store.begin().expect("begin");
    assert_eq!(next.base_revision().value(), 1);
}

#[test]
fn stored_operation_revision_does_not_confer_manifest_coverage() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    // The stored operation claims recordRevision 5, but the manifest's operation family revision is 1.
    // Data-coherence rejects the forward reference — a stored revision is NOT authoritative.
    let ahead = common::operation_dto("op-1");
    assert_eq!(ahead.record_revision, 5);
    let err = store
        .check_operation_covered(&ahead)
        .expect_err("forward ref must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);

    // A record within the manifest's recorded revision is coherent.
    let mut within = common::operation_dto("op-1");
    within.record_revision = 1;
    store.check_operation_covered(&within).expect("covered");
}

#[test]
fn stale_journal_reference_is_rejected_against_current_manifest() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1")).expect("stage");
    store.commit(&mut tx).expect("commit");

    // Manifest operation revision is 1. A journal that only advances to 1 is stale/rollback.
    let stale = JournalRecordDto {
        schema_version: 1,
        record_revision: 1,
        sequence: 0,
        intent_id: "intent-1".to_string(),
        phase: JournalPhaseDto::Commit,
        target_family: TargetFamilyDto::Operation,
        target_revision: 1,
        prev_sequence: None,
    };
    let err = store
        .check_journal_against_current(&stale)
        .expect_err("stale journal must fail");
    assert_eq!(err, StoreError::ConsistencyFailure);

    // A journal that advances the family forward is coherent.
    let mut forward = stale.clone();
    forward.target_revision = 2;
    store
        .check_journal_against_current(&forward)
        .expect("forward journal ok");
}

#[test]
fn coverage_checks_require_an_established_manifest() {
    let store = Store::new();
    // With no committed manifest yet, coverage checks fail closed rather than assuming authority.
    let op = common::operation_dto("op-1");
    let err = store.check_operation_covered(&op).expect_err("no manifest");
    assert_eq!(err, StoreError::MissingRecord);
}

#[test]
fn stored_envelope_is_inert_ciphertext_data() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("cred-1", common::metadata("cred-1"))
        .expect("stage meta");
    tx.insert(
        "cred-1",
        projectos_host_store::StoredRecord::CredentialEnvelope(common::envelope_dto("cred-1")),
    )
    .expect("stage env");
    store.commit(&mut tx).expect("commit");

    // The read path returns the envelope DTO — ciphertext is inert stored data, with NO decryption,
    // plaintext-materialisation, or lease API anywhere on the surface.
    let snap = store.snapshot();
    let env = snap.credential_envelope("cred-1").expect("envelope");
    assert_eq!(env.ciphertext, "deadbeef");
}
