//! Bounded, redacted repository-adapter error taxonomy. No variant carries a raw absolute path, a
//! complete status-path listing, the command environment, arbitrary Git stderr, or credential-helper
//! output — every variant is payload-free.

/// Why the repository adapter refused to produce an observation. Fail closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum RepoAdapterError {
    /// The configured root failed bounded path validation (empty/relative/`..`/control/device/ADS/UNC).
    #[error("invalid repository root")]
    PathInvalid,
    /// The path could not be canonicalized or does not exist / is not a directory.
    #[error("repository root not canonicalizable")]
    PathNotCanonical,
    /// The path is not inside a Git work tree.
    #[error("not a git work tree")]
    NotWorkTree,
    /// The Git-reported top-level root does not match the configured canonical root.
    #[error("repository root mismatch")]
    RootMismatch,
    /// A Git command could not be launched (missing/blocked executable).
    #[error("git command refused")]
    CommandRefused,
    /// A Git command exceeded the per-command timeout (killed).
    #[error("git command timeout")]
    CommandTimeout,
    /// A Git command produced more stdout/stderr than the bound allows.
    #[error("git output overflow")]
    OutputOverflow,
    /// A Git command exited with an unexpected/unsupported status for its contract.
    #[error("git command unexpected exit")]
    UnexpectedExit,
    /// The Git output was malformed for the expected structured contract.
    #[error("malformed git output")]
    MalformedOutput,
    /// A Git object id was malformed (not 40/64 lowercase hex).
    #[error("malformed git oid")]
    MalformedOid,
}
