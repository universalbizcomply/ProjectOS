//! THE PRODUCTION `CanonicalBudgetLedger` — RUN-TO-COMPLETION HOST ATTESTATION §10D.
//!
//! ## What §10A left, and what this is
//!
//! §10A sealed [`CanonicalBudgetLedger`] and shipped no implementation of it, deliberately: an
//! in-memory one would have been a per-process budget truth able to diverge from every other
//! process, and the phase said so in as many words. This is the implementation it named — the
//! concrete bridge to `.projectops/gatekeeper-ledger.json` under `.projectops/gatekeeper-ledger.lock`,
//! the ledger ProjectOS already keeps.
//!
//! ## It holds no budget position, and that is the whole design
//!
//! Look at what this type carries: a root, an identity derived from that root, and a clock reading.
//! There is no committed spend here, no hard stop, no month total and no outstanding list — not
//! because they are hidden, but because holding them is the defect. Every figure is read inside the
//! canonical lock, at the moment of the decision, from the file the agent writes; between two calls
//! this object knows nothing about money at all.
//!
//! ## A CHILD MODULE, BECAUSE THE SEAL SAYS SO
//!
//! `canonical_budget::Sealed` is private to `host_composition`, so the only place a real
//! implementation can live is a module inside it. That is the same fact that decided §10B's file
//! layout, and it is worth restating: the seal is not decoration, it dictates where the code goes.
//!
//! ## The root, and where §10E put it
//!
//! [`HostOwnedGatekeeperProjectRoot`] has a private field and no path-taking constructor. Resolving
//! the real governed project root is installation composition — it was the same missing wiring the
//! durable delegation store (§10B) and the durable replay ledger (§10C) were waiting on — and
//! inventing one here would be fabricating installation truth. §10E supplied it: the canonical
//! installed-project registry selects the ONE repository root for an exact project id, cross-checked
//! against that repository's own `projectId`, and custody seals it. The route in is
//! [`HostOwnedGatekeeperProjectRoot::from_activated`].
//!
//! IT IS STILL FAIL-CLOSED, one level further along. Activation requires a boundary acceptance whose
//! production mint does not exist until the protected installation boundary is accepted — and that
//! boundary is what makes the registry itself trustworthy — so a default build cannot construct this
//! ledger and its budget gate refuses.
//!
//! ## What it will not do
//!
//! It takes no path from a caller, reads no environment variable, uses no working directory, spawns
//! no process, prices nothing and contacts no provider. An unknown cost is a refusal.

use std::path::{Path, PathBuf};

use projectos_host_gatekeeper_ledger::{
    admit_spend, commit_reservation, release_reservation, AdmissionRequest, LedgerRefusal,
    SettledProviderCall,
};
use projectos_host_trusted_roots::{ActivatedGovernedProjectRoot, TrustedRootRefusal};
use sha2::{Digest, Sha256};

use super::{
    canonical_budget, BudgetRefusal, BudgetReservation, BudgetReservationSubject,
    CanonicalBudgetLedger, ProviderCallSettlement,
};
use crate::operation_contract::{sealed::Seal, CORRELATION_LEN, DELEGATION_DIGEST_LEN};
use crate::owner_programme_delegation::HostClockReading;

/// The prefix every Host-minted ledger record carries.
///
/// DISTINCT FROM THE AGENT'S `GKREQ-`, SO THE TWO CAN NEVER COLLIDE. A collision would not merely
/// confuse a report: the canonical ledger addresses a reservation by request id, so two different
/// questions sharing one id would let a settlement land on the wrong one.
const HOST_REQUEST_ID_PREFIX: &str = "GKHOST-";

/// The Host-owned governed project root whose `.projectops` holds the canonical ledger.
///
/// PRIVATE FIELD, AND NO CONSTRUCTOR THAT TAKES A PATH — in any build. The production route is
/// [`HostOwnedGatekeeperProjectRoot::from_activated`], added in §10E, which accepts only an
/// already-resolved, registry-attested, custody-sealed governed project root.
#[derive(Debug, Clone)]
pub struct HostOwnedGatekeeperProjectRoot {
    root: PathBuf,
}

impl HostOwnedGatekeeperProjectRoot {
    /// THE PRODUCTION MINT — RUN-TO-COMPLETION HOST ATTESTATION §10E.
    ///
    /// NO PATH PARAMETER, AND NO PROJECT PARAMETER EITHER. Which project this is was decided when the
    /// [`ActivatedGovernedProjectRoot`] was resolved, by the canonical installed-project registry;
    /// this call cannot disagree with it, and cannot be handed a directory belonging to a different
    /// project or a different repository.
    ///
    /// IT IS A PROJECT ROOT, NOT THE HOST STATE ROOT. The parameter type is what enforces that: the
    /// Host's own state root cannot be passed here, so the canonical ledger can never be transacted
    /// against the protected installation subtree.
    /// # Errors
    /// [`TrustedRootRefusal`] when the root no longer denotes the object, or no longer lives at the
    /// location, that resolution captured.
    pub fn from_activated(
        activated: &ActivatedGovernedProjectRoot,
    ) -> Result<Self, TrustedRootRefusal> {
        // REVALIDATED AT THE HANDOFF, because this is where the handle-owned capability becomes an
        // ordinary path. The trusted root holds a pinned Windows handle and can prove, on demand,
        // that the directory has not been replaced or re-aimed; a `PathBuf` cannot prove anything.
        // Checking here is what stops that proof being discarded unexamined.
        //
        // THIS ONE HAS THE WEAKEST AFTERWARDS, and it should be said plainly: the canonical ledger
        // takes its lock per transaction rather than holding one, so nothing pins the governed
        // project root between transactions. Carry-forward, with the same fix.
        activated.revalidate()?;
        Ok(Self {
            root: activated.path().to_path_buf(),
        })
    }

    /// FIXTURE ONLY: treat a disposable directory the test already owns as the governed project
    /// root.
    ///
    /// Compiled for this crate's tests and the non-default `test-fixtures` graph, so no shipped
    /// build can reach it. It is how the adapter is proven without a real installed project.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(owned_root: &Path) -> Self {
        Self {
            root: owned_root.to_path_buf(),
        }
    }

    fn path(&self) -> &Path {
        &self.root
    }
}

/// THE PRODUCTION CANONICAL BUDGET LEDGER.
///
/// One instance answers for one governed project's canonical ledger file. Constructing it opens
/// nothing, locks nothing and reads nothing: the transaction happens inside each call.
#[derive(Debug)]
pub struct CanonicalGatekeeperLedger {
    root: HostOwnedGatekeeperProjectRoot,
    /// WHICH LEDGER THIS IS, derived from the root rather than from a counter.
    ///
    /// §10A gives every [`BudgetReservation`] the identity of the ledger that minted it, so a
    /// settlement cannot land on a different one. For an in-memory position "which ledger" means
    /// "which object"; for this one it means "which FILE", and deriving the id from the root is what
    /// makes those the same answer. Two adapters opened on one project are the same ledger — which
    /// they are — so a reservation taken by the composition can still be settled by the execution
    /// rung's own adapter, while a reservation from a different project's ledger is refused twice
    /// over: here, and again by the canonical transaction, which will not find it.
    ledger_id: u64,
    /// The Host's clock reading for this ledger's life, in epoch seconds.
    ///
    /// TAKEN FROM A SEALED [`HostClockReading`], never from a caller and never from an argument.
    /// The canonical ledger attributes spend to the month in the entry's timestamp, so "what time is
    /// it" is a budget-relevant fact and is treated like one.
    at_epoch_s: u64,
}

impl CanonicalGatekeeperLedger {
    /// Open the canonical ledger for one governed project, at one clock reading.
    ///
    /// NOTHING IS OPENED, READ OR LOCKED HERE. The name follows the Host's other stores; what it
    /// actually does is bind a root and a time. Every transaction is self-contained.
    #[must_use]
    pub fn open(root: HostOwnedGatekeeperProjectRoot, now: &HostClockReading) -> Self {
        let ledger_id = ledger_identity(root.path());
        Self {
            root,
            ledger_id,
            at_epoch_s: now.epoch_s(),
        }
    }

    /// The canonical ledger record id for one governed request.
    ///
    /// DERIVED, NEVER SUPPLIED. It is the request's correlation rendered as hex under a fixed
    /// prefix: deterministic, bounded, unique to one request, and inside the canonical
    /// `^[A-Za-z0-9_-]{4,128}$` rule that decides whether an id can address a record at all.
    ///
    /// WHY THE CORRELATION AND NOT THE §10C REPLAY IDENTITY. The replay identity is derived from the
    /// Host-resolved facts, which do not exist until composition step 10 — and the budget is
    /// reserved at step 8, before the one-shot inbox is touched, precisely so that a near-ceiling
    /// refusal cannot burn an inbox entry. Reserving under an identity that needs the facts would
    /// mean moving the budget gate below the irreversible one, which is a reordering of accepted
    /// §10A security gates rather than anything §10D may decide. What binds the two is the
    /// composition: one correlation is admitted once by §9A, consumes one inbox entry, and takes one
    /// reservation.
    fn record_id(correlation: &[u8; CORRELATION_LEN]) -> String {
        let mut id = String::with_capacity(HOST_REQUEST_ID_PREFIX.len() + CORRELATION_LEN * 2);
        id.push_str(HOST_REQUEST_ID_PREFIX);
        for byte in correlation {
            id.push_str(&format!("{byte:02x}"));
        }
        id
    }
}

/// A ledger's identity, derived from the file it keeps.
///
/// The root path's bytes through the digest this crate already uses, folded to the eight bytes
/// §10A's `ledger_id` carries. It is not a secret, is never rendered and carries no meaning outside
/// the process; what it has to be is EQUAL for two adapters over one project and different for two
/// projects, and a digest of the root gives both. A lossy rendering of a path that is not valid
/// Unicode could in principle collide, and it would cost nothing: the canonical transaction refuses
/// a reservation it is not holding regardless, so this check is the cheap first answer rather than
/// the only one.
fn ledger_identity(root: &Path) -> u64 {
    // CANONICALISED FIRST, so two spellings of one directory are one ledger.
    //
    // Hashing the path as written meant a trailing separator, a different case or a relative spelling
    // produced a DIFFERENT identity for the same file - and the consequence is not cosmetic. The
    // composition takes the reservation and the execution rung settles it, each through its own
    // adapter, so two independently constructed adapters over one project would refuse each other's
    // reservations with `ReservationNotOutstanding` and the capacity would be stranded until somebody
    // edited the ledger by hand. Unreachable today, because there is no production constructor for
    // the root - and the moment that is wired is the moment it would start happening. Raised by the
    // ECC code review.
    //
    // A ROOT THAT CANNOT BE CANONICALISED FALLS BACK TO ITS OWN SPELLING, which is what this used to
    // be and is still deterministic. Canonicalisation needs the directory to exist; a root that does
    // not exist has no transaction to take, and the refusal it earns comes from
    // `CanonicalPaths::resolve`, not from here.
    let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(b"projectos.host.canonical-budget-ledger.v1");
    hasher.update(canonical.as_os_str().to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let mut eight = [0u8; 8];
    eight.copy_from_slice(&digest[..8]);
    // Never zero, so a ledger id can never be confused with an unset one.
    u64::from_be_bytes(eight) | 1
}

/// A Host-resolved digest, rendered as the label the canonical ledger entry carries.
///
/// THE HOST HAS DIGESTS WHERE THE AGENT HAS NAMES, and this is where that shows. The agent writes
/// `"projectId": "projectos"`; the Host never learns that string — its programme arrives as the
/// project digest inside a signed execution closure, and inventing a name from it would be
/// fabricating an identity. So the label is the digest, written plainly as `sha256:<hex>`.
///
/// IT DOES NOT AFFECT ANY CEILING. The canonical monthly total — the figure both hard stops are
/// compared against — is summed across every entry in the month regardless of project or phase,
/// because a spend limit is per account. These labels are attribution for a human reading the
/// record, and the one thing that would be wrong is to guess at them. Reconciling the Host's digest
/// labels with the agent's string ids, so that per-project and per-phase REPORTS agree, is recorded
/// as carry-forward.
fn digest_label(digest: &[u8; DELEGATION_DIGEST_LEN]) -> String {
    let mut label = String::with_capacity(7 + DELEGATION_DIGEST_LEN * 2);
    label.push_str("sha256:");
    for byte in digest {
        label.push_str(&format!("{byte:02x}"));
    }
    label
}

/// Translate a canonical refusal into the Host's budget vocabulary.
///
/// THE EXACT ONES KEEP THEIR NAMES, so a refusal that §10A already had a word for still reports it,
/// and everything else is carried whole rather than flattened: an operator needs to know that a lock
/// was held rather than that "the budget refused".
fn translate(refusal: LedgerRefusal) -> BudgetRefusal {
    match refusal {
        LedgerRefusal::CostUnknown => BudgetRefusal::CostUnknown,
        LedgerRefusal::ArithmeticOverflow => BudgetRefusal::ArithmeticOverflow,
        LedgerRefusal::CeilingExceeded => BudgetRefusal::CeilingExceeded,
        LedgerRefusal::AlreadyReserved => BudgetRefusal::AlreadyReserved,
        LedgerRefusal::OutstandingReservationsExhausted => {
            BudgetRefusal::OutstandingReservationsExhausted
        }
        LedgerRefusal::ReservationNotOutstanding => BudgetRefusal::ReservationNotOutstanding,
        other => BudgetRefusal::LedgerRefused(other),
    }
}

impl canonical_budget::Sealed for CanonicalGatekeeperLedger {}

impl CanonicalBudgetLedger for CanonicalGatekeeperLedger {
    fn admit_spend(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
        subject: &BudgetReservationSubject<'_>,
    ) -> Result<BudgetReservation, BudgetRefusal> {
        let record_id = Self::record_id(&correlation);
        let project = digest_label(subject.project);
        let phase = digest_label(subject.phase);
        let model = digest_label(subject.model_policy);

        // ONE CANONICAL TRANSACTION. Everything that decides the answer happens inside it, under the
        // canonical lock, over a fresh read of the authoritative file: the installation's own hard
        // stop, the month's committed spend, every outstanding reservation, and the write. Nothing
        // is read here and acted on there.
        let admitted = admit_spend(
            self.root.path(),
            &AdmissionRequest {
                request_id: &record_id,
                project_id: &project,
                phase_id: &phase,
                model: &model,
                cost_micro_usd,
                delegation_ceiling_micro_usd,
                at_epoch_s: self.at_epoch_s,
            },
        )
        .map_err(translate)?;

        // EVERY FIGURE BELOW COMES BACK FROM THE TRANSACTION, NOT FROM THIS FUNCTION'S ARGUMENTS.
        // That is what §10A's ledger-honesty boundary asks for: the evidence the composition
        // receives must derive from the same atomic act that persisted the reservation, or the
        // reservation is a claim about a write rather than a record of one.
        Ok(BudgetReservation {
            _seal: Seal,
            ledger_id: self.ledger_id,
            correlation,
            cost_micro_usd: admitted.cost_micro_usd(),
            delegation_ceiling_micro_usd: admitted.delegation_ceiling_micro_usd(),
            spend_snapshot_micro_usd: admitted.spend_snapshot_micro_usd(),
        })
    }

    fn commit_reservation(
        &mut self,
        reservation: BudgetReservation,
        settlement: &ProviderCallSettlement,
    ) -> Result<(), BudgetRefusal> {
        if reservation.ledger_id != self.ledger_id {
            return Err(BudgetRefusal::ReservationNotOutstanding);
        }
        commit_reservation(
            self.root.path(),
            &Self::record_id(&reservation.correlation),
            &SettledProviderCall {
                input_tokens: settlement.input_tokens,
                cached_input_tokens: settlement.cached_input_tokens,
                output_tokens: settlement.output_tokens,
                cost_micro_usd: settlement.cost_micro_usd,
            },
            self.at_epoch_s,
        )
        .map_err(translate)
    }

    fn release_reservation(&mut self, reservation: BudgetReservation) -> Result<(), BudgetRefusal> {
        if reservation.ledger_id != self.ledger_id {
            return Err(BudgetRefusal::ReservationNotOutstanding);
        }
        release_reservation(
            self.root.path(),
            &Self::record_id(&reservation.correlation),
            self.at_epoch_s,
        )
        .map_err(translate)
    }
}

#[cfg(all(test, feature = "test-fixtures"))]
mod tests;
