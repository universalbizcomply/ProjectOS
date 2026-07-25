//! The CLOSED read-only Git command allowlist and a narrowly-scoped bounded process runner. Direct
//! `std::process` invocation with an argument array — NO shell, NO string-built command line, NO
//! aliases, NO caller-supplied options. Every command is one variant of [`GitCommand`]; there is no way
//! to run anything else through this crate.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::RepoAdapterError;

/// Per-command wall-clock timeout.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
/// Maximum stdout bytes accepted from one command.
pub const MAX_STDOUT: usize = 1_048_576;
/// Maximum stderr bytes read (bounded, never surfaced).
pub const MAX_STDERR: usize = 65_536;

/// The closed allowlist of READ-ONLY observation commands. No mutation, network, config-write, alias,
/// or arbitrary argument is representable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCommand {
    /// `rev-parse --is-inside-work-tree`
    IsInsideWorkTree,
    /// `rev-parse --show-toplevel`
    ShowToplevel,
    /// `rev-parse --git-common-dir`
    GitCommonDir,
    /// `rev-parse HEAD`
    RevParseHead,
    /// `symbolic-ref --quiet --short HEAD`
    SymbolicRefHead,
    /// `status --porcelain=v2 --branch --untracked-files=all`
    StatusPorcelain,
    /// `rev-list --left-right --count <local>...<tracking>`
    RevListCount {
        /// Local ref (validated bounded ref token).
        local: String,
        /// Tracking ref (validated bounded ref token).
        tracking: String,
    },
    /// `submodule status --recursive`
    SubmoduleStatus,
    /// `worktree list --porcelain`
    WorktreeList,
}

impl GitCommand {
    /// The EXACT argument array. Every element is a fixed literal except the two validated ref tokens
    /// of [`GitCommand::RevListCount`], which are bounded and never option-shaped.
    fn args(&self) -> Vec<String> {
        match self {
            GitCommand::IsInsideWorkTree => {
                vec!["rev-parse".into(), "--is-inside-work-tree".into()]
            }
            GitCommand::ShowToplevel => vec!["rev-parse".into(), "--show-toplevel".into()],
            GitCommand::GitCommonDir => vec!["rev-parse".into(), "--git-common-dir".into()],
            GitCommand::RevParseHead => vec!["rev-parse".into(), "HEAD".into()],
            GitCommand::SymbolicRefHead => vec![
                "symbolic-ref".into(),
                "--quiet".into(),
                "--short".into(),
                "HEAD".into(),
            ],
            GitCommand::StatusPorcelain => vec![
                "status".into(),
                "--porcelain=v2".into(),
                "--branch".into(),
                "--untracked-files=all".into(),
            ],
            GitCommand::RevListCount { local, tracking } => vec![
                "rev-list".into(),
                "--left-right".into(),
                "--count".into(),
                format!("{local}...{tracking}"),
            ],
            GitCommand::SubmoduleStatus => {
                vec!["submodule".into(), "status".into(), "--recursive".into()]
            }
            GitCommand::WorktreeList => {
                vec!["worktree".into(), "list".into(), "--porcelain".into()]
            }
        }
    }
}

/// A bounded, contained Git observation runner rooted at a canonical work tree. The Git executable is
/// explicit (default `git`); tests may point it at a disposable fixture, but production callers use the
/// real `git`.
#[derive(Debug, Clone)]
pub struct GitRunner {
    exe: String,
    timeout: Duration,
    max_stdout: usize,
}

/// The bounded result of one command.
pub struct GitOut {
    /// Process exit code (`None` if terminated without a code).
    pub code: Option<i32>,
    /// Bounded stdout bytes.
    pub stdout: Vec<u8>,
}

// A PATH-resolved (`git`) runner is TEST-ONLY: production must pin one verified absolute executable via
// `RepositoryAdapterConfig`, so a live graph can never fall back to an uncontrolled PATH lookup.
#[cfg(any(test, feature = "test-fixtures"))]
impl Default for GitRunner {
    fn default() -> Self {
        Self {
            exe: "git".into(),
            timeout: COMMAND_TIMEOUT,
            max_stdout: MAX_STDOUT,
        }
    }
}

impl GitRunner {
    /// A runner with an explicit Git executable (the verified production path, or a test fixture).
    #[must_use]
    pub fn with_exe(exe: impl Into<String>) -> Self {
        Self {
            exe: exe.into(),
            timeout: COMMAND_TIMEOUT,
            max_stdout: MAX_STDOUT,
        }
    }

    /// A runner with an explicit, shorter timeout (for a timeout fixture).
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Run one allowlisted command in `root`. Direct spawn, no shell; hardened env; bounded stdout;
    /// killed on timeout.
    ///
    /// # Errors
    /// [`RepoAdapterError`] for a launch failure, timeout, or output overflow.
    pub fn run(&self, root: &Path, cmd: &GitCommand) -> Result<GitOut, RepoAdapterError> {
        let mut child = Command::new(&self.exe)
            .args(cmd.args())
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_PAGER", "cat")
            .env("PAGER", "cat")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .spawn()
            .map_err(|_| RepoAdapterError::CommandRefused)?;

        let mut out = child
            .stdout
            .take()
            .ok_or(RepoAdapterError::CommandRefused)?;
        let mut err = child
            .stderr
            .take()
            .ok_or(RepoAdapterError::CommandRefused)?;
        let max = self.max_stdout;
        // Concurrent bounded readers prevent a full-pipe deadlock and cap memory.
        let ho = std::thread::spawn(move || read_bounded(&mut out, max));
        let he = std::thread::spawn(move || read_bounded(&mut err, MAX_STDERR));

        let deadline = Instant::now() + self.timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = ho.join();
                        let _ = he.join();
                        return Err(RepoAdapterError::CommandTimeout);
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(RepoAdapterError::CommandRefused);
                }
            }
        };
        let stdout = ho.join().map_err(|_| RepoAdapterError::CommandRefused)??;
        let _ = he.join();
        Ok(GitOut {
            code: status.code(),
            stdout,
        })
    }
}

/// Read at most `max` bytes; an overflow is refused (never truncated-and-trusted).
fn read_bounded<R: Read>(r: &mut R, max: usize) -> Result<Vec<u8>, RepoAdapterError> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = r
            .read(&mut chunk)
            .map_err(|_| RepoAdapterError::CommandRefused)?;
        if n == 0 {
            break;
        }
        if buf.len() + n > max {
            return Err(RepoAdapterError::OutputOverflow);
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The EXACT argument arrays are fixed literals — no shell, no caller-supplied option, no alias. This
    // pins the closed allowlist so a mutation adding an option/config/network arg is caught.
    #[test]
    fn every_command_emits_only_its_fixed_read_only_args() {
        let cases: &[(GitCommand, &[&str])] = &[
            (
                GitCommand::IsInsideWorkTree,
                &["rev-parse", "--is-inside-work-tree"],
            ),
            (GitCommand::ShowToplevel, &["rev-parse", "--show-toplevel"]),
            (GitCommand::GitCommonDir, &["rev-parse", "--git-common-dir"]),
            (GitCommand::RevParseHead, &["rev-parse", "HEAD"]),
            (
                GitCommand::SymbolicRefHead,
                &["symbolic-ref", "--quiet", "--short", "HEAD"],
            ),
            (
                GitCommand::StatusPorcelain,
                &[
                    "status",
                    "--porcelain=v2",
                    "--branch",
                    "--untracked-files=all",
                ],
            ),
            (
                GitCommand::SubmoduleStatus,
                &["submodule", "status", "--recursive"],
            ),
            (
                GitCommand::WorktreeList,
                &["worktree", "list", "--porcelain"],
            ),
        ];
        for (cmd, expected) in cases {
            assert_eq!(&cmd.args(), expected, "{cmd:?}");
        }
    }

    #[test]
    fn rev_list_count_interpolates_only_a_bounded_refspec() {
        let args = GitCommand::RevListCount {
            local: "main".into(),
            tracking: "@{upstream}".into(),
        }
        .args();
        assert_eq!(
            args,
            ["rev-list", "--left-right", "--count", "main...@{upstream}"]
        );
    }

    #[test]
    fn no_command_carries_a_network_mutation_or_config_verb() {
        let all = [
            GitCommand::IsInsideWorkTree,
            GitCommand::ShowToplevel,
            GitCommand::GitCommonDir,
            GitCommand::RevParseHead,
            GitCommand::SymbolicRefHead,
            GitCommand::StatusPorcelain,
            GitCommand::RevListCount {
                local: "main".into(),
                tracking: "@{upstream}".into(),
            },
            GitCommand::SubmoduleStatus,
            GitCommand::WorktreeList,
        ];
        const FORBIDDEN: &[&str] = &[
            "fetch",
            "pull",
            "push",
            "clone",
            "remote",
            "commit",
            "merge",
            "rebase",
            "reset",
            "checkout",
            "clean",
            "add",
            "tag",
            "config",
            "-c",
            "--exec",
            "--upload-pack",
        ];
        for cmd in all {
            for a in cmd.args() {
                assert!(
                    !FORBIDDEN.contains(&a.as_str()),
                    "forbidden arg {a} in {cmd:?}"
                );
            }
        }
    }
}
