//! # ProjectOSHost.exe — the packaged host artefact
//!
//! CD-B4-INSTALLER-READINESS1A.
//!
//! This exists so the installer dry run references a REAL binary built from committed source, not a
//! placeholder path. It is deliberately inert.
//!
//! It does not register or run as a Windows service: there is no service control handler, no
//! `StartServiceCtrlDispatcher`, no SCM, registry, pipe, socket or ProgramData access, and no protected
//! effect of any kind. Run interactively it reports the frozen installation effect authority — which is
//! `NotAuthorised` — and exits non-zero, so a machine that somehow launched it gets a refusal rather
//! than a half-started host.

#![forbid(unsafe_code)]

use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;

/// The exact service name this artefact is installed under. Frozen; it is not derived from the file
/// name, the command line or the environment.
const SERVICE_NAME: &str = "ProjectOSHost";

/// Exit code for "the host refused to start". Non-zero on purpose: no caller may read success into it.
const EXIT_NOT_AUTHORISED: i32 = 2;

fn main() -> std::process::ExitCode {
    let authority = InstallationEffectAuthority::current();
    println!("{SERVICE_NAME}: installation effect authority = {authority:?}");
    if authority.is_authorised() {
        // Unreachable while the frozen contract has one variant. It is written as a refusal rather
        // than omitted so that authorising the contract later cannot silently start anything here.
        println!(
            "{SERVICE_NAME}: host activation requires a separate owner gate; refusing to start"
        );
    }
    println!("{SERVICE_NAME}: inert artefact, nothing started");
    std::process::ExitCode::from(EXIT_NOT_AUTHORISED as u8)
}
