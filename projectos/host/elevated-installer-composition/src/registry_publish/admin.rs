//! THE MANUAL ADMINISTRATOR REGISTRATION COMMAND.
//!
//! Registering an installed project is an OUT-OF-BAND SETUP ACTION, not something ProjectOS does for
//! itself. The owner runs `projectos install` to put a `.projectops` into a repository; that process
//! is ordinary, unelevated, and cannot publish anything. To make the installed application aware of
//! the project, an administrator opens an Administrator terminal themselves and runs this command
//! once.
//!
//! ## Two modes, and only one of them writes
//!
//! * `plan` — read-only. It prints the complete proposed registration: project id, canonical
//!   repository root, permitted environments, production-frozen status, the canonical registry digest
//!   and the fixed destination. It needs no elevation, changes nothing, and ends by printing the exact
//!   `publish` command to run.
//! * `publish` — prints the same plan AGAIN, requires the administrator to type a confirmation
//!   phrase at a real console, and only then attempts the protected publication.
//!
//! ## What the administrator supplies, and what it is worth
//!
//! The id, root, environments and freeze state say WHICH project to register. The expected digest
//! says what the administrator was shown. NONE of it is trusted: the publication re-reads the registry
//! and the repository, recomputes the whole registration from what is actually on disk, and refuses if
//! the result does not match the digest the administrator saw. A plan made against an older world is
//! not authority over the newer one.
//!
//! There is no destination parameter, here or anywhere below.
//!
//! ## The confirmation phrase is HUMAN CONFIRMATION. Nothing more.
//!
//! It is not secret material, not a capability, not owner-presence proof, and not protection against a
//! compromised administrator. It exists so a protected write cannot happen without a person reading
//! what it will do and typing an acknowledgement at a console. `is_stdin_interactive` refuses a piped
//! or redirected stream for the same reason: an approval that can be automated is not a confirmation.
//!
//! ## The threat boundary, stated truthfully
//!
//! `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators` and `NT SERVICE\ProjectOSHost` are TRUSTED WRITERS
//! to this protected installation area — the Windows DACL grants Administrators Full Control, and this
//! command runs as one of them. Nothing here protects the registry from a compromised administrator,
//! and no text in this crate should be read as claiming otherwise. What the descriptor does protect
//! against is an ORDINARY user, who holds read and nothing else.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C (administrator registration command).

use projectos_project_registry::{
    plan_registration, RealRegistryFacts, RegisteredProjectV1, RegistrationPlan,
    PERMITTED_ENVIRONMENT_NAMES,
};

use super::{
    digest_hex, PlannedRegistration, RegistryPublishOutcome, RegistryPublishRefusal,
    REGISTRY_PUBLISH_PHRASE,
};

/// The command's own name, as it appears in the printed instructions.
pub const COMMAND_NAME: &str = "projectos-register-project";

/// Why the command refused before any publication was attempted.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum AdminRefusal {
    /// The mode was missing or was not `plan` / `publish`.
    UnknownMode,
    /// A required argument was missing.
    MissingArgument(&'static str),
    /// An argument was present but malformed.
    InvalidArgument(&'static str),
    /// The proposed registration could not be planned — the registry or the repository refused it.
    PlanRefused(String),
    /// The project is already registered exactly as proposed. Nothing to do.
    AlreadyRegistered,
    /// Standard input is not an interactive console, so no confirmation can be given. An approval
    /// that can be piped is not a confirmation.
    NotInteractive,
    /// The confirmation phrase was not typed exactly.
    NotConfirmed,
    /// The publication itself refused.
    PublishRefused(RegistryPublishRefusal),
}

/// The console the command talks to. A seam, so the confirmation boundary is exercisable without a
/// terminal — and so a test can prove the ORDER of the checks, not merely their presence.
pub trait Console {
    /// Whether standard input is a real interactive console.
    fn is_interactive(&self) -> bool;
    /// Read one line of confirmation. `None` if nothing could be read.
    fn read_line(&mut self) -> Option<String>;
    /// Emit one line to the operator.
    fn print(&mut self, line: &str);
}

/// The thing that performs the protected publication. Production wires
/// [`super::publish_project_registry`], which derives the destination itself and takes no path.
pub trait Publisher {
    /// # Errors
    /// [`RegistryPublishRefusal`] naming the first failure.
    fn publish(
        &self,
        approval_phrase: &str,
        plan: &PlannedRegistration,
    ) -> Result<RegistryPublishOutcome, RegistryPublishRefusal>;
}

/// One parsed invocation. Deliberately has NO destination field.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    publish: bool,
    proposed: RegisteredProjectV1,
    expected_digest: Option<String>,
}

fn value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
        .filter(|v| !v.starts_with("--"))
}

/// Parse argv into an invocation, or refuse.
///
/// EVERY accepted flag is listed here, and a destination is not among them. An unknown flag is
/// refused rather than ignored: a command that silently drops what it does not understand is a
/// command whose behaviour depends on spelling.
fn parse(args: &[String]) -> Result<Invocation, AdminRefusal> {
    let publish = match args.first().map(String::as_str) {
        Some("plan") => false,
        Some("publish") => true,
        _ => return Err(AdminRefusal::UnknownMode),
    };
    const ACCEPTED: [&str; 5] = [
        "--id",
        "--root",
        "--environments",
        "--frozen",
        "--expect-digest",
    ];
    for arg in args.iter().skip(1).filter(|a| a.starts_with("--")) {
        if !ACCEPTED.contains(&arg.as_str()) {
            return Err(AdminRefusal::InvalidArgument("unrecognised flag"));
        }
    }

    let project_id = value(args, "--id").ok_or(AdminRefusal::MissingArgument("--id"))?;
    let repository_root = value(args, "--root").ok_or(AdminRefusal::MissingArgument("--root"))?;
    let environments =
        value(args, "--environments").ok_or(AdminRefusal::MissingArgument("--environments"))?;
    let frozen = match value(args, "--frozen") {
        Some("true") => true,
        Some("false") => false,
        Some(_) => return Err(AdminRefusal::InvalidArgument("--frozen")),
        None => return Err(AdminRefusal::MissingArgument("--frozen")),
    };
    let permitted_environments: Vec<String> = environments
        .split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(str::to_string)
        .collect();
    // Empty, or naming anything outside the closed vocabulary. The registry refuses both too — but
    // finding out only after a repository has been read reports a typo as a project problem.
    if permitted_environments.is_empty()
        || permitted_environments
            .iter()
            .any(|e| !PERMITTED_ENVIRONMENT_NAMES.contains(&e.as_str()))
    {
        return Err(AdminRefusal::InvalidArgument("--environments"));
    }

    let expected_digest = value(args, "--expect-digest").map(str::to_string);
    if publish && expected_digest.is_none() {
        return Err(AdminRefusal::MissingArgument("--expect-digest"));
    }
    if let Some(d) = &expected_digest {
        if d.len() != 64
            || !d
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(AdminRefusal::InvalidArgument("--expect-digest"));
        }
    }

    Ok(Invocation {
        publish,
        proposed: RegisteredProjectV1 {
            project_id: project_id.to_string(),
            repository_root: repository_root.to_string(),
            permitted_environments,
            production_frozen: frozen,
        },
        expected_digest,
    })
}

/// Print the complete proposed registration. The SAME rendering is used by `plan` and by `publish`,
/// so the administrator confirms exactly what they were shown.
fn show(
    console: &mut dyn Console,
    proposed: &RegisteredProjectV1,
    digest: &str,
    destination: &str,
) {
    console.print("Proposed installed-project registration");
    console.print(&format!("  project ID            {}", proposed.project_id));
    console.print(&format!(
        "  repository root       {}",
        proposed.repository_root
    ));
    console.print(&format!(
        "  permitted environments {}",
        proposed.permitted_environments.join(", ")
    ));
    console.print(&format!(
        "  production frozen     {}",
        proposed.production_frozen
    ));
    console.print(&format!("  registry digest       {digest}"));
    console.print(&format!("  destination           {destination}"));
}

/// Run the command.
///
/// `destination_label` is DISPLAY TEXT ONLY. It is never used to open, create or write anything —
/// the publisher derives the real destination itself, from the approved ProgramData anchor, and takes
/// no path from here or from the administrator.
///
/// # Errors
/// [`AdminRefusal`] naming the first refusal.
pub fn run(
    args: &[String],
    console: &mut dyn Console,
    publisher: &dyn Publisher,
    destination_label: &str,
) -> Result<RegistryPublishOutcome, AdminRefusal> {
    let invocation = parse(args)?;

    // THE PLAN IS COMPUTED HERE, from the registry and the repository as they are RIGHT NOW — not
    // from anything the administrator supplied. `plan_registration` re-reads the existing registry,
    // re-validates the repository, and refuses duplicates, drift and policy violations.
    let planned = plan_registration(
        read_existing_registry().as_deref(),
        &invocation.proposed,
        &RealRegistryFacts,
    )
    .map_err(|refusal| AdminRefusal::PlanRefused(format!("{refusal:?}")))?;
    let bytes = match planned {
        RegistrationPlan::AlreadyRegistered => return Err(AdminRefusal::AlreadyRegistered),
        RegistrationPlan::Register(bytes) => bytes,
    };
    let digest = digest_hex(&bytes);

    show(console, &invocation.proposed, &digest, destination_label);

    if !invocation.publish {
        console.print("");
        console.print("Nothing was written. To register this project, open an Administrator");
        console.print("terminal and run:");
        console.print(&format!(
            "  {COMMAND_NAME} publish --id {} --root \"{}\" --environments {} --frozen {} --expect-digest {digest}",
            invocation.proposed.project_id,
            invocation.proposed.repository_root,
            invocation.proposed.permitted_environments.join(","),
            invocation.proposed.production_frozen,
        ));
        return Ok(RegistryPublishOutcome::AlreadyCurrent);
    }

    // DRIFT. The administrator was shown a digest by `plan`; if the world has changed since, what
    // they approved is not what would be written.
    if invocation.expected_digest.as_deref() != Some(digest.as_str()) {
        console.print("");
        console.print("REFUSED: the registry or the repository changed since the plan was made.");
        console.print("Run `plan` again and re-read it before publishing.");
        return Err(AdminRefusal::PublishRefused(
            RegistryPublishRefusal::PlanStale,
        ));
    }

    // CONFIRMATION, at a real console. A piped approval is not a confirmation.
    if !console.is_interactive() {
        console.print("");
        console.print("REFUSED: this command must be confirmed at an interactive console.");
        return Err(AdminRefusal::NotInteractive);
    }
    console.print("");
    console.print("This writes protected machine configuration. To confirm, type the line below");
    console.print("exactly, then press Enter:");
    console.print(&format!("  {REGISTRY_PUBLISH_PHRASE}"));
    let typed = console.read_line().unwrap_or_default();
    if typed.trim_end_matches(['\r', '\n']) != REGISTRY_PUBLISH_PHRASE {
        console.print("REFUSED: the confirmation phrase did not match. Nothing was written.");
        return Err(AdminRefusal::NotConfirmed);
    }

    // The publication re-does EVERY check for itself — elevation, the whole registration, the digest,
    // the descriptor. Confirmation does not shorten it by one step.
    let outcome = publisher
        .publish(
            REGISTRY_PUBLISH_PHRASE,
            &PlannedRegistration {
                proposed: invocation.proposed,
                planned_digest: digest,
            },
        )
        .map_err(AdminRefusal::PublishRefused)?;
    console.print(&format!("Registered. {outcome:?}"));
    Ok(outcome)
}

/// Read the canonical registry, if one exists. Read-only; a failure to read is treated as absent here
/// because the publication distinguishes the two authoritatively.
#[cfg(all(windows, feature = "registry-publish-effect"))]
fn read_existing_registry() -> Option<Vec<u8>> {
    super::production_destination()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
}

/// Without the effect feature there is no canonical destination to read, so planning proceeds against
/// an empty registry. `plan` still validates the repository; `publish` does not exist in this build.
#[cfg(not(all(windows, feature = "registry-publish-effect")))]
fn read_existing_registry() -> Option<Vec<u8>> {
    None
}

/// THE production publisher, and the only thing outside this crate that can reach the protected
/// write.
///
/// It exists so `publish_project_registry` can stay `pub(crate)`: the binary holds one of these and
/// hands it to [`run`], which reaches it only after the console, the confirmation and the drift check
/// have all passed. A future caller cannot obtain the write any other way.
#[cfg(feature = "registry-publish-effect")]
pub struct ProductionPublisher;

#[cfg(feature = "registry-publish-effect")]
impl Publisher for ProductionPublisher {
    fn publish(
        &self,
        approval_phrase: &str,
        plan: &PlannedRegistration,
    ) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
        super::publish_project_registry(approval_phrase, plan)
    }
}

#[cfg(test)]
mod tests;
