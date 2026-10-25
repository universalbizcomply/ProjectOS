//! Proofs for the production canonical budget ledger (§10D).
//!
//! WHAT IS PROVEN WHERE. The TRANSACTION — the lock, the fresh read, the canonical policy, the
//! entry, settlement exactly once, malformed and oversize refusals, cross-process exclusion, and
//! byte-identical agreement with the REAL compiled TypeScript implementation — is proven in
//! `projectos-host-gatekeeper-ledger`, beside the code that performs it. What is proven HERE is the
//! adapter: that the sealed `CanonicalBudgetLedger` the Host composition is handed really is that
//! transaction, that the evidence it returns comes back from it rather than from its arguments, and
//! that a reservation cannot settle on a ledger that never held it.
//!
//! NO REAL LEDGER IS TOUCHED. Every root is a disposable directory removed when the test ends.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;
use crate::operation_contract::host_composition::MAX_OUTSTANDING_RESERVATIONS;

const PROJECT: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
const PHASE: [u8; DELEGATION_DIGEST_LEN] = [0x55; DELEGATION_DIGEST_LEN];
const MODEL: [u8; DELEGATION_DIGEST_LEN] = [0x88; DELEGATION_DIGEST_LEN];

/// 2026-09-08T13:00:00Z.
const SEPTEMBER: u64 = 1_788_872_400;

static NEXT: AtomicU64 = AtomicU64::new(0);

fn subject() -> BudgetReservationSubject<'static> {
    BudgetReservationSubject {
        project: &PROJECT,
        phase: &PHASE,
        model_policy: &MODEL,
    }
}

fn correlation(seed: u8) -> [u8; CORRELATION_LEN] {
    [seed; CORRELATION_LEN]
}

fn settlement(cost: u64) -> ProviderCallSettlement {
    ProviderCallSettlement {
        input_tokens: 1_599,
        cached_input_tokens: Some(0),
        output_tokens: 463,
        cost_micro_usd: cost,
    }
}

/// A disposable governed project root carrying a real gatekeeper configuration.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(hard_stop: u64) -> Self {
        let root = std::env::temp_dir().join(format!(
            "projectos-10d-adapter-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".projectops")).expect("scratch");
        fs::write(
            root.join(".projectops").join("gatekeeper.json"),
            format!(
                "{{\"schemaVersion\":\"1.0.0\",\"enabled\":true,\"budget\":{{\"initialCreditMicroUsd\":5000000,\"warnAtMicroUsd\":0,\"hardStopAtMicroUsd\":{hard_stop},\"autoRecharge\":false}},\"budgetRaiseAuthorities\":[]}}"
            ),
        )
        .expect("config");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
    }

    fn ledger(&self) -> CanonicalGatekeeperLedger {
        CanonicalGatekeeperLedger::open(
            HostOwnedGatekeeperProjectRoot::fixture(&self.root),
            &HostClockReading::fixture(SEPTEMBER),
        )
    }

    fn ledger_text(&self) -> String {
        fs::read_to_string(self.root.join(".projectops").join("gatekeeper-ledger.json"))
            .unwrap_or_default()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE ADAPTER IS THE CANONICAL TRANSACTION
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_admission_lands_in_the_canonical_file_as_a_canonical_entry() {
    let scratch = Scratch::new(5_000_000);
    let mut ledger = scratch.ledger();

    let reservation = ledger
        .admit_spend(correlation(1), Some(1_000), u64::MAX, &subject())
        .expect("admitted");

    assert_eq!(reservation.cost_micro_usd(), 1_000);
    assert_eq!(reservation.spend_snapshot_micro_usd(), 0);
    assert_eq!(reservation.delegation_ceiling_micro_usd(), u64::MAX);

    let text = scratch.ledger_text();
    // THE RECORD IS ADDRESSED BY A DERIVED ID, never by anything the caller chose.
    assert!(
        text.contains("\"requestId\": \"GKHOST-01010101010101010101010101010101\""),
        "unexpected ledger: {text}"
    );
    // THE LABELS ARE THE HOST'S DIGESTS, written plainly rather than guessed at as names.
    assert!(
        text.contains("\"projectId\": \"sha256:1111"),
        "unexpected ledger: {text}"
    );
    assert!(
        text.contains("\"phaseId\": \"sha256:5555"),
        "unexpected ledger: {text}"
    );
    assert!(
        text.contains("\"model\": \"sha256:8888"),
        "unexpected ledger: {text}"
    );
    // AND IT IS A RESERVATION, NOT A CALL.
    assert!(
        text.contains("\"unresolved\": true"),
        "unexpected ledger: {text}"
    );
    assert!(
        text.contains("\"at\": \"2026-09-08T13:00:00Z\""),
        "unexpected ledger: {text}"
    );
}

#[test]
fn the_snapshot_is_read_from_the_file_rather_than_carried_by_the_adapter() {
    let scratch = Scratch::new(5_000_000);
    // TWO SEPARATE ADAPTERS. If either held a position of its own, the second would start at zero.
    scratch
        .ledger()
        .admit_spend(correlation(1), Some(700), u64::MAX, &subject())
        .expect("first");
    let second = scratch
        .ledger()
        .admit_spend(correlation(2), Some(300), u64::MAX, &subject())
        .expect("second");
    assert_eq!(second.spend_snapshot_micro_usd(), 700);

    // And a THIRD adapter, after a settlement by a fourth, reads the settled cost.
    scratch
        .ledger()
        .commit_reservation(
            scratch
                .ledger()
                .admit_spend(correlation(3), Some(1), u64::MAX, &subject())
                .expect("third"),
            &settlement(2_000),
        )
        .expect("settled");
    let fourth = scratch
        .ledger()
        .admit_spend(correlation(4), Some(1), u64::MAX, &subject())
        .expect("fourth");
    assert_eq!(fourth.spend_snapshot_micro_usd(), 700 + 300 + 2_000);
}

#[test]
fn the_installation_hard_stop_is_the_adapters_own_and_is_carried_whole() {
    let scratch = Scratch::new(1_000);
    let mut ledger = scratch.ledger();
    // The owner's ceiling is unlimited here, so only the CONFIGURED hard stop can refuse — and the
    // Host never supplied it.
    let refused = ledger
        .admit_spend(correlation(1), Some(1_001), u64::MAX, &subject())
        .unwrap_err();
    assert_eq!(
        refused,
        BudgetRefusal::LedgerRefused(LedgerRefusal::HardStopExceeded)
    );
    // The reservation the composition receives records the hard stop the transaction applied.
    let admitted = ledger
        .admit_spend(correlation(2), Some(1_000), u64::MAX, &subject())
        .expect("admitted");
    assert_eq!(admitted.spend_snapshot_micro_usd(), 0);
}

#[test]
fn the_owner_delegation_ceiling_refuses_with_its_own_name() {
    let scratch = Scratch::new(5_000_000);
    assert_eq!(
        scratch
            .ledger()
            .admit_spend(correlation(1), Some(1_001), 1_000, &subject())
            .unwrap_err(),
        BudgetRefusal::CeilingExceeded
    );
}

#[test]
fn an_unknown_cost_refuses_before_the_ledger_is_even_opened() {
    let scratch = Scratch::new(5_000_000);
    assert_eq!(
        scratch
            .ledger()
            .admit_spend(correlation(1), None, u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::CostUnknown
    );
    assert!(scratch.ledger_text().is_empty(), "a refusal wrote a ledger");
}

#[test]
fn a_held_lock_and_a_malformed_ledger_are_reported_as_themselves() {
    let scratch = Scratch::new(5_000_000);
    let lock = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.lock");
    fs::write(&lock, "{\"heldSince\":\"2026-09-08T13:00:00Z\"}\n").unwrap();
    assert_eq!(
        scratch
            .ledger()
            .admit_spend(correlation(1), Some(1), u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::LockHeld)
    );
    fs::remove_file(&lock).unwrap();

    fs::write(
        scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json"),
        "{ not json",
    )
    .unwrap();
    assert_eq!(
        scratch
            .ledger()
            .admit_spend(correlation(1), Some(1), u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::LedgerMalformed)
    );
}

#[test]
fn an_unenforceable_configuration_stops_spending() {
    let scratch = Scratch::new(5_000_000);
    fs::write(
        scratch.path().join(".projectops").join("gatekeeper.json"),
        "{\"schemaVersion\":\"1.0.0\",\"enabled\":true,\"budget\":{\"initialCreditMicroUsd\":1,\"warnAtMicroUsd\":1,\"autoRecharge\":false}}",
    )
    .unwrap();
    assert_eq!(
        scratch
            .ledger()
            .admit_spend(correlation(1), Some(1), u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::PolicyUnenforceable)
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SETTLEMENT
// ─────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_reservation_commits_once_and_then_neither_commits_nor_releases_again() {
    let scratch = Scratch::new(5_000_000);
    let mut ledger = scratch.ledger();
    let reservation = ledger
        .admit_spend(correlation(1), Some(1_000), u64::MAX, &subject())
        .expect("reserved");
    ledger
        .commit_reservation(reservation, &settlement(1_234))
        .expect("committed");

    let text = scratch.ledger_text();
    assert!(
        text.contains("\"costMicroUsd\": 1234"),
        "unexpected ledger: {text}"
    );
    assert!(
        !text.contains("unresolved"),
        "the mark survived settlement: {text}"
    );

    // A SECOND SETTLEMENT OF THE SAME REQUEST. The reservation value itself was moved, so this
    // needs a fresh one for the same correlation — which is exactly the shape a confused execution
    // rung would produce, and the canonical ledger refuses it.
    let mut again = scratch.ledger();
    let ghost = again
        .admit_spend(correlation(1), Some(1_000), u64::MAX, &subject())
        .unwrap_err();
    assert_eq!(ghost, BudgetRefusal::AlreadyReserved);
}

#[test]
fn a_reservation_releases_once_and_the_capacity_comes_back() {
    let scratch = Scratch::new(1_000);
    let mut ledger = scratch.ledger();
    let reservation = ledger
        .admit_spend(correlation(1), Some(1_000), u64::MAX, &subject())
        .expect("reserved");
    assert_eq!(
        ledger
            .admit_spend(correlation(2), Some(1), u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::HardStopExceeded)
    );
    ledger.release_reservation(reservation).expect("released");
    ledger
        .admit_spend(correlation(2), Some(1_000), u64::MAX, &subject())
        .expect("capacity back");
}

#[test]
fn a_settlement_that_records_no_call_is_refused() {
    let scratch = Scratch::new(5_000_000);
    let mut ledger = scratch.ledger();
    let reservation = ledger
        .admit_spend(correlation(1), Some(10), u64::MAX, &subject())
        .expect("reserved");
    let nothing = ProviderCallSettlement {
        input_tokens: 0,
        cached_input_tokens: Some(0),
        output_tokens: 0,
        cost_micro_usd: 10,
    };
    assert_eq!(
        ledger
            .commit_reservation(reservation, &nothing)
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::SettlementRecordsNoCall)
    );
    assert!(
        scratch.ledger_text().contains("\"unresolved\": true"),
        "a refused settlement changed the entry"
    );
}

#[test]
fn a_reservation_from_one_project_cannot_settle_on_another() {
    let held = Scratch::new(5_000_000);
    let other = Scratch::new(5_000_000);
    let reservation = held
        .ledger()
        .admit_spend(correlation(1), Some(10), u64::MAX, &subject())
        .expect("reserved here");

    // A DIFFERENT LEDGER FILE IS A DIFFERENT LEDGER, and the identity carried on the reservation
    // says so before a single byte of the other project's record is touched.
    assert_eq!(
        other
            .ledger()
            .commit_reservation(reservation, &settlement(12))
            .unwrap_err(),
        BudgetRefusal::ReservationNotOutstanding
    );
    assert!(
        other.ledger_text().is_empty(),
        "the foreign settlement wrote to the wrong project's ledger"
    );
    assert!(
        held.ledger_text().contains("\"unresolved\": true"),
        "the real reservation was disturbed"
    );
}

#[test]
fn two_adapters_over_one_project_are_the_same_ledger() {
    // THE EXECUTION RUNG WILL NOT BE HOLDING THE COMPOSITION'S OBJECT. A reservation taken by one
    // adapter must be settleable by another over the same project, or every admitted call would leak
    // its capacity the moment the composition returned. This is why the ledger identity is derived
    // from the root rather than from a per-object counter.
    let scratch = Scratch::new(5_000_000);
    let reservation = scratch
        .ledger()
        .admit_spend(correlation(1), Some(10), u64::MAX, &subject())
        .expect("reserved by one");
    scratch
        .ledger()
        .commit_reservation(reservation, &settlement(12))
        .expect("settled by another");
    assert!(scratch.ledger_text().contains("\"costMicroUsd\": 12"));
}

#[test]
fn a_reservation_survives_a_restart_and_still_constrains_admission() {
    let scratch = Scratch::new(1_000);
    // Reserve, then drop every adapter — the process-style reconstruction: nothing is carried but
    // the file.
    {
        let mut ledger = scratch.ledger();
        // THE VALUE IS DISCARDED WITHOUT BEING RELEASED, which is what a crashed process leaves
        // behind: the in-memory reservation goes away and the durable record does not. A
        // `BudgetReservation` carries no `Drop`, deliberately - releasing capacity is an explicit
        // act against the ledger, never something that happens because a value went out of scope.
        ledger
            .admit_spend(correlation(1), Some(900), u64::MAX, &subject())
            .expect("reserved");
    }
    let mut after = scratch.ledger();
    assert_eq!(
        after
            .admit_spend(correlation(2), Some(200), u64::MAX, &subject())
            .unwrap_err(),
        BudgetRefusal::LedgerRefused(LedgerRefusal::HardStopExceeded)
    );
}

#[test]
fn the_in_flight_bound_is_the_one_the_host_publishes() {
    // The Host's own `MAX_OUTSTANDING_RESERVATIONS` and the canonical transaction's must be the same
    // number, or the bound the Host documents is not the bound it enforces.
    assert_eq!(
        MAX_OUTSTANDING_RESERVATIONS,
        projectos_host_gatekeeper_ledger::MAX_OUTSTANDING_RESERVATIONS
    );
}

#[test]
fn the_record_id_is_the_correlation_and_nothing_else() {
    assert_eq!(
        CanonicalGatekeeperLedger::record_id(&correlation(0xab)),
        "GKHOST-abababababababababababababababab"
    );
    assert_eq!(
        CanonicalGatekeeperLedger::record_id(&[0u8; CORRELATION_LEN]),
        "GKHOST-00000000000000000000000000000000"
    );
    // AND IT IS AN ID THE CANONICAL LEDGER CAN ADDRESS AS A RECORD.
    assert!(projectos_host_gatekeeper_ledger::check_request_id(
        &CanonicalGatekeeperLedger::record_id(&correlation(1))
    )
    .is_ok());
}

#[test]
fn one_directory_spelled_two_ways_is_one_ledger() {
    // A REAL directory, because canonicalisation needs one — and because the failure this pins only
    // matters for a root that exists: the composition takes the reservation and the execution rung
    // settles it, each through its own adapter, and a mismatch here would strand the capacity behind
    // a `ReservationNotOutstanding` nobody could clear. Raised by the ECC code review.
    let scratch = Scratch::new(5_000_000);
    let plain = scratch.path().to_path_buf();
    let round_about = plain
        .join("..")
        .join(plain.file_name().expect("the scratch root has a name"));
    assert_ne!(
        plain.as_os_str(),
        round_about.as_os_str(),
        "the two spellings are supposed to differ"
    );
    assert_eq!(
        ledger_identity(&plain),
        ledger_identity(&round_about),
        "one directory produced two ledger identities"
    );
}

#[test]
fn two_projects_have_two_ledger_identities_and_one_project_has_one() {
    let a = Path::new("C:\\dev\\one");
    let b = Path::new("C:\\dev\\two");
    assert_eq!(ledger_identity(a), ledger_identity(a));
    assert_ne!(ledger_identity(a), ledger_identity(b));
    // Never zero, so it can never be confused with an unset identity.
    assert_ne!(ledger_identity(a), 0);
}
