//! THE HOST REVIEW RESPONDER: one authorised review, from verified subject to bound response record.
//!
//! PROJECTOS-HOST-REVIEW-PATH1A. This is the production logic the sealed execution seam in
//! `windows-local-ipc` drives. It adds no second reviewer path and no provider access: the ONLY thing
//! that can reach a provider is still the existing ordered operation, handed in as `run`.
//!
//! ## What it decides, and what it does not
//!
//! It decides how ONE run of the existing operation is reported: whether the review never began, or ran
//! and was attested, or ran and failed - and, for a failure, the Host-authoritative answer to "may a
//! provider have been reached". It resolves no fact, mints no authority and mints no attestation: the
//! facts arrive in `ctx` from the composition that resolved them, and the attestation comes from the
//! operation's own sealed mint.
//!
//! ## Pure over ports
//!
//! No file, no pipe, no process, no clock of its own. The response record leaves through
//! [`ResponseRecordSink`], so every property here is provable without touching a disk.

use std::cell::RefCell;

use crate::envelope::{
    attested_record_bytes, evidence_ref_of, failed_record_bytes, parse_review_subject,
    verify_declared_bindings, ReviewSubject, EVIDENCE_REF_LEN,
};
use crate::operation::{AttestedReview, HostRefusal, ReviewContext};
use crate::{
    ResponseFileIdentity, ResponseRecordSink, VerifiedRequestBody, MAX_RESPONSE_RECORD_BYTES,
};

/// What the caller's budget authority needs to settle one review: the provider's own usage report, and
/// the amount the Host ADMITTED. There is no provider cost here - the Host has no rate card.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewBill {
    /// Input tokens billed.
    pub input_tokens: u64,
    /// Cached input tokens, when reported.
    pub cached_input_tokens: Option<u64>,
    /// Output tokens billed.
    pub output_tokens: u64,
    /// The amount the Host admitted against the budget, in micro-USD, as attested. NOT a provider cost.
    pub admitted_cost_micro_usd: u64,
}

/// How one authorised review ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewResponse {
    /// The review NEVER BEGAN EXECUTING: the manifest, the closure, the executable policy, the one-shot
    /// subject or its declared bindings refused it. Nothing was dispatched and no record was written.
    NotStarted,
    /// The review ran, was attested, and its response record is durably written.
    Attested {
        /// Binds the record to the wire completion.
        evidence_ref: [u8; EVIDENCE_REF_LEN],
        /// What the provider billed.
        bill: ReviewBill,
    },
    /// The execution ran and produced no usable attested answer.
    Failed {
        /// Binds the failure record to the wire completion. Zero when no record could be written.
        evidence_ref: [u8; EVIDENCE_REF_LEN],
        /// THE HOST-AUTHORITATIVE DISPATCH FACT.
        provider_dispatched: bool,
        /// What the provider billed, when the Host knows. Known only when an attestation was minted
        /// and the record then could not be written.
        bill: Option<ReviewBill>,
    },
}

/// Run ONE review through `run` and report it, writing the bound response record.
///
/// `run` is the existing ordered operation (`run_gatekeeper_review_attested`), partially applied to
/// its ports. It is handed the SUBJECT GATE this function builds: the gate parses the digest-bound
/// subject and proves its DECLARED bindings equal the Host's facts, so a subject declaring another
/// project, phase or candidate is refused before anything executes. It does not, and cannot, judge
/// whether the opaque provider text is a faithful account of that candidate - see
/// [`verify_declared_bindings`].
pub fn respond(
    run: impl FnOnce(&dyn Fn(&VerifiedRequestBody) -> bool) -> Result<AttestedReview, HostRefusal>,
    ctx: &ReviewContext<'_>,
    sink: &mut dyn ResponseRecordSink,
) -> ReviewResponse {
    // The gate is the one place the subject is parsed, and it keeps what it parsed: a failure record
    // needs the declared bindings, and a failed run does not hand the subject back.
    let parsed: RefCell<Option<ReviewSubject>> = RefCell::new(None);
    let gate = |body: &VerifiedRequestBody| -> bool {
        match parse_review_subject(body) {
            Some(subject) if verify_declared_bindings(&subject, ctx) => {
                *parsed.borrow_mut() = Some(subject);
                true
            }
            _ => false,
        }
    };

    let outcome = run(&gate);
    let subject = parsed.into_inner();
    let identity = ResponseFileIdentity::for_correlation(&ctx.correlation);

    match (outcome, subject) {
        (Ok(review), Some(subject)) => {
            let a = &review.attestation;
            let bill = ReviewBill {
                input_tokens: a.input_tokens(),
                cached_input_tokens: review.cached_input_tokens,
                output_tokens: a.output_tokens(),
                admitted_cost_micro_usd: a.admitted_cost_micro_usd(),
            };
            let record = attested_record_bytes(&subject, &review);
            if write(sink, &identity, &record) {
                ReviewResponse::Attested {
                    evidence_ref: evidence_ref_of(&record),
                    bill,
                }
            } else {
                // The provider answered and was paid; only the record was lost. That is a failure the
                // caller cannot read an answer from, and the bill is KNOWN, so it is reported.
                ReviewResponse::Failed {
                    evidence_ref: [0u8; EVIDENCE_REF_LEN],
                    provider_dispatched: true,
                    bill: Some(bill),
                }
            }
        }
        // An attested review always passed the gate, so a subject is always present with `Ok`. If that
        // ever stopped being true the provider was still reached: fail, conservatively.
        (Ok(_), None) => ReviewResponse::Failed {
            evidence_ref: [0u8; EVIDENCE_REF_LEN],
            provider_dispatched: true,
            bill: None,
        },
        // The gate admitted the subject, so EXECUTION WAS ATTEMPTED; the operation says whether a
        // provider may have been reached.
        (Err(refusal), Some(subject)) => {
            let provider_dispatched = refusal.provider_may_have_been_dispatched();
            let record = failed_record_bytes(&subject, &ctx.correlation, provider_dispatched);
            let evidence_ref = if write(sink, &identity, &record) {
                evidence_ref_of(&record)
            } else {
                [0u8; EVIDENCE_REF_LEN]
            };
            ReviewResponse::Failed {
                evidence_ref,
                provider_dispatched,
                bill: None,
            }
        }
        // The gate never admitted a subject, so the review never began executing. Every refusal that
        // can land here is decided before step 6; the assertion keeps that true if the order changes.
        (Err(refusal), None) => {
            debug_assert!(
                !refusal.provider_may_have_been_dispatched(),
                "a refusal before the subject gate cannot have dispatched anything"
            );
            if refusal.provider_may_have_been_dispatched() {
                ReviewResponse::Failed {
                    evidence_ref: [0u8; EVIDENCE_REF_LEN],
                    provider_dispatched: true,
                    bill: None,
                }
            } else {
                ReviewResponse::NotStarted
            }
        }
    }
}

fn write(
    sink: &mut dyn ResponseRecordSink,
    identity: &ResponseFileIdentity,
    record: &[u8],
) -> bool {
    !record.is_empty()
        && record.len() <= MAX_RESPONSE_RECORD_BYTES
        && sink.store_once(identity, record)
}

#[cfg(test)]
#[path = "responder_tests.rs"]
mod tests;
