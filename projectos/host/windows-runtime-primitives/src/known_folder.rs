//! THE trusted read-only Known Folder resolution primitives.
//!
//! CD-B4-INSTALLER-READINESS1A.
//!
//! Two explicitly named functions, one per approved folder. Deliberately NOT a folder-id vocabulary:
//! `KnownFolderAnchor` in `windows-host-activation-plan` is already the single anchor abstraction, and
//! adding an enum of resolvable folders here would make a second one. A caller cannot ask for an
//! arbitrary folder, pass a GUID, or redirect either root.
//!
//! Resolution is READ-ONLY. `KF_FLAG_DONT_VERIFY` is passed and the creation flag never is, so the OS
//! returns the registered location without creating, verifying or touching anything on disk.
//!
//! The value comes from `SHGetKnownFolderPath` only. No environment variable (`%ProgramData%`,
//! `%ProgramFiles%`), no current working directory, no repository path and no hardcoded literal is
//! consulted — those are exactly the roots the activation plan already classifies as forbidden.

use std::path::PathBuf;

/// Why a known folder could not be resolved. Fieldless: no `HRESULT` or OS text escapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum KnownFolderError {
    /// The OS did not return the folder.
    Unresolved,
    /// The OS returned something that is not a usable absolute path.
    Unusable,
}

/// Resolve the machine-wide application-data folder (`FOLDERID_ProgramData`).
///
/// # Errors
/// [`KnownFolderError`] if the OS does not return a usable absolute path.
#[cfg(windows)]
pub fn resolve_program_data() -> Result<PathBuf, KnownFolderError> {
    use windows::Win32::UI::Shell::FOLDERID_ProgramData;
    // The unsafe work is confined to `resolve`, which documents its own invariants.
    resolve(&FOLDERID_ProgramData)
}

/// Resolve the 64-bit program-files folder (`FOLDERID_ProgramFiles`).
///
/// # Errors
/// [`KnownFolderError`] if the OS does not return a usable absolute path.
#[cfg(windows)]
pub fn resolve_program_files() -> Result<PathBuf, KnownFolderError> {
    use windows::Win32::UI::Shell::FOLDERID_ProgramFiles;
    resolve(&FOLDERID_ProgramFiles)
}

/// The single resolution call. Private: the only reachable folders are the two named above.
#[cfg(windows)]
fn resolve(id: &windows::core::GUID) -> Result<PathBuf, KnownFolderError> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DONT_VERIFY};

    // SAFETY: `id` is a valid GUID reference for the call's duration. `KF_FLAG_DONT_VERIFY` asks for
    // the registered location WITHOUT creating or verifying it, and the creation flag is never passed,
    // so no filesystem effect occurs. On success the OS allocates a NUL-terminated wide string that we
    // must free exactly once with `CoTaskMemFree`; `to_string()` copies it before the free, and the
    // pointer is not used afterwards. A failed call returns an error and allocates nothing to free.
    let resolved = unsafe {
        let pwstr = SHGetKnownFolderPath(id, KF_FLAG_DONT_VERIFY, None)
            .map_err(|_| KnownFolderError::Unresolved)?;
        let text = pwstr.to_string();
        CoTaskMemFree(Some(pwstr.0.cast()));
        text
    };

    let path = PathBuf::from(resolved.map_err(|_| KnownFolderError::Unusable)?);
    // A relative or empty result is never usable as a machine-wide root.
    if !path.is_absolute() || path.as_os_str().is_empty() {
        return Err(KnownFolderError::Unusable);
    }
    Ok(path)
}

/// Non-Windows: there are no Known Folders, so both resolvers fail closed.
#[cfg(not(windows))]
pub fn resolve_program_data() -> Result<PathBuf, KnownFolderError> {
    Err(KnownFolderError::Unresolved)
}

/// Non-Windows: there are no Known Folders, so both resolvers fail closed.
#[cfg(not(windows))]
pub fn resolve_program_files() -> Result<PathBuf, KnownFolderError> {
    Err(KnownFolderError::Unresolved)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Resolution is read-only, so calling it in a test creates nothing. Both roots must come back as
    /// absolute existing directories that are NOT the repository, the working directory or TEMP.
    #[test]
    fn both_approved_roots_resolve_to_absolute_machine_locations() {
        for path in [
            resolve_program_data().expect("ProgramData"),
            resolve_program_files().expect("ProgramFiles"),
        ] {
            assert!(path.is_absolute(), "{path:?}");
            let text = path.to_string_lossy().to_lowercase();
            assert!(!text.contains("\\temp"), "resolved into TEMP: {path:?}");
            assert!(
                !text.contains("projectos"),
                "resolved into the repository: {path:?}"
            );
            assert_ne!(
                path,
                std::env::current_dir().expect("cwd"),
                "resolved to the working directory"
            );
        }
    }

    #[test]
    fn the_two_roots_are_distinct() {
        assert_ne!(
            resolve_program_data().expect("ProgramData"),
            resolve_program_files().expect("ProgramFiles")
        );
    }

    #[test]
    fn resolution_is_stable_and_creates_nothing() {
        let a = resolve_program_data().expect("first");
        let b = resolve_program_data().expect("second");
        assert_eq!(a, b);
        // Nothing under the resolved root is created by resolving it: the ProjectOS subtree must not
        // spring into existence merely because this test ran.
        assert!(!a.join("ProjectOS").join("host").exists());
    }
}
