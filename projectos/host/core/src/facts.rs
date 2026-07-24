//! Service-validated facts — outputs of the future verification adapters.
//!
//! These live ONLY inside the future trusted service boundary: they must not cross IPC, must not be
//! placed in the shared wire contract, and must not derive `Serialize`/`Deserialize`. They may be
//! constructed by verification adapters (and by tests standing in for them), but the core cannot
//! prove the external verification was performed honestly — it only defines their structure and the
//! invariants the reducer checks. None may contain raw credentials, private keys, or certificate
//! private material. Numeric revisions/floors/boundaries are opaque, adapter-interpreted values.

use crate::approval::ApprovalOutcome;
use crate::error::RecordError;
use projectos_trust_contract::{
    CredentialRef, EnvironmentId, OperationName, ProjectId, ProviderId,
};

/// Maximum length (bytes) for a bounded service-private identifier.
pub const MAX_BOUNDED_ID_LEN: usize = 128;
/// Maximum number of evidence references retained on a durable record.
pub const MAX_EVIDENCE_REFS: usize = 32;

/// Validate a bounded identifier: non-empty, within [`MAX_BOUNDED_ID_LEN`], every character an ASCII
/// graphic (rejects control/whitespace/non-ASCII), and no path/URL separator (`/` or `\`). This
/// forbids filesystem paths, credential-bearing URLs, and raw multi-line content.
///
/// # Errors
/// [`RecordError`] describing the first violated bound.
pub fn validate_bounded_id(s: &str) -> Result<(), RecordError> {
    if s.is_empty() {
        return Err(RecordError::EmptyIdentifier);
    }
    if s.len() > MAX_BOUNDED_ID_LEN {
        return Err(RecordError::IdentifierTooLong);
    }
    if s.bytes()
        .any(|b| !b.is_ascii_graphic() || b == b'/' || b == b'\\')
    {
        return Err(RecordError::IllegalCharacter);
    }
    Ok(())
}

macro_rules! bounded_id {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);
        impl $name {
            /// Construct a validated bounded identifier.
            ///
            /// # Errors
            /// [`RecordError`] if the token is empty, over-length, or contains an illegal character.
            pub fn new(value: impl Into<String>) -> Result<Self, RecordError> {
                let value = value.into();
                validate_bounded_id(&value)?;
                Ok(Self(value))
            }
            /// Borrow the underlying token.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

bounded_id!(
    /// A bounded, validated approval-record identity (service-private).
    ApprovalRecordId
);
bounded_id!(
    /// A bounded, validated replay-prevention identity (e.g. a consumed nonce id). Not a secret.
    ReplayEvidenceId
);
bounded_id!(
    /// A bounded, validated, opaque evidence reference. Non-authoritative, non-secret; never raw
    /// evidence content, a path, or a URL.
    EvidenceRef
);

/// A bounded, deduplicated collection of opaque evidence references retained on a durable record.
/// Count-bounded by [`MAX_EVIDENCE_REFS`]; each entry length-bounded by [`EvidenceRef`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EvidenceReferences(Vec<EvidenceRef>);

impl EvidenceReferences {
    /// An empty collection.
    #[must_use]
    pub fn new() -> Self {
        Self(Vec::new())
    }

    /// Build from a list, rejecting an over-limit count or any duplicate.
    ///
    /// # Errors
    /// [`RecordError::TooManyEvidenceReferences`] or [`RecordError::DuplicateEvidenceReference`].
    pub fn from_refs(refs: Vec<EvidenceRef>) -> Result<Self, RecordError> {
        let mut out = Self::new();
        for r in refs {
            out.push(r)?;
        }
        Ok(out)
    }

    /// Append one reference, rejecting an over-limit count or a duplicate (deterministic).
    ///
    /// # Errors
    /// [`RecordError::TooManyEvidenceReferences`] or [`RecordError::DuplicateEvidenceReference`].
    pub fn push(&mut self, r: EvidenceRef) -> Result<(), RecordError> {
        if self.0.len() >= MAX_EVIDENCE_REFS {
            return Err(RecordError::TooManyEvidenceReferences);
        }
        if self.0.contains(&r) {
            return Err(RecordError::DuplicateEvidenceReference);
        }
        self.0.push(r);
        Ok(())
    }

    /// Borrow the references.
    #[must_use]
    pub fn as_slice(&self) -> &[EvidenceRef] {
        &self.0
    }
    /// Number of references.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// Whether empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

macro_rules! service_id {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);
        impl $name {
            /// Wrap an adapter-supplied identifier. Service-private; never serialized on the wire.
            #[must_use]
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }
            /// Borrow the underlying token.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

macro_rules! service_num {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub struct $name(pub u64);
    };
}

service_id!(
    /// A validated release identity (service-private).
    ReleaseId
);
service_id!(
    /// A validated installation identity (service-private).
    InstallationId
);
service_id!(
    /// A validated repository identity/reference (service-private).
    RepositoryRef
);
service_id!(
    /// An authenticated-session identity (service-private, ephemeral).
    SessionId
);
service_id!(
    /// A validated executable-artefact identity (service-private). A future adapter derives it from
    /// canonical path + volume serial + file index + size + content/manifest identity; the pure core
    /// only holds the bounded value.
    ExecutableIdentity
);
service_id!(
    /// An approved publisher / signer identity (service-private). NOT a certificate.
    PublisherIdentity
);
service_id!(
    /// A publisher-policy document identity (service-private).
    PolicyId
);

service_num!(
    /// A publisher/manifest policy revision (opaque, monotonic).
    PolicyRevision
);
service_num!(
    /// A protected revocation revision (opaque, monotonic).
    RevocationRevision
);
service_num!(
    /// A protected emergency-state revision (opaque, monotonic).
    EmergencyStateRevision
);
service_num!(
    /// An opaque expiry boundary; its interpretation is supplied by the future service adapter.
    ExpiryBoundary
);
service_num!(
    /// The minimum accepted release floor (opaque, monotonic).
    ReleaseFloor
);
service_num!(
    /// The minimum accepted policy floor (opaque, monotonic).
    PolicyFloor
);

/// The acceptance outcome of a publisher-policy evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyOutcome {
    /// The signer matched the approved publisher policy.
    Accepted,
    /// The signer did not satisfy the policy.
    Refused,
}

/// Whether the authority is still within its validity boundary, as asserted by the adapter (which
/// holds the clock). The pure core does not evaluate wall-clock time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidityStatus {
    /// Within validity.
    Valid,
    /// Past its expiry boundary.
    Expired,
}

/// A revocation status. `Unknown` (the default) fails closed and is never treated as active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RevocationStatus {
    /// Active at the given revision.
    Active(RevocationRevision),
    /// Explicitly revoked.
    Revoked,
    /// Could not be confirmed.
    #[default]
    Unknown,
}

/// The lifecycle state of a credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialLifecycle {
    /// Active.
    Active,
    /// Expired.
    Expired,
    /// Revoked.
    Revoked,
}

/// Validated authenticated-session identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedSession {
    /// The session this fact set is bound to.
    pub session: SessionId,
}

/// Validated client-process identity, bound to an authenticated session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProcess {
    /// The session the verified process is bound to.
    pub session: SessionId,
}

/// Validated executable identity (explicit — never inferred from process/installation/release).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedExecutable {
    /// The exact verified executable artefact identity.
    pub identity: ExecutableIdentity,
    /// The installation the verified executable belongs to (consistency cross-check).
    pub installation: InstallationId,
}

/// Validated release identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedRelease {
    /// The verified release.
    pub release: ReleaseId,
}

/// Validated installation identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedInstallation {
    /// The verified installation.
    pub installation: InstallationId,
}

/// Validated project + repository identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProjectContext {
    /// The verified project.
    pub project: ProjectId,
    /// The verified repository.
    pub repository: RepositoryRef,
}

/// Validated environment identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedEnvironment {
    /// The verified environment.
    pub environment: EnvironmentId,
}

/// Validated publisher-policy fact (explicit — never collapsed into `InstallationId`). No raw
/// certificate or trust-root material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedPublisherPolicy {
    /// Policy-document identity.
    pub policy_id: PolicyId,
    /// Policy revision.
    pub policy_revision: PolicyRevision,
    /// Approved publisher / signer identity.
    pub publisher: PublisherIdentity,
    /// Installation the policy result applies to.
    pub installation: InstallationId,
    /// Acceptance outcome.
    pub outcome: PolicyOutcome,
    /// Protected revocation revision at evaluation time.
    pub revocation_revision: RevocationRevision,
}

/// Validated freshness fact (explicit — never collapsed into `ReleaseId`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedFreshness {
    /// Verified release.
    pub release: ReleaseId,
    /// Minimum accepted release floor.
    pub release_floor: ReleaseFloor,
    /// Protected policy revision.
    pub policy_revision: PolicyRevision,
    /// Minimum accepted policy floor.
    pub policy_floor: PolicyFloor,
    /// Emergency revocation floor/revision.
    pub emergency_revocation_floor: RevocationRevision,
}

/// The authority-validity + revocation + emergency-revision snapshot supplied by the adapter (which
/// holds the clock and protected state).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoritySnapshot {
    /// The authority/permit expiry boundary.
    pub authority_expiry: ExpiryBoundary,
    /// The operation expiry boundary, where applicable.
    pub operation_expiry: Option<ExpiryBoundary>,
    /// Whether the authority is still valid (adapter-evaluated).
    pub validity: ValidityStatus,
    /// The protected revocation status.
    pub revocation: RevocationStatus,
    /// The protected emergency-state revision.
    pub emergency_state_revision: EmergencyStateRevision,
}

/// Emergency-stop state as read from protected state. Truthful and fail-closed: a reader that cannot
/// confirm the state reports `Unknown` (NOT a falsified `Stopped` and NOT `Clear`). The default is
/// `Unknown`. The reducer denies on both `Stopped` and `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EmergencyStopState {
    /// Confirmed not engaged.
    Clear,
    /// Confirmed engaged — all eligibility is refused.
    Stopped,
    /// The state could not be read/confirmed. Fail closed, but do not misreport as `Stopped`.
    #[default]
    Unknown,
}

/// The permitted scope + lifecycle of an available credential (metadata only — NEVER the value).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialScope {
    /// The credential reference (opaque; not a value).
    pub credential: CredentialRef,
    /// Project the credential is bound to.
    pub project: ProjectId,
    /// Environment the credential is bound to.
    pub environment: EnvironmentId,
    /// Provider the credential is bound to.
    pub provider: ProviderId,
    /// The single operation the credential is permitted for.
    pub permitted_operation: OperationName,
    /// Lifecycle state.
    pub lifecycle: CredentialLifecycle,
    /// Expiry boundary.
    pub expiry: ExpiryBoundary,
    /// Protected revocation revision.
    pub revocation_revision: RevocationRevision,
}

/// Service-validated credential availability. Never contains the raw value. A missing reading
/// defaults to `Missing` (setup required), never `Available`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum CredentialOutcome {
    /// The operation needs no credential.
    NotRequired,
    /// Required but not registered — the owner must set it up locally.
    #[default]
    Missing,
    /// Available within a permitted scope.
    Available(CredentialScope),
    /// Registered but expired.
    Expired,
    /// Registered but revoked.
    Revoked,
}

/// The full set of service-validated facts for one candidate connection + requested operation. A
/// `None`/absent fact is treated by the reducer as "not verified" and denies. NOT serializable.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServiceValidatedFacts {
    /// The phase-binding proof: the phase these facts were validated for. `None` means the adapter did
    /// not bind a phase, which the reducer treats as not verified and denies. The reducer additionally
    /// refuses when the bound phase is not the operation's phase, so facts from another phase fail
    /// closed.
    pub phase: Option<crate::phase::PhaseId>,
    /// The validated approved-plan fact (Tier 2), produced only from a reloaded + revalidated committed
    /// plan record. `None` by default; for a plan-governed operation the reducer denies unless this is
    /// present, active and bound to the operation's required approved plan.
    pub approved_plan: Option<crate::plan::ValidatedApprovedPlan>,
    /// Validated authenticated session.
    pub session: Option<ValidatedSession>,
    /// Validated client process.
    pub process: Option<ValidatedProcess>,
    /// Validated executable.
    pub executable: Option<ValidatedExecutable>,
    /// Validated release.
    pub release: Option<ValidatedRelease>,
    /// Validated installation.
    pub installation: Option<ValidatedInstallation>,
    /// Validated project/repository.
    pub project: Option<ValidatedProjectContext>,
    /// Validated environment.
    pub environment: Option<ValidatedEnvironment>,
    /// Validated publisher policy.
    pub publisher_policy: Option<ValidatedPublisherPolicy>,
    /// Validated freshness.
    pub freshness: Option<ValidatedFreshness>,
    /// Authority validity/revocation/emergency-revision snapshot.
    pub authority: Option<AuthoritySnapshot>,
    /// Owner-approval outcome.
    pub approval: ApprovalOutcome,
    /// Credential-availability outcome.
    pub credential: CredentialOutcome,
    /// Emergency-stop state.
    pub emergency_stop: EmergencyStopState,
}
