//! PROJECTOS-HOST-REVIEW-PATH1B — the endpoint-tree difference, the ancestry check and the hardened
//! environment, proven against REAL disposable repositories.
//!
//! EVERY PLANT IS SHOWN TO BE LIVE FIRST. A test that plants a replacement reference and then
//! observes the reader is unaffected proves nothing unless an ordinary, unhardened Git is shown to BE
//! affected by the same plant in the same repository. Each hostile case below therefore has a control
//! leg, and the assertion is the difference between the two.
//!
//! Disposable temporary repositories only. No network, no product repository.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_repository::{
    ChangeKind, CommitId, CommittedFileReader, CommittedPath, CommittedRevision, EntryKind,
    RepoAdapterError, RepositoryAdapter, RepositoryAdapterConfig,
};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let d = std::env::temp_dir().join(format!("pos-evid-{}-{tag}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    assert!(!dir.exists(), "disposable repo residue");
}

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

/// An ORDINARY Git: the test's own, deliberately NOT hardened, so it is affected by every plant.
fn plain(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap()
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = plain(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, rel: &str, bytes: &[u8]) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

fn commit_all(dir: &Path, message: &str) -> CommitId {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "--allow-empty", "-m", message]);
    CommitId::parse(&git(dir, &["rev-parse", "HEAD"])).unwrap()
}

fn init(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "core.autocrlf", "false"]);
}

fn reader_at(dir: &Path, commit: &CommitId) -> CommittedFileReader {
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    CommittedFileReader::open(&cfg, CommittedRevision::Commit(commit.clone())).unwrap()
}

/// A baseline and a candidate that differ in every way the evidence has to show.
fn baseline_and_candidate(dir: &Path) -> (CommitId, CommitId) {
    init(dir);
    write(dir, "keep.txt", b"same");
    write(dir, "mod.txt", b"old");
    write(dir, "gone.txt", b"bye");
    write(dir, "run.sh", b"#!/bin/sh\n");
    write(dir, "dir/nested.txt", b"one");
    write(dir, "flip.txt", b"before");
    let base = commit_all(dir, "baseline");

    // MADE AND REVERTED ALONG THE WAY: absent from an endpoint-tree difference, by construction.
    write(dir, "flip.txt", b"during");
    commit_all(dir, "intermediate");
    write(dir, "flip.txt", b"before");

    write(dir, "mod.txt", b"new");
    std::fs::remove_file(dir.join("gone.txt")).unwrap();
    write(dir, "added.txt", b"hello");
    write(dir, "dir/nested.txt", b"two");
    git(dir, &["add", "-A"]);
    git(dir, &["update-index", "--chmod=+x", "run.sh"]);
    // A link and a submodule pointer, written straight into the index: no privilege, no checkout.
    let target = git(dir, &["hash-object", "-w", "keep.txt"]);
    let link = format!("120000,{target},link");
    git(dir, &["update-index", "--add", "--cacheinfo", &link]);
    let sub = format!("160000,{},vendor/sub", base.as_str());
    git(dir, &["update-index", "--add", "--cacheinfo", &sub]);
    git(dir, &["commit", "-q", "-m", "candidate"]);
    let candidate = CommitId::parse(&git(dir, &["rev-parse", "HEAD"])).unwrap();
    (base, candidate)
}

#[test]
fn every_changed_path_is_reported_and_nothing_else() {
    let dir = temp("complete");
    let (base, candidate) = baseline_and_candidate(&dir);
    let changes = reader_at(&dir, &candidate).changes_since(&base).unwrap();

    let mut seen: Vec<(String, ChangeKind, EntryKind, EntryKind)> = changes
        .iter()
        .map(|c| {
            (
                c.path().as_str().to_string(),
                c.kind(),
                c.old_mode().kind(),
                c.new_mode().kind(),
            )
        })
        .collect();
    seen.sort_by(|a, b| a.0.cmp(&b.0));
    use ChangeKind::{Added, Deleted, Modified};
    use EntryKind::{Absent, ExecutableFile, Gitlink, RegularFile, SymbolicLink};
    assert_eq!(
        seen,
        [
            ("added.txt".to_string(), Added, Absent, RegularFile),
            (
                "dir/nested.txt".to_string(),
                Modified,
                RegularFile,
                RegularFile
            ),
            ("gone.txt".to_string(), Deleted, RegularFile, Absent),
            ("link".to_string(), Added, Absent, SymbolicLink),
            ("mod.txt".to_string(), Modified, RegularFile, RegularFile),
            ("run.sh".to_string(), Modified, RegularFile, ExecutableFile),
            ("vendor/sub".to_string(), Added, Absent, Gitlink),
        ],
        "keep.txt is unchanged and flip.txt was changed and reverted between the endpoints"
    );

    // A MODE-ONLY CHANGE keeps its identity and is still reported.
    let run = changes
        .iter()
        .find(|c| c.path().as_str() == "run.sh")
        .unwrap();
    assert_eq!(run.old_id(), run.new_id());
    // FULL-LENGTH IDENTITIES, and the null identity on the absent side.
    let added = changes
        .iter()
        .find(|c| c.path().as_str() == "added.txt")
        .unwrap();
    assert!(added.old_id().is_null());
    assert_eq!(added.new_id().as_str().len(), 40);
    assert_eq!(
        added.new_id().as_str(),
        git(
            &dir,
            &["rev-parse", &format!("{}:added.txt", candidate.as_str())]
        )
    );

    // A LINK IS NEVER FOLLOWED: the committed object is the target text, not the target's content.
    let reader = reader_at(&dir, &candidate);
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("link").unwrap())
            .unwrap(),
        b"same",
        "this fixture's link blob holds the bytes of keep.txt as its target text"
    );

    // EQUAL ENDPOINTS ARE AN EMPTY ANSWER, NOT AN ERROR.
    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&candidate)
            .unwrap(),
        Vec::new()
    );
    cleanup(&dir);
}

#[test]
fn an_absent_baseline_an_absent_candidate_and_a_non_ancestor_each_refuse_differently() {
    let dir = temp("refuse");
    let (base, candidate) = baseline_and_candidate(&dir);
    let nowhere = CommitId::parse(&"c".repeat(40)).unwrap();

    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&nowhere)
            .unwrap_err(),
        RepoAdapterError::BaselineUnavailable
    );
    assert_eq!(
        reader_at(&dir, &nowhere).changes_since(&base).unwrap_err(),
        RepoAdapterError::CandidateUnavailable
    );
    // A BLOB OR A TREE IS NOT A COMMIT, however real its identity is.
    let blob = CommitId::parse(&git(
        &dir,
        &["rev-parse", &format!("{}:keep.txt", base.as_str())],
    ))
    .unwrap();
    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&blob)
            .unwrap_err(),
        RepoAdapterError::BaselineUnavailable
    );
    // THE WRONG WAY ROUND: the candidate is not an ancestor of the baseline.
    assert_eq!(
        reader_at(&dir, &base)
            .changes_since(&candidate)
            .unwrap_err(),
        RepoAdapterError::BaselineNotAncestor
    );
    // AN UNRELATED HISTORY in the same object store.
    git(&dir, &["checkout", "-q", "--orphan", "other"]);
    git(&dir, &["rm", "-rfq", "--cached", "."]);
    git(&dir, &["clean", "-fdxq"]);
    write(&dir, "elsewhere.txt", b"x");
    let unrelated = commit_all(&dir, "unrelated root");
    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&unrelated)
            .unwrap_err(),
        RepoAdapterError::BaselineNotAncestor
    );
    cleanup(&dir);
}

/// An unrelated root commit in the same object store, leaving `main` checked out.
fn unrelated_root(dir: &Path) -> CommitId {
    git(dir, &["checkout", "-q", "--orphan", "other"]);
    git(dir, &["rm", "-rfq", "--cached", "."]);
    git(dir, &["clean", "-fdxq"]);
    write(dir, "elsewhere.txt", b"x");
    let unrelated = commit_all(dir, "unrelated root");
    git(dir, &["checkout", "-q", "-f", "main"]);
    unrelated
}

fn plain_is_ancestor(dir: &Path, a: &CommitId, d: &CommitId) -> bool {
    plain(
        dir,
        &["merge-base", "--is-ancestor", a.as_str(), d.as_str()],
    )
    .status
    .code()
        == Some(0)
}

#[test]
fn a_planted_graft_cannot_forge_the_ancestry_answer() {
    let dir = temp("graft");
    let (_base, candidate) = baseline_and_candidate(&dir);
    let unrelated = unrelated_root(&dir);
    assert!(
        !plain_is_ancestor(&dir, &unrelated, &candidate),
        "not an ancestor before the plant"
    );

    let grafts = dir.join(".git").join("info").join("grafts");
    std::fs::create_dir_all(grafts.parent().unwrap()).unwrap();
    std::fs::write(
        &grafts,
        format!("{} {}\n", candidate.as_str(), unrelated.as_str()),
    )
    .unwrap();
    assert!(
        plain_is_ancestor(&dir, &unrelated, &candidate),
        "CONTROL: an ordinary Git now believes the forged parent link, so the plant is live"
    );

    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&unrelated)
            .unwrap_err(),
        RepoAdapterError::BaselineNotAncestor
    );
    cleanup(&dir);
}

#[test]
fn a_planted_replacement_reference_changes_neither_the_ancestry_answer_nor_the_bytes() {
    let dir = temp("replace");
    let (base, candidate) = baseline_and_candidate(&dir);
    let unrelated = unrelated_root(&dir);

    // (1) A replacement that re-parents the candidate onto the unrelated root.
    git(
        &dir,
        &["replace", "--graft", candidate.as_str(), unrelated.as_str()],
    );
    assert!(
        plain_is_ancestor(&dir, &unrelated, &candidate),
        "CONTROL: an ordinary Git honours the replacement"
    );
    assert_eq!(
        reader_at(&dir, &candidate)
            .changes_since(&unrelated)
            .unwrap_err(),
        RepoAdapterError::BaselineNotAncestor
    );
    // ...and the true baseline is still the true baseline.
    assert!(reader_at(&dir, &candidate).changes_since(&base).is_ok());
    git(&dir, &["replace", "-d", candidate.as_str()]);

    // (2) A replacement of the BLOB the reviewer would be shown.
    let real = git(
        &dir,
        &["rev-parse", &format!("{}:mod.txt", candidate.as_str())],
    );
    write(&dir, "evil.bin", b"SUBSTITUTED");
    let evil = git(&dir, &["hash-object", "-w", "evil.bin"]);
    std::fs::remove_file(dir.join("evil.bin")).unwrap();
    git(&dir, &["replace", &real, &evil]);
    let spec = format!("{}:mod.txt", candidate.as_str());
    assert_eq!(
        plain(&dir, &["cat-file", "blob", &spec]).stdout,
        b"SUBSTITUTED",
        "CONTROL: an ordinary Git serves the replacement object"
    );
    let reader = reader_at(&dir, &candidate);
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("mod.txt").unwrap())
            .unwrap(),
        b"new"
    );
    let change = reader
        .changes_since(&base)
        .unwrap()
        .into_iter()
        .find(|c| c.path().as_str() == "mod.txt")
        .unwrap();
    assert_eq!(change.new_id().as_str(), real);
    cleanup(&dir);
}

#[test]
fn planted_configuration_and_attribute_filters_run_nothing_and_change_no_bytes() {
    let dir = temp("config");
    init(&dir);
    write(&dir, "a.txt", b"hello");
    let base = commit_all(&dir, "baseline");
    // The attribute file is COMMITTED IN THE CANDIDATE — the implementer controls it.
    write(&dir, ".gitattributes", b"*.txt filter=evil diff=evil\n");
    write(&dir, "a.txt", b"hello world");
    let candidate = commit_all(&dir, "candidate");

    let marker = dir.join("PROGRAM-RAN");
    let marker_unix = marker.to_str().unwrap().replace('\\', "/");
    let run_marker = format!("echo ran > '{marker_unix}' #");
    git(&dir, &["config", "core.fsmonitor", &run_marker]);
    git(&dir, &["config", "filter.evil.smudge", "tr a-z A-Z"]);
    git(&dir, &["config", "filter.evil.clean", "tr a-z A-Z"]);
    git(&dir, &["config", "diff.evil.textconv", "tr a-z A-Z <"]);
    git(&dir, &["config", "core.hooksPath", &marker_unix]);

    // CONTROLS: both plants are live for an ordinary Git in this repository.
    let _ = plain(&dir, &["status", "--porcelain"]);
    assert!(
        marker.exists(),
        "CONTROL: an ordinary `git status` runs the configured program"
    );
    std::fs::remove_file(&marker).unwrap();
    let spec = format!("{}:a.txt", candidate.as_str());
    assert_eq!(
        plain(&dir, &["cat-file", "--filters", &spec]).stdout,
        b"HELLO WORLD",
        "CONTROL: the planted smudge filter is live"
    );

    // THE READER: raw committed bytes, the true difference, and no program.
    let reader = reader_at(&dir, &candidate);
    assert_eq!(
        reader
            .committed_bytes(&CommittedPath::new("a.txt").unwrap())
            .unwrap(),
        b"hello world"
    );
    let mut paths: Vec<String> = reader
        .changes_since(&base)
        .unwrap()
        .iter()
        .map(|c| c.path().as_str().to_string())
        .collect();
    paths.sort();
    assert_eq!(paths, [".gitattributes", "a.txt"]);

    // THE OBSERVATION ADAPTER runs `status`, the one verb that consults the file-system monitor.
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    RepositoryAdapter::new(cfg).observe(1).unwrap();
    assert!(
        !marker.exists(),
        "no configured program ran under the Host's fixed environment"
    );
    cleanup(&dir);
}

#[test]
fn user_level_configuration_cannot_reach_a_read() {
    let dir = temp("global");
    let (base, candidate) = baseline_and_candidate(&dir);
    let unrelated = unrelated_root(&dir);
    git(
        &dir,
        &["replace", "--graft", candidate.as_str(), unrelated.as_str()],
    );

    // A user-level configuration file that would switch replacement references back ON, offered the
    // only two ways one can be: through the profile and through the explicit variable. The reader
    // clears the inherited environment and points both configuration scopes at the null device.
    let home = temp("home");
    std::fs::write(home.join(".gitconfig"), "[core]\n\tuseReplaceRefs = true\n").unwrap();
    std::env::set_var("GIT_CONFIG_GLOBAL", home.join(".gitconfig"));
    std::env::set_var("HOME", &home);
    let outcome = reader_at(&dir, &candidate).changes_since(&unrelated);
    let truthful = reader_at(&dir, &candidate)
        .changes_since(&base)
        .map(|c| c.len());
    std::env::remove_var("GIT_CONFIG_GLOBAL");
    std::env::remove_var("HOME");

    assert_eq!(outcome.unwrap_err(), RepoAdapterError::BaselineNotAncestor);
    assert_eq!(truthful.unwrap(), 7);
    cleanup(&dir);
    cleanup(&home);
}
