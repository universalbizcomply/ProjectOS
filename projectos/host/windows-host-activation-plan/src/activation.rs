//! The deterministic activation SEQUENCE, its governance gates, its failure classification, and the
//! service recovery policy.
//!
//! Every item here is a description of work that a LATER, separately-approved phase may perform.
//! Nothing in this module executes a step: it creates no directory, resolves no known folder, applies
//! no ACL, opens no Service Control Manager, installs/configures/starts no service, writes no
//! registry value, mints no key and reads no credential.
//!
//! ## Governance is structural, not advisory
//!
//! Every step defaults to [`ApprovalStatus::NotAuthorised`]. Steps that can change the system carry
//! `requires_owner_approval == true`, and the sequence will report them as
//! [`ActivationDecision::AwaitingOwnerDecision`] forever unless an explicit owner approval is
//! recorded. Nothing — not a passing test, not a report, not a gatekeeper review, not a previous
//! phase, not this session — advances them on its own.

use crate::error::{ActivationPlanError, ActivationViolation};

/// Who must authorise a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RequiredAuthority {
    /// Reading and checking only; no approval needed.
    PlanOnly,
    /// Murad must approve explicitly.
    OwnerApproval,
    /// Murad must approve, and the operation additionally needs Windows administrator rights.
    OwnerApprovalAndAdministrator,
    /// The gatekeeper must review before anything may proceed.
    GatekeeperReview,
}

/// The kind of system effect a step can have if it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PossibleEffect {
    /// Cannot change the system.
    None,
    /// Creates a filesystem object.
    FilesystemCreate,
    /// Changes a security descriptor.
    AclMutation,
    /// Creates a service (and therefore service-database/registry state).
    ServiceInstallation,
    /// Changes service configuration, startup or recovery.
    ServiceConfiguration,
    /// Starts a running process under a service identity.
    ServiceStart,
    /// Creates or protects key material.
    KeyProvisioning,
    /// Creates or reconciles durable protected state.
    StoreInitialisation,
}

impl PossibleEffect {
    /// Whether the step can change system state at all.
    #[must_use]
    pub fn is_mutating(self) -> bool {
        self != Self::None
    }
}

/// One step of the activation sequence, in canonical order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum ActivationStep {
    /// 1. Verify the repository and the accepted host baseline.
    VerifyBaseline,
    /// 2. Verify the owner-approved activation-plan version.
    VerifyApprovedPlanVersion,
    /// 3. Verify production remains explicitly authorised.
    VerifyProductionAuthorisation,
    /// 4. Resolve the ProgramData known folder through an approved mechanism.
    ResolveKnownFolder,
    /// 5. Verify the intended root does not already conflict.
    VerifyNoRootConflict,
    /// 6. Verify no reparse point or unexpected object occupies the path.
    VerifyNoReparseOrUnexpectedObject,
    /// 7. Install or verify the approved Windows service identity.
    InstallOrVerifyServiceIdentity,
    /// 8. Obtain the authoritative service SID through an approved Windows mechanism.
    ObtainAuthoritativeServiceSid,
    /// 9. Construct the final ACL policy from the resolved principal.
    ComposeFinalAclPolicy,
    /// 10. Create the production root.
    CreateProductionRoot,
    /// 11. Apply the ACL and authoritatively re-read and verify it.
    ApplyAndVerifyAcl,
    /// 12. Establish handle-owned root custody.
    EstablishRootCustody,
    /// 13. Initialise or reconcile the durable protected store.
    InitialiseOrReconcileDurableStore,
    /// 14. Initialise service-only master-key custody.
    InitialiseServiceOnlyKeyCustody,
    /// 15. Configure the Windows service.
    ConfigureWindowsService,
    /// 16. Configure startup type and recovery policy.
    ConfigureStartupAndRecovery,
    /// 17. Start the service — under its own separate gate.
    StartService,
    /// 18. Verify the runtime service identity is the approved one.
    VerifyRuntimeServiceIdentity,
    /// 19. Verify custody and durable-store reopening under that identity.
    VerifyCustodyAndStoreReopen,
    /// 20. Record redacted evidence.
    RecordRedactedEvidence,
    /// 21. Stop for owner and gatekeeper review.
    StopForReview,
}

/// The canonical order. Index in this array IS the dependency order.
const SEQUENCE: [ActivationStep; 21] = [
    ActivationStep::VerifyBaseline,
    ActivationStep::VerifyApprovedPlanVersion,
    ActivationStep::VerifyProductionAuthorisation,
    ActivationStep::ResolveKnownFolder,
    ActivationStep::VerifyNoRootConflict,
    ActivationStep::VerifyNoReparseOrUnexpectedObject,
    ActivationStep::InstallOrVerifyServiceIdentity,
    ActivationStep::ObtainAuthoritativeServiceSid,
    ActivationStep::ComposeFinalAclPolicy,
    ActivationStep::CreateProductionRoot,
    ActivationStep::ApplyAndVerifyAcl,
    ActivationStep::EstablishRootCustody,
    ActivationStep::InitialiseOrReconcileDurableStore,
    ActivationStep::InitialiseServiceOnlyKeyCustody,
    ActivationStep::ConfigureWindowsService,
    ActivationStep::ConfigureStartupAndRecovery,
    ActivationStep::StartService,
    ActivationStep::VerifyRuntimeServiceIdentity,
    ActivationStep::VerifyCustodyAndStoreReopen,
    ActivationStep::RecordRedactedEvidence,
    ActivationStep::StopForReview,
];

impl ActivationStep {
    /// Every step, in canonical order.
    #[must_use]
    pub fn all() -> &'static [ActivationStep] {
        &SEQUENCE
    }

    /// Position in the sequence (0-based).
    #[must_use]
    pub fn order(self) -> usize {
        SEQUENCE
            .iter()
            .position(|s| *s == self)
            .expect("every step is in SEQUENCE")
    }

    /// The immediate prerequisite, if any.
    #[must_use]
    pub fn prerequisite(self) -> Option<ActivationStep> {
        let i = self.order();
        if i == 0 {
            None
        } else {
            Some(SEQUENCE[i - 1])
        }
    }

    /// What this step can change.
    #[must_use]
    pub fn possible_effect(self) -> PossibleEffect {
        use ActivationStep as S;
        match self {
            S::VerifyBaseline
            | S::VerifyApprovedPlanVersion
            | S::VerifyProductionAuthorisation
            | S::ResolveKnownFolder
            | S::VerifyNoRootConflict
            | S::VerifyNoReparseOrUnexpectedObject
            | S::ObtainAuthoritativeServiceSid
            | S::ComposeFinalAclPolicy
            | S::VerifyRuntimeServiceIdentity
            | S::VerifyCustodyAndStoreReopen
            | S::RecordRedactedEvidence
            | S::StopForReview => PossibleEffect::None,
            S::InstallOrVerifyServiceIdentity => PossibleEffect::ServiceInstallation,
            S::CreateProductionRoot => PossibleEffect::FilesystemCreate,
            S::ApplyAndVerifyAcl => PossibleEffect::AclMutation,
            // Opening a handle is observable but changes no persistent state.
            S::EstablishRootCustody => PossibleEffect::None,
            S::InitialiseOrReconcileDurableStore => PossibleEffect::StoreInitialisation,
            S::InitialiseServiceOnlyKeyCustody => PossibleEffect::KeyProvisioning,
            S::ConfigureWindowsService | S::ConfigureStartupAndRecovery => {
                PossibleEffect::ServiceConfiguration
            }
            S::StartService => PossibleEffect::ServiceStart,
        }
    }

    /// Who must authorise it.
    #[must_use]
    pub fn required_authority(self) -> RequiredAuthority {
        use ActivationStep as S;
        match self {
            S::StopForReview => RequiredAuthority::GatekeeperReview,
            S::VerifyProductionAuthorisation => RequiredAuthority::OwnerApproval,
            _ if self.possible_effect().is_mutating() => {
                RequiredAuthority::OwnerApprovalAndAdministrator
            }
            _ => RequiredAuthority::PlanOnly,
        }
    }

    /// Whether an explicit owner approval is required before it may run.
    #[must_use]
    pub fn requires_owner_approval(self) -> bool {
        matches!(
            self.required_authority(),
            RequiredAuthority::OwnerApproval | RequiredAuthority::OwnerApprovalAndAdministrator
        )
    }

    /// What must be independently observed for the step to count as CONFIRMED.
    ///
    /// A successful API call is never sufficient on its own for a mutating step.
    #[must_use]
    pub fn expected_evidence(self) -> &'static str {
        use ActivationStep as S;
        match self {
            S::VerifyBaseline => "accepted commit and branch reconciled",
            S::VerifyApprovedPlanVersion => "owner-approved plan version matches this plan",
            S::VerifyProductionAuthorisation => "explicit, unexpired owner production approval",
            S::ResolveKnownFolder => "known folder resolved via an approved Windows mechanism",
            S::VerifyNoRootConflict => "no pre-existing conflicting object at the intended root",
            S::VerifyNoReparseOrUnexpectedObject => {
                "handle-derived attributes show a real directory, no reparse point"
            }
            S::InstallOrVerifyServiceIdentity => "service identity exists and matches the approval",
            S::ObtainAuthoritativeServiceSid => "SID obtained from Windows, never derived by hand",
            S::ComposeFinalAclPolicy => "policy composed from the resolved principal",
            S::CreateProductionRoot => "root re-opened by handle and identity captured",
            S::ApplyAndVerifyAcl => {
                "descriptor RE-READ from Windows and verified against the policy"
            }
            S::EstablishRootCustody => {
                "custody handle held and revalidated against stored identity"
            }
            S::InitialiseOrReconcileDurableStore => "store manifest and journal reconciled",
            S::InitialiseServiceOnlyKeyCustody => {
                "protected record reopened under the service identity"
            }
            S::ConfigureWindowsService => "service configuration re-read and compared",
            S::ConfigureStartupAndRecovery => "startup and recovery settings re-read and compared",
            S::StartService => "service reports running",
            S::VerifyRuntimeServiceIdentity => "runtime identity equals the approved identity",
            S::VerifyCustodyAndStoreReopen => "custody and store reopen under the running identity",
            S::RecordRedactedEvidence => "redacted evidence record written",
            S::StopForReview => "owner and gatekeeper review requested",
        }
    }

    /// Whether an automatic retry is forbidden after an UNCERTAIN effect.
    ///
    /// Every mutating step qualifies: retrying an operation whose effect is unknown is how a partial
    /// change becomes a compounded one.
    #[must_use]
    pub fn retry_forbidden_after_uncertain_effect(self) -> bool {
        self.possible_effect().is_mutating()
    }

    /// Whether an uncertain outcome demands reconciliation before anything proceeds.
    #[must_use]
    pub fn reconciliation_required_after_uncertain_effect(self) -> bool {
        self.possible_effect().is_mutating()
    }
}

/// The governance status of one step. There is no `Default`: a status must be stated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApprovalStatus {
    /// No approval exists. The starting state of every step.
    NotAuthorised,
    /// The owner has been asked and has not yet decided.
    AwaitingOwnerDecision,
    /// Approved for exactly one execution of this step.
    ApprovedForOneOperation,
    /// Approved for this phase.
    ApprovedForPhase,
    /// Explicitly blocked.
    Blocked,
    /// Prerequisites met and approval present.
    ReadyForExecution,
    /// An uncertain or non-conforming effect must be reconciled first.
    ReconciliationRequired,
    /// Completed and independently confirmed.
    ConfirmedComplete,
}

impl ApprovalStatus {
    /// Whether this status alone permits execution.
    #[must_use]
    pub fn permits_execution(self) -> bool {
        matches!(
            self,
            Self::ApprovedForOneOperation | Self::ApprovedForPhase | Self::ReadyForExecution
        )
    }
}

/// One step and its governance status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivationGate {
    /// The step.
    pub step: ActivationStep,
    /// Its status.
    pub status: ApprovalStatus,
}

/// An operation that is separately gated but is NOT part of the forward activation sequence.
///
/// These are exceptional: they are never reached by advancing through the steps, so they are not
/// modelled as steps. They use the SAME [`ApprovalStatus`] model — there is no second approval
/// system — and they start `NotAuthorised` like everything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum ExceptionalOperation {
    /// Moving existing credentials into service-owned custody.
    CredentialMigration,
    /// Rolling back or destructively cleaning up a partial activation.
    RollbackOrDestructiveCleanup,
}

impl ExceptionalOperation {
    /// Every exceptional operation.
    #[must_use]
    pub fn all() -> &'static [ExceptionalOperation] {
        &[
            ExceptionalOperation::CredentialMigration,
            ExceptionalOperation::RollbackOrDestructiveCleanup,
        ]
    }
}

/// What the sequence says may happen next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ActivationDecision {
    /// An uncertain or non-conforming effect must be reconciled under owner and gatekeeper review.
    ReconciliationRequired(ActivationStep),
    /// The step is explicitly blocked.
    Blocked(ActivationStep),
    /// The owner must decide before this step may run.
    AwaitingOwnerDecision(ActivationStep),
    /// Approved and unblocked.
    ReadyForExecution(ActivationStep),
    /// Every step is confirmed complete.
    Complete,
}

/// The full sequence with its per-step statuses. Immutable: updates return a new value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationSequence {
    gates: Vec<ActivationGate>,
    exceptional: Vec<(ExceptionalOperation, ApprovalStatus)>,
}

impl ActivationSequence {
    /// A fresh sequence. EVERY step and EVERY exceptional operation starts `NotAuthorised` — there
    /// is no pre-approved step anywhere.
    #[must_use]
    pub fn new() -> Self {
        Self {
            gates: ActivationStep::all()
                .iter()
                .map(|&step| ActivationGate {
                    step,
                    status: ApprovalStatus::NotAuthorised,
                })
                .collect(),
            exceptional: ExceptionalOperation::all()
                .iter()
                .map(|&op| (op, ApprovalStatus::NotAuthorised))
                .collect(),
        }
    }

    /// The status of an exceptional operation.
    #[must_use]
    pub fn exceptional_status(&self, operation: ExceptionalOperation) -> ApprovalStatus {
        self.exceptional
            .iter()
            .find(|(op, _)| *op == operation)
            .map(|(_, s)| *s)
            .expect("every exceptional operation has a gate")
    }

    /// Record an exceptional-operation status. Models an owner decision being applied.
    #[must_use]
    pub fn with_exceptional_status(
        mut self,
        operation: ExceptionalOperation,
        status: ApprovalStatus,
    ) -> Self {
        for (op, s) in &mut self.exceptional {
            if *op == operation {
                *s = status;
            }
        }
        self
    }

    /// All gates, in canonical order.
    #[must_use]
    pub fn gates(&self) -> &[ActivationGate] {
        &self.gates
    }

    /// The status of one step.
    #[must_use]
    pub fn status(&self, step: ActivationStep) -> ApprovalStatus {
        self.gates
            .iter()
            .find(|g| g.step == step)
            .map(|g| g.status)
            .expect("every step has a gate")
    }

    /// Record a status. Models an owner or operator decision being applied to the plan.
    #[must_use]
    pub fn with_status(mut self, step: ActivationStep, status: ApprovalStatus) -> Self {
        for g in &mut self.gates {
            if g.step == step {
                g.status = status;
            }
        }
        self
    }

    /// The single next action. There is exactly one — the owner interface must never present two
    /// competing ways to activate the host.
    #[must_use]
    pub fn next_action(&self) -> ActivationDecision {
        // Any unreconciled uncertainty halts everything, wherever it sits in the order.
        if let Some(g) = self
            .gates
            .iter()
            .find(|g| g.status == ApprovalStatus::ReconciliationRequired)
        {
            return ActivationDecision::ReconciliationRequired(g.step);
        }
        for g in &self.gates {
            if g.status == ApprovalStatus::ConfirmedComplete {
                continue;
            }
            return match g.status {
                ApprovalStatus::Blocked => ActivationDecision::Blocked(g.step),
                s if s.permits_execution() => ActivationDecision::ReadyForExecution(g.step),
                // NotAuthorised / AwaitingOwnerDecision.
                _ if g.step.requires_owner_approval() => {
                    ActivationDecision::AwaitingOwnerDecision(g.step)
                }
                _ => ActivationDecision::ReadyForExecution(g.step),
            };
        }
        ActivationDecision::Complete
    }

    /// Check that a step may run right now.
    ///
    /// # Errors
    /// [`ActivationPlanError::ReconciliationRequired`] if anything is unreconciled;
    /// [`ActivationPlanError::PrerequisiteIncomplete`] if an earlier step is not confirmed;
    /// [`ActivationPlanError::NotAuthorised`] or [`ActivationPlanError::OwnerDecisionRequired`] if
    /// approval is missing.
    pub fn check_executable(&self, step: ActivationStep) -> Result<(), ActivationPlanError> {
        if self
            .gates
            .iter()
            .any(|g| g.status == ApprovalStatus::ReconciliationRequired)
        {
            return Err(ActivationPlanError::ReconciliationRequired);
        }
        // No step may be skipped: every earlier step must be confirmed complete.
        for earlier in &SEQUENCE[..step.order()] {
            if self.status(*earlier) != ApprovalStatus::ConfirmedComplete {
                return Err(ActivationPlanError::PrerequisiteIncomplete);
            }
        }
        let status = self.status(step);
        if status == ApprovalStatus::Blocked {
            return Err(ActivationPlanError::NotAuthorised);
        }
        if status.permits_execution() {
            return Ok(());
        }
        if step.requires_owner_approval() {
            Err(ActivationPlanError::OwnerDecisionRequired)
        } else {
            Err(ActivationPlanError::NotAuthorised)
        }
    }

    /// Validate the sequence's own governance shape.
    #[must_use]
    pub fn violations(&self) -> Vec<ActivationViolation> {
        let mut found = Vec::new();
        for (i, g) in self.gates.iter().enumerate() {
            if g.step.order() != i {
                found.push(ActivationViolation::StepOrderViolation);
            }
            if g.step.possible_effect().is_mutating() {
                if !g.step.requires_owner_approval() {
                    found.push(ActivationViolation::StepLacksOwnerApproval);
                }
                if !g.step.reconciliation_required_after_uncertain_effect() {
                    found.push(ActivationViolation::StepLacksEffectClassification);
                }
            }
        }
        found.dedup();
        found
    }
}

impl Default for ActivationSequence {
    fn default() -> Self {
        Self::new()
    }
}

/// How an attempted operation actually ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectClassification {
    /// Refused before anything changed. The system is untouched.
    PreEffectFailure,
    /// Changed AND independently re-read and verified.
    ConfirmedEffect,
    /// An effect may have occurred, but the final state was not proven or differs from the plan.
    UncertainOrNonConforming,
}

/// What is permitted after an outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutcomePolicy {
    /// Whether the operation may be retried automatically.
    pub automatic_retry_permitted: bool,
    /// Whether the policy may be broadened to make it pass.
    pub broadening_permitted: bool,
    /// Whether a guessed rollback may be attempted.
    pub guessed_rollback_permitted: bool,
    /// Whether success may be claimed.
    pub success_claimable: bool,
    /// Whether owner and gatekeeper reconciliation is required.
    pub reconciliation_required: bool,
}

impl EffectClassification {
    /// The policy this outcome implies. Uncertainty is never resolved by trying again.
    #[must_use]
    pub fn policy(self) -> OutcomePolicy {
        match self {
            Self::PreEffectFailure => OutcomePolicy {
                automatic_retry_permitted: false,
                broadening_permitted: false,
                guessed_rollback_permitted: false,
                success_claimable: false,
                reconciliation_required: false,
            },
            Self::ConfirmedEffect => OutcomePolicy {
                automatic_retry_permitted: false,
                broadening_permitted: false,
                guessed_rollback_permitted: false,
                success_claimable: true,
                reconciliation_required: false,
            },
            Self::UncertainOrNonConforming => OutcomePolicy {
                automatic_retry_permitted: false,
                broadening_permitted: false,
                guessed_rollback_permitted: false,
                success_claimable: false,
                reconciliation_required: true,
            },
        }
    }
}

/// Concrete ways activation can end in an uncertain or non-conforming state.
///
/// Each is enumerated so no report can quietly treat one as a success.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum UncertainScenario {
    /// The root was created but its ACL could not be verified.
    RootCreatedAclUnverified,
    /// The service was installed but its identity could not be verified.
    ServiceInstalledIdentityUnverified,
    /// The ACL was applied but the service SID differs from the approved one.
    AclAppliedServiceSidDiffers,
    /// The service was configured but failed to start.
    ServiceConfiguredStartFailed,
    /// The service started but its runtime identity differs from the approved one.
    ServiceStartedRuntimeIdentityDiffers,
    /// Key material was persisted but could not be reopened.
    KeyPersistedReopenFailed,
    /// The durable store was created but could not be reconciled.
    StoreCreatedReconcileFailed,
    /// A service-database or registry effect landed only partially.
    PartialServiceDatabaseEffect,
    /// Cleanup itself failed.
    CleanupFailed,
    /// Activation was interrupted mid-sequence.
    ActivationInterrupted,
}

impl UncertainScenario {
    /// Every enumerated scenario.
    #[must_use]
    pub fn all() -> &'static [UncertainScenario] {
        use UncertainScenario as U;
        &[
            U::RootCreatedAclUnverified,
            U::ServiceInstalledIdentityUnverified,
            U::AclAppliedServiceSidDiffers,
            U::ServiceConfiguredStartFailed,
            U::ServiceStartedRuntimeIdentityDiffers,
            U::KeyPersistedReopenFailed,
            U::StoreCreatedReconcileFailed,
            U::PartialServiceDatabaseEffect,
            U::CleanupFailed,
            U::ActivationInterrupted,
        ]
    }

    /// Every one of these is uncertain. None is a success, and none is retryable.
    #[must_use]
    pub fn classification(self) -> EffectClassification {
        EffectClassification::UncertainOrNonConforming
    }
}

/// Windows startup type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StartupType {
    /// Started by an operator or a dependent, never at boot.
    Manual,
    /// Started automatically at boot.
    Automatic,
    /// Started automatically, after the boot-critical services.
    AutomaticDelayed,
    /// Cannot be started.
    Disabled,
}

/// Behaviour when Windows is in safe mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SafeModeBehaviour {
    /// Do not start. Safe mode is for recovery, not for running the host.
    DoNotStart,
}

/// What to do about a second instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DuplicateInstancePolicy {
    /// Refuse. Two hosts must never own the same state.
    Refuse,
}

/// The bounded restart policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RestartPolicy {
    /// Maximum consecutive restarts before Windows stops trying. Must be ≥ 1 and bounded.
    pub max_consecutive_restarts: u32,
    /// Delay before each restart.
    pub restart_delay_seconds: u32,
    /// Failure-count reset interval.
    pub reset_interval_seconds: u32,
}

/// Absolute ceiling on automatic restarts. Beyond this a human must look.
const MAX_RESTART_CEILING: u32 = 5;

/// The modelled service recovery policy. Nothing here is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceRecoveryPlan {
    /// Startup type.
    pub startup: StartupType,
    /// Restart policy.
    pub restart: RestartPolicy,
    /// Safe-mode behaviour.
    pub safe_mode: SafeModeBehaviour,
    /// Duplicate-instance behaviour.
    pub duplicate_instance: DuplicateInstancePolicy,
    /// Graceful-shutdown budget.
    pub shutdown_timeout_seconds: u32,
    /// Whether the service declares Windows service dependencies.
    pub declares_dependencies: bool,
}

impl ServiceRecoveryPlan {
    /// The intended policy: delayed automatic start, a small bounded restart budget, no safe-mode
    /// start, and a hard refusal of a second instance.
    #[must_use]
    pub fn intended() -> Self {
        Self {
            startup: StartupType::AutomaticDelayed,
            restart: RestartPolicy {
                max_consecutive_restarts: 3,
                restart_delay_seconds: 30,
                reset_interval_seconds: 86_400,
            },
            safe_mode: SafeModeBehaviour::DoNotStart,
            duplicate_instance: DuplicateInstancePolicy::Refuse,
            shutdown_timeout_seconds: 30,
            declares_dependencies: false,
        }
    }

    /// Operations the recovery policy may NEVER retry automatically, whatever Windows does.
    ///
    /// Windows restarting a crashed process must not become a way around a governance gate.
    #[must_use]
    pub fn never_auto_retried() -> &'static [PossibleEffect] {
        &[
            PossibleEffect::AclMutation,
            PossibleEffect::KeyProvisioning,
            PossibleEffect::ServiceInstallation,
            PossibleEffect::FilesystemCreate,
        ]
    }

    /// Validate the policy is bounded.
    ///
    /// # Errors
    /// [`ActivationPlanError::UnboundedRestartPolicy`] if restarts are unlimited (0) or exceed the
    /// ceiling, or the reset interval is zero.
    pub fn validate(&self) -> Result<(), ActivationPlanError> {
        if self.restart.max_consecutive_restarts == 0
            || self.restart.max_consecutive_restarts > MAX_RESTART_CEILING
            || self.restart.reset_interval_seconds == 0
        {
            return Err(ActivationPlanError::UnboundedRestartPolicy);
        }
        Ok(())
    }

    /// Conditions that require a human, with no automatic path onward.
    #[must_use]
    pub fn manual_intervention_conditions() -> &'static [UncertainScenario] {
        UncertainScenario::all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sequence_is_deterministic_and_fully_ordered() {
        assert_eq!(ActivationStep::all().len(), 21);
        for (i, step) in ActivationStep::all().iter().enumerate() {
            assert_eq!(step.order(), i);
            assert_eq!(
                step.prerequisite(),
                if i == 0 {
                    None
                } else {
                    Some(ActivationStep::all()[i - 1])
                }
            );
        }
        assert_eq!(ActivationStep::VerifyBaseline.prerequisite(), None);
    }

    #[test]
    fn a_fresh_sequence_authorises_nothing() {
        let seq = ActivationSequence::new();
        assert!(seq
            .gates()
            .iter()
            .all(|g| g.status == ApprovalStatus::NotAuthorised));
        assert!(seq.violations().is_empty());
    }

    #[test]
    fn every_mutating_step_requires_owner_approval_and_forbids_blind_retry() {
        for step in ActivationStep::all() {
            if step.possible_effect().is_mutating() {
                assert!(
                    step.requires_owner_approval(),
                    "{step:?} mutates and must require owner approval"
                );
                assert!(step.retry_forbidden_after_uncertain_effect());
                assert!(step.reconciliation_required_after_uncertain_effect());
                assert_eq!(
                    step.required_authority(),
                    RequiredAuthority::OwnerApprovalAndAdministrator
                );
            }
        }
        // The specific gates the prompt names.
        for step in [
            ActivationStep::InstallOrVerifyServiceIdentity,
            ActivationStep::CreateProductionRoot,
            ActivationStep::ApplyAndVerifyAcl,
            ActivationStep::InitialiseServiceOnlyKeyCustody,
            ActivationStep::StartService,
        ] {
            assert!(step.requires_owner_approval(), "{step:?}");
        }
    }

    #[test]
    fn no_step_can_be_skipped() {
        let seq = ActivationSequence::new().with_status(
            ActivationStep::CreateProductionRoot,
            ApprovalStatus::ApprovedForOneOperation,
        );
        // Approved, but every earlier step is still unconfirmed.
        assert_eq!(
            seq.check_executable(ActivationStep::CreateProductionRoot)
                .unwrap_err(),
            ActivationPlanError::PrerequisiteIncomplete
        );
    }

    #[test]
    fn dependencies_must_be_confirmed_not_merely_approved() {
        let mut seq = ActivationSequence::new();
        for step in &ActivationStep::all()[..ActivationStep::CreateProductionRoot.order()] {
            seq = seq.with_status(*step, ApprovalStatus::ApprovedForPhase);
        }
        seq = seq.with_status(
            ActivationStep::CreateProductionRoot,
            ApprovalStatus::ApprovedForPhase,
        );
        assert_eq!(
            seq.check_executable(ActivationStep::CreateProductionRoot)
                .unwrap_err(),
            ActivationPlanError::PrerequisiteIncomplete
        );
    }

    #[test]
    fn an_approved_step_with_confirmed_prerequisites_is_executable() {
        let mut seq = ActivationSequence::new();
        for step in &ActivationStep::all()[..ActivationStep::CreateProductionRoot.order()] {
            seq = seq.with_status(*step, ApprovalStatus::ConfirmedComplete);
        }
        assert_eq!(
            seq.check_executable(ActivationStep::CreateProductionRoot)
                .unwrap_err(),
            ActivationPlanError::OwnerDecisionRequired,
            "prerequisites alone must not authorise a mutating step"
        );
        let seq = seq.with_status(
            ActivationStep::CreateProductionRoot,
            ApprovalStatus::ApprovedForOneOperation,
        );
        assert!(seq
            .check_executable(ActivationStep::CreateProductionRoot)
            .is_ok());
    }

    #[test]
    fn the_production_gate_blocks_execution_readiness() {
        let seq = ActivationSequence::new()
            .with_status(
                ActivationStep::VerifyBaseline,
                ApprovalStatus::ConfirmedComplete,
            )
            .with_status(
                ActivationStep::VerifyApprovedPlanVersion,
                ApprovalStatus::ConfirmedComplete,
            );
        assert_eq!(
            seq.next_action(),
            ActivationDecision::AwaitingOwnerDecision(
                ActivationStep::VerifyProductionAuthorisation
            )
        );
    }

    #[test]
    fn there_is_exactly_one_next_action_and_reconciliation_wins() {
        let seq = ActivationSequence::new()
            .with_status(
                ActivationStep::VerifyBaseline,
                ApprovalStatus::ConfirmedComplete,
            )
            .with_status(
                ActivationStep::ApplyAndVerifyAcl,
                ApprovalStatus::ReconciliationRequired,
            );
        assert_eq!(
            seq.next_action(),
            ActivationDecision::ReconciliationRequired(ActivationStep::ApplyAndVerifyAcl)
        );
        // Nothing at all may execute while an uncertainty is outstanding.
        assert_eq!(
            seq.check_executable(ActivationStep::VerifyApprovedPlanVersion)
                .unwrap_err(),
            ActivationPlanError::ReconciliationRequired
        );
    }

    #[test]
    fn a_blocked_step_is_reported_and_refused() {
        let seq = ActivationSequence::new()
            .with_status(ActivationStep::VerifyBaseline, ApprovalStatus::Blocked);
        assert_eq!(
            seq.next_action(),
            ActivationDecision::Blocked(ActivationStep::VerifyBaseline)
        );
        assert_eq!(
            seq.check_executable(ActivationStep::VerifyBaseline)
                .unwrap_err(),
            ActivationPlanError::NotAuthorised
        );
    }

    #[test]
    fn completion_requires_every_step_confirmed() {
        let mut seq = ActivationSequence::new();
        for step in ActivationStep::all() {
            seq = seq.with_status(*step, ApprovalStatus::ConfirmedComplete);
        }
        assert_eq!(seq.next_action(), ActivationDecision::Complete);
    }

    #[test]
    fn effect_classification_never_permits_retry_broadening_or_guessed_rollback() {
        for c in [
            EffectClassification::PreEffectFailure,
            EffectClassification::ConfirmedEffect,
            EffectClassification::UncertainOrNonConforming,
        ] {
            let p = c.policy();
            assert!(!p.automatic_retry_permitted, "{c:?}");
            assert!(!p.broadening_permitted, "{c:?}");
            assert!(!p.guessed_rollback_permitted, "{c:?}");
        }
        assert!(
            EffectClassification::ConfirmedEffect
                .policy()
                .success_claimable
        );
        assert!(
            !EffectClassification::PreEffectFailure
                .policy()
                .success_claimable
        );
        assert!(
            !EffectClassification::UncertainOrNonConforming
                .policy()
                .success_claimable
        );
        assert!(
            EffectClassification::UncertainOrNonConforming
                .policy()
                .reconciliation_required
        );
        assert!(
            !EffectClassification::PreEffectFailure
                .policy()
                .reconciliation_required
        );
    }

    #[test]
    fn every_enumerated_uncertain_scenario_demands_reconciliation() {
        assert_eq!(UncertainScenario::all().len(), 10);
        for s in UncertainScenario::all() {
            assert_eq!(
                s.classification(),
                EffectClassification::UncertainOrNonConforming
            );
            let p = s.classification().policy();
            assert!(p.reconciliation_required);
            assert!(!p.success_claimable);
            assert!(!p.automatic_retry_permitted);
        }
    }

    #[test]
    fn the_recovery_policy_is_bounded_and_never_overrides_a_governance_gate() {
        let plan = ServiceRecoveryPlan::intended();
        assert!(plan.validate().is_ok());
        assert_eq!(plan.safe_mode, SafeModeBehaviour::DoNotStart);
        assert_eq!(plan.duplicate_instance, DuplicateInstancePolicy::Refuse);
        assert_eq!(plan.startup, StartupType::AutomaticDelayed);

        // Unlimited restarts and a zero reset interval are both refused.
        let mut unbounded = plan.clone();
        unbounded.restart.max_consecutive_restarts = 0;
        assert_eq!(
            unbounded.validate().unwrap_err(),
            ActivationPlanError::UnboundedRestartPolicy
        );
        let mut excessive = plan.clone();
        excessive.restart.max_consecutive_restarts = MAX_RESTART_CEILING + 1;
        assert_eq!(
            excessive.validate().unwrap_err(),
            ActivationPlanError::UnboundedRestartPolicy
        );
        let mut no_reset = plan.clone();
        no_reset.restart.reset_interval_seconds = 0;
        assert_eq!(
            no_reset.validate().unwrap_err(),
            ActivationPlanError::UnboundedRestartPolicy
        );

        // The gated effects may never be reached by an automatic restart.
        for effect in ServiceRecoveryPlan::never_auto_retried() {
            assert!(effect.is_mutating());
        }
        assert_eq!(
            ServiceRecoveryPlan::manual_intervention_conditions().len(),
            10
        );
    }

    #[test]
    fn every_mutating_step_states_the_evidence_that_would_confirm_it() {
        for step in ActivationStep::all() {
            assert!(!step.expected_evidence().is_empty());
        }
        // The two steps most likely to be claimed on an API return code alone.
        assert!(ActivationStep::ApplyAndVerifyAcl
            .expected_evidence()
            .contains("RE-READ"));
        assert!(ActivationStep::ObtainAuthoritativeServiceSid
            .expected_evidence()
            .contains("never derived by hand"));
    }
}
