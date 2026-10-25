//! Permit-to-effect-grant boundary (CD-B4-PERMIT-TO-EFFECT-GRANT-INTEGRATION1A + ISSUANCE/CURRENTNESS/
//! ROLLBACK-AMENDMENT1A).
//!
//! Eligibility is NOT effect authority. An [`ExecutionPermit`] proves an operation satisfied the reducer
//! at a specific authority context; it does not authorise any protected effect. This module is the
//! explicit, opaque, narrow, single-use, single-ISSUANCE boundary between a permit and one exact effect:
//!
//! ```text
//! ExecutionPermit --mint_effect_grant--> BoundedEffectGrant --adapter(clock)--> EffectWitness
//! ```
//!
//! A [`BoundedEffectGrant`] is opaque (private fields, no public constructor, no `Default`, no serde, no
//! `From<ExecutionPermit>`/`From<bool>`, redacted `Debug`), thread-bound (`!Send + !Sync`), CONSUMED on use
//! (moved into the adapter). It binds the exact permit context, operation, effect family/target/argument,
//! rollback policy, the trusted-clock provider identity + epoch it was minted under, a crate-assigned
//! single-use identity, and a validity boundary that can never exceed the canonical upstream authority
//! lease. Minting is single-ISSUANCE per (permit-context, effect-policy): a permit cannot mint a second
//! grant. The adapter re-establishes currentness against the sealed clock immediately before consumption.
//! An [`EffectWitness`] is evidence of an attempted effect (with the rollback outcome); never authority.
//!
//! ## Production readiness
//!
//! Synthetic and contract-level. The only adapter is a fixture ([`SyntheticEffectAdapter`], test-gated)
//! that performs NO operating-system mutation. Production durable issuance/consumption, real adapters and
//! real rollback execution are CARRY-FORWARD. `EXECUTION_READY` stays false.

#![allow(dead_code)]

use core::cell::RefCell;
use core::fmt;
use core::marker::PhantomData;
use std::collections::{HashMap, HashSet};

use sha2::{Digest, Sha256};

use projectos_trust_contract::OperationFingerprint;

use crate::capability::{ExecutionPermit, VerifiedExecutionContext};
use crate::facts::validate_bounded_id;

/// Makes every grant/witness `!Send + !Sync` on stable Rust (a raw pointer is neither). Never
/// dereferenced, always null. Mirrors the host-authority effect layer's thread-bound posture.
type ThreadBound = PhantomData<*const ()>;

// ---------------------------------------------------------------------------------------------
// Effect policy model (closed; never an arbitrary command or path)
// ---------------------------------------------------------------------------------------------

/// The closed set of effect families ProjectOS may eventually perform. Only [`EffectFamily::RecordMarker`]
/// has an adapter this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectFamily {
    /// The synthetic, effect-free proof effect (records a marker; no OS mutation).
    RecordMarker,
    /// A reserved family with NO adapter yet — proves the adapter refuses a family it cannot serve.
    ReservedNoAdapter,
}

/// A bounded effect target. Never an arbitrary path/executable/shell string — a validated bounded id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectTarget(String);

impl EffectTarget {
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// The bounded rollback strategy an effect may use. Closed; `Unavailable` is a sentinel a mint refuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RollbackStrategyId {
    /// Restore the prior state on failure.
    Restore,
    /// Delete the created artefact and verify deletion.
    DeleteVerify,
    /// No strategy available — a rollback-required effect with this strategy is refused at mint.
    Unavailable,
}

/// The rollback contract an effect is governed by. Folded into the operation fingerprint and bound into
/// the grant; immutable.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RollbackRequirement {
    /// Rollback not required.
    NotRequired,
    /// Rollback required with a strategy.
    Required { strategy: RollbackStrategyId },
    /// Rollback required, with a strategy AND a pre-validated precondition digest.
    PrevalidatedRequired {
        strategy: RollbackStrategyId,
        precondition_digest: [u8; 32],
    },
}

impl RollbackRequirement {
    fn tag(&self) -> u8 {
        match self {
            RollbackRequirement::NotRequired => 0,
            RollbackRequirement::Required { .. } => 1,
            RollbackRequirement::PrevalidatedRequired { .. } => 2,
        }
    }
    fn strategy(&self) -> Option<RollbackStrategyId> {
        match self {
            RollbackRequirement::NotRequired => None,
            RollbackRequirement::Required { strategy }
            | RollbackRequirement::PrevalidatedRequired { strategy, .. } => Some(*strategy),
        }
    }
    fn is_required(&self) -> bool {
        !matches!(self, RollbackRequirement::NotRequired)
    }
    fn digest_into(&self, h: &mut Sha256) {
        h.update([self.tag()]);
        match self.strategy() {
            None => h.update([0u8]),
            Some(RollbackStrategyId::Restore) => h.update([1u8]),
            Some(RollbackStrategyId::DeleteVerify) => h.update([2u8]),
            Some(RollbackStrategyId::Unavailable) => h.update([3u8]),
        }
        if let RollbackRequirement::PrevalidatedRequired {
            precondition_digest,
            ..
        } = self
        {
            h.update(precondition_digest);
        }
    }
}

/// A closed, narrowly-scoped effect requirement an operation is governed by. `None` on the operation means
/// "no protected effect". Folded into the operation fingerprint (family + target + argument + rollback).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredEffect {
    /// The exact effect family.
    pub family: EffectFamily,
    /// The exact bounded target.
    pub target: EffectTarget,
    /// The exact bounded argument (never arbitrary JSON / shell).
    pub argument: String,
    /// The rollback contract.
    pub rollback: RollbackRequirement,
}

impl RequiredEffect {
    fn family_tag(&self) -> u8 {
        match self.family {
            EffectFamily::RecordMarker => 1,
            EffectFamily::ReservedNoAdapter => 2,
        }
    }

    /// The domain-separated policy digest (stamped into the permit context by the reducer; re-derived at
    /// mint time so a grant can be minted only for the EXACT effect the operation was fingerprinted with).
    #[must_use]
    pub fn policy_digest(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:EFFECT-POLICY:V2");
        h.update([self.family_tag()]);
        h.update((self.target.as_str().len() as u64).to_be_bytes());
        h.update(self.target.as_str().as_bytes());
        h.update((self.argument.len() as u64).to_be_bytes());
        h.update(self.argument.as_bytes());
        self.rollback.digest_into(&mut h);
        h.finalize().into()
    }
}

/// Fold a required effect policy into an already-bound operation fingerprint. Changing the effect family,
/// target, argument OR rollback policy changes the fingerprint (so approval — bound by fingerprint — is
/// transitively effect-policy bound, and a prior permit/grant cannot be replayed after the policy changes).
#[must_use]
pub fn fold_effect_fingerprint(
    base: &OperationFingerprint,
    required: &RequiredEffect,
) -> OperationFingerprint {
    let mut h = Sha256::new();
    h.update(base.as_str().as_bytes());
    h.update(b"PROJECTOS:OPERATION-EFFECT-BINDING:V2");
    h.update(required.policy_digest());
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    OperationFingerprint::new(hex).expect("a 64-hex-digit token is a valid OperationFingerprint")
}

// ---------------------------------------------------------------------------------------------
// Canonical upstream authority lease bound (reducer-derived; opaque)
// ---------------------------------------------------------------------------------------------

/// The canonical upstream authority deadline: the MINIMUM over every applicable time-bounded authority in
/// the permit context (owner-presence lease, elevation lease, operation-expiry boundary, authority-expiry
/// boundary — all monotonic clock-scale deadlines). Opaque: private field, no public constructor, no
/// caller-supplied timestamp; minted ONLY by the reducer. A grant's `valid_until` can never exceed it, and
/// changing any contributing upstream bound changes it. Approval/publisher revocation are non-temporal and
/// are enforced separately by the reducer (they do not contribute a clock-scale deadline).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorityLeaseBound {
    bound: u64,
}

impl AuthorityLeaseBound {
    /// Reducer-only mint from the applicable deadlines. Returns `None` when NO deadline applies (fail
    /// closed downstream).
    pub(crate) fn derive(deadlines: &[Option<u64>]) -> Option<Self> {
        deadlines
            .iter()
            .flatten()
            .copied()
            .min()
            .map(|bound| Self { bound })
    }
    pub(crate) fn value(&self) -> u64 {
        self.bound
    }
}

// ---------------------------------------------------------------------------------------------
// Opaque bounded effect grant (single-use, single-issuance, currentness-revalidated)
// ---------------------------------------------------------------------------------------------

/// Why an effect-grant mint or consumption was refused. Fail closed; payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectGrantError {
    /// A bounded identifier was empty/over-long/illegal.
    Malformed,
    /// The permit's context does not match the freshly re-derived current context, on the named binding
    /// dimension (stale/changed permit). The exact [`crate::capability::ContextField`] is carried so every
    /// dimension is independently distinguishable.
    PermitContextMismatch(crate::capability::ContextField),
    /// The permit is no longer current against the injected clock (a lease expired / provider changed).
    PermitNotCurrent,
    /// The requested effect policy is not the one the operation (permit) was fingerprinted with.
    EffectPolicyMismatch,
    /// The requested grant validity exceeds the canonical upstream authority lease bound.
    ExpiryBeyondUpstream,
    /// No upstream authority deadline was present to bound the grant (fail closed).
    MissingLeaseBound,
    /// A grant was already issued for this (permit-context, effect-policy) — a permit mints at most one.
    AlreadyIssued,
    /// The grant was already consumed (single-use).
    AlreadyConsumed,
    /// A rollback-required effect had no available rollback strategy.
    RollbackUnavailable,
    /// The grant had expired at execution time (`now >= valid_until`).
    GrantExpired,
    /// The execution-time clock reading came from a different provider than the grant was minted under.
    ClockProviderMismatch,
    /// The execution-time clock reading came from a different provider epoch (clock restart).
    ClockEpochMismatch,
    /// The adapter was asked to perform an effect family/target it was not granted.
    WrongEffect,
    /// The grant is bound to a DIFFERENT trusted runtime instance than the live one presented at execution.
    RuntimeInstanceMismatch,
    /// The bound runtime instance is no longer current (restart / provider substitution / epoch / expiry).
    RuntimeNotCurrent,
    /// The grant is bound to a DIFFERENT authenticated IPC session than the live one at execution.
    IpcSessionMismatch,
    /// The bound IPC session is no longer current (reconnect / disconnect / revocation / provider / expiry).
    IpcNotCurrent,
}

/// Process-unique single-use grant identities. Crate-assigned; a caller cannot select or duplicate one.
static NEXT_GRANT_ID: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(1);

/// The single-issuance / single-use ledger. Records, per (permit-context ⊕ effect-policy) issuance key, an
/// [`IssuanceState`]; and separately the set of consumed grant nonces. A permit mints AT MOST ONE grant per
/// effect policy (default cardinality one). Crate-controlled; fixture-durable only — a PRODUCTION durable
/// ledger is CARRY-FORWARD.
#[derive(Default)]
pub struct EffectGrantLedger {
    issued: RefCell<HashMap<[u8; 32], IssuanceState>>,
    consumed: RefCell<HashSet<u64>>,
}

/// The lifecycle state of one issuance key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IssuanceState {
    /// A grant was issued and not yet consumed.
    Issued,
    /// The grant was consumed (an effect was attempted).
    Consumed,
    /// The outcome is unknown (crash between issue/consume and witness).
    Indeterminate,
}

impl EffectGrantLedger {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a single issuance for `key`. Default cardinality is exactly one: a second issuance for the
    /// same key (in ANY state) is refused. No reset exists.
    fn try_issue(&self, key: [u8; 32]) -> Result<(), EffectGrantError> {
        let mut m = self.issued.borrow_mut();
        if m.contains_key(&key) {
            return Err(EffectGrantError::AlreadyIssued);
        }
        m.insert(key, IssuanceState::Issued);
        Ok(())
    }

    pub(crate) fn mark_issuance(&self, key: [u8; 32], state: IssuanceState) {
        self.issued.borrow_mut().insert(key, state);
    }

    /// Record a single-use consumption by grant nonce. A second consumption of the same nonce is refused.
    pub(crate) fn consume(&self, grant_id: u64) -> Result<(), EffectGrantError> {
        if self.consumed.borrow_mut().insert(grant_id) {
            Ok(())
        } else {
            Err(EffectGrantError::AlreadyConsumed)
        }
    }
}

/// The issuance key: domain-separated over the permit-context digest and the effect-policy digest, so a
/// permit mints at most one grant per exact effect (a nonce change cannot bypass it, and a cloned permit
/// yields the same key).
fn issuance_key(permit_context_digest: [u8; 32], policy_digest: [u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:EFFECT-ISSUANCE-KEY:V1");
    h.update(permit_context_digest);
    h.update(policy_digest);
    h.finalize().into()
}

/// TEST-ONLY observability of the single-issuance key derivation, for the K-matrix issuance-identity
/// proofs. Gated behind `test-fixtures`; unavailable in the default/production graph.
#[cfg(any(test, feature = "test-fixtures"))]
#[must_use]
pub fn fixture_issuance_key(permit_context_digest: [u8; 32], policy_digest: [u8; 32]) -> [u8; 32] {
    issuance_key(permit_context_digest, policy_digest)
}

/// The recorded rollback outcome of an attempted effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RollbackOutcome {
    /// Rollback was not attempted (not required, or the effect succeeded).
    NotAttempted,
    /// Rollback ran and succeeded.
    Succeeded,
    /// Rollback ran and failed.
    Failed,
    /// The rollback outcome cannot be proven (crash).
    Indeterminate,
}

/// An opaque, single-use authorisation for exactly ONE bounded effect. Private fields, no public
/// constructor, no `Default`, no serde, no `Clone`/`Copy`, no `From<ExecutionPermit>`/`From<bool>`, redacted
/// `Debug`, `!Send + !Sync`. Minted ONLY by [`mint_effect_grant`] and CONSUMED (moved) by an adapter.
pub struct BoundedEffectGrant {
    grant_id: u64,
    issuance_key: [u8; 32],
    permit_context_digest: [u8; 32],
    operation: projectos_trust_contract::OperationRef,
    family: EffectFamily,
    target: EffectTarget,
    argument: String,
    rollback: RollbackRequirement,
    clock_provider: String,
    clock_epoch: u64,
    generation: u64,
    valid_until: u64,
    /// Canonical runtime-instance identity this grant is bound to (copied from the permit context). An
    /// execution adapter refuses a grant whose bound runtime differs from the live one. `None` = not bound.
    runtime_instance_digest: Option<[u8; 32]>,
    /// Canonical IPC-session identity this grant is bound to (copied from the permit context). `None` = not
    /// bound.
    ipc_session_digest: Option<[u8; 32]>,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for BoundedEffectGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BoundedEffectGrant([REDACTED])")
    }
}

impl BoundedEffectGrant {
    pub(crate) fn grant_id(&self) -> u64 {
        self.grant_id
    }
    pub(crate) fn issuance_key(&self) -> [u8; 32] {
        self.issuance_key
    }
    pub(crate) fn permit_context_digest(&self) -> [u8; 32] {
        self.permit_context_digest
    }
    pub(crate) fn operation(&self) -> &projectos_trust_contract::OperationRef {
        &self.operation
    }
    pub(crate) fn family(&self) -> EffectFamily {
        self.family
    }
    pub(crate) fn target(&self) -> &EffectTarget {
        &self.target
    }
    pub(crate) fn rollback(&self) -> &RollbackRequirement {
        &self.rollback
    }
    pub(crate) fn clock_provider(&self) -> &str {
        &self.clock_provider
    }
    pub(crate) fn clock_epoch(&self) -> u64 {
        self.clock_epoch
    }
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn valid_until(&self) -> u64 {
        self.valid_until
    }
    pub(crate) fn runtime_instance_digest(&self) -> Option<[u8; 32]> {
        self.runtime_instance_digest
    }
    pub(crate) fn ipc_session_digest(&self) -> Option<[u8; 32]> {
        self.ipc_session_digest
    }
}

/// Mint ONE bounded effect grant from an eligible permit. The SOLE construction path.
///
/// Fail-closed refusals: permit context must match the freshly re-derived `current`; the permit must be
/// current against the injected clock; the requested effect policy must be the fingerprinted one; the
/// canonical upstream lease bound must be present (else fail closed) and the requested validity must not
/// exceed it; a rollback-required policy must carry an available strategy; and no grant may already have
/// been issued for this (permit-context, effect-policy) — a permit mints at most one grant. The grant
/// records the trusted-clock provider identity + epoch for execution-time revalidation.
///
/// # Errors
/// [`EffectGrantError`] on the first failed invariant.
pub fn mint_effect_grant(
    permit: &ExecutionPermit,
    current: &VerifiedExecutionContext,
    clock: &dyn crate::authority_time::TrustedClock,
    required: &RequiredEffect,
    requested_valid_until: u64,
    ledger: &EffectGrantLedger,
) -> Result<BoundedEffectGrant, EffectGrantError> {
    validate_bounded_id(required.target.as_str()).map_err(|_| EffectGrantError::Malformed)?;
    validate_bounded_id(&required.argument).map_err(|_| EffectGrantError::Malformed)?;
    // Dimension-aware context comparison: the exact differing binding dimension is returned, so every
    // dimension is independently distinguishable (not one global boolean).
    if let crate::capability::ContextComparison::Mismatch(field) = permit.compare_context(current) {
        return Err(EffectGrantError::PermitContextMismatch(field));
    }
    if !permit.is_current(current, clock) {
        return Err(EffectGrantError::PermitNotCurrent);
    }
    let policy_digest = required.policy_digest();
    match current.effect_policy() {
        Some(digest) if digest == policy_digest => {}
        _ => return Err(EffectGrantError::EffectPolicyMismatch),
    }
    // A rollback-required effect must carry an available strategy.
    if required.rollback.is_required()
        && required.rollback.strategy() == Some(RollbackStrategyId::Unavailable)
    {
        return Err(EffectGrantError::RollbackUnavailable);
    }
    // The grant validity can never exceed the CANONICAL upstream lease bound (fail closed if absent).
    let bound = current
        .authority_lease_bound()
        .ok_or(EffectGrantError::MissingLeaseBound)?;
    if requested_valid_until > bound.value() {
        return Err(EffectGrantError::ExpiryBeyondUpstream);
    }
    // Single ISSUANCE per (permit-context, effect-policy): a permit mints at most one grant.
    let permit_digest = permit.context_digest();
    let key = issuance_key(permit_digest, policy_digest);
    ledger.try_issue(key)?;
    let now = clock.read_current();
    let grant_id = NEXT_GRANT_ID.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    Ok(BoundedEffectGrant {
        grant_id,
        issuance_key: key,
        permit_context_digest: permit_digest,
        operation: permit.operation_ref().clone(),
        family: required.family,
        target: required.target.clone(),
        argument: required.argument.clone(),
        rollback: required.rollback.clone(),
        clock_provider: now.provider_id().to_string(),
        clock_epoch: now.epoch(),
        generation: current.effect_generation(),
        valid_until: requested_valid_until,
        runtime_instance_digest: current.runtime_instance_digest(),
        ipc_session_digest: current.ipc_session_digest(),
        _thread_bound: PhantomData,
    })
}

// ---------------------------------------------------------------------------------------------
// Opaque effect witness (evidence, never authority)
// ---------------------------------------------------------------------------------------------

/// The outcome of an attempted synthetic effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectOutcome {
    /// The synthetic effect completed.
    Success,
    /// The effect was refused (currentness / wrong family/target / already consumed).
    Refused(EffectGrantError),
    /// The system cannot prove whether the effect completed.
    Indeterminate,
}

/// Opaque evidence of ONE attempted effect (with its rollback outcome). Evidence, never authority: there is
/// no path from a witness back to a grant. Private fields, redacted Debug, no serde, no public constructor.
pub struct EffectWitness {
    grant_id: u64,
    operation: projectos_trust_contract::OperationRef,
    family: EffectFamily,
    target: EffectTarget,
    before_digest: [u8; 32],
    after_digest: [u8; 32],
    outcome: EffectOutcome,
    rollback: RollbackOutcome,
    executor_id: String,
    generation: u64,
    completion_reading: u64,
    /// Redacted EVIDENCE that execution occurred under a specific runtime instance / IPC session. Never
    /// authority: there is no path from these back to a runtime instance, IPC session, permit or grant.
    runtime_instance_digest: Option<[u8; 32]>,
    ipc_session_digest: Option<[u8; 32]>,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for EffectWitness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "EffectWitness({:?}, {:?}, [REDACTED])",
            self.outcome, self.rollback
        )
    }
}

impl EffectWitness {
    #[must_use]
    pub fn outcome(&self) -> EffectOutcome {
        self.outcome
    }
    #[must_use]
    pub fn rollback_outcome(&self) -> RollbackOutcome {
        self.rollback
    }
    #[must_use]
    pub fn grant_id(&self) -> u64 {
        self.grant_id
    }
    #[must_use]
    pub fn operation(&self) -> &projectos_trust_contract::OperationRef {
        &self.operation
    }
    #[must_use]
    pub fn family(&self) -> EffectFamily {
        self.family
    }
    pub(crate) fn target(&self) -> &EffectTarget {
        &self.target
    }
    pub(crate) fn before_digest(&self) -> [u8; 32] {
        self.before_digest
    }
    pub(crate) fn after_digest(&self) -> [u8; 32] {
        self.after_digest
    }
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn completion_reading(&self) -> u64 {
        self.completion_reading
    }
    /// TEST-ONLY: the redacted runtime-instance evidence digest recorded on this witness (evidence only).
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_runtime_evidence(&self) -> Option<[u8; 32]> {
        self.runtime_instance_digest
    }
    /// TEST-ONLY: the redacted IPC-session evidence digest recorded on this witness (evidence only).
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_ipc_evidence(&self) -> Option<[u8; 32]> {
        self.ipc_session_digest
    }
}

// ---------------------------------------------------------------------------------------------
// Synthetic effect adapter (test-gated; NO OS mutation; execution-time currentness)
// ---------------------------------------------------------------------------------------------

#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture::{SyntheticEffectAdapter, SyntheticEffectScript};

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture {
    use super::{
        BoundedEffectGrant, EffectFamily, EffectGrantError, EffectGrantLedger, EffectOutcome,
        EffectTarget, EffectWitness, IssuanceState, RollbackOutcome, RollbackRequirement,
        RollbackStrategyId,
    };
    use sha2::{Digest, Sha256};

    /// What the fixture effect should model — success, or a failure whose rollback succeeds/fails, or a
    /// crash. No real work is performed on ANY path.
    #[derive(Debug, Clone, Copy)]
    pub enum SyntheticEffectScript {
        /// The effect succeeds; rollback is not invoked.
        Succeed,
        /// The effect fails; rollback runs and succeeds.
        FailRollbackSucceeds,
        /// The effect fails; rollback runs and fails.
        FailRollbackFails,
        /// The system crashes; the effect and rollback outcome are indeterminate.
        Crash,
    }

    /// A TEST-ONLY synthetic protected-effect adapter. Accepts ONLY a [`BoundedEffectGrant`] (by move),
    /// re-establishes currentness against the sealed clock immediately before consumption, records
    /// single-use, and emits an [`EffectWitness`] with the rollback outcome. NO OS mutation on any path.
    pub struct SyntheticEffectAdapter {
        executor_id: String,
    }

    impl SyntheticEffectAdapter {
        #[must_use]
        pub fn new() -> Self {
            Self {
                executor_id: "synthetic-effect-executor".into(),
            }
        }

        /// Perform the synthetic effect for `grant` per `script`. CONSUMES the grant. Refuses (with a
        /// witness carrying `Refused`, BEFORE any synthetic mutation) an expired grant, a substituted or
        /// restarted clock, a wrong family/target, or a replayed grant. No OS mutation occurs.
        #[must_use]
        pub fn perform(
            &self,
            grant: BoundedEffectGrant,
            expected_target: &EffectTarget,
            ledger: &EffectGrantLedger,
            clock: &dyn crate::authority_time::TrustedClock,
            script: SyntheticEffectScript,
        ) -> EffectWitness {
            let before = Self::state_digest(b"before", grant.grant_id());
            // EXECUTION-TIME currentness — read the sealed clock (never a caller timestamp): same provider,
            // same epoch, still before the grant's valid_until. Checked BEFORE any synthetic effect.
            let now = clock.read_current();
            let refusal = if now.provider_id() != grant.clock_provider() {
                Some(EffectGrantError::ClockProviderMismatch)
            } else if now.epoch() != grant.clock_epoch() {
                Some(EffectGrantError::ClockEpochMismatch)
            } else if now.reading() >= grant.valid_until() {
                Some(EffectGrantError::GrantExpired)
            } else if grant.family() != EffectFamily::RecordMarker
                || grant.target() != expected_target
            {
                Some(EffectGrantError::WrongEffect)
            } else {
                ledger.consume(grant.grant_id()).err()
            };
            if let Some(e) = refusal {
                // No synthetic effect ran; the issuance stays as-is.
                return self.witness(
                    &grant,
                    before,
                    before,
                    EffectOutcome::Refused(e),
                    RollbackOutcome::NotAttempted,
                    now.reading(),
                );
            }
            ledger.mark_issuance(grant.issuance_key(), IssuanceState::Consumed);
            // The synthetic effect (a recorded marker; no OS mutation) and its rollback per the script.
            let required_rollback = grant.rollback().is_required();
            let (outcome, rollback, after) = match script {
                SyntheticEffectScript::Succeed => (
                    EffectOutcome::Success,
                    RollbackOutcome::NotAttempted,
                    Self::state_digest(b"after", grant.grant_id()),
                ),
                SyntheticEffectScript::FailRollbackSucceeds => (
                    EffectOutcome::Refused(EffectGrantError::WrongEffect),
                    if required_rollback {
                        RollbackOutcome::Succeeded
                    } else {
                        RollbackOutcome::NotAttempted
                    },
                    before,
                ),
                SyntheticEffectScript::FailRollbackFails => (
                    EffectOutcome::Refused(EffectGrantError::WrongEffect),
                    if required_rollback {
                        RollbackOutcome::Failed
                    } else {
                        RollbackOutcome::NotAttempted
                    },
                    before,
                ),
                SyntheticEffectScript::Crash => {
                    ledger.mark_issuance(grant.issuance_key(), IssuanceState::Indeterminate);
                    (
                        EffectOutcome::Indeterminate,
                        RollbackOutcome::Indeterminate,
                        before,
                    )
                }
            };
            self.witness(&grant, before, after, outcome, rollback, now.reading())
        }

        /// Perform the synthetic effect for a runtime + IPC-BOUND `grant`. Immediately before consumption
        /// (in addition to the sealed-clock currentness in [`perform`]), re-establishes that the grant's
        /// bound runtime instance and IPC session are BOTH still current against the live authorities, and
        /// that the grant was bound to THOSE exact authorities. Refuses fail-closed (with a `Refused`
        /// witness, BEFORE any synthetic mutation) on a runtime restart/mismatch or an IPC
        /// reconnect/disconnect/revocation/mismatch. No OS mutation occurs.
        #[allow(clippy::too_many_arguments)]
        #[must_use]
        pub fn perform_bound<RV, IV>(
            &self,
            grant: BoundedEffectGrant,
            expected_target: &EffectTarget,
            ledger: &EffectGrantLedger,
            clock: &dyn crate::authority_time::TrustedClock,
            runtime: &crate::runtime_instance::VerifiedRuntimeInstance,
            runtime_verifier: &RV,
            ipc: &crate::ipc_session::BoundIpcSession,
            ipc_verifier: &IV,
            script: SyntheticEffectScript,
        ) -> EffectWitness
        where
            RV: crate::runtime_instance::RuntimeInstanceVerifier,
            IV: crate::ipc_session::IpcSessionVerifier,
        {
            let now = clock.read_current();
            let before = Self::state_digest(b"before", grant.grant_id());
            // Runtime + IPC execution-time currentness and binding-identity match, BEFORE any effect.
            let refusal = if grant.runtime_instance_digest() != Some(runtime.instance_digest()) {
                Some(EffectGrantError::RuntimeInstanceMismatch)
            } else if runtime.is_current(runtime_verifier, &now).is_err() {
                Some(EffectGrantError::RuntimeNotCurrent)
            } else if grant.ipc_session_digest() != Some(ipc.session_digest()) {
                Some(EffectGrantError::IpcSessionMismatch)
            } else if ipc.is_current(ipc_verifier, runtime, &now).is_err() {
                Some(EffectGrantError::IpcNotCurrent)
            } else {
                None
            };
            if let Some(e) = refusal {
                // No synthetic effect ran and the grant was NOT consumed; the issuance stays as-is.
                return self.witness(
                    &grant,
                    before,
                    before,
                    EffectOutcome::Refused(e),
                    RollbackOutcome::NotAttempted,
                    now.reading(),
                );
            }
            // Runtime + IPC current: delegate to the clock/family/consume/script path.
            self.perform(grant, expected_target, ledger, clock, script)
        }

        fn witness(
            &self,
            grant: &BoundedEffectGrant,
            before: [u8; 32],
            after: [u8; 32],
            outcome: EffectOutcome,
            rollback: RollbackOutcome,
            reading: u64,
        ) -> EffectWitness {
            EffectWitness {
                grant_id: grant.grant_id(),
                operation: grant.operation().clone(),
                family: grant.family(),
                target: grant.target().clone(),
                before_digest: before,
                after_digest: after,
                outcome,
                rollback,
                executor_id: self.executor_id.clone(),
                generation: grant.generation(),
                completion_reading: reading,
                runtime_instance_digest: grant.runtime_instance_digest(),
                ipc_session_digest: grant.ipc_session_digest(),
                _thread_bound: core::marker::PhantomData,
            }
        }

        fn state_digest(tag: &[u8], grant_id: u64) -> [u8; 32] {
            let mut h = Sha256::new();
            h.update(b"PROJECTOS:SYNTHETIC-EFFECT-STATE:V1");
            h.update(tag);
            h.update(grant_id.to_be_bytes());
            h.finalize().into()
        }
    }

    impl Default for SyntheticEffectAdapter {
        fn default() -> Self {
            Self::new()
        }
    }

    // Silence unused-variant warnings for the reserved rollback strategies in non-test builds.
    #[allow(dead_code)]
    fn _rollback_variants(r: &RollbackRequirement) -> Option<RollbackStrategyId> {
        match r {
            RollbackRequirement::Required { strategy }
            | RollbackRequirement::PrevalidatedRequired { strategy, .. } => Some(*strategy),
            RollbackRequirement::NotRequired => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eff(argument: &str, rollback: RollbackRequirement) -> RequiredEffect {
        RequiredEffect {
            family: EffectFamily::RecordMarker,
            target: EffectTarget::new("m"),
            argument: argument.into(),
            rollback,
        }
    }

    #[test]
    fn a_different_effect_policy_changes_the_fingerprint() {
        let base = OperationFingerprint::new("fp").unwrap();
        let a = eff("x", RollbackRequirement::NotRequired);
        let f1 = fold_effect_fingerprint(&base, &a);
        assert_ne!(
            f1,
            fold_effect_fingerprint(&base, &eff("y", RollbackRequirement::NotRequired))
        );
        // Rollback policy is part of the fingerprint.
        assert_ne!(
            f1,
            fold_effect_fingerprint(
                &base,
                &eff(
                    "x",
                    RollbackRequirement::Required {
                        strategy: RollbackStrategyId::Restore
                    }
                )
            )
        );
    }

    #[test]
    fn the_lease_bound_is_the_minimum_of_present_deadlines() {
        assert_eq!(
            AuthorityLeaseBound::derive(&[Some(200), Some(150), None, Some(300)])
                .map(|b| b.value()),
            Some(150)
        );
        assert_eq!(AuthorityLeaseBound::derive(&[None, None]), None);
    }

    #[test]
    fn the_ledger_is_single_issuance_and_single_use() {
        let l = EffectGrantLedger::new();
        let k = [7u8; 32];
        assert_eq!(l.try_issue(k), Ok(()));
        assert_eq!(l.try_issue(k), Err(EffectGrantError::AlreadyIssued));
        assert_eq!(l.consume(1), Ok(()));
        assert_eq!(l.consume(1), Err(EffectGrantError::AlreadyConsumed));
    }
}
