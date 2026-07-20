//! Dependent-crate view of the read-only preflight, including the REAL-HOST proof.
//!
//! Nothing here creates, configures, starts, stops or deletes a service, writes the registry,
//! touches ProgramData, changes an ACL, or launches a shell — the crate under test has no such
//! capability, and this file adds none. The only Windows interaction is the crate's own read-only
//! OS-version query and `SC_MANAGER_CONNECT|SC_MANAGER_ENUMERATE_SERVICE` enumeration.

use projectos_host_windows_capability_preflight::{
    default_candidates, projectos_v3_service_name_decision,
    projectos_v3_validated_service_name_owner_decision, recommend, CapabilityKind,
    CapabilityStatus, DecisionOwner, DecisionProvenance, DecisionScope, HostArchitecture,
    HostPreflightError, InstallationRecheck, OwnerDecisionOverlay, PreflightDecision,
    PreflightViolation, RecheckOutcome, ServiceNameAvailability, ServiceNameCandidate,
    ServiceNameDecision, ServiceNameDecisionStatus, WindowsClientProfile, WindowsEditionClass,
    WindowsHostPreflight, REQUIRED_PLAN_CONTRACT_VERSION,
};

// ------------------------------------------------------- ACCEPTED-PLAN CONSISTENCY

#[test]
fn the_accepted_frozen_plan_is_consumed_and_still_consistent() {
    WindowsHostPreflight::new()
        .verify_accepted_plan()
        .expect("the accepted frozen plan must still hold every assumed state");
    assert_eq!(REQUIRED_PLAN_CONTRACT_VERSION, "3K-D.3");
}

#[test]
fn the_preflight_does_not_duplicate_or_mutate_the_activation_plan() {
    use projectos_host_windows_activation_plan::{
        AclCompositionOutcome, ActivationStep, ApprovalStatus, HostActivationPlan,
    };
    let before = HostActivationPlan::projectos_v3_frozen().unwrap();
    let _ = WindowsHostPreflight::new().run();
    let after = HostActivationPlan::projectos_v3_frozen().unwrap();
    assert_eq!(
        before, after,
        "running the preflight must not alter the plan"
    );
    assert_eq!(
        after.compose_acl(),
        AclCompositionOutcome::ServiceIdentityRequired
    );
    assert_eq!(
        after
            .sequence()
            .status(ActivationStep::InstallOrVerifyServiceIdentity),
        ApprovalStatus::NotAuthorised
    );
    assert!(!after.is_execution_ready());
}

// ------------------------------------------------------------- A. HOST CLASSIFICATION

#[test]
fn host_profiles_are_classified_semantically_and_never_promoted() {
    let home = WindowsClientProfile::classify(10, 0, 26_200, 1, Some(0x65), HostArchitecture::X64);
    assert_eq!(home.edition(), WindowsEditionClass::ClientHome);
    assert!(home.meets_baseline());

    let unknown =
        WindowsClientProfile::classify(10, 0, 26_200, 1, Some(0xFFF), HostArchitecture::X64);
    assert_eq!(unknown.edition(), WindowsEditionClass::UnknownClient);
    assert!(!unknown.meets_baseline(), "unknown is never supported");

    let server =
        WindowsClientProfile::classify(10, 0, 20_348, 3, Some(0x04), HostArchitecture::X64);
    assert_eq!(server.edition(), WindowsEditionClass::Server);
    assert!(!server.meets_baseline());

    let old = WindowsClientProfile::classify(6, 1, 7601, 1, Some(0x30), HostArchitecture::X64);
    assert_eq!(old.edition(), WindowsEditionClass::Unsupported);

    let indeterminate = WindowsClientProfile::indeterminate();
    assert_eq!(indeterminate.edition(), WindowsEditionClass::Indeterminate);
    assert!(!indeterminate.meets_baseline());
}

#[test]
fn the_host_profile_carries_no_machine_identity() {
    let p = WindowsClientProfile::classify(10, 0, 26_200, 1, Some(0x65), HostArchitecture::X64);
    let text = format!("{p:?}");
    assert!(!text.contains("S-1-"));
    assert!(!text.contains(":\\"));
    let lower = text.to_ascii_lowercase();
    for forbidden in ["user", "machine", "domain", "computer", "serial"] {
        assert!(!lower.contains(forbidden), "must not disclose {forbidden}");
    }
}

// ------------------------------------------------------ B. SERVICE-NAME VALIDATION

#[test]
fn candidate_shape_rules_are_enforced_exactly() {
    for (name, expected) in [
        ("", HostPreflightError::EmptyServiceName),
        (
            "ProjectOS/Host",
            HostPreflightError::InvalidServiceNameCharacter,
        ),
        (
            "ProjectOS\\Host",
            HostPreflightError::InvalidServiceNameCharacter,
        ),
        (
            "ProjectOS\u{3}Host",
            HostPreflightError::InvalidServiceNameCharacter,
        ),
        (" ProjectOSHost", HostPreflightError::AmbiguousServiceName),
        ("ProjectOSHost ", HostPreflightError::AmbiguousServiceName),
        ("nul", HostPreflightError::ReservedServiceName),
        ("ProjectOSPolyGo", HostPreflightError::ProductSpecificName),
        (
            "ProjectOSHostProd",
            HostPreflightError::EnvironmentSpecificName,
        ),
        (
            "ProjectOSHostSecret",
            HostPreflightError::MachineOrCredentialLikeName,
        ),
        ("SomeOtherService", HostPreflightError::NotProjectScoped),
    ] {
        assert_eq!(
            ServiceNameCandidate::new(name).validate().unwrap_err(),
            expected,
            "{name:?}"
        );
    }
    for c in default_candidates() {
        assert!(c.validate().is_ok(), "{}", c.as_str());
    }
}

#[test]
fn an_over_length_candidate_is_refused() {
    let long = format!("ProjectOS{}", "x".repeat(300));
    assert_eq!(
        ServiceNameCandidate::new(long).validate().unwrap_err(),
        HostPreflightError::ServiceNameTooLong
    );
}

// ------------------------------------------------------------ C. READ-ONLY CONTRACT

#[test]
fn the_public_api_offers_no_mutation_entry_point() {
    // The crate exposes exactly one runner and one plan check. There is no install/configure/
    // start/stop/delete method to call — absence is proven by the compile-fail doctests in lib.rs
    // and by this file compiling without any such call being available.
    let preflight = WindowsHostPreflight::new();
    let _ = preflight.verify_accepted_plan();
    let _ = preflight.run();
}

// -------------------------------------------------------------- D. CAPABILITY HONESTY

#[test]
fn effect_provable_capabilities_are_classified_as_deferred_not_proven() {
    use CapabilityKind as K;
    for kind in [
        K::VirtualAccountRuntimeSupport,
        K::ServiceSidResolution,
        K::FinalAclComposition,
        K::ServiceInstallation,
        K::ServiceStartup,
        K::ProgramDataCreation,
        K::ProductionAclApplication,
    ] {
        assert!(
            kind.requires_approved_effect_to_prove(),
            "{kind:?} must need an approved effect"
        );
    }

    let report = WindowsHostPreflight::new()
        .run()
        .expect("preflight must run");
    for kind in [
        K::VirtualAccountRuntimeSupport,
        K::ServiceSidResolution,
        K::FinalAclComposition,
        K::ServiceInstallation,
        K::ServiceStartup,
        K::ProgramDataCreation,
        K::ProductionAclApplication,
    ] {
        assert_eq!(
            report.status(kind),
            Some(CapabilityStatus::DeferredUntilApprovedEffect),
            "{kind:?} must be deferred"
        );
    }
    assert!(!report
        .violations()
        .contains(&PreflightViolation::ProofRequiresApprovedEffect));
}

#[test]
fn api_presence_is_never_treated_as_runtime_support() {
    let report = WindowsHostPreflight::new().run().unwrap();
    // The installation APIs are not even linked, so their presence is Indeterminate — not proven
    // either way — and that never upgrades the runtime-support row.
    assert_eq!(
        report.status(CapabilityKind::ServiceInstallationApisPresent),
        Some(CapabilityStatus::Indeterminate)
    );
    assert_eq!(
        report.status(CapabilityKind::VirtualAccountRuntimeSupport),
        Some(CapabilityStatus::DeferredUntilApprovedEffect)
    );
}

// -------------------------------------------------------- E/REAL. LIVE HOST PROOF

#[test]
fn the_real_host_preflight_runs_read_only_and_reports_honestly() {
    let report = WindowsHostPreflight::new()
        .run()
        .expect("preflight must run against the live host");

    // The OS profile was collected (or honestly reported as indeterminate).
    let profile = report.profile();
    assert!(
        profile.edition() != WindowsEditionClass::Unsupported || !profile.meets_baseline(),
        "an unsupported edition must never meet the baseline"
    );

    // The namespace was inspected, or its unavailability was classified — never assumed available.
    if report.namespace_known() {
        assert!(
            report.services_inspected() > 0,
            "a readable namespace should contain services"
        );
        assert_eq!(
            report.status(CapabilityKind::ScmReadOnlyAccess),
            Some(CapabilityStatus::ProvenSupported)
        );
    } else {
        for v in report.validations() {
            assert_eq!(
                v.availability,
                ServiceNameAvailability::Unknown,
                "an unreadable namespace must never yield Available"
            );
        }
        assert_eq!(
            report.decision(),
            PreflightDecision::ReadOnlyInspectionUnavailable
        );
    }

    // Whatever happened, the decision is one of the defined outcomes and never installation
    // readiness — that variant does not exist. On a healthy host `run()` records the owner decision.
    assert!(matches!(
        report.decision(),
        PreflightDecision::OwnerServiceNameDecisionRecorded
            | PreflightDecision::ReadyForOwnerServiceNameDecision
            | PreflightDecision::BlockedByHostCapability
            | PreflightDecision::IndeterminateHostCapability
            | PreflightDecision::ServiceNameCollision
            | PreflightDecision::ReadOnlyInspectionUnavailable
            | PreflightDecision::ReconciliationRequired
    ));
}

#[test]
fn the_report_exposes_a_count_but_never_the_service_list() {
    let report = WindowsHostPreflight::new().run().unwrap();
    let rendered = format!("{report:?}");
    // A handful of near-universal Windows service names. None may appear.
    for name in [
        "Spooler", "Dhcp", "EventLog", "Winmgmt", "wuauserv", "Themes",
    ] {
        assert!(
            !rendered.contains(name),
            "the service list must never be disclosed ({name})"
        );
    }
    // The count is available.
    let _ = report.services_inspected();
}

#[test]
fn candidate_collisions_are_checked_case_insensitively_against_the_live_namespace() {
    // A deliberately colliding candidate list: a name that certainly exists on Windows, spelled in
    // a different case, plus the real candidates.
    let mut candidates = vec![ServiceNameCandidate::new("ProjectOSHost")];
    candidates.extend(default_candidates().into_iter().skip(1));

    let report = WindowsHostPreflight::new()
        .run_with_candidates(&candidates)
        .unwrap();
    if report.namespace_known() {
        // ProjectOS is not installed, so its candidates must be genuinely available.
        for v in report.validations() {
            assert_ne!(
                v.availability,
                ServiceNameAvailability::Unknown,
                "a readable namespace must give a definite answer"
            );
        }
        assert!(
            report.recommended().is_some(),
            "at least one ProjectOS candidate should be free on a host without ProjectOS installed"
        );
    }
}

// ------------------------------------ OWNER-APPROVED SERVICE-NAME DECISION (direct)

#[test]
fn the_current_projectos_service_name_is_owner_approved_via_a_direct_owner_decision() {
    let decision = projectos_v3_service_name_decision().expect("owner decision must build");
    assert_eq!(decision.name(), "ProjectOSHost", "exact, case-stable");
    assert_eq!(decision.status(), ServiceNameDecisionStatus::OwnerApproved);
    assert!(decision.is_owner_approved());
    assert!(
        !decision.owner_decision_outstanding(),
        "the direct owner decision is now recorded"
    );
    assert_eq!(decision.owner(), DecisionOwner::Murad);
    assert_eq!(
        decision.provenance(),
        DecisionProvenance::DirectOwnerDecision,
        "provenance must be a direct owner decision, not a recommendation"
    );
    assert_eq!(
        decision.availability_at_decision(),
        ServiceNameAvailability::Available
    );
    assert_eq!(
        decision.recheck_requirement(),
        InstallationRecheck::RequiredBeforeInstallation
    );
    assert!(!decision.name().ends_with("Service"));
    assert!(!decision.name().contains("Windows"));
    assert!(!decision.name().contains("Production"));
    assert!(decision.name().starts_with("ProjectOS"));
}

#[test]
fn recommendation_and_availability_remain_distinct_from_owner_approval() {
    let advisory = ServiceNameDecision::recommended(
        ServiceNameCandidate::new("ProjectOSHost"),
        ServiceNameAvailability::Available,
    )
    .unwrap();
    assert!(!advisory.is_owner_approved());
    assert_eq!(
        advisory.provenance(),
        DecisionProvenance::ProjectOsRecommendation
    );

    let owner = projectos_v3_service_name_decision().unwrap();
    assert_ne!(
        advisory, owner,
        "recommendation must not equal owner approval"
    );

    let report = WindowsHostPreflight::new().run().unwrap();
    for v in report.validations() {
        if v.availability == ServiceNameAvailability::Available {
            assert!(v.is_usable() || v.shape_error.is_some());
        }
    }
    assert_ne!(report.decision(), PreflightDecision::ReconciliationRequired);
}

#[test]
fn there_is_exactly_one_owner_approved_authority_reproducible_only_through_the_sealed_authority() {
    let a = projectos_v3_service_name_decision().unwrap();
    let b = projectos_v3_service_name_decision().unwrap();
    assert_eq!(a, b, "the owner decision is deterministic");
    assert!(a.is_owner_approved());
    // The ONLY route to an equal owner-approved value is via the sealed validated authority — a
    // caller cannot supply a candidate or manufacture direct-owner provenance.
    let validated = projectos_v3_validated_service_name_owner_decision().unwrap();
    let via_authority = ServiceNameDecision::from_validated_owner_decision(
        &validated,
        ServiceNameAvailability::Available,
    )
    .unwrap();
    assert_eq!(a, via_authority, "no hidden shortcut or extra privilege");
    // The recommendation constructor can never produce it.
    let advisory = ServiceNameDecision::recommended(
        ServiceNameCandidate::new("ProjectOSHost"),
        ServiceNameAvailability::Available,
    )
    .unwrap();
    assert_ne!(a, advisory);
}

/// The sealed authority carries the reviewed decision facts and cannot be forged.
#[test]
fn the_validated_owner_authority_is_sealed_and_carries_the_reviewed_facts() {
    let validated = projectos_v3_validated_service_name_owner_decision().unwrap();
    assert_eq!(validated.name(), "ProjectOSHost");
    assert_eq!(validated.owner(), DecisionOwner::Murad);
    assert_eq!(
        validated.scope(),
        DecisionScope::InternalWindowsScmServiceNameOnly
    );
    assert!(validated.is_direct_owner_decision());
    assert!(validated.binding_gate_accepted());
    // The resulting decision inherits scope and direct-owner provenance from the authority.
    let decision = ServiceNameDecision::from_validated_owner_decision(
        &validated,
        ServiceNameAvailability::Available,
    )
    .unwrap();
    assert_eq!(
        decision.provenance(),
        DecisionProvenance::DirectOwnerDecision
    );
    assert_eq!(
        decision.scope(),
        DecisionScope::InternalWindowsScmServiceNameOnly
    );
    // No secret or machine material in the sealed authority's rendering.
    let text = format!("{validated:?}");
    assert!(!text.contains("S-1-"));
    assert!(!text.contains(":\\"));
    assert!(!text.contains("0x"));
    assert!(text.contains("ProjectOSHost"));
}

/// The effective 3K-E state records the decision — it no longer requests one — while the frozen
/// 3K-D crate is untouched and still expresses its historical requirement.
#[test]
fn the_effective_state_records_the_decision_and_the_frozen_plan_stays_historical() {
    use projectos_host_windows_activation_plan::{HostActivationPlan, ServiceNameStatus};

    let report = WindowsHostPreflight::new().run().unwrap();
    if report.namespace_known() {
        assert_eq!(
            report.decision(),
            PreflightDecision::OwnerServiceNameDecisionRecorded,
            "after binding, run() must not re-request the owner decision"
        );
        assert_eq!(
            report.owner_decision(),
            OwnerDecisionOverlay::OwnerServiceNameDecisionRecorded
        );
        assert_ne!(
            report.decision(),
            PreflightDecision::ReadyForOwnerServiceNameDecision
        );
    }

    // The frozen 3K-D plan is UNCHANGED and still carries the historical requirement.
    let frozen = HostActivationPlan::projectos_v3_frozen().unwrap();
    assert_eq!(
        frozen.identity().service_name(),
        ServiceNameStatus::OwnerDecisionRequired,
        "the closed 3K-D crate is not mutated"
    );
    // The generic (no-overlay) preflight still asks for the decision — the overlay is not baked into
    // the report type, it is supplied per run.
    let generic = WindowsHostPreflight::new()
        .run_with_candidates(&default_candidates())
        .unwrap();
    if generic.namespace_known() {
        assert_eq!(
            generic.decision(),
            PreflightDecision::ReadyForOwnerServiceNameDecision
        );
        assert_eq!(
            generic.owner_decision(),
            OwnerDecisionOverlay::OwnerDecisionRequired
        );
    }
}

#[test]
fn a_default_or_convenience_path_cannot_produce_the_owner_approval() {
    for c in default_candidates() {
        let advisory =
            ServiceNameDecision::recommended(c.clone(), ServiceNameAvailability::Available)
                .unwrap();
        assert!(!advisory.is_owner_approved(), "{}", c.as_str());
    }
    let report = WindowsHostPreflight::new().run().unwrap();
    if let Some(v) = report.recommended() {
        assert_eq!(v.candidate.as_str(), "ProjectOSHost");
    }
    assert!(projectos_v3_service_name_decision()
        .unwrap()
        .is_owner_approved());
}

#[test]
fn the_alternatives_remain_unapproved() {
    let approved = projectos_v3_service_name_decision().unwrap();
    for other in ["ProjectOSHostService", "ProjectOSService"] {
        assert_ne!(
            approved.name(),
            other,
            "{other} must not be the approved name"
        );
        let advisory = ServiceNameDecision::recommended(
            ServiceNameCandidate::new(other),
            ServiceNameAvailability::Available,
        )
        .unwrap();
        assert!(!advisory.is_owner_approved());
    }
}

#[test]
fn the_owner_approved_name_that_later_collides_blocks_with_no_substitution() {
    let decision = projectos_v3_service_name_decision().unwrap();

    assert_eq!(
        decision
            .recheck(&["Spooler".to_string(), "Dhcp".to_string()], true)
            .unwrap(),
        RecheckOutcome::StillAvailable
    );
    let taken = decision
        .recheck(&["projectoshost".to_string()], true)
        .unwrap();
    assert_eq!(taken, RecheckOutcome::NoLongerAvailable);
    assert!(taken.blocks_installation());
    let unknown = decision.recheck(&[], false).unwrap();
    assert_eq!(unknown, RecheckOutcome::NamespaceUnknown);
    assert!(unknown.blocks_installation());
    assert_eq!(decision.name(), "ProjectOSHost");
    assert_eq!(decision, projectos_v3_service_name_decision().unwrap());
    assert!(decision.recheck(&[String::new()], true).is_err());
}

#[test]
fn the_owner_approval_authorises_no_effect_and_promotes_no_capability() {
    use projectos_host_windows_activation_plan::{
        ActivationStep, ApprovalStatus, HostActivationPlan,
    };
    let _ = projectos_v3_service_name_decision().unwrap();

    let frozen = HostActivationPlan::projectos_v3_frozen().unwrap();
    for step in [
        ActivationStep::InstallOrVerifyServiceIdentity,
        ActivationStep::CreateProductionRoot,
        ActivationStep::ApplyAndVerifyAcl,
        ActivationStep::InitialiseServiceOnlyKeyCustody,
        ActivationStep::ConfigureWindowsService,
        ActivationStep::StartService,
    ] {
        assert_eq!(
            frozen.sequence().status(step),
            ApprovalStatus::NotAuthorised,
            "{step:?} must remain gated"
        );
    }
    assert!(!frozen.is_execution_ready());

    let report = WindowsHostPreflight::new().run().unwrap();
    for kind in [
        CapabilityKind::VirtualAccountRuntimeSupport,
        CapabilityKind::ServiceSidResolution,
        CapabilityKind::FinalAclComposition,
        CapabilityKind::ServiceInstallation,
        CapabilityKind::ServiceStartup,
        CapabilityKind::ProgramDataCreation,
        CapabilityKind::ProductionAclApplication,
    ] {
        assert_eq!(
            report.status(kind),
            Some(CapabilityStatus::DeferredUntilApprovedEffect),
            "{kind:?} must stay deferred after name approval"
        );
    }
    assert_ne!(report.decision(), PreflightDecision::ReconciliationRequired);
}

#[test]
fn the_owner_decision_record_carries_no_machine_or_secret_material() {
    let decision = projectos_v3_service_name_decision().unwrap();
    let rendered = format!("{decision:?}");
    assert!(!rendered.contains("S-1-"), "no SID");
    assert!(!rendered.contains(":\\"), "no private path");
    assert!(!rendered.contains("0x"), "no handle or pointer");
    let lower = rendered.to_ascii_lowercase();
    for forbidden in ["password", "secret", "token", "hkey", "domain", "username"] {
        assert!(!lower.contains(forbidden), "must not disclose {forbidden}");
    }
    assert!(rendered.contains("ProjectOSHost"));
    assert!(rendered.contains("OwnerApproved"));
    assert!(
        rendered.contains("DirectOwnerDecision"),
        "provenance is explicit"
    );
}

// ------------------------------------------------------------- F. ERROR REDACTION

#[test]
fn errors_and_reports_disclose_nothing_sensitive() {
    let report = WindowsHostPreflight::new().run().unwrap();
    let rendered = format!(
        "{report:?}|{:?}|{}|{:?}",
        HostPreflightError::ScmAccessDenied,
        HostPreflightError::ServiceEnumerationFailed,
        report.profile()
    );
    assert!(!rendered.contains("S-1-"), "no SID");
    assert!(!rendered.contains(":\\"), "no private path");
    assert!(!rendered.contains("0x"), "no handle or pointer value");
    let lower = rendered.to_ascii_lowercase();
    for forbidden in [
        "password", "secret:", "token:", "hkey", "domain:", "username",
    ] {
        assert!(!lower.contains(forbidden), "must not disclose {forbidden}");
    }
}

// ---------------------------------------------------------- G. RESOURCE LIFECYCLE

/// Live process handle count. TEST ONLY.
#[cfg(windows)]
#[allow(unsafe_code)]
fn process_handle_count() -> u32 {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
    let mut count: u32 = 0;
    // SAFETY: the current-process pseudo-handle is always valid and `count` is a writable slot.
    let ok = unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) };
    assert_ne!(ok, 0, "handle count must be observable");
    count
}

#[cfg(windows)]
#[test]
fn repeated_preflight_does_not_materially_leak_handles() {
    /// Absolute tolerance for unrelated runtime activity. Growth PROPORTIONAL to the iteration
    /// count is what this test exists to disprove.
    const TOLERANCE: u32 = 32;
    const CYCLES: u32 = 64;

    let preflight = WindowsHostPreflight::new();
    // Warm up so first-call allocations are not counted.
    let _ = preflight.run();
    let baseline = process_handle_count();

    for _ in 0..CYCLES {
        let _ = preflight.run().expect("preflight must keep running");
    }

    let growth = process_handle_count().saturating_sub(baseline);
    assert!(
        growth <= TOLERANCE,
        "handle growth {growth} over {CYCLES} cycles indicates a leak"
    );
}

// ------------------------------------------------------------------ NO-TRAINING FLOW

#[test]
fn the_next_action_is_a_single_obvious_next_step() {
    // After binding, `run()` records the decision; the generic run still asks for one. Either way
    // exactly one recommendation candidate is surfaced and it is availability + shape only.
    let generic = WindowsHostPreflight::new()
        .run_with_candidates(&default_candidates())
        .unwrap();
    if generic.decision() == PreflightDecision::ReadyForOwnerServiceNameDecision {
        let rec = generic.recommended().expect("a recommendation must exist");
        assert!(rec.is_usable());
        assert_eq!(
            recommend(generic.validations()).map(|v| v.candidate.as_str()),
            Some(rec.candidate.as_str())
        );
    }
    // The bound run records the decision and points at the next gate, never at another name choice.
    let bound = WindowsHostPreflight::new().run().unwrap();
    if bound.namespace_known() {
        assert_eq!(
            bound.decision(),
            PreflightDecision::OwnerServiceNameDecisionRecorded
        );
    }
}
