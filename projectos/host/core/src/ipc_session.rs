//! Authenticated IPC-session authority (CD-B4-IPC-SESSION-AUTHORITY1A, Pattern C).
//!
//! An authorised request reaches the trusted host over exactly ONE authenticated local IPC connection.
//! This module mints the sole IPC-session authority value — the opaque [`BoundIpcSession`] — binding one
//! exact connection to the trusted [`crate::runtime_instance::VerifiedRuntimeInstance`], the confirmed
//! peer process, the peer user/session, the project/environment/phase channel, the repository baseline,
//! the trusted-clock provider identity + epoch, and the bounded channel capabilities and operation
//! families. A LATER phase folds it into the permit/grant; here it is the contract only.
//!
//! Authority is minted ONLY by a sealed [`IpcSessionVerifier`] from an UNTRUSTED [`IpcPeerObservation`]
//! plus a single-use [`ConfirmedHandshakeEvidence`]. A completed transport handshake is EVIDENCE, never
//! authority, and a past handshake never authorises a NEW connection: reconnection yields a new connection
//! identity and handshake generation, so the prior session is refused. Every opaque type has private
//! fields, no public constructor, no `Default`, no serde-as-authority, no broad `From`, a redacted
//! `Debug`, and is thread-bound (`!Send + !Sync`).
//!
//! ## Relationship to `ConfirmedIpcPeerHandshake`
//!
//! The Windows `ConfirmedIpcPeerHandshake` (crate `projectos-host-windows-local-ipc`) is transport-level
//! handshake EVIDENCE. It never enters `core`; a future adapter projects it into the bounded, single-use
//! [`ConfirmedHandshakeEvidence`] carried here, and the sealed verifier decides sufficiency. This phase
//! adds NO dependency on the Windows IPC crate, opens no named pipe, and reads no live peer SID/PID.
//!
//! ## Production readiness
//!
//! This phase ships NO production IPC provider and performs no live observation. The only verifier is the
//! test-gated fixture. [`BoundIpcSession`] is NOT integrated into the permit, context digest, effect-grant
//! issuance or any witness — those are CARRY-FORWARD. `EXECUTION_READY` stays false.

#![allow(dead_code)]

use core::fmt;
use core::marker::PhantomData;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, ProjectId};

use crate::authority_time::VerifiedAuthorityTime;
use crate::facts::{validate_bounded_id, SessionId};
use crate::runtime_instance::VerifiedRuntimeInstance;

type ThreadBound = PhantomData<*const ()>;

// ---------------------------------------------------------------------------------------------
// Bounded classifications (never a bare Boolean / free string)
// ---------------------------------------------------------------------------------------------

/// The liveness of the connection a verifier represents. A dead connection mints and authorises nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ConnectionLiveness {
    /// The connection is live.
    Live,
    /// The peer disconnected.
    Disconnected,
    /// The session authority was revoked.
    Revoked,
}

/// A bounded classification of the connected peer's user identity (never a raw SID/token).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PeerUserClass {
    /// The interactive owner.
    Owner,
    /// The local SYSTEM account.
    System,
    /// The ProjectOS host service account.
    Service,
    /// Any other / unrecognised principal (never accepted as owner authority).
    Other,
}

/// A bounded channel capability. The verifier bounds which capabilities a session may carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ChannelCapability {
    /// Observation-only channel.
    ObserveOnly,
    /// A channel permitted to carry record-marker effect requests.
    RecordMarker,
}

/// A bounded operation family a session is permitted to carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OperationFamily {
    /// Record-marker family.
    RecordMarker,
    /// Reserved family with no adapter.
    ReservedNoAdapter,
}

// ---------------------------------------------------------------------------------------------
// Single-use confirmed-handshake evidence (bounded projection; NOT the Windows type)
// ---------------------------------------------------------------------------------------------

/// A bounded, SINGLE-USE core-side projection of a Windows `ConfirmedIpcPeerHandshake`. It carries only
/// the handshake generation and a confirmation marker as EVIDENCE. It is NOT the Windows type, NOT
/// authority, and is consumed (moved) by the sealed verifier so one confirmed handshake attests at most
/// one session. A future adapter constructs it from a real confirmed handshake; this phase has none.
pub struct ConfirmedHandshakeEvidence {
    handshake_generation: u64,
    confirmed: bool,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for ConfirmedHandshakeEvidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ConfirmedHandshakeEvidence([REDACTED])")
    }
}

impl ConfirmedHandshakeEvidence {
    /// A CONFIRMED handshake-evidence projection for `handshake_generation`.
    #[must_use]
    pub fn confirmed(handshake_generation: u64) -> Self {
        Self {
            handshake_generation,
            confirmed: true,
            _thread_bound: PhantomData,
        }
    }
    /// TEST/adapter helper: an UNCONFIRMED projection (verification must refuse it).
    #[must_use]
    pub fn unconfirmed(handshake_generation: u64) -> Self {
        Self {
            handshake_generation,
            confirmed: false,
            _thread_bound: PhantomData,
        }
    }
    fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }
    fn is_confirmed(&self) -> bool {
        self.confirmed
    }
}

// ---------------------------------------------------------------------------------------------
// Untrusted observation + bounded comparison inputs
// ---------------------------------------------------------------------------------------------

/// The parsed, still-UNTRUSTED reading a future IPC adapter reports for ONE connection. Nothing here is
/// authority; there is no `From<IpcPeerObservation>` producing a verified session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpcPeerObservation {
    /// The connection identity (per accepted connection).
    pub connection_id: u64,
    /// The handshake generation (per handshake; a reconnection advances it).
    pub handshake_generation: u64,
    /// Connected-peer process id.
    pub client_pid: u32,
    /// Connected-peer process creation tick (with pid, its identity; defeats pid reuse).
    pub client_creation_tick: u64,
    /// Bounded peer user classification.
    pub user: PeerUserClass,
    /// The peer's authenticated session, where represented.
    pub session: Option<SessionId>,
    /// The channel project.
    pub project: ProjectId,
    /// The channel environment.
    pub environment: EnvironmentId,
    /// A bounded digest of the channel phase.
    pub phase_digest: [u8; 32],
    /// A bounded digest of the repository identity (root/common-dir/project).
    pub repository_identity: [u8; 32],
    /// A bounded digest of the repository baseline (commit/branch/cleanliness).
    pub repository_baseline: [u8; 32],
    /// Monotonic tick at which the connection was observed.
    pub observed_at: u64,
    /// Monotonic tick after which the session authority is no longer valid.
    pub valid_until: u64,
    /// The channel capabilities requested (must be within the verifier's bound).
    pub capabilities: Vec<ChannelCapability>,
    /// The operation families requested (must be within the verifier's bound).
    pub operation_families: Vec<OperationFamily>,
}

/// The expected peer identity a caller compares a bound session against (a plain comparison input).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedPeer {
    pub pid: u32,
    pub creation_tick: u64,
    pub user: PeerUserClass,
    pub session: Option<SessionId>,
}

/// The expected channel a caller compares a bound session against (a plain comparison input).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedChannel {
    pub project: ProjectId,
    pub environment: EnvironmentId,
    pub phase_digest: [u8; 32],
    pub repository_identity: [u8; 32],
    pub repository_baseline: [u8; 32],
}

// ---------------------------------------------------------------------------------------------
// Structured refusal taxonomy
// ---------------------------------------------------------------------------------------------

/// Why IPC-session verification or currentness failed. Fail closed; every variant is payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IpcSessionError {
    /// A bounded identifier was empty/over-long/illegal.
    Malformed,
    /// The handshake evidence was not confirmed.
    HandshakeNotConfirmed,
    /// The peer process identity was invalid (zero pid or creation tick).
    InvalidPeerProcess,
    /// The validity window was invalid (`valid_until <= observed_at`).
    ProofWindowInvalid,
    /// The session had expired at evaluation time.
    Expired,
    /// The requested validity exceeded the verifier's accepted maximum window.
    ExpiryBeyondBound,
    /// The observation was older than the verifier's accepted staleness bound.
    StaleObservation,
    /// A requested channel capability was outside the verifier's bound.
    CapabilityUnbounded,
    /// A requested operation family was outside the verifier's bound.
    OperationFamilyUnbounded,
    /// The runtime instance differed (a DIFFERENT or restarted trusted host start).
    RuntimeInstanceMismatch,
    /// The runtime instance had itself expired.
    RuntimeNotCurrent,
    /// The current trusted-clock reading came from a DIFFERENT provider.
    ProviderMismatch,
    /// The current trusted-clock reading came from an EARLIER/DIFFERENT provider epoch.
    ProviderEpochMismatch,
    /// The connection identity differed (a different or reconnected connection).
    ConnectionMismatch,
    /// The handshake generation differed (a re-handshake).
    HandshakeGenerationMismatch,
    /// The connection had disconnected.
    Disconnected,
    /// The session authority was revoked.
    Revoked,
    /// The peer process identity differed from the expected peer.
    PeerProcessMismatch,
    /// The peer user classification differed.
    PeerUserMismatch,
    /// The peer session differed.
    PeerSessionMismatch,
    /// The channel project differed.
    ProjectMismatch,
    /// The channel environment differed.
    EnvironmentMismatch,
    /// The channel phase differed.
    PhaseMismatch,
    /// The repository identity differed.
    RepositoryIdentityMismatch,
    /// The repository baseline differed.
    RepositoryBaselineMismatch,
    /// A capability not carried by this session was requested.
    CapabilityNotPermitted,
    /// An operation family not carried by this session was requested.
    OperationFamilyNotPermitted,
}

// ---------------------------------------------------------------------------------------------
// Opaque bound IPC session (the sole IPC-session authority value)
// ---------------------------------------------------------------------------------------------

/// A verified, authenticated IPC session: the sole authority for one exact IPC connection. Opaque —
/// private fields, no public constructor, no `Default`, no serde-as-authority, no broad `From`, redacted
/// `Debug`, NOT `Copy`, NOT `Clone`, thread-bound. Minted ONLY by a sealed [`IpcSessionVerifier`].
pub struct BoundIpcSession {
    session_digest: [u8; 32],
    runtime_generation: u64,
    runtime_digest: [u8; 32],
    connection_id: u64,
    handshake_generation: u64,
    client_pid: u32,
    client_creation_tick: u64,
    user: PeerUserClass,
    session: Option<SessionId>,
    project: ProjectId,
    environment: EnvironmentId,
    phase_digest: [u8; 32],
    repository_identity: [u8; 32],
    repository_baseline: [u8; 32],
    provider_id: String,
    provider_epoch: u64,
    established_at: u64,
    valid_until: u64,
    capabilities: Vec<ChannelCapability>,
    operation_families: Vec<OperationFamily>,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for BoundIpcSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BoundIpcSession(conn=[REDACTED], [REDACTED])")
    }
}

impl BoundIpcSession {
    pub(crate) fn connection_id(&self) -> u64 {
        self.connection_id
    }
    pub(crate) fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }
    pub(crate) fn runtime_generation(&self) -> u64 {
        self.runtime_generation
    }
    pub(crate) fn session_digest(&self) -> [u8; 32] {
        self.session_digest
    }

    /// Re-validate this session against the CURRENT runtime instance, IPC-session verifier and trusted
    /// clock. Fail closed. Refuses a runtime restart, a substituted/epoch-restarted clock provider, a
    /// different/reconnected connection, a re-handshake, a disconnected or revoked connection, or an
    /// expired window.
    ///
    /// # Errors
    /// [`IpcSessionError`] naming the first failed invariant.
    #[must_use = "the currentness result must be checked"]
    pub fn is_current<V: IpcSessionVerifier>(
        &self,
        verifier: &V,
        runtime: &VerifiedRuntimeInstance,
        now: &VerifiedAuthorityTime,
    ) -> Result<(), IpcSessionError> {
        if runtime.generation() != self.runtime_generation
            || runtime.instance_digest() != self.runtime_digest
        {
            return Err(IpcSessionError::RuntimeInstanceMismatch);
        }
        if now.provider_id() != self.provider_id {
            return Err(IpcSessionError::ProviderMismatch);
        }
        if now.epoch() != self.provider_epoch {
            return Err(IpcSessionError::ProviderEpochMismatch);
        }
        if verifier.connection_id() != self.connection_id {
            return Err(IpcSessionError::ConnectionMismatch);
        }
        if verifier.handshake_generation() != self.handshake_generation {
            return Err(IpcSessionError::HandshakeGenerationMismatch);
        }
        match verifier.liveness() {
            ConnectionLiveness::Disconnected => return Err(IpcSessionError::Disconnected),
            ConnectionLiveness::Revoked => return Err(IpcSessionError::Revoked),
            ConnectionLiveness::Live => {}
        }
        if now.reading() >= self.valid_until {
            return Err(IpcSessionError::Expired);
        }
        Ok(())
    }

    /// Confirm the bound peer identity matches the expected connected peer. Refuses a different process,
    /// user classification or session.
    ///
    /// # Errors
    /// [`IpcSessionError`] naming the first difference.
    pub fn matches_peer(&self, expected: &ExpectedPeer) -> Result<(), IpcSessionError> {
        if self.client_pid != expected.pid || self.client_creation_tick != expected.creation_tick {
            return Err(IpcSessionError::PeerProcessMismatch);
        }
        if self.user != expected.user {
            return Err(IpcSessionError::PeerUserMismatch);
        }
        if self.session != expected.session {
            return Err(IpcSessionError::PeerSessionMismatch);
        }
        Ok(())
    }

    /// Confirm the bound channel matches the expected project/environment/phase/repository. Refuses a
    /// cross-project, cross-environment, cross-phase, or cross-repository presentation.
    ///
    /// # Errors
    /// [`IpcSessionError`] naming the first difference.
    pub fn matches_channel(&self, expected: &ExpectedChannel) -> Result<(), IpcSessionError> {
        if self.project != expected.project {
            return Err(IpcSessionError::ProjectMismatch);
        }
        if self.environment != expected.environment {
            return Err(IpcSessionError::EnvironmentMismatch);
        }
        if self.phase_digest != expected.phase_digest {
            return Err(IpcSessionError::PhaseMismatch);
        }
        if self.repository_identity != expected.repository_identity {
            return Err(IpcSessionError::RepositoryIdentityMismatch);
        }
        if self.repository_baseline != expected.repository_baseline {
            return Err(IpcSessionError::RepositoryBaselineMismatch);
        }
        Ok(())
    }

    /// Confirm this session carries `capability`. Refuses an expanded capability the session never bound.
    ///
    /// # Errors
    /// [`IpcSessionError::CapabilityNotPermitted`] when absent.
    pub fn permits_capability(&self, capability: ChannelCapability) -> Result<(), IpcSessionError> {
        if self.capabilities.contains(&capability) {
            Ok(())
        } else {
            Err(IpcSessionError::CapabilityNotPermitted)
        }
    }

    /// Confirm this session carries `family`. Refuses an expanded operation family the session never bound.
    ///
    /// # Errors
    /// [`IpcSessionError::OperationFamilyNotPermitted`] when absent.
    pub fn permits_family(&self, family: OperationFamily) -> Result<(), IpcSessionError> {
        if self.operation_families.contains(&family) {
            Ok(())
        } else {
            Err(IpcSessionError::OperationFamilyNotPermitted)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The crate-internal mint + sealed verifier
// ---------------------------------------------------------------------------------------------

mod sealed {
    pub trait Sealed {}
}

const FIXTURE_MAX_WINDOW: u64 = 10_000;
const FIXTURE_MAX_STALENESS: u64 = 5_000;

/// The crate-internal mint. Consumes the single-use confirmed-handshake evidence, re-validates the
/// untrusted observation against the verifier's live connection and bounds and the runtime instance, and
/// stamps the trusted-clock provider identity + epoch into an opaque [`BoundIpcSession`]. Construction
/// lives ONLY here.
#[allow(clippy::too_many_arguments)]
fn mint<V: IpcSessionVerifier + ?Sized>(
    verifier: &V,
    runtime: &VerifiedRuntimeInstance,
    handshake: ConfirmedHandshakeEvidence,
    obs: &IpcPeerObservation,
    now: &VerifiedAuthorityTime,
) -> Result<BoundIpcSession, IpcSessionError> {
    if !handshake.is_confirmed() {
        return Err(IpcSessionError::HandshakeNotConfirmed);
    }
    if let Some(s) = obs.session.as_ref() {
        validate_bounded_id(s.as_str()).map_err(|_| IpcSessionError::Malformed)?;
    }
    if obs.client_pid == 0 || obs.client_creation_tick == 0 {
        return Err(IpcSessionError::InvalidPeerProcess);
    }
    // The confirmed handshake, the observation and the verifier must all name the SAME live connection.
    if obs.connection_id != verifier.connection_id() {
        return Err(IpcSessionError::ConnectionMismatch);
    }
    if handshake.handshake_generation() != verifier.handshake_generation()
        || obs.handshake_generation != verifier.handshake_generation()
    {
        return Err(IpcSessionError::HandshakeGenerationMismatch);
    }
    match verifier.liveness() {
        ConnectionLiveness::Disconnected => return Err(IpcSessionError::Disconnected),
        ConnectionLiveness::Revoked => return Err(IpcSessionError::Revoked),
        ConnectionLiveness::Live => {}
    }
    if obs
        .capabilities
        .iter()
        .any(|c| !verifier.permitted_capabilities().contains(c))
    {
        return Err(IpcSessionError::CapabilityUnbounded);
    }
    if obs
        .operation_families
        .iter()
        .any(|fam| !verifier.permitted_families().contains(fam))
    {
        return Err(IpcSessionError::OperationFamilyUnbounded);
    }
    if obs.valid_until <= obs.observed_at {
        return Err(IpcSessionError::ProofWindowInvalid);
    }
    if now.reading() >= obs.valid_until {
        return Err(IpcSessionError::Expired);
    }
    if obs.valid_until > now.reading().saturating_add(verifier.max_window()) {
        return Err(IpcSessionError::ExpiryBeyondBound);
    }
    if now.reading().saturating_sub(obs.observed_at) > verifier.max_staleness() {
        return Err(IpcSessionError::StaleObservation);
    }
    // The runtime instance must itself still be within its own validity window.
    if now.reading() >= runtime.valid_until() {
        return Err(IpcSessionError::RuntimeNotCurrent);
    }
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:IPC-SESSION:V1");
    h.update(runtime.instance_digest());
    h.update(runtime.generation().to_be_bytes());
    h.update(obs.connection_id.to_be_bytes());
    h.update(obs.handshake_generation.to_be_bytes());
    h.update(obs.client_pid.to_be_bytes());
    h.update(obs.client_creation_tick.to_be_bytes());
    h.update(obs.phase_digest);
    h.update(obs.repository_identity);
    h.update(obs.repository_baseline);
    Ok(BoundIpcSession {
        session_digest: h.finalize().into(),
        runtime_generation: runtime.generation(),
        runtime_digest: runtime.instance_digest(),
        connection_id: obs.connection_id,
        handshake_generation: obs.handshake_generation,
        client_pid: obs.client_pid,
        client_creation_tick: obs.client_creation_tick,
        user: obs.user,
        session: obs.session.clone(),
        project: obs.project.clone(),
        environment: obs.environment.clone(),
        phase_digest: obs.phase_digest,
        repository_identity: obs.repository_identity,
        repository_baseline: obs.repository_baseline,
        provider_id: now.provider_id().to_string(),
        provider_epoch: now.epoch(),
        established_at: now.reading(),
        valid_until: obs.valid_until,
        capabilities: obs.capabilities.clone(),
        operation_families: obs.operation_families.clone(),
        _thread_bound: PhantomData,
    })
}

/// The sealed IPC-session VERIFIER contract. A verifier is the crate-controlled authority representing ONE
/// live accepted connection; it owns the connection identity, handshake generation, liveness and the
/// capability/family bounds, and it alone may mint a [`BoundIpcSession`]. No external crate can implement
/// it.
pub trait IpcSessionVerifier: sealed::Sealed {
    /// The verifier's live connection identity (a reconnection yields a new one; not caller-selectable).
    fn connection_id(&self) -> u64;
    /// The current handshake generation (a re-handshake advances it; not caller-selectable).
    fn handshake_generation(&self) -> u64;
    /// The connection liveness (a disconnect/revocation changes it; not caller-selectable).
    fn liveness(&self) -> ConnectionLiveness;
    /// The maximum validity window (from `now`) this verifier will attest.
    fn max_window(&self) -> u64;
    /// The maximum observation staleness this verifier will accept.
    fn max_staleness(&self) -> u64;
    /// The bounded channel capabilities this verifier permits.
    fn permitted_capabilities(&self) -> &[ChannelCapability];
    /// The bounded operation families this verifier permits.
    fn permitted_families(&self) -> &[OperationFamily];

    /// Attest an untrusted observation + single-use confirmed handshake into an opaque
    /// [`BoundIpcSession`], bound to `runtime` and stamped with the current trusted-clock provider.
    ///
    /// # Errors
    /// [`IpcSessionError`] on the first failed invariant.
    fn verify(
        &self,
        runtime: &VerifiedRuntimeInstance,
        handshake: ConfirmedHandshakeEvidence,
        obs: &IpcPeerObservation,
        now: &VerifiedAuthorityTime,
    ) -> Result<BoundIpcSession, IpcSessionError> {
        mint(self, runtime, handshake, obs, now)
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture::FixtureIpcSessionVerifier;

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture {
    use super::{
        sealed, ChannelCapability, ConnectionLiveness, IpcSessionVerifier, OperationFamily,
        FIXTURE_MAX_STALENESS, FIXTURE_MAX_WINDOW,
    };
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering};
    use std::rc::Rc;

    struct VerifierState {
        connection_id: Cell<u64>,
        handshake_generation: Cell<u64>,
        liveness: Cell<ConnectionLiveness>,
        capabilities: Vec<ChannelCapability>,
        families: Vec<OperationFamily>,
    }

    /// TEST-ONLY sealed IPC-session verifier modelling ONE live connection. Connection id and handshake
    /// generation are crate-assigned (not caller-selectable); `reconnect` yields a NEW connection id +
    /// handshake generation (so a prior session is refused), `disconnect`/`revoke` change liveness,
    /// `advance_handshake` models a re-handshake on the same connection. A production graph never builds
    /// it.
    #[derive(Clone)]
    pub struct FixtureIpcSessionVerifier {
        state: Rc<VerifierState>,
    }

    static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

    impl FixtureIpcSessionVerifier {
        /// A fresh live connection with a UNIQUE connection id + handshake generation and default bounds
        /// (both capabilities, record-marker family).
        #[must_use]
        pub fn new() -> Self {
            let base = NEXT_CONN.fetch_add(1_000, Ordering::Relaxed);
            Self {
                state: Rc::new(VerifierState {
                    connection_id: Cell::new(base),
                    handshake_generation: Cell::new(base),
                    liveness: Cell::new(ConnectionLiveness::Live),
                    capabilities: vec![
                        ChannelCapability::ObserveOnly,
                        ChannelCapability::RecordMarker,
                    ],
                    families: vec![OperationFamily::RecordMarker],
                }),
            }
        }
        /// Another handle to the SAME connection state.
        #[must_use]
        pub fn handle(&self) -> Self {
            Self {
                state: Rc::clone(&self.state),
            }
        }
        /// Model a reconnection: a NEW connection id and handshake generation (the prior session is now
        /// refused).
        pub fn reconnect(&self) {
            self.state
                .connection_id
                .set(self.state.connection_id.get() + 1);
            self.state
                .handshake_generation
                .set(self.state.handshake_generation.get() + 1);
        }
        /// Model a re-handshake on the same connection (advances only the handshake generation).
        pub fn advance_handshake(&self) {
            self.state
                .handshake_generation
                .set(self.state.handshake_generation.get() + 1);
        }
        /// Model a peer disconnect.
        pub fn disconnect(&self) {
            self.state.liveness.set(ConnectionLiveness::Disconnected);
        }
        /// Model a session revocation.
        pub fn revoke(&self) {
            self.state.liveness.set(ConnectionLiveness::Revoked);
        }
    }

    impl Default for FixtureIpcSessionVerifier {
        fn default() -> Self {
            Self::new()
        }
    }

    impl sealed::Sealed for FixtureIpcSessionVerifier {}
    impl IpcSessionVerifier for FixtureIpcSessionVerifier {
        fn connection_id(&self) -> u64 {
            self.state.connection_id.get()
        }
        fn handshake_generation(&self) -> u64 {
            self.state.handshake_generation.get()
        }
        fn liveness(&self) -> ConnectionLiveness {
            self.state.liveness.get()
        }
        fn max_window(&self) -> u64 {
            FIXTURE_MAX_WINDOW
        }
        fn max_staleness(&self) -> u64 {
            FIXTURE_MAX_STALENESS
        }
        fn permitted_capabilities(&self) -> &[ChannelCapability] {
            &self.state.capabilities
        }
        fn permitted_families(&self) -> &[OperationFamily] {
            &self.state.families
        }
    }
}
