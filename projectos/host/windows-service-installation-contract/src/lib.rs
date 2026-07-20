//! PURE, EFFECT-FREE Windows service INSTALLATION CONTRACT for the future ProjectOS Host Service.
//!
//! This crate FREEZES what a later, separately-approved installation operation would be REQUIRED to
//! do. It is data and validation ONLY. It changes nothing on the machine:
//!
//! * it does NOT create, configure, start, stop or remove any service;
//! * it opens no Service Control Manager and requests no access mask;
//! * it resolves no service SID, writes no registry, creates no ProgramData, and changes no ACL;
//! * it launches no process and no external helper of any kind.
//!
//! It also claims nothing exists: no service, account, SID, ACL, path or effect is asserted to be
//! present. Every not-yet-known value is an explicit `Unresolved` / `OwnerDecisionRequired` state,
//! never a fabricated default that could be mistaken for an approval.
//!
//! # What it consumes (read-only)
//!
//! * the sealed OWNER-approved internal SCM service name `ProjectOSHost`
//!   ([`projectos_host_windows_capability_preflight::projectos_v3_service_name_decision`]);
//! * the OWNER-approved identity strategy `VirtualServiceAccount`
//!   ([`projectos_host_windows_activation_plan::HostActivationPlan::projectos_v3_frozen`]).
//!
//! Neither is duplicated or mutated, and no second authority is created here.
//!
//! # The sealed installation authority
//!
//! Installation is UNCONDITIONALLY not authorised in this phase. The effect-authority type has a
//! single state and no constructor that yields anything else, so no caller — recommendation,
//! availability value, report, prompt, environment variable or session state — can manufacture an
//! installation approval here. A future approval belongs to a later governed phase.
//!
//! ```
//! use projectos_host_windows_service_installation_contract as contract;
//!
//! let frozen = contract::projectos_v3_service_installation_contract()
//!     .expect("owner-approved name and strategy are in the accepted crates");
//!
//! // The exact owner-approved name, and an unconditionally-unauthorised effect.
//! assert_eq!(frozen.creation_request().service_name(), "ProjectOSHost");
//! assert!(!frozen.effect_authority().is_authorised());
//!
//! // Structural validity is NOT execution readiness: the shape is valid for review, yet the effect
//! // and execution are not ready.
//! assert!(frozen.validate_structure_for_review().is_ok());
//! let r = frozen.readiness();
//! assert!(!r.is_execution_ready());
//! assert!(!r.is_effect_authorised());
//! ```
//!
//! The following MUST NOT compile — the effect authority cannot be constructed as authorised, because
//! its only variant is the unauthorised one:
//!
//! ```compile_fail
//! use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;
//! // There is no `Authorised` variant to name.
//! let _ = InstallationEffectAuthority::Authorised;
//! ```
//!
//! And the contract's private internals cannot be reached to forge a different name or an authorised
//! effect:
//!
//! ```compile_fail
//! use projectos_host_windows_service_installation_contract::ServiceInstallationContract;
//! // No public constructor and no public fields — the sole route is the authority function.
//! let _ = ServiceInstallationContract { };
//! ```
//!
//! A physical effect outcome and a required governance action are DIFFERENT types, so one can never
//! be supplied where the other is required — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_service_installation_contract::{EffectOutcome, RequiredAction};
//! // A RequiredAction is not an EffectOutcome.
//! let _: EffectOutcome = RequiredAction::ReconciliationRequired;
//! ```
//!
//! Effect authority is the sealed [`InstallationEffectAuthority`], never a Boolean. A `bool` cannot
//! stand in for it, so a caller can never pass `true` as authority — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_service_installation_contract::InstallationEffectAuthority;
//! // A bool is not an InstallationEffectAuthority.
//! let _: InstallationEffectAuthority = true;
//! ```

#![forbid(unsafe_code)]

pub mod contract;
pub mod error;
pub mod model;
pub mod reconciliation;
pub mod rights;

use projectos_host_windows_activation_plan::{
    HostActivationPlan, IdentityDecisionStatus, ServiceIdentityStrategy,
};
use projectos_host_windows_capability_preflight::projectos_v3_service_name_decision;

pub use contract::{
    AuthorisationStatus, ContractReadiness, EffectOutcome, EffectOutcomeSignal, GatedOperation,
    InstallationContractStatus, InstallationEffectAuthority, MetadataReadiness,
    PostEffectVerification, PreEffectCheck, RequiredAction, StructuralValidity,
};
pub use error::{ContractViolation, ServiceInstallationContractError};
pub use model::{
    CommandLineRepresentation, CredentialModel, ErrorControlModel, FinalAclState,
    FutureCreationRequest, MetadataDecision, NonCrashFailureHandling, PackagedPathState,
    RecoveryAction, RecoveryRecommendation, ServiceSidState, ServiceTypeModel,
    ShellExecutionRepresentation, StartupRecommendation, StartupType, TagIdBehaviour,
    APPROVED_SERVICE_NAME,
};
pub use reconciliation::{
    ForbiddenAutomaticAction, ReconciliationDecision, ReconciliationSituation,
};

/// The frozen installation contract: the future creation request, the ordered pre-effect sequence,
/// the sealed (unauthorised) effect authority, the mandatory post-effect verifications, the service
/// SID and final-ACL states, and the recommendation-only metadata.
///
/// Immutable after construction, deterministic, and equality-comparable. It performs no effect and
/// exposes no method that could. It is constructed ONLY by
/// [`projectos_v3_service_installation_contract`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceInstallationContract {
    creation_request: FutureCreationRequest,
    startup: StartupRecommendation,
    recovery: RecoveryRecommendation,
    service_sid: ServiceSidState,
    final_acl: FinalAclState,
    effect_authority: InstallationEffectAuthority,
    lifecycle: InstallationContractStatus,
}

impl ServiceInstallationContract {
    /// The future creation request (fixed name, no password, no command line, no fallback).
    #[must_use]
    pub fn creation_request(&self) -> &FutureCreationRequest {
        &self.creation_request
    }

    /// The startup recommendation (advisory).
    #[must_use]
    pub fn startup(&self) -> StartupRecommendation {
        self.startup
    }

    /// The recovery recommendation (advisory, bounded).
    #[must_use]
    pub fn recovery(&self) -> RecoveryRecommendation {
        self.recovery
    }

    /// The authoritative service-SID state (unresolved until an approved installation).
    #[must_use]
    pub fn service_sid(&self) -> ServiceSidState {
        self.service_sid
    }

    /// The final-ACL state (deferred until the service SID is proven).
    #[must_use]
    pub fn final_acl(&self) -> FinalAclState {
        self.final_acl
    }

    /// The sealed installation-effect authority. Always [`InstallationEffectAuthority::NotAuthorised`].
    #[must_use]
    pub fn effect_authority(&self) -> InstallationEffectAuthority {
        self.effect_authority
    }

    /// The contract lifecycle status. At most [`InstallationContractStatus::ReadyForReview`].
    #[must_use]
    pub fn lifecycle(&self) -> InstallationContractStatus {
        self.lifecycle
    }

    /// The full readiness picture across all five orthogonal dimensions.
    ///
    /// Structural validity is deliberately kept separate from execution readiness: a well-formed
    /// contract reports `StructuralValidity::ValidForReview` yet `execution_ready == false`. In this
    /// phase `pre_effect_ready`, `effect_authority_ready` and `execution_ready` are invariantly
    /// `false`, and metadata is `Incomplete` while the display name / description remain owner
    /// decisions.
    #[must_use]
    pub fn readiness(&self) -> ContractReadiness {
        let structural = match self.validate_structure_for_review() {
            Ok(v) => v,
            Err(_) => StructuralValidity::Invalid,
        };
        let metadata_resolved = self.creation_request.metadata_fully_resolved();
        // Pure pre-effect prerequisites: resolved metadata AND a resolved packaged path. Neither can
        // be true in this phase.
        let path_resolved = !matches!(
            self.creation_request.binary_path(),
            PackagedPathState::UnresolvedUntilApprovedInstallation
        );
        // Effect authority is the sealed type, never a Boolean the caller controls. It can never be
        // ready in this phase: the authority has only the `NotAuthorised` state.
        //
        // Single source of truth for how the dimensions combine — proves their orthogonality.
        ContractReadiness::evaluate(
            self.lifecycle,
            structural,
            metadata_resolved,
            path_resolved,
            &self.effect_authority,
        )
    }

    /// The ordered pre-effect checks a future installation must pass before any effect.
    #[must_use]
    pub fn pre_effect_sequence(&self) -> &'static [PreEffectCheck] {
        PreEffectCheck::sequence()
    }

    /// The mandatory authoritative post-effect verifications.
    #[must_use]
    pub fn post_effect_verifications(&self) -> &'static [PostEffectVerification] {
        PostEffectVerification::all()
    }

    /// Every gated operation, all `NotAuthorised` in this phase.
    #[must_use]
    pub fn gated_operations(&self) -> &'static [GatedOperation] {
        GatedOperation::all()
    }

    /// Validate the contract's STRUCTURE for review. This proves the SHAPE is well-formed; it does
    /// NOT mean an installation may proceed. A successful result is
    /// [`StructuralValidity::ValidForReview`], never an execution-ready or installation-authorised
    /// signal. Use [`Self::readiness`] for the orthogonal readiness dimensions, all of which report
    /// the effect and execution as not ready in this phase.
    ///
    /// # Errors
    /// [`ContractViolation`] naming the FIRST structural invariant that does not hold. The frozen
    /// contract this crate produces always passes; the check exists so a future edit that breaks an
    /// invariant fails loudly rather than silently.
    pub fn validate_structure_for_review(&self) -> Result<StructuralValidity, ContractViolation> {
        // The one owner-approved name, never anything else.
        if self.creation_request.service_name() != APPROVED_SERVICE_NAME {
            return Err(ContractViolation::WrongServiceName);
        }
        // No credential model other than the no-password virtual account.
        if self.creation_request.account() != CredentialModel::VirtualAccountNoPassword {
            return Err(ContractViolation::PlaintextCredentialPresent);
        }
        // No arbitrary command line or shell route may be representable.
        if self.creation_request.command_line() != CommandLineRepresentation::NotRepresentable
            || self.creation_request.shell_execution()
                != ShellExecutionRepresentation::NotRepresentable
        {
            return Err(ContractViolation::ArbitraryLaunchRoutePresent);
        }
        // No broad access mask anywhere.
        if rights::is_broad(self.creation_request.desired_open_mask()) {
            return Err(ContractViolation::BroadAccessMask);
        }
        for op in rights::ScmOperation::all() {
            if rights::is_broad(op.required_mask()) {
                return Err(ContractViolation::BroadAccessMask);
            }
        }
        // Unresolved metadata must never masquerade as approved.
        if self.creation_request.display_name().is_owner_resolved()
            || self.creation_request.description().is_owner_resolved()
        {
            return Err(ContractViolation::UnresolvedTreatedAsApproved);
        }
        // The effect must remain unauthorised, and no operation may be authorised.
        if self.effect_authority.is_authorised() {
            return Err(ContractViolation::EffectAuthorised);
        }
        // Reconciliation must never perform an automatic destructive/corrective effect.
        for a in ForbiddenAutomaticAction::all() {
            if a.is_permitted() {
                return Err(ContractViolation::UnsafeAutomaticRecovery);
            }
        }
        // No physical outcome may report success without an authoritative re-read.
        if EffectOutcome::classify(EffectOutcomeSignal::SuccessReturnedNoReread).success_claimable()
        {
            return Err(ContractViolation::SuccessWithoutReread);
        }
        Ok(StructuralValidity::ValidForReview)
    }
}

/// **The one authority that produces the frozen installation contract.**
///
/// It CONSUMES, read-only, the two accepted owner decisions and refuses to build a contract unless
/// both hold:
///
/// * the internal SCM service name is OWNER-approved and is exactly `ProjectOSHost`;
/// * the identity strategy is OWNER-approved and is exactly `VirtualServiceAccount`.
///
/// It binds NO new decision, performs NO effect, and returns a contract whose installation authority
/// is unconditionally [`InstallationEffectAuthority::NotAuthorised`].
///
/// # Errors
/// * [`ServiceInstallationContractError::ServiceNameNotOwnerApproved`] if the consumed service-name
///   decision is not the owner-approved `ProjectOSHost`.
/// * [`ServiceInstallationContractError::IdentityStrategyNotOwnerApproved`] if the consumed identity
///   decision is not the owner-approved `VirtualServiceAccount`.
pub fn projectos_v3_service_installation_contract(
) -> Result<ServiceInstallationContract, ServiceInstallationContractError> {
    // 1. Consume the sealed owner-approved service-name decision, read-only.
    let name_decision = projectos_v3_service_name_decision()
        .map_err(|_| ServiceInstallationContractError::ServiceNameNotOwnerApproved)?;
    if !name_decision.is_owner_approved() || name_decision.name() != APPROVED_SERVICE_NAME {
        return Err(ServiceInstallationContractError::ServiceNameNotOwnerApproved);
    }

    // 2. Consume the owner-approved identity strategy, read-only.
    let plan = HostActivationPlan::projectos_v3_frozen()
        .map_err(|_| ServiceInstallationContractError::IdentityStrategyNotOwnerApproved)?;
    if plan.identity().decision()
        != IdentityDecisionStatus::OwnerApproved(ServiceIdentityStrategy::VirtualServiceAccount)
    {
        return Err(ServiceInstallationContractError::IdentityStrategyNotOwnerApproved);
    }

    // 3. Compose the frozen contract. Every value is a future requirement, none an effect.
    let contract = ServiceInstallationContract {
        creation_request: FutureCreationRequest::projectos_host(),
        startup: StartupRecommendation::projectos_host(),
        recovery: RecoveryRecommendation::projectos_host(),
        service_sid: ServiceSidState::UnresolvedUntilApprovedInstallation,
        final_acl: FinalAclState::DeferredUntilServiceSidProven,
        effect_authority: InstallationEffectAuthority::current(),
        lifecycle: InstallationContractStatus::ReadyForReview,
    };
    Ok(contract)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_contract_binds_the_owner_approved_name_and_no_effect() {
        let c = projectos_v3_service_installation_contract().expect("accepted decisions hold");
        assert_eq!(c.creation_request().service_name(), APPROVED_SERVICE_NAME);
        assert_eq!(
            c.effect_authority(),
            InstallationEffectAuthority::NotAuthorised
        );
        assert!(!c.effect_authority().is_authorised());
    }

    #[test]
    fn structural_validation_passes_but_is_not_execution_readiness() {
        let c = projectos_v3_service_installation_contract().unwrap();
        assert_eq!(
            c.validate_structure_for_review().unwrap(),
            StructuralValidity::ValidForReview
        );
        let r = c.readiness();
        assert!(!r.is_execution_ready());
        assert!(!r.is_effect_authorised());
    }

    #[test]
    fn the_lifecycle_is_ready_for_review_only() {
        let c = projectos_v3_service_installation_contract().unwrap();
        assert_eq!(c.lifecycle(), InstallationContractStatus::ReadyForReview);
    }

    #[test]
    fn readiness_dimensions_are_all_blocked_in_this_phase() {
        let r = projectos_v3_service_installation_contract()
            .unwrap()
            .readiness();
        assert_eq!(r.structural, StructuralValidity::ValidForReview);
        assert_eq!(r.metadata, MetadataReadiness::Incomplete);
        assert!(!r.pre_effect_ready);
        assert!(!r.effect_authority_ready);
        assert!(!r.execution_ready);
    }

    #[test]
    fn the_service_sid_and_final_acl_stay_unresolved() {
        let c = projectos_v3_service_installation_contract().unwrap();
        assert_eq!(
            c.service_sid(),
            ServiceSidState::UnresolvedUntilApprovedInstallation
        );
        assert_eq!(c.final_acl(), FinalAclState::DeferredUntilServiceSidProven);
    }

    #[test]
    fn the_pre_and_post_sequences_are_exposed_and_complete() {
        let c = projectos_v3_service_installation_contract().unwrap();
        assert_eq!(c.pre_effect_sequence().len(), 22);
        assert_eq!(c.post_effect_verifications().len(), 13);
        assert_eq!(c.gated_operations().len(), 5);
    }

    #[test]
    fn the_contract_is_deterministic() {
        let a = projectos_v3_service_installation_contract().unwrap();
        let b = projectos_v3_service_installation_contract().unwrap();
        assert_eq!(a, b);
    }
}
