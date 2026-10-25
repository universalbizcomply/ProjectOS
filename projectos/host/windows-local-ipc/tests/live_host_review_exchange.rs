//! LIVE proof of the status-then-review exchange over a REAL named pipe, on an ISOLATED test endpoint.
//!
//! PROJECTOS-HOST-REVIEW-PATH1A.
//!
//! It never touches `\\.\pipe\ProjectOS.Host`: both facades refuse the frozen production run
//! identifier, so the only endpoint reachable here is in the run-scoped test proof namespace. It starts
//! no service, mints no production capability, reads no credential and reaches no provider - the "Host"
//! is a closure in this process.
//!
//! WHY IT IS `#[ignore]`d. The accepted proof-pipe descriptor grants exactly three principals - the
//! ProjectOSHost service SID, LocalSystem and Builtin Administrators - and no interactive user. A
//! NON-ELEVATED process can create the endpoint and can never connect to it, so this proof needs an
//! elevated shell and the ProjectOSHost service principal to be resolvable (the service installed; it
//! need not be running). Run it explicitly:
//!
//! ```text
//! cargo test --offline --features windows-live-ipc,owner-approved-status-read,test-fixtures \
//!     --test live_host_review_exchange -- --ignored --nocapture --test-threads=1
//! ```
//!
//! The same exchange, the same adapter, the same codecs and the same client order are proven on every
//! machine, elevated or not, by the loopback proofs in `src/review_exchange_tests.rs`.

#![cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read",
    feature = "test-fixtures"
))]

use std::sync::mpsc;
use std::time::{SystemTime, UNIX_EPOCH};

use projectos_host_authority::ProjectOsHostPipeSecurity;
use projectos_host_windows_local_ipc::{
    ChannelReport, ClientReviewOutcome, HostReviewIpcCapability, IdentityVerificationReport,
    InstalledHostStatus, LiveIpcOperationCapability, OperationClass, ProtectedOperationRequest,
    ProtectedOperationResponse, ProtectedOperationsReport, ReadinessReport, RejectionReason,
    ResponseState, ResultClass, ReviewNotSent, ServeExchangeOutcome, ServeReviewOutcome,
    ServiceStateReport, TerminalStatus, WindowsHostReviewServer, WindowsHostReviewTestClient,
    INSTALLED_HOST_STATUS_RUN_ID,
};

const EPOCH: u64 = 42;

/// A run identifier unique to this process and moment, so concurrent or repeated runs never share an
/// endpoint. It can never equal the frozen production identifier: the high bit of byte 0 is set and
/// the production identifier is ASCII.
fn unique_run_id() -> [u8; 8] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut id = [0u8; 8];
    id[..4].copy_from_slice(&std::process::id().to_be_bytes());
    id[4..].copy_from_slice(&(nanos as u32).to_be_bytes());
    id[0] |= 0x80;
    id
}

fn status(protected: ProtectedOperationsReport) -> InstalledHostStatus {
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

fn request(seed: u8) -> ProtectedOperationRequest {
    ProtectedOperationRequest::new(
        [seed; 16],
        1,
        EPOCH,
        [0x21; 32],
        OperationClass::IndependentGatekeeperReview,
        [0xaa; 32],
        [0x77; 32],
    )
}

/// Serve ONE exchange on `run_id` in a background thread and report how it ended and what the Host
/// closure was handed.
fn serve_in_background(
    run_id: [u8; 8],
    protected: ProtectedOperationsReport,
) -> (
    mpsc::Receiver<()>,
    std::thread::JoinHandle<(ServeExchangeOutcome, Option<ProtectedOperationRequest>)>,
) {
    let (ready_tx, ready_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let cap = LiveIpcOperationCapability::synthetic_review_scoped_for_fixture();
        let review = HostReviewIpcCapability::synthetic_for_fixture();
        let server =
            WindowsHostReviewServer::for_isolated_test_run(run_id).expect("an isolated run id");
        let security = ProjectOsHostPipeSecurity::resolve().0;
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
        // The endpoint is created inside `serve_one_exchange`; the client retries its connect, so the
        // signal only has to say "the server thread is running".
        let _ = ready_tx.send(());
        let outcome =
            server.serve_one_exchange(&cap, &review, security, || status(protected), &mut host);
        (outcome, seen)
    });
    (ready_rx, handle)
}

fn request_with_retries(run_id: [u8; 8], sent: &ProtectedOperationRequest) -> ClientReviewOutcome {
    let review = HostReviewIpcCapability::synthetic_for_fixture();
    let mut last = None;
    for _ in 0..20 {
        let client =
            WindowsHostReviewTestClient::for_isolated_test_run(run_id).expect("an isolated run id");
        let outcome = client.request_review(&review, sent, 15);
        // Only a connect failure is retried: the endpoint may not exist yet. Anything else is THE
        // answer, and retrying it would hide it.
        if !matches!(outcome, ClientReviewOutcome::NotSent(ReviewNotSent::ConnectFailed(_))) {
            return outcome;
        }
        last = Some(outcome);
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    last.expect("at least one attempt")
}

#[test]
fn neither_facade_can_be_bound_to_the_production_endpoint() {
    assert!(WindowsHostReviewServer::for_isolated_test_run(INSTALLED_HOST_STATUS_RUN_ID).is_none());
    assert!(
        WindowsHostReviewTestClient::for_isolated_test_run(INSTALLED_HOST_STATUS_RUN_ID).is_none()
    );
}

#[test]
#[ignore = "needs an ELEVATED shell: the accepted proof-pipe DACL grants SYSTEM, Administrators and the service SID only"]
fn a_review_request_crosses_a_real_pipe_and_is_answered() {
    let run_id = unique_run_id();
    let sent = request(7);
    let (ready, server) = serve_in_background(run_id, ProtectedOperationsReport::Authorised);
    ready.recv().expect("the server thread started");

    let outcome = request_with_retries(run_id, &sent);
    let (served, seen) = server.join().expect("the server thread finished");

    assert_eq!(
        served,
        ServeExchangeOutcome::ReviewHalf(ServeReviewOutcome::Answered),
        "client saw {outcome:?}"
    );
    assert_eq!(seen, Some(sent), "the Host was handed exactly what was sent");
    let ClientReviewOutcome::Answered(response) = outcome else {
        panic!("expected an answer, got {outcome:?}");
    };
    assert!(response.answers(sent.correlation(), EPOCH));
    assert_eq!(response.state(), ResponseState::Rejected);
    assert_eq!(response.result(), ResultClass::NotRun);
}

#[test]
#[ignore = "needs an ELEVATED shell: the accepted proof-pipe DACL grants SYSTEM, Administrators and the service SID only"]
fn a_host_reporting_refused_is_never_sent_a_request_over_a_real_pipe() {
    let run_id = unique_run_id();
    let (ready, server) = serve_in_background(run_id, ProtectedOperationsReport::Refused);
    ready.recv().expect("the server thread started");

    let outcome = request_with_retries(run_id, &request(8));
    let (served, seen) = server.join().expect("the server thread finished");

    assert_eq!(
        outcome,
        ClientReviewOutcome::NotSent(ReviewNotSent::HostNotAcceptingProtectedOperations)
    );
    assert!(!outcome.may_have_been_dispatched());
    assert_eq!(seen, None, "the Host was never consulted");
    assert!(
        matches!(served, ServeExchangeOutcome::ReviewHalf(ServeReviewOutcome::NoRequest(_))),
        "{served:?}"
    );
}

/// ALWAYS ON, AND TRUTHFUL IN EVERY CONTEXT. One real exchange is attempted on a real isolated pipe and
/// exactly one of three legs is proven - the leg is printed so a reader never has to guess which:
///
/// * `ANSWERED` - an allowlisted principal (an elevated run): the full exchange completed.
/// * `OS-REFUSED` - a principal outside the accepted allowlist (an ordinary run): Windows refused the
///   connect, NOTHING was sent, and the Host was never consulted.
/// * `NOT-PREPARED` - the service principal cannot be resolved on this machine, so the endpoint was
///   never created: nothing was sent and the Host was never consulted.
///
/// There is no leg in which a request reaches the Host without an answer, or is reported sent when it
/// was not.
#[test]
fn a_real_pipe_either_completes_the_exchange_or_refuses_before_anything_is_sent() {
    let run_id = unique_run_id();
    let sent = request(9);
    let (ready, server) = serve_in_background(run_id, ProtectedOperationsReport::Authorised);
    ready.recv().expect("the server thread started");

    let outcome = request_with_retries(run_id, &sent);
    let (served, seen) = server.join().expect("the server thread finished");

    match outcome {
        ClientReviewOutcome::Answered(response) => {
            println!("LEG: ANSWERED (allowlisted principal)");
            assert_eq!(served, ServeExchangeOutcome::ReviewHalf(ServeReviewOutcome::Answered));
            assert_eq!(seen, Some(sent));
            assert!(response.answers(sent.correlation(), EPOCH));
        }
        ClientReviewOutcome::NotSent(ReviewNotSent::ConnectFailed(failure)) => {
            let leg = if matches!(served, ServeExchangeOutcome::StatusHalf(
                projectos_host_windows_local_ipc::ServeStatusOutcome::RefusedPreparation(_)
            )) {
                "NOT-PREPARED"
            } else {
                "OS-REFUSED"
            };
            println!("LEG: {leg} ({failure:?}; served {served:?})");
            assert!(!outcome.may_have_been_dispatched());
            assert_eq!(seen, None, "the Host was consulted although nothing was sent");
            assert!(matches!(served, ServeExchangeOutcome::StatusHalf(_)), "{served:?}");
        }
        other => panic!("a leg outside the three proven ones: {other:?} (served {served:?})"),
    }
}
