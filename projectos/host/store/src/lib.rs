//! # ProjectOS Host Store (synthetic transactional protected-state model)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3G.
//!
//! A service-private, IN-MEMORY, transactional reference model over the accepted persistence DTO
//! contracts (`projectos-host-persistence`). It proves the behavioural core the future ProjectOS Host
//! Service store must have: atomic multi-record transactions, no partial commit, explicit rollback,
//! service-owned monotonic store/family revisions the caller can never set, stale-write refusal,
//! stable snapshot reads, failure-injected atomicity, and resource bounds.
//!
//! ## Boundaries this crate preserves
//!
//! * **No durable persistence** — no filesystem, database, or serialized on-disk format. State lives
//!   only in process memory for the lifetime of a [`Store`] value.
//! * **No cryptography** — the manifest MAC is a synthetic placeholder; there is no key, hash, or MAC
//!   computation/verification here. Real store-integrity is a later phase.
//! * **No Windows API, service process, IPC, credential custody, or provider execution.**
//! * **Zero live authority from stored data.** The store returns persistence DTOs only. It NEVER
//!   constructs or returns an `ExecutionPermit`, `AuthenticatedSession`, `CredentialLease`, or any
//!   eligibility decision. A stored approval/permit-shaped DTO is inert data; a stored revision is an
//!   observation, never the authoritative current state of anything but this store's own bookkeeping.
//!
//! ## What this crate does NOT claim
//!
//! Atomicity here is single-process, single-`Store` in-memory only. It makes NO anti-rollback,
//! anti-tamper, crash-durability, or concurrency guarantee, and defends against no elevated
//! administrator or offline attacker. It is a behavioural reference model, not a production store.

#![forbid(unsafe_code)]

pub mod error;
pub mod model;
pub mod store;
pub mod transaction;

pub use error::StoreError;
pub use model::{
    FamilyRevisions, RecordFamily, Snapshot, StoreRevision, StoredRecord, EMERGENCY_KEY,
};
pub use store::{
    CommitOutcome, Store, MAX_AUDIT, MAX_JOURNAL, MAX_RECORDS_PER_FAMILY, MAX_STAGED_OPS,
};
pub use transaction::{Action, InjectStage, Transaction, TxState};
