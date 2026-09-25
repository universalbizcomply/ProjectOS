//! Proofs for the Host review store adapters and the pinned committed candidate, against a REAL
//! filesystem and a REAL disposable git repository. PROJECTOS-HOST-REVIEW-PATH1A.
//!
//! Nothing here touches ProgramData, the ProjectOS repository, a pipe, a provider or a credential:
//! every directory is a fresh one beneath the system temp directory and is removed by the test.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use projectos_host_gatekeeper_attestation::provider_request::HostProviderRequest;
use projectos_host_gatekeeper_attestation::envelope::evidence_ref_of;
use projectos_host_gatekeeper_attestation::operation::evidence_fixture::{
    fixture_policy, FixtureCandidateEvidence, FIXTURE_BASELINE_COMMIT,
};
use projectos_host_gatekeeper_attestation::operation::{
    run_gatekeeper_review_attested_for_fixture, ClockPort, CommittedBytesPort,
    ExecutablePolicyPort, ExecutionFailure, GatekeeperExecutionPort, HostPorts, ProviderOutcome,
    ReviewContext, ReviewVerdict, ReviewedDecision, TrustManifestPort,
};
use projectos_host_gatekeeper_attestation::responder::{respond, ReviewResponse};
use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestFileIdentity, RequestLifecycle, ResponseFileIdentity, ResponseRecordSink,
    RetainedRequestInbox, INBOX_RELATIVE_ROOT, MAX_RESPONSE_RECORD_BYTES,
    RESPONSE_RELATIVE_ROOT,
};
use projectos_host_gatekeeper_review_composition::review_dispatch::{
    FsAttestationStore, FsRequestInbox, FsResponseOutbox, ATTESTATION_RELATIVE_ROOT,
};
use projectos_host_gatekeeper_review_composition::PinnedCommitCandidateSource;
use projectos_host_identity::{
    committed_candidate_digest, phase_identity_digest, plan_identity_digest,
    project_identity_digest, repository_identity_digest,
};
use projectos_host_repository::{CommittedFileReader, CommittedRevision, RepositoryAdapterConfig};
use projectos_host_windows_local_ipc::CommittedCandidateSource;

const CORRELATION: [u8; 16] = [0x3c; 16];
const PROJECT: &str = "projectos";
const REPOSITORY: &str = "C:/dev/ProjectOS";
const PLAN: &str = "plan-a45a693cb1a5f4b2-e9e72d69fc4a";
const PHASE: &str = "PROJECTOS-HOST-REVIEW-PATH1A";
const COMMIT: &str = "20fe0722528af748504baf9c094818c003a95ef7";

static NEXT: AtomicU32 = AtomicU32::new(0);

/// A fresh, empty directory unique to this process and call.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "projectos-host-review-path1a-{tag}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    assert!(!dir.exists(), "scratch residue at {}", dir.display());
}

/// A Host state root with the three leaves PROVISIONED - which is the installer's job, never the
/// adapters'.
fn provisioned_root(tag: &str) -> PathBuf {
    let root = scratch(tag);
    for leaf in [INBOX_RELATIVE_ROOT, RESPONSE_RELATIVE_ROOT, ATTESTATION_RELATIVE_ROOT] {
        std::fs::create_dir_all(root.join(leaf)).expect("leaf");
    }
    root
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

fn subject_json() -> Vec<u8> {
    format!(
        concat!(
            "{{\"schemaVersion\":1,\"ask\":\"gatekeeper\",\"correlation\":\"{corr}\",\"declared\":{{",
            "\"projectId\":\"{project}\",\"repository\":\"{repo}\",\"planRef\":\"{plan}\",",
            "\"phaseId\":\"{phase}\",\"subjectCommit\":\"{commit}\",\"requestId\":\"GKREQ-1\",",
            "\"requestDigest\":\"{rd}\"}},\"providerRequest\":\"{{}}\"}}"
        ),
        corr = hex_of(&CORRELATION),
        project = PROJECT,
        repo = REPOSITORY,
        plan = PLAN,
        phase = PHASE,
        commit = COMMIT,
        rd = "ab".repeat(32),
    )
    .into_bytes()
}

struct NoManifest;
impl TrustManifestPort for NoManifest {
    fn manifest_bytes(&self) -> Option<Vec<u8>> {
        None
    }
}
struct NoCommitted;
impl CommittedBytesPort for NoCommitted {
    fn committed_bytes(&self, _r: &str) -> Option<Vec<u8>> {
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
struct Provider;
impl GatekeeperExecutionPort for Provider {
    fn execute(&self, _s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        Ok(ProviderOutcome {
            provider_response_id: "resp_fixture".into(),
            provider: "openai".into(),
            model: "gpt-5.6-terra".into(),
            tier: "gatekeeper".into(),
            verdict: ReviewVerdict::ApprovedToProceed,
            allowed_actions: vec!["continue-phase".into()],
            owner_approval_required: false,
            input_tokens: 2_000,
            output_tokens: 300,
            cached_input_tokens: None,
            decision: ReviewedDecision {
                decision_id: "GKDEC-fixture".into(),
                verdict: "APPROVED_TO_PROCEED".into(),
                reason: "independently reviewed".into(),
                next_instruction: "continue".into(),
                forbidden_actions: vec![],
                decided_by: "ChatGPT".into(),
                decided_at: "2026-09-19T00:00:00Z".into(),
            },
        })
    }
}

/// THE HOST HALF ON A REAL DISK: the subject is read from the inbox file once, the attestation and the
/// response record are written once under DERIVED names, and the record on disk is the one the wire
/// completion is bound to.
#[test]
fn a_review_reads_its_subject_and_writes_its_attestation_and_record_on_a_real_disk() {
    let root = provisioned_root("disk");
    let body = subject_json();
    let request_file = root
        .join(INBOX_RELATIVE_ROOT)
        .join(format!("{}.request", hex_of(&CORRELATION)));
    std::fs::write(&request_file, &body).expect("the agent wrote its subject");

    let fs_inbox = FsRequestInbox::beneath(&root);
    let mut inbox = RetainedRequestInbox::over(&fs_inbox);
    let digest = inbox.read_once(&CORRELATION).expect("the subject was read");
    assert_eq!(digest, sha(&body));
    // The file may change now; the review runs over what was read.
    std::fs::write(&request_file, b"swapped after the read").expect("swap");

    let ctx = ReviewContext {
        project: project_identity_digest(PROJECT),
        repository: repository_identity_digest(REPOSITORY),
        plan: plan_identity_digest(PLAN),
        plan_digest: [0x44; 32],
        phase: phase_identity_digest(PHASE),
        candidate_digest: committed_candidate_digest(COMMIT).expect("oid"),
        correlation: CORRELATION,
        delegation_id: [0x88; 32],
        parameter_digest: &digest,
        baseline_commit: FIXTURE_BASELINE_COMMIT,
    };
    let ports = HostPorts {
        manifest: &NoManifest,
        committed: &NoCommitted,
        executables: &Trusted,
        inbox: &inbox,
        execution: &Provider,
        clock: &Clock,
        evidence: &FixtureCandidateEvidence {
            candidate: COMMIT.to_string(),
            ..FixtureCandidateEvidence::default()
        },
    };
    let mut lifecycle = RequestLifecycle::new();
    let mut attestations = FsAttestationStore::beneath(&root);
    let mut outbox = FsResponseOutbox::beneath(&root);

    let response = respond(
        |gate| {
            run_gatekeeper_review_attested_for_fixture(
                &ports,
                &mut lifecycle,
                &mut attestations,
                &ctx,
                gate,
                &fixture_policy(),
            )
        },
        &ctx,
        &mut outbox,
    );

    let ReviewResponse::Attested { evidence_ref, .. } = response else {
        panic!("expected an attested response, got {response:?}");
    };
    let record_file = root
        .join(RESPONSE_RELATIVE_ROOT)
        .join(format!("{}.response", hex_of(&CORRELATION)));
    let record = std::fs::read(&record_file).expect("the record is on disk");
    assert_eq!(evidence_ref, evidence_ref_of(&record));
    assert!(String::from_utf8_lossy(&record).contains("\"outcome\":\"attested\""));

    let stored: Vec<_> = std::fs::read_dir(root.join(ATTESTATION_RELATIVE_ROOT))
        .expect("store")
        .filter_map(Result::ok)
        .collect();
    assert_eq!(stored.len(), 1, "exactly one attestation");
    let name = stored[0].file_name().to_string_lossy().into_owned();
    assert!(name.ends_with(".attestation") && name.len() == 64 + ".attestation".len(), "{name}");

    cleanup(&root);
}

/// ONE-SHOT, ON DISK. A second record for the same correlation is refused and the first is untouched.
#[test]
fn the_outbox_writes_a_record_once_and_never_overwrites_it() {
    let root = provisioned_root("outbox");
    let mut outbox = FsResponseOutbox::beneath(&root);
    let identity = ResponseFileIdentity::for_correlation(&CORRELATION);

    assert!(outbox.store_once(&identity, b"first"));
    assert!(!outbox.store_once(&identity, b"second"));

    let on_disk = std::fs::read(root.join(RESPONSE_RELATIVE_ROOT).join(identity.file_name()));
    assert_eq!(on_disk.expect("record"), b"first");
    cleanup(&root);
}

/// BOUNDED, and never a directory it made for itself.
#[test]
fn the_outbox_refuses_an_empty_or_oversized_record_and_an_unprovisioned_leaf() {
    let root = provisioned_root("bounds");
    let mut outbox = FsResponseOutbox::beneath(&root);
    let identity = ResponseFileIdentity::for_correlation(&CORRELATION);
    assert!(!outbox.store_once(&identity, b""));
    assert!(!outbox.store_once(&identity, &vec![b'x'; MAX_RESPONSE_RECORD_BYTES + 1]));
    assert!(outbox.store_once(&identity, &vec![b'x'; MAX_RESPONSE_RECORD_BYTES]));
    cleanup(&root);

    // No leaf was provisioned: the adapter does NOT create one.
    let bare = scratch("bare");
    let mut outbox = FsResponseOutbox::beneath(&bare);
    assert!(!outbox.store_once(&identity, b"record"));
    assert!(!bare.join(RESPONSE_RELATIVE_ROOT).exists(), "the adapter created a directory");
    cleanup(&bare);
}

/// THE INBOX OPENS ONLY A PLAIN FILE under the DERIVED name. An absent request and a directory standing
/// where the request belongs are both "not there".
#[test]
fn the_inbox_opens_only_a_plain_file_under_the_derived_name() {
    let root = provisioned_root("inbox");
    let inbox = FsRequestInbox::beneath(&root);
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);
    assert!(inbox.open_once(&identity).is_none(), "absent");

    let path = root.join(INBOX_RELATIVE_ROOT).join(identity.file_name());
    std::fs::create_dir_all(&path).expect("a directory where the request belongs");
    assert!(inbox.open_once(&identity).is_none(), "a directory is not a request");
    std::fs::remove_dir_all(&path).expect("remove");

    std::fs::write(&path, b"q").expect("request");
    let mut read = Vec::new();
    inbox
        .open_once(&identity)
        .expect("a plain file")
        .read_to_end(&mut read)
        .expect("read");
    assert_eq!(read, b"q");

    // Another correlation's file is never served for this one.
    let other = RequestFileIdentity::for_correlation(&[0x3d; 16]);
    assert!(inbox.open_once(&other).is_none());
    cleanup(&root);
}

// -------------------------------------------------------------------------------------------------
// THE PINNED COMMITTED CANDIDATE, against a real disposable repository
// -------------------------------------------------------------------------------------------------

fn resolve_git() -> String {
    let path = std::env::var_os("PATH").expect("PATH");
    for dir in std::env::split_paths(&path) {
        let cand = dir.join("git.exe");
        if cand.is_file() {
            return cand.to_str().expect("utf8").to_string();
        }
    }
    panic!("git.exe not found on PATH");
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new(resolve_git())
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git ran");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn commit_file(dir: &Path, name: &str, body: &[u8], message: &str) -> String {
    std::fs::write(dir.join(name), body).expect("write");
    git(dir, &["add", name]);
    git(dir, &["commit", "-m", message]);
    git(dir, &["rev-parse", "HEAD"])
}

fn reader_at_head(dir: &Path) -> Result<CommittedFileReader, String> {
    let root = std::fs::canonicalize(dir).expect("canonical");
    // The adapter's root rule refuses the verbatim `\\?\` form canonicalize returns on Windows.
    let root = root.to_str().expect("utf8").trim_start_matches(r"\\?\").to_string();
    let config = RepositoryAdapterConfig::new(&resolve_git(), &root).map_err(|e| format!("{e:?}"))?;
    CommittedFileReader::open(&config, CommittedRevision::Head).map_err(|e| format!("{e:?}"))
}

/// PINNED ONCE. The candidate is the digest of the exact 40-hex commit `HEAD` named when the reader was
/// opened; moving `HEAD` afterwards changes nothing, and a reader opened later pins the later commit.
#[test]
fn the_candidate_is_pinned_once_and_a_later_head_changes_nothing() {
    let repo = scratch("repo");
    git(&repo, &["init", "-b", "main"]);
    let first = commit_file(&repo, "a.txt", b"one", "first");
    assert_eq!(first.len(), 40);

    let reader = reader_at_head(&repo).expect("a reader at HEAD");
    let source = PinnedCommitCandidateSource::from_reader(&reader);
    assert!(source.is_established());
    assert_eq!(reader.pinned_commit().as_str(), first);
    assert_eq!(source.candidate_digest(), committed_candidate_digest(&first));

    // HEAD MOVES. The pinned source - and the reader it came from - do not.
    let second = commit_file(&repo, "a.txt", b"two", "second");
    assert_ne!(first, second);
    assert_eq!(source.candidate_digest(), committed_candidate_digest(&first));
    assert_eq!(
        PinnedCommitCandidateSource::from_reader(&reader).candidate_digest(),
        committed_candidate_digest(&first),
        "the SAME reader still answers from the commit it pinned"
    );

    // A reader opened NOW pins the later commit, and the two candidates differ.
    let later = reader_at_head(&repo).expect("a later reader");
    let later_source = PinnedCommitCandidateSource::from_reader(&later);
    assert_eq!(later_source.candidate_digest(), committed_candidate_digest(&second));
    assert_ne!(later_source.candidate_digest(), source.candidate_digest());

    // A working-tree edit is NOT a candidate: nothing uncommitted can change the digest.
    std::fs::write(repo.join("a.txt"), b"dirty").expect("dirty");
    let dirty = reader_at_head(&repo).expect("a reader over a dirty tree");
    assert_eq!(
        PinnedCommitCandidateSource::from_reader(&dirty).candidate_digest(),
        committed_candidate_digest(&second)
    );

    cleanup(&repo);
}

/// A 64-CHARACTER OBJECT ID FAILS CLOSED. The ratified contract is exactly 40 lower-case hex; a
/// SHA-256 object-format repository is refused - at the reader or at the digest - and never truncated
/// or re-hashed into a candidate nobody approved.
#[test]
fn a_sha256_object_format_repository_yields_no_candidate() {
    let repo = scratch("sha256");
    git(&repo, &["init", "-b", "main", "--object-format=sha256"]);
    let id = commit_file(&repo, "a.txt", b"one", "first");
    assert_eq!(id.len(), 64, "this proof needs a sha256 repository");
    assert_eq!(committed_candidate_digest(&id), None);

    match reader_at_head(&repo) {
        Ok(reader) => {
            let source = PinnedCommitCandidateSource::from_reader(&reader);
            assert!(!source.is_established());
            assert_eq!(source.candidate_digest(), None);
        }
        // Refused even earlier, by the reader's own object-id rule. Equally closed.
        Err(_) => {}
    }
    cleanup(&repo);
}

/// A STALE EPOCH IS REFUSED BEFORE ANYTHING IS SPENT, and the refusal TEACHES the right one. A matching
/// epoch is not an acceptance - it is simply not this refusal.
#[test]
fn a_stale_epoch_is_refused_with_the_instances_own_epoch_and_a_matching_one_is_not() {
    use projectos_host_gatekeeper_review_composition::review_dispatch::epoch_refusal;
    use projectos_host_windows_local_ipc::{
        OperationClass, ProtectedOperationRequest, RejectionReason, ResponseState, ResultClass,
    };

    let asking = |epoch: u64| {
        ProtectedOperationRequest::new(
            CORRELATION,
            1,
            epoch,
            [0x21; 32],
            OperationClass::IndependentGatekeeperReview,
            [0xaa; 32],
            [0x77; 32],
        )
    };

    let refusal = epoch_refusal(&asking(0), 42).expect("a stale epoch is refused");
    assert_eq!(refusal.state(), ResponseState::Rejected);
    assert_eq!(refusal.result(), ResultClass::NotRun);
    assert_eq!(refusal.reason(), RejectionReason::ServiceEpochMismatch);
    assert_eq!(refusal.service_epoch(), 42, "the refusal carries THIS instance's epoch");
    assert!(refusal.answers(&CORRELATION, 42));

    assert!(epoch_refusal(&asking(42), 42).is_none());
}
