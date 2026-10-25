//! Windows service-identity STRATEGY analysis. Nothing is installed, created, resolved or stored.
//!
//! The plan enumerates every supported strategy with its real trade-offs, records a RECOMMENDATION,
//! and then refuses to proceed until the owner decides. There is no silent selection and no silent
//! fallback to `LocalSystem`: an undecided plan stays undecided, and every downstream composition
//! fails closed on [`ActivationPlanError::ServiceIdentityRequired`].
//!
//! ## What this module structurally cannot do
//!
//! It cannot hold a password, a credential, a token, or a raw SID: no type here has a field for one,
//! and no constructor accepts one. The authoritative service SID is deliberately modelled as
//! [`ServiceSidStatus::UnresolvedUntilActivation`] — it must be obtained at activation time through an
//! approved Windows mechanism, never invented, hand-derived from an account name, or hardcoded.

use crate::error::ActivationPlanError;

/// A supported Windows service-identity strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum ServiceIdentityStrategy {
    /// `LocalSystem` — the most privileged local identity.
    LocalSystem,
    /// `NT AUTHORITY\LocalService` — low privilege, anonymous on the network. SHARED by all services
    /// that use it.
    LocalService,
    /// `NT AUTHORITY\NetworkService` — low privilege locally, machine identity on the network.
    /// SHARED by all services that use it.
    NetworkService,
    /// A virtual service account (`NT SERVICE\<ServiceName>`) — per-service identity, managed by
    /// Windows, no password to store or rotate.
    VirtualServiceAccount,
    /// An explicit local or domain account the owner nominates.
    OwnerApprovedAccount,
}

/// How privileged the identity is on the local machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PrivilegeLevel {
    /// Full local machine authority.
    FullMachine,
    /// A minimal, restricted set.
    Restricted,
    /// Whatever the owner grants the nominated account.
    OwnerDefined,
}

/// What the identity looks like to the network.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum NetworkIdentity {
    /// Presents the computer account.
    MachineAccount,
    /// Presents anonymous credentials.
    Anonymous,
    /// Presents the nominated account.
    NominatedAccount,
}

/// Whether the strategy requires a secret to be supplied and maintained.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PasswordManagement {
    /// No password exists for this identity.
    NoneRequired,
    /// Windows creates and rotates the secret itself; it is never handled by ProjectOS.
    ManagedByWindows,
    /// A human-managed secret with a rotation burden. ProjectOS still never stores or requests it.
    OwnerManaged,
}

/// Whether the identity yields a per-service SID usable in an ACL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceSidSupport {
    /// A per-service SID exists and can be used to scope access to THIS service alone.
    PerService,
    /// Only a well-known shared SID exists, so access cannot be narrowed to this service.
    SharedWellKnown,
    /// The account's own SID; per-service scoping is not available.
    AccountSid,
}

/// The authoritative SID's status. There is no variant that carries SID material.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceSidStatus {
    /// Must be obtained at activation time through an approved Windows mechanism. It is never
    /// invented, derived by hand from a name, or hardcoded — and it is never stored in this plan.
    UnresolvedUntilActivation,
}

/// Why a strategy was not recommended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RejectionReason {
    /// Grants far more authority than the host needs.
    ExcessivePrivilege,
    /// The identity is shared with other services, so "service-only" access is not achievable.
    SharedAcrossServices,
    /// Requires a human-managed secret and rotation.
    CredentialManagementBurden,
    /// Exposes a machine identity to the network without need.
    UnnecessaryNetworkIdentity,
}

/// The complete, honest profile of one strategy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceIdentityProfile {
    /// Which strategy.
    pub strategy: ServiceIdentityStrategy,
    /// Local privilege.
    pub privilege: PrivilegeLevel,
    /// Network identity.
    pub network: NetworkIdentity,
    /// Whether a credential must exist at all.
    pub requires_credential: bool,
    /// Who manages the secret, if any.
    pub password_management: PasswordManagement,
    /// Whether a per-service SID is available for ACL scoping.
    pub service_sid_support: ServiceSidSupport,
    /// Whether the strategy can support service-ONLY custody of host state and keys.
    pub supports_service_only_custody: bool,
    /// Whether installing it needs an extra owner-performed step.
    pub requires_owner_provisioning: bool,
    /// Whether the owner must decide before this can be used.
    pub owner_decision_required: bool,
}

impl ServiceIdentityProfile {
    /// The honest profile for a strategy.
    #[must_use]
    pub fn of(strategy: ServiceIdentityStrategy) -> Self {
        match strategy {
            ServiceIdentityStrategy::LocalSystem => Self {
                strategy,
                privilege: PrivilegeLevel::FullMachine,
                network: NetworkIdentity::MachineAccount,
                requires_credential: false,
                password_management: PasswordManagement::NoneRequired,
                service_sid_support: ServiceSidSupport::SharedWellKnown,
                // A well-known SID shared by every LocalSystem service: an ACL naming it cannot
                // distinguish this host from any other LocalSystem process.
                supports_service_only_custody: false,
                requires_owner_provisioning: false,
                owner_decision_required: true,
            },
            ServiceIdentityStrategy::LocalService => Self {
                strategy,
                privilege: PrivilegeLevel::Restricted,
                network: NetworkIdentity::Anonymous,
                requires_credential: false,
                password_management: PasswordManagement::NoneRequired,
                service_sid_support: ServiceSidSupport::SharedWellKnown,
                supports_service_only_custody: false,
                requires_owner_provisioning: false,
                owner_decision_required: true,
            },
            ServiceIdentityStrategy::NetworkService => Self {
                strategy,
                privilege: PrivilegeLevel::Restricted,
                network: NetworkIdentity::MachineAccount,
                requires_credential: false,
                password_management: PasswordManagement::NoneRequired,
                service_sid_support: ServiceSidSupport::SharedWellKnown,
                supports_service_only_custody: false,
                requires_owner_provisioning: false,
                owner_decision_required: true,
            },
            ServiceIdentityStrategy::VirtualServiceAccount => Self {
                strategy,
                privilege: PrivilegeLevel::Restricted,
                network: NetworkIdentity::MachineAccount,
                requires_credential: false,
                password_management: PasswordManagement::ManagedByWindows,
                service_sid_support: ServiceSidSupport::PerService,
                supports_service_only_custody: true,
                requires_owner_provisioning: false,
                owner_decision_required: true,
            },
            ServiceIdentityStrategy::OwnerApprovedAccount => Self {
                strategy,
                privilege: PrivilegeLevel::OwnerDefined,
                network: NetworkIdentity::NominatedAccount,
                requires_credential: true,
                password_management: PasswordManagement::OwnerManaged,
                service_sid_support: ServiceSidSupport::AccountSid,
                supports_service_only_custody: true,
                requires_owner_provisioning: true,
                owner_decision_required: true,
            },
        }
    }

    /// The unavoidable Windows reality, stated once so no report can imply otherwise.
    #[must_use]
    pub fn administrator_reality(&self) -> &'static str {
        "A local administrator can take ownership, rewrite the DACL, install a driver, or debug the \
         service. No service identity resists an administrator; ACLs raise the cost and make \
         tampering evident, they do not prevent it."
    }
}

/// How far the production-identity DECISION has progressed.
///
/// The three states are deliberately distinct so a recommendation can never be mistaken for an
/// approval. There is no `Default`, no serialisation (so no deserialised value can invent an
/// approval), no environment or session input, and exactly ONE way to reach
/// [`IdentityDecisionStatus::OwnerApproved`]: [`ServiceIdentityPlan::with_owner_decision`], called
/// with an explicit decision the owner made.
///
/// Selecting a strategy is state **A** only. It does not imply **B** identity resolved, **C** SID
/// resolved, **D** installation authorised, or **E** production authorised.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IdentityDecisionStatus {
    /// No strategy is selected and none is even advised.
    Undecided,
    /// ProjectOS advises a strategy. **This is not approval.** Every downstream composition still
    /// fails closed, and nothing becomes executable.
    Recommended(ServiceIdentityStrategy),
    /// The OWNER explicitly approved a strategy. The authoritative Windows identity and its SID are
    /// still unresolved, and every later gate remains separately unapproved.
    OwnerApproved(ServiceIdentityStrategy),
}

/// The final Windows service NAME, which this phase deliberately does not freeze.
///
/// `NT SERVICE\ProjectOSHost` appears in discussion only as an illustration. The internal name,
/// display name, executable identity, installation location, description and startup configuration
/// are a SEPARATE owner decision, and none of them is manufactured here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceNameStatus {
    /// Awaiting a separate owner decision.
    OwnerDecisionRequired,
}

/// The service-identity plan: every option, a recommendation, the rejections, and the resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceIdentityPlan {
    candidates: Vec<ServiceIdentityProfile>,
    recommended: ServiceIdentityStrategy,
    rejected: Vec<(ServiceIdentityStrategy, RejectionReason)>,
    decision: IdentityDecisionStatus,
    sid_status: ServiceSidStatus,
    service_name: ServiceNameStatus,
}

impl ServiceIdentityPlan {
    /// Build the analysis. The result is ALWAYS undecided: a plan cannot decide for the owner.
    #[must_use]
    pub fn analysed() -> Self {
        use ServiceIdentityStrategy as S;
        Self {
            candidates: [
                S::LocalSystem,
                S::LocalService,
                S::NetworkService,
                S::VirtualServiceAccount,
                S::OwnerApprovedAccount,
            ]
            .into_iter()
            .map(ServiceIdentityProfile::of)
            .collect(),
            // ADVISORY ONLY. It is a per-service identity with a per-service SID and no secret for
            // anyone to store or rotate — the only option that can express "this service and nothing
            // else" in an ACL without a credential-management burden.
            recommended: S::VirtualServiceAccount,
            rejected: vec![
                (S::LocalSystem, RejectionReason::ExcessivePrivilege),
                (S::LocalService, RejectionReason::SharedAcrossServices),
                (S::NetworkService, RejectionReason::SharedAcrossServices),
                (
                    S::OwnerApprovedAccount,
                    RejectionReason::CredentialManagementBurden,
                ),
            ],
            // A RECOMMENDATION, not an approval. Nothing downstream unblocks.
            decision: IdentityDecisionStatus::Recommended(S::VirtualServiceAccount),
            sid_status: ServiceSidStatus::UnresolvedUntilActivation,
            service_name: ServiceNameStatus::OwnerDecisionRequired,
        }
    }

    /// The same analysis with NO advisory recommendation at all.
    #[must_use]
    pub fn undecided() -> Self {
        Self {
            decision: IdentityDecisionStatus::Undecided,
            ..Self::analysed()
        }
    }

    /// Record the OWNER's explicit decision — the only route to
    /// [`IdentityDecisionStatus::OwnerApproved`].
    ///
    /// This transcribes a decision the owner made; the plan never calls it on its own behalf, and it
    /// accepts no credential, no password, no SID and no service name. Approving a STRATEGY does not
    /// resolve the identity, does not resolve the SID, and authorises no operation.
    #[must_use]
    pub fn with_owner_decision(mut self, strategy: ServiceIdentityStrategy) -> Self {
        self.decision = IdentityDecisionStatus::OwnerApproved(strategy);
        self
    }

    /// Every analysed option.
    #[must_use]
    pub fn candidates(&self) -> &[ServiceIdentityProfile] {
        &self.candidates
    }

    /// The ADVISORY recommendation. Not a decision.
    #[must_use]
    pub fn recommended(&self) -> ServiceIdentityStrategy {
        self.recommended
    }

    /// Strategies not recommended, and why.
    #[must_use]
    pub fn rejected(&self) -> &[(ServiceIdentityStrategy, RejectionReason)] {
        &self.rejected
    }

    /// The current decision status.
    #[must_use]
    pub fn decision(&self) -> IdentityDecisionStatus {
        self.decision
    }

    /// Whether the OWNER approved a strategy. A recommendation returns `false`.
    #[must_use]
    pub fn is_owner_approved(&self) -> bool {
        matches!(self.decision, IdentityDecisionStatus::OwnerApproved(_))
    }

    /// The SID status. Always unresolved in a plan — Windows must produce it later.
    #[must_use]
    pub fn sid_status(&self) -> ServiceSidStatus {
        self.sid_status
    }

    /// The service-name status. Always a separate owner decision in this phase.
    #[must_use]
    pub fn service_name(&self) -> ServiceNameStatus {
        self.service_name
    }

    /// The OWNER-APPROVED strategy, or a fail-closed refusal.
    ///
    /// # Errors
    /// [`ActivationPlanError::ServiceIdentityRequired`] while undecided **or merely recommended**.
    /// There is no fallback, default or "sensible guess", and a recommendation is never accepted in
    /// place of an approval.
    pub fn decided(&self) -> Result<ServiceIdentityStrategy, ActivationPlanError> {
        match self.decision {
            IdentityDecisionStatus::Undecided | IdentityDecisionStatus::Recommended(_) => {
                Err(ActivationPlanError::ServiceIdentityRequired)
            }
            IdentityDecisionStatus::OwnerApproved(s) => Ok(s),
        }
    }

    /// The profile of a strategy, as analysed by this plan.
    #[must_use]
    pub fn profile(&self, strategy: ServiceIdentityStrategy) -> Option<&ServiceIdentityProfile> {
        self.candidates.iter().find(|p| p.strategy == strategy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_supported_strategy_is_represented() {
        let plan = ServiceIdentityPlan::analysed();
        assert_eq!(plan.candidates().len(), 5);
        for s in [
            ServiceIdentityStrategy::LocalSystem,
            ServiceIdentityStrategy::LocalService,
            ServiceIdentityStrategy::NetworkService,
            ServiceIdentityStrategy::VirtualServiceAccount,
            ServiceIdentityStrategy::OwnerApprovedAccount,
        ] {
            assert!(plan.profile(s).is_some(), "{s:?} must be analysed");
        }
    }

    #[test]
    fn a_fresh_plan_is_only_recommended_and_has_no_fallback() {
        let plan = ServiceIdentityPlan::analysed();
        assert_eq!(
            plan.decision(),
            IdentityDecisionStatus::Recommended(ServiceIdentityStrategy::VirtualServiceAccount)
        );
        assert!(
            !plan.is_owner_approved(),
            "a recommendation is not approval"
        );
        assert_eq!(
            plan.decided().unwrap_err(),
            ActivationPlanError::ServiceIdentityRequired
        );
    }

    #[test]
    fn the_three_decision_states_are_distinct_and_only_one_is_approval() {
        let undecided = ServiceIdentityPlan::undecided();
        assert_eq!(undecided.decision(), IdentityDecisionStatus::Undecided);
        assert!(!undecided.is_owner_approved());
        assert!(undecided.decided().is_err());

        let recommended = ServiceIdentityPlan::analysed();
        assert!(matches!(
            recommended.decision(),
            IdentityDecisionStatus::Recommended(_)
        ));
        assert!(!recommended.is_owner_approved());
        assert!(recommended.decided().is_err());

        let approved = recommended
            .clone()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        assert!(matches!(
            approved.decision(),
            IdentityDecisionStatus::OwnerApproved(_)
        ));
        assert!(approved.is_owner_approved());
        assert_eq!(
            approved.decided().unwrap(),
            ServiceIdentityStrategy::VirtualServiceAccount
        );

        assert_ne!(undecided.decision(), recommended.decision());
        assert_ne!(recommended.decision(), approved.decision());
    }

    #[test]
    fn approving_a_strategy_resolves_neither_the_identity_nor_the_service_name() {
        let approved = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        assert_eq!(
            approved.sid_status(),
            ServiceSidStatus::UnresolvedUntilActivation
        );
        assert_eq!(
            approved.service_name(),
            ServiceNameStatus::OwnerDecisionRequired,
            "the service name is a SEPARATE owner decision and is never manufactured"
        );
    }

    #[test]
    fn there_is_no_silent_local_system_fallback() {
        let plan = ServiceIdentityPlan::analysed();
        // Undecided must NOT resolve to anything, least of all the most privileged identity.
        assert!(plan.decided().is_err());
        assert_ne!(plan.recommended(), ServiceIdentityStrategy::LocalSystem);
        assert!(plan
            .rejected()
            .iter()
            .any(|(s, r)| *s == ServiceIdentityStrategy::LocalSystem
                && *r == RejectionReason::ExcessivePrivilege));
    }

    #[test]
    fn the_recommendation_is_the_only_option_supporting_service_only_custody_without_a_secret() {
        let plan = ServiceIdentityPlan::analysed();
        let rec = plan.profile(plan.recommended()).unwrap();
        assert_eq!(rec.strategy, ServiceIdentityStrategy::VirtualServiceAccount);
        assert!(rec.supports_service_only_custody);
        assert!(!rec.requires_credential);
        assert_eq!(rec.service_sid_support, ServiceSidSupport::PerService);
        assert_eq!(rec.privilege, PrivilegeLevel::Restricted);
        assert_eq!(
            rec.password_management,
            PasswordManagement::ManagedByWindows
        );

        // The shared well-known identities genuinely cannot express service-only custody.
        for s in [
            ServiceIdentityStrategy::LocalSystem,
            ServiceIdentityStrategy::LocalService,
            ServiceIdentityStrategy::NetworkService,
        ] {
            let p = plan.profile(s).unwrap();
            assert_eq!(p.service_sid_support, ServiceSidSupport::SharedWellKnown);
            assert!(!p.supports_service_only_custody);
        }
    }

    #[test]
    fn every_strategy_still_requires_an_owner_decision() {
        let plan = ServiceIdentityPlan::analysed();
        assert!(plan.candidates().iter().all(|p| p.owner_decision_required));
    }

    #[test]
    fn the_owner_decision_is_recorded_but_the_sid_stays_unresolved() {
        let plan = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        assert_eq!(
            plan.decided().unwrap(),
            ServiceIdentityStrategy::VirtualServiceAccount
        );
        // Deciding the STRATEGY never resolves the authoritative SID.
        assert_eq!(
            plan.sid_status(),
            ServiceSidStatus::UnresolvedUntilActivation
        );
    }

    #[test]
    fn an_owner_may_decide_against_the_recommendation() {
        // The recommendation is advisory: the owner remains the final approver.
        let plan = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::LocalSystem);
        assert_eq!(
            plan.decided().unwrap(),
            ServiceIdentityStrategy::LocalSystem
        );
        assert!(
            !plan
                .profile(ServiceIdentityStrategy::LocalSystem)
                .unwrap()
                .supports_service_only_custody
        );
    }

    #[test]
    fn the_administrator_reality_is_stated_and_never_contradicted() {
        let p = ServiceIdentityProfile::of(ServiceIdentityStrategy::VirtualServiceAccount);
        let text = p.administrator_reality();
        assert!(text.contains("No service identity resists an administrator"));
        assert!(!text.contains("prevents"));
    }

    #[test]
    fn no_type_here_can_carry_a_secret_or_a_sid() {
        // Rendering every value must never produce credential or SID material — there is no field
        // for one, so this pins the absence rather than filtering it.
        let plan = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::OwnerApprovedAccount);
        let text = format!("{plan:?}");
        assert!(!text.contains("S-1-"));
        assert!(!text.to_ascii_lowercase().contains("password:"));
        assert!(text.contains("UnresolvedUntilActivation"));
    }
}
