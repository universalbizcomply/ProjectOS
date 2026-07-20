//! Black-box public-API contract tests for the shared host runtime scaffold.
//!
//! These exercise ONLY the public API and prove: the crate is contract-only and not execution-ready;
//! the Control Center client is non-authoritative and cannot acquire authority; the authoritative
//! roles have no public constructor; authority cannot be selected by bool/string/default; no
//! operational handle can be produced by a public route; lifecycle transitions are enforced; the
//! event API is typed (never raw String/JSON); and redacted diagnostics are bounded and reject unsafe
//! content.

use projectos_shared_host_runtime as rt;

use rt::{
    ControlCenterClientRole, DiagnosticCode, HostRuntimeClient, HostRuntimeConfiguration,
    HostRuntimeError, HostRuntimeEvent, HostRuntimeStatus, ImplementationState, LifecycleState,
    RedactedRuntimeMessage, RoleClass,
};

#[test]
// The scaffold's frozen contract constants are deliberately asserted directly.
#[allow(clippy::assertions_on_constants)]
fn the_crate_is_contract_only_and_not_execution_ready() {
    assert!(rt::RUNTIME_IMPLEMENTATION_IS_CONTRACT_ONLY);
    assert!(!rt::EXECUTION_READY);
    assert!(rt::MACHINE_WIDE_AUTHORITY_DEFERRED);
    let s = HostRuntimeStatus::contract_only();
    assert_eq!(s.runtime_impl, ImplementationState::ContractOnly);
    assert!(!s.is_execution_ready());
}

#[test]
fn control_center_client_is_non_authoritative_and_cannot_acquire_authority() {
    let role = ControlCenterClientRole::new();
    assert!(!role.is_authoritative());
    assert_eq!(role.class(), RoleClass::ControlCenterClient);

    let client = HostRuntimeClient::connect(HostRuntimeConfiguration::contract_default()).unwrap();
    assert!(!client.is_authoritative());
    // No method on the client yields authority; its operational methods fail closed.
    assert_eq!(
        client.request_snapshot(),
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    );
}

#[test]
fn no_public_operational_handle_can_be_manufactured() {
    // The only public routes to an AuthoritativeRuntimeHandle are the two `acquire` functions, and
    // both require an unconstructible capability token. There is no public constructor. This test
    // documents the property; the compile-fail doctests in lib.rs enforce the token unconstructibility.
    let client = HostRuntimeClient::connect(HostRuntimeConfiguration::default()).unwrap();
    // The inert event receiver is already closed — it is not connected to any process.
    assert!(client.events().recv().is_err());
}

#[test]
fn lifecycle_valid_transitions_are_accepted() {
    assert!(LifecycleState::ProcessStarting.can_transition_to(LifecycleState::ConfigurationLoading));
    assert!(
        LifecycleState::ConfigurationLoading.can_transition_to(LifecycleState::IdentityValidation)
    );
    assert!(LifecycleState::IdentityValidation
        .can_transition_to(LifecycleState::HostAuthorityAcquisition));
    assert!(LifecycleState::HostAuthorityAcquisition.can_transition_to(LifecycleState::IPCBinding));
    assert!(LifecycleState::IPCBinding.can_transition_to(LifecycleState::Ready));
}

#[test]
fn lifecycle_invalid_transitions_are_refused() {
    assert!(!LifecycleState::Stopped.can_transition_to(LifecycleState::Ready));
    assert!(!LifecycleState::FatalRefusal.can_transition_to(LifecycleState::Ready));
    assert!(!LifecycleState::ProcessStarting.can_transition_to(LifecycleState::Ready));
    // Ready cannot precede identity validation or authority acquisition.
    assert!(!LifecycleState::ConfigurationLoading.can_transition_to(LifecycleState::Ready));
    assert!(!LifecycleState::HostAuthorityAcquisition.can_transition_to(LifecycleState::Ready));
}

#[test]
fn the_event_type_is_typed_not_a_raw_string() {
    // A HostRuntimeEvent is a typed enum. Its degraded/refusal payloads are redacted messages, never
    // raw strings.
    let e = HostRuntimeEvent::FatalRefusal(RedactedRuntimeMessage::from_code(
        DiagnosticCode::AuthorityUnavailable,
    ));
    match e {
        HostRuntimeEvent::FatalRefusal(m) => {
            assert_eq!(m.code(), Some(DiagnosticCode::AuthorityUnavailable));
        }
        _ => panic!("unexpected variant"),
    }
    // AuthorityAcquired carries only a safe classification.
    assert_eq!(
        HostRuntimeEvent::AuthorityAcquired(RoleClass::ControlCenterClient).class(),
        rt::EventClass::AuthorityAcquired
    );
}

#[test]
fn redacted_messages_are_bounded_and_reject_unsafe_content() {
    let code = RedactedRuntimeMessage::from_code(DiagnosticCode::IpcUnavailable);
    assert!(code.is_bounded());
    // The public constructor accepts only a closed code — never free text. Unsafe content is
    // unrepresentable through any public route: there is no public text constructor at all.
    // (Internal validation rejection is proven by the unit tests in the events module.)
    let shown = format!("{code:?}");
    assert!(!shown.contains('\\'));
    assert!(!shown.contains("S-1-"));
}

#[test]
fn the_status_snapshot_contains_no_raw_machine_data() {
    // Every field is a fieldless classification; Debug can carry no path/SID/user/token.
    let s = HostRuntimeStatus::contract_only();
    let shown = format!("{s:?}");
    assert!(!shown.contains('\\'));
    assert!(!shown.contains("S-1-"));
    assert!(!shown.to_lowercase().contains("password"));
    assert!(!shown.contains("C:"));
}
