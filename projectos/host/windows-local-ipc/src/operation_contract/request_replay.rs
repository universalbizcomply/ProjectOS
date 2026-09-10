//! RUN-TO-COMPLETION HOST ATTESTATION §10C — DURABLE REQUEST REPLAY.
//!
//! ## The invariant this module exists to hold
//!
//! A PREVIOUSLY CONSUMED GOVERNED REQUEST MUST NOT BECOME FRESH AGAIN MERELY BECAUSE PROJECTOSHOST
//! RESTARTED.
//!
//! §9A already refuses a replay WITHIN one live `BoundIpcSession`: the `RequestAdmissionStore`
//! remembers correlations and requires the sequence to advance, and it refuses rather than evicting.
//! That is complete for the life of a connection, and it survives nothing. The host may restart;
//! when it does, every one of those facts is gone, and every field the caller and the transport use
//! to distinguish requests is REGENERATED:
//!
//! * the connection identity and handshake generation are drawn from a process-unique counter, so a
//!   new process starts a new space;
//! * the session digest is derived from the runtime instance, the connection and the handshake, so
//!   it is new too;
//! * the service epoch is, by definition, per service instance;
//! * the correlation and the sequence are the CALLER'S, and it may pick whatever it likes.
//!
//! So after a restart there is nothing left in §9A's model for a replayed request to collide with.
//! That is not a defect in §9A — an in-memory history is exactly what it says it is — it is the gap
//! this module closes, and it closes it with a durable fact rather than by changing what admission
//! means.
//!
//! ## The identity, and why it is these three fields
//!
//! [`RequestReplayIdentity`] is a SHA-256 over the delegation id, the Host's binding digest and the
//! Host's parameter digest. Every one of them is resolved by the HOST and survives a restart:
//!
//! * `delegation_id` — the owner-signed programme grant this request runs under. It comes off the
//!   VERIFIED delegation, never off the request; the frame's approval reference has to equal it or
//!   the evaluator refuses. Including it is what keeps a genuinely NEW owner grant able to authorise
//!   work an older, ended grant already consumed: replay is scoped to the grant, so this is not a
//!   global blacklist that ends the programme.
//! * `binding_digest` — the canonical Host digest over project, repository, plan, plan digest,
//!   phase, candidate digest, operation class, model policy and credential reference. §9B chose its
//!   contents precisely: volatile values (clock, spend, cost, service epoch) are deliberately NOT in
//!   it, because "a digest that changes every second is a replay proof nobody can write down". That
//!   sentence is the property §10C needs, and this module reuses that subject rather than inventing
//!   a second one.
//! * `parameter_digest` — the digest of the exact one-shot inbox body the Host read for this
//!   request. Two requests that agree on everything above but ask different things are different
//!   work, and both must be able to run.
//!
//! ## And why the other fields are absent
//!
//! Naming any of them would reopen the gap:
//!
//! * `correlation` — 16 caller-chosen bytes. A replayer picks a new one for free.
//! * `sequence` — caller-chosen and session-scoped; it restarts at zero with the history.
//! * `connection_id` / `handshake_generation` / session digest — host-issued, but regenerated per
//!   connection AND per process. A replayer obtains new ones simply by reconnecting.
//! * `service_epoch` — different in every service instance. Including it would make EVERY request
//!   fresh after a restart, which is the exact bug.
//!
//! ## What a stored byte can and cannot do
//!
//! It can refuse, and it can never authorise. A record's presence refuses; its absence authorises
//! NOTHING — every §9 gate still stands in front of any effect. There is no state word meaning "not
//! consumed", so there is no durable value anyone can write to make a consumed request fresh again:
//! freshness is the ABSENCE of a record.
//!
//! ## Not in this checkpoint
//!
//! The production mint of [`durable_store::HostOwnedRequestReplayRoot`] is deliberately ABSENT, for
//! the reason §10B's is: resolving the real ProgramData state root is installation composition, and
//! fabricating it from an environment variable, the working directory or a request field would be
//! inventing installation truth. A default build therefore constructs no root, opens no store, and
//! the composition refuses because it has no ledger to consult. No compaction is implemented;
//! capacity REFUSES.

use sha2::{Digest, Sha256};

use super::{
    HostResolvedRequestFacts, OperationClass, VerifiedOwnerProgrammeDelegation, BINDING_DIGEST_LEN,
    DELEGATION_DIGEST_LEN,
};

pub mod durable_store;

/// The domain tag for the governed request-replay identity. Distinct from the binding-digest domain,
/// so a binding digest can never be mistaken for — or collide with — a replay identity.
pub const REPLAY_IDENTITY_DOMAIN: &[u8; 32] = b"projectos.host-request-replay.v1";

/// The replay-identity schema version. A change to WHICH fields compose the identity must change
/// this, because the same governed work would otherwise hash differently and read back fresh.
pub const REPLAY_IDENTITY_SCHEMA_VERSION: u32 = 1;

/// The width of a governed request-replay identity.
pub const REPLAY_IDENTITY_LEN: usize = 32;

/// Why a governed request did not pass the durable replay gate. FIELDLESS: no variant carries a
/// path, an identity, a raw OS message or any persisted byte, so a refusal cannot leak the history
/// it is refusing over.
///
/// EVERY VARIANT IS A REFUSAL. There is deliberately no variant meaning "could not tell, carry on".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReplayRefusal {
    /// This governed request identity has already been consumed. The §10C refusal.
    AlreadyConsumed,
    /// The Host's own state root could not be prepared or is not a usable directory.
    StateRootUnusable,
    /// The durable engine refused to open: contention, corruption, or required reconciliation.
    StoreUnavailable,
    /// The durable history could not be read or decoded, so freshness could not be established.
    HistoryUnreadable,
    /// The store is at its record bound. Refused; nothing is evicted.
    CapacityExhausted,
    /// The write was refused before any durable effect, so consumption is not established.
    WriteRefused,
    /// §10I: the history's filesystem custody could not be established, or an object in it does not
    /// carry the committed owner and DACL. Nothing was opened, and nothing was re-secured.
    CustodyRefused,
}

/// The identity of one GOVERNED REQUEST, as the Host resolved it — restart-stable by construction.
///
/// OPAQUE, AND NOT CALLER-SUPPLIABLE. The digest is private and there is no public constructor
/// taking bytes: the only way to obtain one is [`Self::for_request`], which reads the delegation id
/// from a SEALED [`VerifiedOwnerProgrammeDelegation`] and the binding and parameter digests from a
/// SEALED [`HostResolvedRequestFacts`]. A caller who could hand in an identity could hand in one
/// that has never been consumed, and replay under it.
///
/// `Copy` and `Eq` are deliberate and safe: this is a comparison key, not an authority. Copying a
/// question grants nothing, and the gate that answers it is sealed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RequestReplayIdentity {
    digest: [u8; REPLAY_IDENTITY_LEN],
}

impl RequestReplayIdentity {
    /// Derive the replay identity for ONE request from the Host's own sealed answers.
    ///
    /// `operation` is folded in THROUGH the binding digest rather than beside it: the binding
    /// subject already carries the operation class, and hashing it twice would be a second, weaker
    /// statement of the same fact plus a chance for the two to disagree.
    ///
    /// THE REQUEST IS NOT AN ARGUMENT. Nothing a caller sent contributes a byte. The frame's
    /// binding digest, approval reference and parameter digest are CLAIMS, and the evaluator refuses
    /// the request outright when they differ from these facts; deriving the identity from those
    /// claims instead would let a replayer choose which history entry it collides with.
    #[must_use]
    pub fn for_request(
        delegation: &VerifiedOwnerProgrammeDelegation,
        facts: &HostResolvedRequestFacts,
        operation: OperationClass,
    ) -> Self {
        // BOTH READ OFF THE SEALED FACTS, through the parent module's own private items rather than
        // through a public accessor: this module is a CHILD of `operation_contract`, so it can see
        // them, and no new public surface is opened on a closed §9B type to make persistence easier.
        Self::over(
            &delegation.delegation().delegation_id,
            &facts.expected_binding_digest(operation),
            &facts.parameter_digest,
        )
    }

    /// FIXTURE ONLY: an identity over explicitly NAMED parts, for proofs that need two identities
    /// differing in exactly one field.
    ///
    /// It takes the parts rather than a digest, so even the fixture cannot declare an arbitrary
    /// identity that no set of Host facts could ever produce.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_over(
        delegation_id: &[u8; DELEGATION_DIGEST_LEN],
        binding_digest: &[u8; BINDING_DIGEST_LEN],
        parameter_digest: &[u8; BINDING_DIGEST_LEN],
    ) -> Self {
        Self::over(delegation_id, binding_digest, parameter_digest)
    }

    /// THE ONE canonical derivation, so the production route and the fixture cannot drift apart and
    /// silently stop hashing the same governed request to the same identity.
    fn over(
        delegation_id: &[u8; DELEGATION_DIGEST_LEN],
        binding_digest: &[u8; BINDING_DIGEST_LEN],
        parameter_digest: &[u8; BINDING_DIGEST_LEN],
    ) -> Self {
        let mut h = Sha256::new();
        h.update(REPLAY_IDENTITY_DOMAIN);
        h.update(REPLAY_IDENTITY_SCHEMA_VERSION.to_be_bytes());
        h.update(delegation_id);
        h.update(binding_digest);
        h.update(parameter_digest);
        Self {
            digest: h.finalize().into(),
        }
    }

    /// The identity bytes, for storage keying and comparison only.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; REPLAY_IDENTITY_LEN] {
        &self.digest
    }
}

/// The private supertrait that seals [`RequestReplayLedger`].
mod replay_seal {
    /// Unnameable outside this crate, so the trait below cannot be implemented downstream.
    pub trait Sealed {}
}

/// THE HOST'S OWN DURABLE RECORD of which governed requests it has already consumed.
///
/// SEALED, AND THAT IS THE WHOLE DESIGN. If a downstream crate could implement this it could answer
/// "fresh" for every identity it liked, and the restart protection would be worth nothing. Sealing
/// it means "has this governed request already been consumed?" is not a question a caller gets to
/// answer about itself.
///
/// ## ONE METHOD, ON PURPOSE
///
/// There is no `is_consumed` beside [`Self::consume`], and adding one would be a defect rather than
/// a convenience. A separate read and write is a time-of-check-to-time-of-use window by
/// construction: two attempts could each read "fresh" before either wrote. Worse, it would be a
/// SECOND replay path to keep in step with this one — a caller could consult the reader, like the
/// answer, and never take the gate at all. Check and mark are therefore ONE transition, decided
/// inside the implementation, under whatever exclusion that implementation holds.
pub trait RequestReplayLedger: replay_seal::Sealed {
    /// Establish that this governed request identity is FRESH and durably record it as consumed —
    /// as one transition — or refuse.
    ///
    /// AT MOST ONE CALLER MAY SUCCEED for a given identity, ever: across restarts, and across
    /// processes contending for the same state root.
    ///
    /// FAIL CLOSED. An unavailable store, an unreadable record, an exhausted capacity and a refused
    /// write are all refusals. No implementation may interpret an inability to establish the history
    /// as freshness, and none may evict an existing record to make room.
    ///
    /// # Errors
    /// [`ReplayRefusal::AlreadyConsumed`] when the identity is already recorded; another
    /// [`ReplayRefusal`] naming the condition that prevented the transition.
    fn consume(
        &mut self,
        identity: &RequestReplayIdentity,
    ) -> Result<ConsumedRequest, ReplayRefusal>;
}

/// Evidence that ONE governed request identity crossed the durable replay gate, exactly here.
///
/// Opaque: private field, no public constructor, no `Default`, no `Clone`, no serde, redacted
/// `Debug`. Not `Clone` for the reason an admission is not: this answers one request, and handing
/// out copies is how one consumption comes to back several.
///
/// ## What it does NOT say
///
/// It says the Host took replay authority for this identity. It does NOT say the request was
/// admitted, authorised, executed, completed or billed — AUTHORISED IS NOT EXECUTED, and CONSUMED is
/// weaker than either. It carries no capability and mints nothing: it cannot become an
/// `AdmittedRequest`, an [`AuthorisedProtectedOperation`](super::AuthorisedProtectedOperation), a
/// [`TrustedPeerContext`](super::TrustedPeerContext) or an owner presence, because it has no
/// conversion at all.
pub struct ConsumedRequest {
    identity: RequestReplayIdentity,
}

impl core::fmt::Debug for ConsumedRequest {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ConsumedRequest([REDACTED])")
    }
}

impl ConsumedRequest {
    /// Whether this evidence answers exactly this identity.
    #[must_use]
    pub fn answers(&self, identity: &RequestReplayIdentity) -> bool {
        self.identity == *identity
    }
}

/// The mint of [`ConsumedRequest`], private to this subtree.
///
/// The production store lives in the `durable_store` child module and can therefore reach it;
/// nothing else in the crate can. So the evidence that a request crossed the gate is minted only by
/// an implementation of the sealed ledger.
fn consumed(identity: RequestReplayIdentity) -> ConsumedRequest {
    ConsumedRequest { identity }
}

/// FIXTURE ONLY: an in-memory ledger, for proofs about ORDERING and composition rather than about
/// durability.
///
/// IT IS NOT A STAND-IN FOR THE REAL STORE, and no proof of restart safety may use it — an
/// in-memory ledger forgets on restart, which is the precise failure §10C exists to close. The
/// restart, crash, concurrency and corruption proofs all drive
/// [`durable_store::DurableRequestReplayFileStore`] against real bytes in a disposable directory.
#[cfg(any(test, feature = "test-fixtures"))]
#[derive(Debug, Default)]
pub struct FixtureRequestReplayLedger {
    consumed: Vec<[u8; REPLAY_IDENTITY_LEN]>,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl FixtureRequestReplayLedger {
    /// An empty in-memory ledger.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            consumed: Vec::new(),
        }
    }

    /// How many identities this ledger has recorded. Diagnostics only; it grants nothing.
    #[must_use]
    pub fn recorded(&self) -> usize {
        self.consumed.len()
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl replay_seal::Sealed for FixtureRequestReplayLedger {}

#[cfg(any(test, feature = "test-fixtures"))]
impl RequestReplayLedger for FixtureRequestReplayLedger {
    fn consume(
        &mut self,
        identity: &RequestReplayIdentity,
    ) -> Result<ConsumedRequest, ReplayRefusal> {
        if self.consumed.iter().any(|c| c == identity.as_bytes()) {
            return Err(ReplayRefusal::AlreadyConsumed);
        }
        self.consumed.push(*identity.as_bytes());
        Ok(consumed(*identity))
    }
}

/// TEST-ONLY: a ledger that refuses with a chosen condition, touching no storage, and counts how
/// many times it was asked.
///
/// `cfg(test)`, so it exists in NO shipped graph — not the default build and not the fixture build.
/// It proves that the COMPOSITION refuses on each replay condition and releases what it reserved.
/// That is a property of the caller, and the real store cannot be made to exhibit every variant
/// without corrupting real bytes once per variant.
#[cfg(all(test, feature = "test-fixtures"))]
#[derive(Debug)]
pub(crate) struct RefusingReplayLedger {
    refusal: ReplayRefusal,
    asked: usize,
}

#[cfg(all(test, feature = "test-fixtures"))]
impl RefusingReplayLedger {
    pub(crate) fn always(refusal: ReplayRefusal) -> Self {
        Self { refusal, asked: 0 }
    }
    pub(crate) fn asked(&self) -> usize {
        self.asked
    }
}

#[cfg(all(test, feature = "test-fixtures"))]
impl replay_seal::Sealed for RefusingReplayLedger {}

#[cfg(all(test, feature = "test-fixtures"))]
impl RequestReplayLedger for RefusingReplayLedger {
    fn consume(
        &mut self,
        _identity: &RequestReplayIdentity,
    ) -> Result<ConsumedRequest, ReplayRefusal> {
        self.asked += 1;
        Err(self.refusal)
    }
}

/// TEST-ONLY: a ledger that records nothing and answers FRESH to everything.
///
/// `cfg(test)`. It is the NEGATIVE CONTROL: it proves that a ledger which always says fresh really
/// does let the same governed request through twice, so the positive proofs are known to be testing
/// this gate rather than some other refusal further down.
#[cfg(all(test, feature = "test-fixtures"))]
#[derive(Debug, Default)]
pub(crate) struct AlwaysFreshReplayLedger;

#[cfg(all(test, feature = "test-fixtures"))]
impl replay_seal::Sealed for AlwaysFreshReplayLedger {}

#[cfg(all(test, feature = "test-fixtures"))]
impl RequestReplayLedger for AlwaysFreshReplayLedger {
    fn consume(
        &mut self,
        identity: &RequestReplayIdentity,
    ) -> Result<ConsumedRequest, ReplayRefusal> {
        Ok(consumed(*identity))
    }
}

#[cfg(test)]
mod tests;
