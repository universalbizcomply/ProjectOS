//! PROJECTOS-HOST-REVIEW-PATH1B §10/§11 - THE ACTIVATION ADAPTER.
//!
//! # What this closes
//!
//! The governed-review serve loop hands its responder three things: the decoded request, the
//! `BoundIpcSession` minted for THAT connection, and the `TrustedPeerContext` of the client admitted
//! on it. The Host's answer, `answer_review_request`, takes a `HostReviewInputs` in which those two
//! are fields beside the activation ports.
//!
//! Something has to hold the ports for the life of the loop and rebuild that bag per connection.
//! That something is here, in source, so the answer to "does any additional production code still
//! need to be written?" is NO: what remains is supplying VALUES, and every value it wants is an
//! activation input Plan v1.6 already defines.
//!
//! # It activates nothing by itself
//!
//! Holding one grants nothing. The two fields that matter are an OWNER-SIGNED programme delegation
//! record and the sealed attested installation programme - an ECDSA-P256 signature over a canonical
//! record, and the installed trust manifest's signature over the installation's committed bytes.
//! ProjectOS does not hold the owner's private key and must never hold it, so nothing in this
//! repository can produce either.

use projectos_host_gatekeeper_attestation::operation::{AttestationStorePort, HostPorts};
use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestLifecycle, ResponseRecordSink,
};
use projectos_host_gatekeeper_review_composition::review_dispatch::{
    answer_review_request, HostReviewInputs,
};
use projectos_host_identity::AttestedInstallationProgramme;
use projectos_host_core::{BoundIpcSession, InMemoryRequestAdmissionStore};
use projectos_host_windows_local_ipc::{
    AdmittedCostSource, CanonicalBudgetLedger, CommittedCandidateSource,
    DurableDelegationStateStore, HostPlanAuthority, ProtectedOperationRequest,
    ProtectedOperationResponse, RequestReplayLedger, SignedExecutionClosureFacts,
    SignedOwnerProgrammeDelegation, TrustedPeerContext,
};

/// Everything the Host needs to answer governed review requests, EXCEPT the per-connection session
/// and peer - which are produced by the serve loop and supplied per exchange.
///
/// Every field is an activation input or a production port the installation already has an adapter
/// for. None is, or can be derived from, anything a client sends: the review request frame carries a
/// correlation, a sequence, a claimed service epoch, a binding digest, an operation class, an
/// approval reference and a parameter digest, and nothing here corresponds to any of them.
pub struct GovernedReviewActivation<'a> {
    /// The OWNER-SIGNED programme delegation record. An activation input.
    pub delegation_record: &'a SignedOwnerProgrammeDelegation,
    /// The sealed attested installation programme. An activation input.
    pub attested_programme: &'a AttestedInstallationProgramme,
    /// The Host's own durable record of each delegation's lifecycle.
    pub delegation_state: &'a dyn DurableDelegationStateStore,
    /// The durable approved-plan authority.
    pub plan: &'a dyn HostPlanAuthority,
    /// The model and credential policy of the signed execution closure.
    pub closure: &'a dyn SignedExecutionClosureFacts,
    /// The immutable committed candidate the Host pinned for itself.
    ///
    /// PINNED PER EXCHANGE, NOT PER LOOP. On the unattended route every review is preceded by a local
    /// candidate commit (PATH1B unit L), so HEAD moves between reviews; a reader pinned once at service
    /// start would answer every later request about a stale commit, and the agent's claim would be
    /// refused as a candidate mismatch. Whatever composes this adapter must therefore build it - with the
    /// operation ports' `evidence` over the same reader - for each exchange. (That composition is the
    /// service-entry resolver of criterion 21, which is not yet written: see the PATH1B gate report.)
    pub candidate: &'a dyn CommittedCandidateSource,
    /// The admitted cost of this call.
    pub cost: &'a dyn AdmittedCostSource,
    /// The request inbox.
    pub inbox: &'a dyn InboxReader,
    /// The canonical budget ledger.
    pub ledger: &'a mut dyn CanonicalBudgetLedger,
    // NO ADMISSION STORE IS HELD HERE (PATH1B resume, 2026-09-25). The one production store,
    // `InMemoryRequestAdmissionStore`, is bound to ONE `BoundIpcSession` and refuses every other session
    // (`StoreNotBoundToSession`). Every connection mints its own session, so a store held for the life of
    // the loop would admit the first connection's request and refuse every later one. `answer` makes the
    // session's ONE admission history from the session it is handed.
    /// The Host-wide durable replay history.
    pub replay: &'a mut dyn RequestReplayLedger,
    /// This service instance's epoch.
    pub service_epoch: u64,
    /// The review operation's manifest, committed-bytes, executable-policy, execution, clock and
    /// candidate-evidence ports.
    pub operation_ports: HostPorts<'a>,
    /// The operation's one-shot request lifecycle.
    pub lifecycle: &'a mut RequestLifecycle,
    /// The durable attestation store.
    pub attestations: &'a mut dyn AttestationStorePort,
    /// The response outbox.
    pub responses: &'a mut dyn ResponseRecordSink,
}

impl GovernedReviewActivation<'_> {
    /// Answer ONE governed review request, for the connection the serve loop has already admitted.
    ///
    /// `session` and `peer` are NOT stored: they belong to one connection, and a retained session is
    /// a session that outlives its own admission. They are re-bound into the input bag on every
    /// call, so a request can only ever be composed against the connection it actually arrived on.
    ///
    /// Everything else is this adapter's own port set, re-borrowed per call. The composition,
    /// the execution rung and the attestation are unchanged: this is plumbing and nothing else - it
    /// makes no decision, resolves no fact and adds no branch.
    pub fn answer(
        &mut self,
        request: &ProtectedOperationRequest,
        session: &BoundIpcSession,
        peer: &TrustedPeerContext,
    ) -> ProtectedOperationResponse {
        // The session's ONE admission history, bound to exactly this session. A connection is one
        // exchange, so this is the whole of that session's history - never shared with another.
        let mut admissions = InMemoryRequestAdmissionStore::for_session(session);
        let mut inputs = HostReviewInputs {
            delegation_record: self.delegation_record,
            attested_programme: self.attested_programme,
            delegation_state: self.delegation_state,
            plan: self.plan,
            closure: self.closure,
            candidate: self.candidate,
            cost: self.cost,
            inbox: self.inbox,
            ledger: &mut *self.ledger,
            session,
            admissions: &mut admissions,
            replay: &mut *self.replay,
            peer,
            service_epoch: self.service_epoch,
            operation_ports: HostPorts {
                manifest: self.operation_ports.manifest,
                committed: self.operation_ports.committed,
                executables: self.operation_ports.executables,
                inbox: self.operation_ports.inbox,
                execution: self.operation_ports.execution,
                clock: self.operation_ports.clock,
                evidence: self.operation_ports.evidence,
            },
            lifecycle: &mut *self.lifecycle,
            attestations: &mut *self.attestations,
            responses: &mut *self.responses,
        };
        answer_review_request(&mut inputs, request)
    }
}
