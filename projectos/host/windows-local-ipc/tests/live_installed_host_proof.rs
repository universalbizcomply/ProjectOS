//! LIVE proof against the INSTALLED ProjectOSHost service.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! Every test here is `#[ignore]`d: it requires the real service to be installed and running, so it
//! never runs in an ordinary `cargo test` and never blocks a machine that has no installed host.
//! Run it explicitly:
//!
//! ```text
//! cargo test --features windows-live-ipc,owner-approved-status-read,test-fixtures \
//!     --test live_installed_host_proof -- --ignored --nocapture --test-threads=1
//! ```
//!
//! It is READ-ONLY: it starts, stops, configures and writes nothing. The only things it puts on the
//! wire are one `ControllerHello` and three deliberately-invalid requests that must all be refused.

#![cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read",
    feature = "test-fixtures"
))]

use projectos_host_windows_local_ipc::{
    ClientStatusReadOutcome, IdentityVerificationReport, LiveIpcOperationCapability,
    OwnerStatusReadApproval, ProtectedOperationsReport, ReadinessReport, RefusalProbe,
    ServiceStateReport, WindowsInstalledHostStatusClient,
};

/// Mint the one read-only capability from the exact owner phrase.
fn capability() -> LiveIpcOperationCapability {
    let approval = OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE)
        .expect("the frozen owner phrase must transcribe");
    LiveIpcOperationCapability::from_owner_status_read_approval(approval)
}

/// The service serves ONE exchange per loop iteration, so a probe and the real read may race with
/// each other's endpoint teardown. Retry a bounded number of times before declaring a failure.
fn read_status_with_retries(
    cap: &LiveIpcOperationCapability,
    attempts: u32,
) -> ClientStatusReadOutcome {
    let mut last = ClientStatusReadOutcome::RefusedHandshake(
        projectos_host_windows_local_ipc::HandshakeOutcome::TransportConnectedUnauthenticated,
    );
    for _ in 0..attempts {
        let client = WindowsInstalledHostStatusClient::for_installed_host();
        last = client.read_installed_host_status(cap);
        if matches!(last, ClientStatusReadOutcome::Status(_)) {
            return last;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    last
}

#[test]
#[ignore = "requires the installed ProjectOSHost service to be running"]
fn the_installed_host_answers_one_read_only_status_request() {
    let cap = capability();
    let outcome = read_status_with_retries(&cap, 24);
    let ClientStatusReadOutcome::Status(status) = outcome else {
        panic!("expected a decoded status record, got {outcome:?}");
    };

    // The service reports itself Running — it is serving this very exchange.
    assert_eq!(status.service_state(), ServiceStateReport::Running);
    // The installed identity verifies through the frozen reader contract.
    assert_eq!(status.identity(), IdentityVerificationReport::Verified);
    // A Verified identity on a Running service is Ready.
    assert_eq!(status.readiness(), ReadinessReport::Ready);
    // Protected operations are ALWAYS refused.
    assert_eq!(
        status.protected_operations(),
        ProtectedOperationsReport::Refused
    );

    // Both prefixes are 8 lower-case hex characters and neither is the unavailable placeholder.
    for prefix in [status.build_prefix(), status.manifest_prefix()] {
        let s = std::str::from_utf8(prefix).expect("a prefix is ASCII by construction");
        assert_eq!(s.len(), 8, "a prefix is exactly 8 characters");
        assert!(
            s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "a prefix is lower-case hex: {s}"
        );
        assert_ne!(s, "00000000", "the unavailable placeholder was reported");
    }

    println!(
        "LIVE: service={:?} identity={:?} channel={:?} readiness={:?} protected={:?} build={} manifest={}",
        status.service_state(),
        status.identity(),
        status.channel(),
        status.readiness(),
        status.protected_operations(),
        std::str::from_utf8(status.build_prefix()).unwrap(),
        std::str::from_utf8(status.manifest_prefix()).unwrap(),
    );
}

#[test]
#[ignore = "requires the installed ProjectOSHost service to be running"]
fn a_wrong_kind_request_is_refused_and_yields_no_status() {
    let cap = capability();
    let client = WindowsInstalledHostStatusClient::for_installed_host();
    let outcome = client.probe_refusal(&cap, RefusalProbe::WrongMessageKind);
    assert!(
        !matches!(outcome, ClientStatusReadOutcome::Status(_)),
        "a wrong-kind request must never be answered with a status: {outcome:?}"
    );
    println!("LIVE: wrong-kind request refused -> {outcome:?}");
}

#[test]
#[ignore = "requires the installed ProjectOSHost service to be running"]
fn a_malformed_request_is_refused_and_yields_no_status() {
    let cap = capability();
    let client = WindowsInstalledHostStatusClient::for_installed_host();
    let outcome = client.probe_refusal(&cap, RefusalProbe::MalformedFrame);
    assert!(
        !matches!(outcome, ClientStatusReadOutcome::Status(_)),
        "a malformed request must never be answered with a status: {outcome:?}"
    );
    println!("LIVE: malformed request refused -> {outcome:?}");
}

#[test]
#[ignore = "requires the installed ProjectOSHost service to be running"]
fn a_wrong_role_request_is_refused_and_yields_no_status() {
    let cap = capability();
    let client = WindowsInstalledHostStatusClient::for_installed_host();
    let outcome = client.probe_refusal(&cap, RefusalProbe::WrongPeerRole);
    assert!(
        !matches!(outcome, ClientStatusReadOutcome::Status(_)),
        "a wrong-role request must never be answered with a status: {outcome:?}"
    );
    println!("LIVE: wrong-role request refused -> {outcome:?}");
}

/// An UNAUTHORISED caller cannot read. This needs no service: the capability is the gate, and
/// without the exact phrase there is no capability and therefore no call to make.
#[test]
fn an_unauthorised_caller_obtains_no_capability_and_reads_nothing() {
    for wrong in [
        "",
        "approved",
        "APPROVED: one local read-only IPC capability for retrieving installed ProjectOSHost statu",
        "APPROVED: one local read-only IPC capability for retrieving installed ProjectOSHost status ",
        "approved: one local read-only ipc capability for retrieving installed projectoshost status",
    ] {
        assert!(
            OwnerStatusReadApproval::transcribe(wrong).is_err(),
            "an inexact phrase must never yield an approval: {wrong:?}"
        );
    }
    // The exact phrase is the ONLY accepted one.
    assert!(OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE).is_ok());
}
