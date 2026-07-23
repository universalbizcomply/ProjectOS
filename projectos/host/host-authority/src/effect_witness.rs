//! OPAQUE EFFECT WITNESSES and the consuming authorisation transition
//! (3K-I-D-E-C-CAPABILITY-B4-EFFECT-WITNESS-CONTRACT1A).
//!
//! ## Why this exists
//!
//! The legacy [`crate`]-external `OperationGate` in windows-service-control is a POLICY DECLARATION,
//! not evidence: its fields are public, its states are freely-writable unit enums, and it derives
//! `Copy`, so any dependent can assert "owner approved, administrator elevated" with a struct literal
//! and replay it without limit. That is fine for reporting and refusal — which is all it does — but it
//! can never be allowed to mint live authority.
//!
//! These witnesses are the opposite: private representation, no public constructor, no `Clone`, no
//! `Copy`, no `Default`, no `Display`, no serialisation, redacted `Debug`, and consumed on use. A
//! caller can name them and pass them along, but can never manufacture one.
//!
//! ## What this phase does NOT do
//!
//! There is deliberately **no production producer** for any witness. Real owner approval, a real
//! `TokenElevation` observation, real repository verification and real executable verification are all
//! deferred to separately-authorised phases that carry machine effect. The only construction path here
//! is fixture-only, behind an explicit non-default feature, and every fixture witness is marked
//! internally as SYNTHETIC so a future live producer can reject it.
//!
//! Holding a witness is therefore never authority. It is only evidence that some verifier — one that
//! does not exist yet — did its job.

use core::fmt;
use core::marker::PhantomData;

/// Makes every type in this module neither `Send` nor `Sync` on stable Rust.
///
/// A raw pointer is `!Send + !Sync`, and those negatives propagate to any struct containing one, so a
/// witness or grant cannot be moved to another thread — no unstable negative impls required. The
/// pointer is never dereferenced and is always null.
type ThreadBound = PhantomData<*const ()>;

/// How an executable was classified by whatever verified it. Closed and non-authorising: it records a
/// verdict, never a path, hash or signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ExecutableIdentityClass {
    /// The executable was not verified at all.
    Unverified,
    /// A development build: identity established, but never production-trusted.
    DevelopmentBuild,
    /// A verified packaged build.
    VerifiedPackagedBuild,
}

/// Whether rollback is contractually required. A live proof must always require it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RollbackRequirement {
    /// Rollback required on pass AND on failure.
    RequiredOnPassAndFailure,
    /// Rollback not required — never valid for an effectful attempt.
    NotRequired,
}

/// Whether exact-zero residue is contractually required.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ResidueRequirement {
    /// Residue must be exactly Zero.
    ExactlyZero,
    /// Residue unconstrained — never valid for an effectful attempt.
    Unconstrained,
}

/// The closed set of effects an attempt may perform. Deliberately coarse: this is a contract, not a
/// permission bitmask to be widened later.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApprovedEffectSet {
    /// No effect at all.
    None,
    /// Read-only observation: SCM status query, pipe connection, bounded process query.
    ObservationOnly,
    /// Observation plus temporary service lifecycle, with mandatory rollback.
    ObservationAndTemporaryServiceLifecycle,
}

/// The PRIVATE binding every witness carries.
///
/// Each field is an opaque discriminator, never a name, path or identifier a caller could read back.
/// Witnesses compose only if every field matches, which is what prevents a witness minted for one
/// project, phase, baseline, environment, service, attempt or owner session from being reused in
/// another.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct EffectContextBinding {
    project: u64,
    phase: u64,
    repository_baseline: u64,
    environment: u64,
    service_context: u64,
    proof_attempt: u64,
    owner_session: u64,
    executable_class: ExecutableIdentityClass,
    effect_set: ApprovedEffectSet,
    rollback: RollbackRequirement,
    residue: ResidueRequirement,
    /// Remaining validity, measured against a monotonic source by the composer. Zero means expired.
    window_millis: u64,
    /// Whether this binding came from the fixture graph. A future live producer must refuse it.
    synthetic: bool,
}

impl fmt::Debug for EffectContextBinding {
    /// Redacted: printing any discriminator would leak a correlatable identity.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("EffectContextBinding([REDACTED])")
    }
}

impl EffectContextBinding {
    /// Whether two bindings describe the same effect context. Equality only — no field is readable.
    pub(crate) fn matches(&self, other: &Self) -> bool {
        self == other
    }

    /// Whether the bounded validity window has already elapsed.
    pub(crate) fn is_expired(&self) -> bool {
        self.window_millis == 0
    }

    /// Whether the contract requires rollback and exact-zero residue, and permits some effect.
    pub(crate) fn is_effect_contract_complete(&self) -> bool {
        matches!(self.rollback, RollbackRequirement::RequiredOnPassAndFailure)
            && matches!(self.residue, ResidueRequirement::ExactlyZero)
            && !matches!(self.effect_set, ApprovedEffectSet::None)
    }

    /// Whether this binding is synthetic (fixture-produced). Retained for the FUTURE live
    /// capability producer, which must refuse a synthetic witness outright.
    #[allow(dead_code)]
    pub(crate) fn is_synthetic(&self) -> bool {
        self.synthetic
    }
}

/// Declare each witness type: private binding, thread-bound, redacted, no derives.
macro_rules! opaque_witness {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        pub struct $name {
            binding: EffectContextBinding,
            _thread_bound: ThreadBound,
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "([REDACTED])"))
            }
        }

        impl $name {
            /// The private binding, for composition only. Never public.
            pub(crate) fn binding(&self) -> &EffectContextBinding {
                &self.binding
            }
        }
    };
}

opaque_witness!(
    /// Proof that the OWNER approved exactly one operation in this effect context.
    ///
    /// No production producer exists. A future owner-approval subsystem will mint it; until then it is
    /// fixture-only. It is NOT convertible from the legacy `OwnerApproval` enum — that enum is a
    /// caller-writable declaration and accepting it would reintroduce the forgery this type removes.
    VerifiedOwnerApprovalWitness
);

opaque_witness!(
    /// Proof that the current process was OBSERVED to be elevated.
    ///
    /// No production producer exists: obtaining one requires a real `TokenElevation` query, which is a
    /// machine effect and is deferred to a separately-authorised phase. It is NOT convertible from the
    /// legacy `Elevation` enum.
    VerifiedElevationWitness
);

opaque_witness!(
    /// Proof that the repository was verified at an exact baseline.
    ///
    /// No production producer exists. The baseline is stored as an opaque discriminator, never a path
    /// or commit string.
    VerifiedRepositoryBaselineWitness
);

opaque_witness!(
    /// Proof that the executable identity was verified and classified.
    ///
    /// No production producer exists. It carries a closed classification, never a path or signature.
    VerifiedExecutableIdentityWitness
);

/// Why an authorisation composition was refused. Closed, redacted, non-authorising.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectAuthorisationRefusal {
    /// The four witnesses did not describe the same effect context.
    ContextMismatch,
    /// The bounded validity window had elapsed.
    WindowExpired,
    /// The context did not require rollback and exact-zero residue, or approved no effect.
    IncompleteEffectContract,
    /// Any other failure, redacted.
    UnexpectedFailure,
}

/// The NON-AUTHORITATIVE reporting classification of a composition attempt.
///
/// This is what a caller may look at. It is deliberately not the grant: seeing `Composed` tells you a
/// grant exists inside the transition, not that you hold one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EffectAuthorisationClassification {
    /// All four witnesses agreed and the contract was complete.
    Composed,
    /// Composition was refused.
    Refused(EffectAuthorisationRefusal),
}

/// The opaque, consuming authorisation transition.
///
/// It cannot be constructed externally, cloned, copied, defaulted, serialised or persisted, cannot
/// cross a thread, and cannot survive a restart. It privately owns at most one attempt grant, released
/// only by consuming the transition — so one composition yields at most one grant.
///
/// Critically, it CANNOT be produced from the legacy `OperationGate`, from `GateOutcome`, or from any
/// combination of public enum values or booleans. The only route is [`compose_verified_authorisation`],
/// which demands four unforgeable witnesses.
pub struct VerifiedEffectAuthorisationTransition {
    classification: EffectAuthorisationClassification,
    grant: Option<crate::effect_grant::AuthorisedProofAttemptGrant>,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for VerifiedEffectAuthorisationTransition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "VerifiedEffectAuthorisationTransition({:?}, [REDACTED])",
            self.classification
        )
    }
}

impl VerifiedEffectAuthorisationTransition {
    /// The non-authoritative reporting classification.
    #[must_use]
    pub fn classification(&self) -> EffectAuthorisationClassification {
        self.classification
    }

    /// Take the attempt grant, CONSUMING the transition. `None` unless composition succeeded.
    #[must_use]
    pub fn into_authorised_attempt_grant(
        self,
    ) -> Option<crate::effect_grant::AuthorisedProofAttemptGrant> {
        self.grant
    }
}

/// Compose four verified witnesses into one authorisation transition.
///
/// Public, but unforgeable in practice: every argument is an opaque witness with no public
/// constructor, and all four are CONSUMED. No boolean, string or enum combination reaches this
/// function. Every consistency check happens internally, and a mismatch emits no grant at all.
#[must_use]
pub fn compose_verified_authorisation(
    owner: VerifiedOwnerApprovalWitness,
    elevation: VerifiedElevationWitness,
    repository: VerifiedRepositoryBaselineWitness,
    executable: VerifiedExecutableIdentityWitness,
) -> VerifiedEffectAuthorisationTransition {
    let refuse = |reason: EffectAuthorisationRefusal| VerifiedEffectAuthorisationTransition {
        classification: EffectAuthorisationClassification::Refused(reason),
        grant: None,
        _thread_bound: PhantomData,
    };

    let base = owner.binding();
    // Every witness must describe the SAME context: same project, phase, baseline, environment,
    // service, attempt, owner session, executable class, effect set and contract requirements.
    for other in [
        elevation.binding(),
        repository.binding(),
        executable.binding(),
    ] {
        if !base.matches(other) {
            return refuse(EffectAuthorisationRefusal::ContextMismatch);
        }
    }
    if base.is_expired() {
        return refuse(EffectAuthorisationRefusal::WindowExpired);
    }
    if !base.is_effect_contract_complete() {
        return refuse(EffectAuthorisationRefusal::IncompleteEffectContract);
    }

    let binding = *base;
    VerifiedEffectAuthorisationTransition {
        classification: EffectAuthorisationClassification::Composed,
        grant: Some(
            crate::effect_grant::AuthorisedProofAttemptGrant::from_composed_witnesses(binding),
        ),
        _thread_bound: PhantomData,
    }
}

// ---------------------------------------------------------------------------------------------
// FIXTURE-ONLY witness construction (feature `effect-witness-fixtures`).
//
// Explicit, non-default, and independent of this crate's `test-fixtures` feature (which pulls Windows
// and the pipe-security runtime). Nothing here touches a Windows API, a token, an owner queue or the
// repository, and every binding it produces is marked SYNTHETIC so a future live producer can refuse
// it outright.
// ---------------------------------------------------------------------------------------------

/// A fixture description of one effect context. Test scaffolding only.
#[cfg(any(test, feature = "effect-witness-fixtures"))]
#[derive(Clone, Copy)]
pub struct SyntheticEffectContext {
    project: u64,
    phase: u64,
    repository_baseline: u64,
    environment: u64,
    service_context: u64,
    proof_attempt: u64,
    owner_session: u64,
    executable_class: ExecutableIdentityClass,
    effect_set: ApprovedEffectSet,
    rollback: RollbackRequirement,
    residue: ResidueRequirement,
    window_millis: u64,
}

#[cfg(any(test, feature = "effect-witness-fixtures"))]
impl fmt::Debug for SyntheticEffectContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SyntheticEffectContext([REDACTED])")
    }
}

#[cfg(any(test, feature = "effect-witness-fixtures"))]
impl SyntheticEffectContext {
    /// A complete, valid synthetic context: one attempt, rollback required, exact-zero residue.
    #[must_use]
    pub fn valid() -> Self {
        Self {
            project: 1,
            phase: 1,
            repository_baseline: 1,
            environment: 1,
            service_context: 1,
            proof_attempt: 1,
            owner_session: 1,
            executable_class: ExecutableIdentityClass::DevelopmentBuild,
            effect_set: ApprovedEffectSet::ObservationOnly,
            rollback: RollbackRequirement::RequiredOnPassAndFailure,
            residue: ResidueRequirement::ExactlyZero,
            window_millis: 5_000,
        }
    }

    /// Vary one discriminator, so a test can prove witnesses from different contexts never compose.
    #[must_use]
    pub fn with_project(mut self, v: u64) -> Self {
        self.project = v;
        self
    }
    /// Vary the phase discriminator.
    #[must_use]
    pub fn with_phase(mut self, v: u64) -> Self {
        self.phase = v;
        self
    }
    /// Vary the repository-baseline discriminator.
    #[must_use]
    pub fn with_repository_baseline(mut self, v: u64) -> Self {
        self.repository_baseline = v;
        self
    }
    /// Vary the environment discriminator.
    #[must_use]
    pub fn with_environment(mut self, v: u64) -> Self {
        self.environment = v;
        self
    }
    /// Vary the service-context discriminator.
    #[must_use]
    pub fn with_service_context(mut self, v: u64) -> Self {
        self.service_context = v;
        self
    }
    /// Vary the proof-attempt discriminator.
    #[must_use]
    pub fn with_proof_attempt(mut self, v: u64) -> Self {
        self.proof_attempt = v;
        self
    }
    /// Vary the owner-session discriminator.
    #[must_use]
    pub fn with_owner_session(mut self, v: u64) -> Self {
        self.owner_session = v;
        self
    }
    /// Vary the executable classification.
    #[must_use]
    pub fn with_executable_class(mut self, v: ExecutableIdentityClass) -> Self {
        self.executable_class = v;
        self
    }
    /// Vary the approved effect set.
    #[must_use]
    pub fn with_effect_set(mut self, v: ApprovedEffectSet) -> Self {
        self.effect_set = v;
        self
    }
    /// Vary the rollback requirement.
    #[must_use]
    pub fn with_rollback(mut self, v: RollbackRequirement) -> Self {
        self.rollback = v;
        self
    }
    /// Vary the residue requirement.
    #[must_use]
    pub fn with_residue(mut self, v: ResidueRequirement) -> Self {
        self.residue = v;
        self
    }
    /// An already-elapsed window, so expiry can be tested without sleeping.
    #[must_use]
    pub fn expired(mut self) -> Self {
        self.window_millis = 0;
        self
    }

    fn to_binding(self) -> EffectContextBinding {
        EffectContextBinding {
            project: self.project,
            phase: self.phase,
            repository_baseline: self.repository_baseline,
            environment: self.environment,
            service_context: self.service_context,
            proof_attempt: self.proof_attempt,
            owner_session: self.owner_session,
            executable_class: self.executable_class,
            effect_set: self.effect_set,
            rollback: self.rollback,
            residue: self.residue,
            window_millis: self.window_millis,
            // ALWAYS synthetic. A fixture witness can never masquerade as a verified one.
            synthetic: true,
        }
    }
}

/// Build all four SYNTHETIC witnesses for one context. Fixture-only; performs no verification of any
/// kind and asserts nothing about the real machine.
#[cfg(any(test, feature = "effect-witness-fixtures"))]
#[must_use]
pub fn synthetic_witnesses(
    context: SyntheticEffectContext,
) -> (
    VerifiedOwnerApprovalWitness,
    VerifiedElevationWitness,
    VerifiedRepositoryBaselineWitness,
    VerifiedExecutableIdentityWitness,
) {
    let binding = context.to_binding();
    (
        VerifiedOwnerApprovalWitness {
            binding,
            _thread_bound: PhantomData,
        },
        VerifiedElevationWitness {
            binding,
            _thread_bound: PhantomData,
        },
        VerifiedRepositoryBaselineWitness {
            binding,
            _thread_bound: PhantomData,
        },
        VerifiedExecutableIdentityWitness {
            binding,
            _thread_bound: PhantomData,
        },
    )
}

/// Build ONE synthetic owner witness for a different context, so composition mismatch can be tested.
#[cfg(any(test, feature = "effect-witness-fixtures"))]
#[must_use]
pub fn synthetic_owner_witness(context: SyntheticEffectContext) -> VerifiedOwnerApprovalWitness {
    VerifiedOwnerApprovalWitness {
        binding: context.to_binding(),
        _thread_bound: PhantomData,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_agreeing_witnesses_compose() {
        let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());
        let t = compose_verified_authorisation(o, e, r, x);
        assert_eq!(
            t.classification(),
            EffectAuthorisationClassification::Composed
        );
        assert!(t.into_authorised_attempt_grant().is_some());
    }

    #[test]
    fn a_witness_from_another_context_never_composes() {
        let valid = SyntheticEffectContext::valid();
        for other in [
            valid.with_project(9),
            valid.with_phase(9),
            valid.with_repository_baseline(9),
            valid.with_environment(9),
            valid.with_service_context(9),
            valid.with_proof_attempt(9),
            valid.with_owner_session(9),
            valid.with_executable_class(ExecutableIdentityClass::Unverified),
            valid.with_effect_set(ApprovedEffectSet::ObservationAndTemporaryServiceLifecycle),
        ] {
            let owner = synthetic_owner_witness(other);
            let (_, e, r, x) = synthetic_witnesses(valid);
            let t = compose_verified_authorisation(owner, e, r, x);
            assert_eq!(
                t.classification(),
                EffectAuthorisationClassification::Refused(
                    EffectAuthorisationRefusal::ContextMismatch
                )
            );
            assert!(t.into_authorised_attempt_grant().is_none());
        }
    }

    #[test]
    fn an_expired_window_never_composes() {
        let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid().expired());
        let t = compose_verified_authorisation(o, e, r, x);
        assert_eq!(
            t.classification(),
            EffectAuthorisationClassification::Refused(EffectAuthorisationRefusal::WindowExpired)
        );
        assert!(t.into_authorised_attempt_grant().is_none());
    }

    #[test]
    fn an_incomplete_effect_contract_never_composes() {
        for ctx in [
            SyntheticEffectContext::valid().with_rollback(RollbackRequirement::NotRequired),
            SyntheticEffectContext::valid().with_residue(ResidueRequirement::Unconstrained),
            SyntheticEffectContext::valid().with_effect_set(ApprovedEffectSet::None),
        ] {
            let (o, e, r, x) = synthetic_witnesses(ctx);
            let t = compose_verified_authorisation(o, e, r, x);
            assert_eq!(
                t.classification(),
                EffectAuthorisationClassification::Refused(
                    EffectAuthorisationRefusal::IncompleteEffectContract
                )
            );
        }
    }

    #[test]
    fn witness_and_transition_debug_are_redacted() {
        let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());
        assert_eq!(format!("{o:?}"), "VerifiedOwnerApprovalWitness([REDACTED])");
        assert_eq!(format!("{e:?}"), "VerifiedElevationWitness([REDACTED])");
        assert_eq!(
            format!("{r:?}"),
            "VerifiedRepositoryBaselineWitness([REDACTED])"
        );
        assert_eq!(
            format!("{x:?}"),
            "VerifiedExecutableIdentityWitness([REDACTED])"
        );
        let t = compose_verified_authorisation(o, e, r, x);
        let rendered = format!("{t:?}");
        assert!(rendered.contains("[REDACTED]"), "{rendered}");
    }

    #[test]
    fn fixture_bindings_are_marked_synthetic() {
        // A future live producer must be able to tell a fixture witness from a verified one.
        let (o, _, _, _) = synthetic_witnesses(SyntheticEffectContext::valid());
        assert!(o.binding().is_synthetic());
    }
}
