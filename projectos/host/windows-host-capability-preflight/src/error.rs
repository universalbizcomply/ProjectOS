//! Fieldless, redacted refusal and non-conformance classification.
//!
//! No variant carries a machine name, user name, domain, SID, service-list content, handle, pointer,
//! private path, registry value, credential or secret. The classification IS the evidence.

use thiserror::Error;

/// Why a preflight step could not be completed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum HostPreflightError {
    /// Not Windows. No emulation is attempted.
    #[error("unsupported platform")]
    UnsupportedPlatform,

    /// The OS version API could not be resolved or returned no usable answer.
    #[error("version api unavailable")]
    VersionApiUnavailable,

    /// The Service Control Manager refused a READ-ONLY connection.
    #[error("scm access denied")]
    ScmAccessDenied,

    /// The Service Control Manager could not be opened for another reason.
    #[error("scm connect failed")]
    ScmConnectFailed,

    /// Services could not be enumerated.
    #[error("service enumeration failed")]
    ServiceEnumerationFailed,

    /// A candidate service name was empty.
    #[error("empty service name")]
    EmptyServiceName,

    /// A candidate exceeded the bounded Windows service-name length.
    #[error("service name too long")]
    ServiceNameTooLong,

    /// A candidate contained a slash, backslash, control character or other forbidden character.
    #[error("invalid service name character")]
    InvalidServiceNameCharacter,

    /// A candidate had leading or trailing whitespace, or normalises ambiguously.
    #[error("service name whitespace or ambiguous normalisation")]
    AmbiguousServiceName,

    /// A candidate used a reserved or misleading system name.
    #[error("reserved or misleading service name")]
    ReservedServiceName,

    /// A candidate did not clearly identify ProjectOS.
    #[error("service name not project scoped")]
    NotProjectScoped,

    /// A candidate embedded a product name (for example a pilot product).
    #[error("product specific service name")]
    ProductSpecificName,

    /// A candidate embedded an environment name (for example production or staging).
    #[error("environment specific service name")]
    EnvironmentSpecificName,

    /// A candidate embedded a machine, tenant or credential-like identifier.
    #[error("machine or credential like service name")]
    MachineOrCredentialLikeName,

    /// The same candidate was supplied twice (case-insensitively).
    #[error("duplicate candidate")]
    DuplicateCandidate,

    /// An observed service name was malformed. Observations fail CLOSED.
    #[error("malformed observation")]
    MalformedObservation,

    /// The accepted frozen activation plan does not match the state this preflight requires.
    #[error("plan contract mismatch")]
    PlanContractMismatch,

    /// A supported read-only Windows call failed for a reason not classified above. The Windows
    /// error text is deliberately discarded.
    #[error("windows api failure")]
    WindowsApiFailure,
}

/// A semantic non-conformance found while judging the preflight result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PreflightViolation {
    /// The Windows edition could not be classified.
    EditionIndeterminate,
    /// The Windows baseline is below what the host service requires.
    BaselineUnsupported,
    /// Read-only inspection of the service namespace was unavailable.
    ReadOnlyInspectionUnavailable,
    /// Every candidate name was rejected or collided.
    NoUsableServiceName,
    /// A capability was claimed as proven without an effect that could prove it.
    ProofRequiresApprovedEffect,
    /// The accepted frozen plan drifted from the state this preflight requires.
    PlanContractDrift,
}
