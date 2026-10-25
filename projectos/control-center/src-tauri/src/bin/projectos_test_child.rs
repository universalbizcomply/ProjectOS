//! TEST-ONLY synthetic child for PROJECTOS-WINDOWS-PROCESS-CREATION1A lifecycle proofs.
//!
//! THIS IS NOT THE PROJECTOS DAEMON AND CAN NEVER BECOME IT.
//! It is never referenced by a trust manifest, never packaged as the daemon, and refuses to run at
//! all unless argv[1] is exactly the synthetic-child token. It has no shell, no arbitrary command
//! execution, no network, no product/repository access, no credential access, and never dumps its
//! environment.
//!
//! Every mode is bounded and self-terminating: a hard maximum lifetime applies even to `wait`, so a
//! test crash can never leave a process running forever (the Job Object is the real guarantee; this
//! is defence in depth).

use std::io::{BufRead, Read, Write};
use std::time::{Duration, Instant};

/// Exactly the token declared by the process module. Duplicated as a literal because a test-only bin
/// must not depend on the library's internals.
const TOKEN: &str = "--projectos-synthetic-test-child";
/// Hard maximum lifetime for ANY mode. Nothing here may outlive this.
const MAX_LIFETIME: Duration = Duration::from_secs(30);
const EXIT_BAD_INVOCATION: i32 = 2;
/// The known non-zero code the `exit-code` mode returns.
pub const KNOWN_NONZERO_EXIT: i32 = 42;

fn deadline_reached(start: Instant) -> bool {
    start.elapsed() >= MAX_LIFETIME
}

/// Sleep in small slices so the hard lifetime is always honoured.
fn bounded_sleep(start: Instant) {
    while !deadline_reached(start) {
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Wait for a cooperative "shutdown" line on stdin, bounded by the hard lifetime.
fn wait_for_shutdown(start: Instant) {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return,                              // EOF: parent closed stdin
            Ok(_) if line.trim() == "shutdown" => return, // cooperative exit
            Ok(_) => {}
            Err(_) => return,
        }
        if deadline_reached(start) {
            return;
        }
    }
}

fn main() {
    let start = Instant::now();
    let args: Vec<String> = std::env::args().collect();

    // Guard: without the exact token this binary does nothing at all.
    if args.get(1).map(String::as_str) != Some(TOKEN) {
        eprintln!("projectos test child: refused (synthetic test fixture only)");
        std::process::exit(EXIT_BAD_INVOCATION);
    }

    let mode = args.get(2).map(String::as_str).unwrap_or("wait");

    match mode {
        // Live until cooperatively shut down (or the hard lifetime expires).
        "wait" => {
            println!("ready");
            let _ = std::io::stdout().flush();
            wait_for_shutdown(start);
        }
        // Exit straight away, success.
        "exit-immediately" => {}
        // Exit with a known non-zero code.
        "exit-code" => std::process::exit(KNOWN_NONZERO_EXIT),
        // Bounded stdout write, then wait for shutdown.
        "write-stdout" => {
            for i in 0..10 {
                println!("stdout line {i}");
            }
            let _ = std::io::stdout().flush();
            wait_for_shutdown(start);
        }
        // Bounded stderr write, then wait for shutdown.
        "write-stderr" => {
            for i in 0..10 {
                eprintln!("stderr line {i}");
            }
            let _ = std::io::stderr().flush();
            wait_for_shutdown(start);
        }
        // Bounded flood on both streams: proves the drains prevent pipe-full deadlock.
        "flood" => {
            for i in 0..20_000 {
                println!("flood stdout {i} ....................................");
                eprintln!("flood stderr {i} ....................................");
                if deadline_reached(start) {
                    break;
                }
            }
            let _ = std::io::stdout().flush();
            wait_for_shutdown(start);
        }
        // Deliberately ignore cooperative shutdown: must be force-terminated by the owner.
        "ignore-shutdown" => {
            println!("ready");
            let _ = std::io::stdout().flush();
            // Consume stdin without ever acting on it.
            std::thread::spawn(|| {
                let mut sink = Vec::new();
                let _ = std::io::stdin().read_to_end(&mut sink);
            });
            bounded_sleep(start);
        }
        // Spawn exactly one bounded synthetic grandchild, then wait. The grandchild inherits Job
        // membership (no breakaway flags are ever set), so closing the Job must kill it too.
        "spawn-grandchild" => {
            let exe = std::env::current_exe().expect("current exe");
            let child = std::process::Command::new(exe)
                .arg(TOKEN)
                .arg("wait")
                .spawn();
            match child {
                Ok(c) => println!("grandchild {}", c.id()),
                Err(_) => println!("grandchild spawn failed"),
            }
            let _ = std::io::stdout().flush();
            wait_for_shutdown(start);
        }
        _ => {
            eprintln!("projectos test child: unknown mode");
            std::process::exit(EXIT_BAD_INVOCATION);
        }
    }
}
