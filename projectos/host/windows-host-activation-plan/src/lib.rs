//! # ProjectOS Host Windows Activation Plan (pure planning contract)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-D.
//!
//! One explicit, deterministic, side-effect-free plan that binds the intended production root, the
//! Windows service-identity model, the ACL composition, the custody prerequisites, the activation
//! sequence, the governance gates and the reconciliation rules.
//!
//! ## The accurate claim
//!
//! ProjectOS can **produce and validate one explicit Windows host-activation plan**.
//!
//! ## What this crate does NOT claim
//!
//! It does NOT claim the service is installed, the service identity exists, a service SID has been
//! verified, the ProgramData root exists, production ACLs have been applied, service-only access is
//! active, service-only key custody is active, authenticated IPC is active, administrator resistance
//! is proven, rollback is guaranteed, or the production host is ready. **None of those is true.**
//!
//! ## What it structurally cannot do
//!
//! `unsafe` is `forbid`den and there is no platform dependency: the crate has no way to create a
//! directory, resolve a known folder, change an ACL, open the Service Control Manager, install,
//! configure, start or stop a service, write the registry, generate or protect a key, read a
//! credential, launch a process, or create IPC. It also holds no password, token, raw SID, ACL byte
//! or descriptor byte — no type here has a field for one.
//!
//! No serialisation is implemented. Nothing here derives `Serialize`, so a plan cannot be written to
//! disk or a wire in a form that might later leak machine identity.
//!
//! ## Governance
//!
//! Every activation step starts [`ApprovalStatus::NotAuthorised`]. Approval is never inherited from
//! the existence of a plan, a passing test, a Claude report, a gatekeeper implementation review, an
//! unrelated previous phase, or the current session. Only an explicit owner decision advances a gate.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! A plan cannot be executed — there is no runner:
//! ```compile_fail
//! fn f(p: &projectos_host_windows_activation_plan::HostActivationPlan) {
//!     p.execute() // no such method
//! }
//! ```
//! A service SID cannot be supplied to the plan:
//! ```compile_fail
//! use projectos_host_windows_activation_plan::ServiceIdentityPlan;
//! fn f() -> ServiceIdentityPlan {
//!     ServiceIdentityPlan::analysed().with_service_sid("S-1-5-80-0") // no such method
//! }
//! ```
//! A credential cannot be supplied to the plan:
//! ```compile_fail
//! use projectos_host_windows_activation_plan::ServiceIdentityPlan;
//! fn f() -> ServiceIdentityPlan {
//!     ServiceIdentityPlan::analysed().with_password("hunter2") // no such method
//! }
//! ```
//! The production root cannot be resolved to a real path:
//! ```compile_fail
//! fn f(p: &projectos_host_windows_activation_plan::ProductionRootPlan) -> std::path::PathBuf {
//!     p.resolve() // no such method
//! }
//! ```
//! A RECOMMENDATION genuinely blocks composition — it is not an approval:
//! ```
//! use projectos_host_windows_activation_plan::{
//!     AclCompositionOutcome, AclCompositionPlan, IdentityDecisionStatus, ServiceIdentityPlan,
//!     ServiceIdentityStrategy,
//! };
//! let plan = ServiceIdentityPlan::analysed();
//! assert_eq!(
//!     plan.decision(),
//!     IdentityDecisionStatus::Recommended(ServiceIdentityStrategy::VirtualServiceAccount)
//! );
//! assert!(!plan.is_owner_approved());
//! assert_eq!(
//!     AclCompositionPlan::production().compose(&plan),
//!     AclCompositionOutcome::OwnerDecisionRequired
//! );
//! ```
//! And the OWNER-APPROVED frozen plan still resolves nothing and authorises nothing:
//! ```
//! use projectos_host_windows_activation_plan::{
//!     AclCompositionOutcome, ActivationStep, ApprovalStatus, HostActivationPlan,
//!     IdentityDecisionStatus, ServiceIdentityStrategy, ServiceNameStatus, ServiceSidStatus,
//! };
//! let plan = HostActivationPlan::projectos_v3_frozen().unwrap();
//! assert_eq!(
//!     plan.identity().decision(),
//!     IdentityDecisionStatus::OwnerApproved(ServiceIdentityStrategy::VirtualServiceAccount)
//! );
//! // Strategy approved — identity, SID, service name and every gate still unresolved/unapproved.
//! assert_eq!(plan.identity().sid_status(), ServiceSidStatus::UnresolvedUntilActivation);
//! assert_eq!(plan.identity().service_name(), ServiceNameStatus::OwnerDecisionRequired);
//! assert_eq!(plan.compose_acl(), AclCompositionOutcome::ServiceIdentityRequired);
//! assert_eq!(
//!     plan.sequence().status(ActivationStep::InstallOrVerifyServiceIdentity),
//!     ApprovalStatus::NotAuthorised
//! );
//! assert!(!plan.is_execution_ready());
//! ```

#![forbid(unsafe_code)]

pub mod acl_plan;
pub mod activation;
pub mod error;
pub mod root_plan;
pub mod service_identity;

pub use acl_plan::{
    AclCompositionOutcome, AclCompositionPlan, ApprovedServicePrincipal, InteractiveOwnerAccess,
};
pub use activation::{
    ActivationDecision, ActivationGate, ActivationSequence, ActivationStep, ApprovalStatus,
    DuplicateInstancePolicy, EffectClassification, ExceptionalOperation, OutcomePolicy,
    PossibleEffect, RequiredAuthority, RestartPolicy, SafeModeBehaviour, ServiceRecoveryPlan,
    StartupType, UncertainScenario,
};
pub use error::{ActivationPlanError, ActivationViolation};
pub use root_plan::{
    classify_forbidden, ForbiddenRootKind, KnownFolderAnchor, ProductionRootPlan, RootSegment,
    RootSubtree,
};
pub use service_identity::{
    IdentityDecisionStatus, NetworkIdentity, PasswordManagement, PrivilegeLevel, RejectionReason,
    ServiceIdentityPlan, ServiceIdentityProfile, ServiceIdentityStrategy, ServiceNameStatus,
    ServiceSidStatus, ServiceSidSupport,
};

/// The version of this plan contract. An activation may only proceed against the exact version the
/// owner approved, so a silently-edited plan can never be executed under an old approval.
pub const PLAN_CONTRACT_VERSION: &str = "3K-D.3";

/// The complete host-activation plan: root, identity, ACL composition, sequence and recovery.
///
/// Immutable after construction, deterministic, and equality-comparable. It performs no effect and
/// exposes no method that could.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostActivationPlan {
    version: &'static str,
    root: ProductionRootPlan,
    identity: ServiceIdentityPlan,
    acl: AclCompositionPlan,
    sequence: ActivationSequence,
    recovery: ServiceRecoveryPlan,
}

impl HostActivationPlan {
    /// The canonical plan: canonical root, analysed-but-undecided identity, production ACL intent,
    /// a fully unauthorised sequence, and the intended recovery policy.
    ///
    /// # Errors
    /// [`ActivationPlanError`] if the canonical root or recovery policy is invalid, which the unit
    /// tests pin.
    pub fn canonical() -> Result<Self, ActivationPlanError> {
        let recovery = ServiceRecoveryPlan::intended();
        recovery.validate()?;
        Ok(Self {
            version: PLAN_CONTRACT_VERSION,
            root: ProductionRootPlan::canonical()?,
            identity: ServiceIdentityPlan::analysed(),
            acl: AclCompositionPlan::production(),
            sequence: ActivationSequence::new(),
            recovery,
        })
    }

    /// **The one authoritative ProjectOS V3 frozen plan.**
    ///
    /// This is the SINGLE entry point that carries Murad's decision. There is deliberately no
    /// second frozen-plan constructor, no owner-approved constant used as a parallel authority, and
    /// no convenience shortcut that reaches `VirtualServiceAccount` another way — the strategy is
    /// bound here and nowhere else, through the same public [`ServiceIdentityPlan::with_owner_decision`]
    /// API any caller would use.
    ///
    /// **Provenance.** Murad supplied the decision `APPROVE VIRTUAL SERVICE ACCOUNT` on 2026-07-20.
    /// It is transcribed here, not chosen here. It happens to match the advisory recommendation, but
    /// the recommendation is not what makes it approved — [`Self::canonical`] carries that same
    /// recommendation and remains unapproved.
    ///
    /// **This binds the STRATEGY and nothing else.** The frozen plan still:
    /// * leaves the service name an unmade owner decision;
    /// * leaves the Windows service identity unresolved;
    /// * leaves the authoritative service SID unresolved;
    /// * returns [`AclCompositionOutcome::ServiceIdentityRequired`] from [`Self::compose_acl`];
    /// * leaves every activation step and every exceptional operation `NotAuthorised`;
    /// * reports `is_execution_ready() == false`.
    ///
    /// # Errors
    /// [`ActivationPlanError`] if the canonical plan is invalid, which the unit tests pin.
    pub fn projectos_v3_frozen() -> Result<Self, ActivationPlanError> {
        Ok(Self::canonical()?
            .with_owner_identity_decision(ServiceIdentityStrategy::VirtualServiceAccount))
    }

    /// The contract version this plan was built against.
    #[must_use]
    pub fn version(&self) -> &'static str {
        self.version
    }

    /// The production-root plan.
    #[must_use]
    pub fn root(&self) -> &ProductionRootPlan {
        &self.root
    }

    /// The service-identity analysis.
    #[must_use]
    pub fn identity(&self) -> &ServiceIdentityPlan {
        &self.identity
    }

    /// The ACL composition intent.
    #[must_use]
    pub fn acl(&self) -> &AclCompositionPlan {
        &self.acl
    }

    /// The activation sequence and its gates.
    #[must_use]
    pub fn sequence(&self) -> &ActivationSequence {
        &self.sequence
    }

    /// The service recovery policy.
    #[must_use]
    pub fn recovery(&self) -> &ServiceRecoveryPlan {
        &self.recovery
    }

    /// Record the owner's service-identity decision, returning a new plan.
    #[must_use]
    pub fn with_owner_identity_decision(mut self, strategy: ServiceIdentityStrategy) -> Self {
        self.identity = self.identity.with_owner_decision(strategy);
        self
    }

    /// Record a gate status, returning a new plan.
    #[must_use]
    pub fn with_gate(mut self, step: ActivationStep, status: ApprovalStatus) -> Self {
        self.sequence = self.sequence.with_status(step, status);
        self
    }

    /// Attempt to compose the final ACL. Fails closed while the identity or its SID is unresolved.
    #[must_use]
    pub fn compose_acl(&self) -> AclCompositionOutcome {
        self.acl.compose(&self.identity)
    }

    /// The single next action the owner interface should present.
    #[must_use]
    pub fn next_action(&self) -> ActivationDecision {
        self.sequence.next_action()
    }

    /// Whether this plan is ready to be executed. It never is: execution belongs to a later,
    /// separately-approved phase, and this crate has no way to perform one.
    #[must_use]
    pub fn is_execution_ready(&self) -> bool {
        false
    }

    /// Every semantic non-conformance in this plan.
    #[must_use]
    pub fn violations(&self) -> Vec<ActivationViolation> {
        let mut found = self.sequence.violations();
        if self.identity.decided().is_err() {
            found.push(ActivationViolation::ServiceIdentityUndecided);
        }
        if matches!(
            self.compose_acl(),
            AclCompositionOutcome::ServiceIdentityRequired
        ) {
            found.push(ActivationViolation::AclDependsOnUnresolvedSid);
        }
        if self.recovery.validate().is_err() {
            found.push(ActivationViolation::RecoveryUnbounded);
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_canonical_plan_is_deterministic_and_comparable() {
        let a = HostActivationPlan::canonical().unwrap();
        let b = HostActivationPlan::canonical().unwrap();
        assert_eq!(a, b, "the plan must be deterministic");
        assert_eq!(a.version(), PLAN_CONTRACT_VERSION);
    }

    #[test]
    fn a_fresh_plan_is_never_execution_ready_and_awaits_the_owner() {
        let plan = HostActivationPlan::canonical().unwrap();
        assert!(!plan.is_execution_ready());
        assert_eq!(
            plan.next_action(),
            ActivationDecision::ReadyForExecution(ActivationStep::VerifyBaseline),
            "only the non-mutating baseline check may proceed unattended"
        );
        assert!(plan
            .violations()
            .contains(&ActivationViolation::ServiceIdentityUndecided));
    }

    #[test]
    fn an_owner_decision_alone_does_not_unblock_the_acl() {
        let plan = HostActivationPlan::canonical()
            .unwrap()
            .with_owner_identity_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        assert_eq!(
            plan.compose_acl(),
            AclCompositionOutcome::ServiceIdentityRequired
        );
        assert!(plan
            .violations()
            .contains(&ActivationViolation::AclDependsOnUnresolvedSid));
        assert!(!plan.is_execution_ready());
    }

    #[test]
    fn the_plan_never_becomes_execution_ready_even_when_fully_approved() {
        let mut plan = HostActivationPlan::canonical()
            .unwrap()
            .with_owner_identity_decision(ServiceIdentityStrategy::LocalSystem);
        for step in ActivationStep::all() {
            plan = plan.with_gate(*step, ApprovalStatus::ConfirmedComplete);
        }
        assert_eq!(plan.next_action(), ActivationDecision::Complete);
        // A complete SEQUENCE is still not an executed activation, and this crate can never execute.
        assert!(!plan.is_execution_ready());
    }

    #[test]
    fn plan_rendering_discloses_no_machine_or_secret_material() {
        let plan = HostActivationPlan::canonical()
            .unwrap()
            .with_owner_identity_decision(ServiceIdentityStrategy::OwnerApprovedAccount);
        let text = format!("{plan:?}");
        assert!(!text.contains("S-1-"), "no SID string");
        assert!(!text.contains(":\\"), "no resolved machine path");
        assert!(!text.contains("C:"), "no drive letter");
        assert!(
            !text.to_ascii_lowercase().contains("password:"),
            "no secret"
        );
        assert!(
            text.contains("%KNOWNFOLDER:ProgramData%"),
            "anchor is symbolic"
        );
        assert!(text.contains("UnresolvedUntilActivation"));
    }
}
