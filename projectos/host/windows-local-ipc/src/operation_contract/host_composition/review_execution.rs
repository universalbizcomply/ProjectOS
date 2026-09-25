//! PROJECTOS-HOST-REVIEW-PATH1A - THE ONE SHIPPED [`GatekeeperReviewExecution`].
//!
//! A CHILD MODULE FOR THE SAME REASON `canonical_ledger` IS: the seam's sealing supertrait is private
//! to `host_composition`, so the only place a real implementation can live is inside this subtree.
//!
//! ## What it is
//!
//! An ADAPTER, and nothing more. It turns the facts the evaluator sealed into the context the existing
//! ordered review operation takes, drives that operation ONCE through the Host responder, and reports
//! how it ended in the seam's own vocabulary. It restates no step of the operation: the manifest, its
//! signature, the execution closure, the trusted-executable policy, the one-shot subject, the subject's
//! declared bindings, the execution, the cost rule, the verdict rule and the one-shot attestation are
//! all decided in `projectos-host-gatekeeper-attestation`, in the order that crate fixes.
//!
//! ## What it cannot do
//!
//! It resolves no fact, reads no file, opens no pipe, holds no credential and reaches no provider. Every
//! effect arrives as an injected port, so holding one of these opens nothing: the production entry
//! still begins with the owner's signature over the installed manifest, and until an owner has signed a
//! version 2 manifest that entry refuses - DORMANT BY CONSTRUCTION, with no switch in this crate.
//!
//! ## The dispatch fact
//!
//! It is the operation's own statement (`HostRefusal::provider_may_have_been_dispatched`, carried by
//! the responder), never inferred here from how the run ended.

use projectos_host_gatekeeper_attestation::operation::{
    run_gatekeeper_review_attested, AttestationStorePort, AttestedReview, HostPorts, HostRefusal,
    ReviewContext,
};
use projectos_host_gatekeeper_attestation::responder::{respond, ReviewBill, ReviewResponse};
use projectos_host_gatekeeper_attestation::{
    RequestLifecycle, ResponseRecordSink, RetainedRequestInbox, VerifiedRequestBody,
};

use super::{
    gatekeeper_review_execution, AuthorisedProtectedOperation, GatekeeperReviewExecution,
    OneShotRequestSubject, ProviderCallSettlement, ReviewExecutionOutcome, ReviewExecutionRefusal,
    ReviewSubjectFacts,
};
use crate::operation_contract::{BINDING_DIGEST_LEN, CORRELATION_LEN};

/// THE ACCEPTED INBOX CONTRACT, AS COMPOSITION REACHES IT. `OneShotRequestSubject` was a port only
/// because this crate could not name the attestation crate; with the ratified edge it is implemented
/// here, for the one adapter that RETAINS what it read - so the digest composition compares and the
/// bytes the operation executes come from a single open of the request file.
impl OneShotRequestSubject for RetainedRequestInbox<'_> {
    fn consume_once(
        &mut self,
        correlation: &[u8; CORRELATION_LEN],
    ) -> Option<[u8; BINDING_DIGEST_LEN]> {
        self.read_once(correlation)
    }
}

/// Which entry of the review operation this execution drives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Entry {
    /// The production entry: manifest, signature and execution closure FIRST.
    FromTheSignature,
    /// FIXTURE ONLY: steps 4-8, for proofs that cannot hold an owner-signed manifest.
    #[cfg(feature = "test-fixtures")]
    AfterTheClosureForFixture,
}

/// The Host's execution of ONE authorised independent gatekeeper review.
///
/// Borrowed, single-threaded and short-lived: the service composes one around the request it is
/// answering and drops it with the answer.
pub struct HostReviewExecution<'a> {
    ports: HostPorts<'a>,
    lifecycle: &'a mut RequestLifecycle,
    attestations: &'a mut dyn AttestationStorePort,
    responses: &'a mut dyn ResponseRecordSink,
    entry: Entry,
}

impl<'a> HostReviewExecution<'a> {
    /// THE PRODUCTION CONSTRUCTOR. The execution it builds begins with the owner's signature over the
    /// installed manifest, so constructing one grants nothing a caller did not already have.
    #[must_use]
    pub fn new(
        ports: HostPorts<'a>,
        lifecycle: &'a mut RequestLifecycle,
        attestations: &'a mut dyn AttestationStorePort,
        responses: &'a mut dyn ResponseRecordSink,
    ) -> Self {
        Self {
            ports,
            lifecycle,
            attestations,
            responses,
            entry: Entry::FromTheSignature,
        }
    }

    /// FIXTURE ONLY. Drives steps 4-8 of the real operation - the executable policy, the one-shot
    /// subject, the subject gate, the execution port, the cost and verdict rules and the sealed
    /// attestation mint - without the manifest signature no test can hold. No shipped graph enables
    /// the feature, and what runs after the entry point is the production code, unchanged.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn after_the_closure_for_fixture(
        ports: HostPorts<'a>,
        lifecycle: &'a mut RequestLifecycle,
        attestations: &'a mut dyn AttestationStorePort,
        responses: &'a mut dyn ResponseRecordSink,
    ) -> Self {
        Self {
            ports,
            lifecycle,
            attestations,
            responses,
            entry: Entry::AfterTheClosureForFixture,
        }
    }
}

impl gatekeeper_review_execution::Sealed for HostReviewExecution<'_> {}

impl GatekeeperReviewExecution for HostReviewExecution<'_> {
    fn execute(
        &mut self,
        authority: &AuthorisedProtectedOperation,
        subject: &ReviewSubjectFacts,
    ) -> Result<ReviewExecutionOutcome, ReviewExecutionRefusal> {
        // THE FACTS AND THE AUTHORITY ARE ONE REQUEST. The rung hands both from the same composition,
        // so this cannot disagree today; it is checked because an execution under one authority over
        // another request's facts is exactly what this seam exists to make impossible.
        if authority.correlation() != subject.correlation()
            || authority.delegation_id() != subject.delegation_id()
            || authority.parameter_digest() != subject.parameter_digest()
        {
            return Err(ReviewExecutionRefusal::NotDispatched);
        }

        // THE SAME HOST-RESOLVED FACTS THE EVALUATOR SEALED - copied field for field, with nothing
        // taken from a caller and nothing re-derived.
        let ctx = ReviewContext {
            project: *subject.project(),
            repository: *subject.repository(),
            plan: *subject.plan(),
            plan_digest: *subject.plan_digest(),
            phase: *subject.phase(),
            candidate_digest: *subject.candidate_digest(),
            correlation: *subject.correlation(),
            delegation_id: *subject.delegation_id(),
            parameter_digest: subject.parameter_digest(),
            // The approved baseline, from the durable approved-plan record through the SAME composition.
            baseline_commit: *subject.baseline_commit(),
        };

        let ports = &self.ports;
        let lifecycle = &mut *self.lifecycle;
        let attestations = &mut *self.attestations;
        let entry = self.entry;
        let run = |gate: &dyn Fn(&VerifiedRequestBody) -> bool| -> Result<AttestedReview, HostRefusal> {
            match entry {
                Entry::FromTheSignature => {
                    run_gatekeeper_review_attested(ports, lifecycle, attestations, &ctx, gate)
                }
                #[cfg(feature = "test-fixtures")]
                Entry::AfterTheClosureForFixture => {
                    projectos_host_gatekeeper_attestation::operation::run_gatekeeper_review_attested_for_fixture(
                        ports,
                        lifecycle,
                        attestations,
                        &ctx,
                        gate,
                        // The owner-signed policy comes from the verified closure, which no fixture
                        // can hold; the fixture entry states one instead.
                        &projectos_host_gatekeeper_attestation::operation::evidence_fixture::fixture_policy(),
                    )
                }
            }
        };

        match respond(run, &ctx, &mut *self.responses) {
            ReviewResponse::NotStarted => Err(ReviewExecutionRefusal::NotDispatched),
            ReviewResponse::Attested { evidence_ref, bill } => {
                Ok(ReviewExecutionOutcome::Succeeded {
                    evidence_ref,
                    settlement: settlement_of(bill),
                })
            }
            ReviewResponse::Failed {
                evidence_ref,
                provider_dispatched,
                bill,
            } => Ok(ReviewExecutionOutcome::Failed {
                evidence_ref,
                provider_dispatched,
                settlement: bill.map(settlement_of),
            }),
        }
    }
}

/// The attested bill, in the budget authority's own type. A rename, not a calculation: the Host prices
/// nothing, and the figure is the one the attestation carries.
///
/// WHAT THE BUDGET IS CHARGED IS WHAT WAS ADMITTED (PROJECTOS-HOST-REVIEW-PATH1B). The reservation was
/// made at the owner-signed admitted amount and it is settled at that same amount: the Host has no rate
/// card, so there is no other figure it could honestly settle at. The canonical ledger's entry field is
/// named `cost_micro_usd` because that is the ONE ledger's own, shared, accepted vocabulary for "what
/// this entry charges the budget" - it is a budget charge here, not a claim about what a provider
/// billed, and the attestation (which IS the Host's statement about the review) says `admitted`.
fn settlement_of(bill: ReviewBill) -> ProviderCallSettlement {
    ProviderCallSettlement {
        input_tokens: bill.input_tokens,
        cached_input_tokens: bill.cached_input_tokens,
        output_tokens: bill.output_tokens,
        cost_micro_usd: bill.admitted_cost_micro_usd,
    }
}

// GATED ON THE FIXTURE GRAPH for the same reason the composition's own proofs are: they need a live
// `BoundIpcSession`, and the real steps 4-8 are reachable only through the attestation fixture entry.
#[cfg(all(test, feature = "test-fixtures"))]
#[path = "review_execution_tests.rs"]
mod tests;

// THE CROSS-LANGUAGE PROOF, HOST SIDE: the real agent's bytes through the real Host.
#[cfg(all(test, feature = "test-fixtures"))]
#[path = "review_vectors_tests.rs"]
mod vector_tests;
