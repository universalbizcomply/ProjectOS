//! Service-controlled (non-authoritative) repository-adapter configuration. It pins ONE verified,
//! absolute Git executable and the configured repository root, so production observation never depends
//! on an uncontrolled PATH search for `git`. The resolved executable path is retained privately and
//! never rendered in Debug or errors.

use std::path::{Path, PathBuf};

use crate::error::RepoAdapterError;
use crate::path;

/// A verified adapter configuration: an absolute canonical Git executable + a configured root. Not
/// authority; it only pins WHERE observation runs and WHICH binary runs it.
#[derive(Clone)]
pub struct RepositoryAdapterConfig {
    git_exe: PathBuf,
    root: String,
}

impl std::fmt::Debug for RepositoryAdapterConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never render the raw executable / root path.
        f.write_str("RepositoryAdapterConfig([REDACTED])")
    }
}

impl RepositoryAdapterConfig {
    /// Build a configuration from a trusted absolute Git executable path and a repository root. The
    /// executable is structurally validated and canonicalized to one absolute regular file; a relative
    /// `git`, a directory, a device/UNC path, or a traversal is refused.
    ///
    /// # Errors
    /// [`RepoAdapterError`] if the executable path is invalid / not canonicalizable / not a file.
    pub fn new(git_exe_path: &str, repository_root: &str) -> Result<Self, RepoAdapterError> {
        let git_exe = path::verify_executable(git_exe_path)?;
        Ok(Self {
            git_exe,
            root: repository_root.to_string(),
        })
    }

    /// The verified absolute Git executable (crate-internal; never rendered).
    pub(crate) fn git_exe(&self) -> &Path {
        &self.git_exe
    }

    /// The configured repository root.
    #[must_use]
    pub fn root(&self) -> &str {
        &self.root
    }
}
