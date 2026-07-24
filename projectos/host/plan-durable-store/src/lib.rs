//! # ProjectOS Host Plan Durable Store (non-authoritative approved-plan adapter)
//!
//! CD-B4-PROTECTED-PLAN-DURABLE-STORE1A.
//!
//! Integrates the accepted in-core `ApprovedPlanJournal` authority semantics with the existing durable
//! storage foundation. It REUSES [`projectos_host_windows_durable_protected_store::DurableProtectedStore`]
//! for every filesystem mechanic — SHA-256 accidental/unauthorised-mutation framing, the private
//! Prepared→Committed/Aborted journal envelope embedding the accepted `JournalRecordDto`, atomic
//! `MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH)` write-through replacement, single-writer lock, bounded
//! reparse-hardened layout with path containment, and journal-aware interrupted-write recovery — and the
//! accepted `projectos_host_persistence::PlanRecordDto` as the untrusted persisted representation.
//!
//! ## Authority boundary
//!
//! ```text
//! filesystem bytes → framing validation (durable store) → PlanRecordDto (untrusted) → structural
//! validation → to_core_dto → projectos_host_core::validate_durable_plan (committed + schema +
//! re-normalize + SHA-256 recompute + exact active binding) → ValidatedApprovedPlan
//! ```
//!
//! The store NEVER returns a live authority object from bytes: [`PlanDurableStore::resolve_active`]
//! delegates to the accepted crate-private core reload path via the single public
//! `validate_durable_plan` bridge. A stored digest is compared, never trusted; a stored status is an
//! observation; an uncommitted Intent is never authority; recovery synthesises no approval.
//!
//! ## Not implemented / not claimed
//!
//! FOUNDATION only, inheriting the durable store's limits: NO production path selection (ProgramData
//! deferred), NO ACLs, NO Windows service/identity, NO registry, NO DPAPI/CNG, NO real key or
//! credential. The framing digest is unkeyed SHA-256 (corruption/mutation detection, NOT authenticity
//! against a local administrator). Tests use disposable temporary roots only. `EXECUTION_READY` remains
//! false; installation authority remains `NotAuthorised`.

#![forbid(unsafe_code)]

mod adapter;
mod convert;
pub mod error;

pub use adapter::PlanDurableStore;
pub use error::PlanStoreError;
