//! # ProjectOS Host Core (service-private trust & operation contracts)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3D.
//!
//! Pure Rust logic contracts for the FUTURE independent ProjectOS Host Service. This crate defines
//! how collected observations become service-validated facts, how those facts reduce (fail closed)
//! to an operation disposition, the operation state machine, and a construction-restricted execution
//! permit — but it implements NO Windows service, IPC, named pipe, Windows API, process
//! verification, Authenticode, protected storage, encryption, credential value, provider call, or
//! owner-authentication mechanism.
//!
//! ## What this crate cannot prove
//!
//! The real security boundary comes from the administrator-protected Host Service binary, the
//! trusted service process, service-private memory, protected service-owned state, independently
//! collected operating-system facts, authenticated IPC, and service-side enforcement. This crate,
//! on its own, cannot prove that an observation came from Windows, that the service binary is
//! protected, that an IPC peer is authentic, that a process was genuinely verified, that an approval
//! came from the owner, that a credential exists, that a provider operation was authorised, or that a
//! malicious replacement binary cannot reproduce the same type shapes. Type privacy here is
//! **API-level construction control**, not cryptographic non-forgeability.
//!
//! ## Trust vocabulary
//!
//! * [`observation`] — COLLECTED BUT NOT YET TRUSTED inputs.
//! * [`facts`] — service-validated facts (outputs of future verification adapters).
//! * [`reducer`] — the fail-closed reducer; default is DENIED.
//! * [`capability::ExecutionPermit`] — a service-private capability record, returned ONLY by the
//!   reducer; not serialized, never crosses IPC, absent from the shared wire contract.

#![forbid(unsafe_code)]

pub mod approval;
pub mod authority_time;
pub mod capability;
pub mod effect;
pub mod elevation;
pub mod error;
pub mod facts;
pub mod observation;
pub mod operation;
pub mod owner_presence;
pub mod phase;
pub mod plan;
pub mod reducer;
pub mod repository;
pub mod runtime_instance;
pub mod storage;

pub use approval::{ApprovalOutcome, OwnerPresenceVerifier, VerifiedApproval};
#[cfg(any(test, feature = "test-fixtures"))]
pub use authority_time::FixtureClock;
pub use authority_time::{AuthorityTimeError, TrustedClock, VerifiedAuthorityTime};
#[cfg(any(test, feature = "test-fixtures"))]
pub use capability::FixtureDimension;
pub use capability::{
    AuthorityValidity, ContextComparison, ContextField, ExecutionPermit, VerifiedExecutionContext,
};
#[cfg(any(test, feature = "test-fixtures"))]
pub use effect::{fixture_issuance_key, SyntheticEffectAdapter, SyntheticEffectScript};
pub use effect::{
    fold_effect_fingerprint, mint_effect_grant, AuthorityLeaseBound, BoundedEffectGrant,
    EffectFamily, EffectGrantError, EffectGrantLedger, EffectOutcome, EffectTarget, EffectWitness,
    IssuanceState, RequiredEffect, RollbackOutcome, RollbackRequirement, RollbackStrategyId,
};
#[cfg(any(test, feature = "test-fixtures"))]
pub use elevation::FixtureElevationVerifier;
pub use elevation::{
    fold_elevation_fingerprint, ElevationError, ElevationLevel, ElevationObservation,
    ElevationVerifier, RequiredElevation, ValidatedElevationFact, VerifiedElevation,
};
pub use error::{
    BindingKind, DenialReason, ElevationBinding, MissingFact, OwnerPresenceBinding, RecordError,
    RepositoryBinding, RevocationReason, TransitionError,
};
pub use facts::{
    validate_bounded_id, ApprovalRecordId, AuthoritySnapshot, CredentialLifecycle,
    CredentialOutcome, CredentialScope, EmergencyStateRevision, EmergencyStopState, EvidenceRef,
    EvidenceReferences, ExecutableIdentity, ExpiryBoundary, InstallationId, PolicyFloor, PolicyId,
    PolicyOutcome, PolicyRevision, PublisherIdentity, ReleaseFloor, ReleaseId, ReplayEvidenceId,
    RepositoryRef, RevocationRevision, RevocationStatus, ServiceValidatedFacts, SessionId,
    ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness, ValidatedInstallation,
    ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease,
    ValidatedSession, ValidityStatus, MAX_BOUNDED_ID_LEN, MAX_EVIDENCE_REFS,
};
pub use observation::{
    ApprovalObservation, CollectedObservations, ConnectionObservation,
    CredentialAvailabilityObservation, CredentialObservation, EmergencyStopObservation,
    EnvironmentObservation, ExecutableObservation, FreshnessObservation, InstallationObservation,
    ProcessObservation, ProjectObservation, PublisherPolicyObservation, ReleaseObservation,
    ReportedAvailability, ReportedStop, RepositoryObservation,
};
pub use operation::{
    InternalOperationRecord, OperationBinding, OperationInputs, OperationState, RecordPolicy,
    ResumePolicy,
};
pub use owner_presence::{
    fold_owner_presence_fingerprint, verify_owner_presence, OwnerPresenceError,
    OwnerPresenceObservation, RequiredOwnerPresence, ValidatedOwnerPresenceFact,
    VerifiedOwnerPresence,
};
pub use phase::{PhaseId, PhaseReference};
pub use plan::{
    normalize_candidate, path_within_boundary, phase_definition_digest, ApprovedPlanBinding,
    ApprovedPlanJournal, ApprovedPlanReader, ApprovedPlanRecord, ApprovedPlanRef,
    ApprovedPlanStatus, ApprovedPlanVersion, EffectPolicy, NormalizeError,
    NormalizedPhaseDefinition, PhaseDefinitionCandidate, PhaseDefinitionDigest, PhaseType,
    PlanDurableDto, PlanPolicyRefusal, ProviderPolicy, RepositoryPolicy, RequestedOperationPolicy,
    ResidueRequirement, ValidatedApprovedPlan, PLAN_SCHEMA_VERSION,
};
pub use plan::{phase_definition_digest_hex, validate_durable_plan};
pub use reducer::{reduce, Disposition, ReductionRequest};
pub use repository::{
    fold_repository_fingerprint, is_valid_oid, verify_repository_baseline, BranchPolicy,
    BranchState, DivergencePolicy, GitRepositoryObservation, RepositoryAuthorityBinding,
    RepositoryError, RepositoryFreshness, RequiredFreshness, RequiredRepository,
    ValidatedRepositoryFact, VerifiedRepositoryBaseline, VerifiedRepositoryIdentity,
};
#[cfg(any(test, feature = "test-fixtures"))]
pub use runtime_instance::FixtureRuntimeInstanceVerifier;
pub use runtime_instance::{
    HostRole, RuntimeInstanceError, RuntimeInstanceObservation, RuntimeInstanceVerifier,
    RuntimeSource, ServiceInstanceEvidence, VerifiedRuntimeInstance,
};
pub use storage::{
    ApprovalRecordReader, CredentialMetadataReader, EmergencyStopReader, OperationRecordRepository,
    ProjectRegistryReader, TrustPolicyReader,
};

// Re-export the authority-free identifiers the core builds upon. They remain references/identifiers
// and do NOT become trusted merely because a service-private type contains them.
pub use projectos_trust_contract::{
    ApprovalEvidenceRef, CredentialRef, EnvironmentId, OperationFingerprint, OperationName,
    OperationRef, ProjectId, ProviderId,
};
