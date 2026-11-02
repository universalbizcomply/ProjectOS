//! Storing one credential, without the value ever touching the governed command channel.
//!
//! PROJECTOS-PRODUCT-COMPLETION1A §13. The Control Centre has no console, so the credential
//! router's hidden TTY prompt is unusable from it. This is the route that replaces it for the
//! normal owner case, and it is deliberately NOT the governed command channel.
//!
//! ## Why not the governed command channel
//!
//! Every other owner action travels as a JSON line to the daemon's stdin, and the outcome lines
//! come back to be rendered. That channel is a closed vocabulary of NON-SECRET arguments: its values
//! are echoed into action messages, and the whole design assumes anything on it is safe to show. A
//! secret on that channel would be one refactor away from an evidence pack. So the value takes a
//! different path entirely — this command, in the native host, straight into a child process
//! environment.
//!
//! ## Where the value goes, exactly
//!
//! Renderer (a password field) → Tauri IPC → this function → the child's environment block →
//! `projectos-credential-router credentials set --from-env` → the existing vault → Windows
//! Credential Manager. It is never an argv element, never written to a file, never logged, and
//! never returned. The environment channel is the SAME one the credential store already uses to
//! hand the value to its own PowerShell child, chosen there for the same reason: unlike argv it does
//! not appear in a process listing.
//!
//! ## What the owner is told
//!
//! The router's own refusal, one line of it, because "it may already exist" is a guess and the owner
//! cannot act on a guess. Since PROJECTOS-TENANT-CREDENTIALS1A this route is refused by name: it has no
//! terminal and no run handle, so storing a credential needs a real terminal, and that sentence reaches
//! the screen. See `refusal_sentence` for what stands between the router's output and the owner.
//!
//! ## What this does NOT do
//!
//! It creates no second credential system. It validates a reference, resolves the existing router
//! and the runtime, and runs them. Every policy — reference grammar, risk classification,
//! replace-vs-create, redaction, the metadata sidecar — stays in the vault where it already lives.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// `ProjectOS/<project>/<environment>/<provider>/<credential>` — five segments, strict charset.
/// Validated here as well as in the router and again in the PowerShell helper: a malformed
/// reference must not reach a process that will handle a secret.
fn is_valid_reference(reference: &str) -> bool {
    let parts: Vec<&str> = reference.split('/').collect();
    if parts.len() != 5 || parts[0] != "ProjectOS" {
        return false;
    }
    parts[1..].iter().all(|segment| {
        !segment.is_empty()
            && segment.len() <= 64
            && segment
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    })
}

/// The Node runtime this installation runs its own tooling with.
///
/// Packaged: the pinned runtime inside the attested payload, at a fixed relative path from the
/// executable — the same bytes the trust manifest covers. Development: `node` from PATH, which is
/// what a checkout has and what every other development path here already relies on.
fn node_runtime(install_dir: &Path) -> PathBuf {
    let pinned = install_dir.join("runtime-payload").join("runtime").join("node.exe");
    if pinned.is_file() {
        pinned
    } else {
        PathBuf::from("node")
    }
}

/// The credential router, from the governed system tree this installation is bound to.
///
/// Resolved from the SAME record the daemon's own system root comes from rather than from anything
/// the renderer supplies. `None` when neither a bound tree nor a development checkout carries it, so
/// the caller refuses with a reason instead of running something arbitrary.
fn router_path(install_dir: &Path, governed_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(root) = governed_root {
        let bound = root
            .join("projectos")
            .join("scripts")
            .join("projectos-credential-router.cjs");
        if bound.is_file() {
            return Some(bound);
        }
    }
    // Development: the Control Centre binary sits inside the checkout's target directory.
    let mut dir = Some(install_dir);
    while let Some(current) = dir {
        let candidate = current
            .join("projectos")
            .join("scripts")
            .join("projectos-credential-router.cjs");
        if candidate.is_file() {
            return Some(candidate);
        }
        dir = current.parent();
    }
    None
}

/// Store or replace one credential.
///
/// `async` for the same reason `register_project` is: it spawns a child and waits, and a blocking
/// command would do that on the thread running the event loop.
///
/// Returns a short non-secret token. Every error is a sentence the owner can act on; none carries
/// the value or a fingerprint of it. The router's stdout is never read, because a failure message is
/// exactly where an unexpected echo would surface, and its refusal comes through `refusal_sentence`.
#[tauri::command(async)]
pub fn set_credential(reference: String, value: String, replace: bool) -> Result<String, String> {
    if !is_valid_reference(&reference) {
        return Err("That credential name is not usable. It must be \
                    ProjectOS/<project>/<environment>/<provider>/<credential>."
            .to_string());
    }
    if value.is_empty() {
        return Err("No value was entered, so nothing was stored.".to_string());
    }
    // The same rule the hidden prompt and the environment channel both enforce. A control character
    // is never part of a credential, and accepting one stores a value that fails much later at the
    // provider with an error pointing nowhere near here.
    if value.chars().any(|c| c.is_control()) {
        return Err("That value contains a control character, so nothing was stored. If you \
                    pasted it, paste it again without a line break."
            .to_string());
    }

    let exe = std::env::current_exe()
        .map_err(|_| "ProjectOS could not locate its own program directory.".to_string())?;
    let install_dir = exe
        .parent()
        .ok_or_else(|| "ProjectOS could not locate its own program directory.".to_string())?
        .to_path_buf();

    // The governed system root, read from the CANONICAL APPLICATION RECORD in the protected
    // ProgramData installation directory — the same reader `InstalledSystemRoot` uses, and the same
    // record that decides which projects this installation may govern. It is not taken from the
    // renderer, from argv, from the environment or from the working directory, because the value it
    // yields decides which script this host is about to hand a credential to.
    //
    // `None` in a development build, where there is no installed record; the directory walk below
    // then finds the checkout's own copy.
    let governed_root: Option<PathBuf> = {
        #[cfg(windows)]
        {
            projectos_shared_host_runtime::identity::packaged::read_canonical_application_record(
                crate::process::authority::PACKAGED_APPLICATION_ID,
                env!("CARGO_PKG_VERSION"),
                &install_dir,
            )
            .ok()
            .map(|verified| verified.governed_system_root().to_path_buf())
        }
        #[cfg(not(windows))]
        {
            None
        }
    };

    let router = router_path(&install_dir, governed_root.as_deref()).ok_or_else(|| {
        "ProjectOS could not find its credential tool on this computer, so nothing was stored."
            .to_string()
    })?;
    let node = node_runtime(&install_dir);

    let mut command = Command::new(node);
    command
        .arg(&router)
        .arg("credentials")
        .arg("set")
        .arg("--ref")
        .arg(&reference)
        .arg("--from-env")
        // THE VALUE, on the environment of the CHILD only. Never an argument: argv is visible in a
        // process listing to anything running as this user.
        .env("PROJECTOS_CREDENTIAL_VALUE", &value)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if replace {
        command.arg("--replace");
    }

    let output = command.output().map_err(|_| {
        "ProjectOS could not run its credential tool, so nothing was stored.".to_string()
    })?;

    match output.status.code() {
        Some(0) => Ok(if replace { "REPLACED" } else { "STORED" }.to_string()),
        // A refusal is a real answer, not a fault, and the owner can only act on the real one.
        Some(_) => Err(refusal_sentence(&String::from_utf8_lossy(&output.stderr), &value)),
        None => Err("The credential tool stopped unexpectedly, so ProjectOS cannot confirm \
                     whether anything was stored."
            .to_string()),
    }
}

/// The longest refusal shown. The router's sentences are short; anything longer is not one of them.
const REFUSAL_MAX_CHARS: usize = 400;

/// What the owner is told when the router refuses: its first line of stderr, as a sentence.
///
/// The router puts no value in an error, and this does not rely on that. A line holding the value,
/// or nothing usable, gives the fixed sentence instead. Controls become spaces, so a line cannot
/// forge a second one, and the length is bounded.
fn refusal_sentence(stderr: &str, value: &str) -> String {
    const NOTHING_STORED: &str = "ProjectOS did not store that credential, and the credential tool \
                                  gave no reason it could show.";
    let Some(line) = stderr.lines().map(str::trim).find(|line| !line.is_empty()) else {
        return NOTHING_STORED.to_string();
    };
    if !value.is_empty() && line.contains(value) {
        return NOTHING_STORED.to_string();
    }
    let shown: String = line
        .chars()
        .take(REFUSAL_MAX_CHARS)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    format!("ProjectOS did not store that credential. {shown}")
}

#[cfg(test)]
mod tests {
    use super::refusal_sentence;

    #[test]
    fn shows_the_real_refusal() {
        let said = refusal_sentence(
            "REQUESTER_REQUIRED: this needs a real terminal\n    at main\n",
            "synthetic-value",
        );
        assert_eq!(
            said,
            "ProjectOS did not store that credential. REQUESTER_REQUIRED: this needs a real terminal"
        );
    }

    #[test]
    fn never_repeats_the_value() {
        let said = refusal_sentence("refused synthetic-value here", "synthetic-value");
        assert!(!said.contains("synthetic-value"));
    }

    #[test]
    fn says_so_when_there_is_no_reason() {
        assert!(refusal_sentence("  \n\n", "synthetic-value").contains("gave no reason"));
    }

    #[test]
    fn a_line_cannot_forge_another_or_run_on() {
        let said = refusal_sentence(&format!("a\u{7}b{}", "x".repeat(5000)), "synthetic-value");
        assert!(!said.chars().any(char::is_control));
        assert!(said.chars().count() < 500);
    }
}
