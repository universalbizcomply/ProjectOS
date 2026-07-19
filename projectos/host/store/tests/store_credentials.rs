//! Fail-closed credential material existence. The accepted `CredentialLifecycleDto`
//! (Active/Expired/Revoked) carries no "material-absent" state, so EVERY committed metadata record
//! must have a matching committed envelope and vice versa, regardless of lifecycle. Mutation must not
//! create a committed orphan.

mod common;

use projectos_host_persistence::CredentialLifecycleDto;
use projectos_host_store::{RecordFamily, Store, StoreError, StoredRecord};

fn metadata_with(cred_ref: &str, lifecycle: CredentialLifecycleDto) -> StoredRecord {
    let mut dto = common::metadata_dto(cred_ref);
    dto.lifecycle = lifecycle;
    StoredRecord::CredentialMetadata(dto)
}

/// Commit a matching Active metadata + envelope pair; leaves the store at revision 1.
fn seed_pair(store: &mut Store) {
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage metadata");
    tx.insert("cred-1", common::envelope("cred-1"))
        .expect("stage envelope");
    store.commit(&mut tx).expect("seed commit");
}

fn commit_pair_with(
    store: &mut Store,
    lifecycle: CredentialLifecycleDto,
) -> Result<(), StoreError> {
    let mut tx = store.begin().expect("begin");
    tx.insert("cred-1", metadata_with("cred-1", lifecycle))
        .expect("stage metadata");
    tx.insert("cred-1", common::envelope("cred-1"))
        .expect("stage envelope");
    store.commit(&mut tx).map(|_| ())
}

// ---------- SUCCESS ----------

#[test]
fn active_metadata_plus_envelope_accepted() {
    let mut store = Store::new();
    commit_pair_with(&mut store, CredentialLifecycleDto::Active).expect("commit");
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().credential_envelope("cred-1").is_some());
}

#[test]
fn expired_metadata_plus_envelope_accepted() {
    let mut store = Store::new();
    commit_pair_with(&mut store, CredentialLifecycleDto::Expired).expect("commit");
    assert_eq!(store.revision().value(), 1);
}

#[test]
fn revoked_metadata_plus_envelope_accepted() {
    let mut store = Store::new();
    commit_pair_with(&mut store, CredentialLifecycleDto::Revoked).expect("commit");
    assert_eq!(store.revision().value(), 1);
}

#[test]
fn matching_pair_inserted_atomically() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let snap = store.snapshot();
    assert!(snap.credential_metadata("cred-1").is_some());
    assert!(snap.credential_envelope("cred-1").is_some());
}

#[test]
fn matching_pair_removed_atomically() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    tx.remove(RecordFamily::CredentialMetadata, "cred-1")
        .expect("stage");
    tx.remove(RecordFamily::CredentialEnvelope, "cred-1")
        .expect("stage");
    store.commit(&mut tx).expect("remove both");
    let snap = store.snapshot();
    assert!(snap.credential_metadata("cred-1").is_none());
    assert!(snap.credential_envelope("cred-1").is_none());
}

#[test]
fn matching_pair_replaced_atomically() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    tx.replace(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage");
    tx.replace("cred-1", common::envelope("cred-1"))
        .expect("stage");
    store.commit(&mut tx).expect("replace both");
    assert_eq!(store.revision().value(), 2);
}

#[test]
fn active_to_expired_transition_with_envelope_retained_accepted() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    // Metadata lifecycle transitions to Expired; envelope retained.
    tx.replace(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Expired),
    )
    .expect("stage");
    store.commit(&mut tx).expect("transition");
    assert_eq!(
        store
            .snapshot()
            .credential_metadata("cred-1")
            .expect("meta")
            .lifecycle,
        CredentialLifecycleDto::Expired
    );
    assert!(store.snapshot().credential_envelope("cred-1").is_some());
}

#[test]
fn active_to_revoked_transition_with_envelope_retained_accepted() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    tx.replace(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Revoked),
    )
    .expect("stage");
    store.commit(&mut tx).expect("transition");
    assert!(store.snapshot().credential_envelope("cred-1").is_some());
}

// ---------- FAILURE ----------

#[test]
fn active_metadata_only_rejected() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage");
    let err = store.commit(&mut tx).expect_err("metadata-only");
    assert_eq!(err, StoreError::CredentialLifecycleViolation);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn expired_metadata_only_rejected() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Expired),
    )
    .expect("stage");
    let err = store.commit(&mut tx).expect_err("metadata-only");
    assert_eq!(err, StoreError::CredentialLifecycleViolation);
}

#[test]
fn revoked_metadata_only_rejected() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Revoked),
    )
    .expect("stage");
    let err = store.commit(&mut tx).expect_err("metadata-only");
    assert_eq!(err, StoreError::CredentialLifecycleViolation);
}

#[test]
fn envelope_only_rejected() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("cred-1", common::envelope("cred-1"))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("envelope-only");
    assert_eq!(err, StoreError::MissingRecord);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn removing_only_metadata_rejected() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    tx.remove(RecordFamily::CredentialMetadata, "cred-1")
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("orphaned envelope");
    assert_eq!(err, StoreError::MissingRecord);
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().credential_metadata("cred-1").is_some());
}

#[test]
fn removing_only_envelope_rejected() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut tx = store.begin().expect("begin");
    tx.remove(RecordFamily::CredentialEnvelope, "cred-1")
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("orphaned metadata");
    assert_eq!(err, StoreError::CredentialLifecycleViolation);
    assert_eq!(store.revision().value(), 1);
    assert!(store.snapshot().credential_envelope("cred-1").is_some());
}

#[test]
fn replacing_only_metadata_with_conflicting_scope_rejected() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut dto = common::metadata_dto("cred-1");
    dto.project = "other-project".to_string(); // same key, diverging scope
    let mut tx = store.begin().expect("begin");
    tx.replace("cred-1", StoredRecord::CredentialMetadata(dto))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("scope conflict");
    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 1);
}

#[test]
fn replacing_only_envelope_with_conflicting_scope_rejected() {
    let mut store = Store::new();
    seed_pair(&mut store);
    let mut env = common::envelope_dto("cred-1");
    env.provider = "vercel".to_string();
    let mut tx = store.begin().expect("begin");
    tx.replace("cred-1", StoredRecord::CredentialEnvelope(env))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("scope conflict");
    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 1);
}

#[test]
fn project_mismatch_rejected() {
    let mut store = Store::new();
    let mut env = common::envelope_dto("cred-1");
    env.project = "other-project".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage");
    tx.insert("cred-1", StoredRecord::CredentialEnvelope(env))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("project mismatch");
    assert_eq!(err, StoreError::ConsistencyFailure);
    assert_eq!(store.revision().value(), 0);
}

#[test]
fn provider_mismatch_rejected() {
    let mut store = Store::new();
    let mut env = common::envelope_dto("cred-1");
    env.provider = "vercel".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage");
    tx.insert("cred-1", StoredRecord::CredentialEnvelope(env))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("provider mismatch");
    assert_eq!(err, StoreError::ConsistencyFailure);
}

#[test]
fn environment_mismatch_rejected() {
    let mut store = Store::new();
    let mut env = common::envelope_dto("cred-1");
    env.environment = "production".to_string();
    let mut tx = store.begin().expect("begin");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage");
    tx.insert("cred-1", StoredRecord::CredentialEnvelope(env))
        .expect("stage");
    let err = store.commit(&mut tx).expect_err("environment mismatch");
    assert_eq!(err, StoreError::ConsistencyFailure);
}

#[test]
fn existence_violation_aborts_multi_family_transaction() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op");
    tx.insert(
        "cred-1",
        metadata_with("cred-1", CredentialLifecycleDto::Active),
    )
    .expect("stage metadata"); // no envelope
    let err = store.commit(&mut tx).expect_err("existence violation");
    assert_eq!(err, StoreError::CredentialLifecycleViolation);
    assert_eq!(store.revision().value(), 0);
    assert!(store.snapshot().operation("op-1").is_none());
    assert_eq!(store.snapshot().journal_len(), 0);
    assert_eq!(store.snapshot().family_revisions().operation, 0);
}
