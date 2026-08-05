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

/// Kernel-attested peer identity.
///
/// **This phase provides NO way to construct one.** There is no public constructor, no `pub(crate)`
/// constructor and no fixture. Phase 2 mints it from `GetNamedPipeClientProcessId`,
/// `ImpersonateNamedPipeClient`/`OpenThreadToken` and the client session id. Until then every call site
/// must pass `None`, which is exactly why no request can be accepted yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedPeerContext {
    _seal: Seal,
    client_pid: u32,
    client_creation_tick: u64,
    client_session: u32,
}

impl TrustedPeerContext {
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

    /// Kernel-attested Windows session.
    #[must_use]
    pub fn client_session(&self) -> u32 {
        self.client_session
    }
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
