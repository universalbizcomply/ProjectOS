//! The crate-local, fieldless durable-store error taxonomy.
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-A.
//!
//! The accepted in-memory `projectos_host_store::StoreError` is the reference-model transactional
//! taxonomy; it does NOT express durability concepts (unsupported platform, on-disk corruption, lock
//! contention, interrupted-write reconciliation, recovery failure, read failure, path rejection). This
//! taxonomy adds those meanings. Every variant is FIELDLESS: it never carries a filesystem path, a
//! username, a machine or volume name, a raw Windows message, a record identifier, a manifest byte, or
//! any protected payload — only a bare classification, so no sensitive data leaks through an error or
//! its `Display`.

/// A durable protected-store failure. Fieldless by design.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum DurableStoreError {
    /// The current platform does not support the required durable primitives (fail closed).
    #[error("unsupported platform")]
    UnsupportedPlatform,
    /// Caller input was structurally invalid before any effect (bad identifier, revision, payload).
    #[error("invalid input")]
    InvalidInput,
    /// The supplied storage root is not an acceptable, contained, absolute trusted directory.
    #[error("invalid storage root")]
    InvalidRoot,
    /// A resource bound was exceeded (size, count, scan) before any mutation.
    #[error("resource limit exceeded")]
    ResourceLimit,
    /// A write was refused BEFORE any durable effect; the prior on-disk state is intact.
    #[error("write refused before effect")]
    WriteRefusedBeforeEffect,
    /// A read failed (missing, unreadable, or I/O error) with no mutation.
    #[error("read failed")]
    ReadFailed,
    /// A required record does not exist.
    #[error("record not found")]
    RecordNotFound,
    /// A revision did not advance (equal or rollback) relative to the durable current revision.
    #[error("revision not advanced")]
    RevisionNotAdvanced,
    /// Persisted content failed framing/integrity/DTO validation (accidental or unauthorised mutation).
    #[error("corruption detected")]
    CorruptionDetected,
    /// Another writer holds the single-writer lock for this root.
    #[error("writer lock contention")]
    LockContention,
    /// An operation's durable outcome is UNCERTAIN after an atomic effect point; the caller must
    /// reconcile via recovery and MUST NOT retry the original mutation. Evidence is preserved.
    #[error("reconciliation required")]
    ReconciliationRequired,
    /// Recovery could not resolve an ambiguous durable state; fail closed, evidence preserved.
    #[error("recovery failed")]
    RecoveryFailed,
    /// A deterministic test-only fault was injected at a defined stage (absent from release).
    #[error("injected synthetic fault")]
    InjectedFault,
}
