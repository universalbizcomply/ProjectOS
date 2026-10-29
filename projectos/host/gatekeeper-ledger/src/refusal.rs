//! Why the canonical transaction refused. Every variant is a refusal; there is no warning.

use std::fmt;

/// Which of the installation's own spending caps one request would cross.
///
/// EVERY CROSSED CAP, NOT THE FIRST. The canonical `authoriseRequestSpend` names each bound a call
/// would cross so the owner can see which limit stopped it, and this is the same answer without the
/// figures — `Copy` and textless like the refusal that carries it, so no amount, path or id leaves
/// the transaction. Only [`admit_spend`](crate::admit_spend) constructs one, and never with the phase
/// and the day both clear (a month-only crossing keeps its own name, [`LedgerRefusal::HardStopExceeded`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrossedCaps {
    phase: bool,
    day: bool,
    month: bool,
}

impl CrossedCaps {
    /// The refusal for this set of crossings, or `None` when nothing was crossed.
    ///
    /// THE MONTH ALONE STAYS `HardStopExceeded`, because that is the word the Host's own budget
    /// vocabulary and every caller already use for it, and the month is the only cap whose crossing
    /// meant anything before the per-phase and per-day caps existed.
    pub(crate) fn refusal(phase: bool, day: bool, month: bool) -> Option<LedgerRefusal> {
        match (phase, day, month) {
            (false, false, false) => None,
            (false, false, true) => Some(LedgerRefusal::HardStopExceeded),
            _ => Some(LedgerRefusal::CapsExceeded(Self { phase, day, month })),
        }
    }
    /// The request would cross the per-phase cap.
    #[must_use]
    pub fn phase(&self) -> bool {
        self.phase
    }
    /// The request would cross the per-day cap.
    #[must_use]
    pub fn day(&self) -> bool {
        self.day
    }
    /// The request would also cross the month's hard stop.
    #[must_use]
    pub fn month(&self) -> bool {
        self.month
    }
}

impl fmt::Display for CrossedCaps {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let named: Vec<&str> = [
            (self.phase, "the per-phase cap"),
            (self.day, "the per-day cap"),
            (self.month, "the installation's hard stop"),
        ]
        .into_iter()
        .filter_map(|(crossed, name)| crossed.then_some(name))
        .collect();
        f.write_str(&named.join(", "))
    }
}

/// Why the canonical ledger transaction refused.
///
/// EVERY VARIANT MEANS NOTHING WAS ADMITTED AND NOTHING WAS SPENT. They are separate variants
/// because they need separate answers from an operator: a held lock clears by itself, a malformed
/// ledger needs a person, and an exceeded ceiling needs the owner.
///
/// `Copy` because the Host's own [`BudgetRefusal`](../../windows_local_ipc) carries one by value and
/// that enum is `Copy`; it holds no text, so a refusal can never carry a path, an id or a figure out
/// of the transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LedgerRefusal {
    /// The project root is not a directory, or has no `.projectops` directory.
    ///
    /// NOT CREATED. This crate never manufactures a governed project's directories: a root without
    /// `.projectops` is not a governed project, and creating one would be inventing the very fact
    /// that is missing.
    ProjectRootUnavailable,
    /// The ledger, the lock or a directory on the way to them is a link or a reparse point.
    ///
    /// STRICTER THAN THE CANONICAL IMPLEMENTATION, DELIBERATELY. Node's `writeFileSync` follows a
    /// symlink, so a link planted at the ledger path would redirect the Host's write — and with it
    /// the only record of what has been spent — somewhere the owner never looks. The canonical
    /// implementation runs inside a checkout the implementer already controls, so it gains nothing
    /// by checking; the Host is a trust boundary and does.
    PathNotRegular,
    /// The ledger file could not be read, although it exists.
    LedgerUnreadable,
    /// The ledger file is larger than [`MAX_LEDGER_BYTES`](crate::MAX_LEDGER_BYTES).
    LedgerOversize,
    /// The ledger is not the canonical document, or an entry is not a canonical entry.
    ///
    /// INCLUDES AN ENTRY CARRYING A FIELD THIS MODEL DOES NOT KNOW. Rewriting the file would drop
    /// that field, and silently discarding part of the record of what was spent is worse than
    /// refusing to spend.
    LedgerMalformed,
    /// The ledger holds more than [`MAX_LEDGER_ENTRIES`](crate::MAX_LEDGER_ENTRIES) entries.
    TooManyEntries,
    /// Another process holds the canonical ledger lock. Transient: it clears when that process
    /// finishes. Nothing is waited for and nothing is stolen.
    LockHeld,
    /// The lock could not be created at all, so no admission could be serialised.
    LockUnavailable,
    /// The gatekeeper configuration is absent, unreadable or larger than
    /// [`MAX_CONFIG_BYTES`](crate::MAX_CONFIG_BYTES).
    ConfigUnavailable,
    /// The configuration exists but does not carry an enforceable budget policy — a schema this
    /// crate does not know, a gatekeeper that is not enabled, auto-recharge on, a figure above the
    /// approved pilot without an owner decision authorising it, a warning threshold above the hard
    /// stop, or a hard stop that is not a usable amount.
    ///
    /// AN UNENFORCEABLE POLICY STOPS SPENDING, exactly as the canonical implementation has it.
    PolicyUnenforceable,
    /// The cost of this call could not be established. Never spent as zero.
    CostUnknown,
    /// A total, a projection or a settlement did not fit in the ledger's integer micro-USD.
    ArithmeticOverflow,
    /// The month's spend plus this cost would cross the installation's own hard stop — and no other
    /// cap. A crossing of the per-phase or per-day cap is [`LedgerRefusal::CapsExceeded`].
    HardStopExceeded,
    /// This cost would cross the per-phase cap (the phase's spend over the whole ledger) and/or the
    /// per-day cap (the account's spend on this UTC day), and possibly the month's hard stop as well.
    /// Every crossed cap is named.
    CapsExceeded(CrossedCaps),
    /// The month's spend plus this cost would cross the owner's delegation ceiling.
    CeilingExceeded,
    /// This request id already has an entry in the canonical ledger.
    ///
    /// COVERS BOTH CANONICAL CASES AND IS STRICTER THAN EITHER. A settled entry means the call
    /// happened and asking again would double-charge. An unresolved entry means a question was
    /// started and never answered, which the canonical implementation may re-ask ONLY when the
    /// installation's own broker record positively says the reviewer did not answer. The Host has no
    /// broker record, and "we do not know whether it was answered" is the canonical default, which
    /// refuses. So the Host refuses either way.
    AlreadyReserved,
    /// The ledger already holds [`MAX_OUTSTANDING_RESERVATIONS`](crate::MAX_OUTSTANDING_RESERVATIONS)
    /// unresolved reservations. Transient, and distinct from a ceiling: it clears when any in-flight
    /// request settles.
    OutstandingReservationsExhausted,
    /// No unresolved reservation with this request id is outstanding — never taken, already
    /// released, or held by a different ledger.
    ReservationNotOutstanding,
    /// The entry for this request id records usage, so the call already happened. A settled call is
    /// not settled again and is not released.
    AlreadySettled,
    /// The settlement offered records no usage at all, so it is not a call.
    ///
    /// THE CANONICAL LEDGER HAS NO WAY TO SAY "COMMITTED WITH NOTHING RECORDED". An entry carrying
    /// zero usage IS a reservation, by the canonical rule this crate reuses everywhere else — so
    /// writing one as a settlement would produce an entry that the agent's own release path is
    /// entitled to delete, silently erasing a charge that really was incurred. A commit must carry
    /// what the provider reported.
    SettlementRecordsNoCall,
    /// The request id is not one the canonical ledger can address as a record: it must match
    /// `^[A-Za-z0-9_-]{4,128}$`, the rule the canonical implementation already applies before an id
    /// is interpolated into a path.
    RequestIdMalformed,
    /// A project, phase or model label was empty, over-long or carried a control character.
    LabelMalformed,
    /// The clock reading could not be rendered as a canonical timestamp.
    InstantUnrepresentable,
    /// The ledger could not be replaced atomically. The previous ledger is unchanged.
    WriteFailed,
}

impl fmt::Display for LedgerRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let said = match self {
            Self::ProjectRootUnavailable => "the project root has no .projectops directory",
            Self::PathNotRegular => {
                "the canonical ledger path is not a regular file in a real directory"
            }
            Self::LedgerUnreadable => "the canonical ledger could not be read",
            Self::LedgerOversize => "the canonical ledger is larger than this Host will read",
            Self::LedgerMalformed => {
                "the canonical ledger is not the record this Host knows how to keep"
            }
            Self::TooManyEntries => {
                "the canonical ledger holds more entries than this Host will read"
            }
            Self::LockHeld => "another process is deciding gatekeeper spend",
            Self::LockUnavailable => "the canonical ledger lock could not be taken",
            Self::ConfigUnavailable => "the gatekeeper configuration could not be read",
            Self::PolicyUnenforceable => {
                "no gatekeeper call may be made against a budget that cannot be enforced"
            }
            Self::CostUnknown => {
                "the cost of this call could not be established, so it was not made"
            }
            Self::ArithmeticOverflow => "the ledger arithmetic overflowed",
            Self::HardStopExceeded => "this call would cross the installation's hard stop",
            Self::CapsExceeded(crossed) => return write!(f, "this call would cross {crossed}"),
            Self::CeilingExceeded => "this call would cross the owner's delegation ceiling",
            Self::AlreadyReserved => "this request already has an entry in the canonical ledger",
            Self::OutstandingReservationsExhausted => "too many reservations are already in flight",
            Self::ReservationNotOutstanding => "no such reservation is outstanding on this ledger",
            Self::AlreadySettled => "this request's call already happened",
            Self::SettlementRecordsNoCall => "the settlement offered records no call",
            Self::RequestIdMalformed => "the request id is not a safe ledger record name",
            Self::LabelMalformed => "a ledger label was empty, over-long or not printable",
            Self::InstantUnrepresentable => "the clock reading could not be rendered",
            Self::WriteFailed => "the canonical ledger could not be updated atomically",
        };
        f.write_str(said)
    }
}

impl std::error::Error for LedgerRefusal {}
