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
    verify_execution_closure, CommittedClosureBytes, IdentityError, Policy,
    ProductionEs256Verifier, TrustManifest, EXECUTION_CLOSURE_MANIFEST_VERSION,
};
use projectos_packaged_runtime_contract as contract;

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
/// The port takes the VERIFIED request body — not a path, not a command, not a URL and not a
/// prompt — so an implementation cannot be handed anything else to run. There is deliberately no
/// argument through which an executable, a script, an environment or a provider endpoint could
/// arrive: those are the Host's, fixed by the attested closure it just verified.
pub trait GatekeeperExecutionPort {
    /// Run the review and report what the provider actually returned.
    fn execute(&self, subject: &VerifiedRequestBody) -> Result<ProviderOutcome, ExecutionFailure>;
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
    /// Actual cost in micro-USD. `None` when the provider did not report one — refused, never zero.
    pub cost_micro_usd: Option<u64>,
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
    cost_micro_usd: u64,
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
    /// Actual cost in micro-USD.
    #[must_use]
    pub fn cost_micro_usd(&self) -> u64 {
        self.cost_micro_usd
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
        correlation: &[u8; crate::CORRELATION_LEN],
        provider_response_id: &str,
    ) -> [u8; DIGEST_LEN] {
        let mut h = Sha256::new();
        h.update(b"projectos-host-attestation-v1");
        h.update(project);
        h.update(repository);
        h.update(plan_digest);
        h.update(phase);
        h.update(candidate_digest);
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
    /// The provider reported no cost. An unknown cost is refused, never recorded as zero.
    CostUnknown,
    /// An attestation with this identity already exists. One review, one answer.
    AttestationAlreadyStored,
    /// The attestation could not be stored durably, so it must not be acted on.
    AttestationNotStored,
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
}

/// The ports the Host composes for one review.
pub struct HostPorts<'a> {
    pub manifest: &'a dyn TrustManifestPort,
    pub committed: &'a dyn CommittedBytesPort,
    pub executables: &'a dyn ExecutablePolicyPort,
    pub inbox: &'a dyn InboxReader,
    pub execution: &'a dyn GatekeeperExecutionPort,
    pub clock: &'a dyn ClockPort,
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
    verify_execution_closure(
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

    // Steps 4-8 are a separate function so they can be PROVEN. Nothing in a test can satisfy the
    // production anchor above — correctly, since no owner has signed a version 2 manifest yet — so a
    // test that could only enter through step 3 could never reach the cost, storage or replay
    // branches at all, and asserting around them would be theatre. This split lets those branches be
    // exercised directly without weakening the public path: the only way in from outside the crate
    // is still through the signature.
    execute_and_attest(ports, lifecycle, store, ctx)
}

/// Steps 4-8, after the manifest, its signature and its execution closure have been established.
///
/// MODULE-PRIVATE — not merely crate-private: it is visible only to this module and its test
/// submodule, so not even `lib.rs` can call it. It assumes the closure was verified, which is exactly
/// why no caller outside this module may reach it — the assumption is discharged by `run_gatekeeper_review` and nowhere else.
fn execute_and_attest(
    ports: &HostPorts<'_>,
    lifecycle: &mut RequestLifecycle,
    store: &mut dyn AttestationStorePort,
    ctx: &ReviewContext<'_>,
) -> Result<HostAttestation, HostRefusal> {
    // 4. The executables this operation will depend on are the Host's, not a caller's.
    if !ports.executables.executables_are_trusted() {
        return Err(HostRefusal::ExecutablePolicyRefused);
    }

    // 5. The request subject: derived identity, one open, one capped read, digest-bound, one-shot.
    let identity = RequestFileIdentity::for_correlation(&ctx.correlation);
    let subject = lifecycle
        .accept_once(ports.inbox, &identity, ctx.parameter_digest)
        .map_err(HostRefusal::RequestRefused)?;

    // 6. EXECUTION. The first and only effect, and it receives the verified bytes — not a path, not
    //    a command, not a prompt a caller wrote.
    let outcome = ports
        .execution
        .execute(&subject)
        .map_err(HostRefusal::ExecutionRefused)?;

    // 7. A call whose cost nobody can state must not be recorded as free.
    let cost = outcome.cost_micro_usd.ok_or(HostRefusal::CostUnknown)?;

    // 8. Mint from what happened, and store one-shot BEFORE returning.
    let attestation_id = HostAttestation::derive_id(
        &ctx.project,
        &ctx.repository,
        &ctx.plan_digest,
        &ctx.phase,
        &ctx.candidate_digest,
        &ctx.correlation,
        &outcome.provider_response_id,
    );
    let attestation = HostAttestation {
        _seal: Seal,
        schema_version: 1,
        attestation_id,
        project: ctx.project,
        repository: ctx.repository,
        plan: ctx.plan,
        plan_digest: ctx.plan_digest,
        phase: ctx.phase,
        candidate_digest: ctx.candidate_digest,
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
        cost_micro_usd: cost,
        attested_at_epoch_s: ports.clock.now_epoch_s(),
    };

    match store.store_once(&attestation) {
        StoreOutcome::Stored => Ok(attestation),
        // Both refuse, and both are terminal — but they are different facts and the operator needs
        // to be told which one happened.
        StoreOutcome::AlreadyStored => Err(HostRefusal::AttestationAlreadyStored),
        StoreOutcome::Failed => Err(HostRefusal::AttestationNotStored),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUBJECT: &[u8] = b"the exact review subject";

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
        fn execute(&self, _s: &VerifiedRequestBody) -> Result<ProviderOutcome, ExecutionFailure> {
            self.0.clone()
        }
    }
    /// Panics if reached. The strongest way to assert "this never runs".
    struct MustNotExecute;
    impl GatekeeperExecutionPort for MustNotExecute {
        fn execute(&self, _s: &VerifiedRequestBody) -> Result<ProviderOutcome, ExecutionFailure> {
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
            cost_micro_usd: Some(1_333),
        }
    }

    fn ctx(d: &[u8; DIGEST_LEN], correlation: u8) -> ReviewContext<'_> {
        ReviewContext {
            project: [0x11; DIGEST_LEN],
            repository: [0x22; DIGEST_LEN],
            plan: [0x33; DIGEST_LEN],
            plan_digest: [0x44; DIGEST_LEN],
            phase: [0x55; DIGEST_LEN],
            candidate_digest: [0x66; DIGEST_LEN],
            correlation: [correlation; crate::CORRELATION_LEN],
            delegation_id: [0x88; DIGEST_LEN],
            parameter_digest: d,
        }
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
        };
        execute_and_attest(&ports, life, store, &ctx(digest, correlation))
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

        assert_eq!(a.schema_version(), 1);
        assert_eq!(a.project(), &[0x11; DIGEST_LEN]);
        assert_eq!(a.plan_digest(), &[0x44; DIGEST_LEN]);
        assert_eq!(a.candidate_digest(), &[0x66; DIGEST_LEN]);
        assert_eq!(a.delegation_id(), &[0x88; DIGEST_LEN]);
        assert_eq!(a.provider_response_id(), "resp_abc");
        assert_eq!(a.verdict(), ReviewVerdict::ApprovedToProceed);
        assert_eq!(a.cost_micro_usd(), 1_333);
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

    /// A CALL NOBODY CAN PRICE IS REFUSED, not recorded as free.
    #[test]
    fn an_unknown_cost_is_refused_and_attests_nothing() {
        let mut o = outcome();
        o.cost_micro_usd = None;
        let d = sha(SUBJECT);
        let mut store = Store::default();
        let mut life = RequestLifecycle::new();
        let r = attest(
            true,
            Some(SUBJECT.to_vec()),
            &Execution(Ok(o)),
            &mut store,
            &mut life,
            &d,
            1,
        );
        assert_eq!(r.unwrap_err(), HostRefusal::CostUnknown);
        assert!(store.stored.is_empty());
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
            &[0x77; crate::CORRELATION_LEN],
            "resp_abc",
        );
        let other_candidate = HostAttestation::derive_id(
            &[0x11; DIGEST_LEN],
            &[0x22; DIGEST_LEN],
            &[0x44; DIGEST_LEN],
            &[0x55; DIGEST_LEN],
            &[0x67; DIGEST_LEN],
            &[0x77; crate::CORRELATION_LEN],
            "resp_abc",
        );
        let other_response = HostAttestation::derive_id(
            &[0x11; DIGEST_LEN],
            &[0x22; DIGEST_LEN],
            &[0x44; DIGEST_LEN],
            &[0x55; DIGEST_LEN],
            &[0x66; DIGEST_LEN],
            &[0x77; crate::CORRELATION_LEN],
            "resp_xyz",
        );
        assert_ne!(base, other_candidate);
        assert_ne!(base, other_response);
        assert_ne!(other_candidate, other_response);
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
}
