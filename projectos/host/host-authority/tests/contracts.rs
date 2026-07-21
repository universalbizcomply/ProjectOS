//! Black-box public-API contract tests for the host-authority scaffold. Only the public API is
//! exercised: the no-trust token rule, fail-closed corroboration, fallback-eligibility prohibitions,
//! release-before-acquire handover, the security-profile intent, and the absence of any
//! authority-granting public route.

use projectos_host_authority as auth;

use auth::{
    AuthorityDiagnosticCode, AuthorityEvidence, AuthorityHandoverState, AuthorityPeerState,
    AuthorityRefusal, AuthorityTokenOutcome, ConfirmedPeer, FallbackEligibility, HostRuntimeClient,
    IntendedRight, ServiceActivationState, ServiceObservation,
};

#[test]
// The frozen contract constants are deliberately asserted directly.
#[allow(clippy::assertions_on_constants)]
fn the_crate_is_contract_only() {
    assert!(auth::AUTHORITY_IMPLEMENTATION_IS_CONTRACT_ONLY);
    assert!(auth::AUTHORITY_ACQUISITION_DEFERRED_TO_3KIDC);
}

#[test]
fn an_existing_token_is_not_confirmed_and_uncorroborated_refuses_startup() {
    assert!(!AuthorityTokenOutcome::ExistingToken.is_confirmed_authority());
    let peer = AuthorityPeerState::corroborate(AuthorityTokenOutcome::ExistingToken, None);
    assert_eq!(peer, AuthorityPeerState::AuthorityUncertain);
    assert!(!peer.permits_startup());
}

#[test]
fn a_fresh_create_is_uncorroborated_not_confirmed() {
    let peer = AuthorityPeerState::corroborate(AuthorityTokenOutcome::AcquiredToken, None);
    assert_eq!(peer, AuthorityPeerState::Uncorroborated);
    assert!(!peer.permits_startup());
}

#[test]
fn corroborated_service_runtime_permits_startup() {
    let peer = AuthorityPeerState::corroborate(
        AuthorityTokenOutcome::ExistingToken,
        Some(ConfirmedPeer::ServiceRuntime),
    );
    assert!(peer.permits_startup());
}

#[test]
fn ipc_failure_alone_does_not_authorise_fallback() {
    // No public FallbackPolicy constructor exists, so callers cannot even supply one; None refuses.
    let e = FallbackEligibility::evaluate(
        ServiceActivationState::NeverActivated,
        ServiceObservation::ServiceStatusUnavailable,
        None,
    );
    assert!(matches!(e, FallbackEligibility::Refused(_)));
}

#[test]
fn activated_then_stopped_service_never_re_enables_fallback() {
    let e = FallbackEligibility::evaluate(
        ServiceActivationState::ActivationCommitted,
        ServiceObservation::ServiceStopped,
        None,
    );
    // Without a policy it refuses regardless; the activation state also independently forbids it.
    assert!(matches!(e, FallbackEligibility::Refused(_)));
}

#[test]
fn handover_enforces_release_before_acquire() {
    use AuthorityHandoverState as S;
    assert!(!S::FallbackOwned.can_transition_to(S::ServiceTokenAcquired));
    assert!(S::ServiceActivationPending.can_transition_to(S::ServiceTokenAcquired));
}

#[test]
fn a_client_has_no_authority_and_no_acquire_method() {
    let c = HostRuntimeClient::contract();
    assert!(!c.is_authoritative());
    // `c.acquire()` does not exist — enforced by a compile-fail doctest in lib.rs.
}

#[test]
fn security_profile_intends_detection_rights_only() {
    let p = auth::AuthoritySecurityProfile::machine_wide_v1();
    assert_eq!(
        p.intended_rights(),
        &[IntendedRight::Synchronize, IntendedRight::ReadControl]
    );
}

#[test]
fn evidence_is_redacted_classification_only() {
    let e = AuthorityEvidence::new(
        AuthorityTokenOutcome::Refused,
        AuthorityPeerState::AuthorityUncertain,
        AuthorityDiagnosticCode::SecurityProfileRejected,
    );
    let shown = format!("{e:?}");
    assert!(!shown.contains("S-1-"));
    assert!(!shown.contains("Global"));
    assert!(!shown.to_lowercase().contains("password"));
}

#[test]
fn refusal_reasons_are_distinct_and_fieldless() {
    assert_ne!(
        AuthorityRefusal::FallbackForbiddenAfterActivation,
        AuthorityRefusal::FallbackForbiddenByServicePresence
    );
    assert_ne!(
        AuthorityRefusal::AccessDenied,
        AuthorityRefusal::UntrustedObject
    );
}
