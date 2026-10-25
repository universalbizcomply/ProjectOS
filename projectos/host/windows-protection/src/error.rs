//! Deterministic, fieldless protection errors. NO variant carries plaintext, a protected blob, a
//! memory address, a username, a machine name, a token, a file path, or a raw Win32 message. Every
//! variant is reachable through the production paths or the narrow `#[cfg(test)]` release seam.

/// A DPAPI-capability failure. Fieldless by design.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum ProtectionError {
    /// The current platform is not Windows; DPAPI is unavailable (fail closed, no emulation).
    #[error("unsupported platform")]
    UnsupportedPlatform,
    /// Input was empty.
    #[error("empty input")]
    EmptyInput,
    /// Input exceeded the proof bound.
    #[error("input too large")]
    InputTooLarge,
    /// The protected output exceeded the accepted bound.
    #[error("protected output too large")]
    ProtectedOutputTooLarge,
    /// The unprotected output exceeded the accepted bound.
    #[error("plaintext output too large")]
    PlaintextOutputTooLarge,
    /// `CryptProtectData` reported failure.
    #[error("protect failed")]
    ProtectFailed,
    /// `CryptUnprotectData` reported failure.
    #[error("unprotect failed")]
    UnprotectFailed,
    /// A Windows-owned output pointer/length was invalid (null pointer or zero length).
    #[error("windows output invalid")]
    WindowsOutputInvalid,
}
