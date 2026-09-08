//! # ProjectOS Host Persistence (protected-storage DTO contracts)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3F.
//!
//! Strict, versioned persistence DTOs + fail-closed validation for the future ProjectOS Host Service
//! protected state. **Data contracts ONLY** — this crate implements no filesystem, database,
//! encryption, DPAPI/CNG, credential custody, key generation, service process, IPC, Windows API, or
//! provider execution.
//!
//! ## Boundaries this crate preserves
//!
//! * `projectos-host-core` domain authority types remain non-serializable; these DTOs live outside
//!   it and reuse (not duplicate) the core/contract identity rules.
//! * Persistence schema versions are per-family and INDEPENDENT of the wire-contract schema version.
//! * A DTO NEVER grants an `ExecutionPermit`, `AuthenticatedSession`, or `CredentialLease`; a stored
//!   revision is an observation, not authoritative; a copied `operationRef`/`credentialRef` grants
//!   nothing.
//! * Authority-bearing and plaintext/secret fields are structurally impossible: DTOs `deny_unknown_
//!   fields`, so any injected `secret`/`permit`/`session`/`lease` field fails strict parsing.
//! * Audit/evidence fields are bounded and redacted; error messages never echo secret material or
//!   full ciphertext.
//!
//! ## What this crate does NOT claim
//!
//! It represents the data needed for future local rollback/tamper detection (revisions, hashes,
//! MACs, journal sequences) but performs no cryptography and makes **no anti-rollback guarantee** —
//! especially not against an elevated administrator, offline-disk attacker, or restoration of a
//! complete older machine state. Integrity/MAC verification is a later store-integrity phase.

#![forbid(unsafe_code)]

pub mod approval_record;
pub mod audit_record;
pub mod common;
pub mod consistency;
pub mod credential_envelope;
pub mod credential_metadata;
pub mod delegation_lifecycle;
pub mod emergency_stop;
pub mod enums;
pub mod error;
pub mod journal;
pub mod manifest;
pub mod operation_record;
pub mod plan_record;
pub mod project_registry;
pub mod trust_policy;
pub mod version;

pub use approval_record::ApprovalRecordDto;
pub use audit_record::AuditRecordDto;
pub use common::{
    check_intake, validate_local_root, validate_redacted_text, validate_repository_remote,
    MAX_DOCUMENT_BYTES,
};
pub use consistency::{
    validate_approval_for_operation, validate_envelope_metadata, validate_journal_targets_manifest,
    validate_manifest_covers_operation,
};
pub use credential_envelope::CredentialEnvelopeDto;
pub use credential_metadata::CredentialMetadataDto;
pub use delegation_lifecycle::{DelegationLifecycleRecordDto, DelegationLifecycleStateDto};
pub use emergency_stop::EmergencyStopDto;
pub use enums::{
    AuditEventClassDto, CredentialLifecycleDto, JournalPhaseDto, OperationStateDto,
    ProjectStatusDto, ResumePolicyDto, RevocationReasonDto, RevocationStateDto, TargetFamilyDto,
};
pub use error::PersistError;
pub use journal::JournalRecordDto;
pub use manifest::{FamilyRevisionsDto, ProtectedStateManifestDto};
pub use operation_record::OperationRecordDto;
pub use plan_record::{
    EffectPolicyDto, PhaseTypeDto, PlanCandidateDto, PlanRecordDto, PlanStatusDto,
    ProviderPolicyDto, RepositoryPolicyDto, ResidueDto,
};
pub use project_registry::ProjectRegistryDto;
pub use trust_policy::TrustPolicyDto;
