//! The intended ACL composition. Composed as a POLICY VALUE, never applied.
//!
//! This module reuses the ACCEPTED semantic model from `projectos-host-windows-acl-policy`
//! (`AclPrincipal`, `RightsClass`, `AllowedPrincipal`, `AclPolicy`) rather than duplicating its
//! parser, verifier or Windows bindings. It requests no raw ACL bytes and no raw SID bytes — those
//! are crate-private in the accepted crate and unreachable here by construction.
//!
//! The composition is deliberately BLOCKED while the production service identity is undecided or its
//! authoritative SID is unresolved. No placeholder principal is manufactured to make a plan look
//! finished.

use projectos_host_windows_acl_policy::{
    AclPolicy, AclPrincipal, AllowedPrincipal, OwnedSid, RightsClass,
};

use crate::error::ActivationPlanError;
use crate::service_identity::{
    IdentityDecisionStatus, ServiceIdentityPlan, ServiceIdentityStrategy,
};

/// Whether the interactive owner keeps any access to the production root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InteractiveOwnerAccess {
    /// No ACE for the interactive user. The service and administrators only.
    None,
    /// Read-only, for owner inspection without the ability to modify host state.
    ReadOnly,
}

/// The service principal, once the owner has decided AND Windows can name it.
///
/// The only constructor takes an [`AclPrincipal`] that the accepted ACL crate can resolve for
/// itself — a well-known principal. There is deliberately no constructor accepting SID bytes, a SID
/// string, or an account name, so a principal cannot be invented to unblock a plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovedServicePrincipal {
    principal: AclPrincipal,
    strategy: ServiceIdentityStrategy,
}

impl ApprovedServicePrincipal {
    /// Bind an owner-decided strategy to a WELL-KNOWN principal the accepted crate can resolve.
    ///
    /// # Errors
    /// [`ActivationPlanError::ServiceSidUnresolved`] for any strategy whose principal cannot be
    /// named without querying Windows — notably the virtual service account, whose per-service SID
    /// exists only once the service is installed.
    pub fn from_well_known(strategy: ServiceIdentityStrategy) -> Result<Self, ActivationPlanError> {
        let principal = match strategy {
            ServiceIdentityStrategy::LocalSystem => AclPrincipal::LocalSystem,
            // `NT SERVICE\<name>`, `LocalService`, `NetworkService` and a nominated account all
            // require a live Windows lookup. Refusing here is the whole point: the plan must not
            // pretend to know a SID it cannot know.
            ServiceIdentityStrategy::VirtualServiceAccount
            | ServiceIdentityStrategy::LocalService
            | ServiceIdentityStrategy::NetworkService
            | ServiceIdentityStrategy::OwnerApprovedAccount => {
                return Err(ActivationPlanError::ServiceSidUnresolved)
            }
        };
        Ok(Self {
            principal,
            strategy,
        })
    }

    /// Bind an owner-decided strategy to a principal whose SID was RESOLVED LIVE at activation time.
    ///
    /// This is the counterpart [`Self::from_well_known`] refuses to guess: a virtual service account's
    /// per-service SID exists only once the service is installed, so it must be resolved through an
    /// approved Windows mechanism and handed in here. The SID is used exactly as supplied; this
    /// function performs no lookup and manufactures nothing.
    ///
    /// # Errors
    /// [`ActivationPlanError::ServiceSidUnresolved`] for a strategy whose principal is well known and
    /// must therefore come from [`Self::from_well_known`] instead.
    pub fn from_resolved_sid(
        strategy: ServiceIdentityStrategy,
        sid: OwnedSid,
    ) -> Result<Self, ActivationPlanError> {
        match strategy {
            // LocalSystem is well known; accepting a caller-supplied SID for it would let a resolved
            // value silently replace the fixed one.
            ServiceIdentityStrategy::LocalSystem => Err(ActivationPlanError::ServiceSidUnresolved),
            ServiceIdentityStrategy::VirtualServiceAccount
            | ServiceIdentityStrategy::LocalService
            | ServiceIdentityStrategy::NetworkService
            | ServiceIdentityStrategy::OwnerApprovedAccount => Ok(Self {
                principal: AclPrincipal::ExplicitSid(sid),
                strategy,
            }),
        }
    }

    /// The semantic principal.
    #[must_use]
    pub fn principal(&self) -> &AclPrincipal {
        &self.principal
    }

    /// The strategy it came from.
    #[must_use]
    pub fn strategy(&self) -> ServiceIdentityStrategy {
        self.strategy
    }
}

/// The result of attempting to compose the production ACL.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum AclCompositionOutcome {
    /// The owner has not chosen a service-identity strategy.
    OwnerDecisionRequired,
    /// The strategy is chosen, but the authoritative service SID does not exist yet.
    ServiceIdentityRequired,
    /// A complete, fail-closed policy value. Still NOT applied to anything.
    Composed(AclPolicy),
}

/// The intended ACL for the production root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclCompositionPlan {
    interactive_owner: InteractiveOwnerAccess,
    administrators_retained: bool,
    local_system_retained: bool,
}

impl AclCompositionPlan {
    /// The intended production composition.
    ///
    /// `Builtin Administrators` and `LocalSystem` are retained deliberately and honestly: Windows
    /// servicing, backup and recovery depend on them, and excluding them would not exclude an
    /// administrator — it would only make the host unmaintainable while proving nothing.
    #[must_use]
    pub fn production() -> Self {
        Self {
            interactive_owner: InteractiveOwnerAccess::None,
            administrators_retained: true,
            local_system_retained: true,
        }
    }

    /// Whether the interactive owner keeps access.
    #[must_use]
    pub fn interactive_owner(&self) -> InteractiveOwnerAccess {
        self.interactive_owner
    }

    /// Give the interactive owner read-only inspection access.
    #[must_use]
    pub fn with_interactive_owner(mut self, access: InteractiveOwnerAccess) -> Self {
        self.interactive_owner = access;
        self
    }

    /// Compose the policy from an owner-decided identity whose principal was RESOLVED LIVE.
    ///
    /// Same policy shape as [`Self::compose`]; the only difference is that the service principal was
    /// obtained at activation time rather than from the well-known table, which is the one case
    /// [`ApprovedServicePrincipal::from_well_known`] refuses to guess.
    #[must_use]
    pub fn compose_with_resolved_principal(
        &self,
        identity: &ServiceIdentityPlan,
        service: &ApprovedServicePrincipal,
    ) -> AclCompositionOutcome {
        let strategy = match identity.decision() {
            IdentityDecisionStatus::Undecided | IdentityDecisionStatus::Recommended(_) => {
                return AclCompositionOutcome::OwnerDecisionRequired
            }
            IdentityDecisionStatus::OwnerApproved(s) => s,
        };
        // The resolved principal must be the one the owner actually decided on.
        if service.strategy() != strategy {
            return AclCompositionOutcome::ServiceIdentityRequired;
        }
        self.assemble(strategy, service)
    }

    /// The shared policy assembly. Identical for a well-known and a resolved principal.
    fn assemble(
        &self,
        strategy: ServiceIdentityStrategy,
        service: &ApprovedServicePrincipal,
    ) -> AclCompositionOutcome {
        let mut allowed = vec![AllowedPrincipal {
            principal: service.principal().clone(),
            rights: RightsClass::FullControl,
        }];
        if self.administrators_retained {
            allowed.push(AllowedPrincipal {
                principal: AclPrincipal::BuiltinAdministrators,
                rights: RightsClass::FullControl,
            });
        }
        if self.local_system_retained && strategy != ServiceIdentityStrategy::LocalSystem {
            allowed.push(AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            });
        }
        if self.interactive_owner == InteractiveOwnerAccess::ReadOnly {
            allowed.push(AllowedPrincipal {
                principal: AclPrincipal::CurrentInteractiveUser,
                rights: RightsClass::Read,
            });
        }
        AclCompositionOutcome::Composed(AclPolicy::strict(service.principal().clone(), allowed))
    }

    /// Attempt to compose the final policy.
    ///
    /// Fails CLOSED at each stage: undecided strategy → `OwnerDecisionRequired`; decided but
    /// un-nameable principal → `ServiceIdentityRequired`. No placeholder is ever substituted.
    #[must_use]
    pub fn compose(&self, identity: &ServiceIdentityPlan) -> AclCompositionOutcome {
        // A RECOMMENDATION is not an approval: both undecided and merely-recommended states block.
        let strategy = match identity.decision() {
            IdentityDecisionStatus::Undecided | IdentityDecisionStatus::Recommended(_) => {
                return AclCompositionOutcome::OwnerDecisionRequired
            }
            IdentityDecisionStatus::OwnerApproved(s) => s,
        };
        let Ok(service) = ApprovedServicePrincipal::from_well_known(strategy) else {
            return AclCompositionOutcome::ServiceIdentityRequired;
        };
        // `AclPolicy::strict` is closed in every dimension: no inherited ACEs, DACL protection
        // required, no unknown principals, no deny ACEs, no broad-principal access of any kind.
        self.assemble(strategy, &service)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undecided_identity_blocks_composition() {
        let outcome = AclCompositionPlan::production().compose(&ServiceIdentityPlan::analysed());
        assert_eq!(outcome, AclCompositionOutcome::OwnerDecisionRequired);
    }

    #[test]
    fn a_decided_but_unresolvable_principal_still_blocks_composition() {
        // The RECOMMENDED strategy cannot be composed in a plan: its per-service SID exists only
        // after installation. That is the honest answer, not a defect to be worked around.
        for strategy in [
            ServiceIdentityStrategy::VirtualServiceAccount,
            ServiceIdentityStrategy::LocalService,
            ServiceIdentityStrategy::NetworkService,
            ServiceIdentityStrategy::OwnerApprovedAccount,
        ] {
            let identity = ServiceIdentityPlan::analysed().with_owner_decision(strategy);
            assert_eq!(
                AclCompositionPlan::production().compose(&identity),
                AclCompositionOutcome::ServiceIdentityRequired,
                "{strategy:?} must not compose from an unresolved SID"
            );
            assert_eq!(
                ApprovedServicePrincipal::from_well_known(strategy).unwrap_err(),
                ActivationPlanError::ServiceSidUnresolved
            );
        }
    }

    #[test]
    fn a_nameable_principal_composes_a_strict_policy() {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::LocalSystem);
        let AclCompositionOutcome::Composed(policy) =
            AclCompositionPlan::production().compose(&identity)
        else {
            panic!("a well-known principal must compose");
        };
        assert_eq!(policy.expected_owner, AclPrincipal::LocalSystem);
        assert!(!policy.allow_inherited_aces, "inheritance must be explicit");
        assert!(policy.require_protected_dacl);
        assert!(!policy.allow_unknown_principals);
        assert!(!policy.allow_deny_aces);
        assert!(!policy.allow_broad_principals_any_access);
        assert!(!policy.allow_broad_principals_write);
        assert!(!policy.grants_broad_write(), "no broad write authority");
        // LocalSystem is both the service identity and the retained servicing identity — it must not
        // be listed twice.
        assert_eq!(policy.allowed.len(), 2);
    }

    #[test]
    fn interactive_owner_access_is_explicit_and_read_only_when_granted() {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::LocalSystem);

        let none = AclCompositionPlan::production();
        assert_eq!(none.interactive_owner(), InteractiveOwnerAccess::None);
        let AclCompositionOutcome::Composed(p) = none.compose(&identity) else {
            panic!()
        };
        assert!(!p
            .allowed
            .iter()
            .any(|a| a.principal == AclPrincipal::CurrentInteractiveUser));

        let ro = AclCompositionPlan::production()
            .with_interactive_owner(InteractiveOwnerAccess::ReadOnly);
        let AclCompositionOutcome::Composed(p) = ro.compose(&identity) else {
            panic!()
        };
        let entry = p
            .allowed
            .iter()
            .find(|a| a.principal == AclPrincipal::CurrentInteractiveUser)
            .expect("read-only owner ACE must be present");
        assert_eq!(entry.rights, RightsClass::Read);
        assert!(!p.grants_broad_write());
    }

    #[test]
    fn administrators_and_local_system_are_retained_honestly() {
        let plan = AclCompositionPlan::production();
        assert!(plan.administrators_retained);
        assert!(plan.local_system_retained);
    }

    #[test]
    fn no_raw_sid_or_acl_material_is_required_or_rendered() {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::LocalSystem);
        let AclCompositionOutcome::Composed(policy) =
            AclCompositionPlan::production().compose(&identity)
        else {
            panic!()
        };
        let text = format!("{policy:?}");
        assert!(!text.contains("S-1-"), "no SID string may appear");
        assert!(
            !text.contains("0x"),
            "no raw pointer or mask blob may appear"
        );
    }
}
