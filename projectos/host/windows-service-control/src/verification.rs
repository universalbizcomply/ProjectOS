//! Pure, effect-free closed classifications, Win32 redaction, post-effect verdicts and bounded-retry
//! policy for the SCM adapter. Contains NO Windows call and NO unsafe.

/// The exact-name state of the ProjectOSHost service. No other service is ever observed. Redacted —
/// carries no raw handle, name or error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ExactNameState {
    /// The service does not exist.
    Absent,
    /// The service exists.
    Present,
    /// The service exists but is marked for deletion.
    MarkedForDeletion,
    /// Access to the service/SCM was denied.
    AccessDenied,
    /// The SCM/service could not be reached or read.
    Unavailable,
    /// An unexpected condition was observed — fail closed.
    Unexpected,
}

/// A redacted run-state observation of the exact service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RunStateObservation {
    /// The service is running.
    Running,
    /// The service is stopped.
    Stopped,
    /// Start is pending.
    StartPending,
    /// Stop is pending.
    StopPending,
    /// The state could not be read — fail closed.
    StateUnavailable,
    /// An unexpected state — fail closed.
    Unexpected,
}

/// The redacted outcome of a mutating SCM attempt (create/config/start/stop/delete). A `Succeeded`
/// here is only the raw API return — it is NEVER treated as proof; an authoritative re-read follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ScmActionOutcome {
    /// The API returned success (still requires post-effect verification).
    Succeeded,
    /// Access denied.
    AccessDenied,
    /// The service already exists.
    AlreadyExists,
    /// The service does not exist.
    DoesNotExist,
    /// The service is marked for deletion.
    MarkedForDeletion,
    /// The result is uncertain — fail closed.
    Uncertain,
    /// An unexpected condition — fail closed.
    Unexpected,
}

/// Redact a Win32 error code into an [`ExactNameState`] for a query/open. No raw code or message
/// escapes.
#[must_use]
pub fn classify_open_error(win32: u32) -> ExactNameState {
    match win32 {
        ERROR_SERVICE_DOES_NOT_EXIST => ExactNameState::Absent,
        ERROR_SERVICE_MARKED_FOR_DELETE => ExactNameState::MarkedForDeletion,
        ERROR_ACCESS_DENIED => ExactNameState::AccessDenied,
        _ => ExactNameState::Unexpected,
    }
}

/// Redact a Win32 error code into a [`ScmActionOutcome`] for a mutating attempt.
#[must_use]
pub fn classify_action_error(win32: u32) -> ScmActionOutcome {
    match win32 {
        ERROR_ACCESS_DENIED => ScmActionOutcome::AccessDenied,
        ERROR_SERVICE_EXISTS | ERROR_SERVICE_ALREADY_RUNNING => ScmActionOutcome::AlreadyExists,
        ERROR_SERVICE_DOES_NOT_EXIST => ScmActionOutcome::DoesNotExist,
        ERROR_SERVICE_MARKED_FOR_DELETE => ScmActionOutcome::MarkedForDeletion,
        _ => ScmActionOutcome::Unexpected,
    }
}

// The minimum Win32 error codes we classify. Named locally so no windows dependency leaks into the
// pure verification layer; the values are part of the stable Win32 ABI.
const ERROR_ACCESS_DENIED: u32 = 5;
const ERROR_SERVICE_DOES_NOT_EXIST: u32 = 1060;
const ERROR_SERVICE_ALREADY_RUNNING: u32 = 1056;
const ERROR_SERVICE_EXISTS: u32 = 1073;
const ERROR_SERVICE_MARKED_FOR_DELETE: u32 = 1072;

/// The verdict of an authoritative post-effect verification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PostEffectVerdict {
    /// The observed state matches the required post-effect condition.
    Verified,
    /// The observed state does not match — fail closed, with a reason.
    Refused(PostEffectRefusal),
    /// The state could not be determined — fail closed.
    Indeterminate,
}

/// The exact typed post-effect refusal reasons. Fieldless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PostEffectRefusal {
    /// After a create, the service is not present.
    CreatedButNotPresent,
    /// After a SID-policy configuration, the expected policy is not observed.
    SidPolicyNotObserved,
    /// After a start, the service is not running.
    StartedButNotRunning,
    /// After a stop, the service is not stopped.
    StoppedButStillRunning,
    /// After a delete, the service is still present.
    DeletedButStillPresent,
    /// A bare API success was observed without a confirming re-read.
    SuccessWithoutReread,
}

/// Verify that a create is confirmed by the re-read exact-name state.
#[must_use]
pub fn verify_created_present(observed: ExactNameState) -> PostEffectVerdict {
    match observed {
        ExactNameState::Present => PostEffectVerdict::Verified,
        ExactNameState::Absent | ExactNameState::MarkedForDeletion => {
            PostEffectVerdict::Refused(PostEffectRefusal::CreatedButNotPresent)
        }
        ExactNameState::AccessDenied | ExactNameState::Unavailable | ExactNameState::Unexpected => {
            PostEffectVerdict::Indeterminate
        }
    }
}

/// Verify that a start is confirmed by the re-read run state.
#[must_use]
pub fn verify_started(observed: RunStateObservation) -> PostEffectVerdict {
    match observed {
        RunStateObservation::Running => PostEffectVerdict::Verified,
        RunStateObservation::Stopped
        | RunStateObservation::StartPending
        | RunStateObservation::StopPending => {
            PostEffectVerdict::Refused(PostEffectRefusal::StartedButNotRunning)
        }
        RunStateObservation::StateUnavailable | RunStateObservation::Unexpected => {
            PostEffectVerdict::Indeterminate
        }
    }
}

/// Verify that a stop is confirmed by the re-read run state.
#[must_use]
pub fn verify_stopped(observed: RunStateObservation) -> PostEffectVerdict {
    match observed {
        RunStateObservation::Stopped => PostEffectVerdict::Verified,
        RunStateObservation::Running
        | RunStateObservation::StartPending
        | RunStateObservation::StopPending => {
            PostEffectVerdict::Refused(PostEffectRefusal::StoppedButStillRunning)
        }
        RunStateObservation::StateUnavailable | RunStateObservation::Unexpected => {
            PostEffectVerdict::Indeterminate
        }
    }
}

/// Verify that a delete is confirmed by the re-read exact-name state (absence).
#[must_use]
pub fn verify_deleted(observed: ExactNameState) -> PostEffectVerdict {
    match observed {
        ExactNameState::Absent => PostEffectVerdict::Verified,
        ExactNameState::Present | ExactNameState::MarkedForDeletion => {
            PostEffectVerdict::Refused(PostEffectRefusal::DeletedButStillPresent)
        }
        ExactNameState::AccessDenied | ExactNameState::Unavailable | ExactNameState::Unexpected => {
            PostEffectVerdict::Indeterminate
        }
    }
}

/// The redacted result of an AUTHORITATIVE re-read of the service-SID policy (via a
/// `QueryServiceConfig2`-style query of `SERVICE_CONFIG_SERVICE_SID_INFO`). It carries no raw SID,
/// service name, configuration buffer, Win32 code or pointer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SidPolicyObservation {
    /// The observed policy is `SERVICE_SID_TYPE_UNRESTRICTED` (the baseline).
    UnrestrictedObserved,
    /// The observed policy is `SERVICE_SID_TYPE_NONE`.
    NoneObserved,
    /// The observed policy is `SERVICE_SID_TYPE_RESTRICTED`.
    RestrictedObserved,
    /// The service was absent at re-read.
    ServiceAbsent,
    /// Access was denied at re-read.
    AccessDenied,
    /// The service was marked for deletion.
    MarkedForDeletion,
    /// The query buffer/size could not be obtained.
    BufferOrQueryUnavailable,
    /// An unrecognised SID-policy value was observed.
    UnexpectedConfiguration,
    /// The verification query itself failed.
    VerificationFailed,
}

/// Classify a raw `dwServiceSidType` value into a redacted [`SidPolicyObservation`].
#[must_use]
pub fn classify_sid_type(sid_type: u32) -> SidPolicyObservation {
    match sid_type {
        SERVICE_SID_TYPE_UNRESTRICTED => SidPolicyObservation::UnrestrictedObserved,
        SERVICE_SID_TYPE_NONE => SidPolicyObservation::NoneObserved,
        SERVICE_SID_TYPE_RESTRICTED => SidPolicyObservation::RestrictedObserved,
        _ => SidPolicyObservation::UnexpectedConfiguration,
    }
}

/// Classify a Win32 error from the SID-policy query into a redacted [`SidPolicyObservation`].
#[must_use]
pub fn classify_sid_query_error(win32: u32) -> SidPolicyObservation {
    match win32 {
        ERROR_SERVICE_DOES_NOT_EXIST => SidPolicyObservation::ServiceAbsent,
        ERROR_ACCESS_DENIED => SidPolicyObservation::AccessDenied,
        ERROR_SERVICE_MARKED_FOR_DELETE => SidPolicyObservation::MarkedForDeletion,
        ERROR_INSUFFICIENT_BUFFER => SidPolicyObservation::BufferOrQueryUnavailable,
        _ => SidPolicyObservation::VerificationFailed,
    }
}

// SID-policy values (stable Win32 ABI). RESTRICTED is not exported by the windows crate feature in use.
const SERVICE_SID_TYPE_NONE: u32 = 0;
const SERVICE_SID_TYPE_UNRESTRICTED: u32 = 1;
const SERVICE_SID_TYPE_RESTRICTED: u32 = 3;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

/// Verify the service-SID policy from an authoritative re-read. Only `UnrestrictedObserved` confirms;
/// a definitively-wrong policy is refused; any unavailable/failed read is indeterminate (fail closed).
/// A successful `ChangeServiceConfig2` return is NEVER passed here — only an observed policy is.
#[must_use]
pub fn verify_sid_policy(observed: SidPolicyObservation) -> PostEffectVerdict {
    match observed {
        SidPolicyObservation::UnrestrictedObserved => PostEffectVerdict::Verified,
        SidPolicyObservation::NoneObserved
        | SidPolicyObservation::RestrictedObserved
        | SidPolicyObservation::UnexpectedConfiguration => {
            PostEffectVerdict::Refused(PostEffectRefusal::SidPolicyNotObserved)
        }
        SidPolicyObservation::ServiceAbsent
        | SidPolicyObservation::AccessDenied
        | SidPolicyObservation::MarkedForDeletion
        | SidPolicyObservation::BufferOrQueryUnavailable
        | SidPolicyObservation::VerificationFailed => PostEffectVerdict::Indeterminate,
    }
}

/// A bounded, deterministic retry policy. Timing is abstracted (the backend performs any wait), so
/// unit tests never sleep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    max_attempts: u32,
}

impl RetryPolicy {
    /// The bounded policy for waiting on a transient state.
    #[must_use]
    pub fn bounded(max_attempts: u32) -> Self {
        Self {
            max_attempts: max_attempts.clamp(1, MAX_ATTEMPTS_CEILING),
        }
    }

    /// The maximum number of attempts.
    #[must_use]
    pub fn max_attempts(self) -> u32 {
        self.max_attempts
    }
}

/// The hard ceiling on retry attempts — guarantees no unbounded loop.
pub const MAX_ATTEMPTS_CEILING: u32 = 50;

/// The default bounded policy for running/stopped/deletion waits.
#[must_use]
pub fn default_wait_policy() -> RetryPolicy {
    RetryPolicy::bounded(20)
}

/// Which conditions are retryable while waiting, and which fail closed immediately.
#[must_use]
pub fn run_state_is_retryable(observed: RunStateObservation) -> bool {
    matches!(
        observed,
        RunStateObservation::StartPending | RunStateObservation::StopPending
    )
}

/// Whether an exact-name state is retryable while confirming deletion (MarkedForDeletion may clear).
#[must_use]
pub fn deletion_is_retryable(observed: ExactNameState) -> bool {
    matches!(observed, ExactNameState::MarkedForDeletion)
}

/// Non-retryable action outcomes fail closed immediately (no automatic retry).
#[must_use]
pub fn action_is_non_retryable(outcome: ScmActionOutcome) -> bool {
    matches!(
        outcome,
        ScmActionOutcome::AccessDenied
            | ScmActionOutcome::AlreadyExists
            | ScmActionOutcome::MarkedForDeletion
            | ScmActionOutcome::Uncertain
            | ScmActionOutcome::Unexpected
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_errors_redact_to_states() {
        assert_eq!(classify_open_error(1060), ExactNameState::Absent);
        assert_eq!(classify_open_error(1072), ExactNameState::MarkedForDeletion);
        assert_eq!(classify_open_error(5), ExactNameState::AccessDenied);
        assert_eq!(classify_open_error(999999), ExactNameState::Unexpected);
    }

    #[test]
    fn create_verified_only_when_present() {
        assert_eq!(
            verify_created_present(ExactNameState::Present),
            PostEffectVerdict::Verified
        );
        assert_eq!(
            verify_created_present(ExactNameState::Absent),
            PostEffectVerdict::Refused(PostEffectRefusal::CreatedButNotPresent)
        );
        assert_eq!(
            verify_created_present(ExactNameState::AccessDenied),
            PostEffectVerdict::Indeterminate
        );
    }

    #[test]
    fn delete_verified_only_when_absent() {
        assert_eq!(
            verify_deleted(ExactNameState::Absent),
            PostEffectVerdict::Verified
        );
        assert_eq!(
            verify_deleted(ExactNameState::Present),
            PostEffectVerdict::Refused(PostEffectRefusal::DeletedButStillPresent)
        );
    }

    #[test]
    fn retry_policy_is_bounded() {
        assert_eq!(
            RetryPolicy::bounded(1000).max_attempts(),
            MAX_ATTEMPTS_CEILING
        );
        assert_eq!(RetryPolicy::bounded(0).max_attempts(), 1);
        assert!(default_wait_policy().max_attempts() <= MAX_ATTEMPTS_CEILING);
    }

    #[test]
    fn access_denied_is_non_retryable() {
        assert!(action_is_non_retryable(ScmActionOutcome::AccessDenied));
        assert!(action_is_non_retryable(ScmActionOutcome::Uncertain));
        assert!(!run_state_is_retryable(RunStateObservation::Running));
        assert!(run_state_is_retryable(RunStateObservation::StartPending));
    }
}
