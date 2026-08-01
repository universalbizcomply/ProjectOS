//! Serving the READ-ONLY installed-host status over the EXISTING named pipe.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! This is the whole of what the installed service does beyond staying alive. It adds no protocol,
//! no request kind, no second pipe and no generic payload route: the existing `ControllerHello` IS
//! the request, and exactly one closed status record is the answer.
//!
//! Everything protected stays refused. The capability this loop holds has a single scope — the
//! read-only status read — so it cannot start, stop, configure or reconfigure anything, cannot write
//! a file, and cannot put any other message on the wire.

use std::sync::atomic::{AtomicBool, Ordering};

use projectos_host_windows_local_ipc::{
    resolve_installed_host_pipe_security, LiveIpcOperationCapability, OwnerStatusReadApproval,
    ServeStatusOutcome, ServiceStateReport, WindowsInstalledHostStatusServer,
};

use crate::status;

/// Bounded pause after a refused or failed exchange, so a service that cannot serve never spins.
const REFUSAL_BACKOFF_MS: u64 = 200;

/// Serve status exchanges until the SCM asks the service to stop.
///
/// Each iteration is a COMPLETE, independent exchange on a freshly created first-instance endpoint
/// with a freshly derived single-use nonce, so a nonce is never reused across clients and a refused
/// request cannot poison the next one.
///
/// The loop observes nothing until a request has been confirmed: `status::observe` is passed as a
/// callback into the transport façade and is invoked only after the handshake accepted.
pub fn serve_installed_host_status_until_stop(stop: &AtomicBool) {
    // The capability is minted from the exact frozen owner phrase. Its ONLY scope is the read-only
    // status read; there is no other capability in this process and no other thing it can authorise.
    let Ok(approval) =
        OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE)
    else {
        // The phrase did not transcribe. Fail closed: serve nothing rather than serve unapproved.
        return;
    };
    let capability = LiveIpcOperationCapability::from_owner_status_read_approval(approval);

    while !stop.load(Ordering::SeqCst) {
        // Resolved read-only, per attempt, from host-authority. Only `Ready` lets the endpoint exist;
        // every other status refuses inside `prepare_server` with no weaker fallback.
        let security = resolve_installed_host_pipe_security();
        let server = WindowsInstalledHostStatusServer::for_installed_host();

        let outcome = server.serve_one_status_exchange(&capability, security, || {
            // The service is Running by construction: this loop runs only between the lifecycle's
            // `running()` and its stop. The state is not guessed from the SCM or from a caller.
            status::observe(ServiceStateReport::Running)
        });

        if outcome != ServeStatusOutcome::StatusServed {
            // A refusal is normal (no client connected within the bounded wait, or a request failed
            // closed). Pause briefly rather than immediately re-creating the endpoint.
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
        }
    }
}
