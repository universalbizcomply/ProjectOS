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
// REQUEST ADMISSION (RUN-TO-COMPLETION HOST ATTESTATION - OPERATION AUTHORITY + REQUEST BINDING)
//
// WHY IT LIVES HERE, AND NOT IN THE IPC CRATE. `BoundIpcSession` is already the sole IPC-session
// authority: it owns the connection identity, the handshake generation and the session digest, and
// those fields are crate-private, so nothing outside `core` can read them, let alone assert them. A
// second session model in the transport crate would be a second opinion about the same connection,
// which is exactly the duplication the peer-contract reconciliation removed once already. So
// sequence, correlation and replay admission are answered HERE, by the session that already knows
// which connection it is, and the transport crate receives a sealed answer it cannot fabricate.
//
// WHAT AN ADMISSION IS NOT. It is not permission to do anything. It says one thing: this exact
// request arrived on this exact session, its sequence advanced, and its correlation has not been
// seen before. Every authority gate stands untouched in front of any effect.
// ---------------------------------------------------------------------------------------------

/// Bounded correlation width. A correlation is an opaque tag, never a message.
pub const REQUEST_CORRELATION_LEN: usize = 16;

/// The most correlations one session will remember before refusing.
///
/// BOUNDED ON PURPOSE. An unbounded set is a memory exhaustion the peer controls: a caller that can
/// open a session can otherwise make the host remember one entry per request for as long as the
/// connection lives. When the bound is reached the answer is a refusal, never an eviction - evicting
/// the oldest entry is precisely how a replay window reopens.
pub const MAX_REMEMBERED_CORRELATIONS: usize = 1024;

/// Why a request was not admitted. Closed set; every variant refuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RequestAdmissionError {
    /// The store belongs to a different session than the one asked to admit the request.
    StoreNotBoundToSession,
    /// The sequence did not advance. A repeat and a rewind are the same answer: no.
    SequenceNotAdvancing,
    /// This correlation has already been admitted on this session.
    CorrelationReplayed,
    /// The session has remembered as many correlations as it will.
    AdmissionCapacityExhausted,
}

/// Where a session's admission history lives.
///
/// SEALED. A downstream crate cannot implement it, so "has this correlation been seen?" is never a
/// question a caller gets to answer about itself. The trait exists so that the durable, restart
/// surviving store belonging to the persistence checkpoint can back exactly this contract without
/// changing what admission MEANS - the ordering and replay rules below stay here either way.
///
/// # Compile-fail evidence
///
/// Downstream cannot implement it: the supertrait lives in a private module, so no outside type can
/// satisfy the bound.
///
/// ```compile_fail
/// use projectos_host_core::{RequestAdmissionError, RequestAdmissionStore, REQUEST_CORRELATION_LEN};
/// struct MyStore;
/// impl RequestAdmissionStore for MyStore {
///     fn session_digest(&self) -> [u8; 32] { [0u8; 32] }
///     fn last_sequence(&self) -> u64 { 0 }
///     fn is_correlation_seen(&self, _c: &[u8; REQUEST_CORRELATION_LEN]) -> bool { false }
///     fn record(&mut self, _s: u64, _c: [u8; REQUEST_CORRELATION_LEN])
///         -> Result<(), RequestAdmissionError> { Ok(()) }
/// }
/// ```
///
/// The positive control, so the refusal above is a refusal about the SEAL and not about a name that
/// does not resolve - the trait is public, nameable and implemented by the store this module ships:
///
/// ```
/// use projectos_host_core::{InMemoryRequestAdmissionStore, RequestAdmissionStore};
/// fn last<S: RequestAdmissionStore + ?Sized>(s: &S) -> u64 { s.last_sequence() }
/// fn _read(s: &InMemoryRequestAdmissionStore) -> u64 { last(s) }
/// ```
pub trait RequestAdmissionStore: sealed::Sealed {
    /// The session this store belongs to. Compared before anything is recorded.
    fn session_digest(&self) -> [u8; 32];
    /// The highest sequence admitted so far. Zero when nothing has been admitted.
    fn last_sequence(&self) -> u64;
    /// Whether this correlation was already admitted on this session.
    fn is_correlation_seen(&self, correlation: &[u8; REQUEST_CORRELATION_LEN]) -> bool;
    /// Record an admission.
    ///
    /// AN IMPLEMENTATION MUST RE-ENFORCE THE ORDERING AND REPLAY RULES rather than storing whatever
    /// it is handed. This method is public on a public trait, so a caller holding a store reaches it
    /// WITHOUT passing through [`BoundIpcSession::admit_request`]. If the rules lived only in the
    /// mint, one direct `record` with a lower number would rewind the watermark and reopen every
    /// sequence beneath it - the invariant has to hold at the place that writes.
    ///
    /// # Errors
    /// [`RequestAdmissionError::SequenceNotAdvancing`] when `sequence` does not exceed
    /// [`Self::last_sequence`]; [`RequestAdmissionError::CorrelationReplayed`] when the correlation
    /// was already recorded; [`RequestAdmissionError::AdmissionCapacityExhausted`] when the bound is
    /// reached.
    fn record(
        &mut self,
        sequence: u64,
        correlation: [u8; REQUEST_CORRELATION_LEN],
    ) -> Result<(), RequestAdmissionError>;
}

/// The in-memory admission history for one session.
///
/// Bound to its session at construction, so it cannot be presented to another one. It survives
/// nothing: a restart forgets it, which is why durable replay storage is its own checkpoint. What it
/// must not do, and does not, is forget while the session is still alive.
///
/// HOST OBLIGATION, STATED PLAINLY: open exactly ONE store per session and keep it for the session's
/// whole life. The store binds to the session; the session does not own the store. A second store
/// opened for the same session is an empty history, and an empty history admits everything the first
/// one already refused. Nothing a PEER sends can cause that - the peer never touches a store - but
/// host code that reopened one per request would have removed replay protection by itself. The
/// durable-store checkpoint is where a session's history stops being a value the host has to hold.
pub struct InMemoryRequestAdmissionStore {
    session_digest: [u8; 32],
    last_sequence: u64,
    seen: Vec<[u8; REQUEST_CORRELATION_LEN]>,
}

impl fmt::Debug for InMemoryRequestAdmissionStore {
    // Redacted like the session it binds to: the digest and the remembered tags never print. The
    // two counts are diagnostics, not identity.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "InMemoryRequestAdmissionStore(last_sequence={}, remembered={}, [REDACTED])",
            self.last_sequence,
            self.seen.len()
        )
    }
}

impl InMemoryRequestAdmissionStore {
    /// Open an empty history for exactly this session.
    #[must_use]
    pub fn for_session(session: &BoundIpcSession) -> Self {
        Self {
            session_digest: session.session_digest(),
            last_sequence: 0,
            seen: Vec::new(),
        }
    }
}

impl sealed::Sealed for InMemoryRequestAdmissionStore {}

impl RequestAdmissionStore for InMemoryRequestAdmissionStore {
    fn session_digest(&self) -> [u8; 32] {
        self.session_digest
    }
    fn last_sequence(&self) -> u64 {
        self.last_sequence
    }
    fn is_correlation_seen(&self, correlation: &[u8; REQUEST_CORRELATION_LEN]) -> bool {
        self.seen.iter().any(|c| c == correlation)
    }
    fn record(
        &mut self,
        sequence: u64,
        correlation: [u8; REQUEST_CORRELATION_LEN],
    ) -> Result<(), RequestAdmissionError> {
        // Re-enforced HERE, not only in the mint, because this method is reachable directly.
        if sequence <= self.last_sequence {
            return Err(RequestAdmissionError::SequenceNotAdvancing);
        }
        if self.is_correlation_seen(&correlation) {
            return Err(RequestAdmissionError::CorrelationReplayed);
        }
        if self.seen.len() >= MAX_REMEMBERED_CORRELATIONS {
            return Err(RequestAdmissionError::AdmissionCapacityExhausted);
        }
        self.seen.push(correlation);
        self.last_sequence = sequence;
        Ok(())
    }
}

/// Evidence that one exact request was admitted on one exact session.
///
/// Opaque: private fields, no public constructor, no `Default`, no `Clone`, no serde, redacted
/// `Debug`, thread-bound. The identifiers it exposes are the ones the HOST issued - a caller cannot
/// pair a genuine admission with a different connection, because it never supplies them.
///
/// It is deliberately NOT `Clone`: an admission answers one request. Handing out copies of it is how
/// a single admitted request comes to authorise several.
///
/// # What it does NOT carry
///
/// It answers no authority question, and it is not a shortcut past one. Capability, operation family,
/// peer, channel and currentness remain the SESSION's to answer, at the moment the operation is
/// attempted - see [`BoundIpcSession::permits_capability`], [`BoundIpcSession::permits_family`],
/// [`BoundIpcSession::matches_peer`], [`BoundIpcSession::matches_channel`] and
/// [`BoundIpcSession::is_current`]. Admission deliberately consults none of them, so holding an
/// admission never means a gate was passed; it means one request was not a duplicate.
///
/// # Compile-fail evidence
///
/// A caller cannot build one - every field is private and there is no constructor:
///
/// ```compile_fail
/// use projectos_host_core::AdmittedRequest;
/// let _ = AdmittedRequest {
///     connection_id: 1,
///     handshake_generation: 1,
///     session_digest: [0u8; 32],
///     correlation: [0u8; 16],
///     sequence: 1,
/// };
/// ```
///
/// The positive control, so that refusal is about the type's shape rather than a name that does not
/// resolve:
///
/// ```
/// use projectos_host_core::AdmittedRequest;
/// fn _read(a: &AdmittedRequest) -> u64 { a.sequence() }
/// ```
///
/// It answers no capability question - only the session does:
///
/// ```compile_fail
/// use projectos_host_core::{AdmittedRequest, ChannelCapability};
/// fn _f(a: &AdmittedRequest) { let _ = a.permits_capability(ChannelCapability::RecordMarker); }
/// ```
///
/// ```
/// use projectos_host_core::{BoundIpcSession, ChannelCapability};
/// fn _f(s: &BoundIpcSession) { let _ = s.permits_capability(ChannelCapability::RecordMarker); }
/// ```
///
/// ...and it converts into no permit:
///
/// ```compile_fail
/// use projectos_host_core::{AdmittedRequest, ExecutionPermit};
/// fn _f(a: AdmittedRequest) -> ExecutionPermit { a.into() }
/// ```
///
/// ```
/// use projectos_host_core::{AdmittedRequest, ExecutionPermit};
/// fn _f(_a: &AdmittedRequest, _p: &ExecutionPermit) {}
/// ```
pub struct AdmittedRequest {
    connection_id: u64,
    handshake_generation: u64,
    session_digest: [u8; 32],
    correlation: [u8; REQUEST_CORRELATION_LEN],
    sequence: u64,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for AdmittedRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "AdmittedRequest([REDACTED])")
    }
}

impl AdmittedRequest {
    /// The host-issued connection this admission belongs to.
    #[must_use]
    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }
    /// The host-issued handshake generation this admission belongs to.
    #[must_use]
    pub fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }
    /// The session this admission belongs to.
    #[must_use]
    pub fn session_digest(&self) -> [u8; 32] {
        self.session_digest
    }
    /// The correlation this admission answers.
    #[must_use]
    pub fn correlation(&self) -> &[u8; REQUEST_CORRELATION_LEN] {
        &self.correlation
    }
    /// The sequence this admission recorded.
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    /// Whether this admission answers exactly this correlation on exactly this connection.
    #[must_use]
    pub fn answers(
        &self,
        correlation: &[u8; REQUEST_CORRELATION_LEN],
        connection_id: u64,
        handshake_generation: u64,
    ) -> bool {
        &self.correlation == correlation
            && self.connection_id == connection_id
            && self.handshake_generation == handshake_generation
    }
}

impl BoundIpcSession {
    /// Admit ONE request on this session, or refuse.
    ///
    /// THE SOLE MINT of [`AdmittedRequest`]. It is a method on the session rather than a free
    /// function because the facts it stamps - connection, handshake generation, session digest - are
    /// the session's own private fields, so there is no argument through which a caller could supply
    /// them and no version of this that takes them on trust.
    ///
    /// Order is fail-closed. The store must belong to this session; the sequence must ADVANCE, so a
    /// rewind and a repeat receive the same refusal; the correlation must be new. Only then is
    /// anything recorded, so a refused request leaves no trace to interfere with a later legitimate
    /// one.
    ///
    /// WHAT IT DOES NOT CHECK. Admission consults no clock, no verifier and no runtime instance: it
    /// says nothing about whether this session is still current, still connected, or still within its
    /// window, and nothing about capability or family. Those are [`Self::is_current`],
    /// [`Self::permits_capability`], [`Self::permits_family`], [`Self::matches_peer`] and
    /// [`Self::matches_channel`], and the operation gate must ask them at the moment it acts. An
    /// admission on a session that has since expired is still a correct statement - the request was
    /// not a duplicate - and still authorises nothing.
    ///
    /// # Errors
    /// [`RequestAdmissionError`] naming the first gate that refused.
    pub fn admit_request<S: RequestAdmissionStore + ?Sized>(
        &self,
        store: &mut S,
        correlation: [u8; REQUEST_CORRELATION_LEN],
        sequence: u64,
    ) -> Result<AdmittedRequest, RequestAdmissionError> {
        if store.session_digest() != self.session_digest {
            return Err(RequestAdmissionError::StoreNotBoundToSession);
        }
        if sequence <= store.last_sequence() {
            return Err(RequestAdmissionError::SequenceNotAdvancing);
        }
        if store.is_correlation_seen(&correlation) {
            return Err(RequestAdmissionError::CorrelationReplayed);
        }
        store.record(sequence, correlation)?;
        Ok(AdmittedRequest {
            connection_id: self.connection_id,
            handshake_generation: self.handshake_generation,
            session_digest: self.session_digest,
            correlation,
            sequence,
            _thread_bound: ThreadBound::default(),
        })
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

// ---------------------------------------------------------------------------------------------
// Production IPC-session verifier (CD-B4-PRODUCTION-IPC-PROVIDER1A)
// ---------------------------------------------------------------------------------------------

/// The maximum validity window and observation-staleness bound the PRODUCTION verifier accepts.
const PRODUCTION_IPC_MAX_WINDOW: u64 = 30_000;
const PRODUCTION_IPC_MAX_STALENESS: u64 = 10_000;

/// The sole PRODUCTION IPC-session verifier. It implements the sealed [`IpcSessionVerifier`], so an
/// untrusted [`IpcPeerObservation`] + single-use [`ConfirmedHandshakeEvidence`] becomes a
/// [`BoundIpcSession`] only through it (or the test fixture). Its connection identity and handshake
/// generation are crate-assigned from a process-unique counter — never caller-selectable — and are
/// non-zero; the accepted channel bounds are fixed at construction.
///
/// Opaque: private fields, redacted `Debug`, no serde, no evidence-to-authority conversion, thread-bound
/// (`!Send + !Sync`), not `Clone`/`Copy`. Construction is crate-controlled: there is NO default-graph
/// constructor, so an external crate cannot build one (the compile-failure suite proves it). The only
/// reachable constructor is the test-fixtures [`ProductionIpcSessionVerifier::for_local_proof`], used by
/// the Level-2 proof; a real connection-bound production constructor (owner-gated) is CARRY-FORWARD.
/// Safety does not rest on construction alone: even with a verifier, minting needs a real
/// [`VerifiedRuntimeInstance`] and a real [`VerifiedAuthorityTime`], both of which are unforgeable.
pub struct ProductionIpcSessionVerifier {
    connection_id: u64,
    handshake_generation: u64,
    liveness: core::cell::Cell<ConnectionLiveness>,
    capabilities: Vec<ChannelCapability>,
    families: Vec<OperationFamily>,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for ProductionIpcSessionVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProductionIpcSessionVerifier([REDACTED])")
    }
}

impl ProductionIpcSessionVerifier {
    /// The crate-internal mint. Connection identity and handshake generation are drawn from a
    /// process-unique counter (high bit set, disjoint from the fixture verifier's space) so a caller can
    /// neither choose nor forge a matching one; both are non-zero. The channel bounds default to the
    /// observe-only + record-marker capabilities and the record-marker family.
    pub(crate) fn new_internal() -> Self {
        use core::sync::atomic::{AtomicU64, Ordering};
        static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);
        let base = NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed) | (1u64 << 63);
        Self {
            connection_id: base,
            handshake_generation: base,
            liveness: core::cell::Cell::new(ConnectionLiveness::Live),
            capabilities: vec![
                ChannelCapability::ObserveOnly,
                ChannelCapability::RecordMarker,
            ],
            families: vec![OperationFamily::RecordMarker],
            _thread_bound: PhantomData,
        }
    }

    /// TEST-ONLY constructor for the Level-2 proof, gated to `test-fixtures`.
    ///
    /// The production route is [`crate::provider_authority`]: `new_internal` above is reached ONLY by
    /// consuming a `ProviderAuthorityLease`, which requires a confirmed machine-wide host authority. The
    /// default graph still has no way to construct this verifier directly. Binding the verifier to a real
    /// connection remains CARRY-FORWARD.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn for_local_proof() -> Self {
        Self::new_internal()
    }

    /// TEST-ONLY: model a peer disconnect on this verifier's connection (so minting/currentness refuse).
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn disconnect(&self) {
        self.liveness.set(ConnectionLiveness::Disconnected);
    }

    /// TEST-ONLY: model a session revocation on this verifier's connection.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn revoke(&self) {
        self.liveness.set(ConnectionLiveness::Revoked);
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1B — the PER-CONNECTION production verifier.
//
// A `ProductionIpcSessionVerifier` fixes ONE connection identity at construction, and the only route
// to one is a `ProviderAuthorityLease`, which converts exactly once. Taken together, that bound the
// whole Host lifetime to a single client connection: a second connection would have needed a second
// lease, and therefore a second machine-wide authority acquisition, which the gatekeeper rejected.
//
// This type separates the two lifetimes. The machine-wide authority and the provider capability set
// stay long-lived; a FRESH connection-bound verifier is derived for each accepted IPC connection, with
// its own non-zero crate-assigned connection identity and handshake generation.
//
// IT BORROWS THE CAPABILITY SET. The lifetime parameter is the whole ownership model: a per-connection
// verifier cannot outlive the provider capabilities that authorised it, cannot be extracted from them,
// and dropping it releases nothing — the machine-wide authority is released only when the capability
// set itself drops. The borrow is what makes that structural rather than a runtime convention.
// ---------------------------------------------------------------------------------------------

/// A production IPC-session verifier bound to ONE accepted connection, borrowing the provider
/// authority that issued it.
///
/// Opaque, non-`Clone`, non-`Copy`, non-`Default`, non-serialisable, thread-bound, redacted `Debug`.
/// Its connection identity and handshake generation are crate-assigned and non-zero; no caller — and
/// in particular no Agent, request field or peer — can choose or influence them.
pub struct ConnectionBoundIpcSessionVerifier<'a> {
    inner: ProductionIpcSessionVerifier,
    /// The borrow of the issuing provider capability set. Carries no data; it carries the LIFETIME.
    _authority: PhantomData<&'a ()>,
}

impl fmt::Debug for ConnectionBoundIpcSessionVerifier<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ConnectionBoundIpcSessionVerifier([REDACTED])")
    }
}

impl<'a> ConnectionBoundIpcSessionVerifier<'a> {
    /// CRATE-PRIVATE derivation, reached only from
    /// [`crate::provider_authority::ProviderCapabilitySet::begin_connection`]. Each call yields a
    /// FRESH identity, so two accepted connections can never share one.
    pub(crate) fn derive() -> Self {
        Self {
            inner: ProductionIpcSessionVerifier::new_internal(),
            _authority: PhantomData,
        }
    }
}

impl sealed::Sealed for ConnectionBoundIpcSessionVerifier<'_> {}
impl IpcSessionVerifier for ConnectionBoundIpcSessionVerifier<'_> {
    fn connection_id(&self) -> u64 {
        self.inner.connection_id()
    }
    fn handshake_generation(&self) -> u64 {
        self.inner.handshake_generation()
    }
    fn liveness(&self) -> ConnectionLiveness {
        self.inner.liveness()
    }
    fn max_window(&self) -> u64 {
        self.inner.max_window()
    }
    fn max_staleness(&self) -> u64 {
        self.inner.max_staleness()
    }
    fn permitted_capabilities(&self) -> &[ChannelCapability] {
        self.inner.permitted_capabilities()
    }
    fn permitted_families(&self) -> &[OperationFamily] {
        self.inner.permitted_families()
    }
}

impl sealed::Sealed for ProductionIpcSessionVerifier {}
impl IpcSessionVerifier for ProductionIpcSessionVerifier {
    fn connection_id(&self) -> u64 {
        self.connection_id
    }
    fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }
    fn liveness(&self) -> ConnectionLiveness {
        self.liveness.get()
    }
    fn max_window(&self) -> u64 {
        PRODUCTION_IPC_MAX_WINDOW
    }
    fn max_staleness(&self) -> u64 {
        PRODUCTION_IPC_MAX_STALENESS
    }
    fn permitted_capabilities(&self) -> &[ChannelCapability] {
        &self.capabilities
    }
    fn permitted_families(&self) -> &[OperationFamily] {
        &self.families
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
