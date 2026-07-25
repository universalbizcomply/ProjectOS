//! The complete immutable verified-execution context, the service-private execution permit, and a
//! pure before-use comparison.
//!
//! Honest boundary: private fields, no public constructor, and no `Serialize`/`Deserialize` give
//! **API-level construction control inside this crate** — an ordinary supported external caller cannot
//! mint a permit or a context, and neither can be (de)serialized through a supported API. This is NOT
//! cryptographic non-forgeability and NOT protection against a malicious replacement binary; the real
//! boundary is the admin-protected service process (see crate docs). The core cannot prove the
//! external adapters collected these facts honestly, and it does NOT observe runtime changes — the
//! comparison below is the pure operation the future service calls AFTER independently re-deriving the
//! current context.

use crate::approval::VerifiedApproval;
use crate::facts::{
    CredentialScope, EmergencyStateRevision, EmergencyStopState, ExecutableIdentity,
    ExpiryBoundary, InstallationId, ReleaseId, RepositoryRef, RevocationRevision, SessionId,
    ValidatedFreshness, ValidatedPublisherPolicy,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

/// The authority-validity portion of the verified context (expiry + revocation revision).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorityValidity {
    /// Authority/permit expiry boundary.
    pub(crate) authority_expiry: ExpiryBoundary,
    /// Operation expiry boundary, where applicable.
    pub(crate) operation_expiry: Option<ExpiryBoundary>,
    /// Protected revocation revision at derivation time.
    pub(crate) revocation_revision: RevocationRevision,
}

impl AuthorityValidity {
    /// Authority expiry boundary.
    #[must_use]
    pub fn authority_expiry(&self) -> ExpiryBoundary {
        self.authority_expiry
    }
    /// Operation expiry boundary.
    #[must_use]
    pub fn operation_expiry(&self) -> Option<ExpiryBoundary> {
        self.operation_expiry
    }
    /// Revocation revision.
    #[must_use]
    pub fn revocation_revision(&self) -> RevocationRevision {
        self.revocation_revision
    }
}

/// Every authority-sensitive field a comparison can report as changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ContextField {
    /// Phase identity changed.
    Phase,
    /// Approved-plan binding (reference/version/definition-digest/project/environment/phase) changed.
    ApprovedPlan,
    /// Approved-plan status changed (e.g. became revoked/superseded/stale).
    ApprovedPlanStatus,
    /// Approved-plan status revision changed (a later status mutation).
    ApprovedPlanStatusRevision,
    /// Repository identity changed (root/common-dir/project).
    RepositoryIdentity,
    /// Repository baseline changed (commit/branch/cleanliness/divergence/submodule).
    RepositoryBaseline,
    /// Repository observation generation changed.
    RepositoryGeneration,
    /// Repository freshness classification changed.
    RepositoryFreshness,
    /// Owner-presence proof identity/verifier changed (a different proof).
    OwnerPresenceProof,
    /// Owner-presence proof generation changed.
    OwnerPresenceGeneration,
    /// Owner-presence proof validity boundary changed (expiry moved).
    OwnerPresenceValidUntil,
    /// Authenticated session changed.
    Session,
    /// Process binding changed.
    Process,
    /// Executable identity changed.
    Executable,
    /// Installation changed.
    Installation,
    /// Release changed.
    Release,
    /// Repository changed.
    Repository,
    /// Project changed.
    Project,
    /// Environment changed.
    Environment,
    /// Provider changed.
    Provider,
    /// Operation changed.
    Operation,
    /// Fingerprint changed.
    Fingerprint,
    /// Publisher-policy fact (revision/publisher/outcome/revocation) changed.
    PublisherPolicy,
    /// Freshness fact (floors/revisions) changed.
    Freshness,
    /// Authority validity (expiry/revocation revision) changed.
    Authority,
    /// Emergency-stop state changed.
    EmergencyState,
    /// Emergency-state revision changed.
    EmergencyStateRevision,
    /// Approval snapshot changed.
    Approval,
    /// Credential snapshot changed.
    Credential,
}

/// The typed result of a before-use comparison. Fail closed: any change is a `Mismatch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextComparison {
    /// The re-derived context matches the permit's context exactly.
    Match,
    /// The re-derived context differs; the first differing field is reported.
    Mismatch(ContextField),
}

impl ContextComparison {
    /// True only for an exact match.
    #[must_use]
    pub fn is_match(self) -> bool {
        matches!(self, ContextComparison::Match)
    }
}

/// The complete, immutable set of verified bindings under which eligibility was derived. Service
/// private; not (de)serializable; contains no raw secret, token, or certificate material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedExecutionContext {
    pub(crate) phase: crate::phase::PhaseId,
    pub(crate) approved_plan: Option<crate::plan::ApprovedPlanBinding>,
    pub(crate) approved_plan_status: Option<crate::plan::ApprovedPlanStatus>,
    pub(crate) approved_plan_status_revision: Option<u64>,
    pub(crate) repository_baseline: Option<crate::repository::VerifiedRepositoryBaseline>,
    pub(crate) repository_generation: Option<u64>,
    pub(crate) repository_freshness: Option<crate::repository::RepositoryFreshness>,
    pub(crate) owner_presence_proof: Option<crate::owner_presence::VerifiedOwnerPresence>,
    pub(crate) owner_presence_generation: Option<u64>,
    pub(crate) owner_presence_valid_until: Option<u64>,
    /// The trusted-clock provider identity + epoch the owner-presence lease was established under. Used by
    /// permit temporal revalidation to reject a reading from a different provider/epoch.
    pub(crate) owner_presence_provider: Option<String>,
    pub(crate) owner_presence_epoch: Option<u64>,
    pub(crate) session: SessionId,
    pub(crate) process_session: SessionId,
    pub(crate) executable: ExecutableIdentity,
    pub(crate) installation: InstallationId,
    pub(crate) release: ReleaseId,
    pub(crate) repository: RepositoryRef,
    pub(crate) project: ProjectId,
    pub(crate) environment: EnvironmentId,
    pub(crate) provider: ProviderId,
    pub(crate) operation: OperationName,
    pub(crate) fingerprint: OperationFingerprint,
    pub(crate) publisher_policy: ValidatedPublisherPolicy,
    pub(crate) freshness: ValidatedFreshness,
    pub(crate) authority: AuthorityValidity,
    pub(crate) emergency_state: EmergencyStopState,
    pub(crate) emergency_state_revision: EmergencyStateRevision,
    /// The validated approval, present only when approval was required.
    pub(crate) approval: Option<VerifiedApproval>,
    /// The validated credential scope, present only when a credential was required.
    pub(crate) credential: Option<CredentialScope>,
}

impl VerifiedExecutionContext {
    /// The authoritative, service-issued phase identity this context is bound to.
    #[must_use]
    pub fn phase(&self) -> &crate::phase::PhaseId {
        &self.phase
    }
    /// Authenticated session.
    #[must_use]
    pub fn session(&self) -> &SessionId {
        &self.session
    }
    /// The session the verified process was bound to.
    #[must_use]
    pub fn process_session(&self) -> &SessionId {
        &self.process_session
    }
    /// The explicit validated executable identity.
    #[must_use]
    pub fn executable(&self) -> &ExecutableIdentity {
        &self.executable
    }
    /// Validated installation.
    #[must_use]
    pub fn installation(&self) -> &InstallationId {
        &self.installation
    }
    /// Validated release.
    #[must_use]
    pub fn release(&self) -> &ReleaseId {
        &self.release
    }
    /// Validated repository.
    #[must_use]
    pub fn repository(&self) -> &RepositoryRef {
        &self.repository
    }
    /// Validated project.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// Validated environment.
    #[must_use]
    pub fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    /// Provider.
    #[must_use]
    pub fn provider(&self) -> &ProviderId {
        &self.provider
    }
    /// Operation.
    #[must_use]
    pub fn operation(&self) -> &OperationName {
        &self.operation
    }
    /// Operation fingerprint.
    #[must_use]
    pub fn fingerprint(&self) -> &OperationFingerprint {
        &self.fingerprint
    }
    /// The explicit validated publisher-policy fact.
    #[must_use]
    pub fn publisher_policy(&self) -> &ValidatedPublisherPolicy {
        &self.publisher_policy
    }
    /// The explicit validated freshness fact.
    #[must_use]
    pub fn freshness(&self) -> &ValidatedFreshness {
        &self.freshness
    }
    /// The authority-validity snapshot.
    #[must_use]
    pub fn authority(&self) -> &AuthorityValidity {
        &self.authority
    }
    /// The verified emergency-stop state (always `Clear` in an eligible context).
    #[must_use]
    pub fn emergency_state(&self) -> EmergencyStopState {
        self.emergency_state
    }
    /// The emergency-state revision captured at derivation.
    #[must_use]
    pub fn emergency_state_revision(&self) -> EmergencyStateRevision {
        self.emergency_state_revision
    }
    /// The validated approval, if approval was required.
    #[must_use]
    pub fn approval(&self) -> Option<&VerifiedApproval> {
        self.approval.as_ref()
    }
    /// The validated credential scope, if a credential was required.
    #[must_use]
    pub fn credential(&self) -> Option<&CredentialScope> {
        self.credential.as_ref()
    }

    /// Compare this (permit-held) context to a freshly re-derived one, field by field. Fail closed:
    /// any authority-sensitive difference is a [`ContextComparison::Mismatch`] naming the first
    /// differing field. Only an exactly matching re-derived context returns [`ContextComparison::Match`].
    #[must_use]
    pub fn compare(&self, other: &VerifiedExecutionContext) -> ContextComparison {
        use ContextField as F;
        let checks: [(bool, F); 29] = [
            (self.phase == other.phase, F::Phase),
            (self.approved_plan == other.approved_plan, F::ApprovedPlan),
            (
                self.approved_plan_status == other.approved_plan_status,
                F::ApprovedPlanStatus,
            ),
            (
                self.approved_plan_status_revision == other.approved_plan_status_revision,
                F::ApprovedPlanStatusRevision,
            ),
            (
                self.repository_baseline.as_ref().map(|b| b.identity())
                    == other.repository_baseline.as_ref().map(|b| b.identity()),
                F::RepositoryIdentity,
            ),
            (
                self.repository_baseline == other.repository_baseline,
                F::RepositoryBaseline,
            ),
            (
                self.repository_generation == other.repository_generation,
                F::RepositoryGeneration,
            ),
            (
                self.repository_freshness == other.repository_freshness,
                F::RepositoryFreshness,
            ),
            (
                self.owner_presence_proof == other.owner_presence_proof,
                F::OwnerPresenceProof,
            ),
            (
                self.owner_presence_generation == other.owner_presence_generation,
                F::OwnerPresenceGeneration,
            ),
            (
                self.owner_presence_valid_until == other.owner_presence_valid_until,
                F::OwnerPresenceValidUntil,
            ),
            (self.session == other.session, F::Session),
            (self.process_session == other.process_session, F::Process),
            (self.executable == other.executable, F::Executable),
            (self.installation == other.installation, F::Installation),
            (self.release == other.release, F::Release),
            (self.repository == other.repository, F::Repository),
            (self.project == other.project, F::Project),
            (self.environment == other.environment, F::Environment),
            (self.provider == other.provider, F::Provider),
            (self.operation == other.operation, F::Operation),
            (self.fingerprint == other.fingerprint, F::Fingerprint),
            (
                self.publisher_policy == other.publisher_policy,
                F::PublisherPolicy,
            ),
            (self.freshness == other.freshness, F::Freshness),
            (self.authority == other.authority, F::Authority),
            (
                self.emergency_state == other.emergency_state,
                F::EmergencyState,
            ),
            (
                self.emergency_state_revision == other.emergency_state_revision,
                F::EmergencyStateRevision,
            ),
            (self.approval == other.approval, F::Approval),
            (self.credential == other.credential, F::Credential),
        ];
        for (equal, field) in checks {
            if !equal {
                return ContextComparison::Mismatch(field);
            }
        }
        ContextComparison::Match
    }
}

/// A service-private capability record authorising exactly one operation under exactly one immutable
/// [`VerifiedExecutionContext`]. Returned ONLY by [`crate::reducer::reduce`]; no public constructor;
/// not (de)serializable; never appears in the shared wire contract; never crosses IPC.
///
/// The permit does not (and this pure crate cannot) enforce runtime invalidation. It retains the FULL
/// original authority context so the future service can, before every use, re-derive the current
/// context and call [`ExecutionPermit::is_valid_for`] / [`VerifiedExecutionContext::compare`],
/// refusing if ANY element changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPermit {
    operation_ref: OperationRef,
    context: VerifiedExecutionContext,
}

impl ExecutionPermit {
    /// Mint a permit. Crate-private on purpose: only [`crate::reducer::reduce`] may call this, after
    /// every required fact matched. There is no public constructor.
    pub(crate) fn mint(operation_ref: OperationRef, context: VerifiedExecutionContext) -> Self {
        Self {
            operation_ref,
            context,
        }
    }

    /// The operation this permit authorises.
    #[must_use]
    pub fn operation_ref(&self) -> &OperationRef {
        &self.operation_ref
    }
    /// The complete immutable authority context.
    #[must_use]
    pub fn context(&self) -> &VerifiedExecutionContext {
        &self.context
    }

    /// Compare the permit's stored context to a freshly re-derived context. Fail closed.
    #[must_use]
    pub fn compare_context(&self, current: &VerifiedExecutionContext) -> ContextComparison {
        self.context.compare(current)
    }

    /// Convenience: true only when the freshly re-derived context matches exactly.
    #[must_use]
    pub fn is_valid_for(&self, current: &VerifiedExecutionContext) -> bool {
        self.context.compare(current).is_match()
    }

    /// Temporal revalidation against the CURRENT trusted time, read from the injected clock PROVIDER
    /// (never a caller-supplied value): true only when the re-derived context matches exactly AND, where
    /// this permit carries an owner-presence lease, the provider's CURRENT reading is from the same
    /// provider + epoch the lease was established under and is still within `owner_presence_valid_until`.
    ///
    /// A permit minted while a presence lease was current becomes INVALID once ordinary time passes
    /// beyond the boundary — the caller supplies the PROVIDER, not the reading, so a retained historical
    /// time cannot be replayed to keep a stale permit alive; a substituted provider or an earlier epoch
    /// also fails.
    #[must_use]
    pub fn is_current(
        &self,
        current: &VerifiedExecutionContext,
        clock: &dyn crate::authority_time::TrustedClock,
    ) -> bool {
        if !self.context.compare(current).is_match() {
            return false;
        }
        match (
            self.context.owner_presence_valid_until,
            &self.context.owner_presence_provider,
            self.context.owner_presence_epoch,
        ) {
            (Some(valid_until), Some(provider), Some(epoch)) => {
                let now = clock.read_current();
                now.provider_id() == provider && now.epoch() == epoch && now.reading() < valid_until
            }
            // No owner-presence lease on this permit → no temporal constraint.
            _ => true,
        }
    }

    /// Convenience: the bound project.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        self.context.project()
    }
    /// Convenience: the bound environment.
    #[must_use]
    pub fn environment(&self) -> &EnvironmentId {
        self.context.environment()
    }
    /// Convenience: the bound provider.
    #[must_use]
    pub fn provider(&self) -> &ProviderId {
        self.context.provider()
    }
    /// Convenience: the bound operation.
    #[must_use]
    pub fn operation(&self) -> &OperationName {
        self.context.operation()
    }
    /// Convenience: the bound fingerprint.
    #[must_use]
    pub fn fingerprint(&self) -> &OperationFingerprint {
        self.context.fingerprint()
    }
    /// Convenience: the bound release.
    #[must_use]
    pub fn release(&self) -> &ReleaseId {
        self.context.release()
    }
    /// Convenience: the bound session.
    #[must_use]
    pub fn session(&self) -> &SessionId {
        self.context.session()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::{
        PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision, PublisherIdentity, ReleaseFloor,
    };
    use crate::phase::{PhaseId, PhaseReference};
    use crate::plan::{
        approve_normalized_definition, normalize_candidate, ApprovedPlanBinding, ApprovedPlanRef,
        ApprovedPlanStatus, ApprovedPlanVersion, EffectPolicy, PhaseDefinitionCandidate, PhaseType,
        ProviderPolicy, RepositoryPolicy, ResidueRequirement,
    };

    fn ids() -> (ProjectId, EnvironmentId) {
        (
            ProjectId::new("proj").unwrap(),
            EnvironmentId::new("staging").unwrap(),
        )
    }

    fn candidate() -> PhaseDefinitionCandidate {
        let (project, environment) = ids();
        PhaseDefinitionCandidate {
            phase_id: "phase-x".into(),
            phase_type: PhaseType::SourceOnly,
            project,
            environment,
            scope: vec!["a".into()],
            path_boundary: vec!["src/x".into()],
            allowed_actions: vec!["read".into()],
            prohibited_actions: vec!["write".into()],
            dependencies: vec![],
            predecessors: vec![],
            repository_policy: RepositoryPolicy::ReadOnly,
            provider_policy: ProviderPolicy::None,
            effect_policy: EffectPolicy::ObservationOnly,
            rollback_required: true,
            shutdown_required: true,
            disconnect_required: true,
            residue: ResidueRequirement::ExactlyZero,
        }
    }

    // A complete context differing from any other built here ONLY where the caller varies the plan
    // binding; every other field is fixed identical, so a comparison difference can only come from the
    // supplied `binding`.
    fn ctx_with_plan(binding: ApprovedPlanBinding) -> VerifiedExecutionContext {
        let (project, environment) = ids();
        let phase = PhaseId::mint(
            &project,
            &environment,
            &PhaseReference::new("phase-ref").unwrap(),
            &OperationRef::new("op-1").unwrap(),
        );
        VerifiedExecutionContext {
            phase,
            approved_plan: Some(binding),
            approved_plan_status: Some(ApprovedPlanStatus::Active),
            approved_plan_status_revision: Some(0),
            repository_baseline: None,
            repository_generation: None,
            repository_freshness: None,
            owner_presence_proof: None,
            owner_presence_generation: None,
            owner_presence_valid_until: None,
            owner_presence_provider: None,
            owner_presence_epoch: None,
            session: SessionId::new("s"),
            process_session: SessionId::new("s"),
            executable: ExecutableIdentity::new("e"),
            installation: InstallationId::new("i"),
            release: ReleaseId::new("r"),
            repository: RepositoryRef::new("repo"),
            project,
            environment,
            provider: ProviderId::new("prov").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            publisher_policy: ValidatedPublisherPolicy {
                policy_id: PolicyId::new("pol"),
                policy_revision: PolicyRevision(1),
                publisher: PublisherIdentity::new("pub"),
                installation: InstallationId::new("i"),
                outcome: PolicyOutcome::Accepted,
                revocation_revision: RevocationRevision(1),
            },
            freshness: ValidatedFreshness {
                release: ReleaseId::new("r"),
                release_floor: ReleaseFloor(1),
                policy_revision: PolicyRevision(1),
                policy_floor: PolicyFloor(1),
                emergency_revocation_floor: RevocationRevision(1),
            },
            authority: AuthorityValidity {
                authority_expiry: ExpiryBoundary(1000),
                operation_expiry: Some(ExpiryBoundary(1000)),
                revocation_revision: RevocationRevision(1),
            },
            emergency_state: EmergencyStopState::Clear,
            emergency_state_revision: EmergencyStateRevision(1),
            approval: None,
            credential: None,
        }
    }

    /// Two plan bindings identical in plan reference, PhaseDefinitionDigest, project, environment and
    /// phase id, differing ONLY in `ApprovedPlanVersion`. The two contexts are otherwise byte-identical
    /// (same phase, same operation fingerprint, same status and status revision), so the ONLY thing that
    /// can make the comparison report a difference is the plan version. This proves the version field is
    /// load-bearing in the permit context independently of the digest, plan reference, fingerprint,
    /// status and status revision.
    #[test]
    fn context_comparison_detects_a_plan_version_change_with_an_unchanged_digest() {
        let n = normalize_candidate(&candidate()).unwrap();
        let rec = approve_normalized_definition(
            ApprovedPlanRef::new("plan-1").unwrap(),
            ApprovedPlanVersion(1),
            &n,
            ApprovedPlanStatus::Active,
        );
        let binding_v1 = rec.binding().clone();
        // Same digest + reference, different version only (intentionally inconsistent; test-only).
        let binding_v2 = binding_v1.with_version_for_test(ApprovedPlanVersion(2));
        // The pair shares the digest and reference and differs ONLY by version.
        assert_eq!(binding_v1.plan_ref(), binding_v2.plan_ref());
        assert_eq!(binding_v1.digest_bytes(), binding_v2.digest_bytes());
        assert_ne!(binding_v1.version(), binding_v2.version());

        let c1 = ctx_with_plan(binding_v1);
        let c2 = ctx_with_plan(binding_v2);
        // Fixed-identical everywhere except the plan version → the reported difference is the plan.
        assert_eq!(
            c1.compare(&c2),
            ContextComparison::Mismatch(ContextField::ApprovedPlan)
        );
    }
}
