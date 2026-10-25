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
//! ## Skipping is loud, not silent
//!
//! A checkout with no `node` on the PATH, or with the agent not built, cannot run these. They print
//! why and pass, exactly as `packaged-manifest-generator`'s node-dependent proof does — but the skip
//! is printed, so a run that proved nothing does not look like a run that proved everything.

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

impl Harness {
    fn available() -> Option<Self> {
        let driver = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("canonical_driver.mjs");
        match (node_available(), agent_dist(), driver.is_file()) {
            (true, Some(dist), true) => Some(Self { dist, driver }),
            (false, _, _) => {
                println!("SKIPPED: node is not on the PATH, so the canonical implementation cannot be run");
                None
            }
            (_, None, _) => {
                println!(
                    "SKIPPED: projectos/agent/dist is not built (npm ci && npm run build in projectos/core then projectos/agent)"
                );
                None
            }
            (_, _, false) => {
                println!("SKIPPED: the canonical driver script is missing");
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
        self.run(&[
            "admit",
            &root.display().to_string(),
            id,
            "projectos",
            "PHASE-ONE",
            "gpt-5.6-terra",
            &estimate.to_string(),
            SEPTEMBER_ISO,
            &hard_stop.to_string(),
            "0",
        ])
    }
}

/// A disposable governed project root.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(hard_stop: u64) -> Self {
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
                r#"{{"schemaVersion":"1.0.0","enabled":true,"budget":{{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":0,"hardStopAtMicroUsd":{hard_stop},"autoRecharge":false}},"budgetRaiseAuthorities":[]}}"#
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
    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, u64::MAX)).expect("host admitted");

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

    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, u64::MAX)).expect("admitted");
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

    admit_spend(by_host.path(), &ask("GKHOST-0001", 1_000, u64::MAX)).expect("admitted");
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
        admit_spend(scratch.path(), &ask("GKHOST-0002", 600, u64::MAX)).unwrap_err(),
        LedgerRefusal::HardStopExceeded
    );

    // The Host goes first; the agent is refused by the Host's reservation.
    let scratch = Scratch::new(1_000);
    admit_spend(scratch.path(), &ask("GKHOST-0001", 600, u64::MAX)).expect("host admitted");
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
    let next = admit_spend(scratch.path(), &ask("GKHOST-0002", 100, u64::MAX)).expect("fits");
    assert_eq!(next.spend_snapshot_micro_usd(), 900);
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0003", 1, u64::MAX)).unwrap_err(),
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
        admit_spend(&root, &ask("GKHOST-0001", 10, u64::MAX)).unwrap_err(),
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
            admit_spend(host_root.path(), &ask(id, *cost, u64::MAX)).is_err(),
            "{name}: the Host admitted what the agent refused"
        );
    }

    // A ledger the canonical implementation reads as EMPTY because it cannot parse it — the one case
    // where the canonical answer is the permissive one. The Host must refuse.
    let scratch = Scratch::new(1_000);
    fs::write(
        scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json"),
        "{ this is not json",
    )
    .unwrap();
    let answer = harness.admit(scratch.path(), "GKREQ-0001", 900, 1_000);
    assert!(
        answer.contains("\"allowed\":true"),
        "the canonical implementation changed its reading of a corrupt ledger: {answer}"
    );
    // Re-corrupt it: the canonical admission just rewrote the file as a valid one.
    fs::write(
        scratch
            .path()
            .join(".projectops")
            .join("gatekeeper-ledger.json"),
        "{ this is not json",
    )
    .unwrap();
    assert_eq!(
        admit_spend(scratch.path(), &ask("GKHOST-0001", 900, u64::MAX)).unwrap_err(),
        LedgerRefusal::LedgerMalformed,
        "the Host read a corrupt ledger as an open budget"
    );
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
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "auto-recharge on",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"autoRecharge":true},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "raised without an owner decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "raised with a wrongly scoped decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"plan-approval"}]}"#,
        ),
        (
            "raised with the right decision",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]}"#,
        ),
        (
            // THE ORDERING CASE, AND IT IS THE ONE THAT CAUGHT A WRONG READING OF "CANONICAL" TWICE.
            // Production filters the authorities by scope BEFORE the canonical `find` runs, so an
            // entry carrying both the id and the scope authorises the raise wherever it sits. What
            // this case is really for is that both implementations answer the SAME way — whichever
            // way that is — for a list the obvious readings disagree about.
            "the same decision id twice, wrongly scoped first",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"plan-approval"},{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]}"#,
        ),
        (
            "the same decision id twice, correctly scoped first",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"},"budgetRaiseAuthorities":[{"decisionId":"D1","scope":"gatekeeper-budget-raise"},{"decisionId":"D1","scope":"plan-approval"}]}"#,
        ),
        (
            "a warning above the hard stop",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":4000000,"hardStopAtMicroUsd":3000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "no hard stop at all",
            r#"{"schemaVersion":"1.0.0","enabled":true,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
        ),
        (
            "not enabled",
            r#"{"schemaVersion":"1.0.0","enabled":false,"budget":{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"autoRecharge":false},"budgetRaiseAuthorities":[]}"#,
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
