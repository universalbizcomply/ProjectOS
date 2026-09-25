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
    /// `diff-tree -r --raw -z --no-abbrev --no-renames --no-ext-diff --end-of-options <base> <candidate>`
    /// — the COMPLETE changed-path set between the two ENDPOINT TREES.
    ///
    /// RATIFIED IN PROJECTOS-HOST-REVIEW-PATH1B as the one read-only tree-difference addition.
    ///
    /// ENDPOINT TREES, NOT A HISTORY WALK. Given two commits `diff-tree` compares the tree of the
    /// first with the tree of the second and nothing in between, so a change made and reverted along
    /// the way is absent, and a path that differs between the endpoints cannot be absent. `-r`
    /// recurses so every changed blob is its own record rather than a changed directory; `--raw -z`
    /// is the one machine format with NUL-terminated, unquoted paths; `--no-abbrev` gives full-length
    /// object identities; `--no-renames` keeps a rename as a delete plus an add, so no similarity
    /// heuristic — which is configurable — decides what the evidence says; `--no-ext-diff` means no
    /// configured program is consulted even though `--raw` would not reach one.
    ///
    /// BOTH OPERANDS ARE [`CommitId`]s: no reference, no path pattern and no caller-supplied option
    /// is representable.
    DiffTreeEndpoints {
        /// The approved baseline commit.
        base: CommitId,
        /// The pinned candidate commit.
        candidate: CommitId,
    },
    /// `merge-base --is-ancestor <ancestor> <descendant>` — exit 0 yes, exit 1 no, anything else a
    /// refusal (an absent or non-commit operand).
    ///
    /// RATIFIED IN PROJECTOS-HOST-REVIEW-PATH1B as the one read-only ancestry check.
    ///
    /// IT IS ALSO THE EXISTENCE CHECK, so no third verb is needed: a commit is its own ancestor, so
    /// asking the question of one identity twice answers "is this a commit this repository has".
    ///
    /// THE ANSWER IS ONLY AS GOOD AS THE PARENT LINKS, which is why [`GitRunner::run`] disables
    /// replacement references and the graft file for every command: either could splice a baseline
    /// into a candidate's history that never contained it.
    IsAncestor {
        /// The commit that must be reachable.
        ancestor: CommitId,
        /// The commit it must be reachable from.
        descendant: CommitId,
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
            GitCommand::DiffTreeEndpoints { base, candidate } => vec![
                "diff-tree".into(),
                "-r".into(),
                "--raw".into(),
                "-z".into(),
                "--no-abbrev".into(),
                "--no-renames".into(),
                "--no-ext-diff".into(),
                "--end-of-options".into(),
                base.as_str().to_string(),
                candidate.as_str().to_string(),
            ],
            GitCommand::IsAncestor {
                ancestor,
                descendant,
            } => vec![
                "merge-base".into(),
                "--is-ancestor".into(),
                ancestor.as_str().to_string(),
                descendant.as_str().to_string(),
            ],
        }
    }
}

/// The null device: a configuration or graft "file" that exists, is readable and is always empty.
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

/// The ONLY variables carried over from the Host process. Everything else — every `GIT_*` variable
/// above all — is dropped, so nothing the Host inherited can re-point the object store, the index,
/// the namespace or the configuration of a read.
const ENV_PASSTHROUGH: &[&str] = &["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "PATH"];

/// Repository-local configuration CANNOT be switched off, so the keys through which it could run a
/// program or change an answer are overridden at command scope, which outranks the repository file.
const CONFIG_OVERRIDES: &[(&str, &str)] = &[
    ("core.fsmonitor", "false"),
    ("core.hooksPath", NULL_DEVICE),
    ("core.pager", "cat"),
    ("core.useReplaceRefs", "false"),
    ("protocol.allow", "never"),
];

/// A canonical root as Git's `safe.directory` spells it: no verbatim prefix, forward slashes.
fn safe_directory_value(root: &Path) -> String {
    let text = root.to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    text.replace('\\', "/")
}

/// THE ENVIRONMENT EVERY COMMAND RUNS UNDER — fixed by the Host, in full.
///
/// RATIFIED IN PROJECTOS-HOST-REVIEW-PATH1B. The governed worktree is writable by the implementer
/// and the reader is privileged, so nothing in that worktree, in a user profile or in the machine
/// configuration may alter what is read or run a program:
///
/// * replacement references and the graft file are disabled, because either can splice history and
///   so forge an ancestry answer or substitute an object;
/// * system and user configuration are replaced by the null device, and system attributes are off;
/// * a lazy fetch from a promisor remote — network, credential helper and transport program in one
///   — is off, and every transport is refused;
/// * the repository-local keys that name a program or change an answer are overridden.
///
/// `safe.directory` names exactly the proven root. The Host reads a repository it does not own BY
/// DESIGN, and what Git's ownership check defends against — a repository-configured program — is
/// what the overrides above remove.
fn fixed_environment(root: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = [
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_OPTIONAL_LOCKS", "0"),
        ("GIT_PAGER", "cat"),
        ("PAGER", "cat"),
        ("GIT_EDITOR", "true"),
        ("GIT_SEQUENCE_EDITOR", "true"),
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_CONFIG_SYSTEM", NULL_DEVICE),
        ("GIT_CONFIG_GLOBAL", NULL_DEVICE),
        ("GIT_ATTR_NOSYSTEM", "1"),
        ("GIT_NO_REPLACE_OBJECTS", "1"),
        ("GIT_GRAFT_FILE", NULL_DEVICE),
        ("GIT_NO_LAZY_FETCH", "1"),
        ("LC_ALL", "C"),
        ("LANG", "C"),
    ]
    .iter()
    .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
    .collect();

    let mut overrides: Vec<(String, String)> = CONFIG_OVERRIDES
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();
    overrides.push(("safe.directory".to_string(), safe_directory_value(root)));
    env.push(("GIT_CONFIG_COUNT".to_string(), overrides.len().to_string()));
    for (i, (key, value)) in overrides.into_iter().enumerate() {
        env.push((format!("GIT_CONFIG_KEY_{i}"), key));
        env.push((format!("GIT_CONFIG_VALUE_{i}"), value));
    }
    env
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
            // NOTHING IS INHERITED BUT THE CLOSED PASSTHROUGH, and everything Git-facing is set by
            // `fixed_environment` — GIT_TERMINAL_PROMPT, GIT_OPTIONAL_LOCKS, GIT_PAGER, GIT_EDITOR
            // and LC_ALL among them.
            .env_clear()
            .envs(
                ENV_PASSTHROUGH
                    .iter()
                    .filter_map(|name| std::env::var_os(name).map(|value| (*name, value))),
            )
            .envs(fixed_environment(root))
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

    /// THE TREE DIFFERENCE AND THE ANCESTRY CHECK ARE FIXED ARGUMENTS PLUS TWO EXACT COMMITS.
    ///
    /// Pinning the arrays is what stops a later edit adding `-M` (rename detection, whose threshold
    /// is configurable), `--abbrev`, a pathspec that would hide a changed path, or a third operand.
    #[test]
    fn the_tree_difference_and_ancestry_check_emit_only_fixed_args_and_two_commits() {
        let b = "0123456789abcdef0123456789abcdef01234567";
        let d = "89abcdef0123456789abcdef0123456789abcdef";
        let base = CommitId::parse(b).unwrap();
        let candidate = CommitId::parse(d).unwrap();
        assert_eq!(
            GitCommand::DiffTreeEndpoints {
                base: base.clone(),
                candidate: candidate.clone(),
            }
            .args(),
            [
                "diff-tree",
                "-r",
                "--raw",
                "-z",
                "--no-abbrev",
                "--no-renames",
                "--no-ext-diff",
                "--end-of-options",
                b,
                d,
            ]
        );
        assert_eq!(
            GitCommand::IsAncestor {
                ancestor: base,
                descendant: candidate,
            }
            .args(),
            ["merge-base", "--is-ancestor", b, d]
        );
    }

    /// THE ENVIRONMENT IS FIXED IN FULL, and this is the whole of it.
    ///
    /// An exact list rather than a set of "must contain" checks, because the failure this guards is
    /// an ADDITION as much as a removal: one more passthrough variable is one more thing the Host's
    /// own environment can say to Git.
    #[test]
    fn the_environment_is_exactly_the_fixed_list() {
        let env = fixed_environment(Path::new(r"\\?\C:\governed\repo"));
        let render: Vec<String> = env.iter().map(|(k, v)| format!("{k}={v}")).collect();
        assert_eq!(
            render,
            [
                "GIT_TERMINAL_PROMPT=0".to_string(),
                "GIT_OPTIONAL_LOCKS=0".to_string(),
                "GIT_PAGER=cat".to_string(),
                "PAGER=cat".to_string(),
                "GIT_EDITOR=true".to_string(),
                "GIT_SEQUENCE_EDITOR=true".to_string(),
                "GIT_CONFIG_NOSYSTEM=1".to_string(),
                format!("GIT_CONFIG_SYSTEM={NULL_DEVICE}"),
                format!("GIT_CONFIG_GLOBAL={NULL_DEVICE}"),
                "GIT_ATTR_NOSYSTEM=1".to_string(),
                "GIT_NO_REPLACE_OBJECTS=1".to_string(),
                format!("GIT_GRAFT_FILE={NULL_DEVICE}"),
                "GIT_NO_LAZY_FETCH=1".to_string(),
                "LC_ALL=C".to_string(),
                "LANG=C".to_string(),
                "GIT_CONFIG_COUNT=6".to_string(),
                "GIT_CONFIG_KEY_0=core.fsmonitor".to_string(),
                "GIT_CONFIG_VALUE_0=false".to_string(),
                "GIT_CONFIG_KEY_1=core.hooksPath".to_string(),
                format!("GIT_CONFIG_VALUE_1={NULL_DEVICE}"),
                "GIT_CONFIG_KEY_2=core.pager".to_string(),
                "GIT_CONFIG_VALUE_2=cat".to_string(),
                "GIT_CONFIG_KEY_3=core.useReplaceRefs".to_string(),
                "GIT_CONFIG_VALUE_3=false".to_string(),
                "GIT_CONFIG_KEY_4=protocol.allow".to_string(),
                "GIT_CONFIG_VALUE_4=never".to_string(),
                "GIT_CONFIG_KEY_5=safe.directory".to_string(),
                "GIT_CONFIG_VALUE_5=C:/governed/repo".to_string(),
            ]
        );
        assert_eq!(
            ENV_PASSTHROUGH,
            ["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "PATH"]
        );
        assert!(ENV_PASSTHROUGH.iter().all(|name| !name.starts_with("GIT_")));
    }

    /// `safe.directory` IS BOUNDED TO THE ONE ROOT THE COMMAND RUNS IN (gatekeeper ruling §8).
    ///
    /// The Host reads a repository it does not own, so Git's ownership check is answered by naming
    /// the proven root. That is acceptable ONLY while the answer is exactly that root: a wildcard
    /// would trust every repository on the machine, a parent would trust every sibling beneath it,
    /// and a value that does not follow `root` would let whatever chose it choose the trusted
    /// directory. Several unrelated roots are checked so a constant cannot pass by coincidence.
    #[test]
    fn safe_directory_is_exactly_the_run_root_and_never_wider() {
        for (root, spelled) in [
            (r"\\?\C:\governed\repo", "C:/governed/repo"),
            (r"C:\governed\repo", "C:/governed/repo"),
            (r"\\?\D:\deep\nested\worktree\phase", "D:/deep/nested/worktree/phase"),
            (r"\\?\C:\x", "C:/x"),
        ] {
            let env = fixed_environment(Path::new(root));
            let keys: Vec<&(String, String)> = env
                .iter()
                .filter(|(k, v)| k.starts_with("GIT_CONFIG_KEY_") && v == "safe.directory")
                .collect();
            assert_eq!(keys.len(), 1, "{root}: exactly one safe.directory entry");
            let index = keys[0].0.trim_start_matches("GIT_CONFIG_KEY_");
            let value = env
                .iter()
                .find(|(k, _)| *k == format!("GIT_CONFIG_VALUE_{index}"))
                .map(|(_, v)| v.as_str())
                .expect("the entry carries a value");
            assert_eq!(value, spelled, "{root}: the value is the run root itself");
            assert!(!value.contains('*'), "{root}: never a wildcard");
            assert!(!value.is_empty(), "{root}: never empty");
            assert!(
                !value.ends_with('/'),
                "{root}: never a directory prefix that would also match children"
            );
        }
    }

    /// NOTHING THE HOST INHERITED CAN ADD A SECOND `safe.directory`.
    ///
    /// Git also reads configuration from `GIT_CONFIG_PARAMETERS` and from a caller's own
    /// `GIT_CONFIG_COUNT` series. Neither may be carried over from the Host process: the closed
    /// passthrough holds no `GIT_*` name at all, so the only `safe.directory` a read ever sees is the
    /// one `fixed_environment` wrote for the root it runs in.
    #[test]
    fn no_inherited_configuration_channel_is_passed_through() {
        for channel in [
            "GIT_CONFIG_PARAMETERS",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_KEY_0",
            "GIT_CONFIG_VALUE_0",
            "GIT_CONFIG",
            "GIT_DIR",
            "GIT_CEILING_DIRECTORIES",
        ] {
            assert!(
                !ENV_PASSTHROUGH.contains(&channel),
                "{channel} must never be inherited"
            );
        }
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
            GitCommand::DiffTreeEndpoints {
                base: CommitId::parse(&"a".repeat(40)).unwrap(),
                candidate: CommitId::parse(&"b".repeat(40)).unwrap(),
            },
            GitCommand::IsAncestor {
                ancestor: CommitId::parse(&"a".repeat(40)).unwrap(),
                descendant: CommitId::parse(&"b".repeat(40)).unwrap(),
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
