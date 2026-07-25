//! The fail-closed authority reducer. Default is DENIED. Only the eligible disposition carries a
//! service-private [`ExecutionPermit`], and only when the COMPLETE eligible verified context can be
//! assembled. Authority is NEVER derived from an [`OperationRef`], candidate request fields, candidate
//! status, UI state, a response projection, an approval reference alone, or a credential reference
//! alone. No observation feeds the reducer directly.

use crate::approval::{ApprovalOutcome, VerifiedApproval};
use crate::capability::{AuthorityValidity, ExecutionPermit, VerifiedExecutionContext};
use crate::error::{BindingKind, DenialReason, MissingFact, RepositoryBinding};
use crate::facts::{
    CredentialLifecycle, CredentialOutcome, CredentialScope, EmergencyStopState, InstallationId,
    PolicyOutcome, RepositoryRef, RevocationStatus, ServiceValidatedFacts, ValidityStatus,
};
use crate::operation::{InternalOperationRecord, OperationBinding, OperationState};
use projectos_trust_contract::OperationRef;

/// A reduction request: the requested operation identity + record disposition. Borrowed so the core
/// never takes ownership of durable state.
pub struct ReductionRequest<'a> {
    /// Durable lookup reference (non-authoritative).
    pub operation_ref: &'a OperationRef,
    /// The exact operation binding.
    pub binding: &'a OperationBinding,
    /// The protected repository the record is bound to.
    pub repository: &'a RepositoryRef,
    /// The installation identity the record requires.
    pub required_installation: &'a InstallationId,
    /// The current operation state.
    pub state: OperationState,
    /// Whether owner approval is required.
    pub approval_required: bool,
    /// Whether a credential is required.
    pub credential_required: bool,
    /// The Tier-2 approved plan this operation is governed by, if any.
    pub required_plan: Option<&'a crate::plan::ApprovedPlanBinding>,
    /// The requested-operation policy evaluated against the approved definition, if plan-governed.
    pub requested_policy: Option<&'a crate::plan::RequestedOperationPolicy>,
    /// The Tier-2 repository policy this operation is governed by, if any.
    pub required_repository: Option<&'a crate::repository::RequiredRepository>,
}

impl InternalOperationRecord {
    /// Borrow this record as a reduction request.
    #[must_use]
    pub fn to_request(&self) -> ReductionRequest<'_> {
        ReductionRequest {
            operation_ref: &self.operation_ref,
            binding: &self.binding,
            repository: &self.repository,
            required_installation: &self.required_installation,
            state: self.state,
            approval_required: self.approval_required,
            credential_required: self.credential_required,
            required_plan: self.required_plan.as_ref(),
            requested_policy: self.requested_policy.as_ref(),
            required_repository: self.required_repository.as_ref(),
        }
    }
}

/// The reducer's disposition. Only [`Disposition::EligibleForServiceExecution`] carries authority.
///
/// The eligible variant intentionally carries the full [`ExecutionPermit`] (which retains the
/// complete verified context) by value rather than behind a `Box`: a disposition is short-lived and
/// consumed immediately by the service, and keeping the permit inline avoids an allocation and keeps
/// the API ergonomic. The size asymmetry is accepted.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Disposition {
    /// Refused, with a reason. The default outcome.
    Denied(DenialReason),
    /// A credential must be set up locally before proceeding.
    SetupRequired,
    /// Owner approval is required before proceeding.
    ApprovalRequired,
    /// The operation must be freshly revalidated before proceeding.
    RevalidationRequired,
    /// Eligible: carries the service-private execution permit.
    EligibleForServiceExecution(ExecutionPermit),
}

/// Reduce validated facts to a disposition. Fail closed on ANY missing/unverified/mismatched/refused/
/// expired/revoked/unknown/stale/emergency/cross-bound condition.
#[must_use]
pub fn reduce(req: &ReductionRequest<'_>, facts: &ServiceValidatedFacts) -> Disposition {
    // 1. State gate.
    match req.state {
        OperationState::Revoked => return Disposition::Denied(DenialReason::Revoked),
        OperationState::Expired => return Disposition::Denied(DenialReason::Expired),
        OperationState::Completed | OperationState::Failed | OperationState::Executing => {
            return Disposition::Denied(DenialReason::UnusableState(req.state))
        }
        OperationState::NeedsRevalidation => return Disposition::RevalidationRequired,
        OperationState::Created
        | OperationState::SetupRequired
        | OperationState::ApprovalRequired
        | OperationState::ReadyForRevalidation
        | OperationState::EligibleForExecution => {}
    }

    // 2. Emergency stop — truthful and fail closed.
    match facts.emergency_stop {
        EmergencyStopState::Stopped => return Disposition::Denied(DenialReason::EmergencyStopped),
        EmergencyStopState::Unknown => {
            return Disposition::Denied(DenialReason::EmergencyStopUnverified)
        }
        EmergencyStopState::Clear => {}
    }

    // 3. Required facts must all be present (absent == not verified).
    let session = match &facts.session {
        Some(s) => s,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Session)),
    };
    let process = match &facts.process {
        Some(p) => p,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Process)),
    };
    let executable = match &facts.executable {
        Some(e) => e,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Executable)),
    };
    let release = match &facts.release {
        Some(r) => r,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Release)),
    };
    let installation = match &facts.installation {
        Some(i) => i,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Installation)),
    };
    let project = match &facts.project {
        Some(p) => p,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Project)),
    };
    let environment = match &facts.environment {
        Some(e) => e,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Environment)),
    };
    let publisher_policy = match &facts.publisher_policy {
        Some(p) => p,
        None => {
            return Disposition::Denied(DenialReason::MissingFact(MissingFact::PublisherPolicy))
        }
    };
    let freshness = match &facts.freshness {
        Some(f) => f,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Freshness)),
    };
    let authority = match &facts.authority {
        Some(a) => a,
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Authority)),
    };

    // 4. Identity + policy binding checks.
    if process.session != session.session {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Session));
    }
    if executable.installation != installation.installation {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Executable));
    }
    if installation.installation != *req.required_installation {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Installation));
    }
    if publisher_policy.installation != installation.installation {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Installation));
    }
    if publisher_policy.outcome != PolicyOutcome::Accepted {
        return Disposition::Denied(DenialReason::PublisherPolicyRefused);
    }
    // Phase-binding proof: the facts must have been validated FOR this operation's phase. Absent →
    // not verified; a different phase → facts from another phase. Both fail closed.
    match &facts.phase {
        Some(p) if *p == req.binding.phase => {}
        Some(_) => return Disposition::Denied(DenialReason::Mismatch(BindingKind::Phase)),
        None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Phase)),
    }
    // Tier-2 approved-plan enforcement — ONLY for a plan-governed operation. The validated plan fact
    // must be present, ACTIVE and bound EXACTLY to the operation's required approved plan (reference,
    // version, digest, project, environment and phase are all inside the binding), and the requested
    // operation policy must be authorised by the approved definition (scope/path/action/deps/preds).
    let plan_fact = if let Some(required) = req.required_plan {
        let fact = match &facts.approved_plan {
            Some(f) if f.is_active_for(required) => f,
            Some(_) => {
                return Disposition::Denied(DenialReason::Mismatch(BindingKind::ApprovedPlan))
            }
            None => {
                return Disposition::Denied(DenialReason::MissingFact(MissingFact::ApprovedPlan))
            }
        };
        if let Some(policy) = req.requested_policy {
            if let Err(refusal) = fact.authorises(policy) {
                return Disposition::Denied(DenialReason::PlanPolicyRefused(refusal));
            }
        }
        Some(fact)
    } else {
        None
    };
    // Tier-2 repository enforcement — ONLY for a repository-governed operation. The verified baseline
    // fact must be present and satisfy the operation's required repository policy EXACTLY (identity,
    // root, commit, branch, cleanliness, divergence, tracking, freshness, submodule). The policy is
    // folded into the fingerprint, so a fact/policy for another repository yields a fingerprint mismatch.
    let repository_fact = if let Some(required) = req.required_repository {
        let fact = match &facts.repository {
            Some(f) => f,
            None => return Disposition::Denied(DenialReason::MissingFact(MissingFact::Repository)),
        };
        // Fact-binding checks — the fact must be bound to THIS exact operation, so a baseline verified
        // for one operation can never be replayed through a fact bound to another. Checked BEFORE the
        // repository policy. Each dimension has its own distinct, payload-free refusal.
        if fact.project() != &req.binding.project {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Project,
            ));
        }
        if fact.environment() != &req.binding.environment {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Environment,
            ));
        }
        if fact.phase() != &req.binding.phase {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Phase,
            ));
        }
        if fact.plan_binding() != req.required_plan {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Plan,
            ));
        }
        if fact.operation() != req.operation_ref {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Operation,
            ));
        }
        if fact.fingerprint() != &req.binding.fingerprint {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Fingerprint,
            ));
        }
        // Fact↔baseline consistency: the cached generation/freshness must equal the embedded baseline's
        // (identity and every other baseline field are re-checked by satisfies() below).
        if fact.generation() != fact.baseline().generation() {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Generation,
            ));
        }
        if fact.freshness() != fact.baseline().freshness() {
            return Disposition::Denied(DenialReason::RepositoryFactMismatch(
                RepositoryBinding::Freshness,
            ));
        }
        // Only after the fact is proven bound to this operation may the baseline be evaluated against the
        // required repository policy (identity/root/commit/branch/cleanliness/divergence/freshness/submodule).
        if let Err(refusal) = fact.baseline().satisfies(required) {
            return Disposition::Denied(DenialReason::RepositoryPolicyRefused(refusal));
        }
        Some(fact)
    } else {
        None
    };
    if project.project != req.binding.project {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Project));
    }
    if project.repository != *req.repository {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Repository));
    }
    if environment.environment != req.binding.environment {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Environment));
    }
    if release.release != req.binding.release {
        return Disposition::Denied(DenialReason::Mismatch(BindingKind::Release));
    }
    if freshness.release != req.binding.release {
        return Disposition::Denied(DenialReason::Stale);
    }

    // 5. Authority validity + revocation.
    if authority.validity != ValidityStatus::Valid {
        return Disposition::Denied(DenialReason::AuthorityExpired);
    }
    let revocation_revision = match authority.revocation {
        RevocationStatus::Active(rev) => rev,
        RevocationStatus::Revoked => return Disposition::Denied(DenialReason::Revoked),
        RevocationStatus::Unknown => return Disposition::Denied(DenialReason::RevocationUnknown),
    };

    // 6. Credential.
    let mut matched_credential: Option<CredentialScope> = None;
    if req.credential_required {
        match &facts.credential {
            CredentialOutcome::Available(scope) => {
                if scope.project != req.binding.project
                    || scope.environment != req.binding.environment
                    || scope.provider != req.binding.provider
                    || scope.permitted_operation != req.binding.operation
                {
                    return Disposition::Denied(DenialReason::CredentialScopeMismatch);
                }
                match scope.lifecycle {
                    CredentialLifecycle::Active => {}
                    CredentialLifecycle::Expired => {
                        return Disposition::Denied(DenialReason::Expired)
                    }
                    CredentialLifecycle::Revoked => {
                        return Disposition::Denied(DenialReason::Revoked)
                    }
                }
                matched_credential = Some(scope.clone());
            }
            CredentialOutcome::Missing | CredentialOutcome::NotRequired => {
                return Disposition::SetupRequired;
            }
            CredentialOutcome::Expired => return Disposition::Denied(DenialReason::Expired),
            CredentialOutcome::Revoked => return Disposition::Denied(DenialReason::Revoked),
        }
    }

    // 7. Approval.
    let mut matched_approval: Option<VerifiedApproval> = None;
    if req.approval_required {
        match &facts.approval {
            ApprovalOutcome::Verified(a) => {
                if a.phase != req.binding.phase
                    || a.project != req.binding.project
                    || a.environment != req.binding.environment
                    || a.provider != req.binding.provider
                    || a.operation != req.binding.operation
                    || a.fingerprint != req.binding.fingerprint
                    || a.release != req.binding.release
                    || a.repository.as_ref().is_some_and(|r| r != req.repository)
                {
                    return Disposition::Denied(DenialReason::ApprovalBindingMismatch);
                }
                if !matches!(a.revocation, RevocationStatus::Active(_)) {
                    return Disposition::Denied(DenialReason::ApprovalRevoked);
                }
                matched_approval = Some(a.clone());
            }
            ApprovalOutcome::Absent | ApprovalOutcome::Pending | ApprovalOutcome::NotRequired => {
                return Disposition::ApprovalRequired;
            }
            ApprovalOutcome::Expired => return Disposition::Denied(DenialReason::ApprovalExpired),
            ApprovalOutcome::Revoked => return Disposition::Denied(DenialReason::ApprovalRevoked),
            ApprovalOutcome::BindingMismatch => {
                return Disposition::Denied(DenialReason::ApprovalBindingMismatch)
            }
        }
    }

    // 8. Assemble the complete verified context and mint the permit.
    let context = VerifiedExecutionContext {
        phase: req.binding.phase.clone(),
        approved_plan: plan_fact.map(|f| f.binding().clone()),
        approved_plan_status: plan_fact.map(crate::plan::ValidatedApprovedPlan::status),
        approved_plan_status_revision: plan_fact
            .map(crate::plan::ValidatedApprovedPlan::status_revision),
        repository_baseline: repository_fact.map(|f| f.baseline().clone()),
        repository_generation: repository_fact
            .map(crate::repository::ValidatedRepositoryFact::generation),
        repository_freshness: repository_fact
            .map(crate::repository::ValidatedRepositoryFact::freshness),
        session: session.session.clone(),
        process_session: process.session.clone(),
        executable: executable.identity.clone(),
        installation: installation.installation.clone(),
        release: req.binding.release.clone(),
        repository: req.repository.clone(),
        project: req.binding.project.clone(),
        environment: req.binding.environment.clone(),
        provider: req.binding.provider.clone(),
        operation: req.binding.operation.clone(),
        fingerprint: req.binding.fingerprint.clone(),
        publisher_policy: publisher_policy.clone(),
        freshness: freshness.clone(),
        authority: AuthorityValidity {
            authority_expiry: authority.authority_expiry,
            operation_expiry: authority.operation_expiry,
            revocation_revision,
        },
        emergency_state: EmergencyStopState::Clear,
        emergency_state_revision: authority.emergency_state_revision,
        approval: matched_approval,
        credential: matched_credential,
    };
    Disposition::EligibleForServiceExecution(ExecutionPermit::mint(
        req.operation_ref.clone(),
        context,
    ))
}
