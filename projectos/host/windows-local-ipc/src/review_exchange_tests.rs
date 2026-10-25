//! Proofs for the review exchange, over REAL frames through the shipped adapter and client order.
//!
//! No pipe, no ACL, no elevation: the loopback stands in for the pipe and for nothing else.

use projectos_host_authority::ProjectOsHostPipeSecurityStatus;

use super::loopback::{pair, LoopbackClient, LoopbackHostBackend, RequestTamper};
use super::*;
use crate::adapter::{ConnectionState, ServerPreparation};
use crate::operation_contract::{
    OperationClass, RejectionReason, ResponseState, ResultClass, TerminalStatus,
};
use crate::protocol::{
    ChannelReport, FrameParseError, IdentityVerificationReport, InstalledHostStatus,
    ProtectedOperationsReport, ReadinessReport, ServiceStateReport,
};

const RUN: [u8; 8] = [0x52, 0x45, 0x56, 0x49, 0x45, 0x57, 0x30, 0x31];
const EPOCH: u64 = 42;

fn request(seed: u8) -> ProtectedOperationRequest {
    ProtectedOperationRequest::new(
        [seed; crate::operation_contract::CORRELATION_LEN],
        1,
        EPOCH,
        [0x21; 32],
        OperationClass::IndependentGatekeeperReview,
        [0xaa; 32],
        [0x77; 32],
    )
}

fn status() -> InstalledHostStatus {
    status_reporting(ProtectedOperationsReport::Authorised)
}

fn status_reporting(protected: ProtectedOperationsReport) -> InstalledHostStatus {
    InstalledHostStatus::new(
        ServiceStateReport::Running,
        IdentityVerificationReport::Verified,
        ChannelReport::Development,
        ReadinessReport::Ready,
        protected,
        *b"0123abcd",
        *b"4567ef01",
    )
    .expect("lower-case hex prefixes")
}

/// Serve the accepted four status steps and then the review half, exactly as the live facade does.
fn serve(
    adapter: &LocalIpcAdapter<LoopbackHostBackend>,
    host: &mut dyn FnMut(&ProtectedOperationRequest) -> ProtectedOperationResponse,
) -> ServeReviewOutcome {
    let cap = LiveIpcOperationCapability::synthetic_review_scoped_for_fixture();
    let review = HostReviewIpcCapability::synthetic_for_fixture();
    assert_eq!(
        adapter.prepare_server(&cap, ProjectOsHostPipeSecurityStatus::Ready),
        ServerPreparation::Prepared
    );
    assert_eq!(
        adapter.accept_unauthenticated(&cap),
        ConnectionState::TransportConnectedUnauthenticated
    );
    assert!(adapter.complete_service_handshake(&cap).is_peer_confirmed());
    assert_eq!(
        adapter.send_installed_host_status(&cap, &status()),
        SendOutcome::Sent
    );
    adapter.serve_review_request(&cap, &review, host)
}

fn refusing_host(calls: &mut u32) -> impl FnMut(&ProtectedOperationRequest) -> ProtectedOperationResponse + '_ {
    move |request| {
        *calls += 1;
        ProtectedOperationResponse::rejected(
            *request.correlation(),
            RejectionReason::PolicyRefused,
            EPOCH,
            TerminalStatus::Terminal,
        )
    }
}

fn exchange(client: LoopbackClient, host_end: LoopbackHostBackend, sent: &ProtectedOperationRequest) -> (ServeReviewOutcome, ClientReviewOutcome, u32) {
    let adapter = LocalIpcAdapter::new(host_end);
    client.send_hello();
    client.queue_request(sent);
    let mut calls = 0;
    let served = {
        let mut host = refusing_host(&mut calls);
        serve(&adapter, &mut host)
    };
    (served, client.finish(sent), calls)
}

/// THE WHOLE EXCHANGE: the accepted status half, then one request decoded strictly, handed to the
/// Host once, and its response read back by the shipped client order.
#[test]
fn a_request_after_the_status_half_reaches_the_host_once_and_is_answered() {
    let (host_end, client) = pair(RUN);
    let sent = request(7);

    let (served, outcome, calls) = exchange(client, host_end, &sent);

    assert_eq!(served, ServeReviewOutcome::Answered);
    assert_eq!(calls, 1);
    let ClientReviewOutcome::Answered(response) = outcome else {
        panic!("expected an answer, got {outcome:?}");
    };
    assert_eq!(response.correlation(), sent.correlation());
    assert_eq!(response.state(), ResponseState::Rejected);
    assert_eq!(response.result(), ResultClass::NotRun);
    assert!(response.answers(sent.correlation(), EPOCH));
}

/// THE HOST SEES EXACTLY WHAT WAS SENT - every field crosses the existing codec unchanged.
#[test]
fn the_host_is_handed_the_request_that_was_sent() {
    let (host_end, client) = pair(RUN);
    let adapter = LocalIpcAdapter::new(host_end);
    let sent = request(9);
    client.send_hello();
    client.queue_request(&sent);
    let mut seen = None;
    let mut host = |r: &ProtectedOperationRequest| {
        seen = Some(*r);
        ProtectedOperationResponse::rejected(
            *r.correlation(),
            RejectionReason::PolicyRefused,
            EPOCH,
            TerminalStatus::Terminal,
        )
    };

    let _ = serve(&adapter, &mut host);

    assert_eq!(seen, Some(sent));
}

/// A STATUS CLIENT IS STILL JUST A STATUS CLIENT. No request follows the record; the Host is never
/// consulted, and that is reported as the ordinary case it is.
#[test]
fn a_status_only_client_never_reaches_the_host() {
    let (host_end, client) = pair(RUN);
    let adapter = LocalIpcAdapter::new(host_end);
    client.send_hello();
    let mut calls = 0;

    let served = {
        let mut host = refusing_host(&mut calls);
        serve(&adapter, &mut host)
    };

    assert!(matches!(served, ServeReviewOutcome::NoRequest(_)), "{served:?}");
    assert_eq!(calls, 0);
}

/// EVERY MALFORMED REQUEST IS REFUSED BEFORE THE HOST IS CONSULTED, and the client - which did write
/// its frame - reports an unanswered request, never a release.
#[test]
fn a_tampered_request_never_reaches_the_host_and_is_never_answered() {
    let cases = [
        (RequestTamper::Truncated, Some(FrameParseError::TruncatedPayload)),
        (RequestTamper::TrailingByte, Some(FrameParseError::TrailingData)),
        (RequestTamper::Oversized, Some(FrameParseError::OversizedPayload)),
        (RequestTamper::BadMagic, Some(FrameParseError::BadMagic)),
        (RequestTamper::WrongKind, Some(FrameParseError::UnexpectedMessageKind)),
        (RequestTamper::OtherNonce, None),
    ];
    for (tamper, expected) in cases {
        let (host_end, client) = pair(RUN);
        let sent = request(3);

        let (served, outcome, calls) = exchange(client.tampering(tamper), host_end, &sent);

        match expected {
            Some(e) => assert_eq!(served, ServeReviewOutcome::RefusedMalformed(e), "{tamper:?}"),
            None => assert_eq!(served, ServeReviewOutcome::RefusedNonce, "{tamper:?}"),
        }
        assert_eq!(calls, 0, "{tamper:?}: the Host was consulted");
        assert!(
            matches!(outcome, ClientReviewOutcome::SentUnanswered(_)),
            "{tamper:?}: {outcome:?}"
        );
        assert!(outcome.may_have_been_dispatched(), "{tamper:?}");
    }
}

/// THE CLIENT TRUSTS NOTHING IT READS. A response for another correlation, a corrupted response and a
/// truncated one are each an UNANSWERED request - sent, and therefore possibly dispatched.
#[test]
fn the_client_refuses_a_response_that_is_not_the_answer_to_its_request() {
    // Another correlation.
    let (host_end, client) = pair(RUN);
    let adapter = LocalIpcAdapter::new(host_end);
    let sent = request(5);
    client.send_hello();
    client.queue_request(&sent);
    let mut host = |_: &ProtectedOperationRequest| {
        ProtectedOperationResponse::rejected(
            [0x99; crate::operation_contract::CORRELATION_LEN],
            RejectionReason::PolicyRefused,
            EPOCH,
            TerminalStatus::Terminal,
        )
    };
    assert_eq!(serve(&adapter, &mut host), ServeReviewOutcome::Answered);
    assert_eq!(
        client.finish(&sent),
        ClientReviewOutcome::SentUnanswered(ReviewUnanswered::WrongCorrelation)
    );

    // A corrupted, a truncated and a padded response frame.
    let corruptions: [(fn(&mut Vec<u8>), FrameParseError); 3] = [
        (|f| f[0] ^= 0xff, FrameParseError::BadMagic),
        (
            |f| {
                f.pop();
            },
            FrameParseError::TruncatedPayload,
        ),
        (|f| f.push(0), FrameParseError::TrailingData),
    ];
    for (corrupt, expected) in corruptions {
        let (host_end, client) = pair(RUN);
        let adapter = LocalIpcAdapter::new(host_end);
        client.send_hello();
        client.queue_request(&sent);
        let mut calls = 0;
        {
            let mut host = refusing_host(&mut calls);
            assert_eq!(serve(&adapter, &mut host), ServeReviewOutcome::Answered);
        }
        client.corrupt_next_frame_to_client(corrupt);

        assert_eq!(
            client.finish(&sent),
            ClientReviewOutcome::SentUnanswered(ReviewUnanswered::Malformed(expected))
        );
    }
}

/// TODAY'S INSTALLED SERVICE reports protected operations REFUSED in the record it serves. The client
/// reads that and WITHHOLDS the request: nothing is written, so nothing can have been dispatched.
#[test]
fn a_host_reporting_protected_operations_refused_is_never_sent_a_request() {
    let (host_end, client) = pair(RUN);
    let adapter = LocalIpcAdapter::new(host_end);
    let cap = LiveIpcOperationCapability::synthetic_for_fixture();
    client.send_hello();
    let _ = adapter.prepare_server(&cap, ProjectOsHostPipeSecurityStatus::Ready);
    let _ = adapter.accept_unauthenticated(&cap);
    assert!(adapter.complete_service_handshake(&cap).is_peer_confirmed());
    let refused = status_reporting(ProtectedOperationsReport::Refused);
    assert_eq!(adapter.send_installed_host_status(&cap, &refused), SendOutcome::Sent);

    let outcome = client.finish(&request(6));

    assert_eq!(
        outcome,
        ClientReviewOutcome::NotSent(ReviewNotSent::HostNotAcceptingProtectedOperations)
    );
    assert!(!outcome.may_have_been_dispatched());
}

/// A HOST THAT CLAIMED TO ACCEPT AND THEN WENT AWAY. The request was written into a connection nobody
/// answered, and the client reports exactly that - sent, therefore possibly dispatched.
#[test]
fn a_host_that_stops_after_the_status_record_leaves_the_request_unanswered() {
    let (host_end, client) = pair(RUN);
    let adapter = LocalIpcAdapter::new(host_end);
    let cap = LiveIpcOperationCapability::synthetic_for_fixture();
    let sent = request(4);
    client.send_hello();
    let _ = adapter.prepare_server(&cap, ProjectOsHostPipeSecurityStatus::Ready);
    let _ = adapter.accept_unauthenticated(&cap);
    assert!(adapter.complete_service_handshake(&cap).is_peer_confirmed());
    assert_eq!(adapter.send_installed_host_status(&cap, &status()), SendOutcome::Sent);
    // ...and the status-only host stops here.

    let outcome = client.finish(&sent);

    assert!(
        matches!(outcome, ClientReviewOutcome::SentUnanswered(ReviewUnanswered::Failed(_))),
        "{outcome:?}"
    );
}

/// NO HOST AT ALL: nothing was written, so nothing can have been dispatched.
#[test]
fn an_absent_host_means_the_request_was_never_sent() {
    let (_host_end, client) = pair(RUN);
    let outcome = client.finish(&request(2));

    assert!(matches!(outcome, ClientReviewOutcome::NotSent(_)), "{outcome:?}");
    assert!(!outcome.may_have_been_dispatched());
}

/// A BACKEND THAT DOES NOT IMPLEMENT THE REVIEW EXCHANGE CANNOT SERVE ONE. The trait methods fail
/// closed by default, so no existing backend gained the ability by their existing.
#[test]
fn a_backend_without_the_review_methods_fails_closed() {
    use crate::adapter::{
        BackendState, EndpointOutcome, HandshakeReceipt, ReceivedFrame, StatusReceipt,
    };
    use crate::contracts::{IpcResidue, IpcShutdownResult};
    use crate::protocol::MessageKind;
    use crate::verification::PeerRole;

    struct Legacy;
    impl IpcBackend for Legacy {
        fn state(&self) -> BackendState {
            BackendState::Operational
        }
        fn open_endpoint(&self) -> EndpointOutcome {
            EndpointOutcome::FirstInstanceReady
        }
        fn connect_unauthenticated(&self) -> ConnectionState {
            ConnectionState::TransportConnectedUnauthenticated
        }
        fn send_handshake(&self, _k: MessageKind, _r: PeerRole) -> SendOutcome {
            SendOutcome::Sent
        }
        fn receive_handshake(&self) -> HandshakeReceipt {
            HandshakeReceipt::Failed(IpcFailure::EndpointUnavailable)
        }
        fn receive_frame(&self) -> ReceivedFrame {
            ReceivedFrame::Failed(IpcFailure::EndpointUnavailable)
        }
        fn send_installed_host_status(&self, _s: &InstalledHostStatus) -> SendOutcome {
            SendOutcome::Sent
        }
        fn receive_installed_host_status(&self) -> StatusReceipt {
            StatusReceipt::Failed(IpcFailure::EndpointUnavailable)
        }
        fn send_control(&self, _k: MessageKind) -> SendOutcome {
            SendOutcome::Sent
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

    let adapter = LocalIpcAdapter::new(Legacy);
    let cap = LiveIpcOperationCapability::synthetic_review_scoped_for_fixture();
    let review = HostReviewIpcCapability::synthetic_for_fixture();
    let mut calls = 0;
    let served = {
        let mut host = refusing_host(&mut calls);
        adapter.serve_review_request(&cap, &review, &mut host)
    };

    assert_eq!(served, ServeReviewOutcome::NoRequest(IpcFailure::EndpointUnavailable));
    assert_eq!(calls, 0);
}

// =================================================================================================
// PROJECTOS-HOST-REVIEW-PATH1B G5 - THE TWO SCOPES, AND WHY NEITHER SUBSTITUTES FOR THE OTHER.
//
// Every test below is a NEGATIVE except the two that show each scope doing its own job. They are
// here rather than in a separate file because they are about this module capability, and a proof
// that lives beside the thing it constrains is the proof that gets updated when it changes.
// =================================================================================================
mod governed_review_capability_scope {
    use super::*;
    use crate::adapter::{CapabilityScope, OwnerStatusReadApproval};
    use crate::operation_contract::VerifiedOwnerProgrammeDelegation;

    /// A verified delegation, through THE REAL VERIFICATION ORDER.
    ///
    /// It does NOT fabricate one. An earlier draft of these proofs called the crate-internal mint
    /// directly, and `val-projectoshost-ipc-operation-contract1a` refused it under O12 — correctly:
    /// only the verification order may reach that mint, because a test that can skip it is a
    /// demonstration that the skip exists. The helper below builds the record, signs it with the
    /// fixture oracle and runs the same signature / programme / liveness order the production entry
    /// runs, so these proofs are about a delegation that really verified.
    fn verified(
        operation: OperationClass,
        finished: bool,
    ) -> Option<VerifiedOwnerProgrammeDelegation> {
        crate::owner_programme_delegation::tests::verified_delegation_for_test(operation, finished)
    }

    // ---- THE MINT ------------------------------------------------------------------------------

    #[test]
    fn a_review_delegation_mints_the_governed_review_capability() {
        let d = verified(OperationClass::IndependentGatekeeperReview, false)
            .expect("the verification order accepts the signed, live review delegation");
        let cap = HostReviewIpcCapability::from_owner_programme_delegation(&d)
            .expect("an owner-signed review delegation");
        assert_eq!(cap.scope(), CapabilityScope::GovernedHostReviewLocalOnly);
    }

    #[test]
    fn a_delegation_for_another_operation_class_mints_nothing() {
        // A delegation the owner signed for a provider identity read or a staging read authorises no
        // review. It is REFUSED, not reinterpreted into the nearest thing it might have meant.
        for other in [
            OperationClass::ProviderIdentityRead,
            OperationClass::StagingRead,
        ] {
            let Some(d) = verified(other, false) else {
                // The delegation record only carries ONE operation class, and the verification
                // order refuses a record whose class this installation may not satisfy. That is
                // itself a refusal of the same proposition, so the case is proven either way.
                continue;
            };
            assert_eq!(
                HostReviewIpcCapability::from_owner_programme_delegation(&d).unwrap_err(),
                ReviewCapabilityRefusal::NotAReviewDelegation,
                "{other:?} must not mint a review capability"
            );
        }
    }

    #[test]
    fn a_finished_delegation_mints_nothing() {
        // A revoked or completed delegation is refused by the LOCAL liveness rung of the
        // verification order, BEFORE the capability mint is ever consulted — which is the stronger
        // of the two refusals. If it ever did verify, the mint must still refuse it, so both are
        // asserted rather than one being assumed.
        match verified(OperationClass::IndependentGatekeeperReview, true) {
            None => {}
            Some(d) => assert_eq!(
                HostReviewIpcCapability::from_owner_programme_delegation(&d).unwrap_err(),
                ReviewCapabilityRefusal::RevokedOrCompleted
            ),
        }
    }

    #[test]
    fn the_refusal_names_the_check_and_never_the_record() {
        // Payload-free: an operator learns which gate said no and nothing about the delegation.
        for r in [
            ReviewCapabilityRefusal::NotAReviewDelegation,
            ReviewCapabilityRefusal::RevokedOrCompleted,
        ] {
            let rendered = format!("{r:?} {r}");
            for leak in ["01010101", "delegation_id", "0x01"] {
                assert!(!rendered.contains(leak), "refusal leaked {leak}: {rendered}");
            }
        }
    }

    // ---- THE TWO SCOPES DO NOT SUBSTITUTE ------------------------------------------------------

    #[test]
    fn the_status_phrase_never_mints_a_review_capability() {
        // There is NO function taking an OwnerStatusReadApproval and returning a
        // HostReviewIpcCapability - the compile-fail doctests on the crate root state that - and the
        // capability the phrase DOES mint carries the status scope and only that.
        let approval =
            OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE).unwrap();
        let status_cap = LiveIpcOperationCapability::from_owner_status_read_approval(approval);
        assert_eq!(
            status_cap.scope(),
            CapabilityScope::ReadInstalledHostStatusLocalOnly
        );
        assert_ne!(
            status_cap.scope(),
            CapabilityScope::GovernedHostReviewLocalOnly
        );
    }

    #[test]
    fn a_status_scoped_capability_cannot_serve_a_governed_review() {
        // THE CORE NEGATIVE. A status capability is presented to the review half: no frame is read,
        // the Host is never consulted and the refusal names the scope.
        let (backend, client) = pair(RUN);
        let adapter = LocalIpcAdapter::new(backend);
        let status_cap = LiveIpcOperationCapability::synthetic_for_fixture();
        let review = HostReviewIpcCapability::synthetic_for_fixture();
        client.send_hello();
        client.queue_request(&request(0x31));
        let mut calls = 0u32;
        let outcome = {
            let mut host = refusing_host(&mut calls);
            adapter.serve_review_request(&status_cap, &review, &mut host)
        };
        assert_eq!(
            outcome,
            ServeReviewOutcome::RefusedCapabilityScope(
                CapabilityScope::ReadInstalledHostStatusLocalOnly
            )
        );
        assert_eq!(calls, 0, "the Host must never have been consulted");
    }

    #[test]
    fn a_review_scoped_capability_does_serve_a_governed_review() {
        // The mirror of the negative above, so the refusal is the SCOPE and not the arrangement.
        let (backend, client) = pair(RUN);
        let adapter = LocalIpcAdapter::new(backend);
        client.send_hello();
        client.queue_request(&request(0x31));
        let mut calls = 0u32;
        let outcome = {
            let mut host = refusing_host(&mut calls);
            serve(&adapter, &mut host)
        };
        assert_eq!(outcome, ServeReviewOutcome::Answered);
        assert_eq!(calls, 1);
    }

    #[test]
    fn the_review_authority_issues_only_its_own_scope() {
        // A review capability cannot silently acquire status/service-control authority: the ONE
        // transport capability it can issue carries the review scope, and there is no argument,
        // builder or setter by which it could issue any other.
        let d = verified(OperationClass::IndependentGatekeeperReview, false)
            .expect("the verification order accepts the signed, live review delegation");
        let review = HostReviewIpcCapability::from_owner_programme_delegation(&d).unwrap();
        let transport = review.issue_transport_capability();
        assert_eq!(
            transport.scope(),
            CapabilityScope::GovernedHostReviewLocalOnly
        );
        assert_ne!(
            transport.scope(),
            CapabilityScope::ReadInstalledHostStatusLocalOnly
        );
        // Issuing twice yields the same scope both times - there is no widening on repetition.
        assert_eq!(
            review.issue_transport_capability().scope(),
            transport.scope()
        );
    }

    #[test]
    fn a_review_capability_is_not_a_provider_or_spend_authority() {
        // The review capability is a TRANSPORT authority. It carries no provider execution and no
        // budget: the execution rung still demands the owner-signed closure, the canonical ledger
        // and the attestation ports, and none of them is reachable from this value. The structural
        // statement is that the type has exactly three methods and none of them yields any of that.
        let d = verified(OperationClass::IndependentGatekeeperReview, false)
            .expect("the verification order accepts the signed, live review delegation");
        let review = HostReviewIpcCapability::from_owner_programme_delegation(&d).unwrap();
        assert_eq!(review.scope(), CapabilityScope::GovernedHostReviewLocalOnly);
        assert!(format!("{review:?}").contains("[SEALED]"));
    }

    #[test]
    fn the_scope_vocabulary_stays_two_distinct_values() {
        // A single generic scope would make every check above vacuous. They are distinct values and
        // are compared by equality, never by a bound or an ordering.
        assert_ne!(
            CapabilityScope::ReadInstalledHostStatusLocalOnly,
            CapabilityScope::GovernedHostReviewLocalOnly
        );
    }
}
