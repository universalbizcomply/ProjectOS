//! The handle-owned root custody type.
//!
//! Custody trusts the OPENED OBJECT, not a pathname: the directory handle is retained for the lifetime
//! of the value, identity is captured from that handle, and revalidation checks BOTH the held object
//! AND that the original pathname still resolves to the same object. A path whose handle remains valid
//! is never accepted if the pathname now denotes a different object.

use std::fmt;
use std::path::{Path, PathBuf};

use projectos_host_persistence::validate_local_root;

use crate::error::RootCustodyError;
use crate::identity::RootIdentity;
use crate::windows::{self, ATTR_DIRECTORY, ATTR_REPARSE_POINT};

#[cfg(windows)]
type OwnedRootHandle = std::os::windows::io::OwnedHandle;
#[cfg(not(windows))]
type OwnedRootHandle = crate::windows::UnsupportedHandle;

/// Custody of one explicitly trusted, absolute Windows directory root.
///
/// Not `Clone`, not `Copy`, not serialisable; exposes no raw handle. The handle is created exactly once
/// and closed exactly once when this value drops (RAII via the standard owned-handle type).
pub struct WindowsRootCustody {
    handle: OwnedRootHandle,
    identity: RootIdentity,
    canonical: PathBuf,
    original: PathBuf,
}

impl WindowsRootCustody {
    /// Open an explicitly supplied ABSOLUTE existing directory as a custody root, retaining its handle.
    /// The root is never created, and a reparse point is refused rather than followed.
    ///
    /// # Errors
    /// [`RootCustodyError`] classifying the refusal (syntax, missing, not-a-directory, reparse, or a
    /// Windows API failure).
    pub fn open(path: &Path) -> Result<Self, RootCustodyError> {
        let text = path
            .to_str()
            .ok_or(RootCustodyError::UnsupportedNamespace)?;
        classify_syntax(text)?;

        // Any failure below drops the acquired handle, closing it (no partial-open leak).
        let handle = windows::open_directory_handle(path)?;
        let (identity, attributes) = windows::query_identity(&handle)?;
        if attributes & ATTR_REPARSE_POINT != 0 {
            return Err(RootCustodyError::ReparsePointRefused);
        }
        if attributes & ATTR_DIRECTORY == 0 {
            return Err(RootCustodyError::NotADirectory);
        }
        let canonical = windows::final_path(&handle)?;
        Ok(Self {
            handle,
            identity,
            canonical,
            original: path.to_path_buf(),
        })
    }

    /// The captured, immutable, handle-derived identity (values are redacted in `Debug`).
    #[must_use]
    pub fn identity(&self) -> RootIdentity {
        self.identity
    }

    /// The canonical root path derived FROM the held handle at open time.
    #[must_use]
    pub fn canonical_path(&self) -> &Path {
        &self.canonical
    }

    /// Confirm the held handle STILL denotes the original trusted root, and that the original pathname
    /// still resolves to that same object. Detects handle invalidation, type change, reparse
    /// substitution, identity drift, and path replacement/redirection.
    ///
    /// # Errors
    /// [`RootCustodyError`] classifying the first detected divergence. A failure never replaces the
    /// held handle and never reopens custody automatically.
    pub fn revalidate(&self) -> Result<(), RootCustodyError> {
        // 1) The held object itself.
        let (held_identity, held_attributes) = windows::query_identity(&self.handle)?;
        if held_attributes & ATTR_REPARSE_POINT != 0 {
            return Err(RootCustodyError::ReparsePointRefused);
        }
        if held_attributes & ATTR_DIRECTORY == 0 {
            return Err(RootCustodyError::NotADirectory);
        }
        if !held_identity.same_object(&self.identity) {
            return Err(RootCustodyError::IdentityMismatch);
        }

        // 2) The ORIGINAL pathname, resolved independently. A still-valid held handle must NOT make a
        //    replacement object at the same pathname acceptable.
        let fresh = windows::open_directory_handle(&self.original)?; // NotFound = path missing
        let (fresh_identity, fresh_attributes) = windows::query_identity(&fresh)?;
        if fresh_attributes & ATTR_REPARSE_POINT != 0 {
            return Err(RootCustodyError::ReparsePointRefused);
        }
        if fresh_attributes & ATTR_DIRECTORY == 0 {
            return Err(RootCustodyError::NotADirectory);
        }
        if !fresh_identity.same_object(&self.identity) {
            return Err(RootCustodyError::PathReplaced);
        }
        Ok(())
    }
}

impl fmt::Debug for WindowsRootCustody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // REDACTED: no path, no identity values, no handle.
        f.write_str("WindowsRootCustody(redacted)")
    }
}

/// Classify the root path's syntax before touching the filesystem. Reuses the ACCEPTED
/// `validate_local_root` rule as the authoritative gate, adding only finer error classification.
fn classify_syntax(text: &str) -> Result<(), RootCustodyError> {
    if text.is_empty() {
        return Err(RootCustodyError::EmptyPath);
    }
    if text.starts_with("\\\\") || text.contains('/') {
        // UNC (`\\server\share`), device namespace (`\\?\`, `\\.\`), or forward-slash/URL form.
        return Err(RootCustodyError::UnsupportedNamespace);
    }
    let bytes = text.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err(RootCustodyError::RelativePath);
    }
    for segment in text[3..].split('\\').filter(|s| !s.is_empty()) {
        if segment == "." || segment == ".." || segment.contains(':') {
            // Traversal or alternate-data-stream interpretation.
            return Err(RootCustodyError::UnsupportedNamespace);
        }
    }
    // Authoritative accepted rule (not duplicated here).
    validate_local_root(text).map_err(|_| RootCustodyError::UnsupportedNamespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn syntax_classification() {
        assert_eq!(
            classify_syntax("").unwrap_err(),
            RootCustodyError::EmptyPath
        );
        assert_eq!(
            classify_syntax("relative\\path").unwrap_err(),
            RootCustodyError::RelativePath
        );
        assert_eq!(
            classify_syntax("\\\\server\\share").unwrap_err(),
            RootCustodyError::UnsupportedNamespace
        );
        assert_eq!(
            classify_syntax("\\\\?\\C:\\x").unwrap_err(),
            RootCustodyError::UnsupportedNamespace
        );
        assert_eq!(
            classify_syntax("C:/forward/slash").unwrap_err(),
            RootCustodyError::UnsupportedNamespace
        );
        assert_eq!(
            classify_syntax("C:\\a\\..\\b").unwrap_err(),
            RootCustodyError::UnsupportedNamespace
        );
        assert_eq!(
            classify_syntax("C:\\a\\stream:ads").unwrap_err(),
            RootCustodyError::UnsupportedNamespace
        );
        assert!(classify_syntax("C:\\Windows\\Temp\\x").is_ok());
    }
}
