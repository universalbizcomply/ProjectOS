//! THE CROSS-LANGUAGE PROOF, HOST SIDE. PROJECTOS-HOST-REVIEW-PATH1A.
//!
//! `projectos/contracts/host-review-path-vectors.v1.json` holds, under `agent`, the EXACT subject bytes
//! and request frames the real TypeScript agent implementation produced. This file feeds those bytes -
//! unmodified - through the REAL Host: the strict frame decoder, the accepted status half, the real
//! composition, the real execution rung, the one shipped seam implementation, the real responder and the
//! real steps 4-8 of the review operation. So "request bytes produced by the real agent are accepted by
//! the real Host decoder" is a thing that ran, not a thing two files agree to say.
//!
//! What the real Host then emitted - the `ServiceReady`, status and response frames and the response
//! record - is recorded under `host` in the same file, and the TypeScript suite verifies THOSE bytes
//! with the real agent verifier. This test asserts the Host still produces exactly what is recorded, so
//! a drift on this side fails here.
//!
//! REGENERATION is explicit and never silent: with `PROJECTOS_HOST_REVIEW_VECTORS_OUT` naming a file,
//! the Host half is written THERE (never into the contract file) for a reviewer to merge.

use std::cell::Cell;
use std::io::Read;

use projectos_host_authority::ProjectOsHostPipeSecurityStatus;
use projectos_host_core::{
    FixtureClock, FixtureIpcSessionVerifier, InMemoryRequestAdmissionStore, IpcSessionVerifier,
};
use projectos_host_gatekeeper_attestation::candidate_evidence::{
    CandidateEvidence, EvidenceChange, EvidenceEntryInput,
};
use projectos_host_gatekeeper_attestation::provider_request::HostProviderRequest;
use projectos_host_gatekeeper_attestation::operation::evidence_fixture::FixtureCandidateEvidence;
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
use serde_json::{json, Value};

use super::super::*;
use super::HostReviewExecution;
use crate::adapter::{LiveIpcOperationCapability, LocalIpcAdapter, SendOutcome};
use crate::fixture_session::fixture_bound_session;
use crate::operation_contract::request_replay::FixtureRequestReplayLedger;
use crate::operation_contract::{
    decode_protected_operation_request, OwnerProgrammeDelegation, RejectionReason, ResponseState,
    MAX_DELEGATED_PHASES,
};
use crate::protocol::{
    ChannelReport, IdentityVerificationReport, InstalledHostStatus, ProtectedOperationsReport,
    ReadinessReport, ServiceStateReport,
};
use crate::review_exchange::loopback::pair;
use crate::review_exchange::{ClientReviewOutcome, HostReviewIpcCapability, ServeReviewOutcome};

const VECTORS: &str = include_str!("../../../../../contracts/host-review-path-vectors.v1.json");
const CEILING: u64 = 5_000_000;
const COMMITTED: u64 = 1_000_000;
const COST: u64 = 200_000;

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn bytes_of(hex: &str) -> Vec<u8> {
    assert!(hex.len() % 2 == 0, "odd-length hex in the vectors");
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex in the vectors"))
        .collect()
}

fn array<const N: usize>(hex: &str) -> [u8; N] {
    bytes_of(hex).try_into().expect("a fixed-width vector value")
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("the vectors carry no string `{key}`"))
}

/// The Host's own facts, resolved from the vector INPUTS by the Host's own digests - never read from
/// the agent's half, which is only ever a claim.
struct Facts {
    project: [u8; 32],
    repository: [u8; 32],
    plan: [u8; 32],
    plan_digest: [u8; 32],
    phase: [u8; 32],
    candidate: [u8; 32],
    model: [u8; 32],
    credential: [u8; 32],
    delegation_id: [u8; 32],
    epoch: u64,
}

impl Facts {
    fn from_inputs(inputs: &Value) -> Self {
        Self {
            project: project_identity_digest(text(inputs, "projectId")),
            repository: repository_identity_digest(text(inputs, "repository")),
            plan: plan_identity_digest(text(inputs, "planRef")),
            plan_digest: array(text(inputs, "planDigest")),
            phase: phase_identity_digest(text(inputs, "phaseId")),
            candidate: committed_candidate_digest(text(inputs, "subjectCommit")).expect("oid"),
            model: model_policy_identity_digest(text(inputs, "modelPolicy")),
            credential: credential_ref_identity_digest(text(inputs, "credentialRef")),
            delegation_id: array(text(inputs, "delegationId")),
            epoch: text(inputs, "serviceEpoch").parse().expect("epoch"),
        }
    }

    fn delegation(&self) -> OwnerProgrammeDelegation {
        let mut allowed_phases = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
        allowed_phases[0] = self.phase;
        OwnerProgrammeDelegation {
            delegation_id: self.delegation_id,
            owner: [0xbb; DELEGATION_DIGEST_LEN],
            project: self.project,
            repository: self.repository,
            plan: self.plan,
            plan_digest: self.plan_digest,
            allowed_phases,
            allowed_phase_count: 1,
            operation: OperationClass::IndependentGatekeeperReview,
            model_policy: self.model,
            credential_ref: self.credential,
            budget_ceiling_micro_usd: CEILING,
            expires_at_epoch_s: 2_000,
            revoked_or_completed: false,
        }
    }
}

struct Plan<'a>(&'a Facts);
/// The approved baseline commit every fixture plan authority states (PROJECTOS-HOST-REVIEW-PATH1B).
const FIXTURE_BASELINE: [u8; crate::BASELINE_COMMIT_LEN] = [0xb4; crate::BASELINE_COMMIT_LEN];

impl HostPlanAuthority for Plan<'_> {
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.0.plan)
    }
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.0.plan_digest)
    }
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.0.phase)
    }
    fn approved_baseline(&self) -> Option<[u8; crate::BASELINE_COMMIT_LEN]> {
        Some(FIXTURE_BASELINE)
    }
}
struct Closure<'a>(&'a Facts);
impl SignedExecutionClosureFacts for Closure<'_> {
    fn model_policy(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.0.model)
    }
    fn credential_ref(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.0.credential)
    }
}
struct Candidate<'a>(&'a Facts);
impl CommittedCandidateSource for Candidate<'_> {
    fn candidate_digest(&self) -> Option<[u8; BINDING_DIGEST_LEN]> {
        Some(self.0.candidate)
    }
}
struct Cost;
impl AdmittedCostSource for Cost {
    fn admitted_cost_micro_usd(&self) -> Option<u64> {
        Some(COST)
    }
}
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
        1_758_240_000
    }
}
struct Provider {
    answer: Result<ProviderOutcome, ExecutionFailure>,
    calls: Cell<u32>,
    /// THE BODY THE HOST AUTHORED, exactly as the execution port was handed it.
    body: std::cell::RefCell<Vec<u8>>,
}
#[allow(non_snake_case)]
fn Provider(answer: Result<ProviderOutcome, ExecutionFailure>) -> Provider {
    Provider {
        answer,
        calls: Cell::new(0),
        body: std::cell::RefCell::new(Vec::new()),
    }
}
impl GatekeeperExecutionPort for Provider {
    fn execute(&self, s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        self.calls.set(self.calls.get() + 1);
        *self.body.borrow_mut() = s.body().to_vec();
        self.answer.clone()
    }
}

/// What one exchange produced.
struct Ran {
    frames: Vec<Vec<u8>>,
    response: ProtectedOperationResponse,
    record: Option<(String, Vec<u8>)>,
    provider_calls: u32,
    provider_request_body: Vec<u8>,
}
struct Attestations;
impl AttestationStorePort for Attestations {
    fn store_once(&mut self, _a: &HostAttestation) -> StoreOutcome {
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

/// The fixture provider's answer to each ask, in that ask's own vocabulary.
fn answer_for(ask: &str) -> ProviderOutcome {
    let (word, class, actions, owner): (&str, ReviewVerdict, Vec<String>, bool) = match ask {
        "gatekeeper" => (
            "APPROVED_TO_PROCEED",
            ReviewVerdict::ApprovedToProceed,
            vec!["continue-phase".into()],
            false,
        ),
        "closure" => ("close", ReviewVerdict::OwnerApprovalRequired, vec![], true),
        other => panic!("the vectors carry an unknown ask `{other}`"),
    };
    ProviderOutcome {
        provider_response_id: format!("resp_vector_{ask}"),
        provider: "openai".into(),
        model: "vector-model".into(),
        tier: ask.into(),
        verdict: class,
        allowed_actions: actions,
        owner_approval_required: owner,
        input_tokens: 2_000,
        output_tokens: 300,
        cached_input_tokens: Some(1_500),
        decision: ReviewedDecision {
            decision_id: format!("HOSTDEC-vector-{ask}"),
            verdict: word.into(),
            reason: "independently reviewed by the vector provider".into(),
            next_instruction: "continue".into(),
            forbidden_actions: vec!["production-deploy".into()],
            decided_by: "ChatGPT".into(),
            decided_at: "2026-09-19T00:00:00Z".into(),
        },
    }
}

fn accepting_status() -> InstalledHostStatus {
    InstalledHostStatus::new(
        ServiceStateReport::Running,
        IdentityVerificationReport::Verified,
        ChannelReport::Development,
        ReadinessReport::Ready,
        ProtectedOperationsReport::Authorised,
        *b"0123abcd",
        *b"4567ef01",
    )
    .expect("lower-case hex prefixes")
}

/// The recorded Host half of one exchange that produced a response record.
fn host_half_for(inputs: &Value, exchange: &Value, provider: Provider) -> Value {
    let ran = run_exchange(inputs, exchange, provider);
    let (record_name, record) = ran.record.expect("a response record");
    json!({
        "ask": text(exchange, "ask"),
        "correlation": text(exchange, "correlation"),
        "serviceReadyFrameHex": hex_of(&ran.frames[0]),
        "statusFrameHex": hex_of(&ran.frames[1]),
        "responseFrameHex": hex_of(&ran.frames[2]),
        "responseState": format!("{:?}", ran.response.state()),
        "responseResult": format!("{:?}", ran.response.result()),
        "evidenceRef": hex_of(ran.response.evidence_ref()),
        "responseRecordFileName": record_name,
        "responseRecord": String::from_utf8(record).expect("the record is UTF-8"),
        // PROJECTOS-HOST-REVIEW-PATH1B. THE PROVIDER REQUEST THE REAL HOST AUTHORED for this exchange. The
        // agent suite hands these exact bytes to the REAL, byte-unchanged transport broker, which is how
        // "the existing broker transports the Host-built body" is a thing that ran. Empty when the Host
        // never reached the execution port.
        "hostProviderRequestBody": String::from_utf8(ran.provider_request_body).expect("the body is UTF-8"),
    })
}

/// ONE EXCHANGE, from the agent's exact bytes to the Host's exact bytes.
fn run_exchange(inputs: &Value, exchange: &Value, provider: Provider) -> Ran {
    let facts = Facts::from_inputs(inputs);
    let run_id: [u8; 8] = array(text(inputs, "runIdHex"));
    let subject = text(exchange, "subject").as_bytes().to_vec();
    let frame = bytes_of(text(exchange, "requestFrameHex"));

    let clock = FixtureClock::new(150);
    let verifier = FixtureIpcSessionVerifier::new();
    let session = fixture_bound_session(&clock, &verifier);
    let mut admission = InMemoryRequestAdmissionStore::for_session(&session);
    let peer = TrustedPeerContext::for_admitted_connection(
        verifier.connection_id(),
        verifier.handshake_generation(),
    );
    let verified = VerifiedOwnerProgrammeDelegation::for_test(facts.delegation());
    let programme = ExpectedProgramme::fixture(facts.project, facts.repository);
    let mut ledger = FixtureBudgetLedger::holding(CEILING, COMMITTED);
    let mut replay = FixtureRequestReplayLedger::empty();
    let file = FileInbox {
        body: subject,
        opens: Cell::new(0),
    };
    let mut inbox = RetainedRequestInbox::over(&file);
    let mut lifecycle = RequestLifecycle::new();
    let mut attestations = Attestations;
    let mut outbox = Outbox::default();

    let (host_end, client) = pair(run_id);
    client.send_hello();
    client.queue_request_frame_from_vector(&frame);
    let adapter = LocalIpcAdapter::new(host_end);
    let cap = LiveIpcOperationCapability::synthetic_review_scoped_for_fixture();
    let review = HostReviewIpcCapability::synthetic_for_fixture();
    let _ = adapter.prepare_server(&cap, ProjectOsHostPipeSecurityStatus::Ready);
    let _ = adapter.accept_unauthenticated(&cap);
    assert!(adapter.complete_service_handshake(&cap).is_peer_confirmed());
    assert_eq!(
        adapter.send_installed_host_status(&cap, &accepting_status()),
        SendOutcome::Sent
    );

    let mut host = |request: &ProtectedOperationRequest| -> ProtectedOperationResponse {
        let composed = {
            let mut sources = HostRequestSources {
                plan: &Plan(&facts),
                closure: &Closure(&facts),
                candidate: &Candidate(&facts),
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
                request,
                facts.epoch,
            )
        };
        let composed = match composed {
            Ok(composed) => composed,
            Err(CompositionRefusal::Rejected(response)) => return response,
            Err(other) => panic!("composition refused outside the evaluator: {other:?}"),
        };
        let ports = HostPorts {
            manifest: &NoManifest,
            committed: &NoCommitted,
            executables: &Trusted,
            inbox: &inbox,
            execution: &provider,
            clock: &Clock,
            evidence: &FixtureCandidateEvidence {
                candidate: text(inputs, "subjectCommit").to_string(),
                ..FixtureCandidateEvidence::default()
            },
        };
        let mut seam = HostReviewExecution::after_the_closure_for_fixture(
            ports,
            &mut lifecycle,
            &mut attestations,
            &mut outbox,
        );
        run_authorised_review(composed, &mut seam, &mut ledger)
    };
    let served = adapter.serve_review_request(&cap, &review, &mut host);
    assert_eq!(served, ServeReviewOutcome::Answered, "the agent's real frame was not served");
    assert_eq!(file.opens.get(), 1, "one open of the subject");

    let frames = client.frames_from_host();
    assert_eq!(frames.len(), 3, "ServiceReady, status, response");

    // THE SHIPPED CLIENT ORDER ACCEPTS WHAT THE HOST SAID, for the request the agent really sent.
    let (decoded, _) = decode_protected_operation_request(&frame).expect("the agent's frame decodes");
    let ClientReviewOutcome::Answered(response) = client.finish(&decoded) else {
        panic!("the shipped client order refused the Host's answer");
    };

    Ran {
        frames,
        response,
        record: outbox.0.first().cloned(),
        provider_calls: provider.calls.get(),
        provider_request_body: provider.body.borrow().clone(),
    }
}

fn host_half(doc: &Value) -> Value {
    let inputs = &doc["inputs"];
    let exchanges = doc["agent"]["exchanges"].as_array().expect("agent exchanges");
    let attested: Vec<Value> = exchanges
        .iter()
        .map(|x| host_half_for(inputs, x, Provider(Ok(answer_for(text(x, "ask"))))))
        .collect();
    // THE TWO FAILURE CLASSES THE AGENT'S BUDGET DEPENDS ON, for the first exchange's exact bytes.
    let first = &exchanges[0];
    json!({
        "attested": attested,
        "failedNotDispatched": host_half_for(
            inputs, first, Provider(Err(ExecutionFailure::CredentialUnavailable))),
        "failedDispatched": host_half_for(
            inputs, first, Provider(Err(ExecutionFailure::ProviderUnavailable))),
    })
}

/// THE REAL HOST ACCEPTS THE REAL AGENT'S BYTES, and still emits exactly the recorded Host half.
#[test]
fn the_real_agent_bytes_are_served_by_the_real_host_and_the_host_half_is_stable() {
    let doc: Value = serde_json::from_str(VECTORS).expect("the vector file is JSON");
    assert_eq!(doc["contract"], "projectos.host-review-path-vectors.v1");

    let produced = host_half(&doc);

    if let Some(out) = std::env::var_os("PROJECTOS_HOST_REVIEW_VECTORS_OUT") {
        std::fs::write(&out, serde_json::to_vec_pretty(&produced).expect("json"))
            .expect("write the regenerated Host half");
        println!("REGENERATED the Host half at {}", std::path::Path::new(&out).display());
        return;
    }
    assert_eq!(
        produced, doc["host"],
        "the Host no longer produces the recorded bytes; regenerate DELIBERATELY with \
         PROJECTOS_HOST_REVIEW_VECTORS_OUT and review the difference"
    );

    // PROJECTOS-HOST-REVIEW-PATH1B. THE EVIDENCE BOTH LANGUAGES RECOMPUTE. `inputs.evidence` is what the
    // agent's verifier hashes; assembled here by the REAL Host contract it must reproduce the digest the
    // Host attested, or the file's two halves describe different evidence.
    let inputs = &doc["inputs"];
    let entries = inputs["evidence"]
        .as_array()
        .expect("inputs.evidence")
        .iter()
        .map(|e| EvidenceEntryInput {
            change: match text(e, "change") {
                "added" => EvidenceChange::Added,
                "deleted" => EvidenceChange::Deleted,
                "modified" => EvidenceChange::Modified,
                "type-changed" => EvidenceChange::TypeChanged,
                other => panic!("unknown change {other}"),
            },
            path: text(e, "path").to_string(),
            old_mode: u32::from_str_radix(text(e, "oldMode"), 8).expect("octal"),
            new_mode: u32::from_str_radix(text(e, "newMode"), 8).expect("octal"),
            old_id: text(e, "oldId").to_string(),
            new_id: text(e, "newId").to_string(),
            new_contents: e["contentsUtf8"].as_str().map(|c| c.as_bytes().to_vec()),
        })
        .collect();
    // F2: the vector's ordered ancestry, exactly as the contract file states it.
    let ancestry = inputs["ancestry"]
        .as_array()
        .expect("the vector carries its ancestry")
        .iter()
        .map(|s| projectos_host_gatekeeper_attestation::candidate_evidence::AncestryStepInput {
            commit: text(s, "commit").to_string(),
            parent: text(s, "parent").to_string(),
            entries: s["entries"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .map(|e| {
                            projectos_host_gatekeeper_attestation::candidate_evidence::AncestryEntryInput {
                                change: match text(e, "change") {
                                    "added" => EvidenceChange::Added,
                                    "deleted" => EvidenceChange::Deleted,
                                    "modified" => EvidenceChange::Modified,
                                    "type-changed" => EvidenceChange::TypeChanged,
                                    other => panic!("unknown change {other}"),
                                },
                                path: text(e, "path").to_string(),
                                old_mode: u32::from_str_radix(text(e, "oldMode"), 8).expect("octal"),
                                new_mode: u32::from_str_radix(text(e, "newMode"), 8).expect("octal"),
                                old_id: text(e, "oldId").to_string(),
                                new_id: text(e, "newId").to_string(),
                                vanished_contents: e["vanishedContentsUtf8"]
                                    .as_str()
                                    .map(|c| c.as_bytes().to_vec()),
                            }
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect();
    let evidence = CandidateEvidence::assemble(
        text(inputs, "baselineCommit"),
        text(inputs, "subjectCommit"),
        entries,
        ancestry,
    )
    .expect("the vector evidence assembles");
    let attested_exchanges = produced["attested"].as_array().expect("attested exchanges");
    assert!(!attested_exchanges.is_empty());
    for exchange in attested_exchanges {
        let record: Value =
            serde_json::from_str(text(exchange, "responseRecord")).expect("record JSON");
        let attested = &record["attestation"];
        assert_eq!(attested["evidenceDigest"], hex_of(&evidence.digest()));
        assert_eq!(attested["baselineCommit"], text(inputs, "baselineCommit"));
        assert_eq!(attested["schemaVersion"], 2);
    }
}

/// THE HOST NEVER ADOPTS THE AGENT'S CLAIM. The agent's claimed binding digest is compared with the one
/// the Host computes from its OWN facts; the real agent frame with ONE BIT of its claim altered is
/// answered `Rejected`/`NotRun`/`BindingMismatch`, the provider port is never reached, no record is
/// written, and the shipped client order still reads that refusal as the answer to its request.
#[test]
fn an_altered_agent_claim_is_refused_by_the_real_host() {
    let doc: Value = serde_json::from_str(VECTORS).expect("the vector file is JSON");
    let mut exchange = doc["agent"]["exchanges"][0].clone();
    let mut frame = bytes_of(text(&exchange, "requestFrameHex"));
    // The binding digest starts after the header, correlation, sequence and claimed epoch.
    frame[41 + 16 + 8 + 8] ^= 0x01;
    exchange["requestFrameHex"] = Value::String(hex_of(&frame));

    let ran = run_exchange(&doc["inputs"], &exchange, Provider(Ok(answer_for("gatekeeper"))));

    assert_eq!(ran.response.state(), ResponseState::Rejected);
    assert_eq!(ran.response.result(), ResultClass::NotRun);
    assert_eq!(ran.response.reason(), RejectionReason::BindingMismatch);
    assert_eq!(ran.provider_calls, 0);
    assert!(ran.record.is_none(), "a refused request produced a response record");
}
