//! `projectos-register-project` — the manual administrator registration command.
//!
//! It exists because installed-project registration is an OUT-OF-BAND SETUP ACTION. The Control
//! Centre never publishes; there is no "Add project" button, no background task and no self-elevation
//! anywhere in this program. An administrator opens an Administrator terminal themselves and runs:
//!
//! ```text
//! projectos-register-project plan    --id <slug> --root <repo> --environments development --frozen true
//! projectos-register-project publish --id <slug> --root <repo> --environments development --frozen true --expect-digest <64 hex>
//! ```
//!
//! `plan` writes nothing and needs no elevation. `publish` prints the same plan again, requires the
//! confirmation phrase typed at a real console, and then attempts the protected write — which
//! re-reads and re-validates everything for itself before touching anything.
//!
//! WHAT THIS BINARY DOES NOT DO, and has no code for: it does not elevate itself, does not launch
//! another process, does not accept a destination path, does not read a destination from the
//! environment, the working directory or a repository, and does not write anywhere except through
//! `publish_project_registry`, which derives the one canonical destination itself.
//!
//! It is built ONLY with `--features registry-publish-effect`; a default build produces no binary at
//! all.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C.

use std::io::{BufRead, Write};
use std::process::ExitCode;

use projectos_host_elevated_installer_composition::registry_publish::admin::{
    run, AdminRefusal, Console, ProductionPublisher, COMMAND_NAME,
};
use projectos_host_elevated_installer_composition::registry_publish::production_destination;

/// The real console: stdout for the plan, stdin for the one confirmation line.
struct RealConsole;

impl Console for RealConsole {
    fn is_interactive(&self) -> bool {
        projectos_host_protected_file_primitives::is_stdin_interactive()
    }
    fn read_line(&mut self) -> Option<String> {
        let mut line = String::new();
        std::io::stdout().flush().ok()?;
        std::io::stdin().lock().read_line(&mut line).ok()?;
        Some(line)
    }
    fn print(&mut self, line: &str) {
        println!("{line}");
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("{COMMAND_NAME}: usage:");
        eprintln!("  {COMMAND_NAME} plan    --id <slug> --root <repo> --environments <list> --frozen <true|false>");
        eprintln!("  {COMMAND_NAME} publish --id <slug> --root <repo> --environments <list> --frozen <true|false> --expect-digest <64 hex>");
        return ExitCode::from(2);
    }

    // DISPLAY TEXT ONLY. The publisher derives the real destination itself; this string is never
    // opened, joined to, or passed anywhere that writes.
    let destination_label = production_destination()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| {
            "<ProgramData>\\ProjectOS\\host\\installation\\projects.v1.json".into()
        });

    match run(
        &args,
        &mut RealConsole,
        &ProductionPublisher,
        &destination_label,
    ) {
        Ok(_) => ExitCode::SUCCESS,
        Err(AdminRefusal::AlreadyRegistered) => {
            println!("This project is already registered exactly as proposed. Nothing to do.");
            ExitCode::SUCCESS
        }
        Err(refusal) => {
            eprintln!("{COMMAND_NAME}: refused: {refusal:?}");
            ExitCode::from(2)
        }
    }
}
