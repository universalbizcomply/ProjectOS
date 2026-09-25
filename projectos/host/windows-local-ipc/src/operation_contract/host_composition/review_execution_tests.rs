//! Proofs for the ONE shipped `GatekeeperReviewExecution`, driven through the REAL execution rung.
//!
//! The facts here are REAL canonical identity digests rather than filler bytes, because the responder's
//! subject gate hashes what the subject declares and compares it with what the Host resolved: a rig of
//! `[0x11; 32]` facts could never be named by any subject, and every test would prove only a refusal.
//!
//! What runs: the real composition (`compose_verified`), the real rung (`run_authorised_review`), the
//! real seam implementation, the real responder and the real steps 4-8 of the review operation. What
//! is a fixture: the session, the owner signature, the ledger and the provider - there is no provider,
//! no credential and no spend anywhere in this file.

use std::cell::Cell;
use std::io::Read;

use sha2::{Digest, Sha256};

use projectos_host_core::{
    FixtureClock, FixtureIpcSessionVerifier, InMemoryRequestAdmissionStore, IpcSessionVerifier,
};
use projectos_host_gatekeeper_attestation::provider_request::HostProviderRequest;
use projectos_host_gatekeeper_attestation::operation::evidence_fixture::FixtureCandidateEvidence;
use projectos_host_gatekeeper_attestation::envelope::evidence_ref_of;
use projectos_host_gatekeeper_attestation::operation::{
    AttestationStorePort, ClockPort, CommittedBytesPort, ExecutablePolicyPort, ExecutionFailure,
    GatekeeperExecutionPort, HostAttestation, HostPorts, ProviderOutcome, ReviewVerdict,
    ReviewedDecision, StoreOutcome, TrustManifestPort,
};
use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestFileIdentity, RequestLifecycle, ResponseFileIdentity, ResponseRecordSink,
    RetainedRequestInbox,
};
use projectos_host_identity::{
    committed_candidate_digest, credential_ref_identity_digest, model_policy_identity_digest,
    phase_identity_digest, plan_identity_digest, project_identity_digest,
    repository_identity_digest,
};

use super::super::*;
use super::HostReviewExecution;
use crate::fixture_session::fixture_bound_session;
use crate::operation_contract::request_replay::FixtureRequestReplayLedger;
use crate::operation_contract::{
    binding_digest, BindingSubject, OwnerProgrammeDelegation, ResponseState, MAX_DELEGATED_PHASES,
};

const PROJECT_ID: &str = "projectos";
const REPOSITORY_ID: &str = "C:/dev/ProjectOS";
const PLAN_REF: &str = "plan-a45a693cb1a5f4b2-e9e72d69fc4a";
const PHASE_ID: &str = "PROJECTOS-HOST-REVIEW-PATH1A";
const COMMIT: &str = "20fe0722528af748504baf9c094818c003a95ef7";
const OTHER_COMMIT: &str = "7e15629506400000000000000000000000000000";

const PLAN_DIGEST: [u8; DELEGATION_DIGEST_LEN] = [0x44; DELEGATION_DIGEST_LEN];
const DELEGATION_ID: [u8; DELEGATION_DIGEST_LEN] = [0xaa; DELEGATION_DIGEST_LEN];
const CORRELATION: [u8; CORRELATION_LEN] = [0x0c; CORRELATION_LEN];
const CEILING: u64 = 5_000_000;
const COMMITTED: u64 = 1_000_000;
const COST: u64 = 200_000;
const EPOCH: u64 = 42;

fn sha(b: &[u8]) -> [u8; BINDING_DIGEST_LEN] {
    Sha256::digest(b).into()
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn candidate() -> [u8; BINDING_DIGEST_LEN] {
    committed_candidate_digest(COMMIT).expect("a canonical oid")
}

fn delegation() -> OwnerProgrammeDelegation {
    let mut allowed_phases = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
    allowed_phases[0] = phase_identity_digest(PHASE_ID);
    OwnerProgrammeDelegation {
        delegation_id: DELEGATION_ID,
        owner: [0xbb; DELEGATION_DIGEST_LEN],
        project: project_identity_digest(PROJECT_ID),
        repository: repository_identity_digest(REPOSITORY_ID),
        plan: plan_identity_digest(PLAN_REF),
        plan_digest: PLAN_DIGEST,
        allowed_phases,
        allowed_phase_count: 1,
        operation: OperationClass::IndependentGatekeeperReview,
        model_policy: model_policy_identity_digest("gatekeeper-default"),
        credential_ref: credential_ref_identity_digest("openai-gatekeeper"),
        budget_ceiling_micro_usd: CEILING,
        expires_at_epoch_s: 2_000,
        revoked_or_completed: false,
    }
}

struct Plan;
/// The approved baseline commit every fixture plan authority states (PROJECTOS-HOST-REVIEW-PATH1B).
const FIXTURE_BASELINE: [u8; crate::BASELINE_COMMIT_LEN] = [0xb4; crate::BASELINE_COMMIT_LEN];

impl HostPlanAuthority for Plan {
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(plan_identity_digest(PLAN_REF))
    }
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(PLAN_DIGEST)
    }
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(phase_identity_digest(PHASE_ID))
    }
    fn approved_baseline(&self) -> Option<[u8; crate::BASELINE_COMMIT_LEN]> {
        Some(FIXTURE_BASELINE)
    }
}
struct Closure;
impl SignedExecutionClosureFacts for Closure {
    fn model_policy(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(model_policy_identity_digest("gatekeeper-default"))
    }
    fn credential_ref(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(credential_ref_identity_digest("openai-gatekeeper"))
    }
}
struct Candidate;
impl CommittedCandidateSource for Candidate {
    fn candidate_digest(&self) -> Option<[u8; BINDING_DIGEST_LEN]> {
        Some(candidate())
    }
}
struct Cost;
impl AdmittedCostSource for Cost {
    fn admitted_cost_micro_usd(&self) -> Option<u64> {
        Some(COST)
    }
}

/// The real inbox: ONE file, and a count of how often it was opened.
struct FileInbox {
    body: Vec<u8>,
    opens: Cell<u32>,
}
impl InboxReader for FileInbox {
    fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
        self.opens.set(self.opens.get() + 1);
        Some(Box::new(std::io::Cursor::new(self.body.clone())))
    }
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
struct Provider {
    answer: Result<ProviderOutcome, ExecutionFailure>,
    calls: Cell<u32>,
    saw: std::cell::RefCell<Vec<u8>>,
}
impl Provider {
    fn answering(answer: Result<ProviderOutcome, ExecutionFailure>) -> Self {
        Self {
            answer,
            calls: Cell::new(0),
            saw: std::cell::RefCell::new(Vec::new()),
        }
    }
}
impl GatekeeperExecutionPort for Provider {
    fn execute(&self, s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        self.calls.set(self.calls.get() + 1);
        *self.saw.borrow_mut() = s.framed().as_bytes().to_vec();
        self.answer.clone()
    }
}
#[derive(Default)]
struct Attestations(u32);
impl AttestationStorePort for Attestations {
    fn store_once(&mut self, _a: &HostAttestation) -> StoreOutcome {
        self.0 += 1;
        StoreOutcome::Stored
    }
}
#[derive(Default)]
struct Outbox(Vec<(String, Vec<u8>)>);
impl ResponseRecordSink for Outbox {
    fn store_once(&mut self, identity: &ResponseFileIdentity, record: &[u8]) -> bool {
        self.0.push((identity.file_name().to_owned(), record.to_vec()));
        true
    }
}

fn approved() -> ProviderOutcome {
    ProviderOutcome {
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
            forbidden_actions: vec!["production-deploy".into()],
            decided_by: "ChatGPT".into(),
            decided_at: "2026-09-19T00:00:00Z".into(),
        },
    }
}

fn subject_json(commit: &str) -> Vec<u8> {
    format!(
        concat!(
            "{{\"schemaVersion\":1,\"ask\":\"gatekeeper\",\"correlation\":\"{corr}\",\"declared\":{{",
            "\"projectId\":\"{project}\",\"repository\":\"{repo}\",\"planRef\":\"{plan}\",",
            "\"phaseId\":\"{phase}\",\"subjectCommit\":\"{commit}\",\"requestId\":\"GKREQ-1\",",
            "\"requestDigest\":\"{rd}\"}},\"providerRequest\":\"{{}}\"}}"
        ),
        corr = hex_of(&CORRELATION),
        project = PROJECT_ID,
        repo = REPOSITORY_ID,
        plan = PLAN_REF,
        phase = PHASE_ID,
        commit = commit,
        rd = "ab".repeat(32),
    )
    .into_bytes()
}

/// Which entry of the operation the seam is built on.
#[derive(Clone, Copy)]
enum Build {
    Production,
    FixtureAfterClosure,
}

struct Ran {
    response: ProtectedOperationResponse,
    ledger: FixtureBudgetLedger,
    provider_calls: u32,
    provider_saw: Vec<u8>,
    inbox_opens: u32,
    attestations: u32,
    outbox: Vec<(String, Vec<u8>)>,
}

/// One request, end to end: real composition, real rung, real seam, real responder, real operation.
fn run(body: &[u8], provider: Provider, build: Build) -> Ran {
    let clock = FixtureClock::new(150);
    let verifier = FixtureIpcSessionVerifier::new();
    let session = fixture_bound_session(&clock, &verifier);
    let mut admission = InMemoryRequestAdmissionStore::for_session(&session);
    let peer = TrustedPeerContext::for_admitted_connection(
        verifier.connection_id(),
        verifier.handshake_generation(),
    );
    let verified = VerifiedOwnerProgrammeDelegation::for_test(delegation());
    let programme = ExpectedProgramme::fixture(
        project_identity_digest(PROJECT_ID),
        repository_identity_digest(REPOSITORY_ID),
    );
    let mut ledger = FixtureBudgetLedger::holding(CEILING, COMMITTED);
    let mut replay = FixtureRequestReplayLedger::empty();

    let file = FileInbox {
        body: body.to_vec(),
        opens: Cell::new(0),
    };
    let mut inbox = RetainedRequestInbox::over(&file);

    // THE AGENT'S CLAIM: the binding digest over ITS OWN view of the same nine facts, and the digest
    // of the exact subject it wrote. The Host recomputes both and compares.
    let request = ProtectedOperationRequest::new(
        CORRELATION,
        1,
        EPOCH,
        binding_digest(&BindingSubject {
            project: project_identity_digest(PROJECT_ID),
            repository: repository_identity_digest(REPOSITORY_ID),
            plan: plan_identity_digest(PLAN_REF),
            plan_digest: PLAN_DIGEST,
            phase: phase_identity_digest(PHASE_ID),
            candidate_digest: candidate(),
            operation: OperationClass::IndependentGatekeeperReview,
            model_policy: model_policy_identity_digest("gatekeeper-default"),
            credential_ref: credential_ref_identity_digest("openai-gatekeeper"),
        }),
        OperationClass::IndependentGatekeeperReview,
        DELEGATION_ID,
        sha(body),
    );

    let composed = {
        let mut sources = HostRequestSources {
            plan: &Plan,
            closure: &Closure,
            candidate: &Candidate,
            cost: &Cost,
            subject: &mut inbox,
        };
        compose_verified(
            &verified,
            &programme,
            &HostClockReading::fixture(1_000),
            &mut sources,
            &mut ledger,
            &session,
            &mut admission,
            &mut replay,
            &peer,
            &request,
            EPOCH,
        )
        .expect("the exact case is authorised")
    };
    assert_eq!(ledger.available_micro_usd(), CEILING - COMMITTED - COST, "reserved");

    let mut lifecycle = RequestLifecycle::new();
    let mut attestations = Attestations::default();
    let mut outbox = Outbox::default();
    let response = {
        let ports = HostPorts {
            manifest: &NoManifest,
            committed: &NoCommitted,
            executables: &Trusted,
            inbox: &inbox,
            execution: &provider,
            clock: &Clock,
            evidence: &FixtureCandidateEvidence {
                candidate: COMMIT.to_string(),
                ..FixtureCandidateEvidence::default()
            },
        };
        let mut seam = match build {
            Build::Production => {
                HostReviewExecution::new(ports, &mut lifecycle, &mut attestations, &mut outbox)
            }
            Build::FixtureAfterClosure => HostReviewExecution::after_the_closure_for_fixture(
                ports,
                &mut lifecycle,
                &mut attestations,
                &mut outbox,
            ),
        };
        run_authorised_review(composed, &mut seam, &mut ledger)
    };

    Ran {
        response,
        ledger,
        provider_calls: provider.calls.get(),
        provider_saw: provider.saw.borrow().clone(),
        inbox_opens: file.opens.get(),
        attestations: attestations.0,
        outbox: outbox.0,
    }
}

/// THE WHOLE HOST HALF, ONCE: authorised, executed over the bytes that were hashed, attested, recorded,
/// bound to the wire by the record's own digest, and settled at what was billed.
#[test]
fn an_authorised_review_completes_with_a_record_bound_to_the_wire() {
    let body = subject_json(COMMIT);
    let ran = run(&body, Provider::answering(Ok(approved())), Build::FixtureAfterClosure);

    assert_eq!(ran.response.state(), ResponseState::Completed);
    assert_eq!(ran.response.result(), ResultClass::Succeeded);
    assert_eq!(ran.response.correlation(), &CORRELATION);
    assert_eq!(ran.provider_calls, 1);
    // PROJECTOS-HOST-REVIEW-PATH1B. WHAT EXECUTES IS THE HOST'S FRAME, and the hashed bytes are inside it
    // as the agent's labelled, unverified claim - after the Host's own evidence of the candidate, never
    // in its place.
    let saw = String::from_utf8(ran.provider_saw.clone()).expect("the frame is text");
    assert_ne!(ran.provider_saw, body, "the agent's bytes never execute on their own");
    let established = saw.find("----- BEGIN HOST-ESTABLISHED ").expect("the Host block");
    let claimed = saw
        .find("----- BEGIN AGENT-CLAIMED NOT HOST VERIFIED ")
        .expect("the claim block");
    assert!(established < claimed);
    assert!(saw[established..claimed].contains(&format!("candidate-commit: {COMMIT}")));
    assert!(
        saw[claimed..].contains(std::str::from_utf8(&body).unwrap()),
        "the hashed bytes are the claim, verbatim"
    );
    assert_eq!(ran.inbox_opens, 1, "composition and operation shared ONE open");
    assert_eq!(ran.attestations, 1);

    assert_eq!(ran.outbox.len(), 1);
    let (name, record) = &ran.outbox[0];
    assert_eq!(name, &format!("{}.response", hex_of(&CORRELATION)));
    assert_eq!(ran.response.evidence_ref(), &evidence_ref_of(record));
    let text = String::from_utf8(record.clone()).expect("utf8");
    assert!(text.contains("\"outcome\":\"attested\""));
    assert!(text.contains(&format!("\"candidateDigest\":\"{}\"", hex_of(&candidate()))));
    assert!(text.contains(&format!("\"delegationId\":\"{}\"", hex_of(&DELEGATION_ID))));
    assert!(text.contains(&format!("\"planDigest\":\"{}\"", hex_of(&PLAN_DIGEST))));

    // Settled: no longer reserved, and counted as spend.
    assert!(ran.ledger.committed_spend_micro_usd() > COMMITTED);
}

/// AUTHORISED FOR ONE CANDIDATE, ASKING ABOUT ANOTHER. The wire claim, the digest and the delegation
/// are all exact - only the TEXT names a different commit. Nothing executes, nothing is recorded, the
/// wire says `NotRun`, and the reservation is released.
#[test]
fn a_subject_about_another_candidate_is_not_run_and_releases_the_reservation() {
    let ran = run(
        &subject_json(OTHER_COMMIT),
        Provider::answering(Ok(approved())),
        Build::FixtureAfterClosure,
    );

    assert_eq!(ran.response.state(), ResponseState::Rejected);
    assert_eq!(ran.response.result(), ResultClass::NotRun);
    assert_eq!(ran.provider_calls, 0);
    assert_eq!(ran.attestations, 0);
    assert!(ran.outbox.is_empty());
    assert_eq!(ran.ledger.available_micro_usd(), CEILING - COMMITTED);
}

/// NO CREDENTIAL, NO CALL. The execution ran - the wire says `Completed`/`Failed` and a failure record
/// is bound to it - and the Host can prove nothing was dispatched, so the reservation is RELEASED.
#[test]
fn an_unavailable_credential_fails_without_dispatch_and_releases_the_reservation() {
    let ran = run(
        &subject_json(COMMIT),
        Provider::answering(Err(ExecutionFailure::CredentialUnavailable)),
        Build::FixtureAfterClosure,
    );

    assert_eq!(ran.response.state(), ResponseState::Completed);
    assert_eq!(ran.response.result(), ResultClass::Failed);
    assert_eq!(ran.attestations, 0);
    let (_, record) = &ran.outbox[0];
    assert_eq!(ran.response.evidence_ref(), &evidence_ref_of(record));
    let text = String::from_utf8(record.clone()).expect("utf8");
    assert!(text.contains("\"outcome\":\"failed\""));
    assert!(text.contains("\"providerDispatched\":false"));
    assert_eq!(ran.ledger.available_micro_usd(), CEILING - COMMITTED);
    assert_eq!(ran.ledger.committed_spend_micro_usd(), COMMITTED);
}

/// A PROVIDER MAY HAVE BEEN REACHED AND NOBODY KNOWS THE BILL. The reservation stays OUTSTANDING.
#[test]
fn a_provider_failure_is_dispatched_and_the_reservation_is_retained() {
    for failure in [
        ExecutionFailure::ProviderUnavailable,
        ExecutionFailure::ProviderResultUnusable,
    ] {
        let ran = run(
            &subject_json(COMMIT),
            Provider::answering(Err(failure)),
            Build::FixtureAfterClosure,
        );

        assert_eq!(ran.response.state(), ResponseState::Completed, "{failure:?}");
        assert_eq!(ran.response.result(), ResultClass::Failed, "{failure:?}");
        let text = String::from_utf8(ran.outbox[0].1.clone()).expect("utf8");
        assert!(text.contains("\"providerDispatched\":true"), "{failure:?}");
        assert_eq!(
            ran.ledger.available_micro_usd(),
            CEILING - COMMITTED - COST,
            "{failure:?}: neither released nor committed"
        );
        assert_eq!(ran.ledger.committed_spend_micro_usd(), COMMITTED, "{failure:?}");
    }
}

/// DORMANT BY CONSTRUCTION. The PRODUCTION seam begins with the owner's signature over the installed
/// manifest; with none, an otherwise perfect request is `NotRun`, nothing reaches the provider port,
/// nothing is recorded, and the reservation is released. There is no switch that skips this.
#[test]
fn the_production_seam_refuses_before_execution_without_an_owner_signed_manifest() {
    let ran = run(&subject_json(COMMIT), Provider::answering(Ok(approved())), Build::Production);

    assert_eq!(ran.response.state(), ResponseState::Rejected);
    assert_eq!(ran.response.result(), ResultClass::NotRun);
    assert_eq!(ran.provider_calls, 0);
    assert_eq!(ran.attestations, 0);
    assert!(ran.outbox.is_empty());
    assert_eq!(ran.ledger.available_micro_usd(), CEILING - COMMITTED);
}
