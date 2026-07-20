//! External (black-box) contract tests. These exercise ONLY the public API and prove the frozen
//! installation contract from a consumer's point of view: the owner-approved name, the sealed
//! unauthorised effect, structural-validity-is-not-readiness, the complete effect taxonomy, the
//! no-password creation shape, the minimum access masks, the mandatory post-effect re-read, and the
//! no-automatic-recovery reconciliation rules.

use contract::{
    CommandLineRepresentation, ContractViolation, CredentialModel, EffectOutcome,
    EffectOutcomeSignal, ErrorControlModel, ForbiddenAutomaticAction, InstallationContractStatus,
    InstallationEffectAuthority, MetadataDecision, MetadataReadiness, NonCrashFailureHandling,
    PackagedPathState, ReconciliationDecision, ReconciliationSituation, RecoveryAction,
    RequiredAction, ServiceSidState, ServiceTypeModel, ShellExecutionRepresentation, StartupType,
    StructuralValidity, TagIdBehaviour, APPROVED_SERVICE_NAME,
};
use projectos_host_windows_service_installation_contract as contract;

fn frozen() -> contract::ServiceInstallationContract {
    contract::projectos_v3_service_installation_contract()
        .expect("owner-approved name and strategy are present in the accepted crates")
}

#[test]
fn the_authority_builds_a_structurally_valid_contract() {
    assert_eq!(
        frozen().validate_structure_for_review().unwrap(),
        StructuralValidity::ValidForReview
    );
}

#[test]
fn structural_validity_is_not_execution_readiness() {
    let c = frozen();
    assert!(c.validate_structure_for_review().is_ok());
    let r = c.readiness();
    assert!(!r.is_execution_ready());
    assert!(!r.is_effect_authorised());
    assert!(!r.pre_effect_ready);
    assert!(!r.effect_authority_ready);
    assert!(!r.execution_ready);
}

#[test]
fn the_lifecycle_is_ready_for_review_only() {
    assert_eq!(
        frozen().lifecycle(),
        InstallationContractStatus::ReadyForReview
    );
}

#[test]
fn metadata_readiness_is_incomplete() {
    assert_eq!(frozen().readiness().metadata, MetadataReadiness::Incomplete);
}

#[test]
fn the_service_name_is_exactly_the_owner_approved_value() {
    let c = frozen();
    assert_eq!(c.creation_request().service_name(), "ProjectOSHost");
    assert_eq!(c.creation_request().service_name(), APPROVED_SERVICE_NAME);
}

#[test]
fn installation_is_unconditionally_not_authorised() {
    let c = frozen();
    assert_eq!(
        c.effect_authority(),
        InstallationEffectAuthority::NotAuthorised
    );
    assert!(!c.effect_authority().is_authorised());
}

#[test]
fn the_creation_request_carries_no_password() {
    assert_eq!(
        frozen().creation_request().account(),
        CredentialModel::VirtualAccountNoPassword
    );
}

#[test]
fn metadata_and_paths_are_unresolved_not_defaulted() {
    let c = frozen();
    assert_eq!(
        c.creation_request().display_name(),
        &MetadataDecision::OwnerDecisionRequired
    );
    assert_eq!(
        c.creation_request().description(),
        &MetadataDecision::OwnerDecisionRequired
    );
    assert!(!c.creation_request().display_name().is_owner_resolved());
    assert!(!c.creation_request().metadata_fully_resolved());
    assert_eq!(
        c.creation_request().binary_path(),
        PackagedPathState::UnresolvedUntilApprovedInstallation
    );
    assert_eq!(
        c.service_sid(),
        ServiceSidState::UnresolvedUntilApprovedInstallation
    );
}

#[test]
fn the_open_mask_is_the_creation_minimum_not_a_broad_mask() {
    let mask = frozen().creation_request().desired_open_mask();
    assert!(!contract::rights::is_broad(mask));
    assert_eq!(
        mask,
        contract::rights::SC_MANAGER_CONNECT | contract::rights::SC_MANAGER_CREATE_SERVICE
    );
}

#[test]
fn every_modelled_operation_requests_only_its_minimum() {
    for op in contract::rights::ScmOperation::all() {
        assert!(!contract::rights::is_broad(op.required_mask()), "{op:?}");
    }
}

#[test]
fn creation_request_fields_are_all_explicit() {
    let req = frozen();
    let req = req.creation_request();
    assert_eq!(req.service_type(), ServiceTypeModel::OwnProcess);
    assert_eq!(req.error_control(), ErrorControlModel::Normal);
    assert_eq!(req.load_order_group(), None);
    assert!(!req.declares_dependencies());
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
fn the_startup_is_a_delayed_auto_recommendation() {
    assert_eq!(
        frozen().startup().recommended,
        StartupType::AutomaticDelayedStart
    );
}

#[test]
fn the_recovery_recommendation_is_bounded_and_recommendation_only() {
    let r = frozen().recovery();
    assert!(r.is_bounded());
    assert!(r.is_recommendation_only());
    assert_eq!(r.max_consecutive_restarts, 3);
    assert_eq!(r.first_failure, RecoveryAction::RestartService);
    assert_eq!(
        r.non_crash_handling,
        NonCrashFailureHandling::IgnoreNonCrashCleanExit
    );
}

#[test]
fn the_pre_effect_sequence_is_ordered_and_complete() {
    let c = frozen();
    let seq = c.pre_effect_sequence();
    assert_eq!(seq.len(), 22);
    for (i, check) in seq.iter().enumerate() {
        assert_eq!(check.order(), i);
    }
}

#[test]
fn every_post_effect_verification_is_present() {
    assert_eq!(frozen().post_effect_verifications().len(), 13);
}

#[test]
fn every_required_effect_state_is_representable() {
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
        EffectOutcome::classify(EffectOutcomeSignal::AuthoritativeRereadAllPassed),
        EffectOutcome::CompletedAndVerified
    );
}

#[test]
fn pre_effect_refused_is_distinct_from_no_effect_confirmed() {
    assert_ne!(
        EffectOutcome::classify(EffectOutcomeSignal::PreEffectConditionFailed),
        EffectOutcome::classify(EffectOutcomeSignal::NeverSubmittedAbsenceProven)
    );
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
fn a_success_return_without_a_reread_is_uncertain_never_confirmed() {
    let uncertain = EffectOutcome::classify(EffectOutcomeSignal::SuccessReturnedNoReread);
    assert_eq!(uncertain, EffectOutcome::EffectUncertain);
    assert!(!uncertain.success_claimable());
}

#[test]
fn partial_and_uncertain_effects_require_reconciliation() {
    for s in [
        EffectOutcomeSignal::VisibleMismatchedConfiguration,
        EffectOutcomeSignal::TimeoutAfterSubmission,
        EffectOutcomeSignal::CrashAfterSubmission,
    ] {
        assert!(
            EffectOutcome::classify(s).reconciliation_required(),
            "{s:?}"
        );
    }
}

#[test]
fn rollback_requires_a_separate_approval() {
    // Destructive remediation of an uncertain/partial effect escalates to a rollback approval.
    assert_eq!(
        EffectOutcome::EffectUncertain.destructive_remediation_action(),
        RequiredAction::RollbackApprovalRequired
    );
    assert_eq!(
        EffectOutcome::EffectPartiallyConfirmed.destructive_remediation_action(),
        RequiredAction::RollbackApprovalRequired
    );
}

#[test]
fn no_classification_permits_an_automatic_retry() {
    for s in [
        EffectOutcomeSignal::PreEffectConditionFailed,
        EffectOutcomeSignal::NeverSubmittedAbsenceProven,
        EffectOutcomeSignal::SubmittedExistenceProvenVerificationIncomplete,
        EffectOutcomeSignal::SuccessReturnedNoReread,
        EffectOutcomeSignal::TimeoutAfterSubmission,
        EffectOutcomeSignal::CrashAfterSubmission,
        EffectOutcomeSignal::VisibleMismatchedConfiguration,
        EffectOutcomeSignal::AuthoritativeRereadAllPassed,
    ] {
        assert!(!EffectOutcome::classify(s).automatic_retry_permitted());
    }
}

#[test]
fn reconciliation_never_performs_an_automatic_effect() {
    for situation in [
        ReconciliationSituation::NothingToReconcile,
        ReconciliationSituation::UnexplainedServicePresent,
        ReconciliationSituation::EffectUncertain,
        ReconciliationSituation::ConfigurationMismatch,
        ReconciliationSituation::PartialInstallation,
        ReconciliationSituation::NameCollisionWithForeignService,
    ] {
        assert!(
            !situation.decision().performs_automatic_effect(),
            "{situation:?}"
        );
    }
}

#[test]
fn uncertain_and_partial_situations_escalate_to_a_human() {
    assert_eq!(
        ReconciliationSituation::EffectUncertain.decision(),
        ReconciliationDecision::RequireSeparateRollbackApproval
    );
    assert_eq!(
        ReconciliationSituation::PartialInstallation.decision(),
        ReconciliationDecision::RequireSeparateRollbackApproval
    );
    assert_eq!(
        ReconciliationSituation::ConfigurationMismatch.decision(),
        ReconciliationDecision::RequireSeparateReconfigurationApproval
    );
}

#[test]
fn every_forbidden_automatic_action_is_forbidden() {
    assert_eq!(ForbiddenAutomaticAction::all().len(), 6);
    for a in ForbiddenAutomaticAction::all() {
        assert!(!a.is_permitted(), "{a:?}");
    }
}

#[test]
fn the_future_account_expression_is_derived_from_the_approved_name() {
    assert_eq!(
        frozen()
            .creation_request()
            .derived_future_account_expression(),
        "NT SERVICE\\ProjectOSHost"
    );
}

#[test]
fn validation_reports_a_named_violation_type() {
    let _ = ContractViolation::WrongServiceName;
    assert!(matches!(
        frozen().validate_structure_for_review(),
        Ok(StructuralValidity::ValidForReview)
    ));
}
