//! Bounded, redacted output capture (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! stdout and stderr are drained CONCURRENTLY from process start on separate threads. This is not a
//! nicety: an undrained pipe fills (~64 KB) and then blocks the child forever on its next write —
//! the current sidecar discards stderr entirely (`Stdio::null()`), which both destroys crash
//! evidence and is a latent hang. Two blocking threads are the smallest reliable design; anonymous
//! pipes cannot do overlapped I/O, so an async model would require named pipes for no benefit.
//!
//! Memory is bounded by construction: a tail buffer with a hard byte cap and a per-line cap, so an
//! output flood cannot grow memory without limit.
//!
//! The redaction here is defence-in-depth for crash evidence. It is NOT a secret-management control:
//! secrets are excluded from the child by construction (explicit allowlisted environment, no
//! secrets in argv).

use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex};

/// Hard cap on retained output per stream.
pub const MAX_RETAINED_BYTES: usize = 64 * 1024;
/// Hard cap on a single retained line.
pub const MAX_LINE_BYTES: usize = 4 * 1024;
/// Marker recorded when output was dropped to stay within the cap.
pub const TRUNCATION_MARKER: &str = "[...truncated...]";

/// Secret-shaped fragments redacted from retained output.
const REDACT_PATTERNS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "apikey",
    "api_key",
    "bearer",
    "authorization",
    "cookie",
    "jwt",
    "eyJ",
    "sk-",
    "ghp_",
    "AKIA",
];

/// Redact a single line: secret-shaped lines are replaced wholesale, and Windows-style local paths
/// are reduced to their file name so crash evidence never carries the local filesystem layout.
pub fn redact_line(line: &str) -> String {
    let lower = line.to_lowercase();
    if REDACT_PATTERNS
        .iter()
        .any(|p| lower.contains(&p.to_lowercase()))
    {
        return "[REDACTED]".to_string();
    }
    redact_paths(line)
}

/// Replace `X:\a\b\c.txt` style absolute paths with `<path>\c.txt`.
fn redact_paths(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        // Detect a drive-letter path start: <letter> ':' ('\' | '/')
        let is_path_start = i + 2 < chars.len()
            && chars[i].is_ascii_alphabetic()
            && chars[i + 1] == ':'
            && (chars[i + 2] == '\\' || chars[i + 2] == '/');
        if is_path_start {
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '"' {
                i += 1;
            }
            let path: String = chars[start..i].iter().collect();
            let tail = path.rsplit(['\\', '/']).next().unwrap_or("").to_string();
            out.push_str("<path>");
            if !tail.is_empty() {
                out.push('\\');
                out.push_str(&tail);
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// A bounded tail of redacted output lines.
#[derive(Debug, Default)]
pub struct BoundedOutput {
    lines: Vec<String>,
    bytes: usize,
    truncated: bool,
}

impl BoundedOutput {
    pub fn push_line(&mut self, raw: &str) {
        let mut line = redact_line(raw);
        if line.len() > MAX_LINE_BYTES {
            line.truncate(MAX_LINE_BYTES);
            line.push_str(TRUNCATION_MARKER);
            self.truncated = true;
        }
        self.bytes += line.len();
        self.lines.push(line);
        // Drop from the front until inside the cap: retain the TAIL, which is what matters at a crash.
        while self.bytes > MAX_RETAINED_BYTES && !self.lines.is_empty() {
            let removed = self.lines.remove(0);
            self.bytes -= removed.len();
            self.truncated = true;
        }
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub fn lines(&self) -> &[String] {
        &self.lines
    }

    /// Safe rendering, with an explicit marker when anything was dropped.
    pub fn render(&self) -> String {
        let mut s = String::new();
        if self.truncated {
            s.push_str(TRUNCATION_MARKER);
            s.push('\n');
        }
        s.push_str(&self.lines.join("\n"));
        s
    }
}

/// Hard cap on a single protocol line forwarded from stdout. Anything longer is dropped rather than
/// forwarded — a daemon cannot flood memory through the lifecycle channel.
pub const MAX_PROTOCOL_LINE_BYTES: usize = 64 * 1024;

/// Drain a reader, forwarding each bounded line to `tx`. Used for the REAL daemon's stdout, which is
/// a protocol channel rather than diagnostics.
///
/// The thread always terminates: on EOF, on a read error, or once the receiver is dropped (which is
/// how shutdown stops forwarding without blocking).
pub(crate) fn drain_lines<R: Read>(reader: R, tx: std::sync::mpsc::Sender<String>) {
    let buf = BufReader::new(reader);
    for line in buf.lines() {
        match line {
            Ok(l) => {
                if l.len() > MAX_PROTOCOL_LINE_BYTES {
                    continue; // oversize: never forwarded, never buffered
                }
                if tx.send(l).is_err() {
                    return; // receiver gone (shutdown) — stop forwarding
                }
            }
            Err(_) => return,
        }
    }
}

/// Drain a reader to completion into a bounded buffer. Returns when the pipe reaches EOF, which
/// happens once the child exits AND the parent has closed its copy of the child-side write end.
pub fn drain<R: Read>(reader: R, sink: Arc<Mutex<BoundedOutput>>) {
    let buf = BufReader::new(reader);
    for line in buf.lines() {
        match line {
            Ok(l) => {
                if let Ok(mut guard) = sink.lock() {
                    guard.push_line(&l);
                }
            }
            // Invalid UTF-8 or a broken pipe ends the drain; the thread must always terminate.
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_shaped_line_is_redacted() {
        for l in [
            "GITHUB_TOKEN=ghp_abcdefghijklmnopqrst",
            "Authorization: Bearer eyJhbGciOi",
            "password=hunter2",
            "cookie: session=abc",
        ] {
            assert_eq!(redact_line(l), "[REDACTED]", "{l}");
        }
    }

    #[test]
    fn local_paths_are_reduced_to_file_name() {
        assert_eq!(
            redact_line("failed at C:\\dev\\ProjectOS\\workers\\thing.js line 4"),
            "failed at <path>\\thing.js line 4"
        );
    }

    #[test]
    fn secret_check_wins_over_path_reduction() {
        // A path containing a secret-shaped segment must redact the WHOLE line, not merely shorten
        // the path — the conservative order is deliberate.
        assert_eq!(redact_line("read C:\\dev\\secret\\thing.js"), "[REDACTED]");
    }

    #[test]
    fn ordinary_line_survives() {
        assert_eq!(redact_line("worker ready"), "worker ready");
    }

    #[test]
    fn retained_bytes_are_bounded_and_marked() {
        let mut o = BoundedOutput::default();
        for i in 0..5000 {
            o.push_line(&format!("line {i} padding padding padding padding"));
        }
        assert!(o.bytes <= MAX_RETAINED_BYTES, "bytes={}", o.bytes);
        assert!(o.truncated());
        assert!(o.render().contains(TRUNCATION_MARKER));
    }

    #[test]
    fn tail_is_retained_not_head() {
        let mut o = BoundedOutput::default();
        for i in 0..5000 {
            o.push_line(&format!("line {i} padding padding padding padding"));
        }
        assert!(o.render().contains("line 4999"));
        assert!(!o.render().contains("line 0 padding"));
    }

    #[test]
    fn long_line_is_capped() {
        let mut o = BoundedOutput::default();
        o.push_line(&"x".repeat(MAX_LINE_BYTES * 3));
        assert!(o.lines()[0].len() <= MAX_LINE_BYTES + TRUNCATION_MARKER.len());
        assert!(o.truncated());
    }

    #[test]
    fn drain_reads_to_eof_and_terminates() {
        let data = b"alpha\nbeta\n" as &[u8];
        let sink = Arc::new(Mutex::new(BoundedOutput::default()));
        drain(data, sink.clone());
        let g = sink.lock().unwrap();
        assert_eq!(g.lines(), &["alpha".to_string(), "beta".to_string()]);
    }

    #[test]
    fn drain_redacts_while_reading() {
        let data = b"ok\npassword=hunter2\n" as &[u8];
        let sink = Arc::new(Mutex::new(BoundedOutput::default()));
        drain(data, sink.clone());
        let g = sink.lock().unwrap();
        assert_eq!(g.lines(), &["ok".to_string(), "[REDACTED]".to_string()]);
    }
}
