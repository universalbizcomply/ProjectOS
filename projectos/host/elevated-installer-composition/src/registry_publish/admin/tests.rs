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
// THE UAC-CONFIRMED ROUTE ACTUALLY REACHES THE PUBLICATION.
//
// THE DEFECT THESE EXIST TO PREVENT, and it shipped: `run_uac_confirmed` reused `parse`, which
// required `--expect-digest` for every `publish`. The UAC route deliberately supplies none, so it
// refused with MissingArgument("--expect-digest") before computing anything — STRUCTURALLY
// UNREACHABLE, and it compiled. Nothing caught it because no test ever executed this function; it
// was verified by reading it. These drive it for real.
// =============================================================================================

/// The route reaches the publisher and forwards a plan computed HERE, with no digest supplied.
#[test]
fn u1_the_uac_route_publishes_without_an_expected_digest() {
    let root = scratch("uac-publishes");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();

    let outcome = run_uac_confirmed(&args("publish", &root, &[]), &publisher)
        .expect("the UAC route must reach the publication");

    assert_eq!(outcome, RegistryPublishOutcome::Created);
    assert_eq!(
        publisher.called(),
        1,
        "the publisher must have been called exactly once"
    );
    let plan = publisher.calls.borrow()[0].clone();
    assert_eq!(plan.proposed.project_id, "projectos");
    assert_eq!(
        plan.planned_digest.len(),
        64,
        "the route must compute its own digest rather than carry one in"
    );
}

/// A digest supplied from OUTSIDE names a plan some other process computed. Refused, not ignored.
#[test]
fn u2_the_uac_route_refuses_a_supplied_digest() {
    let root = scratch("uac-refuses-digest");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();

    let refusal = run_uac_confirmed(
        &args("publish", &root, &["--expect-digest", &"a".repeat(64)]),
        &publisher,
    )
    .expect_err("a caller-supplied digest must be refused on this route");

    assert_eq!(refusal, AdminRefusal::InvalidArgument("--expect-digest"));
    assert_eq!(
        publisher.called(),
        0,
        "nothing may be published after a refusal"
    );
}

/// `plan` is a preview. Reaching the effect while asking for a preview must be impossible.
#[test]
fn u3_the_uac_route_refuses_plan_mode() {
    let root = scratch("uac-refuses-plan");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();

    let refusal = run_uac_confirmed(&args("plan", &root, &[]), &publisher)
        .expect_err("plan mode must not reach the publication");

    assert_eq!(refusal, AdminRefusal::UnknownMode);
    assert_eq!(publisher.called(), 0);
}

/// The shared grammar still applies: this route validates exactly as the terminal command does.
#[test]
fn u4_the_uac_route_still_enforces_the_shared_argument_grammar() {
    let root = scratch("uac-grammar");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();

    // Built literally rather than via `args(..., extra)`: that helper already supplies
    // `--environments development` and `--frozen true`, and `value()` takes the FIRST match, so an
    // appended second value would be silently ignored and the test would pass against a valid
    // invocation. (It did, on the first run of this test — the assertion caught it.)
    let root_s = root.to_string_lossy().to_string();
    let base = |env: &str, frozen: &str| {
        vec![
            "publish".to_string(),
            "--id".into(),
            "projectos".into(),
            "--root".into(),
            root_s.clone(),
            "--environments".into(),
            env.to_string(),
            "--frozen".into(),
            frozen.to_string(),
        ]
    };

    let cases: Vec<(Vec<String>, &str)> = vec![
        (
            base("banana", "true"),
            "an environment outside the closed vocabulary",
        ),
        (base("development", "perhaps"), "a non-boolean freeze state"),
        (
            {
                let mut v = base("development", "true");
                v.push("--wat".into());
                v.push("x".into());
                v
            },
            "an unrecognised flag",
        ),
    ];

    for (argv, why) in cases {
        let refusal = run_uac_confirmed(&argv, &publisher).expect_err(why);
        assert!(
            matches!(refusal, AdminRefusal::InvalidArgument(_)),
            "{why} must be refused as an invalid argument, saw {refusal:?}"
        );
    }
    assert_eq!(publisher.called(), 0, "no invalid invocation may publish");
}

/// A publication refusal is surfaced, never converted into success.
#[test]
fn u5_a_publication_refusal_is_reported_not_swallowed() {
    let root = scratch("uac-publish-refused");
    repository(&root, "projectos");
    let publisher = SpyPublisher::refusing(RegistryPublishRefusal::NotElevated);

    let refusal = run_uac_confirmed(&args("publish", &root, &[]), &publisher)
        .expect_err("a refusing publisher must produce a refusal");

    assert_eq!(
        refusal,
        AdminRefusal::PublishRefused(RegistryPublishRefusal::NotElevated)
    );
}

/// The TERMINAL route is unchanged: it still demands the digest its two-step workflow prints.
#[test]
fn u6_the_terminal_route_still_requires_its_digest() {
    let root = scratch("terminal-still-requires-digest");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();
    let mut console = FakeConsole::new(true, Some(PHRASE));

    let refusal = run(&args("publish", &root, &[]), &mut console, &publisher, LABEL)
        .expect_err("the terminal command must still require --expect-digest");

    assert_eq!(refusal, AdminRefusal::MissingArgument("--expect-digest"));
    assert_eq!(publisher.called(), 0);
}

// =============================================================================================
// [14] NOTHING IN THE APPLICATION CALLS THIS. REGISTRATION IS OUT OF BAND.
// =============================================================================================

/// No WebView, renderer, packaged runtime or Tauri host LINKS the publication or carries its
/// confirmation phrase.
///
/// REBASELINED by PROJECTOS-PRODUCT-COMPLETION1A §11, which asked for an in-app "Add project"
/// button. The previous form of this test forbade the application from naming registration at all,
/// and it correctly failed the moment that button was built — it is doing its job, so it is narrowed
/// to the boundary that still holds rather than deleted.
///
/// WHAT CHANGED. The Tauri host may now LAUNCH a bounded elevated helper through a real Windows UAC
/// prompt. What it may not do is hold the capability itself.
///
/// WHAT DID NOT CHANGE, and is asserted below:
///   - the runtime side still does not DEPEND on this crate, so no WebView-hosting binary links the
///     publication;
///   - no renderer, daemon or host source carries the confirmation phrase or names the publish entry
///     point;
///   - the RENDERER additionally may not name the terminal command or build a command line — the
///     WebView asks the host, and the host decides. Only `src-tauri` may name the helper it runs.
#[test]
fn a14_no_webview_or_packaged_runtime_caller_exists() {
    let projectos = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("the projectos root")
        .to_path_buf();

    // 1. The runtime side does not depend on this crate. UNCHANGED, and the load-bearing half: a
    //    launched process is a bounded, separately-authorised thing; a linked one is a capability
    //    sitting inside the WebView host.
    let tauri_manifest =
        std::fs::read_to_string(projectos.join("control-center/src-tauri/Cargo.toml"))
            .expect("the Tauri manifest is readable");
    assert!(
        !tauri_manifest.contains("elevated-installer-composition"),
        "the Tauri host must not depend on the elevated installer composition"
    );

    // 2. Nothing an owner drives carries the phrase or names the publication internals.
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
            for forbidden in ["publish_project_registry", REGISTRY_PUBLISH_PHRASE] {
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

    // 3. THE RENDERER IS NOT A CALLER. It may not name the terminal command, and it may not name the
    //    elevated helper either: a WebView that can name the binary is one step from a WebView that
    //    chooses which binary. It asks the host by command name; the host owns the file name.
    let mut renderer_checked = 0usize;
    for file in sources_under(&projectos.join("control-center/src")) {
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        renderer_checked += 1;
        for forbidden in [COMMAND_NAME, "runas", "ShellExecute"] {
            assert!(
                !text.contains(forbidden),
                "{} is renderer source and must not reference {forbidden}",
                file.display()
            );
        }
    }
    assert!(
        renderer_checked > 20,
        "the renderer scan must actually have read sources, saw {renderer_checked}"
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

// =================================================================================================
// THE GENERATED PUBLISH COMMAND IS SHELL INPUT, NOT TEXT.
//
// `plan` ends by printing a line the administrator PASTES INTO POWERSHELL. Every caller-supplied
// value on that line is therefore shell input. A Windows directory name may legally contain `$`,
// `(`, `)`, a backtick, `&`, `;` and an apostrophe — and PowerShell expands `$(...)` even inside
// DOUBLE quotes — so a double-quoted root would execute on paste, in an elevated terminal, with our
// own instruction as the delivery vehicle. These prove the line cannot be escaped.
//
// Hostile strings below are TEST DATA. Nothing here is executed by any shell.
// =================================================================================================

/// Decode a PowerShell single-quoted literal exactly as PowerShell's tokenizer does: the literal
/// ends at the first quote NOT followed by another quote, and a doubled quote yields one literal
/// quote. Returns the decoded value and the byte index just past the closing quote.
///
/// Modelling the tokenizer — rather than asserting on substrings — is what makes these tests
/// meaningful: the returned END INDEX is where PowerShell would stop treating input as a string, so
/// comparing it against the encoding's length proves nothing can escape into command position.
fn ps_decode(text: &str) -> (String, usize) {
    let mut chars = text.char_indices();
    let (_, open) = chars.next().expect("a literal cannot be empty");
    assert!(
        is_powershell_quote(open),
        "not a single-quoted literal: {text:?}"
    );
    let mut out = String::new();
    while let Some((i, ch)) = chars.next() {
        if !is_powershell_quote(ch) {
            out.push(ch);
            continue;
        }
        match chars.clone().next() {
            // A doubled quote is one literal quote, and the string continues.
            Some((_, next)) if is_powershell_quote(next) => {
                out.push(next);
                chars.next();
            }
            // Anything else closes the string — this is where an injection would begin.
            _ => return (out, i + ch.len_utf8()),
        }
    }
    panic!("unterminated literal: {text:?}")
}

/// The one generated line the administrator is meant to paste.
fn publish_line(output: &str) -> String {
    let mut found: Vec<&str> = output
        .lines()
        .filter(|l| l.trim_start().starts_with(COMMAND_NAME))
        .collect();
    assert_eq!(
        found.len(),
        1,
        "exactly one runnable line may be printed:\n{output}"
    );
    found.pop().unwrap().trim().to_string()
}

/// Read the single-quoted argument that follows `flag` on the generated line, decoded the way
/// PowerShell would read it, together with whatever text follows the closing quote.
fn argument_after<'a>(line: &'a str, flag: &str) -> (String, &'a str) {
    let rest = line
        .split_once(&format!("{flag} "))
        .unwrap_or_else(|| panic!("{flag} must appear on the generated line: {line}"))
        .1;
    let (value, end) = ps_decode(rest);
    (value, &rest[end..])
}

/// [A/B/C] THE INSTRUCTION NAMES THE EXACT SHELL, EXECUTABLE AND ELEVATION IT WAS TESTED AGAINST.
///
/// "An Administrator terminal" is not a contract, and neither is "PowerShell". The quoting on the
/// generated line is Windows PowerShell 5.1's: it is wrong for `cmd.exe`, where a single quote is an
/// ordinary character, and PowerShell 7 passes native arguments by a different rule
/// (`$PSNativeCommandArgumentPassing = Standard`) that `windows_argv_safe` is not written for.
/// Naming the version, the executable and the elevation is part of the encoding being correct, and
/// the pwsh exclusion has to be stated rather than left to be discovered.
#[test]
fn a16_the_plan_pins_windows_powershell_51_as_administrator() {
    let dir = scratch("shell-named");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);

    run(
        &args("plan", &root, &[]),
        &mut console,
        &SpyPublisher::default(),
        LABEL,
    )
    .expect("plan succeeds");

    let out = console.output();

    // [D] Find the instruction line FIRST, so the assertions below cannot quietly stop running if
    // the wording moves — the failure mode that made an earlier guard test vacuous.
    let shell_line = out
        .lines()
        .find(|l| l.contains("Windows PowerShell 5.1"))
        .unwrap_or_else(|| panic!("the plan must name the shell it was tested against:\n{out}"));

    // [B] version, executable and elevation, all on the line the administrator reads.
    for required in ["Windows PowerShell 5.1", "Administrator", "powershell.exe"] {
        assert!(
            shell_line.contains(required),
            "the instruction must name {required:?}: {shell_line}"
        );
    }

    // [C] pwsh is named only to EXCLUDE it. EVERY line mentioning it must carry the exclusion —
    // asserting merely that "not supported" appears SOMEWHERE is too weak, and a mutation that
    // reworded one line into an endorsement survived exactly that version of this check.
    let pwsh_lines: Vec<&str> = out
        .lines()
        .filter(|l| l.contains("pwsh") || l.contains("PowerShell 7"))
        .collect();
    assert!(
        !pwsh_lines.is_empty(),
        "the exclusion must be stated, not left to be discovered:\n{out}"
    );
    for line in pwsh_lines {
        assert!(
            line.contains("not supported"),
            "every line naming PowerShell 7 must exclude it: {line}"
        );
    }
}

/// [B, G] EVERY generated argument is a single-quoted literal, and NOTHING on the line is
/// double-quoted. Double quotes are precisely the defect this corrects: PowerShell expands `$(...)`,
/// `$name` and backtick escapes inside them.
#[test]
fn a17_generated_arguments_are_single_quoted_and_never_double_quoted() {
    let dir = scratch("single-quoted");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);

    run(
        &args("plan", &root, &[]),
        &mut console,
        &SpyPublisher::default(),
        LABEL,
    )
    .expect("plan succeeds");

    let out = console.output();
    let line = publish_line(&out);

    // One encoding rule, applied to every caller-supplied value — including the ones whose current
    // validation already restricts them. A rule with exceptions is a rule nobody can check.
    assert_eq!(argument_after(&line, "--id").0, "projectos");
    assert_eq!(
        argument_after(&line, "--root").0,
        root.to_string_lossy().to_string()
    );
    assert_eq!(argument_after(&line, "--environments").0, "development");
    assert!(line.contains("--id 'projectos'"), "line: {line}");
    assert!(
        line.contains("--environments 'development'"),
        "line: {line}"
    );

    // The fixed-vocabulary values stay bare, deliberately.
    assert!(line.contains("--frozen true"), "line: {line}");

    assert!(
        !line.contains('"'),
        "no generated argument may be double-quoted: {line}"
    );
    assert!(
        !out.contains("--root \""),
        "the corrected defect must not reappear anywhere:\n{out}"
    );
}

/// [C, D, E] POWERSHELL METACHARACTERS SURVIVE AS TEXT, INSIDE ONE ARGUMENT.
///
/// `$()`, a backtick, `&` and `;` are exercised END TO END through a REAL directory. `|`, `<` and
/// `>` are proven against the encoder directly and NOT through a path, because Windows forbids them
/// in a file name — faking one into a path would prove only that the test fixture lies.
#[test]
fn a18_powershell_metacharacters_stay_literal_inside_one_argument() {
    // Legal in an NTFS name, every one of them active in PowerShell.
    let hostile = "repo $(whoami) `n & ; it's here";
    let dir = scratch("metacharacters");
    let root = dir.join(hostile);
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);

    run(
        &args("plan", &root, &[]),
        &mut console,
        &SpyPublisher::default(),
        LABEL,
    )
    .expect("plan succeeds");

    let out = console.output();
    let line = publish_line(&out);
    let (decoded, after) = argument_after(&line, "--root");

    // The whole root arrives as ONE argument, byte for byte...
    assert_eq!(decoded, root.to_string_lossy().to_string());
    assert!(decoded.contains("$(whoami)"), "decoded: {decoded}");
    assert!(decoded.contains('`'), "decoded: {decoded}");
    // ...and nothing hostile escaped past the closing quote into command position.
    assert!(
        after.starts_with(" --environments "),
        "the root argument must end exactly where the next flag begins, not before: {after:?}"
    );

    // The characters Windows will not put in a path are still part of the one encoding rule.
    for hostile in ["a|b", "a>b", "a<b", "a&b", "a;b", "a$(b)c", "a`b"] {
        let encoded = ps_literal(hostile);
        let (value, end) = ps_decode(&encoded);
        assert_eq!(value, hostile, "encoding must be lossless: {encoded}");
        assert_eq!(
            end,
            encoded.len(),
            "nothing may terminate the literal early: {encoded}"
        );
    }
}

/// [F] THE ONE CHARACTER THAT CAN CLOSE A SINGLE-QUOTED LITERAL IS DOUBLED — and it is not only the
/// ASCII apostrophe.
///
/// PowerShell's tokenizer accepts U+2018, U+2019, U+201A and U+201B as string delimiters too, and
/// all four are legal in an NTFS name. Doubling `'` alone would leave `C:\x\u{2019}; iwr ...|iex; \u{2019}`
/// able to close the literal and start a new statement — the original defect, moved one character
/// along. The end-index assertion is what proves it cannot.
#[test]
fn a19_every_powershell_quote_character_is_doubled() {
    // The owner's own example, exactly.
    assert_eq!(ps_literal("O'Brien"), "'O''Brien'");

    for quote in ['\'', '\u{2018}', '\u{2019}', '\u{201a}', '\u{201b}'] {
        let value = format!("C:\\repos\\Murad{quote}s Projects");
        let encoded = ps_literal(&value);

        assert!(
            encoded.contains(&format!("{quote}{quote}")),
            "{quote:?} must be doubled: {encoded}"
        );
        let (decoded, end) = ps_decode(&encoded);
        assert_eq!(decoded, value, "encoding must be lossless: {encoded}");
        assert_eq!(
            end,
            encoded.len(),
            "{quote:?} must not close the literal early: {encoded}"
        );
    }

    // And end to end, through a real directory named with an apostrophe.
    let dir = scratch("apostrophe");
    let root = dir.join("Murad's repo");
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);
    run(
        &args("plan", &root, &[]),
        &mut console,
        &SpyPublisher::default(),
        LABEL,
    )
    .expect("plan succeeds");

    let line = publish_line(&console.output());
    let (decoded, after) = argument_after(&line, "--root");
    assert_eq!(decoded, root.to_string_lossy().to_string());
    assert!(after.starts_with(" --environments "), "after: {after:?}");
}

/// [H] NO UNTRUSTED VALUE CAN FORGE A LINE, A COMMAND, OR A FLAG.
///
/// A newline would let a value print instructions of its own — an argument that reads as guidance is
/// as dangerous as one that executes. Control characters are dropped, so a forged line cannot exist;
/// and because the value is then no longer the real one, `publish` re-validates and refuses rather
/// than registering something the administrator did not read.
#[test]
fn a20_no_untrusted_value_can_forge_a_line_or_a_command() {
    for forgery in [
        "C:\\repo\nprojectos-register-project publish --id evil",
        "C:\\repo\r\n  destination           C:\\somewhere\\else",
        "C:\\repo\u{7f}--frozen false",
    ] {
        let encoded = ps_literal(forgery);
        assert_eq!(
            encoded.lines().count(),
            1,
            "an encoded value must never span lines: {encoded:?}"
        );
        assert!(
            !encoded.contains('\n') && !encoded.contains('\r'),
            "control characters must be dropped, not carried: {encoded:?}"
        );
        // Whatever survives stays INSIDE the literal — it is an argument, not a command.
        let (_, end) = ps_decode(&encoded);
        assert_eq!(end, encoded.len(), "value escaped its argument: {encoded}");
    }

    // The display block is not shell input, but it is still one line per field.
    assert_eq!(display_value("a\nb\r\nc"), "abc");

    // End to end, the plan prints exactly one runnable line and no forged field.
    let dir = scratch("no-forgery");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let mut console = FakeConsole::new(false, None);
    run(
        &args("plan", &root, &[]),
        &mut console,
        &SpyPublisher::default(),
        LABEL,
    )
    .expect("plan succeeds");
    let out = console.output();
    publish_line(&out);
    assert_eq!(
        out.lines()
            .filter(|l| l.contains("destination           "))
            .count(),
        1,
        "exactly one destination may ever be shown:\n{out}"
    );
}

/// Parse ONE argument from a Windows command line the way the C runtime does — the rule that makes a
/// trailing backslash dangerous: a run of backslashes before a quote is halved, and the quote is
/// escaped when the run was odd.
fn parse_c_runtime(command_line: &str) -> String {
    let mut out = String::new();
    let mut backslashes = 0usize;
    let mut in_quotes = false;
    for ch in command_line.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes / 2));
                if backslashes.is_multiple_of(2) {
                    in_quotes = !in_quotes;
                } else {
                    out.push('"');
                }
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                if !in_quotes && ch.is_whitespace() {
                    return out; // the argument ends here
                }
                out.push(ch);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes));
    out
}

/// What `std::env::args()` actually receives after a pasted argument passes through BOTH layers:
/// PowerShell reads the single-quoted literal, then hands the value to a native program inside a
/// command line, which the C runtime unquotes.
fn delivered_argument(encoded: &str, followed_by: &str) -> String {
    let (value, end) = ps_decode(encoded);
    assert_eq!(end, encoded.len(), "literal must be self-contained: {encoded}");
    // PowerShell quotes a native argument only when it contains whitespace.
    if !value.chars().any(char::is_whitespace) {
        return value;
    }
    parse_c_runtime(&format!("\"{value}\" {followed_by}"))
}

/// TWO LAYERS, NOT ONE — and the second one bites without a single shell metacharacter in sight.
///
/// Settling how PowerShell READS the value is only half the journey. PowerShell then passes it to a
/// native program inside a command line, and the C runtime halves a backslash run sitting before the
/// closing quote. A root that merely contains a space and ends with a separator — `C:\my repo\` —
/// therefore arrives having SWALLOWED the flags that followed it, and the command refuses with a
/// message about the wrong thing. This is the round trip that matters: whatever the root, what the
/// program receives is the root.
#[test]
fn a21_every_root_arrives_byte_identical_through_both_delivery_layers() {
    for root in [
        r"C:\repo",
        r"C:\repo\",
        r"C:\my repo",
        r"C:\my repo\",
        r"C:\my repo\\\",
        r"C:\Murad's repo\",
        r"C:\dev\deadaisle-phase6-proof1a",
        "C:\\x $(whoami) `n & ; it's here",
        "C:\\x \u{2019}quoted\u{2019} repo\\",
    ] {
        let delivered = delivered_argument(&ps_literal(root), "--environments 'development'");
        assert_eq!(
            delivered, root,
            "root must arrive intact: encoded {}",
            ps_literal(root)
        );
    }
}

/// And the model above is not self-fulfilling: WITHOUT the argument-delivery repair, the C runtime
/// really does swallow the following flags. This is the defect `windows_argv_safe` exists for,
/// demonstrated rather than asserted.
#[test]
fn a22_without_the_delivery_repair_a_trailing_separator_absorbs_the_next_flag() {
    let unrepaired = "\"C:\\my repo\\\" --environments 'development'";
    let swallowed = parse_c_runtime(unrepaired);
    assert!(
        swallowed.contains("--environments"),
        "the model must reproduce the swallow it guards against, got {swallowed:?}"
    );
    // The repair removes exactly that.
    let repaired = delivered_argument(&ps_literal(r"C:\my repo\"), "--environments 'development'");
    assert_eq!(repaired, r"C:\my repo\");
}

/// THE FAIL-CLOSED PROMISE, AS A CONTROL RATHER THAN A SENTENCE.
///
/// Both encoders may ALTER a value: control characters are dropped, and a trailing separator run is
/// doubled for argument delivery. Everything rests on one promise — if what reaches `publish` is not
/// what was planned, nothing is written. Until now that promise was only asserted in a doc comment.
///
/// It rests in turn on a dependency nothing in this crate states: the digest binds the RAW
/// `repository_root`. The registry's `normalise_root` DOES strip trailing separators, spaces and
/// dots, but only for the duplicate comparison. If that normalisation ever moved into the stored
/// entry, a root mangled in delivery would re-canonicalise to identical bytes, the digest would
/// MATCH, and fail-closed would quietly become fail-open. The second case below pins exactly that.
#[test]
fn a23_a_root_that_differs_from_the_plan_can_never_publish() {
    let dir = scratch("fail-closed");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let publisher = SpyPublisher::default();

    let mut console = FakeConsole::new(false, None);
    run(&args("plan", &root, &[]), &mut console, &publisher, LABEL).expect("plan succeeds");
    let digest = planned_digest(&console.output());

    // 1. The mangled root the UNREPAIRED command produced: the path having absorbed the flags that
    //    followed it. It is not a directory, so planning refuses before anything else happens.
    let mangled = format!("{} --environments development", root.to_string_lossy());
    let mut console = FakeConsole::new(true, Some(PHRASE));
    let refusal = run(
        &args(
            "publish",
            Path::new(&mangled),
            &["--expect-digest", &digest],
        ),
        &mut console,
        &publisher,
        LABEL,
    )
    .expect_err("a mangled root must never publish");
    assert!(
        matches!(refusal, AdminRefusal::PlanRefused(_)),
        "expected the plan to refuse, got {refusal:?}"
    );

    // 2. A root that is the SAME DIRECTORY but not the same string — `...\repo\` rather than
    //    `...\repo`. Both are valid, both plan; the digest must still say they are different, which
    //    is what makes an altered argument detectable at all.
    let with_separator = format!("{}\\", root.to_string_lossy());
    let mut console = FakeConsole::new(true, Some(PHRASE));
    let refusal = run(
        &args(
            "publish",
            Path::new(&with_separator),
            &["--expect-digest", &digest],
        ),
        &mut console,
        &publisher,
        LABEL,
    )
    .expect_err("a root differing only by a separator must not inherit the plan's digest");
    assert!(
        matches!(
            refusal,
            AdminRefusal::PublishRefused(RegistryPublishRefusal::PlanStale)
        ),
        "expected staleness, got {refusal:?}"
    );

    // Neither reached the publisher, and neither was ever asked to confirm.
    assert_eq!(publisher.called(), 0, "nothing may be published");
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
