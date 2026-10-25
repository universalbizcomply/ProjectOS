//! The transaction's own proofs, over disposable project roots.
//!
//! NO REAL LEDGER IS TOUCHED. Every root here is a fresh directory under the system temporary
//! directory, created by the test and removed when it drops. Nothing reads or writes the ProjectOS
//! checkout's own `.projectops`, no provider is contacted, and no cost is real.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;

/// A disposable project root, removed when it drops.
///
/// REMOVED, NOT LEFT BEHIND. A previous ProjectOS phase leaked tens of gigabytes of scratch
/// directories from tests that created them and never cleaned up; a `Drop` is what makes that
/// impossible rather than remembered.
struct Scratch {
    root: PathBuf,
}

static NEXT: AtomicU64 = AtomicU64::new(0);

impl Scratch {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "projectos-10d-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".projectops")).expect("scratch root");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
    }

    /// Write a gatekeeper configuration carrying this hard stop, otherwise the approved pilot.
    fn with_hard_stop(self, hard_stop: u64) -> Self {
        let warn = hard_stop.min(policy::APPROVED_WARN_AT_MICRO_USD);
        let config = format!(
            r#"{{
  "schemaVersion": "1.0.0",
  "enabled": true,
  "programmeId": "projectos-autonomous-self-hosting",
  "budget": {{
    "initialCreditMicroUsd": 5000000,
    "warnAtMicroUsd": {warn},
    "hardStopAtMicroUsd": {hard_stop},
    "autoRecharge": false
  }},
  "budgetRaiseAuthorities": []
}}
"#
        );
        fs::write(
            self.root.join(".projectops").join("gatekeeper.json"),
            config,
        )
        .expect("config");
        self
    }

    fn ledger_text(&self) -> String {
        fs::read_to_string(self.root.join(".projectops").join("gatekeeper-ledger.json"))
            .unwrap_or_default()
    }

    fn document(&self) -> LedgerDocument {
        read_ledger_for_evidence(self.path()).expect("readable ledger")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// 2026-09-08T13:00:00Z — inside 2026-09.
const SEPTEMBER: u64 = 1_788_872_400;
/// 2026-08-31T23:59:59Z — the last second of the previous month.
const AUGUST_LAST_SECOND: u64 = 1_788_220_799;

fn ask<'a>(id: &'a str, cost: Option<u64>, ceiling: u64) -> AdmissionRequest<'a> {
    AdmissionRequest {
        request_id: id,
        project_id: "projectos",
        phase_id: "PHASE-ONE",
        model: "gpt-5.6-terra",
        cost_micro_usd: cost,
        delegation_ceiling_micro_usd: ceiling,
        at_epoch_s: SEPTEMBER,
    }
}

/// Settle a call at the test's own clock reading.
fn commit_at(root: &Path, id: &str, settled: &SettledProviderCall) -> Result<(), LedgerRefusal> {
    commit_reservation(root, id, settled, SEPTEMBER)
}

/// Release at the test's own clock reading.
fn release_at(root: &Path, id: &str) -> Result<(), LedgerRefusal> {
    release_reservation(root, id, SEPTEMBER)
}

fn call(cost: u64) -> SettledProviderCall {
    SettledProviderCall {
        input_tokens: 1_599,
        cached_input_tokens: Some(0),
        output_tokens: 463,
        cost_micro_usd: cost,
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (A) THE CANONICAL FILE IS THE ONE SOURCE, AND THE ENTRY IS THE CANONICAL ENTRY
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_admission_writes_the_canonical_entry_to_the_canonical_file() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let admitted =
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_000), u64::MAX)).expect("admitted");

    assert_eq!(admitted.cost_micro_usd(), 1_000);
    assert_eq!(admitted.spend_snapshot_micro_usd(), 0);
    assert_eq!(admitted.hard_stop_micro_usd(), 5_000_000);
    assert_eq!(
        scratch.ledger_text(),
        r#"{
  "schemaVersion": "1.0.0",
  "entries": [
    {
      "requestId": "GKHOST-0001",
      "projectId": "projectos",
      "phaseId": "PHASE-ONE",
      "model": "gpt-5.6-terra",
      "usage": {
        "inputTokens": 0,
        "outputTokens": 0
      },
      "costMicroUsd": 1000,
      "unresolved": true,
      "at": "2026-09-08T13:00:00Z"
    }
  ]
}
"#
    );
}

#[test]
fn a_reservation_is_visible_to_a_completely_fresh_reader() {
    // "PROCESS-STYLE RECONSTRUCTION": nothing is carried between these calls but the file. There is
    // no handle, no cache and no in-memory position to preserve, because there is none to begin
    // with — which is the property this test exists to pin.
    let scratch = Scratch::new().with_hard_stop(5_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(4_000), u64::MAX)).expect("first");
    let refused = admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1_001), u64::MAX));
    assert_eq!(refused.unwrap_err(), LedgerRefusal::HardStopExceeded);
    // And the capacity that IS left is still admissible.
    admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1_000), u64::MAX)).expect("fits exactly");
}

#[test]
fn the_month_snapshot_counts_committed_spend_and_outstanding_reservations_alike() {
    let scratch = Scratch::new().with_hard_stop(5_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_000), u64::MAX)).expect("first");
    commit_at(scratch.path(), "GKHOST-0001", &call(1_200)).expect("settled");
    admit_spend(scratch.path(), &ask("GKHOST-0002", Some(800), u64::MAX)).expect("second");

    let third =
        admit_spend(scratch.path(), &ask("GKHOST-0003", Some(1_000), u64::MAX)).expect("third");
    // 1,200 committed + 800 still outstanding.
    assert_eq!(third.spend_snapshot_micro_usd(), 2_000);
}

#[test]
fn spend_in_another_month_does_not_count_against_this_one() {
    let scratch = Scratch::new().with_hard_stop(1_000);
    let august = AdmissionRequest {
        at_epoch_s: AUGUST_LAST_SECOND,
        ..ask("GKHOST-AUG1", Some(900), u64::MAX)
    };
    admit_spend(scratch.path(), &august).expect("august");
    // September starts clean, one second later.
    let september =
        admit_spend(scratch.path(), &ask("GKHOST-SEP1", Some(900), u64::MAX)).expect("september");
    assert_eq!(september.spend_snapshot_micro_usd(), 0);
    assert_eq!(scratch.document().entries.len(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (B) BOTH CEILINGS, AND THE LOWER BINDS
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_installation_hard_stop_refuses_independently_of_the_owner_ceiling() {
    let scratch = Scratch::new().with_hard_stop(1_000);
    let refused = admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_001), u64::MAX));
    assert_eq!(refused.unwrap_err(), LedgerRefusal::HardStopExceeded);
    assert!(scratch.ledger_text().is_empty(), "a refusal wrote a ledger");
}

#[test]
fn the_owner_delegation_ceiling_refuses_independently_of_the_hard_stop() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let refused = admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_001), 1_000));
    assert_eq!(refused.unwrap_err(), LedgerRefusal::CeilingExceeded);
}

#[test]
fn the_lower_of_the_two_controls_is_the_one_that_binds() {
    // Owner ceiling lower.
    let scratch = Scratch::new().with_hard_stop(5_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(2_000), 2_000)).expect("at the ceiling");
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1), 2_000)).unwrap_err(),
        LedgerRefusal::CeilingExceeded
    );

    // Hard stop lower.
    let scratch = Scratch::new().with_hard_stop(2_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(2_000), 5_000)).expect("at the stop");
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1), 5_000)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );
}

#[test]
fn a_month_already_at_the_hard_stop_admits_nothing_at_all() {
    let scratch = Scratch::new().with_hard_stop(1_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_000), u64::MAX)).expect("exactly");
    // Even a zero-cost call: `spent >= hardStop` is STOPPED before any estimate is considered.
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", Some(0), u64::MAX)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (C) COST
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_unknown_cost_is_refused_and_never_spent_as_zero() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", None, u64::MAX)).unwrap_err(),
        LedgerRefusal::CostUnknown
    );
    assert!(scratch.ledger_text().is_empty());
}

#[test]
fn an_overflowing_projection_is_refused_rather_than_wrapped() {
    let scratch = Scratch::new().with_hard_stop(u64::MAX);
    // A hard stop of u64::MAX needs an owner decision, so this configuration is refused first —
    // which is itself the point: there is no way to configure a ceiling that makes overflow
    // reachable without an owner decision behind it.
    assert_eq!(
        admit_spend(
            scratch.path(),
            &ask("GKHOST-0001", Some(u64::MAX), u64::MAX)
        )
        .unwrap_err(),
        LedgerRefusal::PolicyUnenforceable
    );

    // With the raise authorised, the arithmetic itself is still checked.
    let scratch = Scratch::new();
    fs::write(
        scratch.path().join(".projectops").join("gatekeeper.json"),
        format!(
            r#"{{"schemaVersion":"1.0.0","enabled":true,"budget":{{"initialCreditMicroUsd":0,"warnAtMicroUsd":0,"hardStopAtMicroUsd":{},"autoRecharge":false,"raisedByOwnerDecisionId":"D1"}},"budgetRaiseAuthorities":[{{"decisionId":"D1","scope":"gatekeeper-budget-raise"}}]}}"#,
            u64::MAX
        ),
    )
    .unwrap();
    admit_spend(
        scratch.path(),
        &ask("GKHOST-0001", Some(u64::MAX - 1), u64::MAX),
    )
    .expect("admitted under an authorised raise");
    assert_eq!(
        admit_spend(
            scratch.path(),
            &ask("GKHOST-0002", Some(u64::MAX), u64::MAX)
        )
        .unwrap_err(),
        LedgerRefusal::ArithmeticOverflow
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (D) ONE REQUEST, ONE RESERVATION
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_request_id_that_already_has_an_entry_is_refused_whatever_that_entry_is() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).expect("first");
    // Outstanding.
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::AlreadyReserved
    );
    // Settled.
    commit_at(scratch.path(), "GKHOST-0001", &call(12)).expect("settled");
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::AlreadyReserved
    );
    assert_eq!(scratch.document().entries.len(), 1);
}

#[test]
fn a_request_id_that_could_never_address_a_record_is_refused() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    for bad in [
        "",
        "ab",
        "../escape",
        "GKHOST 0001",
        "GKHOST/0001",
        &"a".repeat(129),
    ] {
        assert_eq!(
            admit_spend(scratch.path(), &ask(bad, Some(10), u64::MAX)).unwrap_err(),
            LedgerRefusal::RequestIdMalformed,
            "accepted id {bad:?}"
        );
    }
}

#[test]
fn the_outstanding_reservation_list_is_bounded() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    for n in 0..MAX_OUTSTANDING_RESERVATIONS {
        admit_spend(
            scratch.path(),
            &ask(&format!("GKHOST-{n:04}"), Some(1), u64::MAX),
        )
        .unwrap_or_else(|e| panic!("admission {n} refused: {e}"));
    }
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-9999", Some(1), u64::MAX)).unwrap_err(),
        LedgerRefusal::OutstandingReservationsExhausted
    );
    // TRANSIENT, UNLIKE A CEILING: settling one in flight clears it.
    commit_at(scratch.path(), "GKHOST-0000", &call(1)).expect("settled");
    admit_spend(scratch.path(), &ask("GKHOST-9999", Some(1), u64::MAX)).expect("room again");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (E) SETTLEMENT, EXACTLY ONCE
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_reservation_commits_once_and_becomes_the_call_that_happened() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_000), u64::MAX)).expect("reserved");
    commit_at(scratch.path(), "GKHOST-0001", &call(1_234)).expect("committed");

    let document = scratch.document();
    let entry = document.find("GKHOST-0001").expect("still there");
    assert_eq!(entry.cost_micro_usd, 1_234);
    assert_eq!(entry.unresolved, None);
    assert!(entry.usage.is_a_call());
    assert_eq!(
        entry.at, "2026-09-08T13:00:00Z",
        "the admitting month was kept"
    );
    assert_eq!(
        document.entries.len(),
        1,
        "settlement replaced rather than appended"
    );

    // Committed spend moved exactly once.
    assert_eq!(document.month_total_micro_usd("2026-09").unwrap(), 1_234);
}

#[test]
fn a_reservation_releases_once_and_the_capacity_comes_back() {
    let scratch = Scratch::new().with_hard_stop(1_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(1_000), u64::MAX)).expect("reserved");
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1), u64::MAX)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );
    release_at(scratch.path(), "GKHOST-0001").expect("released");
    assert_eq!(scratch.document().entries.len(), 0);
    admit_spend(scratch.path(), &ask("GKHOST-0002", Some(1_000), u64::MAX)).expect("capacity back");
}

#[test]
fn every_invalid_settlement_transition_is_refused() {
    // Double commit.
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap();
    commit_at(scratch.path(), "GKHOST-0001", &call(12)).unwrap();
    assert_eq!(
        commit_at(scratch.path(), "GKHOST-0001", &call(12)).unwrap_err(),
        LedgerRefusal::AlreadySettled
    );
    // Release after commit — a real charge is never erased by a release.
    assert_eq!(
        release_at(scratch.path(), "GKHOST-0001").unwrap_err(),
        LedgerRefusal::AlreadySettled
    );
    assert_eq!(
        scratch.document().month_total_micro_usd("2026-09").unwrap(),
        12
    );

    // Double release, and commit after release.
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0002", Some(10), u64::MAX)).unwrap();
    release_at(scratch.path(), "GKHOST-0002").unwrap();
    assert_eq!(
        release_at(scratch.path(), "GKHOST-0002").unwrap_err(),
        LedgerRefusal::ReservationNotOutstanding
    );
    assert_eq!(
        commit_at(scratch.path(), "GKHOST-0002", &call(12)).unwrap_err(),
        LedgerRefusal::ReservationNotOutstanding
    );
}

#[test]
fn a_reservation_cannot_be_settled_on_a_ledger_that_never_held_it() {
    let held = Scratch::new().with_hard_stop(5_000_000);
    let other = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(held.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).expect("reserved here");

    assert_eq!(
        commit_at(other.path(), "GKHOST-0001", &call(12)).unwrap_err(),
        LedgerRefusal::ReservationNotOutstanding
    );
    assert_eq!(
        release_at(other.path(), "GKHOST-0001").unwrap_err(),
        LedgerRefusal::ReservationNotOutstanding
    );
    // And the reservation that really exists is untouched by either attempt.
    assert!(held
        .document()
        .find("GKHOST-0001")
        .unwrap()
        .is_outstanding());
}

#[test]
fn a_settlement_that_records_no_call_is_refused() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap();
    let nothing = SettledProviderCall {
        input_tokens: 0,
        cached_input_tokens: Some(0),
        output_tokens: 0,
        cost_micro_usd: 10,
    };
    assert_eq!(
        commit_at(scratch.path(), "GKHOST-0001", &nothing).unwrap_err(),
        LedgerRefusal::SettlementRecordsNoCall
    );
    assert!(scratch
        .document()
        .find("GKHOST-0001")
        .unwrap()
        .is_outstanding());
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (F) THE LOCK
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_held_lock_refuses_admission_settlement_and_release_alike() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).expect("reserved");

    // Exactly what another process holding the canonical lock looks like on disk.
    let lock = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.lock");
    fs::write(&lock, "{\"heldSince\":\"2026-09-08T13:00:00Z\"}\n").unwrap();

    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::LockHeld
    );
    assert_eq!(
        commit_at(scratch.path(), "GKHOST-0001", &call(12)).unwrap_err(),
        LedgerRefusal::LockHeld
    );
    assert_eq!(
        release_at(scratch.path(), "GKHOST-0001").unwrap_err(),
        LedgerRefusal::LockHeld
    );

    fs::remove_file(&lock).unwrap();
    admit_spend(scratch.path(), &ask("GKHOST-0002", Some(10), u64::MAX)).expect("lock released");
}

#[test]
fn concurrent_admissions_cannot_overbook_one_hard_stop() {
    // TWO CONTENDERS, ONE SEAT. The hard stop is 1,000 and each request costs 600, so at most one
    // can be admitted. Threads share nothing but the file and the lock, which is precisely the
    // interface two PROCESSES share — the cross-implementation proof drives the same property
    // against the real TypeScript implementation in a separate process.
    let scratch = Scratch::new().with_hard_stop(1_000);
    let root = scratch.path().to_path_buf();

    let outcomes: Vec<Result<AdmittedReservation, LedgerRefusal>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|n| {
                let root = root.clone();
                scope.spawn(move || {
                    let id = format!("GKHOST-{n:04}");
                    admit_spend(&root, &ask(&id, Some(600), u64::MAX))
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("thread"))
            .collect()
    });

    let admitted = outcomes.iter().filter(|o| o.is_ok()).count();
    assert_eq!(
        admitted, 1,
        "both contenders were admitted against one budget"
    );
    // The refusal is either the hard stop (it read the other's reservation) or a held lock (it never
    // got in). Both are refusals; neither spends.
    let refusal = outcomes
        .iter()
        .find_map(|o| o.as_ref().err())
        .copied()
        .unwrap();
    assert!(
        matches!(
            refusal,
            LedgerRefusal::HardStopExceeded | LedgerRefusal::LockHeld
        ),
        "unexpected refusal {refusal:?}"
    );
    assert_eq!(scratch.document().entries.len(), 1);
    assert_eq!(
        scratch.document().month_total_micro_usd("2026-09").unwrap(),
        600
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (G) A LEDGER THAT CANNOT BE READ IS NEVER AN OPEN BUDGET
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_malformed_ledger_refuses_rather_than_reading_as_empty() {
    for corrupt in [
        "",
        "{",
        "null",
        r#"{"schemaVersion":"1.0.0"}"#,
        r#"{"schemaVersion":"9.9.9","entries":[]}"#,
        r#"{"schemaVersion":"1.0.0","entries":[{"requestId":"GKHOST-0001","projectId":"p","phaseId":"f","model":"m","usage":{"inputTokens":0,"outputTokens":0},"costMicroUsd":-5,"at":"2026-09-01T00:00:00Z"}]}"#,
    ] {
        let scratch = Scratch::new().with_hard_stop(5_000_000);
        fs::write(
            scratch
                .path()
                .join(".projectops")
                .join("gatekeeper-ledger.json"),
            corrupt,
        )
        .unwrap();
        let refused = admit_spend(scratch.path(), &ask("GKHOST-0002", Some(10), u64::MAX));
        assert_eq!(
            refused.unwrap_err(),
            LedgerRefusal::LedgerMalformed,
            "admitted against {corrupt}"
        );
    }
}

#[test]
fn an_oversize_ledger_is_refused_rather_than_read() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let padding = "x".repeat(MAX_LEDGER_BYTES as usize + 1);
    fs::write(
        scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json"),
        padding,
    )
    .unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::LedgerOversize
    );
}

#[test]
fn a_ledger_path_that_is_not_a_regular_file_is_refused() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    fs::create_dir(
        scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json"),
    )
    .unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::PathNotRegular
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (H) THE ROOT AND THE POLICY
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_root_that_is_not_a_governed_project_admits_nothing_and_creates_nothing() {
    let bare = std::env::temp_dir().join(format!("projectos-10d-bare-{}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    fs::create_dir_all(&bare).unwrap();
    assert_eq!(
        admit_spend(&bare, &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::ProjectRootUnavailable
    );
    assert!(
        !bare.join(".projectops").exists(),
        "the transaction manufactured a governed project directory"
    );
    let missing = bare.join("no-such-root");
    assert_eq!(
        admit_spend(&missing, &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::ProjectRootUnavailable
    );
    let _ = fs::remove_dir_all(&bare);
}

#[test]
fn an_absent_or_unenforceable_configuration_stops_spending() {
    // Absent.
    let scratch = Scratch::new();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::ConfigUnavailable
    );
    // Present but unenforceable: no hard stop at all.
    let scratch = Scratch::new();
    fs::write(
        scratch.path().join(".projectops").join("gatekeeper.json"),
        r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":1,"warnAtMicroUsd":1,"autoRecharge":false}}"#,
    )
    .unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::PolicyUnenforceable
    );
    assert!(scratch.ledger_text().is_empty());
}

#[test]
fn the_lock_is_always_released_however_the_transaction_ended() {
    let scratch = Scratch::new().with_hard_stop(1_000);
    let lock = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.lock");

    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).expect("admitted");
    assert!(!lock.exists(), "the lock outlived a successful admission");

    let _ = admit_spend(
        scratch.path(),
        &ask("GKHOST-0002", Some(u64::MAX), u64::MAX),
    );
    assert!(!lock.exists(), "the lock outlived a refused admission");

    let _ = release_at(scratch.path(), "GKHOST-NOPE");
    assert!(!lock.exists(), "the lock outlived a refused release");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (I) A PLANTED WRITE TARGET IS NEVER WRITTEN THROUGH
//
// The ECC security review for §10D found the atomic write's companion `<ledger>.tmp` was created
// with `File::create` and never validated, so anything that could write inside `.projectops` could
// plant a link there and redirect the Host's write. These are the proofs that it cannot, and they
// use `std::fs` only — no process is spawned to create a link.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A file the attacker wants the Host to overwrite, and its untouched contents.
const VICTIM: &str = "a file the Host has no business writing\n";

#[test]
fn a_hard_link_planted_at_the_companion_path_is_not_written_through() {
    // A HARD LINK NEEDS NO PRIVILEGE AT ALL on NTFS, so this is the variant that matters.
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let victim = scratch.path().join("victim.txt");
    fs::write(&victim, VICTIM).unwrap();
    let pending = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json.tmp");
    if fs::hard_link(&victim, &pending).is_err() {
        println!("SKIPPED: this filesystem refused to create a hard link");
        return;
    }

    admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).expect("admitted");

    assert_eq!(
        fs::read_to_string(&victim).unwrap(),
        VICTIM,
        "the Host wrote the ledger through a planted hard link"
    );
    assert!(scratch.document().find("GKHOST-0001").is_some());
}

#[test]
fn a_symlink_planted_at_the_companion_path_is_not_written_through() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let victim = scratch.path().join("victim.txt");
    fs::write(&victim, VICTIM).unwrap();
    let pending = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json.tmp");
    if !link_to(&victim, &pending) {
        println!("SKIPPED: this account may not create symlinks");
        return;
    }

    // A SYMLINK IS VISIBLE TO `symlink_metadata`, so this one never reaches the write at all: the
    // path check refuses it outright. The hard link above is the case that cannot be seen that way -
    // a hard link IS a regular file - and there it is `remove` + `create_new` that protects the
    // victim. Two different defences, and the ledger needs both.
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::PathNotRegular
    );

    assert_eq!(
        fs::read_to_string(&victim).unwrap(),
        VICTIM,
        "the Host wrote the ledger through a planted symlink"
    );
    assert!(
        scratch.ledger_text().is_empty(),
        "a refused admission wrote a ledger"
    );
    // AND THE LEDGER PATH IS NOT A LINK EITHER: nothing was renamed onto it.
    let ledger = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    assert!(
        fs::symlink_metadata(&ledger).is_err(),
        "the canonical ledger path was created by a refused admission"
    );
}

#[test]
fn a_symlink_at_the_ledger_itself_is_refused_rather_than_followed() {
    let scratch = Scratch::new().with_hard_stop(5_000_000);
    let elsewhere = scratch.path().join("elsewhere.json");
    fs::write(&elsewhere, "{\"schemaVersion\":\"1.0.0\",\"entries\":[]}\n").unwrap();
    let ledger = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    if !link_to(&elsewhere, &ledger) {
        println!("SKIPPED: this account may not create symlinks");
        return;
    }
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", Some(10), u64::MAX)).unwrap_err(),
        LedgerRefusal::PathNotRegular
    );
}

/// Create a file symlink, or report that this account may not.
///
/// Windows needs `SeCreateSymbolicLinkPrivilege` or Developer Mode for this, so the tests that use
/// it skip loudly rather than pass silently on a machine where the attack cannot even be staged.
fn link_to(target: &Path, link: &Path) -> bool {
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
}
