//! # ProjectOSHost.exe — the minimum Windows service runtime
//!
//! CD-B4-PROJECTOSHOST-SERVICE-RUNTIME1A.
//!
//! A genuine SCM-compatible service: it registers a dispatcher and a control handler, publishes the
//! four required states, and runs an inert loop until the SCM asks it to stop.
//!
//! ## What it deliberately does not do
//!
//! It performs no protected effect of any kind: no file, registry, network, IPC or ProgramData access,
//! no ACL, no SID resolution, no key provisioning, no authority acquisition, no service creation and no
//! UI. Installing and starting it is the installer's job and remains gated behind
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

pub mod lifecycle;
#[cfg(windows)]
pub mod scm;
#[cfg(windows)]
pub mod serve;
#[cfg(windows)]
pub mod status;

/// The exact service name. Frozen: it is not derived from the file name, the command line or the
/// environment, and no other name is representable here.
pub const SERVICE_NAME: &str = "ProjectOSHost";

/// The service ran under the SCM and stopped cleanly.
const EXIT_CLEAN_STOP: u8 = 0;
/// The process was not started by the SCM. Non-zero on purpose: no caller may read success into it.
const EXIT_NOT_A_SERVICE: u8 = 2;

fn main() -> std::process::ExitCode {
    #[cfg(windows)]
    {
        match scm::run_under_scm() {
            Ok(()) => {
                // The dispatcher returns only after the service has stopped.
                println!("{SERVICE_NAME}: stopped");
                std::process::ExitCode::from(EXIT_CLEAN_STOP)
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
