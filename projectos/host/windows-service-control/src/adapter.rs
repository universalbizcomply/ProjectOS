//! The safe public SCM adapter, the backend seam and the sealed live-operation capability. Contains
//! NO Windows call and NO unsafe: all Windows FFI lives behind the [`ScmBackend`] trait, implemented
//! live only in `windows_ffi.rs`. The orchestration logic (post-effect re-read + bounded retry) is
//! pure and fully testable with a deterministic fake backend.

use crate::verification::{
    action_is_non_retryable, default_wait_policy, deletion_is_retryable, run_state_is_retryable,
    verify_created_present, verify_deleted, verify_sid_policy, verify_started, verify_stopped,
    ExactNameState, PostEffectVerdict, RunStateObservation, ScmActionOutcome, SidPolicyObservation,
};

/// A private sealing marker. Because it is private and no function in this crate constructs a
/// [`LiveOperationCapability`], the capability is UNCONSTRUCTIBLE in this phase — not by default code,
/// not by a feature, not by a test, not by elevation. A later, separately-gated phase adds a
/// crate-private constructor reachable only from the accepted owner-approval broker.
#[derive(Debug)]
struct Sealed;

/// The sealed capability that authorises a LIVE SCM operation. It has no public constructor and none
/// is created anywhere in this phase, so every capability-gated method below is unreachable at
/// runtime. Compiled capability is therefore never runtime authority.
#[derive(Debug)]
pub struct LiveOperationCapability {
    _sealed: Sealed,
}

/// ONE owner-approved installation. Not a default, not a flag, and not derivable from elevation:
/// it exists only when the owner has explicitly approved a single controlled installation, and the
/// approval is transcribed here by the exact phrase they used.
///
/// It is move-only and consumed by the capability it authorises, so one approval yields one operation
/// set and cannot be reused for a second installation.
#[cfg(feature = "owner-approved-installation")]
#[derive(Debug)]
pub struct OwnerInstallationApproval {
    _sealed: Sealed,
}

#[cfg(feature = "owner-approved-installation")]
impl OwnerInstallationApproval {
    /// The exact phrase the owner must have given. A near-miss is refused: this transcribes an
    /// approval, it does not interpret one.
    pub const REQUIRED_PHRASE: &'static str =
        "APPROVED: one controlled elevated local installation of ProjectOSHost";

    /// Transcribe the owner's approval.
    ///
    /// # Errors
    /// [`ApprovalRefused`] if the phrase is not exactly [`Self::REQUIRED_PHRASE`].
    pub fn transcribe(phrase: &str) -> Result<Self, ApprovalRefused> {
        if phrase != Self::REQUIRED_PHRASE {
            return Err(ApprovalRefused);
        }
        Ok(Self { _sealed: Sealed })
    }
}

/// The owner approval was not the exact required phrase. Fieldless: it echoes nothing back.
#[cfg(feature = "owner-approved-installation")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApprovalRefused;

#[cfg(feature = "owner-approved-installation")]
impl LiveOperationCapability {
    /// The ONLY production route to a live capability: consume one owner approval.
    ///
    /// Compiled solely under `owner-approved-installation`, which is non-default and is not implied by
    /// `windows-live-scm`. Elevation alone does not produce one, and neither does any test or fixture.
    #[must_use]
    pub fn from_owner_approval(approval: OwnerInstallationApproval) -> Self {
        // The approval is CONSUMED, so it cannot authorise a second installation.
        let OwnerInstallationApproval { _sealed } = approval;
        Self { _sealed }
    }
}

#[cfg(feature = "test-fixtures")]
impl LiveOperationCapability {
    /// FIXTURE-ONLY acquisition, so a dependent consumer can compile and exercise the real
    /// contribution facades without any SCM call. Compiled only under `test-fixtures`, which is
    /// non-default and is NOT implied by `windows-live-scm`.
    ///
    /// This authorises nothing: it carries no authority name, no handle, no credential and no token,
    /// and every live code path additionally requires the Windows feature and a real service handle.
    /// Real live capability production remains absent and owner-gated.
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self { _sealed: Sealed }
    }
}

/// The FIXTURE implementations of the SCM contribution facades.
///
/// They carry the SAME public names and signatures as the live ones in `windows_ffi.rs`, so a
/// dependent orchestrator writes identical code in either graph; only the internal observation source
/// differs. Nothing here opens a service, queries the SCM or touches Win32.
#[cfg(all(
    feature = "test-fixtures",
    not(all(windows, feature = "windows-live-scm"))
))]
mod fixture_facade {
    use projectos_host_windows_service_identity_proof::{
        synthetic_observation, AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved,
        ScmBeforeObserved, ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
    };

    /// The fixed synthetic instance every fixture facade reports. SCM-before, the IPC peer and
    /// SCM-after must agree for the positive flow to bind, so all three use this one selector.
    fn fixture_instance() -> SyntheticInstanceSelector {
        SyntheticInstanceSelector::new(1, 1)
    }

    /// Fixture SCM-before contribution. Same signature as the live facade.
    pub fn contribute_scm_before(
        _capability: &super::LiveOperationCapability,
        attempt: ServiceInstanceBindingAttempt<Prepared>,
    ) -> AttemptOutcome<ScmBeforeObserved> {
        attempt.record_scm_before(synthetic_observation(fixture_instance()))
    }

    /// Fixture SCM-after contribution. Accepts only an attempt that has already observed the peer, so
    /// the SCM-before -> IPC -> SCM-after order is enforced by the type in the fixture graph too.
    pub fn contribute_scm_after(
        _capability: &super::LiveOperationCapability,
        attempt: ServiceInstanceBindingAttempt<IpcPeerObserved>,
    ) -> AttemptOutcome<ScmAfterObserved> {
        attempt.record_scm_after(synthetic_observation(fixture_instance()))
    }
}

#[cfg(all(
    feature = "test-fixtures",
    not(all(windows, feature = "windows-live-scm"))
))]
pub use fixture_facade::{contribute_scm_after, contribute_scm_before};

/// The backend seam between the safe adapter and the Windows SCM. Every method takes closed inputs and
/// returns a closed, redacted classification — no raw handle, SID, name, path or Win32 error crosses
/// it. The live implementation lives in `windows_ffi.rs`; tests use a deterministic fake.
pub trait ScmBackend {
    /// The exact-name state of the ProjectOSHost service (no enumeration).
    fn open_state(&self) -> ExactNameState;
    /// Attempt to create the approved ProjectOSHost service.
    fn create(&self) -> ScmActionOutcome;
    /// Attempt to configure `SERVICE_SID_TYPE_UNRESTRICTED`.
    fn configure_sid_unrestricted(&self) -> ScmActionOutcome;
    /// AUTHORITATIVELY re-read and classify the observed service-SID policy (never a cached/expected
    /// value; never the mutation's success return).
    fn sid_policy_observation(&self) -> SidPolicyObservation;
    /// Attempt a demand start.
    fn start(&self) -> ScmActionOutcome;
    /// The current run state of the exact service.
    fn run_state(&self) -> RunStateObservation;
    /// Request a normal stop (never terminates a process).
    fn stop(&self) -> ScmActionOutcome;
    /// Delete the exact service.
    fn delete(&self) -> ScmActionOutcome;
    /// Perform any bounded inter-attempt wait. No-op in tests; a bounded sleep live.
    fn wait_between_attempts(&self);
}

/// The outcome of a bounded lifecycle operation: the action plus its authoritative re-read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LifecycleOutcome {
    /// The action succeeded AND the confirming re-read verified it.
    Confirmed,
    /// The operation was refused, with an exact reason.
    Refused(LifecycleRefusal),
    /// The operation could not be confirmed — fail closed.
    Indeterminate,
}

/// The exact typed lifecycle refusal reasons. Fieldless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LifecycleRefusal {
    /// A create was requested but the service is already present.
    AlreadyPresent,
    /// The service is marked for deletion and must not be overwritten.
    MarkedForDeletion,
    /// An unexpected existing service must not be modified.
    UnexpectedExistingService,
    /// Access was denied.
    AccessDenied,
    /// The service does not exist for the requested operation.
    DoesNotExist,
    /// The SID policy configuration was not observed after the change.
    SidPolicyNotObserved,
    /// A bare API success was not confirmed by a re-read.
    SuccessWithoutReread,
    /// The verified state contradicts the expected post-effect condition.
    PostEffectMismatch,
    /// A bounded wait expired before the expected state was reached.
    WaitTimedOut,
}

/// The bounded SCM adapter, generic over the backend so it is testable without Windows.
#[derive(Debug)]
pub struct ScmServiceAdapter<B: ScmBackend> {
    backend: B,
}

impl<B: ScmBackend> ScmServiceAdapter<B> {
    /// Construct an adapter over a backend.
    #[must_use]
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    // -------- Capability-gated LIVE entry points. Unreachable this phase (no capability exists). -----

    /// Verify the exact-name state (live). Requires the sealed capability.
    #[must_use]
    pub fn verify_exact_state(&self, _cap: &LiveOperationCapability) -> ExactNameState {
        self.verify_exact_state_logic()
    }
    /// Create the approved service (live). Requires the sealed capability.
    #[must_use]
    pub fn create(&self, _cap: &LiveOperationCapability) -> LifecycleOutcome {
        self.create_logic()
    }
    /// Configure the UNRESTRICTED service-SID policy (live). Requires the sealed capability.
    #[must_use]
    pub fn configure_sid(&self, _cap: &LiveOperationCapability) -> LifecycleOutcome {
        self.configure_sid_logic()
    }
    /// Demand-start the service (live). Requires the sealed capability.
    #[must_use]
    pub fn start(&self, _cap: &LiveOperationCapability) -> LifecycleOutcome {
        self.start_logic()
    }
    /// AUTHORITATIVELY re-read the observed service-SID policy (live). Requires the sealed
    /// capability. This is the observation itself, never a cached or expected value.
    #[must_use]
    pub fn sid_policy(&self, _cap: &LiveOperationCapability) -> SidPolicyObservation {
        self.backend.sid_policy_observation()
    }
    /// Query the run state (live). Requires the sealed capability.
    #[must_use]
    pub fn query(&self, _cap: &LiveOperationCapability) -> RunStateObservation {
        self.backend.run_state()
    }
    /// Request a normal stop (live). Requires the sealed capability.
    #[must_use]
    pub fn stop(&self, _cap: &LiveOperationCapability) -> LifecycleOutcome {
        self.stop_logic()
    }
    /// Delete the service (live). Requires the sealed capability.
    #[must_use]
    pub fn delete(&self, _cap: &LiveOperationCapability) -> LifecycleOutcome {
        self.delete_logic()
    }

    // -------- Pure orchestration logic. Tested directly with a fake backend (no capability). --------

    pub(crate) fn verify_exact_state_logic(&self) -> ExactNameState {
        self.backend.open_state()
    }

    pub(crate) fn create_logic(&self) -> LifecycleOutcome {
        // Never overwrite a present / marked-for-deletion / unexpected service.
        match self.backend.open_state() {
            ExactNameState::Absent => {}
            ExactNameState::Present => {
                return LifecycleOutcome::Refused(LifecycleRefusal::AlreadyPresent)
            }
            ExactNameState::MarkedForDeletion => {
                return LifecycleOutcome::Refused(LifecycleRefusal::MarkedForDeletion)
            }
            ExactNameState::AccessDenied => {
                return LifecycleOutcome::Refused(LifecycleRefusal::AccessDenied)
            }
            ExactNameState::Unavailable | ExactNameState::Unexpected => {
                return LifecycleOutcome::Refused(LifecycleRefusal::UnexpectedExistingService)
            }
        }
        // Attempt the create. Any non-success fails closed (no automatic retry).
        match self.backend.create() {
            ScmActionOutcome::Succeeded => {}
            other => return refuse_action(other),
        }
        // Authoritative re-read — a bare success is never proof.
        into_outcome(verify_created_present(self.backend.open_state()))
    }

    pub(crate) fn configure_sid_logic(&self) -> LifecycleOutcome {
        match self.backend.configure_sid_unrestricted() {
            ScmActionOutcome::Succeeded => {}
            other => return refuse_action(other),
        }
        // A successful ChangeServiceConfig2 return is NOT proof: authoritatively re-read the policy.
        match verify_sid_policy(self.backend.sid_policy_observation()) {
            PostEffectVerdict::Verified => LifecycleOutcome::Confirmed,
            PostEffectVerdict::Refused(_) => {
                LifecycleOutcome::Refused(LifecycleRefusal::SidPolicyNotObserved)
            }
            PostEffectVerdict::Indeterminate => LifecycleOutcome::Indeterminate,
        }
    }

    pub(crate) fn start_logic(&self) -> LifecycleOutcome {
        match self.backend.start() {
            ScmActionOutcome::Succeeded => {}
            other => return refuse_action(other),
        }
        self.wait_for(verify_started)
    }

    pub(crate) fn stop_logic(&self) -> LifecycleOutcome {
        match self.backend.stop() {
            ScmActionOutcome::Succeeded => {}
            other => return refuse_action(other),
        }
        self.wait_for(verify_stopped)
    }

    pub(crate) fn delete_logic(&self) -> LifecycleOutcome {
        // Verify exact identity present before deleting.
        match self.backend.open_state() {
            ExactNameState::Present => {}
            ExactNameState::Absent => {
                return LifecycleOutcome::Refused(LifecycleRefusal::DoesNotExist)
            }
            ExactNameState::AccessDenied => {
                return LifecycleOutcome::Refused(LifecycleRefusal::AccessDenied)
            }
            ExactNameState::MarkedForDeletion
            | ExactNameState::Unavailable
            | ExactNameState::Unexpected => return LifecycleOutcome::Indeterminate,
        }
        match self.backend.delete() {
            ScmActionOutcome::Succeeded => {}
            other => return refuse_action(other),
        }
        // Confirm deletion by bounded re-open until Absent (MarkedForDeletion is retryable).
        self.confirm_deleted()
    }

    fn confirm_deleted(&self) -> LifecycleOutcome {
        let policy = default_wait_policy();
        for attempt in 0..policy.max_attempts() {
            let state = self.backend.open_state();
            match verify_deleted(state) {
                PostEffectVerdict::Verified => return LifecycleOutcome::Confirmed,
                PostEffectVerdict::Refused(_) if deletion_is_retryable(state) => {
                    if attempt + 1 < policy.max_attempts() {
                        self.backend.wait_between_attempts();
                        continue;
                    }
                    return LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut);
                }
                PostEffectVerdict::Refused(_) => {
                    return LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
                }
                PostEffectVerdict::Indeterminate => return LifecycleOutcome::Indeterminate,
            }
        }
        LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut)
    }

    /// Bounded poll of the run state until `verify` yields a terminal verdict.
    fn wait_for(
        &self,
        verify: impl Fn(RunStateObservation) -> PostEffectVerdict,
    ) -> LifecycleOutcome {
        let policy = default_wait_policy();
        for attempt in 0..policy.max_attempts() {
            let state = self.backend.run_state();
            match verify(state) {
                PostEffectVerdict::Verified => return LifecycleOutcome::Confirmed,
                PostEffectVerdict::Refused(_) if run_state_is_retryable(state) => {
                    if attempt + 1 < policy.max_attempts() {
                        self.backend.wait_between_attempts();
                        continue;
                    }
                    return LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut);
                }
                PostEffectVerdict::Refused(_) => {
                    return LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
                }
                PostEffectVerdict::Indeterminate => return LifecycleOutcome::Indeterminate,
            }
        }
        LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut)
    }
}

/// Map a non-success action outcome to a fail-closed lifecycle refusal (never retried automatically).
fn refuse_action(outcome: ScmActionOutcome) -> LifecycleOutcome {
    // Only non-retryable outcomes ever reach here (an action is attempted exactly once).
    debug_assert!(action_is_non_retryable(outcome) || outcome == ScmActionOutcome::Succeeded);
    match outcome {
        ScmActionOutcome::AccessDenied => LifecycleOutcome::Refused(LifecycleRefusal::AccessDenied),
        ScmActionOutcome::AlreadyExists => {
            LifecycleOutcome::Refused(LifecycleRefusal::AlreadyPresent)
        }
        ScmActionOutcome::DoesNotExist => LifecycleOutcome::Refused(LifecycleRefusal::DoesNotExist),
        ScmActionOutcome::MarkedForDeletion => {
            LifecycleOutcome::Refused(LifecycleRefusal::MarkedForDeletion)
        }
        ScmActionOutcome::Uncertain | ScmActionOutcome::Unexpected => {
            LifecycleOutcome::Indeterminate
        }
        ScmActionOutcome::Succeeded => LifecycleOutcome::Indeterminate,
    }
}

/// Convert a post-effect verdict into a lifecycle outcome.
fn into_outcome(verdict: PostEffectVerdict) -> LifecycleOutcome {
    match verdict {
        PostEffectVerdict::Verified => LifecycleOutcome::Confirmed,
        PostEffectVerdict::Refused(_) => {
            LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
        }
        PostEffectVerdict::Indeterminate => LifecycleOutcome::Indeterminate,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;

    /// A deterministic fake backend. It performs NO Windows call: every response is scripted, so the
    /// adapter logic is proven without SCM, a service, a handle or any effect. Waits are counted, not
    /// slept.
    #[derive(Default)]
    struct FakeBackend {
        open_states: RefCell<VecDeque<ExactNameState>>,
        default_open: Option<ExactNameState>,
        create: Option<ScmActionOutcome>,
        configure_sid: Option<ScmActionOutcome>,
        sid_policy: Option<SidPolicyObservation>,
        start: Option<ScmActionOutcome>,
        run_states: RefCell<VecDeque<RunStateObservation>>,
        default_run: Option<RunStateObservation>,
        stop: Option<ScmActionOutcome>,
        delete: Option<ScmActionOutcome>,
        waits: Cell<u32>,
    }

    impl FakeBackend {
        fn open_seq(states: &[ExactNameState]) -> Self {
            Self {
                open_states: RefCell::new(states.iter().copied().collect()),
                ..Self::default()
            }
        }
    }

    impl ScmBackend for FakeBackend {
        fn open_state(&self) -> ExactNameState {
            self.open_states
                .borrow_mut()
                .pop_front()
                .or(self.default_open)
                .unwrap_or(ExactNameState::Unexpected)
        }
        fn create(&self) -> ScmActionOutcome {
            self.create.unwrap_or(ScmActionOutcome::Succeeded)
        }
        fn configure_sid_unrestricted(&self) -> ScmActionOutcome {
            self.configure_sid.unwrap_or(ScmActionOutcome::Succeeded)
        }
        fn sid_policy_observation(&self) -> SidPolicyObservation {
            self.sid_policy
                .unwrap_or(SidPolicyObservation::UnrestrictedObserved)
        }
        fn start(&self) -> ScmActionOutcome {
            self.start.unwrap_or(ScmActionOutcome::Succeeded)
        }
        fn run_state(&self) -> RunStateObservation {
            self.run_states
                .borrow_mut()
                .pop_front()
                .or(self.default_run)
                .unwrap_or(RunStateObservation::Unexpected)
        }
        fn stop(&self) -> ScmActionOutcome {
            self.stop.unwrap_or(ScmActionOutcome::Succeeded)
        }
        fn delete(&self) -> ScmActionOutcome {
            self.delete.unwrap_or(ScmActionOutcome::Succeeded)
        }
        fn wait_between_attempts(&self) {
            self.waits.set(self.waits.get() + 1);
        }
    }

    fn adapter(b: FakeBackend) -> ScmServiceAdapter<FakeBackend> {
        ScmServiceAdapter::new(b)
    }

    #[test]
    fn create_confirms_only_after_verified_reread() {
        // open_state: Absent (pre-check) then Present (re-read) → Confirmed.
        let a = adapter(FakeBackend::open_seq(&[
            ExactNameState::Absent,
            ExactNameState::Present,
        ]));
        assert_eq!(a.create_logic(), LifecycleOutcome::Confirmed);
    }

    #[test]
    fn create_success_without_present_reread_is_refused() {
        // create() succeeds but the re-read is still Absent → NOT confirmed (success alone insufficient).
        let a = adapter(FakeBackend::open_seq(&[
            ExactNameState::Absent,
            ExactNameState::Absent,
        ]));
        assert_eq!(
            a.create_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
        );
    }

    #[test]
    fn create_refuses_when_already_present() {
        let a = adapter(FakeBackend::open_seq(&[ExactNameState::Present]));
        assert_eq!(
            a.create_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::AlreadyPresent)
        );
    }

    #[test]
    fn create_refuses_marked_for_deletion() {
        let a = adapter(FakeBackend::open_seq(&[ExactNameState::MarkedForDeletion]));
        assert_eq!(
            a.create_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::MarkedForDeletion)
        );
    }

    #[test]
    fn create_access_denied_pre_check_fails_closed() {
        let a = adapter(FakeBackend::open_seq(&[ExactNameState::AccessDenied]));
        assert_eq!(
            a.create_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::AccessDenied)
        );
    }

    #[test]
    fn create_action_access_denied_is_non_retryable() {
        let b = FakeBackend {
            open_states: RefCell::new([ExactNameState::Absent].into_iter().collect()),
            create: Some(ScmActionOutcome::AccessDenied),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).create_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::AccessDenied)
        );
    }

    #[test]
    fn config_success_alone_does_not_confirm_sid_policy() {
        // ChangeServiceConfig2 succeeds, but the authoritative re-read observes NONE → NOT confirmed.
        let b = FakeBackend {
            sid_policy: Some(SidPolicyObservation::NoneObserved),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).configure_sid_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::SidPolicyNotObserved)
        );
    }

    #[test]
    fn unrestricted_reread_confirms_sid_policy() {
        let b = FakeBackend {
            sid_policy: Some(SidPolicyObservation::UnrestrictedObserved),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).configure_sid_logic(),
            LifecycleOutcome::Confirmed
        );
    }

    #[test]
    fn restricted_reread_fails_closed() {
        let b = FakeBackend {
            sid_policy: Some(SidPolicyObservation::RestrictedObserved),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).configure_sid_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::SidPolicyNotObserved)
        );
    }

    #[test]
    fn unavailable_sid_query_does_not_confirm() {
        for obs in [
            SidPolicyObservation::BufferOrQueryUnavailable,
            SidPolicyObservation::AccessDenied,
            SidPolicyObservation::ServiceAbsent,
            SidPolicyObservation::MarkedForDeletion,
            SidPolicyObservation::VerificationFailed,
        ] {
            let b = FakeBackend {
                sid_policy: Some(obs),
                ..Default::default()
            };
            assert_ne!(
                adapter(b).configure_sid_logic(),
                LifecycleOutcome::Confirmed
            );
        }
    }

    #[test]
    fn start_confirmed_after_pending_then_running() {
        let b = FakeBackend {
            run_states: RefCell::new(
                [
                    RunStateObservation::StartPending,
                    RunStateObservation::Running,
                ]
                .into_iter()
                .collect(),
            ),
            ..Default::default()
        };
        assert_eq!(adapter(b).start_logic(), LifecycleOutcome::Confirmed);
    }

    #[test]
    fn start_success_but_stopped_reread_is_refused() {
        let b = FakeBackend {
            default_run: Some(RunStateObservation::Stopped),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).start_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
        );
    }

    #[test]
    fn start_pending_forever_times_out_bounded() {
        let b = FakeBackend {
            default_run: Some(RunStateObservation::StartPending), // never resolves
            ..Default::default()
        };
        assert_eq!(
            adapter(b).start_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut)
        );
    }

    #[test]
    fn stop_confirmed_after_stopped_reread() {
        let b = FakeBackend {
            default_run: Some(RunStateObservation::Stopped),
            ..Default::default()
        };
        assert_eq!(adapter(b).stop_logic(), LifecycleOutcome::Confirmed);
    }

    #[test]
    fn delete_confirms_only_after_absent_reread() {
        // open_state: Present (identity), then Absent (confirm) → Confirmed.
        let a = adapter(FakeBackend::open_seq(&[
            ExactNameState::Present,
            ExactNameState::Absent,
        ]));
        assert_eq!(a.delete_logic(), LifecycleOutcome::Confirmed);
    }

    #[test]
    fn delete_success_but_still_present_is_refused() {
        // Present (identity) then Present forever → DeleteService success is NOT deletion proof.
        let b = FakeBackend {
            open_states: RefCell::new([ExactNameState::Present].into_iter().collect()),
            default_open: Some(ExactNameState::Present),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).delete_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::PostEffectMismatch)
        );
    }

    #[test]
    fn delete_marked_for_deletion_retries_bounded_then_times_out() {
        // Present (identity) then MarkedForDeletion forever → retryable but bounded → WaitTimedOut.
        let b = FakeBackend {
            open_states: RefCell::new([ExactNameState::Present].into_iter().collect()),
            default_open: Some(ExactNameState::MarkedForDeletion),
            ..Default::default()
        };
        assert_eq!(
            adapter(b).delete_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::WaitTimedOut)
        );
    }

    #[test]
    fn delete_nonexistent_is_refused() {
        let a = adapter(FakeBackend::open_seq(&[ExactNameState::Absent]));
        assert_eq!(
            a.delete_logic(),
            LifecycleOutcome::Refused(LifecycleRefusal::DoesNotExist)
        );
    }
}
