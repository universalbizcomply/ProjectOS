//! `projectos-register-project-elevated` — the bounded elevated registration helper.
//!
//! THE ONE OPERATION THIS BINARY CAN PERFORM is publishing a single installed-project registration
//! into the canonical registry. It is what the Control Centre launches through a real Windows UAC
//! elevation prompt when the owner clicks Register (PROJECTOS-PRODUCT-COMPLETION1A §11).
//!
//! ## Why a separate binary from `projectos-register-project`
//!
//! The terminal command keeps its interactive typed-phrase confirmation, unchanged — this binary
//! cannot reach that code path and that code path cannot reach this one. They are two routes with
//! two confirmation mechanisms, and neither weakens the other. Keeping them apart is deliberate: a
//! single binary with a "skip the phrase" flag would mean the terminal command's confirmation could
//! be argued away by an argument, which is precisely what must not be possible.
//!
//! ## What bounds it
//!
//! * It accepts ONLY the registration arguments. There is no destination parameter, no path to
//!   write, no shell, no command to run, no script to evaluate. `parse` refuses an unrecognised
//!   flag rather than ignoring it.
//! * It spawns nothing and launches nothing. An elevated process that can start another process is
//!   an elevated shell wearing a different name.
//! * It performs no I/O beyond the registration itself.
//! * The publication independently re-establishes elevation from the process token, recomputes the
//!   plan from the registry and repository as they are, and re-verifies bytes and descriptor. None
//!   of that is skipped because the caller was elevated.
//! * It is built ONLY with `--features registry-publish-effect`; a default build produces no such
//!   binary at all.
//!
//! ## Exit codes — the entire result channel
//!
//! An elevated process launched by `ShellExecuteW` has no inherited stdout the caller can read, so
//! the outcome is the exit code and nothing else. The caller re-reads the canonical registry to see
//! what actually happened; this code only says which branch was taken.
//!
//! * `0`  registered (created or replaced)
//! * `2`  already registered exactly as proposed — nothing was written, and that is not a failure
//! * `3`  refused before any write (bad arguments, plan refused, publication refused)
//!
//! Created in PROJECTOS-PRODUCT-COMPLETION1A.

use std::process::ExitCode;

use projectos_host_elevated_installer_composition::registry_publish::admin::{
    run_uac_confirmed, AdminRefusal, ProductionPublisher,
};
use projectos_host_elevated_installer_composition::registry_publish::RegistryPublishOutcome;

/// Registered, or already current.
const EXIT_OK: u8 = 0;
/// Already registered exactly as proposed.
const EXIT_ALREADY: u8 = 2;
/// Refused. Nothing was written.
const EXIT_REFUSED: u8 = 3;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match run_uac_confirmed(&args, &ProductionPublisher) {
        Ok(RegistryPublishOutcome::Created | RegistryPublishOutcome::Replaced) => {
            ExitCode::from(EXIT_OK)
        }
        Ok(RegistryPublishOutcome::AlreadyCurrent) => ExitCode::from(EXIT_ALREADY),
        // `RegistryPublishOutcome` is `#[non_exhaustive]`, so a future variant lands here. It is
        // reported as REFUSED rather than OK deliberately: an outcome this binary was not written to
        // understand must not be announced to the owner as a successful registration.
        Ok(_) => ExitCode::from(EXIT_REFUSED),
        Err(AdminRefusal::AlreadyRegistered) => ExitCode::from(EXIT_ALREADY),
        // Every refusal is the same answer to the CALLER: nothing was written. The specific reason
        // is deliberately not encoded into more exit codes — the Control Centre re-reads the
        // registry to establish the real state rather than inferring it from a number.
        //
        // It IS written to stderr, though. Collapsing every refusal to a bare "3" made a real
        // failure undiagnosable: the read-only `plan` accepted this exact registration while the
        // publication refused it, and nothing anywhere said why. stderr is the right channel — an
        // elevated launch through ShellExecuteExW has no inherited pipe, so the Control Centre
        // cannot read this and no refusal detail can leak into the UI, while a human running the
        // helper directly gets the answer immediately.
        Err(refusal) => {
            eprintln!("projectos-register-project-elevated: refused: {refusal:?}");
            ExitCode::from(EXIT_REFUSED)
        }
    }
}
