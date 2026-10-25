//! Bounded, substitution-resistant repository-root validation. The configured root must come from
//! trusted project configuration; here it is structurally validated and canonicalized BEFORE any Git
//! command runs, and the Git-reported top-level is re-canonicalized and compared.

use std::path::{Path, PathBuf};

use crate::error::RepoAdapterError;

/// Maximum accepted root length.
const MAX_ROOT_LEN: usize = 4096;

/// Structurally validate and canonicalize a configured repository root. Rejects empty/relative paths,
/// `..` traversal, NUL/control characters, alternate-data-stream syntax, device paths and (for now)
/// UNC/network paths, then canonicalizes and requires an existing directory.
///
/// # Errors
/// [`RepoAdapterError::PathInvalid`] for a structural violation; [`RepoAdapterError::PathNotCanonical`]
/// if canonicalization fails or the target is not a directory.
pub fn verify_root(config_root: &str) -> Result<PathBuf, RepoAdapterError> {
    if config_root.is_empty() || config_root.len() > MAX_ROOT_LEN {
        return Err(RepoAdapterError::PathInvalid);
    }
    if config_root.bytes().any(|b| b == 0 || b < 0x20) {
        return Err(RepoAdapterError::PathInvalid); // NUL / control
    }
    // Reject device (\\.\ , \\?\) and UNC (\\server\share) forms up front.
    if config_root.starts_with("\\\\") || config_root.starts_with("//") {
        return Err(RepoAdapterError::PathInvalid);
    }
    // Any `..` segment (either separator) is a traversal.
    if config_root
        .split(['/', '\\'])
        .any(|seg| seg == ".." || seg == ".")
    {
        return Err(RepoAdapterError::PathInvalid);
    }
    // Alternate-data-stream: a ':' anywhere except the drive-letter position (index 1).
    if config_root.char_indices().any(|(i, c)| c == ':' && i != 1) {
        return Err(RepoAdapterError::PathInvalid);
    }
    let p = Path::new(config_root);
    if !p.is_absolute() {
        return Err(RepoAdapterError::PathInvalid);
    }
    let canon = std::fs::canonicalize(p).map_err(|_| RepoAdapterError::PathNotCanonical)?;
    if !canon.is_dir() {
        return Err(RepoAdapterError::PathNotCanonical);
    }
    Ok(canon)
}

/// Structurally validate and canonicalize a configured Git EXECUTABLE path. The production adapter must
/// invoke this exact absolute file — never an uncontrolled PATH search for `git`. Rejects empty/relative
/// paths (including bare `git`), `..` traversal, NUL/control, ADS syntax, and UNC/device forms, then
/// canonicalizes and requires an existing regular file.
///
/// # Errors
/// [`RepoAdapterError::PathInvalid`] for a structural violation; [`RepoAdapterError::PathNotCanonical`]
/// if canonicalization fails or the target is not a regular file.
pub fn verify_executable(configured: &str) -> Result<PathBuf, RepoAdapterError> {
    if configured.is_empty() || configured.len() > MAX_ROOT_LEN {
        return Err(RepoAdapterError::PathInvalid);
    }
    if configured.bytes().any(|b| b == 0 || b < 0x20) {
        return Err(RepoAdapterError::PathInvalid);
    }
    if configured.starts_with("\\\\") || configured.starts_with("//") {
        return Err(RepoAdapterError::PathInvalid); // UNC / device
    }
    if configured
        .split(['/', '\\'])
        .any(|seg| seg == ".." || seg == ".")
    {
        return Err(RepoAdapterError::PathInvalid);
    }
    if configured.char_indices().any(|(i, c)| c == ':' && i != 1) {
        return Err(RepoAdapterError::PathInvalid); // ADS
    }
    let p = Path::new(configured);
    if !p.is_absolute() {
        return Err(RepoAdapterError::PathInvalid); // rejects bare "git" and other relative forms
    }
    let canon = std::fs::canonicalize(p).map_err(|_| RepoAdapterError::PathNotCanonical)?;
    if !canon.is_file() {
        return Err(RepoAdapterError::PathNotCanonical); // rejects directories
    }
    Ok(canon)
}

/// Canonicalize a Git-reported top-level path and compare it to the already-canonical configured root.
///
/// # Errors
/// [`RepoAdapterError::RootMismatch`] if the reported top-level cannot be canonicalized or differs.
pub fn same_canonical(
    reported_toplevel: &str,
    configured_canon: &Path,
) -> Result<(), RepoAdapterError> {
    let reported =
        std::fs::canonicalize(reported_toplevel).map_err(|_| RepoAdapterError::RootMismatch)?;
    if reported != configured_canon {
        return Err(RepoAdapterError::RootMismatch);
    }
    Ok(())
}
