//! The synthetic transactional store. In-memory only. It owns the committed state and every service
//! authority the caller must not forge: the monotonic store revision, the per-family revisions, and
//! the transaction identity. A commit either applies fully (atomic swap of a fully-prepared new
//! committed state) or leaves the store byte-for-byte unchanged. NOTHING here reads live authority
//! from stored data — the store returns DTOs, never permits/sessions/leases/eligibility.

use std::collections::BTreeMap;
use std::fmt;

use projectos_host_persistence::version::{JOURNAL_RECORD_SCHEMA, MANIFEST_SCHEMA};
use projectos_host_persistence::{
    validate_approval_for_operation, validate_envelope_metadata, validate_journal_targets_manifest,
    validate_manifest_covers_operation, FamilyRevisionsDto, JournalPhaseDto, JournalRecordDto,
    OperationRecordDto, ProtectedStateManifestDto, TargetFamilyDto,
};

use crate::error::StoreError;
use crate::model::{
    CommittedState, FamilyRevisions, RecordFamily, Snapshot, StoreRevision, StoredRecord,
};
use crate::transaction::{Action, InjectStage, StagedOp, Transaction, TxState};

/// Maximum operations that may be staged in one transaction.
pub const MAX_STAGED_OPS: usize = 256;
/// Maximum records retained in any single keyed family.
pub const MAX_RECORDS_PER_FAMILY: usize = 4096;
/// Maximum committed journal records.
pub const MAX_JOURNAL: usize = 8192;
/// Maximum committed audit records.
pub const MAX_AUDIT: usize = 8192;

/// The number of caller-stageable record families.
const FAMILY_COUNT: usize = 8;

/// A synthetic non-cryptographic manifest MAC placeholder. This is NOT an integrity value; real MAC
/// computation/verification is a future store-integrity phase (no crypto in this crate).
const SYNTHETIC_MANIFEST_MAC: &str = "00";

/// A deliberate corruption of store-GENERATED bookkeeping, applied after generation and before the
/// pre-swap validation gate. It is set ONLY through a `#[cfg(test)]` seam — production `commit`
/// always passes [`GenCorruption::None`]. It exists solely to prove that generated-DTO validation
/// rejects the whole transaction atomically. It is NOT an arbitrary committed-state mutation hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
enum GenCorruption {
    None,
    MalformedJournal,
    MalformedManifest,
    WrongTargetRevision,
    BrokenPrevSequence,
}

/// The outcome of a successful commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommitOutcome {
    /// The store revision after the commit (unchanged for a read-only commit).
    pub revision: StoreRevision,
    /// The committing transaction's identity.
    pub tx_id: u64,
    /// The first journal sequence written by a mutating commit; `None` for a read-only commit.
    pub journal_first_seq: Option<u64>,
    /// The number of journal records written (one per touched family; `0` for a read-only commit).
    pub journal_records: u32,
}

/// The in-memory transactional store. `Debug` is redacted (counts/revisions only).
#[derive(Default)]
pub struct Store {
    committed: CommittedState,
    tx_counter: u64,
}

impl fmt::Debug for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Store")
            .field("revision", &self.committed.revision.value())
            .field("tx_counter", &self.tx_counter)
            .field("committed", &self.committed)
            .finish()
    }
}

impl Store {
    /// A fresh, empty store at revision zero.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The current committed store revision.
    #[must_use]
    pub fn revision(&self) -> StoreRevision {
        self.committed.revision
    }

    /// A stable read snapshot of the current committed state. The snapshot is a clone; later commits
    /// never mutate it. A snapshot is data, not a security attestation.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        Snapshot(self.committed.clone())
    }

    /// Open a transaction against the current committed revision. The store assigns the transaction
    /// identity; the caller cannot choose it. Fails closed if the identity counter is exhausted.
    ///
    /// # Errors
    /// [`StoreError::CounterExhausted`] if the monotonic transaction counter cannot advance.
    pub fn begin(&mut self) -> Result<Transaction, StoreError> {
        let next = self
            .tx_counter
            .checked_add(1)
            .ok_or(StoreError::CounterExhausted)?;
        self.tx_counter = next;
        Ok(Transaction {
            id: next,
            base: self.committed.revision,
            staged: Vec::new(),
            state: TxState::Open,
            inject: None,
        })
    }

    /// Explicitly roll back an open transaction. The store is untouched.
    ///
    /// # Errors
    /// [`StoreError::InvalidTransactionState`] if the transaction is not open.
    pub fn rollback(&self, tx: &mut Transaction) -> Result<(), StoreError> {
        if tx.state != TxState::Open {
            return Err(StoreError::InvalidTransactionState);
        }
        tx.state = TxState::RolledBack;
        Ok(())
    }

    /// Commit a transaction atomically. On ANY error the store is left unchanged and the transaction
    /// is driven to [`TxState::Failed`]. A read-only (empty) transaction commits without advancing
    /// the revision.
    ///
    /// # Errors
    /// A [`StoreError`] classifying the first violated rule.
    pub fn commit(&mut self, tx: &mut Transaction) -> Result<CommitOutcome, StoreError> {
        if tx.state != TxState::Open {
            // Already terminal: do NOT reclassify as Failed.
            return Err(StoreError::InvalidTransactionState);
        }
        match self.try_commit(tx, GenCorruption::None) {
            Ok(outcome) => Ok(outcome),
            Err(err) => {
                tx.state = TxState::Failed;
                Err(err)
            }
        }
    }

    fn try_commit(
        &mut self,
        tx: &mut Transaction,
        corruption: GenCorruption,
    ) -> Result<CommitOutcome, StoreError> {
        if tx.inject == Some(InjectStage::BeforeValidation) {
            return Err(StoreError::InjectedFailure);
        }
        // Stale-write refusal: the transaction must be based on the exact current revision.
        if tx.base.0 < self.committed.revision.0 {
            return Err(StoreError::StaleBase);
        }
        if tx.base.0 > self.committed.revision.0 {
            return Err(StoreError::FutureBase);
        }
        // Read-only commit: nothing staged, revision unchanged, no journal record.
        if tx.staged.is_empty() {
            tx.state = TxState::Committed;
            return Ok(CommitOutcome {
                revision: self.committed.revision,
                tx_id: tx.id,
                journal_first_seq: None,
                journal_records: 0,
            });
        }
        if tx.staged.len() > MAX_STAGED_OPS {
            return Err(StoreError::ResourceLimit);
        }

        // Prepare an isolated candidate state; the live state is untouched until the final swap.
        let mut next = self.committed.clone();
        let mut touched = [false; FAMILY_COUNT];
        for op in &tx.staged {
            apply(&mut next, op)?;
            touched[family_index(op.family)] = true;
        }
        // Per-record DTO validation (fail-closed) over exactly what will be stored.
        for op in &tx.staged {
            if let Some(record) = &op.record {
                validate_record(record)?;
            }
        }
        if tx.inject == Some(InjectStage::AfterValidation) {
            return Err(StoreError::InjectedFailure);
        }
        // Cross-record coherence over the FULL candidate state.
        check_credential_consistency(&next)?;
        check_approval_consistency(&next)?;
        // Resource bounds on the resulting committed state.
        check_bounds(&next)?;

        // Advance service-owned revisions (caller can never set these).
        let store_rev = self
            .committed
            .revision
            .0
            .checked_add(1)
            .ok_or(StoreError::RevisionOverflow)?;
        advance_family_revisions(&mut next, &touched)?;
        next.revision = StoreRevision(store_rev);

        // Store-GENERATED bookkeeping: one commit journal record PER touched family + refreshed
        // manifest. The whole batch is prepared, then validated, then swapped — never partially.
        let touched_count = touched.iter().filter(|t| **t).count();
        let batch_start = next.journal.len();
        match batch_start.checked_add(touched_count) {
            Some(end) if end <= MAX_JOURNAL => {}
            _ => return Err(StoreError::ResourceLimit),
        }
        next.manifest = Some(build_manifest(&next));
        let mut batch = build_family_journals(&next, &touched, store_rev, batch_start)?;
        apply_test_corruption(corruption, &mut batch, next.manifest.as_mut());
        next.journal.extend(batch);

        // Validate the generated manifest + journal batch BEFORE the swap; reject atomically on fail.
        verify_generated_bookkeeping(&next, batch_start)?;

        if tx.inject == Some(InjectStage::BeforeSwap) {
            // Candidate dropped here; the live store never observed it.
            return Err(StoreError::InjectedFailure);
        }

        // Atomic swap: the ONLY point at which live state changes.
        let first_seq = u64::try_from(batch_start).map_err(|_| StoreError::ResourceLimit)?;
        let records = u32::try_from(touched_count).map_err(|_| StoreError::ResourceLimit)?;
        self.committed = next;
        tx.state = TxState::Committed;
        Ok(CommitOutcome {
            revision: self.committed.revision,
            tx_id: tx.id,
            journal_first_seq: Some(first_seq),
            journal_records: records,
        })
    }

    /// Data-coherence check (NOT an authority check): an operation record must not claim a revision
    /// ahead of the current manifest's operation-family revision. Reuses the persistence validator.
    ///
    /// # Errors
    /// [`StoreError::MissingRecord`] if no manifest exists yet; [`StoreError::ConsistencyFailure`] if
    /// the record is a forward/dangling reference.
    pub fn check_operation_covered(&self, op: &OperationRecordDto) -> Result<(), StoreError> {
        let manifest = self
            .committed
            .manifest
            .as_ref()
            .ok_or(StoreError::MissingRecord)?;
        validate_manifest_covers_operation(manifest, op).map_err(|_| StoreError::ConsistencyFailure)
    }

    /// Data-coherence check (NOT an authority check): an incoming journal record must advance its
    /// target family forward of the current manifest. Reuses the persistence validator.
    ///
    /// # Errors
    /// [`StoreError::MissingRecord`] if no manifest exists yet; [`StoreError::ConsistencyFailure`] if
    /// the journal is stale/rollback relative to the manifest.
    pub fn check_journal_against_current(
        &self,
        journal: &JournalRecordDto,
    ) -> Result<(), StoreError> {
        let manifest = self
            .committed
            .manifest
            .as_ref()
            .ok_or(StoreError::MissingRecord)?;
        validate_journal_targets_manifest(journal, manifest)
            .map_err(|_| StoreError::ConsistencyFailure)
    }
}

fn family_index(family: RecordFamily) -> usize {
    match family {
        RecordFamily::TrustPolicy => 0,
        RecordFamily::ProjectRegistry => 1,
        RecordFamily::Operation => 2,
        RecordFamily::Approval => 3,
        RecordFamily::CredentialMetadata => 4,
        RecordFamily::CredentialEnvelope => 5,
        RecordFamily::EmergencyStop => 6,
        RecordFamily::Audit => 7,
    }
}

fn apply(state: &mut CommittedState, op: &StagedOp) -> Result<(), StoreError> {
    if let Some(record) = &op.record {
        // Identity binding: the staged key must equal the record's own identity.
        if op.key != record.key() {
            return Err(StoreError::IdentityMismatch);
        }
    }
    match op.action {
        Action::Insert => insert_record(state, op),
        Action::Replace => replace_record(state, op),
        Action::Remove => remove_record(state, op),
    }
}

fn insert_record(state: &mut CommittedState, op: &StagedOp) -> Result<(), StoreError> {
    let record = op
        .record
        .as_ref()
        .ok_or(StoreError::InvalidTransactionState)?;
    match record {
        StoredRecord::TrustPolicy(r) => map_insert(&mut state.trust_policy, &op.key, r.clone()),
        StoredRecord::ProjectRegistry(r) => {
            map_insert(&mut state.project_registry, &op.key, r.clone())
        }
        StoredRecord::Operation(r) => map_insert(&mut state.operation, &op.key, r.clone()),
        StoredRecord::Approval(r) => map_insert(&mut state.approval, &op.key, r.clone()),
        StoredRecord::CredentialMetadata(r) => {
            map_insert(&mut state.credential_metadata, &op.key, r.clone())
        }
        StoredRecord::CredentialEnvelope(r) => {
            map_insert(&mut state.credential_envelope, &op.key, r.clone())
        }
        StoredRecord::EmergencyStop(r) => {
            if state.emergency.is_some() {
                return Err(StoreError::DuplicateRecord);
            }
            // Deterministic initial revision: the candidate state_revision must equal the store-owned
            // emergency family revision + 1 (exactly 1 in the initial empty state).
            let required = state
                .revs
                .emergency_stop
                .checked_add(1)
                .ok_or(StoreError::EmergencyRevisionInconsistent)?;
            if r.state_revision != required {
                return Err(StoreError::EmergencyRevisionInconsistent);
            }
            state.emergency = Some(r.clone());
            Ok(())
        }
        StoredRecord::Audit(r) => {
            // Append-only: sequence must equal the next append index.
            let expected =
                u64::try_from(state.audit.len()).map_err(|_| StoreError::ResourceLimit)?;
            if r.sequence != expected {
                return Err(StoreError::ConsistencyFailure);
            }
            state.audit.push(r.clone());
            Ok(())
        }
    }
}

fn replace_record(state: &mut CommittedState, op: &StagedOp) -> Result<(), StoreError> {
    let record = op
        .record
        .as_ref()
        .ok_or(StoreError::InvalidTransactionState)?;
    match record {
        StoredRecord::TrustPolicy(r) => map_replace(&mut state.trust_policy, &op.key, r.clone()),
        StoredRecord::ProjectRegistry(r) => {
            map_replace(&mut state.project_registry, &op.key, r.clone())
        }
        StoredRecord::Operation(r) => map_replace(&mut state.operation, &op.key, r.clone()),
        StoredRecord::Approval(r) => map_replace(&mut state.approval, &op.key, r.clone()),
        StoredRecord::CredentialMetadata(r) => {
            map_replace(&mut state.credential_metadata, &op.key, r.clone())
        }
        StoredRecord::CredentialEnvelope(r) => {
            map_replace(&mut state.credential_envelope, &op.key, r.clone())
        }
        StoredRecord::EmergencyStop(r) => {
            // Replace requires an existing record. The committed record must be coherent with the
            // store-owned emergency family revision, and the candidate must advance to exactly
            // family_revision + 1 (== old.state_revision + 1) — rejecting stale, duplicate, skipped,
            // future, and DTO/store-divergent revisions.
            let old = state.emergency.as_ref().ok_or(StoreError::MissingRecord)?;
            let family_rev = state.revs.emergency_stop;
            if old.state_revision != family_rev {
                return Err(StoreError::EmergencyRevisionInconsistent);
            }
            let required = family_rev
                .checked_add(1)
                .ok_or(StoreError::EmergencyRevisionInconsistent)?;
            if r.state_revision != required {
                return Err(StoreError::EmergencyRevisionInconsistent);
            }
            state.emergency = Some(r.clone());
            Ok(())
        }
        // Audit is append-only: replacing history is never permitted.
        StoredRecord::Audit(_) => Err(StoreError::ConsistencyFailure),
    }
}

fn remove_record(state: &mut CommittedState, op: &StagedOp) -> Result<(), StoreError> {
    match op.family {
        RecordFamily::TrustPolicy => map_remove(&mut state.trust_policy, &op.key),
        RecordFamily::ProjectRegistry => map_remove(&mut state.project_registry, &op.key),
        RecordFamily::Operation => map_remove(&mut state.operation, &op.key),
        RecordFamily::Approval => map_remove(&mut state.approval, &op.key),
        RecordFamily::CredentialMetadata => map_remove(&mut state.credential_metadata, &op.key),
        RecordFamily::CredentialEnvelope => map_remove(&mut state.credential_envelope, &op.key),
        RecordFamily::EmergencyStop => {
            if state.emergency.take().is_none() {
                return Err(StoreError::MissingRecord);
            }
            Ok(())
        }
        // Audit is append-only: history cannot be removed.
        RecordFamily::Audit => Err(StoreError::ConsistencyFailure),
    }
}

fn map_insert<V>(map: &mut BTreeMap<String, V>, key: &str, value: V) -> Result<(), StoreError> {
    if map.contains_key(key) {
        return Err(StoreError::DuplicateRecord);
    }
    map.insert(key.to_string(), value);
    Ok(())
}

fn map_replace<V>(map: &mut BTreeMap<String, V>, key: &str, value: V) -> Result<(), StoreError> {
    if !map.contains_key(key) {
        return Err(StoreError::MissingRecord);
    }
    map.insert(key.to_string(), value);
    Ok(())
}

fn map_remove<V>(map: &mut BTreeMap<String, V>, key: &str) -> Result<(), StoreError> {
    if map.remove(key).is_none() {
        return Err(StoreError::MissingRecord);
    }
    Ok(())
}

fn validate_record(record: &StoredRecord) -> Result<(), StoreError> {
    let result = match record {
        StoredRecord::TrustPolicy(r) => r.validate(),
        StoredRecord::ProjectRegistry(r) => r.validate(),
        StoredRecord::Operation(r) => r.validate(),
        StoredRecord::Approval(r) => r.validate(),
        StoredRecord::CredentialMetadata(r) => r.validate(),
        StoredRecord::CredentialEnvelope(r) => r.validate(),
        StoredRecord::EmergencyStop(r) => r.validate(),
        StoredRecord::Audit(r) => r.validate(),
    };
    result.map_err(|_| StoreError::ConsistencyFailure)
}

/// Credential material-existence rule (FAIL-CLOSED, BIDIRECTIONAL).
///
/// The accepted `CredentialLifecycleDto` (Active | Expired | Revoked) carries usability/revocation
/// status ONLY — it has NO state that expresses "encrypted material absent / setup incomplete /
/// destroyed". Therefore, regardless of lifecycle, a committed credential is coherent only when its
/// metadata and its encrypted-material envelope BOTH exist under the same credential reference with
/// matching project/provider/environment.
///
/// (A) Envelope → metadata: every envelope must have matching, scope-agreeing metadata (orphan
///     ciphertext rejected).
/// (B) Metadata → envelope: every metadata record must have a committed envelope (metadata-only is
///     rejected for Active, Expired, AND Revoked — the lifecycle never authorises absent material).
///
/// The scope agreement is symmetric (validated on the envelope side), so together these guarantee
/// bidirectional coherence. A dedicated material-absent lifecycle would require a separate
/// persistence-contract phase (carry-forward, not a store invention).
fn check_credential_consistency(state: &CommittedState) -> Result<(), StoreError> {
    for (key, envelope) in &state.credential_envelope {
        let metadata = state
            .credential_metadata
            .get(key)
            .ok_or(StoreError::MissingRecord)?;
        validate_envelope_metadata(envelope, metadata)
            .map_err(|_| StoreError::ConsistencyFailure)?;
    }
    for key in state.credential_metadata.keys() {
        if !state.credential_envelope.contains_key(key) {
            return Err(StoreError::CredentialLifecycleViolation);
        }
    }
    Ok(())
}

/// Approval-to-operation coherence (NOT authority). The accepted `ApprovalRecordDto` exposes no
/// durable operation identifier — only an operation `fingerprint` — so binding resolves by fingerprint
/// with a strict EXACTLY-ONE rule: zero matches → `MissingRecord`; more than one →
/// `AmbiguousOperationBinding` (never select by map/insertion order). The single match must then pass
/// the accepted persistence scope + expiry validator. A stored approval remains inert data regardless.
///
/// Limitation: the persistence contract does NOT constrain operation fingerprints to be store-wide
/// unique (operations are keyed by `operationRef`), so duplicate fingerprints are not rejected on
/// their own — only an approval that would resolve ambiguously is refused.
fn check_approval_consistency(state: &CommittedState) -> Result<(), StoreError> {
    for approval in state.approval.values() {
        let mut matches = state
            .operation
            .values()
            .filter(|o| o.fingerprint == approval.fingerprint);
        let op = matches.next().ok_or(StoreError::MissingRecord)?;
        if matches.next().is_some() {
            return Err(StoreError::AmbiguousOperationBinding);
        }
        validate_approval_for_operation(approval, op)
            .map_err(|_| StoreError::ConsistencyFailure)?;
    }
    Ok(())
}

fn check_bounds(state: &CommittedState) -> Result<(), StoreError> {
    let over = state.trust_policy.len() > MAX_RECORDS_PER_FAMILY
        || state.project_registry.len() > MAX_RECORDS_PER_FAMILY
        || state.operation.len() > MAX_RECORDS_PER_FAMILY
        || state.approval.len() > MAX_RECORDS_PER_FAMILY
        || state.credential_metadata.len() > MAX_RECORDS_PER_FAMILY
        || state.credential_envelope.len() > MAX_RECORDS_PER_FAMILY;
    if over || state.audit.len() > MAX_AUDIT {
        return Err(StoreError::ResourceLimit);
    }
    Ok(())
}

fn advance_family_revisions(
    state: &mut CommittedState,
    touched: &[bool; FAMILY_COUNT],
) -> Result<(), StoreError> {
    let revs = &mut state.revs;
    let fields: [(&mut u64, bool); FAMILY_COUNT] = [
        (&mut revs.trust_policy, touched[0]),
        (&mut revs.project_registry, touched[1]),
        (&mut revs.operation, touched[2]),
        (&mut revs.approval, touched[3]),
        (&mut revs.credential_metadata, touched[4]),
        (&mut revs.credential_envelope, touched[5]),
        (&mut revs.emergency_stop, touched[6]),
        (&mut revs.audit, touched[7]),
    ];
    for (slot, was_touched) in fields {
        if was_touched {
            *slot = slot.checked_add(1).ok_or(StoreError::RevisionOverflow)?;
        }
    }
    Ok(())
}

/// Generate one `Commit` journal record per touched family, in fixed family order, with consecutive
/// sequences chained from `batch_start`, all bound to the same store revision. Each targets the
/// family's newly committed revision exactly once.
fn build_family_journals(
    state: &CommittedState,
    touched: &[bool; FAMILY_COUNT],
    store_rev: u64,
    batch_start: usize,
) -> Result<Vec<JournalRecordDto>, StoreError> {
    let intent_id = format!("commit-{store_rev}");
    let revs = &state.revs;
    let order: [(TargetFamilyDto, u64); FAMILY_COUNT] = [
        (TargetFamilyDto::TrustPolicy, revs.trust_policy),
        (TargetFamilyDto::ProjectRegistry, revs.project_registry),
        (TargetFamilyDto::Operation, revs.operation),
        (TargetFamilyDto::Approval, revs.approval),
        (
            TargetFamilyDto::CredentialMetadata,
            revs.credential_metadata,
        ),
        (
            TargetFamilyDto::CredentialEnvelope,
            revs.credential_envelope,
        ),
        (TargetFamilyDto::EmergencyStop, revs.emergency_stop),
        (TargetFamilyDto::Audit, revs.audit),
    ];
    let mut out = Vec::new();
    let mut index = batch_start;
    for (idx, (target_family, target_revision)) in order.into_iter().enumerate() {
        if !touched[idx] {
            continue;
        }
        let sequence = u64::try_from(index).map_err(|_| StoreError::ResourceLimit)?;
        let prev_sequence = match index.checked_sub(1) {
            Some(p) => Some(u64::try_from(p).map_err(|_| StoreError::ResourceLimit)?),
            None => None,
        };
        out.push(JournalRecordDto {
            schema_version: JOURNAL_RECORD_SCHEMA,
            record_revision: store_rev,
            sequence,
            intent_id: intent_id.clone(),
            phase: JournalPhaseDto::Commit,
            target_family,
            target_revision,
            prev_sequence,
        });
        index += 1;
    }
    Ok(out)
}

fn build_manifest(state: &CommittedState) -> ProtectedStateManifestDto {
    let revs = &state.revs;
    ProtectedStateManifestDto {
        schema_version: MANIFEST_SCHEMA,
        store_revision: state.revision.0,
        family_revisions: FamilyRevisionsDto {
            trust_policy: revs.trust_policy,
            project_registry: revs.project_registry,
            operation: revs.operation,
            approval: revs.approval,
            credential_metadata: revs.credential_metadata,
            credential_envelope: revs.credential_envelope,
            emergency_stop: revs.emergency_stop,
            audit: revs.audit,
        },
        manifest_mac: SYNTHETIC_MANIFEST_MAC.to_string(),
        record_revision: state.revision.0,
    }
}

/// Validate the generated manifest + journal batch against their own DTO contracts AND against the
/// candidate state, before the swap. Store-local relationship (equality of the journal target to the
/// candidate family revision) differs from the persistence forward-advance validator by design.
fn verify_generated_bookkeeping(
    state: &CommittedState,
    batch_start: usize,
) -> Result<(), StoreError> {
    let manifest = state
        .manifest
        .as_ref()
        .ok_or(StoreError::GeneratedBookkeepingInvalid)?;
    manifest
        .validate()
        .map_err(|_| StoreError::GeneratedBookkeepingInvalid)?;
    if manifest.store_revision != state.revision.0
        || manifest.record_revision != state.revision.0
        || !family_revisions_match(&manifest.family_revisions, &state.revs)
    {
        return Err(StoreError::GeneratedBookkeepingInvalid);
    }
    for (idx, journal) in state.journal.iter().enumerate().skip(batch_start) {
        journal
            .validate()
            .map_err(|_| StoreError::GeneratedBookkeepingInvalid)?;
        let seq = u64::try_from(idx).map_err(|_| StoreError::GeneratedBookkeepingInvalid)?;
        if journal.sequence != seq {
            return Err(StoreError::GeneratedBookkeepingInvalid);
        }
        let expected_prev = match idx.checked_sub(1) {
            Some(p) => Some(u64::try_from(p).map_err(|_| StoreError::GeneratedBookkeepingInvalid)?),
            None => None,
        };
        if journal.prev_sequence != expected_prev {
            return Err(StoreError::GeneratedBookkeepingInvalid);
        }
        if journal.record_revision != manifest.store_revision {
            return Err(StoreError::GeneratedBookkeepingInvalid);
        }
        // Target must equal the candidate family revision exactly — never point beyond it.
        if journal.target_revision != manifest_family_rev(manifest, journal.target_family) {
            return Err(StoreError::GeneratedBookkeepingInvalid);
        }
    }
    Ok(())
}

fn family_revisions_match(dto: &FamilyRevisionsDto, revs: &FamilyRevisions) -> bool {
    dto.trust_policy == revs.trust_policy
        && dto.project_registry == revs.project_registry
        && dto.operation == revs.operation
        && dto.approval == revs.approval
        && dto.credential_metadata == revs.credential_metadata
        && dto.credential_envelope == revs.credential_envelope
        && dto.emergency_stop == revs.emergency_stop
        && dto.audit == revs.audit
}

fn manifest_family_rev(manifest: &ProtectedStateManifestDto, family: TargetFamilyDto) -> u64 {
    let fr = &manifest.family_revisions;
    match family {
        TargetFamilyDto::TrustPolicy => fr.trust_policy,
        TargetFamilyDto::ProjectRegistry => fr.project_registry,
        TargetFamilyDto::Operation => fr.operation,
        TargetFamilyDto::Approval => fr.approval,
        TargetFamilyDto::CredentialMetadata => fr.credential_metadata,
        TargetFamilyDto::CredentialEnvelope => fr.credential_envelope,
        TargetFamilyDto::EmergencyStop => fr.emergency_stop,
        TargetFamilyDto::Audit => fr.audit,
        // Plan records are stored via PlanDurableStore, not this combined store's journaled families,
        // so there is no dedicated `family_revisions.plan` field. They track the manifest's generic
        // record revision — the same explicit contract persistence::validate_journal_targets_manifest
        // uses for the Plan family.
        TargetFamilyDto::Plan | TargetFamilyDto::DelegationLifecycle => manifest.record_revision,
    }
}

/// Apply a test-seam corruption to the generated batch/manifest. `GenCorruption::None` (production)
/// is a no-op.
fn apply_test_corruption(
    corruption: GenCorruption,
    batch: &mut [JournalRecordDto],
    manifest: Option<&mut ProtectedStateManifestDto>,
) {
    match corruption {
        GenCorruption::None => {}
        GenCorruption::MalformedJournal => {
            if let Some(last) = batch.last_mut() {
                last.target_revision = 0; // fails DTO nonzero-revision validation
            }
        }
        GenCorruption::MalformedManifest => {
            if let Some(m) = manifest {
                m.store_revision = 0; // fails DTO nonzero-revision validation
            }
        }
        GenCorruption::WrongTargetRevision => {
            if let Some(last) = batch.last_mut() {
                last.target_revision = last.target_revision.saturating_add(5); // valid DTO, wrong relationship
            }
        }
        GenCorruption::BrokenPrevSequence => {
            if let Some(last) = batch.last_mut() {
                last.prev_sequence = Some(last.sequence); // prev >= sequence: broken chain
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_family_rev_maps_every_family_including_plan() {
        let manifest = ProtectedStateManifestDto {
            schema_version: 1,
            store_revision: 100,
            family_revisions: projectos_host_persistence::FamilyRevisionsDto {
                trust_policy: 1,
                project_registry: 2,
                operation: 3,
                approval: 4,
                credential_metadata: 5,
                credential_envelope: 6,
                emergency_stop: 7,
                audit: 8,
            },
            manifest_mac: "00ff".into(),
            record_revision: 99,
        };
        use TargetFamilyDto as F;
        // Each combined-store family resolves to its own manifest field (behaviour preserved).
        assert_eq!(manifest_family_rev(&manifest, F::TrustPolicy), 1);
        assert_eq!(manifest_family_rev(&manifest, F::ProjectRegistry), 2);
        assert_eq!(manifest_family_rev(&manifest, F::Operation), 3);
        assert_eq!(manifest_family_rev(&manifest, F::Approval), 4);
        assert_eq!(manifest_family_rev(&manifest, F::CredentialMetadata), 5);
        assert_eq!(manifest_family_rev(&manifest, F::CredentialEnvelope), 6);
        assert_eq!(manifest_family_rev(&manifest, F::EmergencyStop), 7);
        assert_eq!(manifest_family_rev(&manifest, F::Audit), 8);
        // Plan tracks the manifest's generic record revision, and is NOT silently mapped to any
        // per-family field (all of which are 1..=8 here).
        assert_eq!(manifest_family_rev(&manifest, F::Plan), 99);
        for family_field in [1u64, 2, 3, 4, 5, 6, 7, 8] {
            assert_ne!(manifest_family_rev(&manifest, F::Plan), family_field);
        }
    }

    const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;
    const AUDIT: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"eventClass":"OPERATION_REQUESTED","evidenceRefs":["ev-1"],"thisHash":"00ff","redactedSummary":"operation requested for polygo staging"}"#;
    const JOURNAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"intentId":"intent-1","phase":"COMMIT","targetFamily":"OPERATION","targetRevision":1}"#;
    const EMERGENCY: &str = r#"{"schemaVersion":1,"recordRevision":1,"globalStop":false,"projectStops":[],"providerStops":[],"environmentStops":[],"stagingLock":false,"productionLock":true,"stateRevision":1,"ownerDecisionProvenance":"owner-decision-1"}"#;

    fn op(op_ref: &str) -> StoredRecord {
        let mut dto = OperationRecordDto::parse_json(OPERATION.as_bytes()).unwrap();
        dto.operation_ref = op_ref.to_string();
        StoredRecord::Operation(dto)
    }

    // ---- cfg(test)-only seams: tightly scoped internal state preparation. NOT public API. ----
    impl Store {
        fn set_store_revision_for_test(&mut self, rev: u64) {
            self.committed.revision = StoreRevision(rev);
        }
        fn set_operation_family_revision_for_test(&mut self, rev: u64) {
            self.committed.revs.operation = rev;
        }
        fn force_emergency_for_test(&mut self, state_revision: u64, family_rev: u64) {
            let mut dto =
                projectos_host_persistence::EmergencyStopDto::parse_json(EMERGENCY.as_bytes())
                    .unwrap();
            dto.state_revision = state_revision;
            self.committed.emergency = Some(dto);
            self.committed.revs.emergency_stop = family_rev;
        }
        fn fill_operation_family_for_test(&mut self, n: usize) {
            for i in 0..n {
                let mut dto = OperationRecordDto::parse_json(OPERATION.as_bytes()).unwrap();
                dto.operation_ref = format!("seed-op-{i}");
                self.committed
                    .operation
                    .insert(dto.operation_ref.clone(), dto);
            }
        }
        fn fill_audit_for_test(&mut self, n: usize) {
            for i in 0..n {
                let mut dto =
                    projectos_host_persistence::AuditRecordDto::parse_json(AUDIT.as_bytes())
                        .unwrap();
                dto.sequence = u64::try_from(i).unwrap();
                self.committed.audit.push(dto);
            }
        }
        fn fill_journal_for_test(&mut self, n: usize) {
            for i in 0..n {
                let mut dto = JournalRecordDto::parse_json(JOURNAL.as_bytes()).unwrap();
                dto.sequence = u64::try_from(i).unwrap();
                dto.prev_sequence = i.checked_sub(1).map(|p| u64::try_from(p).unwrap());
                self.committed.journal.push(dto);
            }
        }
        fn exhaust_tx_counter_for_test(&mut self) {
            self.tx_counter = u64::MAX;
        }
        fn begin_with_base_for_test(&mut self, base: u64) -> Transaction {
            self.tx_counter += 1;
            Transaction {
                id: self.tx_counter,
                base: StoreRevision(base),
                staged: Vec::new(),
                state: TxState::Open,
                inject: None,
            }
        }
        fn commit_with_corruption_for_test(
            &mut self,
            tx: &mut Transaction,
            corruption: GenCorruption,
        ) -> Result<CommitOutcome, StoreError> {
            if tx.state != TxState::Open {
                return Err(StoreError::InvalidTransactionState);
            }
            match self.try_commit(tx, corruption) {
                Ok(o) => Ok(o),
                Err(e) => {
                    tx.state = TxState::Failed;
                    Err(e)
                }
            }
        }
    }

    fn staged_op_commit(
        store: &mut Store,
        corruption: GenCorruption,
    ) -> Result<CommitOutcome, StoreError> {
        let mut tx = store.begin().unwrap();
        tx.insert("op-1", op("op-1")).unwrap();
        store.commit_with_corruption_for_test(&mut tx, corruption)
    }

    #[test]
    fn generated_malformed_journal_rejected_atomically() {
        let mut store = Store::new();
        let err = staged_op_commit(&mut store, GenCorruption::MalformedJournal).unwrap_err();
        assert_eq!(err, StoreError::GeneratedBookkeepingInvalid);
        assert_eq!(store.revision().value(), 0);
        assert!(store.snapshot().manifest().is_none());
        assert_eq!(store.snapshot().journal_len(), 0);
    }

    #[test]
    fn generated_malformed_manifest_rejected_atomically() {
        let mut store = Store::new();
        let err = staged_op_commit(&mut store, GenCorruption::MalformedManifest).unwrap_err();
        assert_eq!(err, StoreError::GeneratedBookkeepingInvalid);
        assert_eq!(store.revision().value(), 0);
    }

    #[test]
    fn generated_wrong_target_revision_rejected_atomically() {
        let mut store = Store::new();
        let err = staged_op_commit(&mut store, GenCorruption::WrongTargetRevision).unwrap_err();
        assert_eq!(err, StoreError::GeneratedBookkeepingInvalid);
        assert_eq!(store.revision().value(), 0);
    }

    #[test]
    fn generated_broken_prev_sequence_rejected_atomically() {
        let mut store = Store::new();
        // Seed one committed journal so the new batch record is not at sequence 0 (prev must exist).
        store.fill_journal_for_test(1);
        let err = staged_op_commit(&mut store, GenCorruption::BrokenPrevSequence).unwrap_err();
        assert_eq!(err, StoreError::GeneratedBookkeepingInvalid);
        assert_eq!(store.revision().value(), 0);
        assert_eq!(store.snapshot().journal_len(), 1);
    }

    #[test]
    fn global_revision_overflow_rejected() {
        let mut store = Store::new();
        store.set_store_revision_for_test(u64::MAX);
        let mut tx = store.begin_with_base_for_test(u64::MAX);
        tx.insert("op-1", op("op-1")).unwrap();
        let err = store
            .commit_with_corruption_for_test(&mut tx, GenCorruption::None)
            .unwrap_err();
        assert_eq!(err, StoreError::RevisionOverflow);
        assert_eq!(store.revision().value(), u64::MAX);
        assert!(store.snapshot().operation("op-1").is_none());
    }

    #[test]
    fn family_revision_overflow_rejected() {
        let mut store = Store::new();
        store.set_operation_family_revision_for_test(u64::MAX);
        let err = staged_op_commit(&mut store, GenCorruption::None).unwrap_err();
        assert_eq!(err, StoreError::RevisionOverflow);
        assert_eq!(store.revision().value(), 0);
        assert!(store.snapshot().operation("op-1").is_none());
    }

    #[test]
    fn transaction_counter_exhausted_rejected() {
        let mut store = Store::new();
        store.exhaust_tx_counter_for_test();
        let err = store.begin().unwrap_err();
        assert_eq!(err, StoreError::CounterExhausted);
    }

    #[test]
    fn future_base_rejected_via_seam() {
        let mut store = Store::new();
        let mut tx = store.begin_with_base_for_test(5);
        tx.insert("op-1", op("op-1")).unwrap();
        let err = store
            .commit_with_corruption_for_test(&mut tx, GenCorruption::None)
            .unwrap_err();
        assert_eq!(err, StoreError::FutureBase);
        assert_eq!(store.revision().value(), 0);
    }

    #[test]
    fn operation_family_capacity_rejected_atomically() {
        let mut store = Store::new();
        store.fill_operation_family_for_test(MAX_RECORDS_PER_FAMILY);
        let mut tx = store.begin().unwrap();
        tx.insert("op-over", op("op-over")).unwrap();
        let err = store.commit(&mut tx).unwrap_err();
        assert_eq!(err, StoreError::ResourceLimit);
        assert_eq!(store.revision().value(), 0);
    }

    #[test]
    fn audit_capacity_rejected_atomically() {
        let mut store = Store::new();
        store.fill_audit_for_test(MAX_AUDIT);
        let mut tx = store.begin().unwrap();
        let mut audit =
            projectos_host_persistence::AuditRecordDto::parse_json(AUDIT.as_bytes()).unwrap();
        audit.sequence = u64::try_from(MAX_AUDIT).unwrap();
        // A non-first audit record must carry a chain predecessor hash to be structurally valid.
        audit.prev_hash = Some("00ff".to_string());
        tx.insert(audit.sequence.to_string(), StoredRecord::Audit(audit))
            .unwrap();
        let err = store.commit(&mut tx).unwrap_err();
        assert_eq!(err, StoreError::ResourceLimit);
        assert_eq!(store.revision().value(), 0);
    }

    #[test]
    fn journal_capacity_insufficient_for_batch_rejected() {
        let mut store = Store::new();
        store.fill_journal_for_test(MAX_JOURNAL - 1);
        // A two-family commit needs two journal slots but only one remains.
        let mut tx = store.begin().unwrap();
        tx.insert("op-1", op("op-1")).unwrap();
        tx.insert("0", {
            let dto =
                projectos_host_persistence::AuditRecordDto::parse_json(AUDIT.as_bytes()).unwrap();
            StoredRecord::Audit(dto)
        })
        .unwrap();
        let err = store.commit(&mut tx).unwrap_err();
        assert_eq!(err, StoreError::ResourceLimit);
        assert_eq!(store.revision().value(), 0);
        assert_eq!(store.snapshot().journal_len(), MAX_JOURNAL - 1);
    }

    #[test]
    fn emergency_dto_diverging_from_family_revision_rejected() {
        let mut store = Store::new();
        // Force a committed emergency record whose DTO state_revision (5) disagrees with the
        // store-owned emergency family revision (1).
        store.force_emergency_for_test(5, 1);
        let mut dto =
            projectos_host_persistence::EmergencyStopDto::parse_json(EMERGENCY.as_bytes()).unwrap();
        dto.state_revision = 2; // == family_rev + 1, but the committed record is incoherent
        let mut tx = store.begin().unwrap();
        tx.replace(
            crate::model::EMERGENCY_KEY,
            StoredRecord::EmergencyStop(dto),
        )
        .unwrap();
        let err = store.commit(&mut tx).unwrap_err();
        assert_eq!(err, StoreError::EmergencyRevisionInconsistent);
        assert_eq!(store.revision().value(), 0);
    }
}
