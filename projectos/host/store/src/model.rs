//! Service-owned store facts and the committed-state snapshot. These types are the store's own
//! authority-free bookkeeping: revisions the caller can never set directly, and immutable snapshots
//! of persisted DTOs. NOTHING here reconstructs live authority (no permit/session/lease/eligibility).

use std::collections::BTreeMap;
use std::fmt;

use projectos_host_persistence::{
    ApprovalRecordDto, AuditRecordDto, CredentialEnvelopeDto, CredentialMetadataDto,
    EmergencyStopDto, JournalRecordDto, OperationRecordDto, ProjectRegistryDto,
    ProtectedStateManifestDto, TrustPolicyDto,
};

/// A service-owned monotonic store revision. The caller can never set this directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct StoreRevision(pub(crate) u64);

impl StoreRevision {
    /// The revision value (read-only view for reporting).
    #[must_use]
    pub fn value(self) -> u64 {
        self.0
    }
}

/// Service-owned per-family revisions. Advanced only by a successful mutating commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FamilyRevisions {
    /// Trust-policy family revision.
    pub trust_policy: u64,
    /// Project-registry family revision.
    pub project_registry: u64,
    /// Operation family revision.
    pub operation: u64,
    /// Approval family revision.
    pub approval: u64,
    /// Credential-metadata family revision.
    pub credential_metadata: u64,
    /// Credential-envelope family revision.
    pub credential_envelope: u64,
    /// Emergency-stop family revision.
    pub emergency_stop: u64,
    /// Audit family revision.
    pub audit: u64,
}

/// The record families a caller may stage. Manifest and journal are store-GENERATED, not staged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordFamily {
    /// Trust policy.
    TrustPolicy,
    /// Project registry.
    ProjectRegistry,
    /// Operation record.
    Operation,
    /// Approval record.
    Approval,
    /// Credential metadata.
    CredentialMetadata,
    /// Credential envelope.
    CredentialEnvelope,
    /// Emergency stop (singleton).
    EmergencyStop,
    /// Audit (append-only).
    Audit,
}

/// A caller-supplied validated persistence DTO to stage. The store never activates these; it only
/// stores and returns them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredRecord {
    /// Trust policy.
    TrustPolicy(TrustPolicyDto),
    /// Project registry.
    ProjectRegistry(ProjectRegistryDto),
    /// Operation record.
    Operation(OperationRecordDto),
    /// Approval record.
    Approval(ApprovalRecordDto),
    /// Credential metadata.
    CredentialMetadata(CredentialMetadataDto),
    /// Credential envelope.
    CredentialEnvelope(CredentialEnvelopeDto),
    /// Emergency stop.
    EmergencyStop(EmergencyStopDto),
    /// Audit record.
    Audit(AuditRecordDto),
}

impl StoredRecord {
    /// The family of this record.
    #[must_use]
    pub fn family(&self) -> RecordFamily {
        match self {
            StoredRecord::TrustPolicy(_) => RecordFamily::TrustPolicy,
            StoredRecord::ProjectRegistry(_) => RecordFamily::ProjectRegistry,
            StoredRecord::Operation(_) => RecordFamily::Operation,
            StoredRecord::Approval(_) => RecordFamily::Approval,
            StoredRecord::CredentialMetadata(_) => RecordFamily::CredentialMetadata,
            StoredRecord::CredentialEnvelope(_) => RecordFamily::CredentialEnvelope,
            StoredRecord::EmergencyStop(_) => RecordFamily::EmergencyStop,
            StoredRecord::Audit(_) => RecordFamily::Audit,
        }
    }

    /// The record's own stable key (its identity field). Emergency is a fixed singleton key; audit is
    /// keyed by its append sequence.
    #[must_use]
    pub fn key(&self) -> String {
        match self {
            StoredRecord::TrustPolicy(r) => r.signing_policy_id.clone(),
            StoredRecord::ProjectRegistry(r) => r.project.clone(),
            StoredRecord::Operation(r) => r.operation_ref.clone(),
            StoredRecord::Approval(r) => r.approval_id.clone(),
            StoredRecord::CredentialMetadata(r) => r.credential_ref.clone(),
            StoredRecord::CredentialEnvelope(r) => r.credential_ref.clone(),
            StoredRecord::EmergencyStop(_) => EMERGENCY_KEY.to_string(),
            StoredRecord::Audit(r) => r.sequence.to_string(),
        }
    }
}

/// The fixed singleton key for the emergency-stop record.
pub const EMERGENCY_KEY: &str = "emergency";

/// The immutable committed state. Cloned to form a snapshot; a transaction commits by atomically
/// replacing the store's committed state with a fully-prepared new one.
///
/// `Debug` is deliberately redacted: it renders only revisions and per-family COUNTS, never the DTO
/// contents (which could carry synthetic ciphertext, references, or summaries).
#[derive(Clone, Default)]
pub struct CommittedState {
    pub(crate) revision: StoreRevision,
    pub(crate) revs: FamilyRevisions,
    pub(crate) trust_policy: BTreeMap<String, TrustPolicyDto>,
    pub(crate) project_registry: BTreeMap<String, ProjectRegistryDto>,
    pub(crate) operation: BTreeMap<String, OperationRecordDto>,
    pub(crate) approval: BTreeMap<String, ApprovalRecordDto>,
    pub(crate) credential_metadata: BTreeMap<String, CredentialMetadataDto>,
    pub(crate) credential_envelope: BTreeMap<String, CredentialEnvelopeDto>,
    pub(crate) emergency: Option<EmergencyStopDto>,
    pub(crate) audit: Vec<AuditRecordDto>,
    pub(crate) journal: Vec<JournalRecordDto>,
    pub(crate) manifest: Option<ProtectedStateManifestDto>,
}

impl fmt::Debug for CommittedState {
    /// Redacted: counts and revisions only, never DTO contents.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommittedState")
            .field("revision", &self.revision.0)
            .field("trust_policy", &self.trust_policy.len())
            .field("project_registry", &self.project_registry.len())
            .field("operation", &self.operation.len())
            .field("approval", &self.approval.len())
            .field("credential_metadata", &self.credential_metadata.len())
            .field("credential_envelope", &self.credential_envelope.len())
            .field("emergency_present", &self.emergency.is_some())
            .field("audit", &self.audit.len())
            .field("journal", &self.journal.len())
            .field("manifest_present", &self.manifest.is_some())
            .finish()
    }
}

/// An immutable read snapshot. It is a clone of the committed state at snapshot time and remains
/// stable even if later transactions commit. A snapshot is NOT a security attestation. `Debug` is
/// redacted (counts/revisions only).
#[derive(Clone)]
pub struct Snapshot(pub(crate) CommittedState);

impl fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Snapshot")
            .field("revision", &self.0.revision.0)
            .field("journal", &self.0.journal.len())
            .field("audit", &self.0.audit.len())
            .field("manifest_present", &self.0.manifest.is_some())
            .finish()
    }
}

impl Snapshot {
    /// The store revision of this snapshot.
    #[must_use]
    pub fn revision(&self) -> StoreRevision {
        self.0.revision
    }
    /// The per-family revisions of this snapshot.
    #[must_use]
    pub fn family_revisions(&self) -> FamilyRevisions {
        self.0.revs
    }
    /// Read an operation record by reference key (DTO data only — no authority).
    #[must_use]
    pub fn operation(&self, key: &str) -> Option<&OperationRecordDto> {
        self.0.operation.get(key)
    }
    /// Read a credential-metadata record by reference key.
    #[must_use]
    pub fn credential_metadata(&self, key: &str) -> Option<&CredentialMetadataDto> {
        self.0.credential_metadata.get(key)
    }
    /// Read a credential-envelope record by reference key.
    #[must_use]
    pub fn credential_envelope(&self, key: &str) -> Option<&CredentialEnvelopeDto> {
        self.0.credential_envelope.get(key)
    }
    /// Read an approval record by id.
    #[must_use]
    pub fn approval(&self, key: &str) -> Option<&ApprovalRecordDto> {
        self.0.approval.get(key)
    }
    /// The current emergency-stop record, if any.
    #[must_use]
    pub fn emergency_stop(&self) -> Option<&EmergencyStopDto> {
        self.0.emergency.as_ref()
    }
    /// The current manifest, if any (synthetic; not integrity-verified).
    #[must_use]
    pub fn manifest(&self) -> Option<&ProtectedStateManifestDto> {
        self.0.manifest.as_ref()
    }
    /// The number of committed journal records.
    #[must_use]
    pub fn journal_len(&self) -> usize {
        self.0.journal.len()
    }
    /// The committed journal records (non-secret bookkeeping; deterministic commit transitions).
    #[must_use]
    pub fn journal(&self) -> &[JournalRecordDto] {
        &self.0.journal
    }
    /// The number of committed audit records.
    #[must_use]
    pub fn audit_len(&self) -> usize {
        self.0.audit.len()
    }
}
