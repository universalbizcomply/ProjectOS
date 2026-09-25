//! # ProjectOSHost.exe — the minimum Windows service runtime
//!
//! CD-B4-PROJECTOSHOST-SERVICE-RUNTIME1A.
//!
//! A genuine SCM-compatible service: it registers a dispatcher and a control handler, publishes the
//! four required states, and runs an inert loop until the SCM asks it to stop.
//!
//! ## What it does at start — RUN-TO-COMPLETION HOST ATTESTATION §10H
//!
//! Before it reports Running it activates the Host's durable state through the ONE production route
//! ([`host_state`]): the Host state root is resolved from the approved Known Folder anchor, its
//! protected boundary is verified live against the accepted production ACL policy, and only then are
//! the durable delegation and replay stores opened beneath it — laying out their leaf directories on
//! first use. Any refusal stops the service with a service-specific error; there is no mode that runs
//! without that state. While running it serves the read-only installed-host status (`serve`).
//!
//! ## What it deliberately does not do
//!
//! No registry write, no network, no ACL or ownership change, no key provisioning, no service
//! creation and no UI, and no path, argument or environment variable is taken as an authority.
//! Installing and starting it is the installer's job and remains gated behind
//! `InstallationEffectAuthority`, which is still `NotAuthorised`.
//!
//! ## Console mode
//!
//! Launched interactively the dispatcher refuses, which is correct and expected. The process reports
//! that refusal and exits non-zero. Console mode holds no service status handle, so it cannot publish
//! a state to the SCM or be mistaken for an authoritative service instance.

// `unsafe` is REQUIRED by the SCM boundary and is confined to `scm`, which documents every call. Every
// unsafe operation must sit in an explicit inner block.
#![deny(unsafe_op_in_unsafe_fn)]

use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;

#[cfg(windows)]
pub mod host_state;
pub mod lifecycle;
#[cfg(windows)]
pub mod scm;
#[cfg(windows)]
pub mod serve;
#[cfg(windows)]
pub mod status;
// PROJECTOS-HOST-REVIEW-PATH1B §10. The trusted startup composition: verified installation ->
// machine-wide authority -> one-shot clock authority -> trusted clock -> ONE provider lease -> ONE
// capability set. Windows-only, because every link in it is a Windows fact.
#[cfg(windows)]
pub mod trusted_startup;
// PROJECTOS-HOST-REVIEW-PATH1B 10/11. The activation adapter: it holds the owner-signed activation
// inputs and the production ports for the life of the serve loop, and re-binds the per-connection
// session and peer into the Host answer on every exchange.
#[cfg(windows)]
pub mod governed_review_activation;

/// The exact service name. Frozen: it is not derived from the file name, the command line or the
/// environment, and no other name is representable here.
pub const SERVICE_NAME: &str = "ProjectOSHost";

/// The service ran under the SCM and stopped cleanly.
const EXIT_CLEAN_STOP: u8 = 0;
/// The process was not started by the SCM. Non-zero on purpose: no caller may read success into it.
const EXIT_NOT_A_SERVICE: u8 = 2;
/// The service ran under the SCM and refused to serve, because the Host's durable state could not be
/// activated. Distinct from not being a service at all.
#[cfg(windows)]
const EXIT_HOST_STATE_REFUSED: u8 = 3;

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    {
        match scm::run_under_scm() {
            Ok(()) => {
                // The dispatcher returns only after the service has stopped.
                println!("{SERVICE_NAME}: stopped");
                std::process::ExitCode::from(EXIT_CLEAN_STOP)
            }
            Err(scm::ScmError::HostStateRefused) => {
                // It DID run under the SCM, and stopped rather than serve without its durable state.
                // The SCM holds the service-specific code naming which link refused.
                println!(
                    "{SERVICE_NAME}: refused to serve: the Host durable state was not activated"
                );
                std::process::ExitCode::from(EXIT_HOST_STATE_REFUSED)
            }
            Err(e) => {
                // The expected interactive outcome. Report it plainly rather than pretending to run.
                println!("{SERVICE_NAME}: not started by the Service Control Manager ({e:?})");
                println!(
                    "{SERVICE_NAME}: installation effect authority = {:?}",
                    InstallationEffectAuthority::current()
                );
                println!("{SERVICE_NAME}: console mode is not authoritative; nothing started");
                std::process::ExitCode::from(EXIT_NOT_A_SERVICE)
            }
        }
    }
    #[cfg(not(windows))]
    {
        println!(
            "{SERVICE_NAME}: Windows-only service host; effect authority = {:?}",
            InstallationEffectAuthority::current()
        );
        std::process::ExitCode::from(EXIT_NOT_A_SERVICE)
    }
}
