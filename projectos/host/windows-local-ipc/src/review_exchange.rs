//! PROJECTOS-HOST-REVIEW-PATH1A - THE REVIEW EXCHANGE over the EXISTING local IPC transport.
//!
//! ## One endpoint, one handshake, one more pair of frames
//!
//! The accepted capability contract allows exactly ONE production endpoint, so the review exchange
//! cannot have a pipe of its own - and it does not need one. It is the accepted read-only status
//! exchange, UNCHANGED, followed by one fixed-width request and one fixed-width response:
//!
//! ```text
//!   client                                   Host
//!   ControllerHello            ->
//!                              <-            ServiceReady
//!                              <-            InstalledHostStatus      (the accepted exchange ends here)
//!   ProtectedOperationRequest  ->
//!                              <-            ProtectedOperationResponse
//! ```
//!
//! A status client reads the record and closes, exactly as before; a Host that serves only status
//! closes after the record, exactly as before. Nothing about the accepted exchange moved, and both
//! new frames are the message kinds and codecs the operation contract already defined. NO frame was
//! widened: authority crosses the wire, the subject and the answer travel out of band by digest.
//!
//! ## Code existence is not live authority
//!
//! Every function here demands a [`HostReviewIpcCapability`], and that type has NO production mint:
//! no constructor, no `Default`, no conversion, in any shipped graph. The installed service therefore
//! cannot serve a review and nothing can ask it to - the path is complete and DORMANT, and what stands
//! between it and use is an owner-governed mint, not another implementation bridge.
//!
//! ## What the client can and cannot conclude
//!
//! The client outcome keeps apart the one distinction a caller's budget depends on: a request that
//! was NEVER SENT (nothing can have been dispatched) and a request that was sent and went unanswered
//! (a provider may have been reached). It never turns the second into the first.

use crate::adapter::{
    CapabilityScope, HandshakeOutcome, IpcBackend, LiveIpcOperationCapability, LocalIpcAdapter,
    SendOutcome,
};
use crate::operation_contract::{ProtectedOperationRequest, ProtectedOperationResponse};
use crate::protocol::FrameParseError;
use crate::verification::IpcFailure;

/// The private seal. Unnameable outside this module, so the capability below cannot be built by
/// struct literal anywhere else in the crate, let alone outside it.
struct ReviewSeal;

/// The sealed capability to take part in ONE side of a Host review exchange.
///
/// THERE IS NO PRODUCTION MINT. Not behind a feature, not behind a phrase, not behind elevation: no
/// shipped graph contains a function that returns one. It is a SEPARATE type from
/// [`LiveIpcOperationCapability`] on purpose - that capability's single scope is the read-only status
/// read, the accepted contract pins it to exactly that, and a review is not a status read.
pub struct HostReviewIpcCapability {
    _sealed: ReviewSeal,
}

impl core::fmt::Debug for HostReviewIpcCapability {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("HostReviewIpcCapability([SEALED])")
    }
}

#[cfg(feature = "test-fixtures")]
impl HostReviewIpcCapability {
    /// FIXTURE-ONLY. Compiled only under the non-default `test-fixtures` feature, which no shipped
    /// graph enables and which `windows-live-ipc` does not imply. It authorises no provider call and
    /// reaches no credential: it only lets a proof drive the exchange on an isolated test endpoint.
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self {
            _sealed: ReviewSeal,
        }
    }
}

/// Why a governed-review IPC capability was refused. Fail closed; payload-free - it names the check,
/// never a digest, an id or an owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReviewCapabilityRefusal {
    /// The owner-signed delegation is not for an independent gatekeeper review. A delegation for a
    /// provider identity read or a staging read authorises no review, and is not reinterpreted.
    NotAReviewDelegation,
    /// The Host has observed this delegation as completed or revoked. Either ends it.
    RevokedOrCompleted,
}

impl core::fmt::Display for ReviewCapabilityRefusal {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::NotAReviewDelegation => "delegation is not for an independent gatekeeper review",
            Self::RevokedOrCompleted => "delegation is revoked or completed",
        })
    }
}

impl std::error::Error for ReviewCapabilityRefusal {}

impl HostReviewIpcCapability {
    /// THE PRODUCTION MINT (PROJECTOS-HOST-REVIEW-PATH1B G5).
    ///
    /// # Where the authority comes from
    ///
    /// The EXISTING Plan v1.6 unattended-review execution authority, and nothing new: a
    /// [`VerifiedOwnerProgrammeDelegation`]. That type is sealed and its only production mint is
    /// `verify_owner_programme_delegation`, which establishes an ECDSA-P256 signature by the owner
    /// over a domain-separated canonical record, checked against the SAME embedded owner anchor the
    /// packaged trust manifest uses, AND that the record addresses this installation programme, AND
    /// that the Host own durable record says it is live. No new owner approval workflow is
    /// introduced, and none was needed: that authority already roots the whole unattended route.
    ///
    /// # What it is NOT minted from
    ///
    /// Not [`crate::OwnerStatusReadApproval`] and not its required phrase - the status read is a
    /// different question with a different answer. Not a bool, a string, an environment variable, a
    /// command line, an Agent request, a handshake success, a configured-owner SID or elevation.
    /// There is no parameter here but the sealed delegation.
    ///
    /// # Code existence is still not live authority
    ///
    /// Compiling this changes nothing a Host can do. A `VerifiedOwnerProgrammeDelegation` requires
    /// an owner-signed record that ProjectOS cannot manufacture, so live activation still requires
    /// exactly the protected activation inputs Plan v1.6 already defines.
    ///
    /// # Errors
    /// [`ReviewCapabilityRefusal`] naming the first failed check.
    pub fn from_owner_programme_delegation(
        delegation: &crate::operation_contract::VerifiedOwnerProgrammeDelegation,
    ) -> Result<Self, ReviewCapabilityRefusal> {
        let record = delegation.delegation();
        // THE ONE OPERATION CLASS. Matched exhaustively: a future class cannot join by default.
        match record.operation {
            crate::operation_contract::OperationClass::IndependentGatekeeperReview => {}
            crate::operation_contract::OperationClass::ProviderIdentityRead
            | crate::operation_contract::OperationClass::StagingRead => {
                return Err(ReviewCapabilityRefusal::NotAReviewDelegation)
            }
        }
        // A delegation the Host has recorded as finished authorises nothing further. This is a
        // FIELD of the verified record, so it is the owner signed record as the Host verified it,
        // not a separate liveness opinion taken here.
        if record.revoked_or_completed {
            return Err(ReviewCapabilityRefusal::RevokedOrCompleted);
        }
        Ok(Self {
            _sealed: ReviewSeal,
        })
    }

    /// The scope this capability authorises: the governed review, local only.
    #[must_use]
    pub fn scope(&self) -> CapabilityScope {
        CapabilityScope::GovernedHostReviewLocalOnly
    }

    /// Issue the TRANSPORT capability for the one governed review exchange this capability covers.
    ///
    /// # Why this exists and why it is not a widening
    ///
    /// The review exchange IS the accepted status exchange followed by two more frames, so serving
    /// one needs a transport capability. Taking that from the owner STATUS-READ phrase - which is
    /// what the dormant loop did - would mean an unattended review could only run where an in-process
    /// status approval had been transcribed, and would make the status approval a de facto review
    /// authority. That is exactly the conflation G5 forbids.
    ///
    /// So the review authority issues its OWN transport capability, at the GOVERNED REVIEW scope. It
    /// is a different value from the status one and the two are not interchangeable in either
    /// direction: `serve_one_status_exchange` refuses a review-scoped capability and
    /// `serve_one_exchange` refuses a status-scoped one.
    ///
    /// # What it does not carry
    ///
    /// Nothing beyond the six local transport operations the scope names. It reaches no provider, no
    /// credential, no service control and no other message kind - the transport surface a
    /// `LiveIpcOperationCapability` gates is only ever endpoint, handshake, status frame, review
    /// frames, shutdown confirmation and residue classification.
    #[must_use]
    pub fn issue_transport_capability(&self) -> LiveIpcOperationCapability {
        LiveIpcOperationCapability::for_governed_review(self)
    }
}

/// The closed receipt of ONE protected-operation request read. Carries the DECODED request or a
/// specific refusal - never bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProtectedRequestReceipt {
    /// A well-formed request the strict decoder accepted, bound to this exchange's nonce.
    Ok(ProtectedOperationRequest),
    /// The frame did not decode: wrong kind, wrong length, trailing data, unknown enum byte.
    Malformed(FrameParseError),
    /// The frame decoded but carried another exchange's nonce. Refused, never answered.
    RefusedNonce,
    /// A transport failure - redacted. Includes the ordinary case of a status client that read its
    /// record and left.
    Failed(IpcFailure),
}

/// How the review half of one served exchange ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServeReviewOutcome {
    /// One decoded request was handed to the Host and its response was put on the wire.
    Answered,
    /// No request followed the status record. NORMAL: that is what a status client looks like.
    NoRequest(IpcFailure),
    /// A frame followed and was refused. The Host was never consulted and nothing was answered.
    RefusedMalformed(FrameParseError),
    /// A request for another exchange's nonce. The Host was never consulted.
    RefusedNonce,
    /// The Host answered and the response could not be put on the wire. The caller will see an
    /// unanswered request and must treat it as possibly dispatched - which is the truth.
    SendFailed(IpcFailure),
    /// THE TRANSPORT CAPABILITY IS NOT FOR THIS (PROJECTOS-HOST-REVIEW-PATH1B G5). It was minted at
    /// a different [`CapabilityScope`], so no frame was read, the Host was never consulted and
    /// nothing was answered.
    RefusedCapabilityScope(CapabilityScope),
}

impl<B: IpcBackend> LocalIpcAdapter<B> {
    /// Serve the REVIEW HALF of an exchange whose accepted status half has already completed.
    ///
    /// `host` is called AT MOST ONCE, and only with a request the strict decoder accepted under this
    /// exchange's nonce: a malformed, truncated, oversized, trailing-data, wrong-kind or wrong-nonce
    /// frame never reaches it. What it returns is sent as the one response.
    pub fn serve_review_request(
        &self,
        cap: &LiveIpcOperationCapability,
        review: &HostReviewIpcCapability,
        host: &mut dyn FnMut(&ProtectedOperationRequest) -> ProtectedOperationResponse,
    ) -> ServeReviewOutcome {
        // THE SCOPE, BEFORE A BYTE IS READ (G5). Checked HERE as well as in the live facade, so the
        // guarantee holds for any caller of the primitive and does not depend on the route taken.
        if cap.scope() != CapabilityScope::GovernedHostReviewLocalOnly {
            return ServeReviewOutcome::RefusedCapabilityScope(cap.scope());
        }
        let request = match self.receive_protected_operation_request(cap, review) {
            ProtectedRequestReceipt::Ok(request) => request,
            ProtectedRequestReceipt::Malformed(e) => return ServeReviewOutcome::RefusedMalformed(e),
            ProtectedRequestReceipt::RefusedNonce => return ServeReviewOutcome::RefusedNonce,
            ProtectedRequestReceipt::Failed(f) => return ServeReviewOutcome::NoRequest(f),
        };
        let response = host(&request);
        match self.send_protected_operation_response(cap, review, &response) {
            SendOutcome::Sent => ServeReviewOutcome::Answered,
            SendOutcome::Failed(f) => ServeReviewOutcome::SendFailed(f),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// THE CLIENT HALF
// -------------------------------------------------------------------------------------------------

/// Why a review request was NEVER SENT. Nothing can have been dispatched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReviewNotSent {
    /// The endpoint could not be opened: no Host, access denied, or busy.
    ConnectFailed(IpcFailure),
    /// The Host's answer to the hello was not an accepted `ServiceReady`.
    RefusedHandshake(HandshakeOutcome),
    /// A frame before the request did not decode.
    Malformed(FrameParseError),
    /// THE HOST SAID IT IS NOT ACCEPTING PROTECTED OPERATIONS, in the status record it just served -
    /// which is what every installed service reports today. The request is withheld, so a dormant
    /// Host is a clean "never sent" rather than a request written into a connection nobody reads.
    HostNotAcceptingProtectedOperations,
    /// A transport failure before the request was written.
    Failed(IpcFailure),
}

/// Why a SENT review request has no usable answer. A provider MAY have been reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReviewUnanswered {
    /// The response frame did not decode.
    Malformed(FrameParseError),
    /// The response carried another exchange's nonce.
    WrongNonce,
    /// The response answered another correlation.
    WrongCorrelation,
    /// A transport failure after the request was written - including a Host that serves only status
    /// and closed the connection.
    Failed(IpcFailure),
}

/// The closed outcome of one client-side review exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ClientReviewOutcome {
    /// The Host answered THIS request. The response is still only a claim until the caller has
    /// verified the out-of-band record it points at.
    Answered(ProtectedOperationResponse),
    /// The request was never sent.
    NotSent(ReviewNotSent),
    /// The request was sent and went unanswered.
    SentUnanswered(ReviewUnanswered),
}

impl ClientReviewOutcome {
    /// Whether a provider MAY have been reached as far as the TRANSPORT can tell. `false` only when
    /// the request was provably never written. An `Answered` outcome defers to the Host's own
    /// statement and is reported here as `true` so that no caller can read this as a release signal.
    #[must_use]
    pub fn may_have_been_dispatched(&self) -> bool {
        !matches!(self, Self::NotSent(_))
    }
}

/// The three things a review client does to a connection. CRATE-PRIVATE: the only implementors are
/// the live pipe proof client and the fixture loopback, and neither exposes a generic byte send.
///
/// PROOF-ONLY. The production client is the agent's own transport, in another language, and mirrors
/// this order; the order below is what the Host half is proven against.
#[cfg(feature = "test-fixtures")]
pub(crate) trait ReviewClientLink {
    /// Send the accepted `ControllerHello` and verify the `ServiceReady` and the status record.
    fn complete_status_exchange(&mut self) -> Result<(), ReviewNotSent>;
    /// Write the one request frame. `Err` means it was NOT written.
    fn send_request(&mut self, request: &ProtectedOperationRequest) -> Result<(), IpcFailure>;
    /// Read and strictly decode the one response frame, bound to this exchange's nonce.
    fn receive_response(&mut self) -> Result<ProtectedOperationResponse, ReviewUnanswered>;
}

/// THE PRE-SEND GATE, shared by every link. The Host's own status record must say protected operations
/// are authorised before a request is written. It is the Host's statement about itself, read from a
/// strictly decoded frame under this exchange's nonce - and it authorises nothing: a Host that says
/// yes still evaluates the request in full.
#[cfg(feature = "test-fixtures")]
pub(crate) fn require_host_accepting(
    status: crate::protocol::InstalledHostStatus,
) -> Result<(), ReviewNotSent> {
    if status.protected_operations() == crate::protocol::ProtectedOperationsReport::Authorised {
        Ok(())
    } else {
        Err(ReviewNotSent::HostNotAcceptingProtectedOperations)
    }
}

/// THE CLIENT ORDER, shared by every link so there is one opinion about it.
#[cfg(feature = "test-fixtures")]
pub(crate) fn run_review_client(
    link: &mut dyn ReviewClientLink,
    request: &ProtectedOperationRequest,
) -> ClientReviewOutcome {
    if let Err(not_sent) = link.complete_status_exchange() {
        return ClientReviewOutcome::NotSent(not_sent);
    }
    if let Err(f) = link.send_request(request) {
        return ClientReviewOutcome::NotSent(ReviewNotSent::Failed(f));
    }
    match link.receive_response() {
        Ok(response) if response.correlation() == request.correlation() => {
            ClientReviewOutcome::Answered(response)
        }
        Ok(_) => ClientReviewOutcome::SentUnanswered(ReviewUnanswered::WrongCorrelation),
        Err(unanswered) => ClientReviewOutcome::SentUnanswered(unanswered),
    }
}

// -------------------------------------------------------------------------------------------------
// FIXTURE LOOPBACK - the whole exchange over REAL frames, with no pipe
// -------------------------------------------------------------------------------------------------

/// FIXTURE ONLY. An in-process duplex carrying the REAL encoded frames between a real
/// [`LocalIpcAdapter`] and the real client order, so the exchange, the codecs and every frame-level
/// refusal can be proven on any machine with no pipe, no ACL and no elevation.
///
/// It is a stand-in for the PIPE and for nothing else: the adapter, the encoders, the strict decoders
/// and the client order are the shipped ones.
#[cfg(feature = "test-fixtures")]
pub mod loopback {
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::rc::Rc;

    use super::{ProtectedRequestReceipt, ReviewClientLink, ReviewNotSent, ReviewUnanswered};
    use crate::adapter::{
        BackendState, ConnectionState, EndpointOutcome, HandshakeObservation, HandshakeOutcome,
        HandshakeReceipt, IpcBackend, ReceivedFrame, SendOutcome, StatusReceipt,
    };
    use crate::contracts::{EndpointFreshness, IpcResidue, IpcShutdownResult, ReplayClassification};
    use crate::operation_contract::{
        decode_protected_operation_request, decode_protected_operation_response,
        encode_protected_operation_request, encode_protected_operation_response,
        ProtectedOperationRequest, ProtectedOperationResponse,
    };
    use crate::protocol::{
        decode_installed_host_status, encode_control_frame, encode_installed_host_status,
        parse_single_frame, InstalledHostStatus, MessageKind, Nonce, MAX_FRAME_SIZE, NONCE_LEN,
    };
    use crate::verification::{IpcFailure, PeerRole};

    #[derive(Default)]
    struct Wire {
        to_host: RefCell<VecDeque<Vec<u8>>>,
        to_client: RefCell<VecDeque<Vec<u8>>>,
    }

    fn nonce_for(run_id: [u8; 8]) -> Nonce {
        let mut bytes = [0u8; NONCE_LEN];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = run_id[i % run_id.len()];
        }
        Nonce::from_fixed_bytes(bytes)
    }

    /// Build one connected pair bound to `run_id`, exactly as the live backend derives its nonce.
    #[must_use]
    pub fn pair(run_id: [u8; 8]) -> (LoopbackHostBackend, LoopbackClient) {
        let wire = Rc::new(Wire::default());
        (
            LoopbackHostBackend {
                wire: Rc::clone(&wire),
                nonce: nonce_for(run_id),
                nonce_consumed: Cell::new(false),
            },
            LoopbackClient {
                wire,
                nonce: nonce_for(run_id),
                tamper: None,
            },
        )
    }

    /// The HOST end. Mirrors the live backend's frame handling line for line.
    pub struct LoopbackHostBackend {
        wire: Rc<Wire>,
        nonce: Nonce,
        nonce_consumed: Cell<bool>,
    }

    impl LoopbackHostBackend {
        fn read(&self) -> Result<Vec<u8>, IpcFailure> {
            let frame = self
                .wire
                .to_host
                .borrow_mut()
                .pop_front()
                .ok_or(IpcFailure::BrokenPeer)?;
            // The live read buffer is MAX_FRAME_SIZE; a larger message fails the read itself.
            if frame.len() > MAX_FRAME_SIZE {
                return Err(IpcFailure::UnexpectedFailure);
            }
            Ok(frame)
        }
        fn write(&self, frame: &[u8]) -> SendOutcome {
            self.wire.to_client.borrow_mut().push_back(frame.to_vec());
            SendOutcome::Sent
        }
    }

    impl IpcBackend for LoopbackHostBackend {
        fn state(&self) -> BackendState {
            BackendState::Operational
        }
        fn open_endpoint(&self) -> EndpointOutcome {
            EndpointOutcome::FirstInstanceReady
        }
        fn connect_unauthenticated(&self) -> ConnectionState {
            ConnectionState::TransportConnectedUnauthenticated
        }
        fn send_handshake(&self, kind: MessageKind, role: PeerRole) -> SendOutcome {
            self.write(&encode_control_frame(kind, &self.nonce, role.wire()))
        }
        fn receive_handshake(&self) -> HandshakeReceipt {
            match self.read() {
                Ok(buf) => match parse_single_frame(&buf) {
                    Ok((hdr, nonce)) => {
                        let replay = if self.nonce_consumed.get() {
                            ReplayClassification::ReplayRefused
                        } else {
                            ReplayClassification::FreshAccepted
                        };
                        let nonce_matches = nonce == self.nonce;
                        if nonce_matches {
                            self.nonce_consumed.set(true);
                        }
                        HandshakeReceipt::Observed(HandshakeObservation {
                            kind: hdr.kind(),
                            nonce_matches,
                            role: PeerRole::from_wire(hdr.control_flag()),
                            replay,
                            freshness: EndpointFreshness::Fresh,
                        })
                    }
                    Err(e) => HandshakeReceipt::Malformed(e),
                },
                Err(f) => HandshakeReceipt::Failed(f),
            }
        }
        fn receive_frame(&self) -> ReceivedFrame {
            match self.read() {
                Ok(buf) => match parse_single_frame(&buf) {
                    Ok((hdr, _)) => ReceivedFrame::Ok(hdr.kind()),
                    Err(e) => ReceivedFrame::Malformed(e),
                },
                Err(f) => ReceivedFrame::Failed(f),
            }
        }
        fn send_installed_host_status(&self, status: &InstalledHostStatus) -> SendOutcome {
            self.write(&encode_installed_host_status(&self.nonce, status))
        }
        fn receive_installed_host_status(&self) -> StatusReceipt {
            StatusReceipt::Failed(IpcFailure::EndpointUnavailable)
        }
        fn receive_protected_operation_request(&self) -> ProtectedRequestReceipt {
            match self.read() {
                Ok(buf) => match decode_protected_operation_request(&buf) {
                    Ok((request, nonce)) if nonce == self.nonce => {
                        ProtectedRequestReceipt::Ok(request)
                    }
                    Ok(_) => ProtectedRequestReceipt::RefusedNonce,
                    Err(e) => ProtectedRequestReceipt::Malformed(e),
                },
                Err(IpcFailure::UnexpectedFailure) => ProtectedRequestReceipt::Malformed(
                    crate::protocol::FrameParseError::OversizedPayload,
                ),
                Err(f) => ProtectedRequestReceipt::Failed(f),
            }
        }
        fn send_protected_operation_response(
            &self,
            response: &ProtectedOperationResponse,
        ) -> SendOutcome {
            self.write(&encode_protected_operation_response(&self.nonce, response))
        }
        fn send_control(&self, kind: MessageKind) -> SendOutcome {
            self.write(&encode_control_frame(
                kind,
                &self.nonce,
                PeerRole::RefusedOrUnknown.wire(),
            ))
        }
        fn confirm_shutdown(&self) -> IpcShutdownResult {
            IpcShutdownResult::CleanShutdown
        }
        fn close_residue(&self) -> IpcResidue {
            IpcResidue::Zero
        }
        fn has_quarantined_io(&self) -> bool {
            false
        }
        fn wait_between_attempts(&self) {}
    }

    /// A deliberate corruption of the ONE request frame, built inside the fixture. There is no
    /// caller-supplied payload: these are fixed, named, deliberately-invalid requests.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum RequestTamper {
        /// One byte is dropped from the end of the frame.
        Truncated,
        /// One byte is appended after the declared payload.
        TrailingByte,
        /// The frame is padded past the transport's maximum message size.
        Oversized,
        /// The magic is corrupted.
        BadMagic,
        /// The frame is re-encoded under another exchange's nonce.
        OtherNonce,
        /// A well-formed frame of another kind is sent where the request belongs.
        WrongKind,
    }

    /// The CLIENT end.
    pub struct LoopbackClient {
        wire: Rc<Wire>,
        nonce: Nonce,
        tamper: Option<RequestTamper>,
    }

    impl LoopbackClient {
        /// Corrupt the request frame this client will send.
        #[must_use]
        pub fn tampering(mut self, tamper: RequestTamper) -> Self {
            self.tamper = Some(tamper);
            self
        }

        /// STEP 1 of a threadless exchange: queue the hello. The host half is then served, and
        /// [`finish`](Self::finish) completes the client half against what the host queued.
        pub fn send_hello(&self) {
            self.wire.to_host.borrow_mut().push_back(
                encode_control_frame(
                    MessageKind::ControllerHello,
                    &self.nonce,
                    PeerRole::Controller.wire(),
                )
                .to_vec(),
            );
        }

        /// Queue the (possibly tampered) request frame ahead of the host's read.
        pub fn queue_request(&self, request: &ProtectedOperationRequest) {
            let mut frame = encode_protected_operation_request(&self.nonce, request).to_vec();
            match self.tamper {
                None => {}
                Some(RequestTamper::Truncated) => {
                    frame.pop();
                }
                Some(RequestTamper::TrailingByte) => frame.push(0),
                Some(RequestTamper::Oversized) => frame.resize(MAX_FRAME_SIZE + 1, 0),
                Some(RequestTamper::BadMagic) => frame[0] ^= 0xff,
                Some(RequestTamper::OtherNonce) => {
                    frame = encode_protected_operation_request(&nonce_for([0xee; 8]), request)
                        .to_vec();
                }
                Some(RequestTamper::WrongKind) => {
                    frame = encode_control_frame(
                        MessageKind::ShutdownRequest,
                        &self.nonce,
                        PeerRole::Controller.wire(),
                    )
                    .to_vec();
                }
            }
            self.wire.to_host.borrow_mut().push_back(frame);
        }

        /// Queue a request frame PRODUCED ELSEWHERE - the cross-language vectors hold frames the real
        /// TypeScript agent encoded. The Host end judges it with the same strict decoder as any other.
        pub fn queue_request_frame_from_vector(&self, frame: &[u8]) {
            self.wire.to_host.borrow_mut().push_back(frame.to_vec());
        }

        /// A copy of every frame the Host has queued for the client, in order, WITHOUT consuming them.
        /// For the cross-language vectors, which record the real Host's bytes.
        #[must_use]
        pub fn frames_from_host(&self) -> Vec<Vec<u8>> {
            self.wire.to_client.borrow().iter().cloned().collect()
        }

        /// Replace the next frame the client will read, to prove the client's own refusals.
        pub fn corrupt_next_frame_to_client(&self, mutate: impl FnOnce(&mut Vec<u8>)) {
            if let Some(frame) = self.wire.to_client.borrow_mut().back_mut() {
                mutate(frame);
            }
        }

        /// Complete the client half against the frames the host already queued, through the SHIPPED
        /// client order.
        #[must_use]
        pub fn finish(mut self, request: &ProtectedOperationRequest) -> super::ClientReviewOutcome {
            super::run_review_client(&mut Replay(&mut self), request)
        }

        fn read(&self) -> Result<Vec<u8>, IpcFailure> {
            self.wire
                .to_client
                .borrow_mut()
                .pop_front()
                .ok_or(IpcFailure::BrokenPeer)
        }
    }

    /// The link used by [`LoopbackClient::finish`]: the frames to the host were already queued, so the
    /// sends are no-ops and the reads are real.
    struct Replay<'a>(&'a mut LoopbackClient);

    impl ReviewClientLink for Replay<'_> {
        fn complete_status_exchange(&mut self) -> Result<(), ReviewNotSent> {
            let ready = self.0.read().map_err(ReviewNotSent::Failed)?;
            let (hdr, nonce) = parse_single_frame(&ready).map_err(ReviewNotSent::Malformed)?;
            if hdr.kind() != MessageKind::ServiceReady {
                return Err(ReviewNotSent::RefusedHandshake(
                    HandshakeOutcome::RefusedWrongMessageKind,
                ));
            }
            if nonce != self.0.nonce {
                return Err(ReviewNotSent::RefusedHandshake(
                    HandshakeOutcome::RefusedNonceMismatch,
                ));
            }
            if PeerRole::from_wire(hdr.control_flag()) != PeerRole::ServiceFixture {
                return Err(ReviewNotSent::RefusedHandshake(HandshakeOutcome::RefusedRole));
            }
            let status = self.0.read().map_err(ReviewNotSent::Failed)?;
            let (record, nonce) =
                decode_installed_host_status(&status).map_err(ReviewNotSent::Malformed)?;
            if nonce != self.0.nonce {
                return Err(ReviewNotSent::RefusedHandshake(
                    HandshakeOutcome::RefusedNonceMismatch,
                ));
            }
            super::require_host_accepting(record)
        }
        fn send_request(&mut self, _request: &ProtectedOperationRequest) -> Result<(), IpcFailure> {
            Ok(())
        }
        fn receive_response(&mut self) -> Result<ProtectedOperationResponse, ReviewUnanswered> {
            let frame = self.0.read().map_err(ReviewUnanswered::Failed)?;
            let (response, nonce) =
                decode_protected_operation_response(&frame).map_err(ReviewUnanswered::Malformed)?;
            if nonce != self.0.nonce {
                return Err(ReviewUnanswered::WrongNonce);
            }
            Ok(response)
        }
    }
}

#[cfg(all(test, feature = "test-fixtures"))]
#[path = "review_exchange_tests.rs"]
mod tests;
