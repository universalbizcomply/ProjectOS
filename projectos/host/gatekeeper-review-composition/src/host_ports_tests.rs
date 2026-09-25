//! Proofs for the production ports. No credential is read and no provider is reached anywhere here: the
//! provider is a fixture at the launcher seam, and where the REAL broker runs it stops at its own
//! credential stage because the disposable installation has none.

#![cfg(windows)]

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use super::*;
use projectos_host_gatekeeper_attestation::candidate_evidence::{
    CandidateEvidence, EvidenceChange, EvidenceEntryInput, FramedReviewInput,
};
use projectos_host_gatekeeper_attestation::envelope::parse_review_subject;
use projectos_host_gatekeeper_attestation::operation::evidence_fixture::{fixture_policy, FIXTURE_MARKER};
use projectos_host_gatekeeper_attestation::operation::ReviewVerdict;
use projectos_host_gatekeeper_attestation::{accept_request_body, InboxReader, RequestFileIdentity};

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn temp(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let d = std::env::temp_dir().join(format!("pos-hostports-{}-{tag}-{n}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}
fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    assert!(!dir.exists(), "residue");
}
fn on_path(exe: &str) -> PathBuf {
    std::env::split_paths(&std::env::var_os("PATH").expect("PATH"))
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
        .unwrap_or_else(|| panic!("{exe} not found on PATH"))
}
fn unix(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

const PROJECT: &str = "projectos";
const PHASE: &str = "PHASE-HOSTPORTS-1A";
const REQUEST_ID: &str = "GKREQ-hostports-0000000001";

/// A Host-authored request for `commit`, built by the REAL builder from a digest-bound subject.
fn host_request(commit: &str) -> HostProviderRequest {
    struct Inbox(Vec<u8>);
    impl InboxReader for Inbox {
        fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn std::io::Read + '_>> {
            Some(Box::new(std::io::Cursor::new(self.0.clone())))
        }
    }
    let subject = format!(
        concat!(
            r#"{{"schemaVersion":1,"ask":"gatekeeper","correlation":"01010101010101010101010101010101","#,
            r#""declared":{{"projectId":"{project}","repository":"github.com/local/fixture","planRef":"plan-hostports","#,
            r#""phaseId":"{phase}","subjectCommit":"{commit}","requestId":"{request}","#,
            r#""requestDigest":"sha256:{digest}"}},"providerRequest":"the agent's own account"}}"#
        ),
        project = PROJECT,
        phase = PHASE,
        commit = commit,
        request = REQUEST_ID,
        digest = "ab".repeat(32),
    );
    let digest: [u8; 32] = Sha256::digest(subject.as_bytes()).into();
    let identity = RequestFileIdentity::for_correlation(&[1; 16]);
    let body = accept_request_body(&Inbox(subject.clone().into_bytes()), &identity, &digest).unwrap();
    let parsed = parse_review_subject(&body).unwrap();
    let evidence = CandidateEvidence::assemble(
        &"b4".repeat(20),
        commit,
        vec![EvidenceEntryInput {
            change: EvidenceChange::Added,
            path: "src/reviewed.rs".into(),
            old_mode: 0,
            new_mode: 0o100_644,
            old_id: "0".repeat(40),
            new_id: "a".repeat(40),
            new_contents: Some(b"fn reviewed() {}\n".to_vec()),
        }],
    )
    .unwrap();
    let framed = FramedReviewInput::frame(&evidence, subject.as_bytes(), &FIXTURE_MARKER).unwrap();
    HostProviderRequest::build(&fixture_policy(), &parsed, framed).unwrap()
}

fn roots(install: &Path) -> BrokerRoots {
    BrokerRoots {
        install_root: install.to_string_lossy().into_owned(),
        state_dir: install.join("state").to_string_lossy().into_owned(),
        governed_root: install.to_string_lossy().into_owned(),
    }
}

struct FixedClock;
impl ClockPort for FixedClock {
    fn now_epoch_s(&self) -> u64 {
        1_788_000_000
    }
}

/// THE FIXTURE PROVIDER, at the launcher seam: records exactly what it was asked to run and answers.
struct FixtureLauncher {
    answer: Result<Vec<u8>, LaunchFailure>,
    source: RefCell<Vec<u8>>,
    request: RefCell<Vec<u8>>,
}
impl FixtureLauncher {
    fn answering(answer: Result<Vec<u8>, LaunchFailure>) -> Self {
        Self { answer, source: RefCell::new(Vec::new()), request: RefCell::new(Vec::new()) }
    }
}
impl BrokerLauncher for FixtureLauncher {
    fn launch(&self, launch: &BrokerLaunch<'_>) -> Result<Vec<u8>, LaunchFailure> {
        *self.source.borrow_mut() = launch.source.to_vec();
        *self.request.borrow_mut() = launch.request_json.to_vec();
        self.answer.clone()
    }
}

fn provider_answer(model: &str) -> Vec<u8> {
    let decision = r#"{"verdict":"APPROVED_TO_PROCEED","reason":"matches","nextInstruction":"continue","allowedActions":["commit"],"forbiddenActions":[],"ownerApprovalRequired":false}"#;
    let body = serde_json::json!({
        "id": "resp_ports_1", "model": model, "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": decision}]}],
        "usage": {"input_tokens": 100, "output_tokens": 20}
    })
    .to_string();
    serde_json::json!({ "status": 200, "body": body }).to_string().into_bytes()
}

const BROKER_BYTES: &[u8] = b"// the closure-verified broker bytes\nvoid 0;\n";

#[test]
fn the_port_runs_exactly_the_verified_broker_over_exactly_the_host_authored_body() {
    let install = temp("port");
    let launcher = FixtureLauncher::answering(Ok(provider_answer("gpt-5.6-terra")));
    let port = PackagedBrokerExecution::for_fixture(&launcher, &FixedClock, BROKER_BYTES.to_vec(), fixture_policy(), roots(&install));
    let request = host_request(&"c".repeat(40));
    let outcome = port.execute(&request).expect("a completed answer from the signed model");

    assert_eq!(outcome.verdict, ReviewVerdict::ApprovedToProceed);
    // The outcome states NO cost: the Host has no rate card, and the admitted amount is attested from
    // the owner-signed policy, never from a broker or provider answer.
    assert_eq!(outcome.decision.decided_at, "2026-08-29T10:40:00Z");

    // THE REQUEST FILE: the broker's contract, with the Host-authored body VERBATIM and the owner-signed
    // credential reference - and nothing a caller chose.
    let sent: serde_json::Value = serde_json::from_slice(&launcher.request.borrow()).unwrap();
    assert_eq!(sent["kind"], "gatekeeper");
    assert_eq!(sent["projectId"], PROJECT);
    assert_eq!(sent["phaseId"], PHASE);
    assert_eq!(sent["subjectCommit"], "c".repeat(40));
    assert_eq!(sent["ask"], "evidence-review");
    assert_eq!(sent["requestId"], REQUEST_ID);
    assert_eq!(sent["credentialRef"], "PROJECTOS_GATEKEEPER_OPENAI_KEY");
    assert_eq!(sent["body"].as_str().unwrap().as_bytes(), request.body());
    assert_eq!(sent["governedRoot"], install.to_string_lossy().as_ref());

    // THE SOURCE: three pinned constants, then the verified broker bytes, unchanged to the last byte.
    let source = launcher.source.borrow().clone();
    assert!(source.ends_with(BROKER_BYTES));
    let prelude = String::from_utf8(source[..source.len() - BROKER_BYTES.len()].to_vec()).unwrap();
    let request_sha: String = Sha256::digest(&*launcher.request.borrow()).iter().map(|b| format!("{b:02x}")).collect();
    let lines: Vec<&str> = prelude.lines().collect();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0], format!("const TRUSTED_INSTALL_ROOT = {};", serde_json::to_string(install.to_str().unwrap()).unwrap()));
    assert_eq!(lines[1], format!("const TRUSTED_REQUEST_SHA256 = \"{request_sha}\";"));
    assert!(lines[2].starts_with("const TRUSTED_STATE_DIR = "));
    cleanup(&install);
}

#[test]
fn every_way_the_broker_can_fail_is_retained_and_attests_nothing() {
    let install = temp("fail");
    let request = host_request(&"c".repeat(40));
    let cases: Vec<(&str, Result<Vec<u8>, LaunchFailure>, ExecutionFailure)> = vec![
        ("the runtime could not be started", Err(LaunchFailure::NotStarted), ExecutionFailure::ProviderUnavailable),
        ("the process failed", Err(LaunchFailure::Failed), ExecutionFailure::ProviderUnavailable),
        ("the broker refused", Ok(br#"{"error":"this installation does not authorise the project"}"#.to_vec()), ExecutionFailure::ProviderUnavailable),
        ("unreadable output", Ok(b"<html>".to_vec()), ExecutionFailure::ProviderUnavailable),
        ("no status", Ok(br#"{"body":"x"}"#.to_vec()), ExecutionFailure::ProviderUnavailable),
        ("another model answered", Ok(provider_answer("gpt-4o")), ExecutionFailure::ProviderResultUnusable),
    ];
    for (name, answer, expected) in cases {
        let launcher = FixtureLauncher::answering(answer);
        let port = PackagedBrokerExecution::for_fixture(&launcher, &FixedClock, BROKER_BYTES.to_vec(), fixture_policy(), roots(&install));
        assert_eq!(port.execute(&request).unwrap_err(), expected, "{name}");
    }
    cleanup(&install);
}

/// DORMANT BY CONSTRUCTION. Without an owner-signed version 2 manifest there is no execution port at
/// all - not one that refuses, none.
#[test]
fn without_an_owner_signed_closure_no_execution_port_exists() {
    struct Manifest(Option<Vec<u8>>);
    impl TrustManifestPort for Manifest {
        fn manifest_bytes(&self) -> Option<Vec<u8>> {
            self.0.clone()
        }
    }
    struct Committed;
    impl CommittedBytesPort for Committed {
        fn committed_bytes(&self, _p: &str) -> Option<Vec<u8>> {
            Some(b"committed".to_vec())
        }
    }
    let install = temp("dormant");
    let launcher = FixtureLauncher::answering(Ok(provider_answer("gpt-5.6-terra")));
    for manifest in [None, Some(b"not json".to_vec()), Some(br#"{"schemaVersion":1}"#.to_vec())] {
        let port = PackagedBrokerExecution::establish(&Manifest(manifest), &Committed, &launcher, &FixedClock, roots(&install));
        assert!(port.is_none());
    }
    assert!(launcher.source.borrow().is_empty(), "nothing was ever launched");
    cleanup(&install);
}

#[test]
fn only_the_pinned_runtime_and_an_absolute_git_are_trusted() {
    let node = on_path("node.exe");
    let git = on_path("git.exe");
    // THIS MACHINE'S node.exe IS THE PINNED RUNTIME; if a later machine's is not, the positive leg says
    // so rather than passing vacuously.
    assert!(is_pinned_runtime(&node), "the local node.exe is not the packaging contract's pinned runtime");
    assert!(PinnedExecutablePolicy::over(&node, &git).executables_are_trusted());
    // ANOTHER EXECUTABLE in the runtime's place - even a genuine one - is not the pinned runtime.
    assert!(!PinnedExecutablePolicy::over(&git, &git).executables_are_trusted());
    assert!(!PinnedExecutablePolicy::over(Path::new("node.exe"), &git).executables_are_trusted());
    assert!(!PinnedExecutablePolicy::over(&node, Path::new("git.exe")).executables_are_trusted());
    assert!(!PinnedExecutablePolicy::over(&node, &std::env::temp_dir()).executables_are_trusted());
}

#[test]
fn the_installed_manifest_is_read_bounded_by_name_and_never_through_a_directory() {
    let root = temp("manifest");
    assert_eq!(InstalledTrustManifest::beneath(&root).manifest_bytes(), None, "absent");
    let file = root.join(contract::TRUST_MANIFEST_FILENAME);
    std::fs::write(&file, b"").unwrap();
    assert_eq!(InstalledTrustManifest::beneath(&root).manifest_bytes(), None, "empty");
    std::fs::write(&file, b"{\"m\":1}").unwrap();
    assert_eq!(InstalledTrustManifest::beneath(&root).manifest_bytes(), Some(b"{\"m\":1}".to_vec()));
    std::fs::write(&file, vec![b' '; MAX_TRUST_MANIFEST_BYTES as usize + 1]).unwrap();
    assert_eq!(InstalledTrustManifest::beneath(&root).manifest_bytes(), None, "oversize");
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert_eq!(InstalledTrustManifest::beneath(&root).manifest_bytes(), None, "a directory is not a manifest");
    cleanup(&root);
}

/// THE PRODUCTION LAUNCHER, WITH THE REAL PINNED RUNTIME. A tiny stand-in source reports what it was
/// given: the request file it was pointed at hashes to what was written, the git executable arrived,
/// and NOTHING inherited from this process did.
#[test]
fn the_production_launcher_runs_the_source_from_stdin_under_a_fixed_environment() {
    let work = temp("launch");
    let scratch = work.join("scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let (node, git) = (on_path("node.exe"), on_path("git.exe"));
    std::env::set_var("POS_INHERITED_CANARY", "must-not-arrive");
    std::env::set_var("NODE_OPTIONS", "--require=./planted.js");

    let source = br#"
const fs = require("fs"), crypto = require("crypto");
const file = process.env.PROJECTOS_BROKER_REQUEST;
const seen = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
process.stdout.write(JSON.stringify({
  requestSha256: seen, git: process.env.PROJECTOS_GIT_EXE, cwd: process.cwd(),
  inherited: ["POS_INHERITED_CANARY", "NODE_OPTIONS", "PATH", "USERPROFILE"].filter((k) => process.env[k] !== undefined),
}));
"#;
    let request = br#"{"kind":"gatekeeper","body":"x"}"#;
    let launcher = PinnedNodeLauncher::new(&node, &git, &work, &scratch);
    let printed = launcher.launch(&BrokerLaunch { source, request_json: request }).expect("the pinned runtime ran the source");
    std::env::remove_var("POS_INHERITED_CANARY");
    std::env::remove_var("NODE_OPTIONS");

    let seen: serde_json::Value = serde_json::from_slice(&printed).unwrap();
    let expected: String = Sha256::digest(request).iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(seen["requestSha256"], expected);
    assert_eq!(seen["git"], git.to_string_lossy().as_ref());
    assert_eq!(seen["inherited"], serde_json::json!([]), "nothing this process held reached the broker");
    assert_eq!(std::fs::read_dir(&scratch).unwrap().count(), 0, "the request file is removed afterwards");

    // A RUNTIME THAT IS NOT THE PINNED ONE IS NEVER STARTED.
    let wrong = PinnedNodeLauncher::new(&git, &git, &work, &scratch);
    assert_eq!(wrong.launch(&BrokerLaunch { source, request_json: request }).unwrap_err(), LaunchFailure::NotStarted);
    // A SOURCE THAT HANGS IS KILLED.
    let hang = PinnedNodeLauncher::new(&node, &git, &work, &scratch).with_timeout(Duration::from_millis(400));
    let forever = b"setInterval(() => {}, 1000);";
    assert_eq!(hang.launch(&BrokerLaunch { source: forever, request_json: request }).unwrap_err(), LaunchFailure::Failed);
    cleanup(&work);
}

/// Wraps the production launcher to keep what the broker printed.
struct Capturing<'a> {
    inner: &'a PinnedNodeLauncher,
    printed: RefCell<Vec<u8>>,
}
impl BrokerLauncher for Capturing<'_> {
    fn launch(&self, launch: &BrokerLaunch<'_>) -> Result<Vec<u8>, LaunchFailure> {
        let out = self.inner.launch(launch)?;
        *self.printed.borrow_mut() = out.clone();
        Ok(out)
    }
}

/// THE PRODUCTION PORT -> THE PRODUCTION LAUNCHER -> THE REAL PINNED RUNTIME -> THE REAL BROKER BYTES,
/// in a disposable installation that authorises the project and the phase and REALLY CONTAINS the
/// candidate commit. The broker accepts the Host-authored body through every gate it has - bindings,
/// installation allowlist, owner receipt, ask vocabulary, commit existence, spend reservation - and stops
/// where it must: it has no credential. The Host reads that as "may have been dispatched" and retains.
#[test]
fn the_real_broker_accepts_the_host_authored_request_up_to_its_credential_stage() {
    let install = temp("real-broker");
    let scratch = temp("real-broker-scratch");
    let git = |args: &[&str]| -> String {
        let out = Command::new("git").arg("-C").arg(&install).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.invalid"]);
    git(&["config", "user.name", "Test"]);
    git(&["config", "commit.gpgsign", "false"]);
    git(&["remote", "add", "origin", "https://github.com/local/fixture.git"]);
    let write = |rel: &str, bytes: &[u8]| {
        let p = install.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    };
    // THE REAL BROKER, byte for byte as the repository holds it.
    let broker = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../security/gatekeeper-transport-broker.cjs")).unwrap();
    write(contract::BROKER_REPOSITORY_RELATIVE_PATH, &broker);
    write(
        contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
        format!(
            r#"{{"schemaVersion":"1.0.0","projects":[{{"projectId":"{PROJECT}","repository":"github.com/local/fixture","governedRoot":"{}"}}]}}"#,
            unix(&install)
        )
        .as_bytes(),
    );
    write(
        &format!(".projectops/gates/{PHASE}.secrets-handling.json"),
        format!(r#"{{"gateName":"secrets-handling","phaseId":"{PHASE}","ownerChoice":"APPROVE"}}"#).as_bytes(),
    );
    git(&["add", "-A"]);
    git(&["commit", "-q", "-m", "authorised"]);
    let head = git(&["rev-parse", "HEAD"]);

    let production = PinnedNodeLauncher::new(&on_path("node.exe"), &on_path("git.exe"), &install, &scratch)
        .with_timeout(Duration::from_secs(90));
    let launcher = Capturing { inner: &production, printed: RefCell::new(Vec::new()) };
    let state = temp("real-broker-state");
    let port = PackagedBrokerExecution::for_fixture(
        &launcher,
        &FixedClock,
        broker,
        fixture_policy(),
        BrokerRoots {
            install_root: install.to_string_lossy().into_owned(),
            state_dir: state.to_string_lossy().into_owned(),
            governed_root: install.to_string_lossy().into_owned(),
        },
    );

    let refusal = port.execute(&host_request(&head)).unwrap_err();
    assert_eq!(refusal, ExecutionFailure::ProviderUnavailable, "retained: the Host cannot prove nothing was dispatched");

    let printed = String::from_utf8_lossy(&launcher.printed.borrow()).to_lowercase();
    assert!(
        printed.contains("credential") || printed.contains("vault") || printed.contains("adapter") || printed.contains("powershell"),
        "the broker should have stopped at its credential stage, but said: {printed}"
    );
    for earlier in ["cannot be bound", "states no ", "is for project", "is for phase", "is for subject", "is for ask", "more than once", "request id", "does not authorise", "not a question", "contains no commit", "not the one this call was prepared for"] {
        assert!(!printed.contains(earlier), "refused at an EARLIER gate ({earlier}): {printed}");
    }
    // THE SPEND WAS RESERVED before the credential was wanted - which is exactly why the Host retains.
    let ledger = state.join("gatekeeper-spend.json");
    assert!(ledger.is_file(), "the broker reserved the call in the installation's spend ledger");
    cleanup(&install);
    cleanup(&scratch);
    cleanup(&state);
}
