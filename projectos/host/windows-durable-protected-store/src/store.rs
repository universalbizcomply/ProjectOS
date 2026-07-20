//! The durable protected-state store engine: single-writer lock, canonical layout with reparse
//! hardening, a Prepared→Committed/Aborted journal-backed mutation protocol with an INDEPENDENT
//! monotonic journal sequence (retaining Committed AND Aborted evidence, decoupled from the store
//! revision so an aborted transaction never blocks progress), atomic write-through replacement, a
//! monotonic store revision anchored by the accepted manifest DTO, and intent-aware recovery on open.
//! It persists ONLY accepted persistence DTOs, bound to their real accepted family.

use std::fmt;
use std::fs::{File, OpenOptions};
use std::path::Path;

use projectos_host_persistence::version::MANIFEST_SCHEMA;
use projectos_host_persistence::{ProtectedStateManifestDto, TargetFamilyDto};

use crate::atomic_write::atomic_write;
use crate::error::DurableStoreError;
use crate::framing::{self, FrameKind, MAX_FRAMED_BYTES, MAX_PAYLOAD_BYTES};
use crate::journal::{validate_payload_family, JournalEnvelope, JournalOp, JournalOutcome};
use crate::layout::{
    validate_record_id, VerifiedRoot, MAX_JOURNAL_ENTRIES, MAX_RECORDS, MAX_TEMP_SCAN,
};
use crate::recovery::{structural, RecordScan, Structural};

/// The framing-container schema version (independent of any DTO family schema).
const CONTAINER_SCHEMA: u32 = 1;
/// Synthetic non-cryptographic manifest MAC placeholder (the framing SHA-256 provides integrity).
const SYNTHETIC_MANIFEST_MAC: &str = "00";
/// Fixed temp disambiguator for recovery-time writes (recovery precedes any production put).
const RECOVERY_TOKEN: u64 = 0;

/// A durable, single-writer, journal-backed protected-state store rooted at a verified trusted dir.
pub struct DurableProtectedStore {
    root: VerifiedRoot,
    _lock: File,
    current_revision: u64,
    next_sequence: u64,
    temp_token: u64,
}

impl fmt::Debug for DurableProtectedStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DurableProtectedStore")
            .field("revision", &self.current_revision)
            .field("next_sequence", &self.next_sequence)
            .finish()
    }
}

impl DurableProtectedStore {
    /// Open (or create the layout for) a durable store at the explicit trusted `root`, hardening fixed
    /// paths, acquiring the single-writer lock, and running journal-aware recovery.
    ///
    /// # Errors
    /// [`DurableStoreError`] for an invalid/redirected root, lock contention, corruption, or required
    /// reconciliation.
    pub fn open(root: &str) -> Result<Self, DurableStoreError> {
        let root = VerifiedRoot::verify(root)?;
        ensure_layout(&root)?;
        root.verify_fixed_paths_safe()?;
        let lock = acquire_lock(&root)?;
        cleanup_stale_temps(&root)?;
        let (current_revision, next_sequence) = recover(&root)?;
        Ok(Self {
            root,
            _lock: lock,
            current_revision,
            next_sequence,
            temp_token: RECOVERY_TOKEN,
        })
    }

    /// The current durable store revision (0 for an empty store).
    #[must_use]
    pub fn current_revision(&self) -> u64 {
        self.current_revision
    }

    /// The current record count.
    ///
    /// # Errors
    /// [`DurableStoreError`] on a scan failure.
    pub fn record_count(&self) -> Result<usize, DurableStoreError> {
        Ok(scan_records(&self.root)?.len())
    }

    /// Read the accepted DTO document persisted under `id`.
    ///
    /// # Errors
    /// [`DurableStoreError::RecordNotFound`] if absent; [`DurableStoreError::CorruptionDetected`] if the
    /// frame/integrity is invalid.
    pub fn get_record(&self, id: &[u8]) -> Result<Vec<u8>, DurableStoreError> {
        let path = self.root.record_path(id)?;
        if !path.exists() {
            return Err(DurableStoreError::RecordNotFound);
        }
        let bytes = read_bounded(&path)?;
        let frame = framing::decode(&bytes)?;
        if frame.kind != FrameKind::Record {
            return Err(DurableStoreError::CorruptionDetected);
        }
        Ok(frame.payload)
    }

    /// Durably store `payload` (a valid accepted DTO of `family`) under `id`, journal-backed. `expected`
    /// is the record's current revision for optimistic concurrency (`None` to create). Returns the new
    /// store revision.
    ///
    /// # Errors
    /// [`DurableStoreError`] for invalid input, family mismatch, revision non-advance, resource limits,
    /// or a known-before-effect failure.
    pub fn put_record(
        &mut self,
        id: &[u8],
        family: TargetFamilyDto,
        expected: Option<u64>,
        payload: &[u8],
    ) -> Result<u64, DurableStoreError> {
        let plan = self.prepare(id, family, expected, payload)?;
        self.write_journal(&plan.intent)?; // 1. Prepared intent (durable) at the journal sequence
        self.write_record(id, &plan.record_frame)?; // 2. durable write-through record replacement
        let mtoken = self.next_token()?;
        write_manifest(&self.root, plan.next_revision, mtoken)?; // 3. durable manifest advance
        self.write_journal(&plan.intent.clone().into_committed())?; // 4. mark Committed (after durable point)
        self.current_revision = plan.next_revision;
        self.next_sequence = plan.sequence + 1;
        Ok(plan.next_revision)
    }

    fn prepare(
        &mut self,
        id: &[u8],
        family: TargetFamilyDto,
        expected: Option<u64>,
        payload: &[u8],
    ) -> Result<PutPlan, DurableStoreError> {
        validate_record_id(id)?;
        if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
            return Err(DurableStoreError::InvalidInput);
        }
        validate_payload_family(family, payload)?; // truthful family — refuse before journal
        self.root.verify_fixed_paths_safe()?; // revalidate fixed subtree before mutation
        let existing = existing_revision(&self.root, id)?;
        if existing != expected {
            return Err(DurableStoreError::RevisionNotAdvanced);
        }
        if existing.is_none() && scan_records(&self.root)?.len() >= MAX_RECORDS {
            return Err(DurableStoreError::ResourceLimit);
        }
        if self.next_sequence >= MAX_JOURNAL_ENTRIES as u64 {
            return Err(DurableStoreError::ResourceLimit);
        }
        let next_revision = self
            .current_revision
            .checked_add(1)
            .ok_or(DurableStoreError::ResourceLimit)?;
        let sequence = self.next_sequence;
        let prev_sequence = sequence.checked_sub(1);
        let record_frame = framing::encode(
            CONTAINER_SCHEMA,
            FrameKind::Record,
            id,
            next_revision,
            payload,
        )?;
        let digest = framing::sha256(&record_frame);
        let op = if existing.is_some() {
            JournalOp::Replace
        } else {
            JournalOp::Create
        };
        let intent = JournalEnvelope::prepared(
            sequence,
            prev_sequence,
            id,
            family,
            op,
            expected,
            next_revision,
            digest,
        );
        Ok(PutPlan {
            next_revision,
            sequence,
            record_frame,
            intent,
        })
    }

    fn write_journal(&mut self, env: &JournalEnvelope) -> Result<(), DurableStoreError> {
        let token = self.next_token()?;
        write_journal_entry(&self.root, env, token)
    }

    fn write_record(&mut self, id: &[u8], frame: &[u8]) -> Result<(), DurableStoreError> {
        let token = self.next_token()?;
        let temp = self.root.temp_path(id, token)?;
        let final_path = self.root.record_path(id)?;
        atomic_write(&temp, &final_path, frame)
    }

    fn next_token(&mut self) -> Result<u64, DurableStoreError> {
        self.temp_token = self
            .temp_token
            .checked_add(1)
            .ok_or(DurableStoreError::ResourceLimit)?;
        Ok(self.temp_token)
    }
}

struct PutPlan {
    next_revision: u64,
    sequence: u64,
    record_frame: Vec<u8>,
    intent: JournalEnvelope,
}

// ---------------------------------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------------------------------

/// Returns `(current_revision, next_sequence)`.
fn recover(root: &VerifiedRoot) -> Result<(u64, u64), DurableStoreError> {
    let manifest = read_manifest_revision(root)?;
    let entries = read_journal_entries(root)?; // sorted + chain-validated
    let records = scan_records(root)?;
    let next_sequence = entries.last().map(|(s, _)| s + 1).unwrap_or(0);

    let struct_ = structural(manifest, &records);
    match struct_ {
        Structural::Corrupt => return Err(DurableStoreError::CorruptionDetected),
        Structural::ManifestAhead | Structural::MultipleAhead | Structural::RecordsNoManifest => {
            return Err(DurableStoreError::ReconciliationRequired)
        }
        _ => {}
    }

    let last = entries.last().map(|(_, e)| e.clone());
    let current = match struct_ {
        Structural::Empty => {
            if let Some(e) = &last {
                if e.outcome == JournalOutcome::Prepared {
                    write_journal_entry(root, &e.clone().into_aborted(), RECOVERY_TOKEN)?;
                }
            }
            0
        }
        Structural::Coherent(m) => match last {
            None => {
                if records.is_empty() {
                    m
                } else {
                    return Err(DurableStoreError::ReconciliationRequired); // records without journal
                }
            }
            Some(e) => reconcile_coherent(root, &e, m)?,
        },
        Structural::OneAhead {
            manifest: m,
            ahead: x,
        } => match last {
            None => return Err(DurableStoreError::ReconciliationRequired),
            Some(e) => complete_one_ahead(root, &e, m, x)?,
        },
        _ => unreachable!("hard failures handled above"),
    };
    Ok((current, next_sequence))
}

/// Coherent record set (nothing ahead of the manifest). Finalise the last journal entry.
fn reconcile_coherent(
    root: &VerifiedRoot,
    e: &JournalEnvelope,
    m: u64,
) -> Result<u64, DurableStoreError> {
    let ir = e.intended_manifest_revision;
    match e.outcome {
        JournalOutcome::Committed | JournalOutcome::Aborted => {
            // Committed must not exceed the manifest; Aborted must not have advanced it.
            if ir > m {
                return Err(DurableStoreError::ReconciliationRequired);
            }
            Ok(m)
        }
        JournalOutcome::Prepared => {
            if ir == m {
                // Crash after the manifest advance, before the commit-mark: the record must match.
                let matches = matches_bound_record(root, e, m)?;
                if matches {
                    write_journal_entry(root, &e.clone().into_committed(), RECOVERY_TOKEN)?;
                    Ok(m)
                } else {
                    Err(DurableStoreError::ReconciliationRequired)
                }
            } else if ir == m + 1 {
                // Prepared for the next revision but no record durably ahead → the transaction aborted.
                write_journal_entry(root, &e.clone().into_aborted(), RECOVERY_TOKEN)?;
                Ok(m)
            } else {
                Err(DurableStoreError::ReconciliationRequired)
            }
        }
    }
}

/// A single record is one revision ahead. Promote ONLY with an exact matching valid Prepared intent.
fn complete_one_ahead(
    root: &VerifiedRoot,
    e: &JournalEnvelope,
    m: u64,
    x: u64,
) -> Result<u64, DurableStoreError> {
    if e.outcome != JournalOutcome::Prepared
        || e.intended_manifest_revision != x
        || e.journal.target_revision != x
        || x != m + 1
    {
        return Err(DurableStoreError::ReconciliationRequired);
    }
    if !matches_bound_record(root, e, x)? {
        return Err(DurableStoreError::ReconciliationRequired);
    }
    write_manifest(root, x, RECOVERY_TOKEN)?;
    write_journal_entry(root, &e.clone().into_committed(), RECOVERY_TOKEN)?;
    Ok(x)
}

/// Whether the record bound by `e` exists at revision `rev` with a matching frame digest.
fn matches_bound_record(
    root: &VerifiedRoot,
    e: &JournalEnvelope,
    rev: u64,
) -> Result<bool, DurableStoreError> {
    let Some(frame) = read_record_frame(root, e.record_id.as_bytes())? else {
        return Ok(false);
    };
    let decoded = framing::decode(&frame)?;
    Ok(decoded.kind == FrameKind::Record
        && decoded.revision == rev
        && e.matches_record_frame(&frame))
}

// ---------------------------------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------------------------------

fn ensure_layout(root: &VerifiedRoot) -> Result<(), DurableStoreError> {
    for dir in [root.records_dir(), root.temp_dir(), root.journal_dir()] {
        std::fs::create_dir_all(&dir).map_err(|_| DurableStoreError::InvalidRoot)?;
    }
    Ok(())
}

fn acquire_lock(root: &VerifiedRoot) -> Result<File, DurableStoreError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.lock_path())
        .map_err(|_| DurableStoreError::InvalidRoot)?;
    crate::windows_fs::try_lock_exclusive(&file)?;
    Ok(file)
}

fn cleanup_stale_temps(root: &VerifiedRoot) -> Result<u32, DurableStoreError> {
    let entries = std::fs::read_dir(root.temp_dir()).map_err(|_| DurableStoreError::ReadFailed)?;
    let mut removed = 0u32;
    let mut scanned = 0usize;
    for entry in entries {
        scanned += 1;
        if scanned > MAX_TEMP_SCAN {
            return Err(DurableStoreError::ResourceLimit);
        }
        let entry = entry.map_err(|_| DurableStoreError::ReadFailed)?;
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

fn read_manifest_revision(root: &VerifiedRoot) -> Result<Option<u64>, DurableStoreError> {
    let path = root.manifest_path();
    if !path.exists() {
        return Ok(None);
    }
    let bytes = read_bounded(&path)?;
    let frame = framing::decode(&bytes)?;
    if frame.kind != FrameKind::Manifest {
        return Err(DurableStoreError::CorruptionDetected);
    }
    let dto = ProtectedStateManifestDto::parse_json(&frame.payload)
        .map_err(|_| DurableStoreError::CorruptionDetected)?;
    dto.validate()
        .map_err(|_| DurableStoreError::CorruptionDetected)?;
    if frame.revision != dto.store_revision {
        return Err(DurableStoreError::CorruptionDetected);
    }
    Ok(Some(dto.store_revision))
}

/// Read + validate every journal entry, returning them sorted by sequence. Enforces a contiguous,
/// well-chained sequence (0..=max, `prev_sequence == sequence - 1`, filename sequence == embedded
/// sequence) — a gap, duplicate, rollback, or broken chain is corruption.
fn read_journal_entries(
    root: &VerifiedRoot,
) -> Result<Vec<(u64, JournalEnvelope)>, DurableStoreError> {
    let dir = root.journal_dir();
    let entries = std::fs::read_dir(&dir).map_err(|_| DurableStoreError::ReadFailed)?;
    let mut out: Vec<(u64, JournalEnvelope)> = Vec::new();
    for entry in entries {
        if out.len() >= MAX_JOURNAL_ENTRIES {
            return Err(DurableStoreError::ResourceLimit);
        }
        let entry = entry.map_err(|_| DurableStoreError::ReadFailed)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Parse the sequence from the fixed-width `<seq>.j` filename.
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or(DurableStoreError::CorruptionDetected)?;
        let seq_str = name
            .strip_suffix(".j")
            .ok_or(DurableStoreError::CorruptionDetected)?;
        let seq: u64 = seq_str
            .parse()
            .map_err(|_| DurableStoreError::CorruptionDetected)?;
        let bytes = read_bounded(&path)?;
        let frame = framing::decode(&bytes)?;
        if frame.kind != FrameKind::Journal {
            return Err(DurableStoreError::CorruptionDetected);
        }
        let env = JournalEnvelope::parse_validate(&frame.payload)?;
        if env.journal.sequence != seq {
            return Err(DurableStoreError::CorruptionDetected); // filename/content disagreement
        }
        out.push((seq, env));
    }
    out.sort_by_key(|(s, _)| *s);
    // Contiguous, well-chained: 0,1,2,... with prev binding the predecessor.
    for (i, (seq, env)) in out.iter().enumerate() {
        let expected_seq = i as u64;
        if *seq != expected_seq {
            return Err(DurableStoreError::CorruptionDetected); // gap / duplicate / rollback
        }
        let expected_prev = expected_seq.checked_sub(1);
        if env.journal.prev_sequence != expected_prev {
            return Err(DurableStoreError::CorruptionDetected); // broken chain
        }
    }
    Ok(out)
}

fn scan_records(root: &VerifiedRoot) -> Result<Vec<RecordScan>, DurableStoreError> {
    let entries =
        std::fs::read_dir(root.records_dir()).map_err(|_| DurableStoreError::ReadFailed)?;
    let mut out = Vec::new();
    for entry in entries {
        if out.len() >= MAX_RECORDS {
            return Err(DurableStoreError::ResourceLimit);
        }
        let entry = entry.map_err(|_| DurableStoreError::ReadFailed)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let scan = match read_bounded(&path).and_then(|b| framing::decode(&b)) {
            Ok(frame) if frame.kind == FrameKind::Record => RecordScan {
                revision: frame.revision,
                integrity_ok: true,
            },
            _ => RecordScan {
                revision: 0,
                integrity_ok: false,
            },
        };
        out.push(scan);
    }
    Ok(out)
}

fn existing_revision(root: &VerifiedRoot, id: &[u8]) -> Result<Option<u64>, DurableStoreError> {
    match read_record_frame(root, id)? {
        None => Ok(None),
        Some(frame) => Ok(Some(framing::decode(&frame)?.revision)),
    }
}

fn read_record_frame(root: &VerifiedRoot, id: &[u8]) -> Result<Option<Vec<u8>>, DurableStoreError> {
    let path = root.record_path(id)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_bounded(&path)?))
}

fn build_manifest_dto(store_rev: u64) -> ProtectedStateManifestDto {
    use projectos_host_persistence::FamilyRevisionsDto;
    ProtectedStateManifestDto {
        schema_version: MANIFEST_SCHEMA,
        store_revision: store_rev,
        family_revisions: FamilyRevisionsDto {
            trust_policy: store_rev,
            project_registry: store_rev,
            operation: store_rev,
            approval: store_rev,
            credential_metadata: store_rev,
            credential_envelope: store_rev,
            emergency_stop: store_rev,
            audit: store_rev,
        },
        manifest_mac: SYNTHETIC_MANIFEST_MAC.to_string(),
        record_revision: store_rev,
    }
}

fn write_manifest(
    root: &VerifiedRoot,
    store_rev: u64,
    token: u64,
) -> Result<(), DurableStoreError> {
    let dto = build_manifest_dto(store_rev);
    let json = dto
        .to_json()
        .map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)?;
    let framed = framing::encode(
        CONTAINER_SCHEMA,
        FrameKind::Manifest,
        b"",
        store_rev,
        json.as_bytes(),
    )?;
    let temp = root.manifest_temp_path(token);
    atomic_write(&temp, &root.manifest_path(), &framed)
}

fn write_journal_entry(
    root: &VerifiedRoot,
    env: &JournalEnvelope,
    token: u64,
) -> Result<(), DurableStoreError> {
    let json = env.to_json()?;
    let framed = framing::encode(
        CONTAINER_SCHEMA,
        FrameKind::Journal,
        env.record_id.as_bytes(),
        env.journal.sequence,
        &json,
    )?;
    let temp = root.journal_temp_path(token);
    atomic_write(
        &temp,
        &root.journal_entry_path(env.journal.sequence),
        &framed,
    )
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, DurableStoreError> {
    let meta = std::fs::metadata(path).map_err(|_| DurableStoreError::ReadFailed)?;
    if meta.len() > MAX_FRAMED_BYTES as u64 {
        return Err(DurableStoreError::ResourceLimit);
    }
    std::fs::read(path).map_err(|_| DurableStoreError::ReadFailed)
}

// ---------------------------------------------------------------------------------------------------
// Private cfg(test)-only fault seam + store-touching tests (never compiled into any release/normal
// build; not a Cargo feature; not reachable by integration tests).
// ---------------------------------------------------------------------------------------------------
#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use projectos_host_persistence::OperationRecordDto;
    use std::sync::atomic::{AtomicU64, Ordering};

    const SYNTH_OP: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;
    const FAMILY: TargetFamilyDto = TargetFamilyDto::Operation;
    static SEQ: AtomicU64 = AtomicU64::new(0);

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    #[allow(clippy::enum_variant_names)]
    enum FaultStage {
        AfterIntent,
        AfterRecord,
        AfterManifest,
    }

    fn payload() -> Vec<u8> {
        OperationRecordDto::parse_json(SYNTH_OP.as_bytes())
            .unwrap()
            .to_json()
            .unwrap()
            .into_bytes()
    }

    fn root() -> String {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pos-durable-u-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_str().unwrap().to_string()
    }

    impl DurableProtectedStore {
        /// Run the journal protocol but STOP after `stage`, simulating a crash (leaves partial durable
        /// state; does not advance in-memory revision/sequence).
        fn put_record_stop_after(
            &mut self,
            id: &[u8],
            family: TargetFamilyDto,
            expected: Option<u64>,
            payload: &[u8],
            stage: FaultStage,
        ) -> Result<u64, DurableStoreError> {
            let plan = self.prepare(id, family, expected, payload)?;
            self.write_journal(&plan.intent)?;
            if stage == FaultStage::AfterIntent {
                return Ok(plan.next_revision);
            }
            self.write_record(id, &plan.record_frame)?;
            if stage == FaultStage::AfterRecord {
                return Ok(plan.next_revision);
            }
            let mtoken = self.next_token()?;
            write_manifest(&self.root, plan.next_revision, mtoken)?;
            Ok(plan.next_revision) // intent left Prepared (crash before commit-mark)
        }
    }

    #[test]
    fn crash_after_intent_aborts_and_frees_revision() {
        let r = root();
        let p = payload();
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record(b"rec-a", FAMILY, None, &p).unwrap(); // seq0, rev1 committed
            s.put_record_stop_after(b"rec-b", FAMILY, None, &p, FaultStage::AfterIntent)
                .unwrap(); // seq1 Prepared@rev2, no record
        }
        let s = DurableProtectedStore::open(&r).unwrap();
        assert_eq!(s.current_revision(), 1); // aborted; store revision NOT consumed
        assert_eq!(
            s.get_record(b"rec-b").unwrap_err(),
            DurableStoreError::RecordNotFound
        );
        drop(s);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn liveness_new_transaction_after_abort_reuses_revision() {
        let r = root();
        let p = payload();
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record(b"rec-a", FAMILY, None, &p).unwrap(); // seq0 rev1
            s.put_record_stop_after(b"rec-b", FAMILY, None, &p, FaultStage::AfterIntent)
                .unwrap(); // seq1 aborted@rev2
        }
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.current_revision(), 1);
            // New transaction (journal seq2) still targets store revision 2 and succeeds.
            assert_eq!(s.put_record(b"rec-b", FAMILY, None, &p).unwrap(), 2);
            // Store remains writable for a later revision.
            assert_eq!(s.put_record(b"rec-c", FAMILY, None, &p).unwrap(), 3);
        }
        // Reopen: coherent; committed evidence not re-applied.
        let s = DurableProtectedStore::open(&r).unwrap();
        assert_eq!(s.current_revision(), 3);
        drop(s);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn crash_after_record_recovers_via_matching_intent() {
        let r = root();
        let p = payload();
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record(b"rec-a", FAMILY, None, &p).unwrap();
            s.put_record_stop_after(b"rec-b", FAMILY, None, &p, FaultStage::AfterRecord)
                .unwrap(); // record@rev2, manifest 1, seq1 Prepared
        }
        let s = DurableProtectedStore::open(&r).unwrap();
        assert_eq!(s.current_revision(), 2);
        assert_eq!(s.get_record(b"rec-b").unwrap(), p);
        drop(s);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn crash_after_manifest_finalises_committed() {
        let r = root();
        let p = payload();
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record(b"rec-a", FAMILY, None, &p).unwrap();
            s.put_record_stop_after(b"rec-b", FAMILY, None, &p, FaultStage::AfterManifest)
                .unwrap(); // record+manifest@2, seq1 Prepared
        }
        let s = DurableProtectedStore::open(&r).unwrap();
        assert_eq!(s.current_revision(), 2);
        drop(s);
        let s2 = DurableProtectedStore::open(&r).unwrap(); // now committed; clean reopen
        assert_eq!(s2.current_revision(), 2);
        drop(s2);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn broken_journal_chain_is_corrupt() {
        let r = root();
        let p = payload();
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record(b"rec-a", FAMILY, None, &p).unwrap(); // seq0
        }
        // Craft a journal entry at sequence 2 (gap: no sequence 1) → broken chain.
        let vr = VerifiedRoot::verify(&r).unwrap();
        let digest = framing::sha256(b"x");
        let env = JournalEnvelope::prepared(
            2,
            Some(1),
            b"rec-z",
            FAMILY,
            JournalOp::Create,
            None,
            2,
            digest,
        );
        let framed = framing::encode(
            CONTAINER_SCHEMA,
            FrameKind::Journal,
            env.record_id.as_bytes(),
            2,
            &env.to_json().unwrap(),
        )
        .unwrap();
        std::fs::write(vr.journal_entry_path(2), &framed).unwrap();
        assert_eq!(
            DurableProtectedStore::open(&r).unwrap_err(),
            DurableStoreError::CorruptionDetected
        );
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    #[ignore = "owner-machine durability probe; set PROJECTOS_RUN_WINDOWS_DURABLE_STORE_PROBE=1"]
    fn live_windows_durable_store_probe() {
        if std::env::var("PROJECTOS_RUN_WINDOWS_DURABLE_STORE_PROBE").as_deref() != Ok("1") {
            return;
        }
        let r = root();
        let p = payload();
        // Journal-backed write, reopen, replace.
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.put_record(b"rec-a", FAMILY, None, &p).unwrap(), 1);
        }
        {
            let s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.current_revision(), 1);
            assert_eq!(s.get_record(b"rec-a").unwrap().len(), p.len());
        }
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.put_record(b"rec-a", FAMILY, Some(1), &p).unwrap(), 2);
        }
        // Abort then liveness: new transaction reuses the freed store revision.
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record_stop_after(b"rec-b", FAMILY, None, &p, FaultStage::AfterIntent)
                .unwrap();
        }
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.current_revision(), 2);
            assert_eq!(s.put_record(b"rec-b", FAMILY, None, &p).unwrap(), 3);
        }
        // Interruption after record, before manifest — recovered via matching intent.
        {
            let mut s = DurableProtectedStore::open(&r).unwrap();
            s.put_record_stop_after(b"rec-c", FAMILY, None, &p, FaultStage::AfterRecord)
                .unwrap();
        }
        {
            let s = DurableProtectedStore::open(&r).unwrap();
            assert_eq!(s.current_revision(), 4);
        }
        // SHA-256 corruption refusal.
        {
            let vr = VerifiedRoot::verify(&r).unwrap();
            let rp = vr.record_path(b"rec-a").unwrap();
            let mut bytes = std::fs::read(&rp).unwrap();
            let mid = bytes.len() / 2;
            bytes[mid] ^= 0x01;
            std::fs::write(&rp, &bytes).unwrap();
            assert_eq!(
                DurableProtectedStore::open(&r).unwrap_err(),
                DurableStoreError::CorruptionDetected
            );
        }
        std::fs::remove_dir_all(&r).unwrap();
        assert!(!std::path::Path::new(&r).exists());
    }
}
