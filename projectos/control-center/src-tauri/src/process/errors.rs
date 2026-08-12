//! Typed, closed process failures (CREATION1A, extended by OWNERSHIP1B).
//!
//! Every failure is fail-closed: no partial ownership survives, and no caller may interpret a
//! failure as "running". Errors never carry raw handles, PIDs, full local paths, environment
//! contents, or stack traces.
//!
//! Owner-facing wording deliberately says "local worker", never "secure" or "trusted": this phase
//! job-binds and observes the daemon, which is a *containment* property — it establishes no identity
//! and no trust.

use serde::Serialize;

/// Closed set of native process / lifecycle failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProcessError {
    /// The native ownership architecture is Windows-only; other platforms get a closed result.
    UnsupportedPlatform,

    // ---- OWNERSHIP1B: development runtime resolution -------------------------------------------
    /// `PROJECTOS_DEV_NODE` is not an absolute local path to a real `node.exe`.
    DevRuntimeOverrideInvalid,
    /// No `node.exe` in any absolute local PATH directory (cwd/empty/relative are never searched).
    DevRuntimeNotFound,
    /// The fixed development sidecar entry point could not be resolved.
    DevSidecarNotFound,
    /// The development Git executable could not be resolved from the host PATH.
    DevGitNotFound,

    // ---- OWNERSHIP1B: lifecycle / readiness ----------------------------------------------------
    /// A lifecycle-shaped line was malformed, mis-statused, or carried unknown fields.
    LifecycleMessageMalformed,
    /// The daemon announced a lifecycle protocol version we do not speak.
    LifecycleProtocolMismatch,
    /// A daemon announced readiness for a different instance (stale or wrong process).
    DaemonInstanceMismatch,
    /// No `lifecycle.ready` within the bounded startup window.
    DaemonReadyTimeout,
    /// The daemon exited, or stdout reached EOF, before announcing readiness.
    DaemonExitedEarly,
    /// A request arrived while the daemon was not `RUNNING_READ_ONLY`.
    DaemonNotReady,
    /// The lifecycle lock was poisoned; the owner is treated as BLOCKED.
    LifecycleStateBlocked,
    /// Packaged identity is unverified, so no packaged daemon may launch. Never falls back to dev.
    ProductionIdentityUnavailable,
    /// Packaged identity WAS verified and packaged launch authority exists — but the packaged
    /// runtime payload it would launch (pinned runtime + daemon artefact) is not provisioned in this
    /// build yet.
    ///
    /// Deliberately distinct from `ProductionIdentityUnavailable`: conflating them would report an
    /// identity failure for a run whose identity verified perfectly, which is the sort of untruth
    /// that sends someone to debug the wrong subsystem. It fails closed either way — and it never
    /// falls back to development.
    PackagedRuntimeNotProvisioned,

    // ---- RECOVERY-BARRIER1B: prior-daemon recovery barrier --------------------------------------
    /// The persisted lifecycle evidence record was malformed, wrong-scope, or inconsistent.
    RecoveryEvidenceMalformed,
    /// The evidence record declares a schema version this build does not speak.
    RecoveryEvidenceUnsupportedSchema,
    /// Evidence could not be durably persisted (or the store could not be resolved). Fails closed:
    /// a daemon whose death would be unrecoverable-in-evidence must never run.
    RecoveryEvidenceWriteFailed,
    /// The recorded prior process exists but its identity could not be safely verified.
    RecoveryIdentityUnverifiable,
    /// Access was denied while checking the recorded prior process. NEVER read as termination.
    RecoveryAccessDenied,
    /// The exact prior process did not terminate within the bounded recovery window.
    RecoveryTimeout,
    /// Startup was cancelled by application shutdown before completion. Not an error condition in
    /// the system — the fail-closed outcome of a deliberate close.
    RecoveryCancelled,

    // ---- RECOVERY-BARRIER1B: suspended launch ---------------------------------------------------
    /// `ResumeThread` reported a native failure. The trusted child was terminated.
    DaemonResumeFailed,
    /// `ResumeThread` returned a suspend count other than exactly 1 (0 = already running; >1 =
    /// foreign suspension). The controlled-launch invariant was violated; the trusted child was
    /// terminated and no foreign suspension was ever force-removed.
    DaemonUnexpectedSuspendCount,
    /// `CreateProcessW` returned no usable primary-thread handle for a suspended launch.
    ThreadHandleUnavailable,

    // ---- CREATION1A: native primitive ----------------------------------------------------------
    JobObjectCreateFailed,
    JobObjectConfigurationFailed,
    JobMembershipUnverified,
    PipeCreateFailed,
    PipeInheritanceConfigurationFailed,
    AttributeListSizeQueryFailed,
    AttributeListInitFailed,
    AttributeListUpdateFailed,
    /// The supplied executable is not the Cargo-built synthetic fixture.
    FixtureExecutableRejected,
    ExecutablePathInvalid,
    ExecutablePathNotAbsolute,
    CurrentDirectoryInvalid,
    CommandLineInvalid,
    CommandLineTooLong,
    EnvironmentVariableInvalid,
    ProcessCreateFailed,
    ProcessHandleUnavailable,
    ProcessCreationTimeUnavailable,
    ProcessExitCodeUnavailable,
    ShutdownTimeout,
    ForceTerminationFailed,
    InvalidStateTransition,
    InternalErrorRedacted,
}

impl ProcessError {
    /// Whether an OS process may still exist after this failure. `false` for every pre-creation
    /// failure — the invariant that makes cleanup provable. Where this is `true`, the caller MUST
    /// terminate (the Job close does it regardless).
    pub const fn process_may_exist(self) -> bool {
        matches!(
            self,
            ProcessError::JobMembershipUnverified
                | ProcessError::ProcessHandleUnavailable
                | ProcessError::ProcessCreationTimeUnavailable
                | ProcessError::ShutdownTimeout
                | ProcessError::ForceTerminationFailed
                // A process exists but never announced (or wrongly announced) readiness.
                | ProcessError::DaemonReadyTimeout
                | ProcessError::LifecycleMessageMalformed
                | ProcessError::LifecycleProtocolMismatch
                | ProcessError::DaemonInstanceMismatch
                // A suspended child existed when these were raised; it is terminated on the same
                // path, and the Job close is the backstop.
                | ProcessError::RecoveryEvidenceWriteFailed
                | ProcessError::DaemonResumeFailed
                | ProcessError::DaemonUnexpectedSuspendCount
                | ProcessError::ThreadHandleUnavailable
                // The PRIOR (not our) process may still exist; it is Job-contained by its dead
                // host and is never ours to terminate.
                | ProcessError::RecoveryTimeout
                | ProcessError::RecoveryAccessDenied
                | ProcessError::RecoveryIdentityUnverifiable
        )
    }

    /// Whether protected approvals are disabled. Always true in this phase — nothing here can
    /// establish the identity or trust that protected approvals require.
    pub const fn protected_approvals_disabled(self) -> bool {
        true
    }

    /// Short, safe operator hint. No paths, handles, PIDs, env, or stack content — and never the
    /// words "secure" or "trusted".
    pub const fn next_safe_action(self) -> &'static str {
        match self {
            ProcessError::UnsupportedPlatform => {
                "Local worker ownership is available on Windows only."
            }
            ProcessError::DevRuntimeOverrideInvalid => {
                "PROJECTOS_DEV_NODE must be an absolute path to node.exe on a local drive."
            }
            ProcessError::DevRuntimeNotFound => {
                "Node was not found on PATH. Install Node or set PROJECTOS_DEV_NODE."
            }
            ProcessError::DevSidecarNotFound => {
                "The local worker entry point was not found in this development tree."
            }
            ProcessError::DevGitNotFound => {
                "Git was not found on PATH. ProjectOS needs it to establish repository facts."
            }
            ProcessError::LifecycleMessageMalformed
            | ProcessError::LifecycleProtocolMismatch
            | ProcessError::DaemonInstanceMismatch => {
                "The local worker did not start correctly and was stopped. Restart ProjectOS."
            }
            ProcessError::DaemonReadyTimeout | ProcessError::DaemonExitedEarly => {
                "The local worker did not become ready and was stopped. Restart ProjectOS."
            }
            ProcessError::DaemonNotReady => "The local worker is not ready for requests yet.",
            ProcessError::LifecycleStateBlocked => {
                "The local worker state could not be read safely. Restart ProjectOS."
            }
            ProcessError::ProductionIdentityUnavailable => {
                "Packaged worker identity unavailable. Protected approvals unavailable."
            }
            ProcessError::PackagedRuntimeNotProvisioned => {
                "Packaged runtime payload is not present in this build. Reinstall an approved release."
            }
            ProcessError::JobObjectCreateFailed
            | ProcessError::JobObjectConfigurationFailed
            | ProcessError::JobMembershipUnverified => {
                "The local worker container could not be established; no worker was started."
            }
            ProcessError::PipeCreateFailed
            | ProcessError::PipeInheritanceConfigurationFailed
            | ProcessError::AttributeListSizeQueryFailed
            | ProcessError::AttributeListInitFailed
            | ProcessError::AttributeListUpdateFailed => {
                "The local worker channel could not be prepared; no worker was started."
            }
            ProcessError::FixtureExecutableRejected
            | ProcessError::ExecutablePathInvalid
            | ProcessError::ExecutablePathNotAbsolute
            | ProcessError::CurrentDirectoryInvalid
            | ProcessError::CommandLineInvalid
            | ProcessError::CommandLineTooLong
            | ProcessError::EnvironmentVariableInvalid => {
                "The local worker launch specification was rejected; no worker was started."
            }
            ProcessError::ProcessCreateFailed => {
                "The local worker could not start; no worker process exists."
            }
            ProcessError::ProcessHandleUnavailable
            | ProcessError::ProcessCreationTimeUnavailable
            | ProcessError::ProcessExitCodeUnavailable => {
                "The local worker could not be observed reliably and was stopped."
            }
            ProcessError::ShutdownTimeout | ProcessError::ForceTerminationFailed => {
                "The local worker did not stop cooperatively and was force-stopped."
            }
            ProcessError::RecoveryEvidenceMalformed
            | ProcessError::RecoveryEvidenceUnsupportedSchema
            | ProcessError::RecoveryEvidenceWriteFailed
            | ProcessError::RecoveryIdentityUnverifiable
            | ProcessError::RecoveryAccessDenied
            | ProcessError::RecoveryTimeout => {
                "ProjectOS could not safely confirm that the previous local worker has stopped. \
                 No new worker was started."
            }
            ProcessError::RecoveryCancelled => {
                "ProjectOS was closed before startup finished. No new worker was started."
            }
            ProcessError::DaemonResumeFailed
            | ProcessError::DaemonUnexpectedSuspendCount
            | ProcessError::ThreadHandleUnavailable => {
                "The local worker did not start correctly and was stopped. Restart ProjectOS."
            }
            ProcessError::InvalidStateTransition | ProcessError::InternalErrorRedacted => {
                "Restart ProjectOS; the local worker was left stopped."
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_wording_never_claims_secure_or_trusted() {
        // Job-binding is containment, not trust. The wording must not imply otherwise.
        for e in [
            ProcessError::UnsupportedPlatform,
            ProcessError::DevRuntimeNotFound,
            ProcessError::DaemonReadyTimeout,
            ProcessError::ProductionIdentityUnavailable,
            ProcessError::JobObjectCreateFailed,
            ProcessError::ProcessCreateFailed,
            ProcessError::ShutdownTimeout,
            ProcessError::InternalErrorRedacted,
        ] {
            let m = e.next_safe_action().to_lowercase();
            assert!(!m.contains("secure"), "{e:?} says 'secure'");
            assert!(!m.contains("trusted"), "{e:?} says 'trusted'");
        }
    }

    #[test]
    fn every_failure_disables_protected_approvals() {
        assert!(ProcessError::DaemonNotReady.protected_approvals_disabled());
        assert!(ProcessError::ProductionIdentityUnavailable.protected_approvals_disabled());
    }

    #[test]
    fn pre_creation_failures_cannot_leave_a_process() {
        for e in [
            ProcessError::DevRuntimeNotFound,
            ProcessError::DevRuntimeOverrideInvalid,
            ProcessError::DevSidecarNotFound,
            ProcessError::EnvironmentVariableInvalid,
            ProcessError::ExecutablePathNotAbsolute,
            ProcessError::ProcessCreateFailed,
            ProcessError::ProductionIdentityUnavailable,
        ] {
            assert!(
                !e.process_may_exist(),
                "{e:?} must not imply a live process"
            );
        }
    }

    #[test]
    fn readiness_failures_imply_a_process_needing_termination() {
        for e in [
            ProcessError::DaemonReadyTimeout,
            ProcessError::DaemonInstanceMismatch,
            ProcessError::LifecycleProtocolMismatch,
        ] {
            assert!(
                e.process_may_exist(),
                "{e:?} leaves a process that must be terminated"
            );
        }
    }
}
