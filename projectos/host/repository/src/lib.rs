//! # ProjectOS Host Repository (non-authoritative local repository adapter)
//!
//! CD-B4-REPOSITORY-BASELINE-ADAPTER1A.
//!
//! Runs a CLOSED ALLOWLIST of READ-ONLY Git commands ([`command::GitCommand`]) via direct
//! `std::process` — no shell, no string-built command line, no aliases, no caller-supplied options —
//! under a canonicalized, substitution-resistant trusted root, with a bounded per-command timeout and
//! bounded stdout/stderr, and structurally parses only machine-readable output (porcelain v2, exact
//! OIDs, integer counts). The result is an UNTRUSTED [`projectos_host_core::GitRepositoryObservation`].
//!
//! ## Committed bytes (RUN-TO-COMPLETION HOST ATTESTATION)
//!
//! [`CommittedFileReader`] adds the ONE read the host was missing: the committed content of a
//! contract-fixed path, answered from the object store rather than the working tree. It mints no
//! authority either — bytes are an observation, and whether they are the bytes the owner signed is
//! decided by the trust manifest, not here. The allowlist stays closed: a read names one exact
//! [`CommitId`] — `HEAD` is resolved to one when the reader opens and never carried onto a command
//! line — the path is a validated [`CommittedPath`], and no other object read exists.
//!
//! ## Authority boundary
//!
//! The adapter mints NO authority. `VerifiedRepositoryIdentity` / `VerifiedRepositoryBaseline` come
//! ONLY from `projectos_host_core::verify_repository_baseline`, which re-checks every field. A path, a
//! commit string, a report, or a caller "clean=true" can never become authority.
//!
//! ## Not done / not claimed
//!
//! NO fetch/pull/push/checkout/reset/clean/add/commit/merge/rebase/tag/config-write; NO network; NO
//! product-repository access (tests use disposable temporary repositories only); a local tracking
//! reference is NOT proof of live-remote freshness. `EXECUTION_READY` stays false; installation
//! authority stays `NotAuthorised`.

#![forbid(unsafe_code)]

pub mod command;
pub mod config;
pub mod error;
pub mod parse;
pub mod path;
pub mod tree_diff;

mod adapter;

pub use adapter::{CommittedFileReader, RepositoryAdapter};
pub use command::{CommitId, CommittedPath, CommittedRevision, GitCommand, GitRunner};
pub use config::RepositoryAdapterConfig;
pub use error::RepoAdapterError;
pub use tree_diff::{ChangeKind, EntryKind, EntryMode, ObjectId, TreeChange};
