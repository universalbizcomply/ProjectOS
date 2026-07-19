//! Stable, fail-closed error codes.
//!
//! Trust: SERVICE-GENERATED CLAIM consumed by the client, or a local parse/validation outcome. Codes
//! are intentionally coarse — they name a refusal category and reveal NO sensitive internal detail
//! (no paths, no state contents, no secret material, no verification internals).

use serde::{Deserialize, Serialize};

/// A stable contract error code. Serialised as a `SCREAMING_SNAKE_CASE` string so the wire code is
/// language-neutral and stable across versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[non_exhaustive]
pub enum ContractError {
    /// Schema version is not the supported version (older or newer). Never silently accepted.
    #[error("unsupported schema")]
    UnsupportedSchema,
    /// Request bytes could not be strictly parsed (bad JSON, unknown field, missing field).
    #[error("malformed request")]
    MalformedRequest,
    /// Request kind is not a known kind. Reserved for callers that classify kinds before parse.
    #[error("unknown request kind")]
    UnknownRequestKind,
    /// An identifier was empty, over-length, or contained control/whitespace characters.
    #[error("invalid identifier")]
    InvalidIdentifier,
    /// Future service outcome: the requested context could not be independently verified.
    #[error("context unverified")]
    ContextUnverified,
    /// Future service outcome: the calling process could not be independently verified.
    #[error("process unverified")]
    ProcessUnverified,
    /// Future service outcome: the project could not be independently verified.
    #[error("project unverified")]
    ProjectUnverified,
    /// Future service outcome: the environment could not be independently verified.
    #[error("environment unverified")]
    EnvironmentUnverified,
    /// Future service outcome: no credential is registered for the referenced project/environment.
    #[error("credential missing")]
    CredentialMissing,
    /// Future service outcome: no authoritative owner-approval provenance exists for the operation.
    #[error("approval unproven")]
    ApprovalUnproven,
    /// Future service outcome: the operation is not permitted for this context.
    #[error("operation not allowed")]
    OperationNotAllowed,
    /// Future service outcome: the operation reference is not known to the service.
    #[error("handle unknown")]
    HandleUnknown,
    /// Future service outcome: the operation reference does not match its bound session/process.
    #[error("handle binding mismatch")]
    HandleBindingMismatch,
    /// Future service outcome: the operation reference has expired.
    #[error("handle expired")]
    HandleExpired,
    /// The future Host Service is not running or not reachable.
    #[error("service unavailable")]
    ServiceUnavailable,
    /// A refusal with no client-actionable detail. Default fail-closed outcome.
    #[error("internal refusal")]
    InternalRefusal,
}
