//! The administrator registration command's boundary.
//!
//! Everything runs against disposable directories under `%TEMP%` with a fake console and a fake
//! publisher, so each refusal is driven deliberately. **No test publishes a real `projects.v1.json`**:
//! the production publisher is never called here, and the one test that touches the canonical path
//! only reads it.

use super::*;
use std::path::{Path, PathBuf};

const PHRASE: &str = REGISTRY_PUBLISH_PHRASE;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-admin-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch");
    dir
}

fn repository(root: &Path, project_id: &str) {
    std::fs::create_dir_all(root.join(".projectops")).unwrap();
    std::fs::write(root.join(".git"), b"gitdir: elsewhere").unwrap();
    std::fs::write(
        root.join(".projectops").join("project-config.json"),
        format!(r#"{{"projectId":"{project_id}","projectName":"{project_id}"}}"#),
    )
    .unwrap();
}

/// A console whose interactivity and typed line are both chosen by the test.
struct FakeConsole {
    interactive: bool,
    typed: Option<String>,
    printed: Vec<String>,
    reads: usize,
}

impl FakeConsole {
    fn new(interactive: bool, typed: Option<&str>) -> Self {
        Self {
            interactive,
            typed: typed.map(str::to_string),
            printed: Vec::new(),
            reads: 0,
        }
    }
    fn output(&self) -> String {
        self.printed.join("\n")
    }
}

impl Console for FakeConsole {
    fn is_interactive(&self) -> bool {
        self.interactive
    }
    fn read_line(&mut self) -> Option<String> {
        self.reads += 1;
        self.typed.clone()
    }
    fn print(&mut self, line: &str) {
        self.printed.push(line.to_string());
    }
}

/// A publisher that records what it was asked to do and never touches a real path.
#[derive(Default)]
struct SpyPublisher {
    calls: std::cell::RefCell<Vec<PlannedRegistration>>,
    refuse: Option<RegistryPublishRefusal>,
}

impl SpyPublisher {
    fn refusing(refusal: RegistryPublishRefusal) -> Self {
        Self {
            calls: std::cell::RefCell::new(Vec::new()),
            refuse: Some(refusal),
        }
    }
    fn called(&self) -> usize {
        self.calls.borrow().len()
    }
}

impl Publisher for SpyPublisher {
    fn publish(
        &self,
        approval_phrase: &str,
        plan: &PlannedRegistration,
    ) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
        assert_eq!(
            approval_phrase, PHRASE,
            "the command must forward the exact phrase it displayed"
        );
        self.calls.borrow_mut().push(plan.clone());
        match &self.refuse {
            Some(refusal) => Err(refusal.clone()),
            None => Ok(RegistryPublishOutcome::Created),
        }
    }
}

const LABEL: &str = r"C:\ProgramData\ProjectOS\host\installation\projects.v1.json";

fn args(mode: &str, root: &Path, extra: &[&str]) -> Vec<String> {
    let mut v = vec![
        mode.to_string(),
        "--id".into(),
        "projectos".into(),
        "--root".into(),
        root.to_string_lossy().to_string(),
        "--environments".into(),
        "development".into(),
        "--frozen".into(),
        "true".into(),
    ];
    v.extend(extra.iter().map(|s| (*s).to_string()));
    v
}

/// The digest `plan` computes for this repository, taken from the command's own output so a test can
/// never disagree with it.
fn planned_digest(output: &str) -> String {
    output
        .lines()
        .find_map(|l| l.trim().strip_prefix("registry digest       "))
        .expect("the plan prints a digest")
        .trim()
        .to_string()
}

// =============================================================================================
// PLAN — read-only, shows everything, writes nothing.
// =============================================================================================

#[test]
fn a1_plan_shows_the_complete_registration_and_writes_nothing() {
    let dir = scratch("plan");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);
    let publisher = SpyPublisher::default();

    run(&args("plan", &root, &[]), &mut console, &publisher, LABEL).expect("plan succeeds");

    let out = console.output();
    for expected in [
        "project ID            projectos",
        "permitted environments development",
        "production frozen     true",
        "registry digest       ",
        LABEL,
    ] {
        assert!(
            out.contains(expected),
            "plan must show {expected:?}:\n{out}"
        );
    }
    assert!(out.contains(&root.to_string_lossy().to_string()));
    // It ends by telling the administrator exactly what to run.
    assert!(out.contains(&format!("{COMMAND_NAME} publish")));
    assert_eq!(publisher.called(), 0, "plan must publish nothing");
    assert_eq!(console.reads, 0, "plan must not ask for confirmation");
}

// =============================================================================================
// [1, 2, 3, 4] CONFIRMATION: interactive, exact, and never a substitute for validation.
// =============================================================================================

/// [2] A non-interactive stream cannot confirm. An approval that can be piped is not a confirmation,
/// and it is refused BEFORE the publisher is reached.
#[test]
fn a2_a_non_interactive_console_cannot_confirm() {
    let dir = scratch("not-interactive");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let digest = {
        let mut c = FakeConsole::new(false, None);
        run(
            &args("plan", &root, &[]),
            &mut c,
            &SpyPublisher::default(),
            LABEL,
        )
        .unwrap();
        planned_digest(&c.output())
    };

    let mut console = FakeConsole::new(false, Some(PHRASE));
    let publisher = SpyPublisher::default();
    let outcome = run(
        &args("publish", &root, &["--expect-digest", &digest]),
        &mut console,
        &publisher,
        LABEL,
    );
    assert_eq!(outcome, Err(AdminRefusal::NotInteractive));
    assert_eq!(publisher.called(), 0);
    assert!(console.output().contains("interactive console"));
}

/// [3] A wrong, empty or absent confirmation is refused, and nothing is published.
#[test]
fn a3_a_wrong_or_missing_confirmation_is_refused() {
    let dir = scratch("wrong-phrase");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let digest = {
        let mut c = FakeConsole::new(false, None);
        run(
            &args("plan", &root, &[]),
            &mut c,
            &SpyPublisher::default(),
            LABEL,
        )
        .unwrap();
        planned_digest(&c.output())
    };

    for typed in [
        None,
        Some(""),
        Some("y"),
        Some("yes"),
        Some("approved: publish the ProjectOS installed-project registry"),
        Some("APPROVED: publish the ProjectOS installed-project registry now"),
    ] {
        let mut console = FakeConsole::new(true, typed);
        let publisher = SpyPublisher::default();
        assert_eq!(
            run(
                &args("publish", &root, &["--expect-digest", &digest]),
                &mut console,
                &publisher,
                LABEL
            ),
            Err(AdminRefusal::NotConfirmed),
            "{typed:?} must not confirm"
        );
        assert_eq!(publisher.called(), 0);
    }
}

/// [1, 4] A CORRECT confirmation reaches the publisher — and the publisher still refuses on its own
/// grounds. Confirmation shortens nothing: an unelevated process is refused after a perfect
/// confirmation, exactly as it would be without one.
#[test]
fn a4_confirmation_does_not_bypass_independent_validation() {
    let dir = scratch("no-bypass");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let digest = {
        let mut c = FakeConsole::new(false, None);
        run(
            &args("plan", &root, &[]),
            &mut c,
            &SpyPublisher::default(),
            LABEL,
        )
        .unwrap();
        planned_digest(&c.output())
    };

    let mut console = FakeConsole::new(true, Some(&format!("{PHRASE}\r\n")));
    let publisher = SpyPublisher::refusing(RegistryPublishRefusal::NotElevated);
    assert_eq!(
        run(
            &args("publish", &root, &["--expect-digest", &digest]),
            &mut console,
            &publisher,
            LABEL
        ),
        Err(AdminRefusal::PublishRefused(
            RegistryPublishRefusal::NotElevated
        )),
        "a confirmed but unelevated publication must still refuse"
    );
    assert_eq!(
        publisher.called(),
        1,
        "the publisher decides, not the console"
    );
    // And the plan it was handed is the one the administrator was shown.
    assert_eq!(publisher.calls.borrow()[0].planned_digest, digest);
    assert_eq!(publisher.calls.borrow()[0].proposed.project_id, "projectos");
}

// =============================================================================================
// [5, 6] THE DESTINATION IS NOT SUPPLIABLE, AND NOTHING AMBIENT SELECTS IT.
// =============================================================================================

/// [5] There is no destination flag. Every attempt to introduce one is refused as an unrecognised
/// flag, and the label the command prints is display text the publisher never receives.
#[test]
fn a5_no_destination_can_be_supplied() {
    let dir = scratch("no-destination");
    let root = dir.join("repo");
    repository(&root, "projectos");

    for attempt in [
        ["--out", r"C:\attacker\projects.v1.json"],
        ["--destination", r"C:\attacker\projects.v1.json"],
        ["--programdata", r"C:\attacker"],
        ["--registry", r"C:\attacker\projects.v1.json"],
        ["--bytes", "{}"],
    ] {
        let mut console = FakeConsole::new(true, Some(PHRASE));
        let publisher = SpyPublisher::default();
        let outcome = run(
            &args("plan", &root, &attempt),
            &mut console,
            &publisher,
            LABEL,
        );
        assert_eq!(
            outcome,
            Err(AdminRefusal::InvalidArgument("unrecognised flag")),
            "{attempt:?} must be refused"
        );
        assert_eq!(publisher.called(), 0);
    }
}

/// [6] The module reads no ambient source. Comments and this test module are stripped first: the file
/// necessarily discusses environment variables and the working directory, and the list below
/// literally contains the strings being forbidden.
#[test]
fn a6_no_environment_or_working_directory_can_redirect_anything() {
    let source = include_str!("../admin.rs");
    let production = &source[..source.find("mod tests").unwrap_or(source.len())];
    let code: String = production
        .lines()
        .filter(|line| {
            let t = line.trim_start();
            !t.starts_with("//") && !t.starts_with("///") && !t.starts_with("//!")
        })
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "env::var",
        "env!(",
        "current_dir",
        "current_exe",
        "ProgramData%",
        "set_current_dir",
    ] {
        assert!(
            !code.contains(forbidden),
            "the administrator command must not consult {forbidden}"
        );
    }
}

// =============================================================================================
// [7, 8] DRIFT AND A STALE DIGEST ARE REFUSED BEFORE ANY CONFIRMATION IS EVEN OFFERED.
// =============================================================================================

#[test]
fn a7_repository_drift_after_the_plan_is_refused() {
    let dir = scratch("drift");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let digest = {
        let mut c = FakeConsole::new(false, None);
        run(
            &args("plan", &root, &[]),
            &mut c,
            &SpyPublisher::default(),
            LABEL,
        )
        .unwrap();
        planned_digest(&c.output())
    };

    // The repository is re-badged after the plan was made.
    repository(&root, "renamed-behind-our-back");
    let mut console = FakeConsole::new(true, Some(PHRASE));
    let publisher = SpyPublisher::default();
    let outcome = run(
        &args("publish", &root, &["--expect-digest", &digest]),
        &mut console,
        &publisher,
        LABEL,
    );
    assert!(
        matches!(outcome, Err(AdminRefusal::PlanRefused(_))),
        "a re-badged repository must be refused by the command's own recomputation, got {outcome:?}"
    );
    assert_eq!(publisher.called(), 0);
    assert_eq!(
        console.reads, 0,
        "no confirmation is offered for a refused plan"
    );
}

#[test]
fn a8_a_stale_expected_digest_is_refused_before_confirmation() {
    let dir = scratch("stale-digest");
    let root = dir.join("repo");
    repository(&root, "projectos");

    let mut console = FakeConsole::new(true, Some(PHRASE));
    let publisher = SpyPublisher::default();
    let outcome = run(
        &args("publish", &root, &["--expect-digest", &"0".repeat(64)]),
        &mut console,
        &publisher,
        LABEL,
    );
    assert_eq!(
        outcome,
        Err(AdminRefusal::PublishRefused(
            RegistryPublishRefusal::PlanStale
        ))
    );
    assert_eq!(publisher.called(), 0);
    assert_eq!(
        console.reads, 0,
        "drift is decided before a person is asked to confirm"
    );
    assert!(console.output().contains("changed since the plan was made"));
}

/// A malformed digest never reaches the comparison at all.
#[test]
fn a8b_a_malformed_expected_digest_is_refused_at_parse_time() {
    let dir = scratch("bad-digest");
    let root = dir.join("repo");
    repository(&root, "projectos");
    for bad in ["", "abc", &"z".repeat(64), &"a".repeat(63), &"A".repeat(64)] {
        let mut console = FakeConsole::new(true, Some(PHRASE));
        assert_eq!(
            run(
                &args("publish", &root, &["--expect-digest", bad]),
                &mut console,
                &SpyPublisher::default(),
                LABEL
            ),
            Err(AdminRefusal::InvalidArgument("--expect-digest")),
            "{bad:?} must be refused"
        );
    }
    // And `publish` without one at all is refused.
    let mut console = FakeConsole::new(true, Some(PHRASE));
    assert_eq!(
        run(
            &args("publish", &root, &[]),
            &mut console,
            &SpyPublisher::default(),
            LABEL
        ),
        Err(AdminRefusal::MissingArgument("--expect-digest"))
    );
}

// =============================================================================================
// [9, 10] THE REGISTRY'S OWN RULES STILL DECIDE.
// =============================================================================================

/// [10] A repository that is not a ProjectOS project is refused by the command's own planning, with
/// the registry contract's own reason — no confirmation is offered.
#[test]
fn a10_an_invalid_project_is_refused_by_the_commands_own_planning() {
    let dir = scratch("invalid-project");
    let empty = dir.join("not-a-repo");
    std::fs::create_dir_all(&empty).unwrap();

    let mut console = FakeConsole::new(true, Some(PHRASE));
    let publisher = SpyPublisher::default();
    let outcome = run(&args("plan", &empty, &[]), &mut console, &publisher, LABEL);
    assert!(matches!(outcome, Err(AdminRefusal::PlanRefused(_))));
    assert_eq!(publisher.called(), 0);

    // A relative root, and one with traversal, are refused the same way.
    for bad in ["relative\\path", "C:\\dev\\..\\dev\\ProjectOS"] {
        let mut console = FakeConsole::new(true, Some(PHRASE));
        let mut a = args("plan", &empty, &[]);
        let idx = a.iter().position(|x| x == "--root").unwrap() + 1;
        a[idx] = bad.to_string();
        assert!(matches!(
            run(&a, &mut console, &SpyPublisher::default(), LABEL),
            Err(AdminRefusal::PlanRefused(_))
        ));
    }
}

/// [9] Duplicate ids and roots are the registry's business, and the command does not second-guess
/// them: it plans through `plan_registration`, which is where those refusals live. Proven here by an
/// environment the registry refuses outright.
#[test]
fn a9_an_invalid_environment_policy_is_refused() {
    let dir = scratch("bad-environments");
    let root = dir.join("repo");
    repository(&root, "projectos");
    for bad in [
        "",
        "prod",
        "development,production,everything",
        "DEVELOPMENT",
    ] {
        let mut a = args("plan", &root, &[]);
        let idx = a.iter().position(|x| x == "--environments").unwrap() + 1;
        a[idx] = bad.to_string();
        let mut console = FakeConsole::new(true, Some(PHRASE));
        let outcome = run(&a, &mut console, &SpyPublisher::default(), LABEL);
        // Refused AT PARSE TIME, before the filesystem is touched at all. The registry would refuse
        // these too, but a command that only found out after reading a repository would be reporting
        // a typo as a project problem.
        assert_eq!(
            outcome,
            Err(AdminRefusal::InvalidArgument("--environments")),
            "{bad:?} must be refused before planning"
        );
    }
}

// =============================================================================================
// [15] NO SELF-ELEVATION, ANYWHERE ON THIS PATH.
// =============================================================================================

/// The command never elevates itself and never launches anything. There is no process-creation,
/// shell-execute or `runas` route in the command or in the publication it drives — the administrator
/// opens the terminal, and the code only ever REFUSES when it finds itself unelevated.
#[test]
fn a15_there_is_no_self_elevation_or_process_launch_on_this_path() {
    for source in [
        include_str!("../admin.rs"),
        include_str!("../../registry_publish.rs"),
        include_str!("../../bin/projectos-register-project.rs"),
    ] {
        let production = &source[..source.find("mod tests").unwrap_or(source.len())];
        let code: String = production
            .lines()
            .filter(|line| {
                let t = line.trim_start();
                !t.starts_with("//") && !t.starts_with("///") && !t.starts_with("//!")
            })
            .collect::<Vec<_>>()
            .join("\n");
        for forbidden in [
            "ShellExecute",
            "runas",
            "CreateProcess",
            "Command::new",
            "std::process::Command",
        ] {
            assert!(
                !code.contains(forbidden),
                "the registration path must not contain {forbidden}"
            );
        }
    }
}

// =============================================================================================
// [14] NOTHING IN THE APPLICATION CALLS THIS. REGISTRATION IS OUT OF BAND.
// =============================================================================================

/// No WebView, renderer, packaged runtime or Tauri host reaches the registration command or the
/// publication it drives.
///
/// Checked against the manifests and sources themselves rather than asserted in prose: the runtime
/// side must not depend on this crate at all, and no renderer or daemon source may name the command,
/// the phrase, or the publish entry point. If a future phase wires an in-app "Add project" button,
/// this test is what notices.
#[test]
fn a14_no_webview_or_packaged_runtime_caller_exists() {
    let projectos = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("the projectos root")
        .to_path_buf();

    // 1. The runtime side does not depend on this crate.
    let tauri_manifest =
        std::fs::read_to_string(projectos.join("control-center/src-tauri/Cargo.toml"))
            .expect("the Tauri manifest is readable");
    assert!(
        !tauri_manifest.contains("elevated-installer-composition"),
        "the Tauri host must not depend on the elevated installer composition"
    );

    // 2. No renderer, daemon or Tauri source mentions the command, the publication or the phrase at
    //    all. These are the surfaces an owner drives; registration is not one of the things they do.
    let mut checked = 0usize;
    for relative in [
        "control-center/src",
        "control-center/sidecar",
        "control-center/src-tauri/src",
        "bridge/daemon/src",
    ] {
        for file in sources_under(&projectos.join(relative)) {
            let text = std::fs::read_to_string(&file).unwrap_or_default();
            checked += 1;
            for forbidden in [
                COMMAND_NAME,
                "publish_project_registry",
                "registry_publish",
                REGISTRY_PUBLISH_PHRASE,
            ] {
                assert!(
                    !text.contains(forbidden),
                    "{} must not reference {forbidden}",
                    file.display()
                );
            }
        }
    }
    assert!(
        checked > 50,
        "the scan must actually have read sources, saw {checked}"
    );

    // 3. The CLI may NAME the command - printing the administrator's next step is the whole point -
    //    but it must never invoke it, never emit the publish subcommand, and never carry the phrase.
    //    A pointer is guidance; a spawn would be the in-app caller this phase does not have.
    for file in sources_under(&projectos.join("agent/src")) {
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        assert!(
            !text.contains(&format!("{COMMAND_NAME} publish")),
            "{} must not emit an invocable publish command",
            file.display()
        );
        assert!(
            !text.contains(REGISTRY_PUBLISH_PHRASE),
            "{} must not carry the confirmation phrase",
            file.display()
        );
        for spawn in ["exec(", "spawn(", "execSync", "spawnSync"] {
            assert!(
                !text
                    .lines()
                    .any(|l| l.contains(COMMAND_NAME) && l.contains(spawn)),
                "{} must not execute the registration command",
                file.display()
            );
        }
    }
}

/// Every source file beneath a directory, skipping build output and dependencies.
fn sources_under(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !matches!(
                    name.as_str(),
                    "node_modules" | "target" | "dist" | "coverage"
                ) {
                    stack.push(path);
                }
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("rs" | "ts" | "tsx" | "mjs" | "cjs" | "js")
            ) {
                out.push(path);
            }
        }
    }
    out
}
