//! Lifecycle contract, bounded safe status, configuration handle and fail-closed errors.
//!
//! All logic here is PURE: the lifecycle transition rules are total functions over enums, the status
//! is a bounded classification, and the configuration is an opaque handle. Nothing starts a process,
//! opens IPC, or reads the environment/filesystem.

use crate::events::EventClass;

/// The typed lifecycle states of the future runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LifecycleState {
    /// The runtime process is starting.
    ProcessStarting,
    /// Governed configuration is loading.
    ConfigurationLoading,
    /// Runtime identity and publisher trust are being validated.
    IdentityValidation,
    /// Host authority is being acquired.
    HostAuthorityAcquisition,
    /// Authenticated local IPC is being bound.
    IPCBinding,
    /// The runtime is authoritative and ready.
    Ready,
    /// The runtime is serving in a degraded state.
    Degraded,
    /// A stop has been requested.
    StopRequested,
    /// The runtime is stopping.
    Stopping,
    /// The runtime has stopped.
    Stopped,
    /// The runtime fail-closed and refuses to serve. Terminal.
    FatalRefusal,
}

impl LifecycleState {
    /// The canonical forward ordering used by the transition rule. `FatalRefusal` and the stop chain
    /// are handled separately.
    fn forward_index(self) -> Option<u8> {
        match self {
            Self::ProcessStarting => Some(0),
            Self::ConfigurationLoading => Some(1),
            Self::IdentityValidation => Some(2),
            Self::HostAuthorityAcquisition => Some(3),
            Self::IPCBinding => Some(4),
            Self::Ready => Some(5),
            _ => None,
        }
    }

    /// Whether a transition from `self` to `next` is permitted.
    ///
    /// Rules: the startup chain advances by exactly one step; `Ready` can only be reached from
    /// `IPCBinding` (so it can never precede identity validation or authority acquisition); `Ready`
    /// and `Degraded` interconvert; a stop can be requested from `Ready`/`Degraded`, then
    /// `StopRequested → Stopping → Stopped`; `FatalRefusal` is reachable from any non-terminal state
    /// and is terminal; `Stopped` and `FatalRefusal` never return to `Ready`.
    #[must_use]
    pub fn can_transition_to(self, next: LifecycleState) -> bool {
        // Terminal states never transition anywhere.
        if matches!(self, Self::Stopped | Self::FatalRefusal) {
            return false;
        }
        // Fail-closed is always reachable from a non-terminal state.
        if matches!(next, Self::FatalRefusal) {
            return true;
        }
        // Startup chain: advance by exactly one forward step.
        if let (Some(a), Some(b)) = (self.forward_index(), next.forward_index()) {
            return b == a + 1;
        }
        match (self, next) {
            // Ready/Degraded interconvert.
            (Self::Ready, Self::Degraded) | (Self::Degraded, Self::Ready) => true,
            // Stop can be requested from a serving state.
            (Self::Ready, Self::StopRequested) | (Self::Degraded, Self::StopRequested) => true,
            // The bounded stop chain.
            (Self::StopRequested, Self::Stopping) => true,
            (Self::Stopping, Self::Stopped) => true,
            _ => false,
        }
    }

    /// Whether this state is an authoritative state that a client-only role must never drive.
    #[must_use]
    pub fn is_authoritative_state(self) -> bool {
        matches!(
            self,
            Self::HostAuthorityAcquisition | Self::Ready | Self::Degraded
        )
    }
}

/// The implementation status of a runtime concern in the current phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ImplementationState {
    /// Only the public contract exists; no live behaviour.
    ContractOnly,
    /// The contract plus a READ-ONLY identity capability (through the canonical identity crate);
    /// still not executable.
    ContractOnlyWithReadOnlyIdentity,
    /// The contract plus read-only identity AND the typed (effect-free) authority contract; still not
    /// executable.
    ContractOnlyWithReadOnlyIdentityAndAuthorityContract,
    /// The authority is present only as a typed contract scaffold (no live acquisition).
    TypedContractScaffolded,
    /// The authority has a SYNTHETIC Windows existence-token implementation that is present ONLY under
    /// the `test-fixtures` feature (3K-I-D-C): atomic named-mutex acquisition, machine-wide security
    /// descriptor + read-only DACL inspection, and read-only service-SID resolution. It is NOT compiled
    /// into a default/release build, ships no acquisition surface, and acquires no production authority
    /// name. Explicitly qualified `TestFixtureOnly` so no reader mistakes it for production capability.
    SyntheticWindowsTokenTestFixtureOnly,
    /// The runtime contract plus read-only identity AND the TEST-FIXTURE-ONLY synthetic Windows
    /// authority implementation; the default build remains contract-only and this is not executable.
    ContractWithTestOnlySyntheticWindowsAuthority,
    /// A synthetic proof exercised for the SAME user across MULTIPLE processes (including forced-child
    /// crash release), same session only; cross-user and cross-session proofs remain NotRun.
    SyntheticSameUserMultiprocessProven,
    /// Deferred to gate 3K-I-D-C.
    DeferredTo3KIDC,
    /// Deferred to gate 3K-I-D-E.
    DeferredTo3KIDE,
    /// A capability whose live proof has not been run.
    NotRun,
    /// Implemented by the external canonical identity crate (`projectos-host-identity`) and consumed
    /// here only through its safe facade.
    ExternalCanonicalIdentityCrate,
    /// Implemented, read-only classification only — grants nothing.
    ImplementedReadOnly,
    /// Deferred to a later governed gate.
    Deferred,
}

/// The publisher-policy disposition reported by a status snapshot. Fieldless classification only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PublisherPolicyClass {
    /// No approved publisher is configured and the policy fails closed — an unsigned or
    /// unexpected-signer artifact can never become Verified.
    EmptyAndFailClosed,
}

/// The authority disposition reported by a status snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityState {
    /// The reporting party holds no authority (e.g. the Control Center client).
    NonAuthoritative,
    /// Authority is not available in this phase.
    NotAuthorised,
    /// The machine-wide cross-identity authority mechanism is deferred to gate 3K-I-D.
    DeferredTo3KID,
}

/// A bounded health classification. Carries no detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HealthClass {
    /// Health is not yet known.
    Unknown,
    /// Healthy.
    Nominal,
    /// Degraded.
    Degraded,
    /// Fail-closed.
    FatalRefusal,
}

/// An opaque, effect-free configuration handle.
///
/// It exposes NO path, environment map, command line, credential or arbitrary value. The scaffold
/// offers only a non-effectful contract default; real configuration loading is a later gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostRuntimeConfiguration {
    _seal: (),
}

impl HostRuntimeConfiguration {
    /// The non-effectful contract default. Reads nothing and resolves nothing.
    #[must_use]
    pub fn contract_default() -> Self {
        Self { _seal: () }
    }
}

impl Default for HostRuntimeConfiguration {
    fn default() -> Self {
        Self::contract_default()
    }
}

/// A bounded, safe status snapshot.
///
/// Every field is a fieldless classification. It contains no raw process output, path, command line,
/// environment value, token, credential, machine name, user name, domain, SID, ACL, raw error, or
/// unbounded text, and it derives a safe `Debug`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostRuntimeStatus {
    /// The lifecycle state.
    pub lifecycle: LifecycleState,
    /// The authority disposition.
    pub authority: AuthorityState,
    /// The health classification.
    pub health: HealthClass,
    /// The runtime implementation state.
    pub runtime_impl: ImplementationState,
    /// The authority implementation state.
    pub authority_impl: ImplementationState,
    /// The process-supervision implementation state.
    pub process_impl: ImplementationState,
    /// The identity/trust implementation state.
    pub identity_impl: ImplementationState,
    /// The identity-verification capability state.
    pub identity_verification: ImplementationState,
    /// The publisher-policy disposition.
    pub publisher_policy: PublisherPolicyClass,
    /// The authority contract/implementation state.
    pub authority_contract: ImplementationState,
    /// Whether the machine-wide authority live proof has been run.
    pub machine_wide_proof: ImplementationState,
    /// Whether a cross-USER authority proof has been run (it has not — Windows 11 Home limits).
    pub cross_user_proof: ImplementationState,
    /// Whether a cross-SESSION authority proof has been run (it has not — Windows 11 Home limits).
    pub cross_session_proof: ImplementationState,
    /// Whether the service-identity live proof has been run.
    pub service_identity_proof: ImplementationState,
    /// The IPC implementation state.
    pub ipc_impl: ImplementationState,
    /// The Windows-service implementation state.
    pub service_impl: ImplementationState,
    /// The classification of the last event, if any.
    pub last_event: Option<EventClass>,
}

impl HostRuntimeStatus {
    /// The status this phase reports: a runtime whose DEFAULT build is contract-only, whose Windows
    /// authority implementation exists ONLY under the `test-fixtures` feature (never production), and
    /// whose synthetic proof covers same-user multiprocess + forced-child-crash release. Production
    /// authority is NotAuthorised, there is no production acquisition route, cross-user and
    /// cross-session proofs are NotRun, service-identity is deferred, and execution is NOT ready.
    #[must_use]
    pub fn contract_only() -> Self {
        Self {
            lifecycle: LifecycleState::ProcessStarting,
            authority: AuthorityState::NotAuthorised,
            health: HealthClass::Unknown,
            runtime_impl: ImplementationState::ContractWithTestOnlySyntheticWindowsAuthority,
            authority_impl: ImplementationState::SyntheticWindowsTokenTestFixtureOnly,
            process_impl: ImplementationState::Deferred,
            identity_impl: ImplementationState::ExternalCanonicalIdentityCrate,
            identity_verification: ImplementationState::ImplementedReadOnly,
            publisher_policy: PublisherPolicyClass::EmptyAndFailClosed,
            authority_contract: ImplementationState::TypedContractScaffolded,
            machine_wide_proof: ImplementationState::SyntheticSameUserMultiprocessProven,
            cross_user_proof: ImplementationState::NotRun,
            cross_session_proof: ImplementationState::NotRun,
            service_identity_proof: ImplementationState::DeferredTo3KIDE,
            ipc_impl: ImplementationState::Deferred,
            service_impl: ImplementationState::Deferred,
            last_event: None,
        }
    }

    /// Whether the runtime may execute. Always `false` in this phase.
    #[must_use]
    pub fn is_execution_ready(&self) -> bool {
        false
    }
}

/// A fail-closed operational error. Fieldless — it names no object, path, account or native code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostRuntimeError {
    /// The operation exists only as a contract in this phase and performs no effect.
    NotImplementedInContractScaffold,
}

impl core::fmt::Display for HostRuntimeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("operation not implemented in the contract scaffold")
    }
}

impl std::error::Error for HostRuntimeError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_startup_chain_advances_one_step_at_a_time() {
        assert!(
            LifecycleState::ProcessStarting.can_transition_to(LifecycleState::ConfigurationLoading)
        );
        assert!(LifecycleState::IPCBinding.can_transition_to(LifecycleState::Ready));
        // Cannot skip a step.
        assert!(!LifecycleState::ProcessStarting.can_transition_to(LifecycleState::Ready));
    }

    #[test]
    fn ready_cannot_precede_identity_validation_or_authority_acquisition() {
        assert!(!LifecycleState::ConfigurationLoading.can_transition_to(LifecycleState::Ready));
        assert!(!LifecycleState::IdentityValidation.can_transition_to(LifecycleState::Ready));
        assert!(!LifecycleState::HostAuthorityAcquisition.can_transition_to(LifecycleState::Ready));
        // Only IPCBinding → Ready.
        assert!(LifecycleState::IPCBinding.can_transition_to(LifecycleState::Ready));
    }

    #[test]
    fn terminal_states_never_return_to_ready() {
        assert!(!LifecycleState::Stopped.can_transition_to(LifecycleState::Ready));
        assert!(!LifecycleState::FatalRefusal.can_transition_to(LifecycleState::Ready));
        assert!(!LifecycleState::Stopped.can_transition_to(LifecycleState::Stopping));
    }

    #[test]
    fn fatal_refusal_is_reachable_from_any_non_terminal_state() {
        for s in [
            LifecycleState::ProcessStarting,
            LifecycleState::IdentityValidation,
            LifecycleState::Ready,
            LifecycleState::Degraded,
            LifecycleState::Stopping,
        ] {
            assert!(s.can_transition_to(LifecycleState::FatalRefusal), "{s:?}");
        }
        assert!(!LifecycleState::FatalRefusal.can_transition_to(LifecycleState::FatalRefusal));
    }

    #[test]
    fn the_stop_chain_is_bounded_and_ordered() {
        assert!(LifecycleState::Ready.can_transition_to(LifecycleState::StopRequested));
        assert!(LifecycleState::StopRequested.can_transition_to(LifecycleState::Stopping));
        assert!(LifecycleState::Stopping.can_transition_to(LifecycleState::Stopped));
        assert!(!LifecycleState::StopRequested.can_transition_to(LifecycleState::Stopped));
    }

    #[test]
    fn the_scaffold_status_is_contract_only_and_not_execution_ready() {
        let s = HostRuntimeStatus::contract_only();
        assert_eq!(
            s.runtime_impl,
            ImplementationState::ContractWithTestOnlySyntheticWindowsAuthority
        );
        assert_eq!(
            s.authority_impl,
            ImplementationState::SyntheticWindowsTokenTestFixtureOnly
        );
        assert_eq!(s.process_impl, ImplementationState::Deferred);
        assert_eq!(
            s.identity_impl,
            ImplementationState::ExternalCanonicalIdentityCrate
        );
        assert_eq!(
            s.identity_verification,
            ImplementationState::ImplementedReadOnly
        );
        assert_eq!(s.publisher_policy, PublisherPolicyClass::EmptyAndFailClosed);
        assert_eq!(
            s.authority_contract,
            ImplementationState::TypedContractScaffolded
        );
        assert_eq!(
            s.machine_wide_proof,
            ImplementationState::SyntheticSameUserMultiprocessProven
        );
        assert_eq!(s.cross_user_proof, ImplementationState::NotRun);
        assert_eq!(s.cross_session_proof, ImplementationState::NotRun);
        assert_eq!(
            s.service_identity_proof,
            ImplementationState::DeferredTo3KIDE
        );
        assert_eq!(s.ipc_impl, ImplementationState::Deferred);
        assert_eq!(s.service_impl, ImplementationState::Deferred);
        assert_eq!(s.authority, AuthorityState::NotAuthorised);
        assert!(!s.is_execution_ready());
    }

    #[test]
    fn authoritative_states_are_flagged() {
        assert!(LifecycleState::Ready.is_authoritative_state());
        assert!(LifecycleState::HostAuthorityAcquisition.is_authoritative_state());
        assert!(!LifecycleState::ConfigurationLoading.is_authoritative_state());
    }
}
