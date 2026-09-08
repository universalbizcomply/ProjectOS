//! The PRIVATE, crate-local durable journal envelope.
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-A (amendment).
//!
//! The accepted [`JournalRecordDto`] carries the accepted transaction/revision/phase evidence
//! (`intent_id`, `phase` Intent→Commit, `sequence`/`prev_sequence`, `record_revision`, `target_family`,
//! `target_revision`) but is FAMILY-scoped: it cannot bind a per-record identity, the previous accepted
//! record revision, the intended record-frame digest, or a filesystem storage outcome. This envelope
//! EMBEDS the accepted DTO UNCHANGED and adds ONLY those storage-specific bindings. It is private to
//! this crate and is NOT a universal ProjectOS DTO. There is no dummy/placeholder family: the caller's
//! declared family must match the actual accepted payload family (validated before journal creation).

use serde::{Deserialize, Serialize};

use projectos_host_persistence::enums::JournalPhaseDto;
use projectos_host_persistence::version::JOURNAL_RECORD_SCHEMA;
use projectos_host_persistence::{
    ApprovalRecordDto, AuditRecordDto, CredentialEnvelopeDto, CredentialMetadataDto,
    DelegationLifecycleRecordDto, EmergencyStopDto, JournalRecordDto, OperationRecordDto,
    PlanRecordDto, ProjectRegistryDto, TargetFamilyDto, TrustPolicyDto,
};

use crate::error::DurableStoreError;
use crate::layout::validate_record_id;

/// The private journal-envelope format version (independent of the accepted DTO schema).
pub(crate) const ENVELOPE_VERSION: u32 = 1;

/// The filesystem mutation kind bound by an intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum JournalOp {
    /// A new record is being created (no prior revision).
    Create,
    /// An existing record is being replaced.
    Replace,
}

/// The durable storage outcome of a transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum JournalOutcome {
    /// Intent recorded; the durable record/manifest effects may or may not have completed.
    Prepared,
    /// The transaction completed durably (record + manifest agree).
    Committed,
    /// The transaction did not take effect; the prior state is intact.
    Aborted,
}

/// The private durable journal envelope. Embeds the accepted [`JournalRecordDto`] and adds only the
/// storage-specific bindings it cannot express.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct JournalEnvelope {
    /// Private envelope format version.
    pub envelope_version: u32,
    /// The embedded accepted transaction-evidence DTO (unchanged).
    pub journal: JournalRecordDto,
    /// The exact record identity this transaction targets (ASCII-graphic, bounded).
    pub record_id: String,
    /// Create or Replace.
    pub operation: JournalOp,
    /// The previous accepted record revision (`None` for Create).
    pub expected_prev_revision: Option<u64>,
    /// The intended manifest/store revision after this transaction.
    pub intended_manifest_revision: u64,
    /// Lowercase-hex SHA-256 of the EXACT intended framed record (binds intent to record content).
    pub record_frame_sha256_hex: String,
    /// The durable storage outcome.
    pub outcome: JournalOutcome,
}

impl JournalEnvelope {
    /// Build a Prepared intent envelope for one record mutation. `sequence` is the monotonic JOURNAL
    /// sequence (independent of the store/manifest revision); `prev_sequence` binds the immediately
    /// preceding durable journal sequence (`None` only for the first entry, sequence 0). `intent_id` is
    /// derived from the journal sequence, NOT from the intended store revision — so an Aborted
    /// transaction does not consume the store revision or block progress.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepared(
        sequence: u64,
        prev_sequence: Option<u64>,
        record_id: &[u8],
        family: TargetFamilyDto,
        operation: JournalOp,
        expected_prev_revision: Option<u64>,
        intended_revision: u64,
        record_frame_sha256: [u8; 32],
    ) -> Self {
        let journal = JournalRecordDto {
            schema_version: JOURNAL_RECORD_SCHEMA,
            record_revision: intended_revision,
            sequence,
            intent_id: format!("txseq-{sequence}"),
            phase: JournalPhaseDto::Intent,
            target_family: family,
            target_revision: intended_revision,
            prev_sequence,
        };
        Self {
            envelope_version: ENVELOPE_VERSION,
            journal,
            record_id: String::from_utf8_lossy(record_id).into_owned(),
            operation,
            expected_prev_revision,
            intended_manifest_revision: intended_revision,
            record_frame_sha256_hex: to_hex(&record_frame_sha256),
            outcome: JournalOutcome::Prepared,
        }
    }

    /// Return a Committed copy (outcome Committed, embedded phase Commit).
    pub(crate) fn into_committed(mut self) -> Self {
        self.outcome = JournalOutcome::Committed;
        self.journal.phase = JournalPhaseDto::Commit;
        self
    }

    /// Return an Aborted copy (outcome Aborted, embedded phase Intent).
    pub(crate) fn into_aborted(mut self) -> Self {
        self.outcome = JournalOutcome::Aborted;
        self.journal.phase = JournalPhaseDto::Intent;
        self
    }

    /// Serialise to JSON bytes.
    ///
    /// # Errors
    /// [`DurableStoreError::WriteRefusedBeforeEffect`] on a serialisation failure.
    pub(crate) fn to_json(&self) -> Result<Vec<u8>, DurableStoreError> {
        serde_json::to_vec(self).map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)
    }

    /// Parse + validate from JSON bytes (strict; unknown fields rejected).
    ///
    /// # Errors
    /// [`DurableStoreError::CorruptionDetected`] for malformed or invalid content.
    pub(crate) fn parse_validate(bytes: &[u8]) -> Result<Self, DurableStoreError> {
        let env: JournalEnvelope =
            serde_json::from_slice(bytes).map_err(|_| DurableStoreError::CorruptionDetected)?;
        env.validate()?;
        Ok(env)
    }

    fn validate(&self) -> Result<(), DurableStoreError> {
        let bad = DurableStoreError::CorruptionDetected;
        if self.envelope_version != ENVELOPE_VERSION {
            return Err(bad);
        }
        self.journal.validate().map_err(|_| bad)?;
        // The intent id is canonically derived from the journal sequence.
        if self.journal.intent_id != format!("txseq-{}", self.journal.sequence) {
            return Err(bad);
        }
        validate_record_id(self.record_id.as_bytes()).map_err(|_| bad)?;
        // Phase must agree with outcome: Intent for Prepared/Aborted, Commit for Committed.
        let phase_ok = match self.outcome {
            JournalOutcome::Prepared | JournalOutcome::Aborted => {
                self.journal.phase == JournalPhaseDto::Intent
            }
            JournalOutcome::Committed => self.journal.phase == JournalPhaseDto::Commit,
        };
        if !phase_ok {
            return Err(bad);
        }
        // Revision coherence: all intended revisions agree.
        if self.journal.record_revision != self.intended_manifest_revision
            || self.journal.target_revision != self.intended_manifest_revision
        {
            return Err(bad);
        }
        // Digest binding must be exactly 64 lowercase hex chars.
        if self.record_frame_sha256_hex.len() != 64
            || !self
                .record_frame_sha256_hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err(bad);
        }
        Ok(())
    }

    /// Whether this envelope's record-frame digest matches `frame` bytes.
    pub(crate) fn matches_record_frame(&self, frame: &[u8]) -> bool {
        to_hex(&crate::framing::sha256(frame)) == self.record_frame_sha256_hex
    }
}

/// Validate that `payload` is a well-formed, valid accepted DTO of exactly `family`. There is NO dummy
/// family: an unparseable/invalid payload, or one that does not match the declared family, is refused
/// BEFORE any journal creation.
///
/// # Errors
/// [`DurableStoreError::InvalidInput`] if the payload is not a valid DTO of `family`.
pub(crate) fn validate_payload_family(
    family: TargetFamilyDto,
    payload: &[u8],
) -> Result<(), DurableStoreError> {
    let result = match family {
        TargetFamilyDto::TrustPolicy => {
            TrustPolicyDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::ProjectRegistry => {
            ProjectRegistryDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::Operation => {
            OperationRecordDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::Approval => {
            ApprovalRecordDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::CredentialMetadata => {
            CredentialMetadataDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::CredentialEnvelope => {
            CredentialEnvelopeDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::EmergencyStop => {
            EmergencyStopDto::parse_json(payload).and_then(|d| d.validate())
        }
        TargetFamilyDto::Audit => AuditRecordDto::parse_json(payload).and_then(|d| d.validate()),
        TargetFamilyDto::Plan => PlanRecordDto::parse_json(payload).and_then(|d| d.validate()),
        TargetFamilyDto::DelegationLifecycle => {
            DelegationLifecycleRecordDto::parse_json(payload).and_then(|d| d.validate())
        }
    };
    result.map_err(|_| DurableStoreError::InvalidInput)
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    s
}
