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
// `Clone, Copy, PartialEq, Eq` are additive and grant nothing: the marker is still private and still
// has no public construction route, so a sealed type remains unconstructible outside this module. They
// exist so a sealed value-type such as `CanonicalPeerContribution` can be compared and copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    #[cfg(any(
        test,
        feature = "test-fixtures",
        all(windows, feature = "windows-live-instance-observation")
    ))]
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
#[cfg(any(test, feature = "consumer-contract"))]
pub enum ServiceInstanceObservation {
    /// An OS-derived instance identity was established.
    Observed(ServiceInstanceToken),
    /// No identity was established; the reason is closed and redacted.
    Refused(ServiceInstanceRefusal),
}

#[cfg(any(test, feature = "consumer-contract"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
const MAX_OBSERVATION_WINDOW_MILLIS: u64 = 5_000;

/// The attempt's internal, closed time source.
///
/// Production uses [`std::time::Instant`], which is MONOTONIC: it cannot be moved by a wall-clock
/// change, so a clock rollback cannot extend an attempt's validity. No caller-supplied timestamp is
/// accepted in any build, and the fake variant exists only under `cfg(test)`.
#[cfg(any(test, feature = "consumer-contract"))]
enum AttemptClock {
    Monotonic(std::time::Instant),
    #[cfg(any(test, feature = "test-fixtures"))]
    Fake {
        now_millis: std::rc::Rc<std::cell::Cell<u64>>,
        started_at: u64,
        /// Highest value ever observed, so the fake is MONOTONIC like the production source: moving
        /// the underlying value backwards can never reduce measured elapsed time.
        peak: std::cell::Cell<u64>,
    },
}

#[cfg(any(test, feature = "consumer-contract"))]
impl AttemptClock {
    /// Milliseconds elapsed since the attempt began. Never exposed publicly.
    fn elapsed_millis(&self) -> u64 {
        match self {
            Self::Monotonic(start) => {
                u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
            }
            #[cfg(any(test, feature = "test-fixtures"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
pub enum Prepared {}
/// The SCM instance was observed before the peer.
#[cfg(any(test, feature = "consumer-contract"))]
pub enum ScmBeforeObserved {}
/// The confirmed IPC peer's instance was observed.
#[cfg(any(test, feature = "consumer-contract"))]
pub enum IpcPeerObserved {}
/// The SCM instance was observed again after the peer.
#[cfg(any(test, feature = "consumer-contract"))]
pub enum ScmAfterObserved {}

/// The attempt's private contents. Never public, never returned, never cloned.
#[cfg(any(test, feature = "consumer-contract"))]
struct AttemptInner {
    clock: AttemptClock,
    scm_before: Option<ServiceInstanceToken>,
    ipc_peer: Option<ServiceInstanceToken>,
    scm_after: Option<ServiceInstanceToken>,
    /// The bounded peer identity captured for this attempt, when one was captured. Written by exactly
    /// one transition and read by exactly one reconciliation; never returned, never re-exported.
    /// Present only where a peer identity can legitimately originate.
    ///
    /// Boxed so a bounded SID buffer does not travel inside every attempt transition's return value.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    peer: Option<Box<CanonicalPeerContribution>>,
}

#[cfg(any(test, feature = "consumer-contract"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
pub struct ServiceInstanceBindingAttempt<S> {
    inner: AttemptInner,
    _state: core::marker::PhantomData<S>,
}

#[cfg(any(test, feature = "consumer-contract"))]
impl<S> fmt::Debug for ServiceInstanceBindingAttempt<S> {
    /// Redacted: an attempt holds up to three identities plus its window state, none of which may be
    /// rendered, and no attempt identifier exists to print.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ServiceInstanceBindingAttempt([REDACTED])")
    }
}

#[cfg(any(test, feature = "consumer-contract"))]
impl<S> ServiceInstanceBindingAttempt<S> {
    /// Move the attempt into its next state, carrying the private contents with it.
    #[cfg(any(test, feature = "consumer-contract"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
pub enum AttemptOutcome<S> {
    /// The observation was accepted; the attempt continues in its next state.
    Continue(ServiceInstanceBindingAttempt<S>),
    /// The attempt is over, with this closed verdict.
    Refused(ServiceInstanceBinding),
}

#[cfg(any(test, feature = "consumer-contract"))]
impl<S> fmt::Debug for AttemptOutcome<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Continue(_) => f.write_str("AttemptOutcome::Continue([REDACTED])"),
            Self::Refused(v) => write!(f, "AttemptOutcome::Refused({v:?})"),
        }
    }
}

#[cfg(any(test, feature = "consumer-contract"))]
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
#[cfg(any(test, feature = "consumer-contract"))]
fn scm_refusal_verdict(r: ServiceInstanceRefusal) -> ServiceInstanceBinding {
    match r {
        ServiceInstanceRefusal::ServiceTypeAmbiguous => ServiceInstanceBinding::Ambiguous,
        ServiceInstanceRefusal::UnsupportedPlatform => ServiceInstanceBinding::Unsupported,
        _ => ServiceInstanceBinding::MissingScmObservation,
    }
}

/// As above, for the IPC side.
#[cfg(any(test, feature = "consumer-contract"))]
fn ipc_refusal_verdict(r: ServiceInstanceRefusal) -> ServiceInstanceBinding {
    match r {
        ServiceInstanceRefusal::UnsupportedPlatform => ServiceInstanceBinding::Unsupported,
        _ => ServiceInstanceBinding::MissingIpcObservation,
    }
}

/// Collapse a peer-identity refusal onto the attempt's closed verdict.
///
/// Every reason maps to the SAME answer on purpose: a consumer learns "no IPC-derived identity" and
/// never which token fact was missing, so a caller cannot probe the token state of a peer it could not
/// otherwise read. The match is EXHAUSTIVE rather than a wildcard, so a future refusal reason cannot
/// join the collapse without someone deciding that it should.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
fn peer_refusal_verdict(reason: PeerContributionRefusal) -> ServiceInstanceBinding {
    match reason {
        PeerContributionRefusal::ImpersonationNotReverted
        | PeerContributionRefusal::ImpersonationFailed
        | PeerContributionRefusal::InstanceUnavailable
        | PeerContributionRefusal::TokenUserUnavailable
        | PeerContributionRefusal::TokenSessionUnavailable
        | PeerContributionRefusal::UnknownPeerPrincipal => {
            ServiceInstanceBinding::MissingIpcObservation
        }
    }
}

#[cfg(any(test, feature = "consumer-contract"))]
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
                #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
                peer: None,
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
                #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
                peer: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// Record the SCM-before observation. The token is retained INSIDE the attempt and never returned.
    #[cfg(any(test, feature = "consumer-contract"))]
    pub fn record_scm_before(
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

#[cfg(any(test, feature = "consumer-contract"))]
impl ServiceInstanceBindingAttempt<ScmBeforeObserved> {
    /// Record the confirmed IPC peer's observation. Legal ONLY after SCM-before, by construction.
    #[cfg(any(test, feature = "consumer-contract"))]
    pub fn record_ipc_peer(
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

    /// Record the confirmed IPC peer's observation TOGETHER with its bounded kernel identity, and
    /// advance. This is the ATTEMPT-SCOPED capture: the identity is decided here, stored here, and
    /// never handed back.
    ///
    /// The caller receives exactly the same two things every other transition returns — the attempt in
    /// its next opaque state, or a closed redacted verdict. Every peer-side refusal collapses onto
    /// [`ServiceInstanceBinding::MissingIpcObservation`], so which token fact was missing is not
    /// disclosed; the platform answer is preserved separately because it is not an identity fact.
    ///
    /// `connection_id` and `handshake_generation` are HOST-issued and are recorded so that a later
    /// reconciliation on this attempt cannot be satisfied by a capture from another connection.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn record_ipc_peer_identity(
        mut self,
        observation: ServiceInstanceObservation,
        facts: &PeerIdentityFacts,
        connection_id: u64,
        handshake_generation: u64,
    ) -> AttemptOutcome<IpcPeerObserved> {
        if let Some(expired) = self.inner.expiry() {
            return AttemptOutcome::Refused(expired);
        }
        // Preserve the precise platform answer, exactly as the identity-free transition does.
        if let ServiceInstanceObservation::Refused(r) = observation {
            return AttemptOutcome::Refused(ipc_refusal_verdict(r));
        }
        match decide_peer_contribution(observation, facts, connection_id, handshake_generation) {
            PeerContributionOutcome::Refused(reason) => {
                AttemptOutcome::Refused(peer_refusal_verdict(reason))
            }
            PeerContributionOutcome::Contributed(peer) => {
                self.inner.ipc_peer = Some(peer.instance);
                self.inner.peer = Some(Box::new(peer));
                AttemptOutcome::Continue(self.advance())
            }
        }
    }
}

#[cfg(any(test, feature = "consumer-contract"))]
impl ServiceInstanceBindingAttempt<IpcPeerObserved> {
    /// Record the SCM-after observation. Legal ONLY after the peer, by construction.
    #[cfg(any(test, feature = "consumer-contract"))]
    pub fn record_scm_after(
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

    /// Reconcile a LATER capture against the peer identity this attempt already recorded.
    ///
    /// This is where re-authentication lives now that identity never leaves the attempt: the
    /// expectation is the attempt's OWN earlier canonical reading, never anything a peer sent, and the
    /// process instance, the EXACT user, the EXACT session and both host-issued identifiers must all be
    /// identical. Integrity is NOT compared — it is non-authorising evidence, so a peer that elevates
    /// keeps the identity it already had.
    ///
    /// Ordering is not weakened: this transition is legal only AFTER a peer identity was recorded, it
    /// cannot skip a step, it cannot return to an earlier state, and it is strictly stricter than doing
    /// nothing because a divergent identity ends the attempt.
    #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
    pub(crate) fn reconcile_ipc_peer_identity(
        self,
        observation: ServiceInstanceObservation,
        facts: &PeerIdentityFacts,
        connection_id: u64,
        handshake_generation: u64,
    ) -> AttemptOutcome<IpcPeerObserved> {
        if let Some(expired) = self.inner.expiry() {
            return AttemptOutcome::Refused(expired);
        }
        // An attempt that advanced through the identity-free transition has no recorded peer, so there
        // is nothing to reconcile against and it fails closed rather than admitting the fresh capture.
        let Some(bound) = self.inner.peer.as_deref().copied() else {
            return AttemptOutcome::Refused(ServiceInstanceBinding::MissingIpcObservation);
        };
        if let ServiceInstanceObservation::Refused(r) = observation {
            return AttemptOutcome::Refused(ipc_refusal_verdict(r));
        }
        match decide_peer_contribution(observation, facts, connection_id, handshake_generation) {
            PeerContributionOutcome::Refused(reason) => {
                AttemptOutcome::Refused(peer_refusal_verdict(reason))
            }
            PeerContributionOutcome::Contributed(fresh) => {
                if fresh.identity_matches(&bound) {
                    AttemptOutcome::Continue(self.advance())
                } else {
                    AttemptOutcome::Refused(ServiceInstanceBinding::Mismatch)
                }
            }
        }
    }
}

#[cfg(any(test, feature = "consumer-contract"))]
impl ServiceInstanceBindingAttempt<ScmAfterObserved> {
    /// Finalise the attempt and return ONLY the closed verdict.
    ///
    /// Takes `self` by value, so the attempt is consumed: it cannot be finalised twice and no
    /// observation survives for reuse. The window is re-checked here, so an attempt that expired
    /// between the last observation and finalisation can never return `Match`.
    #[must_use]
    #[cfg(any(test, feature = "consumer-contract"))]
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

// ---------------------------------------------------------------------------------------------
// SYNTHETIC TEST FIXTURES (feature `test-fixtures` only).
//
// These exist so a DEPENDENT crate's fake backends can drive an attempt to a positive verdict with no
// Windows call at all. They are explicit, non-default, and never implied by the consumer contract or
// by live observation, so a default or live-only consumer cannot reach them.
//
// Synthetic identity is structurally distinct from live identity: a caller selects an opaque
// INSTANCE and INCARNATION selector, never a process ID and never a creation time. The mapping from
// selector to internal identity is private, so a fixture value carries no OS meaning and cannot be
// mistaken for, or substituted into, live evidence.
// ---------------------------------------------------------------------------------------------

/// An opaque synthetic instance selector. Compile-only test scaffolding.
///
/// `instance` distinguishes different running processes; `incarnation` distinguishes a RESTART of the
/// same logical process, which is what models process-ID reuse. Neither is a process ID and neither is
/// a creation time; both are arbitrary opaque labels.
#[cfg(any(test, feature = "test-fixtures"))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SyntheticInstanceSelector {
    instance: u8,
    incarnation: u8,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl SyntheticInstanceSelector {
    /// Select a synthetic instance. Same `instance` with a different `incarnation` models a restart
    /// that reuses the earlier process ID — the case that must NEVER bind.
    #[must_use]
    pub fn new(instance: u8, incarnation: u8) -> Self {
        Self {
            instance,
            incarnation,
        }
    }

    /// Map the opaque selectors onto an internal identity. PRIVATE: the mapping never leaves this
    /// module, so a fixture cannot be used to choose a real process identity.
    fn to_internal_parts(self) -> (u32, u64) {
        // Both components are forced non-zero so a synthetic identity is always well-formed.
        let process_id = 0x0001_0000_u32 | u32::from(self.instance);
        let creation_time = 0x0001_0000_0000_u64 | (u64::from(self.incarnation) + 1);
        (process_id, creation_time)
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl fmt::Debug for SyntheticInstanceSelector {
    /// Redacted like every other identity-bearing type, so a fixture can never print a selector that
    /// a reader might mistake for real identity.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SyntheticInstanceSelector([REDACTED])")
    }
}

// -------------------------------------------------------------------------------------------------
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A — ATTEMPT-SCOPED canonical peer identity.
//
// Kernel peer identity is captured INSIDE the bounded attempt that already owns the instance
// observations, and it never leaves. There is no returned contribution, no independent lifetime and no
// sibling-facing identity type: every item in this section is CRATE-PRIVATE, so a consumer crate can
// learn exactly two things — that the attempt advanced into its next opaque state, or the closed
// redacted verdict that refused it.
//
// The storage pattern is the one `ServiceInstanceToken` already established: the value is held
// privately, there is no accessor, and equality is the only permitted operation. Bounded classification
// is a FAIL-CLOSED GATE derived from the token user SID alone; it never stands in for exact identity,
// so two different users that both classify as `Owner` remain distinguishable by their bindings.
//
// Everything here is compiled only where a peer identity can legitimately originate — this crate's own
// tests, and the live Windows observation FFI. A default, consumer-contract or fixture build contains
// no peer identity type, no constructor and no storage slot at all.
// -------------------------------------------------------------------------------------------------

/// Maximum bytes of a Windows SID (`SECURITY_MAX_SID_SIZE`). A user binding is bounded by construction.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
const PEER_SID_MAX_LEN: usize = 68;

/// Shortest structurally meaningful SID: revision + sub-authority count + 6-byte authority.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
const PEER_SID_MIN_LEN: usize = 8;

/// An OPAQUE, equality-only binding to the EXACT token user.
///
/// Internally the token user's SID bytes, zero-padded so equality is well defined. Neither the bytes
/// nor the length are readable: the fields are private, the constructor is crate-private, and there is
/// no accessor, no slice view, no `AsRef`/`Borrow`/`Deref`/`Into`, no raw-parts conversion, no hash or
/// fingerprint, no `Display` and no serialisation. `Debug` is redacted. The only permitted operation is
/// equality — which is all exact-user reconciliation ever needs, because proving two observations are
/// or are not the same principal never requires reading the SID.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct PeerUserBinding {
    /// Zero-padded SID bytes. Never exposed; never accepted from a caller.
    sid: [u8; PEER_SID_MAX_LEN],
    /// Significant length. Never exposed.
    len: u8,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl PeerUserBinding {
    /// The ONLY constructor. Crate-private, so no sibling crate and no external caller can build a
    /// binding from raw bytes; it is reached only from this crate's own token observation code.
    ///
    /// Fails closed on a structurally impossible length rather than truncating.
    pub(crate) fn from_sid_bytes(raw: &[u8]) -> Option<Self> {
        if raw.len() < PEER_SID_MIN_LEN || raw.len() > PEER_SID_MAX_LEN {
            return None;
        }
        let mut sid = [0u8; PEER_SID_MAX_LEN];
        sid[..raw.len()].copy_from_slice(raw);
        Some(Self {
            sid,
            len: raw.len() as u8,
        })
    }

    /// The identifier authority (SID bytes 2..8). PRIVATE: classification input only.
    fn authority(&self) -> u64 {
        let b = &self.sid;
        (u64::from(b[2]) << 40)
            | (u64::from(b[3]) << 32)
            | (u64::from(b[4]) << 24)
            | (u64::from(b[5]) << 16)
            | (u64::from(b[6]) << 8)
            | u64::from(b[7])
    }

    /// The first sub-authority, if the SID structurally has one. PRIVATE.
    fn first_sub_authority(&self) -> Option<u32> {
        if self.sid[1] == 0 || (self.len as usize) < 12 {
            return None;
        }
        Some(u32::from_le_bytes([
            self.sid[8],
            self.sid[9],
            self.sid[10],
            self.sid[11],
        ]))
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl fmt::Debug for PeerUserBinding {
    /// Redacted: a user binding must never render a SID in any form, including a hash or a prefix.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PeerUserBinding([REDACTED])")
    }
}

/// An OPAQUE, equality-only binding to the EXACT Windows session.
///
/// Same contract as [`PeerUserBinding`]: private field, crate-private constructor, no accessor, no
/// `Display`, no serialisation, redacted `Debug`, equality only.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct PeerSessionBinding {
    /// Windows session identifier. Never exposed; never accepted from a caller.
    session: u32,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl PeerSessionBinding {
    /// The ONLY constructor. Crate-private, reached only from this crate's token observation code.
    pub(crate) fn from_session_id(session: u32) -> Self {
        Self { session }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl fmt::Debug for PeerSessionBinding {
    /// Redacted: a session binding must never render a session identifier.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PeerSessionBinding([REDACTED])")
    }
}

/// A bounded, CLOSED classification of the peer principal, derived from the token USER SID ALONE.
///
/// Deliberately ignores group membership. An elevated process carries a FILTERED token whose
/// `Administrators` entry is deny-only, so classifying by group would make the answer depend on which
/// token variant happened to be in play. Classifying by the user SID gives the same answer for both, so
/// elevation cannot promote an ordinary user.
///
/// It is used as a FAIL-CLOSED GATE — an unclassifiable principal refuses the capture — and never as a
/// substitute for exact identity.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub(crate) enum PeerPrincipalClass {
    /// A local or domain account (NT Authority sub-authority 21) — the interactive owner.
    Owner,
    /// LocalSystem (NT Authority sub-authority 18).
    System,
    /// A service account (NT Authority sub-authority 80).
    Service,
    /// Any other recognised principal. Never accepted as owner authority.
    Other,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl PeerPrincipalClass {
    /// Classify from the token user binding ALONE. PRIVATE input, bounded output.
    ///
    /// Returns `None` when the SID is structurally unclassifiable, so an unknown principal fails closed
    /// instead of defaulting to `Other`.
    pub(crate) fn from_user_binding(user: &PeerUserBinding) -> Option<Self> {
        // NT Authority is 5; sub-authority 18 is LocalSystem, 80 a service account, 21 a local or
        // domain account.
        if user.authority() != 5 {
            return Some(Self::Other);
        }
        Some(match user.first_sub_authority()? {
            18 => Self::System,
            80 => Self::Service,
            21 => Self::Owner,
            _ => Self::Other,
        })
    }
}

/// BOUNDED, NON-AUTHORISING integrity evidence.
///
/// It is captured and recorded. It can neither ESTABLISH nor INVALIDATE identity: no branch of the
/// decision core consults it, and the attempt's identity reconciliation deliberately does not compare
/// it, so a peer that elevates keeps exactly the identity it had. An unrecognised mandatory-label RID
/// classifies as [`PeerIntegrityEvidence::Unrecognised`] rather than being coerced to a neighbouring
/// level — it fails closed AS EVIDENCE, without gaining the power to refuse.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub(crate) enum PeerIntegrityEvidence {
    /// `SECURITY_MANDATORY_UNTRUSTED_RID`
    Untrusted,
    /// `SECURITY_MANDATORY_LOW_RID`
    Low,
    /// `SECURITY_MANDATORY_MEDIUM_RID` — an ordinary, non-elevated process.
    Medium,
    /// `SECURITY_MANDATORY_HIGH_RID` — an elevated process.
    High,
    /// `SECURITY_MANDATORY_SYSTEM_RID`
    System,
    /// The label was absent or its RID was not recognised. Evidence only; never a refusal.
    Unrecognised,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl PeerIntegrityEvidence {
    /// Map a mandatory-label RID. Unknown values classify as `Unrecognised`, never as a neighbour.
    pub(crate) fn from_rid(rid: u32) -> Self {
        match rid {
            0x0000 => Self::Untrusted,
            0x1000 => Self::Low,
            0x2000 => Self::Medium,
            0x3000 => Self::High,
            0x4000 => Self::System,
            _ => Self::Unrecognised,
        }
    }
}

/// CLOSED reasons a peer capture was refused. Fieldless: names the check, never the value.
///
/// CRATE-PRIVATE. A consumer never sees this: the attempt maps every one of these onto the existing
/// closed [`ServiceInstanceBinding`] verdict, so the sibling learns "no IPC-derived identity" and
/// nothing about which token fact was missing.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub(crate) enum PeerContributionRefusal {
    /// Impersonation was entered but did not revert cleanly. Checked FIRST.
    ImpersonationNotReverted,
    /// The client could not be impersonated at all.
    ImpersonationFailed,
    /// No OS-derived process instance was established.
    InstanceUnavailable,
    /// The token user could not be read or was structurally impossible.
    TokenUserUnavailable,
    /// The token session could not be read.
    TokenSessionUnavailable,
    /// The token user SID could not be classified into a bounded principal class.
    UnknownPeerPrincipal,
}

/// The bounded peer identity RECORDED INSIDE one attempt.
///
/// CRATE-PRIVATE and sealed. It is never returned to a caller, never re-exported, and has no lifetime
/// of its own: it exists only as a field of [`AttemptInner`], is written by exactly one transition and
/// is read by exactly one reconciliation, both of which live in this module.
///
/// It carries no PID, no creation time, no SID, no session identifier, no handle and no Win32 error in
/// any readable form.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Clone, Copy)]
pub(crate) struct CanonicalPeerContribution {
    _sealed: Sealed,
    /// The opaque OS-derived process instance (PID plus creation time).
    instance: ServiceInstanceToken,
    /// The opaque EXACT user binding.
    user: PeerUserBinding,
    /// The opaque EXACT session binding.
    session: PeerSessionBinding,
    /// Bounded NON-AUTHORISING integrity evidence.
    ///
    /// Recorded faithfully and consulted by NOTHING: no branch of the decision core reads it and the
    /// attempt's identity reconciliation deliberately excludes it. The lint allowance below is the
    /// compiler-checked statement of exactly that — outside this crate's own tests, integrity is a
    /// value this code writes and never acts on, which is what "can neither establish nor invalidate
    /// identity" means in practice. Deleting the allowance would only be possible by giving integrity
    /// authority over some decision.
    #[allow(dead_code)]
    integrity: PeerIntegrityEvidence,
    /// HOST-issued connection identity. Never supplied by the peer.
    connection_id: u64,
    /// HOST-issued handshake generation. Never supplied by the peer.
    handshake_generation: u64,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl fmt::Debug for CanonicalPeerContribution {
    /// Redacted: a recorded peer holds three identities and must never render any of them.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CanonicalPeerContribution([REDACTED])")
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl CanonicalPeerContribution {
    /// Exact-identity equality, used ONLY by the attempt's own reconciliation.
    ///
    /// Compares the process instance, the EXACT user, the EXACT session and both host-issued
    /// identifiers. Integrity is deliberately NOT compared: it is non-authorising evidence, so a peer
    /// that elevates between two readings keeps the identity it already had.
    fn identity_matches(&self, bound: &Self) -> bool {
        self.instance == bound.instance
            && self.user == bound.user
            && self.session == bound.session
            && self.connection_id == bound.connection_id
            && self.handshake_generation == bound.handshake_generation
    }

    /// The recorded bounded integrity evidence. CRATE-PRIVATE and consulted by no decision — it exists
    /// so the tests can prove that recording integrity changes no outcome.
    #[cfg(test)]
    fn recorded_integrity(&self) -> PeerIntegrityEvidence {
        self.integrity
    }
}

/// The CLOSED internal outcome of one peer capture.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Debug, Clone, Copy)]
pub(crate) enum PeerContributionOutcome {
    /// A bounded, sealed peer identity was established.
    Contributed(CanonicalPeerContribution),
    /// No identity; the reason is closed and redacted.
    Refused(PeerContributionRefusal),
}

/// Token-side facts gathered under impersonation.
///
/// Deliberately a SEPARATE struct from `PipePeerFacts` rather than new fields on it: the existing
/// process-observation facts and their accepted decision tests are left untouched, so this phase adds
/// an identity layer instead of mutating an accepted one.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) struct PeerIdentityFacts {
    /// Impersonation of the pipe client was entered.
    pub impersonated: bool,
    /// Impersonation was reverted AND the revert was confirmed to succeed.
    pub impersonation_reverted: bool,
    /// The token user, where it could be read.
    pub token_user: Option<PeerUserBinding>,
    /// The token session, where it could be read.
    pub token_session: Option<PeerSessionBinding>,
    /// Bounded integrity evidence, where it could be read.
    pub integrity: Option<PeerIntegrityEvidence>,
}

/// Decide a bounded peer identity from the process observation plus the token-side facts.
///
/// Ordering is deliberate and fail-closed. Reversion is checked FIRST: a capture that left the thread
/// impersonating is never trusted, however good the rest of the evidence looks. Integrity is consulted
/// by NO branch — it is recorded as evidence and can neither establish nor invalidate identity.
///
/// `connection_id` and `handshake_generation` come from the HOST, never from the peer.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub(crate) fn decide_peer_contribution(
    instance: ServiceInstanceObservation,
    facts: &PeerIdentityFacts,
    connection_id: u64,
    handshake_generation: u64,
) -> PeerContributionOutcome {
    use PeerContributionRefusal as R;

    // 1. An unreverted impersonation poisons everything that follows.
    if facts.impersonated && !facts.impersonation_reverted {
        return PeerContributionOutcome::Refused(R::ImpersonationNotReverted);
    }
    if !facts.impersonated {
        return PeerContributionOutcome::Refused(R::ImpersonationFailed);
    }
    // 2. The process instance must already have been established by the accepted observation core.
    let ServiceInstanceObservation::Observed(observed) = instance else {
        return PeerContributionOutcome::Refused(R::InstanceUnavailable);
    };
    // 3. Exact identity must be present.
    let Some(user) = facts.token_user else {
        return PeerContributionOutcome::Refused(R::TokenUserUnavailable);
    };
    let Some(session) = facts.token_session else {
        return PeerContributionOutcome::Refused(R::TokenSessionUnavailable);
    };
    // 4. Classification is derived from the user SID alone, and must succeed. It is a gate, not a
    //    stored substitute for identity.
    if PeerPrincipalClass::from_user_binding(&user).is_none() {
        return PeerContributionOutcome::Refused(R::UnknownPeerPrincipal);
    }
    // 5. Integrity is evidence. An absent reading is recorded as Unrecognised and refuses nothing.
    let integrity = facts
        .integrity
        .unwrap_or(PeerIntegrityEvidence::Unrecognised);

    PeerContributionOutcome::Contributed(CanonicalPeerContribution {
        _sealed: Sealed,
        instance: observed,
        user,
        session,
        integrity,
        connection_id,
        handshake_generation,
    })
}

/// Build a SYNTHETIC observed identity. Fixture-only; performs no Windows call, opens no process,
/// queries no SCM and creates no pipe.
#[cfg(any(test, feature = "test-fixtures"))]
#[must_use]
pub fn synthetic_observation(selector: SyntheticInstanceSelector) -> ServiceInstanceObservation {
    let (process_id, creation_time) = selector.to_internal_parts();
    match ServiceInstanceToken::from_observed_parts(process_id, creation_time) {
        Some(t) => ServiceInstanceObservation::Observed(t),
        None => ServiceInstanceObservation::Refused(ServiceInstanceRefusal::InvalidProcessId),
    }
}

/// Build a synthetic REFUSAL. Available to fixtures for symmetry; a default or live-only consumer can
/// already build refusals directly, because a refusal carries no identity.
#[cfg(any(test, feature = "test-fixtures"))]
#[must_use]
pub fn synthetic_refusal(reason: ServiceInstanceRefusal) -> ServiceInstanceObservation {
    ServiceInstanceObservation::Refused(reason)
}

#[cfg(any(test, feature = "test-fixtures"))]
impl LiveInstanceObservationCapability {
    /// A SYNTHETIC capability, so a fixture can begin an attempt. Fixture-only: it authorises nothing
    /// and reaches no Windows API, because every live observation path additionally requires the
    /// live-observation feature and a real OS handle.
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self { _sealed: Sealed }
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl ServiceInstanceBindingAttempt<Prepared> {
    /// Begin an attempt driven by a caller-advanced synthetic clock, so freshness and expiry can be
    /// tested deterministically without sleeping. Fixture-only.
    #[must_use]
    pub fn begin_with_synthetic_clock(
        _capability: &LiveInstanceObservationCapability,
        now_millis: std::rc::Rc<std::cell::Cell<u64>>,
    ) -> Self {
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
                #[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
                peer: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// The fixed synthetic observation window, so a fixture can compute an expiry deterministically
    /// without learning the production constant's meaning.
    #[must_use]
    pub fn synthetic_window_millis() -> u64 {
        MAX_OBSERVATION_WINDOW_MILLIS
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

    // ---- PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A: attempt-scoped kernel peer identity -----------
    //
    // Every case drives the REAL decision core and the REAL classification with synthetic token facts.
    // No Windows API, no pipe, no impersonation and no token is involved: the facts struct is exactly
    // what the confined FFI would hand the core after its own reads.

    /// S-1-5-21-1-2-3-1001 — an ordinary local account.
    fn owner_sid() -> [u8; 28] {
        let mut raw = [0u8; 28];
        raw[0] = 1; // revision
        raw[1] = 5; // sub-authority count
        raw[7] = 5; // NT Authority
        raw[8..12].copy_from_slice(&21u32.to_le_bytes());
        raw[12..16].copy_from_slice(&1u32.to_le_bytes());
        raw[16..20].copy_from_slice(&2u32.to_le_bytes());
        raw[20..24].copy_from_slice(&3u32.to_le_bytes());
        raw[24..28].copy_from_slice(&1001u32.to_le_bytes());
        raw
    }

    /// A DIFFERENT local account: S-1-5-21-1-2-3-1002. Same class, different exact user.
    fn other_owner_sid() -> [u8; 28] {
        let mut raw = owner_sid();
        raw[24..28].copy_from_slice(&1002u32.to_le_bytes());
        raw
    }

    /// S-1-5-18 (LocalSystem).
    fn system_sid() -> [u8; 12] {
        let mut raw = [0u8; 12];
        raw[0] = 1;
        raw[1] = 1;
        raw[7] = 5;
        raw[8..12].copy_from_slice(&18u32.to_le_bytes());
        raw
    }

    /// S-1-5-80-7 (a service account).
    fn service_sid() -> [u8; 16] {
        let mut raw = [0u8; 16];
        raw[0] = 1;
        raw[1] = 2;
        raw[7] = 5;
        raw[8..12].copy_from_slice(&80u32.to_le_bytes());
        raw[12..16].copy_from_slice(&7u32.to_le_bytes());
        raw
    }

    /// NT Authority with NO sub-authority: structurally valid, but not classifiable.
    fn unclassifiable_sid() -> [u8; 8] {
        let mut raw = [0u8; 8];
        raw[0] = 1;
        raw[1] = 0;
        raw[7] = 5;
        raw
    }

    fn peer_facts(sid: &[u8], session: u32, integrity_rid: Option<u32>) -> PeerIdentityFacts {
        PeerIdentityFacts {
            impersonated: true,
            impersonation_reverted: true,
            token_user: PeerUserBinding::from_sid_bytes(sid),
            token_session: Some(PeerSessionBinding::from_session_id(session)),
            integrity: integrity_rid.map(PeerIntegrityEvidence::from_rid),
        }
    }

    /// An attempt already advanced to `ScmBeforeObserved`, ready for a peer capture.
    fn attempt_at_scm_before() -> ServiceInstanceBindingAttempt<ScmBeforeObserved> {
        let clock = std::rc::Rc::new(std::cell::Cell::new(0u64));
        ServiceInstanceBindingAttempt::<Prepared>::begin_for_test(clock)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-before recorded")
    }

    /// Capture a peer identity into a fresh attempt and return the attempt in its next state.
    fn captured(
        sid: &[u8],
        session: u32,
        integrity_rid: Option<u32>,
    ) -> ServiceInstanceBindingAttempt<IpcPeerObserved> {
        attempt_at_scm_before()
            .record_ipc_peer_identity(
                observed(PID_A, CREATED_A),
                &peer_facts(sid, session, integrity_rid),
                77,
                5,
            )
            .into_attempt()
            .expect("peer identity captured")
    }

    #[test]
    fn integrity_rids_map_bounded_and_unknown_values_are_not_coerced() {
        // Integrity is EVIDENCE. An unrecognised label must classify as Unrecognised rather than
        // being rounded to a neighbouring level, and it still refuses nothing.
        assert_eq!(
            PeerIntegrityEvidence::from_rid(0x2000),
            PeerIntegrityEvidence::Medium
        );
        assert_eq!(
            PeerIntegrityEvidence::from_rid(0x3000),
            PeerIntegrityEvidence::High
        );
        assert_eq!(
            PeerIntegrityEvidence::from_rid(0x2500),
            PeerIntegrityEvidence::Unrecognised
        );
        assert_eq!(
            PeerIntegrityEvidence::from_rid(0xFFFF),
            PeerIntegrityEvidence::Unrecognised
        );
    }

    #[test]
    fn classification_follows_the_user_sid_alone() {
        for (sid, expected) in [
            (&owner_sid()[..], PeerPrincipalClass::Owner),
            (&system_sid()[..], PeerPrincipalClass::System),
            (&service_sid()[..], PeerPrincipalClass::Service),
        ] {
            let user = PeerUserBinding::from_sid_bytes(sid).expect("valid sid");
            assert_eq!(PeerPrincipalClass::from_user_binding(&user), Some(expected));
        }
    }

    #[test]
    fn an_unclassifiable_principal_fails_closed_rather_than_defaulting() {
        let user = PeerUserBinding::from_sid_bytes(&unclassifiable_sid()).expect("valid sid");
        assert_eq!(PeerPrincipalClass::from_user_binding(&user), None);
        let outcome = attempt_at_scm_before().record_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&unclassifiable_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(
            outcome.refusal(),
            Some(ServiceInstanceBinding::MissingIpcObservation)
        );
    }

    #[test]
    fn a_structurally_impossible_sid_yields_no_binding_at_all() {
        assert!(
            PeerUserBinding::from_sid_bytes(&[1u8; 4]).is_none(),
            "short"
        );
        assert!(
            PeerUserBinding::from_sid_bytes(&[1u8; 96]).is_none(),
            "long"
        );
    }

    #[test]
    fn an_unreverted_impersonation_is_refused_before_any_other_check() {
        // Reversion is checked FIRST: even with a perfect instance, user and session, a capture that
        // left the thread impersonating is never trusted.
        let facts = PeerIdentityFacts {
            impersonated: true,
            impersonation_reverted: false,
            ..peer_facts(&owner_sid(), 2, Some(0x2000))
        };
        assert!(matches!(
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5),
            PeerContributionOutcome::Refused(PeerContributionRefusal::ImpersonationNotReverted)
        ));
        let outcome = attempt_at_scm_before().record_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &facts,
            77,
            5,
        );
        assert_eq!(
            outcome.refusal(),
            Some(ServiceInstanceBinding::MissingIpcObservation)
        );
    }

    #[test]
    fn a_capture_that_never_impersonated_is_refused() {
        let facts = PeerIdentityFacts {
            impersonated: false,
            impersonation_reverted: false,
            ..peer_facts(&owner_sid(), 2, Some(0x2000))
        };
        assert!(matches!(
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5),
            PeerContributionOutcome::Refused(PeerContributionRefusal::ImpersonationFailed)
        ));
    }

    #[test]
    fn a_missing_token_user_or_session_is_refused() {
        let mut facts = peer_facts(&owner_sid(), 2, Some(0x2000));
        facts.token_user = None;
        assert!(matches!(
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5),
            PeerContributionOutcome::Refused(PeerContributionRefusal::TokenUserUnavailable)
        ));
        let mut facts = peer_facts(&owner_sid(), 2, Some(0x2000));
        facts.token_session = None;
        assert!(matches!(
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5),
            PeerContributionOutcome::Refused(PeerContributionRefusal::TokenSessionUnavailable)
        ));
    }

    #[test]
    fn a_refused_instance_observation_keeps_its_precise_platform_answer() {
        // The identity layer must not collapse "unsupported platform" into "no IPC observation".
        let outcome = attempt_at_scm_before().record_ipc_peer_identity(
            refused(ServiceInstanceRefusal::UnsupportedPlatform),
            &peer_facts(&owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(outcome.refusal(), Some(ServiceInstanceBinding::Unsupported));
    }

    #[test]
    fn an_identical_later_capture_reconciles_successfully() {
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        let again = bound.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert!(again.is_continuing());
    }

    #[test]
    fn two_different_users_of_the_same_class_remain_distinguishable() {
        // The whole point of keeping an EXACT user binding alongside the bounded class: both classify
        // as Owner, but they are different principals and reconciliation must refuse.
        let a = PeerUserBinding::from_sid_bytes(&owner_sid()).expect("a");
        let b = PeerUserBinding::from_sid_bytes(&other_owner_sid()).expect("b");
        assert_eq!(
            PeerPrincipalClass::from_user_binding(&a),
            PeerPrincipalClass::from_user_binding(&b),
            "the bounded class is deliberately the same"
        );
        assert_ne!(a, b, "the exact user binding must still differ");

        let bound = captured(&owner_sid(), 2, Some(0x2000));
        let outcome = bound.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&other_owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(outcome.refusal(), Some(ServiceInstanceBinding::Mismatch));
    }

    #[test]
    fn a_peer_that_moved_session_is_refused() {
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        let outcome = bound.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 3, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(outcome.refusal(), Some(ServiceInstanceBinding::Mismatch));
    }

    #[test]
    fn a_reused_pid_with_a_different_creation_identity_is_refused() {
        // The opaque instance carries PID **and** creation time, so this is the PID-reuse defence.
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        let outcome = bound.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_B),
            &peer_facts(&owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(outcome.refusal(), Some(ServiceInstanceBinding::Mismatch));
    }

    #[test]
    fn a_capture_from_another_connection_or_generation_cannot_reconcile() {
        // The host-issued identifiers are recorded, so a capture belonging to a different connection
        // or a later handshake generation cannot satisfy this attempt.
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        assert_eq!(
            bound
                .reconcile_ipc_peer_identity(
                    observed(PID_A, CREATED_A),
                    &peer_facts(&owner_sid(), 2, Some(0x2000)),
                    78,
                    5,
                )
                .refusal(),
            Some(ServiceInstanceBinding::Mismatch)
        );
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        assert_eq!(
            bound
                .reconcile_ipc_peer_identity(
                    observed(PID_A, CREATED_A),
                    &peer_facts(&owner_sid(), 2, Some(0x2000)),
                    77,
                    6,
                )
                .refusal(),
            Some(ServiceInstanceBinding::Mismatch)
        );
    }

    #[test]
    fn integrity_never_refuses_and_never_alters_identity() {
        // Ruling: integrity is non-authorising evidence. A peer that elevates between two readings
        // keeps exactly the identity it had, and reconciliation must still succeed.
        let bound = captured(&owner_sid(), 2, Some(0x2000));
        let elevated = bound.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 2, Some(0x3000)),
            77,
            5,
        );
        assert!(elevated.is_continuing(), "elevation must not refuse");
        let unknown = captured(&owner_sid(), 2, Some(0x2500)).reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 2, None),
            77,
            5,
        );
        assert!(
            unknown.is_continuing(),
            "an unreadable integrity label must not refuse"
        );
    }

    #[test]
    fn recorded_integrity_is_carried_but_authorises_nothing() {
        // It is recorded faithfully...
        let facts = peer_facts(&owner_sid(), 2, Some(0x3000));
        let PeerContributionOutcome::Contributed(high) =
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5)
        else {
            panic!("expected a contribution");
        };
        assert_eq!(high.recorded_integrity(), PeerIntegrityEvidence::High);
        // ...an absent reading records Unrecognised rather than refusing...
        let facts = peer_facts(&owner_sid(), 2, None);
        let PeerContributionOutcome::Contributed(none) =
            decide_peer_contribution(observed(PID_A, CREATED_A), &facts, 77, 5)
        else {
            panic!("expected a contribution");
        };
        assert_eq!(
            none.recorded_integrity(),
            PeerIntegrityEvidence::Unrecognised
        );
        // ...and it is excluded from identity equality, so it can neither establish nor invalidate.
        assert!(high.identity_matches(&none));
    }

    #[test]
    fn an_attempt_that_skipped_the_identity_capture_cannot_reconcile_into_one() {
        // Advancing through the identity-free transition records no peer, so there is nothing to
        // reconcile against and the attempt fails closed instead of admitting a fresh capture.
        let clock = std::rc::Rc::new(std::cell::Cell::new(0u64));
        let attempt = ServiceInstanceBindingAttempt::<Prepared>::begin_for_test(clock)
            .record_scm_before(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-before")
            .record_ipc_peer(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("peer observed without identity");
        let outcome = attempt.reconcile_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(
            outcome.refusal(),
            Some(ServiceInstanceBinding::MissingIpcObservation)
        );
    }

    #[test]
    fn a_captured_peer_identity_still_completes_the_ordinary_binding() {
        // The identity layer sits ALONGSIDE the accepted cross-source binding; it neither replaces
        // nor weakens it.
        let verdict = captured(&owner_sid(), 2, Some(0x2000))
            .record_scm_after(observed(PID_A, CREATED_A))
            .into_attempt()
            .expect("scm-after")
            .finalise();
        assert_eq!(verdict, ServiceInstanceBinding::Match);
    }

    #[test]
    fn an_expired_attempt_cannot_capture_or_reconcile_a_peer_identity() {
        let clock = std::rc::Rc::new(std::cell::Cell::new(0u64));
        let attempt =
            ServiceInstanceBindingAttempt::<Prepared>::begin_for_test(std::rc::Rc::clone(&clock))
                .record_scm_before(observed(PID_A, CREATED_A))
                .into_attempt()
                .expect("scm-before");
        clock.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
        let outcome = attempt.record_ipc_peer_identity(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 2, Some(0x2000)),
            77,
            5,
        );
        assert_eq!(
            outcome.refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );

        let clock = std::rc::Rc::new(std::cell::Cell::new(0u64));
        let bound =
            ServiceInstanceBindingAttempt::<Prepared>::begin_for_test(std::rc::Rc::clone(&clock))
                .record_scm_before(observed(PID_A, CREATED_A))
                .into_attempt()
                .expect("scm-before")
                .record_ipc_peer_identity(
                    observed(PID_A, CREATED_A),
                    &peer_facts(&owner_sid(), 2, Some(0x2000)),
                    77,
                    5,
                )
                .into_attempt()
                .expect("captured");
        clock.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
        assert_eq!(
            bound
                .reconcile_ipc_peer_identity(
                    observed(PID_A, CREATED_A),
                    &peer_facts(&owner_sid(), 2, Some(0x2000)),
                    77,
                    5,
                )
                .refusal(),
            Some(ServiceInstanceBinding::ObservationWindowExpired)
        );
    }

    #[test]
    fn a_recorded_peer_identity_is_never_rendered() {
        let user = PeerUserBinding::from_sid_bytes(&owner_sid()).expect("sid");
        let session = PeerSessionBinding::from_session_id(7);
        assert_eq!(format!("{user:?}"), "PeerUserBinding([REDACTED])");
        assert_eq!(format!("{session:?}"), "PeerSessionBinding([REDACTED])");
        let PeerContributionOutcome::Contributed(peer) = decide_peer_contribution(
            observed(PID_A, CREATED_A),
            &peer_facts(&owner_sid(), 7, Some(0x2000)),
            77,
            5,
        ) else {
            panic!("expected a contribution");
        };
        let rendered = format!("{peer:?}");
        assert_eq!(rendered, "CanonicalPeerContribution([REDACTED])");
        assert!(!rendered.contains("1001") && !rendered.contains('7'));
        // The attempt holding one renders nothing either.
        assert_eq!(
            format!("{:?}", captured(&owner_sid(), 7, Some(0x2000))),
            "ServiceInstanceBindingAttempt([REDACTED])"
        );
    }
}
