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

use super::{
    evaluate_protected_operation, sealed::Seal, AuthorisedProtectedOperation,
    GatekeeperDelegationEvidence, HostResolvedFacts, HostResolvedRequestFacts, OperationClass,
    ProtectedOperationEvaluation, ProtectedOperationRequest, ProtectedOperationResponse,
    TrustedPeerContext, VerifiedOwnerProgrammeDelegation, BINDING_DIGEST_LEN, CORRELATION_LEN,
    DELEGATION_DIGEST_LEN,
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
    fn admit_spend(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
    ) -> Result<BudgetReservation, BudgetRefusal>;

    /// A charge was actually incurred: turn this reservation into committed spend, once.
    ///
    /// # Errors
    /// [`BudgetRefusal::ReservationNotOutstanding`] for a reservation this ledger is not holding.
    fn commit_reservation(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal>;

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
    ) -> Result<BudgetReservation, BudgetRefusal> {
        self.reserve(correlation, cost_micro_usd, delegation_ceiling_micro_usd)
    }
    fn commit_reservation(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal> {
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
    /// The Host's approved-plan authority could not establish the plan, its digest or the phase.
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
/// 10. THE FACTS, sealed together with the programme and the Host's clock reading.
/// 11. FRESHNESS on the canonical session — the §9A admission, minted by the session itself.
/// 12. THE §9 EVALUATOR. It re-checks every one of these against the caller's claims and against
///     the owner's record, and mints the authority only if they all agree.
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
    peer: &TrustedPeerContext,
    request: &ProtectedOperationRequest,
    service_epoch: u64,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    // 5. THE HOST'S PLAN AUTHORITY. A plan the Host cannot establish is not a plan it may review
    //    against, whatever the request believes.
    let (Some(plan), Some(plan_digest), Some(phase)) = (
        sources.plan.plan(),
        sources.plan.plan_digest(),
        sources.plan.phase(),
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

/// The one operation class this composition serves.
///
/// Restated here so a reader does not have to follow the enum to know what is being composed, and
/// asserted in the tests against [`OperationClass::may_be_delegated_by_programme`] so the two can
/// never drift.
pub const COMPOSED_OPERATION: OperationClass = OperationClass::IndependentGatekeeperReview;

// GATED ON THE FIXTURE GRAPH, because almost every proof here needs a LIVE `BoundIpcSession` and the
// only way to mint one without a real named pipe is core's fixture verifier. Run with
// `--features test-fixtures` (or `--all-features`).
#[cfg(all(test, feature = "test-fixtures"))]
mod tests;
