//! Operation binding, the durable service-private operation record, and the operation state machine.

use crate::error::{RecordError, RevocationReason, TransitionError};
use crate::facts::{
    EvidenceReferences, ExpiryBoundary, InstallationId, ReleaseId, RepositoryRef, RevocationStatus,
};
use crate::phase::{derive_operation_fingerprint, PhaseId, PhaseReference};
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

/// The caller/adapter-supplied operation inputs, WITHOUT a phase. A phase cannot be supplied here: the
/// authoritative [`PhaseId`] is minted by the operation-creation authority, never chosen by the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationInputs {
    /// Project.
    pub project: ProjectId,
    /// Environment.
    pub environment: EnvironmentId,
    /// Provider.
    pub provider: ProviderId,
    /// Operation name.
    pub operation: OperationName,
    /// Base operation fingerprint (before the phase is folded in).
    pub fingerprint: OperationFingerprint,
    /// Required release identity.
    pub release: ReleaseId,
}

/// The exact operation an operation record is about. Every dimension the reducer binds against.
///
/// `phase` is the authoritative, service-issued [`PhaseId`], and `fingerprint` is the PHASE-BOUND
/// fingerprint (the base fingerprint folded with the phase). A binding with a different phase differs
/// from another even when every other human-readable field matches, because both `phase` and the
/// folded `fingerprint` differ. The struct is built ONLY by the operation-creation authority
/// ([`InternalOperationRecord::new`]); a caller cannot originate a `PhaseId`, so it cannot fabricate a
/// binding with a chosen phase.
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
    /// Phase-bound operation fingerprint (base fingerprint folded with the phase identity).
    pub fingerprint: OperationFingerprint,
    /// Required release identity.
    pub release: ReleaseId,
    /// The authoritative, service-issued phase identity this operation belongs to.
    pub phase: PhaseId,
}

impl OperationBinding {
    /// The authoritative phase identity.
    #[must_use]
    pub fn phase(&self) -> &PhaseId {
        &self.phase
    }
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
    /// The Tier-2 approved-plan this operation is GOVERNED by. `None` = not plan-governed (the reducer
    /// applies no plan check). Once set by [`InternalOperationRecord::bind_approved_plan`] it is
    /// immutable — the operation cannot replace its plan binding.
    pub required_plan: Option<crate::plan::ApprovedPlanBinding>,
    /// The requested-operation policy (action/scope/paths/deps/preds) evaluated against the approved
    /// definition. Present iff `required_plan` is set. Folded into the fingerprint.
    pub requested_policy: Option<crate::plan::RequestedOperationPolicy>,
    /// The Tier-2 repository policy this operation is GOVERNED by. `None` = not repository-governed (the
    /// reducer applies no repository check). Set once by [`InternalOperationRecord::bind_repository`],
    /// immutable thereafter, and folded into the fingerprint.
    pub required_repository: Option<crate::repository::RequiredRepository>,
    /// The owner-presence policy this operation is GOVERNED by. `None` = owner presence not required (the
    /// reducer applies no owner-presence check). Set once by
    /// [`InternalOperationRecord::bind_owner_presence`], immutable thereafter, and folded into the
    /// fingerprint (so changing the requirement invalidates prior approval and permit authority).
    pub required_owner_presence: Option<crate::owner_presence::RequiredOwnerPresence>,
    /// The elevation policy this operation is GOVERNED by. `None` = elevation not required (the reducer
    /// applies no elevation check). Set once by [`InternalOperationRecord::bind_elevation`], immutable
    /// thereafter, and folded into the fingerprint (so changing the requirement invalidates prior approval
    /// and permit authority).
    pub required_elevation: Option<crate::elevation::RequiredElevation>,
    /// The protected-effect policy this operation is governed by. `None` = no protected effect. Set once
    /// by [`InternalOperationRecord::bind_effect`], immutable thereafter, and folded into the fingerprint
    /// (so changing the effect family/target/argument invalidates prior approval, permit and grant).
    pub required_effect: Option<crate::effect::RequiredEffect>,
}

impl InternalOperationRecord {
    /// Create a fresh record in [`OperationState::Created`], with an active (un-revoked) revocation
    /// state at revision 0.
    ///
    /// This is the operation-creation authority and the ONLY phase-issuance path: it mints the
    /// authoritative [`PhaseId`] from the verified project, environment and the non-authoritative
    /// `phase_reference`, folds the phase into the base fingerprint, and stamps both into the stored
    /// binding. The `phase_reference` names a phase; it does not select an authority.
    #[must_use]
    pub fn new(
        operation_ref: OperationRef,
        inputs: OperationInputs,
        phase_reference: &PhaseReference,
        repository: RepositoryRef,
        required_installation: InstallationId,
        policy: RecordPolicy,
    ) -> Self {
        let phase = PhaseId::mint(
            &inputs.project,
            &inputs.environment,
            phase_reference,
            &operation_ref,
        );
        let fingerprint = derive_operation_fingerprint(&inputs.fingerprint, &phase);
        let binding = OperationBinding {
            project: inputs.project,
            environment: inputs.environment,
            provider: inputs.provider,
            operation: inputs.operation,
            fingerprint,
            release: inputs.release,
            phase,
        };
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
            required_plan: None,
            requested_policy: None,
            required_repository: None,
            required_owner_presence: None,
            required_elevation: None,
            required_effect: None,
        }
    }

    /// Bind this operation to a Tier-2 approved plan, CONSUMING the record and returning the plan-governed
    /// record. The required plan binding is taken from a service-validated [`ValidatedApprovedPlan`] (a
    /// caller cannot originate one), the requested policy is folded into the fingerprint, and both become
    /// immutable. Must be called at creation (state `Created`) before any transition.
    #[must_use]
    pub fn bind_approved_plan(
        mut self,
        validated: &crate::plan::ValidatedApprovedPlan,
        requested_policy: crate::plan::RequestedOperationPolicy,
    ) -> Self {
        let binding = validated.binding().clone();
        self.binding.fingerprint = crate::plan::fold_operation_fingerprint(
            &self.binding.fingerprint,
            &binding,
            &requested_policy,
        );
        self.required_plan = Some(binding);
        self.requested_policy = Some(requested_policy);
        self
    }

    /// Bind this operation to a Tier-2 REPOSITORY policy, CONSUMING the record. The policy is folded into
    /// the operation fingerprint (so a different repository requirement yields a different fingerprint,
    /// and approval — bound by fingerprint — is transitively repository-bound) and becomes immutable.
    /// Must be called at creation before any transition; there is no setter to replace it after approval.
    #[must_use]
    pub fn bind_repository(mut self, required: crate::repository::RequiredRepository) -> Self {
        self.binding.fingerprint =
            crate::repository::fold_repository_fingerprint(&self.binding.fingerprint, &required);
        self.required_repository = Some(required);
        self
    }

    /// Bind this operation to an OWNER-PRESENCE policy, CONSUMING the record. The requirement is folded
    /// into the operation fingerprint (so a different owner-presence requirement yields a different
    /// fingerprint, and approval — bound by fingerprint — is transitively owner-presence-policy bound)
    /// and becomes immutable. Must be called at creation before any transition.
    #[must_use]
    pub fn bind_owner_presence(
        mut self,
        required: crate::owner_presence::RequiredOwnerPresence,
    ) -> Self {
        self.binding.fingerprint = crate::owner_presence::fold_owner_presence_fingerprint(
            &self.binding.fingerprint,
            &required,
        );
        self.required_owner_presence = Some(required);
        self
    }

    /// Bind this operation to an ELEVATION policy, CONSUMING the record. The requirement (level + minimum
    /// generation) is folded into the operation fingerprint (so a different elevation requirement yields a
    /// different fingerprint, and approval — bound by fingerprint — is transitively elevation-policy bound)
    /// and becomes immutable. The expected process identity is carried but NOT folded (a runtime binding).
    /// Must be called at creation before any transition.
    #[must_use]
    pub fn bind_elevation(mut self, required: crate::elevation::RequiredElevation) -> Self {
        self.binding.fingerprint =
            crate::elevation::fold_elevation_fingerprint(&self.binding.fingerprint, &required);
        self.required_elevation = Some(required);
        self
    }

    /// Bind this operation to a protected-EFFECT policy, CONSUMING the record. The effect requirement
    /// (family + target + argument) is folded into the operation fingerprint (so a different effect yields
    /// a different fingerprint, and approval — bound by fingerprint — is transitively effect-policy bound)
    /// and becomes immutable. Must be called at creation before any transition.
    #[must_use]
    pub fn bind_effect(mut self, required: crate::effect::RequiredEffect) -> Self {
        self.binding.fingerprint =
            crate::effect::fold_effect_fingerprint(&self.binding.fingerprint, &required);
        self.required_effect = Some(required);
        self
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
