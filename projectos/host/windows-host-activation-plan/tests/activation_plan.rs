//! Pure, side-effect-free validation of the activation plan from a DEPENDENT-CRATE view.
//!
//! Every test here is arithmetic over values. Nothing in this file touches ProgramData, changes an
//! ACL, opens the Service Control Manager, installs/configures/starts a service, writes the
//! registry, mints or protects a key, reads a credential, or launches a process — the crate under
//! test has no capability to do any of those, and this file adds none.

use projectos_host_windows_activation_plan::{
    classify_forbidden, AclCompositionOutcome, AclCompositionPlan, ActivationDecision,
    ActivationPlanError, ActivationSequence, ActivationStep, ActivationViolation, ApprovalStatus,
    ApprovedServicePrincipal, DuplicateInstancePolicy, EffectClassification, ExceptionalOperation,
    ForbiddenRootKind, HostActivationPlan, IdentityDecisionStatus, InteractiveOwnerAccess,
    KnownFolderAnchor, PossibleEffect, ProductionRootPlan, RootSegment, RootSubtree,
    SafeModeBehaviour, ServiceIdentityPlan, ServiceIdentityStrategy, ServiceNameStatus,
    ServiceRecoveryPlan, ServiceSidStatus, ServiceSidSupport, UncertainScenario,
    PLAN_CONTRACT_VERSION,
};

// ------------------------------------------------------------------ A. SAFE ROOT PLAN

#[test]
fn the_canonical_root_plan_is_accepted_and_anchored_not_resolved() {
    let plan = ProductionRootPlan::canonical().expect("canonical root plan must be valid");
    assert_eq!(plan.anchor(), KnownFolderAnchor::ProgramData);
    assert_eq!(plan.symbolic_path(), "%KNOWNFOLDER:ProgramData%\\ProjectOS");
    assert!(
        !plan.symbolic_path().contains(":\\"),
        "never a resolved path"
    );
    for subtree in [
        RootSubtree::HostState,
        RootSubtree::ProjectState,
        RootSubtree::DurableState,
        RootSubtree::Journal,
        RootSubtree::Staging,
        RootSubtree::CredentialReference,
    ] {
        assert!(plan.includes(subtree), "{subtree:?} must be planned");
    }
}

#[test]
fn every_unsafe_root_shape_is_refused() {
    for (input, expected) in [
        ("", ActivationPlanError::EmptySegment),
        ("..", ActivationPlanError::TraversalSegment),
        ("a\\b", ActivationPlanError::SeparatorInSegment),
        ("name:stream", ActivationPlanError::AlternateDataStream),
        ("\\\\?\\C", ActivationPlanError::DeviceNamespace),
        ("\\\\server", ActivationPlanError::UnsupportedUncRoot),
        ("NUL", ActivationPlanError::ReservedName),
    ] {
        assert_eq!(
            RootSegment::parse(input).unwrap_err(),
            expected,
            "{input:?}"
        );
    }
}

#[test]
fn user_profile_repository_and_temporary_roots_are_refused_as_production_authority() {
    for (input, expected) in [
        ("C:\\Users\\someone\\X", ForbiddenRootKind::UserProfile),
        ("C:\\dev\\ProjectOS", ForbiddenRootKind::RepositoryPath),
        ("C:\\Windows\\Temp\\x", ForbiddenRootKind::SystemTemporary),
        ("%PROGRAMDATA%\\X", ForbiddenRootKind::EnvironmentVariable),
        ("relative\\path", ForbiddenRootKind::RelativePath),
        ("\\\\server\\share", ForbiddenRootKind::NetworkOrRemovable),
    ] {
        assert_eq!(classify_forbidden(input), Some(expected), "{input:?}");
    }
}

#[test]
fn a_namespace_collision_is_refused() {
    assert_eq!(
        ProductionRootPlan::new(
            KnownFolderAnchor::ProgramData,
            &["ProjectOS"],
            &[RootSubtree::DurableState, RootSubtree::DurableState],
        )
        .unwrap_err(),
        ActivationPlanError::NamespaceCollision
    );
}

// ------------------------------------------------------- B. SERVICE IDENTITY OPTIONS

#[test]
fn all_five_identity_strategies_are_represented_with_honest_trade_offs() {
    let plan = ServiceIdentityPlan::analysed();
    assert_eq!(plan.candidates().len(), 5);
    for s in [
        ServiceIdentityStrategy::LocalSystem,
        ServiceIdentityStrategy::LocalService,
        ServiceIdentityStrategy::NetworkService,
        ServiceIdentityStrategy::VirtualServiceAccount,
        ServiceIdentityStrategy::OwnerApprovedAccount,
    ] {
        let p = plan.profile(s).expect("every strategy must be analysed");
        assert!(p.owner_decision_required);
        // Only a per-service SID can express "this service and nothing else".
        assert_eq!(
            p.supports_service_only_custody,
            p.service_sid_support != ServiceSidSupport::SharedWellKnown
        );
    }
}

#[test]
fn the_final_identity_stays_unresolved_without_an_owner_decision() {
    let plan = ServiceIdentityPlan::analysed();
    assert_eq!(
        plan.decision(),
        IdentityDecisionStatus::Recommended(ServiceIdentityStrategy::VirtualServiceAccount)
    );
    assert!(
        !plan.is_owner_approved(),
        "a recommendation is never an approval"
    );
    assert_eq!(
        plan.decided().unwrap_err(),
        ActivationPlanError::ServiceIdentityRequired
    );
    // No silent fallback to the most privileged identity.
    assert_ne!(plan.recommended(), ServiceIdentityStrategy::LocalSystem);
}

#[test]
fn the_service_sid_can_never_be_invented_or_supplied() {
    let plan = ServiceIdentityPlan::analysed()
        .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
    // Deciding the strategy does not conjure a SID.
    assert_eq!(
        plan.sid_status(),
        ServiceSidStatus::UnresolvedUntilActivation
    );
    // And a principal cannot be minted for any strategy needing a live Windows lookup.
    assert_eq!(
        ApprovedServicePrincipal::from_well_known(ServiceIdentityStrategy::VirtualServiceAccount)
            .unwrap_err(),
        ActivationPlanError::ServiceSidUnresolved
    );
}

#[test]
fn the_interactive_user_is_never_the_production_service_identity() {
    let plan = ServiceIdentityPlan::analysed();
    // There is no interactive-user strategy at all.
    assert!(plan.candidates().iter().all(|p| !matches!(
        p.strategy,
        ServiceIdentityStrategy::OwnerApprovedAccount
    ) || p.requires_owner_provisioning));
    // The only place the interactive user may appear is a deliberate READ-ONLY inspection ACE.
    let identity =
        ServiceIdentityPlan::analysed().with_owner_decision(ServiceIdentityStrategy::LocalSystem);
    let AclCompositionOutcome::Composed(policy) = AclCompositionPlan::production()
        .with_interactive_owner(InteractiveOwnerAccess::ReadOnly)
        .compose(&identity)
    else {
        panic!("composition must succeed for a well-known principal")
    };
    assert_ne!(
        policy.expected_owner,
        projectos_host_windows_acl_policy::AclPrincipal::CurrentInteractiveUser,
        "the interactive user must never own the production root"
    );
}

// ------------------------------------------- B2. OWNER DECISION vs RECOMMENDATION

#[test]
fn an_undecided_plan_finalises_nothing_and_authorises_nothing() {
    let identity = ServiceIdentityPlan::undecided();
    assert_eq!(identity.decision(), IdentityDecisionStatus::Undecided);
    assert!(identity.decided().is_err(), "no strategy is final");
    assert_eq!(
        AclCompositionPlan::production().compose(&identity),
        AclCompositionOutcome::OwnerDecisionRequired
    );
    // Installation and production remain unauthorised regardless.
    let seq = ActivationSequence::new();
    assert_eq!(
        seq.status(ActivationStep::InstallOrVerifyServiceIdentity),
        ApprovalStatus::NotAuthorised
    );
    assert_eq!(
        seq.status(ActivationStep::VerifyProductionAuthorisation),
        ApprovalStatus::NotAuthorised
    );
}

#[test]
fn a_recommendation_alone_never_becomes_an_owner_approval() {
    let identity = ServiceIdentityPlan::analysed();
    assert_eq!(
        identity.recommended(),
        ServiceIdentityStrategy::VirtualServiceAccount,
        "VirtualServiceAccount may be recommended"
    );
    assert_eq!(
        identity.decision(),
        IdentityDecisionStatus::Recommended(ServiceIdentityStrategy::VirtualServiceAccount)
    );
    assert!(!identity.is_owner_approved());
    assert!(identity.decided().is_err());
    assert_eq!(
        AclCompositionPlan::production().compose(&identity),
        AclCompositionOutcome::OwnerDecisionRequired,
        "a recommendation must not unblock composition"
    );
    // Nothing became executable.
    let plan = HostActivationPlan::canonical().unwrap();
    assert!(!plan.identity().is_owner_approved());
    assert!(!plan.is_execution_ready());
}

/// The exact owner decision supplied: APPROVE VIRTUAL SERVICE ACCOUNT.
#[test]
fn the_owner_approved_virtual_service_account_resolves_the_strategy_and_nothing_else() {
    let plan = HostActivationPlan::projectos_v3_frozen().unwrap();

    // A. STRATEGY SELECTED — by the owner, recorded as such.
    assert_eq!(
        plan.identity().decision(),
        IdentityDecisionStatus::OwnerApproved(ServiceIdentityStrategy::VirtualServiceAccount)
    );
    assert!(plan.identity().is_owner_approved());
    assert_eq!(
        plan.identity().decided().unwrap(),
        ServiceIdentityStrategy::VirtualServiceAccount
    );

    // B/C. IDENTITY and SID remain unresolved — Windows must produce them later.
    assert_eq!(
        plan.identity().sid_status(),
        ServiceSidStatus::UnresolvedUntilActivation
    );
    assert_eq!(
        ApprovedServicePrincipal::from_well_known(ServiceIdentityStrategy::VirtualServiceAccount)
            .unwrap_err(),
        ActivationPlanError::ServiceSidUnresolved
    );
    assert_eq!(
        plan.compose_acl(),
        AclCompositionOutcome::ServiceIdentityRequired,
        "an approved STRATEGY must not compose a final ACL"
    );

    // The service name is a separate, still-unmade owner decision.
    assert_eq!(
        plan.identity().service_name(),
        ServiceNameStatus::OwnerDecisionRequired
    );

    // D/E. Every later gate remains independently unapproved.
    for step in [
        ActivationStep::InstallOrVerifyServiceIdentity,
        ActivationStep::CreateProductionRoot,
        ActivationStep::ApplyAndVerifyAcl,
        ActivationStep::InitialiseServiceOnlyKeyCustody,
        ActivationStep::ConfigureWindowsService,
        ActivationStep::StartService,
        ActivationStep::VerifyProductionAuthorisation,
    ] {
        assert_eq!(
            plan.sequence().status(step),
            ApprovalStatus::NotAuthorised,
            "{step:?} must stay separately gated"
        );
    }
    assert!(!plan.is_execution_ready());
}

#[test]
fn every_alternative_owner_decision_keeps_its_own_risk_classification() {
    for strategy in [
        ServiceIdentityStrategy::LocalSystem,
        ServiceIdentityStrategy::LocalService,
        ServiceIdentityStrategy::NetworkService,
        ServiceIdentityStrategy::VirtualServiceAccount,
        ServiceIdentityStrategy::OwnerApprovedAccount,
    ] {
        let identity = ServiceIdentityPlan::analysed().with_owner_decision(strategy);
        assert_eq!(identity.decided().unwrap(), strategy);
        // Approving a strategy never rewrites its honest profile.
        let profile = identity.profile(strategy).unwrap();
        assert_eq!(
            profile.supports_service_only_custody,
            profile.service_sid_support != ServiceSidSupport::SharedWellKnown,
            "{strategy:?} risk classification must be unchanged by approval"
        );
        assert_eq!(
            identity.sid_status(),
            ServiceSidStatus::UnresolvedUntilActivation
        );
    }
}

#[test]
fn the_recorded_owner_decision_carries_no_raw_material() {
    let plan = HostActivationPlan::projectos_v3_frozen().unwrap();
    let rendered = format!("{:?}", plan.identity());
    assert!(!rendered.contains("S-1-"), "no raw SID");
    assert!(!rendered.contains(":\\"), "no machine path");
    assert!(!rendered.contains("0x"), "no handle or pointer");
    assert!(rendered.contains("UnresolvedUntilActivation"));
    assert!(
        rendered.contains("OwnerDecisionRequired"),
        "service name unresolved"
    );
    let lower = rendered.to_ascii_lowercase();
    assert!(!lower.contains("password:"));
    assert!(!lower.contains("token:"));
    assert!(!lower.contains("hkey"));
}

#[test]
fn approval_cannot_arrive_by_default_environment_or_session() {
    // The default-shaped constructors are NEVER approved.
    assert!(!HostActivationPlan::canonical()
        .unwrap()
        .identity()
        .is_owner_approved());
    assert!(!ServiceIdentityPlan::analysed().is_owner_approved());
    assert!(!ServiceIdentityPlan::undecided().is_owner_approved());
    assert!(!ActivationSequence::default()
        .gates()
        .iter()
        .any(|g| g.status != ApprovalStatus::NotAuthorised));
    // There is no deserialisation route (no serde anywhere), no environment read and no session
    // state in this crate, so `with_owner_decision` is the single reachable path to approval.
    assert!(!ServiceIdentityPlan::analysed().clone().is_owner_approved());
}

// ------------------------------------- B3. PROJECTOS FROZEN PLAN (single authority)

/// The frozen plan binds the strategy and NOTHING else. Every other state stays where it was.
#[test]
fn the_frozen_plan_binds_the_owner_approved_strategy_and_resolves_nothing_further() {
    let frozen = HostActivationPlan::projectos_v3_frozen().unwrap();

    // A. STRATEGY OWNER-APPROVED.
    assert_eq!(
        frozen.identity().decision(),
        IdentityDecisionStatus::OwnerApproved(ServiceIdentityStrategy::VirtualServiceAccount)
    );
    assert!(frozen.identity().is_owner_approved());
    assert_eq!(
        frozen.identity().decided().unwrap(),
        ServiceIdentityStrategy::VirtualServiceAccount,
        "no fallback: the frozen plan selects exactly one strategy"
    );

    // B. SERVICE NAME — still an unmade owner decision.
    assert_eq!(
        frozen.identity().service_name(),
        ServiceNameStatus::OwnerDecisionRequired
    );
    // C/D. IDENTITY and SID — unresolved.
    assert_eq!(
        frozen.identity().sid_status(),
        ServiceSidStatus::UnresolvedUntilActivation
    );
    // ACL composition stays blocked until Windows resolves the SID.
    assert_eq!(
        frozen.compose_acl(),
        AclCompositionOutcome::ServiceIdentityRequired
    );

    // E–J. Every effect gate untouched by the strategy approval.
    for step in ActivationStep::all() {
        assert_eq!(
            frozen.sequence().status(*step),
            ApprovalStatus::NotAuthorised,
            "{step:?} must remain NotAuthorised"
        );
    }
    // Credential migration and rollback are gated too, and are not sequence steps.
    for op in ExceptionalOperation::all() {
        assert_eq!(
            frozen.sequence().exceptional_status(*op),
            ApprovalStatus::NotAuthorised,
            "{op:?} must remain NotAuthorised"
        );
    }
    assert!(!frozen.is_execution_ready());
}

/// The GENERIC plan must never be owner-approved, however the frozen plan is defined.
#[test]
fn the_generic_canonical_plan_remains_unapproved_and_inert() {
    let generic = HostActivationPlan::canonical().unwrap();
    assert!(!generic.identity().is_owner_approved());
    assert!(matches!(
        generic.identity().decision(),
        IdentityDecisionStatus::Recommended(_)
    ));
    assert!(generic.identity().decided().is_err());
    assert_eq!(
        generic.compose_acl(),
        AclCompositionOutcome::OwnerDecisionRequired,
        "the generic plan cannot compose the final ACL"
    );
    assert!(!generic.is_execution_ready());
    // It cannot install a service or create ProgramData: both gates are unauthorised, and every
    // prerequisite is unconfirmed.
    for step in [
        ActivationStep::InstallOrVerifyServiceIdentity,
        ActivationStep::CreateProductionRoot,
    ] {
        assert_eq!(
            generic.sequence().status(step),
            ApprovalStatus::NotAuthorised
        );
        assert!(generic.sequence().check_executable(step).is_err());
    }
    // The two plans are genuinely different values — approval is not hiding in the generic one.
    assert_ne!(generic, HostActivationPlan::projectos_v3_frozen().unwrap());
}

/// Exactly one frozen-plan authority, reached through the one public decision API.
#[test]
fn there_is_exactly_one_frozen_plan_authority_and_no_shortcut() {
    let a = HostActivationPlan::projectos_v3_frozen().unwrap();
    let b = HostActivationPlan::projectos_v3_frozen().unwrap();
    assert_eq!(a, b, "the frozen plan is deterministic");

    // The frozen plan is reproducible through the ordinary public decision API — proving it is not
    // a privileged back door that produces a state callers could not otherwise express.
    let via_public_api = HostActivationPlan::canonical()
        .unwrap()
        .with_owner_identity_decision(ServiceIdentityStrategy::VirtualServiceAccount);
    assert_eq!(a, via_public_api, "no hidden shortcut or extra privilege");

    // And that same API cannot smuggle approval into the generic constructor.
    assert!(!HostActivationPlan::canonical()
        .unwrap()
        .identity()
        .is_owner_approved());
}

#[test]
fn exceptional_operations_are_gated_and_are_not_activation_steps() {
    assert_eq!(ExceptionalOperation::all().len(), 2);
    let seq = ActivationSequence::new();
    for op in ExceptionalOperation::all() {
        assert_eq!(
            seq.exceptional_status(*op),
            ApprovalStatus::NotAuthorised,
            "{op:?} starts unauthorised"
        );
    }
    // Approving one never advances the forward sequence.
    let seq = seq.with_exceptional_status(
        ExceptionalOperation::CredentialMigration,
        ApprovalStatus::ApprovedForOneOperation,
    );
    assert_eq!(
        seq.exceptional_status(ExceptionalOperation::RollbackOrDestructiveCleanup),
        ApprovalStatus::NotAuthorised
    );
    assert_eq!(
        seq.next_action(),
        ActivationDecision::ReadyForExecution(ActivationStep::VerifyBaseline),
        "an exceptional approval must not change the activation sequence"
    );
}

// ------------------------------------------------------------- C. ACL COMPOSITION

#[test]
fn an_unresolved_service_identity_blocks_the_final_acl_plan() {
    assert_eq!(
        AclCompositionPlan::production().compose(&ServiceIdentityPlan::analysed()),
        AclCompositionOutcome::OwnerDecisionRequired
    );
    for strategy in [
        ServiceIdentityStrategy::VirtualServiceAccount,
        ServiceIdentityStrategy::LocalService,
        ServiceIdentityStrategy::NetworkService,
        ServiceIdentityStrategy::OwnerApprovedAccount,
    ] {
        assert_eq!(
            AclCompositionPlan::production()
                .compose(&ServiceIdentityPlan::analysed().with_owner_decision(strategy)),
            AclCompositionOutcome::ServiceIdentityRequired,
            "{strategy:?}"
        );
    }
}

#[test]
fn a_composed_policy_is_strict_and_grants_no_broad_authority() {
    let identity =
        ServiceIdentityPlan::analysed().with_owner_decision(ServiceIdentityStrategy::LocalSystem);
    let AclCompositionOutcome::Composed(policy) =
        AclCompositionPlan::production().compose(&identity)
    else {
        panic!("must compose")
    };
    assert!(!policy.grants_broad_write());
    assert!(!policy.allow_broad_principals_any_access);
    assert!(!policy.allow_broad_principals_write);
    assert!(!policy.allow_inherited_aces, "inheritance is explicit");
    assert!(policy.require_protected_dacl);
    assert!(
        !policy.allow_unknown_principals,
        "unknown handling is explicit"
    );
    assert!(!policy.allow_deny_aces);
}

// ------------------------------------------------------------ D. ACTIVATION SEQUENCE

#[test]
fn the_sequence_is_deterministic_and_dependency_enforced() {
    let a = ActivationSequence::new();
    let b = ActivationSequence::new();
    assert_eq!(a, b);
    assert_eq!(ActivationStep::all().len(), 21);
    for (i, step) in ActivationStep::all().iter().enumerate() {
        assert_eq!(step.order(), i);
    }
    assert!(a.violations().is_empty());
}

#[test]
fn no_activation_step_can_be_skipped() {
    // Approve the LAST mutating step and nothing else.
    let seq = ActivationSequence::new().with_status(
        ActivationStep::StartService,
        ApprovalStatus::ApprovedForPhase,
    );
    assert_eq!(
        seq.check_executable(ActivationStep::StartService)
            .unwrap_err(),
        ActivationPlanError::PrerequisiteIncomplete
    );
}

#[test]
fn each_gated_operation_requires_an_explicit_owner_approval() {
    for step in [
        ActivationStep::InstallOrVerifyServiceIdentity,
        ActivationStep::CreateProductionRoot,
        ActivationStep::ApplyAndVerifyAcl,
        ActivationStep::InitialiseServiceOnlyKeyCustody,
        ActivationStep::ConfigureWindowsService,
        ActivationStep::StartService,
    ] {
        assert!(step.requires_owner_approval(), "{step:?} must be gated");

        // Confirm every prerequisite, then prove approval is STILL required.
        let mut seq = ActivationSequence::new();
        for earlier in &ActivationStep::all()[..step.order()] {
            seq = seq.with_status(*earlier, ApprovalStatus::ConfirmedComplete);
        }
        assert_eq!(
            seq.check_executable(step).unwrap_err(),
            ActivationPlanError::OwnerDecisionRequired,
            "{step:?} must not run on prerequisites alone"
        );
    }
}

#[test]
fn the_production_gate_blocks_readiness_and_there_is_no_self_approval() {
    let plan = HostActivationPlan::canonical().unwrap();
    // Nothing about having a plan, or this test passing, advances a gate.
    assert!(!plan.is_execution_ready());
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
        ActivationDecision::AwaitingOwnerDecision(ActivationStep::VerifyProductionAuthorisation)
    );
}

#[test]
fn a_fully_confirmed_sequence_still_does_not_make_the_crate_able_to_activate() {
    let mut plan = HostActivationPlan::canonical().unwrap();
    for step in ActivationStep::all() {
        plan = plan.with_gate(*step, ApprovalStatus::ConfirmedComplete);
    }
    assert_eq!(plan.next_action(), ActivationDecision::Complete);
    assert!(!plan.is_execution_ready(), "no auto-closure, no execution");
}

// -------------------------------------------------------- E. FAILURE CLASSIFICATION

#[test]
fn the_three_effect_classes_behave_exactly_as_specified() {
    let pre = EffectClassification::PreEffectFailure.policy();
    assert!(!pre.success_claimable && !pre.reconciliation_required);

    let confirmed = EffectClassification::ConfirmedEffect.policy();
    assert!(confirmed.success_claimable && !confirmed.reconciliation_required);

    let uncertain = EffectClassification::UncertainOrNonConforming.policy();
    assert!(!uncertain.success_claimable && uncertain.reconciliation_required);

    // No class ever permits a blind retry, broadening, or a guessed rollback.
    for c in [
        EffectClassification::PreEffectFailure,
        EffectClassification::ConfirmedEffect,
        EffectClassification::UncertainOrNonConforming,
    ] {
        let p = c.policy();
        assert!(!p.automatic_retry_permitted);
        assert!(!p.broadening_permitted);
        assert!(!p.guessed_rollback_permitted);
    }
}

#[test]
fn every_named_partial_failure_is_uncertain_and_halts_the_sequence() {
    assert_eq!(UncertainScenario::all().len(), 10);
    for s in UncertainScenario::all() {
        assert_eq!(
            s.classification(),
            EffectClassification::UncertainOrNonConforming
        );
    }
    // An interrupted activation is resumable only after reconciliation.
    let seq = ActivationSequence::new()
        .with_status(
            ActivationStep::VerifyBaseline,
            ApprovalStatus::ConfirmedComplete,
        )
        .with_status(
            ActivationStep::CreateProductionRoot,
            ApprovalStatus::ReconciliationRequired,
        );
    assert_eq!(
        seq.next_action(),
        ActivationDecision::ReconciliationRequired(ActivationStep::CreateProductionRoot)
    );
    assert_eq!(
        seq.check_executable(ActivationStep::VerifyApprovedPlanVersion)
            .unwrap_err(),
        ActivationPlanError::ReconciliationRequired
    );
}

#[test]
fn the_recovery_policy_is_bounded_and_cannot_bypass_a_gate() {
    let recovery = ServiceRecoveryPlan::intended();
    assert!(recovery.validate().is_ok());
    assert!(recovery.restart.max_consecutive_restarts >= 1);
    assert!(recovery.restart.max_consecutive_restarts <= 5, "bounded");
    assert!(recovery.restart.reset_interval_seconds > 0);
    assert_eq!(recovery.safe_mode, SafeModeBehaviour::DoNotStart);
    assert_eq!(recovery.duplicate_instance, DuplicateInstancePolicy::Refuse);

    let mut unbounded = recovery.clone();
    unbounded.restart.max_consecutive_restarts = 0;
    assert_eq!(
        unbounded.validate().unwrap_err(),
        ActivationPlanError::UnboundedRestartPolicy
    );

    for effect in ServiceRecoveryPlan::never_auto_retried() {
        assert!(effect.is_mutating(), "{effect:?} must be a gated effect");
        assert_ne!(*effect, PossibleEffect::None);
    }
}

// -------------------------------------------------------------------- F. REDACTION

#[test]
fn no_public_value_discloses_secret_machine_or_raw_security_material() {
    let plan = HostActivationPlan::canonical()
        .unwrap()
        .with_owner_identity_decision(ServiceIdentityStrategy::OwnerApprovedAccount)
        .with_gate(
            ActivationStep::ApplyAndVerifyAcl,
            ApprovalStatus::ReconciliationRequired,
        );

    let rendered = format!(
        "{plan:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
        plan.root(),
        plan.identity(),
        plan.sequence(),
        plan.recovery(),
        plan.next_action()
    );

    assert!(!rendered.contains("S-1-"), "no raw SID or SID string");
    assert!(!rendered.contains(":\\"), "no private path");
    assert!(!rendered.contains("C:"), "no drive letter or machine path");
    let lower = rendered.to_ascii_lowercase();
    for forbidden in ["hkey", "0x", "sid("] {
        assert!(!lower.contains(forbidden), "must not disclose {forbidden}");
    }
    // A UNC root cannot appear: the anchor is an enum and every segment rejects UNC syntax. (A bare
    // `\\` in this rendering is Rust's escape of the ONE separator inside the symbolic path.)
    assert!(!lower.contains("\\\\\\\\"), "no UNC root may appear");
    // Credentials appear ONLY as the boolean fact "does this strategy need one", never as material:
    // every occurrence of a credential-shaped key is followed by a bare bool.
    for (idx, _) in lower.match_indices("credential") {
        let tail = &lower[idx..];
        assert!(
            // `requires_credential: <bool>`, the `CredentialManagementBurden` rejection reason, the
            // `credential-refs` subtree NAME, and the `CredentialMigration` gate NAME. All four are
            // labels; none is material.
            tail.starts_with("credential:")
                || tail.starts_with("credentialmanagement")
                || tail.starts_with("credentialreference")
                || tail.starts_with("credentialmigration"),
            "unexpected credential-shaped text"
        );
        if let Some(rest) = tail.strip_prefix("credential: ") {
            assert!(
                rest.starts_with("true") || rest.starts_with("false"),
                "a credential field may only ever carry a boolean"
            );
        }
    }
    // No password or token VALUE can exist: there is no such field anywhere in the contract.
    assert!(!lower.contains("password:"), "no password field exists");
    assert!(!lower.contains("token:"), "no token field exists");
    // The evidence that SHOULD be present is present.
    assert!(rendered.contains("%KNOWNFOLDER:ProgramData%"));
    assert!(rendered.contains("UnresolvedUntilActivation"));
    assert!(rendered.contains("ReconciliationRequired"));
}

#[test]
fn errors_and_violations_are_fieldless_and_semantic() {
    let e = ActivationPlanError::ServiceSidUnresolved;
    assert_eq!(e.to_string(), "service sid unresolved");
    assert!(!format!("{e:?}").contains("S-1-"));
    let v = ActivationViolation::AclDependsOnUnresolvedSid;
    assert_eq!(format!("{v:?}"), "AclDependsOnUnresolvedSid");
}

// ------------------------------------------------------- SIMPLICITY / SINGLE AUTHORITY

#[test]
fn there_is_exactly_one_next_action_and_one_plan_version() {
    let plan = HostActivationPlan::canonical().unwrap();
    assert_eq!(plan.version(), PLAN_CONTRACT_VERSION);
    // `next_action` returns ONE decision — the owner interface can present one obvious next step.
    let decision = plan.next_action();
    assert_eq!(
        decision,
        ActivationDecision::ReadyForExecution(ActivationStep::VerifyBaseline)
    );
    // And the canonical constructors are the single source of each authority.
    assert_eq!(plan.root(), &ProductionRootPlan::canonical().unwrap());
    assert_eq!(plan.recovery(), &ServiceRecoveryPlan::intended());
}
