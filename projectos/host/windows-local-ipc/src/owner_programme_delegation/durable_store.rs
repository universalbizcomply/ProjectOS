//! THE HOST'S OWN DURABLE DELEGATION-LIFECYCLE RECORD — the production store.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10B.
//!
//! ## The invariant this file exists to hold
//!
//! AN OLD GENUINE SIGNED DELEGATION MUST NEVER BECOME LIVE AGAIN MERELY BECAUSE THE HOST RESTARTED.
//!
//! §9 shipped the SEAM: [`super::DurableDelegationStateStore`] was sealed and had no production
//! implementation, so [`super::HostDelegationStatus`] had no production value and every delegation
//! failed closed. That was correct but it was not a store. An in-memory map behind the seal would
//! have looked like durability and would have silently resurrected every ended programme on the next
//! service restart — which is the one failure this whole checkpoint is about.
//!
//! ## What it reuses rather than reinvents
//!
//! Everything mechanical. [`DurableProtectedStore`] is the accepted durable engine and it already
//! owns: the single-writer OS advisory lock over the root, the reparse-hardened bounded layout with
//! path containment, SHA-256 framing that detects accidental and unauthorised mutation, the private
//! Prepared-to-Committed/Aborted journal, `MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH)` atomic
//! write-through replacement, journal-aware recovery of an interrupted write on open, monotonic
//! revisions, and optimistic `expected`-revision replacement. The persisted representation is the
//! accepted [`DelegationLifecycleRecordDto`]. This module adds NO storage framework, NO journal
//! state machine, NO framing and NO lock of its own — it adds the LIFECYCLE RULES, which is the only
//! part the engine cannot know.
//!
//! ## What a stored byte can and cannot do
//!
//! It can end a delegation and it can never start one that the owner did not sign. `Active` on disk
//! is necessary, never sufficient: the record still has to satisfy the owner's signature, the
//! programme binding, its own liveness flag and its expiry. `Revoked` or `Completed` on disk is
//! sufficient on its own to refuse, and is TERMINAL — no ordinary load, no stale writer and no
//! caller-facing API here can move it back.
//!
//! ## Not in this checkpoint
//!
//! No live ProgramData directory is created or written. §10E added the composition that RESOLVES
//! the Host state root — see [`HostOwnedDelegationStateRoot::from_activated`] — but not the
//! acceptance that activates it: a default build still cannot construct a root, therefore cannot
//! open a store, therefore cannot present a [`super::HostDelegationStatus`] — and delegation
//! verification keeps failing closed. No owner-facing revocation command, no generic mutation
//! command, and no provisioning route is wired to a caller. Anti-rollback rests on the FUTURE
//! restricted ProgramData ACL, not on anything here: an attacker who can already replace protected
//! files as SYSTEM is outside this checkpoint's boundary, and no local counter would honestly change
//! that.

use std::path::PathBuf;

use projectos_host_persistence::{
    DelegationLifecycleRecordDto, DelegationLifecycleStateDto, TargetFamilyDto,
};
use projectos_host_trusted_roots::{ActivatedHostStateRoot, TrustedRootRefusal};
use projectos_host_windows_durable_protected_store::{DurableProtectedStore, DurableStoreError};

use super::{DelegationLocalState, DurableDelegationStateStore, DELEGATION_DIGEST_LEN};

/// The ONE frozen leaf segment beneath the Host's own state root that holds delegation lifecycle.
///
/// A single plain segment, exactly like the gatekeeper inbox's: it is the unit a narrow ACE can be
/// applied to, and a nested or caller-influenced path would be a second place to look for the
/// host's word on a delegation.
pub const DELEGATION_STATE_RELATIVE_ROOT: &str = "delegation-state";

/// The most delegation lifecycle records one Host may hold.
///
/// JUSTIFIED, NOT ROUND. One record is created per owner-signed programme delegation this
/// installation has ever been told about, and a delegation covers a whole bounded programme rather
/// than a request; an installation that has genuinely seen 256 distinct owner programmes has a
/// governance problem that silently growing the file would hide. Exhaustion REFUSES; it never
/// evicts, and it may never evict a `Revoked` or `Completed` record to make room — an evicted
/// terminal record is a resurrected delegation.
pub const MAX_DELEGATION_RECORDS: usize = 256;

/// The most bytes one lifecycle record may occupy.
///
/// The record is a schema version, a revision, 64 hex characters and one of three state words; a
/// well-formed one is under 200 bytes. 4 KiB is generous room for JSON whitespace and nothing else,
/// and anything larger is refused rather than parsed.
pub const MAX_DELEGATION_RECORD_BYTES: usize = 4096;

/// A durable-store failure. FIELDLESS: it never carries a path, an id, a raw OS message or any
/// persisted byte, so no refusal can leak the registry it is refusing to talk about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DelegationStoreRefusal {
    /// The Host's own state root could not be prepared or is not a usable directory.
    StateRootUnusable,
    /// The durable engine refused to open: contention, corruption, or required reconciliation.
    StoreUnavailable,
    /// The current durable record could not be read or decoded, so no transition may be attempted.
    RecordUnreadable,
    /// No lifecycle record exists for this delegation, so there is nothing to end.
    UnknownDelegation,
    /// The delegation has already ended. `Revoked` and `Completed` are TERMINAL.
    TerminalStateIsFinal,
    /// The store is at its record bound. Refused; nothing is evicted.
    CapacityExhausted,
    /// The write was refused before any durable effect.
    WriteRefused,
}

/// THE HOST'S OWN STATE ROOT — a capability, not a path a caller may choose.
///
/// ## Why this type exists at all
///
/// If [`DurableDelegationStateFileStore::open`] took a path, any code that could call it could
/// declare its own directory authoritative and answer `Active` for every delegation id it liked —
/// which is exactly the attack the sealed trait exists to prevent, re-introduced one level down.
/// The path therefore arrives as an already-trusted capability with PRIVATE fields and no public
/// constructor outside this module.
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
/// §10B therefore shipped the STORE, complete and proven, and left the root as the narrow
/// fail-closed seam. §10E built the composition it was waiting for: the trusted-roots crate resolves
/// the Host state root from the approved Known Folder anchor and the frozen installation segments,
/// walks every level for reparse substitution, and seals the result. The route in is
/// [`HostOwnedDelegationStateRoot::from_activated`], and it still takes NO path.
///
/// IT IS STILL FAIL-CLOSED, one level further along. Activation requires a boundary acceptance whose
/// production mint does not exist until the ProgramData ACL is accepted, so a default build resolves
/// the root correctly and still cannot construct this capability.
#[derive(Debug, Clone)]
pub struct HostOwnedDelegationStateRoot {
    /// The Host-owned state root. Private: no caller outside this module can name a directory.
    root: PathBuf,
}

impl HostOwnedDelegationStateRoot {
    /// THE PRODUCTION MINT — RUN-TO-COMPLETION HOST ATTESTATION §10E.
    ///
    /// NO PATH PARAMETER. The root arrives as an [`ActivatedHostStateRoot`], which can only be
    /// obtained by resolving the installation's own Host state root through the approved anchor AND
    /// presenting an accepted protected boundary. Nothing about which directory this is comes from
    /// the caller, and this function has no way to disagree with what was resolved.
    ///
    /// IT IS THE HOST STATE ROOT, NOT A PROJECT ROOT. The parameter type is what enforces that: a
    /// governed project root cannot be passed here, in any build.
    /// # Errors
    /// [`TrustedRootRefusal`] when the root no longer denotes the object, or no longer lives at the
    /// location, that resolution captured.
    pub fn from_activated(activated: &ActivatedHostStateRoot) -> Result<Self, TrustedRootRefusal> {
        // REVALIDATED AT THE HANDOFF, because this is where the handle-owned capability becomes an
        // ordinary path. The trusted root holds a pinned Windows handle and can prove, on demand,
        // that the directory has not been replaced or re-aimed; a `PathBuf` cannot prove anything.
        // Checking here is what stops that proof being discarded unexamined.
        //
        // IT IS NOT A STANDING GUARANTEE, and saying so matters more than the check itself. After
        // this call the root is a path, and what protects it from then on is the engine's own
        // re-verification at open plus the single-writer lock handle it holds inside the leaf for
        // the store's lifetime - which does keep the leaf directory from being removed or renamed
        // while a store lives. Carrying the custody handle INTO this type would be the complete
        // answer; it is a change to a closed 10B type's shape and is recorded as carry-forward.
        activated.revalidate()?;
        Ok(Self {
            root: activated.path().to_path_buf(),
        })
    }

    /// FIXTURE ONLY: treat a disposable directory the test already owns as the Host state root.
    ///
    /// Compiled for this crate's tests and the non-default `test-fixtures` graph, so no shipped
    /// build can reach it. It is how the store is proven without a live ProgramData directory.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(owned_root: &std::path::Path) -> Self {
        Self {
            root: owned_root.to_path_buf(),
        }
    }

    /// The delegation-state directory, derived from the frozen segment — never supplied.
    fn state_dir(&self) -> PathBuf {
        self.root.join(DELEGATION_STATE_RELATIVE_ROOT)
    }

    /// Whether the Host state root is present as a real directory.
    fn exists(&self) -> bool {
        self.root.is_dir()
    }
}

/// THE PRODUCTION DURABLE DELEGATION-LIFECYCLE STORE.
///
/// SEALED. It implements the private `super::durable_state::Sealed` supertrait, which is unnameable
/// outside this crate's delegation module, so no downstream crate can supply a rival store and
/// answer `Active` for delegations the owner never signed.
///
/// Reading takes `&self` and writing takes `&mut self`, and both go through ONE engine holding ONE
/// exclusive OS lock on the root — so there is no second authority for the same directory, in this
/// process or any other.
#[derive(Debug)]
pub struct DurableDelegationStateFileStore {
    inner: DurableProtectedStore,
}

impl DurableDelegationStateFileStore {
    /// Open (laying out if absent) the Host's durable delegation-lifecycle store.
    ///
    /// AN ABSENT STORE IS NOT AN ACTIVE STORE. Creating the layout on first open is safe precisely
    /// because an empty store knows no delegation: every id reads back `None`, which
    /// [`super::HostDelegationStatus::from_durable_store`] turns into a refusal. Nothing here
    /// provisions a record, and nothing here can decide a delegation is live.
    ///
    /// # Errors
    /// [`DelegationStoreRefusal`] if the root cannot be prepared, or the engine refuses the root,
    /// the single-writer lock, or recovery.
    pub fn open(root: &HostOwnedDelegationStateRoot) -> Result<Self, DelegationStoreRefusal> {
        // THE ROOT IS NOT CREATED, ONLY THE LEAF. A missing state root means the Host is not
        // installed the way this store assumes, and manufacturing the whole directory chain would
        // be exactly the "invent installation truth" failure the capability type exists to prevent
        // - including, on a real machine, creating protected directories under ProgramData that the
        // installer is supposed to own and to ACL. An absent root fails closed.
        if !root.exists() {
            return Err(DelegationStoreRefusal::StateRootUnusable);
        }
        let dir = root.state_dir();
        match std::fs::create_dir(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(DelegationStoreRefusal::StateRootUnusable),
        }
        let dir = dir
            .to_str()
            .ok_or(DelegationStoreRefusal::StateRootUnusable)?;
        let inner = DurableProtectedStore::open(dir).map_err(map_open)?;
        Ok(Self { inner })
    }

    /// The current durable store revision. Observation only; it grants nothing.
    #[must_use]
    pub fn current_revision(&self) -> u64 {
        self.inner.current_revision()
    }

    /// Read the authoritative record, distinguishing ABSENT from UNREADABLE.
    ///
    /// The trait's `recorded_state` collapses both to `None` because a refusal is a refusal to a
    /// verifier; a WRITE may not collapse them, because "there is no record" and "I could not read
    /// the record" lead to opposite decisions — the first may create, the second must never write
    /// over bytes it could not understand.
    fn read_current(
        &self,
        key: &str,
    ) -> Result<Option<DelegationLocalState>, DelegationStoreRefusal> {
        let bytes = match self.inner.get_record(key.as_bytes()) {
            Ok(bytes) => bytes,
            Err(DurableStoreError::RecordNotFound) => return Ok(None),
            Err(_) => return Err(DelegationStoreRefusal::RecordUnreadable),
        };
        interpret(key, &bytes).map(Some)
    }

    /// Record a lifecycle transition for exactly one delegation, or refuse.
    ///
    /// ## The rules, and why each is what it is
    ///
    /// * absent to `Active` — PROVISIONING. Permitted by the engine, reachable by nobody: this
    ///   method is `pub(crate)` and no production caller exists (see the module note). Bringing a
    ///   delegation into the registry is a governed act, not a side effect of verifying one.
    /// * absent to `Revoked`/`Completed` — REFUSED. There is nothing to end, and a store that
    ///   accepted this would let a caller pre-seed terminal records for ids it invented.
    /// * `Active` to `Revoked`/`Completed` — the whole point.
    /// * identical state — succeeds and WRITES NOTHING. Idempotence must not churn a revision, and
    ///   re-recording a terminal state must never be the thing that unlocks a later write.
    /// * out of a terminal state — REFUSED. `Revoked` and `Completed` are FINAL for one delegation
    ///   id. New authority comes from a new governed delegation, never from resurrecting an ended
    ///   one; there is deliberately no caller-controlled reset.
    ///
    /// ## Against a stale writer
    ///
    /// The current state is read from DISK immediately before the decision, never from a snapshot a
    /// caller has been holding, and the write carries that read's exact revision as the engine's
    /// `expected`. A writer whose view is older than the durable record fails the terminal check on
    /// the fresh read; a writer that raced past it fails the engine's optimistic guard.
    ///
    /// `pub(crate)`, so no crate in the workspace can reach it: §10B builds the engine, it does not
    /// open a mutation authority.
    ///
    /// # Errors
    /// [`DelegationStoreRefusal`] naming the rule or the engine condition that refused.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn record_lifecycle(
        &mut self,
        delegation_id: &[u8; DELEGATION_DIGEST_LEN],
        to: DelegationLocalState,
    ) -> Result<(), DelegationStoreRefusal> {
        let key = hex_id(delegation_id);
        let current = self.read_current(&key)?;
        match (current, to) {
            // Idempotent: the durable answer is already the requested one, terminal or not.
            (Some(now), want) if now == want => return Ok(()),
            // TERMINAL IS FINAL. Includes Revoked <-> Completed: no accepted lifecycle contract
            // needs that move, so it is refused rather than quietly permitted.
            (Some(DelegationLocalState::Revoked | DelegationLocalState::Completed), _) => {
                return Err(DelegationStoreRefusal::TerminalStateIsFinal)
            }
            (Some(DelegationLocalState::Active), _) => {}
            (None, DelegationLocalState::Active) => {}
            (None, _) => return Err(DelegationStoreRefusal::UnknownDelegation),
        }
        self.write(&key, to, current.is_none())
    }

    /// The durable write itself, after the lifecycle rules have allowed it.
    fn write(
        &mut self,
        key: &str,
        state: DelegationLocalState,
        creating: bool,
    ) -> Result<(), DelegationStoreRefusal> {
        // CAPACITY IS CHECKED BEFORE ANY EFFECT, and only a CREATE can consume it: ending an
        // existing delegation must never be the operation that runs out of room.
        //
        // `record_count` is a full directory scan. At MAX_DELEGATION_RECORDS = 256, on the create
        // path only, that is immaterial; if the bound is ever raised substantially this becomes the
        // thing to reconsider first.
        if creating
            && self
                .inner
                .record_count()
                .map_err(|_| DelegationStoreRefusal::RecordUnreadable)?
                >= MAX_DELEGATION_RECORDS
        {
            return Err(DelegationStoreRefusal::CapacityExhausted);
        }
        let expected = self
            .inner
            .record_revision(key.as_bytes())
            .map_err(|_| DelegationStoreRefusal::RecordUnreadable)?;
        self.put(key, state, expected)
    }

    /// Encode and hand one record to the engine at an explicit `expected` revision.
    fn put(
        &mut self,
        key: &str,
        state: DelegationLocalState,
        expected: Option<u64>,
    ) -> Result<(), DelegationStoreRefusal> {
        let dto = DelegationLifecycleRecordDto {
            schema_version: projectos_host_persistence::version::DELEGATION_LIFECYCLE_SCHEMA,
            record_revision: self.inner.current_revision().saturating_add(1),
            delegation_id_hex: key.to_owned(),
            state: to_dto(state),
        };
        let json = dto
            .to_json()
            .map_err(|_| DelegationStoreRefusal::WriteRefused)?;
        if json.len() > MAX_DELEGATION_RECORD_BYTES {
            return Err(DelegationStoreRefusal::WriteRefused);
        }
        self.inner
            .put_record(
                key.as_bytes(),
                TargetFamilyDto::DelegationLifecycle,
                expected,
                json.as_bytes(),
            )
            .map(|_| ())
            .map_err(map_write)
    }

    /// TEST-ONLY: write with a caller-chosen `expected` revision, bypassing the lifecycle rules.
    ///
    /// `cfg(test)`, so it exists in NO shipped graph — not the default build and not the fixture
    /// build. It exists to prove ONE property that cannot otherwise be observed through the safe
    /// API: a writer holding a STALE view of the record is refused by the engine's optimistic guard.
    /// Reaching for it in a test that could have used [`Self::record_lifecycle`] would be proving
    /// the wrong thing.
    #[cfg(test)]
    pub(crate) fn put_with_expected_for_test(
        &mut self,
        delegation_id: &[u8; DELEGATION_DIGEST_LEN],
        state: DelegationLocalState,
        expected: Option<u64>,
    ) -> Result<(), DelegationStoreRefusal> {
        let key = hex_id(delegation_id);
        self.put(&key, state, expected)
    }
}

impl super::durable_state::Sealed for DurableDelegationStateFileStore {}

impl DurableDelegationStateStore for DurableDelegationStateFileStore {
    /// EVERY FAILURE IS `None`, AND `None` IS A REFUSAL.
    ///
    /// Unknown id, missing store, unreadable file, failed SHA-256 framing, wrong schema, unknown
    /// state word, a record filed under another delegation — one answer, and
    /// `HostDelegationStatus::from_durable_store` turns it into
    /// [`super::DelegationRefusal::LocalStatusUnavailable`]. There is no branch anywhere in this
    /// function that produces `Active` from an absence or from bytes it could not fully validate.
    fn recorded_state(
        &self,
        delegation_id: &[u8; DELEGATION_DIGEST_LEN],
    ) -> Option<DelegationLocalState> {
        self.read_current(&hex_id(delegation_id)).ok().flatten()
    }
}

/// INTERPRET one record's bytes under the key they were filed at, or refuse.
///
/// SEPARATED FROM THE I/O ON PURPOSE. Every read rule this checkpoint promises lives here — the size
/// bound, strict decoding, schema equality, the closed state vocabulary and the key/body binding —
/// so each one can be exercised directly against exact bytes rather than only through whichever rule
/// the storage engine happens to refuse first. There is no branch in it that yields `Active` from
/// bytes it did not fully validate.
fn interpret(key: &str, bytes: &[u8]) -> Result<DelegationLocalState, DelegationStoreRefusal> {
    // The bound is applied to the RAW BYTES, before any interpretation: an oversized record is
    // refused rather than parsed.
    if bytes.len() > MAX_DELEGATION_RECORD_BYTES {
        return Err(DelegationStoreRefusal::RecordUnreadable);
    }
    let dto = DelegationLifecycleRecordDto::parse_json(bytes)
        .map_err(|_| DelegationStoreRefusal::RecordUnreadable)?;
    dto.validate()
        .map_err(|_| DelegationStoreRefusal::RecordUnreadable)?;
    // THE RECORD MUST BE ABOUT THE DELEGATION IT IS FILED UNDER. A record moved, copied or
    // substituted under another key answers about the delegation it actually names, and a store that
    // let one delegation's state satisfy another is the same confusion the sealed status' id check
    // exists to prevent, one layer lower.
    if dto.delegation_id_hex != key {
        return Err(DelegationStoreRefusal::RecordUnreadable);
    }
    Ok(from_dto(dto.state))
}

/// The storage key for one delegation: 64 lowercase hex characters, and nothing else.
///
/// The engine's record ids must be ASCII-graphic; a fixed-width lowercase hex encoding of the
/// 32-byte id is also CANONICAL, so one delegation has exactly one key and a second spelling cannot
/// become a second record that says something different.
fn hex_id(id: &[u8; DELEGATION_DIGEST_LEN]) -> String {
    const HEX: [u8; 16] = *b"0123456789abcdef";
    let mut out = String::with_capacity(DELEGATION_DIGEST_LEN * 2);
    for &b in id {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Persisted state to sealed lifecycle state. Total, so a future DTO variant cannot default to live.
fn from_dto(state: DelegationLifecycleStateDto) -> DelegationLocalState {
    match state {
        DelegationLifecycleStateDto::Active => DelegationLocalState::Active,
        DelegationLifecycleStateDto::Revoked => DelegationLocalState::Revoked,
        DelegationLifecycleStateDto::Completed => DelegationLocalState::Completed,
    }
}

/// Sealed lifecycle state to persisted state.
fn to_dto(state: DelegationLocalState) -> DelegationLifecycleStateDto {
    match state {
        DelegationLocalState::Active => DelegationLifecycleStateDto::Active,
        DelegationLocalState::Revoked => DelegationLifecycleStateDto::Revoked,
        DelegationLocalState::Completed => DelegationLifecycleStateDto::Completed,
    }
}

/// Open failures, classified without leaking which one the filesystem gave.
///
/// EVERY KNOWN VARIANT IS NAMED. [`DurableStoreError`] is `#[non_exhaustive]`, so a catch-all arm is
/// unavoidable — but listing the variants explicitly means adding one upstream shows up here as a
/// deliberate decision rather than being absorbed silently. The catch-all is the fail-closed answer,
/// so a variant that arrives before anyone revisits this refuses rather than opens.
fn map_open(err: DurableStoreError) -> DelegationStoreRefusal {
    match err {
        DurableStoreError::InvalidRoot | DurableStoreError::UnsupportedPlatform => {
            DelegationStoreRefusal::StateRootUnusable
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
        | DurableStoreError::InjectedFault => DelegationStoreRefusal::StoreUnavailable,
        _ => DelegationStoreRefusal::StoreUnavailable,
    }
}

/// Write failures. A resource bound is capacity; everything else refused before or at the effect.
///
/// EVERY KNOWN VARIANT IS NAMED, for the same reason as [`map_open`]: the upstream enum is
/// `#[non_exhaustive]`, and a silent default is how a new failure meaning gets the wrong one. Note
/// `RevisionNotAdvanced` in particular — that is the engine's optimistic guard refusing a STALE
/// WRITER, and it maps to `WriteRefused` because nothing was written.
fn map_write(err: DurableStoreError) -> DelegationStoreRefusal {
    match err {
        DurableStoreError::ResourceLimit => DelegationStoreRefusal::CapacityExhausted,
        DurableStoreError::CorruptionDetected => DelegationStoreRefusal::RecordUnreadable,
        DurableStoreError::InvalidInput
        | DurableStoreError::InvalidRoot
        | DurableStoreError::UnsupportedPlatform
        | DurableStoreError::WriteRefusedBeforeEffect
        | DurableStoreError::ReadFailed
        | DurableStoreError::RecordNotFound
        | DurableStoreError::RevisionNotAdvanced
        | DurableStoreError::LockContention
        | DurableStoreError::ReconciliationRequired
        | DurableStoreError::RecoveryFailed
        | DurableStoreError::InjectedFault => DelegationStoreRefusal::WriteRefused,
        _ => DelegationStoreRefusal::WriteRefused,
    }
}

#[cfg(test)]
mod tests;
