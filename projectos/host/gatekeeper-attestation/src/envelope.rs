//! THE OUT-OF-BAND HALVES of one independent review: the SUBJECT the agent writes and the RESPONSE
//! RECORD the Host writes back. PROJECTOS-HOST-REVIEW-PATH1A.
//!
//! ## Why these exist
//!
//! The authority wire is fixed-width and secret-free by construction: it carries identifiers and
//! digests, never text. A review subject is kilobytes of text and so is its answer, so both travel
//! out of band and are BOUND to the wire by digest - the subject by the `parameter_digest` the wire
//! carries, the response record by the `evidence_ref` the completion carries.
//!
//! ## Nothing here is trusted because of where it sits
//!
//! The subject is untrusted input. Its `declared` block says what the agent BELIEVES the review is
//! about; [`verify_declared_bindings`] proves each declared identity hashes to the fact the Host
//! resolved for itself, and a disagreement is a refusal decided before anything executes. The Host
//! never adopts a declared value as its own fact - it only checks the two agree, and then ECHOES the
//! verified declarations so the agent can tell an answer to this request from an answer to another.
//!
//! The response record is, in turn, untrusted input to the AGENT, which verifies every binding in it
//! and both of the existing decision and attestation contracts before acting on a byte of it.
//!
//! ## Canonical encoding
//!
//! The same idiom `host-identity`'s canonical manifest bytes use: a typed view, `camelCase`, fields in
//! FIXED declaration order, compact `serde_json`. Identical inputs always produce identical bytes, which
//! is what lets a 16-byte digest of the record mean something.
//!
//! ## What it never carries
//!
//! No credential, no token, no raw provider body, no hidden reasoning. The reviewer's stated reason and
//! next instruction are carried because the agent's decision contract requires them; nothing else the
//! provider said is.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use projectos_host_identity::{
    committed_candidate_digest, phase_identity_digest, plan_identity_digest,
    project_identity_digest, repository_identity_digest,
};

use crate::operation::{AttestedReview, HostAttestation, ReviewContext, ReviewVerdict};
use crate::{VerifiedRequestBody, CORRELATION_LEN};

/// The only accepted review-subject schema version.
pub const REVIEW_SUBJECT_SCHEMA_VERSION: u32 = 1;
/// The only response-record schema version this Host writes.
pub const RESPONSE_RECORD_SCHEMA_VERSION: u32 = 1;
/// Length of the evidence reference the wire completion carries.
pub const EVIDENCE_REF_LEN: usize = 16;

/// The two questions a review subject may ask. CLOSED.
pub const ASK_GATEKEEPER: &str = "gatekeeper";
/// The closure question.
pub const ASK_CLOSURE: &str = "closure";

/// What the agent DECLARES the review is about. Every field is a claim.
///
/// The first five are verified against Host-resolved facts by [`verify_declared_bindings`]. The rest
/// cannot be independently resolved by the Host and are not pretended to be: they are covered by the
/// subject's `parameter_digest` (so they cannot change after authorisation) and echoed verbatim, which
/// is what lets the agent's own decision contract refuse an answer that belongs to another question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeclaredBindings {
    /// VERIFIED: `project_identity_digest` must equal the Host's resolved project.
    pub project_id: String,
    /// VERIFIED: `repository_identity_digest` must equal the Host's resolved repository.
    pub repository: String,
    /// VERIFIED: `plan_identity_digest` must equal the Host's resolved plan.
    pub plan_ref: String,
    /// VERIFIED: `phase_identity_digest` must equal the Host's resolved phase.
    pub phase_id: String,
    /// VERIFIED: `committed_candidate_digest` must equal the candidate the Host pinned for itself.
    pub subject_commit: String,
    /// ECHOED: the agent's own request identity.
    pub request_id: String,
    /// ECHOED: the digest of the governed request this subject was formed from.
    pub request_digest: String,
    /// ECHOED, closure only: the closure scope the question was asked under.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// ECHOED, closure only: the head the closure evidence is bound to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_subject_head: Option<String>,
}

/// One review subject, exactly as the agent wrote it into the request store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewSubject {
    /// Must equal [`REVIEW_SUBJECT_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// [`ASK_GATEKEEPER`] or [`ASK_CLOSURE`].
    pub ask: String,
    /// The wire correlation, as 32 lower-case hex characters.
    pub correlation: String,
    /// What the agent declares this review is about.
    pub declared: DeclaredBindings,
    /// The exact provider request. Opaque to the Host: it is handed to the execution port and nothing
    /// here reads it.
    pub provider_request: String,
}

/// STRICTLY parse a verified subject, or `None`. Unknown fields, an unknown schema version, an unknown
/// ask and a malformed correlation are all refusals - never a default.
#[must_use]
pub fn parse_review_subject(subject: &VerifiedRequestBody) -> Option<ReviewSubject> {
    let parsed: ReviewSubject = serde_json::from_slice(subject.bytes()).ok()?;
    if parsed.schema_version != REVIEW_SUBJECT_SCHEMA_VERSION {
        return None;
    }
    if parsed.ask != ASK_GATEKEEPER && parsed.ask != ASK_CLOSURE {
        return None;
    }
    decode_hex::<CORRELATION_LEN>(&parsed.correlation)?;
    Some(parsed)
}

/// Does every VERIFIED declaration hash to the fact the Host resolved for itself?
///
/// THE HOST'S FACTS ARE THE ONLY TRUTH HERE. `ctx` came from the composition that resolved them and
/// that the evaluator already compared against the caller's wire claim; nothing in `subject` can alter
/// it. This proves that the subject's DECLARED identities - project, repository, plan, phase, candidate
/// and correlation - are the ones the authority was minted for, so an answer cannot be attested against
/// one candidate while declaring another.
///
/// WHAT IT DOES NOT PROVE, stated so nobody relies on it: that the `providerRequest` TEXT is a faithful
/// account of that candidate. That text is opaque to the Host and is written by the agent; a subject
/// may declare commit X and show the reviewer something else. The attestation therefore vouches that an
/// independent provider answered THIS digest-bound question under THIS authority - not that the
/// question was honest. Closing that needs the Host to derive or frame the evidence itself, which is an
/// activation-time decision and is recorded as one.
#[must_use]
pub fn verify_declared_bindings(subject: &ReviewSubject, ctx: &ReviewContext<'_>) -> bool {
    let d = &subject.declared;
    decode_hex::<CORRELATION_LEN>(&subject.correlation) == Some(ctx.correlation)
        && project_identity_digest(&d.project_id) == ctx.project
        && repository_identity_digest(&d.repository) == ctx.repository
        && plan_identity_digest(&d.plan_ref) == ctx.plan
        && phase_identity_digest(&d.phase_id) == ctx.phase
        && committed_candidate_digest(&d.subject_commit) == Some(ctx.candidate_digest)
}

// -------------------------------------------------------------------------------------------------
// THE RESPONSE RECORD
// -------------------------------------------------------------------------------------------------

/// The reviewer's decision as the record carries it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionView<'a> {
    decision_id: &'a str,
    verdict: &'a str,
    reason: &'a str,
    next_instruction: &'a str,
    allowed_actions: &'a [String],
    forbidden_actions: &'a [String],
    owner_approval_required: bool,
    decided_by: &'a str,
    decided_at: &'a str,
}

/// The Host attestation, read through its accessors. The sealed record is never loosened: this is a
/// separate VIEW populated from read-only getters, exactly as the canonical manifest view is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttestationView<'a> {
    schema_version: u32,
    attestation_id: String,
    request_correlation: String,
    project: String,
    repository: String,
    plan: String,
    plan_digest: String,
    phase: String,
    candidate_digest: String,
    /// PROJECTOS-HOST-REVIEW-PATH1B: the approved baseline commit the evidence was measured from, as 40
    /// lower-case hex. Declared AFTER `candidate_digest` and BEFORE `delegation_id`; the order is the
    /// canonical encoding.
    baseline_commit: String,
    /// The digest of the canonical candidate evidence the reviewer was shown. The agent recomputes it
    /// from the same baseline and candidate, and refuses an attestation that disagrees.
    evidence_digest: String,
    delegation_id: String,
    provider_response_id: &'a str,
    provider: &'a str,
    model: &'a str,
    tier: &'a str,
    verdict: &'static str,
    allowed_actions: &'a [String],
    owner_approval_required: bool,
    /// `admittedCostMicroUsd` on the wire. The amount the Host ADMITTED - never a provider cost, and
    /// revision 2 carries no accounted or billed figure beside it.
    admitted_cost_micro_usd: u64,
    attested_at_epoch_s: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageView {
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseRecordView<'a> {
    schema_version: u32,
    correlation: String,
    ask: &'a str,
    /// `attested` or `failed`.
    outcome: &'static str,
    /// THE HOST-AUTHORITATIVE DISPATCH FACT. Never inferred by the agent from the frame's state.
    provider_dispatched: bool,
    declared: &'a DeclaredBindings,
    #[serde(skip_serializing_if = "Option::is_none")]
    decision: Option<DecisionView<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attestation: Option<AttestationView<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<UsageView>,
}

/// The wire spelling of a normalised verdict. Matches the agent's `HOST_REVIEW_VERDICTS`.
#[must_use]
pub fn review_verdict_name(v: ReviewVerdict) -> &'static str {
    match v {
        ReviewVerdict::ApprovedToProceed => "ApprovedToProceed",
        ReviewVerdict::OwnerApprovalRequired => "OwnerApprovalRequired",
        ReviewVerdict::ChangesRequired => "ChangesRequired",
    }
}

fn attestation_view(a: &HostAttestation) -> AttestationView<'_> {
    AttestationView {
        schema_version: a.schema_version(),
        attestation_id: hex(a.attestation_id()),
        request_correlation: hex(a.request_correlation()),
        project: hex(a.project()),
        repository: hex(a.repository()),
        plan: hex(a.plan()),
        plan_digest: hex(a.plan_digest()),
        phase: hex(a.phase()),
        candidate_digest: hex(a.candidate_digest()),
        baseline_commit: hex(a.baseline_commit()),
        evidence_digest: hex(a.evidence_digest()),
        delegation_id: hex(a.delegation_id()),
        provider_response_id: a.provider_response_id(),
        provider: a.provider(),
        model: a.model(),
        tier: a.tier(),
        verdict: review_verdict_name(a.verdict()),
        allowed_actions: a.allowed_actions(),
        owner_approval_required: a.owner_approval_required(),
        admitted_cost_micro_usd: a.admitted_cost_micro_usd(),
        attested_at_epoch_s: a.attested_at_epoch_s(),
    }
}

/// The canonical bytes of ONE attestation, for the Host's own durable attestation store. The same
/// accessor-populated view the response record embeds, so the stored attestation and the one the agent
/// is shown are the same statement.
#[must_use]
pub fn attestation_record_bytes(attestation: &HostAttestation) -> Vec<u8> {
    serde_json::to_vec(&attestation_view(attestation)).unwrap_or_default()
}

/// The canonical bytes of an ATTESTED response record.
#[must_use]
pub fn attested_record_bytes(subject: &ReviewSubject, review: &AttestedReview) -> Vec<u8> {
    let a = &review.attestation;
    let d = &review.decision;
    let view = ResponseRecordView {
        schema_version: RESPONSE_RECORD_SCHEMA_VERSION,
        correlation: hex(a.request_correlation()),
        ask: &subject.ask,
        outcome: "attested",
        provider_dispatched: true,
        declared: &subject.declared,
        decision: Some(DecisionView {
            decision_id: &d.decision_id,
            verdict: &d.verdict,
            reason: &d.reason,
            next_instruction: &d.next_instruction,
            allowed_actions: a.allowed_actions(),
            forbidden_actions: &d.forbidden_actions,
            owner_approval_required: a.owner_approval_required(),
            decided_by: &d.decided_by,
            decided_at: &d.decided_at,
        }),
        attestation: Some(attestation_view(a)),
        usage: Some(UsageView {
            input_tokens: a.input_tokens(),
            cached_input_tokens: review.cached_input_tokens.unwrap_or(0),
            output_tokens: a.output_tokens(),
        }),
    };
    serde_json::to_vec(&view).unwrap_or_default()
}

/// The canonical bytes of a FAILURE record: the execution ran and produced no attested answer.
///
/// It exists so a failure is bound to the wire exactly as a success is, and so the agent learns the
/// one thing it needs from a failure - whether a provider may have been reached - from the Host's own
/// statement rather than by guessing from the frame.
#[must_use]
pub fn failed_record_bytes(
    subject: &ReviewSubject,
    correlation: &[u8; CORRELATION_LEN],
    provider_dispatched: bool,
) -> Vec<u8> {
    let view = ResponseRecordView {
        schema_version: RESPONSE_RECORD_SCHEMA_VERSION,
        correlation: hex(correlation),
        ask: &subject.ask,
        outcome: "failed",
        provider_dispatched,
        declared: &subject.declared,
        decision: None,
        attestation: None,
        usage: None,
    };
    serde_json::to_vec(&view).unwrap_or_default()
}

/// The evidence reference binding a response record to the wire completion: the first sixteen bytes of
/// SHA-256 over the EXACT record bytes. The agent recomputes it from the record it read.
#[must_use]
pub fn evidence_ref_of(record: &[u8]) -> [u8; EVIDENCE_REF_LEN] {
    let digest = Sha256::digest(record);
    let mut out = [0u8; EVIDENCE_REF_LEN];
    out.copy_from_slice(&digest[..EVIDENCE_REF_LEN]);
    out
}

fn hex(bytes: &[u8]) -> String {
    const HEX: [u8; 16] = *b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[usize::from(b >> 4)] as char);
        s.push(HEX[usize::from(b & 0x0f)] as char);
    }
    s
}

/// STRICT lower-case hex of exactly `N` bytes, or `None`. Upper case is refused, not normalised.
fn decode_hex<const N: usize>(s: &str) -> Option<[u8; N]> {
    if s.len() != N * 2 {
        return None;
    }
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let raw = s.as_bytes();
    let mut out = [0u8; N];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = (nibble(raw[i * 2])? << 4) | nibble(raw[i * 2 + 1])?;
    }
    Some(out)
}
