//! ProjectOS Control Centre — Tauri desktop shell + Bridge Daemon host.
//!
//! The authoritative application runner lives HERE (not in `main.rs`) for one security reason: the
//! binary is a separate crate, so anything it calls must be `pub`. With the runner inside the
//! library, the native process layer stays `pub(crate)` and the generic launcher is unreachable from
//! any other crate **by the compiler** — not by a runtime check. `main.rs` is a thin call into
//! `run()`.
//!
//! The window loads the built Vite frontend. On startup the host launches the Node daemon sidecar
//! (`sidecar/host.mjs`) through the sealed development authority: job-bound at creation, observed by
//! handle, drained on both streams, and only declared ready on an explicit `lifecycle.ready`.
//!
//! Read-only throughout: it projects daemon state and requests fresh snapshots. It edits nothing,
//! runs no git/shell for the user, deploys nothing, mints no trust, and enables no approvals.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Identity compatibility boundary (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B). The canonical
// identity/publisher-trust implementation now lives in `projectos-host-identity`, consumed ONLY
// through the shared runtime's safe facade. This module exists so the existing in-crate call sites
// (`app.rs`, `instance/key.rs`) stay byte-for-byte unchanged. It contains NO implementation logic,
// no publisher policy, no trust decision, no hashing, no Authenticode, no unsafe and no serde_json —
// pure re-exports. Crate-private: no external crate gains any identity route through this crate.
#[cfg(windows)]
pub(crate) mod identity {
    pub(crate) use projectos_shared_host_runtime::identity::capture_startup_identity;

    pub(crate) mod composite {
        pub(crate) use projectos_shared_host_runtime::identity::composite::IdentityStatusView;
    }

    pub(crate) mod hash {
        pub(crate) use projectos_shared_host_runtime::identity::hash::sha256_hex;
    }
}

// The native process-creation foundation. Crate-private: no other crate can reach ProcessSpec, the
// generic creator, the job/pipe/handle layer, or the fixture token.
#[cfg(windows)]
pub(crate) mod process;

// Per-user, cross-session host uniqueness. Crate-private: the instance guard is an internal startup
// control, not an API. Left public, another crate could construct or drop the authority — the guard
// is the only thing standing between one host and two concurrent daemons.
#[cfg(windows)]
pub(crate) mod instance;

/// Closed re-export used ONLY by the integration lifecycle tests, and only under the non-default
/// `test-fixtures` feature. Absent from every default and release build.
///
/// It exposes the closed fixture surface and nothing else — no `ProcessSpec`, no generic creator, no
/// executable/argument/environment authority, no token, no raw handles, no job configuration.
#[cfg(all(windows, feature = "test-fixtures"))]
pub mod test_fixtures {
    /// Bounded-diagnostics limits the lifecycle assertions need.
    pub mod diagnostics_limits {
        pub use crate::process::diagnostics::{MAX_RETAINED_BYTES, TRUNCATION_MARKER};
    }
    pub use crate::process::errors::ProcessError;
    pub use crate::process::owner::{FixtureMode, JobBoundProcessOwner, SyntheticFixtureSpec};
    pub use crate::process::state::ProcessState;

    /// The fixture-facing name for the job-bound owner.
    pub use crate::process::owner::JobBoundProcessOwner as SyntheticProcessOwner;

    /// RECOVERY-BARRIER1B closed test surface: the evidence store, the recovery barrier with its
    /// injectable native seam, the resume seam, and the lifecycle state with an isolated evidence
    /// directory. Exposes no generic process authority, no raw handles, and no production paths
    /// beyond what the integration proofs must drive.
    pub use crate::process::evidence::{
        EvidenceRecord, EvidenceScope, EvidenceState, EvidenceStore, ReadOutcome,
    };
    pub use crate::process::lifecycle::{
        DaemonLifecycleState, DaemonStatus, SafeDaemonStatus, StartupPhase,
    };
    pub use crate::process::owner::{classify_resume, RealResumeApi, ResumeApi};
    pub use crate::process::recovery::{
        run_barrier, PriorProcess, ProbeOutcome, RecoveryConfig, RecoveryNative, WaitSlice,
        Win32RecoveryNative, RECOVERY_DEFAULT_TIMEOUT, RECOVERY_TIMEOUT_CEILING,
        RECOVERY_WAIT_SLICE,
    };

    // The identity test surface moved with the canonical identity implementation
    // (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B): the relocated identity integration tests
    // now consume `projectos_host_identity::test_fixtures::identity` directly.

    /// Narrow instance-uniqueness adapter for the multi-process race proofs, which need an isolated
    /// object name so they cannot collide with a real Control Centre running on this machine.
    ///
    /// It exposes the classification surface and the pure key rules only — no raw handle, no object
    /// name derivation for the production scope, no descriptor internals, and no way to reach the
    /// process or identity layers.
    pub mod instance {
        pub use crate::instance::guard::ProjectOsInstanceGuard;
        pub use crate::instance::key::{
            detect_channel, install_component, install_dir_from_exe, instance_name, user_component,
            Channel, KeyError,
        };
        pub use crate::instance::{acquire_named, InstanceFailure, InstanceOutcome};
    }
}

#[cfg(windows)]
mod app;

/// Run the ProjectOS Control Centre. The application's sole public entry point.
///
/// Returns `ExitCode` rather than calling `std::process::exit`, which would bypass every Rust
/// destructor — including the instance guard's and the daemon owner's.
#[cfg(windows)]
pub fn run() -> std::process::ExitCode {
    app::run()
}

/// Non-Windows builds have no native process ownership; the desktop shell is Windows-targeted.
#[cfg(not(windows))]
pub fn run() -> std::process::ExitCode {
    eprintln!("ProjectOS Control Centre requires Windows.");
    std::process::ExitCode::FAILURE
}
