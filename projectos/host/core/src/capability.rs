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
    /// Elevation proof identity/level changed (a different elevation proof).
    ElevationProof,
    /// Elevation proof generation changed.
    ElevationGeneration,
    /// Elevation proof validity boundary changed (expiry moved).
    ElevationValidUntil,
    /// Elevation trusted-clock provider identity changed (provider substitution).
    ElevationProvider,
    /// Elevation provider epoch changed (provider restart).
    ElevationEpoch,
    /// Elevation-bound process identity (pid + creation tick) changed (a different or restarted process).
    ElevationProcess,
    /// Elevation VERIFIER identity changed (verifier substitution — distinct from the clock provider).
    ElevationVerifier,
    /// Elevation verifier epoch changed (verifier restart).
    ElevationVerifierEpoch,
    /// Elevation-bound authenticated session changed (a fact from another session).
    ElevationSession,
    /// Effect policy changed (a different bounded effect family/target/argument/rollback).
    EffectPolicy,
    /// Canonical upstream authority lease bound changed (an upstream deadline moved).
    AuthorityLeaseBound,
    /// Runtime-instance identity changed (a different or restarted trusted host start).
    RuntimeInstance,
    /// IPC-session identity changed (a different or reconnected authenticated connection).
    IpcSession,
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

/// TEST-ONLY selector naming exactly one binding dimension for [`VerifiedExecutionContext::fixture_take`].
/// Feature-gated; not reachable from the production graph.
#[cfg(any(test, feature = "test-fixtures"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureDimension {
    Project,
    Environment,
    Phase,
    ApprovedPlan,
    OperationName,
    Fingerprint,
    RepositoryBaseline,
    RepositoryGeneration,
    Session,
    Process,
    OwnerPresence,
    Elevation,
    ElevationVerifier,
    ElevationVerifierEpoch,
    ElevationClockProvider,
    ElevationClockEpoch,
    EffectPolicy,
    AuthorityLeaseBound,
    RuntimeInstance,
    IpcSession,
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
    pub(crate) elevation_proof: Option<crate::elevation::VerifiedElevation>,
    pub(crate) elevation_generation: Option<u64>,
    pub(crate) elevation_valid_until: Option<u64>,
    /// The trusted-clock provider identity + epoch the elevation proof was established under.
    pub(crate) elevation_provider: Option<String>,
    pub(crate) elevation_epoch: Option<u64>,
    /// The elevation-bound process identity (pid + creation tick).
    pub(crate) elevation_process: Option<(u32, u64)>,
    /// The elevation VERIFIER identity + epoch (distinct from the clock provider).
    pub(crate) elevation_verifier: Option<String>,
    pub(crate) elevation_verifier_epoch: Option<u64>,
    /// The authenticated session the elevation proof was verified under.
    pub(crate) elevation_session: Option<SessionId>,
    /// The digest of the effect policy this operation is governed by (folded into the fingerprint). An
    /// effect grant can be minted only for the EXACT policy stamped here. `None` = no protected effect.
    pub(crate) effect_policy: Option<[u8; 32]>,
    /// The canonical upstream authority lease bound (minimum over every applicable temporal authority).
    pub(crate) authority_lease_bound: Option<crate::effect::AuthorityLeaseBound>,
    /// Canonical identity of the trusted runtime instance this operation is bound to (digest + per-start
    /// generation), derived from a [`crate::runtime_instance::VerifiedRuntimeInstance`]. `None` when the
    /// operation is not runtime-bound. An identity dimension: a different host start/instance is refused.
    pub(crate) runtime_instance_digest: Option<[u8; 32]>,
    pub(crate) runtime_generation: Option<u64>,
    /// Canonical identity of the authenticated IPC session this operation is bound to (session digest +
    /// connection id + handshake generation), derived from a [`crate::ipc_session::BoundIpcSession`].
    /// `None` when not IPC-bound. An identity dimension: a different/reconnected connection is refused.
    pub(crate) ipc_session_digest: Option<[u8; 32]>,
    pub(crate) ipc_connection_id: Option<u64>,
    pub(crate) ipc_handshake_generation: Option<u64>,
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
    /// The digest of the effect policy this operation is governed by (crate-internal; read by the
    /// effect-grant mint to prove the requested effect is the one the operation was fingerprinted with).
    pub(crate) fn effect_policy(&self) -> Option<[u8; 32]> {
        self.effect_policy
    }
    /// The upstream authority generation an effect grant records for traceability (elevation, else
    /// owner-presence, else 0).
    pub(crate) fn effect_generation(&self) -> u64 {
        self.elevation_generation
            .or(self.owner_presence_generation)
            .unwrap_or(0)
    }
    /// The canonical upstream authority lease bound (reducer-derived minimum over every applicable
    /// time-bounded authority). An effect grant's validity can never exceed this.
    pub(crate) fn authority_lease_bound(&self) -> Option<crate::effect::AuthorityLeaseBound> {
        self.authority_lease_bound
    }
    /// The canonical runtime-instance identity digest this context is bound to (an effect grant records
    /// it so it can never be presented under a different trusted host start).
    pub(crate) fn runtime_instance_digest(&self) -> Option<[u8; 32]> {
        self.runtime_instance_digest
    }
    /// The canonical IPC-session identity digest this context is bound to (an effect grant records it so
    /// it can never be presented over a different or reconnected IPC connection).
    pub(crate) fn ipc_session_digest(&self) -> Option<[u8; 32]> {
        self.ipc_session_digest
    }

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

    /// TEST-ONLY: clone this canonical context but replace EXACTLY ONE binding dimension with the value
    /// from `other`, leaving every other compared dimension identical. This deliberately creates an
    /// internally-inconsistent candidate context so the effect-grant mint's per-dimension comparison can be
    /// tested in isolation (production construction correctly derives dependent fields together; this bypass
    /// exists ONLY under `test-fixtures`, is not reachable from the production graph, mints no authority).
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_take(&self, other: &Self, dim: FixtureDimension) -> Self {
        let mut c = self.clone();
        match dim {
            FixtureDimension::Project => c.project = other.project.clone(),
            FixtureDimension::Environment => c.environment = other.environment.clone(),
            FixtureDimension::Phase => c.phase = other.phase.clone(),
            FixtureDimension::ApprovedPlan => c.approved_plan = other.approved_plan.clone(),
            FixtureDimension::OperationName => c.operation = other.operation.clone(),
            FixtureDimension::Fingerprint => c.fingerprint = other.fingerprint.clone(),
            FixtureDimension::RepositoryBaseline => {
                c.repository_baseline = other.repository_baseline.clone();
            }
            FixtureDimension::RepositoryGeneration => {
                c.repository_generation = other.repository_generation;
            }
            FixtureDimension::Session => c.session = other.session.clone(),
            FixtureDimension::Process => c.elevation_process = other.elevation_process,
            FixtureDimension::OwnerPresence => {
                c.owner_presence_proof = other.owner_presence_proof.clone();
            }
            FixtureDimension::Elevation => c.elevation_proof = other.elevation_proof.clone(),
            FixtureDimension::ElevationVerifier => {
                c.elevation_verifier = other.elevation_verifier.clone();
            }
            FixtureDimension::ElevationVerifierEpoch => {
                c.elevation_verifier_epoch = other.elevation_verifier_epoch;
            }
            FixtureDimension::ElevationClockProvider => {
                c.elevation_provider = other.elevation_provider.clone();
            }
            FixtureDimension::ElevationClockEpoch => {
                c.elevation_epoch = other.elevation_epoch;
            }
            FixtureDimension::EffectPolicy => c.effect_policy = other.effect_policy,
            FixtureDimension::AuthorityLeaseBound => {
                c.authority_lease_bound = other.authority_lease_bound;
            }
            FixtureDimension::RuntimeInstance => {
                c.runtime_instance_digest = other.runtime_instance_digest;
                c.runtime_generation = other.runtime_generation;
            }
            FixtureDimension::IpcSession => {
                c.ipc_session_digest = other.ipc_session_digest;
                c.ipc_connection_id = other.ipc_connection_id;
                c.ipc_handshake_generation = other.ipc_handshake_generation;
            }
        }
        c
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
        let checks: [(bool, F); 42] = [
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
            (
                self.elevation_proof == other.elevation_proof,
                F::ElevationProof,
            ),
            (
                self.elevation_generation == other.elevation_generation,
                F::ElevationGeneration,
            ),
            (
                self.elevation_valid_until == other.elevation_valid_until,
                F::ElevationValidUntil,
            ),
            (
                self.elevation_provider == other.elevation_provider,
                F::ElevationProvider,
            ),
            (
                self.elevation_epoch == other.elevation_epoch,
                F::ElevationEpoch,
            ),
            (
                self.elevation_process == other.elevation_process,
                F::ElevationProcess,
            ),
            (
                self.elevation_verifier == other.elevation_verifier,
                F::ElevationVerifier,
            ),
            (
                self.elevation_verifier_epoch == other.elevation_verifier_epoch,
                F::ElevationVerifierEpoch,
            ),
            (
                self.elevation_session == other.elevation_session,
                F::ElevationSession,
            ),
            (self.effect_policy == other.effect_policy, F::EffectPolicy),
            (
                self.authority_lease_bound == other.authority_lease_bound,
                F::AuthorityLeaseBound,
            ),
            (
                self.runtime_instance_digest == other.runtime_instance_digest
                    && self.runtime_generation == other.runtime_generation,
                F::RuntimeInstance,
            ),
            (
                self.ipc_session_digest == other.ipc_session_digest
                    && self.ipc_connection_id == other.ipc_connection_id
                    && self.ipc_handshake_generation == other.ipc_handshake_generation,
                F::IpcSession,
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

    /// A canonical, domain-separated digest binding a grant to THIS exact permit's stable AUTHORITY
    /// IDENTITY. Crate-internal; folded (with the effect policy) into the single-issuance key so two
    /// permits with distinct authority identity can never share issuance state, and recorded on the grant
    /// so it can never be paired with a different permit.
    ///
    /// # Canonical encoding
    /// Domain-tag `PROJECTOS:PERMIT-CONTEXT-DIGEST:V3`, then every field in a fixed order with unambiguous
    /// framing: strings/byte-slices are length-prefixed (`u32` BE length ‖ bytes); every `Option` is
    /// preceded by a `0x00` absent / `0x01` present tag so `Some("")`, `None`, and a shorter value can
    /// never collide; integers are fixed-width big-endian.
    ///
    /// # Included IDENTITY dimensions (a change → a different issuance key)
    /// B6 fingerprint, B1 project, B2 environment, B3 phase, B9 session, B15 effect policy, B4
    /// approved-plan (definition digest ‖ version ‖ reference), B7 repository baseline CONTENT (root ‖
    /// commit ‖ branch), B10 process (pid ‖ creation tick), B11 owner-presence PROOF digest, B12
    /// elevation PROOF digest, B14 elevation-verifier IDENTITY.
    ///
    /// B5 operation reference is bound TRANSITIVELY, not directly: `InternalOperationRecord::new` folds
    /// `operation_ref` into the canonical [`crate::phase::PhaseId`] (`PhaseId::mint(…, operation_ref)`),
    /// which is folded here as `phase.digest()` and again into the fingerprint. There is deliberately NO
    /// direct `operation_ref` fold — it would be redundant, since two operations differing only in the
    /// reference already carry different phases, and no context can be constructed whose phase disagrees
    /// with its operation reference.
    ///
    /// # Intentionally EXCLUDED (enforced by [`VerifiedExecutionContext::compare`] at mint + sealed-clock
    /// currentness at execution; folding them would tie issuance IDENTITY to transient re-authorization
    /// state and let a benign re-observation mint a SECOND grant, breaking one-grant-per-operation)
    /// B8 repository generation, B13 clock provider+epoch, B14 verifier EPOCH, B16 authority lease bound,
    /// and every owner-presence/elevation generation, valid-until, provider and epoch scalar. B17 rollback
    /// policy is bound through the effect `policy_digest`, the issuance key's second half.
    pub(crate) fn context_digest(&self) -> [u8; 32] {
        Self::digest_of(&self.context)
    }

    /// The canonical V2 digest of a context. Sole implementation; [`ExecutionPermit::context_digest`]
    /// and the test-only helpers delegate here. The operation reference is NOT an argument: it is
    /// represented only through the context's phase (into which the record constructor folded it).
    fn digest_of(c: &VerifiedExecutionContext) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:PERMIT-CONTEXT-DIGEST:V3");
        let seg = |h: &mut Sha256, b: &[u8]| {
            h.update((b.len() as u32).to_be_bytes());
            h.update(b);
        };
        // B6 / B1 / B2 / B3 / B9 — stable string identity (B5 op-ref rides in the phase).
        seg(&mut h, c.fingerprint.as_str().as_bytes());
        seg(&mut h, c.project.as_str().as_bytes());
        seg(&mut h, c.environment.as_str().as_bytes());
        seg(&mut h, c.phase.digest().as_bytes());
        seg(&mut h, c.session.as_str().as_bytes());
        // B15 effect policy.
        match c.effect_policy {
            Some(d) => {
                h.update([1u8]);
                h.update(d);
            }
            None => h.update([0u8]),
        }
        // B4 approved-plan identity: definition digest ‖ version ‖ reference.
        match &c.approved_plan {
            Some(p) => {
                h.update([1u8]);
                h.update(p.digest_bytes());
                h.update(p.version().0.to_be_bytes());
                seg(&mut h, p.plan_ref().as_str().as_bytes());
            }
            None => h.update([0u8]),
        }
        // B7 repository baseline CONTENT (root ‖ commit ‖ branch).
        match &c.repository_baseline {
            Some(b) => {
                h.update([1u8]);
                h.update(b.fingerprint_material());
            }
            None => h.update([0u8]),
        }
        // B10 process identity (pid ‖ creation tick).
        match c.elevation_process {
            Some((pid, tick)) => {
                h.update([1u8]);
                h.update(pid.to_be_bytes());
                h.update(tick.to_be_bytes());
            }
            None => h.update([0u8]),
        }
        // B11 owner-presence PROOF identity.
        match &c.owner_presence_proof {
            Some(p) => {
                h.update([1u8]);
                h.update(p.proof_digest());
            }
            None => h.update([0u8]),
        }
        // B12 elevation PROOF identity.
        match &c.elevation_proof {
            Some(e) => {
                h.update([1u8]);
                h.update(e.proof_digest());
            }
            None => h.update([0u8]),
        }
        // B14 elevation-verifier IDENTITY (epoch intentionally excluded — see doc).
        match &c.elevation_verifier {
            Some(v) => {
                h.update([1u8]);
                seg(&mut h, v.as_bytes());
            }
            None => h.update([0u8]),
        }
        // Runtime-instance IDENTITY (digest ‖ per-start generation) — an identity dimension: a different
        // host start yields a different issuance key.
        match (c.runtime_instance_digest, c.runtime_generation) {
            (Some(d), Some(g)) => {
                h.update([1u8]);
                h.update(d);
                h.update(g.to_be_bytes());
            }
            _ => h.update([0u8]),
        }
        // IPC-session IDENTITY (session digest ‖ connection id ‖ handshake generation) — an identity
        // dimension: a different or reconnected connection yields a different issuance key.
        match (
            c.ipc_session_digest,
            c.ipc_connection_id,
            c.ipc_handshake_generation,
        ) {
            (Some(d), Some(conn), Some(hg)) => {
                h.update([1u8]);
                h.update(d);
                h.update(conn.to_be_bytes());
                h.update(hg.to_be_bytes());
            }
            _ => h.update([0u8]),
        }
        h.finalize().into()
    }

    /// TEST-ONLY observability of the canonical permit-context digest, for digest-isolation proofs.
    /// Gated behind `test-fixtures`; unavailable in the default/production graph.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_context_digest(&self) -> [u8; 32] {
        self.context_digest()
    }

    /// TEST-ONLY: digest an ARBITRARY context under THIS permit's operation reference, so a single
    /// `fixture_take`-swapped field can be isolated in a digest-isolation proof. Gated behind
    /// `test-fixtures`; unavailable in the default/production graph.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_context_digest_with(&self, context: &VerifiedExecutionContext) -> [u8; 32] {
        Self::digest_of(context)
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
        let now = clock.read_current();
        // Owner-presence lease (where present).
        if let (Some(valid_until), Some(provider), Some(epoch)) = (
            self.context.owner_presence_valid_until,
            &self.context.owner_presence_provider,
            self.context.owner_presence_epoch,
        ) {
            if now.provider_id() != provider || now.epoch() != epoch || now.reading() >= valid_until
            {
                return false;
            }
        }
        // Elevation lease (where present) — same sealed-provider model: same provider + epoch, still
        // within `elevation_valid_until`.
        if let (Some(valid_until), Some(provider), Some(epoch)) = (
            self.context.elevation_valid_until,
            &self.context.elevation_provider,
            self.context.elevation_epoch,
        ) {
            if now.provider_id() != provider || now.epoch() != epoch || now.reading() >= valid_until
            {
                return false;
            }
        }
        true
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
            elevation_proof: None,
            elevation_generation: None,
            elevation_valid_until: None,
            elevation_provider: None,
            elevation_epoch: None,
            elevation_process: None,
            elevation_verifier: None,
            elevation_verifier_epoch: None,
            elevation_session: None,
            effect_policy: None,
            authority_lease_bound: None,
            runtime_instance_digest: None,
            runtime_generation: None,
            ipc_session_digest: None,
            ipc_connection_id: None,
            ipc_handshake_generation: None,
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
