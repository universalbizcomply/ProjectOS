//! Deterministic, coarse persistence-validation errors. Service-private; never echo secret-bearing
//! material or full ciphertext.

/// A fail-closed persistence DTO validation error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum PersistError {
    /// The input document exceeded the parser-intake byte limit (checked BEFORE deserialisation).
    #[error("document too large")]
    DocumentTooLarge,
    /// The DTO schema version is not the exact supported version for its family (older/newer/zero).
    #[error("unsupported schema version")]
    UnsupportedSchema,
    /// The bytes could not be strictly parsed (bad JSON, unknown field, missing field, duplicate
    /// field, unknown enum variant). Structurally rejects injected authority/plaintext fields.
    #[error("malformed record")]
    Malformed,
    /// A bounded identifier was empty, over-length, or contained an illegal character.
    #[error("invalid identifier")]
    InvalidIdentifier,
    /// A hex-encoded field was empty, over-length, or not hex.
    #[error("invalid hex field")]
    InvalidHex,
    /// A bounded text field exceeded its length bound or contained a control character.
    #[error("invalid bounded text")]
    InvalidText,
    /// A repository-remote identifier was not a supported, credential-free remote form.
    #[error("invalid repository remote")]
    InvalidRepositoryRemote,
    /// A permitted-local-root descriptor was not a supported absolute Windows path form.
    #[error("invalid local root")]
    InvalidLocalRoot,
    /// A bounded collection exceeded its count bound or contained a duplicate.
    #[error("invalid collection")]
    InvalidCollection,
    /// A revision/version value was invalid (e.g. zero where a positive value is required).
    #[error("invalid revision")]
    InvalidRevision,
    /// Two expiry/boundary values were contradictory.
    #[error("expiry contradiction")]
    ExpiryContradiction,
    /// A scope/binding did not match across fields (project/provider/environment/operation/release).
    #[error("scope or binding mismatch")]
    ScopeMismatch,
    /// A revocation state was inconsistent (active-with-reason, revoked-without-reason, etc.).
    #[error("revocation inconsistency")]
    RevocationInconsistency,
    /// An emergency-stop revision/lock combination was contradictory.
    #[error("emergency-stop inconsistency")]
    EmergencyInconsistency,
    /// An audit/manifest/journal chain reference was invalid.
    #[error("invalid chain reference")]
    InvalidChainReference,
}
