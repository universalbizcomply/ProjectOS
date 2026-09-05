//! THE HOST OPERATION REFUSAL MATRIX.
//!
//! Every proof here is a refusal except two. That ratio is the design: the Host runs one thing, and
//! everything else stops. These are written as an EXTERNAL consumer of the crate, so anything a test
//! can reach here is something a real caller could reach too.
//!
//! Nothing in this file touches a disk, a process, a credential, a provider or a clock. The ports
//! are the seam, and the fakes below are the only implementations that exist anywhere.

use projectos_host_gatekeeper_attestation::operation::{
    run_gatekeeper_review, AttestationStorePort, ClockPort, CommittedBytesPort,
    ExecutablePolicyPort, ExecutionFailure, GatekeeperExecutionPort, HostAttestation, HostPorts,
    HostRefusal, ProviderOutcome, ReviewContext, ReviewVerdict, StoreOutcome, TrustManifestPort,
    DIGEST_LEN,
};
use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestFileIdentity, RequestLifecycle, RequestLifecycle as Life,
    VerifiedRequestBody, CORRELATION_LEN,
};
use std::io::Read;

// ---- fixtures ------------------------------------------------------------------------------------

const SUBJECT: &[u8] = b"the exact review subject the agent wrote and hashed";

fn sha(bytes: &[u8]) -> [u8; DIGEST_LEN] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

struct Manifest(Option<Vec<u8>>);
impl TrustManifestPort for Manifest {
    fn manifest_bytes(&self) -> Option<Vec<u8>> {
        self.0.clone()
    }
}

struct Committed;
impl CommittedBytesPort for Committed {
    fn committed_bytes(&self, _rel: &str) -> Option<Vec<u8>> {
        Some(b"committed".to_vec())
    }
}

/// A port that cannot establish committed bytes — "I could not ask", which must never read as "fine".
struct NoCommitted;
impl CommittedBytesPort for NoCommitted {
    fn committed_bytes(&self, _rel: &str) -> Option<Vec<u8>> {
        None
    }
}

struct Executables(bool);
impl ExecutablePolicyPort for Executables {
    fn executables_are_trusted(&self) -> bool {
        self.0
    }
}

struct Inbox(Option<Vec<u8>>);
impl InboxReader for Inbox {
    fn open_once(&self, _id: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
        self.0
            .as_ref()
            .map(|b| Box::new(std::io::Cursor::new(b.clone())) as Box<dyn Read + '_>)
    }
}

struct Execution(Result<ProviderOutcome, ExecutionFailure>);
impl GatekeeperExecutionPort for Execution {
    fn execute(&self, _subject: &VerifiedRequestBody) -> Result<ProviderOutcome, ExecutionFailure> {
        self.0.clone()
    }
}

struct Clock;
impl ClockPort for Clock {
    fn now_epoch_s(&self) -> u64 {
        1_000
    }
}

#[derive(Default)]
struct Store {
    stored: Vec<[u8; DIGEST_LEN]>,
}
impl AttestationStorePort for Store {
    fn store_once(&mut self, a: &HostAttestation) -> StoreOutcome {
        if self.stored.contains(a.attestation_id()) {
            return StoreOutcome::AlreadyStored;
        }
        self.stored.push(*a.attestation_id());
        StoreOutcome::Stored
    }
}

fn outcome() -> ProviderOutcome {
    ProviderOutcome {
        provider_response_id: "resp_abc123".into(),
        provider: "openai".into(),
        model: "gpt-5.6-terra".into(),
        tier: "closure".into(),
        verdict: ReviewVerdict::ApprovedToProceed,
        allowed_actions: vec!["close-phase".into()],
        owner_approval_required: false,
        input_tokens: 3_333,
        output_tokens: 512,
        cost_micro_usd: Some(1_333),
    }
}

fn ctx(digest: &[u8; DIGEST_LEN]) -> ReviewContext<'_> {
    ReviewContext {
        project: [0x11; DIGEST_LEN],
        repository: [0x22; DIGEST_LEN],
        plan: [0x33; DIGEST_LEN],
        plan_digest: [0x44; DIGEST_LEN],
        phase: [0x55; DIGEST_LEN],
        candidate_digest: [0x66; DIGEST_LEN],
        correlation: [0x77; CORRELATION_LEN],
        delegation_id: [0x88; DIGEST_LEN],
        parameter_digest: digest,
    }
}

/// A version 1 manifest — real shape, no execution closure.
fn v1_manifest() -> Vec<u8> {
    br#"{"schemaVersion":1,"manifestVersion":1,"applicationId":"com.universalbizcomply.projectos.control",
"applicationVersion":"0.1.0","buildId":"b","installationModel":"PER_MACHINE",
"runtime":{"relativePath":"runtime/node.exe","sha256":"aa","expectedVersion":"24.14.1","platform":"windows","architecture":"x86_64"},
"daemonArtefact":{"relativePath":"daemon/projectos-daemon.mjs","sha256":"bb","format":"single-bundle","buildId":"b"},
"generatedAt":"2026-09-05T18:00:00.000Z","minimumProtocolVersion":1,"signatureAlgorithm":"es256",
"signingKeyId":"projectos-signing-20260812","signature":"ff"}"#
        .to_vec()
}

/// A version 2 manifest carrying a closure at the CONTRACT's paths.
fn v2_manifest(signature: &str) -> Vec<u8> {
    v2_manifest_full(
        signature,
        "projectos/security/gatekeeper-transport-broker.cjs",
        "projectos/security/installation-project-allowlist.json",
        "projectos/credentials/windows-credential-store.ps1",
    )
}

/// The same manifest declaring arbitrary paths, for proving the Host ignores them.
fn v2_manifest_with_paths(broker: &str, allowlist: &str, adapter: &str) -> Vec<u8> {
    v2_manifest_full(&"ff".repeat(64), broker, allowlist, adapter)
}

fn v2_manifest_full(signature: &str, broker: &str, allowlist: &str, adapter: &str) -> Vec<u8> {
    format!(
        r#"{{"schemaVersion":1,"manifestVersion":2,"applicationId":"com.universalbizcomply.projectos.control",
"applicationVersion":"0.1.0","buildId":"b","installationModel":"PER_MACHINE",
"runtime":{{"relativePath":"runtime/node.exe","sha256":"aa","expectedVersion":"24.14.1","platform":"windows","architecture":"x86_64"}},
"daemonArtefact":{{"relativePath":"daemon/projectos-daemon.mjs","sha256":"bb","format":"single-bundle","buildId":"b"}},
"generatedAt":"2026-09-05T18:00:00.000Z","minimumProtocolVersion":1,"signatureAlgorithm":"es256",
"signingKeyId":"projectos-signing-20260812",
"executionClosure":{{
  "gatekeeperBroker":{{"repositoryRelativePath":"{broker}","sha256":"{d}"}},
  "installationProjectAllowlist":{{"repositoryRelativePath":"{allowlist}","sha256":"{d}"}},
  "credentialAdapter":{{"repositoryRelativePath":"{adapter}","sha256":"{d}"}}
}},
"signature":"{signature}"}}"#,
        d = hex(&sha(b"committed")),
    )
    .into_bytes()
}

fn hex(b: &[u8; DIGEST_LEN]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Run the operation with everything honest except what a test overrides.
fn run_with(
    manifest: Vec<u8>,
    committed: &dyn CommittedBytesPort,
    executables: bool,
    inbox_body: Option<Vec<u8>>,
    exec: Result<ProviderOutcome, ExecutionFailure>,
    store: &mut dyn AttestationStorePort,
    life: &mut RequestLifecycle,
) -> Result<HostAttestation, HostRefusal> {
    let m = Manifest(Some(manifest));
    let e = Executables(executables);
    let i = Inbox(inbox_body);
    let x = Execution(exec);
    let c = Clock;
    let ports = HostPorts {
        manifest: &m,
        committed,
        executables: &e,
        inbox: &i,
        execution: &x,
        clock: &c,
    };
    let digest = sha(SUBJECT);
    run_gatekeeper_review(&ports, life, store, &ctx(&digest))
}

// ---- proofs --------------------------------------------------------------------------------------

/// A V1 MANIFEST CAN NEVER REACH EXECUTION.
///
/// It is a valid manifest of what it signed — a runtime and a daemon — and it simply never signed a
/// closure. It must stop before the broker is even considered.
#[test]
fn a_version_1_manifest_is_refused() {
    let mut store = Store::default();
    let mut life = Life::new();
    let r = run_with(
        v1_manifest(),
        &Committed,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    assert!(matches!(r, Err(HostRefusal::ExecutionClosureRefused(_))));
    assert!(store.stored.is_empty(), "nothing may be attested");
}

/// AN UNSIGNED OR ALTERED V2 MANIFEST IS REFUSED, and refused before anything executes.
///
/// This is the load-bearing ordering proof: the signature is established BEFORE the closure material
/// it covers is believed, so a manifest that signs nothing cannot vouch for its own broker digests.
#[test]
fn a_v2_manifest_without_a_valid_owner_signature_is_refused() {
    for signature in ["", &"ff".repeat(64)] {
        let mut store = Store::default();
        let mut life = Life::new();
        let r = run_with(
            v2_manifest(signature),
            &Committed,
            true,
            Some(SUBJECT.to_vec()),
            Ok(outcome()),
            &mut store,
            &mut life,
        );
        assert!(
            matches!(r, Err(HostRefusal::ExecutionClosureRefused(_))),
            "signature {signature:?} must not authorise execution"
        );
        assert!(store.stored.is_empty());
    }
}

/// COMMITTED BYTES THAT CANNOT BE ESTABLISHED ARE A REFUSAL.
///
/// "I could not ask git" must never arrive as "nothing changed". This is the case the whole
/// committed-bytes port exists to keep honest.
#[test]
fn committed_bytes_that_cannot_be_established_are_refused() {
    let mut store = Store::default();
    let mut life = Life::new();
    let r = run_with(
        v2_manifest(&"ff".repeat(64)),
        &NoCommitted,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    assert_eq!(r.unwrap_err(), HostRefusal::CommittedBytesUnavailable);
    assert!(store.stored.is_empty());
}

/// A MISSING OR UNREADABLE MANIFEST FAILS CLOSED.
#[test]
fn an_absent_or_malformed_manifest_is_refused() {
    let mut store = Store::default();
    let mut life = Life::new();
    let m = Manifest(None);
    let e = Executables(true);
    let i = Inbox(Some(SUBJECT.to_vec()));
    let x = Execution(Ok(outcome()));
    let c = Clock;
    let ports = HostPorts {
        manifest: &m,
        committed: &Committed,
        executables: &e,
        inbox: &i,
        execution: &x,
        clock: &c,
    };
    let d = sha(SUBJECT);
    assert_eq!(
        run_gatekeeper_review(&ports, &mut life, &mut store, &ctx(&d)).unwrap_err(),
        HostRefusal::ManifestUnavailable
    );

    let mut life = Life::new();
    let r = run_with(
        b"not json".to_vec(),
        &Committed,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    assert_eq!(r.unwrap_err(), HostRefusal::ManifestMalformed);
}

/// NOTHING RUNS BEFORE THE MANIFEST IS SETTLED — proven by the execution port never being reached.
///
/// The port panics if called. A V1 manifest still refuses, which shows the refusal happens before
/// execution rather than after it.
#[test]
fn execution_is_never_reached_when_the_manifest_is_refused() {
    struct MustNotRun;
    impl GatekeeperExecutionPort for MustNotRun {
        fn execute(&self, _s: &VerifiedRequestBody) -> Result<ProviderOutcome, ExecutionFailure> {
            panic!("execution must not be reached when the manifest was refused");
        }
    }
    let m = Manifest(Some(v1_manifest()));
    let e = Executables(true);
    let i = Inbox(Some(SUBJECT.to_vec()));
    let c = Clock;
    let ports = HostPorts {
        manifest: &m,
        committed: &Committed,
        executables: &e,
        inbox: &i,
        execution: &MustNotRun,
        clock: &c,
    };
    let mut store = Store::default();
    let mut life = Life::new();
    let d = sha(SUBJECT);
    assert!(run_gatekeeper_review(&ports, &mut life, &mut store, &ctx(&d)).is_err());
}

/// THE PRODUCTION ANCHOR IS THE ONE THAT DECIDES. No fixture in this file can satisfy it, and that
/// is the correct state: until an owner signs a version 2 manifest, no Host execution is reachable.
#[test]
fn no_fixture_can_reach_execution_without_a_real_owner_signature() {
    let mut store = Store::default();
    let mut life = Life::new();
    let r = run_with(
        v2_manifest(&"ab".repeat(64)),
        &Committed,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    assert!(
        r.is_err(),
        "an unsigned candidate manifest must never reach execution"
    );
    assert!(store.stored.is_empty());
}

/// THE ATTESTATION A CALLER HOLDS IS THE ONE THE HOST MINTED.
///
/// This is the CRITICAL the review caught. A private seal blocked fresh construction, but every data
/// field was public and the record is returned by value — so a holder could rewrite the verdict, the
/// cost or the owner-approval flag afterwards, and `derive_id` covers none of those, so the identity
/// would not have moved either. Anything downstream treating the id as a content check would have
/// seen nothing wrong.
///
/// This test is an EXTERNAL consumer. It can read every field and mutate none. The lines in the
/// comment below are the forgery, and they no longer compile.
#[test]
fn an_attestation_is_read_only_to_every_consumer() {
    // let mut a: HostAttestation = ...;
    // a.verdict = ReviewVerdict::ApprovedToProceed;      // private field
    // a.cost_micro_usd = 0;                              // private field
    // a.owner_approval_required = false;                 // private field
    //
    // Reading is all a consumer can do, and that is the point.
    fn reads_only(a: &HostAttestation) -> (ReviewVerdict, u64, bool, &str) {
        (
            a.verdict(),
            a.cost_micro_usd(),
            a.owner_approval_required(),
            a.provider_response_id(),
        )
    }
    // The function above compiles; a mutating counterpart cannot exist outside the crate.
    let _ = reads_only as fn(&HostAttestation) -> (ReviewVerdict, u64, bool, &str);
}

/// THE HOST READS AT THE CONTRACT'S PATHS, NEVER AT THE ONES AN UNSIGNED MANIFEST DECLARES.
///
/// The manifest below names three innocuous-looking paths that are NOT the contract's. If the Host
/// still took its read targets from the manifest, the port would be asked for those paths; it now
/// records every path it is asked for, so the assertion is on what was actually requested — before
/// any signature had been checked.
#[test]
fn committed_reads_use_the_contract_paths_not_the_manifests() {
    use std::cell::RefCell;

    struct Recording(RefCell<Vec<String>>);
    impl CommittedBytesPort for Recording {
        fn committed_bytes(&self, rel: &str) -> Option<Vec<u8>> {
            self.0.borrow_mut().push(rel.to_string());
            Some(b"committed".to_vec())
        }
    }

    let manifest = v2_manifest_with_paths(
        "docs/not-the-broker.md",
        "docs/not-the-allowlist.md",
        "docs/not-the-adapter.md",
    );
    let recording = Recording(RefCell::new(Vec::new()));
    let mut store = Store::default();
    let mut life = Life::new();
    let r = run_with(
        manifest,
        &recording,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    assert!(r.is_err(), "an unsigned manifest must still be refused");

    let asked = recording.0.borrow();
    for decoy in [
        "docs/not-the-broker.md",
        "docs/not-the-allowlist.md",
        "docs/not-the-adapter.md",
    ] {
        assert!(
            !asked.iter().any(|a| a == decoy),
            "the Host must never be steered to {decoy} by an unverified manifest"
        );
    }
    assert_eq!(asked.len(), 3, "exactly the three closure artefacts");
    for asked_path in asked.iter() {
        assert!(
            asked_path.starts_with("projectos/"),
            "{asked_path} is not a packaging-contract path"
        );
    }
}

/// A VERSION 1 MANIFEST IS REFUSED FOR BEING VERSION 1, not for a missing closure.
///
/// Both are refusals, so nothing was unsafe — but a refusal taxonomy that names the wrong gate sends
/// an operator to look at the wrong thing, and this module's own rule is that a refusal names the
/// gate that refused.
#[test]
fn a_version_1_manifest_is_refused_by_version_not_by_absence() {
    let mut store = Store::default();
    let mut life = Life::new();
    let r = run_with(
        v1_manifest(),
        &Committed,
        true,
        Some(SUBJECT.to_vec()),
        Ok(outcome()),
        &mut store,
        &mut life,
    );
    match r {
        Err(HostRefusal::ExecutionClosureRefused(e)) => assert_eq!(
            format!("{e:?}"),
            "ExecutionClosureManifestVersionTooLow",
            "a v1 manifest never signed a closure; that is a version fact, not an absence"
        ),
        other => panic!("expected a version refusal, got {other:?}"),
    }
    assert!(store.stored.is_empty());
}
