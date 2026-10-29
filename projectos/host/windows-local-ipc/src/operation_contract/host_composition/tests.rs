//! Proofs for the Host production composition (§10A).
//!
//! WHAT IS PROVEN WHERE, stated once so no proof is assumed to live somewhere it does not:
//!
//! * The owner-signed PROGRAMME SOURCE — that the closure is verified before the allowlist is read,
//!   that substituted bytes never reach the parser, that an unlisted or ambiguous installation is
//!   refused — is proven in `projectos-host-identity`, beside the parser it belongs to.
//! * That a delegation naming another project or another repository is refused, and that a local
//!   `Revoked`/`Completed` beats a signed record claiming otherwise, is proven in
//!   `owner_programme_delegation.rs` against the identical verification order.
//! * Everything the COMPOSITION itself decides is proven here.
//!
//! The positive cases run through `compose_verified`, because no test can satisfy the embedded
//! production anchor — ProjectOS does not hold the owner's private key. The negative cases that sit
//! ABOVE the signature run through the public entry, which is how the ordering is proven.

use super::*;

use crate::fixture_session::fixture_bound_session;
use crate::operation_contract::request_replay::{
    AlwaysFreshReplayLedger, FixtureRequestReplayLedger, RefusingReplayLedger, ReplayRefusal,
    RequestReplayIdentity, RequestReplayLedger,
};
use crate::operation_contract::{
    binding_digest, BindingSubject, OwnerProgrammeDelegation, RejectionReason, ResponseState,
    APPROVAL_REF_LEN, MAX_DELEGATED_PHASES,
};
use crate::owner_programme_delegation::{DelegationLocalState, FixtureDurableDelegationStateStore};
use projectos_host_core::{
    FixtureClock, FixtureIpcSessionVerifier, InMemoryRequestAdmissionStore, IpcSessionVerifier,
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The exact case
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const PROJECT: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
const REPOSITORY: [u8; DELEGATION_DIGEST_LEN] = [0x22; DELEGATION_DIGEST_LEN];
const PLAN: [u8; DELEGATION_DIGEST_LEN] = [0x33; DELEGATION_DIGEST_LEN];
const PLAN_DIGEST: [u8; DELEGATION_DIGEST_LEN] = [0x44; DELEGATION_DIGEST_LEN];
const PHASE: [u8; DELEGATION_DIGEST_LEN] = [0x55; DELEGATION_DIGEST_LEN];
const CANDIDATE: [u8; BINDING_DIGEST_LEN] = [0x66; BINDING_DIGEST_LEN];
const SUBJECT_DIGEST: [u8; BINDING_DIGEST_LEN] = [0x77; BINDING_DIGEST_LEN];
const MODEL: [u8; DELEGATION_DIGEST_LEN] = [0x88; DELEGATION_DIGEST_LEN];
const CREDENTIAL: [u8; DELEGATION_DIGEST_LEN] = [0x99; DELEGATION_DIGEST_LEN];
const DELEGATION_ID: [u8; DELEGATION_DIGEST_LEN] = [0xaa; DELEGATION_DIGEST_LEN];
const OTHER: [u8; DELEGATION_DIGEST_LEN] = [0xee; DELEGATION_DIGEST_LEN];

const NOW: u64 = 1_000;
const EXPIRES: u64 = 2_000;
const CEILING: u64 = 5_000_000;
const COMMITTED: u64 = 1_000_000;
const COST: u64 = 200_000;
const EPOCH: u64 = 42;

fn programme() -> ExpectedProgramme {
    ExpectedProgramme::fixture(PROJECT, REPOSITORY)
}

fn clock() -> HostClockReading {
    HostClockReading::fixture(NOW)
}

/// The sealed attestation the public entry consumes. A test cannot produce a production-signed
/// manifest — that needs the owner's private key — so the fixture route stands in for it, and the
/// proofs it enables are about what the COMPOSITION does, never about the signature.
fn attested_programme() -> projectos_host_identity::AttestedInstallationProgramme {
    projectos_host_identity::AttestedInstallationProgramme::fixture(PROJECT, REPOSITORY)
}

fn delegation() -> OwnerProgrammeDelegation {
    let mut allowed_phases = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
    allowed_phases[0] = PHASE;
    OwnerProgrammeDelegation {
        delegation_id: DELEGATION_ID,
        owner: [0xbb; DELEGATION_DIGEST_LEN],
        project: PROJECT,
        repository: REPOSITORY,
        plan: PLAN,
        plan_digest: PLAN_DIGEST,
        allowed_phases,
        allowed_phase_count: 1,
        operation: OperationClass::IndependentGatekeeperReview,
        model_policy: MODEL,
        credential_ref: CREDENTIAL,
        budget_ceiling_micro_usd: CEILING,
        expires_at_epoch_s: EXPIRES,
        revoked_or_completed: false,
    }
}

fn verified() -> VerifiedOwnerProgrammeDelegation {
    VerifiedOwnerProgrammeDelegation::for_test(delegation())
}

/// The digest the HOST will compute for the exact case. A request that claims anything else is
/// asking about a different subject and must be refused.
fn exact_binding() -> [u8; BINDING_DIGEST_LEN] {
    binding_digest(&BindingSubject {
        project: PROJECT,
        repository: REPOSITORY,
        plan: PLAN,
        plan_digest: PLAN_DIGEST,
        phase: PHASE,
        candidate_digest: CANDIDATE,
        operation: OperationClass::IndependentGatekeeperReview,
        model_policy: MODEL,
        credential_ref: CREDENTIAL,
    })
}

fn correlation(seed: u8) -> [u8; CORRELATION_LEN] {
    [seed; CORRELATION_LEN]
}

fn approval_ref() -> [u8; APPROVAL_REF_LEN] {
    DELEGATION_ID
}

fn request(seed: u8, sequence: u64) -> ProtectedOperationRequest {
    ProtectedOperationRequest::new(
        correlation(seed),
        sequence,
        EPOCH,
        exact_binding(),
        OperationClass::IndependentGatekeeperReview,
        approval_ref(),
        SUBJECT_DIGEST,
    )
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Fixture ports
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A plan authority that answers, or cannot.
struct Plan(Option<()>);
/// The approved baseline commit every fixture plan authority states (PROJECTOS-HOST-REVIEW-PATH1B).
const FIXTURE_BASELINE: [u8; super::BASELINE_COMMIT_LEN] = [0xb4; super::BASELINE_COMMIT_LEN];

impl HostPlanAuthority for Plan {
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        self.0.map(|()| PLAN)
    }
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        self.0.map(|()| PLAN_DIGEST)
    }
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        self.0.map(|()| PHASE)
    }
    fn approved_baseline(&self) -> Option<[u8; super::BASELINE_COMMIT_LEN]> {
        Some(FIXTURE_BASELINE)
    }
}

/// A plan authority that establishes the plan, its digest and the phase - and has NO approved baseline
/// commit for it (PROJECTOS-HOST-REVIEW-PATH1B).
struct NoBaselinePlan;
impl HostPlanAuthority for NoBaselinePlan {
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(PLAN)
    }
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(PLAN_DIGEST)
    }
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(PHASE)
    }
    fn approved_baseline(&self) -> Option<[u8; super::BASELINE_COMMIT_LEN]> {
        None
    }
}

/// A plan authority that answers a DIFFERENT plan/phase than the owner delegated.
struct WrongPlan {
    plan: [u8; DELEGATION_DIGEST_LEN],
    plan_digest: [u8; DELEGATION_DIGEST_LEN],
    phase: [u8; DELEGATION_DIGEST_LEN],
}
impl HostPlanAuthority for WrongPlan {
    fn plan(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.plan)
    }
    fn plan_digest(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.plan_digest)
    }
    fn phase(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        Some(self.phase)
    }
    fn approved_baseline(&self) -> Option<[u8; super::BASELINE_COMMIT_LEN]> {
        Some(FIXTURE_BASELINE)
    }
}

struct Closure(Option<([u8; DELEGATION_DIGEST_LEN], [u8; DELEGATION_DIGEST_LEN])>);
impl SignedExecutionClosureFacts for Closure {
    fn model_policy(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        self.0.map(|(m, _)| m)
    }
    fn credential_ref(&self) -> Option<[u8; DELEGATION_DIGEST_LEN]> {
        self.0.map(|(_, c)| c)
    }
}

struct Candidate(Option<[u8; BINDING_DIGEST_LEN]>);
impl CommittedCandidateSource for Candidate {
    fn candidate_digest(&self) -> Option<[u8; BINDING_DIGEST_LEN]> {
        self.0
    }
}

struct Cost(Option<u64>);
impl AdmittedCostSource for Cost {
    fn admitted_cost_micro_usd(&self) -> Option<u64> {
        self.0
    }
}

/// A ONE-SHOT inbox: it answers for exactly one correlation, exactly once, and counts every ask.
///
/// COUNTING IS THE POINT. "Composition reads the subject once" is only a real claim if something
/// notices a second read, and a fixture that silently answered twice would let a regression through.
struct Inbox {
    digest: Option<[u8; BINDING_DIGEST_LEN]>,
    only_for: [u8; CORRELATION_LEN],
    consumed: bool,
    asks: usize,
}
impl Inbox {
    fn holding(digest: [u8; BINDING_DIGEST_LEN], only_for: [u8; CORRELATION_LEN]) -> Self {
        Self {
            digest: Some(digest),
            only_for,
            consumed: false,
            asks: 0,
        }
    }
    fn empty() -> Self {
        Self {
            digest: None,
            only_for: correlation(0),
            consumed: false,
            asks: 0,
        }
    }
}
impl OneShotRequestSubject for Inbox {
    fn consume_once(
        &mut self,
        correlation: &[u8; CORRELATION_LEN],
    ) -> Option<[u8; BINDING_DIGEST_LEN]> {
        self.asks += 1;
        if self.consumed || *correlation != self.only_for {
            return None;
        }
        self.consumed = true;
        self.digest
    }
}

/// Everything a composition needs, held together so a test can vary exactly one thing.
struct Rig {
    plan: Box<dyn HostPlanAuthority>,
    closure: Closure,
    candidate: Candidate,
    cost: Cost,
    inbox: Inbox,
    budget: FixtureBudgetLedger,
    /// The HOST-WIDE replay history (§10C). It belongs to the rig rather than to `Live` on purpose:
    /// replay protection that lived on the session would be forgotten with the session, which is
    /// the whole failure this checkpoint closes.
    replay: FixtureRequestReplayLedger,
}

impl Rig {
    /// The EXACT case: every source answers what the owner delegated.
    fn exact(seed: u8) -> Self {
        Self {
            plan: Box::new(Plan(Some(()))),
            closure: Closure(Some((MODEL, CREDENTIAL))),
            candidate: Candidate(Some(CANDIDATE)),
            cost: Cost(Some(COST)),
            inbox: Inbox::holding(SUBJECT_DIGEST, correlation(seed)),
            budget: FixtureBudgetLedger::holding(CEILING, COMMITTED),
            replay: FixtureRequestReplayLedger::empty(),
        }
    }
}

/// One live session, its peer and its ONE admission history — opened once, exactly as a Host must.
struct Live {
    _clock: FixtureClock,
    verifier: FixtureIpcSessionVerifier,
    session: BoundIpcSession,
    store: InMemoryRequestAdmissionStore,
}

impl Live {
    fn open() -> Self {
        let clock = FixtureClock::new(150);
        let verifier = FixtureIpcSessionVerifier::new();
        let session = fixture_bound_session(&clock, &verifier);
        let store = InMemoryRequestAdmissionStore::for_session(&session);
        Self {
            _clock: clock,
            verifier,
            session,
            store,
        }
    }
    fn peer(&self) -> TrustedPeerContext {
        TrustedPeerContext::for_admitted_connection(
            self.verifier.connection_id(),
            self.verifier.handshake_generation(),
        )
    }
}

/// Compose one request through the verified half, against this rig and this live session.
fn compose(
    live: &mut Live,
    rig: &mut Rig,
    request: &ProtectedOperationRequest,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    let v = verified();
    let peer = live.peer();
    // DISJOINT FIELDS, BORROWED DIRECTLY. An earlier version shuffled the budget out with
    // `mem::replace` and put it back, which read as though there were an aliasing conflict here.
    // There is not: `sources` borrows four other fields of `rig`, and the borrow checker is happy to
    // hand out `&mut rig.budget` alongside them. Raised by the ECC code review.
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        request,
        EPOCH,
    )
}

/// Compose one request against an EXPLICIT budget ledger, for the §10D proofs that hand the
/// composition the REAL canonical one instead of the in-memory fixture.
fn compose_with_ledger(
    live: &mut Live,
    rig: &mut Rig,
    ledger: &mut dyn CanonicalBudgetLedger,
    request: &ProtectedOperationRequest,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    let v = verified();
    let peer = live.peer();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        ledger,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        request,
        EPOCH,
    )
}

/// Compose one request against an EXPLICIT replay ledger, for the §10C proofs that need to supply a
/// refusing or an always-fresh one.
fn compose_with_replay(
    live: &mut Live,
    rig: &mut Rig,
    replay: &mut dyn RequestReplayLedger,
    request: &ProtectedOperationRequest,
) -> Result<ComposedProtectedOperation, CompositionRefusal> {
    let v = verified();
    let peer = live.peer();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        replay,
        &peer,
        request,
        EPOCH,
    )
}

fn refusal_reason(
    outcome: &Result<ComposedProtectedOperation, CompositionRefusal>,
) -> RejectionReason {
    match outcome {
        Err(CompositionRefusal::Rejected(response)) => response.reason(),
        other => panic!("expected an evaluator refusal, got {other:?}"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// G — AUTHORITY. The exact case, and everything that must remain a refusal.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (G) THE ONE PATH THAT WORKS. Exact composed inputs reach the EXISTING evaluator and it mints the
/// one authority — stamped from the sealed rungs, not from the request.
#[test]
fn the_exact_composed_case_reaches_the_evaluator_and_is_authorised() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    assert_eq!(composed.reservation().correlation(), &correlation(1));
    assert_eq!(composed.reservation().cost_micro_usd(), COST);

    let (authority, _reservation) = composed.into_parts();
    assert_eq!(authority.correlation(), &correlation(1));
    assert_eq!(authority.sequence(), 1);
    assert_eq!(authority.operation(), COMPOSED_OPERATION);
    assert_eq!(authority.delegation_id(), &DELEGATION_ID);
    assert_eq!(authority.binding_digest(), &exact_binding());
    assert_eq!(authority.candidate_digest(), &CANDIDATE);
    assert_eq!(authority.parameter_digest(), &SUBJECT_DIGEST);
    assert_eq!(authority.admitted_cost_micro_usd(), COST);
    assert!(authority.is_bound_to(
        live.verifier.connection_id(),
        live.verifier.handshake_generation()
    ));
    // The reservation is still HELD: authority is admission, not spend, and nothing has executed.
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED - COST);
}

/// (G) THE COMPOSED CLASS IS THE ONLY DELEGABLE ONE, and the two read-only classes are not.
///
/// Asserted against the enum's own rule rather than restated, so the constant here cannot drift away
/// from what §9 will actually admit.
#[test]
fn only_the_composed_class_may_be_delegated() {
    assert!(COMPOSED_OPERATION.may_be_delegated_by_programme());
    assert!(!OperationClass::ProviderIdentityRead.may_be_delegated_by_programme());
    assert!(!OperationClass::StagingRead.may_be_delegated_by_programme());
}

/// (G) A READ-ONLY CLASS CANNOT USE THE COMPOSITION. Composing for `ProviderIdentityRead` or
/// `StagingRead` is refused at C4, whatever else agrees — the delegation names one class and the
/// request must be asking for that same class.
#[test]
fn a_read_only_class_cannot_use_the_composition() {
    for class in [
        OperationClass::ProviderIdentityRead,
        OperationClass::StagingRead,
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let req = ProtectedOperationRequest::new(
            correlation(1),
            1,
            EPOCH,
            exact_binding(),
            class,
            approval_ref(),
            SUBJECT_DIGEST,
        );
        let outcome = compose(&mut live, &mut rig, &req);
        assert_eq!(
            refusal_reason(&outcome),
            RejectionReason::OwnerPresenceGateOpen,
            "{class:?} must not reach authority through the composition"
        );
        // And its reservation was released, so a refused class cannot drain the ceiling.
        assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// C — HOST FACTS. A claim never becomes a fact.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (C) A WRONG CLAIM ABOUT THE SUBJECT CANNOT ALTER WHAT THE HOST RESOLVED.
///
/// The caller states its belief as ONE value — the binding digest on the wire — so every "wrong X
/// claim" is the same experiment with a different field, and each must be refused rather than
/// merging into the Host's answer.
#[test]
fn no_caller_claim_can_alter_a_host_resolved_fact() {
    let mutations: [(&str, BindingSubject); 8] = [
        (
            "project",
            BindingSubject {
                project: OTHER,
                ..exact_subject()
            },
        ),
        (
            "repository",
            BindingSubject {
                repository: OTHER,
                ..exact_subject()
            },
        ),
        (
            "plan",
            BindingSubject {
                plan: OTHER,
                ..exact_subject()
            },
        ),
        (
            "plan_digest",
            BindingSubject {
                plan_digest: OTHER,
                ..exact_subject()
            },
        ),
        (
            "phase",
            BindingSubject {
                phase: OTHER,
                ..exact_subject()
            },
        ),
        (
            "candidate",
            BindingSubject {
                candidate_digest: OTHER,
                ..exact_subject()
            },
        ),
        (
            "model_policy",
            BindingSubject {
                model_policy: OTHER,
                ..exact_subject()
            },
        ),
        (
            "credential_ref",
            BindingSubject {
                credential_ref: OTHER,
                ..exact_subject()
            },
        ),
    ];
    for (what, subject) in mutations {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let req = ProtectedOperationRequest::new(
            correlation(1),
            1,
            EPOCH,
            binding_digest(&subject),
            OperationClass::IndependentGatekeeperReview,
            approval_ref(),
            SUBJECT_DIGEST,
        );
        let outcome = compose(&mut live, &mut rig, &req);
        assert_eq!(
            refusal_reason(&outcome),
            RejectionReason::BindingMismatch,
            "a caller claiming a different {what} must be refused, not agreed with"
        );
    }
}

fn exact_subject() -> BindingSubject {
    BindingSubject {
        project: PROJECT,
        repository: REPOSITORY,
        plan: PLAN,
        plan_digest: PLAN_DIGEST,
        phase: PHASE,
        candidate_digest: CANDIDATE,
        operation: OperationClass::IndependentGatekeeperReview,
        model_policy: MODEL,
        credential_ref: CREDENTIAL,
    }
}

/// (C) THE PARAMETER DIGEST IS THE INBOX'S, NEVER THE CALLER'S. A request claiming a subject the
/// Host did not read is refused, so a caller cannot name a question it never wrote down.
#[test]
fn a_claimed_parameter_digest_that_is_not_the_inboxs_is_refused() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let req = ProtectedOperationRequest::new(
        correlation(1),
        1,
        EPOCH,
        exact_binding(),
        OperationClass::IndependentGatekeeperReview,
        approval_ref(),
        OTHER,
    );
    assert_eq!(
        refusal_reason(&compose(&mut live, &mut rig, &req)),
        RejectionReason::BindingMismatch
    );
}

/// (C) A CLAIMED APPROVAL REFERENCE THAT IS NOT THE VERIFIED DELEGATION'S IS REFUSED.
#[test]
fn a_claimed_approval_reference_for_another_delegation_is_refused() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let req = ProtectedOperationRequest::new(
        correlation(1),
        1,
        EPOCH,
        exact_binding(),
        OperationClass::IndependentGatekeeperReview,
        OTHER,
        SUBJECT_DIGEST,
    );
    assert_eq!(
        refusal_reason(&compose(&mut live, &mut rig, &req)),
        RejectionReason::BindingMismatch
    );
}

/// (C) A HOST SOURCE THAT CANNOT ANSWER REFUSES, and it refuses BEFORE the inbox is touched.
///
/// The one-shot subject is a resource that cannot be un-spent, so every source that could have
/// refused for free must be consulted first. The ask count proves it rather than the comment.
#[test]
fn an_unavailable_host_source_refuses_before_the_inbox_is_consumed() {
    struct Case(&'static str);
    for case in [
        Case("plan"),
        Case("baseline"),
        Case("closure"),
        Case("candidate"),
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        match case.0 {
            "plan" => rig.plan = Box::new(Plan(None)),
            // AN ABSENT BASELINE REFUSES: everything else about the plan is established, and it is
            // still not a plan a candidate can be measured against.
            "baseline" => rig.plan = Box::new(NoBaselinePlan),
            "closure" => rig.closure = Closure(None),
            _ => rig.candidate = Candidate(None),
        }
        let outcome = compose(&mut live, &mut rig, &request(1, 1));
        assert!(
            matches!(
                outcome,
                Err(CompositionRefusal::PlanAuthorityUnavailable)
                    | Err(CompositionRefusal::ClosureFactsUnavailable)
                    | Err(CompositionRefusal::CandidateUnavailable)
            ),
            "{} must refuse, got {outcome:?}",
            case.0
        );
        if case.0 == "baseline" {
            assert!(matches!(
                outcome,
                Err(CompositionRefusal::PlanAuthorityUnavailable)
            ));
        }
        assert_eq!(
            rig.inbox.asks, 0,
            "{} refused, so nothing was consumed",
            case.0
        );
        assert_eq!(
            rig.budget.available_micro_usd(),
            CEILING - COMMITTED,
            "{} refused, so nothing was reserved",
            case.0
        );
    }
}

/// (C) A HOST PLAN AUTHORITY THAT DISAGREES WITH THE OWNER'S RECORD OPENS NOTHING.
///
/// This is the cross-check that makes an unsealed plan port safe: the plan, its digest and the phase
/// are all compared against what the owner delegated, so a port answering wrongly produces a refusal.
#[test]
fn a_plan_authority_that_disagrees_with_the_owner_is_refused() {
    for wrong in [
        WrongPlan {
            plan: OTHER,
            plan_digest: PLAN_DIGEST,
            phase: PHASE,
        },
        WrongPlan {
            plan: PLAN,
            plan_digest: OTHER,
            phase: PHASE,
        },
        WrongPlan {
            plan: PLAN,
            plan_digest: PLAN_DIGEST,
            phase: OTHER,
        },
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        rig.plan = Box::new(wrong);
        let outcome = compose(&mut live, &mut rig, &request(1, 1));
        assert_eq!(
            refusal_reason(&outcome),
            RejectionReason::OwnerPresenceGateOpen
        );
        assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    }
}

/// (C) A CLOSURE THAT REPORTS A MODEL OR CREDENTIAL THE OWNER DID NOT DELEGATE OPENS NOTHING.
#[test]
fn closure_facts_that_disagree_with_the_owner_are_refused() {
    for pair in [(OTHER, CREDENTIAL), (MODEL, OTHER)] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        rig.closure = Closure(Some(pair));
        assert_eq!(
            refusal_reason(&compose(&mut live, &mut rig, &request(1, 1))),
            RejectionReason::OwnerPresenceGateOpen
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// D — THE ONE-SHOT INBOX
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (D) THE SUBJECT IS READ EXACTLY ONCE, and its digest is what the facts carry.
#[test]
fn the_subject_is_consumed_exactly_once() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    assert_eq!(rig.inbox.asks, 1, "one composition, one read");
    let (authority, _) = composed.into_parts();
    assert_eq!(authority.parameter_digest(), &SUBJECT_DIGEST);
}

/// (D) AN ABSENT SUBJECT REFUSES, and the reservation taken a moment earlier is given straight back.
///
/// The budget now runs BEFORE the inbox, so this is the case that proves a reservation is reversible
/// where a consumed inbox entry is not: capacity set aside for a question with no subject returns in
/// full.
#[test]
fn an_absent_subject_refuses_and_releases_its_reservation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    rig.inbox = Inbox::empty();
    assert!(matches!(
        compose(&mut live, &mut rig, &request(1, 1)),
        Err(CompositionRefusal::RequestSubjectUnavailable)
    ));
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (D) A SUBJECT FOR ANOTHER CORRELATION ANSWERS NOTHING. The inbox is asked about the correlation
/// this request carries, so one request cannot read another's subject.
#[test]
fn a_subject_for_another_correlation_is_refused() {
    let mut live = Live::open();
    let mut rig = Rig::exact(9);
    assert!(matches!(
        compose(&mut live, &mut rig, &request(1, 1)),
        Err(CompositionRefusal::RequestSubjectUnavailable)
    ));
}

/// (D) A CONSUMED IDENTITY CANNOT ANSWER AGAIN. One shot means one shot, and composition does not
/// keep its own second opinion about that — it asks the accepted contract and takes the answer.
#[test]
fn a_consumed_subject_cannot_answer_a_second_composition() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    assert!(compose(&mut live, &mut rig, &request(1, 1)).is_ok());
    // A second question under the same correlation: the inbox has spent it.
    let mut rig2 = Rig::exact(1);
    rig2.inbox = std::mem::replace(&mut rig.inbox, Inbox::empty());
    assert!(matches!(
        compose(&mut live, &mut rig2, &request(1, 2)),
        Err(CompositionRefusal::RequestSubjectUnavailable)
    ));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// E — SESSION AND ADMISSION. One live session, one continuous history.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (E) THE SAME LIVE SESSION USES THE SAME ADMISSION HISTORY ACROSS COMPOSITIONS, and a replayed
/// correlation is refused by it.
///
/// Composition takes the store as `&mut dyn RequestAdmissionStore` and never opens one, so there is
/// no version of this that resets a session's history between calls — the shape is the guarantee.
#[test]
fn one_live_session_keeps_one_admission_history() {
    let mut live = Live::open();
    let mut first = Rig::exact(1);
    assert!(compose(&mut live, &mut first, &request(1, 1)).is_ok());

    // The SAME store, a NEW request: the second is admitted and the history has both.
    let mut second = Rig::exact(2);
    assert!(compose(&mut live, &mut second, &request(2, 2)).is_ok());

    // And the first correlation is now a replay on that same history.
    let mut replay = Rig::exact(1);
    let outcome = compose(&mut live, &mut replay, &request(1, 3));
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::AdmissionRefused(
                RequestAdmissionError::CorrelationReplayed
            ))
        ),
        "got {outcome:?}"
    );
    // Nothing ran, so the replay's reservation was released.
    assert_eq!(replay.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (E) A SEQUENCE THAT DOES NOT ADVANCE IS REFUSED. A repeat and a rewind get the same answer.
#[test]
fn a_stale_sequence_is_refused_on_the_live_session() {
    let mut live = Live::open();
    let mut first = Rig::exact(1);
    assert!(compose(&mut live, &mut first, &request(1, 5)).is_ok());

    let mut stale = Rig::exact(2);
    let outcome = compose(&mut live, &mut stale, &request(2, 4));
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::AdmissionRefused(
                RequestAdmissionError::SequenceNotAdvancing
            ))
        ),
        "got {outcome:?}"
    );
}

/// (E) A STORE BOUND TO ANOTHER SESSION ANSWERS NOTHING. Composition cannot be handed one session's
/// history and another's session.
#[test]
fn a_store_from_another_session_is_refused() {
    let mut live = Live::open();
    let other = Live::open();
    live.store = InMemoryRequestAdmissionStore::for_session(&other.session);
    let mut rig = Rig::exact(1);
    let outcome = compose(&mut live, &mut rig, &request(1, 1));
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::AdmissionRefused(
                RequestAdmissionError::StoreNotBoundToSession
            ))
        ),
        "got {outcome:?}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// B — HOST DELEGATION STATUS
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (B) THE STATUS IS THE STORE'S WORD, FOR EXACTLY ONE DELEGATION.
#[test]
fn the_durable_store_supplies_the_state_for_exactly_one_delegation() {
    for state in [
        DelegationLocalState::Active,
        DelegationLocalState::Revoked,
        DelegationLocalState::Completed,
    ] {
        let store = FixtureDurableDelegationStateStore::holding(DELEGATION_ID, state);
        let status = HostDelegationStatus::from_durable_store(&store, &DELEGATION_ID)
            .expect("the store holds this delegation");
        assert_eq!(status.state(), state);
        assert_eq!(status.delegation_id(), &DELEGATION_ID);

        // A status is never transferable: the store answers about the id it holds and no other.
        assert_eq!(
            HostDelegationStatus::from_durable_store(&store, &OTHER),
            Err(DelegationRefusal::LocalStatusUnavailable),
            "a store must not answer about a delegation it does not hold"
        );
    }
}

/// (B) SEC-L1 — AN UNSIGNED RECORD NEVER REACHES THE DURABLE DELEGATION REGISTRY.
///
/// ## What this replaces, and why
///
/// This test previously asserted the OPPOSITE ordering: that an unavailable delegation state refused
/// BEFORE the signature was consulted. That was a true description of the code and it was a
/// membership oracle. Every decodable record — forged, expired, or addressed to someone else — made
/// the Host look its delegation id up in its own registry, and the two outcomes were
/// distinguishable: an id the Host holds carried on to the signature check, an id it does not know
/// refused at the store. With §10B that registry is a real filesystem store, so the leak would also
/// have had a timing and a filesystem-activity component.
///
/// ## What is proven now
///
/// Not merely that the refusal variant changed. The store COUNTS its calls, and the count is zero:
/// the registry is not consulted at all. A test that only compared refusal variants would still pass
/// if the read happened and its answer were thrown away, which is exactly the case the side channels
/// would still leak.
///
/// The record below decodes and its signature can never satisfy the owner's embedded anchor —
/// ProjectOS does not hold the owner's private key and must never hold it.
#[test]
fn an_unsigned_record_never_reaches_the_delegation_registry() {
    let bytes = crate::owner_programme_delegation::test_decodable_record_bytes(
        DELEGATION_ID,
        PROJECT,
        REPOSITORY,
    );
    let record =
        crate::owner_programme_delegation::decode_signed_owner_programme_delegation(&bytes)
            .expect("a well-formed record");
    let store = crate::owner_programme_delegation::CountingDelegationStateStore::holding(
        DELEGATION_ID,
        DelegationLocalState::Active,
    );

    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let peer = live.peer();
    let attested = attested_programme();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_protected_operation(
        &record,
        &attested,
        &clock(),
        &store,
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::DelegationRefused(
                DelegationRefusal::SignatureRefused
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(
        store.asks(),
        0,
        "SEC-L1: an unauthenticated record must not cause a delegation-registry lookup"
    );
    assert_eq!(
        rig.inbox.asks, 0,
        "nothing above the signature may spend the inbox"
    );
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (B) SEC-L1 — THE REFUSAL IS IDENTICAL WHETHER OR NOT THE HOST HOLDS THAT DELEGATION.
///
/// The oracle is only useful if the caller can TELL THE TWO CASES APART. Same unsigned record, three
/// registries — one holding exactly this delegation, one holding a different one, one holding
/// nothing — and one indistinguishable answer, with no lookup in any of them. There is nothing in
/// the response to correlate with membership.
#[test]
fn registry_membership_is_indistinguishable_to_an_unsigned_caller() {
    use crate::owner_programme_delegation::CountingDelegationStateStore;

    let bytes = crate::owner_programme_delegation::test_decodable_record_bytes(
        DELEGATION_ID,
        PROJECT,
        REPOSITORY,
    );
    let record =
        crate::owner_programme_delegation::decode_signed_owner_programme_delegation(&bytes)
            .expect("a well-formed record");

    for store in [
        CountingDelegationStateStore::holding(DELEGATION_ID, DelegationLocalState::Active),
        CountingDelegationStateStore::holding(DELEGATION_ID, DelegationLocalState::Revoked),
        CountingDelegationStateStore::holding(OTHER, DelegationLocalState::Active),
        CountingDelegationStateStore::empty(),
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let peer = live.peer();
        let attested = attested_programme();
        let mut sources = HostRequestSources {
            plan: rig.plan.as_ref(),
            closure: &rig.closure,
            candidate: &rig.candidate,
            cost: &rig.cost,
            subject: &mut rig.inbox,
        };
        let outcome = compose_protected_operation(
            &record,
            &attested,
            &clock(),
            &store,
            &mut sources,
            &mut rig.budget,
            &live.session,
            &mut live.store,
            &mut rig.replay,
            &peer,
            &request(1, 1),
            EPOCH,
        );
        assert!(
            matches!(
                outcome,
                Err(CompositionRefusal::DelegationRefused(
                    DelegationRefusal::SignatureRefused
                ))
            ),
            "every registry must give the same answer; got {outcome:?}"
        );
        assert_eq!(store.asks(), 0, "and none of them may be read");
    }
}

/// (B) SEC-L1 — A RECORD FOR ANOTHER INSTALLATION ALSO STOPS BEFORE THE REGISTRY.
///
/// Relevance is part of the pre-registry gate, not only the signature. A delegation naming another
/// project or another checkout is refused with `ProgrammeMismatch` and this installation's registry
/// is never consulted — so one installation cannot be used to probe another's delegation list.
///
/// Note the ordering this proves: the signature is checked FIRST, so a record for another project
/// that is ALSO unsigned refuses with `SignatureRefused`. Reaching `ProgrammeMismatch` from outside
/// would require the owner's private key, which is why this asserts the pre-gate function directly.
#[test]
fn a_record_for_another_installation_stops_before_the_registry() {
    let other_project = [0x5au8; DELEGATION_DIGEST_LEN];
    let bytes = crate::owner_programme_delegation::test_decodable_record_bytes(
        DELEGATION_ID,
        other_project,
        REPOSITORY,
    );
    let record =
        crate::owner_programme_delegation::decode_signed_owner_programme_delegation(&bytes)
            .expect("a well-formed record");
    let store = crate::owner_programme_delegation::CountingDelegationStateStore::holding(
        DELEGATION_ID,
        DelegationLocalState::Active,
    );
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let peer = live.peer();
    let attested = attested_programme();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_protected_operation(
        &record,
        &attested,
        &clock(),
        &store,
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::DelegationRefused(
                DelegationRefusal::SignatureRefused
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(store.asks(), 0);
}

/// (B) A REAL, DECODABLE RECORD WITH AN ACTIVE LOCAL STATE IS STILL REFUSED — by the signature.
///
/// The complement of the proof above, and the reason production is fail-closed twice over: even with
/// a durable store answering `Active`, no record ProjectOS can produce satisfies the owner's embedded
/// anchor. ProjectOS does not hold the owner's private key and must never hold it.
#[test]
fn an_active_local_state_still_cannot_manufacture_an_owner_signature() {
    let bytes = crate::owner_programme_delegation::test_decodable_record_bytes(
        DELEGATION_ID,
        PROJECT,
        REPOSITORY,
    );
    let record =
        crate::owner_programme_delegation::decode_signed_owner_programme_delegation(&bytes)
            .expect("a well-formed record");
    let store =
        FixtureDurableDelegationStateStore::holding(DELEGATION_ID, DelegationLocalState::Active);

    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let peer = live.peer();
    let attested = attested_programme();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_protected_operation(
        &record,
        &attested,
        &clock(),
        &store,
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::DelegationRefused(
                DelegationRefusal::SignatureRefused
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(rig.inbox.asks, 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// F — BUDGET: check, reserve, then commit or release
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// (F) AN UNKNOWN COST IS REFUSED, never spent as zero.
#[test]
fn an_unknown_cost_is_refused() {
    let mut budget = FixtureBudgetLedger::holding(CEILING, COMMITTED);
    assert_eq!(
        budget.reserve_for_test(correlation(1), None),
        Err(BudgetRefusal::CostUnknown)
    );
    assert_eq!(budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (F) OVERFLOW IS REFUSED. A figure that wrapped would report a tiny commitment against a huge one.
#[test]
fn arithmetic_overflow_is_refused() {
    let mut budget = FixtureBudgetLedger::holding(u64::MAX, u64::MAX - 1);
    assert_eq!(
        budget.reserve_for_test(correlation(1), Some(u64::MAX)),
        Err(BudgetRefusal::ArithmeticOverflow)
    );
}

/// (F) OVER THE OWNER'S CEILING IS REFUSED, and the boundary is exact: at the ceiling is allowed,
/// one micro-USD past it is not.
#[test]
fn the_ceiling_is_a_ceiling() {
    let mut budget = FixtureBudgetLedger::holding(CEILING, COMMITTED);
    assert_eq!(
        budget.reserve_for_test(correlation(1), Some(CEILING - COMMITTED + 1)),
        Err(BudgetRefusal::CeilingExceeded)
    );
    assert!(budget
        .reserve_for_test(correlation(1), Some(CEILING - COMMITTED))
        .is_ok());
}

/// (F) A RESERVATION REDUCES WHAT IS AVAILABLE, and a second one sees the first.
///
/// This is the whole point of reserving. Under the read-only snapshot the §9 review criticised, both
/// requests would have observed the same remaining budget and both would have been admitted.
#[test]
fn a_reservation_reduces_available_budget_for_the_next_one() {
    let mut budget = FixtureBudgetLedger::holding(1_000, 0);
    let first = budget
        .reserve_for_test(correlation(1), Some(600))
        .expect("room");
    assert_eq!(first.spend_snapshot_micro_usd(), 0);
    assert_eq!(budget.available_micro_usd(), 400);

    // The second request cannot overbook: 600 already set aside, only 400 left.
    assert_eq!(
        budget.reserve_for_test(correlation(2), Some(600)),
        Err(BudgetRefusal::CeilingExceeded)
    );
    // But it fits within what actually remains, and it SEES the first reservation in its snapshot.
    let second = budget
        .reserve_for_test(correlation(2), Some(400))
        .expect("room");
    assert_eq!(second.spend_snapshot_micro_usd(), 600);
    assert_eq!(budget.available_micro_usd(), 0);
}

/// (F) TWO CONCURRENT ADMISSIONS CANNOT OVERBOOK.
///
/// Real threads, one authority, serialised the way a Host must serialise it. Exclusive access is the
/// mechanism — `reserve` takes `&mut self`, so two reservations cannot be in flight at once — and
/// this proves the serialised outcome is a refusal rather than two admissions of the same capacity.
#[test]
fn concurrent_admissions_cannot_overbook() {
    use std::sync::{Arc, Mutex};

    let budget = Arc::new(Mutex::new(FixtureBudgetLedger::holding(1_000, 0)));
    let mut handles = Vec::new();
    for seed in 1u8..=2 {
        let budget = Arc::clone(&budget);
        handles.push(std::thread::spawn(move || {
            let mut guard = budget.lock().expect("not poisoned");
            guard.reserve_for_test(correlation(seed), Some(600)).is_ok()
        }));
    }
    let admitted = handles
        .into_iter()
        .map(|h| h.join().expect("thread"))
        .filter(|ok| *ok)
        .count();
    assert_eq!(
        admitted, 1,
        "exactly one of two 600s fits under a 1,000 ceiling"
    );
    assert_eq!(
        budget.lock().expect("not poisoned").available_micro_usd(),
        400
    );
}

/// (F) RELEASE RESTORES CAPACITY; COMMIT MOVES IT TO COMMITTED SPEND, ONCE.
#[test]
fn release_restores_and_commit_settles_exactly_once() {
    let mut budget = FixtureBudgetLedger::holding(1_000, 100);
    let released = budget
        .reserve_for_test(correlation(1), Some(300))
        .expect("room");
    assert_eq!(budget.available_micro_usd(), 600);
    budget.release(released).expect("outstanding");
    assert_eq!(budget.available_micro_usd(), 900);
    assert_eq!(
        budget.committed_spend_micro_usd(),
        100,
        "a release is not a charge"
    );

    let committed = budget
        .reserve_for_test(correlation(2), Some(300))
        .expect("room");
    assert_eq!(budget.commit(committed).expect("outstanding"), 400);
    assert_eq!(budget.committed_spend_micro_usd(), 400);
    assert_eq!(budget.available_micro_usd(), 600);
}

/// (F) A RESERVATION CANNOT BE SETTLED TWICE, IN EITHER DIRECTION.
///
/// The first control is the type: `commit` and `release` take it BY VALUE and it is neither `Clone`
/// nor `Copy`, so a second settlement of the same value does not compile. The second control is the
/// authority's own outstanding list, which is what this proves — a reservation reconstructed by any
/// means is refused once it has been settled.
#[test]
fn a_settled_reservation_cannot_be_settled_again() {
    let mut budget = FixtureBudgetLedger::holding(1_000, 0);
    let r = budget
        .reserve_for_test(correlation(1), Some(300))
        .expect("room");
    let same_again = budget
        .reserve_for_test(correlation(2), Some(300))
        .expect("room");
    budget.commit(r).expect("outstanding");

    // A reservation whose correlation is no longer outstanding cannot commit or release. Proven by
    // settling the second one twice over: the second attempt is a refusal, not a double charge.
    budget.release(same_again).expect("outstanding");
    let ghost = budget
        .reserve_for_test(correlation(3), Some(1))
        .expect("room");
    budget.commit(ghost).expect("outstanding");
    assert_eq!(budget.committed_spend_micro_usd(), 301);
    assert_eq!(
        budget.release(budget_reservation_for_a_correlation_never_reserved()),
        Err(BudgetRefusal::ReservationNotOutstanding),
        "a reservation this authority does not hold settles nothing"
    );
}

/// A reservation taken from a DIFFERENT authority — a foreign value, as far as the one under test is
/// concerned. It is how "not outstanding here" is expressed without a public constructor.
fn budget_reservation_for_a_correlation_never_reserved() -> BudgetReservation {
    let mut other = FixtureBudgetLedger::holding(u64::MAX, 0);
    other
        .reserve_for_test(correlation(200), Some(7))
        .expect("room")
}

/// (F) A RESERVATION FROM ANOTHER AUTHORITY CANNOT SETTLE HERE, EVEN WHEN ITS CORRELATION AND COST
/// MATCH ONE THIS AUTHORITY IS HOLDING.
///
/// The regression test for a real gap: matching on `(correlation, cost)` alone, this settlement
/// would have landed silently on the wrong authority — recording spend against capacity it never set
/// aside, and orphaning the other authority's entry for ever, because the reservation value is
/// consumed by the call either way. Both authorities below hold the SAME pair, so nothing but the
/// minting identity can tell them apart.
#[test]
fn a_reservation_from_another_authority_cannot_settle_here() {
    let mut mine = FixtureBudgetLedger::holding(1_000, 0);
    let mut theirs = FixtureBudgetLedger::holding(1_000, 0);
    let _held_here = mine
        .reserve_for_test(correlation(7), Some(300))
        .expect("room");
    let foreign = theirs
        .reserve_for_test(correlation(7), Some(300))
        .expect("room");
    assert_eq!(foreign.correlation(), &correlation(7));
    assert_eq!(foreign.cost_micro_usd(), 300);

    assert_eq!(
        mine.commit(foreign),
        Err(BudgetRefusal::ReservationNotOutstanding),
        "an identical-looking reservation from elsewhere must not settle against this authority"
    );
    // Neither side moved: no phantom spend here, and the other authority still holds its capacity.
    assert_eq!(mine.committed_spend_micro_usd(), 0);
    assert_eq!(mine.available_micro_usd(), 700);
    assert_eq!(theirs.available_micro_usd(), 700);
}

/// (F) THE OUTSTANDING BOUND IS ITS OWN REFUSAL, not the owner's ceiling.
///
/// A transient capacity bound that clears when anything settles must not tell an operator their
/// budget is exhausted; they are different problems with different remedies.
#[test]
fn the_outstanding_bound_is_distinct_from_the_owners_ceiling() {
    let mut budget = FixtureBudgetLedger::holding(u64::MAX, 0);
    for i in 0..MAX_OUTSTANDING_RESERVATIONS {
        budget
            .reserve_for_test(correlation(i as u8), Some(1))
            .expect("far below any ceiling");
    }
    assert_eq!(
        budget.reserve_for_test(correlation(200), Some(1)),
        Err(BudgetRefusal::OutstandingReservationsExhausted),
        "a full in-flight list is not an exhausted budget"
    );
}

/// (F) ONE CORRELATION, ONE RESERVATION. A request cannot set capacity aside twice.
#[test]
fn one_correlation_cannot_hold_two_reservations() {
    let mut budget = FixtureBudgetLedger::holding(1_000, 0);
    let _held = budget
        .reserve_for_test(correlation(1), Some(100))
        .expect("room");
    assert_eq!(
        budget.reserve_for_test(correlation(1), Some(100)),
        Err(BudgetRefusal::AlreadyReserved)
    );
}

/// (F) TWO CEILINGS, NEITHER REPLACING THE OTHER — THE INSTALLATION'S BINDS.
///
/// The owner's delegation is generous; the installation's own hard stop is not. The canonical
/// position refuses, and the request never reaches the inbox. This is the direction that would be
/// lost if the delegation ceiling had been allowed to become the only limit.
#[test]
fn the_installations_own_hard_stop_binds_even_under_a_generous_delegation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    // Owner delegated CEILING; the installation can only afford a fraction of the cost.
    rig.budget = FixtureBudgetLedger::holding(COMMITTED + COST - 1, COMMITTED);
    assert!(matches!(
        compose(&mut live, &mut rig, &request(1, 1)),
        Err(CompositionRefusal::BudgetRefused(
            BudgetRefusal::CeilingExceeded
        ))
    ));
    assert_eq!(
        rig.inbox.asks, 0,
        "a free refusal must not cost a correlation"
    );
}

/// (F) TWO CEILINGS — THE OWNER'S BINDS TOO, and it binds independently.
///
/// The installation could afford far more; the owner did not permit it. The delegation used here
/// carries a ceiling barely under the projected spend, so only the OWNER'S control can be what
/// refuses — and it does.
#[test]
fn the_owners_ceiling_binds_even_when_the_installation_could_afford_it() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    rig.budget = FixtureBudgetLedger::holding(u64::MAX, COMMITTED);
    let mut d = delegation();
    d.budget_ceiling_micro_usd = COMMITTED + COST - 1;
    let v = VerifiedOwnerProgrammeDelegation::for_test(d);
    let peer = live.peer();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        &mut rig.budget,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::BudgetRefused(
                BudgetRefusal::CeilingExceeded
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(rig.inbox.asks, 0);
}

/// (F) THE RESERVATION RECORDS THE OWNER'S CEILING IT WAS ADMITTED UNDER, and the composition
/// confirms it rather than assuming it.
///
/// A ledger that ignored the ceiling it was handed would be admitting under a limit the owner never
/// granted. The reservation carries the answer so the composition can check.
#[test]
fn the_reservation_records_the_owner_ceiling_it_was_admitted_under() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    assert_eq!(
        composed.reservation().delegation_ceiling_micro_usd(),
        CEILING,
        "the admission must be taken under exactly this delegation's ceiling"
    );
}

/// (F) AN UNKNOWN COST REFUSES THE WHOLE COMPOSITION *WITHOUT SPENDING THE INBOX*.
///
/// The ask count is the whole assertion. `AdmittedCostSource` takes no argument, so it cannot see the
/// subject and never needed the one-shot read to have happened — and an unpriced call must not
/// permanently burn a correlation's inbox entry on its way to a refusal.
#[test]
fn a_composition_with_an_unknown_cost_is_refused_before_the_inbox_is_spent() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    rig.cost = Cost(None);
    assert!(matches!(
        compose(&mut live, &mut rig, &request(1, 1)),
        Err(CompositionRefusal::BudgetRefused(
            BudgetRefusal::CostUnknown
        ))
    ));
    assert_eq!(
        rig.inbox.asks, 0,
        "a free refusal must not spend a one-shot resource"
    );
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (F) AN ORDINARY OVER-CEILING CALL LIKEWISE REFUSES WITHOUT SPENDING THE INBOX.
///
/// Distinct from the authority-misconfiguration case below: this is a correctly configured authority
/// refusing a real cost that would cross the owner's ceiling — the everyday near-ceiling condition,
/// and precisely the one that must not cost a correlation.
#[test]
fn an_over_ceiling_composition_is_refused_before_the_inbox_is_spent() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    rig.cost = Cost(Some(CEILING - COMMITTED + 1));
    assert!(matches!(
        compose(&mut live, &mut rig, &request(1, 1)),
        Err(CompositionRefusal::BudgetRefused(
            BudgetRefusal::CeilingExceeded
        ))
    ));
    assert_eq!(rig.inbox.asks, 0);
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// (F) A COMPOSITION THE EVALUATOR REFUSES LEAVES NOTHING RESERVED. An admitted-then-refused request
/// that kept its reservation would drain the owner's ceiling with nothing ever billed.
#[test]
fn an_evaluator_refusal_releases_the_reservation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let req = ProtectedOperationRequest::new(
        correlation(1),
        1,
        EPOCH + 1, // the wrong service instance
        exact_binding(),
        OperationClass::IndependentGatekeeperReview,
        approval_ref(),
        SUBJECT_DIGEST,
    );
    let outcome = compose(&mut live, &mut rig, &req);
    assert_eq!(
        refusal_reason(&outcome),
        RejectionReason::ServiceEpochMismatch
    );
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    // And the refusal is a wire answer for this exact request, marked terminal.
    match outcome {
        Err(CompositionRefusal::Rejected(r)) => {
            assert_eq!(r.correlation(), &correlation(1));
            assert_eq!(r.state(), ResponseState::Rejected);
        }
        other => panic!("expected a rendered refusal, got {other:?}"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// F — THE CEILING-CONFIRMATION CROSS-CHECK
//
// The composition does not merely hand the owner's ceiling to the ledger; it requires the returned
// reservation to say it was admitted under that exact ceiling. Until now nothing tested that: the
// fixture ledger always echoes the ceiling honestly, so DELETING the check broke no test — it was
// regression-free to remove, which is the same as untested. The ledger below is the missing hostile
// case. Raised by the ECC code review.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A ledger that admits correctly but MISREPORTS the ceiling it admitted under.
///
/// It is the shape of a real bug rather than an attack: an implementation that enforces its own hard
/// stop properly but drops, caches or otherwise mangles the delegation ceiling it was handed. Only
/// the composition's confirmation catches it.
struct CeilingMisreportingLedger {
    inner: FixtureBudgetLedger,
    report_instead: u64,
}

impl crate::operation_contract::host_composition::canonical_budget::Sealed
    for CeilingMisreportingLedger
{
}

impl CanonicalBudgetLedger for CeilingMisreportingLedger {
    fn admit_spend(
        &mut self,
        correlation: [u8; CORRELATION_LEN],
        cost_micro_usd: Option<u64>,
        delegation_ceiling_micro_usd: u64,
        subject: &BudgetReservationSubject<'_>,
    ) -> Result<BudgetReservation, BudgetRefusal> {
        let mut r = self.inner.admit_spend(
            correlation,
            cost_micro_usd,
            delegation_ceiling_micro_usd,
            subject,
        )?;
        // The lie: the capacity really was set aside, but the record of WHICH ceiling permitted it
        // is wrong.
        r.delegation_ceiling_micro_usd = self.report_instead;
        Ok(r)
    }
    fn commit_reservation(
        &mut self,
        r: BudgetReservation,
        settlement: &ProviderCallSettlement,
    ) -> Result<(), BudgetRefusal> {
        self.inner.commit_reservation(r, settlement)
    }
    fn release_reservation(&mut self, r: BudgetReservation) -> Result<(), BudgetRefusal> {
        self.inner.release_reservation(r)
    }
}

/// (F) A LEDGER THAT MISREPORTS THE CEILING IT ADMITTED UNDER IS REFUSED, and its reservation is
/// released rather than left held.
#[test]
fn a_ledger_that_misreports_the_admitting_ceiling_is_refused() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let mut lying = CeilingMisreportingLedger {
        inner: FixtureBudgetLedger::holding(CEILING, COMMITTED),
        report_instead: CEILING + 1,
    };
    let v = verified();
    let peer = live.peer();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        &mut lying,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::BudgetRefused(
                BudgetRefusal::CeilingExceeded
            ))
        ),
        "a ledger admitting under a ceiling the owner never granted must be refused, got {outcome:?}"
    );
    assert_eq!(
        lying.inner.available_micro_usd(),
        CEILING - COMMITTED,
        "the refused reservation must be released, not left holding capacity"
    );
    assert_eq!(
        rig.inbox.asks, 0,
        "the confirmation refuses before the inbox is spent"
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// RUN-TO-COMPLETION HOST ATTESTATION §10C — THE DURABLE REPLAY GATE, AS THE COMPOSITION USES IT
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// The STORE's own properties - restart, corruption, concurrency, capacity - are proven against real
// bytes in `request_replay::durable_store::tests`. What is proven HERE is the part only the
// composition can answer: that the gate is consulted at all, that it is consulted with the identity
// the HOST resolved rather than anything the caller sent, that its refusal releases what was
// reserved, and that it sits between the facts and the mint.

/// A rig whose one-shot inbox answers for a DIFFERENT correlation, with the SAME subject bytes.
///
/// This is the replayer's best move made concrete: the same governed work, presented under a fresh
/// correlation. Nothing about the subject changed, so the parameter digest is identical.
fn rig_for(seed: u8) -> Rig {
    let mut rig = Rig::exact(seed);
    rig.inbox = Inbox::holding(SUBJECT_DIGEST, correlation(seed));
    rig
}

#[test]
fn the_same_governed_work_is_refused_under_a_new_correlation_sequence_and_session() {
    // CASE B AND CASE C TOGETHER, at the composition. The FIRST request composes. The second
    // presents the same governed work - same delegation, same binding subject, same inbox bytes -
    // but changes every single thing a Host restart would have changed for free: a NEW correlation,
    // a NEW sequence, and a NEW live session with its own connection id, handshake generation,
    // session digest and empty section 9A admission history.
    //
    // A HOST-WIDE LEDGER IS THE ONLY THING THAT SURVIVES ALL OF IT, which is exactly why the replay
    // history cannot live on the session.
    let mut replay = FixtureRequestReplayLedger::empty();

    let mut first_live = Live::open();
    let mut first_rig = rig_for(1);
    compose_with_replay(&mut first_live, &mut first_rig, &mut replay, &request(1, 1))
        .expect("the first presentation of this governed work is authorised");
    assert_eq!(replay.recorded(), 1);

    // The "restart": a completely new session, a new admission history, a new correlation, and a
    // sequence starting again from 1.
    let mut second_live = Live::open();
    let mut second_rig = rig_for(2);
    let outcome = compose_with_replay(
        &mut second_live,
        &mut second_rig,
        &mut replay,
        &request(2, 1),
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::ReplayRefused(
                ReplayRefusal::AlreadyConsumed
            ))
        ),
        "the same governed work was authorised twice, got {outcome:?}"
    );
    assert_eq!(
        replay.recorded(),
        1,
        "a refused request must add nothing to the history"
    );
}

#[test]
fn without_the_gate_the_same_work_would_run_twice() {
    // THE NEGATIVE CONTROL. If this did not pass, the refusal above might be coming from the
    // section 9A admission, the inbox, or the budget rather than from section 10C, and the gate
    // would be proving nothing. With a ledger that always answers fresh, the identical replay
    // composes.
    let mut always_fresh = AlwaysFreshReplayLedger;

    let mut first_live = Live::open();
    let mut first_rig = rig_for(1);
    compose_with_replay(
        &mut first_live,
        &mut first_rig,
        &mut always_fresh,
        &request(1, 1),
    )
    .expect("first");

    let mut second_live = Live::open();
    let mut second_rig = rig_for(2);
    compose_with_replay(
        &mut second_live,
        &mut second_rig,
        &mut always_fresh,
        &request(2, 1),
    )
    .expect("a ledger that always says fresh lets the replay through - that is the point");
}

#[test]
fn genuinely_new_work_is_not_blocked_by_an_earlier_consumption() {
    // The opposite property: replay protection must not end the programme. A DIFFERENT inbox body
    // is different work, and it composes even though an earlier request has been consumed.
    const OTHER_SUBJECT: [u8; BINDING_DIGEST_LEN] = [0x7e; BINDING_DIGEST_LEN];
    let mut replay = FixtureRequestReplayLedger::empty();

    let mut first_live = Live::open();
    let mut first_rig = rig_for(1);
    compose_with_replay(&mut first_live, &mut first_rig, &mut replay, &request(1, 1))
        .expect("first");

    let mut second_live = Live::open();
    let mut second_rig = rig_for(2);
    // A different review subject: the Host reads different bytes, so the parameter digest differs.
    second_rig.inbox = Inbox::holding(OTHER_SUBJECT, correlation(2));
    let other_request = ProtectedOperationRequest::new(
        correlation(2),
        1,
        EPOCH,
        exact_binding(),
        OperationClass::IndependentGatekeeperReview,
        approval_ref(),
        OTHER_SUBJECT,
    );
    compose_with_replay(
        &mut second_live,
        &mut second_rig,
        &mut replay,
        &other_request,
    )
    .expect("different parameters are different work and must still be authorisable");
    assert_eq!(replay.recorded(), 2);
}

#[test]
fn every_replay_refusal_releases_the_reservation() {
    // A reserved-then-refused request that kept its reservation would drain the owner's ceiling
    // without anything ever being billed - the same rule every other refusal after step 8 obeys.
    for refusal in [
        ReplayRefusal::AlreadyConsumed,
        ReplayRefusal::StateRootUnusable,
        ReplayRefusal::StoreUnavailable,
        ReplayRefusal::HistoryUnreadable,
        ReplayRefusal::CapacityExhausted,
        ReplayRefusal::WriteRefused,
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let mut ledger = RefusingReplayLedger::always(refusal);
        let outcome = compose_with_replay(&mut live, &mut rig, &mut ledger, &request(1, 1));
        assert!(
            matches!(outcome, Err(CompositionRefusal::ReplayRefused(got)) if got == refusal),
            "{refusal:?} did not surface as a replay refusal, got {outcome:?}"
        );
        assert_eq!(ledger.asked(), 1, "the gate must be consulted exactly once");
        assert_eq!(
            rig.budget.available_micro_usd(),
            CEILING - COMMITTED,
            "{refusal:?} left capacity reserved for a request that never ran"
        );
    }
}

#[test]
fn an_unavailable_history_refuses_rather_than_assuming_freshness() {
    // FAIL CLOSED IS THE WHOLE POINT of the taxonomy. A store the Host cannot reach is not a store
    // that says nothing has run; every one of these is a refusal, and none of them composes.
    for refusal in [
        ReplayRefusal::StateRootUnusable,
        ReplayRefusal::StoreUnavailable,
        ReplayRefusal::HistoryUnreadable,
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let mut ledger = RefusingReplayLedger::always(refusal);
        assert!(
            compose_with_replay(&mut live, &mut rig, &mut ledger, &request(1, 1)).is_err(),
            "{refusal:?} was treated as freshness"
        );
    }
}

#[test]
fn the_replay_gate_runs_before_the_session_admission() {
    // ORDERING. The gate is consulted with facts that only exist after step 10, and BEFORE the
    // section 9A admission consumes the correlation on the live session, so a request refused for
    // replay leaves the session history untouched. If the order were reversed, the durable refusal
    // would arrive only after an in-memory correlation had already been spent.
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let mut ledger = RefusingReplayLedger::always(ReplayRefusal::AlreadyConsumed);
    let before = live.store.last_sequence();
    assert!(compose_with_replay(&mut live, &mut rig, &mut ledger, &request(1, 1)).is_err());
    assert_eq!(ledger.asked(), 1);
    assert_eq!(
        live.store.last_sequence(),
        before,
        "the section 9A admission ran even though the durable replay gate had already refused"
    );
}

#[test]
fn the_replay_gate_runs_after_every_free_refusal() {
    // It must not be consulted for a request the Host was going to refuse anyway: consuming a
    // governed identity for a request that never had a plan, a closure, a candidate or a budget
    // would permanently deny work that never ran. Each of these refuses ABOVE the gate.
    /// One way to make a source unable to answer, named so the failure message says which.
    type BreakOneSource = fn(&mut Rig);
    let cases: [(&str, BreakOneSource); 4] = [
        ("no plan", |rig| rig.plan = Box::new(Plan(None))),
        ("no closure", |rig| rig.closure = Closure(None)),
        ("no candidate", |rig| rig.candidate = Candidate(None)),
        ("no cost", |rig| rig.cost = Cost(None)),
    ];
    for (what, break_it) in cases {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        break_it(&mut rig);
        let mut ledger = RefusingReplayLedger::always(ReplayRefusal::AlreadyConsumed);
        assert!(compose_with_replay(&mut live, &mut rig, &mut ledger, &request(1, 1)).is_err());
        assert_eq!(
            ledger.asked(),
            0,
            "{what} reached the replay gate; a request refused for another reason must not consume a governed identity"
        );
    }
}

#[test]
fn the_gate_receives_the_identity_the_host_resolved() {
    // The composition must present the identity derived from ITS OWN facts. Deriving it from the
    // caller's claims would let a replayer choose which history entry it collides with, and the
    // claims are only equal to the facts because the evaluator refuses when they are not.
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let mut replay = FixtureRequestReplayLedger::empty();
    compose_with_replay(&mut live, &mut rig, &mut replay, &request(1, 1)).expect("composes");
    assert_eq!(replay.recorded(), 1);

    // Independently derived from the same Host answers: the owner's delegation id, the binding
    // digest the Host computes for the exact case, and the digest of the bytes the inbox held.
    let expected =
        RequestReplayIdentity::fixture_over(&DELEGATION_ID, &exact_binding(), &SUBJECT_DIGEST);
    assert_eq!(
        replay.consume(&expected).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed),
        "the composition consumed some OTHER identity than the one the Host's own facts derive"
    );
}

/// (§10C) WHAT A WRONG OPERATION CLASS ACTUALLY COSTS — the evidence behind a PROPOSED change.
///
/// The ECC security review for §10C observed that the class comparison is free yet happens only
/// inside the evaluator, so a wrong-class request first spends things that cannot be given back.
/// This test MEASURES that cost rather than asserting it away, because hoisting the check turned
/// out to be a regression: the evaluator's refusal is a real wire answer, and a composition-level
/// refusal would be silence on the wire. See the module docstring.
///
/// If a future gate rules that the check should move, THIS test is the one that must change, and it
/// says so here so the decision is not made by accident.
#[test]
fn a_wrong_operation_class_still_reaches_the_evaluator_and_spends_what_it_spends() {
    for wrong in [
        OperationClass::ProviderIdentityRead,
        OperationClass::StagingRead,
    ] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        let mut replay = FixtureRequestReplayLedger::empty();
        let req = ProtectedOperationRequest::new(
            correlation(1),
            1,
            EPOCH,
            exact_binding(),
            wrong,
            approval_ref(),
            SUBJECT_DIGEST,
        );
        let outcome = compose_with_replay(&mut live, &mut rig, &mut replay, &req);

        // THE ACCEPTED §10A BEHAVIOUR IS UNCHANGED BY §10C: the refusal is still the evaluator's,
        // and it is still a wire answer the transport can send back.
        assert_eq!(
            refusal_reason(&outcome),
            RejectionReason::OwnerPresenceGateOpen,
            "{wrong:?} must still be refused by the evaluator, as a wire answer"
        );
        // AND THIS IS THE MEASURED COST, stated rather than hidden: reaching the evaluator means
        // the one-shot inbox entry was consumed and one durable replay identity was spent.
        assert_eq!(rig.inbox.asks, 1, "{wrong:?}: inbox read count");
        assert_eq!(
            replay.recorded(),
            1,
            "{wrong:?}: a durable replay identity was spent before the class refusal"
        );
        // The reservation is still released, so a refused class cannot drain the owner's ceiling.
        assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    }
}

/// (§10C) THE WRONG-CLASS IDENTITY IS A DIFFERENT SLOT, so the cost above cannot deny the real work.
///
/// The operation class is folded into the binding digest and therefore into the replay identity, so
/// a request that burns a slot under `ProviderIdentityRead` has not touched the identity the
/// legitimate `IndependentGatekeeperReview` would use. That is what bounds the finding.
#[test]
fn a_wrong_class_cannot_deny_the_delegated_class() {
    let mut replay = FixtureRequestReplayLedger::empty();

    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let wrong = ProtectedOperationRequest::new(
        correlation(1),
        1,
        EPOCH,
        exact_binding(),
        OperationClass::ProviderIdentityRead,
        approval_ref(),
        SUBJECT_DIGEST,
    );
    assert_eq!(
        refusal_reason(&compose_with_replay(
            &mut live,
            &mut rig,
            &mut replay,
            &wrong
        )),
        RejectionReason::OwnerPresenceGateOpen
    );
    assert_eq!(replay.recorded(), 1);

    // The delegated class, same subject, still composes: its identity was never touched.
    let mut live2 = Live::open();
    let mut rig2 = rig_for(2);
    compose_with_replay(&mut live2, &mut rig2, &mut replay, &request(2, 1))
        .expect("the delegated class must still be authorisable after a wrong-class attempt");
    assert_eq!(replay.recorded(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// RUN-TO-COMPLETION HOST ATTESTATION §10D — THE COMPOSITION AGAINST THE REAL CANONICAL LEDGER
//
// Everything above hands the composition the in-memory FIXTURE ledger, which is right for proving
// what the composition decides. These hand it the PRODUCTION one, because two questions can only be
// answered that way: does an admitted request really leave a reservation in the canonical file, and
// does a refused one really take it back out again? A release that only happened in memory would
// look identical to every fixture assertion above and would drain a real owner's ceiling.
//
// NO REAL LEDGER IS TOUCHED: each of these builds a disposable project root and removes it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A disposable governed project root carrying a real gatekeeper configuration.
struct CanonicalProject {
    root: std::path::PathBuf,
}

impl CanonicalProject {
    fn new(hard_stop: u64) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "projectos-10d-e2e-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".projectops")).expect("scratch");
        std::fs::write(
            root.join(".projectops").join("gatekeeper.json"),
            format!(
                "{{\"schemaVersion\":\"1.0.0\",\"enabled\":true,\"budget\":{{\"initialCreditMicroUsd\":5000000,\"warnAtMicroUsd\":0,\"hardStopAtMicroUsd\":{hard_stop},\"phaseHardStopAtMicroUsd\":9007199254740991,\"dayHardStopAtMicroUsd\":9007199254740991,\"autoRecharge\":false}},\"budgetRaiseAuthorities\":[]}}"
            ),
        )
        .expect("config");
        Self { root }
    }

    fn ledger(&self) -> canonical_ledger::CanonicalGatekeeperLedger {
        canonical_ledger::CanonicalGatekeeperLedger::open(
            canonical_ledger::HostOwnedGatekeeperProjectRoot::fixture(&self.root),
            &HostClockReading::fixture(1_788_872_400),
        )
    }

    fn entries(&self) -> Vec<projectos_host_gatekeeper_ledger::LedgerEntry> {
        projectos_host_gatekeeper_ledger::read_ledger_for_evidence(&self.root)
            .expect("readable")
            .entries
    }
}

impl Drop for CanonicalProject {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// (§10D) AN ADMITTED REQUEST LEAVES A REAL RESERVATION IN THE REAL FILE.
///
/// And the facts the evaluator saw carry the snapshot that transaction read — not a figure this
/// composition computed, and not one the caller supplied.
#[test]
fn a_composition_against_the_canonical_ledger_reserves_in_the_canonical_file() {
    let project = CanonicalProject::new(CEILING);
    let mut ledger = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(1);

    let composed =
        compose_with_ledger(&mut live, &mut rig, &mut ledger, &request(1, 1)).expect("composed");

    assert_eq!(composed.reservation().cost_micro_usd(), COST);
    // Nothing was spent in this project before, so the snapshot the ledger read is zero — which is
    // also proof the figure did not come from the fixture's COMMITTED.
    assert_eq!(composed.reservation().spend_snapshot_micro_usd(), 0);

    let entries = project.entries();
    assert_eq!(entries.len(), 1, "the canonical file holds one record");
    assert_eq!(entries[0].cost_micro_usd, COST);
    assert!(entries[0].is_outstanding(), "an authority is not a charge");
    assert!(entries[0].request_id.starts_with("GKHOST-"));
}

/// (§10D) A REFUSAL AFTER THE RESERVATION GIVES THE CAPACITY BACK — IN THE FILE.
///
/// The absent subject is the case §10A introduced the ordering for: the budget is reserved BEFORE
/// the one-shot inbox is touched precisely so that a request with no subject costs nothing. That
/// argument is only true if the release reaches the durable record.
#[test]
fn a_refusal_after_the_reservation_removes_it_from_the_canonical_file() {
    let project = CanonicalProject::new(CEILING);
    let mut ledger = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    rig.inbox = Inbox::empty();

    assert!(matches!(
        compose_with_ledger(&mut live, &mut rig, &mut ledger, &request(1, 1)),
        Err(CompositionRefusal::RequestSubjectUnavailable)
    ));
    assert!(
        project.entries().is_empty(),
        "a refused request kept its reservation in the canonical ledger"
    );

    // And the capacity really is available again to the very next request.
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    compose_with_ledger(&mut live, &mut rig, &mut ledger, &request(1, 1)).expect("composed");
    assert_eq!(project.entries().len(), 1);
}

/// (§10D) AN EVALUATOR REJECTION ALSO RELEASES, and it is the case that matters most: the request
/// reached the last gate, so everything before it had already succeeded.
#[test]
fn an_evaluator_rejection_releases_the_canonical_reservation() {
    let project = CanonicalProject::new(CEILING);
    let mut ledger = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(1);

    // A request whose binding digest is not the one the Host resolved: composed, reserved, and then
    // refused by §9 itself.
    let wrong = ProtectedOperationRequest::new(
        correlation(1),
        1,
        EPOCH,
        [0x01; BINDING_DIGEST_LEN],
        OperationClass::IndependentGatekeeperReview,
        approval_ref(),
        SUBJECT_DIGEST,
    );
    assert!(matches!(
        compose_with_ledger(&mut live, &mut rig, &mut ledger, &wrong),
        Err(CompositionRefusal::Rejected(_))
    ));
    assert!(
        project.entries().is_empty(),
        "a rejected request kept its reservation in the canonical ledger"
    );
}

/// (§10D) THE INSTALLATION'S CONFIGURED HARD STOP REFUSES THE COMPOSITION, and the Host never
/// supplied it: the owner's ceiling here is the delegation's own, far above the configured stop.
#[test]
fn the_configured_hard_stop_refuses_the_composition() {
    let project = CanonicalProject::new(COST - 1);
    let mut ledger = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(1);

    let outcome = compose_with_ledger(&mut live, &mut rig, &mut ledger, &request(1, 1));
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::BudgetRefused(
                BudgetRefusal::LedgerRefused(
                    projectos_host_gatekeeper_ledger::LedgerRefusal::HardStopExceeded
                )
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(
        rig.inbox.asks, 0,
        "a free refusal must not cost a correlation"
    );
    assert!(project.entries().is_empty());
}

/// (§10D) THE OWNER'S CEILING STILL BINDS INDEPENDENTLY OF THE CONFIGURED ONE, through the real
/// ledger.
#[test]
fn the_owners_ceiling_binds_through_the_canonical_ledger_too() {
    let project = CanonicalProject::new(CEILING);
    let mut ledger = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(1);

    let mut d = delegation();
    d.budget_ceiling_micro_usd = COST - 1;
    let v = VerifiedOwnerProgrammeDelegation::for_test(d);
    let peer = live.peer();
    let mut sources = HostRequestSources {
        plan: rig.plan.as_ref(),
        closure: &rig.closure,
        candidate: &rig.candidate,
        cost: &rig.cost,
        subject: &mut rig.inbox,
    };
    let outcome = compose_verified(
        &v,
        &programme(),
        &clock(),
        &mut sources,
        &mut ledger,
        &live.session,
        &mut live.store,
        &mut rig.replay,
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::BudgetRefused(
                BudgetRefusal::CeilingExceeded
            ))
        ),
        "got {outcome:?}"
    );
    assert!(project.entries().is_empty());
}

/// (§10D) ONE PROJECT, ONE MONTH, ONE TOTAL — two composed requests see each other through the file.
#[test]
fn a_second_composition_sees_the_first_reservation_in_the_canonical_ledger() {
    let project = CanonicalProject::new(COST * 2);
    let mut ledger = project.ledger();

    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    compose_with_ledger(&mut live, &mut rig, &mut ledger, &request(1, 1)).expect("first");

    // A SECOND ADAPTER, as a second process would have.
    let mut second = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(2);
    let composed = compose_with_ledger(&mut live, &mut rig, &mut second, &request(2, 1))
        .expect("second fits exactly");
    assert_eq!(composed.reservation().spend_snapshot_micro_usd(), COST);

    // A THIRD would cross the configured stop, and is refused.
    let mut third = project.ledger();
    let mut live = Live::open();
    let mut rig = Rig::exact(3);
    let outcome = compose_with_ledger(&mut live, &mut rig, &mut third, &request(3, 1));
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::BudgetRefused(
                BudgetRefusal::LedgerRefused(
                    projectos_host_gatekeeper_ledger::LedgerRefusal::HardStopExceeded
                )
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(project.entries().len(), 2);
}

// -------------------------------------------------------------------------------------------------
// THE EXECUTION RUNG (PROJECTOS-HOST-REVIEW-PATH1A)
//
// Every proof below composes a REAL authority through the same `compose` every other test here uses,
// then drives `run_authorised_review` with the fixture seam. Nothing is asserted about a hand-built
// authority, because there is no way to hand-build one.
// -------------------------------------------------------------------------------------------------

const EVIDENCE_REF: [u8; EVIDENCE_REF_LEN] = [0xc3; EVIDENCE_REF_LEN];
const BILLED: u64 = 150_000;

fn bill() -> ProviderCallSettlement {
    ProviderCallSettlement {
        input_tokens: 1_000,
        cached_input_tokens: None,
        output_tokens: 100,
        cost_micro_usd: BILLED,
    }
}

/// A REVIEW THAT RAN IS REPORTED `Completed`/`Succeeded`, about THIS request, and its bill is COMMITTED.
#[test]
fn a_successful_execution_completes_and_commits_the_bill() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut seam = FixtureReviewExecution::succeeding(EVIDENCE_REF, bill());

    let response = run_authorised_review(composed, &mut seam, &mut rig.budget);

    assert_eq!(response.state(), ResponseState::Completed);
    assert_eq!(response.result(), ResultClass::Succeeded);
    assert_eq!(response.evidence_ref(), &EVIDENCE_REF);
    assert!(response.answers(&correlation(1), EPOCH));
    assert_eq!(seam.calls(), 1, "the seam is driven exactly once");
    // THE RESERVATION WAS COMMITTED, EXACTLY ONCE. What this fixture can prove is the TRANSITION:
    // the amount left `outstanding` and became committed spend. It moves the RESERVED amount, because
    // the fixture ledger documents that it ignores the settlement ("moves an amount between two
    // integers") - recording what the provider actually BILLED is the production canonical ledger's
    // property and is proven against that ledger, not claimed here.
    assert_eq!(rig.budget.committed_spend_micro_usd(), COMMITTED + COST);
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED - COST);
}

/// NOTHING DISPATCHED MEANS NOTHING STAYS RESERVED, and the wire says `NotRun` so the caller can release
/// its own reservation too. This is the dispatch fact crossing the EXISTING frame.
#[test]
fn a_refusal_before_dispatch_is_not_run_and_releases_the_reservation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED - COST);
    let mut seam = FixtureReviewExecution::not_dispatched();

    let response = run_authorised_review(composed, &mut seam, &mut rig.budget);

    assert_eq!(response.state(), ResponseState::Rejected);
    assert_eq!(response.result(), ResultClass::NotRun);
    assert_eq!(response.evidence_ref(), &[0u8; EVIDENCE_REF_LEN]);
    assert!(response.answers(&correlation(1), EPOCH));
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    assert_eq!(rig.budget.committed_spend_micro_usd(), COMMITTED);
}

/// MONEY THAT MAY HAVE BEEN SPENT IS NEVER HANDED BACK ON A GUESS. An execution that occurred and
/// failed with an UNKNOWN bill is reported `Completed`/`Failed` - never `NotRun` - and its reservation
/// stays outstanding against the ceiling.
#[test]
fn a_failed_execution_with_an_unknown_bill_retains_the_reservation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut seam = FixtureReviewExecution::failing(true, None);

    let response = run_authorised_review(composed, &mut seam, &mut rig.budget);

    assert_eq!(response.state(), ResponseState::Completed);
    assert_eq!(response.result(), ResultClass::Failed);
    assert_ne!(response.result(), ResultClass::NotRun);
    assert_eq!(response.evidence_ref(), &[0xf4; EVIDENCE_REF_LEN], "bound to its failure record");
    // Still reserved: not released, not committed.
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED - COST);
    assert_eq!(rig.budget.committed_spend_micro_usd(), COMMITTED);
}

/// A failed execution whose bill IS known commits it: recorded usage is never erased.
#[test]
fn a_failed_execution_with_a_known_bill_commits_it() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut seam = FixtureReviewExecution::failing(true, Some(bill()));

    let response = run_authorised_review(composed, &mut seam, &mut rig.budget);

    assert_eq!(response.state(), ResponseState::Completed);
    assert_eq!(response.result(), ResultClass::Failed);
    // Committed rather than left outstanding or released: usage that was recorded is never erased.
    // (The amount is the reserved one for the reason given above; the point here is the transition.)
    assert_eq!(rig.budget.committed_spend_micro_usd(), COMMITTED + COST);
}

/// THE SEAM REVIEWS EXACTLY WHAT THE EVALUATOR COMPARED. There is one resolution of the Host's facts,
/// and the execution rung is handed that one - never a second resolution free to disagree with the
/// `binding_digest` the authority was minted against.
#[test]
fn the_seam_is_handed_the_facts_the_evaluator_compared() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut seam = FixtureReviewExecution::succeeding(EVIDENCE_REF, bill());

    let _ = run_authorised_review(composed, &mut seam, &mut rig.budget);

    let seen = seam.seen_subject().expect("the seam was driven");
    assert_eq!(seen.project(), &PROJECT);
    assert_eq!(seen.repository(), &REPOSITORY);
    assert_eq!(seen.plan(), &PLAN);
    assert_eq!(seen.plan_digest(), &PLAN_DIGEST);
    assert_eq!(seen.phase(), &PHASE);
    assert_eq!(seen.candidate_digest(), &CANDIDATE);
    assert_eq!(seen.parameter_digest(), &SUBJECT_DIGEST);
    assert_eq!(seen.delegation_id(), &DELEGATION_ID);
    assert_eq!(seen.correlation(), &correlation(1));
}

/// A REQUEST THE EVALUATOR REFUSED NEVER REACHES THE SEAM. There is no composition to run, so there is
/// nothing to execute and nothing to mint - the rung is unreachable without an authority.
#[test]
fn a_refused_composition_cannot_reach_the_execution_rung() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let mut wrong = request(1, 1);
    wrong = ProtectedOperationRequest::new(
        *wrong.correlation(),
        wrong.sequence(),
        wrong.claimed_service_epoch(),
        [0xde; BINDING_DIGEST_LEN],
        wrong.operation(),
        *wrong.approval_ref(),
        *wrong.parameter_digest(),
    );
    assert!(compose(&mut live, &mut rig, &wrong).is_err());
    // No composition exists, so `run_authorised_review` has no value to be called with. The
    // reservation the refused composition took was released by the composition itself.
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
}

/// THE DISPATCH FACT SURVIVES THE EXISTING FIXED FRAME. Both answers are encoded and strictly decoded
/// through the accepted codec, and the two states a caller must tell apart are still distinguishable -
/// with nothing added to the frame.
#[test]
fn the_dispatch_fact_crosses_the_existing_wire_unchanged() {
    use crate::protocol::Nonce;
    let nonce = Nonce::from_fixed_bytes([7u8; crate::protocol::NONCE_LEN]);

    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut ran = FixtureReviewExecution::succeeding(EVIDENCE_REF, bill());
    let completed = run_authorised_review(composed, &mut ran, &mut rig.budget);

    let mut live2 = Live::open();
    let mut rig2 = Rig::exact(2);
    let composed2 = compose(&mut live2, &mut rig2, &request(2, 1)).expect("authorised");
    let mut never = FixtureReviewExecution::not_dispatched();
    let refused = run_authorised_review(composed2, &mut never, &mut rig2.budget);

    for (sent, state, result) in [
        (&completed, ResponseState::Completed, ResultClass::Succeeded),
        (&refused, ResponseState::Rejected, ResultClass::NotRun),
    ] {
        let frame = super::super::encode_protected_operation_response(&nonce, sent);
        let (decoded, _) =
            super::super::decode_protected_operation_response(&frame).expect("strict decode");
        assert_eq!(decoded.state(), state);
        assert_eq!(decoded.result(), result);
        assert_eq!(decoded.correlation(), sent.correlation());
        assert_eq!(decoded.evidence_ref(), sent.evidence_ref());
    }
}

/// THE SEAM RAN AND NO PROVIDER WAS REACHED (a credential that could not be resolved: "no credential,
/// no call"). The wire still says `Completed`/`Failed` - the execution DID run - and the reservation is
/// RELEASED, because the Host can prove nothing was dispatched. The dispatch fact is the seam's own
/// statement; it is never inferred from the frame's state.
#[test]
fn a_failed_execution_that_provably_dispatched_nothing_releases_the_reservation() {
    let mut live = Live::open();
    let mut rig = Rig::exact(1);
    let composed = compose(&mut live, &mut rig, &request(1, 1)).expect("authorised");
    let mut seam = FixtureReviewExecution::failing(false, None);

    let response = run_authorised_review(composed, &mut seam, &mut rig.budget);

    assert_eq!(response.state(), ResponseState::Completed);
    assert_eq!(response.result(), ResultClass::Failed);
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
    assert_eq!(rig.budget.committed_spend_micro_usd(), COMMITTED);
}
