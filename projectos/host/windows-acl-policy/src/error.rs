//! Fieldless, redacted refusal classification.
//!
//! No variant carries a path, an account name, a SID, descriptor or ACL bytes, a pointer, a handle,
//! or Windows error text. The classification IS the evidence.

use thiserror::Error;

/// Why an ACL inspection, verification or application was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum AclPolicyError {
    /// Not Windows. No emulation is attempted.
    #[error("unsupported platform")]
    UnsupportedPlatform,

    /// The supplied root was empty.
    #[error("empty path")]
    EmptyPath,

    /// The supplied root was not drive-rooted absolute.
    #[error("relative path")]
    RelativePath,

    /// UNC, device namespace, traversal, forward-slash form, or an alternate-data-stream
    /// interpretation.
    #[error("unsupported namespace")]
    UnsupportedNamespace,

    /// The root does not exist.
    #[error("not found")]
    NotFound,

    /// The root exists but is not a directory (for example a regular file).
    #[error("not a directory")]
    NotADirectory,
    /// The path denotes a directory where a FILE was required.
    #[error("not a file")]
    NotAFile,

    /// The root is a symlink, junction or other reparse point. It is REFUSED, never followed.
    #[error("reparse point refused")]
    ReparsePointRefused,

    /// The pathname no longer denotes the object admitted a moment earlier.
    #[error("path replaced")]
    PathReplaced,

    /// Windows denied the access required to read or write the security descriptor.
    #[error("access denied")]
    AccessDenied,

    /// Windows returned no usable security descriptor.
    #[error("security descriptor unavailable")]
    SecurityDescriptorUnavailable,

    /// The security descriptor, its DACL, or an ACE was structurally invalid or truncated.
    #[error("malformed descriptor")]
    MalformedDescriptor,

    /// A supplied or returned SID was not a syntactically valid, length-bounded SID.
    #[error("invalid sid")]
    InvalidSid,

    /// The policy itself is unsafe to apply (for example it would grant a broad principal
    /// write-like authority). Refused BEFORE any effect.
    #[error("policy refused")]
    PolicyRefused,

    /// Windows reported success (or partial success) but authoritative re-verification did not
    /// match the policy. NOT a success, NOT retried automatically, NOT rolled back.
    #[error("reconciliation required")]
    ReconciliationRequired,

    /// `SeRestorePrivilege` — what lets this process assign an owner other than itself — could not be
    /// admitted: the token does not hold it (`ERROR_NOT_ALL_ASSIGNED`), it could not be enabled, or the
    /// calling thread is impersonating so the write would be checked against a different token.
    /// Refused BEFORE any effect: no descriptor was written.
    #[error("privilege unavailable")]
    PrivilegeUnavailable,

    /// The ownership write ran (or was about to), but the token's prior `SeRestorePrivilege` state
    /// could not be restored and confirmed by a re-read. NOT a success whatever the write returned:
    /// the descriptor may have changed and the token may still hold the privilege enabled.
    #[error("privilege restore failed")]
    PrivilegeRestoreFailed,

    /// A supported Windows call failed for a reason not classified above. The Windows error text is
    /// deliberately discarded.
    #[error("windows api failure")]
    WindowsApiFailure,
}
