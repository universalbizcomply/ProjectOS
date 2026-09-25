//! THE HOST OPERATION — one independent gatekeeper review, decided in one ordered pass.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION — HOST OPERATION + ATTESTATION.
//!
//! ## What this module is
//!
//! The complete production decision for `IndependentGatekeeperReview`, written as a pure function
//! over injected ports. Every capability the Host needs — reading committed bytes, reading the
//! installed trust manifest, executing the attested broker, persisting an attestation, telling the
//! time — arrives as a trait. That is not a testing convenience: it is what lets the whole chain be
//! stated, ordered and proven before a single live capability exists, and it makes each missing
//! capability a NAMED port rather than a hidden assumption.
//!
//! ## The order is the security property
//!
//! Nothing here is arranged for readability. The signature is established before any signed material
//! is trusted; the closure is verified before the broker is executed; the request is consumed before
//! it can be replayed; execution happens before an attestation can exist; and the attestation is
//! stored one-shot before it is returned. Reordering any pair of these makes something reachable
//! that the owner did not authorise, which is why each step says what it is standing in the way of.
//!
//! ## What it will not do
//!
//! It executes nothing itself, opens no file, spawns no process, reads no credential, contacts no
//! provider and writes nothing durable. It decides, and it hands the decision to ports. A caller
//! that supplies no ports gets no effects — which is exactly the state this phase is in.

use sha2::{Digest, Sha256};

use projectos_host_identity::{
    committed_candidate_digest, verify_execution_closure, CommittedClosureBytes, IdentityError, Policy,
    ProductionEs256Verifier, TrustManifest, EXECUTION_CLOSURE_MANIFEST_VERSION,
};
use projectos_packaged_runtime_contract as contract;

use crate::candidate_evidence::{
    CandidateEvidence, EvidenceRefusal, FramedReviewInput, BOUNDARY_MARKER_LEN,
};
use crate::provider_request::{HostProviderRequest, RequestBuildRefusal, ReviewExecutionPolicy};
use crate::{
    InboxReader, InboxRefusal, RequestFileIdentity, RequestLifecycle, VerifiedRequestBody,
};

/// Length of a bounded identity or content digest.
pub const DIGEST_LEN: usize = 32;

/// The repository-relative paths whose COMMITTED bytes the execution closure attests.
///
/// Not restated here. They are the packaging contract's constants, read directly in
/// `run_gatekeeper_review`, and `verify_execution_closure` compares the manifest's declarations
/// against the same source. A third opinion about which files matter is how they drift.
pub const CLOSURE_ARTEFACT_COUNT: usize = contract::EXECUTION_CLOSURE_REPOSITORY_PATHS.len();

// -------------------------------------------------------------------------------------------------
// PORTS — every capability the Host needs, named
// -------------------------------------------------------------------------------------------------

/// Read the COMMITTED bytes of a repository-relative path from the governed installation.
///
/// COMMITTED, NOT ON-DISK, and the distinction is the whole point of the port. The execution closure
/// attests what an owner signed; a working-tree read would attest whatever is there now. A real
/// implementation asks git for the object at `HEAD` and returns `None` if it cannot establish it —
/// "I could not ask" must never arrive here as "there is nothing wrong".
pub trait CommittedBytesPort {
    /// The committed bytes at `repository_relative_path`, or `None` if they cannot be established.
    fn committed_bytes(&self, repository_relative_path: &str) -> Option<Vec<u8>>;
}

/// Read the installed trust manifest.
pub trait TrustManifestPort {
    /// The raw manifest bytes as installed, or `None` if absent or unreadable.
    fn manifest_bytes(&self) -> Option<Vec<u8>>;
}

/// The trusted-executable policy the Host requires before it will run anything.
pub trait ExecutablePolicyPort {
    /// Whether every executable this operation depends on resolves to a trusted, non-substitutable
    /// location. A caller never supplies a path; this reports on the Host's own resolution.
    fn executables_are_trusted(&self) -> bool;
}

/// Execute ONE attested gatekeeper review. The only effect this module can cause, and only through
/// an implementation the Host composes.
///
/// The port takes THE HOST-AUTHORED PROVIDER REQUEST (PROJECTOS-HOST-REVIEW-PATH1B): a body the Host
/// built, over the Host's own evidence of the candidate framed with the agent's bytes as a labelled,
/// unverified claim, under the owner-signed policy. Not a path, not a command, not a URL, and never
/// the agent's bytes on their own — so an implementation cannot be handed anything else to run. There
/// is deliberately no
/// argument through which an executable, a script, an environment or a provider endpoint could
/// arrive: those are the Host's, fixed by the attested closure it just verified.
pub trait GatekeeperExecutionPort {
    /// Run the review and report what the provider actually returned.
    fn execute(&self, request: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure>;
}

/// Width of an approved baseline commit: a full-length SHA-1 object identity, as raw bytes.
pub const BASELINE_COMMIT_LEN: usize = 20;

/// Schema of the sealed attestation. REVISION 2 (PROJECTOS-HOST-REVIEW-PATH1B) binds the approved
/// baseline and the digest of the evidence the reviewer was shown.
pub const ATTESTATION_SCHEMA_VERSION: u32 = 2;

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Why the Host could not establish candidate evidence. Payload-free, and coarse on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceUnavailable {
    /// The approved baseline is not a commit the governed repository has.
    BaselineUnavailable,
    /// The pinned candidate is not a commit the governed repository has.
    CandidateUnavailable,
    /// The approved baseline is not an ancestor of the pinned candidate.
    BaselineNotAncestor,
    /// The repository read refused, timed out, overflowed or returned something not understood.
    RepositoryRefused,
    /// What was read cannot be evidence: an unsupported entry, an inconsistency or a bound exceeded.
    Refused(EvidenceRefusal),
    /// No boundary marker could be generated.
    MarkerUnavailable,
}

/// THE HOST'S OWN READING OF THE CANDIDATE. PROJECTOS-HOST-REVIEW-PATH1B.
///
/// The baseline is an ARGUMENT because it is a Host fact resolved elsewhere - the durable approved-plan
/// record - and the candidate is NOT, because it is the commit the implementation pinned once. Nothing
/// a request carries reaches either.
pub trait CandidateEvidencePort {
    /// The complete evidence between `baseline` (40 lower-case hex) and the pinned candidate.
    ///
    /// # Errors
    /// [`EvidenceUnavailable`]; never partial evidence.
    fn candidate_evidence(&self, baseline: &str) -> Result<CandidateEvidence, EvidenceUnavailable>;
    /// A fresh boundary marker, generated AFTER the evidence and the claim are fixed.
    fn boundary_marker(&self) -> Option<[u8; BOUNDARY_MARKER_LEN]>;
}

/// Durable, one-shot attestation storage owned by the Host.
pub trait AttestationStorePort {
    /// Store this attestation if its identity has never been stored.
    ///
    /// THREE ANSWERS, NOT TWO. A boolean collapsed "someone already answered this review" and "the
    /// store failed" into one value, and the operation reported both as the former — so a genuine
    /// durability failure was indistinguishable from a legitimate one-shot refusal, and the enum's
    /// own `AttestationNotStored` variant could never be constructed. Both still fail closed, but an
    /// operator chasing a storage fault should not be told the review was already answered.
    fn store_once(&mut self, attestation: &HostAttestation) -> StoreOutcome;
}

/// What durable storage did with an attestation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StoreOutcome {
    /// Written durably. The only outcome that permits the caller to act.
    Stored,
    /// This exact review already has a durable answer. One review, one answer.
    AlreadyStored,
    /// Storage failed. The attestation must not be acted on.
    Failed,
}

/// The Host's own clock. A caller never supplies one.
pub trait ClockPort {
    /// Seconds since the Unix epoch, as the Host reads it.
    fn now_epoch_s(&self) -> u64;
}

// -------------------------------------------------------------------------------------------------
// PROVIDER RESULT
// -------------------------------------------------------------------------------------------------

/// Why an execution did not produce a usable result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ExecutionFailure {
    /// The credential could not be resolved. Fails closed: no credential, no call, no attestation.
    CredentialUnavailable,
    /// The provider was not reached, or refused.
    ProviderUnavailable,
    /// The provider answered, but not in a shape this operation can normalise.
    ProviderResultUnusable,
}

/// The CLOSED set of verdicts an independent review may return.
///
/// A closed enum rather than a string, because a verdict is an authority-bearing value: a free-form
/// answer would let a provider — or anything imitating one — introduce a verdict nobody defined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReviewVerdict {
    /// The candidate may proceed.
    ApprovedToProceed,
    /// The candidate may proceed only with the owner's approval.
    OwnerApprovalRequired,
    /// The candidate is refused.
    ChangesRequired,
}

/// THE CLOSED MAP from a reviewer's verdict - in either asking contract's vocabulary - to the class an
/// attestation vouches for. `None` for anything outside the two vocabularies: an encouraging word a
/// model invented is not a verdict.
///
/// It mirrors the agent's `HOST_VERDICT_FOR` and `HOST_VERDICT_FOR_CLOSURE` exactly. Every owner-gated
/// answer maps to [`ReviewVerdict::OwnerApprovalRequired`]: an attestation cannot turn a recommendation
/// into a permission. The two vocabularies are disjoint, so one map serves both without an `ask`.
#[must_use]
pub fn normalised_verdict(verdict: &str) -> Option<ReviewVerdict> {
    match verdict {
        "APPROVED_TO_PROCEED" => Some(ReviewVerdict::ApprovedToProceed),
        "AMENDMENT_REQUIRED" | "DO_NOT_PROCEED" | "do-not-close" => {
            Some(ReviewVerdict::ChangesRequired)
        }
        "AWAITING_OWNER"
        | "APPROVED_TO_COMMIT"
        | "APPROVED_TO_PUSH"
        | "APPROVED_FOR_CLOSURE"
        | "close"
        | "awaiting-owner" => Some(ReviewVerdict::OwnerApprovalRequired),
        _ => None,
    }
}

/// What the provider actually returned, normalised.
///
/// EVERY FIELD IS AN OBSERVATION, and the caller of `execute` never gets to choose one. In
/// particular the verdict is the provider's, reported by the Host's own execution path; a caller
/// cannot submit "the verdict was approve" as an input, which is the difference between an
/// attestation and a rubber stamp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderOutcome {
    /// The provider's own response identity, so an attestation can be traced to one real call.
    pub provider_response_id: String,
    /// Provider identity (e.g. the vendor).
    pub provider: String,
    /// Model identity.
    pub model: String,
    /// Tier or routing class.
    pub tier: String,
    /// The normalised verdict.
    pub verdict: ReviewVerdict,
    /// The actions this verdict permits, as the review named them.
    pub allowed_actions: Vec<String>,
    /// Whether the review says an owner must still approve.
    pub owner_approval_required: bool,
    /// Input tokens, as billed.
    pub input_tokens: u64,
    /// Output tokens, as billed.
    pub output_tokens: u64,
    /// Cached input tokens, when the provider reported them. Carried so the caller's own ledger can
    /// settle at what was billed; `None` is "not reported", never zero.
    pub cached_input_tokens: Option<u64>,
    /// What the independent reviewer DECIDED, in the reviewer's own words and vocabulary.
    pub decision: ReviewedDecision,
}

/// THE REVIEWER'S CHOICES - and nothing the reviewer is not responsible for.
///
/// PROJECTOS-HOST-REVIEW-PATH1A. The agent consumes a full decision record, and until this phase the
/// Host could not produce one: [`ProviderOutcome`] carried a verdict class, the permitted actions and
/// a cost, and nothing else. This is the missing half.
///
/// WHAT IS DELIBERATELY NOT HERE. There is no project, repository, plan, phase, subject commit, request
/// digest or correlation in this struct. Those are HOST-RESOLVED BINDING FACTS: a reviewer asked "is
/// this candidate acceptable" is not an authority on which project it was asked about, and a provider
/// that could state them could be steered into vouching for something else. They reach the response
/// record from the verified request subject, only after the Host has proven their canonical digests
/// equal the facts it resolved for itself - see `envelope::verify_declared_bindings`.
///
/// EVERY FIELD IS AN OBSERVATION of what the provider returned, reported by the Host's own execution
/// path. A caller never supplies one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewedDecision {
    /// The reviewer's own identifier for this decision, so a replayed answer is recognisable.
    pub decision_id: String,
    /// The verdict in the ASKING contract's own vocabulary (the technical one has seven values, the
    /// closure one three). The Host normalises it into [`ReviewVerdict`] for the attestation; this is
    /// kept verbatim because the agent's contract is defined over it.
    pub verdict: String,
    /// Why. An unexplained verdict is not reviewable, and the agent's contract refuses one.
    pub reason: String,
    /// What the implementer should do next, as the reviewer put it. Empty for a closure answer.
    pub next_instruction: String,
    /// Actions the reviewer explicitly forbids.
    pub forbidden_actions: Vec<String>,
    /// Who decided. Compared by the agent against the decider the PLAN names, never trusted as a claim.
    pub decided_by: String,
    /// When, as the reviewer stated it.
    pub decided_at: String,
}

// -------------------------------------------------------------------------------------------------
// ATTESTATION
// -------------------------------------------------------------------------------------------------

/// A Host-owned attestation of one independent review that actually happened.
///
/// MINTED ONLY BY [`run_gatekeeper_review`], and only after a real execution returned a real
/// provider result. There is no public constructor, no `Default`, and — the part that was missing —
/// NO PUBLIC FIELD.
///
/// A private seal alone was not enough, and saying it was would have been the more dangerous kind of
/// wrong. The seal blocks fresh construction by struct literal, but every data field was public and
/// the record is returned BY VALUE, so any holder could rewrite the verdict, the cost or the
/// owner-approval flag afterwards — and `derive_id` covers none of those, so the identity would not
/// have moved. A downstream reader treating the id as a content check would have seen nothing wrong.
/// The fields are private with read-only accessors, so the record a caller holds is the record the
/// Host minted.
///
/// WHAT IT NEVER CARRIES: a credential, a token, hidden reasoning, chain-of-thought, or the raw
/// provider body. It carries what a later decision needs to check and nothing that would make the
/// record itself sensitive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostAttestation {
    _seal: Seal,
    schema_version: u32,
    attestation_id: [u8; DIGEST_LEN],
    project: [u8; DIGEST_LEN],
    repository: [u8; DIGEST_LEN],
    plan: [u8; DIGEST_LEN],
    plan_digest: [u8; DIGEST_LEN],
    phase: [u8; DIGEST_LEN],
    candidate_digest: [u8; DIGEST_LEN],
    baseline_commit: [u8; BASELINE_COMMIT_LEN],
    evidence_digest: [u8; DIGEST_LEN],
    request_correlation: [u8; crate::CORRELATION_LEN],
    delegation_id: [u8; DIGEST_LEN],
    provider_response_id: String,
    provider: String,
    model: String,
    tier: String,
    verdict: ReviewVerdict,
    allowed_actions: Vec<String>,
    owner_approval_required: bool,
    input_tokens: u64,
    output_tokens: u64,
    admitted_cost_micro_usd: u64,
    attested_at_epoch_s: u64,
}

/// Private seal. A record carrying this cannot be built outside this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Seal;

impl HostAttestation {
    /// Schema version of this record.
    #[must_use]
    pub fn schema_version(&self) -> u32 {
        self.schema_version
    }
    /// The project this review was for.
    #[must_use]
    pub fn project(&self) -> &[u8; DIGEST_LEN] {
        &self.project
    }
    /// Canonical repository identity, so a project id alone cannot impersonate another checkout.
    #[must_use]
    pub fn repository(&self) -> &[u8; DIGEST_LEN] {
        &self.repository
    }
    /// The plan id.
    #[must_use]
    pub fn plan(&self) -> &[u8; DIGEST_LEN] {
        &self.plan
    }
    /// The exact plan digest it was reviewed under.
    #[must_use]
    pub fn plan_digest(&self) -> &[u8; DIGEST_LEN] {
        &self.plan_digest
    }
    /// The phase.
    #[must_use]
    pub fn phase(&self) -> &[u8; DIGEST_LEN] {
        &self.phase
    }
    /// The candidate actually reviewed.
    #[must_use]
    pub fn candidate_digest(&self) -> &[u8; DIGEST_LEN] {
        &self.candidate_digest
    }

    /// The approved baseline commit the evidence was measured from.
    #[must_use]
    pub fn baseline_commit(&self) -> &[u8; BASELINE_COMMIT_LEN] {
        &self.baseline_commit
    }

    /// The digest of the canonical candidate evidence the reviewer was shown. The agent recomputes
    /// it from the same baseline and candidate and refuses an attestation that disagrees.
    #[must_use]
    pub fn evidence_digest(&self) -> &[u8; DIGEST_LEN] {
        &self.evidence_digest
    }
    /// The gatekeeper request this answers.
    #[must_use]
    pub fn request_correlation(&self) -> &[u8; crate::CORRELATION_LEN] {
        &self.request_correlation
    }
    /// The owner delegation the Host validated.
    #[must_use]
    pub fn delegation_id(&self) -> &[u8; DIGEST_LEN] {
        &self.delegation_id
    }
    /// The provider's own response identity.
    #[must_use]
    pub fn provider_response_id(&self) -> &str {
        &self.provider_response_id
    }
    /// Provider identity.
    #[must_use]
    pub fn provider(&self) -> &str {
        &self.provider
    }
    /// Model identity.
    #[must_use]
    pub fn model(&self) -> &str {
        &self.model
    }
    /// Tier or routing class.
    #[must_use]
    pub fn tier(&self) -> &str {
        &self.tier
    }
    /// THE VERDICT, as the provider returned it.
    #[must_use]
    pub fn verdict(&self) -> ReviewVerdict {
        self.verdict
    }
    /// The actions this verdict permits.
    #[must_use]
    pub fn allowed_actions(&self) -> &[String] {
        &self.allowed_actions
    }
    /// Whether an owner must still approve.
    #[must_use]
    pub fn owner_approval_required(&self) -> bool {
        self.owner_approval_required
    }
    /// Input tokens, as billed.
    #[must_use]
    pub fn input_tokens(&self) -> u64 {
        self.input_tokens
    }
    /// Output tokens, as billed.
    #[must_use]
    pub fn output_tokens(&self) -> u64 {
        self.output_tokens
    }
    /// THE AMOUNT THE HOST ADMITTED against the budget for this review, in micro-USD: the
    /// owner-signed figure the reservation was made at.
    ///
    /// NOT A PROVIDER COST, and not named like one. The Host has no rate card, so it cannot state what
    /// a provider billed and revision 2 does not pretend to: there is no accounted-cost or billed-cost
    /// field on this type at all, and the token counts beside it are the provider's own report, not a
    /// price. Revision 1 called this field a cost; that name is why revision 2 exists.
    #[must_use]
    pub fn admitted_cost_micro_usd(&self) -> u64 {
        self.admitted_cost_micro_usd
    }
    /// When the Host minted it, by its own clock.
    #[must_use]
    pub fn attested_at_epoch_s(&self) -> u64 {
        self.attested_at_epoch_s
    }

    /// Derive a stable identity from the bindings that make this attestation what it is.
    ///
    /// DERIVED, NOT CHOSEN. An identity a caller could pick is an identity a caller could collide
    /// with an existing record, and one-shot storage keyed on it would then refuse the real one or
    /// accept a second. Every binding that distinguishes one review from another is folded in.
    fn derive_id(
        project: &[u8; DIGEST_LEN],
        repository: &[u8; DIGEST_LEN],
        plan_digest: &[u8; DIGEST_LEN],
        phase: &[u8; DIGEST_LEN],
        candidate_digest: &[u8; DIGEST_LEN],
        baseline_commit: &[u8; BASELINE_COMMIT_LEN],
        evidence_digest: &[u8; DIGEST_LEN],
        correlation: &[u8; crate::CORRELATION_LEN],
        provider_response_id: &str,
    ) -> [u8; DIGEST_LEN] {
        let mut h = Sha256::new();
        // v2: the identity covers what the reviewer was SHOWN. Every field before the response id is
        // fixed width, so the concatenation is unambiguous.
        h.update(b"projectos-host-attestation-v2");
        h.update(project);
        h.update(repository);
        h.update(plan_digest);
        h.update(phase);
        h.update(candidate_digest);
        h.update(baseline_commit);
        h.update(evidence_digest);
        h.update(correlation);
        h.update(provider_response_id.as_bytes());
        h.finalize().into()
    }

    /// This attestation's derived identity.
    #[must_use]
    pub fn attestation_id(&self) -> &[u8; DIGEST_LEN] {
        &self.attestation_id
    }
}

// -------------------------------------------------------------------------------------------------
// THE OPERATION
// -------------------------------------------------------------------------------------------------

/// Why the Host refused. Coarse by design: a refusal taxonomy is an oracle, so it names the gate
/// that refused rather than the value that failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostRefusal {
    /// The installed trust manifest is absent or unreadable.
    ManifestUnavailable,
    /// The manifest did not parse under the strict contract.
    ManifestMalformed,
    /// The manifest, its signature, its version or its execution closure did not verify.
    ExecutionClosureRefused(IdentityError),
    /// A committed closure artefact could not be established. Never treated as "unchanged".
    CommittedBytesUnavailable,
    /// The Host's trusted-executable policy does not hold.
    ExecutablePolicyRefused,
    /// The inbox refused the request.
    RequestRefused(InboxRefusal),
    /// Execution did not produce a usable result.
    ExecutionRefused(ExecutionFailure),
    /// An attestation with this identity already exists. One review, one answer.
    AttestationAlreadyStored,
    /// The attestation could not be stored durably, so it must not be acted on.
    AttestationNotStored,
    /// The verified request subject did not name the facts the Host resolved for itself.
    ///
    /// DECIDED BEFORE EXECUTION, so nothing reaches a provider: a subject whose declared project,
    /// phase, candidate or correlation disagrees with the Host's own facts is refused while it is
    /// still only bytes.
    SubjectBindingRefused,
    /// The Host could not establish evidence of the candidate. Decided before execution.
    CandidateEvidenceRefused(EvidenceUnavailable),
    /// The Host could not build its provider request from the verified facts and the owner's policy.
    /// Decided before execution.
    ProviderRequestRefused(RequestBuildRefusal),
    /// The evidence is not evidence OF THE AUTHORISED REVIEW: its candidate is not the candidate the
    /// authority was minted for, or its baseline is not the approved one. Decided before execution.
    EvidenceBindingRefused,
}

impl HostRefusal {
    /// Could a provider have been reached before this refusal was decided?
    ///
    /// THE DISPATCH FACT, OWNED BY THE MODULE THAT OWNS THE ORDER. A caller holds a budget reservation
    /// for every review it asks for, and what it does with that reservation depends on exactly this:
    /// release it when nothing was dispatched, keep it when money may have been spent. Answering here
    /// - with an EXHAUSTIVE match, so a refusal added later cannot be silently classified - keeps the
    /// answer next to the ordered steps it is derived from.
    ///
    /// `false` ONLY WHERE THE ORDER PROVES IT. Every variant decided before step 6 is `false`, and so
    /// is a credential that could not be resolved, because that failure is documented as "no
    /// credential, no call". Everything else is `true`, including [`ExecutionFailure::ProviderUnavailable`],
    /// whose own text says "not reached, OR refused": an ambiguity about money is resolved towards
    /// retaining it, never towards handing it back.
    #[must_use]
    pub fn provider_may_have_been_dispatched(&self) -> bool {
        match self {
            Self::ManifestUnavailable
            | Self::ManifestMalformed
            | Self::ExecutionClosureRefused(_)
            | Self::CommittedBytesUnavailable
            | Self::ExecutablePolicyRefused
            | Self::RequestRefused(_)
            | Self::SubjectBindingRefused
            | Self::CandidateEvidenceRefused(_)
            | Self::ProviderRequestRefused(_)
            | Self::EvidenceBindingRefused
            | Self::ExecutionRefused(ExecutionFailure::CredentialUnavailable) => false,
            Self::ExecutionRefused(_)
            | Self::AttestationAlreadyStored
            | Self::AttestationNotStored => true,
        }
    }
}

/// Everything the Host resolved for this one review, independently of the caller.
///
/// These are facts, not claims. A caller's frame carries digests; the Host resolves these from the
/// plan record, the phase record and repository state it verifies itself, and the request-scoped C4
/// evaluation in `windows-local-ipc` has already compared the two before this operation runs.
pub struct ReviewContext<'a> {
    pub project: [u8; DIGEST_LEN],
    pub repository: [u8; DIGEST_LEN],
    pub plan: [u8; DIGEST_LEN],
    pub plan_digest: [u8; DIGEST_LEN],
    pub phase: [u8; DIGEST_LEN],
    pub candidate_digest: [u8; DIGEST_LEN],
    pub correlation: [u8; crate::CORRELATION_LEN],
    pub delegation_id: [u8; DIGEST_LEN],
    /// The digest the authority wire carried for the request parameters.
    pub parameter_digest: &'a [u8; DIGEST_LEN],
    /// The approved baseline commit of the phase, from the durable approved-plan record.
    pub baseline_commit: [u8; BASELINE_COMMIT_LEN],
}

/// The ports the Host composes for one review.
pub struct HostPorts<'a> {
    pub manifest: &'a dyn TrustManifestPort,
    pub committed: &'a dyn CommittedBytesPort,
    pub executables: &'a dyn ExecutablePolicyPort,
    pub inbox: &'a dyn InboxReader,
    pub execution: &'a dyn GatekeeperExecutionPort,
    pub clock: &'a dyn ClockPort,
    /// The Host's own reading of the candidate, and its boundary-marker source.
    pub evidence: &'a dyn CandidateEvidencePort,
}

/// Run one independent gatekeeper review, or refuse.
///
/// THE ORDER BELOW IS THE CONTROL. Read it as a sequence of things each step prevents:
///
///  1–3. The manifest is read, parsed and its SIGNATURE established, together with the execution
///       closure, before anything signed is believed. Doing this after reading the broker would mean
///       trusting bytes to tell us whether to trust them.
///  4.   The trusted-executable policy, before any execution is contemplated.
///  5.   The request is consumed ONE-SHOT and its bytes bound to the digest the wire carried, so the
///       subject cannot change between verification and execution and cannot be replayed.
///  6.   Only now does anything run.
///  7.   Cost is required. An unknown cost is refused rather than recorded as free.
///  8.   The attestation is minted from what actually happened and stored ONE-SHOT before it is
///       returned — an attestation the caller holds but the Host never durably recorded would be a
///       claim that survives a restart as if it were a fact.
///
/// `verify_execution_closure` is called HERE, from the Host's own decision path. That closes the
/// standing finding that it existed with no production caller — subject to the honest caveat that
/// the adapters behind these ports are the next phase.
pub fn run_gatekeeper_review(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
) -> Result<HostAttestation, HostRefusal> {
    run_gatekeeper_review_attested(ports, lifecycle, store, ctx, &|_| true)
        .map(|review| review.attestation)
}

/// One completed independent review: the Host's attestation AND what the reviewer decided.
///
/// The two travel together because the agent needs both and must be able to check one against the
/// other: the attestation vouches for a verdict class, permitted actions and an owner-approval flag,
/// and the decision is the answer those are supposed to agree with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestedReview {
    /// The Host's sealed attestation, durably stored before this value existed.
    pub attestation: HostAttestation,
    /// The reviewer's own choices, verbatim.
    pub decision: ReviewedDecision,
    /// The verified subject the reviewer was asked about. The exact bytes that were bound to the
    /// authority's parameter digest and sent to the provider - so whoever builds the response record
    /// reads the declared bindings from the SAME bytes that were reviewed.
    pub subject: VerifiedRequestBody,
    /// Cached input tokens, when the provider reported them.
    pub cached_input_tokens: Option<u64>,
}

/// [`run_gatekeeper_review`], returning the reviewer's decision as well and admitting a SUBJECT GATE.
///
/// THE ORDER IS UNCHANGED, and that is the point of sharing it rather than writing a second one: the
/// manifest, the signature, the execution closure, the executable policy and the one-shot subject are
/// all decided exactly as before. The gate is asked about the verified subject AFTER it has been bound
/// to the authority's parameter digest and BEFORE anything executes, so a subject that names the wrong
/// project, phase or candidate is refused while it is still only bytes - and no provider is ever asked
/// about it.
///
/// `subject_gate` returns whether the subject may be executed. It is a plain predicate rather than a
/// port because it decides nothing about authority: it can only make this operation refuse.
///
/// # Errors
/// [`HostRefusal`], exactly as [`run_gatekeeper_review`], plus [`HostRefusal::SubjectBindingRefused`].
pub fn run_gatekeeper_review_attested(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
    subject_gate: &dyn Fn(&VerifiedRequestBody) -> bool,
) -> Result<AttestedReview, HostRefusal> {
    // 1. The installed manifest.
    let raw = ports
        .manifest
        .manifest_bytes()
        .ok_or(HostRefusal::ManifestUnavailable)?;
    let manifest = TrustManifest::parse(&raw).map_err(|_| HostRefusal::ManifestMalformed)?;

    // 2. The committed closure artefacts, named by the manifest itself. `None` is "could not
    //    establish", which is a refusal — never an assumption that nothing changed.
    // A VERSION 1 MANIFEST IS NOT A MANIFEST MISSING ITS CLOSURE. It is a valid manifest of what it
    // signed, from before the closure existed — the common case for every release to date. Reporting
    // it as `ExecutionClosureMissing` would name the wrong gate, and this module's own rule is that a
    // refusal names the gate that refused.
    if manifest.manifest_version < EXECUTION_CLOSURE_MANIFEST_VERSION {
        return Err(HostRefusal::ExecutionClosureRefused(
            IdentityError::ExecutionClosureManifestVersionTooLow,
        ));
    }
    if manifest.execution_closure.is_none() {
        return Err(HostRefusal::ExecutionClosureRefused(
            IdentityError::ExecutionClosureMissing,
        ));
    }
    // THE PATHS ARE THE CONTRACT'S, NEVER THE MANIFEST'S.
    //
    // These reads used to use `closure.<artefact>.repository_relative_path` — a string taken from a
    // manifest whose signature had not yet been checked. `verify_execution_closure` compares those
    // declared paths against these same constants a moment later, so no substitution ever survived;
    // but the READ ITSELF was aimed by unauthenticated bytes, which is precisely the ordering this
    // module says it exists to prevent, and it silently made "treat this path as hostile" the
    // problem of whoever implements `CommittedBytesPort`. Reading at the fixed constants removes the
    // question: an unsigned manifest cannot choose which file the Host opens.
    let broker = ports
        .committed
        .committed_bytes(contract::BROKER_REPOSITORY_RELATIVE_PATH)
        .ok_or(HostRefusal::CommittedBytesUnavailable)?;
    let allowlist = ports
        .committed
        .committed_bytes(contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH)
        .ok_or(HostRefusal::CommittedBytesUnavailable)?;
    let adapter = ports
        .committed
        .committed_bytes(contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH)
        .ok_or(HostRefusal::CommittedBytesUnavailable)?;

    // 3. SIGNATURE AND CLOSURE, under production policy against the embedded anchor. This refuses a
    //    version 1 manifest, an unsigned or altered one, a missing closure, and any artefact whose
    //    committed bytes are not the ones the owner signed.
    let verified_closure = verify_execution_closure(
        &manifest,
        Policy::Production,
        &ProductionEs256Verifier::from_embedded(),
        &CommittedClosureBytes {
            gatekeeper_broker: Some(&broker),
            installation_project_allowlist: Some(&allowlist),
            credential_adapter: Some(&adapter),
        },
    )
    .map_err(HostRefusal::ExecutionClosureRefused)?;
    // THE OWNER-SIGNED POLICY, from the closure that was just verified and from nowhere else: which
    // model reviews, which credential reference the broker resolves, and what the call may cost.
    let policy = ReviewExecutionPolicy::from_verified(&verified_closure);

    // Steps 4-8 are a separate function so they can be PROVEN. Nothing in a test can satisfy the
    // production anchor above — correctly, since no owner has signed a version 2 manifest yet — so a
    // test that could only enter through step 3 could never reach the cost, storage or replay
    // branches at all, and asserting around them would be theatre. This split lets those branches be
    // exercised directly without weakening the public path: the only way in from outside the crate
    // is still through the signature.
    execute_and_attest_gated(ports, lifecycle, store, ctx, subject_gate, &policy)
}

/// Steps 4-8, after the manifest, its signature and its execution closure have been established.
///
/// MODULE-PRIVATE — not merely crate-private: it is visible only to this module and its test
/// submodule, so not even `lib.rs` can call it. It assumes the closure was verified, which is exactly
/// why no caller outside this module may reach it — the assumption is discharged by `run_gatekeeper_review` and nowhere else.
#[cfg(test)]
fn execute_and_attest(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
    policy: &ReviewExecutionPolicy,
) -> Result<HostAttestation, HostRefusal> {
    execute_and_attest_gated(ports, lifecycle, store, ctx, &|_| true, policy)
        .map(|review| review.attestation)
}

/// FIXTURE-ONLY entry to steps 4-8, for a DEPENDENT crate's proofs.
///
/// WHY IT EXISTS. Steps 1-3 verify the installed manifest against the embedded production owner anchor,
/// and no owner has signed a version 2 manifest - so nothing outside this module can reach the cost,
/// storage, subject-gate or attestation branches through the public path, and a dependent crate's proof
/// of the responder and the sealed execution seam would be theatre. This exposes exactly what this
/// module's own tests already use, to exactly the graphs that ask for it.
///
/// Compiled ONLY under the non-default `test-fixtures` feature, which no shipped graph enables. The
/// production path is unchanged and still begins with the signature.
///
/// # Errors
/// [`HostRefusal`], as steps 4-8 report it.
#[cfg(any(test, feature = "test-fixtures"))]
pub fn run_gatekeeper_review_attested_for_fixture(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
    subject_gate: &dyn Fn(&VerifiedRequestBody) -> bool,
    policy: &ReviewExecutionPolicy,
) -> Result<AttestedReview, HostRefusal> {
    execute_and_attest_gated(ports, lifecycle, store, ctx, subject_gate, policy)
}

/// [`execute_and_attest`] with the subject gate and the reviewer's decision. Same steps, same order,
/// same module-private visibility; the ungated form above is this one with a gate that always admits.
fn execute_and_attest_gated(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
    subject_gate: &dyn Fn(&VerifiedRequestBody) -> bool,
    policy: &ReviewExecutionPolicy,
) -> Result<AttestedReview, HostRefusal> {
    // 4. The executables this operation will depend on are the Host's, not a caller's.
    if !ports.executables.executables_are_trusted() {
        return Err(HostRefusal::ExecutablePolicyRefused);
    }

    // 5. The request subject: derived identity, one open, one capped read, digest-bound, one-shot.
    let identity = RequestFileIdentity::for_correlation(&ctx.correlation);
    let subject = lifecycle
        .accept_once(ports.inbox, &identity, ctx.parameter_digest)
        .map_err(HostRefusal::RequestRefused)?;

    // 5b. THE SUBJECT NAMES WHAT THE HOST RESOLVED, OR NOTHING RUNS. The bytes are now bound to the
    //     authority's parameter digest, so this is the first moment they can be trusted to be the
    //     bytes that were authorised - and the last moment before a provider would see them.
    if !subject_gate(&subject) {
        return Err(HostRefusal::SubjectBindingRefused);
    }

    // 5c. THE HOST'S OWN EVIDENCE OF THE CANDIDATE, between the approved baseline and the pinned
    //     commit. The agent's bytes are a claim about a change; this is the change.
    let baseline = hex_lower(&ctx.baseline_commit);
    let evidence = ports
        .evidence
        .candidate_evidence(&baseline)
        .map_err(HostRefusal::CandidateEvidenceRefused)?;

    // 5d. IT MUST BE EVIDENCE OF THIS AUTHORISED REVIEW. The authority was minted over the candidate
    //     digest the Host resolved; evidence of any other commit, or measured from any other baseline,
    //     is evidence of something nobody authorised a review of.
    if committed_candidate_digest(evidence.candidate()) != Some(ctx.candidate_digest)
        || evidence.baseline() != baseline
    {
        return Err(HostRefusal::EvidenceBindingRefused);
    }

    // 5e. FRAME. The marker is generated only now, after both blocks are fixed, and is refused if it
    //     occurs in either.
    let marker = ports
        .evidence
        .boundary_marker()
        .ok_or(HostRefusal::CandidateEvidenceRefused(
            EvidenceUnavailable::MarkerUnavailable,
        ))?;
    let framed = FramedReviewInput::frame(&evidence, subject.bytes(), &marker)
        .map_err(|r| HostRefusal::CandidateEvidenceRefused(EvidenceUnavailable::Refused(r)))?;
    let evidence_digest = *framed.evidence_digest();

    // 5f. THE HOST AUTHORS THE PROVIDER REQUEST. The subject's project, phase and candidate are used
    //     as TEXT only because they are re-proven HERE to hash to the Host's own resolution - the
    //     caller's gate may have checked the same thing, but a fact this step depends on is a fact
    //     this step establishes. The model, the credential reference and the admitted cost are the
    //     owner's, from the signed closure; the agent nominates none of them.
    let parsed = crate::envelope::parse_review_subject(&subject)
        .filter(|parsed| crate::envelope::verify_declared_bindings(parsed, ctx))
        .ok_or(HostRefusal::SubjectBindingRefused)?;
    let request = HostProviderRequest::build(policy, &parsed, framed)
        .map_err(HostRefusal::ProviderRequestRefused)?;

    // 6. EXECUTION. The first and only effect, and it receives EXACTLY THE HOST-AUTHORED REQUEST — not
    //    a path, not a command, and not the agent's bytes on their own.
    let outcome = ports
        .execution
        .execute(&request)
        .map_err(HostRefusal::ExecutionRefused)?;

    // 7. WHAT THE HOST RECORDS IS WHAT IT ADMITTED, from the owner-signed policy - the same figure the
    //    budget reservation was made at. It is never taken from the execution outcome: the Host has no
    //    rate card, so nothing downstream of the provider can tell it what the call cost, and an
    //    outcome that offered a figure would be offering one nobody on this side measured.
    let admitted_cost_micro_usd = policy.admitted_cost_micro_usd();

    // 7b. THE REVIEWER'S VERDICT AND ITS NORMALISED CLASS MUST BE ONE ANSWER. The attestation vouches
    //     for the class; the decision carries the reviewer's own word. An execution path that reported
    //     an inconsistent pair would mint an attestation that vouches for something the reviewer did
    //     not say, so it is refused BEFORE the mint - as an unusable provider result, which it is.
    if normalised_verdict(&outcome.decision.verdict) != Some(outcome.verdict) {
        return Err(HostRefusal::ExecutionRefused(
            ExecutionFailure::ProviderResultUnusable,
        ));
    }
    let decision = outcome.decision.clone();
    let cached_input_tokens = outcome.cached_input_tokens;

    // 8. Mint from what happened, and store one-shot BEFORE returning.
    let attestation_id = HostAttestation::derive_id(
        &ctx.project,
        &ctx.repository,
        &ctx.plan_digest,
        &ctx.phase,
        &ctx.candidate_digest,
        &ctx.baseline_commit,
        &evidence_digest,
        &ctx.correlation,
        &outcome.provider_response_id,
    );
    let attestation = HostAttestation {
        _seal: Seal,
        schema_version: ATTESTATION_SCHEMA_VERSION,
        attestation_id,
        project: ctx.project,
        repository: ctx.repository,
        plan: ctx.plan,
        plan_digest: ctx.plan_digest,
        phase: ctx.phase,
        candidate_digest: ctx.candidate_digest,
        baseline_commit: ctx.baseline_commit,
        evidence_digest,
        request_correlation: ctx.correlation,
        delegation_id: ctx.delegation_id,
        provider_response_id: outcome.provider_response_id,
        provider: outcome.provider,
        model: outcome.model,
        tier: outcome.tier,
        verdict: outcome.verdict,
        allowed_actions: outcome.allowed_actions,
        owner_approval_required: outcome.owner_approval_required,
        input_tokens: outcome.input_tokens,
        output_tokens: outcome.output_tokens,
        admitted_cost_micro_usd,
        attested_at_epoch_s: ports.clock.now_epoch_s(),
    };

    match store.store_once(&attestation) {
        StoreOutcome::Stored => Ok(AttestedReview {
            attestation,
            decision,
            subject,
            cached_input_tokens,
        }),
        // Both refuse, and both are terminal — but they are different facts and the operator needs
        // to be told which one happened.
        StoreOutcome::AlreadyStored => Err(HostRefusal::AttestationAlreadyStored),
        StoreOutcome::Failed => Err(HostRefusal::AttestationNotStored),
    }
}

/// FIXTURE-ONLY candidate evidence, for this crate's proofs and a dependent crate's.
///
/// Compiled ONLY under `cfg(test)` or the non-default `test-fixtures` feature, which no shipped graph
/// enables. It reads no repository: production evidence comes from the one repository reader, through
/// the adapter in `gatekeeper-review-composition`.
#[cfg(any(test, feature = "test-fixtures"))]
pub mod evidence_fixture {
    use super::{
        committed_candidate_digest, CandidateEvidence, CandidateEvidencePort, EvidenceUnavailable,
        BASELINE_COMMIT_LEN, BOUNDARY_MARKER_LEN, DIGEST_LEN,
    };
    use crate::candidate_evidence::{EvidenceChange, EvidenceEntryInput};

    /// The commit the fixture evidence is evidence OF.
    pub const FIXTURE_CANDIDATE_COMMIT: &str = "c4d1da7ec4d1da7ec4d1da7ec4d1da7ec4d1da7e";
    /// The approved baseline a fixture review context states.
    pub const FIXTURE_BASELINE_COMMIT: [u8; BASELINE_COMMIT_LEN] = [0xb4; BASELINE_COMMIT_LEN];
    /// The boundary marker the fixture generates.
    pub const FIXTURE_MARKER: [u8; BOUNDARY_MARKER_LEN] = [0x5a; BOUNDARY_MARKER_LEN];

    /// The candidate digest a fixture review context must carry for the fixture evidence to bind.
    #[must_use]
    pub fn fixture_candidate_digest() -> [u8; DIGEST_LEN] {
        committed_candidate_digest(FIXTURE_CANDIDATE_COMMIT).expect("fixture commit is 40 lower hex")
    }

    /// Evidence of one added file at [`FIXTURE_CANDIDATE_COMMIT`], measured from whatever baseline it
    /// is asked for - or a stated refusal, a different candidate, or no marker.
    pub struct FixtureCandidateEvidence {
        /// The commit the evidence names as its candidate.
        pub candidate: String,
        /// When set, the baseline the evidence claims instead of the one it was asked for.
        pub baseline_override: Option<String>,
        /// When set, the evidence is refused with this reason.
        pub refusal: Option<EvidenceUnavailable>,
        /// The marker to generate; `None` models a marker source that failed.
        pub marker: Option<[u8; BOUNDARY_MARKER_LEN]>,
    }

    impl Default for FixtureCandidateEvidence {
        fn default() -> Self {
            Self {
                candidate: FIXTURE_CANDIDATE_COMMIT.to_string(),
                baseline_override: None,
                refusal: None,
                marker: Some(FIXTURE_MARKER),
            }
        }
    }

    impl CandidateEvidencePort for FixtureCandidateEvidence {
        fn candidate_evidence(&self, baseline: &str) -> Result<CandidateEvidence, EvidenceUnavailable> {
            if let Some(refusal) = self.refusal {
                return Err(refusal);
            }
            let baseline = self.baseline_override.as_deref().unwrap_or(baseline);
            CandidateEvidence::assemble(
                baseline,
                &self.candidate,
                vec![EvidenceEntryInput {
                    change: EvidenceChange::Added,
                    path: "src/reviewed.rs".to_string(),
                    old_mode: 0,
                    new_mode: 0o100_644,
                    old_id: "0".repeat(40),
                    new_id: "a".repeat(40),
                    new_contents: Some(b"fn reviewed() {}\n".to_vec()),
                }],
            )
            .map_err(EvidenceUnavailable::Refused)
        }

        fn boundary_marker(&self) -> Option<[u8; BOUNDARY_MARKER_LEN]> {
            self.marker
        }
    }

    // ---- a VALID review subject, and the Host facts it hashes to --------------------------------------

    /// The project the fixture subject declares.
    pub const FIXTURE_PROJECT_ID: &str = "projectos";
    /// The repository the fixture subject declares.
    pub const FIXTURE_REPOSITORY: &str = "github.com/acme/projectos";
    /// The plan reference the fixture subject declares.
    pub const FIXTURE_PLAN_REF: &str = "plan-fixture-0001";
    /// The phase the fixture subject declares.
    pub const FIXTURE_PHASE_ID: &str = "PHASE-FIXTURE-1A";
    /// The request identity the fixture subject declares.
    pub const FIXTURE_REQUEST_ID: &str = "GKREQ-fixture-000000000001";
    /// The correlation the fixture subject is written for.
    pub const FIXTURE_CORRELATION: [u8; crate::CORRELATION_LEN] = [1; crate::CORRELATION_LEN];

    /// A technical-review subject exactly as an agent would write it: declared facts that hash to
    /// [`fixture_context`], and an opaque agent-authored provider request that is now only a CLAIM.
    pub const FIXTURE_SUBJECT: &[u8] = br#"{"schemaVersion":1,"ask":"gatekeeper","correlation":"01010101010101010101010101010101","declared":{"projectId":"projectos","repository":"github.com/acme/projectos","planRef":"plan-fixture-0001","phaseId":"PHASE-FIXTURE-1A","subjectCommit":"c4d1da7ec4d1da7ec4d1da7ec4d1da7ec4d1da7e","requestId":"GKREQ-fixture-000000000001","requestDigest":"sha256:abababababababababababababababababababababababababababababababab"},"providerRequest":"{\"agentSays\":\"only a harmless comment changed\"}"}"#;

    /// The Host-resolved facts the fixture subject's declarations hash to.
    #[must_use]
    pub fn fixture_context<'a>(
        parameter_digest: &'a [u8; DIGEST_LEN],
        correlation: [u8; crate::CORRELATION_LEN],
    ) -> super::ReviewContext<'a> {
        use projectos_host_identity::{
            phase_identity_digest, plan_identity_digest, project_identity_digest,
            repository_identity_digest,
        };
        super::ReviewContext {
            project: project_identity_digest(FIXTURE_PROJECT_ID),
            repository: repository_identity_digest(FIXTURE_REPOSITORY),
            plan: plan_identity_digest(FIXTURE_PLAN_REF),
            plan_digest: [0x44; DIGEST_LEN],
            phase: phase_identity_digest(FIXTURE_PHASE_ID),
            candidate_digest: fixture_candidate_digest(),
            correlation,
            delegation_id: [0x88; DIGEST_LEN],
            parameter_digest,
            baseline_commit: FIXTURE_BASELINE_COMMIT,
        }
    }

    /// The owner-signed policy a fixture review executes under.
    #[must_use]
    pub fn fixture_policy() -> crate::provider_request::ReviewExecutionPolicy {
        crate::provider_request::ReviewExecutionPolicy::for_fixture(
            "openai",
            "gpt-5.6-terra",
            "PROJECTOS_GATEKEEPER_OPENAI_KEY",
            250_000,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::evidence_fixture::{
        fixture_candidate_digest, fixture_context, fixture_policy, FixtureCandidateEvidence,
        FIXTURE_BASELINE_COMMIT, FIXTURE_MARKER, FIXTURE_SUBJECT,
    };
    use super::*;

    /// A VALID subject: the operation now re-proves the declared bindings before it authors a request.
    const SUBJECT: &[u8] = FIXTURE_SUBJECT;

    fn sha(b: &[u8]) -> [u8; DIGEST_LEN] {
        let mut h = Sha256::new();
        h.update(b);
        h.finalize().into()
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
    struct Executables(bool);
    impl ExecutablePolicyPort for Executables {
        fn executables_are_trusted(&self) -> bool {
            self.0
        }
    }
    struct Inbox(Option<Vec<u8>>);
    impl InboxReader for Inbox {
        fn open_once(&self, _i: &RequestFileIdentity) -> Option<Box<dyn std::io::Read + '_>> {
            self.0
                .as_ref()
                .map(|b| Box::new(std::io::Cursor::new(b.clone())) as Box<dyn std::io::Read + '_>)
        }
    }
    struct Execution(Result<ProviderOutcome, ExecutionFailure>);
    impl GatekeeperExecutionPort for Execution {
        fn execute(&self, _s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
            self.0.clone()
        }
    }
    /// Panics if reached. The strongest way to assert "this never runs".
    struct MustNotExecute;
    impl GatekeeperExecutionPort for MustNotExecute {
        fn execute(&self, _s: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
            panic!("execution must not be reached");
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
    /// A store whose write genuinely FAILS — distinct from one that has already answered.
    struct FailingStore;
    impl AttestationStorePort for FailingStore {
        fn store_once(&mut self, _a: &HostAttestation) -> StoreOutcome {
            StoreOutcome::Failed
        }
    }

    fn outcome() -> ProviderOutcome {
        ProviderOutcome {
            provider_response_id: "resp_abc".into(),
            provider: "openai".into(),
            model: "gpt-5.6-terra".into(),
            tier: "closure".into(),
            verdict: ReviewVerdict::ApprovedToProceed,
            allowed_actions: vec!["close-phase".into()],
            owner_approval_required: false,
            input_tokens: 3_333,
            output_tokens: 512,
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

    fn ctx(d: &[u8; DIGEST_LEN], correlation: u8) -> ReviewContext<'_> {
        fixture_context(d, [correlation; crate::CORRELATION_LEN])
    }

    #[allow(clippy::too_many_arguments)]
    fn attest(
        executables: bool,
        body: Option<Vec<u8>>,
        exec: &dyn GatekeeperExecutionPort,
        store: &mut dyn AttestationStorePort,
        life: &mut RequestLifecycle,
        digest: &[u8; DIGEST_LEN],
        correlation: u8,
    ) -> Result<HostAttestation, HostRefusal> {
        let e = Executables(executables);
        let i = Inbox(body);
        let c = Clock;
        let ports = HostPorts {
            manifest: &NoManifest,
            committed: &NoCommitted,
            executables: &e,
            inbox: &i,
            execution: exec,
            clock: &c,
            evidence: &FixtureCandidateEvidence::default(),
        };
        execute_and_attest(&ports, life, store, &ctx(digest, correlation), &fixture_policy())
    }

    /// THE ONE PATH THAT WORKS, and everything it binds.
    #[test]
    fn a_real_execution_yields_a_bound_attestation() {
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        let a = attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut store,
            &mut life,
            &d,
            1,
        )
        .expect("the exact case must be attested");

        assert_eq!(a.schema_version(), ATTESTATION_SCHEMA_VERSION);
        assert_eq!(a.schema_version(), 2);
        assert_eq!(
            a.project(),
            &projectos_host_identity::project_identity_digest(evidence_fixture::FIXTURE_PROJECT_ID)
        );
        assert_eq!(a.plan_digest(), &[0x44; DIGEST_LEN]);
        assert_eq!(a.candidate_digest(), &fixture_candidate_digest());
        // PROJECTOS-HOST-REVIEW-PATH1B: it binds where the candidate was measured from and the digest
        // of exactly the evidence the fixture port produced for that baseline.
        assert_eq!(a.baseline_commit(), &FIXTURE_BASELINE_COMMIT);
        let expected = FixtureCandidateEvidence::default()
            .candidate_evidence(&hex_lower(&FIXTURE_BASELINE_COMMIT))
            .unwrap()
            .digest();
        assert_eq!(a.evidence_digest(), &expected);
        assert_eq!(a.delegation_id(), &[0x88; DIGEST_LEN]);
        assert_eq!(a.provider_response_id(), "resp_abc");
        assert_eq!(a.verdict(), ReviewVerdict::ApprovedToProceed);
        // The admitted amount is the POLICY's, never the outcome's: the outcome has no such field.
        assert_eq!(a.admitted_cost_micro_usd(), fixture_policy().admitted_cost_micro_usd());
        assert_eq!(a.attested_at_epoch_s(), 1_000);
        assert_eq!(store.stored.len(), 1, "it must be durably recorded");
    }

    /// THE EXECUTABLE POLICY IS A GATE, and it stands BEFORE execution.
    #[test]
    fn an_untrusted_executable_policy_refuses_before_anything_runs() {
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        let r = attest(
            false,
            Some(SUBJECT.to_vec()),
            &MustNotExecute,
            &mut store,
            &mut life,
            &d,
            1,
        );
        assert_eq!(r.unwrap_err(), HostRefusal::ExecutablePolicyRefused);
        assert!(store.stored.is_empty());
    }

    /// A SUBJECT THAT IS NOT THE ONE THE WIRE NAMED NEVER REACHES THE PROVIDER.
    #[test]
    fn a_request_digest_mismatch_refuses_before_anything_runs() {
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        let r = attest(
            true,
            Some(b"a different question entirely".to_vec()),
            &MustNotExecute,
            &mut store,
            &mut life,
            &d,
            1,
        );
        assert_eq!(
            r.unwrap_err(),
            HostRefusal::RequestRefused(InboxRefusal::ParameterDigestMismatch)
        );
        assert!(store.stored.is_empty());
    }

    /// A REQUEST IS ONE-SHOT: the same correlation cannot be reviewed twice.
    #[test]
    fn a_replayed_request_is_refused() {
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        assert!(attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut store,
            &mut life,
            &d,
            1
        )
        .is_ok());

        let r = attest(
            true,
            Some(SUBJECT.to_vec()),
            &MustNotExecute,
            &mut store,
            &mut life,
            &d,
            1,
        );
        assert_eq!(
            r.unwrap_err(),
            HostRefusal::RequestRefused(InboxRefusal::AlreadyConsumed),
            "a replayed request must not reach the provider a second time"
        );
        assert_eq!(store.stored.len(), 1);
    }

    /// EVERY EXECUTION FAILURE FAILS CLOSED, and none becomes an attestation.
    #[test]
    fn execution_failures_attest_nothing() {
        for f in [
            ExecutionFailure::CredentialUnavailable,
            ExecutionFailure::ProviderUnavailable,
            ExecutionFailure::ProviderResultUnusable,
        ] {
            let d = sha(SUBJECT);
            let mut store = Store::default();
            let mut life = RequestLifecycle::new();
            let r = attest(
                true,
                Some(SUBJECT.to_vec()),
                &Execution(Err(f)),
                &mut store,
                &mut life,
                &d,
                1,
            );
            assert_eq!(r.unwrap_err(), HostRefusal::ExecutionRefused(f));
            assert!(store.stored.is_empty(), "{f:?} must attest nothing");
        }
    }

    /// THE ATTESTED AMOUNT IS WHAT THE HOST ADMITTED, AND THE PROVIDER CANNOT MOVE IT. Two reviews whose
    /// providers reported wildly different usage attest the SAME amount - the owner-signed one - because
    /// the Host has no rate card and never turns usage into a price. (An execution outcome has no cost
    /// field to set, so "the provider states a cost" is not a case that can be written down here.)
    #[test]
    fn the_attested_amount_is_the_policys_admitted_amount_whatever_the_provider_reports() {
        let admitted = fixture_policy().admitted_cost_micro_usd();
        let mut amounts = Vec::new();
        for (input_tokens, output_tokens) in [(1u64, 1u64), (9_000_000, 4_000_000)] {
            let mut o = outcome();
            o.input_tokens = input_tokens;
            o.output_tokens = output_tokens;
            let d = sha(SUBJECT);
            let mut store = Store::default();
            let mut life = RequestLifecycle::new();
            let a = attest(
                true,
                Some(SUBJECT.to_vec()),
                &Execution(Ok(o)),
                &mut store,
                &mut life,
                &d,
                1,
            )
            .expect("the review attests");
            assert_eq!(a.input_tokens(), input_tokens, "usage is still the provider's own report");
            amounts.push(a.admitted_cost_micro_usd());
        }
        assert_eq!(amounts, vec![admitted, admitted]);
        assert_ne!(admitted, 0, "the fixture policy must admit a real amount or this proves nothing");
    }

    /// AN ATTESTATION THAT COULD NOT BE STORED IS A REFUSAL.
    ///
    /// A record the caller holds but the Host never durably recorded would survive a restart as a
    /// claim wearing the clothes of a fact.
    #[test]
    fn an_attestation_that_cannot_be_stored_is_refused() {
        let d = sha(SUBJECT);
        let mut life = RequestLifecycle::new();
        let r = attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut FailingStore,
            &mut life,
            &d,
            1,
        );
        assert_eq!(
            r.unwrap_err(),
            HostRefusal::AttestationNotStored,
            "a storage FAILURE must be reported as such, not as an already-answered review"
        );
    }

    /// THE ATTESTATION IDENTITY BINDS THE CANDIDATE AND THE PROVIDER RESPONSE.
    ///
    /// Two reviews that differ only in candidate — or only in which provider call answered — must not
    /// share an identity, or one-shot storage would refuse the second as a duplicate of the first.
    #[test]
    fn the_attestation_identity_distinguishes_candidate_and_response() {
        let base = HostAttestation::derive_id(
            &[0x11; DIGEST_LEN],
            &[0x22; DIGEST_LEN],
            &[0x44; DIGEST_LEN],
            &[0x55; DIGEST_LEN],
            &[0x66; DIGEST_LEN],
            &[0xb4; BASELINE_COMMIT_LEN],
            &[0xee; DIGEST_LEN],
            &[0x77; crate::CORRELATION_LEN],
            "resp_abc",
        );
        let other_candidate = HostAttestation::derive_id(
            &[0x11; DIGEST_LEN],
            &[0x22; DIGEST_LEN],
            &[0x44; DIGEST_LEN],
            &[0x55; DIGEST_LEN],
            &[0x67; DIGEST_LEN],
            &[0xb4; BASELINE_COMMIT_LEN],
            &[0xee; DIGEST_LEN],
            &[0x77; crate::CORRELATION_LEN],
            "resp_abc",
        );
        // PROJECTOS-HOST-REVIEW-PATH1B: the identity also covers WHAT THE REVIEWER WAS SHOWN and where it
        // was measured from, so the same candidate reviewed over different evidence is a different review.
        let id_with = |baseline: u8, evidence: u8| {
            HostAttestation::derive_id(
                &[0x11; DIGEST_LEN],
                &[0x22; DIGEST_LEN],
                &[0x44; DIGEST_LEN],
                &[0x55; DIGEST_LEN],
                &[0x66; DIGEST_LEN],
                &[baseline; BASELINE_COMMIT_LEN],
                &[evidence; DIGEST_LEN],
                &[0x77; crate::CORRELATION_LEN],
                "resp_abc",
            )
        };
        assert_eq!(id_with(0xb4, 0xee), base);
        assert_ne!(id_with(0xb5, 0xee), base, "another baseline is another review");
        assert_ne!(id_with(0xb4, 0xef), base, "other evidence is another review");

        let other_response = HostAttestation::derive_id(
            &[0x11; DIGEST_LEN],
            &[0x22; DIGEST_LEN],
            &[0x44; DIGEST_LEN],
            &[0x55; DIGEST_LEN],
            &[0x66; DIGEST_LEN],
            &[0xb4; BASELINE_COMMIT_LEN],
            &[0xee; DIGEST_LEN],
            &[0x77; crate::CORRELATION_LEN],
            "resp_xyz",
        );
        assert_ne!(base, other_candidate);
        assert_ne!(base, other_response);
        assert_ne!(other_candidate, other_response);
    }

    // ---- PROJECTOS-HOST-REVIEW-PATH1B: the review executes the HOST-FRAMED evidence -----------------

    /// Records exactly what execution was handed.
    struct Recording(std::cell::RefCell<Vec<u8>>);
    impl GatekeeperExecutionPort for Recording {
        fn execute(&self, request: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
            *self.0.borrow_mut() = request.framed().as_bytes().to_vec();
            Ok(outcome())
        }
    }

    fn attest_with_evidence(
        evidence: &dyn CandidateEvidencePort,
        exec: &dyn GatekeeperExecutionPort,
    ) -> Result<HostAttestation, HostRefusal> {
        let d = sha(SUBJECT);
        let (e, i, c) = (Executables(true), Inbox(Some(SUBJECT.to_vec())), Clock);
        let ports = HostPorts {
            manifest: &NoManifest,
            committed: &NoCommitted,
            executables: &e,
            inbox: &i,
            execution: exec,
            clock: &c,
            evidence,
        };
        execute_and_attest(
            &ports,
            &mut RequestLifecycle::new(),
            &mut Store::default(),
            &ctx(&d, 1),
            &fixture_policy(),
        )
    }

    /// EXECUTION RECEIVES EXACTLY THE FRAMED INPUT: the Host's evidence, then the agent's bytes as an
    /// unverified claim, under the generated marker - and never the agent's bytes on their own.
    #[test]
    fn execution_receives_exactly_the_host_framed_evidence() {
        let seen = Recording(std::cell::RefCell::new(Vec::new()));
        attest_with_evidence(&FixtureCandidateEvidence::default(), &seen).expect("attested");
        let text = String::from_utf8(seen.0.borrow().clone()).unwrap();
        let marker: String = FIXTURE_MARKER.iter().map(|b| format!("{b:02x}")).collect();

        assert!(text.starts_with(crate::candidate_evidence::REVIEWER_INSTRUCTIONS));
        assert!(text.contains(&format!("----- BEGIN HOST-ESTABLISHED {marker} -----")));
        assert!(text.contains("candidate-commit: c4d1da7ec4d1da7ec4d1da7ec4d1da7ec4d1da7e"));
        assert!(text.contains(&format!("baseline-commit: {}", "b4".repeat(20))));
        assert!(text.contains("[1] added src/reviewed.rs"));
        let claim = text
            .find(&format!("----- BEGIN AGENT-CLAIMED NOT HOST VERIFIED {marker} -----"))
            .expect("the agent's bytes are present only as a labelled claim");
        assert!(text[claim..].contains(std::str::from_utf8(SUBJECT).unwrap()));
        assert_ne!(seen.0.borrow().as_slice(), SUBJECT);
    }

    /// EVERY WAY EVIDENCE CAN FAIL RUNS NOTHING, and is classified as never dispatched so the caller
    /// releases its reservation rather than paying for a review that did not happen.
    #[test]
    fn evidence_that_cannot_be_established_or_bound_is_refused_before_anything_runs() {
        use EvidenceUnavailable::{
            BaselineNotAncestor, BaselineUnavailable, CandidateUnavailable, MarkerUnavailable,
            RepositoryRefused,
        };
        for reason in [BaselineUnavailable, CandidateUnavailable, BaselineNotAncestor, RepositoryRefused] {
            let port = FixtureCandidateEvidence { refusal: Some(reason), ..Default::default() };
            let refusal = attest_with_evidence(&port, &MustNotExecute).unwrap_err();
            assert_eq!(refusal, HostRefusal::CandidateEvidenceRefused(reason));
            assert!(!refusal.provider_may_have_been_dispatched());
        }

        // EVIDENCE OF ANOTHER COMMIT is not evidence of the candidate the authority was minted over.
        let other = FixtureCandidateEvidence {
            candidate: "d".repeat(40),
            ..Default::default()
        };
        let refusal = attest_with_evidence(&other, &MustNotExecute).unwrap_err();
        assert_eq!(refusal, HostRefusal::EvidenceBindingRefused);
        assert!(!refusal.provider_may_have_been_dispatched());

        // EVIDENCE MEASURED FROM ANOTHER BASELINE is not a change to what the owner approved.
        let moved = FixtureCandidateEvidence {
            baseline_override: Some("e".repeat(40)),
            ..Default::default()
        };
        assert_eq!(
            attest_with_evidence(&moved, &MustNotExecute).unwrap_err(),
            HostRefusal::EvidenceBindingRefused
        );

        // NO MARKER, NO FRAME, NO EXECUTION.
        let unmarked = FixtureCandidateEvidence { marker: None, ..Default::default() };
        assert_eq!(
            attest_with_evidence(&unmarked, &MustNotExecute).unwrap_err(),
            HostRefusal::CandidateEvidenceRefused(MarkerUnavailable)
        );

    }

    /// AN ATTESTATION CANNOT BE REPLAYED INTO THE STORE.
    #[test]
    fn a_second_identical_attestation_is_refused_by_one_shot_storage() {
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        assert!(attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut store,
            &mut life,
            &d,
            1
        )
        .is_ok());

        // A FRESH lifecycle — so the request gate cannot be what refuses. Only the store can.
        let mut life2 = RequestLifecycle::new();
        let r = attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut store,
            &mut life2,
            &d,
            1,
        );
        assert_eq!(r.unwrap_err(), HostRefusal::AttestationAlreadyStored);
        assert_eq!(store.stored.len(), 1, "one review, one durable answer");
    }

    // ---------------------------------------------------------------------------------------------
    // PROJECTOS-HOST-REVIEW-PATH1A: the subject gate, the reviewer's decision, and the dispatch fact
    // ---------------------------------------------------------------------------------------------

    fn attest_gated(
        exec: &dyn GatekeeperExecutionPort,
        store: &mut dyn AttestationStorePort,
        life: &mut RequestLifecycle,
        digest: &[u8; DIGEST_LEN],
        gate: &dyn Fn(&VerifiedRequestBody) -> bool,
    ) -> Result<AttestedReview, HostRefusal> {
        let e = Executables(true);
        let i = Inbox(Some(SUBJECT.to_vec()));
        let c = Clock;
        let ports = HostPorts {
            manifest: &NoManifest,
            committed: &NoCommitted,
            executables: &e,
            inbox: &i,
            execution: exec,
            clock: &c,
            evidence: &FixtureCandidateEvidence::default(),
        };
        execute_and_attest_gated(&ports, life, store, &ctx(digest, 1), gate, &fixture_policy())
    }

    /// A SUBJECT THE GATE REFUSES NEVER REACHES A PROVIDER. `MustNotExecute` panics if it is called, so
    /// this proves the order rather than asserting it: the gate sits after the digest binding and
    /// before execution.
    #[test]
    fn a_subject_the_gate_refuses_is_never_executed() {
        let d = sha(SUBJECT);
        let mut life = RequestLifecycle::default();
        let mut store = Store { stored: Vec::new() };
        let r = attest_gated(&MustNotExecute, &mut store, &mut life, &d, &|_| false);
        assert_eq!(r.unwrap_err(), HostRefusal::SubjectBindingRefused);
        assert!(store.stored.is_empty(), "a refused subject attests nothing");
    }

    /// THE GATE SEES THE VERIFIED BYTES - the exact bytes bound to the parameter digest - so whatever it
    /// decides, it decides about the subject that was authorised and not about a second read.
    #[test]
    fn the_gate_is_shown_the_digest_bound_subject() {
        let d = sha(SUBJECT);
        let mut life = RequestLifecycle::default();
        let mut store = Store { stored: Vec::new() };
        let seen = std::cell::RefCell::new(Vec::new());
        let r = attest_gated(&Execution(Ok(outcome())), &mut store, &mut life, &d, &|s| {
            seen.borrow_mut().extend_from_slice(s.bytes());
            true
        });
        assert!(r.is_ok());
        assert_eq!(seen.borrow().as_slice(), SUBJECT);
    }

    /// THE REVIEWER'S DECISION COMES BACK VERBATIM, beside an attestation that was stored first.
    #[test]
    fn an_attested_review_carries_the_reviewers_decision_and_the_reviewed_subject() {
        let d = sha(SUBJECT);
        let mut life = RequestLifecycle::default();
        let mut store = Store { stored: Vec::new() };
        let review = attest_gated(
            &Execution(Ok(outcome())),
            &mut store,
            &mut life,
            &d,
            &|_| true,
        )
        .expect("attested");
        assert_eq!(review.decision, outcome().decision);
        assert_eq!(review.subject.bytes(), SUBJECT);
        assert_eq!(store.stored.len(), 1, "stored before it was returned");
        assert_eq!(review.attestation.attestation_id(), &store.stored[0]);
    }

    /// THE DISPATCH FACT, VARIANT BY VARIANT. A caller releases its reservation on `false` and keeps it
    /// on `true`, so a wrong answer here is money handed back that was spent, or money held for a call
    /// that never happened. `ProviderUnavailable` is `true` on purpose: its own text says "not reached,
    /// OR refused", and an ambiguity about money resolves towards keeping it.
    #[test]
    fn the_dispatch_fact_follows_the_order_of_the_operation() {
        use crate::InboxRefusal;
        let never = [
            HostRefusal::ManifestUnavailable,
            HostRefusal::ManifestMalformed,
            HostRefusal::ExecutionClosureRefused(
                IdentityError::ExecutionClosureManifestVersionTooLow,
            ),
            HostRefusal::CommittedBytesUnavailable,
            HostRefusal::ExecutablePolicyRefused,
            HostRefusal::RequestRefused(InboxRefusal::RequestNotPresent),
            HostRefusal::RequestRefused(InboxRefusal::AlreadyConsumed),
            HostRefusal::SubjectBindingRefused,
            HostRefusal::ExecutionRefused(ExecutionFailure::CredentialUnavailable),
        ];
        for r in never {
            assert!(
                !r.provider_may_have_been_dispatched(),
                "{r:?} is decided before any dispatch"
            );
        }
        let possibly = [
            HostRefusal::ExecutionRefused(ExecutionFailure::ProviderUnavailable),
            HostRefusal::ExecutionRefused(ExecutionFailure::ProviderResultUnusable),
            HostRefusal::AttestationAlreadyStored,
            HostRefusal::AttestationNotStored,
        ];
        for r in possibly {
            assert!(
                r.provider_may_have_been_dispatched(),
                "{r:?} may follow a provider call"
            );
        }
    }

    /// THE UNGATED ENTRY POINT IS THE GATED ONE WITH A GATE THAT ADMITS. One order, not two.
    #[test]
    fn the_ungated_path_produces_the_same_attestation_as_an_admitting_gate() {
        let d = sha(SUBJECT);
        let mut s1 = Store { stored: Vec::new() };
        let mut s2 = Store { stored: Vec::new() };
        let plain = attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(outcome())),
            &mut s1,
            &mut RequestLifecycle::default(),
            &d,
            1,
        )
        .expect("attested");
        let gated = attest_gated(
            &Execution(Ok(outcome())),
            &mut s2,
            &mut RequestLifecycle::default(),
            &d,
            &|_| true,
        )
        .expect("attested");
        assert_eq!(plain.attestation_id(), gated.attestation.attestation_id());
    }
}
