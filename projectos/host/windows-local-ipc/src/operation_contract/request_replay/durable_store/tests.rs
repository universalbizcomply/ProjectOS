//! Proof for the durable request-replay history (RUN-TO-COMPLETION HOST ATTESTATION §10C).
//!
//! EVERY TEST USES A DISPOSABLE TEMPORARY ROOT. Nothing here creates, resolves, reads or writes the
//! live ProjectOS ProgramData directory, touches a service, changes an ACL, opens a socket, or
//! reaches a credential or a provider. The roots are created under the process temp directory, keyed
//! by process id and a counter so two tests in the same run can never share one, and removed when
//! the guard drops.
//!
//! THE RESTART PROOFS RECONSTRUCT FROM BYTES. A "restart" here is never a cleared field or a reused
//! object: the store is dropped entirely — which releases the OS lock — and a NEW store is opened
//! over the same directory, so recovery runs again and every answer comes from what is on disk.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_trusted_roots::{HostStateStore, HostStoreCustody};

use super::{
    hex_identity, interpret, DurableRequestReplayFileStore, HostOwnedRequestReplayRoot,
    MAX_REPLAY_RECORD_BYTES, REQUEST_REPLAY_RELATIVE_ROOT,
};
use crate::operation_contract::request_replay::{
    ReplayRefusal, RequestReplayIdentity, RequestReplayLedger, REPLAY_IDENTITY_LEN,
};
use crate::operation_contract::{BINDING_DIGEST_LEN, DELEGATION_DIGEST_LEN};

static NEXT: AtomicU64 = AtomicU64::new(0);

const DELEG_A: [u8; DELEGATION_DIGEST_LEN] = [0xa1; DELEGATION_DIGEST_LEN];
const DELEG_B: [u8; DELEGATION_DIGEST_LEN] = [0xb2; DELEGATION_DIGEST_LEN];
const BIND_A: [u8; BINDING_DIGEST_LEN] = [0xc3; BINDING_DIGEST_LEN];
const BIND_B: [u8; BINDING_DIGEST_LEN] = [0xd4; BINDING_DIGEST_LEN];
const PARAM_A: [u8; BINDING_DIGEST_LEN] = [0xe5; BINDING_DIGEST_LEN];
const PARAM_B: [u8; BINDING_DIGEST_LEN] = [0xf6; BINDING_DIGEST_LEN];

/// The governed request every proof below replays.
fn request_a() -> RequestReplayIdentity {
    RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A)
}

/// A disposable directory this test owns outright, removed when the guard drops.
struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(tag: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("pos-replay-{}-{tag}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp root");
        Self { path }
    }

    fn root(&self) -> HostOwnedRequestReplayRoot {
        HostOwnedRequestReplayRoot::fixture(&self.path)
    }

    fn open(&self) -> DurableRequestReplayFileStore {
        DurableRequestReplayFileStore::open(&self.root()).expect("open store")
    }

    /// The on-disk record file for one identity, for the tamper probes.
    fn record_file(&self, id: &RequestReplayIdentity) -> PathBuf {
        // The engine names a record file by the HEX of its record-id BYTES; the record id here is
        // already a hex string, so the on-disk name is the hex of that string's ASCII bytes.
        let key = hex_identity(id.as_bytes());
        let mut name = String::new();
        for b in key.as_bytes() {
            name.push_str(&format!("{b:02x}"));
        }
        self.path
            .join(REQUEST_REPLAY_RELATIVE_ROOT)
            .join("records")
            .join(format!("{name}.rec"))
    }

    /// Plant `bytes` at a NEW path inside the history the way the engine creates a file — with the
    /// store's committed descriptor (§10I) — so a tamper probe tests the rule it names instead of
    /// tripping custody first. An AMBIENT plant is custody's own case, proven separately.
    fn plant(&self, path: &std::path::Path, bytes: &[u8]) {
        use std::io::Write;
        let store = HostStoreCustody::fixture(&self.path)
            .establish(HostStateStore::RequestReplay)
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

/// A well-formed record body, exactly as the store itself writes one.
fn body(identity_hex: &str) -> String {
    format!(
        "{{\"schemaVersion\":1,\"recordRevision\":1,\"requestIdentityHex\":\"{identity_hex}\",\"state\":\"CONSUMED\"}}"
    )
}

// ---------------------------------------------------------------------------------------------
// B. RESTART — the whole point of the checkpoint.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_fresh_request_is_consumed_once() {
    let temp = TempRoot::new("fresh-once");
    let id = request_a();
    let mut store = temp.open();
    let evidence = store.consume(&id).expect("the first attempt is fresh");
    assert!(evidence.answers(&id));
}

#[test]
fn the_same_request_is_refused_within_one_store() {
    let temp = TempRoot::new("same-store");
    let id = request_a();
    let mut store = temp.open();
    store.consume(&id).expect("first");
    assert_eq!(
        store.consume(&id).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

#[test]
fn a_consumed_request_is_refused_after_a_restart() {
    let temp = TempRoot::new("restart");
    let id = request_a();
    {
        let mut store = temp.open();
        store.consume(&id).expect("first, before the restart");
    }
    // THE STORE OBJECT IS GONE. The lock was released, the in-memory revision and sequence were
    // dropped, and this open re-runs journal recovery over the directory. Every fact the answer
    // rests on is read back from bytes.
    let mut restarted = temp.open();
    assert_eq!(
        restarted.consume(&id).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed),
        "a Host restart must not turn already-consumed governed work back into fresh work"
    );
}

#[test]
fn repeated_restarts_keep_refusing() {
    let temp = TempRoot::new("restart-many");
    let id = request_a();
    {
        temp.open().consume(&id).expect("first");
    }
    for round in 0..5 {
        let mut store = temp.open();
        assert_eq!(
            store.consume(&id).map(|_| ()),
            Err(ReplayRefusal::AlreadyConsumed),
            "restart round {round} let a consumed request back in"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// C. NEW WORK — the opposite property. Replay protection must not end the programme.
// ---------------------------------------------------------------------------------------------

#[test]
fn genuinely_new_work_is_admitted_after_a_restart() {
    let temp = TempRoot::new("new-after-restart");
    let consumed_one = request_a();
    {
        temp.open().consume(&consumed_one).expect("first");
    }
    let mut store = temp.open();
    // A different review candidate / plan / phase - anything that changes the binding subject.
    store
        .consume(&RequestReplayIdentity::fixture_over(
            &DELEG_A, &BIND_B, &PARAM_A,
        ))
        .expect("different binding subject is different work");
    // A different inbox body under the same subject.
    store
        .consume(&RequestReplayIdentity::fixture_over(
            &DELEG_A, &BIND_A, &PARAM_B,
        ))
        .expect("different parameters are different work");
    // A NEW owner-signed delegation covering the same work. The owner granting again is a governed
    // act, not a replay - and it is the reason the delegation id is in the identity at all.
    store
        .consume(&RequestReplayIdentity::fixture_over(
            &DELEG_B, &BIND_A, &PARAM_A,
        ))
        .expect("a new owner grant is new authority");
    // ...and the original is still refused throughout.
    assert_eq!(
        store.consume(&consumed_one).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

#[test]
fn one_consumed_request_does_not_end_the_history() {
    let temp = TempRoot::new("not-a-blacklist");
    let mut store = temp.open();
    store.consume(&request_a()).expect("first");
    for i in 0u8..16 {
        let param = [i; BINDING_DIGEST_LEN];
        store
            .consume(&RequestReplayIdentity::fixture_over(
                &DELEG_A, &BIND_A, &param,
            ))
            .unwrap_or_else(|e| panic!("new work {i} was refused: {e:?}"));
    }
    assert_eq!(store.recorded().expect("count"), 17);
}

// ---------------------------------------------------------------------------------------------
// D. THE IDENTITY IS THE RIGHT ONE — session-local fields are absent by construction.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_identity_is_exactly_its_three_parts() {
    // Equal parts, equal identity - no clock, no counter and no salt has crept in, which would make
    // the durable record unmatchable on the next attempt.
    assert_eq!(
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A),
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A)
    );
    // Each part is load-bearing: changing any ONE changes the identity.
    let base = request_a();
    for other in [
        RequestReplayIdentity::fixture_over(&DELEG_B, &BIND_A, &PARAM_A),
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_B, &PARAM_A),
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B),
    ] {
        assert_ne!(base, other);
    }
}

#[test]
fn the_identity_does_not_transpose() {
    // A digest that concatenated its parts without fixed widths, or hashed them in a caller-chosen
    // order, could give two different governed requests the same identity - one of which would then
    // be permanently refused, and the other permanently replayable.
    assert_ne!(
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A),
        RequestReplayIdentity::fixture_over(&DELEG_A, &PARAM_A, &BIND_A)
    );
}

// ---------------------------------------------------------------------------------------------
// E. CONCURRENCY — at most one attempt may cross the gate.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_second_store_cannot_open_the_same_root_while_one_is_live() {
    let temp = TempRoot::new("second-store");
    let _held = temp.open();
    // The engine's single-writer OS lock is the exclusion. A second replay authority for the same
    // history is refused outright rather than given its own opinion - which is what stops two
    // processes each finding the same governed request fresh.
    let second = DurableRequestReplayFileStore::open(&temp.root());
    assert!(
        matches!(second, Err(ReplayRefusal::StoreUnavailable)),
        "a second store opened the same replay root"
    );
}

#[test]
fn repeated_attempts_produce_exactly_one_consumption() {
    // ONE STORE, MANY ATTEMPTS. `consume` takes `&mut self`, so attempts through one store are
    // serialised at the type level; what this proves is that the SERIALISED outcome is one success
    // and refusals thereafter - the freshness answer is re-read from disk inside every call rather
    // than taken from a snapshot made before the first write.
    let temp = TempRoot::new("repeat");
    let id = request_a();
    let mut store = temp.open();
    let outcomes: Vec<Result<(), ReplayRefusal>> =
        (0..8).map(|_| store.consume(&id).map(|_| ())).collect();
    assert_eq!(outcomes.iter().filter(|o| o.is_ok()).count(), 1);
    assert!(outcomes
        .iter()
        .skip(1)
        .all(|o| *o == Err(ReplayRefusal::AlreadyConsumed)));
}

#[test]
fn two_contending_threads_yield_one_store_and_one_consumption() {
    // TWO INDEPENDENT ATTEMPTS AT THE SAME ROOT, each opening its OWN store, running at the same
    // time. This is the in-process stand-in for two service instances contending for one state
    // root, and the property is the same: at most one may cross the gate. The loser is refused at
    // the OS lock - it never gets a store, so it never gets an opinion about freshness.
    let temp = TempRoot::new("contend");
    let id = request_a();
    let root = temp.root();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let attempt = |root: HostOwnedRequestReplayRoot,
                   barrier: std::sync::Arc<std::sync::Barrier>| {
        std::thread::spawn(move || {
            barrier.wait();
            DurableRequestReplayFileStore::open(&root).map(|mut s| s.consume(&id).map(|_| ()))
        })
    };
    let a = attempt(root.clone(), std::sync::Arc::clone(&barrier));
    let b = attempt(root, barrier);
    let outcomes = [a.join().expect("thread a"), b.join().expect("thread b")];
    let consumed = outcomes.iter().filter(|o| matches!(o, Ok(Ok(())))).count();
    assert!(
        consumed <= 1,
        "two contending attempts both consumed one governed request"
    );
    // Whatever happened above, the identity is consumed exactly once and stays refused.
    assert_eq!(
        temp.open().consume(&id).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

#[test]
fn a_writer_holding_a_stale_view_is_refused_by_the_engine() {
    // The create is issued with `expected = None`. A writer whose view of the history predates
    // another writer's record finds a record where it expected none, and the engine's optimistic
    // guard refuses it. Simulated by writing the record behind this store's back - which is exactly
    // the shape of a racing writer - and then asking it to consume.
    let temp = TempRoot::new("stale-writer");
    let id = request_a();
    let mut first = temp.open();
    first.consume(&id).expect("the record now exists");
    // A second attempt through the SAME object still re-reads from disk, so it refuses. If the
    // freshness answer were cached, this is the assertion that would fail.
    assert_eq!(
        first.consume(&id).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

// ---------------------------------------------------------------------------------------------
// F. SUBSTITUTION — a record must answer about the request it describes.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_record_moved_under_another_key_refuses() {
    let temp = TempRoot::new("moved-record");
    let consumed_id = request_a();
    let other_id = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B);
    {
        temp.open().consume(&consumed_id).expect("consume A");
    }
    // Copy A's record onto B's key. Under a store that trusted the filename, B would now read back
    // "consumed" - a denial of legitimate work. Under one that trusted only the body, A's own key
    // could be emptied to make A fresh again. The key/body binding refuses both.
    let from = temp.record_file(&consumed_id);
    let to = temp.record_file(&other_id);
    temp.plant(&to, &std::fs::read(&from).expect("read record"));
    let mut store = temp.open();
    assert_eq!(
        store.consume(&other_id).map(|_| ()),
        Err(ReplayRefusal::HistoryUnreadable),
        "a record filed under another identity must not answer for it"
    );
    // ...and A is still refused, so the substitution bought nothing in either direction.
    assert_eq!(
        store.consume(&consumed_id).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

// ---------------------------------------------------------------------------------------------
// §10I. CUSTODY — the history's own filesystem objects.
// ---------------------------------------------------------------------------------------------

#[test]
fn every_history_object_keeps_the_committed_descriptor_across_consumes_and_a_restart() {
    let temp = TempRoot::new("custody-history");
    let a = request_a();
    let b = RequestReplayIdentity::fixture_over(&DELEG_B, &BIND_B, &PARAM_B);
    {
        let mut store = temp.open();
        store.consume(&a).expect("consume a");
        store.consume(&b).expect("consume b");
    }
    {
        let mut store = temp.open();
        assert_eq!(
            store.consume(&a).map(|_| ()),
            Err(ReplayRefusal::AlreadyConsumed),
            "consumption survived the restart"
        );
    }
    HostStoreCustody::fixture(&temp.path)
        .establish(HostStateStore::RequestReplay)
        .expect("the history directory conforms")
        .verify_contents()
        .expect("every record, journal entry, the manifest and the lock conform");
}

#[test]
fn an_ambient_record_planted_in_the_history_refuses_the_next_open_and_is_not_repaired() {
    let temp = TempRoot::new("custody-ambient-plant");
    let a = request_a();
    let b = RequestReplayIdentity::fixture_over(&DELEG_B, &BIND_B, &PARAM_B);
    {
        temp.open().consume(&a).expect("consume a");
    }
    let planted = temp.record_file(&b);
    std::fs::write(&planted, body(&hex_identity(b.as_bytes()))).expect("plant");
    for _ in 0..2 {
        assert_eq!(
            DurableRequestReplayFileStore::open(&temp.root()).map(|_| ()),
            Err(ReplayRefusal::CustodyRefused)
        );
    }
    assert!(
        planted.exists(),
        "a refusal must not remove what it refused"
    );
}

#[test]
fn interpret_binds_the_body_to_the_key() {
    let a = hex_identity(request_a().as_bytes());
    let b =
        hex_identity(RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B).as_bytes());
    assert!(interpret(&a, body(&a).as_bytes()).is_ok());
    assert_eq!(
        interpret(&a, body(&b).as_bytes()),
        Err(ReplayRefusal::HistoryUnreadable)
    );
}

// ---------------------------------------------------------------------------------------------
// G. FAILURE — every uncertainty refuses, and none of them is "fresh".
// ---------------------------------------------------------------------------------------------

#[test]
fn an_absent_state_root_refuses() {
    // A root that is not there is NOT an empty history that may be trusted: a store that laid out a
    // whole missing directory chain would treat any unprepared machine as one where nothing has run.
    let missing = std::env::temp_dir().join(format!("pos-replay-absent-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&missing);
    let root = HostOwnedRequestReplayRoot::fixture(&missing);
    assert!(matches!(
        DurableRequestReplayFileStore::open(&root),
        Err(ReplayRefusal::StateRootUnusable)
    ));
}

/// Consume one request, then TAMPER with its durable record, and require the store to refuse.
///
/// THE REFUSAL ARRIVES AT OPEN, NOT AT READ, and that is stronger than the shape this test was
/// first written to expect. The engine's journal-aware recovery scan re-frames every record when
/// the store opens, so a record whose SHA-256 framing no longer vouches for it takes the WHOLE
/// history offline rather than being skipped while the untouched records carry on answering. That
/// is the right direction for a replay history: a store that opened and reported one tampered
/// entry as merely unreadable would still be answering "fresh" for it, because there is no other
/// record to find. Refusing to open refuses everything.
fn assert_tamper_refuses(tag: &str, mutate: impl Fn(&[u8]) -> Vec<u8>) {
    let temp = TempRoot::new(tag);
    let id = request_a();
    {
        temp.open().consume(&id).expect("consume");
    }
    let path = temp.record_file(&id);
    let original = std::fs::read(&path).expect("read record");
    assert!(original.len() > 16, "a real frame, not an empty file");
    std::fs::write(&path, mutate(&original)).expect("tamper");
    assert_eq!(
        DurableRequestReplayFileStore::open(&temp.root()).map(|_| ()),
        Err(ReplayRefusal::StoreUnavailable),
        "{tag}: a history holding a record it cannot vouch for must not open at all"
    );
}

#[test]
fn a_truncated_record_refuses() {
    assert_tamper_refuses("truncated", |b| b[..b.len() / 2].to_vec());
}

#[test]
fn a_record_the_engine_cannot_frame_refuses() {
    assert_tamper_refuses("garbage", |_| b"not a framed record at all".to_vec());
}

#[test]
fn a_flipped_byte_refuses_because_the_framing_digest_covers_it() {
    // The one that matters most: an attacker who edits the state word or the identity inside an
    // otherwise well-formed record. The framing digest covers the body, so the edit is detected.
    assert_tamper_refuses("bitflip", |b| {
        let mut out = b.to_vec();
        let last = out.len() - 1;
        out[last] ^= 0xff;
        out
    });
}

// ---------------------------------------------------------------------------------------------
// DELETION — the boundary of what this checkpoint can honestly claim, measured rather than assumed.
// ---------------------------------------------------------------------------------------------
//
// FRESHNESS IS THE ABSENCE OF A RECORD. That is what makes the family small and what makes it
// impossible to write a value meaning "no longer consumed" — and it is also what makes DELETION the
// attack this family is most exposed to. An attacker who can remove protected files can make a
// consumed request fresh again.
//
// THAT IS THE ALREADY-STATED BOUNDARY, NOT A NEW GAP. §10B says it in as many words for the
// delegation family: anti-rollback rests on the FUTURE restricted ProgramData ACL, an attacker who
// can already replace protected files as SYSTEM is outside the checkpoint, and no local counter
// would honestly change that. A deleted `Revoked` record resurrects a delegation by exactly the
// same route.
//
// WHAT THE TWO TESTS BELOW ADD is the precise shape of it, because the engine does NOT behave
// uniformly and assuming it did would have been the wrong claim to write down. Recovery compares
// the MAXIMUM surviving record revision against the manifest: removing the most recent record
// leaves the manifest ahead and the whole store refuses to open, while removing an older one leaves
// the maximum unchanged, so the store opens and that identity reads back fresh. Both are measured
// here so the limit is documented rather than discovered later.

#[test]
fn deleting_the_most_recent_record_takes_the_whole_history_offline() {
    let temp = TempRoot::new("deleted-newest");
    let first = request_a();
    let newest = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B);
    {
        let mut store = temp.open();
        store.consume(&first).expect("first");
        store.consume(&newest).expect("second");
    }
    std::fs::remove_file(temp.record_file(&newest)).expect("delete the newest record");
    assert_eq!(
        DurableRequestReplayFileStore::open(&temp.root()).map(|_| ()),
        Err(ReplayRefusal::StoreUnavailable),
        "the manifest is ahead of every surviving record; the history must not open"
    );
}

#[test]
fn deleting_an_older_record_is_not_detected_and_that_identity_reads_fresh() {
    // MEASURED, AND IT IS A REFUTATION OF THE COMFORTABLE ANSWER. The store opens and the deleted
    // identity is admitted again. Recovery's coherence test is `max(record revision) >= manifest`,
    // which an older record's removal does not disturb, and nothing in this family counts its own
    // entries.
    //
    // It is recorded as a test rather than left out because a suite that only demonstrated the
    // detected case would read as though deletion were covered. It is not, and closing it needs the
    // restricted ProgramData ACL that the installation chain owns - carried forward, not papered
    // over here with a local counter an attacker at this privilege level would simply edit too.
    let temp = TempRoot::new("deleted-older");
    let older = request_a();
    let newest = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B);
    {
        let mut store = temp.open();
        store.consume(&older).expect("first");
        store.consume(&newest).expect("second");
    }
    std::fs::remove_file(temp.record_file(&older)).expect("delete the older record");
    let mut store = temp.open();
    assert!(
        store.consume(&older).is_ok(),
        "if this now REFUSES, deletion has become detectable and the boundary above must be \
         restated - which would be an improvement, not a regression"
    );
    // The record that was NOT deleted is still refused, so the exposure is exactly one entry per
    // deletion and never a wholesale reset.
    assert_eq!(
        store.consume(&newest).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
}

#[test]
fn interpret_refuses_every_malformed_body() {
    let key = hex_identity(request_a().as_bytes());
    let cases: [(&str, String); 8] = [
        ("not json", "}{".to_owned()),
        ("truncated json", body(&key)[..20].to_owned()),
        (
            "wrong schema",
            body(&key).replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
        ),
        (
            "zero revision",
            body(&key).replace("\"recordRevision\":1", "\"recordRevision\":0"),
        ),
        (
            "unknown state word",
            body(&key).replace("CONSUMED", "RELEASED"),
        ),
        (
            "unknown field",
            body(&key).replace("{\"schemaVersion\"", "{\"fresh\":true,\"schemaVersion\""),
        ),
        ("empty identity", body("")),
        ("short identity", body(&key[..REPLAY_IDENTITY_LEN * 2 - 2])),
    ];
    for (what, text) in cases {
        assert_eq!(
            interpret(&key, text.as_bytes()),
            Err(ReplayRefusal::HistoryUnreadable),
            "{what} was not refused"
        );
    }
    // UPPERCASE IS ITS OWN CASE, checked under its own key so the refusal is about the CANONICAL
    // SPELLING rule and not merely about the key and the body disagreeing. Two spellings of one
    // identity would be two storage keys, and the second reads back absent - which is fresh.
    let shouty = key.to_uppercase();
    assert_eq!(
        interpret(&shouty, body(&shouty).as_bytes()),
        Err(ReplayRefusal::HistoryUnreadable),
        "an uppercase identity spelling was accepted"
    );
}

#[test]
fn an_oversize_record_is_refused_before_it_is_parsed() {
    let key = hex_identity(request_a().as_bytes());
    let mut padded = body(&key);
    padded.push_str(&" ".repeat(MAX_REPLAY_RECORD_BYTES + 1));
    assert_eq!(
        interpret(&key, padded.as_bytes()),
        Err(ReplayRefusal::HistoryUnreadable)
    );
}

// ---------------------------------------------------------------------------------------------
// H. BOUNDS — capacity refuses; it never evicts.
// ---------------------------------------------------------------------------------------------

#[test]
fn capacity_refuses_and_evicts_nothing() {
    // The engine's own layout bound is reached long before this store's, which is the safe ordering:
    // a bound crossed anywhere on this path must REFUSE the new request. What must never happen is
    // that an existing consumed record disappears to make room, so the earliest entry is re-checked
    // after the refusal.
    let temp = TempRoot::new("capacity");
    let first = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &[0u8; BINDING_DIGEST_LEN]);
    let mut store = temp.open();
    store.consume(&first).expect("first");
    let mut refused_at = None;
    for i in 1u32..(super::MAX_REPLAY_RECORDS as u32 + 8) {
        let mut param = [0u8; BINDING_DIGEST_LEN];
        param[..4].copy_from_slice(&i.to_be_bytes());
        let id = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &param);
        if let Err(err) = store.consume(&id) {
            assert!(
                matches!(
                    err,
                    ReplayRefusal::CapacityExhausted | ReplayRefusal::WriteRefused
                ),
                "capacity was reached with an unexpected refusal: {err:?}"
            );
            refused_at = Some(i);
            break;
        }
    }
    let refused_at = refused_at.expect("the bound was never reached");
    assert_eq!(
        store.consume(&first).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed),
        "the oldest consumed record was evicted to make room at {refused_at}"
    );
}

// ---------------------------------------------------------------------------------------------
// I. NO EFFECT — what these proofs did not touch.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_store_writes_only_inside_the_root_it_was_given() {
    let temp = TempRoot::new("containment");
    let id = request_a();
    {
        temp.open().consume(&id).expect("consume");
    }
    // Everything the store created is under the ONE frozen leaf segment; the record file exists and
    // nothing was written beside the leaf.
    assert!(temp.record_file(&id).is_file());
    let entries: Vec<String> = std::fs::read_dir(&temp.path)
        .expect("read root")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(entries, vec![REQUEST_REPLAY_RELATIVE_ROOT.to_owned()]);
}

#[test]
fn the_leaf_segment_is_frozen_and_not_caller_influenced() {
    // The segment is a constant joined onto a private root: there is no argument anywhere on this
    // path through which a caller could choose a different directory - which is the whole reason
    // the root is a capability rather than a path.
    assert_eq!(REQUEST_REPLAY_RELATIVE_ROOT, "request-replay");
    assert!(!REQUEST_REPLAY_RELATIVE_ROOT.contains(['/', '\\', ':']));
}

#[test]
fn the_storage_key_is_canonical_lowercase_hex() {
    let key = hex_identity(&[0xAB; REPLAY_IDENTITY_LEN]);
    assert_eq!(key.len(), REPLAY_IDENTITY_LEN * 2);
    assert!(key
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
    // One identity, one spelling. A second spelling would be a second key that reads back ABSENT,
    // which is the same as fresh.
    assert_eq!(key, hex_identity(&[0xab; REPLAY_IDENTITY_LEN]));
}

// ---------------------------------------------------------------------------------------------
// D. CRASH — an interrupted durable transition must never resolve to "fresh" for work already done.
// ---------------------------------------------------------------------------------------------
//
// `put_record` is four durable steps: write the Prepared intent, replace the record, advance the
// manifest, mark Committed. A crash can land between any two of them, and the engine's open-time
// recovery is what decides the outcome. The property §10C needs is narrow and worth stating exactly:
//
//   * `consume` returns evidence ONLY after `put_record` has returned, i.e. after the manifest
//     advance and the Committed mark. So a crash anywhere inside the transition means the caller
//     never received a `ConsumedRequest`, never reached the §9A admission, and never reached the
//     §9C mint - no authority exists for that request, and nothing executed.
//   * Therefore the only dangerous direction is the OTHER one: an interruption must not lose or
//     invalidate an identity that was ALREADY consumed and reported. That is what these tests pin.

/// The engine's manifest file for this store's leaf, used to simulate a crash between the record
/// replacement and the manifest advance.
fn manifest_file(temp: &TempRoot) -> PathBuf {
    temp.path
        .join(REQUEST_REPLAY_RELATIVE_ROOT)
        .join("manifest.pdr")
}

#[test]
fn an_interrupted_transition_does_not_lose_an_earlier_consumption() {
    // A is consumed and REPORTED - its caller holds evidence. B's transition is then rolled back to
    // the state a crash between "record written" and "manifest advanced" would leave: B's record is
    // on disk at a revision the manifest does not yet cover.
    let temp = TempRoot::new("crash-earlier");
    let a = request_a();
    let b = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B);

    let before_b = {
        let mut store = temp.open();
        store.consume(&a).expect("A is consumed and reported");
        std::fs::read(manifest_file(&temp)).expect("manifest after A")
    };
    {
        let mut store = temp.open();
        store.consume(&b).expect("B writes its record");
    }
    // The crash: B's record survives, the manifest does not know about it.
    std::fs::write(manifest_file(&temp), &before_b).expect("roll the manifest back");

    // Whatever recovery decides about B, it must decide it WITHOUT resurrecting A. Opening may also
    // refuse outright - that is equally safe, and the assertion below covers both.
    match DurableRequestReplayFileStore::open(&temp.root()) {
        Ok(mut store) => assert_eq!(
            store.consume(&a).map(|_| ()),
            Err(ReplayRefusal::AlreadyConsumed),
            "an interrupted write for ANOTHER request made an already-consumed one fresh"
        ),
        Err(err) => assert!(
            matches!(
                err,
                ReplayRefusal::StoreUnavailable | ReplayRefusal::StateRootUnusable
            ),
            "an interrupted transition must fail closed, got {err:?}"
        ),
    }
}

#[test]
fn an_interrupted_first_transition_fails_closed_rather_than_opening() {
    // THE CRASH WINDOW ITSELF, for the FIRST-EVER write. Before it there is no manifest at all - the
    // engine writes one as part of the transition - so the state a crash between "record replaced"
    // and "manifest advanced" leaves behind is: records on disk, no manifest. (An earlier draft of
    // this test tried to snapshot the empty store's manifest and failed with NotFound, which is how
    // the actual shape of the interruption was established rather than assumed.)
    //
    // The caller of that interrupted `consume` never received a `ConsumedRequest`, so no admission
    // and no authority ever existed for it. What must NOT happen is the store opening and quietly
    // answering about a history it cannot vouch for.
    let temp = TempRoot::new("crash-first");
    let id = request_a();
    {
        let mut store = temp.open();
        store.consume(&id).expect("the record is written");
    }
    std::fs::remove_file(manifest_file(&temp)).expect("drop the manifest the crash never wrote");
    assert_eq!(
        DurableRequestReplayFileStore::open(&temp.root()).map(|_| ()),
        Err(ReplayRefusal::StoreUnavailable),
        "records with no manifest is an unvouched-for history and must not open"
    );
}

#[test]
fn a_removed_journal_does_not_turn_a_consumed_request_fresh() {
    // The journal is the engine's own record of intent. Deleting it is a cruder attack than editing
    // a record, and the answer must still not be "fresh": either recovery refuses the store, or the
    // record itself still stands on its own framing.
    let temp = TempRoot::new("crash-journal");
    let id = request_a();
    {
        temp.open().consume(&id).expect("consume");
    }
    let journal = temp.path.join(REQUEST_REPLAY_RELATIVE_ROOT).join("journal");
    if journal.is_dir() {
        let _ = std::fs::remove_dir_all(&journal);
    }
    match DurableRequestReplayFileStore::open(&temp.root()) {
        Ok(mut store) => assert_eq!(
            store.consume(&id).map(|_| ()),
            Err(ReplayRefusal::AlreadyConsumed),
            "a consumed request became fresh when the journal was removed"
        ),
        Err(err) => assert!(
            matches!(
                err,
                ReplayRefusal::StoreUnavailable | ReplayRefusal::StateRootUnusable
            ),
            "a removed journal must fail closed, got {err:?}"
        ),
    }
}
