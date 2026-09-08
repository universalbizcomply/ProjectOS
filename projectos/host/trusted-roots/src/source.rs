//! WHERE EACH ROOT'S AUTHORITY COMES FROM — the two sources, and the seal that closes the set.
//!
//! ## Why these are traits at all, and why they are SEALED
//!
//! The resolution algorithms have to be provable against disposable directories: a proof that only
//! runs against the live `ProjectOS` ProgramData subtree and a real installed project is a proof
//! nobody can run, and running it would mutate the very boundary §10E may not touch. So each
//! algorithm takes its starting fact through a named source.
//!
//! A trait a downstream crate could implement would be exactly the defect this phase exists to
//! prevent — "no caller path authority" is not worth much if a caller can write four lines and
//! become the authority. Both traits therefore have a PRIVATE supertrait. The implementor set is
//! closed at compile time to the ones in this file, and the fixture ones do not exist in a default
//! build.
//!
//! ## What a source may and may not do
//!
//! A source produces ONE starting fact and nothing else. It does not canonicalise, it does not open
//! a handle, it does not decide that a path is trusted, and it never returns a sealed value —
//! validating and sealing is the resolver's job, exactly as it is in the Control Centre's
//! `GovernedSystemRootSource`. A source that answered wrongly still cannot produce a trusted root,
//! because every check that makes one trusted happens after it.

use std::path::PathBuf;

use crate::refusal::TrustedRootRefusal;

/// The private supertrait. Unnameable outside this crate, so the implementor set is closed.
mod sealed {
    pub trait Sealed {}
}

// -------------------------------------------------------------------------------------------------
// A1 — THE INSTALLATION ANCHOR
// -------------------------------------------------------------------------------------------------

/// The machine-wide installation anchor the Host state root is composed beneath.
pub trait InstallationAnchorSource: sealed::Sealed {
    /// The anchor directory, or the refusal that stops resolution.
    ///
    /// # Errors
    /// [`TrustedRootRefusal::AnchorUnresolved`] when the anchor cannot be established, or
    /// [`TrustedRootRefusal::PlatformUnsupported`] where no Known Folder exists.
    fn anchor(&self) -> Result<PathBuf, TrustedRootRefusal>;
}

/// THE PRODUCTION ANCHOR: the registered ProgramData location, read through the approved primitive.
///
/// ZERO-SIZED ON PURPOSE. It carries no path and takes no argument, so there is no field for a
/// caller to set and no constructor for a caller to steer. `SHGetKnownFolderPath` is asked with
/// `KF_FLAG_DONT_VERIFY` and never the creation flag, so the answer is READ and nothing on disk is
/// created, verified or touched.
///
/// THE ENVIRONMENT IS NEVER CONSULTED. The `%ProgramData%` variable is something the process's
/// launcher chooses, which is precisely why it is not an authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApprovedKnownFolderAnchor;

impl sealed::Sealed for ApprovedKnownFolderAnchor {}

impl InstallationAnchorSource for ApprovedKnownFolderAnchor {
    #[cfg(windows)]
    fn anchor(&self) -> Result<PathBuf, TrustedRootRefusal> {
        projectos_windows_runtime_primitives::known_folder::resolve_program_data()
            .map_err(|_| TrustedRootRefusal::AnchorUnresolved)
    }

    #[cfg(not(windows))]
    fn anchor(&self) -> Result<PathBuf, TrustedRootRefusal> {
        Err(TrustedRootRefusal::PlatformUnsupported)
    }
}

/// FIXTURE ONLY: a disposable directory the test already owns, standing in for the resolved anchor.
///
/// Compiled for this crate's tests and the non-default `test-fixtures` graph, so no shipped build
/// can reach it. Substituting the ANCHOR is the smallest possible substitution: every segment joined
/// beneath it, every custody open, every reparse refusal and every identity capture below is the
/// production code path, unmodified.
#[cfg(any(test, feature = "test-fixtures"))]
#[derive(Debug, Clone)]
pub struct FixtureInstallationAnchor {
    root: PathBuf,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl FixtureInstallationAnchor {
    /// Treat a disposable directory as the resolved anchor.
    #[must_use]
    pub fn new(owned_root: &std::path::Path) -> Self {
        Self {
            root: owned_root.to_path_buf(),
        }
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl sealed::Sealed for FixtureInstallationAnchor {}

#[cfg(any(test, feature = "test-fixtures"))]
impl InstallationAnchorSource for FixtureInstallationAnchor {
    fn anchor(&self) -> Result<PathBuf, TrustedRootRefusal> {
        Ok(self.root.clone())
    }
}

// -------------------------------------------------------------------------------------------------
// A2 — THE REGISTERED PROJECT
// -------------------------------------------------------------------------------------------------

/// The authority that maps a project id to the ONE repository root this installation may govern.
pub trait RegisteredProjectSource: sealed::Sealed {
    /// The registered repository root for `project_id`.
    ///
    /// # Errors
    /// [`TrustedRootRefusal::RegistryRefused`] when the registry itself refused, or
    /// [`TrustedRootRefusal::ProjectNotRegistered`] when the registry is valid and does not carry
    /// this project.
    fn repository_root(&self, project_id: &str) -> Result<PathBuf, TrustedRootRefusal>;
}

/// THE PRODUCTION PROJECT AUTHORITY: the canonical installed-project registry.
///
/// ZERO-SIZED, exactly as the anchor is. The registry's whole input surface is its own canonical
/// ProgramData path, so there is nothing here for a caller to point somewhere else — a registry
/// injected through argv, an environment variable, a manifest field or the governed repository
/// itself is not refused, it is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanonicalProjectRegistry;

impl sealed::Sealed for CanonicalProjectRegistry {}

impl RegisteredProjectSource for CanonicalProjectRegistry {
    fn repository_root(&self, project_id: &str) -> Result<PathBuf, TrustedRootRefusal> {
        let registry = projectos_project_registry::read_canonical_registry(
            &projectos_project_registry::RealRegistryFacts,
        )
        .map_err(TrustedRootRefusal::RegistryRefused)?;
        select(&registry, project_id)
    }
}

/// FIXTURE ONLY: a registry DOCUMENT the test owns, validated by the real validator.
///
/// THE ONLY SUBSTITUTION IS WHERE THE BYTES CAME FROM. The document is handed to the accepted
/// `validate_registry_bytes` together with `RealRegistryFacts`, so every rule that decides whether a
/// registered root is usable — absolute, no traversal, an existing directory, a `.git` marker, no
/// reparse point, a readable `.projectops/project-config.json`, and a project id that AGREES with
/// the entry — runs for real against the disposable tree the test built. A fixture that returned a
/// path directly would have proven the selection and skipped the attestation.
#[cfg(any(test, feature = "test-fixtures"))]
#[derive(Debug, Clone)]
pub struct FixtureProjectRegistry {
    document: Vec<u8>,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl FixtureProjectRegistry {
    /// Treat these bytes as the registry document at the canonical location.
    #[must_use]
    pub fn new(document: Vec<u8>) -> Self {
        Self { document }
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl sealed::Sealed for FixtureProjectRegistry {}

#[cfg(any(test, feature = "test-fixtures"))]
impl RegisteredProjectSource for FixtureProjectRegistry {
    fn repository_root(&self, project_id: &str) -> Result<PathBuf, TrustedRootRefusal> {
        let registry = projectos_project_registry::validate_registry_bytes(
            &self.document,
            &projectos_project_registry::RealRegistryFacts,
        )
        .map_err(TrustedRootRefusal::RegistryRefused)?;
        select(&registry, project_id)
    }
}

/// The ONE selection step, shared by both project sources.
///
/// IT SELECTS, IT DOES NOT SEARCH. A registry that does not carry this exact id refuses; there is no
/// nearest match, no first entry, no default project and no scan.
fn select(
    registry: &projectos_project_registry::ValidatedProjectRegistry,
    project_id: &str,
) -> Result<PathBuf, TrustedRootRefusal> {
    registry
        .repository_for(project_id)
        .map(std::path::Path::to_path_buf)
        .ok_or(TrustedRootRefusal::ProjectNotRegistered)
}
