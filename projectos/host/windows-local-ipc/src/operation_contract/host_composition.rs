//! HOST PRODUCTION COMPOSITION — RUN-TO-COMPLETION HOST ATTESTATION §10A.
//!
//! ## What this module is
//!
//! The one ordered pass in which ProjectOSHost assembles, FROM ITS OWN SOURCES, every prerequisite
//! the closed §9 authority chain requires, and then asks that chain. It answers the phase's
//! question — "where does the Host obtain the sealed facts §9 requires?" — by naming a source for
//! each one and refusing when a source cannot answer.
//!
//! ## It is composition, not authority
//!
//! Nothing here mints an [`AuthorisedProtectedOperation`]. The sole mint is still the tail of
//! [`evaluate_protected_operation`], and this module reaches it the same way any caller would: by
//! presenting a verified delegation, a trusted peer, host-resolved facts and a fresh admission, and
//! being refused if any of them is wrong. What composition adds is that the Host — not the request,
//! not the record under test, and not whoever is calling — decides what each of those says.
//!
//! ## Why the production constructors live behind this module
//!
//! [`ExpectedProgramme`], [`HostDelegationStatus`] and [`HostResolvedRequestFacts`] gained their
//! production routes in §10A, and every one of them is `pub(crate)`. No crate in the workspace can
//! name them; the only way to obtain those sealed values is to run the order below, which begins
//! with the owner's signature. A public constructor would have been the ordinary shape and it would
//! have meant any crate could state what programme this installation is.
//!
//! ## What it will not do
//!
//! It opens no file, resolves no path, spawns no process, contacts no provider, reads no credential
//! and executes nothing. Every capability arrives as a named port, so each missing capability is a
//! NAMED GAP rather than a hidden assumption — and a Host that supplies no ports composes nothing.

#[cfg(feature = "test-fixtures")]
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_core::{BoundIpcSession, RequestAdmissionError, RequestAdmissionStore};
use projectos_host_identity::AttestedInstallationProgramme;

use super::request_replay::{ReplayRefusal, RequestReplayIdentity, RequestReplayLedger};
use super::{
    evaluate_protected_operation, sealed::Seal, AuthorisedProtectedOperation,
    ExecutionOutcomeEvidence, GatekeeperDelegationEvidence, HostResolvedFacts,
    HostResolvedRequestFacts, OperationClass, ProtectedOperationEvaluation,
    ProtectedOperationRequest, ProtectedOperationResponse, RejectionReason, ResultClass,
    TerminalStatus, TrustedPeerContext, VerifiedOwnerProgrammeDelegation, BINDING_DIGEST_LEN,
    CORRELATION_LEN, DELEGATION_DIGEST_LEN, EVIDENCE_REF_LEN,
};
use crate::owner_programme_delegation::{
    owner_provenance_established, verify_owner_programme_delegation, DelegationRefusal,
    DurableDelegationStateStore, ExpectedProgramme, HostClockReading, HostDelegationStatus,
    SignedOwnerProgrammeDelegation,
};

// -------------------------------------------------------------------------------------------------
// PORTS — the Host capabilities composition needs, each named
// -------------------------------------------------------------------------------------------------
//
// THESE ARE HOST CODE, NOT CALLER DATA. A port is implemented by the Host's own adapters; a request
// never reaches one. That is why most of them are ordinary traits rather than sealed ones — sealing
// buys protection against a workspace crate answering a question it should not, and it costs the
// ability to wire an adapter from anywhere but this crate. Each port below therefore says what
// CROSS-CHECK makes a wrong answer harmless, and the one port where no cross-check exists — the
// Host's own record of whether a delegation is still live — is sealed.

/// Width of an approved baseline commit: a full-length SHA-1 object identity, as raw bytes. Fixed
/// width and free of text for the same reason every other Host fact here is.
pub const BASELINE_COMMIT_LEN: usize = 20;

/// The Host's validated approved-plan authority for the phase under review.
///
/// CROSS-CHECKED BY THE OWNER'S RECORD. Everything this port reports is compared against the
/// owner-signed delegation inside `satisfy_c4_for_gatekeeper_request`: a plan, a plan digest or a
/// phase that is not the one the owner delegated opens nothing, so a port that answered wrongly
/// produces a refusal rather than an escalation.
///
/// `None` IS "COULD NOT ESTABLISH", NEVER "NOTHING IS WRONG". An adapter that cannot resolve the
/// active plan must answer `None` and be refused.
pub trait HostPlanAuthority {
    /// The plan identity, as the Host's own approved-plan authority resolves it.
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]>;
    /// The canonical, immutable phase-definition digest of that plan.
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]>;
    /// The governed phase currently under review.
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]>;
    /// THE APPROVED BASELINE COMMIT of that phase, as raw object-identity bytes.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B. It comes from the durable approved-plan record and from nowhere
    /// else: no request, no frame and no caller value can supply or influence it, it is never read
    /// from a remote-tracking reference, and it is never derived or advanced at run time. `None` is
    /// "no baseline was approved", and a review without one is refused.
    fn approved_baseline(&self) -> Option<[u8; BASELINE_COMMIT_LEN]>;
}

/// The model and credential policy the installation's SIGNED EXECUTION CLOSURE fixes.
///
/// CROSS-CHECKED BY THE OWNER'S RECORD, exactly as the plan is: the delegation names the model
/// policy and credential reference it was granted for, and a disagreement is a refusal.
pub trait SignedExecutionClosureFacts {
    /// The model policy the signed closure fixes.
    fn model_policy(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]>;
    /// The credential reference the signed closure fixes. An identifier, never a secret.
    fn credential_ref(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]>;
}

/// The EXACT review candidate: the committed-byte reader's digest at an immutable commit.
///
/// NOT A PATH, NOT A BRANCH, NOT `HEAD`, NOT CALLER BYTES. The accepted committed-byte reader
/// resolves `HEAD` once, at open, and every read afterwards names the pinned commit, so the digest
/// this port reports is of bytes that were committed at one exact revision.
///
/// CROSS-CHECKED BY THE CALLER'S OWN CLAIM. The candidate is folded into the Host's binding digest,
/// which must equal the digest the caller put on the wire — so the Host and the agent must have
/// resolved the SAME candidate for anything to be admitted.
pub trait CommittedCandidateSource {
    /// The digest of the committed candidate at an immutable commit.
    fn candidate_digest(&self) -> Option<[u8; BINDING_DIGEST_LEN]>;
}

/// The bounded ONE-SHOT gatekeeper request inbox, as the accepted inbox contract implements it.
///
/// THE PRODUCTION IMPLEMENTATION IS THE ACCEPTED CONTRACT AND MUST STAY SO. An adapter derives the
/// request file's identity from the correlation (never from a caller-supplied path), opens it once,
/// reads it once through a cap it controls, hashes those exact in-memory bytes, and consumes the
/// identity so the same file can never answer twice. That contract already exists in
/// `projectos-host-gatekeeper-attestation`; this port is how composition reaches it, and it is a
/// port rather than a direct call because this crate's dependency list is closed by an accepted
/// validator.
///
/// IT RETURNS A DIGEST AND RETAINS THE BYTES. Composition never holds the review subject — an
/// authority path has no business carrying the text of a question — and the execution rung asks the
/// SAME adapter for the body it already read. That is what keeps "hash these bytes" and "execute
/// these bytes" the same single read: there is no second open to substitute anything into.
pub trait OneShotRequestSubject {
    /// Consume this correlation's inbox entry ONCE and report the digest of the exact bytes read.
    ///
    /// `None` covers every outcome that is not a body: absent, unreadable, over the size bound, or
    /// an identity already spent. They are one answer here because they are one answer to
    /// composition — there is no subject, so there is nothing to review.
    fn consume_once(
        &mut self,
        correlation: &[u8; CORRELATION_LEN],
    ) -> Option<[u8; BINDING_DIGEST_LEN]>;
}

/// The known provider cost of this exact call, in micro-USD.
///
/// AN UNKNOWN COST IS REFUSED, NEVER SPENT AS ZERO. A zero cost is under every ceiling, so a budget
/// that treats "we could not price this" as free is not a budget.
pub trait AdmittedCostSource {
    /// The cost this call will incur, or `None` when it cannot be established.
    fn admitted_cost_micro_usd(&self) -> Option<u64>;
}

// -------------------------------------------------------------------------------------------------
// BUDGET — check, reserve, then commit or release
// -------------------------------------------------------------------------------------------------

/// Why a budget transition refused. Every variant refuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BudgetRefusal {
    /// The provider cost could not be established.
    CostUnknown,
    /// Committed spend plus outstanding reservations plus this cost overflowed.
    ArithmeticOverflow,
    /// The reservation would take the programme past the owner's ceiling.
    CeilingExceeded,
    /// This correlation already holds an outstanding reservation. One question, one reservation.
    AlreadyReserved,
    /// The ledger is already holding [`MAX_OUTSTANDING_RESERVATIONS`] in flight.
    ///
    /// DISTINCT FROM [`BudgetRefusal::CeilingExceeded`], and the distinction is operational. This is
    /// a transient capacity bound that clears the moment any in-flight request settles; the ceiling
    /// is the owner's money, and it clears when the owner raises it or the month turns. Collapsing
    /// them told an operator to go and change a budget when all they had to do was wait.
    OutstandingReservationsExhausted,
    /// The reservation presented is not outstanding on this ledger — minted by a different ledger,
    /// or already settled.
    ReservationNotOutstanding,
    /// THE CANONICAL LEDGER TRANSACTION ITSELF REFUSED, and this is what it said.
    ///
    /// RUN-TO-COMPLETION HOST ATTESTATION 10D. Everything above is a refusal 10A could name from its
    /// own vocabulary; this carries the ones only a real ledger has - a held lock, an unenforceable
    /// configured policy, a malformed or oversize record, the installation's own hard stop as
    /// distinct from the owner's ceiling, a settlement recording no call. Carried WHOLE rather than
    /// flattened into "the budget refused": an operator meeting a stuck admission needs to know
    /// whether to wait for another process, fix a configuration, or ask the owner.
    LedgerRefused(projectos_host_gatekeeper_ledger::LedgerRefusal),
}

/// A bounded reservation against one programme's ceiling, held for exactly one request.
///
/// SEALED, AND NOT `Clone`/`Copy`. A copyable reservation is how one admitted call comes to be
/// charged, released and charged again; `commit` and `release` take it BY VALUE, so spending it
/// twice is not a rule an implementation has to remember — it is a move error.
///
/// IT IS NOT SPEND. Holding one means capacity is set aside, not that anything was billed. Nothing
/// in this checkpoint executes, so nothing here may be recorded as committed spend: the execution
/// rung commits a reservation when a charge was actually incurred and releases it when no provider
/// effect happened.
#[derive(Debug, PartialEq, Eq)]
pub struct BudgetReservation {
    _seal: Seal,
    /// WHICH LEDGER MINTED THIS, so settlement cannot land on a different one.
    ///
    /// Matching on `(correlation, cost)` alone was not enough, and the gap was real rather than
    /// theoretical: a Host holding two live authorities could call `a.commit(reservation_from_b)`,
    /// and if `a`'s outstanding list happened to contain an equal pair the settlement would land
    /// silently on `a` — corrupting `a`'s accounting and orphaning `b`'s capacity for ever, because
    /// the reservation value was consumed by the wrong call. Nothing in this module can reach that
    /// today (the composition threads exactly one ledger), but the execution rung that will call
    /// `commit`/`release` is precisely where it would first become live. Raised by the ECC code
    /// review.
    ledger_id: u64,
    correlation: [u8; CORRELATION_LEN],
    cost_micro_usd: u64,
    /// THE OWNER'S CEILING THIS ADMISSION WAS TAKEN UNDER.
    ///
    /// Recorded so the composition can confirm the canonical transaction applied the ceiling from
    /// the delegation it actually verified. The owner's ceiling and the installation's own hard stop
    /// are two separate controls and a request must satisfy both; carrying this makes "which ceiling
    /// was this admitted under?" a fact rather than an assumption.
    delegation_ceiling_micro_usd: u64,
    /// Committed spend PLUS every reservation outstanding when this one was taken.
    ///
    /// THIS IS THE FIGURE C4 MUST SEE. §9's request-scoped budget gate adds the admitted cost to the
    /// spend the facts report and compares against the owner's ceiling. Feeding it bare committed
    /// spend would let two concurrent requests each observe the same remaining budget and both be
    /// admitted; feeding it committed-plus-outstanding makes §9's own arithmetic reproduce the
    /// reservation check exactly, with no change to the closed evaluator.
    spend_snapshot_micro_usd: u64,
}

impl BudgetReservation {
    /// The request this reservation is held for.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }
    /// The cost set aside.
    #[must_use]
    pub fn cost_micro_usd(&self) -> u64 {
        self.cost_micro_usd
    }
    /// Committed spend plus the reservations outstanding when this one was taken.
    #[must_use]
    pub fn spend_snapshot_micro_usd(&self) -> u64 {
        self.spend_snapshot_micro_usd
    }
    /// The owner's delegation ceiling this admission was taken under.
    #[must_use]
    pub fn delegation_ceiling_micro_usd(&self) -> u64 {
        self.delegation_ceiling_micro_usd
    }
}

/// WHAT THIS SPEND IS FOR, as the Host resolved it.
///
/// RUN-TO-COMPLETION HOST ATTESTATION 10D. The canonical ledger entry is not an anonymous amount:
/// every record carries the project, the phase and the model it was spent on, because a ledger that
/// cannot say which phase spent this is a running total rather than a record. A production adapter
/// therefore cannot write a canonical entry from a correlation and a cost alone.
///
/// IT IS THREE DIGESTS BECAUSE THE HOST HAS THREE DIGESTS. The project arrives inside the sealed
/// programme attestation, the phase from the Host's own plan authority, the model policy from the
/// signed execution closure - and each is a digest, never a name. The adapter renders them; it does
/// not invent names for them.
///
/// IT IS THREADED THROUGH THE TRANSACTION RATHER THAN HELD BY THE ADAPTER, and that is the point of
/// the parameter. An adapter constructed with its own idea of the phase would be a SECOND resolution
/// of a fact the composition already resolved at step 5, free to disagree with the facts the
/// reservation is actually taken for. Threading it makes the label provably the same answer.
#[derive(Debug, Clone, Copy)]
pub struct BudgetReservationSubject<'a> {
    /// The programme's project, from the sealed attested installation.
    pub project: &'a [u8; DELEGATION_DIGEST_LEN],
    /// The governed phase under review, from the Host's approved-plan authority.
    pub phase: &'a [u8; DELEGATION_DIGEST_LEN],
    /// The model policy the signed execution closure fixes.
    pub model_policy: &'a [u8; DELEGATION_DIGEST_LEN],
}

/// WHAT A PROVIDER CALL ACTUALLY COST, once it has happened.
///
/// RUN-TO-COMPLETION HOST ATTESTATION 10D. `commit_reservation` takes one because the canonical
/// ledger HAS NO WAY TO SAY "committed with nothing recorded": an entry carrying no usage IS a
/// reservation, by the canonical rule, so a commit that wrote zeroes would leave behind an entry the
/// agent's own release path is entitled to delete - silently erasing a charge that really was
/// incurred. Settlement REPLACES the provisional entry with the real call, which means the real call
/// has to be presented.
///
/// NOTHING IN THIS CHECKPOINT CONSTRUCTS ONE OUTSIDE A TEST. No provider is executed anywhere in
/// 10D, so the only settlements that exist are fixtures; the execution rung is what will report a
/// real one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderCallSettlement {
    /// Input tokens the provider billed.
    pub input_tokens: u64,
    /// Cached input tokens, when the provider reported them.
    pub cached_input_tokens: Option<u64>,
    /// Output tokens the provider billed.
    pub output_tokens: u64,
    /// What those tokens cost at the configured rate card, in integer micro-USD.
    ///
    /// THE RATE CARD IS THE AGENT'S, NOT THE HOST'S. 10D prices nothing: the Host has no rate card,
    /// no tokenizer and no request body, so this figure is reported to it rather than derived by it.
    /// That is the same reason an unknown admitted cost refuses instead of defaulting - see
    /// [`AdmittedCostSource`].
    pub cost_micro_usd: u64,
}

/// The private supertrait that seals [`CanonicalBudgetLedger`].
mod canonical_budget {
    /// Unnameable outside this crate, so the trait below cannot be implemented downstream.
    pub trait Sealed {}
}

/// THE CANONICAL ProjectOS BUDGET LEDGER, presented as ONE authoritative transaction.
///
/// ## There is one ledger, and it is not this
///
/// The source of spend truth is the existing ProjectOS ledger — `.projectops/gatekeeper-ledger.json`
/// under `.projectops/gatekeeper-ledger.lock`, whose model is `admitGatekeeperSpend`: take the lock,
/// read the authoritative entries FRESH, authorise this cost, and write a provisional unresolved
/// entry, all without letting go in between. This trait is how the Host composition reaches that
/// transaction. It is not a second ledger and it cannot become one: nothing here persists anything,
/// and no implementation is asked to.
///
/// ## READ, CHECK AND RESERVE ARE ONE OPERATION, DELIBERATELY
///
/// There is no `committed_spend()`, no `ceiling()` and no `available()` on this trait. A caller that
/// could read a figure could act on it, and two callers reading the same figure is exactly how two
/// requests come to be admitted against one budget. The only thing a caller may do is ASK, and what
/// comes back is either a refusal or a reservation that has already been taken.
///
/// ## SEALED, AND WITH NO PRODUCTION IMPLEMENTATION IN THIS CHECKPOINT
///
/// The supertrait is private, so no downstream crate can implement it and answer its own questions
/// about money. The concrete bridge to the canonical ledger is a later rung; until it exists the
/// production composition has no ledger to be handed and fails closed by construction, exactly as it
/// does for the durable delegation store. An in-memory implementation shipped as production would
/// have been a per-process budget truth able to diverge from every other process.
pub trait CanonicalBudgetLedger: canonical_budget::Sealed {
    /// ONE authoritative transaction: read the canonical position fresh, check this cost against
    /// BOTH the installation's own hard stop AND the owner's delegation ceiling, and reserve.
    ///
    /// `delegation_ceiling_micro_usd` is the OWNER'S ceiling, read by the composition off a
    /// delegation whose signature it has already verified. It constrains this programme in addition
    /// to — never instead of — the canonical hard stop the implementation applies from its own
    /// authoritative state. A request must satisfy both.
    ///
    /// # Errors
    /// [`BudgetRefusal`] naming the gate that refused. An unknown cost refuses; overflow refuses;
    /// either ceiling refuses.
    /// `subject` says WHAT the spend is for. The canonical ledger entry carries a project, a phase
    /// and a model, so an implementation that persists one needs all three; see
    /// [`BudgetReservationSubject`] for why they are threaded rather than held.
    fn admit_spend(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
        subject: &BudgetReservationSubject<'_>,
    ) -> Result<BudgetReservation, BudgetRefusal>;

    /// A charge was actually incurred: turn this reservation into committed spend, once.
    ///
    /// `settlement` is what the provider actually billed. It is required rather than optional
    /// because the canonical ledger expresses "committed" AS the recorded call - see
    /// [`ProviderCallSettlement`].
    ///
    /// # Errors
    /// [`BudgetRefusal::ReservationNotOutstanding`] for a reservation this ledger is not holding.
    fn commit_reservation(
        &mut self,
        reservation: BudgetReservation,
        settlement: &ProviderCallSettlement,
    ) -> Result<(), BudgetRefusal>;

    /// No provider effect happened: give the capacity back, once.
    ///
    /// # Errors
    /// [`BudgetRefusal::ReservationNotOutstanding`] for a reservation this ledger is not holding.
    fn release_reservation(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal>;
}

/// The most reservations one programme's ledger position will hold outstanding at once.
///
/// BOUNDED, LIKE EVERY OTHER SET THE HOST KEEPS ON BEHALF OF A PEER. Without a bound, a caller that
/// can reach admission can make the Host remember one entry per request for as long as it lives.
pub const MAX_OUTSTANDING_RESERVATIONS: usize = 64;

/// The source of ledger identities.
///
/// A PROCESS-WIDE COUNTER, not a random value: this distinguishes ledgers within one running Host,
/// which is the whole scope of the confusion it prevents. It is not a secret, is never rendered, and
/// carries no meaning outside the process. Wrapping would need 2^64 ledgers in one process lifetime.
#[cfg(feature = "test-fixtures")] // NOT `any(test, ..)`: the only consumers are the
                                  // composition tests, which require this feature, so a bare `cfg(test)` build compiled these
                                  // and used none of them — six dead-code errors under `cargo clippy --all-targets -D warnings`
                                  // with default features, an invocation that passed at the §10A base commit. Raised by ECC code.
static NEXT_LEDGER_ID: AtomicU64 = AtomicU64::new(1);

/// FIXTURE ONLY: an in-memory [`CanonicalBudgetLedger`] holding one programme's position.
///
/// ## Why it is a fixture and not production authority
///
/// It was `HostBudgetAuthority`, and it was public, and `open(ceiling, committed_spend)` let ANY
/// caller — including a downstream crate in a default build — state a budget position out of two
/// integers. Two such objects were demonstrably able to admit 900 each against their own 1,000
/// ceilings: 1,800 admitted against one budget, because neither could see the other and neither was
/// reading anything authoritative. That is a per-process budget truth, which is precisely what a
/// single source of truth must not permit. The type keeps its state machine and loses its
/// production standing: it is compiled only for this crate's tests and the non-default
/// `test-fixtures` graph, so a shipped build cannot construct a budget position at all.
///
/// ## What it still proves
///
/// Everything the state machine is responsible for, and those properties are unchanged: checked
/// arithmetic, an unknown cost refused, both ceilings enforced, one reservation per correlation, a
/// bounded in-flight list, settlement exactly once, and — because `admit_spend` takes `&mut self` —
/// no two reservations in flight against ONE position. What it no longer claims is to be the
/// authoritative position itself.
#[cfg(feature = "test-fixtures")]
#[derive(Debug)]
pub struct FixtureBudgetLedger {
    ledger_id: u64,
    ceiling_micro_usd: u64,
    committed_spend_micro_usd: u64,
    outstanding: Vec<([u8; CORRELATION_LEN], u64)>,
}

#[cfg(feature = "test-fixtures")]
impl canonical_budget::Sealed for FixtureBudgetLedger {}

#[cfg(feature = "test-fixtures")]
impl CanonicalBudgetLedger for FixtureBudgetLedger {
    fn admit_spend(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
        // AN IN-MEMORY POSITION HAS NOWHERE TO PUT A LABEL. The fixture persists no record, so there
        // is nothing here to attribute; a production ledger writes an entry and needs all three.
        _subject: &BudgetReservationSubject<'_>,
    ) -> Result<BudgetReservation, BudgetRefusal> {
        self.reserve(correlation, cost_micro_usd, delegation_ceiling_micro_usd)
    }
    fn commit_reservation(
        &mut self,
        reservation: BudgetReservation,
        // Likewise: the fixture's `commit` moves an amount between two integers, and there is no
        // persisted entry for a settlement to replace.
        _settlement: &ProviderCallSettlement,
    ) -> Result<(), BudgetRefusal> {
        self.commit(reservation).map(|_| ())
    }
    fn release_reservation(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal> {
        self.release(reservation)
    }
}

#[cfg(feature = "test-fixtures")]
impl FixtureBudgetLedger {
    /// FIXTURE ONLY: reserve under this position's own hard stop alone.
    ///
    /// For the unit tests that are about the STATE MACHINE — checked arithmetic, one reservation per
    /// correlation, the in-flight bound, settlement exactly once — rather than about the owner's
    /// ceiling. It passes `u64::MAX` as the delegation ceiling so that control cannot be what
    /// refuses, leaving the installation's own hard stop as the only ceiling in play. The tests that
    /// are about the owner's ceiling call [`Self::reserve`] directly with a real one.
    ///
    /// # Errors
    /// [`BudgetRefusal`] naming the gate that refused.
    pub fn reserve_for_test(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
    ) -> Result<BudgetReservation, BudgetRefusal> {
        self.reserve(correlation, cost_micro_usd, u64::MAX)
    }

    /// FIXTURE ONLY. Stand up a position: the installation's own hard stop and its committed spend.
    #[must_use]
    pub fn holding(ceiling_micro_usd: u64, committed_spend_micro_usd: u64) -> Self {
        Self {
            ledger_id: NEXT_LEDGER_ID.fetch_add(1, Ordering::Relaxed),
            ceiling_micro_usd,
            committed_spend_micro_usd,
            outstanding: Vec::new(),
        }
    }

    /// The installation's own hard stop this position was stood up at.
    #[must_use]
    pub fn ceiling_micro_usd(&self) -> u64 {
        self.ceiling_micro_usd
    }

    /// Spend the ledger has committed.
    #[must_use]
    pub fn committed_spend_micro_usd(&self) -> u64 {
        self.committed_spend_micro_usd
    }

    /// Committed spend plus every outstanding reservation.
    ///
    /// # Errors
    /// [`BudgetRefusal::ArithmeticOverflow`] if the sum does not fit. Checked, because a corrupt or
    /// hostile figure that wrapped would report a tiny commitment against a huge one.
    pub fn commitment_micro_usd(&self) -> Result<u64, BudgetRefusal> {
        let mut total = self.committed_spend_micro_usd;
        for (_, cost) in &self.outstanding {
            total = total
                .checked_add(*cost)
                .ok_or(BudgetRefusal::ArithmeticOverflow)?;
        }
        Ok(total)
    }

    /// Capacity still available beneath the ceiling. Saturating at zero: "less than nothing
    /// remains" is not a quantity anyone can act on.
    ///
    /// AN OVERFLOWING COMMITMENT ALSO REPORTS ZERO, and that is fail-closed rather than correct.
    /// `reserve`'s own checked arithmetic makes it unreachable in normal operation, but `holding`
    /// takes committed spend as a raw figure, so a fixture position can be stood up already corrupt.
    /// Zero is the safe answer; it is also indistinguishable from an ordinary exhausted budget to
    /// anything that only reads this, which is an observability loss rather than a risk.
    #[must_use]
    pub fn available_micro_usd(&self) -> u64 {
        self.commitment_micro_usd()
            .map(|c| self.ceiling_micro_usd.saturating_sub(c))
            .unwrap_or(0)
    }

    /// READ, CHECK, then RESERVE, in one transition nothing can interleave with.
    ///
    /// Order is fail-closed: an unknown cost refuses before anything is measured; the commitment is
    /// summed with checked arithmetic; the projection is compared against BOTH ceilings; and only
    /// then is capacity set aside. A refused reservation leaves the position untouched, so a caller
    /// cannot grind a ceiling down with refusals.
    ///
    /// BOTH CEILINGS, NEITHER REPLACING THE OTHER. `self.ceiling_micro_usd` is the installation's
    /// own hard stop, read from this position's authoritative state; `delegation_ceiling_micro_usd`
    /// is the owner's, read off a signed delegation. They are separate controls answering separate
    /// questions — "can this installation afford it?" and "did the owner permit this programme that
    /// much?" — so a request must satisfy both, and the lower of the two binds.
    ///
    /// # Errors
    /// [`BudgetRefusal`] naming the gate that refused.
    pub fn reserve(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
    ) -> Result<BudgetReservation, BudgetRefusal> {
        let cost = cost_micro_usd.ok_or(BudgetRefusal::CostUnknown)?;
        if self.outstanding.iter().any(|(c, _)| *c == correlation) {
            return Err(BudgetRefusal::AlreadyReserved);
        }
        if self.outstanding.len() >= MAX_OUTSTANDING_RESERVATIONS {
            return Err(BudgetRefusal::OutstandingReservationsExhausted);
        }
        let snapshot = self.commitment_micro_usd()?;
        let projected = snapshot
            .checked_add(cost)
            .ok_or(BudgetRefusal::ArithmeticOverflow)?;
        if projected > self.ceiling_micro_usd || projected > delegation_ceiling_micro_usd {
            return Err(BudgetRefusal::CeilingExceeded);
        }
        self.outstanding.push((correlation, cost));
        Ok(BudgetReservation {
            _seal: Seal,
            ledger_id: self.ledger_id,
            correlation,
            cost_micro_usd: cost,
            spend_snapshot_micro_usd: snapshot,
            delegation_ceiling_micro_usd,
        })
    }

    /// COMMIT: a charge was actually incurred, so the reservation becomes committed spend.
    ///
    /// ONLY THE EXECUTION RUNG MAY CALL THIS, and only when a provider effect really happened.
    /// Minting authority is not spending: a call that was admitted and never dispatched must be
    /// released, not committed, or the ceiling drains without anyone being billed.
    ///
    /// # Errors
    /// [`BudgetRefusal::ReservationNotOutstanding`] for a reservation this authority does not hold —
    /// which is also what a second settlement of the same one looks like, since the first removed
    /// it. [`BudgetRefusal::ArithmeticOverflow`] if committed spend would not fit.
    pub fn commit(&mut self, reservation: BudgetReservation) -> Result<u64, BudgetRefusal> {
        let index = self.position_of(&reservation)?;
        let committed = self
            .committed_spend_micro_usd
            .checked_add(reservation.cost_micro_usd)
            .ok_or(BudgetRefusal::ArithmeticOverflow)?;
        self.outstanding.remove(index);
        self.committed_spend_micro_usd = committed;
        Ok(committed)
    }

    /// RELEASE: no provider effect happened, so the capacity returns.
    ///
    /// # Errors
    /// [`BudgetRefusal::ReservationNotOutstanding`] for a reservation this authority does not hold —
    /// including one that has already been committed.
    pub fn release(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal> {
        let index = self.position_of(&reservation)?;
        self.outstanding.remove(index);
        Ok(())
    }

    /// Where an outstanding reservation sits, or a refusal.
    ///
    /// MATCHED ON THE MINTING LEDGER FIRST, then on correlation and cost together. The ledger check
    /// is what stops a reservation from one ledger settling against another's coincidentally equal
    /// entry; the cost check is what stops a reservation settling for the wrong amount.
    fn position_of(&self, reservation: &BudgetReservation) -> Result<usize, BudgetRefusal> {
        if reservation.ledger_id != self.ledger_id {
            return Err(BudgetRefusal::ReservationNotOutstanding);
        }
        self.outstanding
            .iter()
            .position(|(c, cost)| {
                *c == reservation.correlation && *cost == reservation.cost_micro_usd
            })
            .ok_or(BudgetRefusal::ReservationNotOutstanding)
    }
}

impl HostResolvedRequestFacts {
    /// THE PRODUCTION ROUTE: facts the Host resolved, sealed together for one request.
    ///
    /// PRIVATE TO THIS CHILD MODULE. Not `pub`, not `pub(crate)`, and reachable from no other module
    /// in this crate — it is visible here only because Rust makes a parent's private fields and
    /// private seal visible to its descendants. The one caller is
    /// [`compose_protected_operation`] below, so "who may state what the Host resolved?" has exactly
    /// one answer: the ordered pass that begins with the owner's signature.
    ///
    /// WHAT IT DEMANDS IS THE SECOND ANSWER, and it is the one that would still hold if the
    /// visibility were ever widened. Three of its four arguments are SEALED types with no forgeable
    /// constructor, and the first of them is the one that matters most:
    ///
    /// * `delegation` — a [`VerifiedOwnerProgrammeDelegation`] exists only after the OWNER'S KEY has
    ///   verified over the record's canonical subject. It is taken and not read: the facts must be
    ///   resolved independently of the record, and comparing the two is
    ///   `satisfy_c4_for_gatekeeper_request`'s job, not this one's.
    /// * `programme` — the sealed `ExpectedProgramme`, whose only production route is an
    ///   owner-signed execution closure that lists this installation. The project and repository are
    ///   READ OFF IT rather than accepted as arguments, so there is no way to state a programme here.
    /// * `now` — the sealed `HostClockReading`, taken from the system clock inside the Host. There is
    ///   no `now_epoch_s` parameter anywhere on this path.
    /// * `material` — the per-request digests, each resolved by the composition from a named trusted
    ///   source. They are plain values because they come from ports rather than from types: a
    ///   candidate digest is whatever the committed-byte reader hashed at an immutable commit, and
    ///   wrapping it in a newtype here would move the question rather than answer it.
    ///
    /// AND HOLDING FACTS IS STILL NOT AUTHORITY. The evaluator additionally demands a
    /// [`TrustedPeerContext`] from a real peer admission and an [`projectos_host_core::AdmittedRequest`] minted by a live
    /// `BoundIpcSession`, and every fact must match the owner-signed delegation on project,
    /// repository, plan, plan digest, phase, model policy, credential reference and budget. Facts
    /// that disagree with the owner's record open nothing.
    #[must_use]
    fn production_resolved(
        _delegation: &VerifiedOwnerProgrammeDelegation,
        programme: &ExpectedProgramme,
        now: &HostClockReading,
        material: HostResolvedFacts,
    ) -> Self {
        Self {
            _seal: Seal,
            project: *programme.project(),
            repository: *programme.repository(),
            plan: material.plan,
            plan_digest: material.plan_digest,
            phase: material.phase,
            candidate_digest: material.candidate_digest,
            parameter_digest: material.parameter_digest,
            model_policy: material.model_policy,
            credential_ref: material.credential_ref,
            committed_spend_micro_usd: material.committed_spend_micro_usd,
            admitted_cost_micro_usd: material.admitted_cost_micro_usd,
            protected_effect_requested: material.protected_effect_requested,
            now_epoch_s: now.epoch_s(),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// THE COMPOSITION
// -------------------------------------------------------------------------------------------------

/// Why the Host could not compose this operation.
#[derive(Debug)]
#[non_exhaustive]
pub enum CompositionRefusal {
    /// The owner programme delegation did not verify, or the Host's own record ended it.
    DelegationRefused(DelegationRefusal),
    /// The Host's approved-plan authority could not establish the plan, its digest, the phase or
    /// the phase's approved baseline commit.
    PlanAuthorityUnavailable,
    /// The signed execution closure could not supply the model or credential policy.
    ClosureFactsUnavailable,
    /// The committed candidate could not be established at an immutable commit.
    CandidateUnavailable,
    /// The one-shot inbox had no usable subject for this correlation.
    RequestSubjectUnavailable,
    /// The budget refused.
    BudgetRefused(BudgetRefusal),
    /// The request was not fresh on this session.
    AdmissionRefused(RequestAdmissionError),
    /// The Host's durable replay history refused this governed request. Either it has already been
    /// consumed - the RUN-TO-COMPLETION HOST ATTESTATION 10C refusal, which survives a Host restart
    /// - or the history could not be established, which fails closed for the same reason.
    ReplayRefused(ReplayRefusal),
    /// The §9 evaluator refused, and this is the wire answer it produced. The reservation taken for
    /// this request has been RELEASED before this is returned: no provider effect happened, so no
    /// capacity stays set aside.
    Rejected(ProtectedOperationResponse),
}

/// The per-request Host sources composition reads.
///
/// Gathered so [`compose_protected_operation`] keeps one argument rather than five, and `&mut` for
/// the subject because consuming a one-shot inbox entry is a state change by definition.
pub struct HostRequestSources<'a> {
    /// The Host's approved-plan authority.
    pub plan: &'a dyn HostPlanAuthority,
    /// The signed execution closure's model and credential policy.
    pub closure: &'a dyn SignedExecutionClosureFacts,
    /// The committed candidate at an immutable commit.
    pub candidate: &'a dyn CommittedCandidateSource,
    /// The known provider cost of this call.
    pub cost: &'a dyn AdmittedCostSource,
    /// The bounded one-shot request inbox.
    pub subject: &'a mut dyn OneShotRequestSubject,
}

/// Everything the Host assembled for one admitted operation.
///
/// SEALED, AND IT IS NOT A NEW AUTHORITY. It carries the ONE authority §9 minted plus the budget
/// reservation held for it, because the execution rung needs both and needs them to belong to the
/// same request. There is no accessor that reports "authorised": the only thing that says so is the
/// [`AuthorisedProtectedOperation`] inside it, minted by the evaluator and by nothing else.
///
/// NOT `Clone`, for the same reason the authority is not.
#[derive(Debug)]
pub struct ComposedProtectedOperation {
    _seal: Seal,
    authority: AuthorisedProtectedOperation,
    reservation: BudgetReservation,
    /// What the Host resolved for this request, carried forward for the execution rung.
    ///
    /// THE SINGLE EXISTING RESOLUTION, NOT A SECOND ONE. The review operation needs the project,
    /// repository, plan, plan digest, phase and candidate the Host resolved; the authority carries
    /// only digests OF them. Resolving them again at execution time would be a second opinion, free
    /// to disagree with the `binding_digest` the authority was minted against - so the facts the
    /// evaluator compared are the facts the review runs over, by construction.
    review_subject: ReviewSubjectFacts,
}

impl ComposedProtectedOperation {
    /// The reservation held for this exact request.
    #[must_use]
    pub fn reservation(&self) -> &BudgetReservation {
        &self.reservation
    }

    /// Take the parts apart, for the execution rung that must settle the reservation.
    ///
    /// BY VALUE, AND THERE IS NO BORROWING ACCESSOR FOR THE AUTHORITY. Two reasons, and the second
    /// is the one that decided it. First, an authority answers one request, so consuming the
    /// composition to use it is the honest shape — a borrow invites holding the composed value and
    /// acting on the authority more than once. Second, the accepted operation-contract validator
    /// counts every `AuthorisedProtectedOperation {` in the crate as a construction, and a
    /// borrow-returning accessor spells exactly that (`-> &AuthorisedProtectedOperation {`), which
    /// its `-> ` exclusion does not cover. That over-count can only ever cause a FALSE FAILURE,
    /// never a false pass, so the right move was to change this signature rather than the check.
    #[must_use]
    pub fn into_parts(self) -> (AuthorisedProtectedOperation, BudgetReservation) {
        (self.authority, self.reservation)
    }

    /// The facts the Host resolved for this request, as the execution rung will review them.
    #[must_use]
    pub fn review_subject(&self) -> &ReviewSubjectFacts {
        &self.review_subject
    }
}

// -------------------------------------------------------------------------------------------------
// THE EXECUTION RUNG (PROJECTOS-HOST-REVIEW-PATH1A)
// -------------------------------------------------------------------------------------------------

/// What the Host resolved for ONE admitted request, in the shape the review operation consumes.
///
/// PLAIN DIGESTS, AND IT AUTHORISES NOTHING. Every value here is one the evaluator already compared:
/// `project` .. `candidate_digest` are the fields of the binding subject the authority's
/// `binding_digest` was computed over, and `correlation`, `delegation_id` and `parameter_digest` are
/// read off the minted authority itself. Nothing in it is secret - the same values are public fields
/// of the caller-constructible `OwnerProgrammeDelegation` and are published after a review by the
/// attestation's accessors - and holding one opens nothing, because the only function that acts on it
/// also demands the composition it came from.
///
/// THE ONLY CONSTRUCTOR IS PRIVATE AND TAKES THE SEALED FACTS, so there is no way to build one from
/// caller data and no way for it to disagree with what was authorised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewSubjectFacts {
    project: [u8; DELEGATION_DIGEST_LEN],
    repository: [u8; DELEGATION_DIGEST_LEN],
    plan: [u8; DELEGATION_DIGEST_LEN],
    plan_digest: [u8; DELEGATION_DIGEST_LEN],
    phase: [u8; DELEGATION_DIGEST_LEN],
    candidate_digest: [u8; BINDING_DIGEST_LEN],
    correlation: [u8; CORRELATION_LEN],
    delegation_id: [u8; DELEGATION_DIGEST_LEN],
    parameter_digest: [u8; BINDING_DIGEST_LEN],
    baseline_commit: [u8; BASELINE_COMMIT_LEN],
}

impl ReviewSubjectFacts {
    fn from_resolved(
        facts: &HostResolvedRequestFacts,
        authority: &AuthorisedProtectedOperation,
        baseline_commit: [u8; BASELINE_COMMIT_LEN],
    ) -> Self {
        Self {
            project: facts.project,
            repository: facts.repository,
            plan: facts.plan,
            plan_digest: facts.plan_digest,
            phase: facts.phase,
            candidate_digest: facts.candidate_digest,
            correlation: *authority.correlation(),
            delegation_id: *authority.delegation_id(),
            parameter_digest: *authority.parameter_digest(),
            baseline_commit,
        }
    }

    /// The approved baseline commit of the phase, from the durable approved-plan record. NOT part of
    /// the request binding: the fixed authority frames are unchanged, and a caller never states it.
    #[must_use]
    pub fn baseline_commit(&self) -> &[u8; BASELINE_COMMIT_LEN] {
        &self.baseline_commit
    }

    /// The canonical programme identity of the project.
    #[must_use]
    pub fn project(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.project
    }
    /// The canonical programme identity of the repository.
    #[must_use]
    pub fn repository(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.repository
    }
    /// The canonical programme identity of the approved plan reference.
    #[must_use]
    pub fn plan(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.plan
    }
    /// The validated phase-definition digest of the approved plan.
    #[must_use]
    pub fn plan_digest(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.plan_digest
    }
    /// The canonical programme identity of the phase id.
    #[must_use]
    pub fn phase(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.phase
    }
    /// The committed-candidate digest the Host resolved.
    #[must_use]
    pub fn candidate_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.candidate_digest
    }
    /// The correlation of the authorised request.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }
    /// The delegation the authority was minted under.
    #[must_use]
    pub fn delegation_id(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.delegation_id
    }
    /// The digest of the exact one-shot request subject.
    #[must_use]
    pub fn parameter_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.parameter_digest
    }
}

/// An execution that GENUINELY OCCURRED, as the sealed seam reports it.
///
/// BOTH VARIANTS MEAN THE EXECUTION RAN - which is what `ExecutionOutcomeEvidence` records. Neither
/// means the provider succeeded, and `Failed` does not by itself mean a provider was reached: that is
/// the separate, Host-authoritative `provider_dispatched` fact. A review that never began executing is
/// not an outcome at all, it is a [`ReviewExecutionRefusal`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewExecutionOutcome {
    /// The review ran, an attestation was minted and durably stored, and the response record exists.
    Succeeded {
        /// First sixteen bytes of SHA-256 over the exact response-record bytes, so the wire
        /// completion and the out-of-band record are bound to each other rather than merely both
        /// present.
        evidence_ref: [u8; EVIDENCE_REF_LEN],
        /// What the provider actually billed.
        settlement: ProviderCallSettlement,
    },
    /// The execution ran and produced no usable attested answer.
    Failed {
        /// First sixteen bytes of SHA-256 over the exact FAILURE record, so a failure is bound to its
        /// out-of-band record exactly as a success is.
        evidence_ref: [u8; EVIDENCE_REF_LEN],
        /// THE HOST-AUTHORITATIVE DISPATCH FACT. `Completed`/`Failed` on the wire says the execution
        /// seam RAN; it does not say a billable provider call occurred, and the two must not be
        /// conflated. `false` only where the Host can prove no provider was reached (a credential
        /// that could not be resolved is "no credential, no call"); every ambiguity is `true`.
        provider_dispatched: bool,
        /// What the provider billed, when that is known. `None` with `provider_dispatched` leaves
        /// the reservation OUTSTANDING: money that may have been spent is never released on a guess.
        settlement: Option<ProviderCallSettlement>,
    },
}

/// The review was refused BEFORE anything could reach a provider.
///
/// ONE VARIANT, AND THE NAME IS THE CONTRACT. Every cause that lands here - the manifest, the
/// execution closure, the trusted-executable policy, the one-shot subject - is decided before
/// execution is contemplated, so the reservation held for the request is provably unspent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewExecutionRefusal {
    /// Nothing was dispatched. The reservation is released.
    NotDispatched,
}

/// The private supertrait that seals [`GatekeeperReviewExecution`].
mod gatekeeper_review_execution {
    /// Unnameable outside this module tree, so the seam below cannot be implemented downstream.
    pub trait Sealed {}
}

/// THE SEALED EXECUTION SEAM: run ONE authorised independent gatekeeper review.
///
/// SEALED, FOR THE REASON `CanonicalBudgetLedger` IS - and with more at stake. This seam answers "did
/// a real attested review run, and how did it end", and there is no second oracle the rung below
/// could check that answer against. If a downstream crate could implement it, it could answer
/// `Succeeded` for a review that never touched the manifest check, the one-shot subject or the
/// review operation, and the rung would mint genuine-looking evidence of an execution that never
/// happened. The accepted validator pins WHERE the evidence is minted; sealing is what pins WHO may
/// say an execution occurred. The one production implementation therefore lives in this module's
/// own subtree, exactly as the production budget ledger does.
pub trait GatekeeperReviewExecution: gatekeeper_review_execution::Sealed {
    /// Execute the review this authority admits, over the facts the Host resolved for it.
    ///
    /// # Errors
    /// [`ReviewExecutionRefusal::NotDispatched`] when the review was refused before any provider
    /// could be reached.
    fn execute(
        &mut self,
        authority: &AuthorisedProtectedOperation,
        subject: &ReviewSubjectFacts,
    ) -> Result<ReviewExecutionOutcome, ReviewExecutionRefusal>;
}

/// THE EXECUTION RUNG: turn one composed, authorised operation into its wire answer.
///
/// ## The order is the control
///
/// 1. The composition is CONSUMED, so one authority answers one request and cannot be run twice.
/// 2. The review runs ONLY through the sealed seam. There is no argument through which a caller could
///    state that an execution happened - no bool, no result class, no evidence reference.
/// 3. Evidence is minted ONLY after the seam reported an execution that genuinely occurred, with the
///    correlation taken from the authority. This is the crate's single shipped mint of
///    [`ExecutionOutcomeEvidence`] (owner-ratified Amendment 1), and the accepted validator pins it
///    to this function.
/// 4. The reservation follows the DISPATCH FACT: released when nothing was dispatched, committed
///    when the provider's bill is known, and left outstanding when money may have been spent and
///    nobody can say how much.
///
/// ## What the wire says, without widening it
///
/// `Rejected` + `NotRun` means nothing ran, so the caller releases its own reservation. `Completed`
/// means an execution occurred - `Succeeded` or `Failed` - and the caller must treat money as
/// possibly spent. The dispatch fact therefore crosses the existing fixed frame in fields it already
/// had; nothing was added to it.
pub fn run_authorised_review(
    composed: ComposedProtectedOperation,
    execution: &mut dyn GatekeeperReviewExecution,
    ledger: &mut dyn CanonicalBudgetLedger,
) -> ProtectedOperationResponse {
    let subject = composed.review_subject;
    let (authority, reservation) = composed.into_parts();

    let (result, evidence_ref, dispatched, settlement) = match execution.execute(&authority, &subject) {
        Err(ReviewExecutionRefusal::NotDispatched) => {
            // The review never began executing, so nothing may stay reserved.
            release_unused(ledger, reservation);
            return refused_after_authority(&authority);
        }
        Ok(ReviewExecutionOutcome::Succeeded {
            evidence_ref,
            settlement,
        }) => (ResultClass::Succeeded, evidence_ref, true, Some(settlement)),
        Ok(ReviewExecutionOutcome::Failed {
            evidence_ref,
            provider_dispatched,
            settlement,
        }) => (ResultClass::Failed, evidence_ref, provider_dispatched, settlement),
    };

    // THE RESERVATION FOLLOWS THE HOST-AUTHORITATIVE DISPATCH FACT, never the frame's state.
    //   - the seam ran and PROVABLY reached no provider  -> released;
    //   - a provider was or may have been reached, bill known -> committed;
    //   - a provider may have been reached, bill UNKNOWN  -> left OUTSTANDING on purpose: dropping
    //     the value does not release it, the ledger still counts it against the ceiling, and money
    //     that may have been spent is never handed back on a guess.
    match (dispatched, settlement) {
        (false, _) => release_unused(ledger, reservation),
        (true, Some(bill)) => {
            let committed = ledger.commit_reservation(reservation, &bill);
            debug_assert!(
                committed.is_ok(),
                "a reservation this composition just minted must still be outstanding on this authority"
            );
        }
        (true, None) => {}
    }

    // THE ONE SHIPPED MINT. `completed` independently refuses evidence about another correlation;
    // it cannot fail here because the correlation came off this same authority, and if it ever did
    // the honest answer is a refusal, never a fabricated completion.
    ExecutionOutcomeEvidence::from_completed_execution(&authority, result, evidence_ref)
        .and_then(|evidence| ProtectedOperationResponse::completed(&authority, &evidence))
        .unwrap_or_else(|| refused_after_authority(&authority))
}

/// The refusal an authorised request receives when its review did not run. `NotRun` on the wire is
/// what tells the caller nothing was dispatched.
fn refused_after_authority(authority: &AuthorisedProtectedOperation) -> ProtectedOperationResponse {
    ProtectedOperationResponse::rejected(
        *authority.correlation(),
        RejectionReason::PolicyRefused,
        authority.service_epoch(),
        TerminalStatus::Terminal,
    )
}

/// Compose one independent gatekeeper review from the Host's own trusted sources, or refuse.
///
/// ## The order is the security property
///
/// 1. THE PROGRAMME. Taken from the sealed attestation of the owner-signed execution closure, never
///    from the record about to be checked and never from the request.
/// 2. THE OWNER'S SIGNATURE, AND THAT THIS INSTALLATION IS THE ONE ADDRESSED — before anything is
///    read from the Host's own state. See the SEC-L1 note below: this gate exists so that
///    unauthenticated bytes never reach the durable delegation registry at all.
/// 3. THE HOST'S OWN WORD on this delegation's lifecycle, read from its durable store. Unavailable
///    fails closed, and a local `Revoked`/`Completed` beats a signed copy that still says active.
/// 4. THE FULL VERIFICATION ORDER — signature, relevance, then liveness — inside
///    [`verify_owner_programme_delegation`], which is the only production route to a verified
///    delegation and takes no verifier. Gate 2 is a pre-check, never a substitute: every gate runs
///    again here, in one place, exactly as before.
/// 5. THE HOST'S OWN ANSWERS about plan, phase, closure policy and candidate (steps 5-7). Free to
///    obtain and free to refuse, so they come before anything is spent.
/// 8. THE BUDGET RESERVATION. Check and reserve in one transition, so a second concurrent request
///    sees this one's cost before either has spent anything. It comes before the inbox because both
///    of its gates are free and neither can see the subject, and because a reservation is reversible
///    where a consumed inbox entry is not.
/// 9. THE ONE-SHOT SUBJECT. Deliberately after every free refusal, and after the one reversible one:
///    consuming an inbox entry spends a resource that cannot be un-spent, so nothing that could have
///    refused earlier is left until after it.
/// 10. THE FACTS, sealed together with the programme and the Host's clock reading — and then,
///     immediately, FRESHNESS ACROSS RESTARTS: the §10C durable replay gate. The governed request
///     identity is derived from the owner's delegation and these sealed facts, and is consumed
///     durably. It cannot come earlier, because the identity needs the facts, and it must not come
///     later, because the mark has to be durable before the authority that unlocks execution
///     exists - so this is the only correct place for it. Every refusal here releases the
///     reservation.
/// 11. FRESHNESS on the canonical session — the §9A admission, minted by the session itself.
/// 12. THE §9 EVALUATOR. It re-checks every one of these against the caller's claims and against
///     the owner's record, and mints the authority only if they all agree.
///
/// ## Why the OPERATION-CLASS check is NOT hoisted above the spending steps
///
/// The ECC security review for §10C observed that `request.operation() != delegation.operation` is
/// a free comparison of two values of a closed enum, yet it is reached only inside the evaluator at
/// step 12 — so a request naming a class this delegation does not grant still consumes a one-shot
/// inbox entry at step 9 and a durable §10C replay identity at step 10b before being refused. By
/// this module's own ordering law that check looks like it belongs with the free refusals.
///
/// IT WAS TRIED, AND IT IS A REGRESSION, WHICH IS WHY IT IS NOT HERE. A wrong class is not merely
/// refused by the evaluator: the evaluator produces a `ProtectedOperationResponse` — a real wire
/// answer, `OwnerPresenceGateOpen`, that the transport sends back to the caller. A composition-level
/// refusal produces no response frame at all, so hoisting the check would replace a proper protocol
/// rejection with silence on the wire. The accepted §10A proof
/// `a_read_only_class_cannot_use_the_composition` pins exactly that behaviour.
///
/// So the cost is real but bounded — it is the already-documented "a request refused after the gate
/// spends its identity" trade-off, applied to one more field — and removing it means changing what
/// a wrong-class request receives on the wire, which is accepted §9/§10A semantics rather than
/// anything §10C may decide. Recorded as PROPOSED and left to the gate.
///
/// ## SEC-L1 — why gate 2 precedes gate 3
///
/// A `HostDelegationStatus` can only be obtained by asking the durable registry about the id on the
/// record, so before this ordering EVERY decodable record — forged, expired, someone else's —
/// caused a lookup in the Host's own delegation store. With §10B that store is a real filesystem
/// registry, and the two outcomes are distinguishable: an id the Host knows carries on to the
/// signature check, an id it does not know refuses at the store. Response taxonomy, timing and
/// filesystem activity would all have leaked delegation-registry MEMBERSHIP to an unauthenticated
/// caller. Establishing provenance first closes it: an attacker who cannot produce the owner's
/// signature learns nothing about which delegations exist, because no read happens.
///
/// It costs one extra ECDSA verification on the success path — deterministic, over bytes already in
/// memory — and it changes no authority type, no mint and no refusal variant.
///
/// EVERY REFUSAL AFTER THE RESERVATION RELEASES IT — the absent subject, the refused admission and
/// the evaluator's rejection alike. A reserved-then-refused request that kept its reservation would
/// drain the owner's ceiling without anything ever being billed.
///
/// ## What it still cannot do
///
/// It cannot decide that a review is authorised: step 11 owns that, and every step above it can only
/// refuse. It cannot execute, and it holds no provider, no route and no credential — a later rung
/// chooses between the interactive and autonomous routes, and this composition is deliberately
/// neutral between them.
///
/// # Errors
/// [`CompositionRefusal`] naming the source or the gate that refused.
#[allow(clippy::too_many_arguments)]
pub fn compose_protected_operation(
    record: &SignedOwnerProgrammeDelegation,
    attested_programme: &AttestedInstallationProgramme,
    now: &HostClockReading,
    delegation_state: &dyn DurableDelegationStateStore,
    sources: &mut HostRequestSources<'_>,
    ledger: &mut dyn CanonicalBudgetLedger,
    session: &BoundIpcSession,
    admissions: &mut dyn RequestAdmissionStore,
    replay: &mut dyn RequestReplayLedger,
    peer: &TrustedPeerContext,
    request: &ProtectedOperationRequest,
    service_epoch: u64,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    // 1. THE PROGRAMME THIS INSTALLATION IS.
    let expected = ExpectedProgramme::from_attested_installation(attested_programme);

    // 2. SEC-L1 — PROVENANCE BEFORE THE REGISTRY. The owner really signed these bytes, and they
    //    address this installation. Nothing below this line runs for a record that failed either,
    //    and in particular the durable delegation store is NOT consulted, so an unauthenticated
    //    caller cannot learn which delegation ids the Host holds. It mints nothing: the full
    //    verification order still runs at step 4.
    owner_provenance_established(record, &expected)
        .map_err(CompositionRefusal::DelegationRefused)?;

    // 3. THE HOST'S OWN RECORD of this delegation. The id comes off the DECODED record, so a status
    //    is always about the delegation actually being checked; `verify_owner_programme_delegation`
    //    re-checks that pairing anyway rather than trusting this line to have got it right.
    let status = HostDelegationStatus::from_durable_store(
        delegation_state,
        &record.claimed_delegation().delegation_id,
    )
    .map_err(CompositionRefusal::DelegationRefused)?;

    // 4. THE ONE VERIFICATION ORDER: signature, relevance, liveness. Unchanged and undiminished.
    let delegation = verify_owner_programme_delegation(record, &expected, now, &status)
        .map_err(CompositionRefusal::DelegationRefused)?;

    compose_verified(
        &delegation,
        &expected,
        now,
        sources,
        ledger,
        session,
        admissions,
        replay,
        peer,
        request,
        service_epoch,
    )
}

/// Steps 5-12, after the owner's signature and the Host's own liveness record have been established.
///
/// MODULE-PRIVATE, not merely crate-private: it is visible only to this module and its test
/// submodule, so not even the rest of `operation_contract` can call it. It ASSUMES the delegation was
/// verified, which is exactly why no caller outside this module may reach it — the assumption is
/// discharged by [`compose_protected_operation`] and nowhere else.
///
/// SPLIT SO IT CAN BE PROVEN. Nothing in a test can satisfy the embedded production anchor above —
/// correctly, since ProjectOS does not hold the owner's private key and must never hold it — so a
/// test that could only enter through step 3 could never reach the plan, candidate, inbox, budget,
/// admission or evaluator branches at all, and asserting around them would be theatre. This split
/// exercises them directly without weakening the public path: the only way in from outside this
/// module is still through the owner's signature.
#[allow(clippy::too_many_arguments)]
fn compose_verified(
    delegation: &VerifiedOwnerProgrammeDelegation,
    expected: &ExpectedProgramme,
    now: &HostClockReading,
    sources: &mut HostRequestSources<'_>,
    ledger: &mut dyn CanonicalBudgetLedger,
    session: &BoundIpcSession,
    admissions: &mut dyn RequestAdmissionStore,
    replay: &mut dyn RequestReplayLedger,
    peer: &TrustedPeerContext,
    request: &ProtectedOperationRequest,
    service_epoch: u64,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    // 5. THE HOST'S PLAN AUTHORITY. A plan the Host cannot establish is not a plan it may review
    //    against, whatever the request believes.
    let (Some(plan), Some(plan_digest), Some(phase), Some(baseline_commit)) = (
        sources.plan.plan(),
        sources.plan.plan_digest(),
        sources.plan.phase(),
        sources.plan.approved_baseline(),
    ) else {
        return Err(CompositionRefusal::PlanAuthorityUnavailable);
    };

    // 6. THE SIGNED CLOSURE'S MODEL AND CREDENTIAL POLICY.
    let (Some(model_policy), Some(credential_ref)) = (
        sources.closure.model_policy(),
        sources.closure.credential_ref(),
    ) else {
        return Err(CompositionRefusal::ClosureFactsUnavailable);
    };

    // 7. THE EXACT COMMITTED CANDIDATE.
    let Some(candidate_digest) = sources.candidate.candidate_digest() else {
        return Err(CompositionRefusal::CandidateUnavailable);
    };

    // 8. CHECK AND RESERVE, BEFORE THE INBOX IS TOUCHED.
    //
    //    THIS USED TO COME AFTER THE ONE-SHOT READ, AND THAT WAS WRONG. The reasoning offered for it
    //    was that "the subject is what the cost is for" — but `AdmittedCostSource` takes no argument
    //    at all, so it cannot see the subject and never needed the read to have happened. Both gates
    //    here are free: the ceiling comparison is a Host-configuration check about no particular
    //    request, and an unknown or over-ceiling cost refuses without touching anything. Leaving them
    //    after the consume meant an ordinary near-ceiling refusal permanently burned a one-shot inbox
    //    entry that could never be resubmitted under the same correlation — a self-inflicted denial
    //    of service with nothing bought for it, and a direct breach of this module's own ordering
    //    law. Raised by the ECC security review.
    //
    //    ONE CANONICAL TRANSACTION. The composition does not read a budget figure and then decide:
    //    it asks, and the ledger reads its own authoritative state, applies its own hard stop AND
    //    the owner's ceiling, and reserves, without letting go in between. There is nothing here for
    //    a caller to state — no committed spend, no canonical ceiling, no available capacity — which
    //    is what stops two callers acting on one figure.
    let owner_ceiling = delegation.delegation().budget_ceiling_micro_usd;
    let reservation = ledger
        .admit_spend(
            *request.correlation(),
            sources.cost.admitted_cost_micro_usd(),
            owner_ceiling,
            // WHAT THE SPEND IS FOR, from the sources already resolved above and from nothing the
            // request supplied: the project is the programme's, taken from the sealed attestation at
            // step 1; the phase is the Host's own plan authority's, from step 5; the model policy is
            // the signed closure's, from step 6.
            &BudgetReservationSubject {
                project: expected.project(),
                phase: &phase,
                model_policy: &model_policy,
            },
        )
        .map_err(CompositionRefusal::BudgetRefused)?;
    //    AND THE OWNER'S CEILING IS CONFIRMED, not assumed. An implementation that ignored the
    //    ceiling it was handed would be admitting under a limit the owner never granted, so the
    //    reservation must say it was taken under exactly this delegation's ceiling. §9's own C4 gate
    //    then checks the same ceiling a third time, from the facts.
    if reservation.delegation_ceiling_micro_usd() != owner_ceiling {
        release_unused(ledger, reservation);
        return Err(CompositionRefusal::BudgetRefused(
            BudgetRefusal::CeilingExceeded,
        ));
    }

    // 9. THE ONE-SHOT SUBJECT — the first irreversible act, and now genuinely the last thing after
    //    every free refusal. The digest is of the exact bytes the Host read; the caller's own claim
    //    is compared against it at step 11 and never copied into it.
    //
    //    A reservation IS reversible, which is why it may come first: if there is no subject, the
    //    capacity goes straight back.
    let Some(parameter_digest) = sources.subject.consume_once(request.correlation()) else {
        release_unused(ledger, reservation);
        return Err(CompositionRefusal::RequestSubjectUnavailable);
    };

    // 10. THE FACTS. `committed_spend` is the reservation-aware snapshot, so §9's own budget
    //    arithmetic reproduces the reservation check without the closed evaluator changing at all.
    let facts = HostResolvedRequestFacts::production_resolved(
        delegation,
        expected,
        now,
        HostResolvedFacts {
            plan,
            plan_digest,
            phase,
            candidate_digest,
            parameter_digest,
            model_policy,
            credential_ref,
            committed_spend_micro_usd: reservation.spend_snapshot_micro_usd(),
            admitted_cost_micro_usd: Some(reservation.cost_micro_usd()),
            // A GATEKEEPER REVIEW EXECUTES A REVIEW. This is a constant here rather than a port
            // because there is no source that could legitimately answer `true` for this operation
            // class, and a port that could would be a way to ask for one.
            protected_effect_requested: false,
        },
    );

    // 10b. FRESHNESS ACROSS RESTARTS — the §10C durable replay gate.
    //
    //     WHY IT IS HERE AND NOT ANYWHERE ELSE. It cannot be earlier: the identity is derived from
    //     the facts, and the facts are step 10. It must not be later: it has to be durable BEFORE
    //     anything downstream can produce an effect, and the authority the evaluator mints at step
    //     12 is exactly what a later rung executes against. Between the two is the only correct
    //     place, and it is also the only place where the answer is known and nothing external has
    //     happened yet.
    //
    //     THE IDENTITY IS THE HOST'S, NOT THE CALLER'S. It is derived from the verified delegation
    //     and these sealed facts — the binding subject and the exact inbox body — and from nothing
    //     the request supplied. A replayer that reconnects, picks a new correlation, restarts the
    //     sequence and meets a new service epoch changes none of it, which is the whole point: those
    //     are the four things a Host restart regenerates for free.
    //
    //     CHECK AND MARK ARE ONE TRANSITION inside the ledger, so two concurrent attempts at the
    //     same governed request cannot both be told they are fresh. Every refusal — already
    //     consumed, store unavailable, history unreadable, capacity exhausted, write refused —
    //     releases the reservation, because nothing was executed.
    //
    //     CONSUMED IS NOT EXECUTED. Crossing this gate says the Host has taken replay authority for
    //     this identity once; it asserts nothing about a provider having run. A crash after this
    //     point leaves the request refused rather than repeatable, and that is the intended
    //     direction: a governed request that may have started is not one to start again.
    //
    //     THE COST OF PUTTING IT HERE, STATED RATHER THAN LEFT TO BE FOUND. Because the mark is
    //     durable BEFORE steps 11 and 12, a request that is consumed and then refused by the §9A
    //     admission or by the evaluator has permanently spent its governed identity. That is a real
    //     denial, and it is accepted for two reasons. First, it is not a NEW one: step 9 already
    //     spent the one-shot inbox entry for this correlation, so such a request was unrepeatable
    //     under the accepted contract before §10C existed. Second, the alternative is worse in the
    //     direction that matters - marking after the mint would leave a window in which authority
    //     exists and no durable record does, and a crash inside that window is exactly how a
    //     governed request becomes repeatable. A denial the owner can see beats a replay nobody can.
    //
    //     It is also why the gate sits BELOW every free refusal: a request that could not establish
    //     a plan, a closure, a candidate or a budget never reaches here, so it never spends an
    //     identity for work that was never going to run.
    let identity = RequestReplayIdentity::for_request(delegation, &facts, request.operation());
    let consumed = match replay.consume(&identity) {
        Ok(consumed) => consumed,
        Err(err) => {
            release_unused(ledger, reservation);
            return Err(CompositionRefusal::ReplayRefused(err));
        }
    };
    debug_assert!(
        consumed.answers(&identity),
        "the ledger returned evidence for an identity this request did not present"
    );

    // 11. FRESHNESS ON THE CANONICAL SESSION. One store per live session is the §9A invariant; this
    //     function never opens one, so it cannot be the place a history is reset.
    //
    //     WHY ADMISSION STAYS AFTER THE ONE-SHOT READ, having been asked to move ahead of it. The
    //     ECC code review noted that `admit_request` records nothing when it refuses, so it looks
    //     like another free gate that could sit alongside steps 4-7 and save the inbox entry of a
    //     request carrying a stale sequence. It is free on the REFUSAL path — but on the SUCCESS
    //     path it consumes the correlation permanently, and that is the case this order protects.
    //
    //     The accepted inbox contract deliberately does NOT consume an identity when the request
    //     file is simply not there yet: absence is a race, not an attack, and a benign
    //     write-then-notify overlap has to stay recoverable under the only identity the request has.
    //     Admitting first would spend that correlation in the session history before the Host had
    //     even looked for a subject, so the retry the inbox carefully preserved could never be
    //     admitted — the exemption would be worth nothing. That trades a common race for a rare
    //     client bug (a fresh correlation carrying a non-advancing sequence, on an ordered pipe), so
    //     the order stays as it is. Pre-checking freshness without recording, then admitting later,
    //     is not an option either: that is a second replay path to keep in step with this one.

    let admitted =
        match session.admit_request(admissions, *request.correlation(), request.sequence()) {
            Ok(admitted) => admitted,
            Err(err) => {
                // Nothing was executed, so nothing may stay reserved.
                release_unused(ledger, reservation);
                return Err(CompositionRefusal::AdmissionRefused(err));
            }
        };
    debug_assert_eq!(admitted.sequence(), request.sequence());

    // 12. THE §9 EVALUATOR — the sole mint, unchanged.
    let evidence = GatekeeperDelegationEvidence {
        delegation,
        facts: &facts,
    };
    match evaluate_protected_operation(
        request,
        Some(peer),
        Some(&evidence),
        Some(admitted),
        service_epoch,
    ) {
        ProtectedOperationEvaluation::Authorised(authority) => Ok(ComposedProtectedOperation {
            _seal: Seal,
            review_subject: ReviewSubjectFacts::from_resolved(&facts, &authority, baseline_commit),
            authority,
            reservation,
        }),
        ProtectedOperationEvaluation::Rejected(response) => {
            release_unused(ledger, reservation);
            Err(CompositionRefusal::Rejected(response))
        }
    }
}

/// Give back capacity that was set aside for a request which will not run.
///
/// THE RESULT IS NOT DISCARDED, AND THAT IS THE POINT. `release` can only refuse a reservation this
/// authority is not holding, and every call site here passes one it minted moments earlier from this
/// same authority — so a refusal would mean an invariant had broken, not that a caller got something
/// wrong. `let _ =` at each site swallowed exactly that signal. The assertion is a `debug_assert`, so
/// release builds behave identically; note that the release itself is performed OUTSIDE it, because a
/// side effect written inside `debug_assert!` does not happen in a release build at all — which would
/// have turned a tidy-up into a capacity leak in production and nowhere else. Raised by the ECC code
/// review.
fn release_unused(ledger: &mut dyn CanonicalBudgetLedger, reservation: BudgetReservation) {
    let released = ledger.release_reservation(reservation);
    debug_assert!(
        released.is_ok(),
        "a reservation this composition just minted must still be outstanding on this authority"
    );
}

/// FIXTURE-ONLY implementation of the sealed execution seam.
///
/// THE SAME SHAPE AS [`FixtureBudgetLedger`], FOR THE SAME REASON: the seam is sealed, so the only place
/// even a deterministic stand-in can live is inside this module tree, and it is compiled only under the
/// non-default `test-fixtures` feature that no shipped graph enables. It plays back ONE scripted answer
/// and records what it was asked, so a proof can assert both what the rung did with the answer and
/// which facts the seam was actually handed.
///
/// It contacts nothing, reads nothing and executes nothing. It is how the rung, the wire codec and the
/// isolated transport are proven with no provider, no credential and no spend.
#[cfg(feature = "test-fixtures")]
#[derive(Debug)]
pub struct FixtureReviewExecution {
    script: Result<ReviewExecutionOutcome, ReviewExecutionRefusal>,
    calls: u32,
    seen: Option<ReviewSubjectFacts>,
}

#[cfg(feature = "test-fixtures")]
impl FixtureReviewExecution {
    /// FIXTURE ONLY. A review that ran, was attested, and billed `settlement`.
    #[must_use]
    pub fn succeeding(
        evidence_ref: [u8; EVIDENCE_REF_LEN],
        settlement: ProviderCallSettlement,
    ) -> Self {
        Self::scripted(Ok(ReviewExecutionOutcome::Succeeded {
            evidence_ref,
            settlement,
        }))
    }

    /// FIXTURE ONLY. An execution that occurred and produced no usable attested answer.
    #[must_use]
    pub fn failing(provider_dispatched: bool, settlement: Option<ProviderCallSettlement>) -> Self {
        Self::scripted(Ok(ReviewExecutionOutcome::Failed {
            evidence_ref: [0xf4; EVIDENCE_REF_LEN],
            provider_dispatched,
            settlement,
        }))
    }

    /// FIXTURE ONLY. A review refused before anything could reach a provider.
    #[must_use]
    pub fn not_dispatched() -> Self {
        Self::scripted(Err(ReviewExecutionRefusal::NotDispatched))
    }

    fn scripted(script: Result<ReviewExecutionOutcome, ReviewExecutionRefusal>) -> Self {
        Self {
            script,
            calls: 0,
            seen: None,
        }
    }

    /// How many times the rung drove the seam.
    #[must_use]
    pub fn calls(&self) -> u32 {
        self.calls
    }

    /// The facts the seam was handed, if it was driven at all.
    #[must_use]
    pub fn seen_subject(&self) -> Option<&ReviewSubjectFacts> {
        self.seen.as_ref()
    }
}

#[cfg(feature = "test-fixtures")]
impl gatekeeper_review_execution::Sealed for FixtureReviewExecution {}

#[cfg(feature = "test-fixtures")]
impl GatekeeperReviewExecution for FixtureReviewExecution {
    fn execute(
        &mut self,
        _authority: &AuthorisedProtectedOperation,
        subject: &ReviewSubjectFacts,
    ) -> Result<ReviewExecutionOutcome, ReviewExecutionRefusal> {
        self.calls += 1;
        self.seen = Some(*subject);
        self.script.clone()
    }
}

/// The one operation class this composition serves.
///
/// Restated here so a reader does not have to follow the enum to know what is being composed, and
/// asserted in the tests against [`OperationClass::may_be_delegated_by_programme`] so the two can
/// never drift.
pub const COMPOSED_OPERATION: OperationClass = OperationClass::IndependentGatekeeperReview;

/// RUN-TO-COMPLETION HOST ATTESTATION 10D - THE PRODUCTION `CanonicalBudgetLedger`.
///
/// A CHILD MODULE FOR THE SAME REASON THIS ONE IS: `canonical_budget::Sealed` is private here, so
/// the only place a real implementation of the sealed trait can live is inside this subtree.
pub mod canonical_ledger;

/// PROJECTOS-HOST-REVIEW-PATH1A - THE ONE SHIPPED `GatekeeperReviewExecution`.
///
/// A CHILD MODULE FOR THE SAME REASON: `gatekeeper_review_execution::Sealed` is private here.
pub mod review_execution;

// GATED ON THE FIXTURE GRAPH, because almost every proof here needs a LIVE `BoundIpcSession` and the
// only way to mint one without a real named pipe is core's fixture verifier. Run with
// `--features test-fixtures` (or `--all-features`).
#[cfg(all(test, feature = "test-fixtures"))]
mod tests;
