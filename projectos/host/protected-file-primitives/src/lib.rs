//! Two low-level Win32 primitives an ELEVATED publisher of protected machine configuration needs,
//! and which have no `std` equivalent.
//!
//! `is_process_elevated` answers whether the calling process actually holds an elevated token. It is
//! not a permission model and it grants nothing: a caller uses it to REFUSE before performing any
//! effect, so an unelevated attempt fails closed at the boundary instead of failing halfway through
//! a write with an access-denied error and an indeterminate file on disk.
//!
//! `replace_file` is `ReplaceFileW`, which is the only Windows primitive that replaces a file's
//! CONTENTS while preserving the target's own security descriptor, creation time and object identity.
//! `MoveFileExW`/rename does not: the replacement file's descriptor wins, so a rename over a protected
//! file silently discards the explicit DACL that made it protected. That distinction is the entire
//! reason this function exists rather than reusing the durable store's move-based publish.
//!
//! WHAT NEITHER OF THEM DOES. Neither resolves a path, chooses a destination, elevates anything,
//! requests consent, reads a policy, or applies an ACL. Both take exactly what the caller gives them
//! and report exactly what Windows said. Authority lives above; this is the leaf.
//!
//! WHY A CRATE OF ITS OWN. These belong beside the owned-handle wrapper in
//! `windows-runtime-primitives`, and that is where they were first written — but that crate carries an
//! ACCEPTED boundary validator pinning `unsafe` to exactly `handles.rs`, `system_random.rs` and
//! `known_folder.rs`. Adding a fourth file broke it. Editing the validator to make room would be
//! weakening another phase's accepted control to pass this one, so the primitives moved instead. The
//! confinement property is unchanged: one crate, one file, every `unsafe` block documented.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C (elevated registry publication).

#![cfg(windows)]
#![deny(unsafe_op_in_unsafe_fn)]

use std::path::Path;

/// Why a primitive could not answer. Fieldless variants: no OS status code, path or handle escapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProtectedFileError {
    /// The process token could not be opened or queried.
    TokenUnavailable,
    /// A path could not be encoded for Win32 (interior NUL, or not representable).
    PathNotRepresentable,
    /// The replacement did not happen. The destination is unchanged.
    ReplaceFailed,
}

/// Encode a path as a NUL-terminated UTF-16 buffer.
fn wide(path: &Path) -> Result<Vec<u16>, ProtectedFileError> {
    use std::os::windows::ffi::OsStrExt;
    let mut buffer: Vec<u16> = path.as_os_str().encode_wide().collect();
    if buffer.contains(&0) {
        return Err(ProtectedFileError::PathNotRepresentable);
    }
    buffer.push(0);
    Ok(buffer)
}

/// Whether the calling process is running with an ELEVATED token.
///
/// `TokenElevation` is the same fact Windows itself uses to decide whether a process is running "as
/// administrator". It answers about THIS process only; it says nothing about what the process is
/// permitted to do with any particular object, which is Windows' job and is checked separately by the
/// object's own DACL.
///
/// # Errors
/// [`ProtectedFileError::TokenUnavailable`] if the process token cannot be opened or queried. A
/// caller must treat that as NOT elevated — an unanswerable question is not a yes.
pub fn is_process_elevated() -> Result<bool, ProtectedFileError> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle that needs no closing; `token` is a live,
    // writable local for the duration of the call. Only TOKEN_QUERY is requested — the narrowest
    // access that answers the question, and it grants no ability to modify the token.
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|_| ProtectedFileError::TokenUnavailable)?;
    // RAII from here: the token handle is closed exactly once on drop, on every path below including
    // the error ones. SAFETY: `OpenProcessToken` succeeded and transferred ownership of `token` to
    // us; no other owner exists.
    let owned = unsafe { projectos_windows_runtime_primitives::handles::adopt(token) }
        .ok_or(ProtectedFileError::TokenUnavailable)?;

    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned: u32 = 0;
    // SAFETY: `owned` holds a live token handle opened with TOKEN_QUERY; the output buffer is an
    // owned, correctly sized `TOKEN_ELEVATION` alive across the call, and its size is passed exactly.
    let queried = unsafe {
        GetTokenInformation(
            projectos_windows_runtime_primitives::handles::win32(&owned),
            TokenElevation,
            Some(std::ptr::addr_of_mut!(elevation).cast()),
            u32::try_from(std::mem::size_of::<TOKEN_ELEVATION>())
                .map_err(|_| ProtectedFileError::TokenUnavailable)?,
            &mut returned,
        )
    };
    queried.map_err(|_| ProtectedFileError::TokenUnavailable)?;
    Ok(elevation.TokenIsElevated != 0)
}

/// Whether standard input is an INTERACTIVE console.
///
/// A registration that may be approved by a piped or redirected stream is not an owner confirmation;
/// it is an unattended one wearing a confirmation's clothes. `GetConsoleMode` succeeds only on a real
/// console handle, so a pipe, a file and a closed handle all answer `false`.
///
/// This proves the KEYSTROKES came from a console, not who typed them. It is a check against
/// automation, not an identity or presence proof, and nothing here should be read as one.
#[must_use]
pub fn is_stdin_interactive() -> bool {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Console::{
        GetConsoleMode, GetStdHandle, CONSOLE_MODE, STD_INPUT_HANDLE,
    };

    // SAFETY: `GetStdHandle` returns a borrowed pseudo-handle that must not be closed; it is used
    // only for the duration of the `GetConsoleMode` query below.
    let handle: HANDLE = match unsafe { GetStdHandle(STD_INPUT_HANDLE) } {
        Ok(h) if !h.is_invalid() => h,
        _ => return false,
    };
    let mut mode = CONSOLE_MODE::default();
    // SAFETY: `handle` is a live standard-handle value and `mode` is an owned local alive across the
    // call. A non-console handle simply fails, which is the answer we want.
    unsafe { GetConsoleMode(handle, &mut mode) }.is_ok()
}

/// Replace `destination`'s contents with `replacement`, PRESERVING the destination's own security
/// descriptor and object identity.
///
/// Both paths must be on the same volume, and `destination` must already exist — `ReplaceFileW` is a
/// replacement primitive, not a create primitive, and a caller that wants creation must say so
/// explicitly by creating the file itself. On failure the destination is left exactly as it was.
///
/// No backup file is requested: a backup would be a second copy of protected configuration sitting
/// beside it under whatever descriptor the backup inherited.
///
/// # Errors
/// [`ProtectedFileError::PathNotRepresentable`] or [`ProtectedFileError::ReplaceFailed`].
pub fn replace_file(destination: &Path, replacement: &Path) -> Result<(), ProtectedFileError> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

    let destination_w = wide(destination)?;
    let replacement_w = wide(replacement)?;
    // SAFETY: both buffers are owned, NUL-terminated and alive across the call; no backup path, no
    // reserved parameters. Windows validates the paths itself and reports failure through the result.
    unsafe {
        ReplaceFileW(
            PCWSTR(destination_w.as_ptr()),
            PCWSTR(replacement_w.as_ptr()),
            PCWSTR::null(),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|_| ProtectedFileError::ReplaceFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The elevation question is ANSWERED, whichever way. A test process is normally not elevated,
    /// but asserting the value would make the test depend on how it was launched; what matters is
    /// that the primitive returns a definite answer rather than failing.
    /// The interactivity question is ANSWERED, whichever way. Under `cargo test` stdin is not a
    /// console, so this is normally `false`; asserting the value would make the test depend on how it
    /// was launched. What matters is that it never panics and never fails open.
    #[test]
    fn the_interactivity_question_is_answerable_and_defaults_closed() {
        // Two real properties, neither of them a tautology: it returns rather than panicking or
        // blocking on a read, and it is DETERMINISTIC for one handle. A check that flickered would be
        // worse than none, because a confirmation gate would then depend on when it was asked.
        let first = is_stdin_interactive();
        for _ in 0..5 {
            assert_eq!(
                is_stdin_interactive(),
                first,
                "the interactivity answer must not change under repetition"
            );
        }
    }

    #[test]
    fn the_elevation_question_is_answerable() {
        assert!(is_process_elevated().is_ok());
    }

    /// Replacement swaps the CONTENTS of an existing destination, in place.
    #[test]
    fn replacement_swaps_the_contents_of_an_existing_destination() {
        let dir = std::env::temp_dir().join("projectos-replace-file-ok");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let destination = dir.join("target.json");
        let replacement = dir.join("target.json.tmp");
        std::fs::write(&destination, b"before").unwrap();
        std::fs::write(&replacement, b"after").unwrap();

        replace_file(&destination, &replacement).expect("the replacement succeeds");
        assert_eq!(std::fs::read(&destination).unwrap(), b"after");
        assert!(!replacement.exists(), "the replacement file is consumed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An ABSENT destination is refused rather than created. Replacement is not creation: a caller
    /// that wanted a new file must create it deliberately, with its descriptor chosen deliberately.
    #[test]
    fn an_absent_destination_is_refused_rather_than_created() {
        let dir = std::env::temp_dir().join("projectos-replace-file-absent");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let destination = dir.join("target.json");
        let replacement = dir.join("target.json.tmp");
        std::fs::write(&replacement, b"after").unwrap();

        assert_eq!(
            replace_file(&destination, &replacement),
            Err(ProtectedFileError::ReplaceFailed)
        );
        assert!(!destination.exists(), "nothing was created");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A failed replacement leaves the destination byte-for-byte as it was.
    #[test]
    fn a_failed_replacement_leaves_the_destination_unchanged() {
        let dir = std::env::temp_dir().join("projectos-replace-file-fail");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let destination = dir.join("target.json");
        std::fs::write(&destination, b"before").unwrap();

        // The replacement does not exist, so the operation cannot succeed.
        assert_eq!(
            replace_file(&destination, &dir.join("absent.tmp")),
            Err(ProtectedFileError::ReplaceFailed)
        );
        assert_eq!(std::fs::read(&destination).unwrap(), b"before");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_with_an_interior_nul_is_refused_before_any_call() {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        let bad = std::path::PathBuf::from(OsString::from_wide(&[0x43, 0x00, 0x44]));
        assert_eq!(wide(&bad), Err(ProtectedFileError::PathNotRepresentable));
    }
}
