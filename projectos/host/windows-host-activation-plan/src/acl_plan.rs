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
        // NTFS OWNERSHIP IS SYSTEM, NOT THE SERVICE. An owner holds implicit `READ_CONTROL` and
        // `WRITE_DAC` whatever the DACL says, so a service-owned directory would carry authority no
        // reviewed ACE states. SYSTEM ownership removes that IMPLICIT owner authority from the
        // service and makes the reviewed DACL the complete, explicit statement of what the service
        // may do; the accepted production policy requires it.
        //
        // It does NOT take away what the service's EXPLICIT `FullControl` ACE above grants:
        // `WRITE_DAC`, `WRITE_OWNER`, `DELETE` and `FILE_DELETE_CHILD`. Under this policy the
        // service can still re-secure these directories and delete or replace what is beneath them
        // through that grant. The protection this ownership supports is against ORDINARY
        // NON-PRIVILEGED LOCAL ACCOUNTS — not against ProjectOSHost itself, Administrators, SYSTEM,
        // kernel compromise or offline disk modification.
        //
        // This ONE expression governs every ProjectOS-managed ancestor of the record (`ProjectOS`,
        // `host`, `installation`). The DACL is untouched: `allowed` still carries exactly the rights
        // it always did.
        AclCompositionOutcome::Composed(AclPolicy::strict(AclPrincipal::LocalSystem, allowed))
    }

    /// Compose the policy for the CANONICAL IDENTITY RECORD FILE.
    ///
    /// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A (post-freeze installer correction).
    ///
    /// One thing differs from the directory policy, and only this one: the service principal gets
    /// [`RightsClass::Read`], NOT full control. The service only ever reads its own identity record,
    /// so the record's own DACL grants it no right to write, append, delete, re-DAC or take ownership
    /// of the thing that proves who it is.
    ///
    /// The expected owner is `NT AUTHORITY\SYSTEM` — the same as the directory policy's — and NOT the
    /// installing account. An owner holds implicit `WRITE_DAC`, so a service owner would hand back
    /// exactly the authority the read-only grant withholds, and an installing-account owner would
    /// keep that same implicit authority with a user. An earlier version of this policy preserved the
    /// installing account as owner; the executable policy below does not.
    ///
    /// Everything else is the same closed `AclPolicy::strict`: protected DACL, no inherited ACEs, no
    /// unknown principals, no deny ACEs, no broad principal with any access.
    #[must_use]
    pub fn compose_record_file_with_resolved_principal(
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
        if service.strategy() != strategy {
            return AclCompositionOutcome::ServiceIdentityRequired;
        }
        let mut allowed = vec![AllowedPrincipal {
            principal: service.principal().clone(),
            rights: RightsClass::Read,
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
        // NTFS OWNERSHIP IS SYSTEM. The original policy preserved the INSTALLING ACCOUNT as owner
        // to keep the service from owning the record, since an owner holds implicit `WRITE_DAC`.
        // That kept the same implicit `WRITE_DAC` with a USER account. SYSTEM ownership removes it
        // from every user AND from the service, which is what F1 established for the binary.
        AclCompositionOutcome::Composed(AclPolicy::strict(AclPrincipal::LocalSystem, allowed))
    }

    /// Compose the custody policy for the HOST'S MUTABLE DURABLE STORES — RUN-TO-COMPLETION HOST
    /// ATTESTATION §10I.
    ///
    /// ONE policy for every object in both stores: the delegation-lifecycle store and the
    /// request-replay store run the SAME durable engine and perform the SAME operations on the same
    /// object kinds, so there is nothing a second composition could legitimately say differently.
    ///
    /// ## Why this differs from the state-root policy, bit by bit
    ///
    /// The state root and its two ancestors are protected INFRASTRUCTURE the service reads through;
    /// the stores are MUTABLE HOST STATE the service must create, write, replace and delete. So:
    ///
    /// * THE OWNER IS THE SERVICE, not SYSTEM. The stores come into existence at first service start,
    ///   created BY the service, WITH their descriptor. A virtual service account may name itself as
    ///   owner and may not name SYSTEM without `SeRestorePrivilege` — a privilege it does not hold and
    ///   must not be given merely so a descriptor looks like its parent's. Creating as the service is
    ///   what removes the ambient step entirely: nothing is created under a default descriptor and
    ///   fixed afterwards, and nothing needs privilege.
    /// * OWNER RIGHTS IS NAMED, with read-only attributes. Ownership would otherwise hand the service
    ///   implicit `WRITE_DAC` over its own state — the exact authority the state-root policy moved
    ///   to SYSTEM to remove. An OWNER RIGHTS ACE replaces the owner's implicit rights with what it
    ///   grants, so the DACL is again the complete statement of what the owner may do.
    /// * THE SERVICE GETS `Modify`, NOT `FullControl`. Read, traverse, create files and directories,
    ///   write, and delete — what staging a file, flushing it, renaming it over a record, taking the
    ///   single-writer lock and removing a stale temp need. NOT `WRITE_DAC`, `WRITE_OWNER` or
    ///   `FILE_DELETE_CHILD`: nothing the engine does re-secures an object, takes ownership, or deletes
    ///   a child it holds no `DELETE` on.
    /// * ADMINISTRATORS AND SYSTEM KEEP `FullControl`, for the same honest reason as everywhere else:
    ///   servicing, backup and recovery need them, and excluding them would exclude nobody.
    ///
    /// Everything else is the closed `AclPolicy::strict`: protected DACL, no inherited ACE, no
    /// unknown principal, no deny ACE, no broad principal with any access.
    #[must_use]
    pub fn compose_host_store_with_resolved_principal(
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
        if service.strategy() != strategy {
            return AclCompositionOutcome::ServiceIdentityRequired;
        }
        let mut allowed = vec![
            AllowedPrincipal {
                principal: service.principal().clone(),
                rights: RightsClass::Modify,
            },
            AllowedPrincipal {
                principal: AclPrincipal::OwnerRights,
                rights: RightsClass::ReadAttributes,
            },
        ];
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

#[cfg(test)]
mod record_file_policy_tests {
    use super::*;
    /// A syntactically valid, non-broad SID standing in for a resolved per-service SID:
    /// `S-1-5-80-1-1-1-1` — the NT SERVICE authority, exactly the shape a virtual service account
    /// resolves to. It is not a broad principal and not a well-known alias.
    fn resolved_service_sid() -> OwnedSid {
        let mut bytes = vec![1u8, 5, 0, 0, 0, 0, 0, 5];
        for sub in [80u32, 1, 1, 1, 1] {
            bytes.extend_from_slice(&sub.to_le_bytes());
        }
        OwnedSid::from_bytes(&bytes).expect("a well-formed service SID")
    }

    fn composed() -> AclPolicy {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        let principal = ApprovedServicePrincipal::from_resolved_sid(
            ServiceIdentityStrategy::VirtualServiceAccount,
            resolved_service_sid(),
        )
        .expect("the approved strategy composes");
        match AclCompositionPlan::production()
            .compose_record_file_with_resolved_principal(&identity, &principal)
        {
            AclCompositionOutcome::Composed(p) => p,
            other => panic!("expected a composed record-file policy, got {other:?}"),
        }
    }

    #[test]
    fn the_record_file_policy_grants_the_service_read_only() {
        let policy = composed();
        let service = policy
            .allowed
            .iter()
            .find(|a| matches!(a.principal, AclPrincipal::ExplicitSid(_)))
            .expect("the service principal is present");
        assert_eq!(service.rights, RightsClass::Read);
        assert_ne!(service.rights, RightsClass::FullControl);
        assert_ne!(service.rights, RightsClass::Modify);
    }

    #[test]
    fn the_service_can_never_receive_write_delete_or_acl_changing_rights() {
        let policy = composed();
        let service = policy
            .allowed
            .iter()
            .find(|a| matches!(a.principal, AclPrincipal::ExplicitSid(_)))
            .expect("the service principal is present");
        let mask = service.rights.mask();
        // Every right the ACL contract forbids the service identity, checked bit by bit.
        for (name, bit) in [
            ("FILE_WRITE_DATA", 0x0000_0002u32),
            ("FILE_APPEND_DATA", 0x0000_0004),
            ("FILE_WRITE_EA", 0x0000_0010),
            ("FILE_WRITE_ATTRIBUTES", 0x0000_0100),
            ("FILE_DELETE_CHILD", 0x0000_0040),
            ("DELETE", 0x0001_0000),
            ("WRITE_DAC", 0x0004_0000),
            ("WRITE_OWNER", 0x0008_0000),
        ] {
            assert_eq!(mask & bit, 0, "the service must not hold {name}");
        }
        assert_ne!(
            mask & 0x0000_0001,
            0,
            "the service must be able to read data"
        );
    }

    #[test]
    fn system_and_administrators_keep_full_control() {
        let policy = composed();
        for principal in [
            AclPrincipal::LocalSystem,
            AclPrincipal::BuiltinAdministrators,
        ] {
            let entry = policy
                .allowed
                .iter()
                .find(|a| a.principal == principal)
                .unwrap_or_else(|| panic!("{principal:?} is present"));
            assert_eq!(entry.rights, RightsClass::FullControl);
        }
    }

    #[test]
    fn no_broad_principal_is_admitted_and_the_dacl_is_protected() {
        let policy = composed();
        assert!(!policy.grants_broad_write());
        assert!(policy.require_protected_dacl);
        assert!(!policy.allow_inherited_aces);
        assert!(!policy.allow_unknown_principals);
        assert!(!policy.allow_deny_aces);
        assert!(!policy.allow_broad_principals_any_access);
        assert!(!policy.allow_broad_principals_write);
        // Exactly three principals: the service, Administrators and SYSTEM. Nothing else.
        assert_eq!(policy.allowed.len(), 3);
    }

    #[test]
    fn system_owns_the_record_so_no_user_or_service_holds_implicit_write_dac() {
        // An owner holds implicit WRITE_DAC. The original policy kept the INSTALLING ACCOUNT as owner
        // so the service could not own the record — but that merely moved the same implicit authority
        // to a user. SYSTEM ownership removes it from BOTH, which is what F1 established for the
        // binary and its parents.
        let policy = composed();
        assert_eq!(policy.expected_owner, AclPrincipal::LocalSystem);
        assert_ne!(policy.expected_owner, AclPrincipal::CurrentInteractiveUser);
        assert!(!matches!(
            policy.expected_owner,
            AclPrincipal::ExplicitSid(_)
        ));
    }

    fn host_store() -> AclPolicy {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        let principal = ApprovedServicePrincipal::from_resolved_sid(
            ServiceIdentityStrategy::VirtualServiceAccount,
            resolved_service_sid(),
        )
        .expect("the approved strategy composes");
        match AclCompositionPlan::production()
            .compose_host_store_with_resolved_principal(&identity, &principal)
        {
            AclCompositionOutcome::Composed(p) => p,
            other => panic!("expected a composed host-store policy, got {other:?}"),
        }
    }

    #[test]
    fn the_host_store_policy_is_service_owned_modify_only_and_owner_rights_neutralised() {
        let policy = host_store();
        assert_eq!(
            policy.expected_owner,
            AclPrincipal::ExplicitSid(resolved_service_sid()),
            "the stores are created BY the service, which may only name itself as owner"
        );
        let rights = |p: &AclPrincipal| {
            policy
                .allowed
                .iter()
                .find(|a| &a.principal == p)
                .unwrap_or_else(|| panic!("{p:?} is present"))
                .rights
        };
        let service = AclPrincipal::ExplicitSid(resolved_service_sid());
        assert_eq!(rights(&service), RightsClass::Modify);
        // THE OWNER'S IMPLICIT WRITE_DAC IS REPLACED, and by a read-only grant.
        assert_eq!(
            rights(&AclPrincipal::OwnerRights),
            RightsClass::ReadAttributes
        );
        assert_eq!(
            rights(&AclPrincipal::BuiltinAdministrators),
            RightsClass::FullControl
        );
        assert_eq!(rights(&AclPrincipal::LocalSystem), RightsClass::FullControl);
        assert_eq!(policy.allowed.len(), 4, "exactly four principals");
        // Bit by bit: the service may write and delete, never re-secure, re-own or delete-child.
        let mask = rights(&service).mask();
        for (name, bit) in [
            ("WRITE_DAC", 0x0004_0000u32),
            ("WRITE_OWNER", 0x0008_0000),
            ("FILE_DELETE_CHILD", 0x0000_0040),
        ] {
            assert_eq!(mask & bit, 0, "the service must not hold {name}");
        }
        for (name, bit) in [
            ("FILE_WRITE_DATA / ADD_FILE", 0x0000_0002u32),
            ("FILE_APPEND_DATA / ADD_SUBDIRECTORY", 0x0000_0004),
            ("DELETE", 0x0001_0000),
            ("READ_CONTROL", 0x0002_0000),
        ] {
            assert_ne!(mask & bit, 0, "the service needs {name}");
        }
        assert_eq!(
            RightsClass::ReadAttributes.mask() & 0x000C_0000,
            0,
            "OWNER RIGHTS must not hand WRITE_DAC or WRITE_OWNER back"
        );
    }

    #[test]
    fn the_host_store_policy_is_closed_in_every_dimension() {
        let policy = host_store();
        assert!(!policy.grants_broad_write());
        assert!(policy.require_protected_dacl);
        assert!(!policy.allow_inherited_aces);
        assert!(!policy.allow_unknown_principals);
        assert!(!policy.allow_deny_aces);
        assert!(!policy.allow_broad_principals_any_access);
        assert!(!policy.allow_broad_principals_write);
        assert!(!policy
            .allowed
            .iter()
            .any(|a| a.principal == AclPrincipal::CurrentInteractiveUser));
    }

    #[test]
    fn an_undecided_or_mismatched_identity_blocks_the_host_store_policy() {
        let principal = ApprovedServicePrincipal::from_resolved_sid(
            ServiceIdentityStrategy::VirtualServiceAccount,
            resolved_service_sid(),
        )
        .expect("the approved strategy composes");
        assert_eq!(
            AclCompositionPlan::production().compose_host_store_with_resolved_principal(
                &ServiceIdentityPlan::analysed(),
                &principal,
            ),
            AclCompositionOutcome::OwnerDecisionRequired
        );
        assert_eq!(
            AclCompositionPlan::production().compose_host_store_with_resolved_principal(
                &ServiceIdentityPlan::analysed()
                    .with_owner_decision(ServiceIdentityStrategy::LocalService),
                &principal,
            ),
            AclCompositionOutcome::ServiceIdentityRequired
        );
    }

    #[test]
    fn an_undecided_identity_blocks_the_record_file_policy_too() {
        let principal = ApprovedServicePrincipal::from_resolved_sid(
            ServiceIdentityStrategy::VirtualServiceAccount,
            resolved_service_sid(),
        )
        .expect("the approved strategy composes");
        let outcome = AclCompositionPlan::production().compose_record_file_with_resolved_principal(
            &ServiceIdentityPlan::analysed(),
            &principal,
        );
        assert_eq!(outcome, AclCompositionOutcome::OwnerDecisionRequired);
    }
}
