//! THE HOST'S CLIENT OF THE ONE CANONICAL ProjectOS BUDGET LEDGER.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10D.
//!
//! # There is one ledger, and this is not it
//!
//! The source of spend truth is `.projectops/gatekeeper-ledger.json`, guarded by
//! `.projectops/gatekeeper-ledger.lock`, written and read by `admitGatekeeperSpend` /
//! `settleGatekeeperSpend` / `releaseUndispatchedReservation` / `readLedger` in
//! `projectos/agent/src/loop/gatekeeperConfig.ts`. That file holds real historical spend, is the
//! record an owner audits, and answers the only question a budget has: what has this account already
//! committed this month?
//!
//! This crate does not own that record, copy it, cache it, mirror it, summarise it into state of its
//! own, or keep any budget position between calls. It holds **no** committed spend, **no** hard stop
//! and **no** outstanding list. What it does is take the canonical lock, read the canonical file
//! fresh, apply the canonical policy, write the canonical entry, and let go. Between two calls it
//! remembers nothing, because there is nothing it would be entitled to remember.
//!
//! ## Why a second implementation of the protocol is not a second ledger
//!
//! Two programs write this file: the ProjectOS agent (TypeScript) and ProjectOSHost (Rust). They
//! could have been made to share code only by making one of them call the other, and the routes to
//! that were examined and rejected in the §10D design:
//!
//! * A **subprocess boundary** — Host spawns Node to run the canonical transaction — is forbidden
//!   outright in the crate that must hold the sealed adapter (`val-windows-local-ipc-capability-b3`
//!   refuses `std::process::Command` anywhere in its sources) and would need an installation-fixed
//!   Node identity that does not exist. It also cannot prove the property §10D is for: what comes
//!   back over a pipe is a *report* of a transaction, and a Host that believed a report would be
//!   trusting an answer rather than taking a decision.
//! * A **service boundary** would be a second daemon to install, secure and keep alive, for one
//!   integer comparison.
//!
//! What is shared instead is the thing that actually has to be shared: **the file, the lock, the
//! schema and the rule**. Mutual exclusion between the two programs is the filesystem's
//! `CREATE_NEW`, which does not care which language asked. The accounting they each perform is
//! checked against the other in `tests/cross_implementation.rs`, which drives the REAL compiled
//! TypeScript over the same temporary ledger.
//!
//! ## The divergence policy: refuse more, admit never
//!
//! Where this reading is stricter than the canonical implementation's, it is only ever in the
//! direction of refusing. Each difference is documented where it is made, and the whole set is:
//!
//! | Situation | Canonical | Host |
//! |---|---|---|
//! | Ledger file absent | empty | empty |
//! | Ledger unparseable / not the canonical shape | empty (an OPEN budget) | REFUSE |
//! | Entry carries an unknown field | ignored, and dropped on rewrite | REFUSE |
//! | Cost is negative / fractional / not a number | coerced to 0 | REFUSE |
//! | Ledger over a size or entry bound | no bound | REFUSE |
//! | Ledger or lock path is a link / reparse point | followed | REFUSE |
//! | Request id already present, unresolved | re-askable IF the broker record says "not answered" | REFUSE |
//! | Budget figure fractional | accepted if finite ≥ 0 | REFUSE |
//! | More than [`MAX_OUTSTANDING_RESERVATIONS`] in flight | no bound | REFUSE |
//!
//! There is no row in which the Host admits something the canonical transaction would refuse, and
//! `tests/cross_implementation.rs` asserts that on the paths a test can drive.
//!
//! # What this crate will not do
//!
//! It resolves no path of its own beyond two frozen relative segments under a root it is given; it
//! reads no environment variable and no working directory; it spawns no process; it creates no
//! directory; it opens no network; it holds no credential; it prices nothing — an unknown cost is a
//! refusal, never a zero — and it never contacts a provider.
//!
//! # The root is not this crate's to choose either
//!
//! Every entry point takes the governed project root as a `&Path` and derives both files from it by
//! frozen relative segments. Choosing that root is the caller's responsibility and it is a trusted
//! one: in ProjectOSHost the only caller is the sealed `CanonicalBudgetLedger` adapter, whose root
//! type has private fields and, as of this checkpoint, no production constructor — so a shipped Host
//! cannot name a project root at all and its budget gate fails closed, exactly as the durable
//! delegation store and the durable replay ledger do.

#![forbid(unsafe_code)]

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub mod entry;
pub mod instant;
pub mod lock;
pub mod policy;
pub mod refusal;

pub use entry::{LedgerDocument, LedgerEntry, TokenUsage, LEDGER_SCHEMA_VERSION};
pub use instant::LedgerInstant;
pub use policy::BudgetPolicy;
pub use refusal::LedgerRefusal;

/// The canonical ledger, relative to the governed project root.
pub const GATEKEEPER_LEDGER_REL: [&str; 2] = [".projectops", "gatekeeper-ledger.json"];
/// The canonical lock, relative to the governed project root.
pub const GATEKEEPER_LEDGER_LOCK_REL: [&str; 2] = [".projectops", "gatekeeper-ledger.lock"];
/// The canonical gatekeeper configuration, relative to the governed project root.
pub const GATEKEEPER_CONFIG_REL: [&str; 2] = [".projectops", "gatekeeper.json"];

/// The suffix of the complete-then-rename companion file, beside the ledger it replaces.
const PENDING_SUFFIX: &str = ".tmp";

/// The largest ledger this Host will read.
///
/// The real ProjectOS ledger is about 21 KB after fifty-eight recorded calls. Four mebibytes is
/// roughly ten thousand entries' worth of headroom and still small enough that reading it into
/// memory under a lock is bounded work. Beyond it, refusing beats reading: an unbounded read on the
/// admission path is a way to make the Host do arbitrary work before it will answer anybody.
pub const MAX_LEDGER_BYTES: u64 = 4 * 1024 * 1024;

/// The largest gatekeeper configuration this Host will read.
pub const MAX_CONFIG_BYTES: u64 = 256 * 1024;

/// The most entries a ledger may carry and still be accounted for.
pub const MAX_LEDGER_ENTRIES: usize = 8_192;

/// The most reservations that may be outstanding at once, across every requester.
///
/// BOUNDED, LIKE EVERY OTHER SET THE HOST KEEPS ON BEHALF OF A PEER, and equal to the Host's own
/// `MAX_OUTSTANDING_RESERVATIONS`, which a test in the IPC crate pins. The canonical implementation
/// has no such bound; enforcing one can only refuse, never admit.
pub const MAX_OUTSTANDING_RESERVATIONS: usize = 64;

/// The longest project, phase, model or timestamp label an entry may carry.
pub const MAX_LABEL_LEN: usize = 256;

/// The request id rule, transcribed from `gatekeeperDecisionEvidenceRelPath`.
///
/// NARROW ON PURPOSE, AND IT IS THE CANONICAL RULE. Ids are interpolated into paths elsewhere in
/// ProjectOS, so anything that could traverse, hide or collide is refused rather than sanitised.
/// Request ids are derived, not supplied, so nothing legitimate is excluded.
///
/// # Errors
/// [`LedgerRefusal::RequestIdMalformed`].
pub fn check_request_id(id: &str) -> Result<(), LedgerRefusal> {
    let ok = (4..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(LedgerRefusal::RequestIdMalformed)
    }
}

/// A label an entry may carry: non-empty, bounded, and free of control characters.
///
/// # Errors
/// [`LedgerRefusal::LabelMalformed`].
pub fn check_label(label: &str) -> Result<(), LedgerRefusal> {
    if label.is_empty() || label.chars().count() > MAX_LABEL_LEN {
        return Err(LedgerRefusal::LabelMalformed);
    }
    if label.chars().any(char::is_control) {
        return Err(LedgerRefusal::LabelMalformed);
    }
    Ok(())
}

/// What the Host is asking the canonical ledger to admit.
///
/// EVERY FIELD IS A FACT THE HOST RESOLVED, and none of them is a budget position. There is no
/// committed spend here, no hard stop, no available capacity and no month total: those are read
/// inside the transaction from the authoritative file, which is what stops two callers acting on one
/// figure.
#[derive(Debug, Clone, Copy)]
pub struct AdmissionRequest<'a> {
    /// The deterministic identity of this exact governed request.
    pub request_id: &'a str,
    /// The project this spend is attributed to.
    pub project_id: &'a str,
    /// The phase this spend is attributed to.
    pub phase_id: &'a str,
    /// The model that will answer.
    pub model: &'a str,
    /// The cost this call will incur, or `None` when it could not be established.
    ///
    /// `None` REFUSES. A zero cost is under every ceiling, so a budget that treats "we could not
    /// price this" as free is not a budget.
    pub cost_micro_usd: Option<u64>,
    /// The OWNER'S ceiling, read off a delegation whose signature the Host already verified.
    ///
    /// It constrains this programme IN ADDITION TO — never instead of — the installation's own hard
    /// stop, which the transaction reads for itself from the canonical configuration. A request must
    /// satisfy both, and the lower of the two binds.
    pub delegation_ceiling_micro_usd: u64,
    /// The Host's clock reading, in Unix epoch seconds. Rendered here into the canonical UTC
    /// timestamp, which is also what decides the accounting month.
    pub at_epoch_s: u64,
}

/// A reservation the canonical transaction actually took, described by the transaction itself.
///
/// EVERY FIGURE HERE WAS COMPUTED INSIDE THE LOCK, from the authoritative file, after the write. It
/// is not an echo of anything the caller supplied: `spend_snapshot_micro_usd` is the month total the
/// transaction read, `hard_stop_micro_usd` is the ceiling it resolved from the canonical
/// configuration, and `cost_micro_usd` is the cost it checked and committed capacity for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedReservation {
    request_id: String,
    cost_micro_usd: u64,
    spend_snapshot_micro_usd: u64,
    delegation_ceiling_micro_usd: u64,
    hard_stop_micro_usd: u64,
}

impl AdmittedReservation {
    /// The canonical ledger record this reservation is held under.
    #[must_use]
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
    /// The cost set aside.
    #[must_use]
    pub fn cost_micro_usd(&self) -> u64 {
        self.cost_micro_usd
    }
    /// The month's committed spend PLUS every reservation outstanding when this one was taken,
    /// BEFORE this one was added. The figure §9's own request-scoped budget gate adds the admitted
    /// cost to.
    #[must_use]
    pub fn spend_snapshot_micro_usd(&self) -> u64 {
        self.spend_snapshot_micro_usd
    }
    /// The owner's delegation ceiling this admission was taken under.
    #[must_use]
    pub fn delegation_ceiling_micro_usd(&self) -> u64 {
        self.delegation_ceiling_micro_usd
    }
    /// The installation's own hard stop, as the canonical configuration set it.
    #[must_use]
    pub fn hard_stop_micro_usd(&self) -> u64 {
        self.hard_stop_micro_usd
    }
}

/// What a provider call actually cost, once it has happened.
///
/// THIS IS WHAT MAKES A COMMIT REPRESENTABLE AT ALL. In the canonical ledger an entry carrying no
/// usage IS a reservation — that is the rule every path in this crate uses — so "committed" cannot
/// be expressed by flipping a flag. A settlement replaces the provisional entry with the real call,
/// exactly as `settleGatekeeperSpend` does, and a settlement that recorded nothing would leave
/// behind an entry the agent's own release path is entitled to delete.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettledProviderCall {
    /// Input tokens the provider billed.
    pub input_tokens: u64,
    /// Cached input tokens, when the provider reported them.
    pub cached_input_tokens: Option<u64>,
    /// Output tokens the provider billed.
    pub output_tokens: u64,
    /// What those tokens cost at the configured rate card, in integer micro-USD.
    pub cost_micro_usd: u64,
}

/// The canonical paths, resolved from one trusted root.
///
/// FOUR, NOT THREE. The atomic write needs a companion `<ledger>.tmp`, and until the ECC security
/// review for §10D that path was derived inline at the point of use and never checked — so it was
/// the one write target this crate's "follows no reparse point" claim did not actually cover. It is
/// resolved and validated here with the others now, because a path that is written to is a path that
/// decides where the record of spending goes.
#[derive(Debug, Clone)]
struct CanonicalPaths {
    ledger: PathBuf,
    lock: PathBuf,
    config: PathBuf,
    pending: PathBuf,
}

impl CanonicalPaths {
    /// Resolve the canonical paths under a root, refusing anything that is not a real directory or
    /// that reaches the ledger through a link.
    ///
    /// NO `..`, NO CALLER SEGMENT, NO CREATION. Both files are the root joined with two frozen
    /// segments. `.projectops` must already exist as a real directory: a root without one is not a
    /// governed project, and creating it would manufacture the fact that is missing.
    fn resolve(root: &Path) -> Result<Self, LedgerRefusal> {
        if !root.is_dir() {
            return Err(LedgerRefusal::ProjectRootUnavailable);
        }
        let projectops = root.join(GATEKEEPER_LEDGER_REL[0]);
        let meta =
            fs::symlink_metadata(&projectops).map_err(|_| LedgerRefusal::ProjectRootUnavailable)?;
        if meta.file_type().is_symlink() {
            return Err(LedgerRefusal::PathNotRegular);
        }
        if !meta.is_dir() {
            return Err(LedgerRefusal::ProjectRootUnavailable);
        }
        let ledger = projectops.join(GATEKEEPER_LEDGER_REL[1]);
        let mut pending = ledger.clone().into_os_string();
        pending.push(PENDING_SUFFIX);
        let paths = Self {
            lock: projectops.join(GATEKEEPER_LEDGER_LOCK_REL[1]),
            config: projectops.join(GATEKEEPER_CONFIG_REL[1]),
            pending: PathBuf::from(pending),
            ledger,
        };
        paths.check_each_path_is_ordinary()?;
        Ok(paths)
    }

    /// Every canonical path that EXISTS must be an ordinary file.
    ///
    /// One that does not exist yet is fine — the ledger is created on the first admission — and
    /// `create_new` is what decides the lock and the pending file.
    ///
    /// SEPARATED SO IT CAN BE RUN TWICE. [`CanonicalPaths::resolve`] necessarily runs before the lock
    /// is taken, because the lock's own path comes out of it; that leaves a window in which the
    /// paths it approved could be swapped before they are used. Re-running this INSIDE the lock does
    /// not close the window against an attacker who ignores the lock — nothing check-then-open can —
    /// but it removes the whole of the ordinary window, which is the part that spans a file creation
    /// and an `fsync`. What actually makes the write safe regardless is that neither the lock nor the
    /// pending file is ever opened in a mode that would follow a link. Raised by the ECC security
    /// review.
    fn check_each_path_is_ordinary(&self) -> Result<(), LedgerRefusal> {
        for path in [&self.ledger, &self.lock, &self.config, &self.pending] {
            if let Ok(meta) = fs::symlink_metadata(path) {
                if !meta.is_file() {
                    return Err(LedgerRefusal::PathNotRegular);
                }
            }
        }
        Ok(())
    }
}

/// Read a whole file through a hard byte bound, or refuse.
///
/// `take(MAX + 1)` so at most one byte beyond the limit is ever allocated: an oversized file is
/// REFUSED, not truncated and used, and not read into memory first to find that out.
fn read_bounded(path: &Path, max: u64, absent: Option<String>) -> Result<String, LedgerRefusal> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return absent.ok_or(LedgerRefusal::ConfigUnavailable);
        }
        Err(_) => return Err(LedgerRefusal::LedgerUnreadable),
    };
    let mut text = String::new();
    let read = file.take(max + 1).read_to_string(&mut text);
    match read {
        Ok(_) if text.len() as u64 > max => Err(LedgerRefusal::LedgerOversize),
        Ok(_) => Ok(text),
        Err(_) => Err(LedgerRefusal::LedgerUnreadable),
    }
}

/// Read the canonical ledger under an already-held lock.
fn read_ledger_locked(paths: &CanonicalPaths) -> Result<LedgerDocument, LedgerRefusal> {
    let text = read_bounded(
        &paths.ledger,
        MAX_LEDGER_BYTES,
        // AN ABSENT LEDGER IS AN EMPTY ONE, which is the canonical reading and the only forgiving
        // case: a project that has never spent anything really has no record of spending. Every
        // other unreadable state refuses.
        Some(LedgerDocument::empty().render()?),
    )?;
    LedgerDocument::parse(&text)
}

/// Write the whole ledger atomically: a complete temporary file, then a rename over the target.
///
/// THE SAME CRASH-SAFE WRITE THE CANONICAL IMPLEMENTATION USES, and for the reason it records: the
/// first version of that code read the whole ledger and wrote it back over the same path, and a
/// crash between the two left the record of what had already been spent truncated — which does not
/// merely lose an audit line, it re-opens the budget. A reader sees either the old complete ledger or
/// the new complete ledger, never a partial one.
///
/// The temporary file is in the SAME DIRECTORY, because a rename across volumes is a copy and a copy
/// is the non-atomic write this is replacing.
fn write_ledger_locked(
    paths: &CanonicalPaths,
    document: &LedgerDocument,
) -> Result<(), LedgerRefusal> {
    let rendered = document.render()?;
    let temporary = &paths.pending;

    // THE COMPANION PATH IS A WRITE TARGET, AND IT WAS THE ONE THIS CRATE DID NOT DEFEND.
    //
    // It used to be opened with `File::create`, which is create-or-truncate and FOLLOWS whatever is
    // already at the name. Anything that can write inside `.projectops` — which is exactly what this
    // Host's threat model grants the adversary — could therefore plant `<ledger>.tmp` in advance and
    // redirect every subsequent admission's write. Two variants, both real: a HARD LINK, which needs
    // no privilege at all on NTFS and makes the Host overwrite the linked file's contents; and a
    // SYMLINK, where the following `rename` moves the LINK itself onto the ledger's name, so that
    // from then on the canonical ledger IS a link the attacker controls — and if its target does not
    // exist, the next read finds the ledger absent and reads it as an EMPTY BUDGET. That is the exact
    // outcome this whole module exists to make impossible.
    //
    // REMOVE THE NAME, THEN DEMAND CREATE_NEW. Removing deletes only the directory entry — a hard
    // link's victim keeps its data, a symlink's target is untouched — and `create_new` refuses to
    // open ANYTHING that already exists, including a link re-planted in the gap. So the write either
    // happens into a file this call created, or it does not happen. Raised by the ECC security
    // review.
    let _ = fs::remove_file(temporary);
    // FLUSHED TO THE DEVICE BEFORE THE RENAME. Without it a crash can leave the rename durable and
    // the contents not, which is the one ordering that produces an empty-looking ledger — the state
    // this whole path exists to make impossible.
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary)
        .and_then(|mut file| {
            std::io::Write::write_all(&mut file, rendered.as_bytes())?;
            file.sync_all()
        });
    if written.is_err() {
        let _ = fs::remove_file(temporary);
        return Err(LedgerRefusal::WriteFailed);
    }
    if fs::rename(temporary, &paths.ledger).is_err() {
        // The rename failed, so the temporary file is the only complete copy and the original is
        // intact. Falling back to a direct overwrite would reintroduce exactly the window being
        // closed, so it is left in place and named in the refusal's documentation.
        return Err(LedgerRefusal::WriteFailed);
    }
    Ok(())
}

/// LOCK → READ FRESH → RESOLVE POLICY → CHECK BOTH CEILINGS → RESERVE → WRITE → UNLOCK.
///
/// One transaction, and it is the whole of §10D's claim. Nothing between the read and the write lets
/// go of the lock, so two callers cannot observe the same remaining capacity: whoever takes the lock
/// second reads a ledger that already carries the first one's reservation at its estimate, and is
/// refused by the same hard stop. That is exactly the canonical `admitGatekeeperSpend` transaction,
/// against the same file, under the same lock.
///
/// # Errors
/// [`LedgerRefusal`] naming the gate that refused. An unknown cost refuses before anything is read;
/// a held lock refuses without waiting; an unenforceable policy refuses; either ceiling refuses; a
/// malformed or oversize ledger refuses; and every refusal leaves the ledger exactly as it was.
pub fn admit_spend(
    root: &Path,
    request: &AdmissionRequest<'_>,
) -> Result<AdmittedReservation, LedgerRefusal> {
    // FREE REFUSALS FIRST, before a lock is taken or a file is opened. An unknown cost cannot become
    // admissible by anything below, and an id that could never address a record cannot be settled or
    // released later, so admitting one would create a reservation nobody could ever clear.
    check_request_id(request.request_id)?;
    check_label(request.project_id)?;
    check_label(request.phase_id)?;
    check_label(request.model)?;
    let cost = request.cost_micro_usd.ok_or(LedgerRefusal::CostUnknown)?;
    let at = LedgerInstant::from_epoch_s(request.at_epoch_s)
        .map_err(|_| LedgerRefusal::InstantUnrepresentable)?;

    let paths = CanonicalPaths::resolve(root)?;
    let lock = lock::LedgerLock::take(&paths.lock, at.as_str())?;

    let admitted = (|| {
        // THE PATHS ARE RE-CHECKED NOW THAT THE LOCK IS HELD — see
        // `CanonicalPaths::check_each_path_is_ordinary`.
        paths.check_each_path_is_ordinary()?;
        // THE POLICY IS READ INSIDE THE LOCK, so the ceiling a decision is taken against is the one
        // in force at the moment of the decision rather than one loaded at start-up.
        let config = read_bounded(&paths.config, MAX_CONFIG_BYTES, None)
            .map_err(|_| LedgerRefusal::ConfigUnavailable)?;
        let policy = policy::resolve(&config)?;

        let mut document = read_ledger_locked(&paths)?;

        // ONE QUESTION, ONE RESERVATION. Any existing entry under this id refuses — see
        // `LedgerRefusal::AlreadyReserved` for why the Host refuses in both canonical cases.
        if document.find(request.request_id).is_some() {
            return Err(LedgerRefusal::AlreadyReserved);
        }
        if document.outstanding_count() >= MAX_OUTSTANDING_RESERVATIONS {
            return Err(LedgerRefusal::OutstandingReservationsExhausted);
        }

        let snapshot = document.month_total_micro_usd(at.month())?;
        // A MONTH ALREADY AT THE HARD STOP ADMITS NOTHING, including a zero-cost call. The canonical
        // `evaluateBudget` returns STOPPED on `spent >= hardStop` before any estimate is considered,
        // and this reproduces that rather than only checking the projection.
        if snapshot >= policy.hard_stop_micro_usd() {
            return Err(LedgerRefusal::HardStopExceeded);
        }
        let projected = snapshot
            .checked_add(cost)
            .ok_or(LedgerRefusal::ArithmeticOverflow)?;
        // BOTH CONTROLS, NEITHER REPLACING THE OTHER, AND THE LOWER OF THE TWO BINDS. The
        // installation's hard stop answers "can this installation afford it?"; the owner's
        // delegation ceiling answers "did the owner permit this programme that much?".
        if projected > policy.hard_stop_micro_usd() {
            return Err(LedgerRefusal::HardStopExceeded);
        }
        if projected > request.delegation_ceiling_micro_usd {
            return Err(LedgerRefusal::CeilingExceeded);
        }

        document.entries.push(LedgerEntry {
            request_id: request.request_id.to_owned(),
            project_id: request.project_id.to_owned(),
            phase_id: request.phase_id.to_owned(),
            model: request.model.to_owned(),
            usage: TokenUsage::none_yet(),
            cost_micro_usd: cost,
            // MARKED THE MOMENT IT IS WRITTEN. The canonical implementation learned this the hard
            // way: marking from a later step left a bare reservation behind whenever anything
            // stopped the process reaching it.
            unresolved: Some(true),
            at: at.as_str().to_owned(),
        });
        write_ledger_locked(&paths, &document)?;

        Ok(AdmittedReservation {
            request_id: request.request_id.to_owned(),
            cost_micro_usd: cost,
            spend_snapshot_micro_usd: snapshot,
            delegation_ceiling_micro_usd: request.delegation_ceiling_micro_usd,
            hard_stop_micro_usd: policy.hard_stop_micro_usd(),
        })
    })();

    drop(lock);
    admitted
}

/// A charge was actually incurred: replace the reservation with the call that happened.
///
/// REPLACEMENT, NEVER AN APPEND, which is the canonical `settleGatekeeperSpend` rule and its reason:
/// deduplication keeps the FIRST entry per request id, so an appended truth would sit behind the
/// estimate and never be counted.
///
/// EXACTLY ONCE. The entry must be an outstanding reservation. A settled entry refuses
/// ([`LedgerRefusal::AlreadySettled`]) and an absent one refuses
/// ([`LedgerRefusal::ReservationNotOutstanding`]) — which together make double commit, commit after
/// release and the settlement of somebody else's reservation all impossible.
///
/// # Errors
/// [`LedgerRefusal`] naming the gate that refused.
pub fn commit_reservation(
    root: &Path,
    request_id: &str,
    settlement: &SettledProviderCall,
    at_epoch_s: u64,
) -> Result<(), LedgerRefusal> {
    check_request_id(request_id)?;
    let usage = TokenUsage {
        input_tokens: settlement.input_tokens,
        cached_input_tokens: settlement.cached_input_tokens,
        output_tokens: settlement.output_tokens,
    };
    if !usage.is_a_call() {
        return Err(LedgerRefusal::SettlementRecordsNoCall);
    }
    settle(
        root,
        request_id,
        Some((usage, settlement.cost_micro_usd)),
        at_epoch_s,
    )
}

/// No provider effect happened: give the capacity back.
///
/// THE NARROW RELEASE, and the caller must know that nothing was dispatched. The canonical
/// implementation is emphatic about the asymmetry: real spend must never disappear because a reply
/// was lost, so a call that MAY have been dispatched keeps its reservation, and only a cause that
/// PROVES nothing was sent releases it. This function performs the release; deciding that it is safe
/// is the caller's, and in the Host that decision is made in one place — the composition releases a
/// reservation exactly when it is about to refuse the request before anything could execute.
///
/// EXACTLY ONCE, and never over a call: an entry carrying usage refuses
/// ([`LedgerRefusal::AlreadySettled`]), so a real charge can never be erased by a release, and a
/// second release of the same reservation refuses because the first removed it.
///
/// # Errors
/// [`LedgerRefusal`] naming the gate that refused.
pub fn release_reservation(
    root: &Path,
    request_id: &str,
    at_epoch_s: u64,
) -> Result<(), LedgerRefusal> {
    check_request_id(request_id)?;
    settle(root, request_id, None, at_epoch_s)
}

/// The shared body of commit and release: lock, read fresh, find the OUTSTANDING reservation,
/// replace or remove it, write, unlock.
fn settle(
    root: &Path,
    request_id: &str,
    outcome: Option<(TokenUsage, u64)>,
    at_epoch_s: u64,
) -> Result<(), LedgerRefusal> {
    // THE LOCK RECORDS WHEN IT WAS TAKEN, AND IT MUST BE A REAL TIME. Settlement used to stamp the
    // literal word "settlement" into `heldSince`. Nothing parses that field — but a person reading a
    // stuck lock does, and a diagnostic that says something untrue is worse than one that says
    // nothing. The reading is the Host's sealed clock, the same one the admission stamps its entry
    // with.
    let at = LedgerInstant::from_epoch_s(at_epoch_s)
        .map_err(|_| LedgerRefusal::InstantUnrepresentable)?;
    let paths = CanonicalPaths::resolve(root)?;
    let lock = lock::LedgerLock::take(&paths.lock, at.as_str())?;

    let settled = (|| {
        paths.check_each_path_is_ordinary()?;
        let mut document = read_ledger_locked(&paths)?;
        let index = document
            .entries
            .iter()
            .position(|e| e.request_id == request_id)
            .ok_or(LedgerRefusal::ReservationNotOutstanding)?;
        if document.entries[index].usage.is_a_call() {
            return Err(LedgerRefusal::AlreadySettled);
        }
        match outcome {
            Some((usage, cost_micro_usd)) => {
                let existing = &document.entries[index];
                document.entries[index] = LedgerEntry {
                    request_id: existing.request_id.clone(),
                    project_id: existing.project_id.clone(),
                    phase_id: existing.phase_id.clone(),
                    model: existing.model.clone(),
                    usage,
                    cost_micro_usd,
                    // THE MARK IS CLEARED BY REPLACEMENT, not by being set to false: the canonical
                    // settled entry carries no `unresolved` key at all, and an entry that carried
                    // `"unresolved": false` would not be the record the agent writes.
                    unresolved: None,
                    // THE ORIGINAL INSTANT IS KEPT, so a call is accounted to the month it was
                    // admitted in. Re-stamping it at settlement would move spend across a month
                    // boundary and make the hard stop apply to a month that did not incur it.
                    at: existing.at.clone(),
                };
            }
            None => {
                document.entries.remove(index);
            }
        }
        write_ledger_locked(&paths, &document)
    })();

    drop(lock);
    settled
}

/// The canonical ledger, read for EVIDENCE.
///
/// NOT AN AUTHORITY ROUTE, and the distinction is the whole design of the sealed
/// `CanonicalBudgetLedger` trait: a caller that can read a figure can act on it, and two callers
/// acting on one figure is how two requests come to be admitted against one budget. Nothing in the
/// Host's budget path calls this — the decision is taken inside [`admit_spend`], under the lock,
/// from a read nobody else can interleave with. It exists so an operator tool, a test or a report can
/// show what the record says.
///
/// # Errors
/// [`LedgerRefusal`] for a root, a path or a document that is not canonical.
pub fn read_ledger_for_evidence(root: &Path) -> Result<LedgerDocument, LedgerRefusal> {
    let paths = CanonicalPaths::resolve(root)?;
    read_ledger_locked(&paths)
}

#[cfg(test)]
mod tests;
