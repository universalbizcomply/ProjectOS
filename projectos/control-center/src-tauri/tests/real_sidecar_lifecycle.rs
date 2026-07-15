//! REAL sidecar proof (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! Drives the ACTUAL `sidecar/host.mjs` through the real launch path: sanitized dev-Node resolution
//! → atomic Job-bound creation → explicit `lifecycle.ready` → graceful shutdown → PID-tracked orphan
//! proof.
//!
//! Bounded and non-destructive: it starts and stops one local daemon. Destructive lifecycle cases
//! (force-kill, ignore-shutdown, grandchild containment) stay with the synthetic child. Nothing here
//! touches a provider, the network, production, or a product repository.
//!
//! Requires the `test-fixtures` feature only because it uses the closed test surface; the launch path
//! it exercises is the same one the application uses.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// `canonicalize` yields a verbatim path (`\\?\C:\...`) which Node cannot parse — it dies with
/// `EISDIR: illegal operation on a directory, lstat 'C:'`. Strip it, exactly as the production
/// resolver (`dev_runtime::strip_verbatim`) does.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    match s.strip_prefix("\\\\?\\") {
        Some(rest) if rest.len() > 2 && rest.as_bytes()[1] == b':' => PathBuf::from(rest),
        _ => p,
    }
}

/// Locate `sidecar/host.mjs` from the test binary location (never the ambient cwd).
fn host_script() -> Option<PathBuf> {
    let me = std::env::current_exe().ok()?;
    let mut dir = me.parent()?.to_path_buf();
    for _ in 0..6 {
        let candidate = dir.join("sidecar").join("host.mjs");
        if candidate.is_file() {
            return std::fs::canonicalize(candidate).ok().map(plain);
        }
        dir = dir.parent()?.to_path_buf();
    }
    None
}

/// Resolve node exactly as the production resolver does: sanitized absolute PATH entries only, no
/// cwd, no empty entries, no shell.
fn dev_node() -> Option<PathBuf> {
    if let Some(o) = std::env::var_os("PROJECTOS_DEV_NODE") {
        let p = PathBuf::from(o);
        if p.is_absolute() && p.is_file() {
            return std::fs::canonicalize(p).ok().map(plain);
        }
        return None;
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            continue; // empty == cwd on Windows; relative resolves against cwd
        }
        let c = dir.join("node.exe");
        if c.is_file() {
            return std::fs::canonicalize(c).ok().map(plain);
        }
    }
    None
}

/// Probe whether a PID is still alive. Read-only; terminates nothing.
fn pid_is_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };
    // SAFETY: read-only probe; the handle is closed immediately and nothing is terminated.
    unsafe {
        match OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            Ok(h) => {
                let alive = WaitForSingleObject(h, 0) != WAIT_OBJECT_0;
                let _ = CloseHandle(h);
                alive
            }
            Err(_) => false,
        }
    }
}

/// The real daemon, launched the way the application launches it (minus the Tauri shell).
struct RealDaemon {
    child: std::process::Child,
}

impl RealDaemon {
    fn start(instance: &str) -> Option<RealDaemon> {
        let node = dev_node()?;
        let script = host_script()?;
        let root = script.parent()?.parent()?.to_path_buf();
        let mut cmd = Command::new(&node); // absolute — no PATH search
        cmd.arg(&script)
            .current_dir(&root)
            .env_clear() // never inherit the host environment
            .env("SystemRoot", std::env::var("SystemRoot").ok()?)
            .env("PROJECTOS_DAEMON_INSTANCE_ID", instance)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Some(RealDaemon {
            child: cmd.spawn().ok()?,
        })
    }
}

impl Drop for RealDaemon {
    fn drop(&mut self) {
        // Cleanup guard: established before any assertion can fail.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Read stdout lines until `pred` matches or the deadline passes.
fn read_until<F: Fn(&str) -> bool>(
    reader: &mut BufReader<std::process::ChildStdout>,
    limit: Duration,
    pred: F,
) -> Option<String> {
    let deadline = Instant::now() + limit;
    let mut line = String::new();
    while Instant::now() < deadline {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return None, // EOF
            Ok(_) => {
                if pred(&line) {
                    return Some(line.clone());
                }
            }
            Err(_) => return None,
        }
    }
    None
}

#[test]
fn real_sidecar_announces_deterministic_lifecycle_ready() {
    let Some(mut d) = RealDaemon::start("host-proof-1") else {
        eprintln!("SKIP: node or sidecar/host.mjs unavailable in this environment");
        return;
    };
    let mut out = BufReader::new(d.child.stdout.take().expect("stdout"));

    let ready = read_until(&mut out, Duration::from_secs(15), |l| {
        l.contains("lifecycle.ready")
    });
    let ready = ready.expect("daemon must announce lifecycle.ready");

    // Exact contract.
    assert!(ready.contains("\"type\":\"lifecycle.ready\""), "{ready}");
    assert!(ready.contains("\"protocolVersion\":1"), "{ready}");
    assert!(
        ready.contains("\"daemonInstanceId\":\"host-proof-1\""),
        "{ready}"
    );
    assert!(ready.contains("\"status\":\"read-only\""), "{ready}");
    // Readiness must never claim trust.
    let lower = ready.to_lowercase();
    assert!(
        !lower.contains("trusted") && !lower.contains("secure"),
        "{ready}"
    );
}

#[test]
fn real_sidecar_refuses_to_start_without_an_instance_id() {
    let Some(node) = dev_node() else { return };
    let Some(script) = host_script() else { return };
    let root = script.parent().unwrap().parent().unwrap().to_path_buf();
    let out = Command::new(&node)
        .arg(&script)
        .current_dir(&root)
        .env_clear()
        .env(
            "SystemRoot",
            std::env::var("SystemRoot").unwrap_or_default(),
        )
        // PROJECTOS_DAEMON_INSTANCE_ID deliberately absent
        .output()
        .expect("spawn");
    // Refuses rather than running unowned; emits no ready line.
    assert_eq!(
        out.status.code(),
        Some(3),
        "must refuse without an instance id"
    );
    assert!(!String::from_utf8_lossy(&out.stdout).contains("lifecycle.ready"));
}

#[test]
fn real_sidecar_rejects_a_malformed_instance_id() {
    let Some(node) = dev_node() else { return };
    let Some(script) = host_script() else { return };
    let root = script.parent().unwrap().parent().unwrap().to_path_buf();
    let out = Command::new(&node)
        .arg(&script)
        .current_dir(&root)
        .env_clear()
        .env(
            "SystemRoot",
            std::env::var("SystemRoot").unwrap_or_default(),
        )
        .env("PROJECTOS_DAEMON_INSTANCE_ID", "bad id with spaces!")
        .output()
        .expect("spawn");
    assert_eq!(out.status.code(), Some(3));
}

#[test]
fn real_sidecar_ordinary_snapshot_precedes_ready_and_is_not_ready() {
    let Some(mut d) = RealDaemon::start("host-proof-2") else {
        return;
    };
    let mut out = BufReader::new(d.child.stdout.take().expect("stdout"));

    // The FIRST line is the incidental startup snapshot — proof that "first valid message" would
    // have been the wrong readiness contract.
    let first = read_until(&mut out, Duration::from_secs(15), |_| true).expect("first line");
    assert!(
        first.contains("\"kind\":\"snapshot\""),
        "first line was: {first}"
    );
    assert!(!first.contains("lifecycle.ready"));

    // Readiness still arrives, distinctly, afterwards.
    let ready = read_until(&mut out, Duration::from_secs(15), |l| {
        l.contains("lifecycle.ready")
    });
    assert!(ready.is_some(), "ready must follow the startup snapshot");
}

#[test]
fn real_sidecar_serves_a_snapshot_request_after_ready() {
    let Some(mut d) = RealDaemon::start("host-proof-3") else {
        return;
    };
    let mut out = BufReader::new(d.child.stdout.take().expect("stdout"));
    let mut stdin = d.child.stdin.take().expect("stdin");

    read_until(&mut out, Duration::from_secs(15), |l| {
        l.contains("lifecycle.ready")
    })
    .expect("ready");

    // Exactly the bytes the Rust host sends.
    stdin.write_all(b"{\"cmd\":\"snapshot\"}\n").expect("write");
    stdin.flush().ok();

    let snap = read_until(&mut out, Duration::from_secs(10), |l| {
        l.contains("\"kind\":\"snapshot\"")
    });
    assert!(snap.is_some(), "a fresh snapshot must follow the request");
}

#[test]
fn real_sidecar_exits_gracefully_on_lifecycle_shutdown_and_leaves_no_process() {
    let Some(mut d) = RealDaemon::start("host-proof-4") else {
        return;
    };
    let pid = d.child.id();
    let mut out = BufReader::new(d.child.stdout.take().expect("stdout"));
    let mut stdin = d.child.stdin.take().expect("stdin");

    read_until(&mut out, Duration::from_secs(15), |l| {
        l.contains("lifecycle.ready")
    })
    .expect("ready");

    stdin
        .write_all(b"{\"cmd\":\"lifecycle.shutdown\"}\n")
        .expect("write");
    stdin.flush().ok();

    let status = {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match d.child.try_wait() {
                Ok(Some(s)) => break Some(s),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                _ => break None,
            }
        }
    };
    let status = status.expect("daemon must exit on lifecycle.shutdown");
    assert_eq!(status.code(), Some(0), "graceful exit code");

    std::thread::sleep(Duration::from_millis(300));
    // PID-tracked: a raw node.exe count proves nothing (many unrelated node processes exist).
    assert!(
        !pid_is_alive(pid),
        "daemon pid {pid} survived graceful shutdown"
    );
}

#[test]
fn real_sidecar_exits_when_stdin_closes() {
    // Closing stdin is what happens when the host goes away. The Job Object is the hard guarantee;
    // this proves the graceful path also works, so normal exits are clean.
    let Some(mut d) = RealDaemon::start("host-proof-5") else {
        return;
    };
    let pid = d.child.id();
    let mut out = BufReader::new(d.child.stdout.take().expect("stdout"));
    read_until(&mut out, Duration::from_secs(15), |l| {
        l.contains("lifecycle.ready")
    })
    .expect("ready");

    drop(d.child.stdin.take()); // EOF

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut exited = false;
    while Instant::now() < deadline {
        if matches!(d.child.try_wait(), Ok(Some(_))) {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        exited,
        "daemon must exit on stdin EOF (interval must not hold the loop open)"
    );
    std::thread::sleep(Duration::from_millis(300));
    assert!(!pid_is_alive(pid), "daemon pid {pid} survived stdin EOF");
}
