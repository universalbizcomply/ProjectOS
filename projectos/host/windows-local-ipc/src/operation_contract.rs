//! The PROTECTED-OPERATION contract — PROJECTOSHOST-IPC-OPERATION-CONTRACT1A (F2/F3 phase 1).
//!
//! Types and validation only. This module adds NO transport, opens NO channel, dispatches NO effect and
//! touches NO credential. It exists so that later phases have a boundary to authenticate against.
//!
//! ## The three-layer separation this module exists to enforce
//!
//! 1. [`ProtectedOperationRequest`] — the UNTRUSTED wire DTO. Everything in it is a *claim* made by a
//!    caller. Parsing it proves only that bytes were well formed.
//! 2. [`TrustedPeerContext`] — created ONLY from kernel-attested peer identity. **Phase 1 provides no
//!    constructor at all**, so no code can currently produce one. Phase 2 mints it.
//! 3. [`AuthorisedProtectedOperation`] — created ONLY from a trusted peer context, an independently
//!    verified owner approval and a closed C4 gate. Unreachable today, by construction.
//!
//! ## Why there is no wire encryption
//!
//! There is nothing to encrypt. Every field below is a bounded identifier, a closed enum byte, a
//! counter or a digest. **No `String`, no `Vec<u8>`, no map, no free-form text and no generic payload
//! accessor exists anywhere in this module**, so a credential, token, cookie, key, command line or
//! filesystem path is not *representable* on this wire — not merely rejected, but unable to be spelled.
//! The protected value itself never leaves the host under Model C.
//!
//! ## C4
//!
//! [`OwnerPresenceGate`] has exactly one variant and `is_closed()` returns `false` unconditionally.
//! While that holds, [`evaluate_protected_operation`] can only ever answer
//! [`RejectionReason::OwnerPresenceGateOpen`]. There is deliberately no constructor, feature flag or
//! test hook in this crate that produces a closed gate.

use projectos_host_core::PeerUserClass;

use crate::protocol::{
    parse_single_frame, write_frame_header, FrameParseError, MessageKind, Nonce, HEADER_LEN,
    PROTECTED_OPERATION_REQUEST_LEN, PROTECTED_OPERATION_RESPONSE_LEN,
};

/// Bounded correlation identity. Fixed width: a correlation is an opaque tag, never a message.
pub const CORRELATION_LEN: usize = 16;
/// Bounded reference to an owner-approval record. A REFERENCE, never approval material itself.
pub const APPROVAL_REF_LEN: usize = 32;
/// Bounded reference to a client session. Evidence only — never authority (see the binding matrix).
pub const SESSION_REF_LEN: usize = 16;
/// A SHA-256-shaped binding digest. This module never computes one; it carries and compares it.
pub const BINDING_DIGEST_LEN: usize = 32;
/// Bounded reference to host-side evidence produced by a completed operation.
pub const EVIDENCE_REF_LEN: usize = 16;

/// Private seal. A type carrying this cannot be constructed outside this module, so no downstream
/// crate can fabricate a trusted value by writing a struct literal.
mod sealed {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Seal;
}
use sealed::Seal;

/// The CLOSED set of protected operation classes. There is no `Other`, no numeric escape hatch and no
/// caller-supplied command: an operation the host does not already know is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OperationClass {
    /// Read-only provider identity verification (the C6 shape). Executes nothing.
    ProviderIdentityRead,
    /// A staging-scoped, non-mutating provider read.
    StagingRead,
}

impl OperationClass {
    /// The fixed wire discriminant.
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::ProviderIdentityRead => 1,
            Self::StagingRead => 2,
        }
    }

    /// Decode a wire discriminant. Unknown fails closed.
    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::ProviderIdentityRead,
            2 => Self::StagingRead,
            _ => return None,
        })
    }
}

/// The CLOSED response state. `Accepted` means "admitted for host-side execution" and NEVER "executed";
/// only `Completed` reports an executed effect, and only the host can construct it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ResponseState {
    /// The request was refused. Nothing ran.
    Rejected,
    /// The request was admitted. **No effect has occurred.**
    Accepted,
    /// A host-executed operation finished. Constructible only from an authorised operation.
    Completed,
}

impl ResponseState {
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::Rejected => 1,
            Self::Accepted => 2,
            Self::Completed => 3,
        }
    }

    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::Rejected,
            2 => Self::Accepted,
            3 => Self::Completed,
            _ => return None,
        })
    }
}

/// CLOSED, fieldless refusal reasons. Deliberately coarse: a refusal taxonomy is an oracle, so it names
/// the gate that refused and never the value that failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RejectionReason {
    /// C4 owner presence is not closed. The only reachable outcome in this phase.
    OwnerPresenceGateOpen,
    /// No kernel-attested peer context accompanied the request.
    PeerNotAuthenticated,
    /// A project/environment/repository/phase/provider/operation binding did not match.
    BindingMismatch,
    /// The correlation did not match an outstanding request.
    CorrelationMismatch,
    /// The service-instance epoch did not match this instance.
    ServiceEpochMismatch,
    /// The sequence was stale, duplicated or reordered.
    SequenceRefused,
    /// The frame did not parse under this contract.
    MalformedRequest,
    /// Policy refused the operation class outright.
    PolicyRefused,
}

impl RejectionReason {
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::OwnerPresenceGateOpen => 1,
            Self::PeerNotAuthenticated => 2,
            Self::BindingMismatch => 3,
            Self::CorrelationMismatch => 4,
            Self::ServiceEpochMismatch => 5,
            Self::SequenceRefused => 6,
            Self::MalformedRequest => 7,
            Self::PolicyRefused => 8,
        }
    }

    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::OwnerPresenceGateOpen,
            2 => Self::PeerNotAuthenticated,
            3 => Self::BindingMismatch,
            4 => Self::CorrelationMismatch,
            5 => Self::ServiceEpochMismatch,
            6 => Self::SequenceRefused,
            7 => Self::MalformedRequest,
            8 => Self::PolicyRefused,
            _ => return None,
        })
    }
}

/// CLOSED, redacted result classification. Never an exit code, never output, never a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ResultClass {
    /// Nothing ran.
    NotRun,
    /// The host ran the operation and it succeeded.
    Succeeded,
    /// The host ran the operation and it failed.
    Failed,
}

impl ResultClass {
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::NotRun => 1,
            Self::Succeeded => 2,
            Self::Failed => 3,
        }
    }

    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::NotRun,
            2 => Self::Succeeded,
            3 => Self::Failed,
            _ => return None,
        })
    }
}

/// Whether the caller may try again. Closed enum: a refusal must not imply a retry loop by omission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TerminalStatus {
    /// Terminal for this correlation. Do not retry.
    Terminal,
    /// The caller may submit a NEW correlation. Never a licence to replay this one.
    RetryWithNewCorrelation,
}

impl TerminalStatus {
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::Terminal => 1,
            Self::RetryWithNewCorrelation => 2,
        }
    }

    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::Terminal,
            2 => Self::RetryWithNewCorrelation,
            _ => return None,
        })
    }
}

// -------------------------------------------------------------------------------------------------
// LAYER 1 — THE UNTRUSTED WIRE DTO
// -------------------------------------------------------------------------------------------------

/// An UNTRUSTED protected-operation request, exactly as a caller sent it.
///
/// Every accessor returns a **claim**. Holding this type proves the bytes parsed and nothing else. It
/// is deliberately impossible to turn one of these into authority without [`evaluate_protected_operation`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedOperationRequest {
    correlation: [u8; CORRELATION_LEN],
    sequence: u64,
    claimed_service_epoch: u64,
    binding_digest: [u8; BINDING_DIGEST_LEN],
    operation: OperationClass,
    approval_ref: [u8; APPROVAL_REF_LEN],
    client_session_ref: [u8; SESSION_REF_LEN],
    parameter_digest: [u8; BINDING_DIGEST_LEN],
}

impl ProtectedOperationRequest {
    /// Build a request DTO. Public on purpose — this is the UNTRUSTED layer, and a caller being able to
    /// build one confers nothing. It is the trusted types below that are sealed.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        correlation: [u8; CORRELATION_LEN],
        sequence: u64,
        claimed_service_epoch: u64,
        binding_digest: [u8; BINDING_DIGEST_LEN],
        operation: OperationClass,
        approval_ref: [u8; APPROVAL_REF_LEN],
        client_session_ref: [u8; SESSION_REF_LEN],
        parameter_digest: [u8; BINDING_DIGEST_LEN],
    ) -> Self {
        Self {
            correlation,
            sequence,
            claimed_service_epoch,
            binding_digest,
            operation,
            approval_ref,
            client_session_ref,
            parameter_digest,
        }
    }

    /// The caller's correlation tag (claim).
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }

    /// The caller's sequence (claim). Enforcement is phase 4.
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// The service epoch the caller CLAIMS to be addressing. Never trusted; compared host-side.
    #[must_use]
    pub fn claimed_service_epoch(&self) -> u64 {
        self.claimed_service_epoch
    }

    /// The claimed project/environment/repository/phase/provider/operation binding digest.
    #[must_use]
    pub fn binding_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.binding_digest
    }

    /// The requested operation class.
    #[must_use]
    pub fn operation(&self) -> OperationClass {
        self.operation
    }

    /// A REFERENCE to an owner-approval record. Not approval, and never usable as one.
    #[must_use]
    pub fn approval_ref(&self) -> &[u8; APPROVAL_REF_LEN] {
        &self.approval_ref
    }

    /// A client-session REFERENCE. Evidence only.
    #[must_use]
    pub fn client_session_ref(&self) -> &[u8; SESSION_REF_LEN] {
        &self.client_session_ref
    }

    /// Digest of the bounded non-secret parameters. The parameters themselves are resolved host-side.
    #[must_use]
    pub fn parameter_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.parameter_digest
    }
}

// -------------------------------------------------------------------------------------------------
// LAYER 2 — TRUSTED PEER CONTEXT (no constructor in this phase)
// -------------------------------------------------------------------------------------------------

/// Maximum bytes of a Windows SID (`SECURITY_MAX_SID_SIZE`). A SID is carried as bounded BYTES, never
/// as text, so this module's "no free-form field" property survives peer authentication.
pub const SID_MAX_LEN: usize = 68;

/// A bounded, zero-padded copy of a token user SID.
///
/// Deliberately offers NO byte-slice accessor: comparison is by value, so nothing here can become a
/// generic payload route. Zero padding makes equality well defined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenUserSid {
    bytes: [u8; SID_MAX_LEN],
    len: u8,
}

impl TokenUserSid {
    /// Shortest structurally meaningful SID: revision + subauthority count + 6-byte authority. Gated
    /// alongside the only constructor that consults it, which is itself absent from a production build.
    #[cfg(any(test, feature = "test-fixtures"))]
    const MIN_LEN: usize = 8;

    /// Copy a SID out of kernel-provided bytes. Fails closed on an impossible length.
    ///
    /// NOT AVAILABLE IN A PRODUCTION BUILD. This is the only route from arbitrary bytes to an identity
    /// value, so while live capture is deferred it is gated to tests and the non-default fixture graph.
    /// The later canonical-capture phase supplies real kernel bytes through its own sealed route.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn from_kernel_bytes(raw: &[u8]) -> Option<Self> {
        if raw.len() < Self::MIN_LEN || raw.len() > SID_MAX_LEN {
            return None;
        }
        let mut bytes = [0u8; SID_MAX_LEN];
        bytes[..raw.len()].copy_from_slice(raw);
        Some(Self {
            bytes,
            len: raw.len() as u8,
        })
    }

    /// The SID's byte length.
    #[must_use]
    pub fn len(&self) -> usize {
        self.len as usize
    }

    /// A SID is never empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        false
    }

    /// The identifier authority (bytes 2..8).
    fn authority(&self) -> u64 {
        let b = &self.bytes;
        (u64::from(b[2]) << 40)
            | (u64::from(b[3]) << 32)
            | (u64::from(b[4]) << 24)
            | (u64::from(b[5]) << 16)
            | (u64::from(b[6]) << 8)
            | u64::from(b[7])
    }

    /// The first sub-authority, if present.
    fn first_sub_authority(&self) -> Option<u32> {
        if self.bytes[1] == 0 || self.len() < 12 {
            return None;
        }
        Some(u32::from_le_bytes([
            self.bytes[8],
            self.bytes[9],
            self.bytes[10],
            self.bytes[11],
        ]))
    }

    /// Classify the principal from the SID ALONE.
    ///
    /// Deliberately ignores group membership. A filtered administrator token still carries the user's
    /// own SID, so an ordinary user cannot become `System` or `Service` by group, and a deny-only
    /// Administrators entry cannot promote anyone.
    fn classify(&self) -> Option<PeerUserClass> {
        // NT Authority is 5; sub-authority 18 is LocalSystem, 80 a service account, 21 a local or
        // domain account (the interactive owner).
        if self.authority() != 5 {
            return Some(PeerUserClass::Other);
        }
        Some(match self.first_sub_authority()? {
            18 => PeerUserClass::System,
            80 => PeerUserClass::Service,
            21 => PeerUserClass::Owner,
            _ => PeerUserClass::Other,
        })
    }
}

/// The CLOSED Windows integrity levels this contract recognises. An unknown RID fails closed rather
/// than being coerced to a neighbouring level.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IntegrityLevel {
    /// `SECURITY_MANDATORY_UNTRUSTED_RID`
    Untrusted,
    /// `SECURITY_MANDATORY_LOW_RID`
    Low,
    /// `SECURITY_MANDATORY_MEDIUM_RID` - an ordinary, non-elevated process.
    Medium,
    /// `SECURITY_MANDATORY_HIGH_RID` - an elevated process.
    High,
    /// `SECURITY_MANDATORY_SYSTEM_RID`
    System,
}

impl IntegrityLevel {
    /// Map a mandatory-label RID. Unknown fails closed.
    #[must_use]
    pub fn from_rid(rid: u32) -> Option<Self> {
        Some(match rid {
            0x0000 => Self::Untrusted,
            0x1000 => Self::Low,
            0x2000 => Self::Medium,
            0x3000 => Self::High,
            0x4000 => Self::System,
            _ => return None,
        })
    }
}

/// Kernel-attested evidence about one connected peer, as an INPUT to authentication.
///
/// PRODUCTION-INERT BY CONSTRUCTION. Every field is private, the type carries the module seal, and its
/// only constructor is gated to tests and the non-default fixture graph — so no production code path
/// can fabricate evidence and feed it to [`authenticate_peer`]. Live capture is deliberately NOT
/// implemented here: the accepted `val-windows-local-ipc-capability-b3` invariant assigns raw process
/// and token identity to the canonical identity-proof crate, and a separately gated phase will supply
/// this evidence from there.
///
/// Holding one would grant nothing in any case: only [`authenticate_peer`] turns coherent evidence into
/// a [`TrustedPeerContext`], and that context is still not authority while C4 is open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObservedPeerEvidence {
    _seal: Seal,
    /// The connected client's process identifier, as attested by the kernel.
    client_pid: u32,
    /// Creation identity of that process, read at observation time.
    client_creation_tick: u64,
    /// The same process re-read AFTER the identity work, or `None` if it has gone.
    live_pid: Option<u32>,
    /// Creation identity re-read alongside `live_pid`.
    live_creation_tick: Option<u64>,
    /// The client token's user SID.
    token_user_sid: TokenUserSid,
    /// The client token's Windows session.
    session_id: u32,
    /// The client token's integrity level.
    integrity: IntegrityLevel,
    /// Host-assigned connection identity.
    connection_id: u64,
    /// Host-assigned handshake generation.
    handshake_generation: u64,
}

impl ObservedPeerEvidence {
    /// Assemble evidence for authentication.
    ///
    /// NOT AVAILABLE IN A PRODUCTION BUILD — gated to tests and the non-default fixture graph, which is
    /// what makes the whole evidence path inert until the canonical capture phase lands.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn observed(
        client_pid: u32,
        client_creation_tick: u64,
        live_pid: Option<u32>,
        live_creation_tick: Option<u64>,
        token_user_sid: TokenUserSid,
        session_id: u32,
        integrity: IntegrityLevel,
        connection_id: u64,
        handshake_generation: u64,
    ) -> Self {
        Self {
            _seal: Seal,
            client_pid,
            client_creation_tick,
            live_pid,
            live_creation_tick,
            token_user_sid,
            session_id,
            integrity,
            connection_id,
            handshake_generation,
        }
    }
}

/// CLOSED reasons peer authentication refused. Fieldless: it names the check, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PeerAuthenticationError {
    /// The client process could not be identified.
    ClientProcessUnavailable,
    /// The process no longer exists.
    ClientProcessExited,
    /// The PID matches but the creation identity does not - the PID was reused.
    ProcessCreationMismatch,
    /// The connection identity did not match the one this host issued.
    ConnectionMismatch,
    /// The handshake generation did not match.
    HandshakeGenerationMismatch,
    /// The token SID could not be classified into a bounded peer class.
    UnknownPeerClass,
    /// The token user SID differs from the one this connection was bound to.
    UserSidMismatch,
    /// The Windows session differs from the one this connection was bound to.
    SessionMismatch,
    /// The integrity level differs from the one this connection was bound to.
    IntegrityMismatch,
}

/// Kernel-attested peer identity.
///
/// Constructed ONLY by [`authenticate_peer`], the sole caller of the private `mint` below. There is no
/// public constructor, no `pub(crate)` constructor, no `From` conversion from the wire DTO and no
/// deserialisation into this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedPeerContext {
    _seal: Seal,
    client_pid: u32,
    client_creation_tick: u64,
    token_user_sid: TokenUserSid,
    session_id: u32,
    integrity: IntegrityLevel,
    peer_class: PeerUserClass,
    connection_id: u64,
    handshake_generation: u64,
}

impl TrustedPeerContext {
    /// PRIVATE. Not `pub`, not `pub(crate)`: only `authenticate_peer` in this module reaches it.
    #[allow(clippy::too_many_arguments)]
    fn mint(
        client_pid: u32,
        client_creation_tick: u64,
        token_user_sid: TokenUserSid,
        session_id: u32,
        integrity: IntegrityLevel,
        peer_class: PeerUserClass,
        connection_id: u64,
        handshake_generation: u64,
    ) -> Self {
        Self {
            _seal: Seal,
            client_pid,
            client_creation_tick,
            token_user_sid,
            session_id,
            integrity,
            peer_class,
            connection_id,
            handshake_generation,
        }
    }

    /// Kernel-attested client PID.
    #[must_use]
    pub fn client_pid(&self) -> u32 {
        self.client_pid
    }

    /// Kernel-attested process creation tick, which defeats PID reuse.
    #[must_use]
    pub fn client_creation_tick(&self) -> u64 {
        self.client_creation_tick
    }

    /// Kernel-attested token user SID.
    #[must_use]
    pub fn token_user_sid(&self) -> &TokenUserSid {
        &self.token_user_sid
    }

    /// Kernel-attested Windows session.
    #[must_use]
    pub fn client_session(&self) -> u32 {
        self.session_id
    }

    /// Kernel-attested integrity level.
    #[must_use]
    pub fn integrity(&self) -> IntegrityLevel {
        self.integrity
    }

    /// Bounded peer classification, derived from the token SID alone.
    #[must_use]
    pub fn peer_class(&self) -> PeerUserClass {
        self.peer_class
    }

    /// The host-issued connection identity this context is bound to.
    #[must_use]
    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }

    /// The host-issued handshake generation this context is bound to.
    #[must_use]
    pub fn handshake_generation(&self) -> u64 {
        self.handshake_generation
    }
}

/// Turn raw kernel evidence into a trusted peer context, or refuse.
///
/// `expected_connection_id` and `expected_handshake_generation` come from the HOST, never the caller,
/// so a peer cannot nominate the connection it belongs to. Every check fails closed, and the
/// process-creation comparison is what stops a later process that reuses an earlier PID from
/// inheriting the earlier peer's context.
///
/// # Errors
/// [`PeerAuthenticationError`] naming the first check that refused.
pub fn authenticate_peer(
    evidence: &ObservedPeerEvidence,
    expected_connection_id: u64,
    expected_handshake_generation: u64,
) -> Result<TrustedPeerContext, PeerAuthenticationError> {
    if evidence.client_pid == 0 {
        return Err(PeerAuthenticationError::ClientProcessUnavailable);
    }
    // The process must still exist once the token work finishes.
    let (live_pid, live_tick) = match (evidence.live_pid, evidence.live_creation_tick) {
        (Some(p), Some(t)) => (p, t),
        _ => return Err(PeerAuthenticationError::ClientProcessExited),
    };
    // PID alone is reusable; the creation identity is what makes the pair stable.
    if live_pid != evidence.client_pid || live_tick != evidence.client_creation_tick {
        return Err(PeerAuthenticationError::ProcessCreationMismatch);
    }
    if evidence.connection_id != expected_connection_id {
        return Err(PeerAuthenticationError::ConnectionMismatch);
    }
    if evidence.handshake_generation != expected_handshake_generation {
        return Err(PeerAuthenticationError::HandshakeGenerationMismatch);
    }
    // Classification comes from the SID, never from anything the caller sent.
    let peer_class = evidence
        .token_user_sid
        .classify()
        .ok_or(PeerAuthenticationError::UnknownPeerClass)?;
    Ok(TrustedPeerContext::mint(
        evidence.client_pid,
        evidence.client_creation_tick,
        evidence.token_user_sid,
        evidence.session_id,
        evidence.integrity,
        peer_class,
        evidence.connection_id,
        evidence.handshake_generation,
    ))
}

/// Re-authenticate a peer against the identity this connection was ALREADY bound to.
///
/// [`authenticate_peer`] admits the FIRST observation and thereby fixes the connection's identity.
/// Every later observation on the same connection goes through here, and every attested field must be
/// identical. That is what makes "wrong SID refused" and "wrong session refused" structural rather than
/// advisory: the expectation is the host's own earlier kernel reading, never anything the peer sent.
///
/// # Errors
/// [`PeerAuthenticationError`] naming the first field that diverged.
pub fn reauthenticate_peer(
    bound: &TrustedPeerContext,
    evidence: &ObservedPeerEvidence,
) -> Result<TrustedPeerContext, PeerAuthenticationError> {
    // Re-run the full first-observation checks against the SAME connection and generation, so a stale
    // or replayed capture cannot skip them by arriving second.
    let fresh = authenticate_peer(
        evidence,
        bound.connection_id(),
        bound.handshake_generation(),
    )?;
    if fresh.token_user_sid() != bound.token_user_sid() {
        return Err(PeerAuthenticationError::UserSidMismatch);
    }
    if fresh.client_session() != bound.client_session() {
        return Err(PeerAuthenticationError::SessionMismatch);
    }
    if fresh.integrity() != bound.integrity() {
        return Err(PeerAuthenticationError::IntegrityMismatch);
    }
    // PID and creation tick are already compared by `authenticate_peer` against the live re-read; here
    // they must additionally equal the process this connection was bound to in the first place.
    if fresh.client_pid() != bound.client_pid()
        || fresh.client_creation_tick() != bound.client_creation_tick()
    {
        return Err(PeerAuthenticationError::ProcessCreationMismatch);
    }
    Ok(fresh)
}

// -------------------------------------------------------------------------------------------------
// C4 GATE
// -------------------------------------------------------------------------------------------------

/// The C4 owner-presence gate.
///
/// One variant. `is_closed()` returns `false` unconditionally. There is no constructor anywhere in this
/// crate that yields a closed gate, so the hard stop cannot be defeated by a feature flag or a fixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OwnerPresenceGate {
    /// C4 is open. Protected operations are refused.
    Open,
}

impl OwnerPresenceGate {
    /// The live gate state.
    #[must_use]
    pub fn current() -> Self {
        Self::Open
    }

    /// Always `false` in this phase, by construction.
    #[must_use]
    pub fn is_closed(self) -> bool {
        false
    }
}

// -------------------------------------------------------------------------------------------------
// LAYER 3 — TRUSTED OPERATION AUTHORITY (unreachable in this phase)
// -------------------------------------------------------------------------------------------------

/// An authorised protected operation.
///
/// Minted only by [`evaluate_protected_operation`] and only when C4 is closed AND a trusted peer context
/// exists. Both are impossible in this phase, so this type is currently unconstructible — which is the
/// point: the contract exists, the path to an effect does not.
#[derive(Debug)]
pub struct AuthorisedProtectedOperation {
    _seal: Seal,
    correlation: [u8; CORRELATION_LEN],
    operation: OperationClass,
    service_epoch: u64,
}

impl AuthorisedProtectedOperation {
    /// The correlation this authority is bound to.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }

    /// The single operation class this authority permits.
    #[must_use]
    pub fn operation(&self) -> OperationClass {
        self.operation
    }

    /// The service instance this authority belongs to.
    #[must_use]
    pub fn service_epoch(&self) -> u64 {
        self.service_epoch
    }
}

// -------------------------------------------------------------------------------------------------
// RESPONSE
// -------------------------------------------------------------------------------------------------

/// A protected-operation response.
///
/// `Completed` cannot be built from caller data: [`ProtectedOperationResponse::completed`] consumes an
/// [`AuthorisedProtectedOperation`], which only the host can hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedOperationResponse {
    correlation: [u8; CORRELATION_LEN],
    state: ResponseState,
    reason: RejectionReason,
    result: ResultClass,
    service_epoch: u64,
    evidence_ref: [u8; EVIDENCE_REF_LEN],
    terminal: TerminalStatus,
}

impl ProtectedOperationResponse {
    /// Build a refusal. Always available — refusing is never privileged.
    #[must_use]
    pub fn rejected(
        correlation: [u8; CORRELATION_LEN],
        reason: RejectionReason,
        service_epoch: u64,
        terminal: TerminalStatus,
    ) -> Self {
        Self {
            correlation,
            state: ResponseState::Rejected,
            reason,
            result: ResultClass::NotRun,
            service_epoch,
            evidence_ref: [0u8; EVIDENCE_REF_LEN],
            terminal,
        }
    }

    /// Build an ADMISSION. Consumes the authority so an admission cannot be minted from caller data,
    /// and reports `NotRun`: admission is not execution.
    #[must_use]
    pub fn accepted(authority: &AuthorisedProtectedOperation) -> Self {
        Self {
            correlation: *authority.correlation(),
            state: ResponseState::Accepted,
            reason: RejectionReason::PolicyRefused,
            result: ResultClass::NotRun,
            service_epoch: authority.service_epoch(),
            evidence_ref: [0u8; EVIDENCE_REF_LEN],
            terminal: TerminalStatus::Terminal,
        }
    }

    /// Build a COMPLETION. Requires the host-held authority, so a caller can never assert that an
    /// operation ran.
    #[must_use]
    pub fn completed(
        authority: &AuthorisedProtectedOperation,
        result: ResultClass,
        evidence_ref: [u8; EVIDENCE_REF_LEN],
    ) -> Self {
        Self {
            correlation: *authority.correlation(),
            state: ResponseState::Completed,
            reason: RejectionReason::PolicyRefused,
            result,
            service_epoch: authority.service_epoch(),
            evidence_ref,
            terminal: TerminalStatus::Terminal,
        }
    }

    /// The correlation this response answers.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }
    /// The response state.
    #[must_use]
    pub fn state(&self) -> ResponseState {
        self.state
    }
    /// The refusal reason. Meaningful only when [`ResponseState::Rejected`].
    #[must_use]
    pub fn reason(&self) -> RejectionReason {
        self.reason
    }
    /// The redacted result classification.
    #[must_use]
    pub fn result(&self) -> ResultClass {
        self.result
    }
    /// The answering service instance.
    #[must_use]
    pub fn service_epoch(&self) -> u64 {
        self.service_epoch
    }
    /// The bounded evidence reference.
    #[must_use]
    pub fn evidence_ref(&self) -> &[u8; EVIDENCE_REF_LEN] {
        &self.evidence_ref
    }
    /// Whether the caller may retry under a NEW correlation.
    #[must_use]
    pub fn terminal(&self) -> TerminalStatus {
        self.terminal
    }

    /// Does this response answer `correlation` from `service_epoch`?
    ///
    /// Both must match. A response from another correlation or another service instance answers
    /// nothing, which is what stops a replayed or cross-instance answer from satisfying a caller.
    #[must_use]
    pub fn answers(&self, correlation: &[u8; CORRELATION_LEN], service_epoch: u64) -> bool {
        &self.correlation == correlation && self.service_epoch == service_epoch
    }
}

// -------------------------------------------------------------------------------------------------
// EVALUATION — the C4 hard stop
// -------------------------------------------------------------------------------------------------

/// Evaluate an untrusted request.
///
/// Order is fail-closed and deliberate: the C4 gate is checked FIRST, so no amount of peer or binding
/// work can produce an acceptance while owner presence is unproven. In this phase the gate is always
/// open and [`TrustedPeerContext`] is unconstructible, so the only reachable answer is a refusal.
#[must_use]
pub fn evaluate_protected_operation(
    request: &ProtectedOperationRequest,
    peer: Option<&TrustedPeerContext>,
    service_epoch: u64,
) -> ProtectedOperationResponse {
    // 1. C4 FIRST. Unconditional hard stop.
    if !OwnerPresenceGate::current().is_closed() {
        return ProtectedOperationResponse::rejected(
            *request.correlation(),
            RejectionReason::OwnerPresenceGateOpen,
            service_epoch,
            TerminalStatus::Terminal,
        );
    }
    // 2. Kernel-attested peer identity is mandatory (phase 2 supplies it).
    if peer.is_none() {
        return ProtectedOperationResponse::rejected(
            *request.correlation(),
            RejectionReason::PeerNotAuthenticated,
            service_epoch,
            TerminalStatus::Terminal,
        );
    }
    // 3. The claimed epoch must be this instance's.
    if request.claimed_service_epoch() != service_epoch {
        return ProtectedOperationResponse::rejected(
            *request.correlation(),
            RejectionReason::ServiceEpochMismatch,
            service_epoch,
            TerminalStatus::Terminal,
        );
    }
    // Bindings, correlation currency, sequence and F5 single-use consumption are phases 4 and 5.
    ProtectedOperationResponse::rejected(
        *request.correlation(),
        RejectionReason::PolicyRefused,
        service_epoch,
        TerminalStatus::Terminal,
    )
}

// -------------------------------------------------------------------------------------------------
// CODEC
// -------------------------------------------------------------------------------------------------

/// Encode a request frame. Canonical: identical inputs always yield identical bytes.
#[must_use]
pub fn encode_protected_operation_request(
    nonce: &Nonce,
    request: &ProtectedOperationRequest,
) -> [u8; HEADER_LEN + PROTECTED_OPERATION_REQUEST_LEN] {
    let mut out = [0u8; HEADER_LEN + PROTECTED_OPERATION_REQUEST_LEN];
    write_frame_header(
        &mut out,
        MessageKind::ProtectedOperationRequest,
        nonce,
        PROTECTED_OPERATION_REQUEST_LEN as u16,
    );
    let p = HEADER_LEN;
    out[p..p + CORRELATION_LEN].copy_from_slice(&request.correlation);
    let mut o = p + CORRELATION_LEN;
    out[o..o + 8].copy_from_slice(&request.sequence.to_be_bytes());
    o += 8;
    out[o..o + 8].copy_from_slice(&request.claimed_service_epoch.to_be_bytes());
    o += 8;
    out[o..o + BINDING_DIGEST_LEN].copy_from_slice(&request.binding_digest);
    o += BINDING_DIGEST_LEN;
    out[o] = request.operation.discriminant();
    o += 1;
    out[o..o + APPROVAL_REF_LEN].copy_from_slice(&request.approval_ref);
    o += APPROVAL_REF_LEN;
    out[o..o + SESSION_REF_LEN].copy_from_slice(&request.client_session_ref);
    o += SESSION_REF_LEN;
    out[o..o + BINDING_DIGEST_LEN].copy_from_slice(&request.parameter_digest);
    out
}

/// STRICTLY decode one request frame.
///
/// # Errors
/// [`FrameParseError`] naming the first failure. Refuses bad magic, unknown version, unknown kind,
/// oversize, truncation, trailing bytes, length mismatch and an unknown operation discriminant.
pub fn decode_protected_operation_request(
    buf: &[u8],
) -> Result<(ProtectedOperationRequest, Nonce), FrameParseError> {
    let (header, nonce) = parse_single_frame(buf)?;
    if header.kind() != MessageKind::ProtectedOperationRequest {
        return Err(FrameParseError::UnexpectedMessageKind);
    }
    let p = HEADER_LEN;
    let mut correlation = [0u8; CORRELATION_LEN];
    correlation.copy_from_slice(&buf[p..p + CORRELATION_LEN]);
    let mut o = p + CORRELATION_LEN;
    let mut eight = [0u8; 8];
    eight.copy_from_slice(&buf[o..o + 8]);
    let sequence = u64::from_be_bytes(eight);
    o += 8;
    eight.copy_from_slice(&buf[o..o + 8]);
    let claimed_service_epoch = u64::from_be_bytes(eight);
    o += 8;
    let mut binding_digest = [0u8; BINDING_DIGEST_LEN];
    binding_digest.copy_from_slice(&buf[o..o + BINDING_DIGEST_LEN]);
    o += BINDING_DIGEST_LEN;
    let operation =
        OperationClass::from_discriminant(buf[o]).ok_or(FrameParseError::UnknownStatusEnum)?;
    o += 1;
    let mut approval_ref = [0u8; APPROVAL_REF_LEN];
    approval_ref.copy_from_slice(&buf[o..o + APPROVAL_REF_LEN]);
    o += APPROVAL_REF_LEN;
    let mut client_session_ref = [0u8; SESSION_REF_LEN];
    client_session_ref.copy_from_slice(&buf[o..o + SESSION_REF_LEN]);
    o += SESSION_REF_LEN;
    let mut parameter_digest = [0u8; BINDING_DIGEST_LEN];
    parameter_digest.copy_from_slice(&buf[o..o + BINDING_DIGEST_LEN]);
    Ok((
        ProtectedOperationRequest {
            correlation,
            sequence,
            claimed_service_epoch,
            binding_digest,
            operation,
            approval_ref,
            client_session_ref,
            parameter_digest,
        },
        nonce,
    ))
}

/// Encode a response frame. Canonical.
#[must_use]
pub fn encode_protected_operation_response(
    nonce: &Nonce,
    response: &ProtectedOperationResponse,
) -> [u8; HEADER_LEN + PROTECTED_OPERATION_RESPONSE_LEN] {
    let mut out = [0u8; HEADER_LEN + PROTECTED_OPERATION_RESPONSE_LEN];
    write_frame_header(
        &mut out,
        MessageKind::ProtectedOperationResponse,
        nonce,
        PROTECTED_OPERATION_RESPONSE_LEN as u16,
    );
    let p = HEADER_LEN;
    out[p..p + CORRELATION_LEN].copy_from_slice(&response.correlation);
    let mut o = p + CORRELATION_LEN;
    out[o] = response.state.discriminant();
    out[o + 1] = response.reason.discriminant();
    out[o + 2] = response.result.discriminant();
    o += 3;
    out[o..o + 8].copy_from_slice(&response.service_epoch.to_be_bytes());
    o += 8;
    out[o..o + EVIDENCE_REF_LEN].copy_from_slice(&response.evidence_ref);
    o += EVIDENCE_REF_LEN;
    out[o] = response.terminal.discriminant();
    out
}

/// STRICTLY decode one response frame.
///
/// # Errors
/// [`FrameParseError`] naming the first failure.
pub fn decode_protected_operation_response(
    buf: &[u8],
) -> Result<(ProtectedOperationResponse, Nonce), FrameParseError> {
    let (header, nonce) = parse_single_frame(buf)?;
    if header.kind() != MessageKind::ProtectedOperationResponse {
        return Err(FrameParseError::UnexpectedMessageKind);
    }
    let p = HEADER_LEN;
    let mut correlation = [0u8; CORRELATION_LEN];
    correlation.copy_from_slice(&buf[p..p + CORRELATION_LEN]);
    let mut o = p + CORRELATION_LEN;
    let state =
        ResponseState::from_discriminant(buf[o]).ok_or(FrameParseError::UnknownStatusEnum)?;
    let reason =
        RejectionReason::from_discriminant(buf[o + 1]).ok_or(FrameParseError::UnknownStatusEnum)?;
    let result =
        ResultClass::from_discriminant(buf[o + 2]).ok_or(FrameParseError::UnknownStatusEnum)?;
    o += 3;
    let mut eight = [0u8; 8];
    eight.copy_from_slice(&buf[o..o + 8]);
    let service_epoch = u64::from_be_bytes(eight);
    o += 8;
    let mut evidence_ref = [0u8; EVIDENCE_REF_LEN];
    evidence_ref.copy_from_slice(&buf[o..o + EVIDENCE_REF_LEN]);
    o += EVIDENCE_REF_LEN;
    let terminal =
        TerminalStatus::from_discriminant(buf[o]).ok_or(FrameParseError::UnknownStatusEnum)?;
    Ok((
        ProtectedOperationResponse {
            correlation,
            state,
            reason,
            result,
            service_epoch,
            evidence_ref,
            terminal,
        },
        nonce,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::NONCE_LEN;

    fn nonce() -> Nonce {
        Nonce::from_fixed_bytes([9u8; NONCE_LEN])
    }

    fn request() -> ProtectedOperationRequest {
        ProtectedOperationRequest::new(
            [1u8; CORRELATION_LEN],
            7,
            42,
            [2u8; BINDING_DIGEST_LEN],
            OperationClass::ProviderIdentityRead,
            [3u8; APPROVAL_REF_LEN],
            [4u8; SESSION_REF_LEN],
            [5u8; BINDING_DIGEST_LEN],
        )
    }

    #[test]
    fn request_round_trips_canonically() {
        let r = request();
        let bytes = encode_protected_operation_request(&nonce(), &r);
        let (back, n) = decode_protected_operation_request(&bytes).expect("decodes");
        assert_eq!(back, r);
        assert_eq!(n, nonce());
        assert_eq!(bytes, encode_protected_operation_request(&nonce(), &r));
    }

    #[test]
    fn rejected_response_round_trips() {
        let resp = ProtectedOperationResponse::rejected(
            [1u8; CORRELATION_LEN],
            RejectionReason::OwnerPresenceGateOpen,
            42,
            TerminalStatus::Terminal,
        );
        let bytes = encode_protected_operation_response(&nonce(), &resp);
        let (back, _) = decode_protected_operation_response(&bytes).expect("decodes");
        assert_eq!(back, resp);
        assert_eq!(back.state(), ResponseState::Rejected);
        assert_eq!(back.result(), ResultClass::NotRun);
    }

    #[test]
    fn encoded_frames_stay_within_the_accepted_ceiling() {
        // Measures the ACTUAL encoded frames, not the constants. The constants are already pinned at
        // compile time by the `const _: () = assert!(..)` checks in `protocol.rs`; asserting them again
        // here would be a tautology. What is worth testing is that the encoders emit exactly the
        // declared length and nothing longer.
        let req = encode_protected_operation_request(&nonce(), &request());
        let resp = encode_protected_operation_response(
            &nonce(),
            &ProtectedOperationResponse::rejected(
                [1u8; CORRELATION_LEN],
                RejectionReason::OwnerPresenceGateOpen,
                1,
                TerminalStatus::Terminal,
            ),
        );
        assert_eq!(req.len(), HEADER_LEN + PROTECTED_OPERATION_REQUEST_LEN);
        assert_eq!(resp.len(), HEADER_LEN + PROTECTED_OPERATION_RESPONSE_LEN);
        assert!(req.len() <= 512, "request frame exceeds the frame ceiling");
        assert!(
            resp.len() <= 512,
            "response frame exceeds the frame ceiling"
        );
    }

    // ---- PHASE 2: the peer-authentication CONTRACT ----
    //
    // Every case below drives the contract with SYNTHETIC evidence. Live capture is deferred to the
    // canonical identity-proof crate, so nothing here claims that a real peer was ever observed — what
    // is proven is the reconciliation and refusal logic that such evidence will meet.

    /// A well-formed local-account SID: S-1-5-21-1-2-3-1001.
    fn owner_sid() -> TokenUserSid {
        let mut raw = [0u8; 8 + 5 * 4];
        raw[0] = 1; // revision
        raw[1] = 5; // sub-authority count
        raw[7] = 5; // NT Authority
        raw[8..12].copy_from_slice(&21u32.to_le_bytes());
        raw[12..16].copy_from_slice(&1u32.to_le_bytes());
        raw[16..20].copy_from_slice(&2u32.to_le_bytes());
        raw[20..24].copy_from_slice(&3u32.to_le_bytes());
        raw[24..28].copy_from_slice(&1001u32.to_le_bytes());
        TokenUserSid::from_kernel_bytes(&raw).expect("valid sid")
    }

    /// S-1-5-18 (LocalSystem).
    fn system_sid() -> TokenUserSid {
        let mut raw = [0u8; 8 + 4];
        raw[0] = 1;
        raw[1] = 1;
        raw[7] = 5;
        raw[8..12].copy_from_slice(&18u32.to_le_bytes());
        TokenUserSid::from_kernel_bytes(&raw).expect("valid sid")
    }

    /// S-1-5-80-... (a service account).
    fn service_sid() -> TokenUserSid {
        let mut raw = [0u8; 8 + 2 * 4];
        raw[0] = 1;
        raw[1] = 2;
        raw[7] = 5;
        raw[8..12].copy_from_slice(&80u32.to_le_bytes());
        raw[12..16].copy_from_slice(&7u32.to_le_bytes());
        TokenUserSid::from_kernel_bytes(&raw).expect("valid sid")
    }

    /// NT Authority with NO sub-authority: structurally valid, but not classifiable.
    fn unclassifiable_sid() -> TokenUserSid {
        let mut raw = [0u8; 8];
        raw[0] = 1;
        raw[1] = 0; // no sub-authorities
        raw[7] = 5;
        TokenUserSid::from_kernel_bytes(&raw).expect("valid sid")
    }

    /// The baseline coherent observation: one live process, one token, on connection 77 generation 5.
    fn coherent_evidence() -> ObservedPeerEvidence {
        ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        )
    }

    #[test]
    fn coherent_evidence_yields_a_trusted_context_retaining_every_field() {
        let ctx = authenticate_peer(&coherent_evidence(), 77, 5).expect("authenticates");
        assert_eq!(ctx.client_pid(), 4242);
        assert_eq!(ctx.client_creation_tick(), 99_000);
        assert_eq!(ctx.token_user_sid(), &owner_sid());
        assert_eq!(ctx.client_session(), 2);
        assert_eq!(ctx.integrity(), IntegrityLevel::Medium);
        assert_eq!(ctx.connection_id(), 77);
        assert_eq!(ctx.handshake_generation(), 5);
        assert_eq!(ctx.peer_class(), PeerUserClass::Owner);
    }

    #[test]
    fn peer_class_is_derived_from_the_token_sid_alone() {
        for (sid, expected) in [
            (owner_sid(), PeerUserClass::Owner),
            (system_sid(), PeerUserClass::System),
            (service_sid(), PeerUserClass::Service),
        ] {
            let e = ObservedPeerEvidence::observed(
                4242,
                99_000,
                Some(4242),
                Some(99_000),
                sid,
                2,
                IntegrityLevel::Medium,
                77,
                5,
            );
            let ctx = authenticate_peer(&e, 77, 5).expect("authenticates");
            assert_eq!(ctx.peer_class(), expected);
        }
    }

    #[test]
    fn a_high_integrity_token_does_not_change_the_peer_class() {
        // Elevation is recorded as its own field. It must not promote an ordinary user into System or
        // Service, which is the filtered-token / deny-only-Administrators trap.
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::High,
            77,
            5,
        );
        let ctx = authenticate_peer(&e, 77, 5).expect("authenticates");
        assert_eq!(ctx.peer_class(), PeerUserClass::Owner);
        assert_eq!(ctx.integrity(), IntegrityLevel::High);
    }

    #[test]
    fn a_sid_that_cannot_be_classified_is_refused() {
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            unclassifiable_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            authenticate_peer(&e, 77, 5),
            Err(PeerAuthenticationError::UnknownPeerClass)
        );
    }

    #[test]
    fn a_dead_process_is_refused() {
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            None,
            None,
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            authenticate_peer(&e, 77, 5),
            Err(PeerAuthenticationError::ClientProcessExited)
        );
    }

    #[test]
    fn a_reused_pid_with_a_different_creation_identity_is_refused() {
        // Same PID, different creation tick: a later process must NOT inherit the earlier context.
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_001),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            authenticate_peer(&e, 77, 5),
            Err(PeerAuthenticationError::ProcessCreationMismatch)
        );
    }

    #[test]
    fn a_missing_client_pid_is_refused() {
        let e = ObservedPeerEvidence::observed(
            0,
            99_000,
            Some(0),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            authenticate_peer(&e, 77, 5),
            Err(PeerAuthenticationError::ClientProcessUnavailable)
        );
    }

    #[test]
    fn a_connection_or_handshake_mismatch_is_refused() {
        assert_eq!(
            authenticate_peer(&coherent_evidence(), 78, 5),
            Err(PeerAuthenticationError::ConnectionMismatch)
        );
        assert_eq!(
            authenticate_peer(&coherent_evidence(), 77, 6),
            Err(PeerAuthenticationError::HandshakeGenerationMismatch)
        );
    }

    #[test]
    fn a_structurally_impossible_sid_is_refused_at_construction() {
        assert!(
            TokenUserSid::from_kernel_bytes(&[1u8; 4]).is_none(),
            "too short"
        );
        assert!(
            TokenUserSid::from_kernel_bytes(&[1u8; 96]).is_none(),
            "too long"
        );
    }

    #[test]
    fn distinct_sids_and_sessions_stay_distinct() {
        let a = authenticate_peer(&coherent_evidence(), 77, 5).expect("a");
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            system_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        let b = authenticate_peer(&e, 77, 5).expect("b");
        assert_ne!(a.token_user_sid(), b.token_user_sid());

        let f = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            3,
            IntegrityLevel::Medium,
            77,
            5,
        );
        let c = authenticate_peer(&f, 77, 5).expect("c");
        assert_ne!(a.client_session(), c.client_session());
    }

    #[test]
    fn unknown_integrity_rids_fail_closed() {
        assert!(IntegrityLevel::from_rid(0x2000).is_some());
        assert!(IntegrityLevel::from_rid(0x2500).is_none());
        assert!(IntegrityLevel::from_rid(0xFFFF).is_none());
    }

    #[test]
    fn an_authenticated_peer_still_cannot_pass_c4() {
        // The whole point of the phase: peer identity does NOT grant operation authority.
        let ctx = authenticate_peer(&coherent_evidence(), 77, 5).expect("authenticates");
        let resp = evaluate_protected_operation(&request(), Some(&ctx), 42);
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
        assert_eq!(resp.result(), ResultClass::NotRun);
    }

    #[test]
    fn wire_request_fields_never_influence_the_trusted_context() {
        // The DTO carries a client_session_ref; authentication ignores it entirely. Changing it must
        // not change any authenticated field.
        let ctx = authenticate_peer(&coherent_evidence(), 77, 5).expect("authenticates");
        let mut r = request();
        r.client_session_ref = [0xFFu8; SESSION_REF_LEN];
        let resp = evaluate_protected_operation(&r, Some(&ctx), 42);
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(
            ctx.client_session(),
            2,
            "wire data must not alter the attested session"
        );
        assert_eq!(ctx.peer_class(), PeerUserClass::Owner);
    }

    #[test]
    fn a_rebound_peer_with_a_different_sid_is_refused() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            system_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &e),
            Err(PeerAuthenticationError::UserSidMismatch)
        );
    }

    #[test]
    fn a_rebound_peer_from_a_different_session_is_refused() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            1,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &e),
            Err(PeerAuthenticationError::SessionMismatch)
        );
    }

    #[test]
    fn a_rebound_peer_at_a_different_integrity_is_refused() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::High,
            77,
            5,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &e),
            Err(PeerAuthenticationError::IntegrityMismatch)
        );
    }

    #[test]
    fn a_rebound_peer_from_a_different_process_is_refused() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let e = ObservedPeerEvidence::observed(
            4243,
            99_000,
            Some(4243),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            5,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &e),
            Err(PeerAuthenticationError::ProcessCreationMismatch)
        );
    }

    #[test]
    fn rebinding_still_enforces_the_connection_and_generation() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let e = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            78,
            5,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &e),
            Err(PeerAuthenticationError::ConnectionMismatch)
        );
        let f = ObservedPeerEvidence::observed(
            4242,
            99_000,
            Some(4242),
            Some(99_000),
            owner_sid(),
            2,
            IntegrityLevel::Medium,
            77,
            6,
        );
        assert_eq!(
            reauthenticate_peer(&bound, &f),
            Err(PeerAuthenticationError::HandshakeGenerationMismatch)
        );
    }

    #[test]
    fn an_identical_later_observation_rebinds_successfully() {
        let bound = authenticate_peer(&coherent_evidence(), 77, 5).expect("bound");
        let again = reauthenticate_peer(&bound, &coherent_evidence()).expect("rebinds");
        assert_eq!(again, bound);
    }

    // ---- the C4 hard stop ----

    #[test]
    fn c4_gate_is_open_and_cannot_be_closed() {
        assert!(!OwnerPresenceGate::current().is_closed());
    }

    #[test]
    fn c4_open_request_is_always_rejected() {
        let resp = evaluate_protected_operation(&request(), None, 42);
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
        assert_eq!(resp.result(), ResultClass::NotRun);
        assert_eq!(resp.terminal(), TerminalStatus::Terminal);
    }

    #[test]
    fn c4_is_checked_before_anything_else() {
        // A request whose epoch is wrong AND whose peer is absent still refuses on C4 first, proving
        // the gate cannot be bypassed by failing a later check.
        let mut r = request();
        r.claimed_service_epoch = 999;
        let resp = evaluate_protected_operation(&r, None, 42);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    #[test]
    fn no_evaluation_path_returns_accepted_or_completed() {
        for epoch in [0u64, 42, u64::MAX] {
            for seq in [0u64, 1, u64::MAX] {
                let mut r = request();
                r.sequence = seq;
                r.claimed_service_epoch = epoch;
                let resp = evaluate_protected_operation(&r, None, 42);
                assert_eq!(resp.state(), ResponseState::Rejected);
            }
        }
    }

    // ---- correlation and epoch separation ----

    #[test]
    fn a_response_answers_only_its_own_correlation_and_epoch() {
        let resp = ProtectedOperationResponse::rejected(
            [1u8; CORRELATION_LEN],
            RejectionReason::PolicyRefused,
            42,
            TerminalStatus::Terminal,
        );
        assert!(resp.answers(&[1u8; CORRELATION_LEN], 42));
        assert!(
            !resp.answers(&[2u8; CORRELATION_LEN], 42),
            "cross-correlation"
        );
        assert!(!resp.answers(&[1u8; CORRELATION_LEN], 43), "cross-epoch");
    }

    #[test]
    fn distinct_bindings_encode_distinctly() {
        let a = request();
        let mut b = request();
        b.binding_digest = [8u8; BINDING_DIGEST_LEN];
        assert_ne!(
            encode_protected_operation_request(&nonce(), &a),
            encode_protected_operation_request(&nonce(), &b)
        );
        let mut c = request();
        c.operation = OperationClass::StagingRead;
        assert_ne!(
            encode_protected_operation_request(&nonce(), &a),
            encode_protected_operation_request(&nonce(), &c)
        );
    }

    // ---- negative parsing ----

    #[test]
    fn wrong_kind_is_refused() {
        let resp = ProtectedOperationResponse::rejected(
            [1u8; CORRELATION_LEN],
            RejectionReason::PolicyRefused,
            1,
            TerminalStatus::Terminal,
        );
        let bytes = encode_protected_operation_response(&nonce(), &resp);
        assert_eq!(
            decode_protected_operation_request(&bytes),
            Err(FrameParseError::UnexpectedMessageKind)
        );
    }

    #[test]
    fn truncation_and_trailing_bytes_are_refused() {
        let bytes = encode_protected_operation_request(&nonce(), &request());
        assert!(decode_protected_operation_request(&bytes[..bytes.len() - 1]).is_err());
        let mut extra = bytes.to_vec();
        extra.push(0);
        assert_eq!(
            decode_protected_operation_request(&extra),
            Err(FrameParseError::TrailingData)
        );
    }

    #[test]
    fn bad_magic_and_bad_version_are_refused() {
        let mut bytes = encode_protected_operation_request(&nonce(), &request());
        bytes[0] = b'X';
        assert_eq!(
            decode_protected_operation_request(&bytes),
            Err(FrameParseError::BadMagic)
        );
        let mut v = encode_protected_operation_request(&nonce(), &request());
        v[4] = 0xFF;
        v[5] = 0xFF;
        assert_eq!(
            decode_protected_operation_request(&v),
            Err(FrameParseError::UnknownVersion)
        );
    }

    #[test]
    fn a_declared_length_that_disagrees_is_refused() {
        let len_off = 7 + NONCE_LEN;

        // Under-declaring the length against a full-size buffer is caught as trailing data: the
        // parser refuses the surplus rather than silently reading a short record.
        let mut short = encode_protected_operation_request(&nonce(), &request());
        short[len_off..len_off + 2].copy_from_slice(&1u16.to_be_bytes());
        assert_eq!(
            decode_protected_operation_request(&short),
            Err(FrameParseError::TrailingData)
        );

        // A self-consistent frame whose declared length is simply not this kind's length is caught by
        // the kind/length table itself.
        let mut wrong = [0u8; HEADER_LEN + 1];
        wrong.copy_from_slice(&short[..HEADER_LEN + 1]);
        assert_eq!(
            decode_protected_operation_request(&wrong),
            Err(FrameParseError::PayloadLengthMismatch)
        );
    }

    #[test]
    fn unknown_closed_enum_bytes_are_refused() {
        let mut bytes = encode_protected_operation_request(&nonce(), &request());
        let op_off = HEADER_LEN + CORRELATION_LEN + 8 + 8 + BINDING_DIGEST_LEN;
        bytes[op_off] = 0xEE;
        assert_eq!(
            decode_protected_operation_request(&bytes),
            Err(FrameParseError::UnknownStatusEnum)
        );

        let resp = ProtectedOperationResponse::rejected(
            [1u8; CORRELATION_LEN],
            RejectionReason::PolicyRefused,
            1,
            TerminalStatus::Terminal,
        );
        let mut rb = encode_protected_operation_response(&nonce(), &resp);
        rb[HEADER_LEN + CORRELATION_LEN] = 0xEE;
        assert_eq!(
            decode_protected_operation_response(&rb),
            Err(FrameParseError::UnknownStatusEnum)
        );
    }

    #[test]
    fn accepted_is_not_completed_and_reports_nothing_ran() {
        // Constructed here only because the test module is inside the crate; note that even so it
        // needs an AuthorisedProtectedOperation, which no production path can obtain.
        let authority = AuthorisedProtectedOperation {
            _seal: Seal,
            correlation: [1u8; CORRELATION_LEN],
            operation: OperationClass::ProviderIdentityRead,
            service_epoch: 42,
        };
        let accepted = ProtectedOperationResponse::accepted(&authority);
        assert_eq!(accepted.state(), ResponseState::Accepted);
        assert_eq!(
            accepted.result(),
            ResultClass::NotRun,
            "ACCEPTED must never imply an executed effect"
        );
        let completed = ProtectedOperationResponse::completed(
            &authority,
            ResultClass::Succeeded,
            [6u8; EVIDENCE_REF_LEN],
        );
        assert_eq!(completed.state(), ResponseState::Completed);
        assert_ne!(accepted.state(), completed.state());
    }
}
