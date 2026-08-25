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

/// Every character PowerShell's tokenizer accepts as a SINGLE-QUOTE string delimiter.
///
/// It is not only the ASCII apostrophe. PowerShell also honours the typographic quotes U+2018,
/// U+2019, U+201A and U+201B as delimiters, and all four are legal in an NTFS name — so a value
/// carrying one would close a literal that had doubled `'` alone.
fn is_powershell_quote(ch: char) -> bool {
    matches!(ch, '\'' | '\u{2018}' | '\u{2019}' | '\u{201a}' | '\u{201b}')
}

/// Repair a value for WINDOWS ARGUMENT DELIVERY — the layer BELOW the PowerShell literal.
///
/// Quoting the literal only settles how POWERSHELL reads the value. PowerShell then hands a native
/// program its arguments as one command line, adding double quotes around any argument containing
/// whitespace, and the C runtime unquotes it with a rule of its own: a run of backslashes
/// immediately before a quote is HALVED and the quote taken as escaped. So an argument that both
/// contains a space and ends in a backslash — `C:\my repo\` — arrives with its closing quote
/// swallowed, absorbing every flag that followed it into the path. Doubling the trailing run makes
/// the halving restore exactly what was meant.
///
/// This applies ONLY when PowerShell will add the quotes. Doubling an unquoted argument would
/// deliver two backslashes where the path has one, which is why the whitespace test is not
/// decoration.
///
/// VERIFIED AGAINST WINDOWS POWERSHELL 5.1, AND ONLY THAT. PowerShell 7.3 and later default
/// `$PSNativeCommandArgumentPassing` to `Standard` on Windows, which builds the argument list
/// correctly by itself — so on PS7 this repair would land on top of correct escaping and deliver one
/// backslash too many. The consequence is a REFUSAL, never a wrong registration: the digest binds
/// the raw root, so an altered argument is stale by construction (see
/// `a23_a_root_that_differs_from_the_plan_can_never_publish`). A repository path that both contains
/// whitespace and ends in a separator would therefore be un-registerable from PS7 until this is made
/// version-aware. That is an open limitation, recorded rather than guessed at, because no PowerShell
/// 7 exists on the machine this was written against.
///
/// One visible consequence: for such a path the displayed proposal shows `C:\my repo\` while the
/// pasted line carries `'C:\my repo\\'`. The runtime undoes the difference, but the two do not read
/// identically.
fn windows_argv_safe(value: &str) -> String {
    if !value.chars().any(char::is_whitespace) || !value.ends_with('\\') {
        return value.to_string();
    }
    let kept = value.trim_end_matches('\\');
    format!("{kept}{}", "\\".repeat((value.len() - kept.len()) * 2))
}

/// Encode one untrusted value as a POWERSHELL SINGLE-QUOTED LITERAL.
///
/// The `publish` line below is meant to be PASTED INTO A SHELL, so every value spliced into it is
/// shell input, not text. PowerShell expands `$(...)`, `$name` and backtick escapes INSIDE DOUBLE
/// QUOTES — and `$`, `(`, `)`, a backtick, `&`, `;` and an apostrophe are all legal in a Windows
/// directory name. A repository at `C:\proj\$(iwr ...|iex)` rendered inside double quotes would
/// therefore execute on paste, in an ADMINISTRATOR terminal, with our own instruction as the
/// delivery vehicle.
///
/// Inside a SINGLE-quoted literal PowerShell expands nothing whatsoever; the only character that can
/// end the string is a quote. So this doubles every quote — the whole family, see
/// [`is_powershell_quote`] — and wraps the result. That family was MEASURED, not assumed: every code
/// point in the Basic Multilingual Plane was fed through PowerShell 5.1's own parser, and exactly
/// five terminate a single-quoted literal.
///
/// Quoting settles how PowerShell READS the value. Getting it to the program intact is a second
/// problem, handled by [`windows_argv_safe`] above.
///
/// Control characters are DROPPED rather than encoded, because a value carrying a newline could
/// forge further lines and make the instruction appear to say something it does not. A Windows path
/// cannot contain one and the root printed here has already been proven to exist on disk, so this
/// guards the display layer; it does not repair the value. A dropped character changes the argument,
/// and `publish` re-validates everything it is given, so the altered command refuses rather than
/// registering something unintended.
fn ps_literal(value: &str) -> String {
    let cleaned: String = value.chars().filter(|ch| !ch.is_control()).collect();
    let delivered = windows_argv_safe(&cleaned);
    let mut out = String::with_capacity(delivered.len() + 2);
    out.push('\'');
    for ch in delivered.chars() {
        if is_powershell_quote(ch) {
            out.push(ch);
        }
        out.push(ch);
    }
    out.push('\'');
    out
}

/// Render an untrusted value as one line of DISPLAY text.
///
/// Nothing here is pasted into a shell, so it is not quoted. Control characters — and only those —
/// are dropped, for the same reason as in [`ps_literal`]: a carriage return or newline is what lets
/// one value forge a second line and make this block appear to say something it does not.
fn display_value(value: &str) -> String {
    value.chars().filter(|ch| !ch.is_control()).collect()
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
    console.print(&format!(
        "  project ID            {}",
        display_value(&proposed.project_id)
    ));
    console.print(&format!(
        "  repository root       {}",
        display_value(&proposed.repository_root)
    ));
    console.print(&format!(
        "  permitted environments {}",
        display_value(&proposed.permitted_environments.join(", "))
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
        console.print("Nothing was written. To register this project:");
        console.print("  Open Windows PowerShell 5.1 as Administrator (powershell.exe).");
        console.print("  PowerShell 7 (pwsh) is not supported for the line below.");
        console.print("Then run this line:");
        // EVERY caller-supplied value is a single-quoted PowerShell literal — see `ps_literal`.
        // `--frozen` and `--expect-digest` are left bare deliberately: one is `true`/`false` and the
        // other is 64 lowercase hex characters, both produced here from validated data rather than
        // echoed from the caller, so neither can carry a shell character in the first place.
        console.print(&format!(
            "  {COMMAND_NAME} publish --id {} --root {} --environments {} --frozen {} --expect-digest {digest}",
            ps_literal(&invocation.proposed.project_id),
            ps_literal(&invocation.proposed.repository_root),
            ps_literal(&invocation.proposed.permitted_environments.join(",")),
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

/// Plan and publish ONE registration in a single already-elevated invocation.
///
/// ## Why this exists beside [`run`], rather than replacing it
///
/// [`run`] is the ADMINISTRATOR TERMINAL command, and its confirmation is a phrase typed at an
/// interactive console. That is the right mechanism when the operator is already in a terminal, and
/// it is unchanged: nothing in this function is reachable from `run`, and `run` still refuses a
/// piped approval exactly as before.
///
/// This function serves a different, owner-requested route (PROJECTOS-PRODUCT-COMPLETION1A §11):
/// registration initiated from the Control Centre, where requiring an Administrator terminal, a
/// copied digest and a typed phrase was rejected as the normal owner experience.
///
/// ## What replaces the typed phrase, stated honestly
///
/// The typed phrase is NOT silently dropped — the confirmation MOVES to a different mechanism of
/// equivalent intent:
///
/// * The proposed registration is displayed by the CALLER before anything is launched, and the owner
///   must click to proceed. No background task or timer reaches here.
/// * The caller must obtain a REAL Windows UAC elevation prompt to run the binary that calls this.
///   That prompt is a Windows-owned consent dialog the application cannot suppress, pre-answer or
///   synthesise, which is the property the typed phrase was protecting.
/// * `publish_project_registry` still establishes elevation from the PROCESS TOKEN itself, so an
///   unelevated caller reaching this function is refused by the publication regardless.
///
/// The phrase constant is still passed to the publication because the publication checks it; it was
/// never the authority (see [`REGISTRY_PUBLISH_PHRASE`]'s own documentation), and supplying it here
/// does not shorten any of the checks below it by one step.
///
/// ## What is NOT relaxed
///
/// The plan is recomputed HERE from the registry and repository as they are right now, in the
/// elevated process — never taken from the caller. There is no `--expect-digest` because there is no
/// drift window to protect: planning and publication happen in one invocation, so the bytes
/// published are the bytes just planned. Every validation `publish_project_registry` performs —
/// elevation, revalidation, descriptor policy, byte verification, DACL confirmation — runs
/// unchanged.
///
/// # Errors
/// [`AdminRefusal`] naming the first refusal.
#[cfg(all(windows, feature = "registry-publish-effect"))]
pub fn run_uac_confirmed(
    args: &[String],
    publisher: &dyn Publisher,
) -> Result<RegistryPublishOutcome, AdminRefusal> {
    // Reuses the SAME argument parser the terminal command uses, so the two routes cannot diverge on
    // what a valid project id, root, environment list or freeze state is. `publish` mode is required
    // so an operator cannot reach the effect while believing they asked for a preview.
    let invocation = parse(args)?;
    if !invocation.publish {
        return Err(AdminRefusal::UnknownMode);
    }
    // A digest cannot be supplied on this route: it would name a plan made in a DIFFERENT process,
    // and accepting it would reintroduce exactly the drift window this route does not have.
    if invocation.expected_digest.is_some() {
        return Err(AdminRefusal::InvalidArgument("--expect-digest"));
    }

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

    publisher
        .publish(
            REGISTRY_PUBLISH_PHRASE,
            &PlannedRegistration {
                proposed: invocation.proposed,
                planned_digest: digest,
            },
        )
        .map_err(AdminRefusal::PublishRefused)
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
