//! The pure data model for a proposed future service installation.
//!
//! Every value here describes an intended future requirement, not a present fact. Nothing claims a
//! service, account, SID, path or ACL exists. Unresolved values are modelled as explicit
//! `Unresolved` / `OwnerDecisionRequired` states — never a fabricated default that could be mistaken
//! for an approval.

/// The one owner-approved internal SCM service name.
pub const APPROVED_SERVICE_NAME: &str = "ProjectOSHost";

/// A metadata value the owner has not yet fixed.
///
/// `Recommended` carries a proposed value; it is NOT an approval. `OwnerDecisionRequired` and
/// `Unresolved` carry no value at all.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum MetadataDecision {
    /// A proposed value, advisory only.
    Recommended(String),
    /// The owner must decide; no value proposed.
    OwnerDecisionRequired,
    /// Not yet determined.
    Unresolved,
}

impl MetadataDecision {
    /// Whether this decision has been made by the owner. Always `false` — recommendations and
    /// unresolved states are not approvals, and this phase records no owner metadata approval.
    #[must_use]
    pub fn is_owner_resolved(&self) -> bool {
        false
    }

    /// The proposed value, if any. Never an approved value.
    #[must_use]
    pub fn recommended_value(&self) -> Option<&str> {
        match self {
            Self::Recommended(v) => Some(v),
            Self::OwnerDecisionRequired | Self::Unresolved => None,
        }
    }
}

/// The resolution state of a path that a later approved packaging/installation phase must supply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PackagedPathState {
    /// Must be resolved by a later approved installation; no path is known or claimed now. It must
    /// be absolute, canonical and packaged — never a developer build path or a private machine path.
    UnresolvedUntilApprovedInstallation,
}

/// The authoritative service SID state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceSidState {
    /// The per-service SID exists only after an approved installation; unknown and unclaimed now.
    UnresolvedUntilApprovedInstallation,
}

/// The final production-ACL state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FinalAclState {
    /// The final ACL cannot be composed until the authoritative service SID is proven.
    DeferredUntilServiceSidProven,
}

/// Windows startup type — modelled as a RECOMMENDATION only in this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StartupType {
    /// Started automatically at boot.
    Automatic,
    /// Started automatically after the boot-critical services.
    AutomaticDelayedStart,
    /// Started on demand.
    Manual,
    /// Cannot be started.
    Disabled,
}

/// A startup recommendation with rationale. Recommendation, never approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupRecommendation {
    /// The recommended startup type.
    pub recommended: StartupType,
    /// Fixed semantic rationale (never a path, name or machine identifier).
    pub rationale: &'static str,
}

impl StartupRecommendation {
    /// The recommendation for the ProjectOS host service.
    ///
    /// `AutomaticDelayedStart` matches the accepted 3K-D recovery plan (`ServiceRecoveryPlan`) and
    /// lets boot-critical Windows services start first, reducing early-boot contention while still
    /// bringing the host up without an operator. It is a recommendation; the owner decides.
    #[must_use]
    pub fn projectos_host() -> Self {
        Self {
            recommended: StartupType::AutomaticDelayedStart,
            rationale:
                "delayed-auto matches the accepted recovery plan and yields to boot-critical \
                        services while still starting unattended",
        }
    }
}

/// A single recovery action a failure step would take. Recommendation only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RecoveryAction {
    /// Restart the service.
    RestartService,
    /// Take no automatic action.
    TakeNoAction,
}

/// How non-crash terminations (a clean exit that reports a non-zero error) are treated by the
/// recovery policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum NonCrashFailureHandling {
    /// Extend the recovery policy to clean non-crash exits.
    RecoverOnNonCrash,
    /// Do NOT restart on a clean non-crash exit — the conservative fail-safe. This is the Windows
    /// default (failure actions apply to a crash, not an orderly exit) and it avoids restart-looping
    /// a process that exited on purpose; a human looks instead.
    IgnoreNonCrashCleanExit,
}

/// A recommended, bounded recovery configuration. Recommendation, never approval, never applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryRecommendation {
    /// Action after the first failure.
    pub first_failure: RecoveryAction,
    /// Action after the second failure.
    pub second_failure: RecoveryAction,
    /// Action after subsequent failures.
    pub subsequent_failure: RecoveryAction,
    /// Bounded maximum consecutive restarts before a human must intervene.
    pub max_consecutive_restarts: u32,
    /// Reset period (seconds) after which the failure count clears.
    pub reset_period_seconds: u32,
    /// Delay (seconds) before each restart.
    pub restart_delay_seconds: u32,
    /// How non-crash (clean-exit-with-error) terminations are treated. Explicitly modelled, never
    /// omitted.
    pub non_crash_handling: NonCrashFailureHandling,
}

impl RecoveryRecommendation {
    /// The recommendation, mirroring the accepted 3K-D `ServiceRecoveryPlan::intended()`: a small
    /// bounded restart budget, a day-long reset period, a short restart delay, and the conservative
    /// non-crash fail-safe consistent with that plan (which restarts on failure only).
    #[must_use]
    pub fn projectos_host() -> Self {
        Self {
            first_failure: RecoveryAction::RestartService,
            second_failure: RecoveryAction::RestartService,
            subsequent_failure: RecoveryAction::RestartService,
            max_consecutive_restarts: 3,
            reset_period_seconds: 86_400,
            restart_delay_seconds: 30,
            non_crash_handling: NonCrashFailureHandling::IgnoreNonCrashCleanExit,
        }
    }

    /// Whether the recovery policy is bounded (a real restart ceiling and a non-zero reset period).
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.max_consecutive_restarts >= 1
            && self.max_consecutive_restarts <= 5
            && self.reset_period_seconds > 0
    }

    /// Whether every recovery value is a recommendation only. Always `true` — nothing here is
    /// owner-approved or applied in this phase.
    #[must_use]
    pub fn is_recommendation_only(&self) -> bool {
        true
    }
}

/// How the future service creation would supply its account credential.
///
/// A virtual service account requires NO password: Windows manages the secret. There is deliberately
/// no field capable of holding a plaintext password anywhere in this model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CredentialModel {
    /// No password is supplied or stored; Windows manages the virtual account's secret.
    VirtualAccountNoPassword,
}

/// The service type a future creation request would declare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceTypeModel {
    /// A service that runs in its own process.
    OwnProcess,
}

/// The error-control mode a future creation request would declare.
///
/// `Normal` — log the error and continue — is the least-surprising fail-safe for a host service: a
/// start failure is recorded but does not halt the boot sequence or trigger last-known-good rollback,
/// which `SevereError`/`Critical` would. It is a recommendation only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ErrorControlModel {
    /// Log the error and continue startup.
    Normal,
}

/// Whether the future creation request would ask the SCM for a start-order tag ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TagIdBehaviour {
    /// No tag ID is requested. Tag IDs order boot-start/system-start drivers, not a user-mode host
    /// service, so none is needed.
    NotRequested,
}

/// Whether an arbitrary command line can be expressed. It cannot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CommandLineRepresentation {
    /// No arbitrary command line exists in this model. The future binary path is a resolved packaged
    /// executable, not a caller-supplied command string.
    NotRepresentable,
}

/// Whether a shell/interpreter launch route can be expressed. It cannot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ShellExecutionRepresentation {
    /// No shell, interpreter, or indirect launch route exists in this model.
    NotRepresentable,
}

/// The exact data a future APPROVED service-creation request would require.
///
/// This is a description of a future requirement. It has NO password field, NO arbitrary command
/// line, and NO launch route. The service name is fixed to the owner-approved value and cannot be
/// supplied by a caller; there is no fallback name and no numeric-suffix path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FutureCreationRequest {
    service_name: &'static str,
    display_name: MetadataDecision,
    description: MetadataDecision,
    desired_open_mask: u32,
    service_type: ServiceTypeModel,
    startup: StartupRecommendation,
    error_control: ErrorControlModel,
    binary_path: PackagedPathState,
    account: CredentialModel,
    dependencies_declared: bool,
    load_order_group: Option<&'static str>,
    tag_id: TagIdBehaviour,
    command_line: CommandLineRepresentation,
    shell_execution: ShellExecutionRepresentation,
}

impl FutureCreationRequest {
    /// The frozen future creation request for the ProjectOS host service.
    #[must_use]
    pub fn projectos_host() -> Self {
        Self {
            service_name: APPROVED_SERVICE_NAME,
            display_name: MetadataDecision::OwnerDecisionRequired,
            description: MetadataDecision::OwnerDecisionRequired,
            desired_open_mask: crate::rights::ScmOperation::OpenForCreation.required_mask(),
            service_type: ServiceTypeModel::OwnProcess,
            startup: StartupRecommendation::projectos_host(),
            error_control: ErrorControlModel::Normal,
            binary_path: PackagedPathState::UnresolvedUntilApprovedInstallation,
            account: CredentialModel::VirtualAccountNoPassword,
            dependencies_declared: false,
            load_order_group: None,
            tag_id: TagIdBehaviour::NotRequested,
            command_line: CommandLineRepresentation::NotRepresentable,
            shell_execution: ShellExecutionRepresentation::NotRepresentable,
        }
    }

    /// The fixed service name — always the owner-approved value.
    #[must_use]
    pub fn service_name(&self) -> &str {
        self.service_name
    }
    /// The display-name decision.
    #[must_use]
    pub fn display_name(&self) -> &MetadataDecision {
        &self.display_name
    }
    /// The description decision.
    #[must_use]
    pub fn description(&self) -> &MetadataDecision {
        &self.description
    }
    /// The SCM open mask this request would use (creation mask; never broad).
    #[must_use]
    pub fn desired_open_mask(&self) -> u32 {
        self.desired_open_mask
    }
    /// The service type.
    #[must_use]
    pub fn service_type(&self) -> ServiceTypeModel {
        self.service_type
    }
    /// The startup recommendation.
    #[must_use]
    pub fn startup(&self) -> StartupRecommendation {
        self.startup
    }
    /// The error-control mode.
    #[must_use]
    pub fn error_control(&self) -> ErrorControlModel {
        self.error_control
    }
    /// The binary-path state (unresolved until an approved installation).
    #[must_use]
    pub fn binary_path(&self) -> PackagedPathState {
        self.binary_path
    }
    /// The credential model — always no-password for a virtual account.
    #[must_use]
    pub fn account(&self) -> CredentialModel {
        self.account
    }
    /// Whether any service dependency is declared. Always false unless repository evidence proves a
    /// mandatory dependency — none does.
    #[must_use]
    pub fn declares_dependencies(&self) -> bool {
        self.dependencies_declared
    }
    /// The load-order group, if any. None.
    #[must_use]
    pub fn load_order_group(&self) -> Option<&'static str> {
        self.load_order_group
    }
    /// The tag-ID behaviour. Never requested.
    #[must_use]
    pub fn tag_id(&self) -> TagIdBehaviour {
        self.tag_id
    }
    /// Command-line representability. Never representable.
    #[must_use]
    pub fn command_line(&self) -> CommandLineRepresentation {
        self.command_line
    }
    /// Shell-execution representability. Never representable.
    #[must_use]
    pub fn shell_execution(&self) -> ShellExecutionRepresentation {
        self.shell_execution
    }

    /// Whether every metadata value this request needs before an effect is resolved. Always `false`
    /// in this phase — display name and description remain owner decisions.
    #[must_use]
    pub fn metadata_fully_resolved(&self) -> bool {
        self.display_name.is_owner_resolved() && self.description.is_owner_resolved()
    }

    /// The derived FUTURE virtual-account identity expression, `NT SERVICE\ProjectOSHost`.
    ///
    /// This is a derived string only — the account and its SID exist solely after an approved
    /// installation, and this method claims neither.
    #[must_use]
    pub fn derived_future_account_expression(&self) -> String {
        format!("NT SERVICE\\{}", self.service_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_service_name_is_fixed_to_the_owner_approved_value() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.service_name(), APPROVED_SERVICE_NAME);
        assert_eq!(req.service_name(), "ProjectOSHost");
    }

    #[test]
    fn metadata_and_paths_are_unresolved_not_defaulted() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.display_name(), &MetadataDecision::OwnerDecisionRequired);
        assert!(!req.display_name().is_owner_resolved());
        assert_eq!(
            req.binary_path(),
            PackagedPathState::UnresolvedUntilApprovedInstallation
        );
    }

    #[test]
    fn the_account_model_has_no_password() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.account(), CredentialModel::VirtualAccountNoPassword);
        // Rendering the whole request must never contain a password value.
        let text = format!("{req:?}");
        assert!(!text.to_ascii_lowercase().contains("password:"));
        assert!(!text.contains("NoPassword") || text.contains("VirtualAccountNoPassword"));
    }

    #[test]
    fn the_creation_mask_is_not_broad() {
        let req = FutureCreationRequest::projectos_host();
        assert!(!crate::rights::is_broad(req.desired_open_mask()));
    }

    #[test]
    fn no_dependency_and_no_load_order_group_are_invented() {
        let req = FutureCreationRequest::projectos_host();
        assert!(!req.declares_dependencies());
        assert_eq!(req.load_order_group(), None);
    }

    #[test]
    fn the_future_account_expression_is_derived_not_claimed_to_exist() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(
            req.derived_future_account_expression(),
            "NT SERVICE\\ProjectOSHost"
        );
    }

    #[test]
    fn the_startup_recommendation_is_delayed_auto_and_advisory() {
        let r = StartupRecommendation::projectos_host();
        assert_eq!(r.recommended, StartupType::AutomaticDelayedStart);
        assert!(!r.rationale.is_empty());
    }

    #[test]
    fn the_recovery_recommendation_is_bounded_and_recommendation_only() {
        let r = RecoveryRecommendation::projectos_host();
        assert!(r.is_bounded());
        assert!(r.is_recommendation_only());
        assert_eq!(r.max_consecutive_restarts, 3);
        assert_eq!(r.reset_period_seconds, 86_400);
        assert_eq!(r.restart_delay_seconds, 30);
    }

    #[test]
    fn every_recovery_failure_step_is_an_explicit_action() {
        let r = RecoveryRecommendation::projectos_host();
        assert_eq!(r.first_failure, RecoveryAction::RestartService);
        assert_eq!(r.second_failure, RecoveryAction::RestartService);
        assert_eq!(r.subsequent_failure, RecoveryAction::RestartService);
    }

    #[test]
    fn non_crash_failure_handling_is_explicit_and_conservative() {
        let r = RecoveryRecommendation::projectos_host();
        assert_eq!(
            r.non_crash_handling,
            NonCrashFailureHandling::IgnoreNonCrashCleanExit
        );
    }

    #[test]
    fn the_description_is_an_unresolved_owner_decision() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.description(), &MetadataDecision::OwnerDecisionRequired);
        assert!(!req.description().is_owner_resolved());
        assert!(!req.metadata_fully_resolved());
    }

    #[test]
    fn the_service_type_is_explicit_own_process() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.service_type(), ServiceTypeModel::OwnProcess);
    }

    #[test]
    fn the_error_control_mode_is_explicit_normal() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.error_control(), ErrorControlModel::Normal);
    }

    #[test]
    fn tag_id_command_line_and_shell_are_explicitly_absent() {
        let req = FutureCreationRequest::projectos_host();
        assert_eq!(req.tag_id(), TagIdBehaviour::NotRequested);
        assert_eq!(
            req.command_line(),
            CommandLineRepresentation::NotRepresentable
        );
        assert_eq!(
            req.shell_execution(),
            ShellExecutionRepresentation::NotRepresentable
        );
    }

    #[test]
    fn a_metadata_recommendation_is_never_an_approval() {
        let m = MetadataDecision::Recommended("ProjectOS Host Service".to_string());
        assert!(!m.is_owner_resolved());
        assert_eq!(m.recommended_value(), Some("ProjectOS Host Service"));
    }
}
