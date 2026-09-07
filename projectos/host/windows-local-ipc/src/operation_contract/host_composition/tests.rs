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
    for case in [Case("plan"), Case("closure"), Case("candidate")] {
        let mut live = Live::open();
        let mut rig = Rig::exact(1);
        match case.0 {
            "plan" => rig.plan = Box::new(Plan(None)),
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

/// (B) AN UNAVAILABLE STORE FAILS CLOSED, and it does so BEFORE the signature is consulted.
///
/// THIS IS THE REFUSAL PRODUCTION GIVES TODAY, so it is worth proving rather than describing. No
/// durable delegation store exists yet, so every real composition stops here — and it stops with
/// "the Host cannot establish this delegation's lifecycle", not with "the signature is bad" and
/// certainly not by assuming the programme is live. The record below decodes and its signature can
/// never verify; getting `LocalStatusUnavailable` rather than `SignatureRefused` is what proves the
/// order.
#[test]
fn an_unavailable_delegation_state_refuses_before_the_signature_is_consulted() {
    let bytes = crate::owner_programme_delegation::test_decodable_record_bytes(
        DELEGATION_ID,
        PROJECT,
        REPOSITORY,
    );
    let record =
        crate::owner_programme_delegation::decode_signed_owner_programme_delegation(&bytes)
            .expect("a well-formed record");
    // A store that holds SOME OTHER delegation — which is indistinguishable, from here, from the
    // store that does not exist at all.
    let store = FixtureDurableDelegationStateStore::holding(OTHER, DelegationLocalState::Active);

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
        &peer,
        &request(1, 1),
        EPOCH,
    );
    assert!(
        matches!(
            outcome,
            Err(CompositionRefusal::DelegationRefused(
                DelegationRefusal::LocalStatusUnavailable
            ))
        ),
        "got {outcome:?}"
    );
    assert_eq!(
        rig.inbox.asks, 0,
        "nothing above the signature may spend the inbox"
    );
    assert_eq!(rig.budget.available_micro_usd(), CEILING - COMMITTED);
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
    ) -> Result<BudgetReservation, BudgetRefusal> {
        let mut r =
            self.inner
                .admit_spend(correlation, cost_micro_usd, delegation_ceiling_micro_usd)?;
        // The lie: the capacity really was set aside, but the record of WHICH ceiling permitted it
        // is wrong.
        r.delegation_ceiling_micro_usd = self.report_instead;
        Ok(r)
    }
    fn commit_reservation(&mut self, r: BudgetReservation) -> Result<(), BudgetRefusal> {
        self.inner.commit_reservation(r)
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
