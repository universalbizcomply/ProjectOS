//! Deterministic, fieldless store errors. They never echo record content (ciphertext, nonce, tag,
//! remote URL, local root, summary, or any DTO field) — every variant is a bare classification.

/// A synthetic-store failure. Fieldless by design so no sensitive record data can leak through an
/// error value or its `Display`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum StoreError {
    /// The transaction's base revision is older than the current committed store revision.
    #[error("stale transaction base revision")]
    StaleBase,
    /// The transaction's base revision is ahead of the current committed store revision.
    #[error("future transaction base revision")]
    FutureBase,
    /// An insert targeted an existing key.
    #[error("duplicate record")]
    DuplicateRecord,
    /// A replace/remove targeted a missing key.
    #[error("missing record")]
    MissingRecord,
    /// A record's own identity did not match its staged key.
    #[error("record identity mismatch")]
    IdentityMismatch,
    /// A per-record DTO validation or cross-record consistency check failed.
    #[error("consistency failure")]
    ConsistencyFailure,
    /// An approval matched more than one committed operation by fingerprint (no deterministic bind).
    #[error("ambiguous operation binding")]
    AmbiguousOperationBinding,
    /// An emergency-stop candidate revision is inconsistent with the store-owned family revision.
    #[error("emergency revision inconsistent")]
    EmergencyRevisionInconsistent,
    /// A credential's lifecycle requires (or forbids) material that the committed state does not match.
    #[error("credential lifecycle violation")]
    CredentialLifecycleViolation,
    /// A transaction operation was attempted from an invalid state (e.g. commit after rollback).
    #[error("invalid transaction state")]
    InvalidTransactionState,
    /// A resource bound was exceeded (staged operations, records, journal, or audit).
    #[error("resource limit exceeded")]
    ResourceLimit,
    /// A store revision or per-family revision would overflow.
    #[error("revision overflow")]
    RevisionOverflow,
    /// The service-owned transaction-identity counter is exhausted.
    #[error("transaction counter exhausted")]
    CounterExhausted,
    /// A store-generated manifest or journal record failed its own contract or relationship check.
    #[error("generated bookkeeping invalid")]
    GeneratedBookkeepingInvalid,
    /// A deterministic test-only failure was injected at a defined commit stage.
    #[error("injected synthetic failure")]
    InjectedFailure,
}
