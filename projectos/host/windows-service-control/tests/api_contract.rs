//! Public-surface, effect-free contract tests for the bounded SCM adapter. They exercise only the
//! public API and perform NO Windows call, open NO SCM, and touch NO service. The adapter's internal
//! orchestration logic is proven separately by the crate's unit tests with a deterministic fake.

use projectos_host_windows_service_control as svc;

use svc::{
    Compiled, Elevation, ExactNameState, GateOutcome, LiveProof, OperationGate, OwnerApproval,
    PostEffectVerdict, ProductionActivation, ProofServiceAccountPolicy, ProofServiceIdentity,
    ProofServiceSidPolicy, ProofServiceStartPolicy, RetryPolicy, RunStateObservation,
    ScmActionOutcome, ServiceLifecycleOperation, ServiceOperationAuthority,
    ServiceOperationRefusal, MAX_ATTEMPTS_CEILING,
};

#[test]
// The phase-state constants are deliberately asserted directly.
#[allow(clippy::assertions_on_constants)]
fn default_build_is_contract_only_and_authorises_no_live_control() {
    assert!(svc::SERVICE_CONTROL_IS_CONTRACT_ONLY);
    assert!(!svc::LIVE_SERVICE_CONTROL_AUTHORISED);
}

#[test]
fn the_only_identity_is_projectoshost_virtual_account_demand_unrestricted() {
    let id = ProofServiceIdentity::projectos_host();
    assert_eq!(id.approved_name(), "ProjectOSHost");
    assert!(ProofServiceIdentity::is_approved_name("ProjectOSHost"));
    assert!(!ProofServiceIdentity::is_approved_name("Anything"));
    assert_eq!(
        id.account_policy(),
        ProofServiceAccountPolicy::VirtualServiceAccountNoPassword
    );
    assert_eq!(id.sid_policy(), ProofServiceSidPolicy::Unrestricted);
    assert_eq!(id.start_policy(), ProofServiceStartPolicy::DemandStartOnly);
}

#[test]
fn every_operation_is_notauthorised_in_this_phase() {
    for op in ServiceLifecycleOperation::all() {
        assert_eq!(op.authority(), ServiceOperationAuthority::NotAuthorised);
    }
}

#[test]
fn compiled_capability_alone_is_not_runtime_authority() {
    let g = OperationGate {
        compiled_capability: Compiled::Present,
        owner_approval: OwnerApproval::Absent,
        elevation: Elevation::Administrator,
        live_proof: LiveProof::Absent,
        production_activation: ProductionActivation::Forbidden,
    };
    assert_eq!(
        g.evaluate(),
        GateOutcome::Refused(ServiceOperationRefusal::CompiledCapabilityNotAuthority)
    );
}

#[test]
fn elevation_and_owner_approval_are_separate_gates() {
    let elevation_only = OperationGate {
        compiled_capability: Compiled::Absent,
        owner_approval: OwnerApproval::Absent,
        elevation: Elevation::Administrator,
        live_proof: LiveProof::Absent,
        production_activation: ProductionActivation::Forbidden,
    };
    assert_eq!(
        elevation_only.evaluate(),
        GateOutcome::Refused(ServiceOperationRefusal::ElevationWithoutOwnerApproval)
    );
    let owner_only = OperationGate {
        compiled_capability: Compiled::Absent,
        owner_approval: OwnerApproval::PresentForOneOperation,
        elevation: Elevation::Absent,
        live_proof: LiveProof::Absent,
        production_activation: ProductionActivation::Forbidden,
    };
    assert_eq!(
        owner_only.evaluate(),
        GateOutcome::Refused(ServiceOperationRefusal::OwnerApprovalWithoutElevation)
    );
}

#[test]
fn win32_errors_redact_to_closed_classifications() {
    // Raw Win32 codes never surface — only closed enums.
    assert_eq!(svc::classify_open_error(1060), ExactNameState::Absent);
    assert_eq!(svc::classify_open_error(5), ExactNameState::AccessDenied);
    assert_eq!(
        svc::classify_action_error(5),
        ScmActionOutcome::AccessDenied
    );
    assert_eq!(
        svc::classify_action_error(1072),
        ScmActionOutcome::MarkedForDeletion
    );
}

#[test]
fn post_effect_verification_confirms_only_matching_state() {
    assert_eq!(
        svc::verify_created_present(ExactNameState::Present),
        PostEffectVerdict::Verified
    );
    assert!(matches!(
        svc::verify_created_present(ExactNameState::Absent),
        PostEffectVerdict::Refused(_)
    ));
    assert_eq!(
        svc::verify_started(RunStateObservation::Running),
        PostEffectVerdict::Verified
    );
    assert_eq!(
        svc::verify_stopped(RunStateObservation::Stopped),
        PostEffectVerdict::Verified
    );
    assert_eq!(
        svc::verify_deleted(ExactNameState::Absent),
        PostEffectVerdict::Verified
    );
}

#[test]
fn wait_policy_is_bounded() {
    assert!(svc::default_wait_policy().max_attempts() <= MAX_ATTEMPTS_CEILING);
    assert_eq!(
        RetryPolicy::bounded(10_000).max_attempts(),
        MAX_ATTEMPTS_CEILING
    );
}

#[test]
fn sid_policy_confirms_only_when_unrestricted_is_observed() {
    use svc::SidPolicyObservation as S;
    assert_eq!(
        svc::verify_sid_policy(S::UnrestrictedObserved),
        PostEffectVerdict::Verified
    );
    assert!(matches!(
        svc::verify_sid_policy(S::NoneObserved),
        PostEffectVerdict::Refused(_)
    ));
    assert!(matches!(
        svc::verify_sid_policy(S::RestrictedObserved),
        PostEffectVerdict::Refused(_)
    ));
    for obs in [
        S::ServiceAbsent,
        S::AccessDenied,
        S::MarkedForDeletion,
        S::BufferOrQueryUnavailable,
        S::VerificationFailed,
    ] {
        assert_ne!(svc::verify_sid_policy(obs), PostEffectVerdict::Verified);
    }
}

#[test]
fn raw_sid_type_values_classify_to_closed_observations() {
    use svc::SidPolicyObservation as S;
    assert_eq!(svc::classify_sid_type(1), S::UnrestrictedObserved);
    assert_eq!(svc::classify_sid_type(0), S::NoneObserved);
    assert_eq!(svc::classify_sid_type(3), S::RestrictedObserved);
    assert_eq!(svc::classify_sid_type(999), S::UnexpectedConfiguration);
    assert_eq!(svc::classify_sid_query_error(5), S::AccessDenied);
}
