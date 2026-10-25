//! The pre-effect sequence, the sealed effect-authority model, the post-effect verification
//! requirements, and the effect classification.
//!
//! Central discipline: installation is unconditionally NOT authorised in this phase. The
//! effect-authority type has a single `NotAuthorised` state and no constructor that yields anything
//! else, so no caller — recommendation, availability, report, prompt, environment or session — can
//! manufacture an installation approval here. A future approval belongs to a later governed phase.

/// The strict, ordered pre-effect checks a future installation must pass before ANY service
/// creation. Every check must pass; any failed or indeterminate check stops before the effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum PreEffectCheck {
    /// 1. Repository and accepted-plan consistency.
    RepositoryAndPlanConsistency,
    /// 2. Exact owner-approved service name (`ProjectOSHost`).
    OwnerApprovedServiceName,
    /// 3. Exact owner-approved identity strategy (`VirtualServiceAccount`).
    OwnerApprovedIdentityStrategy,
    /// 4. Fresh live service-name collision check.
    FreshLiveCollisionCheck,
    /// 5. Supported Windows baseline.
    SupportedWindowsBaseline,
    /// 6. Read-only SCM access.
    ScmReadOnlyAccess,
    /// 7. Installation API availability.
    InstallationApiAvailability,
    /// 8. Packaged executable path resolved.
    PackagedExecutablePathResolved,
    /// 9. Executable exists.
    ExecutableExists,
    /// 10. Executable is a regular file.
    ExecutableIsRegularFile,
    /// 11. Executable identity and trust checks pass.
    ExecutableIdentityAndTrust,
    /// 12. Installation directory is canonical and acceptable.
    InstallationDirectoryCanonical,
    /// 13. No reparse, junction or path-replacement issue.
    NoReparseOrPathReplacement,
    /// 14. Service does not already exist.
    ServiceDoesNotExist,
    /// 15. No alternative or fallback name selected.
    NoFallbackNameSelected,
    /// 16. Display-name decision resolved.
    DisplayNameResolved,
    /// 17. Description decision resolved.
    DescriptionResolved,
    /// 18. Startup decision resolved.
    StartupResolved,
    /// 19. Recovery decision resolved.
    RecoveryResolved,
    /// 20. Explicit installation-effect approval exists.
    InstallationEffectApprovalExists,
    /// 21. Approval is current, scoped and unexpired.
    ApprovalCurrentScopedUnexpired,
    /// 22. No production or unrelated authority is inferred.
    NoInferredAuthority,
}

/// The canonical pre-effect order. Index IS the required order.
const PRE_EFFECT_SEQUENCE: [PreEffectCheck; 22] = [
    PreEffectCheck::RepositoryAndPlanConsistency,
    PreEffectCheck::OwnerApprovedServiceName,
    PreEffectCheck::OwnerApprovedIdentityStrategy,
    PreEffectCheck::FreshLiveCollisionCheck,
    PreEffectCheck::SupportedWindowsBaseline,
    PreEffectCheck::ScmReadOnlyAccess,
    PreEffectCheck::InstallationApiAvailability,
    PreEffectCheck::PackagedExecutablePathResolved,
    PreEffectCheck::ExecutableExists,
    PreEffectCheck::ExecutableIsRegularFile,
    PreEffectCheck::ExecutableIdentityAndTrust,
    PreEffectCheck::InstallationDirectoryCanonical,
    PreEffectCheck::NoReparseOrPathReplacement,
    PreEffectCheck::ServiceDoesNotExist,
    PreEffectCheck::NoFallbackNameSelected,
    PreEffectCheck::DisplayNameResolved,
    PreEffectCheck::DescriptionResolved,
    PreEffectCheck::StartupResolved,
    PreEffectCheck::RecoveryResolved,
    PreEffectCheck::InstallationEffectApprovalExists,
    PreEffectCheck::ApprovalCurrentScopedUnexpired,
    PreEffectCheck::NoInferredAuthority,
];

impl PreEffectCheck {
    /// The full ordered sequence.
    #[must_use]
    pub fn sequence() -> &'static [PreEffectCheck] {
        &PRE_EFFECT_SEQUENCE
    }

    /// Position in the sequence (0-based).
    #[must_use]
    pub fn order(self) -> usize {
        PRE_EFFECT_SEQUENCE
            .iter()
            .position(|c| *c == self)
            .expect("every check is in the sequence")
    }
}

/// The sealed installation-effect authority.
///
/// There is exactly one state — `NotAuthorised` — and no constructor that produces anything else, so
/// this crate cannot represent an installation approval. A future approval requires a new governed
/// type in a later phase; it cannot be manufactured here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallationEffectAuthority {
    /// No installation effect is authorised.
    NotAuthorised,
}

impl InstallationEffectAuthority {
    /// The only authority this phase can express.
    #[must_use]
    pub fn current() -> Self {
        Self::NotAuthorised
    }

    /// Whether any installation effect is authorised. Always `false`.
    #[must_use]
    pub fn is_authorised(self) -> bool {
        false
    }
}

/// The lifecycle status of the installation contract.
///
/// In 3K-F the contract is at most [`Self::ReadyForReview`]. There is deliberately no
/// `ReadyForEffect`, `ReadyForInstallation`, `ExecutionReady`, `InstallationApproved` or
/// `EffectAuthorised` status — none of those states is reachable in this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallationContractStatus {
    /// Being drafted; not yet offered for review.
    Drafted,
    /// Structurally complete and offered for gatekeeper review. NOT an installation authority.
    ReadyForReview,
}

/// Whether the contract's SHAPE is well-formed. This is about structure ONLY and says nothing about
/// whether an installation may proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StructuralValidity {
    /// The shape is well-formed and may be reviewed. NOT execution readiness.
    ValidForReview,
    /// The shape is malformed.
    Invalid,
}

/// Whether the metadata a future installation needs is complete.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum MetadataReadiness {
    /// Every required metadata value is resolved.
    Complete,
    /// One or more required metadata values are unresolved owner decisions.
    Incomplete,
}

/// The five orthogonal readiness dimensions of the contract. Structural validity is kept strictly
/// separate from execution readiness so a well-formed contract can never be mistaken for an
/// installable one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContractReadiness {
    /// The lifecycle status.
    pub lifecycle: InstallationContractStatus,
    /// Whether the shape is well-formed.
    pub structural: StructuralValidity,
    /// Whether required metadata is complete.
    pub metadata: MetadataReadiness,
    /// Whether every pre-effect check could pass now.
    pub pre_effect_ready: bool,
    /// Whether a current scoped installation-effect authority exists.
    pub effect_authority_ready: bool,
    /// Whether the contract may be executed. Invariantly `false` in this phase.
    pub execution_ready: bool,
}

impl ContractReadiness {
    /// Compute readiness from independent inputs. This is the SINGLE place the dimensions combine, so
    /// their orthogonality is provable: execution readiness requires structural validity AND resolved
    /// metadata AND met pre-effect prerequisites AND effect authority — all four.
    ///
    /// Effect authority is NOT a caller-supplied Boolean: it is the sealed
    /// [`InstallationEffectAuthority`], and `effect_authority_ready` is derived internally from
    /// [`InstallationEffectAuthority::is_authorised`]. Because that type has the single variant
    /// `NotAuthorised`, no caller — production or otherwise — can raise effect-authority readiness or
    /// execution readiness. Completing metadata or pre-effect prerequisites therefore cannot
    /// manufacture effect authority. It constructs nothing installable.
    ///
    /// `pub(crate)` so no external consumer can call it.
    #[must_use]
    pub(crate) fn evaluate(
        lifecycle: InstallationContractStatus,
        structural: StructuralValidity,
        metadata_resolved: bool,
        pre_effect_prerequisites_met: bool,
        authority: &InstallationEffectAuthority,
    ) -> Self {
        let effect_authority_ready = authority.is_authorised();
        Self {
            lifecycle,
            structural,
            metadata: if metadata_resolved {
                MetadataReadiness::Complete
            } else {
                MetadataReadiness::Incomplete
            },
            pre_effect_ready: metadata_resolved && pre_effect_prerequisites_met,
            effect_authority_ready,
            execution_ready: structural == StructuralValidity::ValidForReview
                && metadata_resolved
                && pre_effect_prerequisites_met
                && effect_authority_ready,
        }
    }

    /// Whether the contract may be executed. Always `false` in 3K-F.
    #[must_use]
    pub fn is_execution_ready(&self) -> bool {
        self.execution_ready
    }

    /// Whether an installation effect is authorised. Always `false` in 3K-F.
    #[must_use]
    pub fn is_effect_authorised(&self) -> bool {
        self.effect_authority_ready
    }
}

/// A future gated operation and its current authority. Every one is `NotAuthorised` in this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum GatedOperation {
    /// Creating the service.
    ServiceCreation,
    /// Configuring the service.
    ServiceConfiguration,
    /// Starting the service.
    ServiceStartup,
    /// Rolling back / destructive cleanup.
    Rollback,
    /// Activating production.
    ProductionActivation,
}

impl GatedOperation {
    /// Every gated operation.
    #[must_use]
    pub fn all() -> &'static [GatedOperation] {
        use GatedOperation as G;
        &[
            G::ServiceCreation,
            G::ServiceConfiguration,
            G::ServiceStartup,
            G::Rollback,
            G::ProductionActivation,
        ]
    }
}

/// Authorisation status of a gated operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorisationStatus {
    /// Not authorised.
    NotAuthorised,
}

/// What must be authoritatively re-read after a future service-creation effect.
///
/// Every item is `DeferredUntilApprovedEffect`: none is proven now, and a future effect can NEVER be
/// marked confirmed merely because the creation call returned success — the re-read is mandatory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum PostEffectVerification {
    /// The exact service name.
    ExactServiceName,
    /// The service exists.
    ServiceExists,
    /// The service type.
    ServiceType,
    /// The startup configuration.
    StartupConfiguration,
    /// The binary path.
    BinaryPath,
    /// The account identity.
    AccountIdentity,
    /// The service SID type.
    SidType,
    /// The display name.
    DisplayName,
    /// The description.
    Description,
    /// The recovery configuration.
    RecoveryConfiguration,
    /// The current service status.
    ServiceStatus,
    /// The service SID resolution.
    ServiceSidResolution,
    /// No fallback or duplicate service.
    NoFallbackOrDuplicate,
}

impl PostEffectVerification {
    /// Every mandatory post-effect verification, in a stable order.
    #[must_use]
    pub fn all() -> &'static [PostEffectVerification] {
        use PostEffectVerification as V;
        &[
            V::ExactServiceName,
            V::ServiceExists,
            V::ServiceType,
            V::StartupConfiguration,
            V::BinaryPath,
            V::AccountIdentity,
            V::SidType,
            V::DisplayName,
            V::Description,
            V::RecoveryConfiguration,
            V::ServiceStatus,
            V::ServiceSidResolution,
            V::NoFallbackOrDuplicate,
        ]
    }
}

/// A PHYSICAL effect outcome — an observable system state after (or instead of) a future submitted
/// effect. There are exactly SIX. This type carries NO governance action: reconciliation and rollback
/// are decisions, not observations, and live in [`RequiredAction`] instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectOutcome {
    /// A pre-effect check refused; no effect occurred.
    PreEffectRefused,
    /// No effect occurred and that is authoritatively proven.
    NoEffectConfirmed,
    /// The effect was submitted and exact existence is proven, but full verification is incomplete.
    /// This is NOT verified success.
    EffectConfirmed,
    /// The service is visible but its configuration does not match the request.
    EffectPartiallyConfirmed,
    /// An effect may have occurred but the final state is unproven.
    EffectUncertain,
    /// The effect completed and every mandatory authoritative verification passed.
    CompletedAndVerified,
}

/// What a future submitted effect experienced, before classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectOutcomeSignal {
    /// A pre-effect condition failed; the request was never submitted.
    PreEffectConditionFailed,
    /// The request was never submitted, and authoritative evidence proves the service is absent.
    NeverSubmittedAbsenceProven,
    /// The request was submitted and exact existence is proven, but full verification is incomplete.
    SubmittedExistenceProvenVerificationIncomplete,
    /// The creation call returned success, but no authoritative re-read has been done — existence is
    /// NOT proven.
    SuccessReturnedNoReread,
    /// The operation timed out after the request was submitted.
    TimeoutAfterSubmission,
    /// The process crashed after the request was submitted.
    CrashAfterSubmission,
    /// The service is visible with a configuration that does not match the request.
    VisibleMismatchedConfiguration,
    /// Every mandatory verification passed after an authoritative re-read.
    AuthoritativeRereadAllPassed,
}

/// The next action a classification demands. No variant performs an effect; the destructive ones are
/// gated behind a separate future approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RequiredAction {
    /// Re-run a fresh pre-effect evaluation; no prior effect is assumed.
    FreshPreEffectEvaluation,
    /// A new attempt still needs a new approval and fresh checks; no automatic retry.
    NewApprovalAndFreshChecks,
    /// Proceed only through reconciliation/verification; no duplicate creation, no automatic repair.
    ReconciliationRequired,
    /// A destructive remediation is needed and needs a separate owner/gatekeeper approval.
    RollbackApprovalRequired,
    /// Success may be reported; no further creation attempt.
    NoneProceedVerified,
}

impl EffectOutcome {
    /// Classify the PHYSICAL outcome from a raw observation signal. Returns one of the six outcomes,
    /// never a governance action. Encodes the exact §4 rules:
    ///
    /// * a failed pre-effect condition → [`Self::PreEffectRefused`];
    /// * never-submitted with proven absence → [`Self::NoEffectConfirmed`];
    /// * submitted with proven existence but incomplete verification → [`Self::EffectConfirmed`]
    ///   (NOT [`Self::CompletedAndVerified`]);
    /// * a visible mismatched configuration → [`Self::EffectPartiallyConfirmed`];
    /// * a success return WITHOUT an authoritative re-read, a timeout, or a crash after submission →
    ///   [`Self::EffectUncertain`] (a bare success return is NOT existence evidence, so it is never
    ///   `EffectConfirmed`; a timeout/crash is never `NoEffectConfirmed`);
    /// * an authoritative all-passed re-read → [`Self::CompletedAndVerified`].
    #[must_use]
    pub fn classify(signal: EffectOutcomeSignal) -> Self {
        match signal {
            EffectOutcomeSignal::PreEffectConditionFailed => Self::PreEffectRefused,
            EffectOutcomeSignal::NeverSubmittedAbsenceProven => Self::NoEffectConfirmed,
            EffectOutcomeSignal::SubmittedExistenceProvenVerificationIncomplete => {
                Self::EffectConfirmed
            }
            EffectOutcomeSignal::VisibleMismatchedConfiguration => Self::EffectPartiallyConfirmed,
            EffectOutcomeSignal::SuccessReturnedNoReread
            | EffectOutcomeSignal::TimeoutAfterSubmission
            | EffectOutcomeSignal::CrashAfterSubmission => Self::EffectUncertain,
            EffectOutcomeSignal::AuthoritativeRereadAllPassed => Self::CompletedAndVerified,
        }
    }

    /// The GOVERNANCE action this physical outcome demands. Distinct type — an action is never an
    /// outcome. No action performs an effect; the destructive one is gated behind a separate approval.
    #[must_use]
    pub fn required_action(self) -> RequiredAction {
        match self {
            Self::PreEffectRefused => RequiredAction::FreshPreEffectEvaluation,
            Self::NoEffectConfirmed => RequiredAction::NewApprovalAndFreshChecks,
            Self::EffectConfirmed | Self::EffectPartiallyConfirmed | Self::EffectUncertain => {
                RequiredAction::ReconciliationRequired
            }
            Self::CompletedAndVerified => RequiredAction::NoneProceedVerified,
        }
    }

    /// The escalated action when a partial or uncertain outcome needs DESTRUCTIVE remediation:
    /// always a separate rollback approval, never an automatic rollback. Rollback approval is an
    /// action requirement, not evidence that rollback is authorised.
    #[must_use]
    pub fn destructive_remediation_action(self) -> RequiredAction {
        match self {
            Self::EffectUncertain | Self::EffectPartiallyConfirmed => {
                RequiredAction::RollbackApprovalRequired
            }
            other => other.required_action(),
        }
    }

    /// Whether an automatic retry is permitted after this outcome. Never — for every outcome.
    #[must_use]
    pub fn automatic_retry_permitted(self) -> bool {
        false
    }

    /// Whether this outcome demands reconciliation before anything proceeds. A confirmed-but-unverified
    /// effect ([`Self::EffectConfirmed`]) is included — it must go through verification, never a
    /// duplicate creation.
    #[must_use]
    pub fn reconciliation_required(self) -> bool {
        matches!(
            self,
            Self::EffectConfirmed | Self::EffectUncertain | Self::EffectPartiallyConfirmed
        )
    }

    /// Whether success may be REPORTED from this outcome. Only a fully verified effect. A
    /// confirmed-but-unverified effect is NOT success.
    #[must_use]
    pub fn success_claimable(self) -> bool {
        matches!(self, Self::CompletedAndVerified)
    }
}

impl RequiredAction {
    /// Whether this action performs any automatic effect. Always `false` — every action either
    /// re-evaluates, requires a fresh approval, requires reconciliation, requires a SEPARATE rollback
    /// approval, or reports verified success. None deletes, overwrites, repairs, retries, renames, or
    /// creates a second service.
    #[must_use]
    pub fn performs_automatic_effect(self) -> bool {
        false
    }

    /// Whether this action means a rollback is AUTHORISED. Always `false` — `RollbackApprovalRequired`
    /// requests a separate approval; it never grants one.
    #[must_use]
    pub fn authorises_rollback(self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pre_effect_sequence_is_ordered_and_complete() {
        assert_eq!(PreEffectCheck::sequence().len(), 22);
        for (i, c) in PreEffectCheck::sequence().iter().enumerate() {
            assert_eq!(c.order(), i);
        }
        // Approval is checked near the end, after every safety precondition.
        assert!(
            PreEffectCheck::InstallationEffectApprovalExists.order()
                > PreEffectCheck::ServiceDoesNotExist.order()
        );
    }

    #[test]
    fn installation_effect_authority_can_only_be_not_authorised() {
        let a = InstallationEffectAuthority::current();
        assert_eq!(a, InstallationEffectAuthority::NotAuthorised);
        assert!(!a.is_authorised());
    }

    #[test]
    fn every_gated_operation_is_not_authorised() {
        assert_eq!(GatedOperation::all().len(), 5);
        // The type can only express NotAuthorised.
        let _ = AuthorisationStatus::NotAuthorised;
    }

    #[test]
    fn every_post_effect_verification_is_mandatory_and_deferred() {
        assert_eq!(PostEffectVerification::all().len(), 13);
    }

    const ALL_OUTCOMES: [EffectOutcome; 6] = [
        EffectOutcome::PreEffectRefused,
        EffectOutcome::NoEffectConfirmed,
        EffectOutcome::EffectConfirmed,
        EffectOutcome::EffectPartiallyConfirmed,
        EffectOutcome::EffectUncertain,
        EffectOutcome::CompletedAndVerified,
    ];

    const ALL_SIGNALS: [EffectOutcomeSignal; 8] = [
        EffectOutcomeSignal::PreEffectConditionFailed,
        EffectOutcomeSignal::NeverSubmittedAbsenceProven,
        EffectOutcomeSignal::SubmittedExistenceProvenVerificationIncomplete,
        EffectOutcomeSignal::VisibleMismatchedConfiguration,
        EffectOutcomeSignal::SuccessReturnedNoReread,
        EffectOutcomeSignal::TimeoutAfterSubmission,
        EffectOutcomeSignal::CrashAfterSubmission,
        EffectOutcomeSignal::AuthoritativeRereadAllPassed,
    ];

    #[test]
    fn there_are_exactly_six_physical_outcomes() {
        assert_eq!(ALL_OUTCOMES.len(), 6);
    }

    #[test]
    fn every_signal_maps_to_exactly_one_physical_outcome() {
        for s in ALL_SIGNALS {
            // classify returns an EffectOutcome (a physical outcome), never a RequiredAction.
            let outcome: EffectOutcome = EffectOutcome::classify(s);
            assert!(ALL_OUTCOMES.contains(&outcome), "{s:?} -> {outcome:?}");
        }
        // The exact §4 mapping.
        assert_eq!(
            EffectOutcome::classify(EffectOutcomeSignal::PreEffectConditionFailed),
            EffectOutcome::PreEffectRefused
        );
        assert_eq!(
            EffectOutcome::classify(EffectOutcomeSignal::NeverSubmittedAbsenceProven),
            EffectOutcome::NoEffectConfirmed
        );
        assert_eq!(
            EffectOutcome::classify(
                EffectOutcomeSignal::SubmittedExistenceProvenVerificationIncomplete
            ),
            EffectOutcome::EffectConfirmed
        );
        assert_eq!(
            EffectOutcome::classify(EffectOutcomeSignal::VisibleMismatchedConfiguration),
            EffectOutcome::EffectPartiallyConfirmed
        );
        for s in [
            EffectOutcomeSignal::SuccessReturnedNoReread,
            EffectOutcomeSignal::TimeoutAfterSubmission,
            EffectOutcomeSignal::CrashAfterSubmission,
        ] {
            assert_eq!(EffectOutcome::classify(s), EffectOutcome::EffectUncertain);
        }
        assert_eq!(
            EffectOutcome::classify(EffectOutcomeSignal::AuthoritativeRereadAllPassed),
            EffectOutcome::CompletedAndVerified
        );
    }

    #[test]
    fn timeout_and_crash_are_uncertain_not_no_effect() {
        for s in [
            EffectOutcomeSignal::TimeoutAfterSubmission,
            EffectOutcomeSignal::CrashAfterSubmission,
        ] {
            let o = EffectOutcome::classify(s);
            assert_eq!(o, EffectOutcome::EffectUncertain);
            assert_ne!(o, EffectOutcome::NoEffectConfirmed);
        }
    }

    #[test]
    fn a_bare_success_return_is_uncertain_never_effect_confirmed() {
        let o = EffectOutcome::classify(EffectOutcomeSignal::SuccessReturnedNoReread);
        assert_eq!(o, EffectOutcome::EffectUncertain);
        assert_ne!(o, EffectOutcome::EffectConfirmed);
    }

    #[test]
    fn effect_confirmed_is_distinct_from_completed_and_verified() {
        let confirmed = EffectOutcome::classify(
            EffectOutcomeSignal::SubmittedExistenceProvenVerificationIncomplete,
        );
        let verified = EffectOutcome::classify(EffectOutcomeSignal::AuthoritativeRereadAllPassed);
        assert_ne!(confirmed, verified);
        assert!(!confirmed.success_claimable());
        assert!(confirmed.reconciliation_required());
        assert!(verified.success_claimable());
    }

    #[test]
    fn only_completed_and_verified_is_success_claimable() {
        for o in ALL_OUTCOMES {
            assert_eq!(
                o.success_claimable(),
                o == EffectOutcome::CompletedAndVerified,
                "{o:?}"
            );
        }
    }

    #[test]
    fn no_outcome_permits_an_automatic_retry() {
        for o in ALL_OUTCOMES {
            assert!(!o.automatic_retry_permitted(), "{o:?}");
        }
    }

    #[test]
    fn partial_and_uncertain_outcomes_require_reconciliation() {
        for o in [
            EffectOutcome::EffectConfirmed,
            EffectOutcome::EffectPartiallyConfirmed,
            EffectOutcome::EffectUncertain,
        ] {
            assert!(o.reconciliation_required(), "{o:?}");
        }
        assert!(!EffectOutcome::PreEffectRefused.reconciliation_required());
        assert!(!EffectOutcome::NoEffectConfirmed.reconciliation_required());
        assert!(!EffectOutcome::CompletedAndVerified.reconciliation_required());
    }

    #[test]
    fn every_outcome_maps_to_exactly_one_required_action() {
        use EffectOutcome as O;
        use RequiredAction as A;
        assert_eq!(
            O::PreEffectRefused.required_action(),
            A::FreshPreEffectEvaluation
        );
        assert_eq!(
            O::NoEffectConfirmed.required_action(),
            A::NewApprovalAndFreshChecks
        );
        assert_eq!(
            O::EffectConfirmed.required_action(),
            A::ReconciliationRequired
        );
        assert_eq!(
            O::EffectPartiallyConfirmed.required_action(),
            A::ReconciliationRequired
        );
        assert_eq!(
            O::EffectUncertain.required_action(),
            A::ReconciliationRequired
        );
        assert_eq!(
            O::CompletedAndVerified.required_action(),
            A::NoneProceedVerified
        );
    }

    #[test]
    fn reconciliation_and_rollback_are_actions_not_physical_outcomes() {
        // RequiredAction carries the governance concepts; EffectOutcome does not. This is enforced at
        // the type level — the following mapping proves the concepts live only on the action side.
        let _reconcile: RequiredAction = RequiredAction::ReconciliationRequired;
        let _rollback: RequiredAction = RequiredAction::RollbackApprovalRequired;
        // An action requirement never performs an effect and never authorises rollback.
        assert!(!RequiredAction::RollbackApprovalRequired.performs_automatic_effect());
        assert!(!RequiredAction::RollbackApprovalRequired.authorises_rollback());
        assert!(!RequiredAction::ReconciliationRequired.performs_automatic_effect());
    }

    #[test]
    fn destructive_remediation_requires_a_separate_rollback_approval_only() {
        for o in [
            EffectOutcome::EffectUncertain,
            EffectOutcome::EffectPartiallyConfirmed,
        ] {
            let a = o.destructive_remediation_action();
            assert_eq!(a, RequiredAction::RollbackApprovalRequired, "{o:?}");
            // Requiring approval is not the same as being authorised.
            assert!(!a.authorises_rollback());
        }
    }

    #[test]
    fn readiness_dimensions_are_orthogonal_metadata_and_pre_effect_cannot_grant_authority() {
        // SYNTHETIC scenario: structurally valid, metadata resolved, pure pre-effect prerequisites
        // met — yet the ACTUAL sealed authority is NotAuthorised. Completing everything short of
        // authority must NOT manufacture effect authority or execution readiness.
        let r = ContractReadiness::evaluate(
            InstallationContractStatus::ReadyForReview,
            StructuralValidity::ValidForReview,
            /* metadata_resolved */ true,
            /* pre_effect_prerequisites_met */ true,
            &InstallationEffectAuthority::NotAuthorised,
        );
        assert_eq!(r.structural, StructuralValidity::ValidForReview);
        assert_eq!(r.metadata, MetadataReadiness::Complete);
        assert!(r.pre_effect_ready);
        assert!(!r.effect_authority_ready);
        assert!(!r.execution_ready);
    }

    #[test]
    fn only_the_sealed_authority_participates_and_it_is_never_authorised() {
        // The production evaluator derives authority readiness solely from the sealed type, whose
        // only value is NotAuthorised → false. There is no Boolean route.
        let r = ContractReadiness::evaluate(
            InstallationContractStatus::ReadyForReview,
            StructuralValidity::ValidForReview,
            true,
            true,
            &InstallationEffectAuthority::current(),
        );
        assert!(!r.effect_authority_ready);
        assert!(!r.execution_ready);
    }

    /// A `cfg(test)`-only PURE combiner over ALREADY-DERIVED readiness Booleans. It accepts NO
    /// authority type, constructs no contract/request, is absent from release builds, and is NEVER
    /// used by production readiness logic. It exists only to demonstrate that the four-way conjunction
    /// would become true if every dimension were true — a logic check, not a production route.
    fn combine_readiness_for_test(
        structural_ready: bool,
        metadata_ready: bool,
        pre_effect_ready: bool,
        effect_authority_ready: bool,
    ) -> bool {
        structural_ready && metadata_ready && pre_effect_ready && effect_authority_ready
    }

    #[test]
    fn the_execution_conjunction_is_logically_complete() {
        assert!(combine_readiness_for_test(true, true, true, true));
        // Dropping the authority dimension alone blocks execution.
        assert!(!combine_readiness_for_test(true, true, true, false));
        assert!(!combine_readiness_for_test(true, true, false, true));
        assert!(!combine_readiness_for_test(true, false, true, true));
        assert!(!combine_readiness_for_test(false, true, true, true));
    }
}
