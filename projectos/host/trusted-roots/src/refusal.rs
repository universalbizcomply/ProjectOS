//! Why a trusted root could not be established. Every variant REFUSES.
//!
//! THERE IS NO RECOVERABLE VARIANT, and that is the point of listing them separately. Naming the
//! first failed check tells an administrator what to repair; none of the names is an invitation to
//! look somewhere else, because there is nowhere else to look — no working directory, no
//! environment variable, no repository guess, no temporary directory, no "first matching project"
//! and no default project appears anywhere in this crate, as an input or as a fallback.

use projectos_host_windows_root_custody::RootCustodyError;
use projectos_project_registry::RegistryRefusal;

/// Why a trusted root was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TrustedRootRefusal {
    /// This platform has no Known Folders and no handle-owned custody, so no root can be trusted.
    ///
    /// FAIL CLOSED, NEVER EMULATED. A non-Windows build does not get a plausible root; it gets none.
    PlatformUnsupported,

    /// The installation anchor itself could not be resolved, so no canonical location exists.
    ///
    /// UNRESOLVABLE ROOT in the phase's vocabulary. The OS did not return the registered ProgramData
    /// location, or returned something that is not a usable absolute path.
    AnchorUnresolved,

    /// The root does not exist.
    ///
    /// MISSING. An absent Host state root means the Host is not installed the way it assumes, and
    /// this crate creates nothing: manufacturing the directory chain would be inventing the very
    /// installation truth the root is supposed to carry.
    RootMissing,

    /// The path exists but is not a directory.
    RootNotADirectory,

    /// The path is unusable as a trusted root on syntax alone, before the filesystem is touched.
    ///
    /// UNSAFE PATH. Empty, relative, UNC (`\\server\share`), device namespace (`\\?\`, `\\.\`),
    /// forward-slash form, a `.`/`..` traversal component, or an alternate-data-stream `:`. The
    /// classification is the accepted custody primitive's, not a second rule written here.
    UnsafePath,

    /// The root, or an ancestor this crate walks, is a symlink, junction or other reparse point.
    ///
    /// REFUSED RATHER THAN FOLLOWED. A root that whoever can write a parent directory may re-aim is
    /// not a fixed location, and following it would let the thing being governed choose its governor.
    ReparsePointRefused,

    /// The object at the root's pathname is no longer the object custody captured.
    ///
    /// MISMATCH. Replacement, redirection or identity drift detected by the custody primitive's
    /// two-sided revalidation — the held handle AND the original pathname must still denote one
    /// object.
    RootIdentityDrift,

    /// The object opened does not live at the path that was composed.
    ///
    /// MISMATCH, and the one that catches a reparse point at a level the final-component check
    /// cannot see. `FILE_FLAG_OPEN_REPARSE_POINT` inspects only the last component, so a junction
    /// substituted for an ANCESTOR is traversed silently — including one swapped in during the walk,
    /// after that ancestor's own check passed. Windows still reports where the object actually
    /// lives, and if a junction was followed that is not the composed path. Testing the outcome
    /// rather than the timing is what makes this decisive rather than a narrower race.
    RootRedirected,

    /// The OS refused the root for a reason that is none of the above.
    ///
    /// Deliberately opaque: no `HRESULT`, no OS text and no path escapes into a refusal value.
    RootUnresolvable,

    /// THE CANONICAL PROJECT REGISTRY REFUSED, and this is what it said.
    ///
    /// CARRIED WHOLE rather than flattened into "the registry refused". An administrator meeting a
    /// governed project that will not resolve needs to know whether the registry is absent, the
    /// entry names a root that no longer exists, the root lost its `.git` marker, or the registry
    /// and the project's own `.projectops/project-config.json` disagree about identity — those are
    /// four different repairs.
    RegistryRefused(RegistryRefusal),

    /// The registry is valid and this project id is not in it.
    ///
    /// UNREGISTERED. Distinct from [`TrustedRootRefusal::RegistryRefused`] on purpose: the registry
    /// answered correctly, and the answer was "not this installation's business". There is no scan
    /// for a project that looks close enough.
    ProjectNotRegistered,
}

/// Map the accepted custody primitive's classification onto this crate's vocabulary.
///
/// ONE MAPPING, IN ONE PLACE. Both roots go through custody, and letting each of them classify
/// custody failures separately is how two callers come to disagree about what a reparse point means.
#[must_use]
pub(crate) fn from_custody(e: RootCustodyError) -> TrustedRootRefusal {
    match e {
        RootCustodyError::UnsupportedPlatform => TrustedRootRefusal::PlatformUnsupported,
        RootCustodyError::EmptyPath
        | RootCustodyError::RelativePath
        | RootCustodyError::UnsupportedNamespace => TrustedRootRefusal::UnsafePath,
        RootCustodyError::NotFound => TrustedRootRefusal::RootMissing,
        RootCustodyError::NotADirectory | RootCustodyError::NotAFile => {
            TrustedRootRefusal::RootNotADirectory
        }
        RootCustodyError::ReparsePointRefused => TrustedRootRefusal::ReparsePointRefused,
        RootCustodyError::HandleInvalid
        | RootCustodyError::IdentityMismatch
        | RootCustodyError::PathReplaced => TrustedRootRefusal::RootIdentityDrift,
        _ => TrustedRootRefusal::RootUnresolvable,
    }
}
