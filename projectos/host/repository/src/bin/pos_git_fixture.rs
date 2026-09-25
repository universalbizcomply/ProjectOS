//! TEST-ONLY fake "Git" executable used to drive the adapter's process-boundary defenses
//! deterministically (timeout kill, stdout-overflow refusal, environment hardening) WITHOUT touching a
//! real repository or the network. It is compiled only under the `test-fixtures` feature, so a
//! production graph can never build or reach it.
//!
//! STEERED BY A FILE IN ITS WORKING DIRECTORY, NOT BY AN ENVIRONMENT VARIABLE. It used to read
//! `POS_FIXTURE_MODE` from the environment it inherited; the runner now clears the inherited
//! environment (PROJECTOS-HOST-REVIEW-PATH1B), so a variable set by the test no longer arrives — which
//! is the hardening working, and is itself asserted below.

use std::io::Write;

/// The file, in the working directory the runner sets, that names the mode.
const MODE_FILE: &str = "pos-fixture-mode.txt";

fn main() {
    let mode = std::fs::read_to_string(MODE_FILE).unwrap_or_default();
    match mode.trim() {
        // Hang well past any test timeout so the runner must kill us.
        "timeout" => std::thread::sleep(std::time::Duration::from_secs(120)),
        // Emit more than the runner's MAX_STDOUT so read_bounded refuses (never truncates-and-trusts).
        "overflow" => {
            let chunk = vec![b'x'; 65_536];
            let mut out = std::io::stdout().lock();
            for _ in 0..64 {
                if out.write_all(&chunk).is_err() {
                    return;
                }
            }
            let _ = out.flush();
        }
        // Prove the runner sets the hardening env AND that nothing Git-facing is inherited. Exit
        // non-zero if ANY expectation fails, so the test fails loudly on a hardening regression.
        "assert_env" => {
            let set = check("GIT_TERMINAL_PROMPT", "0")
                && check("GIT_OPTIONAL_LOCKS", "0")
                && check("GIT_PAGER", "cat")
                && check("PAGER", "cat")
                && check("GIT_EDITOR", "true")
                && check("GIT_CONFIG_NOSYSTEM", "1")
                && check("GIT_NO_REPLACE_OBJECTS", "1")
                && check("GIT_NO_LAZY_FETCH", "1")
                && check("GIT_ATTR_NOSYSTEM", "1")
                && present("GIT_CONFIG_GLOBAL")
                && present("GIT_CONFIG_SYSTEM")
                && present("GIT_GRAFT_FILE")
                && present("GIT_CONFIG_COUNT");
            // The test process sets every one of these before it runs us. None may arrive.
            let inherited = [
                "POS_INHERITED_CANARY",
                "GIT_DIR",
                "GIT_WORK_TREE",
                "GIT_OBJECT_DIRECTORY",
                "GIT_ALTERNATE_OBJECT_DIRECTORIES",
                "GIT_CONFIG_PARAMETERS",
                "GIT_REPLACE_REF_BASE",
                "GIT_EXTERNAL_DIFF",
            ]
            .iter()
            .any(|name| present(name));
            if set && !inherited {
                print!("HARDENED");
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            }
            std::process::exit(if inherited { 4 } else { 3 });
        }
        // A repository that proves out and answers every ancestry question "yes", whose tree
        // difference then FAILS with no output. The reader must refuse, never report "no changes".
        "diff_tree_fails" => {
            let args: Vec<String> = std::env::args().skip(1).collect();
            match args.first().map(String::as_str) {
                Some("rev-parse")
                    if args.get(1).map(String::as_str) == Some("--is-inside-work-tree") =>
                {
                    println!("true");
                }
                Some("rev-parse") => {
                    let cwd = std::env::current_dir().expect("cwd");
                    println!("{}", cwd.to_string_lossy().replace('\\', "/"));
                }
                Some("merge-base") => {}
                Some("diff-tree") => std::process::exit(128),
                _ => std::process::exit(2),
            }
        }
        _ => std::process::exit(2),
    }
}

fn check(key: &str, expected: &str) -> bool {
    std::env::var(key).ok().as_deref() == Some(expected)
}

fn present(key: &str) -> bool {
    std::env::var_os(key).is_some()
}
