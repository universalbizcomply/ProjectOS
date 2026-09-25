//! PROJECTOS-HOST-REVIEW-PATH1B — the PRODUCTION candidate-evidence adapter over a REAL disposable
//! repository, and through the REAL review operation.
//!
//! What this proves that the contract's own tests cannot: that the evidence is what the repository
//! actually holds between the two commits, that nothing the adapter cannot describe is skipped, and
//! that the attestation the operation mints binds exactly that evidence and no other.

#![cfg(windows)]

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use projectos_host_gatekeeper_attestation::candidate_evidence::{
    EvidenceChange, EvidenceRefusal, BOUNDARY_MARKER_LEN,
};
use projectos_host_gatekeeper_attestation::operation::evidence_fixture::fixture_policy;
use projectos_host_gatekeeper_attestation::provider_request::HostProviderRequest;
use projectos_host_gatekeeper_attestation::operation::{
    run_gatekeeper_review_attested_for_fixture, AttestationStorePort, CandidateEvidencePort,
    ClockPort, CommittedBytesPort, EvidenceUnavailable, ExecutablePolicyPort, ExecutionFailure,
    GatekeeperExecutionPort, HostAttestation, HostPorts, HostRefusal, ProviderOutcome,
    ReviewContext, ReviewVerdict, ReviewedDecision, StoreOutcome, TrustManifestPort,
};
use projectos_host_gatekeeper_attestation::{InboxReader, RequestFileIdentity, RequestLifecycle};
use projectos_host_gatekeeper_review_composition::candidate_evidence::PinnedCommitEvidence;
use projectos_host_identity::{
    committed_candidate_digest, phase_identity_digest, plan_identity_digest, project_identity_digest,
    repository_identity_digest,
};
use projectos_host_repository::{
    CommitId, CommittedFileReader, CommittedRevision, RepositoryAdapterConfig,
};

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn temp(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let d = std::env::temp_dir().join(format!("pos-evidence-{}-{tag}-{n}", std::process::id()));
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

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(dir: &Path, rel: &str, bytes: &[u8]) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

fn commit(dir: &Path, message: &str) -> String {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "--allow-empty", "-m", message]);
    git(dir, &["rev-parse", "HEAD"])
}

/// baseline -> candidate: one added file, one deleted, one modified, one mode-only, one link.
fn repository(dir: &Path) -> (String, String) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "core.autocrlf", "false"]);
    write(dir, "keep.txt", b"same");
    write(dir, "mod.txt", b"old");
    write(dir, "gone.txt", b"bye");
    write(dir, "run.sh", b"#!/bin/sh\n");
    let baseline = commit(dir, "baseline");
    write(dir, "mod.txt", b"new\r\nline\n");
    std::fs::remove_file(dir.join("gone.txt")).unwrap();
    write(dir, "src/added.rs", b"fn added() {}\n");
    git(dir, &["add", "-A"]);
    git(dir, &["update-index", "--chmod=+x", "run.sh"]);
    let target = git(dir, &["hash-object", "-w", "keep.txt"]);
    git(dir, &["update-index", "--add", "--cacheinfo", &format!("120000,{target},link")]);
    git(dir, &["commit", "-q", "-m", "candidate"]);
    (baseline, git(dir, &["rev-parse", "HEAD"]))
}

fn reader(dir: &Path, commit: &str) -> CommittedFileReader {
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    CommittedFileReader::open(&cfg, CommittedRevision::Commit(CommitId::parse(commit).unwrap())).unwrap()
}

#[test]
fn the_evidence_is_what_the_repository_holds_between_the_two_commits() {
    let dir = temp("real");
    let (baseline, candidate) = repository(&dir);
    let r = reader(&dir, &candidate);
    let evidence = PinnedCommitEvidence::over(&r).candidate_evidence(&baseline).unwrap();

    assert_eq!(evidence.baseline(), baseline);
    assert_eq!(evidence.candidate(), candidate);
    let seen: Vec<(&str, EvidenceChange)> =
        evidence.entries().iter().map(|e| (e.path(), e.change())).collect();
    assert_eq!(
        seen,
        [
            ("gone.txt", EvidenceChange::Deleted),
            ("link", EvidenceChange::Added),
            ("mod.txt", EvidenceChange::Modified),
            ("run.sh", EvidenceChange::Modified),
            ("src/added.rs", EvidenceChange::Added),
        ],
        "keep.txt is unchanged; everything else is present, in path order"
    );
    // RAW COMMITTED BYTES: the carriage return survives, so no line-ending translation was applied.
    let modified = evidence.entries().iter().find(|e| e.path() == "mod.txt").unwrap();
    let expected: [u8; 32] = Sha256::digest(b"new\r\nline\n").into();
    assert_eq!(modified.contents_sha256(), Some(&expected));
    // A DELETION HAS NO CONTENTS, and a link's contents are its target text.
    assert!(evidence.entries()[0].contents_sha256().is_none());
    let link: [u8; 32] = Sha256::digest(b"same").into();
    assert_eq!(evidence.entries()[1].contents_sha256(), Some(&link));

    // DETERMINISTIC: a second reading of the same two commits is the same digest.
    let again = PinnedCommitEvidence::over(&reader(&dir, &candidate))
        .candidate_evidence(&baseline)
        .unwrap();
    assert_eq!(evidence.digest(), again.digest());
    cleanup(&dir);
}

#[test]
fn what_cannot_be_described_refuses_the_review_instead_of_being_skipped() {
    let dir = temp("refuse");
    let (baseline, candidate) = repository(&dir);

    // A SUBMODULE POINTER anywhere in the difference refuses ALL of it.
    git(&dir, &["update-index", "--add", "--cacheinfo", &format!("160000,{baseline},vendor/sub")]);
    git(&dir, &["commit", "-q", "-m", "with a submodule pointer"]);
    let with_gitlink = git(&dir, &["rev-parse", "HEAD"]);
    let r = reader(&dir, &with_gitlink);
    assert_eq!(
        PinnedCommitEvidence::over(&r).candidate_evidence(&baseline).unwrap_err(),
        EvidenceUnavailable::Refused(EvidenceRefusal::UnsupportedEntryKind)
    );

    // AN OBJECT OVER THE READER'S BOUND refuses; it is never shortened to fit.
    git(&dir, &["rm", "-q", "--cached", "vendor/sub"]);
    write(&dir, "huge.bin", &vec![b'x'; 1_048_577]);
    let huge = commit(&dir, "one byte over the bound");
    let r = reader(&dir, &huge);
    assert_eq!(
        PinnedCommitEvidence::over(&r).candidate_evidence(&baseline).unwrap_err(),
        EvidenceUnavailable::RepositoryRefused
    );

    // THE COMMIT ANSWERS KEEP THEIR MEANING.
    let r = reader(&dir, &candidate);
    let port = PinnedCommitEvidence::over(&r);
    assert_eq!(port.candidate_evidence(&"c".repeat(40)).unwrap_err(), EvidenceUnavailable::BaselineUnavailable);
    assert_eq!(port.candidate_evidence("HEAD").unwrap_err(), EvidenceUnavailable::BaselineUnavailable);
    let r = reader(&dir, &baseline);
    assert_eq!(
        PinnedCommitEvidence::over(&r).candidate_evidence(&candidate).unwrap_err(),
        EvidenceUnavailable::BaselineNotAncestor
    );
    cleanup(&dir);
}

#[test]
fn the_boundary_marker_is_drawn_fresh_from_the_system_source() {
    let dir = temp("marker");
    let (_baseline, candidate) = repository(&dir);
    let r = reader(&dir, &candidate);
    let port = PinnedCommitEvidence::over(&r);
    let one = port.boundary_marker().expect("the system source answers");
    let two = port.boundary_marker().expect("the system source answers");
    assert_eq!(one.len(), BOUNDARY_MARKER_LEN);
    assert_ne!(one, two, "a marker is never reused");
    assert_ne!(one, [0u8; BOUNDARY_MARKER_LEN]);
    cleanup(&dir);
}

// ---- THROUGH THE REAL OPERATION ------------------------------------------------------------------

struct NoManifest;
impl TrustManifestPort for NoManifest {
    fn manifest_bytes(&self) -> Option<Vec<u8>> {
        None
    }
}
struct NoCommitted;
impl CommittedBytesPort for NoCommitted {
    fn committed_bytes(&self, _p: &str) -> Option<Vec<u8>> {
        None
    }
}
struct Trusted;
impl ExecutablePolicyPort for Trusted {
    fn executables_are_trusted(&self) -> bool {
        true
    }
}
struct Clock;
impl ClockPort for Clock {
    fn now_epoch_s(&self) -> u64 {
        1_000
    }
}
struct Inbox(Vec<u8>);
impl InboxReader for Inbox {
    fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn std::io::Read + '_>> {
        Some(Box::new(std::io::Cursor::new(self.0.clone())))
    }
}
#[derive(Default)]
struct Store;
impl AttestationStorePort for Store {
    fn store_once(&mut self, _a: &HostAttestation) -> StoreOutcome {
        StoreOutcome::Stored
    }
}
struct Reviewer(RefCell<Vec<u8>>);
impl GatekeeperExecutionPort for Reviewer {
    fn execute(&self, request: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        *self.0.borrow_mut() = request.framed().as_bytes().to_vec();
        Ok(ProviderOutcome {
            provider_response_id: "resp_real_repo".into(),
            provider: "fixture".into(),
            model: "fixture".into(),
            tier: "gatekeeper".into(),
            verdict: ReviewVerdict::ApprovedToProceed,
            allowed_actions: vec![],
            owner_approval_required: false,
            input_tokens: 1,
            output_tokens: 1,
            cached_input_tokens: None,
            decision: ReviewedDecision {
                decision_id: "GKDEC-real-repo".into(),
                verdict: "APPROVED_TO_PROCEED".into(),
                reason: "fixture".into(),
                next_instruction: "continue".into(),
                forbidden_actions: vec![],
                decided_by: "fixture".into(),
                decided_at: "2026-09-19T00:00:00Z".into(),
            },
        })
    }
}

fn raw(hex: &str) -> [u8; 20] {
    let mut out = [0u8; 20];
    for (i, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap();
    }
    out
}

fn review(
    r: &CommittedFileReader,
    candidate_digest: [u8; 32],
    baseline: &str,
    reviewer: &Reviewer,
) -> Result<HostAttestation, HostRefusal> {
    // A REAL SUBJECT: declarations that hash to the Host's facts below, naming the commit the reader
    // pinned, and carrying the agent's own account of the change - which is now only a CLAIM.
    let claim = format!(
        concat!(
            r#"{{"schemaVersion":1,"ask":"gatekeeper","correlation":"77777777777777777777777777777777","#,
            r#""declared":{{"projectId":"projectos","repository":"github.com/acme/projectos","planRef":"plan-real-repo","#,
            r#""phaseId":"PHASE-REAL-REPO-1A","subjectCommit":"{commit}","requestId":"GKREQ-real-repo-1","#,
            r#""requestDigest":"sha256:{digest}"}},"providerRequest":"only a harmless comment changed"}}"#
        ),
        commit = r.pinned_commit().as_str(),
        digest = "ab".repeat(32),
    );
    let claim = claim.as_bytes();
    let digest: [u8; 32] = Sha256::digest(claim).into();
    let inbox = Inbox(claim.to_vec());
    let evidence = PinnedCommitEvidence::over(r);
    let ports = HostPorts {
        manifest: &NoManifest,
        committed: &NoCommitted,
        executables: &Trusted,
        inbox: &inbox,
        execution: reviewer,
        clock: &Clock,
        evidence: &evidence,
    };
    let ctx = ReviewContext {
        project: project_identity_digest("projectos"),
        repository: repository_identity_digest("github.com/acme/projectos"),
        plan: plan_identity_digest("plan-real-repo"),
        plan_digest: [0x44; 32],
        phase: phase_identity_digest("PHASE-REAL-REPO-1A"),
        candidate_digest,
        correlation: [0x77; 16],
        delegation_id: [0x88; 32],
        parameter_digest: &digest,
        baseline_commit: raw(baseline),
    };
    run_gatekeeper_review_attested_for_fixture(
        &ports,
        &mut RequestLifecycle::new(),
        &mut Store,
        &ctx,
        &|_| true,
        &fixture_policy(),
    )
    .map(|review| review.attestation)
}

/// THE AGENT'S CLAIM SAYS "A HARMLESS COMMENT". The reviewer is shown what the repository says, the
/// attestation binds THAT, and the claim arrives labelled as unverified.
#[test]
fn the_real_operation_reviews_and_attests_the_repositorys_evidence_not_the_agents_claim() {
    let dir = temp("operation");
    let (baseline, candidate) = repository(&dir);
    let r = reader(&dir, &candidate);
    let reviewer = Reviewer(RefCell::new(Vec::new()));
    let attestation = review(&r, committed_candidate_digest(&candidate).unwrap(), &baseline, &reviewer)
        .expect("the exact case is attested");

    let expected = PinnedCommitEvidence::over(&r).candidate_evidence(&baseline).unwrap();
    assert_eq!(attestation.evidence_digest(), &expected.digest());
    assert_eq!(attestation.baseline_commit(), &raw(&baseline));

    let shown = String::from_utf8(reviewer.0.borrow().clone()).unwrap();
    let claim = shown.find("----- BEGIN AGENT-CLAIMED NOT HOST VERIFIED ").unwrap();
    for host_fact in [
        format!("candidate-commit: {candidate}"),
        format!("baseline-commit: {baseline}"),
        "deleted gone.txt".to_string(),
        "added src/added.rs".to_string(),
        "fn added() {}".to_string(),
        "(symbolic-link-not-followed)".to_string(),
    ] {
        let at = shown.find(&host_fact).unwrap_or_else(|| panic!("{host_fact} must be shown"));
        assert!(at < claim, "{host_fact} is Host evidence, so it precedes the agent's claim");
    }
    assert!(shown[claim..].contains("only a harmless comment changed"));
    cleanup(&dir);
}

/// AN AUTHORITY MINTED OVER ONE COMMIT CANNOT BE SPENT ON EVIDENCE OF ANOTHER, and a baseline the
/// repository does not descend from is refused - in both cases with the reviewer never reached.
#[test]
fn evidence_of_another_commit_or_from_another_baseline_never_reaches_a_reviewer() {
    let dir = temp("binding");
    let (baseline, candidate) = repository(&dir);
    let r = reader(&dir, &candidate);
    let reviewer = Reviewer(RefCell::new(Vec::new()));

    let other = committed_candidate_digest(&baseline).unwrap();
    assert_eq!(review(&r, other, &baseline, &reviewer).unwrap_err(), HostRefusal::EvidenceBindingRefused);

    let nowhere = "c".repeat(40);
    assert_eq!(
        review(&r, committed_candidate_digest(&candidate).unwrap(), &nowhere, &reviewer).unwrap_err(),
        HostRefusal::CandidateEvidenceRefused(EvidenceUnavailable::BaselineUnavailable)
    );
    assert!(reviewer.0.borrow().is_empty(), "nothing was ever shown to a reviewer");
    cleanup(&dir);
}
