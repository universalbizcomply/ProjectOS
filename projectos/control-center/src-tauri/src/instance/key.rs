//! Instance-key construction (PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A).
//!
//! Pure and platform-independent so every rule is deterministically testable: no OS call, no
//! filesystem probe, no ambient state. The only impure entry (`resolve_install_dir`) is a thin
//! wrapper that reads `current_exe()` and hands the result to the pure logic.
//!
//! BINDING: the key is NON-SECRET SCOPE MATERIAL. It authenticates nothing, identifies no
//! executable, and grants no capability. Access is controlled by the object's DACL (see
//! `security.rs`), never by the name — a name is only a rendezvous label, and anyone on the machine
//! can derive it.

use std::path::{Path, PathBuf};

use crate::identity::hash::sha256_hex;

/// Fixed application identifier component. Deliberately not the Tauri bundle identifier: this is a
/// namespace label, not identity evidence.
pub const APP_ID: &str = "ProjectOS.Control";

/// Domain-separation labels. Distinct labels make a user digest and an install digest with identical
/// input bytes impossible to confuse.
const USER_LABEL: &[u8] = b"ProjectOS.Instance.User.v1";
const INSTALL_LABEL: &[u8] = b"ProjectOS.Instance.Install.v1";

/// Hex characters retained from each SHA-256 (64 bits). A collision causes OVER-EXCLUSION only (one
/// host refuses to start); it can never grant access, because the DACL — not the name — is the
/// access control.
const COMPONENT_HEX_LEN: usize = 16;

/// `SECURITY_MAX_SID_SIZE` is 68; anything beyond this bound is malformed. Fail closed rather than
/// hash an implausible blob.
const MAX_SID_BYTES: usize = 68;

/// Bound the install path so a pathological value cannot be hashed unboundedly.
const MAX_INSTALL_PATH_BYTES: usize = 4096;

/// Why scope material could not be turned into a key. Deliberately carries no path, SID or detail —
/// nothing here is owner-facing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyError {
    /// The executable directory is missing, relative, empty, UNC/network, or device-namespace.
    ScopeInvalid,
}

/// Execution channel. Determined ONLY from build configuration — never from an environment
/// variable, CLI flag, cwd, React payload, Tauri command, or owner input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Development tree. Always DEVELOPMENT_UNVERIFIED.
    Dev,
    /// Packaged candidate.
    Pkg,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Dev => "dev",
            Channel::Pkg => "pkg",
        }
    }
}

/// The channel comes from `debug_assertions`, mirroring the accepted `detect_app_mode()` classifier.
/// Nothing a caller controls at runtime can influence it.
pub fn detect_channel() -> Channel {
    if cfg!(debug_assertions) {
        Channel::Dev
    } else {
        Channel::Pkg
    }
}

/// Canonical, unambiguous digest input: `label || LE32(len) || bytes`.
///
/// The length prefix is what makes the serialization injective. Plain concatenation would let two
/// different (label, value) pairs produce identical bytes; length-prefixing cannot.
fn digest_component(label: &[u8], bytes: &[u8]) -> String {
    let mut input = Vec::with_capacity(label.len() + 4 + bytes.len());
    input.extend_from_slice(label);
    input.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    input.extend_from_slice(bytes);
    let full = sha256_hex(&input);
    full[..COMPONENT_HEX_LEN].to_string()
}

/// Digest of the CURRENT ACCOUNT SID bytes.
///
/// The caller must pass the account SID (`TokenUser`), never the logon-session SID — that is exactly
/// what makes this value identical across every session belonging to the account, which is the whole
/// point of the cross-session guarantee. The raw SID never leaves this function.
pub fn user_component(sid_bytes: &[u8]) -> Result<String, KeyError> {
    if sid_bytes.is_empty() || sid_bytes.len() > MAX_SID_BYTES {
        return Err(KeyError::ScopeInvalid);
    }
    Ok(digest_component(USER_LABEL, sid_bytes))
}

/// Digest of the canonical installation directory.
///
/// Lower-cased because Windows paths are case-insensitive: `C:\Dev\x` and `c:\dev\x` are the same
/// installation and must not derive two different keys (which would silently permit two hosts).
pub fn install_component(dir: &Path) -> Result<String, KeyError> {
    if !is_valid_install_dir(dir) {
        return Err(KeyError::ScopeInvalid);
    }
    let lowered = dir.to_string_lossy().to_lowercase();
    let bytes = lowered.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_INSTALL_PATH_BYTES {
        return Err(KeyError::ScopeInvalid);
    }
    Ok(digest_component(INSTALL_LABEL, bytes))
}

/// A usable installation directory: absolute, local, drive-rooted, traversal-free.
///
/// Reuses the accepted `is_local_absolute` rule so UNC/network and device-namespace paths are
/// rejected by exactly the same logic that guards runtime resolution — one rule, not two drifting
/// copies.
fn is_valid_install_dir(dir: &Path) -> bool {
    if dir.as_os_str().is_empty() || !dir.is_absolute() {
        return false;
    }
    if dir
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    crate::process::dev_runtime::is_local_absolute(dir)
}

/// The installation directory for an already-canonicalised executable path.
///
/// Pure: takes the canonical exe path so every rejection rule is testable without touching the
/// filesystem. The verbatim `\\?\` prefix produced by `canonicalize` is stripped first — the same
/// defect class that made Node fail with `EISDIR` would otherwise poison the install digest, since
/// `\\?\C:\x` and `C:\x` are the same directory but different strings.
pub fn install_dir_from_exe(canonical_exe: PathBuf) -> Result<PathBuf, KeyError> {
    let exe = crate::process::dev_runtime::strip_verbatim(canonical_exe);
    let dir = exe.parent().ok_or(KeyError::ScopeInvalid)?.to_path_buf();
    if !is_valid_install_dir(&dir) {
        return Err(KeyError::ScopeInvalid);
    }
    Ok(dir)
}

/// Resolve the real installation directory from the running executable.
///
/// Derived from `current_exe()` — NEVER from the current directory, and never from a caller-supplied
/// root. This is the only impure function in this module.
pub fn resolve_install_dir() -> Result<PathBuf, KeyError> {
    let exe = std::env::current_exe().map_err(|_| KeyError::ScopeInvalid)?;
    let canonical = std::fs::canonicalize(&exe).map_err(|_| KeyError::ScopeInvalid)?;
    install_dir_from_exe(canonical)
}

/// The final global instance name.
///
/// `Global\` is required for the cross-session guarantee: per Microsoft's *Kernel object namespaces*,
/// an application detecting an existing instance "in the system across all sessions" must create or
/// open the object in the global namespace, because the default per-session namespace is exactly
/// what isolates one session from another.
///
/// `\` is the only character illegal in an object name and appears solely as the namespace separator.
pub fn instance_name(channel: Channel, user16: &str, install16: &str) -> String {
    format!(
        "Global\\{}.{}.u{}.i{}",
        APP_ID,
        channel.as_str(),
        user16,
        install16
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SID_A: &[u8] = &[1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 10, 20, 30, 40];
    const SID_B: &[u8] = &[1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 11, 20, 30, 40];

    fn dir(p: &str) -> PathBuf {
        PathBuf::from(p)
    }

    #[test]
    fn same_sid_install_and_channel_produce_the_same_name() {
        let u = user_component(SID_A).unwrap();
        let i = install_component(&dir(r"C:\dev\app")).unwrap();
        let a = instance_name(Channel::Dev, &u, &i);
        let b = instance_name(Channel::Dev, &u, &i);
        assert_eq!(a, b);
    }

    /// The cross-session guarantee reduces to exactly this: `user_component` is a pure function of
    /// the account SID bytes, and the same account yields identical bytes in every one of its
    /// sessions (pinned separately by `security::tests::account_sid_is_stable_across_repeated_resolution`).
    /// Identical bytes must therefore derive an identical name — so a second session collides.
    #[test]
    fn user_component_is_a_pure_function_of_the_account_sid_bytes() {
        assert_eq!(
            user_component(SID_A).unwrap(),
            user_component(SID_A).unwrap()
        );
    }

    #[test]
    fn different_accounts_derive_different_names() {
        assert_ne!(
            user_component(SID_A).unwrap(),
            user_component(SID_B).unwrap()
        );
    }

    #[test]
    fn different_channels_derive_different_names() {
        let u = user_component(SID_A).unwrap();
        let i = install_component(&dir(r"C:\dev\app")).unwrap();
        assert_ne!(
            instance_name(Channel::Dev, &u, &i),
            instance_name(Channel::Pkg, &u, &i)
        );
    }

    #[test]
    fn different_installations_derive_different_names() {
        assert_ne!(
            install_component(&dir(r"C:\dev\app")).unwrap(),
            install_component(&dir(r"C:\dev\other")).unwrap()
        );
    }

    /// Version is deliberately absent from the key: an in-place upgrade keeps the path, so the old
    /// and new versions must still exclude each other. A version component would silently permit two
    /// versions to run side by side during an upgrade.
    #[test]
    fn package_version_is_not_part_of_the_name() {
        let u = user_component(SID_A).unwrap();
        let i = install_component(&dir(r"C:\dev\app")).unwrap();
        let name = instance_name(Channel::Dev, &u, &i);
        assert!(!name.contains(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn path_case_does_not_split_one_installation_into_two() {
        assert_eq!(
            install_component(&dir(r"C:\Dev\App")).unwrap(),
            install_component(&dir(r"c:\dev\app")).unwrap()
        );
    }

    #[test]
    fn domain_separation_makes_user_and_install_digests_differ_for_equal_bytes() {
        let bytes = b"C:\\dev\\app";
        let u = digest_component(USER_LABEL, bytes);
        let i = digest_component(INSTALL_LABEL, bytes);
        assert_ne!(u, i);
    }

    /// Without a length prefix, ("ab","c") and ("a","bc") would serialise identically.
    #[test]
    fn length_prefix_makes_serialization_injective() {
        assert_ne!(digest_component(b"ab", b"c"), digest_component(b"a", b"bc"));
    }

    #[test]
    fn name_is_bounded_and_uses_only_legal_object_characters() {
        let u = user_component(SID_A).unwrap();
        let i = install_component(&dir(r"C:\dev\app")).unwrap();
        let name = instance_name(Channel::Dev, &u, &i);
        assert!(name.len() < 200, "name must stay bounded: {}", name.len());
        // The only backslash may be the namespace separator.
        assert_eq!(name.matches('\\').count(), 1);
        assert!(name.starts_with("Global\\"));
    }

    #[test]
    fn name_contains_no_raw_sid_no_path_and_no_username() {
        let u = user_component(SID_A).unwrap();
        let i = install_component(&dir(r"C:\dev\projectos")).unwrap();
        let name = instance_name(Channel::Dev, &u, &i);
        assert!(!name.contains("projectos") || name.starts_with("Global\\ProjectOS.Control."));
        assert!(!name.to_lowercase().contains(r"c:\"));
        assert!(!name.contains("dev\\"));
        // No raw SID byte sequence rendered in any obvious form.
        assert!(!name.contains("S-1-5"));
        assert!(!name.contains("1,5,0"));
    }

    #[test]
    fn components_are_exactly_sixteen_lowercase_hex_characters() {
        let u = user_component(SID_A).unwrap();
        assert_eq!(u.len(), COMPONENT_HEX_LEN);
        assert!(u.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(u, u.to_lowercase());
    }

    #[test]
    fn empty_or_oversized_sid_is_rejected() {
        assert_eq!(user_component(&[]), Err(KeyError::ScopeInvalid));
        assert_eq!(user_component(&[0u8; 69]), Err(KeyError::ScopeInvalid));
    }

    #[test]
    fn relative_and_empty_install_directories_are_rejected() {
        assert_eq!(install_component(&dir("")), Err(KeyError::ScopeInvalid));
        assert_eq!(
            install_component(&dir(r"dev\app")),
            Err(KeyError::ScopeInvalid)
        );
        assert_eq!(
            install_component(&dir(r".\app")),
            Err(KeyError::ScopeInvalid)
        );
    }

    #[test]
    fn unc_and_device_namespace_install_directories_are_rejected() {
        assert_eq!(
            install_component(&dir(r"\\server\share\app")),
            Err(KeyError::ScopeInvalid)
        );
        assert_eq!(
            install_component(&dir(r"\\?\UNC\server\share\app")),
            Err(KeyError::ScopeInvalid)
        );
        assert_eq!(
            install_component(&dir(r"\\.\PIPE\x")),
            Err(KeyError::ScopeInvalid)
        );
    }

    #[test]
    fn traversal_in_install_directory_is_rejected() {
        assert_eq!(
            install_component(&dir(r"C:\dev\..\dev\app")),
            Err(KeyError::ScopeInvalid)
        );
    }

    #[test]
    fn verbatim_prefix_is_stripped_before_the_install_digest() {
        let plain = install_dir_from_exe(PathBuf::from(r"C:\dev\app\x.exe")).unwrap();
        let verbatim = install_dir_from_exe(PathBuf::from(r"\\?\C:\dev\app\x.exe")).unwrap();
        assert_eq!(plain, verbatim);
        assert_eq!(
            install_component(&plain).unwrap(),
            install_component(&verbatim).unwrap()
        );
    }

    #[test]
    fn install_dir_is_the_executables_parent_directory() {
        let d = install_dir_from_exe(PathBuf::from(r"C:\dev\app\x.exe")).unwrap();
        assert_eq!(d, dir(r"C:\dev\app"));
    }

    #[test]
    fn relative_executable_is_rejected_so_the_cwd_can_never_set_scope() {
        assert_eq!(
            install_dir_from_exe(PathBuf::from(r"target\debug\x.exe")),
            Err(KeyError::ScopeInvalid)
        );
        assert_eq!(
            install_dir_from_exe(PathBuf::from("x.exe")),
            Err(KeyError::ScopeInvalid)
        );
    }

    #[test]
    fn unc_executable_is_rejected() {
        assert_eq!(
            install_dir_from_exe(PathBuf::from(r"\\server\share\app\x.exe")),
            Err(KeyError::ScopeInvalid)
        );
    }

    #[test]
    fn channel_is_build_derived_and_not_ambient() {
        std::env::set_var("PROJECTOS_CHANNEL", "pkg");
        // Under `cargo test` this is a debug build ⇒ Dev. The point is that no caller-settable input
        // can move it.
        assert_eq!(detect_channel(), Channel::Dev);
        std::env::remove_var("PROJECTOS_CHANNEL");
    }
}
