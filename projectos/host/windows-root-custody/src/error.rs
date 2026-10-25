//! Fieldless, sanitised root-custody errors.
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-B.
//!
//! No variant carries a filesystem path (complete or partial), a volume serial number, a file
//! identifier, a raw handle, a temporary test-directory name, a machine identifier, or a raw Windows
//! error message. Every variant is a bare classification, so neither the error value nor its `Display`
//! can leak private machine identity.

/// A root-custody failure. Fieldless by design.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum RootCustodyError {
    /// The current platform does not support handle-owned root custody (fail closed, no emulation).
    #[error("unsupported platform")]
    UnsupportedPlatform,
    /// The supplied root path was empty.
    #[error("empty root path")]
    EmptyPath,
    /// The supplied root path was not an absolute drive-rooted path.
    #[error("relative root path")]
    RelativePath,
    /// The supplied root used an unsupported namespace form (UNC, device, alternate data stream,
    /// traversal, or forward-slash form).
    #[error("unsupported root namespace")]
    UnsupportedNamespace,
    /// The root does not exist.
    #[error("root not found")]
    NotFound,
    /// The opened object is not a directory.
    #[error("root is not a directory")]
    NotADirectory,
    /// The path denotes a directory where a FILE was required.
    #[error("path is not a file")]
    NotAFile,
    /// The object is a symlink, junction, or other reparse point; following it is refused.
    #[error("reparse point refused")]
    ReparsePointRefused,
    /// The held handle no longer yields a usable object.
    #[error("held handle invalid")]
    HandleInvalid,
    /// The held object's identity no longer equals the captured identity.
    #[error("root identity mismatch")]
    IdentityMismatch,
    /// The original pathname now resolves to a DIFFERENT filesystem object than the captured root.
    #[error("root path replaced")]
    PathReplaced,
    /// A required Windows API call failed (no raw status or message is carried).
    #[error("windows api failure")]
    WindowsApiFailure,
}
