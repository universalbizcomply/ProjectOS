//! Path binding: a production runtime/artefact path must be absolute and confined beneath the
//! approved installation root, with no traversal, no PATH lookup, and no caller-supplied override.
//! Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use std::path::{Component, Path, PathBuf};

/// Reject a bare-name / relative runtime that would resolve via PATH or the working directory.
/// A production runtime reference must be an absolute path (Windows: has a prefix + root).
pub fn is_absolute_runtime(path: &Path) -> bool {
    path.is_absolute()
}

/// True when `candidate`, resolved lexically (no filesystem access), stays beneath `root` and
/// contains no `..` / `.` traversal components. Lexical-only so it is deterministic and testable.
pub fn is_beneath_root(root: &Path, candidate: &Path) -> bool {
    let root_norm = match lexical_normalise(root) {
        Some(p) => p,
        None => return false,
    };
    let cand_norm = match lexical_normalise(candidate) {
        Some(p) => p,
        None => return false,
    };
    cand_norm.starts_with(&root_norm) && cand_norm != root_norm
}

/// Lexically normalise a path, rejecting any `..` component (returns None) so traversal cannot
/// escape the install root. `.` components are dropped. No filesystem access.
pub fn lexical_normalise(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => return None, // `..` is never permitted in a bound path
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// Join a manifest-declared *relative* path beneath the install root, rejecting absolute or
/// traversing relative paths. Returns the bound absolute path, or None if unsafe.
pub fn bind_relative(root: &Path, relative: &str) -> Option<PathBuf> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return None; // manifest relativePath must be relative
    }
    // Reject traversal in the relative segment before joining.
    lexical_normalise(rel)?;
    let joined = root.join(rel);
    if is_beneath_root(root, &joined) {
        Some(joined)
    } else {
        None
    }
}
