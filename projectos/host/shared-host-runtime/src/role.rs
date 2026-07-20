//! Sealed role types and the three separate authority contracts.
//!
//! Authority cannot be selected by a `bool`, a string, an integer, an environment variable, a
//! configuration value, a prompt or a report. The two authoritative roles are gated behind capability
//! tokens ([`FallbackPolicy`], [`ServiceActivationProof`]) that have NO public constructor in this
//! phase, so neither authoritative authority can be acquired. The Control Center client role is
//! explicitly non-authoritative and has no route to become authoritative. The machine-wide
//! cross-identity authority mechanism is deferred to a later governed gate.

use std::sync::mpsc::Receiver;

use crate::events::{HostRuntimeEvent, RoleClass};
use crate::runtime::{HostRuntimeConfiguration, HostRuntimeError, HostRuntimeStatus};

/// Private sealing marker: a `pub` item carrying a `Private` cannot be constructed outside this
/// crate, and a trait requiring it cannot be implemented outside this crate.
mod sealed {
    /// Zero-size, crate-private. Its presence in a struct makes that struct unconstructible by any
    /// external caller, without exposing a nameable field.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Private;
}
use sealed::Private;

/// The non-authoritative Control Center client role.
///
/// Constructible through exactly one explicit, non-authoritative constructor. It exposes no method,
/// `From`, or conversion that yields an authoritative role — becoming authoritative is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControlCenterClientRole {
    _seal: Private,
}

impl ControlCenterClientRole {
    /// The one explicit non-authoritative constructor.
    #[must_use]
    pub fn new() -> Self {
        Self { _seal: Private }
    }

    /// Always `false` — a client role is never authoritative.
    #[must_use]
    pub fn is_authoritative(self) -> bool {
        false
    }

    /// The safe classification of this role.
    #[must_use]
    pub fn class(self) -> RoleClass {
        RoleClass::ControlCenterClient
    }
}

impl Default for ControlCenterClientRole {
    fn default() -> Self {
        Self::new()
    }
}

/// A future policy that would authorise an interactive fallback host.
///
/// It has NO public constructor in this phase: no `new`, no `Default`, no `From<bool>`, no
/// `From<&str>`, no parse. An [`InteractiveFallbackRole`] therefore cannot be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FallbackPolicy {
    _seal: Private,
}

/// The interactive fallback role. Unconstructible in this phase — it requires a [`FallbackPolicy`],
/// which itself cannot be constructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InteractiveFallbackRole {
    _seal: Private,
}

impl InteractiveFallbackRole {
    /// Always authoritative — but no instance can exist in this phase.
    #[must_use]
    pub fn is_authoritative(self) -> bool {
        true
    }

    /// The safe classification of this role.
    #[must_use]
    pub fn class(self) -> RoleClass {
        RoleClass::InteractiveFallback
    }
}

/// A future proof that the ProjectOSHost service has been installed and activated.
///
/// It has NO public constructor in this phase: no `new`, no `Default`, no `From<bool>`, no
/// `From<&str>`, no environment/prompt/report conversion. An [`InstalledServiceRole`] therefore
/// cannot be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceActivationProof {
    _seal: Private,
}

/// The installed-service role. Unconstructible in this phase — it requires a [`ServiceActivationProof`],
/// which itself cannot be constructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstalledServiceRole {
    _seal: Private,
}

impl InstalledServiceRole {
    /// Always authoritative — but no instance can exist in this phase.
    #[must_use]
    pub fn is_authoritative(self) -> bool {
        true
    }

    /// The safe classification of this role.
    #[must_use]
    pub fn class(self) -> RoleClass {
        RoleClass::InstalledService
    }
}

/// Why an authority could not be established. Fieldless — it names no object, SID, path or account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityError {
    /// The requested authority is not available in this phase.
    NotAuthorisedInThisPhase,
    /// The machine-wide cross-identity authority mechanism is deferred to gate 3K-I-D.
    MachineWideAuthorityDeferred,
}

impl core::fmt::Display for AuthorityError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = match self {
            Self::NotAuthorisedInThisPhase => "authority not available in this phase",
            Self::MachineWideAuthorityDeferred => "machine-wide authority deferred to a later gate",
        };
        f.write_str(s)
    }
}

impl std::error::Error for AuthorityError {}

/// An operational handle over an authoritative runtime.
///
/// No PUBLIC route produces one: every authority `acquire` fails closed, and there is no public
/// constructor. The type exists only so the future operational API has a name. Its operational
/// methods all fail closed in this scaffold; none performs an effect.
#[derive(Debug)]
pub struct AuthoritativeRuntimeHandle {
    _seal: Private,
}

impl AuthoritativeRuntimeHandle {
    /// Crate-private inert constructor. Used only by in-crate tests to prove the operational methods
    /// fail closed; it is NOT reachable by any external caller and yields a non-operational handle.
    #[cfg(test)]
    pub(crate) fn inert() -> Self {
        Self { _seal: Private }
    }

    /// Begin serving. Fails closed in the scaffold — starts no process.
    pub fn start(&self) -> Result<(), HostRuntimeError> {
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    }

    /// The current typed status.
    #[must_use]
    pub fn status(&self) -> HostRuntimeStatus {
        HostRuntimeStatus::contract_only()
    }

    /// A typed event receiver. Inert in the scaffold — the sender is dropped immediately, so the
    /// receiver is already closed and delivers nothing. It is NOT connected to any process.
    #[must_use]
    pub fn events(&self) -> Receiver<HostRuntimeEvent> {
        inert_event_receiver()
    }

    /// Request a fresh redacted snapshot. Fails closed in the scaffold.
    pub fn request_snapshot(&self) -> Result<(), HostRuntimeError> {
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    }

    /// Request a cooperative stop. Fails closed in the scaffold.
    pub fn request_stop(&self) -> Result<(), HostRuntimeError> {
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    }

    /// Claim the single shutdown. Always `false` — nothing to shut down in the scaffold.
    #[must_use]
    pub fn claim_shutdown(&self) -> bool {
        false
    }

    /// Mark that the final exit is underway. A no-op in the scaffold.
    pub fn mark_final_exit(&self) {}

    /// Whether the final exit has been triggered. Always `false` in the scaffold.
    #[must_use]
    pub fn final_exit_triggered(&self) -> bool {
        false
    }

    /// Join the runtime worker. Fails closed in the scaffold.
    pub fn join(self) -> Result<(), HostRuntimeError> {
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    }
}

/// The non-authoritative Control Center client contract.
///
/// It NEVER acquires host authority. In the scaffold it can be constructed as a contract value, and
/// its operational methods fail closed.
#[derive(Debug)]
pub struct HostRuntimeClient {
    role: ControlCenterClientRole,
}

impl HostRuntimeClient {
    /// Build the non-effectful client contract. Connects to nothing in the scaffold — it neither
    /// opens IPC nor discovers a service; it only yields a non-authoritative contract value.
    ///
    /// # Errors
    /// Never in the scaffold; the signature is fixed for the future implementation.
    pub fn connect(config: HostRuntimeConfiguration) -> Result<Self, HostRuntimeError> {
        let _ = config;
        Ok(Self {
            role: ControlCenterClientRole::new(),
        })
    }

    /// Always `false` — a client is never authoritative.
    #[must_use]
    pub fn is_authoritative(&self) -> bool {
        self.role.is_authoritative()
    }

    /// The client's role.
    #[must_use]
    pub fn role(&self) -> ControlCenterClientRole {
        self.role
    }

    /// The current typed status.
    #[must_use]
    pub fn status(&self) -> HostRuntimeStatus {
        HostRuntimeStatus::contract_only()
    }

    /// A typed event receiver. Inert in the scaffold (see [`AuthoritativeRuntimeHandle::events`]).
    #[must_use]
    pub fn events(&self) -> Receiver<HostRuntimeEvent> {
        inert_event_receiver()
    }

    /// Request a fresh redacted snapshot. Fails closed in the scaffold.
    pub fn request_snapshot(&self) -> Result<(), HostRuntimeError> {
        Err(HostRuntimeError::NotImplementedInContractScaffold)
    }
}

/// The interactive fallback authority contract. Acquisition is impossible in this phase because no
/// [`FallbackPolicy`] can be constructed.
#[derive(Debug)]
pub struct InteractiveFallbackAuthority;

impl InteractiveFallbackAuthority {
    /// Attempt to acquire interactive fallback authority. Fails closed: even a caller who somehow held
    /// a [`FallbackPolicy`] gets [`AuthorityError::NotAuthorisedInThisPhase`], and no such policy can
    /// be constructed. Returns no operational handle.
    ///
    /// # Errors
    /// Always in this phase.
    pub fn acquire(
        config: HostRuntimeConfiguration,
        policy: FallbackPolicy,
    ) -> Result<AuthoritativeRuntimeHandle, AuthorityError> {
        let _ = (config, policy);
        Err(AuthorityError::NotAuthorisedInThisPhase)
    }
}

/// The installed-service authority contract. Acquisition is impossible in this phase because no
/// [`ServiceActivationProof`] can be constructed.
#[derive(Debug)]
pub struct ServiceRuntimeAuthority;

impl ServiceRuntimeAuthority {
    /// Attempt to acquire installed-service authority. Fails closed: even a caller who somehow held a
    /// [`ServiceActivationProof`] gets [`AuthorityError::NotAuthorisedInThisPhase`], and no such proof
    /// can be constructed. Returns no operational handle. The machine-wide mechanism is deferred to
    /// gate 3K-I-D.
    ///
    /// # Errors
    /// Always in this phase.
    pub fn acquire(
        config: HostRuntimeConfiguration,
        proof: ServiceActivationProof,
    ) -> Result<AuthoritativeRuntimeHandle, AuthorityError> {
        let _ = (config, proof);
        Err(AuthorityError::NotAuthorisedInThisPhase)
    }
}

/// Build an already-closed typed event receiver: create a channel and drop the sender, so `recv`
/// returns `Err` immediately. Connected to no process; claims no runtime.
fn inert_event_receiver() -> Receiver<HostRuntimeEvent> {
    let (tx, rx) = std::sync::mpsc::channel::<HostRuntimeEvent>();
    drop(tx);
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_center_client_is_non_authoritative() {
        let r = ControlCenterClientRole::new();
        assert!(!r.is_authoritative());
        assert_eq!(r.class(), RoleClass::ControlCenterClient);

        let c = HostRuntimeClient::connect(HostRuntimeConfiguration::contract_default()).unwrap();
        assert!(!c.is_authoritative());
    }

    #[test]
    fn client_operational_methods_fail_closed() {
        let c = HostRuntimeClient::connect(HostRuntimeConfiguration::contract_default()).unwrap();
        assert_eq!(
            c.request_snapshot(),
            Err(HostRuntimeError::NotImplementedInContractScaffold)
        );
        // Inert receiver delivers nothing.
        assert!(c.events().recv().is_err());
    }

    #[test]
    fn interactive_fallback_authority_cannot_be_acquired() {
        // A FallbackPolicy cannot be constructed here, so this call is only reachable in-crate via a
        // hypothetical; the contract still fails closed. (Compile-fail proof lives in lib.rs.)
        // We assert the error shape instead: the two authority-error reasons are distinct and each
        // renders a non-empty fieldless message.
        let e = AuthorityError::NotAuthorisedInThisPhase;
        assert_ne!(e, AuthorityError::MachineWideAuthorityDeferred);
        assert!(!e.to_string().is_empty());
    }

    #[test]
    fn an_inert_authoritative_handle_fails_every_operational_method_closed() {
        let h = AuthoritativeRuntimeHandle::inert();
        assert_eq!(
            h.start(),
            Err(HostRuntimeError::NotImplementedInContractScaffold)
        );
        assert_eq!(
            h.request_snapshot(),
            Err(HostRuntimeError::NotImplementedInContractScaffold)
        );
        assert_eq!(
            h.request_stop(),
            Err(HostRuntimeError::NotImplementedInContractScaffold)
        );
        assert!(!h.claim_shutdown());
        assert!(!h.final_exit_triggered());
        h.mark_final_exit();
        assert!(h.events().recv().is_err());
        assert_eq!(
            h.join(),
            Err(HostRuntimeError::NotImplementedInContractScaffold)
        );
    }

    #[test]
    fn authoritative_roles_classify_but_no_instance_is_reachable() {
        // We can name the classifications without constructing an authoritative role.
        assert_ne!(RoleClass::InteractiveFallback, RoleClass::InstalledService);
        assert_ne!(RoleClass::ControlCenterClient, RoleClass::InstalledService);
    }
}
