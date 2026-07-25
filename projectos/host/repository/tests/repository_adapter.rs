//! End-to-end proof of the repository adapter over DISPOSABLE local Git repositories only, using ONE
//! VERIFIED ABSOLUTE Git executable (never a PATH search). Test-only helpers create/init/commit/push
//! between temporary repos (fixture setup — never the production allowlist). Zero residue.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_core::{
    verify_repository_baseline, BranchPolicy, DivergencePolicy, ProjectId, RepositoryError,
    RepositoryFreshness, RequiredFreshness, RequiredRepository,
};
use projectos_host_repository::{RepoAdapterError, RepositoryAdapter, RepositoryAdapterConfig};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let d = std::env::temp_dir().join(format!("pos-repo-{}-{tag}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn cleanup(dirs: &[&Path]) {
    for d in dirs {
        let _ = std::fs::remove_dir_all(d);
        assert!(!d.exists(), "disposable repo residue");
    }
}

/// The absolute Git executable resolved once from PATH — the production adapter is then pinned to it.
fn resolve_git() -> String {
    let path = std::env::var_os("PATH").expect("PATH");
    for dir in std::env::split_paths(&path) {
        let cand = dir.join("git.exe");
        if cand.is_file() {
            return cand.to_str().unwrap().to_string();
        }
    }
    panic!("git.exe not found on PATH");
}

/// A production adapter pinned to the verified absolute Git executable and `dir`.
fn adapter(dir: &Path) -> RepositoryAdapter {
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    RepositoryAdapter::new(cfg)
}

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn init_clean(dir: &Path) {
    git(dir, &["init", "-b", "main"]);
    std::fs::write(dir.join("a.txt"), b"hello").unwrap();
    git(dir, &["add", "a.txt"]);
    git(dir, &["commit", "-m", "init"]);
}

fn required_clean(root: &str, commit: &str, branch: &str) -> RequiredRepository {
    RequiredRepository {
        expected_root: root.to_string(),
        expected_project: ProjectId::new("proj").unwrap(),
        expected_commit: commit.to_string(),
        branch_policy: BranchPolicy::Exact(branch.to_string()),
        require_clean: true,
        require_submodules_clean: true,
        divergence_policy: DivergencePolicy::Unrestricted,
        required_freshness: RequiredFreshness::Any,
    }
}

// ---- EXECUTABLE SELECTION (M23 defect fix) ----------------------------------------------------

#[test]
fn a_verified_absolute_git_executable_is_accepted() {
    let d = temp("exe-ok");
    assert!(RepositoryAdapterConfig::new(&resolve_git(), d.to_str().unwrap()).is_ok());
    cleanup(&[&d]);
}

#[test]
fn a_relative_git_is_refused_by_the_production_constructor() {
    // Bare "git" would trigger an uncontrolled PATH search — refused.
    assert_eq!(
        RepositoryAdapterConfig::new("git", "C:\\x").unwrap_err(),
        RepoAdapterError::PathInvalid
    );
    assert_eq!(
        RepositoryAdapterConfig::new(".\\git.exe", "C:\\x").unwrap_err(),
        RepoAdapterError::PathInvalid
    );
}

#[test]
fn a_nonexistent_or_directory_executable_is_refused() {
    assert_eq!(
        RepositoryAdapterConfig::new("C:\\nope\\git.exe", "C:\\x").unwrap_err(),
        RepoAdapterError::PathNotCanonical
    );
    let d = temp("exe-dir");
    assert_eq!(
        RepositoryAdapterConfig::new(d.to_str().unwrap(), "C:\\x").unwrap_err(),
        RepoAdapterError::PathNotCanonical
    );
    cleanup(&[&d]);
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn a_clean_repository_observes_and_verifies() {
    let d = temp("clean");
    init_clean(&d);
    let obs = adapter(&d).observe(1).unwrap();
    assert!(obs.is_worktree);
    assert_eq!(obs.branch.as_deref(), Some("main"));
    assert_eq!((obs.staged, obs.unstaged, obs.untracked), (0, 0, 0));
    let req = required_clean(&obs.canonical_root, &obs.head_oid, "main");
    let baseline = verify_repository_baseline(&obs, &req).unwrap();
    assert!(baseline.is_clean());
    assert_eq!(baseline.commit_oid(), obs.head_oid);
    cleanup(&[&d]);
}

// ---- CLEANLINESS REFUSALS ---------------------------------------------------------------------

#[test]
fn staged_unstaged_untracked_each_refuse() {
    let d = temp("staged");
    init_clean(&d);
    let base = adapter(&d).observe(1).unwrap();
    let req = required_clean(&base.canonical_root, &base.head_oid, "main");
    std::fs::write(d.join("b.txt"), b"x").unwrap();
    git(&d, &["add", "b.txt"]);
    assert_eq!(
        verify_repository_baseline(&adapter(&d).observe(2).unwrap(), &req),
        Err(RepositoryError::StagedChangesPresent)
    );
    cleanup(&[&d]);

    let d = temp("unstaged");
    init_clean(&d);
    let base = adapter(&d).observe(1).unwrap();
    let req = required_clean(&base.canonical_root, &base.head_oid, "main");
    std::fs::write(d.join("a.txt"), b"changed").unwrap();
    assert_eq!(
        verify_repository_baseline(&adapter(&d).observe(2).unwrap(), &req),
        Err(RepositoryError::UnstagedChangesPresent)
    );
    cleanup(&[&d]);

    let d = temp("untracked");
    init_clean(&d);
    let base = adapter(&d).observe(1).unwrap();
    let req = required_clean(&base.canonical_root, &base.head_oid, "main");
    std::fs::write(d.join("c.txt"), b"x").unwrap();
    assert_eq!(
        verify_repository_baseline(&adapter(&d).observe(2).unwrap(), &req),
        Err(RepositoryError::UntrackedFilesPresent)
    );
    cleanup(&[&d]);
}

// ---- BRANCH / COMMIT / DETACHED ---------------------------------------------------------------

#[test]
fn a_wrong_branch_and_wrong_commit_refuse() {
    let d = temp("branch");
    init_clean(&d);
    let obs = adapter(&d).observe(1).unwrap();
    assert_eq!(
        verify_repository_baseline(
            &obs,
            &required_clean(&obs.canonical_root, &obs.head_oid, "other")
        ),
        Err(RepositoryError::BranchMismatch)
    );
    assert_eq!(
        verify_repository_baseline(
            &obs,
            &required_clean(
                &obs.canonical_root,
                "0000000000000000000000000000000000000000",
                "main"
            )
        ),
        Err(RepositoryError::CommitMismatch)
    );
    cleanup(&[&d]);
}

#[test]
fn a_detached_head_is_refused_where_a_branch_is_required() {
    let d = temp("detached");
    init_clean(&d);
    let head = adapter(&d).observe(1).unwrap().head_oid;
    git(&d, &["checkout", "--detach", &head]);
    let obs = adapter(&d).observe(2).unwrap();
    assert!(obs.branch.is_none());
    assert_eq!(
        verify_repository_baseline(
            &obs,
            &required_clean(&obs.canonical_root, &obs.head_oid, "main")
        ),
        Err(RepositoryError::DetachedHeadRefused)
    );
    cleanup(&[&d]);
}

// ---- TRACKING / DIVERGENCE --------------------------------------------------------------------

#[test]
fn a_missing_tracking_ref_is_not_zero_zero() {
    let d = temp("no-track");
    init_clean(&d);
    let obs = adapter(&d).observe(1).unwrap();
    assert!(!obs.tracking_present);
    let mut req = required_clean(&obs.canonical_root, &obs.head_oid, "main");
    req.divergence_policy = DivergencePolicy::ReconciledZero;
    assert_eq!(
        verify_repository_baseline(&obs, &req),
        Err(RepositoryError::TrackingReferenceMissing)
    );
    cleanup(&[&d]);
}

#[test]
fn a_reconciled_tracked_repository_verifies_then_ahead_refuses() {
    let bare = temp("bare");
    git(&bare, &["init", "--bare", "-b", "main"]);
    let d = temp("work");
    init_clean(&d);
    git(&d, &["remote", "add", "origin", bare.to_str().unwrap()]);
    git(&d, &["push", "-u", "origin", "main"]);

    let obs = adapter(&d).observe(1).unwrap();
    assert!(obs.tracking_present);
    assert_eq!((obs.ahead, obs.behind), (Some(0), Some(0)));
    let mut req = required_clean(&obs.canonical_root, &obs.head_oid, "main");
    req.divergence_policy = DivergencePolicy::ReconciledZero;
    req.required_freshness = RequiredFreshness::LocallyReconciled;
    assert_eq!(
        verify_repository_baseline(&obs, &req).unwrap().freshness(),
        RepositoryFreshness::LocallyReconciled
    );

    std::fs::write(d.join("d.txt"), b"x").unwrap();
    git(&d, &["add", "d.txt"]);
    git(&d, &["commit", "-m", "ahead"]);
    let obs2 = adapter(&d).observe(2).unwrap();
    assert_eq!(obs2.ahead, Some(1));
    let mut req2 = required_clean(&obs2.canonical_root, &obs2.head_oid, "main");
    req2.divergence_policy = DivergencePolicy::ReconciledZero;
    assert_eq!(
        verify_repository_baseline(&obs2, &req2),
        Err(RepositoryError::AheadMismatch)
    );
    cleanup(&[&d, &bare]);
}

// ---- PATH / NON-GIT / NESTED ------------------------------------------------------------------

#[test]
fn a_non_git_directory_is_refused() {
    let d = temp("nongit");
    assert_eq!(
        adapter(&d).observe(1).unwrap_err(),
        RepoAdapterError::NotWorkTree
    );
    cleanup(&[&d]);
}

#[test]
fn traversal_and_unc_roots_are_refused() {
    let git_exe = resolve_git();
    let mk = |root: &str| {
        RepositoryAdapter::new(RepositoryAdapterConfig::new(&git_exe, root).unwrap()).observe(1)
    };
    assert_eq!(
        mk("C:\\dev\\..\\escape").unwrap_err(),
        RepoAdapterError::PathInvalid
    );
    assert_eq!(
        mk("\\\\server\\share").unwrap_err(),
        RepoAdapterError::PathInvalid
    );
    assert_eq!(
        mk("relative\\path").unwrap_err(),
        RepoAdapterError::PathInvalid
    );
}

#[test]
fn a_nested_repository_root_mismatch_is_refused() {
    let d = temp("nested");
    init_clean(&d);
    let sub = d.join("subdir");
    std::fs::create_dir_all(&sub).unwrap();
    assert_eq!(
        adapter(&sub).observe(1).unwrap_err(),
        RepoAdapterError::RootMismatch
    );
    cleanup(&[&d]);
}
