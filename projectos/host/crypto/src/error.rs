//! Deterministic, fieldless crypto errors. NO variant carries plaintext, raw key bytes, ciphertext,
//! nonce, tag, credential reference, project/provider/environment, complete associated data, or a
//! complete persistence DTO — every variant is a bare classification. No error source chain exposes
//! secret-bearing payloads (there is no source chain).

/// A service-private crypto-contract failure. Fieldless by design.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum CryptoError {
    /// The requested algorithm is not the single supported policy algorithm.
    #[error("unsupported algorithm")]
    UnsupportedAlgorithm,
    /// A key size violated policy.
    #[error("invalid key size")]
    InvalidKeySize,
    /// A nonce size violated policy.
    #[error("invalid nonce size")]
    InvalidNonceSize,
    /// An authentication-tag size violated policy.
    #[error("invalid tag size")]
    InvalidTagSize,
    /// The associated data was empty, malformed, or failed to authenticate.
    #[error("invalid associated data")]
    InvalidAssociatedData,
    /// A scope (project/provider/environment/credential reference) did not match.
    #[error("scope mismatch")]
    ScopeMismatch,
    /// The material's key version did not match the handle's key version.
    #[error("key version mismatch")]
    KeyVersionMismatch,
    /// A handle was revoked.
    #[error("revoked handle")]
    RevokedHandle,
    /// A handle was retired and may not perform this operation.
    #[error("retired handle")]
    RetiredHandle,
    /// A handle was not issued by this adapter instance (unknown / stale after restart). Phase 3H
    /// supports Active/Retiring/Revoked lifecycles plus restart-invalidation; deliberate key
    /// DESTRUCTION + secure erasure are a later governed phase, so there is no `DestroyedHandle`.
    #[error("unknown handle")]
    UnknownHandle,
    /// A reconciliation query named an operation id that this adapter did not issue, or issued for a
    /// different operation kind.
    #[error("unknown operation")]
    UnknownOperation,
    /// A handle was used for the wrong key role.
    #[error("wrong key role")]
    WrongKeyRole,
    /// An identifier or scope value was structurally invalid.
    #[error("invalid identity")]
    InvalidIdentity,
    /// A revision value was invalid (zero or out of range for the projection).
    #[error("invalid revision")]
    InvalidRevision,
    /// A plaintext or material value violated a size bound.
    #[error("resource limit exceeded")]
    ResourceLimit,
    /// A projection to a persistence DTO failed strict validation.
    #[error("projection invalid")]
    ProjectionInvalid,
    /// Secret material required by the operation was unavailable.
    #[error("secret material unavailable")]
    SecretUnavailable,
    // NOTE: there is NO `ReconciliationRequired` error. An uncertain-effect outcome is represented
    // ONLY by `RotationOutcome::ReconciliationRequired` (an outcome, never a retryable error), so a
    // caller can never confuse it with a `FailedBeforeEffect`/refusal error.
    /// A deterministic test-only synthetic failure was injected.
    #[error("injected synthetic failure")]
    SyntheticFailure,
}
