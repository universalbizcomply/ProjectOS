//! # ProjectOS Host Windows Durable Protected Store (file-store foundation)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-A.
//!
//! A real filesystem-backed durable store for accepted [`projectos_host_persistence`] protected-state
//! DTOs, under an EXPLICIT trusted root. It proves the durable mechanics the future ProjectOS Host
//! Service store needs: canonical bounded layout with reparse hardening, path containment, a private
//! Prepared→Committed/Aborted journal-backed mutation protocol (embedding the accepted
//! `JournalRecordDto`), SHA-256 accidental/unauthorised-mutation integrity framing, a monotonic store
//! revision anchored by the accepted manifest DTO, a single-writer OS advisory lock (auto-released on
//! crash), write-through durable replacement, intent-aware recovery, corruption refusal, and
//! fail-closed reconciliation.
//!
//! ## Contract reuse (no duplication)
//!
//! The accepted `projectos_host_store::Store` is an IN-MEMORY reference model; there is no store trait.
//! This crate is a NEW concrete durable type. It reuses the accepted persistence DTOs
//! (`ProtectedStateManifestDto`, `JournalRecordDto`, record DTOs) as the authoritative persisted
//! representation. Because the accepted family-scoped `JournalRecordDto` cannot bind a per-record
//! identity, a PRIVATE crate-local journal envelope EMBEDS it unchanged and adds only the storage-
//! specific bindings (record identity, operation, previous/intended revisions, intended record-frame
//! SHA-256, storage outcome) — it is not a universal ProjectOS DTO. The crate-local
//! [`DurableStoreError`] adds only the durability meanings the accepted `StoreError` does not express.
//!
//! ## What this crate does NOT do / claim
//!
//! FOUNDATION only. It selects NO production path (ProgramData deferred), applies NO ACLs, installs NO
//! Windows service, verifies NO service identity, writes NO registry, calls NO DPAPI/CNG, and stores NO
//! real master key or credential. The framing digest is SHA-256 but UNKEYED: it detects corruption and
//! accidental/unauthorised mutation, NOT authenticity against a local administrator; keyed authenticity
//! is deferred. Durability rests on `MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH)` + file-content flush;
//! Windows provides no documented directory-entry `fsync` guarantee, so directory flushing is
//! best-effort only. Full race-free reparse enforcement remains a later handle-based service duty.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! The store exposes no raw protected-payload getter beyond the accepted-DTO document it stored:
//! ```compile_fail
//! let s = projectos_host_windows_durable_protected_store::DurableProtectedStore::open("C:\\x").unwrap();
//! let _ = s.raw_bytes(); // no such method
//! ```
//! A frame kind is an enum, not an arbitrary integer:
//! ```compile_fail
//! let _ = projectos_host_windows_durable_protected_store::framing::DecodedFrame {
//!     schema_version: 1, kind: 1, id: vec![], revision: 1, payload: vec![],
//! };
//! ```

#![deny(unsafe_code)]

pub mod error;
pub mod framing;
pub mod layout;
pub mod recovery;
pub mod store;

// The ONLY module permitted to use `unsafe` (the minimal Win32 lock/replace/flush primitives).
#[allow(unsafe_code)]
mod windows_fs;

mod atomic_write;
mod journal;

pub use error::DurableStoreError;
pub use layout::VerifiedRoot;
pub use recovery::{RecordScan, Structural};
pub use store::DurableProtectedStore;
