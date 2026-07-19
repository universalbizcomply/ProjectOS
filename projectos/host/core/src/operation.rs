//! Operation binding, the durable service-private operation record, and the operation state machine.

use crate::error::{RecordError, RevocationReason, TransitionError};
use crate::facts::{
    EvidenceReferences, ExpiryBoundary, InstallationId, ReleaseId, RepositoryRef, RevocationStatus,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

/// How a blocked operation may be resumed after setup/approval/reconnect/restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResumePolicy {
    /// The operation may not be resumed; it must be started afresh.
    NoResume,
    /// The operation may resume only after a fresh, full revalidation.
    ResumeAfterRevalidation,
}

/// The durable policy + lifetime a record is created with. Grouped so the constructor stays small.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordPolicy {
    /// Whether owner approval is required before execution.
    pub approval_required: bool,
    /// Whether a project/environment credential is required before execution.
    pub credential_required: bool,
    /// How the operation may be resumed after a block.
    pub resume_policy: ResumePolicy,
    /// The operation's expiry boundary (explicit durable metadata, not just a terminal state).
    pub operation_expiry: ExpiryBoundary,
}

/// The exact operation an operation record is about. Every dimension the reducer binds against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationBinding {
    /// Project.
    pub project: ProjectId,
    /// Environment.
    pub environment: EnvironmentId,
    /// Provider.
    pub provider: ProviderId,
    /// Operation name.
    pub operation: OperationName,
    /// Exact operation fingerprint.
    pub fingerprint: OperationFingerprint,
    /// Required release identity.
    pub release: ReleaseId,
}

/// The explicit operation lifecycle. Names never imply an external side effect occurred unless
/// proven (`COMPLETED`) or unknown (`NEEDS_REVALIDATION`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationState {
    /// Record created.
    Created,
    /// Blocked pending local credential setup.
    SetupRequired,
    /// Blocked pending owner approval.
    ApprovalRequired,
    /// Ready to be freshly revalidated (e.g. after reconnect/restart/setup/approval).
    ReadyForRevalidation,
    /// Revalidated and eligible to execute.
    EligibleForExecution,
    /// Executing.
    Executing,
    /// External outcome uncertain — must be revalidated before any further action.
    NeedsRevalidation,
    /// Completed (proven).
    Completed,
    /// Failed.
    Failed,
    /// Revoked.
    Revoked,
    /// Expired.
    Expired,
}

impl OperationState {
    /// A terminal state cannot transition to any active state.
    #[must_use]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            OperationState::Completed
                | OperationState::Failed
                | OperationState::Revoked
                | OperationState::Expired
        )
    }

    /// Whether a transition to `to` is allowed. Unknown/disallowed transitions are rejected.
    #[must_use]
    pub fn can_transition_to(self, to: OperationState) -> bool {
        use OperationState::{
            ApprovalRequired, Completed, Created, EligibleForExecution, Executing, Expired, Failed,
            NeedsRevalidation, ReadyForRevalidation, Revoked, SetupRequired,
        };
        // Any non-terminal state may be revoked or expire.
        if !self.is_terminal() && matches!(to, Revoked | Expired) {
            return true;
        }
        matches!(
            (self, to),
            (Created, SetupRequired)
                | (Created, ApprovalRequired)
                | (Created, ReadyForRevalidation)
                | (SetupRequired, ReadyForRevalidation)
                | (ApprovalRequired, ReadyForRevalidation)
                | (ReadyForRevalidation, EligibleForExecution)
                | (EligibleForExecution, Executing)
                | (Executing, Completed)
                | (Executing, Failed)
                | (Executing, NeedsRevalidation)
                | (NeedsRevalidation, ReadyForRevalidation)
        )
    }

    /// Apply a transition, or fail closed.
    ///
    /// # Errors
    /// [`TransitionError`] if the transition is not allowed.
    pub fn transition(self, to: OperationState) -> Result<OperationState, TransitionError> {
        if self.can_transition_to(to) {
            Ok(to)
        } else {
            Err(TransitionError { from: self, to })
        }
    }
}

/// The durable, service-private operation record. Located by the authority-free [`OperationRef`]; the
/// reference is a lookup key only and carries no authority. NOT serializable in this phase
/// (persistence serialization belongs to a later protected-storage contract). Contains no raw
/// credential, provider token, candidate-supplied authority, transferable capability, raw
/// owner-authentication material, or unrestricted JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalOperationRecord {
    /// Durable lookup reference (non-authoritative).
    pub operation_ref: OperationRef,
    /// The exact operation binding (project/environment/provider/operation/fingerprint/release).
    pub binding: OperationBinding,
    /// The protected repository this operation is bound to. A different repository can never satisfy
    /// this record.
    pub repository: RepositoryRef,
    /// The installation identity this operation requires. A different installation can never satisfy
    /// this record.
    pub required_installation: InstallationId,
    /// Current operation state. Terminal `Expired`/`Revoked` are outcomes — NOT the only place the
    /// underlying lifetime/revocation facts live (see `operation_expiry` + `revocation`).
    pub state: OperationState,
    /// Whether owner approval is required before execution.
    pub approval_required: bool,
    /// Whether a project/environment credential is required before execution.
    pub credential_required: bool,
    /// How the operation may be resumed after a block.
    pub resume_policy: ResumePolicy,
    /// Explicit durable operation expiry boundary.
    pub operation_expiry: ExpiryBoundary,
    /// Explicit durable revocation state (independent of the terminal `Revoked` state).
    pub revocation: RevocationStatus,
    /// Typed, closed revocation reason — present iff revoked. No free text.
    pub revocation_reason: Option<RevocationReason>,
    /// Bounded, deduplicated, opaque evidence references gathered so far.
    pub evidence_refs: EvidenceReferences,
}

impl InternalOperationRecord {
    /// Create a fresh record in [`OperationState::Created`], with an active (un-revoked) revocation
    /// state at revision 0.
    #[must_use]
    pub fn new(
        operation_ref: OperationRef,
        binding: OperationBinding,
        repository: RepositoryRef,
        required_installation: InstallationId,
        policy: RecordPolicy,
    ) -> Self {
        Self {
            operation_ref,
            binding,
            repository,
            required_installation,
            state: OperationState::Created,
            approval_required: policy.approval_required,
            credential_required: policy.credential_required,
            resume_policy: policy.resume_policy,
            operation_expiry: policy.operation_expiry,
            revocation: RevocationStatus::Active(crate::facts::RevocationRevision(0)),
            revocation_reason: None,
            evidence_refs: EvidenceReferences::new(),
        }
    }

    /// Mark the record revoked with a typed reason (also sets the terminal `Revoked` state where the
    /// current transition allows it; the reason and metadata persist regardless).
    ///
    /// # Errors
    /// [`TransitionError`] if the record cannot transition to `Revoked` from its current state.
    pub fn revoke(&mut self, reason: RevocationReason) -> Result<(), TransitionError> {
        self.revocation = RevocationStatus::Revoked;
        self.revocation_reason = Some(reason);
        self.advance(OperationState::Revoked)
    }

    /// Validate the durable metadata is internally consistent. Fail-closed on contradictory combos.
    ///
    /// # Errors
    /// [`RecordError::RevocationReasonUnexpected`] if an `Active` record carries a reason;
    /// [`RecordError::RevocationReasonMissing`] if a `Revoked` record has no reason.
    pub fn validate(&self) -> Result<(), RecordError> {
        match self.revocation {
            RevocationStatus::Active(_) => {
                if self.revocation_reason.is_some() {
                    return Err(RecordError::RevocationReasonUnexpected);
                }
            }
            RevocationStatus::Revoked => {
                if self.revocation_reason.is_none() {
                    return Err(RecordError::RevocationReasonMissing);
                }
            }
            // Unknown: the protected status is unresolved; a reason is not required. The reducer never
            // grants eligibility on an Unknown authority revocation.
            RevocationStatus::Unknown => {}
        }
        Ok(())
    }

    /// Advance the record's state, failing closed on a disallowed transition.
    ///
    /// # Errors
    /// [`TransitionError`] if the transition is not allowed.
    pub fn advance(&mut self, to: OperationState) -> Result<(), TransitionError> {
        self.state = self.state.transition(to)?;
        Ok(())
    }
}
