//! PROJECTOS-HOST-REVIEW-PATH1B — the canonical PRODUCTION CLIENT-ADMISSION attempt (ROUTE 1).
//!
//! # Why this exists beside the service-instance attempt
//!
//! [`crate::ServiceInstanceBindingAttempt`] proves ONE proposition:
//!
//! > the IPC peer is the SAME running instance as the SCM-observed ProjectOSHost service.
//!
//! That is the B3 proof-runner direction, where this side is the pipe SERVER and the SERVICE FIXTURE
//! is the client. The INSTALLED product is the reverse: ProjectOSHost is the pipe server and the
//! governed Agent is the client. Inside the Host, a service-instance attempt about its own client can
//! therefore never finalise to [`crate::ServiceInstanceBinding::Match`] — the client is not the
//! service — so that route can yield no admission and no session evidence, however the Host is
//! activated.
//!
//! This module adds the SEPARATE proposition the installed product actually needs:
//!
//! > the connected pipe CLIENT is the EXACT enrolled ProjectOS configured owner, on exactly this
//! > host-issued connection and handshake generation.
//!
//! The two are different claims about different processes. They deliberately do NOT share a verdict
//! type: a single `Match` whose meaning depended on which caller produced it is precisely the
//! ambiguity this crate exists to prevent. They share only the sealed OUTPUT,
//! [`crate::VerifiedPeerAdmission`], so downstream there is still exactly one admission type, one
//! peer-context mint and one session mint. O7 is untouched.
//!
//! # What authority comes from where
//!
//! - **Principal identity comes from the token USER SID alone**, compared for equality against the
//!   EXACT enrolled configured-owner SID read from the canonical installation record — the same
//!   record that already supplies the configured-owner principal for the production ProjectOSHost
//!   pipe DACL. Class membership (`Owner`, `Administrators`, LocalSystem, a service account) is
//!   never admission. An unavailable canonical owner REFUSES; there is no fallback principal.
//! - **The expected owner is never caller-selected.** There is no API here that accepts a SID, a
//!   hex string, bytes, a name, an `S-1-…` form, an environment variable or a request field. The
//!   only non-test input type is a verified canonical installation.
//! - **The handshake gates but never authorises.** A confirmed handshake in the expected production
//!   client role is a PRECONDITION of capture; it establishes no identity by itself.
//! - **Integrity is captured and recorded, and authorises nothing.** No branch below reads it. High
//!   integrity cannot promote a different user into the configured owner, and the configured owner is
//!   not denied for being elevated.
//! - **Session must be observed and must stay stable**, and stays opaque. It is never compared to a
//!   caller-supplied session and never to "the current interactive desktop session".

use core::fmt;

use crate::instance::{
    decide_peer_contribution, AttemptClock, CanonicalPeerContribution, PeerContributionOutcome,
    PeerContributionRefusal, PeerIdentityFacts, PeerIntegrityEvidence, PeerUserBinding, Sealed,
    ServiceInstanceObservation, ServiceInstanceRefusal, MAX_OBSERVATION_WINDOW_MILLIS,
};
use crate::VerifiedPeerAdmission;

// -------------------------------------------------------------------------------------------------
// THE NARROW LIVE CAPABILITY
// -------------------------------------------------------------------------------------------------

/// SEALED authority to perform ONE live client-admission observation.
///
/// Deliberately a SEPARATE type from [`crate::LiveInstanceObservationCapability`], which still has no
/// constructor in any build. Widening that one so the client route could reuse it would have handed
/// the B3 service-instance attempt a live capability it is not allowed to have; a distinct type keeps
/// the two reachabilities independent.
///
/// It grants exactly one thing: observing the connected pipe client of a handle the caller already
/// owns. It grants no SCM query, no SCM mutation, no protected-operation authority, no delegation and
/// no generic identity observation, and it carries no caller-selected identity of any kind.
///
/// Obtainable only under the non-default `windows-client-admission` feature, which the production IPC
/// composition is the only thing that enables.
#[derive(Debug)]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub struct ClientAdmissionObservationCapability {
    _sealed: Sealed,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ClientAdmissionObservationCapability {
    /// The PRODUCTION acquisition. Compiled only under `windows-client-admission`.
    ///
    /// It takes no argument, so there is nothing for a caller to steer: the capability says "this
    /// build is the trusted production IPC composition", and every identity fact still comes from
    /// Windows and from the canonical record.
    #[cfg(feature = "windows-client-admission")]
    #[must_use]
    pub fn for_production_ipc() -> Self {
        Self { _sealed: Sealed }
    }

    /// TEST-ONLY. `cfg(test)` alone — deliberately NOT behind `test-fixtures`, so no dependent crate
    /// and no fixture graph can reach it.
    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self { _sealed: Sealed }
    }
}

// -------------------------------------------------------------------------------------------------
// THE EXPECTED PRINCIPAL
// -------------------------------------------------------------------------------------------------

/// Why the canonical configured owner could not be established. Fieldless: names the check, never a
/// value, and never distinguishes one absent owner from another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ConfiguredOwnerRefusal {
    /// The installation has no enrolled ProjectOS owner. A version-1 record always means this.
    NotEnrolled,
    /// An owner was enrolled but its encoding is not a structurally valid binary SID.
    SidMalformed,
}

/// The EXACT enrolled configured-owner principal, in equality-only form.
///
/// SEALED. The only production constructor is [`Self::from_canonical_installation`], so the expected
/// principal can originate ONLY in the canonical installation record. There is deliberately no
/// constructor from a SID, from bytes, from hex, from a name or from an `S-1-…` string, no accessor,
/// no `Display` and no serialisation: a caller can supply the canonical record's verified form and
/// nothing else, and can never read back what it compared against.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub struct EnrolledOwnerPrincipal {
    _sealed: Sealed,
    user: PeerUserBinding,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl fmt::Debug for EnrolledOwnerPrincipal {
    /// Redacted: the expected owner is still a SID and must never be rendered, hashed or prefixed.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("EnrolledOwnerPrincipal([REDACTED])")
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl EnrolledOwnerPrincipal {
    /// THE PRODUCTION SOURCE: the enrolled configured-owner SID of the canonical installation.
    ///
    /// This is the SAME `OwnerEnrolment` that
    /// `host-authority::security::configured_owner_sid_string()` reads to build the fourth principal
    /// of the production ProjectOSHost pipe DACL. Reusing it is what keeps ONE enrolled owner on the
    /// machine — resolving an owner any other way here would be a second owner authority.
    ///
    /// `OwnerEnrolment::Absent` REFUSES. Nothing infers an owner from the console user, the
    /// interactive user, the installing account, an administrator, the service account or a token
    /// the Host happens to be holding.
    ///
    /// # Errors
    /// [`ConfiguredOwnerRefusal`] naming the first failed check.
    #[cfg(feature = "windows-client-admission")]
    pub fn from_canonical_installation(
        _capability: &ClientAdmissionObservationCapability,
        installation: &projectos_host_identity::canonical_record::VerifiedCanonicalInstallation,
    ) -> Result<Self, ConfiguredOwnerRefusal> {
        use projectos_host_identity::canonical_record::OwnerEnrolment;

        // A non-exhaustive canonical enum: anything that is not a positive enrolment refuses, so a
        // future variant cannot silently become an admitted principal.
        let hex = match installation.owner_enrolment() {
            OwnerEnrolment::Enrolled(hex) => hex,
            _ => return Err(ConfiguredOwnerRefusal::NotEnrolled),
        };
        let bytes = decode_lower_hex(&hex).ok_or(ConfiguredOwnerRefusal::SidMalformed)?;
        // The SAME bounded constructor the live token capture uses, so the expected principal and the
        // observed principal are the same kind of value and equality between them is well defined.
        let user =
            PeerUserBinding::from_sid_bytes(&bytes).ok_or(ConfiguredOwnerRefusal::SidMalformed)?;
        Ok(Self {
            _sealed: Sealed,
            user,
        })
    }

    /// TEST-ONLY. `cfg(test)` alone, so it exists in no shipped build and in no fixture graph.
    #[cfg(test)]
    pub(crate) fn from_sid_bytes_for_test(raw: &[u8]) -> Option<Self> {
        Some(Self {
            _sealed: Sealed,
            user: PeerUserBinding::from_sid_bytes(raw)?,
        })
    }
}

/// Decode the canonical record's lower-case hex encoding of a binary SID.
///
/// UPPER-CASE IS REFUSED, not normalised: the canonical record's contract is lower-case hex, and a
/// reader that accepted both would accept an encoding the writer never produces.
#[cfg(feature = "windows-client-admission")]
fn decode_lower_hex(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i < b.len() {
        out.push((hex_nibble(b[i])? << 4) | hex_nibble(b[i + 1])?);
        i += 2;
    }
    Some(out)
}

/// One lower-case hex nibble, or nothing.
#[cfg(feature = "windows-client-admission")]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

// -------------------------------------------------------------------------------------------------
// THE CLOSED VERDICT — REFUSALS ONLY
// -------------------------------------------------------------------------------------------------

/// Why a client admission was refused.
///
/// THERE IS DELIBERATELY NO POSITIVE VARIANT. A public enum variant is something any caller can write
/// down, so a `Match`/`Admitted` here would be a positive answer a consumer could have produced
/// itself. The only positive answer this module can give is the sealed
/// [`crate::VerifiedPeerAdmission`], which nothing outside a completed canonical attempt can make.
///
/// Every token-side capture failure collapses onto [`Self::NoClientObservation`], so which token fact
/// was missing is not disclosed. [`Self::PrincipalNotConfiguredOwner`] stays distinct because it is
/// the whole question this attempt answers and it is read only by the Host's own composition — the
/// connected peer is told nothing beyond a refused protected operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ClientAdmissionVerdict {
    /// No OS-derived client identity was established, for a reason that is not disclosed further.
    NoClientObservation,
    /// The bounded nonce-bound handshake was not confirmed before the capture.
    HandshakeNotConfirmed,
    /// The confirmed peer role is not the expected production client role.
    UnexpectedClientRole,
    /// The client process changed between the capture and its re-observation.
    ClientChangedDuringObservation,
    /// The client's EXACT token user is not the EXACT enrolled configured owner.
    PrincipalNotConfiguredOwner,
    /// The client's Windows token session changed within the bounded attempt.
    SessionChanged,
    /// Evidence was presented for a connection or handshake generation other than its own.
    CrossConnectionPresentation,
    /// The bounded observation window elapsed.
    ObservationWindowExpired,
    /// Client admission is not supported on this platform or in this build.
    UnsupportedPlatform,
    /// Any other failure, redacted.
    UnexpectedFailure,
}

/// Map a closed process-observation refusal onto the client verdict.
///
/// The EXHAUSTIVE match is the point: a future observation refusal cannot join the collapse without
/// someone deciding that it should.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
fn client_observation_verdict(r: ServiceInstanceRefusal) -> ClientAdmissionVerdict {
    use ServiceInstanceRefusal as R;
    match r {
        R::UnsupportedPlatform => ClientAdmissionVerdict::UnsupportedPlatform,
        R::HandshakeNotConfirmed => ClientAdmissionVerdict::HandshakeNotConfirmed,
        R::UnexpectedPeerRole => ClientAdmissionVerdict::UnexpectedClientRole,
        R::PeerChangedDuringObservation => ClientAdmissionVerdict::ClientChangedDuringObservation,
        // Everything else collapses: the Host learns "no client identity" and never which kernel
        // read failed. Listed EXHAUSTIVELY with no wildcard, so a future refusal reason cannot join
        // the collapse without someone deciding that it should.
        R::PipeNotConnected
        | R::ConnectionClosedDuringObservation
        | R::PeerProcessIdUnavailable
        | R::InvalidProcessId
        | R::ProcessOpenDenied
        | R::ProcessCreationTimeUnavailable
        | R::BackendUnavailable
        | R::UnexpectedObservationFailure
        // The three SCM answers cannot arise on this route at all — a client-admission attempt makes
        // no SCM observation — but they are named rather than wildcarded so that stays true by
        // construction.
        | R::ServiceNotRunning
        | R::ServiceStatusUnavailable
        | R::ServiceTypeAmbiguous
        | R::ServiceInstanceChangedDuringObservation => ClientAdmissionVerdict::NoClientObservation,
    }
}

/// Collapse a token-capture refusal. Every reason maps to the SAME answer on purpose.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
fn client_capture_verdict(r: PeerContributionRefusal) -> ClientAdmissionVerdict {
    use PeerContributionRefusal as R;
    match r {
        R::ImpersonationNotReverted
        | R::ImpersonationFailed
        | R::InstanceUnavailable
        | R::TokenUserUnavailable
        | R::TokenSessionUnavailable
        | R::UnknownPeerPrincipal => ClientAdmissionVerdict::NoClientObservation,
    }
}

// -------------------------------------------------------------------------------------------------
// THE ATTEMPT
// -------------------------------------------------------------------------------------------------

/// Type-state markers. UNINHABITED: they distinguish states at compile time and can never be
/// constructed, stored or forged.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ClientPrepared {}
/// The client's bounded kernel identity was captured and matched the configured owner.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ClientObserved {}

/// The attempt's private contents. Never public, never returned, never cloned.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
struct ClientAttemptInner {
    clock: AttemptClock,
    /// The EXACT expected principal, fixed when the attempt began. It cannot be replaced afterwards:
    /// there is no setter and no transition takes a principal, so no later call can re-aim a
    /// half-finished attempt at a different owner.
    expected_owner: PeerUserBinding,
    /// The bounded client identity recorded INSIDE this attempt. Boxed so a SID buffer does not
    /// travel inside every transition's return value.
    captured: Option<Box<CanonicalPeerContribution>>,
    /// HOST-ISSUED `(connection_id, handshake_generation)`. There is NO accessor: these can only ever
    /// be compared, never read back out of the attempt.
    host_connection: Option<(u64, u64)>,
    /// Bounded NON-AUTHORISING integrity evidence, recorded and consulted by nothing.
    #[allow(dead_code)]
    integrity: Option<PeerIntegrityEvidence>,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ClientAttemptInner {
    /// Fail closed once the bounded window has elapsed. Checked on EVERY transition and again at
    /// admission, so expiry at any point refuses.
    fn expiry(&self) -> Option<ClientAdmissionVerdict> {
        if self.clock.elapsed_millis() > MAX_OBSERVATION_WINDOW_MILLIS {
            return Some(ClientAdmissionVerdict::ObservationWindowExpired);
        }
        None
    }
}

/// One bounded, ordered, CONSUMABLE client-admission attempt.
///
/// The captured identity is collected THROUGH the attempt, stored only INSIDE it and can never be
/// extracted, so an observation from one attempt cannot be presented to another. Ordering is enforced
/// by the type: each transition CONSUMES the attempt and returns it in the next state, and a state
/// exposes only the methods legal from it.
///
/// Not `Clone`, not `Copy`, not `Default`, not serialisable, redacted `Debug`.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub struct ClientPeerAdmissionAttempt<S> {
    inner: ClientAttemptInner,
    _state: core::marker::PhantomData<S>,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> fmt::Debug for ClientPeerAdmissionAttempt<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClientPeerAdmissionAttempt([REDACTED])")
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> ClientPeerAdmissionAttempt<S> {
    /// Move the attempt into its next state, carrying the private contents with it.
    fn advance<T>(self) -> ClientPeerAdmissionAttempt<T> {
        ClientPeerAdmissionAttempt {
            inner: self.inner,
            _state: core::marker::PhantomData,
        }
    }
}

/// The result of one transition: the attempt in its next state, or a terminal closed refusal.
///
/// A refusal CONSUMES the attempt — there is no way back to a usable state, so a failed capture can
/// never be retried into an admission.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
pub enum ClientAttemptOutcome<S> {
    /// The attempt advanced.
    Continue(ClientPeerAdmissionAttempt<S>),
    /// The attempt ended with this closed verdict.
    Refused(ClientAdmissionVerdict),
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> fmt::Debug for ClientAttemptOutcome<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Continue(_) => f.write_str("ClientAttemptOutcome::Continue([REDACTED])"),
            Self::Refused(v) => write!(f, "ClientAttemptOutcome::Refused({v:?})"),
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl<S> ClientAttemptOutcome<S> {
    /// Whether the attempt is still usable.
    #[must_use]
    pub fn is_continuing(&self) -> bool {
        matches!(self, Self::Continue(_))
    }

    /// The closed verdict that ended the attempt, if it ended.
    #[must_use]
    pub fn refusal(&self) -> Option<ClientAdmissionVerdict> {
        match self {
            Self::Continue(_) => None,
            Self::Refused(v) => Some(*v),
        }
    }

    /// Take the continuing attempt, if there is one.
    #[must_use]
    pub fn into_attempt(self) -> Option<ClientPeerAdmissionAttempt<S>> {
        match self {
            Self::Continue(a) => Some(a),
            Self::Refused(_) => None,
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ClientPeerAdmissionAttempt<ClientPrepared> {
    /// Begin a client-admission attempt against the EXACT enrolled configured owner.
    ///
    /// The expected principal is fixed HERE and is never a transition argument, so a half-finished
    /// attempt cannot be re-aimed at a different owner. Requires the sealed narrow capability; there
    /// is no `Default`, no caller-supplied clock and no caller-supplied deadline.
    #[must_use]
    pub fn begin(
        _capability: &ClientAdmissionObservationCapability,
        owner: &EnrolledOwnerPrincipal,
    ) -> Self {
        Self {
            inner: ClientAttemptInner {
                clock: AttemptClock::Monotonic(std::time::Instant::now()),
                expected_owner: owner.user,
                captured: None,
                host_connection: None,
                integrity: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// TEST-ONLY deterministic clock. `cfg(test)` and crate-private.
    #[cfg(test)]
    pub(crate) fn begin_for_test(
        owner: &EnrolledOwnerPrincipal,
        now_millis: std::rc::Rc<std::cell::Cell<u64>>,
    ) -> Self {
        let started_at = now_millis.get();
        Self {
            inner: ClientAttemptInner {
                clock: AttemptClock::Fake {
                    now_millis,
                    started_at,
                    peak: std::cell::Cell::new(started_at),
                },
                expected_owner: owner.user,
                captured: None,
                host_connection: None,
                integrity: None,
            },
            _state: core::marker::PhantomData,
        }
    }

    /// Record the confirmed client's bounded kernel identity and prove it is the configured owner.
    ///
    /// ORDER IS THE CONTRACT, and every gate is checked before the next is credited:
    /// window → host-issued identifiers → platform/handshake/role → process observation →
    /// token capture → EXACT configured-owner equality.
    ///
    /// The identity is decided here, stored here, and never handed back: the caller receives the
    /// attempt in its next opaque state, or a closed redacted verdict.
    #[must_use]
    pub(crate) fn record_client_identity(
        mut self,
        observation: ServiceInstanceObservation,
        facts: &PeerIdentityFacts,
        connection_id: u64,
        handshake_generation: u64,
    ) -> ClientAttemptOutcome<ClientObserved> {
        if let Some(expired) = self.inner.expiry() {
            return ClientAttemptOutcome::Refused(expired);
        }
        // A zero identifier is a non-identity. Refused symmetrically with the service-instance route,
        // so neither can store an unpairable pair.
        if connection_id == 0 || handshake_generation == 0 {
            return ClientAttemptOutcome::Refused(ClientAdmissionVerdict::NoClientObservation);
        }
        // The platform / connection / handshake / ROLE answers are preserved precisely. The role gate
        // is the accepted `decide_pipe_peer` one, driven with the PRODUCTION client role rather than
        // the B3 service-fixture role.
        if let ServiceInstanceObservation::Refused(r) = observation {
            return ClientAttemptOutcome::Refused(client_observation_verdict(r));
        }
        match decide_peer_contribution(observation, facts, connection_id, handshake_generation) {
            PeerContributionOutcome::Refused(reason) => {
                ClientAttemptOutcome::Refused(client_capture_verdict(reason))
            }
            PeerContributionOutcome::Contributed(peer) => {
                // THE ADMISSION QUESTION. Equality against the EXACT enrolled configured-owner SID.
                // Not a class, not a group, not a name, not an integrity level.
                if !peer.is_exactly_user(&self.inner.expected_owner) {
                    return ClientAttemptOutcome::Refused(
                        ClientAdmissionVerdict::PrincipalNotConfiguredOwner,
                    );
                }
                self.inner.integrity = Some(peer.integrity_evidence());
                self.inner.host_connection = Some((connection_id, handshake_generation));
                self.inner.captured = Some(Box::new(peer));
                ClientAttemptOutcome::Continue(self.advance())
            }
        }
    }
}

/// The BOUNDED process identity of a client this attempt has already admitted into its
/// `ClientObserved` state.
///
/// PROJECTOS-HOST-REVIEW-PATH1B G3. It carries the two scalars the Host session evidence binds - the
/// OS-observed process id and its creation time, which together defeat pid reuse - and NOTHING else.
/// No SID, no session identifier, no account name, no integrity level, no handle.
///
/// It is EVIDENCE, not authority: holding one admits nothing, proves no principal, and cannot be
/// turned back into an attempt, an admission or a peer context. The admission remains the sealed
/// [`VerifiedPeerAdmission`], obtainable only by CONSUMING the attempt.
///
/// It is not caller-constructible: there is no public constructor, no `Default` and no `From`, so
/// the only way to hold one is to have driven a real capture that really matched the enrolled
/// configured owner.
#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct AdmittedClientProcess {
    _sealed: Sealed,
    pid: u32,
    creation_tick: u64,
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl fmt::Debug for AdmittedClientProcess {
    /// Redacted. The scalars are readable through the accessors by a caller that already holds the
    /// value; they are never rendered into a log line by accident.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AdmittedClientProcess([REDACTED])")
    }
}

#[cfg(all(
    any(test, feature = "test-fixtures"),
    any(test, all(windows, feature = "windows-live-instance-observation"))
))]
impl AdmittedClientProcess {
    /// FIXTURE-ONLY. A bounded admitted-client process with chosen scalars, so a dependent crate can
    /// prove its own assembly order without a live pipe and without a kernel read.
    ///
    /// It admits NOTHING and proves no principal: the value carries no authority anywhere, so a
    /// synthetic one confers exactly what a real one does - two scalars. Gated to `test-fixtures`,
    /// which no shipped graph enables and which the live IPC feature does not imply.
    #[must_use]
    pub fn synthetic_for_fixture(pid: u32, creation_tick: u64) -> Self {
        Self {
            _sealed: Sealed,
            pid,
            creation_tick,
        }
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl AdmittedClientProcess {
    /// The OS-observed client process id.
    #[must_use]
    pub fn pid(&self) -> u32 {
        self.pid
    }
    /// The OS-observed client process creation tick. With the pid, the process identity.
    #[must_use]
    pub fn creation_tick(&self) -> u64 {
        self.creation_tick
    }
}

#[cfg(any(test, all(windows, feature = "windows-live-instance-observation")))]
impl ClientPeerAdmissionAttempt<ClientObserved> {
    /// The bounded process identity of the client THIS attempt captured and matched.
    ///
    /// Borrowing, not consuming: the attempt must still be consumed by
    /// [`Self::admit_client_for_connection`] for anything to be admitted, and this read changes no
    /// state and skips no gate. `None` only if there is no capture, which the type state already
    /// makes unreachable - it is asked rather than assumed so there is no branch that invents one.
    ///
    /// The value is the SAME capture the exact-configured-owner equality was decided on, so the
    /// process the Host binds into its session evidence is by construction the process it admitted.
    #[must_use]
    pub fn observed_client_process(&self) -> Option<AdmittedClientProcess> {
        let captured = self.inner.captured.as_deref()?;
        let (pid, creation_tick) = captured.observed_process_parts();
        Some(AdmittedClientProcess {
            _sealed: Sealed,
            pid,
            creation_tick,
        })
    }

    /// Re-observe the client and reconcile against what this attempt already recorded.
    ///
    /// The expectation is the attempt's OWN earlier canonical reading, never anything a peer sent.
    /// The process instance, the EXACT user, the EXACT session and both host-issued identifiers must
    /// all be identical. Integrity is NOT compared: it is non-authorising evidence, so a client that
    /// elevates between two readings keeps exactly the identity it already had.
    #[must_use]
    pub(crate) fn reconcile_client_identity(
        self,
        observation: ServiceInstanceObservation,
        facts: &PeerIdentityFacts,
        connection_id: u64,
        handshake_generation: u64,
    ) -> ClientAttemptOutcome<ClientObserved> {
        if let Some(expired) = self.inner.expiry() {
            return ClientAttemptOutcome::Refused(expired);
        }
        let Some(bound) = self.inner.captured.as_deref().copied() else {
            return ClientAttemptOutcome::Refused(ClientAdmissionVerdict::NoClientObservation);
        };
        if let ServiceInstanceObservation::Refused(r) = observation {
            return ClientAttemptOutcome::Refused(client_observation_verdict(r));
        }
        match decide_peer_contribution(observation, facts, connection_id, handshake_generation) {
            PeerContributionOutcome::Refused(reason) => {
                ClientAttemptOutcome::Refused(client_capture_verdict(reason))
            }
            PeerContributionOutcome::Contributed(fresh) => {
                // Ordered so the most specific divergence is named. A changed session refuses even
                // though the process and user are unchanged (ruling section 4).
                if fresh.observed_instance() != bound.observed_instance() {
                    return ClientAttemptOutcome::Refused(
                        ClientAdmissionVerdict::ClientChangedDuringObservation,
                    );
                }
                if !fresh.is_same_session(&bound) {
                    return ClientAttemptOutcome::Refused(ClientAdmissionVerdict::SessionChanged);
                }
                if !fresh.is_exactly_user(&self.inner.expected_owner) {
                    return ClientAttemptOutcome::Refused(
                        ClientAdmissionVerdict::PrincipalNotConfiguredOwner,
                    );
                }
                if fresh.host_pair() != bound.host_pair() {
                    return ClientAttemptOutcome::Refused(
                        ClientAdmissionVerdict::CrossConnectionPresentation,
                    );
                }
                ClientAttemptOutcome::Continue(self.advance())
            }
        }
    }

    /// Admit the client for EXACTLY this host-issued connection and handshake generation, or return
    /// the closed verdict that refused it.
    ///
    /// CONSUMING, so an attempt can neither be admitted twice nor re-paired against a second
    /// connection. The pairing is checked BEFORE anything else is credited, so a cross-connection
    /// presentation can never be reported as an identity answer.
    ///
    /// # Errors
    /// The closed [`ClientAdmissionVerdict`] that refused, so an operator learns which gate said no
    /// without the admission ever having existed.
    pub fn admit_client_for_connection(
        self,
        connection_id: u64,
        handshake_generation: u64,
    ) -> Result<VerifiedPeerAdmission, ClientAdmissionVerdict> {
        if let Some(expired) = self.inner.expiry() {
            return Err(expired);
        }
        let Some(captured) = self.inner.captured.as_deref() else {
            return Err(ClientAdmissionVerdict::NoClientObservation);
        };
        let Some(stored_pair) = self.inner.host_connection else {
            return Err(ClientAdmissionVerdict::NoClientObservation);
        };
        let asked = (connection_id, handshake_generation);
        // THE PAIR THE ATTEMPT STORED == THE PAIR INSIDE THE CAPTURE == THE PAIR ASKED ABOUT.
        // All three, so neither the attempt's own bookkeeping nor the caller's values alone can
        // establish an admission.
        if stored_pair != asked || captured.host_pair() != asked {
            return Err(ClientAdmissionVerdict::CrossConnectionPresentation);
        }
        // DEFENCE IN DEPTH, NOT THE CONTROL. The capture could not have been stored unless it already
        // matched; restating it here means no future edit to the transition can quietly admit a
        // principal this final gate would have refused.
        if !captured.is_exactly_user(&self.inner.expected_owner) {
            return Err(ClientAdmissionVerdict::PrincipalNotConfiguredOwner);
        }
        Ok(VerifiedPeerAdmission::for_admitted_client(
            connection_id,
            handshake_generation,
        ))
    }
}

// -------------------------------------------------------------------------------------------------
// SYNTHETIC FIXTURES (feature `test-fixtures` only).
//
// These exist so a DEPENDENT crate can drive a client admission to its sealed output with no Windows
// call at all — the same reason, and the same shape, as the service-instance route's
// `synthetic_observation` / `begin_with_synthetic_clock`. They are explicit, non-default, and never
// implied by the consumer contract or by live observation.
//
// Synthetic identity is structurally distinct from live identity: a caller selects an opaque LABEL,
// never a SID, never a process ID and never a creation time. The mapping from label to internal
// identity is PRIVATE, so a fixture value carries no OS meaning and cannot be used to smuggle a real
// principal into a real decision. A fixture owner and a fixture client that share a label agree; any
// two different labels disagree — which is all a dependent's crossing tests need.
// -------------------------------------------------------------------------------------------------

/// An opaque synthetic principal label. Compile-only test scaffolding: NOT a SID.
#[cfg(feature = "test-fixtures")]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SyntheticOwnerSelector {
    label: u8,
}

#[cfg(feature = "test-fixtures")]
impl SyntheticOwnerSelector {
    /// Select an opaque synthetic principal. The label distinguishes principals and means nothing
    /// else; it is not a RID and is never rendered.
    #[must_use]
    pub fn new(label: u8) -> Self {
        Self { label }
    }
}

#[cfg(feature = "test-fixtures")]
impl fmt::Debug for SyntheticOwnerSelector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SyntheticOwnerSelector([REDACTED])")
    }
}

/// Map an opaque label onto a structurally valid synthetic account SID. PRIVATE.
#[cfg(feature = "test-fixtures")]
fn synthetic_owner_sid(label: u8) -> [u8; 28] {
    let mut raw = [0u8; 28];
    raw[0] = 1; // revision
    raw[1] = 5; // sub-authority count
    raw[7] = 5; // NT Authority
    raw[8..12].copy_from_slice(&21u32.to_le_bytes());
    raw[12..16].copy_from_slice(&1u32.to_le_bytes());
    raw[16..20].copy_from_slice(&2u32.to_le_bytes());
    raw[20..24].copy_from_slice(&3u32.to_le_bytes());
    raw[24..28].copy_from_slice(&(1000u32 + u32::from(label)).to_le_bytes());
    raw
}

#[cfg(feature = "test-fixtures")]
impl ClientAdmissionObservationCapability {
    /// FIXTURE-ONLY acquisition. Explicit and non-default; never implied by the live feature.
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self { _sealed: Sealed }
    }
}

#[cfg(feature = "test-fixtures")]
impl EnrolledOwnerPrincipal {
    /// FIXTURE-ONLY expected principal, from an opaque label rather than a SID.
    #[must_use]
    pub fn synthetic_for_fixture(selector: SyntheticOwnerSelector) -> Self {
        Self {
            _sealed: Sealed,
            // The synthetic SID is structurally valid by construction, so this cannot fail.
            user: PeerUserBinding::from_sid_bytes(&synthetic_owner_sid(selector.label))
                .expect("synthetic owner SID is structurally valid"),
        }
    }
}

#[cfg(feature = "test-fixtures")]
impl ClientPeerAdmissionAttempt<ClientPrepared> {
    /// FIXTURE-ONLY capture: drive the REAL decision core with synthetic kernel facts.
    ///
    /// Every gate below is the production one — the window, the zero-identifier check, the capture
    /// core, and the EXACT configured-owner equality. Only the facts are synthetic, so a dependent's
    /// crossing test proves the real ordering rather than a mock of it. A label that differs from the
    /// attempt's expected owner refuses exactly as a different real user would.
    #[must_use]
    pub fn record_synthetic_client(
        self,
        selector: SyntheticOwnerSelector,
        session: u32,
        process_label: u8,
        connection_id: u64,
        handshake_generation: u64,
    ) -> ClientAttemptOutcome<ClientObserved> {
        use crate::instance::{PeerSessionBinding, ServiceInstanceToken};

        let observation = match ServiceInstanceToken::from_observed_parts(
            4000 + u32::from(process_label),
            900_000 + u64::from(process_label),
        ) {
            Some(t) => ServiceInstanceObservation::Observed(t),
            None => {
                return ClientAttemptOutcome::Refused(ClientAdmissionVerdict::NoClientObservation)
            }
        };
        let facts = PeerIdentityFacts {
            impersonated: true,
            impersonation_reverted: true,
            token_user: PeerUserBinding::from_sid_bytes(&synthetic_owner_sid(selector.label)),
            token_session: Some(PeerSessionBinding::from_session_id(session)),
            integrity: Some(PeerIntegrityEvidence::from_rid(0x2000)),
        };
        self.record_client_identity(observation, &facts, connection_id, handshake_generation)
    }
}

#[cfg(test)]
mod tests;
