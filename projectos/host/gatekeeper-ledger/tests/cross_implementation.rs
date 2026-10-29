//! ONE LEDGER, TWO CLIENTS — proven by running both.
//!
//! §10D's claim is not that the Host implements a ledger correctly. It is that the Host and the
//! ProjectOS agent are two clients of ONE canonical transaction over ONE file, and that the Host
//! never admits anything the canonical implementation would refuse. A claim about two programs can
//! only be checked by running two programs, so every test here drives the REAL compiled TypeScript —
//! `projectos/agent/dist/loop/gatekeeperConfig.js`, through `tests/canonical_driver.mjs` — against
//! the same disposable ledger this crate writes.
//!
//! ## What it does not do
//!
//! It touches no real ledger: every root is a fresh directory under the system temporary directory,
//! removed when the test ends. It contacts no provider, reads no credential and spends nothing. The
//! only process it starts is `node`, on a script committed beside it, and only when a built agent is
//! present.
//!
//! ## Skipping is loud, not silent — and where proof is required, it is a failure
//!
//! A checkout with no `node` on the PATH, or with the agent not built, cannot run these. On a
//! developer machine they print why and pass, exactly as `packaged-manifest-generator`'s
//! node-dependent proof does — but the skip is printed, so a run that proved nothing does not look
//! like a run that proved everything.
//!
//! WHERE THE PROOF IS REQUIRED, A SKIP IS A FAILURE. With `PROJECTOS_REQUIRE_CROSS=1`, or with `CI`
//! set, a missing `node`, agent build or driver fails every test here with the reason. A green run
//! in a place that is meant to prove the two implementations agree must not be one that never ran
//! the second implementation. Raised by the independent review of the cap change.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_gatekeeper_ledger::{
    admit_spend, commit_reservation, release_reservation, AdmissionRequest, LedgerRefusal,
    SettledProviderCall,
};

/// 2026-09-08T13:00:00Z.
const SEPTEMBER: u64 = 1_788_872_400;
const SEPTEMBER_ISO: &str = "2026-09-08T13:00:00Z";
/// 2026-09-08T23:59:59Z — the last second of SEPTEMBER's UTC day.
const SEPTEMBER_DAY_LAST: (u64, &str) = (SEPTEMBER + 39_599, "2026-09-08T23:59:59Z");
/// 2026-09-09T00:00:00Z — the first second of the next UTC day.
const NEXT_DAY_FIRST: (u64, &str) = (SEPTEMBER + 39_600, "2026-09-09T00:00:00Z");
/// 2026-08-31T23:59:59Z — the last second of the previous month.
const AUGUST_LAST: (u64, &str) = (1_788_220_799, "2026-08-31T23:59:59Z");

/// A per-phase or per-day cap that never binds, so that the month is what a test is about.
///
/// `Number.MAX_SAFE_INTEGER`, not `u64::MAX`: the same figure has to reach both implementations
/// exactly, and the canonical one reads it as a JavaScript number.
const NEVER_BINDS: u64 = 9_007_199_254_740_991;

static NEXT: AtomicU64 = AtomicU64::new(0);

/// Where the compiled agent lives, if it is built.
fn agent_dist() -> Option<PathBuf> {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("agent")
        .join("dist");
    dist.join("loop")
        .join("gatekeeperConfig.js")
        .is_file()
        .then_some(dist)
}

/// Whether node can be started at all.
fn node_available() -> bool {
    Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Everything needed to run a cross-implementation proof, or a printed reason there is not.
struct Harness {
    dist: PathBuf,
    driver: PathBuf,
}

/// Whether this run must prove agreement rather than skip: `PROJECTOS_REQUIRE_CROSS=1`, or `CI` set
/// to anything but empty or `false`.
fn cross_proof_required() -> bool {
    let ci = std::env::var("CI").is_ok_and(|v| !v.is_empty() && !v.eq_ignore_ascii_case("false"));
    ci || std::env::var("PROJECTOS_REQUIRE_CROSS").is_ok_and(|v| v == "1")
}

/// Skip loudly, or — where the proof is required — fail with the same reason.
fn skip_or_fail(reason: &str) {
    assert!(
        !cross_proof_required(),
        "the cross-implementation proof is REQUIRED here (PROJECTOS_REQUIRE_CROSS=1 or CI is set) \
         but cannot run: {reason}"
    );
    println!("SKIPPED: {reason}");
}

impl Harness {
    fn available() -> Option<Self> {
        let driver = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("canonical_driver.mjs");
        match (node_available(), agent_dist(), driver.is_file()) {
            (true, Some(dist), true) => Some(Self { dist, driver }),
            (false, _, _) => {
                skip_or_fail(
                    "node is not on the PATH, so the canonical implementation cannot be run",
                );
                None
            }
            (_, None, _) => {
                skip_or_fail(
                    "projectos/agent/dist is not built (npm ci && npm run build in projectos/core then projectos/agent)",
                );
                None
            }
            (_, _, false) => {
                skip_or_fail("the canonical driver script is missing");
                None
            }
        }
    }

    /// Run one canonical operation and return its single line of JSON.
    fn run(&self, args: &[&str]) -> String {
        let output = Command::new("node")
            .arg(&self.driver)
            .arg(&self.dist)
            .args(args)
            .output()
            .expect("node runs");
        assert!(
            output.status.success(),
            "the canonical implementation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn admit(&self, root: &Path, id: &str, estimate: u64, hard_stop: u64) -> String {
        self.admit_under(
            root,
            &Question {
                id,
                estimate,
                ..Question::default()
            },
            Caps::month(hard_stop),
        )
    }

    /// The canonical admission of one question, under the four-field policy.
    fn admit_under(&self, root: &Path, question: &Question<'_>, caps: Caps) -> String {
        self.run(&[
            "admit",
            &root.display().to_string(),
            question.id,
            question.project,
            question.phase,
            "gpt-5.6-terra",
            &question.estimate.to_string(),
            question.at.1,
            &caps.month.to_string(),
            "0",
            &caps.phase.to_string(),
            &caps.day.to_string(),
        ])
    }
}

/// The installation's three stops, as both implementations are given them.
#[derive(Debug, Clone, Copy)]
struct Caps {
    month: u64,
    phase: u64,
    day: u64,
}

impl Caps {
    /// A month hard stop, with per-phase and per-day caps that never bind.
    fn month(month: u64) -> Self {
        Self {
            month,
            phase: NEVER_BINDS,
            day: NEVER_BINDS,
        }
    }
}

/// One question, put identically to both implementations.
#[derive(Debug, Clone, Copy)]
struct Question<'a> {
    id: &'a str,
    project: &'a str,
    phase: &'a str,
    estimate: u64,
    /// The same instant, as the Host's epoch seconds and as the agent's ISO string.
    at: (u64, &'a str),
}

impl Default for Question<'_> {
    fn default() -> Self {
        Self {
            id: "GKHOST-0001",
            project: "projectos",
            phase: "PHASE-ONE",
            estimate: 0,
            at: (SEPTEMBER, SEPTEMBER_ISO),
        }
    }
}

impl Question<'_> {
    fn as_host(&self) -> AdmissionRequest<'_> {
        AdmissionRequest {
            request_id: self.id,
            project_id: self.project,
            phase_id: self.phase,
            model: "gpt-5.6-terra",
            cost_micro_usd: Some(self.estimate),
            delegation_ceiling_micro_usd: NEVER_BINDS,
            at_epoch_s: self.at.0,
        }
    }
}

/// A disposable governed project root.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(hard_stop: u64) -> Self {
        Self::with_caps(Caps::month(hard_stop))
    }

    fn with_caps(caps: Caps) -> Self {
        let Caps {
            month: hard_stop,
            phase,
            day,
        } = caps;
        let root = std::env::temp_dir().join(format!(
            "projectos-10d-x-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".projectops")).expect("scratch");
        fs::write(
            root.join(".projectops").join("gatekeeper.json"),
            format!(
                r#"{{"schemaVersion":"1.0.0","enabled":true,"budget":{{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":0,"hardStopAtMicroUsd":{hard_stop},"phaseHardStopAtMicroUsd":{phase},"dayHardStopAtMicroUsd":{day},"autoRecharge":false}},"budgetRaiseAuthorities":[]}}"#
            ),
        )
        .expect("config");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
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

fn ask<'a>(id: &'a str, cost: u64, ceiling: u64) -> AdmissionRequest<'a> {
    AdmissionRequest {
        request_id: id,
        project_id: "projectos",
        phase_id: "PHASE-ONE",
        model: "gpt-5.6-terra",
        cost_micro_usd: Some(cost),
        delegation_ceiling_micro_usd: ceiling,
        at_epoch_s: SEPTEMBER,
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// THE BYTES ARE THE SAME BYTES. Same inputs, two implementations, one file format.
///
/// If this ever fails, the Host has started writing a document the agent did not write — which is
/// the first symptom of a second ledger, whatever the code says about there being one.
#[test]
fn the_host_and_the_agent_write_byte_identical_ledgers() {
    let Some(harness) = Harness::available() else {
        return;
    };
    let by_node = Scratch::new(5_000_000);
    let by_host = Scratch::new(5_000_000);

    let answer = harness.admit(by_node.path(), "GKHOST-0001", 1_000, 5_000_000);
    assert!(
        answer.contains("\"allowed\":true"),
        "canonical refused: {answer}"
    );
    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, NEVER_BINDS)).expect("host admitted");

    assert_eq!(
        by_host.ledger_text(),
        by_node.ledger_text(),
        "the Host wrote a different ledger from the one the agent writes"
    );
}

/// A SETTLEMENT WRITTEN BY EITHER SIDE IS THE SAME RECORD.
#[test]
fn the_host_and_the_agent_settle_to_byte_identical_ledgers() {
    let Some(harness) = Harness::available() else {
        return;
    };
    let by_node = Scratch::new(5_000_000);
    let by_host = Scratch::new(5_000_000);

    harness.admit(by_node.path(), "GKHOST-0001", 1_000, 5_000_000);
    harness.run(&[
        "settle",
        &by_node.path().display().to_string(),
        "GKHOST-0001",
        "1599",
        "463",
        "6629",
    ]);

    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, NEVER_BINDS)).expect("admitted");
    commit_reservation(
        by_host.path(),
        "GKHOST-0001",
        &SettledProviderCall {
            input_tokens: 1_599,
            cached_input_tokens: Some(0),
            output_tokens: 463,
            cost_micro_usd: 6_629,
        },
        SEPTEMBER,
    )
    .expect("committed");

    assert_eq!(by_host.ledger_text(), by_node.ledger_text());
}

/// A RELEASE WRITTEN BY EITHER SIDE LEAVES THE SAME RECORD.
#[test]
fn the_host_and_the_agent_release_to_byte_identical_ledgers() {
    let Some(harness) = Harness::available() else {
        return;
    };
    let by_node = Scratch::new(5_000_000);
    let by_host = Scratch::new(5_000_000);

    harness.admit(by_node.path(), "GKHOST-0001", 1_000, 5_000_000);
    harness.run(&[
        "release",
        &by_node.path().display().to_string(),
        "GKHOST-0001",
    ]);

    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, NEVER_BINDS)).expect("admitted");
    release_reservation(by_host.path(), "GKHOST-0001", SEPTEMBER).expect("released");

    assert_eq!(by_host.ledger_text(), by_node.ledger_text());
}

/// NEITHER SIDE CAN SPEND CAPACITY THE OTHER HAS ALREADY TAKEN.
///
/// The hard stop is 1,000 and each request is 600, so exactly one of the two may be admitted — and
/// it must not matter which program goes first.
#[test]
fn a_reservation_taken_by_either_side_constrains_the_other() {
    let Some(harness) = Harness::available() else {
        return;
    };

    // The agent goes first; the Host is refused by the agent's reservation.
    let scratch = Scratch::new(1_000);
    let answer = harness.admit(scratch.path(), "GKREQ-0001", 600, 1_000);
    assert!(
        answer.contains("\"allowed\":true"),
        "canonical refused: {answer}"
    );
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0002", 600, NEVER_BINDS)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );

    // The Host goes first; the agent is refused by the Host's reservation.
    let scratch = Scratch::new(1_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", 600, NEVER_BINDS)).expect("host admitted");
    let answer = harness.admit(scratch.path(), "GKREQ-0002", 600, 1_000);
    assert!(
        answer.contains("\"allowed\":false"),
        "the canonical implementation admitted against the Host's reservation: {answer}"
    );
    assert!(
        answer.contains("hard stop"),
        "refused for the wrong reason: {answer}"
    );
}

/// A SETTLEMENT BY ONE SIDE IS COMMITTED SPEND TO THE OTHER.
#[test]
fn a_settlement_by_either_side_is_read_as_committed_spend_by_the_other() {
    let Some(harness) = Harness::available() else {
        return;
    };
    let scratch = Scratch::new(1_000);

    // The agent reserves 100 and settles at 900 — the real cost was higher than the estimate.
    harness.admit(scratch.path(), "GKREQ-0001", 100, 1_000);
    harness.run(&[
        "settle",
        &scratch.path().display().to_string(),
        "GKREQ-0001",
        "1000",
        "200",
        "900",
    ]);

    // The Host reads the settled cost, not the estimate.
    let next = admit_spend(scratch.path(), &ask("GKHOST-0002", 100, NEVER_BINDS)).expect("fits");
    assert_eq!(next.spend_snapshot_micro_usd(), 900);
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0003", 1, NEVER_BINDS)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );
}

/// THE LOCK EXCLUDES ACROSS PROCESSES AND ACROSS LANGUAGES.
#[test]
fn the_canonical_lock_excludes_the_other_implementation() {
    let Some(harness) = Harness::available() else {
        return;
    };

    // The agent holds the lock; the Host is refused without waiting.
    let scratch = Scratch::new(5_000_000);
    let root = scratch.path().to_path_buf();
    let driver = harness.driver.clone();
    let dist = harness.dist.clone();
    let mut held = Command::new("node")
        .arg(&driver)
        .arg(&dist)
        .arg("holdlock")
        .arg(root.display().to_string())
        .arg("3000")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("node holds the lock");

    let lock = root.join(".projectops").join("gatekeeper-ledger.lock");
    let mut waited = 0;
    while !lock.exists() && waited < 100 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        waited += 1;
    }
    assert!(
        lock.exists(),
        "the canonical implementation never took the lock"
    );
    assert_eq!(
        admit_spend(&root, &ask("GKHOST-0001", 10, NEVER_BINDS)).unwrap_err(),
        LedgerRefusal::LockHeld
    );
    held.wait().expect("node finishes");

    // The Host holds the lock; the agent is refused.
    let scratch = Scratch::new(5_000_000);
    let lock = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.lock");
    fs::write(&lock, "{\"heldSince\":\"2026-09-08T13:00:00Z\"}\n").unwrap();
    let answer = harness.admit(scratch.path(), "GKREQ-0001", 10, 5_000_000);
    assert!(
        answer.contains("\"allowed\":false") && answer.contains("another ProjectOS process"),
        "the canonical implementation ignored the Host's lock: {answer}"
    );
    fs::remove_file(&lock).unwrap();
}

/// THE HOST NEVER ADMITS WHAT THE CANONICAL IMPLEMENTATION REFUSES.
///
/// The whole divergence policy, checked rather than asserted: for each ledger state, whatever the
/// canonical implementation answers, the Host's answer must not be "admitted" unless the canonical
/// one was too.
#[test]
fn the_host_refuses_at_least_everything_the_agent_refuses() {
    let Some(harness) = Harness::available() else {
        return;
    };

    // Cases the canonical implementation refuses, with the Host asked the same question.
    let cases: &[(&str, u64, u64, &str)] = &[
        ("over the hard stop", 1_001, 1_000, "GKHOST-0001"),
        ("exactly one micro-USD over", 1_001, 1_000, "GKHOST-0002"),
    ];
    for (name, cost, hard_stop, id) in cases {
        let node_root = Scratch::new(*hard_stop);
        let host_root = Scratch::new(*hard_stop);
        let answer = harness.admit(node_root.path(), id, *cost, *hard_stop);
        assert!(
            answer.contains("\"allowed\":false"),
            "{name}: canonical admitted"
        );
        assert!(
            admit_spend(host_root.path(), &ask(id, *cost, NEVER_BINDS)).is_err(),
            "{name}: the Host admitted what the agent refused"
        );
    }

    // A ledger that cannot be parsed. This used to be the one case where the canonical answer was
    // the permissive one — `readLedger` read it as EMPTY — and the Host had to refuse on its own. The
    // canonical admission now reads through `readLedgerStrict` and refuses it too (ECC SECURITY H2),
    // so both are asserted: if the canonical reading ever relaxes again, this says so.
    //
    // And entries the canonical strict reader refuses: one whose instant places it in no day or
    // month, one with no project or phase to charge, one whose cost cannot be read.
    let entry = r#"{"requestId":"GKREQ-0009","projectId":"p","phaseId":"f","model":"m","usage":{"inputTokens":0,"outputTokens":0},"costMicroUsd":5,"at":"2026-09-08T13:00:00Z"}"#;
    let ledger = |entry: &str| format!(r#"{{"schemaVersion":"1.0.0","entries":[{entry}]}}"#);
    for (name, text) in [
        ("not JSON", "{ this is not json".to_owned()),
        (
            "an instant that is no instant",
            ledger(&entry.replace("2026-09-08T13:00:00Z", "yesterday")),
        ),
        (
            "an instant the canonical parser refuses",
            ledger(&entry.replace("2026-09-08T13:00:00Z", "2026-13-01T00:00:00Z")),
        ),
        (
            "no project and no phase",
            ledger(&entry.replace(r#""projectId":"p","phaseId":"f","#, "")),
        ),
        (
            "a negative cost",
            ledger(&entry.replace(r#""costMicroUsd":5"#, r#""costMicroUsd":-5"#)),
        ),
        (
            "a cost that is not a number",
            ledger(&entry.replace(r#""costMicroUsd":5"#, r#""costMicroUsd":"5""#)),
        ),
    ] {
        let scratch = Scratch::new(1_000);
        let ledger_path = scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json");
        fs::write(&ledger_path, &text).unwrap();
        let answer = harness.admit(scratch.path(), "GKREQ-0001", 900, 1_000);
        assert!(
            answer.contains("\"allowed\":false"),
            "{name}: the canonical implementation admitted against an unreadable ledger: {answer}"
        );
        assert_eq!(
            fs::read_to_string(&ledger_path).unwrap(),
            text,
            "{name}: the canonical refusal rewrote the ledger"
        );
        assert_eq!(
            admit_spend(scratch.path(), &ask("GKHOST-0001", 900, NEVER_BINDS)).unwrap_err(),
            LedgerRefusal::LedgerMalformed,
            "{name}: the Host read an unreadable ledger as an open budget"
        );
    }

    // THE INDEPENDENT REVIEW'S FLOAT-ROUNDING WITNESS: two entries for projectos/PHASE-ONE at
    // 9007199254740992 and 9007199254740995, an estimate of 2, and a phase cap of 18014398509481989.
    // The canonical admission sums in doubles and refuses; exact `u64` arithmetic used to admit. The
    // Host now refuses any amount past `Number.MAX_SAFE_INTEGER`, so it refuses too.
    let witness = r#"{"schemaVersion":"1.0.0","entries":[{"requestId":"GKREQ-0001","projectId":"projectos","phaseId":"PHASE-ONE","model":"m","usage":{"inputTokens":1,"outputTokens":1},"costMicroUsd":9007199254740992,"at":"2026-09-08T10:00:00.000Z"},{"requestId":"GKREQ-0002","projectId":"projectos","phaseId":"PHASE-ONE","model":"m","usage":{"inputTokens":1,"outputTokens":1},"costMicroUsd":9007199254740995,"at":"2026-09-08T11:00:00.000Z"}]}"#;
    let witness_caps = Caps {
        month: 36_028_797_018_963_968,
        phase: 18_014_398_509_481_989,
        day: 36_028_797_018_963_968,
    };
    let scratch = Scratch::with_caps(witness_caps);
    let ledger_path = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    fs::write(&ledger_path, witness).unwrap();
    let answer = harness.admit_under(
        scratch.path(),
        &Question {
            id: "GKHOST-0003",
            estimate: 2,
            ..Question::default()
        },
        witness_caps,
    );
    assert!(
        answer.contains("\"allowed\":false"),
        "the canonical implementation admitted the float-rounding witness: {answer}"
    );
    assert!(
        admit_spend(scratch.path(), &ask("GKHOST-0003", 2, NEVER_BINDS)).is_err(),
        "the Host admitted the float-rounding witness the agent refused"
    );
    let scratch = Scratch::new(5_000_000);
    let ledger_path = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    fs::write(&ledger_path, witness).unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0003", 2, NEVER_BINDS)).unwrap_err(),
        LedgerRefusal::LedgerMalformed,
        "the witness ledger, under an enforceable policy"
    );

    // THE ONE STRICTER ROW THIS TEST CAN DRIVE: an instant with a numeric offset. The canonical
    // reader converts it to UTC and admits; the Host does not parse, so it refuses — the refusing
    // direction, which is the only direction the divergence policy allows.
    let scratch = Scratch::new(1_000);
    let ledger_path = scratch
        .path()
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    fs::write(
        &ledger_path,
        ledger(&entry.replace("2026-09-08T13:00:00Z", "2026-09-08T14:00:00+01:00")),
    )
    .unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", 900, NEVER_BINDS)).unwrap_err(),
        LedgerRefusal::LedgerMalformed,
    );
    let answer = harness.admit(scratch.path(), "GKREQ-0001", 900, 1_000);
    assert!(
        answer.contains("\"allowed\":true"),
        "the canonical reading of an offset instant changed; revisit the divergence table: {answer}"
    );
}

/// What one implementation answered: admitted, or refused naming these caps (phase, day, month).
#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    Admitted,
    Refused { phase: bool, day: bool, month: bool },
}

/// The canonical answer, read from its reasons. The caps are named by the canonical phrases
/// `authoriseRequestSpend` uses for them.
fn canonical_verdict(answer: &str) -> Verdict {
    if answer.contains("\"allowed\":true") {
        return Verdict::Admitted;
    }
    assert!(
        answer.contains("\"allowed\":false"),
        "not an admission answer: {answer}"
    );
    Verdict::Refused {
        phase: answer.contains("cross the per-phase cap"),
        day: answer.contains("cross the per-day cap"),
        month: answer.contains("cross the hard stop") || answer.contains("reached the hard stop"),
    }
}

/// The Host's answer, in the same terms.
fn host_verdict(
    answer: Result<projectos_host_gatekeeper_ledger::AdmittedReservation, LedgerRefusal>,
) -> Verdict {
    match answer {
        Ok(_) => Verdict::Admitted,
        Err(LedgerRefusal::CapsExceeded(caps)) => Verdict::Refused {
            phase: caps.phase(),
            day: caps.day(),
            month: caps.month(),
        },
        Err(LedgerRefusal::HardStopExceeded) => Verdict::Refused {
            phase: false,
            day: false,
            month: true,
        },
        Err(other) => panic!("the Host refused for a reason no cap gives: {other:?}"),
    }
}

/// THE PER-PHASE AND PER-DAY CAPS ARE ONE RULE IN TWO PROGRAMS (PROJECTOS-KERNEL-COST-CAP1A).
///
/// Each scenario is a history of admissions and one question, run separately through each
/// implementation on its own ledger. Both must reach the same verdict and, when they refuse, name
/// the same caps — so a crossing of the phase cap or the day cap is refused by both, and so is
/// nothing the other admits.
#[test]
fn the_two_implementations_agree_on_the_phase_and_day_caps() {
    let Some(harness) = Harness::available() else {
        return;
    };

    let q = |id, project, phase, estimate, at| Question {
        id,
        project,
        phase,
        estimate,
        at,
    };
    let sept = (SEPTEMBER, SEPTEMBER_ISO);
    let phase_cap = Caps {
        month: 5_000_000,
        phase: 1_000,
        day: NEVER_BINDS,
    };
    let day_cap = Caps {
        month: 5_000_000,
        phase: NEVER_BINDS,
        day: 1_000,
    };
    let all_tight = Caps {
        month: 1_000,
        phase: 1_000,
        day: 1_000,
    };
    let refused = |phase, day, month| Verdict::Refused { phase, day, month };

    let scenarios: Vec<(&str, Caps, Vec<Question<'_>>, Question<'_>, Verdict)> = vec![
        (
            "the phase cap crossed",
            phase_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 600, sept)],
            q("GKHOST-0002", "projectos", "PHASE-ONE", 500, sept),
            refused(true, false, false),
        ),
        (
            "the phase cap reached exactly",
            phase_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 600, sept)],
            q("GKHOST-0002", "projectos", "PHASE-ONE", 400, sept),
            Verdict::Admitted,
        ),
        (
            "another phase of the same project",
            phase_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 900, sept)],
            q("GKHOST-0002", "projectos", "PHASE-TWO", 900, sept),
            Verdict::Admitted,
        ),
        (
            "the same phase name in another project",
            phase_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 900, sept)],
            q("GKHOST-0002", "deadaisle", "PHASE-ONE", 900, sept),
            Verdict::Admitted,
        ),
        (
            "the phase cap carried across a month boundary",
            phase_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 900, AUGUST_LAST)],
            q("GKHOST-0002", "projectos", "PHASE-ONE", 200, sept),
            refused(true, false, false),
        ),
        (
            "the day cap crossed by another project and phase",
            day_cap,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 600, sept)],
            q(
                "GKHOST-0002",
                "deadaisle",
                "PHASE-TWO",
                500,
                SEPTEMBER_DAY_LAST,
            ),
            refused(false, true, false),
        ),
        (
            "the next UTC day starts clean",
            day_cap,
            vec![q(
                "GKREQ-0001",
                "projectos",
                "PHASE-ONE",
                1_000,
                SEPTEMBER_DAY_LAST,
            )],
            q(
                "GKHOST-0002",
                "projectos",
                "PHASE-ONE",
                1_000,
                NEXT_DAY_FIRST,
            ),
            Verdict::Admitted,
        ),
        (
            "every cap crossed at once",
            all_tight,
            vec![q("GKREQ-0001", "projectos", "PHASE-ONE", 500, sept)],
            q("GKHOST-0002", "projectos", "PHASE-ONE", 600, sept),
            refused(true, true, true),
        ),
    ];

    for (name, caps, history, question, expected) in scenarios {
        let node_root = Scratch::with_caps(caps);
        let host_root = Scratch::with_caps(caps);
        // Each implementation builds its own history, so each is also checked admitting it.
        for prior in &history {
            let answer = harness.admit_under(node_root.path(), prior, caps);
            assert!(
                answer.contains("\"allowed\":true"),
                "{name}: canonical history refused: {answer}"
            );
            admit_spend(host_root.path(), &prior.as_host())
                .unwrap_or_else(|e| panic!("{name}: Host history refused: {e}"));
        }
        let canonical = canonical_verdict(&harness.admit_under(node_root.path(), &question, caps));
        let host = host_verdict(admit_spend(host_root.path(), &question.as_host()));
        assert_eq!(canonical, expected, "{name}: the canonical implementation");
        assert_eq!(host, expected, "{name}: the Host");
    }
}

/// THE TWO POLICY READINGS AGREE ABOUT WHICH CONFIGURATIONS ARE ENFORCEABLE.
#[test]
fn the_host_and_the_agent_agree_on_which_budget_policies_are_enforceable() {
    let Some(harness) = Harness::available() else {
        return;
    };

    let cases: &[(&str, &str)] = &[
        (
            "the approved pilot",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "auto-recharge on",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":true},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "raised without an owner decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "raised with a wrongly scoped decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"plan-approval"}]}"#,
        ),
        (
            "raised with the right decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]}"#,
        ),
        (
            // THE ORDERING CASE, AND IT IS THE ONE THAT CAUGHT A WRONG READING OF "CANONICAL" TWICE.
            // Production filters the authorities by scope BEFORE the canonical `find` runs, so an
            // entry carrying both the id and the scope authorises the raise wherever it sits. What
            // this case is really for is that both implementations answer the SAME way — whichever
            // way that is — for a list the obvious readings disagree about.
            "the same decision id twice, wrongly scoped first",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"plan-approval"},{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]}"#,
        ),
        (
            "the same decision id twice, correctly scoped first",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"gatekeeper-budget-raise"},{"decisionId":"D1","scope":"plan-approval"}]}"#,
        ),
        (
            "a warning above the hard stop",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":4000000,"hardStopAtMicroUsd":3000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "no hard stop at all",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "no per-phase cap",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "no per-day cap",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "a per-phase cap written as a string",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":"1500000","dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "a negative per-day cap",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":-1,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "a null per-day cap",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":null,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "the committed ProjectOS budget",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "not enabled",
            r#"{"schemaVersion":"1.0.0","enabled":false,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
    ];

    let scratch = Scratch::new(5_000_000);
    let config = scratch.path().join(".projectops").join("gatekeeper.json");
    for (name, text) in cases {
        fs::write(&config, text).unwrap();
        let answer = harness.run(&["policy", &config.display().to_string()]);
        let canonical_enforceable = answer.contains(r#""problems":[]"#);
        let host_enforceable = projectos_host_gatekeeper_ledger::policy::resolve(text).is_ok();
        assert_eq!(
            host_enforceable, canonical_enforceable,
            "{name}: host says enforceable={host_enforceable}, agent says {answer}"
        );
    }

    // THE ONE STRICTER ROW: a fractional cap. The canonical `usable` accepts any finite figure >= 0;
    // the Host refuses a ceiling it would have to round. Refusing direction only.
    let fractional = r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"phaseHardStopAtMicroUsd":1500000.5,"dayHardStopAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#;
    fs::write(&config, fractional).unwrap();
    let answer = harness.run(&["policy", &config.display().to_string()]);
    assert!(
        answer.contains(r#""problems":[]"#),
        "the canonical reading of a fractional cap changed; revisit the divergence table: {answer}"
    );
    assert!(projectos_host_gatekeeper_ledger::policy::resolve(fractional).is_err());
}

/// THE HOST'S TIMESTAMP IS THE AGENT'S TIMESTAMP, TO THE MONTH THAT DECIDES THE BUDGET.
#[test]
fn the_two_implementations_place_an_instant_in_the_same_month() {
    let Some(harness) = Harness::available() else {
        return;
    };
    // The agent stamps its own entries with `new Date().toISOString()`; the Host renders the same
    // instant with its own calendar arithmetic. A disagreement here would put one month's spend in
    // two different totals, and the hard stop would be applied to neither.
    let output = Command::new("node")
        .arg("-e")
        .arg(
            "const xs=[0,951868799,1788220799,1788220800,4102444799,253402300799];\
             console.log(JSON.stringify(xs.map(s=>new Date(s*1000).toISOString().slice(0,7))))",
        )
        .output()
        .expect("node runs");
    let months = String::from_utf8_lossy(&output.stdout);
    let host: Vec<String> = [
        0u64,
        951_868_799,
        1_788_220_799,
        1_788_220_800,
        4_102_444_799,
        253_402_300_799,
    ]
    .iter()
    .map(|s| {
        projectos_host_gatekeeper_ledger::LedgerInstant::from_epoch_s(*s)
            .expect("in range")
            .month()
            .to_owned()
    })
    .collect();
    assert_eq!(
        months.trim(),
        serde_json_line(&host),
        "the Host and the agent disagree about which month an instant falls in"
    );
    let _ = harness;
}

/// The same JSON array of strings Node prints, without pulling a serialiser into this test.
fn serde_json_line(values: &[String]) -> String {
    let inner: Vec<String> = values.iter().map(|v| format!("\"{v}\"")).collect();
    format!("[{}]", inner.join(","))
}
