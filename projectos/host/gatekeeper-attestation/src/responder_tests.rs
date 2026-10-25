//! Proofs for the review subject, the response record and the responder. PROJECTOS-HOST-REVIEW-PATH1A.
//!
//! Every test here drives the REAL steps 4-8 of the operation through the fixture entry, so what is
//! asserted about a record is asserted about a record the real mint produced.

use sha2::{Digest, Sha256};

use projectos_host_identity::{
    committed_candidate_digest, phase_identity_digest, plan_identity_digest,
    project_identity_digest, repository_identity_digest,
};

use super::*;
use crate::envelope::{ASK_CLOSURE, ASK_GATEKEEPER};
use crate::operation::evidence_fixture::{
    fixture_policy, FixtureCandidateEvidence, FIXTURE_BASELINE_COMMIT,
};
use crate::provider_request::HostProviderRequest;
use crate::operation::CandidateEvidencePort;
use crate::operation::{
    run_gatekeeper_review_attested_for_fixture, AttestationStorePort, ClockPort,
    CommittedBytesPort, ExecutablePolicyPort, ExecutionFailure, GatekeeperExecutionPort,
    HostAttestation, HostPorts, ProviderOutcome, ReviewVerdict, ReviewedDecision, StoreOutcome,
    TrustManifestPort,
};
use crate::{InboxReader, RequestFileIdentity, RequestLifecycle, CORRELATION_LEN, DIGEST_LEN};

const PROJECT: &str = "projectos";
const REPOSITORY: &str = "C:/dev/ProjectOS";
const PLAN: &str = "plan-a45a693cb1a5f4b2-e9e72d69fc4a";
const PHASE: &str = "PROJECTOS-HOST-REVIEW-PATH1A";
const COMMIT: &str = "20fe0722528af748504baf9c094818c003a95ef7";
const OTHER_COMMIT: &str = "7e15629506400000000000000000000000000000";
const CORRELATION: [u8; CORRELATION_LEN] = [0xc7; CORRELATION_LEN];

fn sha(b: &[u8]) -> [u8; DIGEST_LEN] {
    Sha256::digest(b).into()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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
struct Inbox(Vec<u8>);
impl InboxReader for Inbox {
    fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn std::io::Read + '_>> {
        Some(Box::new(std::io::Cursor::new(self.0.clone())))
    }
}
struct Execution {
    answer: Result<ProviderOutcome, ExecutionFailure>,
    calls: std::cell::Cell<u32>,
}
impl Execution {
    fn answering(answer: Result<ProviderOutcome, ExecutionFailure>) -> Self {
        Self {
            answer,
            calls: std::cell::Cell::new(0),
        }
    }
}
impl GatekeeperExecutionPort for Execution {
    fn execute(&self, _s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        self.calls.set(self.calls.get() + 1);
        self.answer.clone()
    }
}
struct Clock;
impl ClockPort for Clock {
    fn now_epoch_s(&self) -> u64 {
        1_000
    }
}
struct Store(StoreOutcome);
impl AttestationStorePort for Store {
    fn store_once(&mut self, _a: &HostAttestation) -> StoreOutcome {
        self.0
    }
}

#[derive(Default)]
struct Sink {
    refuse: bool,
    written: Vec<(String, Vec<u8>)>,
}
impl ResponseRecordSink for Sink {
    fn store_once(&mut self, identity: &ResponseFileIdentity, record: &[u8]) -> bool {
        if self.refuse || self.written.iter().any(|(n, _)| n == identity.file_name()) {
            return false;
        }
        self.written
            .push((identity.file_name().to_owned(), record.to_vec()));
        true
    }
}

fn outcome(verdict_word: &str, class: ReviewVerdict) -> ProviderOutcome {
    ProviderOutcome {
        provider_response_id: "resp_fixture".into(),
        provider: "openai".into(),
        model: "gpt-5.6-terra".into(),
        tier: "gatekeeper".into(),
        verdict: class,
        allowed_actions: vec!["continue-phase".into()],
        owner_approval_required: false,
        input_tokens: 2_000,
        output_tokens: 300,
        cached_input_tokens: Some(1_500),
        decision: ReviewedDecision {
            decision_id: "GKDEC-fixture".into(),
            verdict: verdict_word.into(),
            reason: "independently reviewed".into(),
            next_instruction: "continue".into(),
            forbidden_actions: vec!["production-deploy".into()],
            decided_by: "ChatGPT".into(),
            decided_at: "2026-09-19T00:00:00Z".into(),
        },
    }
}

fn approved() -> ProviderOutcome {
    outcome("APPROVED_TO_PROCEED", ReviewVerdict::ApprovedToProceed)
}

/// A subject whose every declaration is true of [`facts`].
fn subject_json(ask: &str, commit: &str, project: &str) -> Vec<u8> {
    format!(
        concat!(
            "{{\"schemaVersion\":1,\"ask\":\"{ask}\",\"correlation\":\"{corr}\",\"declared\":{{",
            "\"projectId\":\"{project}\",\"repository\":\"{repo}\",\"planRef\":\"{plan}\",",
            "\"phaseId\":\"{phase}\",\"subjectCommit\":\"{commit}\",\"requestId\":\"GKREQ-1\",",
            "\"requestDigest\":\"{rd}\"}},\"providerRequest\":\"{{}}\"}}"
        ),
        ask = ask,
        corr = hex_of(&CORRELATION),
        project = project,
        repo = REPOSITORY,
        plan = PLAN,
        phase = PHASE,
        commit = commit,
        rd = "ab".repeat(32),
    )
    .into_bytes()
}

fn facts(parameter_digest: &[u8; DIGEST_LEN]) -> ReviewContext<'_> {
    ReviewContext {
        project: project_identity_digest(PROJECT),
        repository: repository_identity_digest(REPOSITORY),
        plan: plan_identity_digest(PLAN),
        plan_digest: [0x44; DIGEST_LEN],
        phase: phase_identity_digest(PHASE),
        candidate_digest: committed_candidate_digest(COMMIT).expect("canonical oid"),
        correlation: CORRELATION,
        delegation_id: [0x88; DIGEST_LEN],
        parameter_digest,
        baseline_commit: FIXTURE_BASELINE_COMMIT,
    }
}

/// Drive the real steps 4-8 through the responder.
fn drive(body: &[u8], exec: &Execution, store: StoreOutcome, sink: &mut Sink) -> ReviewResponse {
    let digest = sha(body);
    let ctx = facts(&digest);
    let inbox = Inbox(body.to_vec());
    let ports = HostPorts {
        manifest: &NoManifest,
        committed: &NoCommitted,
        executables: &Trusted,
        inbox: &inbox,
        execution: exec,
        clock: &Clock,
        evidence: &FixtureCandidateEvidence {
            candidate: COMMIT.to_string(),
            ..FixtureCandidateEvidence::default()
        },
    };
    let mut lifecycle = RequestLifecycle::default();
    let mut store = Store(store);
    respond(
        |gate| {
            run_gatekeeper_review_attested_for_fixture(
                &ports,
                &mut lifecycle,
                &mut store,
                &ctx,
                gate,
                &fixture_policy(),
            )
        },
        &ctx,
        sink,
    )
}

fn record_of(sink: &Sink) -> serde_json::Value {
    assert_eq!(sink.written.len(), 1, "exactly one record");
    serde_json::from_slice(&sink.written[0].1).expect("the record is JSON")
}

/// THE ONE PATH THAT WORKS: an attested record, bound to the wire by its own digest, carrying the
/// Host's facts, the verified declarations, the reviewer's decision and the attestation.
#[test]
fn an_attested_review_writes_one_record_bound_by_its_evidence_ref() {
    let exec = Execution::answering(Ok(approved()));
    let mut sink = Sink::default();

    let response = drive(
        &subject_json(ASK_GATEKEEPER, COMMIT, PROJECT),
        &exec,
        StoreOutcome::Stored,
        &mut sink,
    );

    let ReviewResponse::Attested { evidence_ref, bill } = response else {
        panic!("expected an attested response, got {response:?}");
    };
    assert_eq!(exec.calls.get(), 1);
    assert_eq!(evidence_ref, evidence_ref_of(&sink.written[0].1));
    assert_eq!(
        sink.written[0].0,
        format!("{}.response", hex_of(&CORRELATION))
    );
    assert_eq!(
        bill,
        ReviewBill {
            input_tokens: 2_000,
            cached_input_tokens: Some(1_500),
            output_tokens: 300,
            admitted_cost_micro_usd: fixture_policy().admitted_cost_micro_usd(),
        }
    );

    let record = record_of(&sink);
    assert_eq!(record["outcome"], "attested");
    assert_eq!(record["providerDispatched"], true);
    assert_eq!(record["ask"], ASK_GATEKEEPER);
    assert_eq!(record["correlation"], hex_of(&CORRELATION));
    assert_eq!(record["declared"]["subjectCommit"], COMMIT);
    assert_eq!(record["declared"]["requestId"], "GKREQ-1");
    assert_eq!(record["decision"]["verdict"], "APPROVED_TO_PROCEED");
    assert_eq!(record["decision"]["decidedBy"], "ChatGPT");
    let attestation = &record["attestation"];
    assert_eq!(attestation["verdict"], "ApprovedToProceed");
    assert_eq!(
        attestation["project"],
        hex_of(&project_identity_digest(PROJECT))
    );
    assert_eq!(attestation["phase"], hex_of(&phase_identity_digest(PHASE)));
    assert_eq!(attestation["planDigest"], hex_of(&[0x44; DIGEST_LEN]));
    assert_eq!(
        attestation["candidateDigest"],
        hex_of(&committed_candidate_digest(COMMIT).expect("oid"))
    );
    // PROJECTOS-HOST-REVIEW-PATH1B: the record the agent is shown states where the candidate was measured
    // from and the digest of the evidence the reviewer saw, so the agent can recompute and compare.
    assert_eq!(attestation["schemaVersion"], 2);
    assert_eq!(attestation["baselineCommit"], "b4".repeat(20));
    let expected_evidence = FixtureCandidateEvidence {
        candidate: COMMIT.to_string(),
        ..FixtureCandidateEvidence::default()
    }
    .candidate_evidence(&"b4".repeat(20))
    .unwrap()
    .digest();
    assert_eq!(attestation["evidenceDigest"], hex_of(&expected_evidence));
    assert_eq!(attestation["delegationId"], hex_of(&[0x88; DIGEST_LEN]));
    assert_eq!(attestation["requestCorrelation"], hex_of(&CORRELATION));
    assert_eq!(record["usage"]["cachedInputTokens"], 1_500);

    // AN ADMITTED AMOUNT IS NOT A COST (PROJECTOS-HOST-REVIEW-PATH1B). Revision 2 states what the Host
    // ADMITTED against the budget - the owner-signed policy figure - under a name that says so, and
    // states NOTHING about what a provider billed: the Host has no rate card. Checked over every key of
    // the attestation AND the whole record, so the claim cannot reappear under another spelling.
    assert_eq!(
        attestation["admittedCostMicroUsd"],
        fixture_policy().admitted_cost_micro_usd()
    );
    let keys = |v: &serde_json::Value| -> Vec<String> {
        v.as_object().expect("an object").keys().map(|k| k.to_lowercase()).collect()
    };
    let cost_like: Vec<String> = keys(attestation)
        .into_iter()
        .chain(keys(&record))
        .chain(keys(&record["usage"]))
        .filter(|k| k.contains("cost") || k.contains("bill") || k.contains("price") || k.contains("accounted"))
        .collect();
    assert_eq!(cost_like, vec!["admittedcostmicrousd".to_string()]);
}

/// THE RECORD CARRIES NOTHING IT WAS NOT GIVEN A FIELD FOR. The opaque provider request - the one
/// place a prompt lives - never appears in the answer.
#[test]
fn the_record_never_echoes_the_provider_request() {
    let exec = Execution::answering(Ok(approved()));
    let mut sink = Sink::default();
    let body = String::from_utf8(subject_json(ASK_GATEKEEPER, COMMIT, PROJECT))
        .expect("utf8")
        .replace(
            "\"providerRequest\":\"{}\"",
            "\"providerRequest\":\"SENTINEL-PROMPT-TEXT\"",
        );

    drive(body.as_bytes(), &exec, StoreOutcome::Stored, &mut sink);

    let written = String::from_utf8(sink.written[0].1.clone()).expect("utf8");
    assert!(!written.contains("SENTINEL-PROMPT-TEXT"));
    assert!(!written.contains("providerRequest"));
}

/// A SUBJECT ABOUT ANOTHER CANDIDATE IS REFUSED BEFORE ANYTHING EXECUTES. The authority was minted for
/// one commit; text asking the reviewer about a different one never reaches a provider.
#[test]
fn a_subject_declaring_another_candidate_never_executes_and_writes_nothing() {
    let exec = Execution::answering(Ok(approved()));
    let mut sink = Sink::default();

    let response = drive(
        &subject_json(ASK_GATEKEEPER, OTHER_COMMIT, PROJECT),
        &exec,
        StoreOutcome::Stored,
        &mut sink,
    );

    assert_eq!(response, ReviewResponse::NotStarted);
    assert_eq!(exec.calls.get(), 0);
    assert!(sink.written.is_empty());
}

/// The same, for each of the other verified declarations and for the correlation.
#[test]
fn every_verified_declaration_is_compared_with_the_hosts_own_fact() {
    let good = String::from_utf8(subject_json(ASK_GATEKEEPER, COMMIT, PROJECT)).expect("utf8");
    let other_correlation = hex_of(&[0xc8; CORRELATION_LEN]);
    let swaps: [(&str, &str); 5] = [
        (PROJECT, "another-project"),
        (REPOSITORY, "C:/dev/Elsewhere"),
        (PLAN, "plan-0000000000000000-000000000000"),
        (PHASE, "SOME-OTHER-PHASE"),
        (&hex_of(&CORRELATION), &other_correlation),
    ];
    for (from, to) in swaps {
        let exec = Execution::answering(Ok(approved()));
        let mut sink = Sink::default();
        let body = good.replacen(from, to, 1);
        assert_ne!(body, good, "the swap must change the subject: {from}");

        let response = drive(body.as_bytes(), &exec, StoreOutcome::Stored, &mut sink);

        assert_eq!(response, ReviewResponse::NotStarted, "swapped {from}");
        assert_eq!(exec.calls.get(), 0, "swapped {from}");
        assert!(sink.written.is_empty(), "swapped {from}");
    }
}

/// STRICT PARSE. An unknown field, an unknown schema version, an unknown ask, an upper-case or short
/// commit and a body that is not JSON are all refusals - none is defaulted or normalised.
#[test]
fn a_malformed_subject_is_refused_not_repaired() {
    let good = String::from_utf8(subject_json(ASK_GATEKEEPER, COMMIT, PROJECT)).expect("utf8");
    let bad: Vec<String> = vec![
        good.replacen("\"schemaVersion\":1", "\"schemaVersion\":2", 1),
        good.replacen("\"ask\":\"gatekeeper\"", "\"ask\":\"self-review\"", 1),
        good.replacen("\"requestId\"", "\"extra\":1,\"requestId\"", 1),
        good.replacen(
            "{\"schemaVersion\"",
            "{\"credential\":\"x\",\"schemaVersion\"",
            1,
        ),
        good.replacen(COMMIT, &COMMIT.to_uppercase(), 1),
        good.replacen(COMMIT, &COMMIT[..39], 1),
        good.replacen(COMMIT, &format!("{COMMIT}{}", "0".repeat(24)), 1),
        "not json".to_owned(),
        format!("{good} trailing"),
    ];
    for body in bad {
        let exec = Execution::answering(Ok(approved()));
        let mut sink = Sink::default();

        let response = drive(body.as_bytes(), &exec, StoreOutcome::Stored, &mut sink);

        assert_eq!(response, ReviewResponse::NotStarted, "{body}");
        assert_eq!(exec.calls.get(), 0, "{body}");
    }
}

/// THE DISPATCH FACT IS THE HOST'S, per failure class - and a failure still writes a bound record.
#[test]
fn a_failed_execution_writes_a_failure_record_with_the_hosts_dispatch_fact() {
    let cases = [
        (ExecutionFailure::CredentialUnavailable, false),
        (ExecutionFailure::ProviderUnavailable, true),
        (ExecutionFailure::ProviderResultUnusable, true),
    ];
    for (failure, dispatched) in cases {
        let exec = Execution::answering(Err(failure));
        let mut sink = Sink::default();

        let response = drive(
            &subject_json(ASK_CLOSURE, COMMIT, PROJECT),
            &exec,
            StoreOutcome::Stored,
            &mut sink,
        );

        let ReviewResponse::Failed {
            evidence_ref,
            provider_dispatched,
            bill,
        } = response
        else {
            panic!("expected a failure for {failure:?}, got {response:?}");
        };
        assert_eq!(provider_dispatched, dispatched, "{failure:?}");
        assert_eq!(bill, None);
        assert_eq!(evidence_ref, evidence_ref_of(&sink.written[0].1));
        let record = record_of(&sink);
        assert_eq!(record["outcome"], "failed");
        assert_eq!(record["providerDispatched"], dispatched);
        assert_eq!(record["ask"], ASK_CLOSURE);
        assert!(record.get("decision").is_none());
        assert!(record.get("attestation").is_none());
        assert!(record.get("usage").is_none());
    }
}

/// An attestation that could not be stored happened AFTER a provider answered. (There is no "unknown
/// cost" case any more: the outcome states no cost, and the admitted amount is the policy's.)
#[test]
fn a_failed_attestation_store_is_a_dispatched_failure() {
    for (answer, store) in [
        (approved(), StoreOutcome::Failed),
        (approved(), StoreOutcome::AlreadyStored),
    ] {
        let exec = Execution::answering(Ok(answer));
        let mut sink = Sink::default();

        let response = drive(
            &subject_json(ASK_GATEKEEPER, COMMIT, PROJECT),
            &exec,
            store,
            &mut sink,
        );

        assert!(
            matches!(
                response,
                ReviewResponse::Failed {
                    provider_dispatched: true,
                    bill: None,
                    ..
                }
            ),
            "{response:?}"
        );
        assert_eq!(record_of(&sink)["providerDispatched"], true);
    }
}

/// A REVIEWER'S WORD AND ITS CLASS MUST BE ONE ANSWER. A provider path reporting "DO_NOT_PROCEED" as
/// an approval mints nothing: it is an unusable result, and it was dispatched.
#[test]
fn an_inconsistent_verdict_pair_mints_no_attestation() {
    for answer in [
        outcome("DO_NOT_PROCEED", ReviewVerdict::ApprovedToProceed),
        outcome("LOOKS_GREAT", ReviewVerdict::ApprovedToProceed),
        outcome("APPROVED_TO_COMMIT", ReviewVerdict::ApprovedToProceed),
    ] {
        let exec = Execution::answering(Ok(answer));
        let mut sink = Sink::default();

        let response = drive(
            &subject_json(ASK_GATEKEEPER, COMMIT, PROJECT),
            &exec,
            StoreOutcome::Stored,
            &mut sink,
        );

        assert!(
            matches!(
                response,
                ReviewResponse::Failed {
                    provider_dispatched: true,
                    bill: None,
                    ..
                }
            ),
            "{response:?}"
        );
        assert_eq!(record_of(&sink)["outcome"], "failed");
    }
}

/// THE ANSWER WAS PAID FOR AND THE RECORD WAS LOST. The bill is known, so it is reported; the evidence
/// reference is zero because there is no record for it to bind.
#[test]
fn a_record_that_cannot_be_written_is_a_dispatched_failure_with_a_known_bill() {
    let exec = Execution::answering(Ok(approved()));
    let mut sink = Sink {
        refuse: true,
        ..Sink::default()
    };

    let response = drive(
        &subject_json(ASK_GATEKEEPER, COMMIT, PROJECT),
        &exec,
        StoreOutcome::Stored,
        &mut sink,
    );

    let ReviewResponse::Failed {
        evidence_ref,
        provider_dispatched,
        bill,
    } = response
    else {
        panic!("expected a failure, got {response:?}");
    };
    assert_eq!(evidence_ref, [0u8; EVIDENCE_REF_LEN]);
    assert!(provider_dispatched);
    assert_eq!(
        bill.map(|b| b.admitted_cost_micro_usd),
        Some(fixture_policy().admitted_cost_micro_usd())
    );
}

/// IDENTICAL INPUTS, IDENTICAL BYTES - which is what lets sixteen bytes of digest mean something.
#[test]
fn the_record_encoding_is_deterministic() {
    let run = || {
        let exec = Execution::answering(Ok(approved()));
        let mut sink = Sink::default();
        drive(
            &subject_json(ASK_GATEKEEPER, COMMIT, PROJECT),
            &exec,
            StoreOutcome::Stored,
            &mut sink,
        );
        sink.written.remove(0).1
    };
    assert_eq!(run(), run());
}

/// The response identity is derived exactly as the request identity is: hex and a fixed extension.
#[test]
fn a_response_identity_can_only_ever_be_hex_and_a_fixed_extension() {
    let identity = ResponseFileIdentity::for_correlation(&[0xff; CORRELATION_LEN]);
    assert_eq!(
        identity.file_name(),
        format!("{}.response", "ff".repeat(CORRELATION_LEN))
    );
    assert!(!identity.file_name().contains(['/', '\\', ':']));
    assert_eq!(crate::RESPONSE_RELATIVE_ROOT, "gatekeeper-outbox");
}
