//! Opaque Windows SERVICE-INSTANCE identity shared by the IPC and SCM evidence sources
//! (3K-I-D-E-C-CAPABILITY-B4-CROSS-SOURCE-BINDING-CONTRACT1A).
//!
//! A live ProjectOSHost proof must eventually show that the peer authenticated over local IPC and the
//! ProjectOSHost service observed through the SCM are the SAME running Windows process instance.
//! Service-name equality, a peer-DECLARED role, timestamp proximity and an IPC-only nonce are all
//! insufficient — none of them is an OS-derived instance fact.
//!
//! The canonical instance identity is therefore:
//!
//! ```text
//! ServiceInstanceIdentity = OS-observed ProcessId + OS-observed process creation time
//! ```
//!
//! The process ID ALONE is deliberately not sufficient: Windows reuses process IDs, so a later
//! unrelated process could otherwise impersonate an earlier instance. Both components are mandatory
//! and both are captured from Windows itself, never from a caller.
//!
//! ## Why this module owns the token
//!
//! A sibling crate cannot be trusted to assemble a token from raw parts it supplies, because a caller
//! able to name the parts is a caller able to forge the identity. [`ServiceInstanceToken`] therefore
//! has a PRIVATE representation, no public constructor, no `from_pid`, no `new(pid, time)`, no raw
//! accessor, no `Display`, no serialisation and a fully redacted `Debug`. The only construction path
//! is crate-private and is reached exclusively from this crate's own OS observation functions
//! (`instance_ffi`), which obtain both components from Windows on a BORROWED live handle.
//!
//! The token is proof-attempt evidence only. It is not durable identity and has no persistence
//! contract.
//!
//! ## Decision cores
//!
//! The observation ORDERING and every refusal are decided by the portable, deterministic
//! [`decide_pipe_peer`] / [`decide_service`] cores below. `instance_ffi` only gathers facts from
//! Windows and hands them to these cores, so the whole refusal matrix is exercised by fake-backed unit
//! tests that call no Windows API.

use core::fmt;

/// Private marker making [`LiveInstanceObservationCapability`] unconstructible outside this module —
/// and nothing inside this module constructs one either. Compiling the observation code is therefore
/// never authority to run it.
#[derive(Debug)]
struct Sealed;

/// Sealed, UNCONSTRUCTIBLE authority to perform a live OS instance observation.
///
/// There is no public constructor, no `Default`, no feature-gated constructor and no test constructor.
/// Enabling the Windows observation feature compiles the FFI but cannot produce this value, so no live
/// observation is reachable in any build.
#[derive(Debug)]
pub struct LiveInstanceObservationCapability {
    _sealed: Sealed,
}

/// An OPAQUE, OS-derived Windows service-instance identity.
///
/// Internally this is the observed process ID PLUS the observed process creation time; neither is
/// readable. The only permitted operation is equality against another token, so a comparison can prove
/// "same running instance" without ever exposing raw identity.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ServiceInstanceToken {
    /// OS-observed process ID. Never exposed; never accepted from a caller.
    process_id: u32,
    /// OS-observed process creation time (FILETIME as a single unsigned value). Never exposed; never
    /// accepted from a caller. Its presence is what defeats process-ID reuse.
    creation_time: u64,
}

impl ServiceInstanceToken {
    /// The ONLY constructor. Crate-private, so no sibling crate and no external caller can build a
    /// token from raw values; it is reached only from this crate's own Windows observation code after
    /// both components were read from the OS.
    ///
    /// Fails closed when either component is absent: a zero process ID is never valid, and a missing
    /// creation time must never degrade to a process-ID-only identity.
    ///
    /// Compiled only where a token can legitimately originate — the OS observation FFI, and this
    /// crate's own tests. The default effect-free build has no constructor for a token at all.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn from_observed_parts(process_id: u32, creation_time: u64) -> Option<Self> {
        if process_id == 0 || creation_time == 0 {
            return None;
        }
        Some(Self {
            process_id,
            creation_time,
        })
    }
}

impl fmt::Debug for ServiceInstanceToken {
    /// Fully redacted. No process ID, creation time, hash, prefix or fingerprint is rendered — a
    /// stable fingerprint would itself be a correlatable identity leak.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ServiceInstanceToken([REDACTED])")
    }
}

/// Closed, redacted reasons an instance observation failed. No raw Win32 error, handle, process ID,
/// creation time, name or path is representable here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceInstanceRefusal {
    /// No pipe connection existed at observation time.
    PipeNotConnected,
    /// The bounded nonce-bound handshake had not been confirmed.
    HandshakeNotConfirmed,
    /// The confirmed peer was not the expected service fixture.
    UnexpectedPeerRole,
    /// Windows did not report a peer process ID for the pipe.
    PeerProcessIdUnavailable,
    /// The observed process ID was zero or otherwise invalid.
    InvalidProcessId,
    /// The pipe peer changed between the first and second peer read.
    PeerChangedDuringObservation,
    /// The connection closed while the observation was in progress.
    ConnectionClosedDuringObservation,
    /// The SCM status query did not succeed.
    ServiceStatusUnavailable,
    /// The service was not in the running state (including start- and stop-pending).
    ServiceNotRunning,
    /// The service was not an unambiguous dedicated own-process service.
    ServiceTypeAmbiguous,
    /// The SCM-reported instance changed between the two status observations.
    ServiceInstanceChangedDuringObservation,
    /// The observed process could not be opened for the minimum query access.
    ProcessOpenDenied,
    /// The process creation time could not be read.
    ProcessCreationTimeUnavailable,
    /// The owning backend was unavailable or not in an observable state.
    BackendUnavailable,
    /// The platform or build cannot observe instance identity at all.
    UnsupportedPlatform,
    /// Any other failure, redacted.
    UnexpectedObservationFailure,
}

/// The outcome of one instance observation: an opaque token, or an exact closed refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ServiceInstanceObservation {
    /// An OS-derived instance identity was established.
    Observed(ServiceInstanceToken),
    /// No identity was established; the reason is closed and redacted.
    Refused(ServiceInstanceRefusal),
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ServiceInstanceObservation {
    /// Whether an identity was established. Reveals nothing about its contents.
    #[must_use]
    #[cfg(test)]
    pub fn is_observed(&self) -> bool {
        matches!(self, Self::Observed(_))
    }

    /// The closed refusal, when the observation failed.
    #[must_use]
    pub fn refusal(&self) -> Option<ServiceInstanceRefusal> {
        match self {
            Self::Observed(_) => None,
            Self::Refused(r) => Some(*r),
        }
    }

    /// Crate-internal token access for the comparison below. Deliberately not public: outside this
    /// crate a token can be moved around but never unwrapped into its parts.
    fn token(&self) -> Option<ServiceInstanceToken> {
        match self {
            Self::Observed(t) => Some(*t),
            Self::Refused(_) => None,
        }
    }
}

/// The closed cross-source binding decision. This is the ONLY thing a proof runner learns; neither
/// token's contents are exposed by it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceInstanceBinding {
    /// The IPC peer and the SCM-observed service are the same stable running instance.
    Match,
    /// Both sources produced an identity, but they are different instances.
    Mismatch,
    /// No IPC-derived identity is available.
    MissingIpcObservation,
    /// No SCM-derived identity is available.
    MissingScmObservation,
    /// The SCM instance changed across the proof window, so no single stable instance exists.
    Stale,
    /// The service instance could not be resolved unambiguously (e.g. shared-process service).
    Ambiguous,
    /// Instance binding is not supported on this platform or in this build.
    Unsupported,
    /// An observation was contributed out of order. Unrepresentable through the type-state API; kept
    /// closed so no path can degrade into a permissive answer.
    WrongObservationOrder,
    /// The same observation was contributed twice. Unrepresentable through the type-state API.
    DuplicateObservation,
    /// An observation from a different proof attempt was presented. Structurally impossible while
    /// observations never leave their attempt.
    CrossAttemptObservation,
    /// The bounded observation window elapsed before the attempt finalised.
    ObservationWindowExpired,
    /// The attempt was already consumed. Unrepresentable through the type-state API.
    AlreadyFinalised,
    /// The sealed live-observation capability was unavailable.
    CapabilityUnavailable,
    /// Any other failure, redacted.
    UnexpectedFailure,
}

/// Compare one IPC-derived identity against the SCM identity observed BEFORE and AFTER it.
///
/// Requiring `scm_before == ipc == scm_after` is what prevents a service restart, a stop/start or a
/// PID handover mid-proof from being reported as one stable instance. Only observations participate:
/// no caller-supplied expected value can influence the result, so equality cannot be steered.
///
/// CRATE-PRIVATE since Contract1B. Equality alone is NOT a proof: three separately-obtained values
/// could be retained and recombined across proof attempts, so this is reachable only from
/// [`ServiceInstanceBindingAttempt::finalise`], which additionally proves the three observations were
/// collected in order inside one bounded, consumable attempt.
#[must_use]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) fn bind_service_instance(
    ipc: &ServiceInstanceObservation,
    scm_before: &ServiceInstanceObservation,
    scm_after: &ServiceInstanceObservation,
) -> ServiceInstanceBinding {
    // An unsupported platform or an ambiguous service type is a distinct answer from "different
    // instance" — report it before any equality is considered.
    for o in [ipc, scm_before, scm_after] {
        if o.refusal() == Some(ServiceInstanceRefusal::UnsupportedPlatform) {
            return ServiceInstanceBinding::Unsupported;
        }
    }
    for o in [scm_before, scm_after] {
        if o.refusal() == Some(ServiceInstanceRefusal::ServiceTypeAmbiguous) {
            return ServiceInstanceBinding::Ambiguous;
        }
    }

    let (Some(before), Some(after)) = (scm_before.token(), scm_after.token()) else {
        return ServiceInstanceBinding::MissingScmObservation;
    };
    let Some(peer) = ipc.token() else {
        return ServiceInstanceBinding::MissingIpcObservation;
    };
    // The service must have been ONE instance for the whole window before the peer is compared at all.
    if before != after {
        return ServiceInstanceBinding::Stale;
    }
    if peer != before {
        return ServiceInstanceBinding::Mismatch;
    }
    ServiceInstanceBinding::Match
}

/// OS facts gathered about a connected named-pipe peer. Crate-private: the public API never accepts
/// process identity from a caller, so this cannot be used to inject a positive result.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) struct PipePeerFacts {
    /// A pipe connection existed when the observation started.
    pub connected: bool,
    /// The bounded nonce-bound handshake completed and was confirmed.
    pub handshake_confirmed: bool,
    /// The confirmed peer role was the expected service fixture.
    pub role_is_expected_service_fixture: bool,
    /// Peer process ID reported by Windows BEFORE the process was opened.
    pub peer_process_id_before: Option<u32>,
    /// The observed process opened for the minimum query access.
    pub process_opened: bool,
    /// Process creation time read from Windows.
    pub creation_time: Option<u64>,
    /// The connection was still established after the identity was captured.
    pub still_connected: bool,
    /// Peer process ID re-read by Windows AFTER the identity was captured.
    pub peer_process_id_after: Option<u32>,
}

/// Decide a named-pipe peer observation from gathered OS facts (§7 ordering).
///
/// Every precondition is checked before any identity is used, and the peer is re-read afterwards so a
/// peer that changed mid-observation can never yield a token.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) fn decide_pipe_peer(facts: &PipePeerFacts) -> ServiceInstanceObservation {
    use ServiceInstanceRefusal as R;

    if !facts.connected {
        return ServiceInstanceObservation::Refused(R::PipeNotConnected);
    }
    if !facts.handshake_confirmed {
        return ServiceInstanceObservation::Refused(R::HandshakeNotConfirmed);
    }
    if !facts.role_is_expected_service_fixture {
        return ServiceInstanceObservation::Refused(R::UnexpectedPeerRole);
    }
    let Some(before) = facts.peer_process_id_before else {
        return ServiceInstanceObservation::Refused(R::PeerProcessIdUnavailable);
    };
    if before == 0 {
        return ServiceInstanceObservation::Refused(R::InvalidProcessId);
    }
    if !facts.process_opened {
        return ServiceInstanceObservation::Refused(R::ProcessOpenDenied);
    }
    // A denied or unavailable creation time NEVER degrades to a process-ID-only identity.
    let Some(created) = facts.creation_time else {
        return ServiceInstanceObservation::Refused(R::ProcessCreationTimeUnavailable);
    };
    if !facts.still_connected {
        return ServiceInstanceObservation::Refused(R::ConnectionClosedDuringObservation);
    }
    let Some(after) = facts.peer_process_id_after else {
        return ServiceInstanceObservation::Refused(R::PeerProcessIdUnavailable);
    };
    if after != before {
        return ServiceInstanceObservation::Refused(R::PeerChangedDuringObservation);
    }
    match ServiceInstanceToken::from_observed_parts(before, created) {
        Some(t) => ServiceInstanceObservation::Observed(t),
        None => ServiceInstanceObservation::Refused(R::InvalidProcessId),
    }
}

/// OS facts gathered about the fixed ProjectOSHost service across TWO status observations.
/// Crate-private for the same reason as [`PipePeerFacts`].
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) struct ServiceFacts {
    /// The first `QueryServiceStatusEx` succeeded.
    pub first_status_available: bool,
    /// The first observation reported the running state (never start-/stop-pending).
    pub first_running: bool,
    /// The first observation reported a dedicated own-process service.
    pub first_own_process: bool,
    /// Process ID from the first observation.
    pub first_process_id: Option<u32>,
    /// The observed process opened for the minimum query access.
    pub process_opened: bool,
    /// Process creation time read from Windows.
    pub creation_time: Option<u64>,
    /// The second `QueryServiceStatusEx` succeeded.
    pub second_status_available: bool,
    /// The second observation still reported the running state.
    pub second_running: bool,
    /// The second observation still reported a dedicated own-process service.
    pub second_own_process: bool,
    /// Process ID from the second observation.
    pub second_process_id: Option<u32>,
}

/// Decide an SCM service observation from gathered OS facts (§8 ordering).
///
/// The status is required to be running and own-process BOTH before and after the identity capture,
/// and the process ID must be unchanged, so a service that transitioned mid-observation fails closed.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) fn decide_service(facts: &ServiceFacts) -> ServiceInstanceObservation {
    use ServiceInstanceRefusal as R;

    if !facts.first_status_available {
        return ServiceInstanceObservation::Refused(R::ServiceStatusUnavailable);
    }
    if !facts.first_running {
        return ServiceInstanceObservation::Refused(R::ServiceNotRunning);
    }
    if !facts.first_own_process {
        return ServiceInstanceObservation::Refused(R::ServiceTypeAmbiguous);
    }
    let Some(first) = facts.first_process_id else {
        return ServiceInstanceObservation::Refused(R::InvalidProcessId);
    };
    if first == 0 {
        return ServiceInstanceObservation::Refused(R::InvalidProcessId);
    }
    if !facts.process_opened {
        return ServiceInstanceObservation::Refused(R::ProcessOpenDenied);
    }
    let Some(created) = facts.creation_time else {
        return ServiceInstanceObservation::Refused(R::ProcessCreationTimeUnavailable);
    };
    if !facts.second_status_available {
        return ServiceInstanceObservation::Refused(R::ServiceStatusUnavailable);
    }
    if !facts.second_running {
        return ServiceInstanceObservation::Refused(R::ServiceNotRunning);
    }
    if !facts.second_own_process {
        return ServiceInstanceObservation::Refused(R::ServiceTypeAmbiguous);
    }
    let Some(second) = facts.second_process_id else {
        return ServiceInstanceObservation::Refused(R::ServiceInstanceChangedDuringObservation);
    };
    if second != first {
        return ServiceInstanceObservation::Refused(R::ServiceInstanceChangedDuringObservation);
    }
    match ServiceInstanceToken::from_observed_parts(first, created) {
        Some(t) => ServiceInstanceObservation::Observed(t),
        None => ServiceInstanceObservation::Refused(R::InvalidProcessId),
    }
}

/// The FIXED maximum duration of one proof attempt's observation window.
///
/// DERIVATION: the three observations are two bounded SCM status queries plus one bounded pipe-peer
/// read, each of which is a local, non-blocking kernel call on an already-open handle. The B3
/// transport's own per-step ceiling is 2 s, and the widest legitimate sequence here is well inside
/// that; 5 s leaves generous headroom for a loaded machine while still being far shorter than any
/// plausible service stop/start cycle. Anything slower is not one coherent instant-in-time
/// observation of a single running instance, so it fails closed rather than being trusted.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
const MAX_OBSERVATION_WINDOW_MILLIS: u64 = 5_000;

/// The attempt's internal, closed time source.
///
/// Production uses [`std::time::Instant`], which is MONOTONIC: it cannot be moved by a wall-clock
/// change, so a clock rollback cannot extend an attempt's validity. No caller-supplied timestamp is
/// accepted in any build, and the fake variant exists only under `cfg(test)`.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
enum AttemptClock {
    Monotonic(std::time::Instant),
    #[cfg(test)]
    Fake {
        now_millis: std::rc::Rc<std::cell::Cell<u64>>,
        started_at: u64,
        /// Highest value ever observed, so the fake is MONOTONIC like the production source: moving
        /// the underlying value backwards can never reduce measured elapsed time.
        peak: std::cell::Cell<u64>,
    },
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl AttemptClock {
    /// Milliseconds elapsed since the attempt began. Never exposed publicly.
    fn elapsed_millis(&self) -> u64 {
        match self {
            Self::Monotonic(start) => {
                u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
            }
            #[cfg(test)]
            Self::Fake {
                now_millis,
                started_at,
                peak,
            } => {
                let highest = peak.get().max(now_millis.get());
                peak.set(highest);
                highest.saturating_sub(*started_at)
            }
        }
    }
}

/// Type-state markers. All are UNINHABITED: they exist only to distinguish attempt states at compile
/// time and can never be constructed, stored or forged.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum Prepared {}
/// The SCM instance was observed before the peer.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ScmBeforeObserved {}
/// The confirmed IPC peer's instance was observed.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum IpcPeerObserved {}
/// The SCM instance was observed again after the peer.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ScmAfterObserved {}

/// The attempt's private contents. Never public, never returned, never cloned.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
struct AttemptInner {
    clock: AttemptClock,
    scm_before: Option<ServiceInstanceToken>,
    ipc_peer: Option<ServiceInstanceToken>,
    scm_after: Option<ServiceInstanceToken>,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl AttemptInner {
    /// Fail closed once the bounded window has elapsed. Checked on EVERY transition and again at
    /// finalisation, so expiry at any point between observations refuses.
    fn expiry(&self) -> Option<ServiceInstanceBinding> {
        if self.clock.elapsed_millis() > MAX_OBSERVATION_WINDOW_MILLIS {
            return Some(ServiceInstanceBinding::ObservationWindowExpired);
        }
        None
    }
}

/// One bounded, ordered, CONSUMABLE service-instance binding attempt.
///
/// Equality between three separately-obtained identities is not a proof: such values could be retained
/// and recombined across attempts. This type makes the proof structural instead. The three
/// observations are collected THROUGH the attempt, stored only INSIDE it, and can never be extracted,
/// so an observation from one attempt cannot be presented to another — the mixing attack has no
/// representation rather than a runtime check.
///
/// Ordering is enforced by the type: each transition CONSUMES the attempt and returns it in the next
/// state, and a state exposes only the one method legal from it. Contributing out of order,
/// contributing twice, skipping a step, returning to an earlier state and finalising twice are all
/// compile-time impossibilities, not runtime refusals.
///
/// The type is deliberately not `Clone`, not `Copy`, not serialisable and has a redacted `Debug`.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub struct ServiceInstanceBindingAttempt<S> {
    inner: AttemptInner,
    _state: core::marker::PhantomData<S>,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> fmt::Debug for ServiceInstanceBindingAttempt<S> {
    /// Redacted: an attempt holds up to three identities plus its window state, none of which may be
    /// rendered, and no attempt identifier exists to print.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ServiceInstanceBindingAttempt([REDACTED])")
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> ServiceInstanceBindingAttempt<S> {
    /// Move the attempt into its next state, carrying the private contents with it.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    fn advance<T>(self) -> ServiceInstanceBindingAttempt<T> {
        ServiceInstanceBindingAttempt {
            inner: self.inner,
            _state: core::marker::PhantomData,
        }
    }
}

/// The result of one attempt transition: the attempt in its next state, or a terminal closed refusal.
///
/// A refusal consumes the attempt — there is no way back to a usable state, so a failed observation
/// can never be retried into a positive result.
#[must_use]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum AttemptOutcome<S> {
    /// The observation was accepted; the attempt continues in its next state.
    Continue(ServiceInstanceBindingAttempt<S>),
    /// The attempt is over, with this closed verdict.
    Refused(ServiceInstanceBinding),
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> fmt::Debug for AttemptOutcome<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Continue(_) => f.write_str("AttemptOutcome::Continue([REDACTED])"),
            Self::Refused(v) => write!(f, "AttemptOutcome::Refused({v:?})"),
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> AttemptOutcome<S> {
    /// Whether the attempt is still alive. Reveals nothing about the observations.
    #[must_use]
    pub fn is_continuing(&self) -> bool {
        matches!(self, Self::Continue(_))
    }

    /// The terminal verdict, when the attempt was refused.
    #[must_use]
    pub fn refusal(&self) -> Option<ServiceInstanceBinding> {
        match self {
            Self::Continue(_) => None,
            Self::Refused(v) => Some(*v),
        }
    }

    /// Take the continuing attempt. Consuming, so an outcome cannot yield two attempts.
    #[must_use]
    pub fn into_attempt(self) -> Option<ServiceInstanceBindingAttempt<S>> {
        match self {
            Self::Continue(a) => Some(a),
            Self::Refused(_) => None,
        }
    }
}

/// Map a closed observation refusal onto the attempt's terminal verdict, preserving the precise
/// answers (ambiguous / unsupported) rather than collapsing everything to "missing".
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
fn scm_refusal_verdict(r: ServiceInstanceRefusal) -> ServiceInstanceBinding {
    match r {
        ServiceInstanceRefusal::ServiceTypeAmbiguous => ServiceInstanceBinding::Ambiguous,
        ServiceInstanceRefusal::UnsupportedPlatform => ServiceInstanceBinding::Unsupported,
        _ => ServiceInstanceBinding::MissingScmObservation,
    }
}

/// As above, for the IPC side.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
fn ipc_refusal_verdict(r: ServiceInstanceRefusal) -> ServiceInstanceBinding {
    match r {
        ServiceInstanceRefusal::UnsupportedPlatform => ServiceInstanceBinding::Unsupported,
        _ => ServiceInstanceBinding::MissingIpcObservation,
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ServiceInstanceBindingAttempt<Prepared> {
    /// Begin a proof attempt. Requires the sealed, unconstructible live-observation capability, so no
    /// build can start one; there is no `Default`, no raw attempt identifier and no caller-supplied
    /// clock, deadline or freshness value.
    #[must_use]
    pub fn begin(_capability: &LiveInstanceObservationCapability) -> Self {
        Self {
            inner: AttemptInner {
                clock: AttemptClock::Monotonic(std::time::Instant::now()),
                scm_before: None,
                ipc_peer: None,
                scm_after: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// Test-only entry point using a deterministic fake clock. Crate-private AND `cfg(test)`, so it
    /// exists in no production build and cannot be reached by any caller.
    #[cfg(test)]
    pub(crate) fn begin_for_test(now_millis: std::rc::Rc<std::cell::Cell<u64>>) -> Self {
        let started_at = now_millis.get();
        Self {
            inner: AttemptInner {
                clock: AttemptClock::Fake {
                    now_millis,
                    started_at,
                    peak: std::cell::Cell::new(started_at),
                },
                scm_before: None,
                ipc_peer: None,
                scm_after: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// Record the SCM-before observation. The token is retained INSIDE the attempt and never returned.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn record_scm_before(
        mut self,
        observation: ServiceInstanceObservation,
    ) -> AttemptOutcome<ScmBeforeObserved> {
        if let Some(expired) = self.inner.expiry() {
            return AttemptOutcome::Refused(expired);
        }
        match observation {
            ServiceInstanceObservation::Refused(r) => {
                AttemptOutcome::Refused(scm_refusal_verdict(r))
            }
            ServiceInstanceObservation::Observed(t) => {
                self.inner.scm_before = Some(t);
                AttemptOutcome::Continue(self.advance())
            }
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ServiceInstanceBindingAttempt<ScmBeforeObserved> {
    /// Record the confirmed IPC peer's observation. Legal ONLY after SCM-before, by construction.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn record_ipc_peer(
        mut self,
        observation: ServiceInstanceObservation,
    ) -> AttemptOutcome<IpcPeerObserved> {
        if let Some(expired) = self.inner.expiry() {
            return AttemptOutcome::Refused(expired);
        }
        match observation {
            ServiceInstanceObservation::Refused(r) => {
                AttemptOutcome::Refused(ipc_refusal_verdict(r))
            }
            ServiceInstanceObservation::Observed(t) => {
                self.inner.ipc_peer = Some(t);
                AttemptOutcome::Continue(self.advance())
            }
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ServiceInstanceBindingAttempt<IpcPeerObserved> {
    /// Record the SCM-after observation. Legal ONLY after the peer, by construction.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn record_scm_after(
        mut self,
        observation: ServiceInstanceObservation,
    ) -> AttemptOutcome<ScmAfterObserved> {
        if let Some(expired) = self.inner.expiry() {
            return AttemptOutcome::Refused(expired);
        }
        match observation {
            ServiceInstanceObservation::Refused(r) => {
                AttemptOutcome::Refused(scm_refusal_verdict(r))
            }
            ServiceInstanceObservation::Observed(t) => {
                self.inner.scm_after = Some(t);
                AttemptOutcome::Continue(self.advance())
            }
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ServiceInstanceBindingAttempt<ScmAfterObserved> {
    /// Finalise the attempt and return ONLY the closed verdict.
    ///
    /// Takes `self` by value, so the attempt is consumed: it cannot be finalised twice and no
    /// observation survives for reuse. The window is re-checked here, so an attempt that expired
    /// between the last observation and finalisation can never return `Match`.
    #[must_use]
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub fn finalise(self) -> ServiceInstanceBinding {
        if let Some(expired) = self.inner.expiry() {
            return expired;
        }
        let (Some(before), Some(peer), Some(after)) = (
            self.inner.scm_before,
            self.inner.ipc_peer,
            self.inner.scm_after,
        ) else {
            // Unreachable through the type-state API; kept as a closed fail-closed answer.
            return ServiceInstanceBinding::UnexpectedFailure;
        };
        bind_service_instance(
            &ServiceInstanceObservation::Observed(peer),
            &ServiceInstanceObservation::Observed(before),
            &ServiceInstanceObservation::Observed(after),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- deterministic fake OS backends -------------------------------------------------------
    // No Windows API, no pipe, no SCM, no OpenProcess, no process launch, no sleep.

    const PID_A: u32 = 4242;
    const PID_B: u32 = 5150;
    const CREATED_A: u64 = 0x01DA_0000_0000_0001;
    const CREATED_B: u64 = 0x01DA_0000_0000_0002;

    fn good_pipe_facts() -> PipePeerFacts {
        PipePeerFacts {
            connected: true,
            handshake_confirmed: true,
            role_is_expected_service_fixture: true,
            peer_process_id_before: Some(PID_A),
            process_opened: true,
            creation_time: Some(CREATED_A),
            still_connected: true,
            peer_process_id_after: Some(PID_A),
        }
    }

    fn good_service_facts() -> ServiceFacts {
        ServiceFacts {
            first_status_available: true,
            first_running: true,
            first_own_process: true,
            first_process_id: Some(PID_A),
            process_opened: true,
            creation_time: Some(CREATED_A),
            second_status_available: true,
            second_running: true,
            second_own_process: true,
            second_process_id: Some(PID_A),
        }
    }

    fn token(pid: u32, created: u64) -> ServiceInstanceToken {
        ServiceInstanceToken::from_observed_parts(pid, created).expect("valid parts")
    }

    fn observed(pid: u32, created: u64) -> ServiceInstanceObservation {
        ServiceInstanceObservation::Observed(token(pid, created))
    }

    fn refused(r: ServiceInstanceRefusal) -> ServiceInstanceObservation {
        ServiceInstanceObservation::Refused(r)
    }

    // ---- token shape --------------------------------------------------------------------------

    #[test]
    fn token_debug_is_fully_redacted() {
        let rendered = format!("{:?}", token(PID_A, CREATED_A));
        assert_eq!(rendered, "ServiceInstanceToken([REDACTED])");
        assert!(!rendered.contains(&PID_A.to_string()));
        assert!(!rendered.contains(&CREATED_A.to_string()));
    }

    #[test]
    fn observation_debug_leaks_no_raw_identity() {
        let rendered = format!("{:?}", observed(PID_A, CREATED_A));
        assert!(!rendered.contains(&PID_A.to_string()));
        assert!(!rendered.contains(&CREATED_A.to_string()));
    }

    #[test]
    fn equal_pid_and_creation_time_compare_equal() {
        assert_eq!(token(PID_A, CREATED_A), token(PID_A, CREATED_A));
    }

    #[test]
    fn same_pid_with_different_creation_time_mismatches() {
        // This is the process-ID-reuse case: a later process inheriting the PID is NOT the instance.
        assert_ne!(token(PID_A, CREATED_A), token(PID_A, CREATED_B));
    }

    #[test]
    fn different_pid_with_same_creation_time_mismatches() {
        assert_ne!(token(PID_A, CREATED_A), token(PID_B, CREATED_A));
    }

    #[test]
    fn zero_process_id_is_refused() {
        assert!(ServiceInstanceToken::from_observed_parts(0, CREATED_A).is_none());
    }

    #[test]
    fn missing_creation_time_is_refused_with_no_pid_only_fallback() {
        assert!(ServiceInstanceToken::from_observed_parts(PID_A, 0).is_none());
    }

    // ---- pipe peer observation ----------------------------------------------------------------

    #[test]
    fn pipe_observation_succeeds_on_a_stable_confirmed_peer() {
        assert_eq!(
            decide_pipe_peer(&good_pipe_facts()),
            observed(PID_A, CREATED_A)
        );
    }

    #[test]
    fn pipe_observation_requires_a_connection() {
        let facts = PipePeerFacts {
            connected: false,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::PipeNotConnected)
        );
    }

    #[test]
    fn pipe_observation_requires_a_confirmed_handshake() {
        let facts = PipePeerFacts {
            handshake_confirmed: false,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::HandshakeNotConfirmed)
        );
    }

    #[test]
    fn pipe_observation_refuses_the_wrong_peer_role() {
        let facts = PipePeerFacts {
            role_is_expected_service_fixture: false,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::UnexpectedPeerRole)
        );
    }

    #[test]
    fn pipe_observation_refuses_an_unavailable_peer_process_id() {
        let facts = PipePeerFacts {
            peer_process_id_before: None,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::PeerProcessIdUnavailable)
        );
    }

    #[test]
    fn pipe_observation_refuses_a_zero_peer_process_id() {
        let facts = PipePeerFacts {
            peer_process_id_before: Some(0),
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::InvalidProcessId)
        );
    }

    #[test]
    fn pipe_observation_fails_closed_when_the_process_cannot_be_opened() {
        let facts = PipePeerFacts {
            process_opened: false,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::ProcessOpenDenied)
        );
    }

    #[test]
    fn pipe_observation_fails_closed_when_creation_time_is_unavailable() {
        let facts = PipePeerFacts {
            creation_time: None,
            ..good_pipe_facts()
        };
        // Crucially NOT a token built from the PID alone.
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::ProcessCreationTimeUnavailable)
        );
    }

    #[test]
    fn pipe_observation_refuses_a_disconnected_pipe() {
        let facts = PipePeerFacts {
            still_connected: false,
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::ConnectionClosedDuringObservation)
        );
    }

    #[test]
    fn pipe_observation_refuses_a_peer_that_changed_during_observation() {
        let facts = PipePeerFacts {
            peer_process_id_after: Some(PID_B),
            ..good_pipe_facts()
        };
        assert_eq!(
            decide_pipe_peer(&facts),
            refused(ServiceInstanceRefusal::PeerChangedDuringObservation)
        );
    }

    // ---- SCM service observation ---------------------------------------------------------------

    #[test]
    fn service_observation_succeeds_on_a_stable_running_own_process_service() {
        assert_eq!(
            decide_service(&good_service_facts()),
            observed(PID_A, CREATED_A)
        );
    }

    #[test]
    fn service_observation_refuses_an_unavailable_status() {
        let facts = ServiceFacts {
            first_status_available: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceStatusUnavailable)
        );
    }

    #[test]
    fn service_observation_refuses_a_stopped_service() {
        // Stopped, start-pending and stop-pending all arrive as "not running" — a stopped-state
        // process ID is never used.
        let facts = ServiceFacts {
            first_running: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceNotRunning)
        );
    }

    #[test]
    fn service_observation_refuses_a_transitioning_service_at_the_second_read() {
        // START_PENDING / STOP_PENDING appearing at the second observation is a transition, not a
        // stable instance.
        let facts = ServiceFacts {
            second_running: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceNotRunning)
        );
    }

    #[test]
    fn service_observation_refuses_shared_process_ambiguity() {
        let facts = ServiceFacts {
            first_own_process: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceTypeAmbiguous)
        );
    }

    #[test]
    fn service_observation_refuses_a_service_type_change_between_observations() {
        let facts = ServiceFacts {
            second_own_process: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceTypeAmbiguous)
        );
    }

    #[test]
    fn service_observation_refuses_a_process_id_change_between_observations() {
        let facts = ServiceFacts {
            second_process_id: Some(PID_B),
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ServiceInstanceChangedDuringObservation)
        );
    }

    #[test]
    fn service_observation_refuses_a_zero_process_id() {
        let facts = ServiceFacts {
            first_process_id: Some(0),
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::InvalidProcessId)
        );
    }

    #[test]
    fn service_observation_fails_closed_when_the_process_cannot_be_opened() {
        let facts = ServiceFacts {
            process_opened: false,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ProcessOpenDenied)
        );
    }

    #[test]
    fn service_observation_fails_closed_when_creation_time_is_unavailable() {
        let facts = ServiceFacts {
            creation_time: None,
            ..good_service_facts()
        };
        assert_eq!(
            decide_service(&facts),
            refused(ServiceInstanceRefusal::ProcessCreationTimeUnavailable)
        );
    }

    // ---- cross-source binding -------------------------------------------------------------------

    #[test]
    fn ipc_and_scm_tokens_bind_through_opaque_equality() {
        let ipc = decide_pipe_peer(&good_pipe_facts());
        let scm = decide_service(&good_service_facts());
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Match
        );
    }

    #[test]
    fn a_different_instance_does_not_bind() {
        let ipc = observed(PID_B, CREATED_B);
        let scm = observed(PID_A, CREATED_A);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn process_id_reuse_does_not_bind() {
        // Same PID, different creation time: a recycled process ID must never satisfy the binding.
        let ipc = observed(PID_A, CREATED_B);
        let scm = observed(PID_A, CREATED_A);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn a_restarted_service_is_stale_not_matched() {
        let ipc = observed(PID_A, CREATED_A);
        let before = observed(PID_A, CREATED_A);
        let after = observed(PID_B, CREATED_B);
        assert_eq!(
            bind_service_instance(&ipc, &before, &after),
            ServiceInstanceBinding::Stale
        );
    }

    #[test]
    fn a_missing_ipc_observation_never_matches() {
        let scm = observed(PID_A, CREATED_A);
        let ipc = refused(ServiceInstanceRefusal::HandshakeNotConfirmed);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::MissingIpcObservation
        );
    }

    #[test]
    fn a_missing_scm_observation_never_matches() {
        let ipc = observed(PID_A, CREATED_A);
        let scm = refused(ServiceInstanceRefusal::ServiceNotRunning);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::MissingScmObservation
        );
    }

    #[test]
    fn a_stale_token_from_an_earlier_attempt_never_matches() {
        // An earlier attempt's token differs in creation time; it cannot revive a later proof.
        let stale = observed(PID_A, CREATED_A);
        let current = observed(PID_A, CREATED_B);
        assert_eq!(
            bind_service_instance(&stale, &current, &current),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn shared_process_ambiguity_is_reported_as_ambiguous_not_mismatch() {
        let ipc = observed(PID_A, CREATED_A);
        let scm = refused(ServiceInstanceRefusal::ServiceTypeAmbiguous);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Ambiguous
        );
    }

    #[test]
    fn an_unsupported_platform_is_reported_as_unsupported() {
        let ipc = refused(ServiceInstanceRefusal::UnsupportedPlatform);
        let scm = observed(PID_A, CREATED_A);
        assert_eq!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Unsupported
        );
    }

    // ---- attempt-scoped binding (Contract1B) ---------------------------------------------------
    // A deterministic fake monotonic clock; no sleeping and no wall-clock dependence anywhere.

    use std::cell::Cell;
    use std::rc::Rc;

    fn clock() -> Rc<Cell<u64>> {
        Rc::new(Cell::new(1_000))
    }

    fn attempt(c: &Rc<Cell<u64>>) -> ServiceInstanceBindingAttempt<Prepared> {
        ServiceInstanceBindingAttempt::begin_for_test(Rc::clone(c))
    }

    /// Drive a full ordered attempt with the three supplied observations, advancing the fake clock by
    /// `step_ms` before each one.
    fn run_attempt(
        c: &Rc<Cell<u64>>,
        step_ms: u64,
        before: ServiceInstanceObservation,
        peer: ServiceInstanceObservation,
        after: ServiceInstanceObservation,
    ) -> ServiceInstanceBinding {
        let a = attempt(c);
        c.set(c.get() + step_ms);
        let a = match a.record_scm_before(before) {
            AttemptOutcome::Refused(v) => return v,
            AttemptOutcome::Continue(a) => a,
        };
        c.set(c.get() + step_ms);
        let a = match a.record_ipc_peer(peer) {
            AttemptOutcome::Refused(v) => return v,
            AttemptOutcome::Continue(a) => a,
        };
        c.set(c.get() + step_ms);
        let a = match a.record_scm_after(after) {
            AttemptOutcome::Refused(v) => return v,
            AttemptOutcome::Continue(a) => a,
        };
        a.finalise()
    }

    #[test]
    fn an_ordered_attempt_with_one_stable_instance_matches() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::Match
        );
    }

    #[test]
    fn an_attempt_whose_peer_differs_from_scm_before_mismatches() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_A, CREATED_A),
                observed(PID_B, CREATED_B),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn an_attempt_whose_peer_differs_from_scm_after_is_stale() {
        // The service changed underneath the peer, so no single instance spans the window.
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
                observed(PID_B, CREATED_B),
            ),
            ServiceInstanceBinding::Stale
        );
    }

    #[test]
    fn process_id_reuse_inside_an_attempt_still_mismatches() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_B),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn a_refused_scm_before_ends_the_attempt() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                refused(ServiceInstanceRefusal::ServiceNotRunning),
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::MissingScmObservation
        );
    }

    #[test]
    fn a_refused_peer_ends_the_attempt() {
        let c = clock();
        for r in [
            ServiceInstanceRefusal::UnexpectedPeerRole,
            ServiceInstanceRefusal::PipeNotConnected,
            ServiceInstanceRefusal::HandshakeNotConfirmed,
        ] {
            assert_eq!(
                run_attempt(
                    &c,
                    10,
                    observed(PID_A, CREATED_A),
                    refused(r),
                    observed(PID_A, CREATED_A),
                ),
                ServiceInstanceBinding::MissingIpcObservation
            );
        }
    }

    #[test]
    fn a_refused_scm_after_ends_the_attempt() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
                refused(ServiceInstanceRefusal::ServiceStatusUnavailable),
            ),
            ServiceInstanceBinding::MissingScmObservation
        );
    }

    #[test]
    fn a_shared_process_service_is_ambiguous_inside_an_attempt() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                refused(ServiceInstanceRefusal::ServiceTypeAmbiguous),
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::Ambiguous
        );
    }

    #[test]
    fn expiry_before_the_first_observation_is_refused() {
        let c = clock();
        let a = attempt(&c);
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        assert_eq!(
            a.record_scm_before(observed(PID_A, CREATED_A)).refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
    }

    #[test]
    fn expiry_between_scm_before_and_the_peer_is_refused() {
        let c = clock();
        let a = attempt(&c)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-before accepted");
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        assert_eq!(
            a.record_ipc_peer(observed(PID_A, CREATED_A)).refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
    }

    #[test]
    fn expiry_between_the_peer_and_scm_after_is_refused() {
        let c = clock();
        let a = attempt(&c)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-before accepted")
            .record_ipc_peer(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("peer accepted");
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        assert_eq!(
            a.record_scm_after(observed(PID_A, CREATED_A)).refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
    }

    #[test]
    fn expiry_after_the_last_observation_but_before_finalise_is_refused() {
        let c = clock();
        let a = attempt(&c)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-before accepted")
            .record_ipc_peer(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("peer accepted")
            .record_scm_after(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-after accepted");
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        // Everything matched, yet the window had elapsed — freshness is not implied by equality.
        assert_eq!(
            a.finalise(),
            ServiceInstanceBinding::ObservationWindowExpired
        );
    }

    #[test]
    fn a_slow_but_in_window_attempt_still_matches() {
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                MAX_OBSERVATION_WINDOW_MILLIS / 4,
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
                observed(PID_A, CREATED_A),
            ),
            ServiceInstanceBinding::Match
        );
    }

    #[test]
    fn a_clock_rollback_cannot_revive_an_expired_attempt() {
        // Production measures with std::time::Instant, which is MONOTONIC: it is derived from the OS
        // monotonic counter, not the wall clock, so changing system time cannot move it. The fake
        // models that with a peak clamp — once a value has been observed, a later smaller value can
        // never reduce measured elapsed time.
        let c = clock();
        let a = attempt(&c);
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        let expired = a.record_scm_before(observed(PID_A, CREATED_A));
        assert_eq!(
            expired.refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
        // Rolling the source backwards afterwards yields no usable attempt and no second chance.
        c.set(0);
        assert!(expired.into_attempt().is_none());
    }

    #[test]
    fn the_fake_clock_never_runs_backwards_within_an_attempt() {
        let c = clock();
        let a = attempt(&c);
        c.set(c.get() + MAX_OBSERVATION_WINDOW_MILLIS + 1);
        // Observe the high value, then roll the source back below the window.
        assert!(a.inner.expiry().is_some());
        c.set(0);
        // Still expired: the peak clamp preserves the monotonic reading.
        assert_eq!(
            a.inner.expiry(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
    }

    #[test]
    fn a_refused_outcome_yields_no_usable_attempt() {
        // A refusal is terminal: there is no attempt left to retry into a positive result.
        let c = clock();
        let outcome =
            attempt(&c).record_scm_before(refused(ServiceInstanceRefusal::ServiceNotRunning));
        assert!(!outcome.is_continuing());
        assert!(outcome.into_attempt().is_none());
    }

    #[test]
    fn an_attempt_never_yields_its_observations() {
        // The only value finalisation produces is the closed verdict; no token escapes, so nothing
        // can be retained for a later attempt. (Extraction is additionally impossible by type: the
        // fields are private and no accessor exists.)
        let c = clock();
        let verdict = run_attempt(
            &c,
            1,
            observed(PID_A, CREATED_A),
            observed(PID_A, CREATED_A),
            observed(PID_A, CREATED_A),
        );
        let rendered = format!("{verdict:?}");
        assert!(
            !rendered.chars().any(|ch| ch.is_ascii_digit()),
            "{rendered}"
        );
    }

    #[test]
    fn attempt_debug_is_redacted() {
        let c = clock();
        let a = attempt(&c);
        assert_eq!(
            format!("{a:?}"),
            "ServiceInstanceBindingAttempt([REDACTED])"
        );
        let outcome = a.record_scm_before(observed(PID_A, CREATED_A));
        assert_eq!(
            format!("{outcome:?}"),
            "AttemptOutcome::Continue([REDACTED])"
        );
    }

    #[test]
    fn observations_from_two_attempts_are_kept_apart() {
        // Two concurrent attempts observe DIFFERENT instances. Because each attempt stores its own
        // observations internally and none can be extracted, attempt A's identity cannot be carried
        // into attempt B: each finalises strictly on what it collected itself.
        let c = clock();
        let a = attempt(&c)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("a scm-before");
        let b = attempt(&c)
            .record_scm_before(observed(PID_B, CREATED_B))
            .into_attempt()
            .expect("b scm-before");
        let a = a
            .record_ipc_peer(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("a peer")
            .record_scm_after(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("a scm-after");
        // Attempt B sees attempt A's peer identity — which is exactly the recombination attack. B must
        // NOT match, because B's own SCM observations describe a different instance.
        let b = b
            .record_ipc_peer(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("b peer")
            .record_scm_after(observed(PID_B, CREATED_B))
            .into_attempt()
            .expect("b scm-after");
        assert_eq!(a.finalise(), ServiceInstanceBinding::Match);
        assert_eq!(b.finalise(), ServiceInstanceBinding::Mismatch);
    }

    #[test]
    fn a_prior_attempts_identity_cannot_complete_a_new_attempt() {
        // A caller who somehow knew an earlier instance still cannot finalise a new attempt with it:
        // the new attempt's own SCM observations govern, and they describe the current instance.
        let c = clock();
        assert_eq!(
            run_attempt(
                &c,
                10,
                observed(PID_B, CREATED_B),
                observed(PID_A, CREATED_A), // stale identity from an earlier attempt
                observed(PID_B, CREATED_B),
            ),
            ServiceInstanceBinding::Mismatch
        );
    }

    #[test]
    fn two_independent_positive_observations_are_not_enough_without_equality() {
        // Both sources succeeded, yet the binding still refuses — the point of the whole contract.
        let ipc = observed(PID_A, CREATED_A);
        let scm = observed(PID_B, CREATED_B);
        assert!(ipc.is_observed() && scm.is_observed());
        assert_ne!(
            bind_service_instance(&ipc, &scm, &scm),
            ServiceInstanceBinding::Match
        );
    }
}
