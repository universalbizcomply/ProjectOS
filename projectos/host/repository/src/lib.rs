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

mod adapter;

pub use adapter::RepositoryAdapter;
pub use command::{GitCommand, GitRunner};
pub use config::RepositoryAdapterConfig;
pub use error::RepoAdapterError;
