//! The closed service-control contract types. No arbitrary name, path, identity or diagnostic can be
//! represented; every field is a closed enum or the fixed proof identity.

use projectos_host_windows_service_installation_contract::{
    PostEffectVerification, APPROVED_SERVICE_NAME,
};

/// The single, fixed proof-service identity. There is deliberately NO public arbitrary-name field and
/// NO arbitrary-binary-path field: the only name is the accepted `ProjectOSHost`, and the binary is
/// resolved by a later approved installation step, never supplied here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProofServiceIdentity {
    account: ProofServiceAccountPolicy,
    sid: ProofServiceSidPolicy,
    start: ProofServiceStartPolicy,
}

impl ProofServiceIdentity {
    /// The one proof-service identity: ProjectOSHost, VirtualServiceAccount (no password), demand-start,
    /// UNRESTRICTED service-SID baseline.
    #[must_use]
    pub fn projectos_host() -> Self {
        Self {
            account: ProofServiceAccountPolicy::VirtualServiceAccountNoPassword,
            sid: ProofServiceSidPolicy::Unrestricted,
            start: ProofServiceStartPolicy::DemandStartOnly,
        }
    }

    /// The fixed approved service name (`ProjectOSHost`). Read-only; not caller-supplied.
    #[must_use]
    pub fn approved_name(self) -> &'static str {
        APPROVED_SERVICE_NAME
    }

    /// The fixed account policy.
    #[must_use]
    pub fn account_policy(self) -> ProofServiceAccountPolicy {
        self.account
    }

    /// The fixed service-SID policy baseline.
    #[must_use]
    pub fn sid_policy(self) -> ProofServiceSidPolicy {
        self.sid
    }

    /// The fixed start policy.
    #[must_use]
    pub fn start_policy(self) -> ProofServiceStartPolicy {
        self.start
    }

    /// Whether a candidate name equals the approved proof-service name. Used by a future adapter's
    /// exact-name preflight; it accepts no other name.
    #[must_use]
    pub fn is_approved_name(name: &str) -> bool {
        name == APPROVED_SERVICE_NAME
    }
}

/// The account policy. Single variant: VirtualServiceAccount with no password. LocalSystem,
/// LocalService, NetworkService and any password-backed account are UNREPRESENTABLE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofServiceAccountPolicy {
    /// `NT SERVICE\ProjectOSHost`, SCM-managed, no password.
    VirtualServiceAccountNoPassword,
}

/// The service-SID policy baseline. Single variant: UNRESTRICTED (the accepted design baseline).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofServiceSidPolicy {
    /// `SERVICE_SID_TYPE_UNRESTRICTED`.
    Unrestricted,
}

/// The start policy. Single variant: demand start only. Automatic and delayed-automatic start are
/// UNREPRESENTABLE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofServiceStartPolicy {
    /// Manual / demand start only.
    DemandStartOnly,
}

/// The closed set of service lifecycle operations a future adapter may perform. There is no general
/// service-management operation and no arbitrary-target operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceLifecycleOperation {
    /// Read-only exact-name absence/collision preflight.
    PreflightExactName,
    /// Create the ProjectOSHost proof service.
    Create,
    /// Configure the service SID type (UNRESTRICTED).
    ConfigureSidType,
    /// Demand-start the service.
    DemandStart,
    /// Query service status.
    QueryStatus,
    /// Stop the service.
    Stop,
    /// Delete the service (exact name).
    Delete,
    /// Verify the service no longer exists.
    ConfirmDeleted,
}

impl ServiceLifecycleOperation {
    /// The complete closed set.
    #[must_use]
    pub fn all() -> &'static [ServiceLifecycleOperation] {
        &[
            Self::PreflightExactName,
            Self::Create,
            Self::ConfigureSidType,
            Self::DemandStart,
            Self::QueryStatus,
            Self::Stop,
            Self::Delete,
            Self::ConfirmDeleted,
        ]
    }

    /// The effect class of this operation.
    #[must_use]
    pub fn effect_class(self) -> ServiceEffectClass {
        match self {
            Self::PreflightExactName | Self::QueryStatus | Self::ConfirmDeleted => {
                ServiceEffectClass::ReadOnly
            }
            Self::Create => ServiceEffectClass::ServiceRegistration,
            Self::ConfigureSidType => ServiceEffectClass::SecurityBoundary,
            Self::DemandStart | Self::Stop => ServiceEffectClass::ServiceStateChange,
            Self::Delete => ServiceEffectClass::ServiceRegistrationRemoval,
        }
    }

    /// Whether this operation mutates the system.
    #[must_use]
    pub fn is_mutating(self) -> bool {
        !matches!(self.effect_class(), ServiceEffectClass::ReadOnly)
    }

    /// The approval requirement. Every mutating operation requires owner approval AND administrator
    /// elevation; read-only operations require neither.
    #[must_use]
    pub fn approval_requirement(self) -> ServiceApprovalRequirement {
        if self.is_mutating() {
            ServiceApprovalRequirement::OwnerApprovalAndAdministrator
        } else {
            ServiceApprovalRequirement::ReadOnlyNoApproval
        }
    }

    /// The elevation requirement.
    #[must_use]
    pub fn elevation_requirement(self) -> ElevationRequirement {
        if self.is_mutating() {
            ElevationRequirement::AdministratorRequired
        } else {
            ElevationRequirement::NotRequired
        }
    }

    /// The effect authority. In this contract phase it is ALWAYS `NotAuthorised` — no operation may
    /// execute.
    #[must_use]
    pub fn authority(self) -> ServiceOperationAuthority {
        ServiceOperationAuthority::NotAuthorised
    }
}

/// The effect class of a service operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceEffectClass {
    /// No system mutation.
    ReadOnly,
    /// Registers the service in the SCM database.
    ServiceRegistration,
    /// Removes the service registration.
    ServiceRegistrationRemoval,
    /// Changes a security-relevant configuration (e.g. the service-SID type).
    SecurityBoundary,
    /// Changes running state (start/stop).
    ServiceStateChange,
}

/// The approval requirement of an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceApprovalRequirement {
    /// Owner approval AND administrator elevation are both required.
    OwnerApprovalAndAdministrator,
    /// A read-only operation requiring neither.
    ReadOnlyNoApproval,
}

/// Whether administrator elevation is required.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ElevationRequirement {
    /// Administrator elevation is required.
    AdministratorRequired,
    /// No elevation required.
    NotRequired,
}

/// The sealed effect authority. Single variant `NotAuthorised`; a `bool` cannot substitute, and no
/// constructor yields anything else in this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceOperationAuthority {
    /// No live service-control operation is authorised.
    NotAuthorised,
}

impl ServiceOperationAuthority {
    /// The authority this phase always reports.
    #[must_use]
    pub fn default_phase() -> Self {
        Self::NotAuthorised
    }
}

/// The five SEPARATE gate states, which must never collapse into one boolean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OperationGate {
    /// Whether the effectful capability is even compiled in.
    pub compiled_capability: Compiled,
    /// Whether the owner has approved this specific operation.
    pub owner_approval: OwnerApproval,
    /// Whether the process is running elevated.
    pub elevation: Elevation,
    /// Whether a live proof run is active.
    pub live_proof: LiveProof,
    /// Whether production activation is authorised (never, in this programme's proof scope).
    pub production_activation: ProductionActivation,
}

/// Whether the effectful capability is compiled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compiled {
    /// Not compiled (default/contract build).
    Absent,
    /// Compiled under an explicit test-fixture feature (a LATER phase).
    Present,
}
/// Whether the owner approved the operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerApproval {
    /// Not approved.
    Absent,
    /// Approved for exactly one operation.
    PresentForOneOperation,
}
/// Whether the process is elevated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Elevation {
    /// Not elevated.
    Absent,
    /// Administrator elevation present.
    Administrator,
}
/// Whether a live proof run is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveProof {
    /// No live proof.
    Absent,
    /// A live proof run is active.
    Active,
}
/// Whether production activation is authorised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductionActivation {
    /// Forbidden (always, in the proof programme).
    Forbidden,
}

/// The resolved outcome of a gate evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum GateOutcome {
    /// The operation is refused, with an exact reason.
    Refused(ServiceOperationRefusal),
    /// Even with all gates set, this contract phase authorises nothing.
    NotAuthorisedInContractPhase,
}

impl OperationGate {
    /// Evaluate the gate, fail closed. Compiled capability alone is never authority; elevation without
    /// owner approval is refused; owner approval without elevation cannot execute a mutating op.
    #[must_use]
    pub fn evaluate(self) -> GateOutcome {
        // Production activation cannot be permitted: `ProductionActivation` has only `Forbidden`, so a
        // live proof never implies production activation (enforced by the type, not a runtime branch).
        // Compiled capability alone is not runtime authority.
        if matches!(self.compiled_capability, Compiled::Present)
            && matches!(self.owner_approval, OwnerApproval::Absent)
        {
            return GateOutcome::Refused(ServiceOperationRefusal::CompiledCapabilityNotAuthority);
        }
        // Elevation without owner approval is refused.
        if matches!(self.elevation, Elevation::Administrator)
            && matches!(self.owner_approval, OwnerApproval::Absent)
        {
            return GateOutcome::Refused(ServiceOperationRefusal::ElevationWithoutOwnerApproval);
        }
        // Owner approval without elevation cannot execute a mutating operation.
        if matches!(self.owner_approval, OwnerApproval::PresentForOneOperation)
            && matches!(self.elevation, Elevation::Absent)
        {
            return GateOutcome::Refused(ServiceOperationRefusal::OwnerApprovalWithoutElevation);
        }
        // Even fully gated, this CONTRACT phase authorises no live effect.
        GateOutcome::NotAuthorisedInContractPhase
    }
}

/// The exact typed refusal reasons. Fieldless — no name, path, SID or account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceOperationRefusal {
    /// An arbitrary (non-ProjectOSHost) service name was supplied.
    ArbitraryNameRefused,
    /// A non-VirtualServiceAccount identity was supplied.
    NonVirtualAccountRefused,
    /// A password-backed account was supplied.
    PasswordRefused,
    /// Automatic / delayed-automatic start was requested.
    AutomaticStartRefused,
    /// Administrator elevation is present but the owner has not approved the operation.
    ElevationWithoutOwnerApproval,
    /// The owner approved the operation but the process is not elevated.
    OwnerApprovalWithoutElevation,
    /// A compiled capability was treated as runtime authority.
    CompiledCapabilityNotAuthority,
    /// A general SCM-management operation was requested.
    GeneralScmManagementRefused,
    /// Production activation was requested.
    ProductionActivationForbidden,
    /// An operation required exact-name verification that was not satisfied.
    ExactNameVerificationRequired,
    /// Deletion was reported without verification.
    DeletionNotVerified,
}

/// The post-effect verification requirement: a future adapter must re-read and verify, never assume a
/// success return. Reuses the canonical [`PostEffectVerification`] set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServicePostEffectRequirement;

impl ServicePostEffectRequirement {
    /// The mandatory canonical post-effect verifications.
    #[must_use]
    pub fn required() -> &'static [PostEffectVerification] {
        PostEffectVerification::all()
    }

    /// Whether a bare success return is sufficient. Always `false` — an authoritative re-read is
    /// mandatory.
    #[must_use]
    pub fn success_return_is_sufficient() -> bool {
        false
    }
}

/// The rollback requirement: stop, delete, then VERIFY deletion — never assume it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceRollbackRequirement {
    /// The ordered, verified rollback: stop → delete → confirm-deleted.
    StopThenDeleteThenVerifyDeleted,
}

impl ServiceRollbackRequirement {
    /// The required rollback sequence.
    #[must_use]
    pub fn sequence() -> &'static [ServiceLifecycleOperation] {
        &[
            ServiceLifecycleOperation::Stop,
            ServiceLifecycleOperation::Delete,
            ServiceLifecycleOperation::ConfirmDeleted,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projectos_host_is_the_only_identity() {
        let id = ProofServiceIdentity::projectos_host();
        assert_eq!(id.approved_name(), "ProjectOSHost");
        assert!(ProofServiceIdentity::is_approved_name("ProjectOSHost"));
        assert!(!ProofServiceIdentity::is_approved_name("SomethingElse"));
    }

    #[test]
    fn only_virtual_service_account_no_password() {
        assert_eq!(
            ProofServiceIdentity::projectos_host().account_policy(),
            ProofServiceAccountPolicy::VirtualServiceAccountNoPassword
        );
        // LocalSystem/LocalService/NetworkService/password are not representable — the enum has one
        // variant.
    }

    #[test]
    fn sid_policy_baseline_is_unrestricted() {
        assert_eq!(
            ProofServiceIdentity::projectos_host().sid_policy(),
            ProofServiceSidPolicy::Unrestricted
        );
    }

    #[test]
    fn start_policy_is_demand_only() {
        assert_eq!(
            ProofServiceIdentity::projectos_host().start_policy(),
            ProofServiceStartPolicy::DemandStartOnly
        );
    }

    #[test]
    fn every_mutating_operation_is_owner_and_admin_gated() {
        for op in ServiceLifecycleOperation::all() {
            if op.is_mutating() {
                assert_eq!(
                    op.approval_requirement(),
                    ServiceApprovalRequirement::OwnerApprovalAndAdministrator
                );
                assert_eq!(
                    op.elevation_requirement(),
                    ElevationRequirement::AdministratorRequired
                );
            }
            // No operation is ever authorised in this phase.
            assert_eq!(op.authority(), ServiceOperationAuthority::NotAuthorised);
        }
    }

    #[test]
    fn compiled_capability_is_not_runtime_authority() {
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
    fn elevation_without_owner_approval_is_refused() {
        let g = OperationGate {
            compiled_capability: Compiled::Absent,
            owner_approval: OwnerApproval::Absent,
            elevation: Elevation::Administrator,
            live_proof: LiveProof::Absent,
            production_activation: ProductionActivation::Forbidden,
        };
        assert_eq!(
            g.evaluate(),
            GateOutcome::Refused(ServiceOperationRefusal::ElevationWithoutOwnerApproval)
        );
    }

    #[test]
    fn owner_approval_without_elevation_cannot_execute() {
        let g = OperationGate {
            compiled_capability: Compiled::Absent,
            owner_approval: OwnerApproval::PresentForOneOperation,
            elevation: Elevation::Absent,
            live_proof: LiveProof::Absent,
            production_activation: ProductionActivation::Forbidden,
        };
        assert_eq!(
            g.evaluate(),
            GateOutcome::Refused(ServiceOperationRefusal::OwnerApprovalWithoutElevation)
        );
    }

    #[test]
    fn fully_gated_still_authorises_nothing_in_contract_phase() {
        let g = OperationGate {
            compiled_capability: Compiled::Present,
            owner_approval: OwnerApproval::PresentForOneOperation,
            elevation: Elevation::Administrator,
            live_proof: LiveProof::Active,
            production_activation: ProductionActivation::Forbidden,
        };
        assert_eq!(g.evaluate(), GateOutcome::NotAuthorisedInContractPhase);
    }

    #[test]
    fn deletion_requires_post_effect_verification_and_verified_rollback() {
        assert!(!ServicePostEffectRequirement::success_return_is_sufficient());
        assert!(!ServicePostEffectRequirement::required().is_empty());
        let seq = ServiceRollbackRequirement::sequence();
        assert_eq!(seq.last(), Some(&ServiceLifecycleOperation::ConfirmDeleted));
    }

    #[test]
    fn production_activation_is_forbidden_and_unrepresentable_as_permitted() {
        // ProductionActivation has a single Forbidden variant.
        assert_eq!(
            ProductionActivation::Forbidden,
            ProductionActivation::Forbidden
        );
    }
}
