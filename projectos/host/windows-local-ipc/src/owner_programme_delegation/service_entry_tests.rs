//! PROJECTOS-HOST-REVIEW-PATH1B, criterion 21 — the two SERVICE-ENTRY delegation routes, proven.
//!
//! * `activate_owner_programme_delegation` — the governed "Active lifecycle writer": its whole
//!   authority is the owner's signature over the record plus the owner-signed attested programme,
//!   and the durable store's own lifecycle rules do the rest.
//! * `verify_owner_programme_delegation_for_installation` — the service-entry verification: the SAME
//!   one verifier, composed over sealed inputs, provenance before the registry read.
//!
//! The POSITIVE legs run through the `_with_oracle` twins — the same code, fixture oracle — because
//! the embedded production anchor is the owner's real key and ProjectOS does not hold its private
//! half. The twins differ from the production entries in the oracle argument and NOTHING else, and
//! one test below proves the production entries really consult the embedded anchor (they refuse the
//! very record the twins accept).

use super::*;
use crate::owner_programme_delegation::durable_store::{
    DelegationStoreRefusal, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
};
use projectos_host_identity::AttestedInstallationProgramme;

const PROJECT: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
const REPOSITORY: [u8; DELEGATION_DIGEST_LEN] = [0x22; DELEGATION_DIGEST_LEN];
const RECORD_ID: [u8; DELEGATION_DIGEST_LEN] = [0xaa; DELEGATION_DIGEST_LEN];
/// Far enough that the host's REAL clock reading is before it for the life of this repository.
const FAR_FUTURE: u64 = u64::MAX / 2;

/// A disposable store root this test owns outright, removed when the guard drops.
struct TempStore {
    path: std::path::PathBuf,
}

impl TempStore {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "pos-c21-delegation-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp store root");
        Self { path }
    }

    fn open(&self) -> DurableDelegationStateFileStore {
        let root = HostOwnedDelegationStateRoot::fixture(&self.path);
        DurableDelegationStateFileStore::open(&root).expect("delegation store opens")
    }
}

impl Drop for TempStore {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn attested() -> AttestedInstallationProgramme {
    AttestedInstallationProgramme::fixture(PROJECT, REPOSITORY)
}

/// A well-formed signed record, decodable and internally live, with a steerable expiry and flag.
fn record(expires_at: u64, revoked_or_completed: bool) -> SignedOwnerProgrammeDelegation {
    let mut body = [0u8; DELEGATION_BODY_LEN];
    body[OFF_SCHEMA..OFF_SCHEMA + 4].copy_from_slice(&DELEGATION_SCHEMA_VERSION.to_be_bytes());
    let key = b"projectos-signing-20260812";
    body[OFF_KEY_ID..OFF_KEY_ID + key.len()].copy_from_slice(key);
    body[OFF_DELEGATION_ID..OFF_DELEGATION_ID + DELEGATION_DIGEST_LEN].copy_from_slice(&RECORD_ID);
    body[OFF_OWNER..OFF_OWNER + DELEGATION_DIGEST_LEN].copy_from_slice(&[0xbb; DELEGATION_DIGEST_LEN]);
    body[OFF_PROJECT..OFF_PROJECT + DELEGATION_DIGEST_LEN].copy_from_slice(&PROJECT);
    body[OFF_REPOSITORY..OFF_REPOSITORY + DELEGATION_DIGEST_LEN].copy_from_slice(&REPOSITORY);
    body[OFF_PLAN..OFF_PLAN + DELEGATION_DIGEST_LEN].copy_from_slice(&[0x33; DELEGATION_DIGEST_LEN]);
    body[OFF_PLAN_DIGEST..OFF_PLAN_DIGEST + DELEGATION_DIGEST_LEN]
        .copy_from_slice(&[0x44; DELEGATION_DIGEST_LEN]);
    body[OFF_PHASE_COUNT] = 1;
    body[OFF_PHASES..OFF_PHASES + DELEGATION_DIGEST_LEN]
        .copy_from_slice(&[0x55; DELEGATION_DIGEST_LEN]);
    body[OFF_OPERATION] = OperationClass::IndependentGatekeeperReview.discriminant();
    body[OFF_MODEL_POLICY..OFF_MODEL_POLICY + DELEGATION_DIGEST_LEN]
        .copy_from_slice(&[0x66; DELEGATION_DIGEST_LEN]);
    body[OFF_CREDENTIAL_REF..OFF_CREDENTIAL_REF + DELEGATION_DIGEST_LEN]
        .copy_from_slice(&[0x77; DELEGATION_DIGEST_LEN]);
    body[OFF_BUDGET..OFF_BUDGET + 8].copy_from_slice(&5_000_000u64.to_be_bytes());
    body[OFF_EXPIRES..OFF_EXPIRES + 8].copy_from_slice(&expires_at.to_be_bytes());
    body[OFF_REVOKED] = u8::from(revoked_or_completed);

    let mut out = Vec::with_capacity(SIGNED_DELEGATION_RECORD_LEN);
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&body);
    let mut alg = [0u8; ALGORITHM_LEN];
    alg[..DELEGATION_SIGNATURE_ALGORITHM.len()]
        .copy_from_slice(DELEGATION_SIGNATURE_ALGORITHM.as_bytes());
    out.extend_from_slice(&alg);
    out.extend_from_slice(&[0x9c; SIGNATURE_LEN]);
    decode_signed_owner_programme_delegation(&out).expect("the record decodes")
}

fn signed(r: &SignedOwnerProgrammeDelegation) -> Vec<u8> {
    r.canonical_subject()
}

#[test]
fn activation_then_verification_succeed_end_to_end_on_a_real_durable_store() {
    let tree = TempStore::new("positive");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);

    // A fresh registry knows nothing, so verification fails closed BEFORE activation...
    assert_eq!(
        verify_for_installation_with_test_oracle(&r, &attested(), &store, signed(&r)).unwrap_err(),
        DelegationRefusal::LocalStatusUnavailable
    );
    // ...activation records Active under the store's own rules...
    activate_delegation_with_test_oracle(&mut store, &r, &attested(), signed(&r))
        .expect("an owner-signed, live, relevant record activates");
    // ...and the SAME service-entry verification now yields the sealed value.
    let verified =
        verify_for_installation_with_test_oracle(&r, &attested(), &store, signed(&r))
            .expect("the activated delegation verifies");
    assert_eq!(verified.delegation().delegation_id, RECORD_ID);
}

#[test]
fn activation_is_idempotent_for_a_record_already_active() {
    let tree = TempStore::new("idempotent");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);
    activate_delegation_with_test_oracle(&mut store, &r, &attested(), signed(&r)).expect("first");
    let revision = store.current_revision();
    activate_delegation_with_test_oracle(&mut store, &r, &attested(), signed(&r))
        .expect("a service restart re-presents the same input");
    assert_eq!(store.current_revision(), revision, "idempotence writes nothing");
}

#[test]
fn an_unsigned_record_activates_nothing_and_writes_nothing() {
    let tree = TempStore::new("unsigned");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);
    // The twin's oracle accepts only the EXACT subject; empty means "the owner signed nothing".
    assert_eq!(
        activate_delegation_with_test_oracle(&mut store, &r, &attested(), Vec::new()).unwrap_err(),
        DelegationActivationRefusal::RecordRefused(DelegationRefusal::SignatureRefused)
    );
    assert_eq!(store.recorded_state(&RECORD_ID), None, "nothing was provisioned");
}

#[test]
fn a_record_for_another_installation_activates_nothing() {
    let tree = TempStore::new("relevance");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);
    let other = AttestedInstallationProgramme::fixture([0x99; 32], REPOSITORY);
    assert_eq!(
        activate_delegation_with_test_oracle(&mut store, &r, &other, signed(&r)).unwrap_err(),
        DelegationActivationRefusal::RecordRefused(DelegationRefusal::ProgrammeMismatch)
    );
    assert_eq!(store.recorded_state(&RECORD_ID), None);
}

#[test]
fn an_ended_or_expired_record_never_reaches_the_store() {
    let tree = TempStore::new("liveness");
    let mut store = tree.open();
    for ended in [record(FAR_FUTURE, true), record(2_000, false)] {
        assert_eq!(
            activate_delegation_with_test_oracle(&mut store, &ended, &attested(), signed(&ended))
                .unwrap_err(),
            DelegationActivationRefusal::RecordRefused(DelegationRefusal::NotLive)
        );
    }
    assert_eq!(store.recorded_state(&RECORD_ID), None);
}

#[test]
fn a_terminal_lifecycle_record_is_never_resurrected_by_activation() {
    let tree = TempStore::new("terminal");
    let mut store = tree.open();
    store
        .record_lifecycle(&RECORD_ID, DelegationLocalState::Active)
        .expect("provision");
    store
        .record_lifecycle(&RECORD_ID, DelegationLocalState::Revoked)
        .expect("end it");
    let r = record(FAR_FUTURE, false);
    assert_eq!(
        activate_delegation_with_test_oracle(&mut store, &r, &attested(), signed(&r)).unwrap_err(),
        DelegationActivationRefusal::StoreRefused(DelegationStoreRefusal::TerminalStateIsFinal)
    );
    assert_eq!(store.recorded_state(&RECORD_ID), Some(DelegationLocalState::Revoked));
}

#[test]
fn service_entry_verification_never_consults_the_registry_for_bytes_the_owner_did_not_sign() {
    // SEC-L1, restated for the service entry: provenance and relevance precede the durable read.
    let unsigned = record(FAR_FUTURE, false);
    let counting = CountingDelegationStateStore::empty();
    assert_eq!(
        verify_for_installation_with_test_oracle(&unsigned, &attested(), &counting, Vec::new())
            .unwrap_err(),
        DelegationRefusal::SignatureRefused
    );
    assert_eq!(counting.asks(), 0, "an unsigned record must not touch the registry");

    let irrelevant = AttestedInstallationProgramme::fixture([0x99; 32], REPOSITORY);
    let counting = CountingDelegationStateStore::empty();
    assert_eq!(
        verify_for_installation_with_test_oracle(&unsigned, &irrelevant, &counting, signed(&unsigned))
            .unwrap_err(),
        DelegationRefusal::ProgrammeMismatch
    );
    assert_eq!(counting.asks(), 0, "another installation's record must not touch the registry");
}

#[test]
fn service_entry_verification_honours_the_host_local_override() {
    let tree = TempStore::new("override");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);
    activate_delegation_with_test_oracle(&mut store, &r, &attested(), signed(&r)).expect("active");
    store
        .record_lifecycle(&RECORD_ID, DelegationLocalState::Revoked)
        .expect("the host ends it");
    assert_eq!(
        verify_for_installation_with_test_oracle(&r, &attested(), &store, signed(&r)).unwrap_err(),
        DelegationRefusal::NotLive,
        "a still-valid signed copy does not resurrect a revoked programme"
    );
}

#[test]
fn the_production_entries_consult_the_embedded_anchor_and_refuse_the_fixture_record() {
    // The same record every positive leg above accepts through the fixture oracle: the SHIPPED
    // entries must refuse it, because its signature bytes are filler no real anchor verifies. This
    // is what makes the twins twins rather than a parallel implementation.
    let tree = TempStore::new("anchor");
    let mut store = tree.open();
    let r = record(FAR_FUTURE, false);
    assert_eq!(
        activate_owner_programme_delegation(&mut store, &r, &attested()).unwrap_err(),
        DelegationActivationRefusal::RecordRefused(DelegationRefusal::SignatureRefused)
    );
    assert_eq!(
        verify_owner_programme_delegation_for_installation(&r, &attested(), &store).unwrap_err(),
        DelegationRefusal::SignatureRefused
    );
    assert_eq!(store.recorded_state(&RECORD_ID), None);
}
