//! Proof for the durable delegation-lifecycle store (RUN-TO-COMPLETION HOST ATTESTATION §10B).
//!
//! EVERY TEST USES A DISPOSABLE TEMPORARY ROOT. Nothing here creates, resolves, reads or writes the
//! live ProjectOS ProgramData directory, touches a service, opens a socket, or reaches a credential.
//! The roots are created under the process temp directory, keyed by process id and a counter so two
//! tests in the same run can never share one, and removed when the guard drops.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_trusted_roots::{HostStateStore, HostStoreCustody};

use super::{
    DelegationStoreRefusal, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
    DELEGATION_STATE_RELATIVE_ROOT, MAX_DELEGATION_RECORD_BYTES,
};
use crate::owner_programme_delegation::{
    DelegationLocalState, DelegationRefusal, DurableDelegationStateStore, HostDelegationStatus,
    DELEGATION_DIGEST_LEN,
};

static NEXT: AtomicU64 = AtomicU64::new(0);

const ID_A: [u8; DELEGATION_DIGEST_LEN] = [0xa1; DELEGATION_DIGEST_LEN];
const ID_B: [u8; DELEGATION_DIGEST_LEN] = [0xb2; DELEGATION_DIGEST_LEN];

/// A disposable directory this test owns outright, removed when the guard drops.
struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(tag: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("pos-deleg-state-{}-{tag}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp root");
        Self { path }
    }

    fn root(&self) -> HostOwnedDelegationStateRoot {
        HostOwnedDelegationStateRoot::fixture(&self.path)
    }

    fn open(&self) -> DurableDelegationStateFileStore {
        DurableDelegationStateFileStore::open(&self.root()).expect("open store")
    }

    /// The on-disk record file for one delegation id, for the tamper probes.
    fn record_file(&self, id: &[u8; DELEGATION_DIGEST_LEN]) -> PathBuf {
        // The engine names a record file by the HEX of its record-id BYTES; the record id here is
        // already a hex string, so the on-disk name is the hex of that string's ASCII bytes.
        let key = super::hex_id(id);
        let mut name = String::new();
        for b in key.as_bytes() {
            name.push_str(&format!("{b:02x}"));
        }
        self.path
            .join(DELEGATION_STATE_RELATIVE_ROOT)
            .join("records")
            .join(format!("{name}.rec"))
    }

    /// Plant `bytes` at a NEW path inside the store the way the engine creates a file — with the
    /// store's committed descriptor (§10I) — so a tamper probe tests the rule it names instead of
    /// tripping custody first. An AMBIENT plant is custody's own case, proven separately.
    fn plant(&self, path: &Path, bytes: &[u8]) {
        use std::io::Write;
        let store = HostStoreCustody::fixture(&self.path)
            .establish(HostStateStore::DelegationLifecycle)
            .expect("custody");
        let mut file = store.create_file(path).expect("governed plant");
        file.write_all(bytes).expect("plant bytes");
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Bring one delegation into the registry as Active, through the only mutation route there is.
fn provision(store: &mut DurableDelegationStateFileStore, id: &[u8; DELEGATION_DIGEST_LEN]) {
    store
        .record_lifecycle(id, DelegationLocalState::Active)
        .expect("provision active");
}

/// A well-formed record body, exactly as the store itself writes one.
fn body(id_hex: &str, state: &str) -> String {
    format!(
        "{{\"schemaVersion\":1,\"recordRevision\":1,\"delegationIdHex\":\"{id_hex}\",\"state\":\"{state}\"}}"
    )
}

// ---------------------------------------------------------------------------------------------
// A. PERSISTENCE — the whole point: a restart must not forget.
// ---------------------------------------------------------------------------------------------

#[test]
fn active_survives_close_and_reopen() {
    let temp = TempRoot::new("active-survives");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        assert_eq!(
            store.recorded_state(&ID_A),
            Some(DelegationLocalState::Active)
        );
    }
    // A fresh store object over the same root is the closest in-process analogue of a service
    // restart: the lock is reacquired, recovery runs again, and nothing is carried in memory.
    assert_eq!(
        temp.open().recorded_state(&ID_A),
        Some(DelegationLocalState::Active)
    );
}

#[test]
fn revoked_survives_close_and_reopen() {
    let temp = TempRoot::new("revoked-survives");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
            .expect("revoke");
    }
    assert_eq!(
        temp.open().recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked),
        "a revocation a restart forgets is not a revocation"
    );
}

#[test]
fn completed_survives_close_and_reopen() {
    let temp = TempRoot::new("completed-survives");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Completed)
            .expect("complete");
    }
    assert_eq!(
        temp.open().recorded_state(&ID_A),
        Some(DelegationLocalState::Completed)
    );
}

#[test]
fn repeated_reconstruction_does_not_reset_state() {
    let temp = TempRoot::new("repeat-reconstruct");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
            .expect("revoke");
    }
    for _ in 0..5 {
        assert_eq!(
            temp.open().recorded_state(&ID_A),
            Some(DelegationLocalState::Revoked)
        );
    }
}

#[test]
fn a_restart_cannot_make_an_ended_delegation_verifiable_again() {
    // The property stated end to end: after a restart the sealed status the verifier consumes is
    // still Revoked, so the delegation is refused however live a signed copy claims to be.
    let temp = TempRoot::new("restart-not-live");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
            .expect("revoke");
    }
    let store = temp.open();
    let status = HostDelegationStatus::from_durable_store(&store, &ID_A).expect("status");
    assert_eq!(status.state(), DelegationLocalState::Revoked);
    assert_eq!(status.delegation_id(), &ID_A);
}

// ---------------------------------------------------------------------------------------------
// B. FAILURE — every one of these is a refusal, and none of them is Active.
// ---------------------------------------------------------------------------------------------

#[test]
fn an_empty_store_knows_nothing_and_therefore_refuses() {
    let temp = TempRoot::new("empty-store");
    let store = temp.open();
    assert_eq!(store.recorded_state(&ID_A), None);
    assert_eq!(
        HostDelegationStatus::from_durable_store(&store, &ID_A).unwrap_err(),
        DelegationRefusal::LocalStatusUnavailable,
        "a store that did not exist until this moment must not mean every delegation is active"
    );
}

#[test]
fn an_unknown_delegation_refuses_even_when_another_is_active() {
    let temp = TempRoot::new("unknown-id");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    assert_eq!(store.recorded_state(&ID_B), None);
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Active),
        "and asking about an id the store does not hold must not disturb one it does"
    );
}

/// Tamper with a record on disk, then assert the store REFUSES rather than answering.
///
/// The engine's SHA-256 framing covers the whole record and its open-time scan revalidates every
/// frame — so a tampered record does not merely read back as `None`, it makes the WHOLE STORE refuse
/// to open. That is stronger than refusing one record and it is the honest thing to assert: with no
/// store there is no `HostDelegationStatus`, so every delegation fails closed.
fn assert_tamper_refuses(tag: &str, mutate: impl Fn(&[u8]) -> Vec<u8>) {
    let temp = TempRoot::new(tag);
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
    }
    let path = temp.record_file(&ID_A);
    let original = std::fs::read(&path).expect("read record");
    assert!(original.len() > 16, "a real frame, not an empty file");
    std::fs::write(&path, mutate(&original)).expect("tamper");
    assert_eq!(
        DurableDelegationStateFileStore::open(&temp.root()).map(|_| ()),
        Err(DelegationStoreRefusal::StoreUnavailable),
        "{tag}: a store holding a record it cannot vouch for must not open at all"
    );
}

#[test]
fn a_malformed_record_refuses() {
    assert_tamper_refuses("malformed", |_| b"not a framed record at all".to_vec());
}

#[test]
fn a_truncated_record_refuses() {
    assert_tamper_refuses("truncated", |b| b[..b.len() / 2].to_vec());
}

#[test]
fn a_flipped_byte_refuses_because_the_framing_digest_covers_it() {
    assert_tamper_refuses("bitflip", |b| {
        let mut out = b.to_vec();
        let last = out.len() - 1;
        out[last] ^= 0xff;
        out
    });
}

#[test]
fn a_stale_record_substituted_over_a_newer_one_refuses_at_the_engine() {
    // A's frame bytes placed over B's, where B is NEWER. The engine refuses the whole store — but
    // be precise about WHY, because the obvious explanation is wrong: the engine's open-time scan
    // (`scan_records` / `recovery::structural`) never inspects a frame's embedded record id at all.
    // It reads only the revision and the integrity flag. What refuses here is REVISION STALENESS:
    // revoking B advanced the store revision, so the swapped-in older A-frame leaves every record
    // behind the manifest, which is `Structural::ManifestAhead` and therefore a refusal to open.
    //
    // That is a real guard and worth having, but it is NOT the identity guard. The identity guard is
    // proven by the two tests below, which cover the case this one cannot reach.
    let temp = TempRoot::new("substituted-stale");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        provision(&mut store, &ID_B);
        store
            .record_lifecycle(&ID_B, DelegationLocalState::Revoked)
            .expect("revoke B");
    }
    let a_bytes = std::fs::read(temp.record_file(&ID_A)).expect("read A");
    std::fs::write(temp.record_file(&ID_B), &a_bytes).expect("substitute");
    assert_eq!(
        DurableDelegationStateFileStore::open(&temp.root()).map(|_| ()),
        Err(DelegationStoreRefusal::StoreUnavailable),
        "a substituted record must not turn a revoked delegation active"
    );
}

#[test]
fn a_substituted_record_the_engine_cannot_catch_is_refused_by_the_id_binding() {
    // THE CASE THE ENGINE GENUINELY CANNOT SEE. Copy A's frame onto B's path with NO intervening
    // write, so both records carry the same revision and the manifest is not ahead of anything:
    // `structural()` classifies the root as Coherent and the store OPENS. `get_record` does not
    // compare the frame's id to the id asked for either, so the bytes come back.
    //
    // At that point the ONLY thing standing between a substituted record and a wrong answer is the
    // body/key binding in `interpret`. This is the test that proves it matters.
    let temp = TempRoot::new("substituted-same-revision");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
    }
    let a_bytes = std::fs::read(temp.record_file(&ID_A)).expect("read A");
    temp.plant(&temp.record_file(&ID_B), &a_bytes);

    let store = DurableDelegationStateFileStore::open(&temp.root())
        .expect("the engine cannot detect this one, and that is the point");
    assert_eq!(
        store.recorded_state(&ID_B),
        None,
        "A's record filed under B must not answer for B"
    );
    // A still answers for itself, so the refusal is about identity and not about the store being
    // broken.
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Active)
    );
}

// --- §10I custody: the store's own filesystem objects ------------------------------------------

#[test]
fn every_store_object_keeps_the_committed_descriptor_through_replacements_and_a_restart() {
    let temp = TempRoot::new("custody-replacements");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        // Active -> Revoked REPLACES A's record: a rename over an existing file.
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
            .expect("revoke A");
        provision(&mut store, &ID_B);
    }
    let reopened = temp.open();
    assert_eq!(
        reopened.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked),
        "the terminal state survived the restart"
    );
    drop(reopened);
    HostStoreCustody::fixture(&temp.path)
        .establish(HostStateStore::DelegationLifecycle)
        .expect("the store directory conforms")
        .verify_contents()
        .expect("every record, journal entry, the manifest and the lock conform");
}

#[test]
fn an_ambient_record_planted_in_the_store_refuses_the_next_open_and_is_not_repaired() {
    let temp = TempRoot::new("custody-ambient-plant");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
    }
    // A file an ordinary process created: the token's default owner and DACL.
    let planted = temp.record_file(&ID_B);
    std::fs::write(&planted, body(&super::hex_id(&ID_B), "ACTIVE")).expect("plant");
    for _ in 0..2 {
        assert_eq!(
            DurableDelegationStateFileStore::open(&temp.root()).map(|_| ()),
            Err(DelegationStoreRefusal::CustodyRefused)
        );
    }
    assert!(
        planted.exists(),
        "a refusal must not remove what it refused"
    );
}

// --- The read rules, proven directly against exact bytes -------------------------------------
//
// `interpret` is the whole read vocabulary once the engine has handed over a record's payload.
// Driving it directly is what makes each rule provable on its own: through the store, whichever rule
// refuses first would mask every rule behind it.

#[test]
fn a_valid_record_reads_back_as_its_exact_state() {
    let key = super::hex_id(&ID_A);
    for (word, expected) in [
        ("ACTIVE", DelegationLocalState::Active),
        ("REVOKED", DelegationLocalState::Revoked),
        ("COMPLETED", DelegationLocalState::Completed),
    ] {
        assert_eq!(
            super::interpret(&key, body(&key, word).as_bytes()),
            Ok(expected)
        );
    }
}

#[test]
fn an_unknown_schema_version_refuses() {
    let key = super::hex_id(&ID_A);
    for version in ["0", "2", "4294967295"] {
        let json = format!(
            "{{\"schemaVersion\":{version},\"recordRevision\":1,\"delegationIdHex\":\"{key}\",\"state\":\"ACTIVE\"}}"
        );
        assert_eq!(
            super::interpret(&key, json.as_bytes()),
            Err(DelegationStoreRefusal::RecordUnreadable),
            "schema {version} must not decode as this family"
        );
    }
}

#[test]
fn an_unknown_state_word_refuses() {
    let key = super::hex_id(&ID_A);
    for word in ["SUSPENDED", "active", "", "ACTIVE "] {
        assert_eq!(
            super::interpret(&key, body(&key, word).as_bytes()),
            Err(DelegationStoreRefusal::RecordUnreadable),
            "a fourth state word must be a refusal, never a tolerated value: {word:?}"
        );
    }
}

#[test]
fn an_unknown_or_missing_field_refuses() {
    let key = super::hex_id(&ID_A);
    let cases = [
        // An extra field: a future writer must not smuggle meaning past an older reader.
        format!(
            "{{\"schemaVersion\":1,\"recordRevision\":1,\"delegationIdHex\":\"{key}\",\"state\":\"ACTIVE\",\"override\":true}}"
        ),
        // A missing field.
        format!("{{\"schemaVersion\":1,\"delegationIdHex\":\"{key}\",\"state\":\"ACTIVE\"}}"),
        // A zero revision.
        format!(
            "{{\"schemaVersion\":1,\"recordRevision\":0,\"delegationIdHex\":\"{key}\",\"state\":\"ACTIVE\"}}"
        ),
        // Not JSON at all.
        "garbage".to_owned(),
    ];
    for json in cases {
        assert_eq!(
            super::interpret(&key, json.as_bytes()),
            Err(DelegationStoreRefusal::RecordUnreadable),
            "must refuse: {json}"
        );
    }
}

#[test]
fn a_malformed_delegation_id_in_the_body_refuses() {
    let key = super::hex_id(&ID_A);
    let cases = [
        // Uppercase: a second spelling of one id would be a second record.
        key.to_uppercase(),
        // Short, long, and not hex at all.
        "a1a1".to_owned(),
        format!("{key}a1"),
        "z".repeat(64),
    ];
    for id_hex in cases {
        assert_eq!(
            super::interpret(&key, body(&id_hex, "ACTIVE").as_bytes()),
            Err(DelegationStoreRefusal::RecordUnreadable),
            "malformed delegation id: {id_hex}"
        );
    }
}

#[test]
fn a_record_that_names_another_delegation_cannot_answer_for_this_key() {
    // Well-formed, valid, and about B. Read under A's key it must refuse, not report B's state.
    let a = super::hex_id(&ID_A);
    let b = super::hex_id(&ID_B);
    assert_eq!(
        super::interpret(&b, body(&b, "ACTIVE").as_bytes()),
        Ok(DelegationLocalState::Active)
    );
    assert_eq!(
        super::interpret(&a, body(&b, "ACTIVE").as_bytes()),
        Err(DelegationStoreRefusal::RecordUnreadable),
        "a status for delegation B must never satisfy delegation A"
    );
}

#[test]
fn an_oversize_record_refuses_before_it_is_parsed() {
    let key = super::hex_id(&ID_A);
    // Padded with JSON whitespace so it stays a VALID document: the refusal is the size bound, not
    // the parser, which is the property under test.
    let valid = body(&key, "ACTIVE");
    let padded = format!("{}{}", " ".repeat(MAX_DELEGATION_RECORD_BYTES), valid);
    assert!(padded.len() > MAX_DELEGATION_RECORD_BYTES);
    assert_eq!(
        super::interpret(&key, padded.as_bytes()),
        Err(DelegationStoreRefusal::RecordUnreadable)
    );
    // The same document under the bound still reads, so the bound is what refused.
    assert_eq!(
        super::interpret(&key, valid.as_bytes()),
        Ok(DelegationLocalState::Active)
    );
}

#[test]
fn the_record_the_store_writes_is_far_inside_its_own_bound() {
    let temp = TempRoot::new("record-size");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    let key = super::hex_id(&ID_A);
    let bytes = store.inner.get_record(key.as_bytes()).expect("record");
    assert!(
        bytes.len() < MAX_DELEGATION_RECORD_BYTES / 4,
        "a lifecycle record is tiny by construction: {} bytes",
        bytes.len()
    );
}

// ---------------------------------------------------------------------------------------------
// C. TERMINALITY — Revoked and Completed are final for one delegation id.
// ---------------------------------------------------------------------------------------------

#[test]
fn active_to_revoked_and_active_to_completed_both_persist() {
    for terminal in [
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        let temp = TempRoot::new("to-terminal");
        {
            let mut store = temp.open();
            provision(&mut store, &ID_A);
            store.record_lifecycle(&ID_A, terminal).expect("end it");
        }
        assert_eq!(temp.open().recorded_state(&ID_A), Some(terminal));
    }
}

#[test]
fn a_terminal_state_can_never_return_to_active() {
    for terminal in [
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        let temp = TempRoot::new("no-resurrection");
        {
            let mut store = temp.open();
            provision(&mut store, &ID_A);
            store.record_lifecycle(&ID_A, terminal).expect("end it");
            assert_eq!(
                store.record_lifecycle(&ID_A, DelegationLocalState::Active),
                Err(DelegationStoreRefusal::TerminalStateIsFinal)
            );
            assert_eq!(store.recorded_state(&ID_A), Some(terminal));
        }
        assert_eq!(
            temp.open().recorded_state(&ID_A),
            Some(terminal),
            "the refusal must also have written nothing"
        );
    }
}

#[test]
fn one_terminal_state_cannot_become_the_other() {
    let temp = TempRoot::new("terminal-swap");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    store
        .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
        .expect("revoke");
    assert_eq!(
        store.record_lifecycle(&ID_A, DelegationLocalState::Completed),
        Err(DelegationStoreRefusal::TerminalStateIsFinal),
        "no accepted contract needs Revoked -> Completed, so it is refused rather than permitted"
    );
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked)
    );
}

#[test]
fn an_identical_terminal_write_succeeds_and_changes_nothing() {
    for terminal in [
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        let temp = TempRoot::new("idempotent");
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store.record_lifecycle(&ID_A, terminal).expect("end it");
        let revision = store.current_revision();
        store
            .record_lifecycle(&ID_A, terminal)
            .expect("idempotent re-write");
        assert_eq!(
            store.current_revision(),
            revision,
            "idempotence must not churn a revision"
        );
        assert_eq!(store.recorded_state(&ID_A), Some(terminal));
    }
}

#[test]
fn ending_a_delegation_the_store_never_knew_is_refused() {
    let temp = TempRoot::new("unknown-end");
    let mut store = temp.open();
    for terminal in [
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        assert_eq!(
            store.record_lifecycle(&ID_A, terminal),
            Err(DelegationStoreRefusal::UnknownDelegation),
            "there is nothing to end, and pre-seeding terminal records for invented ids is refused"
        );
    }
    assert_eq!(store.recorded_state(&ID_A), None);
}

#[test]
fn a_stale_active_snapshot_cannot_overwrite_a_later_terminal_state() {
    for terminal in [
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        let temp = TempRoot::new("stale-writer");
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        // A writer that read the record while it was still Active holds this revision.
        let stale = store
            .inner
            .record_revision(super::hex_id(&ID_A).as_bytes())
            .expect("revision");
        store.record_lifecycle(&ID_A, terminal).expect("end it");

        // ROUTE 1 — through the safe API, the fresh read refuses it on the terminal rule.
        assert_eq!(
            store.record_lifecycle(&ID_A, DelegationLocalState::Active),
            Err(DelegationStoreRefusal::TerminalStateIsFinal)
        );
        // ROUTE 2 — even with the lifecycle rules bypassed, the engine's optimistic guard refuses a
        // write carrying the stale revision, so a lost update cannot drop the terminal state.
        assert_eq!(
            store.put_with_expected_for_test(&ID_A, DelegationLocalState::Active, stale),
            Err(DelegationStoreRefusal::WriteRefused)
        );
        assert_eq!(store.recorded_state(&ID_A), Some(terminal));
    }
}

#[test]
fn the_record_bound_refuses_and_never_evicts_a_terminal_record() {
    use super::MAX_DELEGATION_RECORDS;

    let temp = TempRoot::new("capacity");
    let mut store = temp.open();

    // The FIRST delegation is provisioned and then ended, so the record that capacity pressure
    // would be most tempted to reclaim is a terminal one.
    provision(&mut store, &ID_A);
    store
        .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
        .expect("revoke the first");

    // Fill to the bound with distinct ids.
    let mut id = [0u8; DELEGATION_DIGEST_LEN];
    for n in 1..MAX_DELEGATION_RECORDS {
        id[0] = (n & 0xff) as u8;
        id[1] = ((n >> 8) & 0xff) as u8;
        id[2] = 0x11;
        provision(&mut store, &id);
    }

    // One more CREATE is refused, before any effect.
    id[0] = 0xfe;
    id[1] = 0xfe;
    id[2] = 0xfe;
    assert_eq!(
        store.record_lifecycle(&id, DelegationLocalState::Active),
        Err(DelegationStoreRefusal::CapacityExhausted),
        "exhaustion must refuse, not make room"
    );
    assert_eq!(store.recorded_state(&id), None);

    // NOTHING WAS EVICTED. The terminal record is exactly where it was, and it survives a restart.
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked),
        "a terminal record must never be evicted to make capacity"
    );
    drop(store);
    assert_eq!(
        temp.open().recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked)
    );
}

#[test]
fn capacity_pressure_does_not_block_ending_a_delegation_that_already_exists() {
    // Only a CREATE consumes capacity. Revoking an existing delegation replaces a record in place,
    // so a full store can still be told that a programme has ended — which is the one operation
    // that must never be the thing that runs out of room.
    use super::MAX_DELEGATION_RECORDS;

    let temp = TempRoot::new("capacity-revoke");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    let mut id = [0u8; DELEGATION_DIGEST_LEN];
    for n in 1..MAX_DELEGATION_RECORDS {
        id[0] = (n & 0xff) as u8;
        id[1] = ((n >> 8) & 0xff) as u8;
        id[2] = 0x22;
        provision(&mut store, &id);
    }
    store
        .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
        .expect("a full store can still end a delegation it already holds");
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked)
    );
}

// ---------------------------------------------------------------------------------------------
// D. CONCURRENCY — one lock, one authority.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_second_store_over_the_same_root_is_refused() {
    let temp = TempRoot::new("single-writer");
    let first = temp.open();
    assert_eq!(
        DurableDelegationStateFileStore::open(&temp.root()).map(|_| ()),
        Err(DelegationStoreRefusal::StoreUnavailable),
        "two independent store authorities over one root is exactly what must not exist"
    );
    drop(first);
    // The lock is released with its holder, so the Host can reopen after a clean shutdown.
    assert!(DurableDelegationStateFileStore::open(&temp.root()).is_ok());
}

#[test]
fn a_concurrent_thread_cannot_open_a_second_authority() {
    let temp = TempRoot::new("concurrent-open");
    let mut held = temp.open();
    provision(&mut held, &ID_A);
    held.record_lifecycle(&ID_A, DelegationLocalState::Revoked)
        .expect("revoke");

    let root = temp.root();
    let outcome =
        std::thread::spawn(move || DurableDelegationStateFileStore::open(&root).map(|_| ()))
            .join()
            .expect("thread");
    assert_eq!(outcome, Err(DelegationStoreRefusal::StoreUnavailable));
    assert_eq!(
        held.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked),
        "the revocation is not lost to a concurrent opener"
    );
}

// ---------------------------------------------------------------------------------------------
// E. ID BINDING — one record answers about exactly one delegation.
// ---------------------------------------------------------------------------------------------

#[test]
fn delegation_ids_are_isolated_from_one_another() {
    let temp = TempRoot::new("isolation");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    provision(&mut store, &ID_B);
    store
        .record_lifecycle(&ID_A, DelegationLocalState::Revoked)
        .expect("revoke A");
    assert_eq!(
        store.recorded_state(&ID_A),
        Some(DelegationLocalState::Revoked)
    );
    assert_eq!(
        store.recorded_state(&ID_B),
        Some(DelegationLocalState::Active),
        "ending one delegation must not end another"
    );
}

#[test]
fn a_status_for_one_delegation_cannot_answer_for_another() {
    let temp = TempRoot::new("status-binding");
    let mut store = temp.open();
    provision(&mut store, &ID_A);
    let status = HostDelegationStatus::from_durable_store(&store, &ID_A).expect("status for A");
    assert_eq!(status.delegation_id(), &ID_A);
    assert_ne!(status.delegation_id(), &ID_B);
    assert_eq!(
        HostDelegationStatus::from_durable_store(&store, &ID_B).unwrap_err(),
        DelegationRefusal::LocalStatusUnavailable
    );
}

#[test]
fn the_storage_key_is_canonical_lowercase_hex() {
    let key = super::hex_id(&ID_A);
    assert_eq!(key.len(), DELEGATION_DIGEST_LEN * 2);
    assert!(key
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
    assert_eq!(super::hex_id(&ID_A), super::hex_id(&ID_A));
    assert_ne!(super::hex_id(&ID_A), super::hex_id(&ID_B));
}

// ---------------------------------------------------------------------------------------------
// H. NO EFFECT — what this store does not do.
// ---------------------------------------------------------------------------------------------

#[test]
fn everything_written_stays_under_the_supplied_disposable_root() {
    let temp = TempRoot::new("containment");
    {
        let mut store = temp.open();
        provision(&mut store, &ID_A);
        store
            .record_lifecycle(&ID_A, DelegationLocalState::Completed)
            .expect("complete");
    }
    let state_dir = temp.path.join(DELEGATION_STATE_RELATIVE_ROOT);
    assert!(
        state_dir.is_dir(),
        "the frozen leaf segment is the only child"
    );
    assert!(state_dir.join("records").is_dir());
    // The state directory is ONE plain segment beneath the supplied root: nothing is written beside
    // it, above it, or anywhere the caller did not already own.
    let children: Vec<_> = std::fs::read_dir(&temp.path)
        .expect("read root")
        .map(|e| e.expect("entry").file_name())
        .collect();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0], Path::new(DELEGATION_STATE_RELATIVE_ROOT));
}

#[test]
fn an_absent_state_root_refuses_rather_than_manufacturing_one() {
    // A missing Host state root means the installation is not what this store assumes. Creating the
    // whole directory chain would, on a real machine, manufacture protected ProgramData directories
    // the installer is supposed to own and ACL.
    let missing = std::env::temp_dir().join(format!(
        "pos-deleg-state-absent-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    assert!(!missing.exists());
    let root = HostOwnedDelegationStateRoot::fixture(&missing);
    assert_eq!(
        DurableDelegationStateFileStore::open(&root).map(|_| ()),
        Err(DelegationStoreRefusal::StateRootUnusable)
    );
    assert!(
        !missing.exists(),
        "the refusal must not have created anything"
    );
}

#[test]
fn a_state_root_that_is_a_file_refuses() {
    let temp = TempRoot::new("root-is-file");
    let as_file = temp.path.join("not-a-directory");
    std::fs::write(&as_file, b"x").expect("write");
    let root = HostOwnedDelegationStateRoot::fixture(&as_file);
    assert_eq!(
        DurableDelegationStateFileStore::open(&root).map(|_| ()),
        Err(DelegationStoreRefusal::StateRootUnusable)
    );
}

#[test]
fn the_relative_root_is_a_single_plain_leaf_segment() {
    // A nested or traversing segment would put the host's word on a delegation somewhere an ACE
    // applied to one directory does not cover.
    assert!(!DELEGATION_STATE_RELATIVE_ROOT.is_empty());
    assert!(!DELEGATION_STATE_RELATIVE_ROOT.contains('/'));
    assert!(!DELEGATION_STATE_RELATIVE_ROOT.contains('\\'));
    assert!(!DELEGATION_STATE_RELATIVE_ROOT.contains(':'));
    assert!(!DELEGATION_STATE_RELATIVE_ROOT.contains(".."));
    assert_eq!(
        Path::new(DELEGATION_STATE_RELATIVE_ROOT)
            .components()
            .count(),
        1
    );
}
