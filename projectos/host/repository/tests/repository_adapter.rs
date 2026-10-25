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
use projectos_host_repository::{
    CommitId, CommittedFileReader, CommittedPath, CommittedRevision, RepoAdapterError,
    RepositoryAdapter, RepositoryAdapterConfig,
};

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

// ---- COMMITTED BYTES (RUN-TO-COMPLETION HOST ATTESTATION) --------------------------------------

/// A committed reader at `HEAD` over a verified absolute Git executable and root.
fn committed_head(dir: &Path) -> CommittedFileReader {
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap()
}

fn head_oid(dir: &Path) -> String {
    let out = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

/// THE WHOLE REASON THE READER EXISTS: an edit on disk cannot change what the host verifies.
///
/// The signed execution closure attests COMMITTED bytes. If the host read the working tree, an
/// attacker who could write the broker file would also decide what the manifest was compared
/// against, and the signature would be checking the attacker's own edit against itself. Here the
/// file is replaced on disk — as completely as possible, and left dirty — and the read is unchanged.
#[test]
fn a_working_tree_edit_cannot_substitute_for_the_committed_bytes() {
    let d = temp("committed-substitution");
    init_clean(&d);
    let rel = CommittedPath::new("a.txt").unwrap();
    let reader = committed_head(&d);
    assert_eq!(reader.committed_bytes(&rel).unwrap(), b"hello");

    // The hostile edit: different content, different length, still uncommitted.
    std::fs::write(d.join("a.txt"), b"malicious replacement bytes").unwrap();
    assert_eq!(
        reader.committed_bytes(&rel).unwrap(),
        b"hello",
        "a dirty working tree must not change what the host reads"
    );

    // Even staged, it is still not committed.
    git(&d, &["add", "a.txt"]);
    assert_eq!(
        reader.committed_bytes(&rel).unwrap(),
        b"hello",
        "the index is not the object store either"
    );
    cleanup(&[&d]);
}

/// A READER PINNED TO ONE COMMIT STAYS THERE. Moving `HEAD` does not move it.
///
/// This is what makes an explicit commit context meaningful rather than decorative: a verification
/// begun against one commit cannot be finished against another because somebody committed in
/// between.
#[test]
fn a_reader_pinned_to_a_commit_is_unaffected_by_a_later_one() {
    let d = temp("committed-pinned");
    init_clean(&d);
    let first = head_oid(&d);

    std::fs::write(d.join("a.txt"), b"second version").unwrap();
    git(&d, &["add", "a.txt"]);
    git(&d, &["commit", "-m", "second"]);

    let cfg = RepositoryAdapterConfig::new(&resolve_git(), d.to_str().unwrap()).unwrap();
    let rel = CommittedPath::new("a.txt").unwrap();

    let pinned = CommittedFileReader::open(
        &cfg,
        CommittedRevision::Commit(CommitId::parse(&first).unwrap()),
    )
    .unwrap();
    assert_eq!(pinned.committed_bytes(&rel).unwrap(), b"hello");

    // And HEAD genuinely did move, so the assertion above is not vacuous.
    let head = CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap();
    assert_eq!(head.committed_bytes(&rel).unwrap(), b"second version");
    cleanup(&[&d]);
}

/// OPENING AT `HEAD` PINS THE COMMIT `HEAD` NAMED THEN — it does not follow the pointer.
///
/// `HEAD` moves without anyone committing as the owner: a checkout, a reset or a write to
/// `.git/HEAD` is enough. A reader that re-resolved it on every call would let an attacker change
/// the commit BETWEEN two artefacts of one verification, and each answer would still truthfully
/// report "this is what is committed" — a rollback window opened underneath a check that believes
/// it read one repository state.
///
/// The same reader is used across the move, which is the case a two-reader test cannot reach.
#[test]
fn a_head_reader_does_not_follow_head_after_it_is_opened() {
    let d = temp("committed-head-pinned");
    init_clean(&d);
    let opened_at = head_oid(&d);

    let cfg = RepositoryAdapterConfig::new(&resolve_git(), d.to_str().unwrap()).unwrap();
    let rel = CommittedPath::new("a.txt").unwrap();
    let reader = CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap();
    assert_eq!(reader.pinned_commit().as_str(), opened_at);
    assert_eq!(reader.committed_bytes(&rel).unwrap(), b"hello");

    // HEAD moves forward — no owner signature, no force, just an ordinary commit.
    std::fs::write(d.join("a.txt"), b"rolled forward").unwrap();
    git(&d, &["add", "a.txt"]);
    git(&d, &["commit", "-m", "moves head"]);
    assert_ne!(head_oid(&d), opened_at, "HEAD must genuinely have moved");

    assert_eq!(
        reader.committed_bytes(&rel).unwrap(),
        b"hello",
        "the reader must stay on the commit it was opened at"
    );

    // And backwards, which is the rollback shape: HEAD is re-pointed at the older commit.
    git(&d, &["checkout", "--detach", &opened_at]);
    assert_eq!(reader.committed_bytes(&rel).unwrap(), b"hello");

    // A reader opened NOW sees the moved HEAD, so the assertions above are not vacuous.
    git(&d, &["checkout", "main"]);
    let fresh = CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap();
    assert_eq!(fresh.committed_bytes(&rel).unwrap(), b"rolled forward");
    cleanup(&[&d]);
}

/// THE ROOT IS RE-PROVEN ON EVERY READ, not once at open.
///
/// Proving it only at open would leave a window in which the directory at that path stops being the
/// governed repository — replaced, or a junction retargeted — and every later read is answered from
/// somewhere else while the reader still reports success. Here the repository is dismantled after a
/// successful read and the next read refuses.
#[test]
fn a_root_that_stops_proving_out_is_refused_on_the_next_read() {
    let d = temp("committed-root-reproof");
    init_clean(&d);
    let rel = CommittedPath::new("a.txt").unwrap();
    let reader = committed_head(&d);
    assert_eq!(reader.committed_bytes(&rel).unwrap(), b"hello");

    // The directory is no longer a work tree top level.
    std::fs::remove_dir_all(d.join(".git")).unwrap();
    assert_eq!(
        reader.committed_bytes(&rel).unwrap_err(),
        RepoAdapterError::NotWorkTree,
        "a root that no longer proves out must refuse, not answer from wherever it now points"
    );
    cleanup(&[&d]);
}

/// THE BYTES ARE VERBATIM. No end-of-line translation, no filter, no textconv.
///
/// The manifest pins a SHA-256 of the exact committed object. A reader that silently normalised
/// CRLF would disagree with the generator on every file that has any, and the refusal would look
/// like tampering.
#[test]
fn committed_bytes_are_returned_verbatim() {
    let d = temp("committed-verbatim");
    git(&d, &["init", "-b", "main"]);
    // Pin the repository's own conversion off, so the fixture proves the READER rather than the
    // machine's global git configuration.
    git(&d, &["config", "core.autocrlf", "false"]);
    let raw: &[u8] = b"line one\r\nline two\n\ttrailing\r\n";
    std::fs::write(d.join("crlf.txt"), raw).unwrap();
    git(&d, &["add", "crlf.txt"]);
    git(&d, &["commit", "-m", "crlf"]);

    let got = committed_head(&d)
        .committed_bytes(&CommittedPath::new("crlf.txt").unwrap())
        .unwrap();
    assert_eq!(
        got, raw,
        "the committed object must come back byte-for-byte"
    );
    cleanup(&[&d]);
}

/// NOTHING COMMITTED THERE IS A REFUSAL, NOT AN EMPTY FILE.
///
/// An empty `Vec` would flow onward and be hashed as content, so "the broker is not committed"
/// would arrive at the digest comparison looking like a broker.
#[test]
fn an_uncommitted_or_non_blob_path_is_refused() {
    let d = temp("committed-absent");
    init_clean(&d);
    std::fs::create_dir_all(d.join("sub")).unwrap();
    std::fs::write(d.join("sub/b.txt"), b"tracked later").unwrap();
    git(&d, &["add", "sub/b.txt"]);
    git(&d, &["commit", "-m", "sub"]);

    let reader = committed_head(&d);
    // Never committed at all.
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("no/such/file.txt").unwrap())
            .unwrap_err(),
        RepoAdapterError::CommittedObjectUnavailable
    );
    // Present in the tree, but a directory rather than a blob.
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("sub").unwrap())
            .unwrap_err(),
        RepoAdapterError::CommittedObjectUnavailable
    );
    cleanup(&[&d]);
}

/// A REVISION THAT IS NOT IN THIS REPOSITORY IS REFUSED.
#[test]
fn a_commit_that_does_not_exist_here_is_refused() {
    let d = temp("committed-wrong-rev");
    init_clean(&d);
    let absent = CommitId::parse("0123456789abcdef0123456789abcdef01234567").unwrap();
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), d.to_str().unwrap()).unwrap();
    let reader = CommittedFileReader::open(&cfg, CommittedRevision::Commit(absent)).unwrap();
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("a.txt").unwrap())
            .unwrap_err(),
        RepoAdapterError::CommittedObjectUnavailable
    );
    cleanup(&[&d]);
}

/// A ROOT THAT IS NOT A REPOSITORY TOP LEVEL NEVER BECOMES A READER.
///
/// Opening is where this is settled, so no later read can be answered out of a parent repository's
/// object store just because the configured directory happened to sit inside one.
#[test]
fn a_reader_refuses_a_root_that_is_not_the_work_tree_top_level() {
    let plain = temp("committed-not-a-repo");
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), plain.to_str().unwrap()).unwrap();
    assert_eq!(
        CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap_err(),
        RepoAdapterError::NotWorkTree
    );

    let d = temp("committed-nested");
    init_clean(&d);
    let sub = d.join("subdir");
    std::fs::create_dir_all(&sub).unwrap();
    let nested = RepositoryAdapterConfig::new(&resolve_git(), sub.to_str().unwrap()).unwrap();
    assert_eq!(
        CommittedFileReader::open(&nested, CommittedRevision::Head).unwrap_err(),
        RepoAdapterError::RootMismatch
    );
    cleanup(&[&plain, &d]);
}

/// AN UNAVAILABLE GIT FAILS CLOSED. It never degrades to a filesystem read.
#[test]
fn a_reader_whose_git_cannot_run_fails_closed() {
    let d = temp("committed-no-git");
    init_clean(&d);
    // A real, canonicalizable file that is not a runnable image, so configuration succeeds and the
    // spawn is what fails — exactly the shape of a tampered or missing Git on a live machine.
    let fake = d.join("not-really-git.txt");
    std::fs::write(&fake, b"not an executable").unwrap();
    let cfg = RepositoryAdapterConfig::new(fake.to_str().unwrap(), d.to_str().unwrap()).unwrap();
    assert_eq!(
        CommittedFileReader::open(&cfg, CommittedRevision::Head).unwrap_err(),
        RepoAdapterError::CommandRefused
    );
    cleanup(&[&d]);
}
