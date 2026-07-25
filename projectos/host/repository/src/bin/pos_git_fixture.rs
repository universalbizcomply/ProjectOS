//! TEST-ONLY fake "Git" executable used to drive the adapter's process-boundary defenses
//! deterministically (timeout kill, stdout-overflow refusal, environment hardening) WITHOUT touching a
//! real repository or the network. Behaviour is selected by the `POS_FIXTURE_MODE` environment
//! variable, which the integration test sets before invoking the adapter runner. It is compiled only
//! under the `test-fixtures` feature, so a production graph can never build or reach it.

use std::io::Write;

fn main() {
    let mode = std::env::var("POS_FIXTURE_MODE").unwrap_or_default();
    match mode.as_str() {
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
        // Prove the runner sets the credential/pager/editor/system-config hardening env. Exit non-zero
        // if ANY expected value is missing, so the test fails loudly on a hardening regression.
        "assert_env" => {
            let ok = check("GIT_TERMINAL_PROMPT", "0")
                && check("GIT_OPTIONAL_LOCKS", "0")
                && check("GIT_PAGER", "cat")
                && check("PAGER", "cat")
                && check("GIT_EDITOR", "true")
                && check("GIT_CONFIG_NOSYSTEM", "1");
            if ok {
                print!("HARDENED");
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            }
            std::process::exit(3);
        }
        _ => std::process::exit(2),
    }
}

fn check(key: &str, expected: &str) -> bool {
    std::env::var(key).ok().as_deref() == Some(expected)
}
