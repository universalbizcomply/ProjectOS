//! Bounded, redacted durable-plan-store error taxonomy. No variant carries a full digest, raw plan
//! definition, raw journal payload, absolute private path, replay identity, credential, or secret — the
//! underlying storage errors are already fieldless, and refusal classifications are payload-free.

use projectos_host_windows_durable_protected_store::DurableStoreError;

/// Why a durable approved-plan operation was refused. Fail closed; every variant is payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum PlanStoreError {
    /// A durable-store (framing/journal/atomic/recovery/layout) failure, kept as a bounded kind.
    #[error("durable store failure")]
    Storage(DurableStoreError),
    /// The record bytes were not a well-formed persisted plan DTO.
    #[error("malformed durable plan record")]
    Malformed,
    /// No record exists for the requested plan reference/version.
    #[error("plan record not found")]
    NotFound,
    /// A write that must be an Intent (uncommitted) carried a committed record, or vice versa, or a
    /// commit targeted a record that is already committed (not a fresh intent).
    #[error("intent/commit phase mismatch")]
    PhaseMismatch,
    /// A status transition was attempted on a terminal (Revoked/Superseded/Stale) plan; terminal
    /// statuses cannot be re-activated or further transitioned.
    #[error("terminal plan status")]
    TerminalStatus,
    /// A status transition did not strictly advance the durable status revision (rollback refused).
    #[error("non-monotonic status revision")]
    StatusRevisionRollback,
    /// The record could not be converted into the core reload DTO (unmappable candidate/identity).
    #[error("unconvertible durable plan record")]
    Unconvertible,
    /// The core reload path refused the record: uncommitted, wrong schema, malformed/contradictory
    /// candidate, recomputed-digest mismatch, or not ACTIVE and bound exactly to the required plan. The
    /// specific reason is intentionally not surfaced (no authority-content leak).
    #[error("approved plan refused by core revalidation")]
    Refused,
}

impl From<DurableStoreError> for PlanStoreError {
    fn from(e: DurableStoreError) -> Self {
        match e {
            DurableStoreError::RecordNotFound => PlanStoreError::NotFound,
            other => PlanStoreError::Storage(other),
        }
    }
}
