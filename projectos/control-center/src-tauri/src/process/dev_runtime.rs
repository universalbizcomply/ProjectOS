//! Development Node runtime resolution (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! The old code called `Command::new("node")`, letting Windows resolve the executable through the
//! standard search order — which includes the CURRENT DIRECTORY. A `node.exe` dropped into the cwd
//! would have been executed. `SearchPathW` with a null path has the same defect, so it is NOT used.
//!
//! Instead PATH is read as DATA and filtered:
//!  - an EMPTY PATH entry means "current directory" on Windows → discarded;
//!  - relative entries → discarded (they resolve against the cwd);
//!  - UNC/network and device-namespace paths → rejected;
//!  - only absolute local directories are inspected, in PATH order, first valid match wins.
//!
//! The resolution logic is pure and platform-independent so it is testable everywhere. Only the
//! filesystem probes (`exists`/`is_file`/`canonicalize`) touch the OS, and they are injected via a
//! port so tests are deterministic.
//!
//! BINDING: the result is `DEVELOPMENT_UNVERIFIED`. Path resolution is NOT code identity. This
//! claims nothing about code signing, publisher, protected installation, or production runtime
//! identity — those belong to PACKAGED-SIDECAR-IDENTITY.

use std::path::{Component, Path, PathBuf};

use super::errors::ProcessError;

/// The only executable name this resolver will ever accept.
pub(crate) const NODE_EXE: &str = "node.exe";

/// The development Git executable. Resolved by the HOST and handed to the daemon as one absolute
/// path, because the daemon deliberately has no PATH of its own and must never search for tools.
pub(crate) const GIT_EXE: &str = "git.exe";
/// Development-only absolute override.
pub(crate) const DEV_NODE_OVERRIDE_VAR: &str = "PROJECTOS_DEV_NODE";

/// Filesystem probes, injected so resolution is deterministically testable.
pub(crate) trait RuntimeFs {
    fn is_file(&self, p: &Path) -> bool;
    /// Canonical final path (resolves links). `None` when it cannot be resolved.
    fn canonicalize(&self, p: &Path) -> Option<PathBuf>;
}

/// Real filesystem.
pub(crate) struct RealRuntimeFs;
impl RuntimeFs for RealRuntimeFs {
    fn is_file(&self, p: &Path) -> bool {
        p.is_file()
    }
    fn canonicalize(&self, p: &Path) -> Option<PathBuf> {
        std::fs::canonicalize(p).ok()
    }
}

/// Reject UNC/network shares and the device namespace. `std::fs::canonicalize` on Windows returns a
/// `\\?\` verbatim prefix, which is expected and stripped for the check — a `\\?\UNC\...` (network)
/// or a raw `\\server\share` is not.
pub(crate) fn is_local_absolute(p: &Path) -> bool {
    let s = p.to_string_lossy();
    let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
    // `\\?\UNC\server\share`, `\\server\share`, `//server/share` → network. `\\.\PIPE\x` → device.
    if stripped.starts_with(r"UNC\") || stripped.starts_with(r"\\") || stripped.starts_with("//") {
        return false;
    }
    if stripped.starts_with(r"\\.\") || stripped.starts_with(r"\\?\") {
        return false;
    }
    // Require a drive-letter prefix: `X:\...`
    let b = stripped.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' {
        return false;
    }
    matches!(b[2], b'\\' | b'/')
}

/// `std::fs::canonicalize` returns a Windows VERBATIM path (`\\?\C:\...`). That prefix is correct for
/// Win32 but breaks tools that parse paths themselves: Node given `\\?\C:\…\host.mjs` fails with
/// `EISDIR: illegal operation on a directory, lstat 'C:'`. Strip it for ordinary local drive paths so
/// the child receives a plain absolute path.
///
/// UNC verbatim paths (`\\?\UNC\…`) are deliberately NOT rewritten — they are rejected elsewhere.
pub(crate) fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    match s.strip_prefix(r"\\?\") {
        // Only a plain drive path (`C:\…`) may be de-verbatimised.
        Some(rest)
            if rest.len() >= 3
                && rest.as_bytes()[0].is_ascii_alphabetic()
                && rest.as_bytes()[1] == b':'
                && matches!(rest.as_bytes()[2], b'\\' | b'/') =>
        {
            PathBuf::from(rest)
        }
        _ => p,
    }
}

/// True when the path is absolute AND contains no traversal component.
pub(crate) fn is_clean_absolute(p: &Path) -> bool {
    p.is_absolute() && !p.components().any(|c| matches!(c, Component::ParentDir))
}

/// Validate a fully-resolved candidate: local absolute, regular file, canonical, final name `exe`.
///
/// The executable name is a parameter so Git reuses these guards EXACTLY rather than getting a
/// second, subtly different resolver. It is not a generic external-tool framework: the only callers
/// pass one of two fixed constants.
pub(crate) fn accept_candidate_named(
    fs: &dyn RuntimeFs,
    candidate: &Path,
    exe: &str,
) -> Option<PathBuf> {
    if !fs.is_file(candidate) {
        return None;
    }
    let canonical = strip_verbatim(fs.canonicalize(candidate)?);
    if !is_local_absolute(&canonical) {
        return None; // canonical target escaped to a network/device location
    }
    let name_ok = canonical
        .file_name()
        .and_then(|f| f.to_str())
        .map(|f| f.eq_ignore_ascii_case(exe))
        .unwrap_or(false);
    if !name_ok {
        return None;
    }
    Some(canonical)
}

/// `accept_candidate` for the Node runtime, preserving the original behaviour exactly.
fn accept_candidate(fs: &dyn RuntimeFs, candidate: &Path) -> Option<PathBuf> {
    accept_candidate_named(fs, candidate, NODE_EXE)
}

/// Resolve the development Node runtime from an explicit override.
pub(crate) fn resolve_override(fs: &dyn RuntimeFs, raw: &str) -> Result<PathBuf, ProcessError> {
    let p = Path::new(raw);
    if raw.is_empty() || !is_clean_absolute(p) || !is_local_absolute(p) {
        return Err(ProcessError::DevRuntimeOverrideInvalid);
    }
    let name_ok = p
        .file_name()
        .and_then(|f| f.to_str())
        .map(|f| f.eq_ignore_ascii_case(NODE_EXE))
        .unwrap_or(false);
    if !name_ok {
        return Err(ProcessError::DevRuntimeOverrideInvalid);
    }
    accept_candidate(fs, p).ok_or(ProcessError::DevRuntimeOverrideInvalid)
}

/// Resolve the development Node runtime from PATH entries, treating PATH strictly as data.
///
/// `entries` comes from `std::env::split_paths`, which already splits on `;` and strips quotes.
/// Deterministic rule: **the first absolute local directory containing a valid `node.exe` wins** —
/// mirroring what the developer's own shell would run, with cwd/empty/relative excluded.
pub(crate) fn resolve_from_path_entries<I, P>(
    fs: &dyn RuntimeFs,
    entries: I,
) -> Result<PathBuf, ProcessError>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    resolve_named_from_path_entries(fs, entries, NODE_EXE, ProcessError::DevRuntimeNotFound)
}

/// The shared PATH-as-data search. Same rules for every caller: no empty (current-directory) entry,
/// no relative directory, no UNC/device path, no shell, no `where.exe`, no `SearchPathW`, and the
/// deterministic first valid match wins.
fn resolve_named_from_path_entries<I, P>(
    fs: &dyn RuntimeFs,
    entries: I,
    exe: &str,
    missing: ProcessError,
) -> Result<PathBuf, ProcessError>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    for dir in entries {
        let dir = dir.as_ref();
        // EMPTY entry == current directory on Windows. Never search it.
        if dir.as_os_str().is_empty() {
            continue;
        }
        // Relative entries resolve against the cwd. Never search them.
        if !is_clean_absolute(dir) {
            continue;
        }
        // UNC / network / device namespace.
        if !is_local_absolute(dir) {
            continue;
        }
        if let Some(found) = accept_candidate_named(fs, &dir.join(exe), exe) {
            return Ok(found); // deterministic first match
        }
    }
    Err(missing)
}

/// Resolve the development Git executable from the HOST PATH, treating PATH strictly as data.
///
/// Git is needed because the closure gate derives its facts (head, cleanliness, reconciliation,
/// ancestry) by running git. The DAEMON has no PATH — deliberately, so it cannot inherit developer
/// tokens — so the host resolves one absolute path here and passes only that.
///
/// This is development tool resolution, NOT production identity: resolving proves only that a file
/// named git.exe exists at a local absolute path. It asserts nothing about signature or trust.
pub(crate) fn resolve_development_git(fs: &dyn RuntimeFs) -> Result<PathBuf, ProcessError> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    resolve_named_from_path_entries(
        fs,
        std::env::split_paths(&path),
        GIT_EXE,
        ProcessError::DevGitNotFound,
    )
}

/// Full development resolution: explicit override first, else the sanitized PATH search.
///
/// Never consults the current directory, never invokes a shell, `where.exe`, `cmd.exe`, PowerShell,
/// or `SearchPathW`. There is NO fallback after a failure.
pub(crate) fn resolve_development_node(fs: &dyn RuntimeFs) -> Result<PathBuf, ProcessError> {
    if let Some(raw) = std::env::var_os(DEV_NODE_OVERRIDE_VAR) {
        // An override that is set but invalid is a hard failure — it must never silently fall back
        // to PATH, or a typo would quietly change which runtime runs.
        return resolve_override(fs, &raw.to_string_lossy());
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    resolve_from_path_entries(fs, std::env::split_paths(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Deterministic fake: a set of paths that are "regular files"; canonicalize is identity.
    struct FakeFs {
        files: HashSet<PathBuf>,
    }
    impl FakeFs {
        fn with(paths: &[&str]) -> FakeFs {
            FakeFs {
                files: paths.iter().map(PathBuf::from).collect(),
            }
        }
    }
    impl RuntimeFs for FakeFs {
        fn is_file(&self, p: &Path) -> bool {
            self.files.contains(p)
        }
        fn canonicalize(&self, p: &Path) -> Option<PathBuf> {
            self.files.contains(p).then(|| p.to_path_buf())
        }
    }

    #[test]
    fn empty_path_entry_is_never_searched() {
        // An empty entry means the CURRENT DIRECTORY on Windows.
        let fs = FakeFs::with(&["node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new("")]);
        assert_eq!(r, Err(ProcessError::DevRuntimeNotFound));
    }

    #[test]
    fn relative_path_entry_is_discarded() {
        let fs = FakeFs::with(&[r"tools\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new("tools")]);
        assert_eq!(r, Err(ProcessError::DevRuntimeNotFound));
    }

    #[test]
    fn current_directory_is_never_searched() {
        let fs = FakeFs::with(&[r".\node.exe", r"node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new("."), Path::new("")]);
        assert_eq!(r, Err(ProcessError::DevRuntimeNotFound));
    }

    #[test]
    fn unc_path_entry_is_rejected() {
        let fs = FakeFs::with(&[r"\\evil\share\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new(r"\\evil\share")]);
        assert_eq!(r, Err(ProcessError::DevRuntimeNotFound));
    }

    #[test]
    fn absolute_local_entry_is_accepted() {
        let fs = FakeFs::with(&[r"C:\tools\node\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new(r"C:\tools\node")]).unwrap();
        assert_eq!(r, PathBuf::from(r"C:\tools\node\node.exe"));
    }

    #[test]
    fn first_valid_path_entry_wins_deterministically() {
        let fs = FakeFs::with(&[r"C:\a\node.exe", r"C:\b\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new(r"C:\a"), Path::new(r"C:\b")]).unwrap();
        assert_eq!(r, PathBuf::from(r"C:\a\node.exe"));
        // reversed order → the other one, proving order (not chance) decides
        let r2 = resolve_from_path_entries(&fs, [Path::new(r"C:\b"), Path::new(r"C:\a")]).unwrap();
        assert_eq!(r2, PathBuf::from(r"C:\b\node.exe"));
    }

    #[test]
    fn entries_without_node_are_skipped_not_fatal() {
        let fs = FakeFs::with(&[r"C:\b\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new(r"C:\a"), Path::new(r"C:\b")]).unwrap();
        assert_eq!(r, PathBuf::from(r"C:\b\node.exe"));
    }

    #[test]
    fn missing_node_everywhere_is_typed() {
        let fs = FakeFs::with(&[]);
        assert_eq!(
            resolve_from_path_entries(&fs, [Path::new(r"C:\a")]),
            Err(ProcessError::DevRuntimeNotFound)
        );
    }

    #[test]
    fn traversal_entry_is_discarded() {
        let fs = FakeFs::with(&[r"C:\a\..\b\node.exe"]);
        let r = resolve_from_path_entries(&fs, [Path::new(r"C:\a\..\b")]);
        assert_eq!(r, Err(ProcessError::DevRuntimeNotFound));
    }

    // ---- override ---------------------------------------------------------------------------------

    #[test]
    fn valid_absolute_override_accepted() {
        let fs = FakeFs::with(&[r"C:\tools\node\node.exe"]);
        let r = resolve_override(&fs, r"C:\tools\node\node.exe").unwrap();
        assert_eq!(r, PathBuf::from(r"C:\tools\node\node.exe"));
    }

    #[test]
    fn relative_override_rejected() {
        let fs = FakeFs::with(&[r"node.exe"]);
        assert_eq!(
            resolve_override(&fs, "node.exe"),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    #[test]
    fn empty_override_rejected() {
        let fs = FakeFs::with(&[]);
        assert_eq!(
            resolve_override(&fs, ""),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    #[test]
    fn missing_override_file_rejected() {
        let fs = FakeFs::with(&[]);
        assert_eq!(
            resolve_override(&fs, r"C:\tools\node\node.exe"),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    #[test]
    fn wrong_filename_override_rejected() {
        let fs = FakeFs::with(&[r"C:\windows\system32\cmd.exe"]);
        assert_eq!(
            resolve_override(&fs, r"C:\windows\system32\cmd.exe"),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    #[test]
    fn unc_override_rejected() {
        let fs = FakeFs::with(&[r"\\evil\share\node.exe"]);
        assert_eq!(
            resolve_override(&fs, r"\\evil\share\node.exe"),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    #[test]
    fn directory_override_rejected() {
        // A directory is not a regular file → FakeFs has no such file entry.
        let fs = FakeFs::with(&[]);
        assert_eq!(
            resolve_override(&fs, r"C:\tools\node"),
            Err(ProcessError::DevRuntimeOverrideInvalid)
        );
    }

    // ---- local/network classification -------------------------------------------------------------

    #[test]
    fn verbatim_prefix_is_stripped_for_local_drive_paths() {
        // REGRESSION (found by the real-sidecar proof): `std::fs::canonicalize` returns a verbatim
        // path, and Node handed `\\?\C:\...\host.mjs` dies with
        // `EISDIR: illegal operation on a directory, lstat 'C:'`.
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\C:\dev\host.mjs")),
            PathBuf::from(r"C:\dev\host.mjs")
        );
        // Plain paths are untouched.
        assert_eq!(
            strip_verbatim(PathBuf::from(r"C:\dev\host.mjs")),
            PathBuf::from(r"C:\dev\host.mjs")
        );
        // UNC verbatim is NOT rewritten — it is rejected elsewhere.
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\?\UNC\server\share\x")
        );
    }

    #[test]
    fn local_absolute_classification() {
        assert!(is_local_absolute(Path::new(r"C:\tools\node.exe")));
        assert!(is_local_absolute(Path::new(r"\\?\C:\tools\node.exe"))); // canonicalize prefix
        assert!(!is_local_absolute(Path::new(r"\\server\share\node.exe")));
        assert!(!is_local_absolute(Path::new(
            r"\\?\UNC\server\share\node.exe"
        )));
        assert!(!is_local_absolute(Path::new(r"\\.\PIPE\evil")));
        assert!(!is_local_absolute(Path::new("//server/share/node.exe")));
        assert!(!is_local_absolute(Path::new(r"tools\node.exe")));
    }

    // ---- Git resolution (Option C) -----------------------------------------------------------
    // Git gets the SAME guards as Node because it reuses the same search, not a parallel one.

    #[test]
    fn git1_valid_absolute_local_git_resolves() {
        let fs = FakeFs::with(&[r"C:\tools\git\cmd\git.exe"]);
        assert_eq!(
            resolve_named_from_path_entries(
                &fs,
                [PathBuf::from(r"C:\tools\git\cmd")],
                GIT_EXE,
                ProcessError::DevGitNotFound
            ),
            Ok(PathBuf::from(r"C:\tools\git\cmd\git.exe"))
        );
    }

    #[test]
    fn git2_empty_path_entry_is_never_searched() {
        // An empty PATH entry means the CURRENT DIRECTORY on Windows. Searching it would let
        // whatever directory the process happens to sit in supply the executable.
        let fs = FakeFs::with(&["git.exe", r"C:\tools\git.exe"]);
        let got = resolve_named_from_path_entries(
            &fs,
            [PathBuf::from(""), PathBuf::from(r"C:\tools")],
            GIT_EXE,
            ProcessError::DevGitNotFound,
        );
        assert_eq!(got, Ok(PathBuf::from(r"C:\tools\git.exe")));
    }

    #[test]
    fn git3_relative_entry_is_rejected() {
        let fs = FakeFs::with(&[r"tools\git.exe"]);
        assert_eq!(
            resolve_named_from_path_entries(
                &fs,
                [PathBuf::from("tools")],
                GIT_EXE,
                ProcessError::DevGitNotFound
            ),
            Err(ProcessError::DevGitNotFound)
        );
    }

    #[test]
    fn git4_unc_and_device_entries_are_rejected() {
        let fs = FakeFs::with(&[r"\\server\share\git.exe", r"\\.\PIPE\git.exe"]);
        for dir in [r"\\server\share", r"\\.\PIPE"] {
            assert_eq!(
                resolve_named_from_path_entries(
                    &fs,
                    [PathBuf::from(dir)],
                    GIT_EXE,
                    ProcessError::DevGitNotFound
                ),
                Err(ProcessError::DevGitNotFound),
                "network/device entry must never be searched: {dir}"
            );
        }
    }

    #[test]
    fn git5_wrong_filename_is_rejected() {
        // A directory holding something else git-ish must not satisfy the search.
        let fs = FakeFs::with(&[r"C:\tools\git.cmd", r"C:\tools\gitk.exe"]);
        assert_eq!(
            resolve_named_from_path_entries(
                &fs,
                [PathBuf::from(r"C:\tools")],
                GIT_EXE,
                ProcessError::DevGitNotFound
            ),
            Err(ProcessError::DevGitNotFound)
        );
    }

    #[test]
    fn git12_node_resolution_is_unchanged_by_the_git_addition() {
        // The Node search must behave exactly as before: same first-match rule, same rejections.
        let fs = FakeFs::with(&[r"C:\a\node.exe", r"C:\b\node.exe"]);
        assert_eq!(
            resolve_from_path_entries(&fs, [PathBuf::from(r"C:\a"), PathBuf::from(r"C:\b")]),
            Ok(PathBuf::from(r"C:\a\node.exe"))
        );
        assert_eq!(
            resolve_from_path_entries(&fs, [PathBuf::from(r"C:\missing")]),
            Err(ProcessError::DevRuntimeNotFound)
        );
        // and a git.exe never satisfies a Node search
        let only_git = FakeFs::with(&[r"C:\tools\git.exe"]);
        assert_eq!(
            resolve_from_path_entries(&only_git, [PathBuf::from(r"C:\tools")]),
            Err(ProcessError::DevRuntimeNotFound)
        );
    }
}
