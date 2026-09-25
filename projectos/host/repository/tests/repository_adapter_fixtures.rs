//! Process-boundary defenses of the adapter runner, proven deterministically with a TEST-ONLY fake Git
//! executable (`pos-git-fixture`) instead of a real repository: a hung command is KILLED at the
//! timeout, an over-long stdout is REFUSED (never truncated-and-trusted), and the credential / pager /
//! editor / system-config hardening environment is actually applied to the child. Requires the
//! `test-fixtures` feature (which builds the fake executable); a production graph never builds it.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::PathBuf;
use std::time::Duration;

use projectos_host_repository::{
    CommitId, CommittedFileReader, CommittedRevision, GitCommand, GitRunner, RepoAdapterError,
    RepositoryAdapterConfig,
};

/// The absolute path to the compiled fake-Git fixture (provided by Cargo for the gated `[[bin]]`).
fn fixture_exe() -> &'static str {
    env!("CARGO_BIN_EXE_pos-git-fixture")
}

/// A directory of this test's own, holding the file that steers the fixture. The runner clears the
/// inherited environment, so a variable set here would never reach the child.
fn temp_root() -> PathBuf {
    let d = std::env::temp_dir().join(format!("pos-git-fixture-{}", std::process::id()));
    std::fs::create_dir_all(&d).expect("fixture root");
    d
}

/// Variables the parent plants to prove the child inherits none of them.
const INHERITED: &[&str] = &[
    "POS_INHERITED_CANARY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_PARAMETERS",
    "GIT_REPLACE_REF_BASE",
    "GIT_EXTERNAL_DIFF",
];

fn set_mode(root: &std::path::Path, mode: &str) {
    std::fs::write(root.join("pos-fixture-mode.txt"), mode).expect("fixture mode file");
}

// All three run sequentially in ONE test over ONE steering file, so no two modes are ever live at once.
#[test]
fn adapter_runner_enforces_timeout_overflow_and_env_hardening() {
    let root = temp_root();
    let cmd = GitCommand::IsInsideWorkTree;

    // ---- TIMEOUT (M16): a hung command is killed and refused, not awaited forever. ----
    set_mode(&root, "timeout");
    let runner = GitRunner::with_exe(fixture_exe()).with_timeout(Duration::from_millis(200));
    match runner.run(&root, &cmd) {
        Err(RepoAdapterError::CommandTimeout) => {}
        Err(e) => panic!("expected CommandTimeout, got {e:?}"),
        Ok(_) => panic!("expected CommandTimeout, got Ok"),
    }

    // ---- OVERFLOW: stdout beyond MAX_STDOUT is refused (never truncated-and-trusted). ----
    set_mode(&root, "overflow");
    let runner = GitRunner::with_exe(fixture_exe());
    match runner.run(&root, &cmd) {
        Err(RepoAdapterError::OutputOverflow) => {}
        Err(e) => panic!("expected OutputOverflow, got {e:?}"),
        Ok(_) => panic!("expected OutputOverflow, got Ok"),
    }

    // ---- ENV HARDENING (prompt/pager/editor/system-config resistance): applied to the child. ----
    // NOTHING GIT-FACING IS INHERITED. Every one of these would re-point a read if it arrived; the
    // fixture exits 4 if it sees any of them.
    for name in INHERITED {
        std::env::set_var(name, "planted-by-the-parent");
    }
    set_mode(&root, "assert_env");
    let runner = GitRunner::with_exe(fixture_exe());
    let out = runner.run(&root, &cmd).expect("assert_env fixture runs");
    assert_eq!(
        out.code,
        Some(0),
        "fixture exits 3 if a hardening variable is wrong and 4 if an inherited one arrived"
    );
    assert_eq!(String::from_utf8_lossy(&out.stdout), "HARDENED");

    for name in INHERITED {
        std::env::remove_var(name);
    }

    // ---- A FAILED TREE DIFFERENCE IS A REFUSAL, NEVER "NOTHING CHANGED". ----
    // The fixture proves the root out and answers every ancestry question "yes", then fails the
    // difference with no output. An empty difference here would tell a reviewer a candidate changed
    // nothing because Git could not answer.
    set_mode(&root, "diff_tree_fails");
    let cfg = RepositoryAdapterConfig::new(fixture_exe(), root.to_str().unwrap()).expect("config");
    let candidate = CommitId::parse(&"d".repeat(40)).unwrap();
    let reader =
        CommittedFileReader::open(&cfg, CommittedRevision::Commit(candidate)).expect("open");
    assert_eq!(
        reader
            .changes_since(&CommitId::parse(&"b".repeat(40)).unwrap())
            .unwrap_err(),
        RepoAdapterError::UnexpectedExit
    );

    let _ = std::fs::remove_dir_all(&root);
}
