//! Windows command-line construction (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! `CreateProcessW` takes the executable via `lpApplicationName` (absolute, verified — so no PATH
//! search can ever occur) AND a command line that must still carry argv[0] itself. This module
//! builds that command line with correct Windows quoting.
//!
//! Deliberately PURE and platform-independent: the quoting rules are pure string logic, so they are
//! testable on every platform and cannot break cross-platform builds or validators.
//!
//! Quoting follows the documented `CommandLineToArgvW` rules:
//!  - a backslash is literal unless it precedes a quote;
//!  - N backslashes before a quote produce N/2 backslashes, and the quote is a delimiter if N is
//!    even or a literal quote if N is odd;
//!  - therefore backslashes immediately before a quote (including the closing quote) are doubled.
//!
//! No shell, no `cmd.exe`, no PowerShell, and no caller-provided raw command line exist anywhere.

use super::errors::ProcessError;

/// Windows hard limit for a `CreateProcessW` command line, including the terminating NUL.
pub const MAX_COMMAND_LINE_CHARS: usize = 32_767;

/// True when the argument can be emitted without quoting.
fn needs_quoting(arg: &str) -> bool {
    arg.is_empty() || arg.chars().any(|c| c == ' ' || c == '\t' || c == '"')
}

/// Quote one argument per the `CommandLineToArgvW` rules.
fn quote_arg(arg: &str) -> String {
    if !needs_quoting(arg) {
        return arg.to_string();
    }
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => {
                backslashes += 1;
            }
            '"' => {
                // Double the run of backslashes, then escape the quote itself.
                for _ in 0..(backslashes * 2 + 1) {
                    out.push('\\');
                }
                out.push('"');
                backslashes = 0;
            }
            other => {
                for _ in 0..backslashes {
                    out.push('\\');
                }
                out.push(other);
                backslashes = 0;
            }
        }
    }
    // Trailing backslashes precede the closing quote, so they must be doubled.
    for _ in 0..(backslashes * 2) {
        out.push('\\');
    }
    out.push('"');
    out
}

/// Build the full command line: quoted argv[0] (the executable) followed by quoted fixed arguments.
///
/// Rejects embedded NUL anywhere (it would truncate the UTF-16 buffer) and any command line at or
/// beyond the Windows limit. Returns the command line as a NUL-terminated UTF-16 buffer, which
/// `CreateProcessW` requires to be MUTABLE.
pub fn build_command_line(exe: &str, args: &[String]) -> Result<Vec<u16>, ProcessError> {
    if exe.is_empty() || exe.contains('\0') {
        return Err(ProcessError::CommandLineInvalid);
    }
    if args.iter().any(|a| a.contains('\0')) {
        return Err(ProcessError::CommandLineInvalid);
    }
    let mut line = quote_arg(exe);
    for a in args {
        line.push(' ');
        line.push_str(&quote_arg(a));
    }
    let mut wide: Vec<u16> = line.encode_utf16().collect();
    // +1 for the terminating NUL.
    if wide.len() + 1 > MAX_COMMAND_LINE_CHARS {
        return Err(ProcessError::CommandLineTooLong);
    }
    wide.push(0);
    Ok(wide)
}

/// Encode a path as a NUL-terminated UTF-16 buffer (for `lpApplicationName` / `lpCurrentDirectory`).
pub fn to_wide_nul(s: &str) -> Result<Vec<u16>, ProcessError> {
    if s.contains('\0') {
        return Err(ProcessError::CommandLineInvalid);
    }
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    Ok(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_of(exe: &str, args: &[&str]) -> String {
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let w = build_command_line(exe, &owned).unwrap();
        String::from_utf16(&w[..w.len() - 1]).unwrap()
    }

    #[test]
    fn plain_argument_is_not_quoted() {
        assert_eq!(
            line_of("C:\\p\\node.exe", &["simple"]),
            "C:\\p\\node.exe simple"
        );
    }

    #[test]
    fn argv0_is_always_included() {
        let l = line_of("C:\\p\\node.exe", &[]);
        assert_eq!(l, "C:\\p\\node.exe");
    }

    #[test]
    fn spaces_force_quoting() {
        assert_eq!(
            line_of("C:\\my dir\\node.exe", &[]),
            "\"C:\\my dir\\node.exe\""
        );
        assert_eq!(line_of("x", &["a b"]), "x \"a b\"");
    }

    #[test]
    fn tab_forces_quoting() {
        assert_eq!(line_of("x", &["a\tb"]), "x \"a\tb\"");
    }

    #[test]
    fn empty_argument_becomes_empty_quotes() {
        assert_eq!(line_of("x", &[""]), "x \"\"");
    }

    #[test]
    fn embedded_quote_is_escaped() {
        assert_eq!(line_of("x", &["a\"b"]), "x \"a\\\"b\"");
    }

    #[test]
    fn trailing_backslashes_are_doubled_before_closing_quote() {
        // `a b\` -> quoted, the trailing backslash doubles so it stays literal.
        assert_eq!(line_of("x", &["a b\\"]), "x \"a b\\\\\"");
    }

    #[test]
    fn backslashes_before_quote_are_doubled_and_quote_escaped() {
        // input: a\"  => backslash run of 1 before a quote -> 3 backslashes + escaped quote
        assert_eq!(line_of("x", &["a\\\"b"]), "x \"a\\\\\\\"b\"");
    }

    #[test]
    fn interior_backslashes_are_literal() {
        assert_eq!(line_of("x", &["a\\b c"]), "x \"a\\b c\"");
    }

    #[test]
    fn unicode_is_preserved() {
        assert_eq!(line_of("x", &["ünï çödé"]), "x \"ünï çödé\"");
    }

    #[test]
    fn embedded_nul_rejected() {
        assert_eq!(
            build_command_line("x", &["a\0b".to_string()]),
            Err(ProcessError::CommandLineInvalid)
        );
        assert_eq!(
            build_command_line("a\0b", &[]),
            Err(ProcessError::CommandLineInvalid)
        );
    }

    #[test]
    fn empty_executable_rejected() {
        assert_eq!(
            build_command_line("", &[]),
            Err(ProcessError::CommandLineInvalid)
        );
    }

    #[test]
    fn oversized_command_line_rejected() {
        let big = "a".repeat(MAX_COMMAND_LINE_CHARS);
        assert_eq!(
            build_command_line("x", &[big]),
            Err(ProcessError::CommandLineTooLong)
        );
    }

    #[test]
    fn command_line_is_nul_terminated() {
        let w = build_command_line("x", &["y".to_string()]).unwrap();
        assert_eq!(*w.last().unwrap(), 0);
    }

    #[test]
    fn to_wide_nul_rejects_embedded_nul() {
        assert_eq!(to_wide_nul("a\0b"), Err(ProcessError::CommandLineInvalid));
        assert_eq!(*to_wide_nul("ok").unwrap().last().unwrap(), 0);
    }
}
