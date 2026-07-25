//! Process-boundary defenses of the adapter runner, proven deterministically with a TEST-ONLY fake Git
//! executable (`pos-git-fixture`) instead of a real repository: a hung command is KILLED at the
//! timeout, an over-long stdout is REFUSED (never truncated-and-trusted), and the credential / pager /
//! editor / system-config hardening environment is actually applied to the child. Requires the
//! `test-fixtures` feature (which builds the fake executable); a production graph never builds it.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::PathBuf;
use std::time::Duration;

use projectos_host_repository::{GitCommand, GitRunner, RepoAdapterError};

/// The absolute path to the compiled fake-Git fixture (provided by Cargo for the gated `[[bin]]`).
fn fixture_exe() -> &'static str {
    env!("CARGO_BIN_EXE_pos-git-fixture")
}

fn temp_root() -> PathBuf {
    let d = std::env::temp_dir();
    assert!(d.is_dir());
    d
}

// All three run sequentially in ONE test so the shared-process `POS_FIXTURE_MODE` env var is never set
// concurrently by parallel tests.
#[test]
fn adapter_runner_enforces_timeout_overflow_and_env_hardening() {
    let root = temp_root();
    let cmd = GitCommand::IsInsideWorkTree;

    // ---- TIMEOUT (M16): a hung command is killed and refused, not awaited forever. ----
    std::env::set_var("POS_FIXTURE_MODE", "timeout");
    let runner = GitRunner::with_exe(fixture_exe()).with_timeout(Duration::from_millis(200));
    match runner.run(&root, &cmd) {
        Err(RepoAdapterError::CommandTimeout) => {}
        Err(e) => panic!("expected CommandTimeout, got {e:?}"),
        Ok(_) => panic!("expected CommandTimeout, got Ok"),
    }

    // ---- OVERFLOW: stdout beyond MAX_STDOUT is refused (never truncated-and-trusted). ----
    std::env::set_var("POS_FIXTURE_MODE", "overflow");
    let runner = GitRunner::with_exe(fixture_exe());
    match runner.run(&root, &cmd) {
        Err(RepoAdapterError::OutputOverflow) => {}
        Err(e) => panic!("expected OutputOverflow, got {e:?}"),
        Ok(_) => panic!("expected OutputOverflow, got Ok"),
    }

    // ---- ENV HARDENING (prompt/pager/editor/system-config resistance): applied to the child. ----
    std::env::set_var("POS_FIXTURE_MODE", "assert_env");
    let runner = GitRunner::with_exe(fixture_exe());
    let out = runner.run(&root, &cmd).expect("assert_env fixture runs");
    assert_eq!(
        out.code,
        Some(0),
        "fixture exits non-zero if any hardening env is wrong"
    );
    assert_eq!(String::from_utf8_lossy(&out.stdout), "HARDENED");

    std::env::remove_var("POS_FIXTURE_MODE");
}
