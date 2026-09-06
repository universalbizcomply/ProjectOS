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

/// Maximum accepted length of a repository-relative committed path.
const MAX_COMMITTED_PATH_LEN: usize = 512;

/// A repository-relative path whose COMMITTED content may be read.
///
/// THERE IS NO WAY TO HOLD AN UNVALIDATED ONE. The inner field is private and the only constructor
/// validates, so every value that reaches [`GitCommand::CatFileBlob`] has already been proven
/// non-empty, bounded, ASCII-graphic, relative, separator-normalised, traversal-free and — the part
/// that matters most for a `<rev>:<path>` object spec — free of `:`, which is the only character
/// that could re-point the spec at a different revision. A leading `-` is refused as well, so the
/// argument cannot be option-shaped even if `--end-of-options` were ever dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedPath {
    rel: String,
}

impl CommittedPath {
    /// Validate one repository-relative path.
    ///
    /// # Errors
    /// [`RepoAdapterError::CommittedPathInvalid`] on any structural violation.
    pub fn new(rel: &str) -> Result<Self, RepoAdapterError> {
        if rel.is_empty() || rel.len() > MAX_COMMITTED_PATH_LEN {
            return Err(RepoAdapterError::CommittedPathInvalid);
        }
        // ASCII GRAPHIC ONLY. This excludes NUL, every control character, space and everything
        // non-ASCII in one rule, so there is no encoding through which a separator or a terminator
        // can arrive. It is deliberately narrower than "a legal Git path": the paths this reader
        // serves are fixed by the packaging contract, and a bound that only just fits them is a
        // bound an attacker has nothing to work with.
        if !rel.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(RepoAdapterError::CommittedPathInvalid);
        }
        // `:` SEPARATES THE REVISION FROM THE PATH. Allowing one here would let a path re-open the
        // question of which commit is being read.
        // `\` is not a Git path separator; accepting it would mean two spellings of one path.
        if rel.contains(':') || rel.contains('\\') {
            return Err(RepoAdapterError::CommittedPathInvalid);
        }
        // Not absolute, not option-shaped, and no empty / dot / traversing segment.
        if rel.starts_with('/') || rel.starts_with('-') || rel.ends_with('/') {
            return Err(RepoAdapterError::CommittedPathInvalid);
        }
        if rel
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
        {
            return Err(RepoAdapterError::CommittedPathInvalid);
        }
        Ok(Self {
            rel: rel.to_string(),
        })
    }

    /// The validated repository-relative path.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.rel
    }
}

/// A commit identity: 40 (SHA-1) or 64 (SHA-256) lower-case hex characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitId {
    hex: String,
}

impl CommitId {
    /// Validate one commit identity.
    ///
    /// # Errors
    /// [`RepoAdapterError::MalformedOid`] if it is not 40/64 lower-case hex.
    pub fn parse(hex: &str) -> Result<Self, RepoAdapterError> {
        let ok = matches!(hex.len(), 40 | 64)
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !ok {
            return Err(RepoAdapterError::MalformedOid);
        }
        Ok(Self {
            hex: hex.to_string(),
        })
    }

    /// The validated lower-case hex identity.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.hex
    }
}

/// WHICH COMMIT a reader is asked to open at. A closed choice, never a free-form revision
/// expression: there is no branch name, no tag, no `@{...}` form and no `^`/`~` walk.
///
/// THIS IS AN OPENING SELECTOR, NOT THE THING A READ USES. `HEAD` is a mutable pointer — an actor
/// with ordinary write access to the repository moves it with `git checkout`, `git reset`,
/// `git symbolic-ref` or by editing `.git/HEAD`, none of which require committing as the owner. A
/// reader that carried the token `HEAD` into every command would therefore re-resolve it each time,
/// and an attacker could move the commit between one artefact's read and the next while every answer
/// still honestly reported "this is what is committed".
///
/// So [`super::CommittedFileReader::open`] RESOLVES this to one exact [`CommitId`] once, and only
/// that resolved id is ever put on a command line. [`GitCommand::CatFileBlob`] cannot carry a ref at
/// all, which makes "no read follows a movable pointer" a property of the type rather than a promise
/// about how it is used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommittedRevision {
    /// Resolve `HEAD` ONCE, when the reader is opened, and pin the commit it names.
    Head,
    /// One exact commit, pinned from the start.
    Commit(CommitId),
}

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
    /// `cat-file blob --end-of-options <commit>:<path>` — the COMMITTED bytes at one path.
    ///
    /// AN EXACT COMMIT, NEVER A REF. The operand is a [`CommitId`] rather than a
    /// [`CommittedRevision`], so `HEAD` — or any other pointer somebody with write access could
    /// move between two reads — is not representable here at all.
    ///
    /// STILL READ-ONLY, and still no way to say anything else. Both operands are validated types
    /// with private fields, so the single interpolated argument is lower-case hex, then `:`, then an
    /// ASCII-graphic relative path with no `:` of its own. `--end-of-options` makes even that
    /// unreadable as a flag (it requires Git 2.24 or later; an older Git refuses the command, which
    /// fails closed). `cat-file` writes nothing, resolves no remote and consults no index — it
    /// answers from the object store, which is why a working-tree edit cannot change what comes
    /// back.
    ///
    /// "BLOB" INCLUDES A SYMLINK. Git stores a symbolic link as a blob holding its target text, so
    /// a path committed as a link yields the link text rather than the linked file's content. That
    /// is the committed object and is the right answer; a caller comparing content digests sees a
    /// mismatch and refuses, which is the intended outcome.
    CatFileBlob {
        /// The exact commit to read from.
        commit: CommitId,
        /// The validated repository-relative path.
        path: CommittedPath,
    },
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
            GitCommand::CatFileBlob { commit, path } => vec![
                "cat-file".into(),
                "blob".into(),
                "--end-of-options".into(),
                format!("{}:{}", commit.as_str(), path.as_str()),
            ],
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

    /// THE COMMITTED READ IS EXACTLY FOUR FIXED ARGUMENTS PLUS ONE UNAMBIGUOUS OBJECT SPEC.
    ///
    /// Pinning the array is what stops a later edit adding `--textconv`, `--filters` or a
    /// `-c core.autocrlf=true` in front of it. Any of those would make the bytes returned a
    /// *rendering* of the committed object rather than the object, and the digest the owner signed
    /// is over the object.
    #[test]
    fn a_committed_read_emits_only_its_fixed_args_and_one_object_spec() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let read = GitCommand::CatFileBlob {
            commit: CommitId::parse(oid).unwrap(),
            path: CommittedPath::new("projectos/security/installation-project-allowlist.json")
                .unwrap(),
        };
        assert_eq!(
            read.args(),
            [
                "cat-file",
                "blob",
                "--end-of-options",
                &format!("{oid}:projectos/security/installation-project-allowlist.json"),
            ]
        );
    }

    /// A COMMITTED READ CANNOT NAME A MOVABLE POINTER.
    ///
    /// `CatFileBlob` takes a `CommitId`, and `CommitId::parse` refuses `HEAD` along with every other
    /// ref spelling — so there is no value of the field that re-resolves at command time. This is
    /// the type-level half of the fix; the resolution half is `CommittedFileReader::open`.
    #[test]
    fn a_committed_read_cannot_carry_head_or_any_other_ref() {
        for pointer in [
            "HEAD",
            "head",
            "ORIG_HEAD",
            "main",
            "refs/heads/main",
            "@",
            "@{-1}",
        ] {
            assert_eq!(
                CommitId::parse(pointer).unwrap_err(),
                RepoAdapterError::MalformedOid,
                "{pointer:?} must not be usable as a committed read's operand"
            );
        }
    }

    /// AN ARBITRARY GIT OPTION IS UNREPRESENTABLE, not filtered.
    ///
    /// Every one of these is a way somebody might try to smuggle a second argument, a second
    /// revision or a flag into the single interpolated operand. None of them can be held as a
    /// `CommittedPath` at all, so none of them ever reaches an argument array.
    #[test]
    fn no_option_traversal_or_second_revision_can_become_a_committed_path() {
        for hostile in [
            "",
            "-c",
            "--upload-pack=calc",
            "-",
            "/etc/passwd",
            "C:/windows/system32",
            "..\\..\\secrets",
            "a/../../b",
            "./a",
            "a/./b",
            "a//b",
            "a/",
            "HEAD:a",
            "a:b",
            "a\\b",
            "a b",
            "a\tb",
            "a\nb",
            "a\0b",
            "\u{00e9}",
        ] {
            assert_eq!(
                CommittedPath::new(hostile).unwrap_err(),
                RepoAdapterError::CommittedPathInvalid,
                "{hostile:?} must not be representable"
            );
        }
        assert!(CommittedPath::new(&"a".repeat(MAX_COMMITTED_PATH_LEN)).is_ok());
        assert_eq!(
            CommittedPath::new(&"a".repeat(MAX_COMMITTED_PATH_LEN + 1)).unwrap_err(),
            RepoAdapterError::CommittedPathInvalid
        );
    }

    /// A REVISION IS `HEAD` OR AN EXACT COMMIT — never a ref, a walk or a reflog expression.
    #[test]
    fn only_head_or_an_exact_lower_case_commit_is_a_revision() {
        assert!(CommitId::parse("0123456789abcdef0123456789abcdef01234567").is_ok());
        assert!(CommitId::parse(&"a".repeat(64)).is_ok());
        for bad in [
            "",
            "main",
            "HEAD~1",
            "@{upstream}",
            "0123456789ABCDEF0123456789ABCDEF01234567",
            "0123456789abcdef0123456789abcdef0123456",
            "0123456789abcdef0123456789abcdef012345678",
            "-0123456789abcdef0123456789abcdef0123456",
        ] {
            assert_eq!(
                CommitId::parse(bad).unwrap_err(),
                RepoAdapterError::MalformedOid,
                "{bad:?} must not be a commit identity"
            );
        }
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
            GitCommand::CatFileBlob {
                commit: CommitId::parse(&"a".repeat(40)).unwrap(),
                path: CommittedPath::new("projectos/security/x.json").unwrap(),
            },
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
