//! THE HOST'S OWN DURABLE REQUEST-REPLAY HISTORY — the production store.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10C.
//!
//! ## The invariant this file exists to hold
//!
//! A GOVERNED REQUEST THE HOST HAS ALREADY CONSUMED MUST NEVER BECOME FRESH AGAIN MERELY BECAUSE
//! THE HOST RESTARTED.
//!
//! §9A holds the same property for the life of ONE connection, in memory, and says so plainly. This
//! is the part that outlives the process.
//!
//! ## What it reuses rather than reinvents
//!
//! Everything mechanical, exactly as §10B does. [`DurableProtectedStore`] is the accepted durable
//! engine and it already owns: the single-writer OS advisory lock over the root, the
//! reparse-hardened bounded layout with path containment, SHA-256 framing that detects accidental
//! and unauthorised mutation, the private Prepared-to-Committed/Aborted journal, atomic
//! write-through replacement, journal-aware recovery of an interrupted write on open, monotonic
//! revisions, and optimistic `expected`-revision replacement. The persisted representation is the
//! accepted [`RequestReplayRecordDto`]. This module adds NO storage framework, NO journal state
//! machine, NO framing and NO lock of its own — it adds the REPLAY RULE, which is the only part the
//! engine cannot know.
//!
//! ## The replay rule, in one line
//!
//! CREATE IF ABSENT, REFUSE IF PRESENT — and never anything else. There is no update, no delete, no
//! reset and no compaction, because every one of them is a route from consumed back to fresh.
//!
//! ## Why a SEPARATE leaf from the delegation store
//!
//! The two answer different questions — "is this owner programme still Active?" and "has this
//! governed request already been consumed?" — and §10C keeps them apart deliberately. Sharing one
//! leaf would also share one engine and one exclusive OS lock, so a delegation read would serialise
//! behind a replay write for no reason, and a bug in either family's rules could reach the other's
//! bytes. Separate leaves also mean each can carry its own narrow ACE when the installer ACLs the
//! state root.
//!
//! ## Not in this checkpoint
//!
//! No live ProgramData directory is created or written. §10E added the composition that RESOLVES
//! the Host state root — see [`HostOwnedRequestReplayRoot::from_activated`] — but not the acceptance
//! that activates it, so a default build cannot construct a root, therefore cannot open a store,
//! therefore cannot supply a ledger — and the composition fails closed.
//!
//! ## THE DELETION BOUNDARY, MEASURED
//!
//! Freshness is the ABSENCE of a record. That is what makes it impossible to write a durable value
//! meaning "no longer consumed", and it is also what makes DELETION the attack this family is most
//! exposed to: removing a record makes that governed request fresh again. Anti-rollback rests on the
//! FUTURE restricted ProgramData ACL, not on anything here — an attacker who can already delete
//! protected files as SYSTEM is outside this checkpoint's boundary, and no local counter would
//! honestly change that, since the counter is a file at the same privilege level. §10B states the
//! same limit for the delegation family, where a deleted `Revoked` record resurrects a delegation.
//!
//! WHAT IS NEW HERE IS THE PRECISE SHAPE, because the engine does not behave uniformly and assuming
//! it did would have been the wrong thing to write down. Recovery compares the MAXIMUM surviving
//! record revision against the manifest, so removing the MOST RECENT record leaves the manifest
//! ahead and the whole history refuses to open, while removing an OLDER one leaves the maximum
//! unchanged and that one identity reads back fresh. Both cases are measured in the tests beside
//! this file rather than asserted from the comfortable assumption.
//!
//! §10I CLOSES THE ORDINARY-ACCOUNT HALF OF THAT BOUNDARY. Every object in this history is created
//! with the committed store descriptor — the service `Modify`, Administrators and SYSTEM full
//! control, nobody else — so an ordinary local account can neither delete nor rename a record, and a
//! history whose descriptor says otherwise is refused at open. The privileged half is unchanged: an
//! administrator or SYSTEM can still delete a record, and nothing at this level stops that.

use projectos_host_persistence::{RequestReplayRecordDto, RequestReplayStateDto, TargetFamilyDto};
use projectos_host_trusted_roots::{
    ActivatedHostStateRoot, HostStateStore, HostStoreCustody, TrustedRootRefusal,
};
use projectos_host_windows_durable_protected_store::{DurableProtectedStore, DurableStoreError};

use super::{
    consumed, replay_seal, ConsumedRequest, ReplayRefusal, RequestReplayIdentity,
    RequestReplayLedger, REPLAY_IDENTITY_LEN,
};
use crate::store_custody::{open_governed_store, GovernedOpenRefusal};

/// The ONE frozen leaf segment beneath the Host's own state root that holds replay history.
///
/// A single plain segment, like the delegation store's: it is the unit a narrow ACE can be applied
/// to, and a nested or caller-influenced path would be a second place to look for the Host's word on
/// whether a request has run.
///
/// §10I: SPELLED ONCE, by the store custody that creates and judges the directory.
pub const REQUEST_REPLAY_RELATIVE_ROOT: &str = HostStateStore::RequestReplay.segment();

/// The most consumed-request records one Host may hold.
///
/// JUSTIFIED, NOT ROUND, AND DELIBERATELY CONSERVATIVE. One record is created per GOVERNED request
/// the Host has actually taken authority for — each of which required an owner-signed delegation, a
/// one-shot inbox entry and budget under the owner's ceiling — so this bounds paid, governed work,
/// not anything a caller can drive for free.
///
/// TWO THINGS SET IT. First, no safe COMPACTION RULE is implemented in this checkpoint: an entry may
/// only be discarded once repository evidence proves it can never again be a valid replay, and the
/// boundary that would prove it (a delegation the Host has durably recorded as Revoked or Completed)
/// lives in a DIFFERENT record family which §10C deliberately does not couple to this one. Until
/// that is designed and ruled on, the honest bound is a low one that REFUSES. Second, establishing
/// freshness costs a directory scan per request, so the bound is also the per-request cost; keeping
/// it well under the engine's own 4096-record layout limit keeps that cost flat and leaves the
/// engine's limit as the engine's business.
///
/// EXHAUSTION REFUSES; IT NEVER EVICTS. Evicting the oldest entry is precisely how a replay window
/// reopens, and every entry here is terminal security history — there is no non-security record in
/// this family that could be discarded instead. Refusing new work is a governance condition the
/// owner can see and act on; evicting old work is a replay window nobody can see.
pub const MAX_REPLAY_RECORDS: usize = 512;

/// The most bytes one replay record may occupy.
///
/// The record is a schema version, a revision, 64 hex characters and one state word; a well-formed
/// one is under 160 bytes. 4 KiB is generous room for JSON whitespace and nothing else, and anything
/// larger is refused rather than parsed.
pub const MAX_REPLAY_RECORD_BYTES: usize = 4096;

/// THE HOST'S OWN STATE ROOT — a capability, not a path a caller may choose.
///
/// ## Why this type exists at all
///
/// If [`DurableRequestReplayFileStore::open`] took a path, any code that could call it could declare
/// its own empty directory authoritative and find EVERY governed request fresh — which is exactly
/// the attack the sealed ledger exists to prevent, re-introduced one level down. A fresh temporary
/// directory is a perfect replay oracle. The path therefore arrives as an already-trusted capability
/// with PRIVATE fields and no public constructor outside this module.
///
/// ## Where the production root comes from — §10E
///
/// The accepted Host persistence boundary is the ProjectOS ProgramData root, and resolving it for
/// real is installation composition: the approved Known Folder anchor, the installed layout beneath
/// it and the restricted ACL that makes the directory mean anything are owned by the installer
/// chain, not by this crate. Fabricating a root here — from an environment variable, the working
/// directory, a literal, or a request field — would be inventing installation truth, and every one
/// of those sources is attacker-influencable in exactly the situation the store is meant to survive.
///
/// §10C therefore shipped the STORE, complete and proven, and left the root as the narrow
/// fail-closed seam. §10E built the composition it was waiting for, and the route in is
/// [`HostOwnedRequestReplayRoot::from_activated`] — which still takes NO path.
///
/// IT IS STILL FAIL-CLOSED, one level further along. Activation requires a boundary acceptance whose
/// production mint does not exist until the ProgramData ACL is accepted, so a default build resolves
/// the root correctly and still cannot construct this capability. A FRESH TEMPORARY DIRECTORY IS A
/// PERFECT REPLAY ORACLE, which is exactly why the route in cannot be handed one.
#[derive(Debug, Clone)]
pub struct HostOwnedRequestReplayRoot {
    /// The custody of the Host's stores beneath the Host-owned state root (§10I). Private: no caller
    /// outside this module can name a directory, a principal or a policy.
    custody: HostStoreCustody,
}

impl HostOwnedRequestReplayRoot {
    /// THE PRODUCTION MINT — RUN-TO-COMPLETION HOST ATTESTATION §10E.
    ///
    /// NO PATH PARAMETER. The root arrives as an [`ActivatedHostStateRoot`], which can only be
    /// obtained by resolving the installation's own Host state root through the approved anchor AND
    /// presenting an accepted protected boundary.
    ///
    /// THE SAME STATE ROOT AS THE DELEGATION STORE, DIFFERENT LEAF. Both take the Host state root and
    /// each joins its own frozen segment beneath it, so the two histories cannot collide and neither
    /// can be pointed at the other's directory.
    /// # Errors
    /// [`TrustedRootRefusal`] when the root no longer denotes the object, or no longer lives at the
    /// location, that resolution captured.
    pub fn from_activated(activated: &ActivatedHostStateRoot) -> Result<Self, TrustedRootRefusal> {
        // REVALIDATED AT THE HANDOFF, because this is where the handle-owned capability becomes an
        // ordinary path. The trusted root holds a pinned Windows handle and can prove, on demand,
        // that the directory has not been replaced or re-aimed; a `PathBuf` cannot prove anything.
        // Checking here is what stops that proof being discarded unexamined.
        //
        // The same limit as 10B's store applies afterwards, and the same lock handle mitigates it.
        activated.revalidate()?;
        // §10I: the custody comes from the SAME activated root, exactly as the delegation store's.
        Ok(Self {
            custody: activated.store_custody(),
        })
    }

    /// FIXTURE ONLY: treat a disposable directory the test already owns as the Host state root,
    /// custodied for the calling account.
    ///
    /// Compiled for this crate's tests only (§10I: its custody fixture lives in the trusted-roots
    /// dev-dependency graph), so no shipped build can reach it. It is how the store is proven
    /// without a live ProgramData directory.
    #[cfg(test)]
    #[must_use]
    pub fn fixture(owned_root: &std::path::Path) -> Self {
        Self {
            custody: HostStoreCustody::fixture(owned_root),
        }
    }

    /// Whether the Host state root is present as a real directory.
    fn exists(&self) -> bool {
        self.custody.state_root().is_dir()
    }
}

/// THE PRODUCTION DURABLE REQUEST-REPLAY STORE.
///
/// SEALED. It implements the private `super::replay_seal::Sealed` supertrait, which is unnameable
/// outside this crate's replay module, so no downstream crate can supply a rival ledger and answer
/// "fresh" for requests the Host has already run.
///
/// ONE ENGINE HOLDING ONE EXCLUSIVE OS LOCK on the leaf directory — so there is no second replay
/// authority for the same history, in this process or any other. A second store opened against the
/// same root while this one lives is refused by the lock, rather than quietly given its own opinion.
#[derive(Debug)]
pub struct DurableRequestReplayFileStore {
    inner: DurableProtectedStore,
}

impl DurableRequestReplayFileStore {
    /// Open (laying out if absent) the Host's durable replay history.
    ///
    /// AN ABSENT STORE IS NOT AN EMPTY HISTORY THAT MAY BE TRUSTED — but creating the layout on
    /// first open is nevertheless correct here, and the distinction matters. The store is created
    /// only INSIDE an already-existing Host-owned state root, which a default build cannot name at
    /// all; within that root, first-ever open genuinely precedes the first governed request. What
    /// the store must never do is treat a root it could not verify as an empty history, and it does
    /// not: a missing root refuses.
    ///
    /// ## Custody (§10I)
    ///
    /// Exactly as the delegation store's: every object is created WITH the committed owner and
    /// protected DACL, an existing history is judged before the engine touches it and again after,
    /// and a non-conforming one is refused — never re-secured. A history whose files an ordinary
    /// account could delete is a replay window, which is why this is checked rather than assumed.
    ///
    /// # Errors
    /// [`ReplayRefusal`] if the root cannot be prepared, custody cannot be established or verified,
    /// or the engine refuses the root, the single-writer lock, or recovery.
    pub fn open(root: &HostOwnedRequestReplayRoot) -> Result<Self, ReplayRefusal> {
        // THE ROOT IS NOT CREATED, ONLY THE LEAF. A missing state root means the Host is not
        // installed the way this store assumes, and manufacturing the whole directory chain would
        // be exactly the "invent installation truth" failure the capability type exists to prevent
        // — including, on a real machine, creating protected directories under ProgramData that the
        // installer is supposed to own and to ACL. An absent root fails closed.
        if !root.exists() {
            return Err(ReplayRefusal::StateRootUnusable);
        }
        let inner = open_governed_store(&root.custody, HostStateStore::RequestReplay).map_err(
            |refusal| match refusal {
                GovernedOpenRefusal::StateRootUnusable => ReplayRefusal::StateRootUnusable,
                GovernedOpenRefusal::CustodyRefused => ReplayRefusal::CustodyRefused,
                GovernedOpenRefusal::Engine(err) => map_open(err),
            },
        )?;
        Ok(Self { inner })
    }

    /// The current durable store revision. Observation only; it grants nothing.
    #[must_use]
    pub fn current_revision(&self) -> u64 {
        self.inner.current_revision()
    }

    /// How many governed requests this history holds.
    ///
    /// # Errors
    /// [`ReplayRefusal::HistoryUnreadable`] if the history cannot be scanned.
    pub fn recorded(&self) -> Result<usize, ReplayRefusal> {
        self.inner
            .record_count()
            .map_err(|_| ReplayRefusal::HistoryUnreadable)
    }

    /// Read the authoritative record for one identity, distinguishing ABSENT from UNREADABLE.
    ///
    /// THE TWO MUST NOT BE COLLAPSED HERE. "There is no record" and "I could not read the record"
    /// lead to opposite decisions: the first may create, the second must never write over bytes it
    /// could not understand, and must certainly never report the identity fresh.
    fn read_current(&self, key: &str) -> Result<Option<RequestReplayStateDto>, ReplayRefusal> {
        let bytes = match self.inner.get_record(key.as_bytes()) {
            Ok(bytes) => bytes,
            Err(DurableStoreError::RecordNotFound) => return Ok(None),
            Err(_) => return Err(ReplayRefusal::HistoryUnreadable),
        };
        interpret(key, &bytes).map(Some)
    }
}

impl replay_seal::Sealed for DurableRequestReplayFileStore {}

impl RequestReplayLedger for DurableRequestReplayFileStore {
    /// CREATE IF ABSENT, REFUSE IF PRESENT — check and mark as one transition.
    ///
    /// ## Against a stale writer, and against a concurrent one
    ///
    /// The current record is read from DISK immediately before the decision, never from a snapshot
    /// anyone has been holding, and the create is issued with `expected = None`. The engine compares
    /// that against the record's ACTUAL revision and refuses on any difference, so a second writer
    /// that raced past the read finds a record where it expected none and is refused by the
    /// optimistic guard rather than by luck. Across processes the exclusive OS lock on the leaf
    /// means the second contender never opens a store at all.
    ///
    /// ## Every failure refuses, and none of them is "fresh"
    ///
    /// An unreadable record, an undecodable one, a record filed under another identity, an
    /// oversize body, a wrong schema, an unknown state word, a capacity bound and a refused write
    /// all return a refusal. There is no branch in this function that reports freshness from bytes
    /// it did not fully validate, or from a read that failed.
    fn consume(
        &mut self,
        identity: &RequestReplayIdentity,
    ) -> Result<ConsumedRequest, ReplayRefusal> {
        let key = hex_identity(identity.as_bytes());
        // 1. THE FRESH ANSWER MUST BE ESTABLISHED, not assumed. `Some(Consumed)` refuses; an error
        //    refuses; only a clean ABSENCE continues.
        match self.read_current(&key)? {
            Some(RequestReplayStateDto::Consumed) => return Err(ReplayRefusal::AlreadyConsumed),
            None => {}
        }
        // 2. CAPACITY IS CHECKED BEFORE ANY EFFECT. Every record in this family is terminal
        //    security history, so there is nothing here that could be discarded to make room:
        //    exhaustion refuses the NEW request and leaves every existing refusal intact. Refusing
        //    new work is a governance problem the owner can see; evicting old work is a replay
        //    window nobody can see.
        if self.recorded()? >= MAX_REPLAY_RECORDS {
            return Err(ReplayRefusal::CapacityExhausted);
        }
        // 3. THE DURABLE MARK. `expected = None` is the create guard described above.
        let dto = RequestReplayRecordDto {
            schema_version: projectos_host_persistence::version::REQUEST_REPLAY_SCHEMA,
            record_revision: self.inner.current_revision().saturating_add(1),
            request_identity_hex: key.clone(),
            state: RequestReplayStateDto::Consumed,
        };
        let json = dto.to_json().map_err(|_| ReplayRefusal::WriteRefused)?;
        if json.len() > MAX_REPLAY_RECORD_BYTES {
            return Err(ReplayRefusal::WriteRefused);
        }
        self.inner
            .put_record(
                key.as_bytes(),
                TargetFamilyDto::RequestReplay,
                None,
                json.as_bytes(),
            )
            .map_err(map_write)?;
        // 4. ONLY NOW is the evidence minted. The record is durable before the caller learns it may
        //    proceed, so a crash between the write and the return leaves the identity CONSUMED —
        //    which refuses on restart. The other order would leave it fresh.
        Ok(consumed(*identity))
    }
}

/// INTERPRET one record's bytes under the key they were filed at, or refuse.
///
/// SEPARATED FROM THE I/O ON PURPOSE, as §10B's is. Every read rule this checkpoint promises lives
/// here — the size bound, strict decoding, schema equality, the closed state vocabulary and the
/// key/body binding — so each can be exercised directly against exact bytes rather than only through
/// whichever rule the storage engine happens to refuse first.
fn interpret(key: &str, bytes: &[u8]) -> Result<RequestReplayStateDto, ReplayRefusal> {
    // The bound is applied to the RAW BYTES, before any interpretation: an oversized record is
    // refused rather than parsed.
    if bytes.len() > MAX_REPLAY_RECORD_BYTES {
        return Err(ReplayRefusal::HistoryUnreadable);
    }
    let dto =
        RequestReplayRecordDto::parse_json(bytes).map_err(|_| ReplayRefusal::HistoryUnreadable)?;
    dto.validate()
        .map_err(|_| ReplayRefusal::HistoryUnreadable)?;
    // THE RECORD MUST BE ABOUT THE REQUEST IT IS FILED UNDER. A record moved, copied or substituted
    // under another key describes the request it actually names, and a store that let one consumed
    // request satisfy the check for a different one would answer the wrong question in both
    // directions — including reporting a genuinely fresh request consumed.
    if dto.request_identity_hex != key {
        return Err(ReplayRefusal::HistoryUnreadable);
    }
    Ok(dto.state)
}

/// The storage key for one governed request identity: 64 lowercase hex characters, and nothing else.
///
/// The engine's record ids must be ASCII-graphic; a fixed-width lowercase hex encoding of the
/// 32-byte identity is also CANONICAL, so one governed request has exactly one key and a second
/// spelling cannot become a second record — or, worse, a key that reads back absent.
fn hex_identity(id: &[u8; REPLAY_IDENTITY_LEN]) -> String {
    const HEX: [u8; 16] = *b"0123456789abcdef";
    let mut out = String::with_capacity(REPLAY_IDENTITY_LEN * 2);
    for &b in id {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Open failures, classified without leaking which one the filesystem gave.
///
/// EVERY KNOWN VARIANT IS NAMED. [`DurableStoreError`] is `#[non_exhaustive]`, so a catch-all arm is
/// unavoidable — but listing the variants explicitly means adding one upstream shows up here as a
/// deliberate decision rather than being absorbed silently. The catch-all is the fail-closed answer,
/// so a variant that arrives before anyone revisits this refuses rather than opens.
fn map_open(err: DurableStoreError) -> ReplayRefusal {
    match err {
        DurableStoreError::InvalidRoot | DurableStoreError::UnsupportedPlatform => {
            ReplayRefusal::StateRootUnusable
        }
        DurableStoreError::InvalidInput
        | DurableStoreError::ResourceLimit
        | DurableStoreError::WriteRefusedBeforeEffect
        | DurableStoreError::ReadFailed
        | DurableStoreError::RecordNotFound
        | DurableStoreError::RevisionNotAdvanced
        | DurableStoreError::CorruptionDetected
        | DurableStoreError::LockContention
        | DurableStoreError::ReconciliationRequired
        | DurableStoreError::RecoveryFailed
        | DurableStoreError::InjectedFault => ReplayRefusal::StoreUnavailable,
        _ => ReplayRefusal::StoreUnavailable,
    }
}

/// Write failures. A resource bound is capacity; everything else refused before or at the effect.
///
/// EVERY KNOWN VARIANT IS NAMED, for the same reason as [`map_open`]. Note `RevisionNotAdvanced` in
/// particular: on this path it is the engine's optimistic guard refusing a create for an identity
/// that ALREADY HAS a record — a racing second consumer. It maps to `AlreadyConsumed` rather than to
/// a generic write refusal, because that is precisely what it means here, and reporting it as a
/// transient failure would invite a retry of work that has already been taken.
fn map_write(err: DurableStoreError) -> ReplayRefusal {
    match err {
        DurableStoreError::RevisionNotAdvanced => ReplayRefusal::AlreadyConsumed,
        DurableStoreError::ResourceLimit => ReplayRefusal::CapacityExhausted,
        DurableStoreError::CorruptionDetected => ReplayRefusal::HistoryUnreadable,
        DurableStoreError::InvalidInput
        | DurableStoreError::InvalidRoot
        | DurableStoreError::UnsupportedPlatform
        | DurableStoreError::WriteRefusedBeforeEffect
        | DurableStoreError::ReadFailed
        | DurableStoreError::RecordNotFound
        | DurableStoreError::LockContention
        | DurableStoreError::ReconciliationRequired
        | DurableStoreError::RecoveryFailed
        | DurableStoreError::InjectedFault => ReplayRefusal::WriteRefused,
        _ => ReplayRefusal::WriteRefused,
    }
}

#[cfg(test)]
mod tests;
