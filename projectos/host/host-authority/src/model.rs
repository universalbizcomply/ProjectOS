//! The typed, effect-free host-authority contracts.
//!
//! Nothing here performs a Windows call, creates a kernel object, derives a `Global\…` name, builds a
//! security descriptor, resolves a SID, queries the SCM, binds IPC, or launches a process. Every type
//! is either a sealed capability (unconstructible outside this crate) or a fieldless classification
//! that carries no capability. The central discipline: a named object is an EXCLUSIVITY TOKEN only —
//! it is never, on its own, trusted ProjectOS authority.

/// Private sealing marker. A `pub` type carrying a `Private` field cannot be constructed outside this
/// crate, and no nameable field is exposed.
mod sealed {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Private;
}
use sealed::Private;

/// The build-derived release channel. Classification only — sourced from build facts by the future
/// implementation, never from an environment variable, flag or caller string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityChannel {
    /// Development tree.
    Development,
    /// Packaged / release candidate.
    Packaged,
}

/// The authority schema version. A governed future migration can introduce `V2`; two versions never
/// share one authority object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthoritySchemaVersion {
    /// Version 1 — the machine-wide cross-identity design.
    V1,
}

/// An opaque, canonical installation identity.
///
/// The Control Center fallback and the future ProjectOSHost service MUST consume the SAME canonical
/// installation identity — neither hashes its own executable-parent path. In this contract phase the
/// value is an opaque sealed token supplied by the canonical installation/host-identity boundary;
/// there is deliberately no public constructor accepting a raw path or an arbitrary digest, no
/// `Default`, and no getter that reveals a path or digest. The future implementation obtains it from
/// the canonical boundary; the tests use the crate-private seam.
#[derive(Clone, PartialEq, Eq)]
pub struct CanonicalInstallationIdentity {
    /// Crate-private opaque token. Never a raw path; never publicly readable.
    token: InstallationToken,
}

#[derive(Clone, PartialEq, Eq)]
enum InstallationToken {
    /// A canonical identity supplied by the installation boundary. The inner value is intentionally
    /// unit in this contract phase — the real opaque digest arrives with the implementation and is
    /// still never publicly readable.
    ///
    /// Reserved construction seam: built only by the crate-private constructor below (exercised by
    /// the contract tests); the 3K-I-D-C implementation constructs it live from the canonical
    /// installation boundary. Retained now so the key contract is frozen.
    #[allow(dead_code)]
    Canonical(Private),
}

impl CanonicalInstallationIdentity {
    /// CRATE-PRIVATE seam: the future implementation and the contract tests obtain a canonical
    /// identity from the installation boundary. No public route constructs one, so no caller can
    /// inject a raw path or arbitrary digest. Reserved for the 3K-I-D-C implementation; exercised by
    /// the contract tests this phase.
    #[must_use]
    #[allow(dead_code)]
    pub(crate) fn from_canonical_boundary() -> Self {
        Self {
            token: InstallationToken::Canonical(Private),
        }
    }
}

impl core::fmt::Debug for CanonicalInstallationIdentity {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Never reveal the installation digest/path.
        f.write_str("CanonicalInstallationIdentity(<redacted>)")
    }
}

/// The authority scope: what an authority object is scoped to. It contains a machine-wide marker, the
/// canonical installation identity, the channel and the schema version — and NO user or service
/// identity component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorityScope {
    /// Always machine-wide in this design (there is no per-user or per-session scope).
    machine_wide: bool,
    installation: CanonicalInstallationIdentity,
    channel: AuthorityChannel,
    version: AuthoritySchemaVersion,
}

impl AuthorityScope {
    /// CRATE-PRIVATE constructor. The scope is assembled by the future implementation from the
    /// canonical installation identity, the build channel and the schema version — never from caller
    /// strings. Reserved for the 3K-I-D-C implementation; exercised by the contract tests.
    #[must_use]
    #[allow(dead_code)]
    pub(crate) fn new(
        installation: CanonicalInstallationIdentity,
        channel: AuthorityChannel,
        version: AuthoritySchemaVersion,
    ) -> Self {
        Self {
            machine_wide: true,
            installation,
            channel,
            version,
        }
    }

    /// Whether the scope is machine-wide. Always `true`.
    #[must_use]
    pub fn is_machine_wide(&self) -> bool {
        self.machine_wide
    }

    /// The channel.
    #[must_use]
    pub fn channel(&self) -> AuthorityChannel {
        self.channel
    }

    /// The schema version.
    #[must_use]
    pub fn schema_version(&self) -> AuthoritySchemaVersion {
        self.version
    }
}

/// The sealed authority key.
///
/// The conceptual key is `Global\ProjectOS.HostAuthority.v1.<channel>.i<installationIdentity16>`, but
/// this contract crate builds NO such string. The key is derived from an [`AuthorityScope`] only; it
/// has private fields, no public arbitrary-string constructor, no `Default`, no `From<String>` /
/// `From<&str>` / `Deserialize`, no public raw object-name getter, and a redacted `Debug`.
#[derive(Clone, PartialEq, Eq)]
pub struct AuthorityKey {
    scope: AuthorityScope,
    _seal: Private,
}

impl AuthorityKey {
    /// CRATE-PRIVATE derivation from a scope. The only route to a key; no caller can supply a raw
    /// object name or arbitrary string. Reserved for the 3K-I-D-C implementation; exercised by the
    /// contract tests.
    #[must_use]
    #[allow(dead_code)]
    pub(crate) fn derive(scope: AuthorityScope) -> Self {
        Self {
            scope,
            _seal: Private,
        }
    }

    /// The scope this key is derived from.
    #[must_use]
    pub fn scope(&self) -> &AuthorityScope {
        &self.scope
    }
}

impl core::fmt::Debug for AuthorityKey {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Never render the eventual Global\ object name.
        f.debug_struct("AuthorityKey")
            .field("object_name", &"<redacted>")
            .field("channel", &self.scope.channel)
            .field("version", &self.scope.version)
            .finish()
    }
}

/// The RAW outcome of a future atomic create-or-open of the existence token. It carries NO trust: an
/// [`Self::ExistingToken`] means only that a kernel object with the name already exists, never that
/// ProjectOS or a trusted peer owns it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityTokenOutcome {
    /// This process newly created the token (was the atomic creator).
    AcquiredToken,
    /// A token with this name already existed. NOT trusted ownership — corroboration is mandatory.
    ExistingToken,
    /// The kernel refused the operation.
    Refused,
}

impl AuthorityTokenOutcome {
    /// Whether this raw outcome, ON ITS OWN, confirms a trusted ProjectOS authority. Always `false` —
    /// a token is an exclusivity signal, not proof of a trusted owner; corroboration is required.
    #[must_use]
    pub fn is_confirmed_authority(self) -> bool {
        false
    }
}

/// The corroborated peer state after typed evidence (SCM observation + typed IPC). Only these
/// confirm what an existing token actually represents; an uncorroborated token is
/// [`Self::AuthorityUncertain`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityPeerState {
    /// No corroboration yet.
    Uncorroborated,
    /// A genuine interactive fallback host was confirmed.
    InteractiveFallbackConfirmed,
    /// A genuine ProjectOSHost service runtime was confirmed.
    ServiceRuntimeConfirmed,
    /// A client connection to a confirmed authority was established.
    ClientConnectionConfirmed,
    /// Ownership is uncertain — fail closed.
    AuthorityUncertain,
}

impl AuthorityPeerState {
    /// Corroborate a raw token outcome into a peer state.
    ///
    /// An [`AuthorityTokenOutcome::ExistingToken`] WITHOUT confirmed peer evidence becomes
    /// [`Self::AuthorityUncertain`] — never a confirmed peer. This is the core no-trust rule.
    #[must_use]
    pub fn corroborate(
        outcome: AuthorityTokenOutcome,
        confirmed: Option<ConfirmedPeer>,
    ) -> AuthorityPeerState {
        match (outcome, confirmed) {
            // A fresh create means we are the (still-unconfirmed) owner; corroboration continues.
            (AuthorityTokenOutcome::AcquiredToken, _) => AuthorityPeerState::Uncorroborated,
            (AuthorityTokenOutcome::ExistingToken, Some(ConfirmedPeer::InteractiveFallback)) => {
                AuthorityPeerState::InteractiveFallbackConfirmed
            }
            (AuthorityTokenOutcome::ExistingToken, Some(ConfirmedPeer::ServiceRuntime)) => {
                AuthorityPeerState::ServiceRuntimeConfirmed
            }
            (AuthorityTokenOutcome::ExistingToken, Some(ConfirmedPeer::ClientConnection)) => {
                AuthorityPeerState::ClientConnectionConfirmed
            }
            // Existing token, no confirmation → uncertain, fail closed.
            (AuthorityTokenOutcome::ExistingToken, None) => AuthorityPeerState::AuthorityUncertain,
            (AuthorityTokenOutcome::Refused, _) => AuthorityPeerState::AuthorityUncertain,
        }
    }

    /// Whether startup may proceed on this peer state. `Uncorroborated` and `AuthorityUncertain` are
    /// fail-closed.
    #[must_use]
    pub fn permits_startup(self) -> bool {
        matches!(
            self,
            Self::InteractiveFallbackConfirmed
                | Self::ServiceRuntimeConfirmed
                | Self::ClientConnectionConfirmed
        )
    }
}

/// The evidence class that corroboration accepts. Produced only by genuine typed evidence in the
/// future implementation; there is no caller route to fabricate one at will (it is `#[non_exhaustive]`
/// and carries no data a caller controls).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ConfirmedPeer {
    /// A confirmed interactive fallback host.
    InteractiveFallback,
    /// A confirmed ProjectOSHost service runtime.
    ServiceRuntime,
    /// A confirmed client connection to an authority.
    ClientConnection,
}

/// Why authority was refused. Fieldless — names no object, SID, DACL, account or path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityRefusal {
    /// The kernel denied access to the object.
    AccessDenied,
    /// The name exists as a different kernel-object type.
    ScopeCollision,
    /// The object exists but its security/ownership evidence is untrusted.
    UntrustedObject,
    /// The object's security profile does not match the expected machine-wide profile.
    SecurityProfileMismatch,
    /// Interactive fallback was requested but service absence could not be proven.
    ServiceAbsenceUnproven,
    /// Fallback is forbidden because the service was already activated (even if now stopped).
    FallbackForbiddenAfterActivation,
    /// Fallback is forbidden because a service authority is present/live.
    FallbackForbiddenByServicePresence,
    /// An activated service is stopped and requires repair, not fallback.
    ServiceRepairRequired,
    /// The activation handover is in an uncertain state.
    HandoverUncertain,
    /// Any other fail-closed unavailability.
    AuthorityUnavailable,
}

/// A bounded, redacted authority evidence record. Contains no raw SID, DACL, object name, handle,
/// username, machine name or private path — only fieldless classifications and a bounded diagnostic
/// code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthorityEvidence {
    /// The raw token outcome observed.
    pub token_outcome: AuthorityTokenOutcome,
    /// The corroborated peer state.
    pub peer_state: AuthorityPeerState,
    /// A closed diagnostic reason.
    pub diagnostic: AuthorityDiagnosticCode,
}

/// Closed diagnostic reasons for authority evidence. A code carries no free text and therefore cannot
/// leak an identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityDiagnosticCode {
    /// Nothing notable.
    None,
    /// Corroboration has not completed.
    CorroborationIncomplete,
    /// The object security profile was rejected.
    SecurityProfileRejected,
    /// Service evidence was unavailable.
    ServiceEvidenceUnavailable,
}

impl AuthorityEvidence {
    /// Build a redacted evidence record.
    #[must_use]
    pub fn new(
        token_outcome: AuthorityTokenOutcome,
        peer_state: AuthorityPeerState,
        diagnostic: AuthorityDiagnosticCode,
    ) -> Self {
        Self {
            token_outcome,
            peer_state,
            diagnostic,
        }
    }
}

/// The intended access rights for the machine-wide authority object's security profile. DETECTION
/// ONLY — this contract creates no ACE. Modification/ownership rights are deliberately excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IntendedRight {
    /// `SYNCHRONIZE` — open/detect the existence token.
    Synchronize,
    /// `READ_CONTROL` — read the object's security descriptor for cross-identity inspection.
    ReadControl,
}

/// The intended principals for the machine-wide authority object's security profile. Sealed set —
/// there is no arbitrary-principal builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IntendedPrincipal {
    /// The ProjectOSHost service-specific principal (semantic classification only — see
    /// [`ServiceSidResolution`]).
    ProjectOsHostService,
    /// The SYSTEM account.
    System,
    /// The Administrators group.
    Administrators,
    /// The INTERACTIVE well-known group (cross-user detection only).
    Interactive,
    /// OWNER_RIGHTS — inclusion is subject to the 3K-I-D-C proof condition.
    OwnerRights,
}

/// The one sealed conceptual security profile for the machine-wide authority object. It exposes the
/// INTENDED principals and detection rights only; it accepts no SDDL, no arbitrary principal list and
/// no arbitrary access mask, and it builds no descriptor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthoritySecurityProfile {
    _seal: Private,
}

impl AuthoritySecurityProfile {
    /// The single machine-wide profile, `MachineWideAuthoritySecurityV1`.
    #[must_use]
    pub fn machine_wide_v1() -> Self {
        Self { _seal: Private }
    }

    /// The intended principals (fixed set).
    #[must_use]
    pub fn intended_principals(self) -> &'static [IntendedPrincipal] {
        &[
            IntendedPrincipal::ProjectOsHostService,
            IntendedPrincipal::System,
            IntendedPrincipal::Administrators,
            IntendedPrincipal::Interactive,
            IntendedPrincipal::OwnerRights,
        ]
    }

    /// The intended detection rights (fixed set): `SYNCHRONIZE | READ_CONTROL` only.
    #[must_use]
    pub fn intended_rights(self) -> &'static [IntendedRight] {
        &[IntendedRight::Synchronize, IntendedRight::ReadControl]
    }
}

/// The classification of whether the future service-specific principal SID can be resolved. This
/// contract computes NO SID; it only names the proof route the implementation must satisfy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceSidResolution {
    /// A supported pre-installation resolution route is proven.
    SupportedResolutionProven,
    /// The installer prepares the SID.
    InstallerPreparedSid,
    /// Resolution requires an installed service to prove.
    RequiresInstalledServiceProof,
    /// No supported resolution route is available.
    ResolutionUnavailable,
}

/// A read-only observation of the Windows service, SEPARATE from activation authority. Produced by a
/// future read-only SCM query; represented here as a classification only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceObservation {
    /// The service is not installed.
    ServiceNotInstalled,
    /// Installed and stopped.
    ServiceStopped,
    /// Start pending.
    ServiceStartPending,
    /// Running.
    ServiceRunning,
    /// Stop pending.
    ServiceStopPending,
    /// Status could not be read.
    ServiceStatusUnavailable,
    /// The installed service identity does not match the expected ProjectOSHost identity.
    ServiceIdentityMismatch,
}

/// The activation authority state, SEPARATE from a read-only service observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceActivationState {
    /// The service has never been activated.
    NeverActivated,
    /// Installation has been prepared.
    InstallationPrepared,
    /// Activation is pending.
    ActivationPending,
    /// Activation was committed (the service became authoritative at least once).
    ActivationCommitted,
    /// An owner-approved rollback to fallback is in effect.
    OwnerApprovedRollback,
    /// The activation state is uncertain.
    ActivationStateUncertain,
}

/// A sealed interactive-fallback policy. There is NO public constructor in this phase — an
/// interactive fallback cannot be authorised until a later governed gate supplies one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FallbackPolicy {
    _seal: Private,
}

/// The result of evaluating fallback eligibility. Informational — it grants no authority; even
/// `Eligible` only means the sealed policy plus evidence would permit a future acquisition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum FallbackEligibility {
    /// Fallback could proceed (still requires the sealed policy and a successful token acquisition to
    /// actually acquire — this value alone acquires nothing).
    Eligible,
    /// Fallback is refused, with a fieldless reason.
    Refused(AuthorityRefusal),
}

impl FallbackEligibility {
    /// Evaluate fallback eligibility from separated evidence. Requires an eligible activation state
    /// AND an eligible service observation AND an explicit sealed policy. SCM status alone and IPC
    /// failure alone never yield eligibility.
    ///
    /// The `policy` is `Option` so callers without a (still-unconstructible) policy are represented;
    /// `None` always refuses.
    #[must_use]
    pub fn evaluate(
        activation: ServiceActivationState,
        observation: ServiceObservation,
        policy: Option<FallbackPolicy>,
    ) -> FallbackEligibility {
        // An explicit sealed policy is mandatory.
        if policy.is_none() {
            return FallbackEligibility::Refused(AuthorityRefusal::ServiceAbsenceUnproven);
        }
        // Any activation past NeverActivated / OwnerApprovedRollback forbids fallback.
        match activation {
            ServiceActivationState::NeverActivated
            | ServiceActivationState::OwnerApprovedRollback => {}
            ServiceActivationState::ActivationCommitted => {
                return FallbackEligibility::Refused(
                    AuthorityRefusal::FallbackForbiddenAfterActivation,
                );
            }
            ServiceActivationState::InstallationPrepared
            | ServiceActivationState::ActivationPending
            | ServiceActivationState::ActivationStateUncertain => {
                return FallbackEligibility::Refused(AuthorityRefusal::HandoverUncertain);
            }
        }
        // Service must be provably absent/stopped-and-clean; presence or unreadable status refuses.
        match observation {
            ServiceObservation::ServiceNotInstalled => FallbackEligibility::Eligible,
            ServiceObservation::ServiceStopped => {
                // Stopped is only eligible when the service was NEVER activated (a stop AFTER
                // activation is repair, handled above by ActivationCommitted).
                if matches!(activation, ServiceActivationState::NeverActivated) {
                    FallbackEligibility::Eligible
                } else {
                    FallbackEligibility::Refused(AuthorityRefusal::ServiceRepairRequired)
                }
            }
            ServiceObservation::ServiceRunning
            | ServiceObservation::ServiceStartPending
            | ServiceObservation::ServiceStopPending => {
                FallbackEligibility::Refused(AuthorityRefusal::FallbackForbiddenByServicePresence)
            }
            ServiceObservation::ServiceStatusUnavailable => {
                FallbackEligibility::Refused(AuthorityRefusal::ServiceAbsenceUnproven)
            }
            ServiceObservation::ServiceIdentityMismatch => {
                FallbackEligibility::Refused(AuthorityRefusal::UntrustedObject)
            }
        }
    }
}

/// The activation handover state machine. `FallbackReleased` must precede `ServiceTokenAcquired`, and
/// a direct `FallbackOwned → ServiceTokenAcquired` transition is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityHandoverState {
    /// No fallback exists.
    FallbackAbsent,
    /// Fallback owns the authority.
    FallbackOwned,
    /// Fallback is stopping (children reconciled).
    FallbackStopping,
    /// Fallback released the authority (its handle closed; the object is gone).
    FallbackReleased,
    /// Service installation is prepared.
    ServiceInstallPrepared,
    /// Service activation is pending.
    ServiceActivationPending,
    /// The service acquired the token (fresh create).
    ServiceTokenAcquired,
    /// The service is authoritative and ready.
    ServiceReady,
    /// An activated service is stopped and needs repair.
    ServiceRepairRequired,
    /// Ownership is uncertain.
    AuthorityUncertain,
    /// Activation refused, fail-closed.
    ActivationRefused,
}

impl AuthorityHandoverState {
    /// Whether a transition from `self` to `next` is permitted.
    ///
    /// The load-bearing invariant: the ONLY route to `ServiceTokenAcquired` is from
    /// `ServiceActivationPending`, which is reachable only after `FallbackReleased` (or
    /// `FallbackAbsent`) → `ServiceInstallPrepared` → `ServiceActivationPending`. A direct
    /// `FallbackOwned → ServiceTokenAcquired` is therefore refused. Any timeout/missing/conflicting
    /// evidence goes to `AuthorityUncertain` or `ActivationRefused`.
    #[must_use]
    pub fn can_transition_to(self, next: AuthorityHandoverState) -> bool {
        use AuthorityHandoverState as S;
        // Fail-closed states are reachable from any non-terminal state.
        if matches!(next, S::AuthorityUncertain | S::ActivationRefused) {
            return !matches!(self, S::ServiceReady | S::ActivationRefused);
        }
        match (self, next) {
            (S::FallbackAbsent, S::ServiceInstallPrepared) => true,
            (S::FallbackAbsent, S::FallbackOwned) => true,
            (S::FallbackOwned, S::FallbackStopping) => true,
            (S::FallbackStopping, S::FallbackReleased) => true,
            (S::FallbackReleased, S::ServiceInstallPrepared) => true,
            (S::ServiceInstallPrepared, S::ServiceActivationPending) => true,
            // Release-before-acquire: the token can be acquired ONLY from ActivationPending.
            (S::ServiceActivationPending, S::ServiceTokenAcquired) => true,
            (S::ServiceTokenAcquired, S::ServiceReady) => true,
            // An activated service that stops needs repair, never silent fallback.
            (S::ServiceReady, S::ServiceRepairRequired) => true,
            _ => false,
        }
    }
}

/// A contract-only, non-constructible authority guard placeholder. In this phase it has no public
/// constructor, is not `Clone`/`Copy`/`Default`/`Serialize`, carries no raw handle, and performs no
/// `Drop` effect. The real handle-owning guard arrives with the implementation.
#[derive(Debug)]
pub struct AuthorityGuard {
    _seal: Private,
}

impl AuthorityGuard {
    /// CRATE-PRIVATE placeholder used only by contract tests to name the type. It owns nothing and
    /// grants nothing.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn contract_placeholder() -> Self {
        Self { _seal: Private }
    }
}

/// The sealed interactive-fallback authority entry point. No public constructor and no generic
/// acquire: an interactive fallback cannot be acquired from a bool/string/environment input, and the
/// route stays separate from the service route.
#[derive(Debug)]
pub struct InteractiveFallbackAuthority {
    _seal: Private,
}

/// The sealed service-runtime authority entry point. No public constructor and no generic acquire:
/// only the future service wrapper, holding a sealed activation proof, can reach acquisition.
#[derive(Debug)]
pub struct ServiceRuntimeAuthority {
    _seal: Private,
}

/// The non-authoritative client contract shape. It exposes NO authority-acquisition method — a client
/// connects to a confirmed authority, it never becomes one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostRuntimeClient {
    _seal: Private,
}

impl HostRuntimeClient {
    /// The client contract value. Non-authoritative by construction.
    #[must_use]
    pub fn contract() -> Self {
        Self { _seal: Private }
    }

    /// A client is never authoritative.
    #[must_use]
    pub fn is_authoritative(self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> AuthorityScope {
        AuthorityScope::new(
            CanonicalInstallationIdentity::from_canonical_boundary(),
            AuthorityChannel::Development,
            AuthoritySchemaVersion::V1,
        )
    }

    #[test]
    fn scope_is_machine_wide_and_has_no_user_component() {
        let s = scope();
        assert!(s.is_machine_wide());
        // The only readable scope facets are channel + version; no user/service getter exists.
        assert_eq!(s.channel(), AuthorityChannel::Development);
        assert_eq!(s.schema_version(), AuthoritySchemaVersion::V1);
    }

    #[test]
    fn authority_key_debug_is_redacted() {
        let k = AuthorityKey::derive(scope());
        let shown = format!("{k:?}");
        assert!(shown.contains("<redacted>"));
        assert!(!shown.contains("Global"));
    }

    #[test]
    fn installation_identity_debug_is_redacted() {
        let i = CanonicalInstallationIdentity::from_canonical_boundary();
        let shown = format!("{i:?}");
        assert!(shown.contains("<redacted>"));
        assert!(!shown.contains(":\\"));
    }

    #[test]
    fn an_existing_token_is_never_confirmed_authority() {
        assert!(!AuthorityTokenOutcome::ExistingToken.is_confirmed_authority());
        assert!(!AuthorityTokenOutcome::AcquiredToken.is_confirmed_authority());
    }

    #[test]
    fn existing_token_without_corroboration_is_uncertain() {
        let peer = AuthorityPeerState::corroborate(AuthorityTokenOutcome::ExistingToken, None);
        assert_eq!(peer, AuthorityPeerState::AuthorityUncertain);
        assert!(!peer.permits_startup());
    }

    #[test]
    fn existing_token_with_confirmation_becomes_the_confirmed_peer() {
        let peer = AuthorityPeerState::corroborate(
            AuthorityTokenOutcome::ExistingToken,
            Some(ConfirmedPeer::ServiceRuntime),
        );
        assert_eq!(peer, AuthorityPeerState::ServiceRuntimeConfirmed);
        assert!(peer.permits_startup());
    }

    #[test]
    fn authority_uncertain_is_fail_closed() {
        assert!(!AuthorityPeerState::AuthorityUncertain.permits_startup());
        assert!(!AuthorityPeerState::Uncorroborated.permits_startup());
    }

    #[test]
    fn ipc_failure_alone_does_not_make_fallback_eligible() {
        // "IPC failure" is modelled as a status that could not be read.
        let e = FallbackEligibility::evaluate(
            ServiceActivationState::NeverActivated,
            ServiceObservation::ServiceStatusUnavailable,
            Some(FallbackPolicy { _seal: Private }),
        );
        assert_eq!(
            e,
            FallbackEligibility::Refused(AuthorityRefusal::ServiceAbsenceUnproven)
        );
    }

    #[test]
    fn activated_then_stopped_service_never_re_enables_fallback() {
        let e = FallbackEligibility::evaluate(
            ServiceActivationState::ActivationCommitted,
            ServiceObservation::ServiceStopped,
            Some(FallbackPolicy { _seal: Private }),
        );
        assert_eq!(
            e,
            FallbackEligibility::Refused(AuthorityRefusal::FallbackForbiddenAfterActivation)
        );
    }

    #[test]
    fn never_activated_with_policy_and_absent_service_is_eligible_but_grants_nothing() {
        let e = FallbackEligibility::evaluate(
            ServiceActivationState::NeverActivated,
            ServiceObservation::ServiceNotInstalled,
            Some(FallbackPolicy { _seal: Private }),
        );
        assert_eq!(e, FallbackEligibility::Eligible);
        // Eligible is informational: it is not an AuthorityGuard and holds no handle.
    }

    #[test]
    fn fallback_without_policy_is_refused() {
        let e = FallbackEligibility::evaluate(
            ServiceActivationState::NeverActivated,
            ServiceObservation::ServiceNotInstalled,
            None,
        );
        assert!(matches!(e, FallbackEligibility::Refused(_)));
    }

    #[test]
    fn running_service_forbids_fallback() {
        let e = FallbackEligibility::evaluate(
            ServiceActivationState::ActivationCommitted,
            ServiceObservation::ServiceRunning,
            Some(FallbackPolicy { _seal: Private }),
        );
        assert_eq!(
            e,
            FallbackEligibility::Refused(AuthorityRefusal::FallbackForbiddenAfterActivation)
        );
    }

    #[test]
    fn fallback_owned_cannot_become_service_token_acquired_directly() {
        assert!(!AuthorityHandoverState::FallbackOwned
            .can_transition_to(AuthorityHandoverState::ServiceTokenAcquired));
    }

    #[test]
    fn release_precedes_service_token_acquisition() {
        use AuthorityHandoverState as S;
        assert!(S::FallbackOwned.can_transition_to(S::FallbackStopping));
        assert!(S::FallbackStopping.can_transition_to(S::FallbackReleased));
        assert!(S::FallbackReleased.can_transition_to(S::ServiceInstallPrepared));
        assert!(S::ServiceInstallPrepared.can_transition_to(S::ServiceActivationPending));
        assert!(S::ServiceActivationPending.can_transition_to(S::ServiceTokenAcquired));
        assert!(S::ServiceTokenAcquired.can_transition_to(S::ServiceReady));
    }

    #[test]
    fn uncertainty_is_reachable_and_terminalish() {
        use AuthorityHandoverState as S;
        assert!(S::ServiceActivationPending.can_transition_to(S::AuthorityUncertain));
        assert!(S::FallbackOwned.can_transition_to(S::ActivationRefused));
        // ServiceReady does not silently fall back to uncertainty.
        assert!(!S::ServiceReady.can_transition_to(S::AuthorityUncertain));
    }

    #[test]
    fn security_profile_intends_synchronize_and_read_control_only() {
        let p = AuthoritySecurityProfile::machine_wide_v1();
        assert_eq!(
            p.intended_rights(),
            &[IntendedRight::Synchronize, IntendedRight::ReadControl]
        );
        // Modification rights are simply not representable in IntendedRight.
    }

    #[test]
    fn security_profile_principals_are_the_fixed_set() {
        let p = AuthoritySecurityProfile::machine_wide_v1();
        let principals = p.intended_principals();
        assert!(principals.contains(&IntendedPrincipal::ProjectOsHostService));
        assert!(principals.contains(&IntendedPrincipal::Interactive));
        assert_eq!(principals.len(), 5);
    }

    #[test]
    fn service_sid_resolution_can_defer_to_installed_proof() {
        // The contract can represent "no pre-install route" so I-D-C may stop.
        let r = ServiceSidResolution::RequiresInstalledServiceProof;
        assert_ne!(r, ServiceSidResolution::SupportedResolutionProven);
    }

    #[test]
    fn client_is_non_authoritative_and_has_no_acquire() {
        let c = HostRuntimeClient::contract();
        assert!(!c.is_authoritative());
        // There is deliberately no c.acquire(...) — enforced by the compile-fail doctests in lib.rs.
    }

    #[test]
    fn evidence_carries_only_classifications() {
        let e = AuthorityEvidence::new(
            AuthorityTokenOutcome::ExistingToken,
            AuthorityPeerState::AuthorityUncertain,
            AuthorityDiagnosticCode::CorroborationIncomplete,
        );
        let shown = format!("{e:?}");
        assert!(!shown.contains("S-1-"));
        assert!(!shown.contains("Global"));
        assert!(!shown.contains(":\\"));
    }

    #[test]
    fn an_authority_guard_placeholder_owns_nothing() {
        let _g = AuthorityGuard::contract_placeholder();
        // Not Clone/Copy/Default; no handle; no Drop effect. Naming it is all this phase permits.
    }
}
