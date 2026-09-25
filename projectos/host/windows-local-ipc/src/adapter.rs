//! The SAFE local-IPC transport adapter. All Windows work is delegated to an [`IpcBackend`] seam; the
//! live Windows backend lives in `windows_ffi.rs` (the only unsafe module). The public operations are
//! gated by a sealed [`LiveIpcOperationCapability`] that has NO public/feature/test constructor, so no
//! live pipe operation is reachable in this phase — compiled capability is never runtime authority. The
//! orchestration logic (`*_logic`) is pure and proven with a deterministic [`FakeIpcBackend`] (no
//! Windows call, no sleep).
//!
//! A connected pipe is NEVER an authenticated peer: `ConnectNamedPipe` success yields only
//! [`ConnectionState::TransportConnectedUnauthenticated`]. The expected peer is confirmed ONLY after a
//! bounded, nonce-bound, version-bound and role-bound `ControllerHello` → `ServiceReady` handshake. Peer
//! role is never inferred from connection success, DACL membership, LocalSystem/Administrator access,
//! endpoint possession, process identity or a caller-supplied role. IPC ALONE still never confirms
//! service authority — SCM corroboration remains independently required by the proof runner.

use projectos_host_authority::ProjectOsHostPipeSecurityStatus;

use crate::contracts::{EndpointFreshness, IpcResidue, IpcShutdownResult, ReplayClassification};
use crate::operation_contract::ProtectedOperationResponse;
use crate::protocol::{FrameParseError, InstalledHostStatus, MessageKind};
use crate::review_exchange::{HostReviewIpcCapability, ProtectedRequestReceipt};
use crate::security::{evaluate_pipe_security, EndpointSecurityDecision};
use crate::verification::{
    verify_endpoint_fresh, verify_not_replayed, verify_peer_role, IpcFailure, PeerRole, RetryPolicy,
};

/// Private seal — `LiveIpcOperationCapability` cannot be constructed outside this module, and this
/// module provides no constructor.
#[derive(Debug)]
struct Sealed;

/// The sealed authority to perform a LIVE local-IPC operation. It has no public constructor, no factory,
/// no `Default`, and is never produced by a feature, environment variable, CLI flag, elevation or an
/// owner-approval boolean. A later owner-gated phase may connect it to the approval broker; until then
/// no value exists, so every capability-gated method is unreachable.
pub struct LiveIpcOperationCapability {
    _sealed: Sealed,
    /// THE SCOPE THIS CAPABILITY WAS MINTED AT (PROJECTOS-HOST-REVIEW-PATH1B G5).
    ///
    /// It is a FIELD, not a constant, because there is now more than one thing a live transport
    /// capability can be for, and a `scope()` that returned the same answer whatever it was minted
    /// from would be a comment pretending to be a check. The field is private and is set only by the
    /// two mints below; nothing can change it afterwards.
    scope: CapabilityScope,
}

/// ONE owner-approved, READ-ONLY installed-host status read.
///
/// Transcribed from the exact phrase the owner gave. It is move-only and consumed by the capability it
/// authorises, so one approval yields one bounded status session and cannot be reused, replayed, or
/// widened into anything else.
#[cfg(feature = "owner-approved-status-read")]
#[derive(Debug)]
pub struct OwnerStatusReadApproval {
    _sealed: Sealed,
}

#[cfg(feature = "owner-approved-status-read")]
impl OwnerStatusReadApproval {
    /// The exact phrase the owner must have given. A near-miss is refused: this transcribes an
    /// approval, it does not interpret one.
    pub const REQUIRED_PHRASE: &'static str =
        "APPROVED: one local read-only IPC capability for retrieving installed ProjectOSHost status";

    /// Transcribe the owner's approval.
    ///
    /// # Errors
    /// [`StatusApprovalRefused`] if the phrase is not exactly [`Self::REQUIRED_PHRASE`].
    pub fn transcribe(phrase: &str) -> Result<Self, StatusApprovalRefused> {
        if phrase != Self::REQUIRED_PHRASE {
            return Err(StatusApprovalRefused);
        }
        Ok(Self { _sealed: Sealed })
    }
}

/// The owner approval was not the exact required phrase. Fieldless: it echoes nothing back.
#[cfg(feature = "owner-approved-status-read")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatusApprovalRefused;

/// What a capability is allowed to do.
///
/// This exists so the authorisation is a value the code must match on, not a comment. A capability
/// obtained for one scope cannot be passed where another is required, because the serving facades
/// REFUSE a capability whose scope is not theirs - see `serve_one_status_exchange` and
/// `serve_one_exchange`. No mutating scope is representable at all.
///
/// UNGATED since PROJECTOS-HOST-REVIEW-PATH1B G5. The enum itself is a plain closed vocabulary and
/// carries no authority; it is compiled always so the capability can carry its scope in every graph.
/// The MINTS remain feature-gated, which is where the authority actually lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CapabilityScope {
    /// Read the installed-host status of the local ProjectOSHost instance. Nothing else.
    ///
    /// UNCHANGED IN MEANING. It does not authorise a governed review, and G5 did not widen it: the
    /// review is a separate value below, minted from a separate authority, and neither substitutes
    /// for the other.
    ReadInstalledHostStatusLocalOnly,
    /// Carry out the local transport operations of ONE governed Host review exchange, and nothing
    /// else (PROJECTOS-HOST-REVIEW-PATH1B G5).
    ///
    /// # What it authorises
    ///
    /// * accepting the governed local connection;
    /// * performing the required handshake;
    /// * serving the status record that exchange begins with;
    /// * receiving the ONE governed review request;
    /// * sending the ONE governed review response;
    /// * closing and classifying the connection.
    ///
    /// # What it does NOT authorise
    ///
    /// Provider or model execution, provider spend, credential access, any other IPC message kind,
    /// service control, production mutation, deployment, database access, external sends or
    /// payments. Each of those remains behind its own separate authority - in particular a review
    /// capability alone reaches no provider: the execution rung still demands the owner-signed
    /// closure, the budget ledger and the attestation ports, none of which this scope supplies.
    GovernedHostReviewLocalOnly,
}

#[cfg(feature = "owner-approved-status-read")]
impl LiveIpcOperationCapability {
    /// The ONLY production route to a live IPC capability: consume one owner approval.
    ///
    /// Compiled solely under `owner-approved-status-read`, which is non-default and is NOT implied by
    /// `windows-live-ipc`. Elevation alone does not produce one, and neither does any test or fixture.
    /// The returned capability is bound to [`CapabilityScope::ReadInstalledHostStatusLocalOnly`] — it
    /// authorises no shutdown, no service control, no write and no other message kind.
    #[must_use]
    pub fn from_owner_status_read_approval(approval: OwnerStatusReadApproval) -> Self {
        // The approval is CONSUMED, so it cannot authorise a second session.
        let OwnerStatusReadApproval { _sealed } = approval;
        Self {
            _sealed,
            // THE STATUS SCOPE, AND ONLY IT. The owner phrase authorises a status read; it has never
            // authorised a review, and G5 is what makes that a value rather than a sentence.
            scope: CapabilityScope::ReadInstalledHostStatusLocalOnly,
        }
    }
}

impl LiveIpcOperationCapability {
    /// The scope this capability was MINTED at. Read off the value, never re-asserted.
    #[must_use]
    pub fn scope(&self) -> CapabilityScope {
        self.scope
    }

}

// The GOVERNED-REVIEW acquisition stands in its OWN impl block, so the one place a review-scoped
// capability can be minted is a block that contains nothing else - and a validator can pin it.
impl LiveIpcOperationCapability {
    /// The GOVERNED REVIEW transport capability (PROJECTOS-HOST-REVIEW-PATH1B G5).
    ///
    /// CRATE-PRIVATE, with exactly one call site:
    /// [`crate::review_exchange::HostReviewIpcCapability::issue_transport_capability`]. The borrowed
    /// review capability IS the authority - it has no production mint but the owner-signed
    /// delegation - so this function adds none of its own and cannot be reached without one.
    pub(crate) fn for_governed_review(
        _review: &crate::review_exchange::HostReviewIpcCapability,
    ) -> Self {
        Self {
            _sealed: Sealed,
            scope: CapabilityScope::GovernedHostReviewLocalOnly,
        }
    }
}

#[cfg(feature = "test-fixtures")]
impl LiveIpcOperationCapability {
    /// FIXTURE-ONLY acquisition, so a dependent consumer can compile and exercise the real peer
    /// contribution facade without any pipe. Compiled only under `test-fixtures`, which is non-default
    /// and is NOT implied by `windows-live-ipc`.
    ///
    /// It authorises nothing and, critically, does NOT by itself confirm a handshake: a confirmation
    /// can only come from the verification logic below. Real live capability production remains absent
    /// and owner-gated.
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self {
            _sealed: Sealed,
            scope: CapabilityScope::ReadInstalledHostStatusLocalOnly,
        }
    }

    /// FIXTURE-ONLY acquisition at the GOVERNED REVIEW scope, so the review facades can be exercised
    /// with a correctly scoped capability and the status facade can be proven to REFUSE one.
    ///
    /// It is a separate function rather than an argument to the one above, so a fixture cannot pick
    /// a scope from a variable either.
    #[must_use]
    pub fn synthetic_review_scoped_for_fixture() -> Self {
        Self {
            _sealed: Sealed,
            scope: CapabilityScope::GovernedHostReviewLocalOnly,
        }
    }
}

/// PROOF that the bounded, nonce-bound handshake completed and the peer is the expected service
/// fixture.
///
/// It is opaque and unforgeable: the field is private, there is no public constructor, no `Default`,
/// no `From<bool>`, no `From<PeerRole>`, no `From<HandshakeOutcome>` and no caller-controlled success
/// field. The ONLY way to obtain one is [`HandshakeTransition::into_confirmed`], and the only code that
/// builds a `HandshakeTransition` carrying a confirmation is the verification path in this module.
///
/// `HandshakeOutcome::ExpectedServiceFixturePeerConfirmed` remains a freely-constructible public unit
/// variant for REPORTING, and is deliberately NOT sufficient to obtain this type.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub struct ConfirmedIpcPeerHandshake {
    _sealed: Sealed,
}

#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
impl core::fmt::Debug for ConfirmedIpcPeerHandshake {
    /// Redacted: a confirmation must never render a nonce, endpoint, role internal or peer identity.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ConfirmedIpcPeerHandshake([REDACTED])")
    }
}

/// The result of driving the handshake: the closed PUBLIC outcome for reporting, plus — only when the
/// verification actually confirmed the expected peer — the opaque confirmation.
///
/// The confirmation is taken by CONSUMING the transition, so one handshake yields at most one
/// contribution and a confirmation cannot be replayed from a retained transition.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub struct HandshakeTransition {
    outcome: HandshakeOutcome,
    confirmed: Option<ConfirmedIpcPeerHandshake>,
}

#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
impl core::fmt::Debug for HandshakeTransition {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "HandshakeTransition({:?}, [REDACTED])", self.outcome)
    }
}

#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
impl HandshakeTransition {
    /// Build a transition. CRATE-PRIVATE, and it attaches a confirmation ONLY for the accepting
    /// outcome, so no other code path can mint one.
    pub(crate) fn from_outcome(outcome: HandshakeOutcome) -> Self {
        let confirmed = if outcome.is_peer_confirmed() {
            Some(ConfirmedIpcPeerHandshake { _sealed: Sealed })
        } else {
            None
        };
        Self { outcome, confirmed }
    }

    /// The closed public outcome, for reporting and refusal mapping.
    #[must_use]
    pub fn outcome(&self) -> HandshakeOutcome {
        self.outcome
    }

    /// Take the confirmation, consuming the transition. `None` unless the peer was actually confirmed.
    #[must_use]
    pub fn into_confirmed(self) -> Option<ConfirmedIpcPeerHandshake> {
        self.confirmed
    }
}

/// The closed outcome of opening the proof endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EndpointOutcome {
    /// The endpoint was created as the FIRST pipe instance (anti-squatting satisfied).
    FirstInstanceReady,
    /// A pre-existing instance was found — first-instance protection refuses it.
    NotFirstInstance,
    /// A remote client was rejected (`PIPE_REJECT_REMOTE_CLIENTS`).
    RemoteClientRejected,
    /// The open failed with a redacted classification.
    Failed(IpcFailure),
}

/// The state a RAW transport connection yields. A connected pipe is NOT an authenticated peer: there is
/// deliberately no "accepted role" variant here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ConnectionState {
    /// A local client connected. NOTHING about its identity or role is known or trusted yet.
    TransportConnectedUnauthenticated,
    /// The connection attempt failed — redacted.
    ConnectFailed(IpcFailure),
}

/// A CLOSED observation of one received handshake frame. It carries no raw bytes, no nonce value and no
/// identity — only closed classifications, including whether the nonce matched the expected one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandshakeObservation {
    /// The message kind of the received frame.
    pub kind: MessageKind,
    /// Whether the frame's nonce equalled the expected single-use nonce (the value is never exposed).
    pub nonce_matches: bool,
    /// The peer role the frame declared (decoded from the closed control discriminant).
    pub role: PeerRole,
    /// The nonce replay classification.
    pub replay: ReplayClassification,
    /// The endpoint freshness.
    pub freshness: EndpointFreshness,
}

/// The closed receipt of a handshake read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HandshakeReceipt {
    /// A well-formed, accepted-version frame was observed.
    Observed(HandshakeObservation),
    /// The frame was malformed (bad magic / unknown version / unknown kind / truncated / oversized /
    /// trailing data / length mismatch) — refused.
    Malformed(FrameParseError),
    /// A transport failure — redacted.
    Failed(IpcFailure),
}

/// A closed frame-receipt outcome for ordinary (non-handshake) traffic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReceivedFrame {
    /// A well-formed frame of the given kind.
    Ok(MessageKind),
    /// A malformed frame — refused.
    Malformed(FrameParseError),
    /// A transport failure — redacted.
    Failed(IpcFailure),
}

/// A closed send outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SendOutcome {
    /// The frame was sent.
    Sent,
    /// The send failed — redacted.
    Failed(IpcFailure),
}

/// The closed lifecycle state of the transport backend. Once an unconfirmed pending operation forces the
/// pipe handle into quarantine, the ordinary backend is PERMANENTLY unusable: it no longer owns the
/// handle and may never reuse, disconnect, close or "cleanly" finish it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BackendState {
    /// Normal operation.
    Operational,
    /// The pipe handle (with its pending OVERLAPPED/event/buffer) was transferred into the managed
    /// quarantine because terminalization was unconfirmed. The backend owns nothing to close.
    HandleTransferredToQuarantine,
    /// The backend is otherwise unusable (endpoint gone / already closed).
    BackendUnavailable,
}

impl BackendState {
    /// Only an operational backend may accept peers, read, write or shut down.
    #[must_use]
    pub fn is_operational(self) -> bool {
        matches!(self, Self::Operational)
    }
}

/// The Windows-facing seam. The safe adapter calls only these closed operations; the live implementation
/// (windows_ffi.rs) performs the actual named-pipe I/O. No method exposes a handle, raw buffer, endpoint
/// name, nonce value, security descriptor or Win32 error.
/// The outcome of receiving ONE installed-host status frame. Mirrors [`ReceivedFrame`], but carries the
/// decoded closed record rather than a kind — and never the raw bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StatusReceipt {
    /// A well-formed status record that the STRICT decoder accepted.
    Ok(InstalledHostStatus),
    /// The frame was refused by the strict decoder.
    Malformed(FrameParseError),
    /// A transport failure — redacted.
    Failed(IpcFailure),
}

pub trait IpcBackend {
    /// The closed backend lifecycle state.
    fn state(&self) -> BackendState;
    /// Open the fixed proof endpoint as the first instance, message-mode, local-only.
    fn open_endpoint(&self) -> EndpointOutcome;
    /// Wait (bounded) for a local client to connect. Yields ONLY an unauthenticated transport state.
    fn connect_unauthenticated(&self) -> ConnectionState;
    /// Send a handshake frame of `kind` declaring `role`, carrying the expected single-use nonce.
    fn send_handshake(&self, kind: MessageKind, role: PeerRole) -> SendOutcome;
    /// Receive exactly one handshake frame (bounded) and classify it against the expected nonce.
    fn receive_handshake(&self) -> HandshakeReceipt;
    /// Receive one typed frame (bounded).
    fn receive_frame(&self) -> ReceivedFrame;
    /// Send ONE installed-host status record (bounded).
    ///
    /// Deliberately specific: there is no generic payload send, so nothing but this closed record can
    /// be put on the wire through it.
    fn send_installed_host_status(&self, status: &InstalledHostStatus) -> SendOutcome;
    /// Receive ONE installed-host status record (bounded), judged by the strict decoder.
    fn receive_installed_host_status(&self) -> StatusReceipt;
    /// PROJECTOS-HOST-REVIEW-PATH1A. Receive ONE protected-operation request (bounded), judged by the
    /// strict decoder and bound to this exchange's nonce.
    ///
    /// FAILS CLOSED BY DEFAULT: a backend that does not implement the review exchange cannot receive a
    /// request, so no existing backend gained the ability by this method existing.
    fn receive_protected_operation_request(&self) -> ProtectedRequestReceipt {
        ProtectedRequestReceipt::Failed(IpcFailure::EndpointUnavailable)
    }
    /// PROJECTOS-HOST-REVIEW-PATH1A. Send ONE protected-operation response (bounded).
    ///
    /// Deliberately specific, like the status send: it takes the closed response type, so nothing but
    /// that fixed-width record can be put on the wire through it. Fails closed by default.
    fn send_protected_operation_response(
        &self,
        _response: &ProtectedOperationResponse,
    ) -> SendOutcome {
        SendOutcome::Failed(IpcFailure::EndpointUnavailable)
    }
    /// Send one closed control frame (bounded).
    fn send_control(&self, kind: MessageKind) -> SendOutcome;
    /// Confirm shutdown (bounded).
    fn confirm_shutdown(&self) -> IpcShutdownResult;
    /// Disconnect, close and classify endpoint residue.
    fn close_residue(&self) -> IpcResidue;
    /// Whether any pending I/O could NOT be terminalized within the bounded cancellation grace and is
    /// therefore QUARANTINED (its OVERLAPPED/event/buffer/handle still owned). While true, residue can
    /// never be Zero and shutdown can never be clean.
    fn has_quarantined_io(&self) -> bool;
    /// A bounded, deterministic inter-attempt wait (no unbounded sleep).
    fn wait_between_attempts(&self);
}

/// The closed result of preparing the proof server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServerPreparation {
    /// The endpoint is prepared (first instance, local-only, message-mode, protected security).
    Prepared,
    /// The host-authority security object was not Ready — refused, no weaker fallback.
    RefusedSecurity(EndpointSecurityDecision),
    /// A pre-existing (non-first) instance was refused.
    RefusedNotFirstInstance,
    /// A remote client was refused.
    RefusedRemoteClient,
    /// The open failed — redacted.
    Failed(IpcFailure),
}

/// The closed result of the bounded, nonce-bound peer handshake. The ONLY accepting variant is
/// [`ExpectedServiceFixturePeerConfirmed`](Self::ExpectedServiceFixturePeerConfirmed), and it is
/// reachable only after every handshake check passes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HandshakeOutcome {
    /// Transport connected; NOTHING is authenticated yet.
    TransportConnectedUnauthenticated,
    /// Version, nonce, freshness, replay and role all verified — the expected peer is confirmed.
    ExpectedServiceFixturePeerConfirmed,
    /// The first frame was not the required kind.
    RefusedWrongMessageKind,
    /// The nonce did not match the expected single-use nonce.
    RefusedNonceMismatch,
    /// The nonce was replayed.
    RefusedReplay,
    /// The endpoint was stale.
    RefusedStale,
    /// The declared peer role did not match the expected role.
    RefusedRole,
    /// The frame was malformed (includes wrong protocol version).
    RefusedMalformed(FrameParseError),
    /// A transport failure or timeout — redacted.
    Failed(IpcFailure),
}

impl HandshakeOutcome {
    /// Only a fully verified handshake confirms the expected peer.
    #[must_use]
    pub fn is_peer_confirmed(self) -> bool {
        matches!(self, Self::ExpectedServiceFixturePeerConfirmed)
    }
}

/// The safe local-IPC adapter over a backend `B`.
pub struct LocalIpcAdapter<B: IpcBackend> {
    backend: B,
    wait: RetryPolicy,
}

impl<B: IpcBackend> LocalIpcAdapter<B> {
    /// Borrow the backend. CRATE-PRIVATE (PROJECTOS-HOST-REVIEW-PATH1B §10): the live governed-review
    /// facade needs to lend the backend live server handle to the canonical client-admission capture,
    /// and the backend must not become part of the public surface to make that possible. A borrow
    /// confers nothing on its own - every capability-gated operation still demands the capability.
    // Used ONLY by the live governed-review facade, which is compiled under ; in a
    // default or fixture graph there is no live server handle to lend, so it is legitimately unused.
    #[allow(dead_code)]
    pub(crate) fn backend(&self) -> &B {
        &self.backend
    }

    /// Construct the adapter over a backend with the default bounded wait policy.
    #[must_use]
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            wait: crate::verification::default_wait_policy(),
        }
    }

    /// The bounded wait policy in force.
    #[must_use]
    pub fn wait_policy(&self) -> RetryPolicy {
        self.wait
    }

    /// IPC ALONE never confirms service authority — not even after a fully verified handshake.
    /// Independent SCM corroboration is always required.
    #[must_use]
    pub fn ipc_alone_confirms_authority() -> bool {
        false
    }

    // --- Capability-gated public surface (unreachable this phase: no capability is constructible) ---

    /// Prepare the proof server. Requires a sealed capability AND a Ready host-authority security object.
    #[must_use]
    pub fn prepare_server(
        &self,
        _cap: &LiveIpcOperationCapability,
        security: ProjectOsHostPipeSecurityStatus,
    ) -> ServerPreparation {
        self.prepare_server_logic(security)
    }

    /// Accept a raw local connection. Yields only an UNAUTHENTICATED transport state.
    #[must_use]
    pub fn accept_unauthenticated(&self, _cap: &LiveIpcOperationCapability) -> ConnectionState {
        self.accept_unauthenticated_logic()
    }

    /// Run the bounded controller-side nonce-bound handshake. Requires a sealed capability.
    #[must_use]
    pub fn complete_controller_handshake(
        &self,
        _cap: &LiveIpcOperationCapability,
        expected_peer: PeerRole,
    ) -> HandshakeOutcome {
        self.complete_controller_handshake_logic(expected_peer)
    }

    /// Run the same bounded handshake and return the transition, which carries the opaque
    /// confirmation when — and only when — the expected peer was actually confirmed.
    ///
    /// This is the PRODUCTION source of a [`ConfirmedIpcPeerHandshake`]. A caller cannot mint one from
    /// the public `HandshakeOutcome` variant, so holding a confirmation always means this verification
    /// path accepted.
    #[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
    #[must_use]
    pub fn complete_controller_handshake_transition(
        &self,
        _cap: &LiveIpcOperationCapability,
        expected_peer: PeerRole,
    ) -> HandshakeTransition {
        HandshakeTransition::from_outcome(self.complete_controller_handshake_logic(expected_peer))
    }

    /// Run the bounded service-side handshake (verify `ControllerHello`, answer `ServiceReady`).
    #[must_use]
    pub fn complete_service_handshake(
        &self,
        _cap: &LiveIpcOperationCapability,
    ) -> HandshakeOutcome {
        self.complete_service_handshake_logic()
    }

    /// Complete the service handshake and RETAIN the confirmation it produced.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B G3. Byte for byte the same verification as
    /// [`Self::complete_service_handshake`] - it calls the SAME
    /// `complete_service_handshake_logic`, so there is one handshake order and one opinion about it.
    /// What differs is only that the closed outcome is wrapped in a [`HandshakeTransition`], which
    /// attaches a [`ConfirmedIpcPeerHandshake`] for an accepting outcome and nothing otherwise.
    ///
    /// This is what makes the production same-connection evidence assemblable: a confirmation is
    /// unforgeable and had, until now, no production producer at all. It grants nothing on its own -
    /// the confirmation is still only one of the facts the assembler needs, and the canonical client
    /// admission still decides whether anything is admitted.
    #[cfg(feature = "windows-live-ipc")]
    #[must_use]
    pub fn complete_service_handshake_confirmed(
        &self,
        _cap: &LiveIpcOperationCapability,
    ) -> HandshakeTransition {
        HandshakeTransition::from_outcome(self.complete_service_handshake_logic())
    }

    /// Send ONE installed-host status record (live). Requires the sealed capability.
    ///
    /// The capability's only scope is the read-only status read, so this is the single thing it can
    /// put on the wire.
    #[must_use]
    pub fn send_installed_host_status(
        &self,
        _cap: &LiveIpcOperationCapability,
        status: &InstalledHostStatus,
    ) -> SendOutcome {
        self.backend.send_installed_host_status(status)
    }

    /// Receive ONE installed-host status record (live). Requires the sealed capability. The bytes are
    /// judged by the strict decoder; no raw payload is ever returned.
    #[must_use]
    pub fn receive_installed_host_status(
        &self,
        _cap: &LiveIpcOperationCapability,
    ) -> StatusReceipt {
        self.backend.receive_installed_host_status()
    }

    /// PROJECTOS-HOST-REVIEW-PATH1A. Receive ONE protected-operation request.
    ///
    /// Requires BOTH sealed capabilities: the transport one, and the review one - which has no
    /// production mint, so in a shipped graph this method cannot be called at all.
    #[must_use]
    pub fn receive_protected_operation_request(
        &self,
        _cap: &LiveIpcOperationCapability,
        _review: &HostReviewIpcCapability,
    ) -> ProtectedRequestReceipt {
        if !self.backend.state().is_operational() {
            return ProtectedRequestReceipt::Failed(IpcFailure::EndpointUnavailable);
        }
        self.backend.receive_protected_operation_request()
    }

    /// PROJECTOS-HOST-REVIEW-PATH1A. Send ONE protected-operation response. Both capabilities, as above.
    #[must_use]
    pub fn send_protected_operation_response(
        &self,
        _cap: &LiveIpcOperationCapability,
        _review: &HostReviewIpcCapability,
        response: &ProtectedOperationResponse,
    ) -> SendOutcome {
        if !self.backend.state().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        self.backend.send_protected_operation_response(response)
    }

    /// Receive one typed frame. Requires a sealed capability.
    #[must_use]
    pub fn receive_typed_frame(&self, _cap: &LiveIpcOperationCapability) -> ReceivedFrame {
        self.receive_typed_frame_logic()
    }

    /// Send one closed control frame. Requires a sealed capability.
    #[must_use]
    pub fn send_typed_frame(
        &self,
        _cap: &LiveIpcOperationCapability,
        kind: MessageKind,
    ) -> SendOutcome {
        self.send_typed_frame_logic(kind)
    }

    /// Confirm shutdown. Requires a sealed capability.
    #[must_use]
    pub fn confirm_shutdown(&self, _cap: &LiveIpcOperationCapability) -> bool {
        self.confirm_shutdown_logic()
    }

    /// Close and classify residue. Requires a sealed capability.
    #[must_use]
    pub fn close_and_classify_residue(&self, _cap: &LiveIpcOperationCapability) -> IpcResidue {
        self.close_and_classify_residue_logic()
    }

    // --- Pure orchestration logic (proven with the fake backend; no capability required) ---

    pub(crate) fn prepare_server_logic(
        &self,
        security: ProjectOsHostPipeSecurityStatus,
    ) -> ServerPreparation {
        let decision = evaluate_pipe_security(security);
        if !decision.permits_endpoint() {
            return ServerPreparation::RefusedSecurity(decision);
        }
        match self.backend.open_endpoint() {
            EndpointOutcome::FirstInstanceReady => ServerPreparation::Prepared,
            EndpointOutcome::NotFirstInstance => ServerPreparation::RefusedNotFirstInstance,
            EndpointOutcome::RemoteClientRejected => ServerPreparation::RefusedRemoteClient,
            EndpointOutcome::Failed(f) => ServerPreparation::Failed(f),
        }
    }

    /// A raw connection yields ONLY `TransportConnectedUnauthenticated` — never a role. A backend whose
    /// handle was transferred to quarantine can never accept again.
    pub(crate) fn accept_unauthenticated_logic(&self) -> ConnectionState {
        if !self.backend.state().is_operational() {
            return ConnectionState::ConnectFailed(IpcFailure::EndpointUnavailable);
        }
        self.backend.connect_unauthenticated()
    }

    /// Controller side: connect → send `ControllerHello` (fixed version + expected nonce + Controller
    /// role) → receive exactly one `ServiceReady` → verify version (via parse), nonce, freshness, replay
    /// and the ServiceFixture role. Only then is the expected peer confirmed.
    pub(crate) fn complete_controller_handshake_logic(
        &self,
        expected_peer: PeerRole,
    ) -> HandshakeOutcome {
        match self.backend.connect_unauthenticated() {
            ConnectionState::ConnectFailed(f) => return HandshakeOutcome::Failed(f),
            ConnectionState::TransportConnectedUnauthenticated => {}
        }
        // Nothing is trusted yet; announce ourselves before any classification.
        if let SendOutcome::Failed(f) = self
            .backend
            .send_handshake(MessageKind::ControllerHello, PeerRole::Controller)
        {
            return HandshakeOutcome::Failed(f);
        }
        let obs = match self.backend.receive_handshake() {
            HandshakeReceipt::Malformed(e) => return HandshakeOutcome::RefusedMalformed(e),
            HandshakeReceipt::Failed(f) => return HandshakeOutcome::Failed(f),
            HandshakeReceipt::Observed(o) => o,
        };
        Self::verify_handshake(obs, MessageKind::ServiceReady, expected_peer)
    }

    /// Service side: receive `ControllerHello`, verify version/nonce/freshness/replay and the Controller
    /// role, then answer `ServiceReady` with the same nonce and the ServiceFixture role.
    pub(crate) fn complete_service_handshake_logic(&self) -> HandshakeOutcome {
        let obs = match self.backend.receive_handshake() {
            HandshakeReceipt::Malformed(e) => return HandshakeOutcome::RefusedMalformed(e),
            HandshakeReceipt::Failed(f) => return HandshakeOutcome::Failed(f),
            HandshakeReceipt::Observed(o) => o,
        };
        let verified =
            Self::verify_handshake(obs, MessageKind::ControllerHello, PeerRole::Controller);
        if !verified.is_peer_confirmed() {
            return verified;
        }
        match self
            .backend
            .send_handshake(MessageKind::ServiceReady, PeerRole::ServiceFixture)
        {
            SendOutcome::Sent => HandshakeOutcome::ExpectedServiceFixturePeerConfirmed,
            SendOutcome::Failed(f) => HandshakeOutcome::Failed(f),
        }
    }

    /// The shared closed verification order: message kind → freshness → replay → nonce → role. Every
    /// failure is a typed refusal; nothing is inferred from the connection itself.
    fn verify_handshake(
        obs: HandshakeObservation,
        expected_kind: MessageKind,
        expected_role: PeerRole,
    ) -> HandshakeOutcome {
        verify_handshake_logic(obs, expected_kind, expected_role)
    }

    pub(crate) fn receive_typed_frame_logic(&self) -> ReceivedFrame {
        if !self.backend.state().is_operational() {
            return ReceivedFrame::Failed(IpcFailure::EndpointUnavailable);
        }
        self.backend.receive_frame()
    }

    pub(crate) fn send_typed_frame_logic(&self, kind: MessageKind) -> SendOutcome {
        if !self.backend.state().is_operational() {
            return SendOutcome::Failed(IpcFailure::EndpointUnavailable);
        }
        self.backend.send_control(kind)
    }

    /// Shutdown is clean ONLY when the backend is still operational AND the protocol acknowledgement
    /// validated AND no quarantined pending I/O remains. A closed (or transferred-away) handle never
    /// fabricates a clean shutdown.
    pub(crate) fn confirm_shutdown_logic(&self) -> bool {
        if !self.backend.state().is_operational() || self.backend.has_quarantined_io() {
            return false;
        }
        matches!(
            self.backend.confirm_shutdown(),
            IpcShutdownResult::CleanShutdown
        )
    }

    /// Residue is Zero ONLY when the backend reports Zero, is still operational, and nothing is
    /// quarantined. A transferred handle or unconfirmed terminalization always downgrades — a MISSING
    /// normal handle is never treated as clean closure when it went to quarantine.
    pub(crate) fn close_and_classify_residue_logic(&self) -> IpcResidue {
        if self.backend.state() == BackendState::HandleTransferredToQuarantine {
            return IpcResidue::NonZero;
        }
        let residue = self.backend.close_residue();
        if self.backend.has_quarantined_io() {
            return IpcResidue::NonZero;
        }
        residue
    }
}

// ---------------------------------------------------------------------------------------------
// FIXTURE-ONLY handshake and peer contribution (feature `test-fixtures`).
//
// The runner does NOT return success: it drives the SAME closed verification order the production
// path uses (message kind -> freshness -> replay -> nonce -> role), over a synthetic observation, and
// yields a confirmation only when every check passes. Invalid observations produce exactly the same
// refusal outcomes as production. Nothing here creates a pipe or calls Win32.
// ---------------------------------------------------------------------------------------------

/// The shared closed verification order, reused by BOTH the production adapter and the fixture runner
/// so a fixture can never diverge from production validation.
pub(crate) fn verify_handshake_logic(
    obs: HandshakeObservation,
    expected_kind: MessageKind,
    expected_role: PeerRole,
) -> HandshakeOutcome {
    if obs.kind != expected_kind {
        return HandshakeOutcome::RefusedWrongMessageKind;
    }
    if !verify_endpoint_fresh(obs.freshness) {
        return HandshakeOutcome::RefusedStale;
    }
    if !verify_not_replayed(obs.replay) {
        return HandshakeOutcome::RefusedReplay;
    }
    if !obs.nonce_matches {
        return HandshakeOutcome::RefusedNonceMismatch;
    }
    if !verify_peer_role(expected_role, obs.role) {
        return HandshakeOutcome::RefusedRole;
    }
    HandshakeOutcome::ExpectedServiceFixturePeerConfirmed
}

#[cfg(feature = "test-fixtures")]
mod fixture_handshake {
    use super::{
        verify_handshake_logic, ConfirmedIpcPeerHandshake, HandshakeObservation, HandshakeOutcome,
        HandshakeTransition, LiveIpcOperationCapability, MessageKind, PeerRole,
        ReplayClassification,
    };
    use crate::contracts::EndpointFreshness;
    use projectos_host_windows_service_identity_proof::{
        synthetic_observation, AttemptOutcome, IpcPeerObserved, ScmBeforeObserved,
        ServiceInstanceBindingAttempt, SyntheticInstanceSelector,
    };

    /// Build a synthetic ControllerHello observation. Fixture-gated; it carries no live endpoint, no
    /// nonce value, no handle and no process identity — only the closed classifications the
    /// verification order consumes.
    #[must_use]
    pub fn synthetic_controller_hello() -> HandshakeObservation {
        HandshakeObservation {
            kind: MessageKind::ControllerHello,
            nonce_matches: true,
            role: PeerRole::Controller,
            replay: ReplayClassification::FreshAccepted,
            freshness: EndpointFreshness::Fresh,
        }
    }

    /// Run the REAL verification order over a synthetic observation. A caller cannot short-circuit it:
    /// the confirmation is attached by `HandshakeTransition::from_outcome`, which only does so for the
    /// accepting outcome.
    #[must_use]
    pub fn run_fixture_handshake(
        _capability: &LiveIpcOperationCapability,
        observation: HandshakeObservation,
    ) -> HandshakeTransition {
        let outcome = verify_handshake_logic(
            observation,
            MessageKind::ControllerHello,
            PeerRole::Controller,
        );
        HandshakeTransition::from_outcome(outcome)
    }

    /// The FIXTURE peer contributor. Same public shape as the live one: it demands the capability, the
    /// opaque confirmation (consumed) and an attempt that has already observed SCM-before.
    pub struct FixtureIpcPeerContributor {
        _private: (),
    }

    impl FixtureIpcPeerContributor {
        /// Obtainable ONLY by consuming a confirmation, so there is no contributor without a verified
        /// handshake and a confirmation cannot be reused for a second contributor.
        #[must_use]
        pub fn from_confirmed(confirmed: ConfirmedIpcPeerHandshake) -> Self {
            let _ = confirmed;
            Self { _private: () }
        }

        /// Contribute the confirmed peer's synthetic instance. Uses the SAME fixed selector as the
        /// service-control fixture facades, so the ordered positive flow binds.
        pub fn contribute_ipc_peer(
            &self,
            _capability: &LiveIpcOperationCapability,
            attempt: ServiceInstanceBindingAttempt<ScmBeforeObserved>,
        ) -> AttemptOutcome<IpcPeerObserved> {
            attempt.record_ipc_peer(synthetic_observation(SyntheticInstanceSelector::new(1, 1)))
        }
    }

    /// Accepting outcomes must still be checkable by a consumer for reporting.
    #[must_use]
    pub fn outcome_is_confirmed(outcome: HandshakeOutcome) -> bool {
        outcome.is_peer_confirmed()
    }

    /// The controlled SAME-CONNECTION co-observation (CD-B4-PRODUCTION-IPC-PROVIDER1A). One operation
    /// drives the REAL handshake verification order (confirming ONLY if it accepts), then pairs the
    /// resulting confirmation with the co-observed peer identity and channel context into the opaque
    /// [`ConfirmedSameConnectionIpcPeerEvidence`] bundle. The confirmation is consumed here, so it cannot
    /// be reused; the connection id and handshake generation are supplied by the OWNING transport (in the
    /// fixture, the sealed verifier's ids) and are re-checked against the sealed verifier at mint time, so
    /// a caller cannot substitute them to forge a session. A real adapter reads the live peer via the
    /// service-identity observation path here; the fixture supplies the co-observed peer identity. No
    /// named pipe is created and no Windows FFI is copied.
    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn assemble_same_connection_ipc_peer_fixture(
        capability: &LiveIpcOperationCapability,
        connection_id: u64,
        handshake_generation: u64,
        peer_pid: u32,
        peer_creation_tick: u64,
        user: projectos_host_core::PeerUserClass,
        session: Option<projectos_host_core::SessionId>,
        project: projectos_host_core::ProjectId,
        environment: projectos_host_core::EnvironmentId,
        phase_digest: [u8; 32],
        repository_identity: [u8; 32],
        repository_baseline: [u8; 32],
        observed_at: u64,
        valid_until: u64,
        capabilities: Vec<projectos_host_core::ChannelCapability>,
        operation_families: Vec<projectos_host_core::OperationFamily>,
    ) -> Option<crate::observation::ConfirmedSameConnectionIpcPeerEvidence> {
        let transition = run_fixture_handshake(capability, synthetic_controller_hello());
        let confirmed = transition.into_confirmed()?;
        crate::observation::ConfirmedSameConnectionIpcPeerEvidence::observe(
            confirmed,
            connection_id,
            handshake_generation,
            peer_pid,
            peer_creation_tick,
            user,
            session,
            project,
            environment,
            phase_digest,
            repository_identity,
            repository_baseline,
            observed_at,
            valid_until,
            capabilities,
            operation_families,
        )
    }
}

#[cfg(feature = "test-fixtures")]
pub use fixture_handshake::{
    assemble_same_connection_ipc_peer_fixture, outcome_is_confirmed, run_fixture_handshake,
    synthetic_controller_hello, FixtureIpcPeerContributor,
};

#[cfg(test)]
mod tests {
    use super::*;

    /// A deterministic fake backend — no Windows call, no sleep. Every outcome is scripted.
    struct FakeIpcBackend {
        endpoint: EndpointOutcome,
        connection: ConnectionState,
        handshake: HandshakeReceipt,
        send: SendOutcome,
        frame: ReceivedFrame,
        shutdown: IpcShutdownResult,
        residue: IpcResidue,
        quarantined: bool,
        state: BackendState,
        waits: std::cell::Cell<u32>,
        sent: std::cell::RefCell<Vec<(MessageKind, PeerRole)>>,
    }

    fn good_observation() -> HandshakeObservation {
        HandshakeObservation {
            kind: MessageKind::ServiceReady,
            nonce_matches: true,
            role: PeerRole::ServiceFixture,
            replay: ReplayClassification::FreshAccepted,
            freshness: EndpointFreshness::Fresh,
        }
    }

    impl Default for FakeIpcBackend {
        fn default() -> Self {
            Self {
                endpoint: EndpointOutcome::FirstInstanceReady,
                connection: ConnectionState::TransportConnectedUnauthenticated,
                handshake: HandshakeReceipt::Observed(good_observation()),
                send: SendOutcome::Sent,
                frame: ReceivedFrame::Ok(MessageKind::ServiceReady),
                shutdown: IpcShutdownResult::CleanShutdown,
                residue: IpcResidue::Zero,
                quarantined: false,
                state: BackendState::Operational,
                waits: std::cell::Cell::new(0),
                sent: std::cell::RefCell::new(Vec::new()),
            }
        }
    }

    impl IpcBackend for FakeIpcBackend {
        fn state(&self) -> BackendState {
            self.state
        }
        fn open_endpoint(&self) -> EndpointOutcome {
            self.endpoint
        }
        fn connect_unauthenticated(&self) -> ConnectionState {
            self.connection
        }
        fn send_handshake(&self, kind: MessageKind, role: PeerRole) -> SendOutcome {
            self.sent.borrow_mut().push((kind, role));
            self.send
        }
        fn receive_handshake(&self) -> HandshakeReceipt {
            self.handshake
        }
        fn receive_frame(&self) -> ReceivedFrame {
            self.frame
        }
        fn send_installed_host_status(&self, _status: &InstalledHostStatus) -> SendOutcome {
            SendOutcome::Sent
        }

        fn receive_installed_host_status(&self) -> StatusReceipt {
            StatusReceipt::Failed(IpcFailure::EndpointUnavailable)
        }

        fn send_control(&self, _kind: MessageKind) -> SendOutcome {
            self.send
        }
        fn confirm_shutdown(&self) -> IpcShutdownResult {
            self.shutdown
        }
        fn close_residue(&self) -> IpcResidue {
            self.residue
        }
        fn has_quarantined_io(&self) -> bool {
            self.quarantined
        }
        fn wait_between_attempts(&self) {
            self.waits.set(self.waits.get() + 1);
        }
    }

    fn adapter(b: FakeIpcBackend) -> LocalIpcAdapter<FakeIpcBackend> {
        LocalIpcAdapter::new(b)
    }

    fn with_observation(o: HandshakeObservation) -> LocalIpcAdapter<FakeIpcBackend> {
        adapter(FakeIpcBackend {
            handshake: HandshakeReceipt::Observed(o),
            ..Default::default()
        })
    }

    #[test]
    fn ready_first_instance_prepares() {
        let a = adapter(FakeIpcBackend::default());
        assert_eq!(
            a.prepare_server_logic(ProjectOsHostPipeSecurityStatus::Ready),
            ServerPreparation::Prepared
        );
    }

    #[test]
    fn requires_install_security_fails_closed() {
        let a = adapter(FakeIpcBackend::default());
        assert_eq!(
            a.prepare_server_logic(ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof),
            ServerPreparation::RefusedSecurity(EndpointSecurityDecision::RefusedRequiresInstall)
        );
    }

    #[test]
    fn non_first_instance_and_remote_client_are_refused() {
        let a = adapter(FakeIpcBackend {
            endpoint: EndpointOutcome::NotFirstInstance,
            ..Default::default()
        });
        assert_eq!(
            a.prepare_server_logic(ProjectOsHostPipeSecurityStatus::Ready),
            ServerPreparation::RefusedNotFirstInstance
        );
        let a = adapter(FakeIpcBackend {
            endpoint: EndpointOutcome::RemoteClientRejected,
            ..Default::default()
        });
        assert_eq!(
            a.prepare_server_logic(ProjectOsHostPipeSecurityStatus::Ready),
            ServerPreparation::RefusedRemoteClient
        );
    }

    #[test]
    fn connection_success_alone_is_unauthenticated_and_never_a_role() {
        let a = adapter(FakeIpcBackend::default());
        assert_eq!(
            a.accept_unauthenticated_logic(),
            ConnectionState::TransportConnectedUnauthenticated
        );
        // There is deliberately no accepted-role variant reachable from a bare connection.
        assert!(!HandshakeOutcome::TransportConnectedUnauthenticated.is_peer_confirmed());
    }

    #[test]
    fn controller_sends_hello_before_any_peer_acceptance() {
        let b = FakeIpcBackend::default();
        let a = adapter(b);
        let outcome = a.complete_controller_handshake_logic(PeerRole::ServiceFixture);
        assert!(outcome.is_peer_confirmed());
        // ControllerHello with the Controller role was transmitted first.
        let sent = a.backend.sent.borrow();
        assert_eq!(
            sent[0],
            (MessageKind::ControllerHello, PeerRole::Controller)
        );
    }

    #[test]
    fn valid_transcript_confirms_expected_service_fixture_peer() {
        let a = with_observation(good_observation());
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::ExpectedServiceFixturePeerConfirmed
        );
    }

    #[test]
    fn wrong_first_message_kind_is_refused() {
        let a = with_observation(HandshakeObservation {
            kind: MessageKind::AuthorityOutcome,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedWrongMessageKind
        );
    }

    #[test]
    fn nonce_mismatch_and_replay_are_refused() {
        let a = with_observation(HandshakeObservation {
            nonce_matches: false,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedNonceMismatch
        );
        let a = with_observation(HandshakeObservation {
            replay: ReplayClassification::ReplayRefused,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedReplay
        );
    }

    #[test]
    fn stale_endpoint_and_role_mismatch_are_refused() {
        let a = with_observation(HandshakeObservation {
            freshness: EndpointFreshness::Stale,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedStale
        );
        let a = with_observation(HandshakeObservation {
            role: PeerRole::Controller,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedRole
        );
        // An unknown/unauthenticated role never matches.
        let a = with_observation(HandshakeObservation {
            role: PeerRole::RefusedOrUnknown,
            ..good_observation()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedRole
        );
    }

    #[test]
    fn wrong_protocol_version_and_malformed_frames_are_refused() {
        let a = adapter(FakeIpcBackend {
            handshake: HandshakeReceipt::Malformed(FrameParseError::UnknownVersion),
            ..Default::default()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::RefusedMalformed(FrameParseError::UnknownVersion)
        );
    }

    #[test]
    fn handshake_timeout_fails_closed() {
        let a = adapter(FakeIpcBackend {
            handshake: HandshakeReceipt::Failed(IpcFailure::ReadTimedOut),
            ..Default::default()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::Failed(IpcFailure::ReadTimedOut)
        );
    }

    #[test]
    fn connect_failure_fails_closed_before_any_handshake() {
        let a = adapter(FakeIpcBackend {
            connection: ConnectionState::ConnectFailed(IpcFailure::ConnectionTimedOut),
            ..Default::default()
        });
        assert_eq!(
            a.complete_controller_handshake_logic(PeerRole::ServiceFixture),
            HandshakeOutcome::Failed(IpcFailure::ConnectionTimedOut)
        );
        assert!(
            a.backend.sent.borrow().is_empty(),
            "no hello before connect"
        );
    }

    #[test]
    fn service_side_requires_controller_hello_then_answers_ready() {
        let a = adapter(FakeIpcBackend {
            handshake: HandshakeReceipt::Observed(HandshakeObservation {
                kind: MessageKind::ControllerHello,
                role: PeerRole::Controller,
                ..good_observation()
            }),
            ..Default::default()
        });
        assert!(a.complete_service_handshake_logic().is_peer_confirmed());
        let sent = a.backend.sent.borrow();
        assert_eq!(
            sent[0],
            (MessageKind::ServiceReady, PeerRole::ServiceFixture)
        );
    }

    #[test]
    fn service_side_refuses_wrong_controller_role() {
        let a = adapter(FakeIpcBackend {
            handshake: HandshakeReceipt::Observed(HandshakeObservation {
                kind: MessageKind::ControllerHello,
                role: PeerRole::ServiceFixture,
                ..good_observation()
            }),
            ..Default::default()
        });
        assert_eq!(
            a.complete_service_handshake_logic(),
            HandshakeOutcome::RefusedRole
        );
    }

    #[test]
    fn malformed_frame_receipt_is_refused() {
        let a = adapter(FakeIpcBackend {
            frame: ReceivedFrame::Malformed(FrameParseError::BadMagic),
            ..Default::default()
        });
        assert_eq!(
            a.receive_typed_frame_logic(),
            ReceivedFrame::Malformed(FrameParseError::BadMagic)
        );
    }

    #[test]
    fn shutdown_and_residue_are_classified() {
        let a = adapter(FakeIpcBackend::default());
        assert!(a.confirm_shutdown_logic());
        assert_eq!(a.close_and_classify_residue_logic(), IpcResidue::Zero);
        let a = adapter(FakeIpcBackend {
            shutdown: IpcShutdownResult::ShutdownFailed,
            residue: IpcResidue::NonZero,
            ..Default::default()
        });
        assert!(!a.confirm_shutdown_logic());
        assert_ne!(a.close_and_classify_residue_logic(), IpcResidue::Zero);
    }

    #[test]
    fn quarantined_io_forbids_zero_residue_and_clean_shutdown() {
        // Even when the backend would report a clean shutdown and Zero residue, an unconfirmed
        // (quarantined) pending operation downgrades both.
        let a = adapter(FakeIpcBackend {
            shutdown: IpcShutdownResult::CleanShutdown,
            residue: IpcResidue::Zero,
            quarantined: true,
            ..Default::default()
        });
        assert!(
            !a.confirm_shutdown_logic(),
            "quarantine forbids clean shutdown"
        );
        assert_eq!(
            a.close_and_classify_residue_logic(),
            IpcResidue::NonZero,
            "quarantine forbids Zero residue"
        );
    }

    #[test]
    fn ipc_alone_never_confirms_authority_even_after_handshake() {
        let a = with_observation(good_observation());
        assert!(a
            .complete_controller_handshake_logic(PeerRole::ServiceFixture)
            .is_peer_confirmed());
        // A confirmed peer is still NOT service authority — SCM corroboration remains required.
        assert!(!LocalIpcAdapter::<FakeIpcBackend>::ipc_alone_confirms_authority());
    }

    #[test]
    fn a_transferred_backend_refuses_every_operation_and_cannot_close_cleanly() {
        // The handle went to quarantine: the backend owns nothing and is permanently unusable.
        let a = adapter(FakeIpcBackend {
            state: BackendState::HandleTransferredToQuarantine,
            // Even a backend that would otherwise report success must not be believed.
            shutdown: IpcShutdownResult::CleanShutdown,
            residue: IpcResidue::Zero,
            ..Default::default()
        });
        assert_eq!(
            a.accept_unauthenticated_logic(),
            ConnectionState::ConnectFailed(IpcFailure::EndpointUnavailable),
            "no further peer acceptance"
        );
        assert_eq!(
            a.receive_typed_frame_logic(),
            ReceivedFrame::Failed(IpcFailure::EndpointUnavailable),
            "no further reads"
        );
        assert_eq!(
            a.send_typed_frame_logic(MessageKind::ShutdownRequest),
            SendOutcome::Failed(IpcFailure::EndpointUnavailable),
            "no further writes"
        );
        assert!(!a.confirm_shutdown_logic(), "no clean shutdown");
        assert_eq!(
            a.close_and_classify_residue_logic(),
            IpcResidue::NonZero,
            "a missing normal handle is NEVER clean closure when it was transferred"
        );
    }

    // --- Deterministic ownership / drop-safety model (no Windows, no sleep) ---
    //
    // These prove the AMENDMENT1C ownership invariant structurally: the objects Windows may still
    // reference (handle, event, OVERLAPPED storage, buffer) are MOVED into a quarantine owner that
    // outlives the backend, so destroying the backend cannot release them, and they are released exactly
    // once only after a confirmed terminal state.

    /// A tracked resource standing in for a handle / event / OVERLAPPED box / buffer.
    struct TrackedResource {
        closes: std::rc::Rc<std::cell::Cell<u32>>,
    }
    impl Drop for TrackedResource {
        fn drop(&mut self) {
            self.closes.set(self.closes.get() + 1);
        }
    }

    /// The complete pending-operation ownership graph, exactly as quarantine must hold it.
    struct OwnedPendingIo {
        _handle: TrackedResource,
        _event: TrackedResource,
        _overlapped: TrackedResource,
        _buffer: TrackedResource,
    }

    /// A backend that owns the operation graph until it is transferred away.
    struct OwningBackend {
        io: Option<OwnedPendingIo>,
    }
    impl OwningBackend {
        /// Transfer moves the WHOLE graph out — the backend structurally cannot close it afterwards.
        fn transfer_to_quarantine(&mut self) -> OwnedPendingIo {
            self.io.take().expect("io present")
        }
    }

    /// A process-lifetime-style managed quarantine that outlives any backend.
    struct ManagedQuarantine {
        entries: Vec<(OwnedPendingIo, u32)>,
    }
    impl ManagedQuarantine {
        fn new() -> Self {
            Self {
                entries: Vec::new(),
            }
        }
        fn admit(&mut self, io: OwnedPendingIo) {
            self.entries.push((io, 0));
        }
        fn unresolved(&self) -> usize {
            self.entries.len()
        }
        /// A BOUNDED drain: at most `max_attempts` tries per entry; only CONFIRMED terminal entries are
        /// released (dropped exactly once), non-terminal entries stay owned.
        fn drain(&mut self, terminal: bool, max_attempts: u32) -> u32 {
            let mut attempts_used = 0;
            self.entries.retain_mut(|(_io, attempts)| {
                if *attempts >= max_attempts {
                    return true; // keep; never fabricate completion
                }
                *attempts += 1;
                attempts_used += 1;
                !terminal // retain unless a terminal result is confirmed
            });
            attempts_used
        }
    }

    #[test]
    fn backend_drop_cannot_release_quarantined_pending_io() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let mk = || TrackedResource {
            closes: closes.clone(),
        };
        let mut backend = OwningBackend {
            io: Some(OwnedPendingIo {
                _handle: mk(),
                _event: mk(),
                _overlapped: mk(),
                _buffer: mk(),
            }),
        };
        let mut quarantine = ManagedQuarantine::new();

        // Terminalization unconfirmed → the ENTIRE graph (handle, event, OVERLAPPED, buffer) transfers.
        quarantine.admit(backend.transfer_to_quarantine());
        assert!(backend.io.is_none(), "backend lost ownership of the handle");
        assert_eq!(quarantine.unresolved(), 1);

        // Destroying the ordinary backend must free NOTHING that Windows may still reference.
        drop(backend);
        assert_eq!(
            closes.get(),
            0,
            "backend Drop must not close the handle or drop the event/overlapped-storage/buffer"
        );

        // A bounded drain that cannot confirm a terminal state RETAINS the entry.
        let used = quarantine.drain(false, 3);
        assert_eq!(used, 1, "drain attempts are bounded");
        assert_eq!(quarantine.unresolved(), 1, "non-terminal entry stays owned");
        assert_eq!(closes.get(), 0, "nothing released while unconfirmed");

        // Only a CONFIRMED terminal result releases the graph — exactly once.
        quarantine.drain(true, 3);
        assert_eq!(quarantine.unresolved(), 0);
        assert_eq!(closes.get(), 4, "each owned resource released exactly once");
    }

    /// Poison-resilient lock: the SAME shape as the production
    /// `lock_managed_quarantine_recovering_poison` — poison is RECOVERED via `PoisonError::into_inner`,
    /// never `unwrap()`/`expect()`, so a poisoned registry can never deny access, look empty, or strand
    /// ownership in a droppable backend.
    fn lock_recovering<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        match m.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Poison a TEST-LOCAL mutex (never the process-global production registry) without emitting panic
    /// noise.
    fn poison<T>(m: &std::sync::Mutex<T>) {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = m.lock().expect("first lock succeeds");
            panic!("deliberately poison the test registry");
        }));
        std::panic::set_hook(prev);
        assert!(m.is_poisoned(), "test registry must be poisoned");
    }

    #[test]
    fn poisoned_registry_still_accepts_the_full_ownership_handoff() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        // A dedicated FIXED-CAPACITY test registry (the process-global production registry is untouched).
        let registry: std::sync::Mutex<TestRegistry> = std::sync::Mutex::new(TestRegistry::new());
        poison(&registry);

        let mut backend = OwningBackend {
            io: Some(tracked(&closes)),
        };

        // ORDER: lock (recovering poison) and reserve the slot via a PERMIT before extracting ownership.
        {
            let mut q = lock_recovering(&registry);
            let permit = q.acquire().expect("a free slot");
            let io = backend.transfer_to_quarantine();
            // Installing into the already-reserved slot is infallible — no early return in the gap.
            q.install(permit, io);
        }
        assert!(
            backend.io.is_none(),
            "poison must not leave ownership backend-local"
        );
        assert!(
            lock_recovering(&registry).outstanding(),
            "a poisoned registry is never treated as empty"
        );

        // The registry (and its entries) survive backend destruction; nothing is released.
        drop(backend);
        assert_eq!(
            closes.get(),
            0,
            "backend Drop after poisoned transfer releases nothing"
        );

        // Poisoned drain still retains a non-terminal entry...
        lock_recovering(&registry).drain(false);
        assert_eq!(lock_recovering(&registry).counts().2, 1);
        assert_eq!(closes.get(), 0);

        // ...and releases a confirmed-terminal entry exactly once.
        lock_recovering(&registry).drain(true);
        assert!(!lock_recovering(&registry).outstanding());
        assert_eq!(closes.get(), 4, "each owned resource released exactly once");
    }

    #[test]
    fn poison_recovery_preserves_existing_entries() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let registry: std::sync::Mutex<TestRegistry> = std::sync::Mutex::new(TestRegistry::new());
        {
            let mut q = lock_recovering(&registry);
            let permit = q.acquire().expect("a free slot");
            q.install(permit, tracked(&closes));
        }
        poison(&registry);
        // Recovery returns access to the entries that were already owned — never an empty view.
        assert_eq!(lock_recovering(&registry).counts().2, 1);
        assert_eq!(closes.get(), 0, "poison must not destroy owned resources");
    }

    // --- Fixed-capacity admission model (mirrors the production slot registry + permit) ---

    const TEST_CAPACITY: usize = 2;

    enum TestSlot {
        Empty,
        Reserved,
        Occupied(#[allow(dead_code)] OwnedPendingIo),
    }

    struct TestRegistry {
        slots: [TestSlot; TEST_CAPACITY],
    }

    /// Non-cloneable, non-copyable permit for exactly one slot (same shape as `QuarantinePermit`).
    struct TestPermit {
        slot: usize,
        armed: bool,
    }

    impl TestRegistry {
        fn new() -> Self {
            Self {
                slots: std::array::from_fn(|_| TestSlot::Empty),
            }
        }
        fn acquire(&mut self) -> Option<TestPermit> {
            for (i, s) in self.slots.iter_mut().enumerate() {
                if matches!(s, TestSlot::Empty) {
                    *s = TestSlot::Reserved;
                    return Some(TestPermit {
                        slot: i,
                        armed: false,
                    });
                }
            }
            None
        }
        fn install(&mut self, permit: TestPermit, io: OwnedPendingIo) {
            self.slots[permit.slot] = TestSlot::Occupied(io);
        }
        fn release(&mut self, permit: TestPermit) {
            if matches!(self.slots[permit.slot], TestSlot::Reserved) {
                self.slots[permit.slot] = TestSlot::Empty;
            }
        }
        /// Models the production `Drop for QuarantinePermit`: an ARMED (issued) permit must NOT return
        /// its slot, because Windows may still reference the operation's memory.
        fn drop_permit(&mut self, permit: TestPermit) {
            if permit.armed {
                return;
            }
            self.release(permit);
        }
        fn counts(&self) -> (usize, usize, usize) {
            let mut e = 0;
            let mut r = 0;
            let mut o = 0;
            for s in self.slots.iter() {
                match s {
                    TestSlot::Empty => e += 1,
                    TestSlot::Reserved => r += 1,
                    TestSlot::Occupied(_) => o += 1,
                }
            }
            (e, r, o)
        }
        fn outstanding(&self) -> bool {
            let (_, r, o) = self.counts();
            r != 0 || o != 0
        }
        /// Bounded drain: only CONFIRMED terminal occupied slots are released; Reserved is never touched.
        fn drain(&mut self, terminal: bool) {
            for s in self.slots.iter_mut() {
                if let TestSlot::Occupied(_) = s {
                    if terminal {
                        *s = TestSlot::Empty;
                    }
                }
            }
        }
    }

    fn tracked(closes: &std::rc::Rc<std::cell::Cell<u32>>) -> OwnedPendingIo {
        let mk = || TrackedResource {
            closes: closes.clone(),
        };
        OwnedPendingIo {
            _handle: mk(),
            _event: mk(),
            _overlapped: mk(),
            _buffer: mk(),
        }
    }

    #[test]
    fn capacity_is_fixed_and_accounting_invariant_holds() {
        let reg = TestRegistry::new();
        let (e, r, o) = reg.counts();
        assert_eq!(
            e + r + o,
            TEST_CAPACITY,
            "empty + reserved + occupied == capacity"
        );
        assert_eq!(reg.slots.len(), TEST_CAPACITY, "capacity cannot grow");
    }

    #[test]
    fn capacity_exhaustion_refuses_the_next_operation_without_issuing_io() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let mut reg = TestRegistry::new();
        // A fake "issue counter" proves no Windows call would be made without a permit.
        let mut issued = 0;

        // Fill every slot with an unresolved (occupied) operation.
        for _ in 0..TEST_CAPACITY {
            let permit = reg.acquire().expect("free slot");
            issued += 1;
            reg.install(permit, tracked(&closes));
        }
        let (e, _r, o) = reg.counts();
        assert_eq!((e, o), (0, TEST_CAPACITY));

        // The next admission fails -> the operation is NEVER issued and nothing is evicted/overwritten.
        match reg.acquire() {
            Some(_) => panic!("capacity must be exhausted"),
            None => { /* QuarantineCapacityUnavailable */ }
        }
        assert_eq!(
            issued, TEST_CAPACITY,
            "no Windows call issued without a permit"
        );
        assert_eq!(
            reg.counts().2,
            TEST_CAPACITY,
            "no entry evicted or overwritten"
        );
        assert_eq!(
            closes.get(),
            0,
            "no quarantined resource released by exhaustion"
        );

        // The capacity-exhausted classification is fail-closed and non-retryable.
        assert!(IpcFailure::QuarantineCapacityUnavailable.is_non_retryable());
    }

    #[test]
    fn permit_lifecycle_reserves_then_releases_or_is_consumed() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let mut reg = TestRegistry::new();

        // Reserve -> Reserved (outstanding, so no clean classification is possible).
        let permit = reg.acquire().expect("slot");
        assert_eq!(reg.counts(), (TEST_CAPACITY - 1, 1, 0));
        assert!(reg.outstanding(), "a Reserved slot is outstanding");

        // Normal terminal completion returns the slot.
        reg.release(permit);
        assert_eq!(reg.counts(), (TEST_CAPACITY, 0, 0));
        assert!(!reg.outstanding());

        // Unconfirmed terminalization consumes the permit into Occupied.
        let permit = reg.acquire().expect("slot");
        reg.install(permit, tracked(&closes));
        assert_eq!(reg.counts(), (TEST_CAPACITY - 1, 0, 1));
        assert!(reg.outstanding());

        // An occupied slot cannot be reserved again: only the remaining empty slot is available.
        let p2 = reg.acquire().expect("the other slot");
        assert_eq!(p2.slot, 1, "a distinct slot is handed out");
        assert!(reg.acquire().is_none(), "no third slot exists");
        reg.release(p2);

        // Non-terminal drain retains; terminal drain releases exactly once.
        reg.drain(false);
        assert_eq!(reg.counts().2, 1);
        assert_eq!(closes.get(), 0);
        reg.drain(true);
        assert_eq!(reg.counts(), (TEST_CAPACITY, 0, 0));
        assert_eq!(closes.get(), 4, "each owned resource released exactly once");
    }

    #[test]
    fn an_armed_permit_never_returns_its_slot_on_drop() {
        // Mirrors the production Drop rule: once the operation is ISSUED, dropping the permit must not
        // free the reservation (Windows may still reference the operation's memory).
        let mut reg = TestRegistry::new();
        let mut permit = reg.acquire().expect("slot");
        permit.armed = true; // IssuedPending
        let slot = permit.slot;
        reg.drop_permit(permit);
        // The production Drop returns early when armed, so the slot stays Reserved.
        assert!(
            matches!(reg.slots[slot], TestSlot::Reserved),
            "an issued (armed) permit leaves the slot Reserved"
        );
        assert!(
            reg.outstanding(),
            "reservation still forbids a clean classification"
        );
    }

    // --- Issued-operation unwind-safety model (mirrors `IssuedPendingOperation`) ---

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum TestIssueState {
        ReservedNotIssued,
        IssuedPending,
        TerminalConfirmed,
        InstalledInQuarantine,
    }

    /// Owns the COMPLETE graph after the issue point, exactly like the production guard: permit + the
    /// pending resources. Its Drop performs the quarantine handoff instead of releasing anything.
    struct TestIssuedOp<'a> {
        state: TestIssueState,
        permit: Option<TestPermit>,
        io: Option<OwnedPendingIo>,
        registry: &'a std::sync::Mutex<TestRegistry>,
    }

    impl<'a> TestIssuedOp<'a> {
        fn new(
            registry: &'a std::sync::Mutex<TestRegistry>,
            permit: TestPermit,
            io: OwnedPendingIo,
        ) -> Self {
            Self {
                state: TestIssueState::ReservedNotIssued,
                permit: Some(permit),
                io: Some(io),
                registry,
            }
        }
        fn mark_issued(&mut self) {
            self.state = TestIssueState::IssuedPending;
            if let Some(p) = self.permit.as_mut() {
                p.armed = true;
            }
        }
        fn finish_terminal(&mut self) {
            self.state = TestIssueState::TerminalConfirmed;
            if let Some(p) = self.permit.take() {
                lock_recovering(self.registry).release(p);
            }
            // `io` drops here — the operation reached a confirmed terminal state.
            self.io.take();
        }
        fn install_into_quarantine(&mut self) {
            if let (Some(permit), Some(io)) = (self.permit.take(), self.io.take()) {
                lock_recovering(self.registry).install(permit, io);
            }
            self.state = TestIssueState::InstalledInQuarantine;
        }
    }

    impl Drop for TestIssuedOp<'_> {
        fn drop(&mut self) {
            if self.state != TestIssueState::IssuedPending {
                return;
            }
            // Post-issue unwind: hand the WHOLE graph off; release nothing.
            self.install_into_quarantine();
        }
    }

    #[test]
    fn pre_issue_drop_returns_the_slot_but_post_issue_drop_installs_quarantine() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let registry = std::sync::Mutex::new(TestRegistry::new());

        // PRE-ISSUE drop: the permit was never armed, so the slot returns to Empty and the (not yet
        // issued) resources are released normally.
        {
            let permit = lock_recovering(&registry).acquire().expect("slot");
            let guard = TestIssuedOp::new(&registry, permit, tracked(&closes));
            drop(guard);
        }
        // The unarmed permit is returned by the model's drop_permit rule.
        {
            let mut reg = lock_recovering(&registry);
            // Simulate the unarmed-permit Drop returning the slot.
            for s in reg.slots.iter_mut() {
                if matches!(s, TestSlot::Reserved) {
                    *s = TestSlot::Empty;
                }
            }
        }
        assert_eq!(lock_recovering(&registry).counts().0, TEST_CAPACITY);

        // POST-ISSUE unwind: nothing is released; the whole graph lands in Occupied.
        let before = closes.get();
        {
            let permit = lock_recovering(&registry).acquire().expect("slot");
            let mut guard = TestIssuedOp::new(&registry, permit, tracked(&closes));
            guard.mark_issued();
            // Simulated panic/unwind: the guard is dropped without an explicit resolution.
            drop(guard);
        }
        assert_eq!(
            closes.get(),
            before,
            "post-issue unwind releases zero resources immediately"
        );
        assert_eq!(
            lock_recovering(&registry).counts().2,
            1,
            "post-issue Drop installs the graph into Occupied"
        );
        assert!(lock_recovering(&registry).outstanding());

        // The installed entry still owns handle/event/overlapped-storage/buffer: a confirmed terminal
        // drain releases all four exactly once.
        lock_recovering(&registry).drain(false);
        assert_eq!(
            closes.get(),
            before,
            "non-terminal drain retains everything"
        );
        lock_recovering(&registry).drain(true);
        assert_eq!(
            closes.get(),
            before + 4,
            "each owned resource released exactly once"
        );
    }

    #[test]
    fn post_issue_unwind_under_a_poisoned_registry_still_installs_quarantine() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let registry = std::sync::Mutex::new(TestRegistry::new());
        let permit = lock_recovering(&registry).acquire().expect("slot");
        poison(&registry);

        {
            let mut guard = TestIssuedOp::new(&registry, permit, tracked(&closes));
            guard.mark_issued();
            drop(guard); // simulated post-issue unwind while the registry is poisoned
        }
        assert_eq!(closes.get(), 0, "poisoned handoff releases nothing");
        assert_eq!(
            lock_recovering(&registry).counts().2,
            1,
            "poison recovery still installs Occupied"
        );
    }

    #[test]
    fn terminal_completion_releases_permit_and_resources_once() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let registry = std::sync::Mutex::new(TestRegistry::new());
        let permit = lock_recovering(&registry).acquire().expect("slot");
        let mut guard = TestIssuedOp::new(&registry, permit, tracked(&closes));
        guard.mark_issued();
        guard.finish_terminal();
        drop(guard);
        assert_eq!(
            lock_recovering(&registry).counts(),
            (TEST_CAPACITY, 0, 0),
            "terminal completion returns the slot"
        );
        assert_eq!(closes.get(), 4, "resources released exactly once");
    }

    #[test]
    fn reserved_or_occupied_forbids_zero_residue_and_clean_shutdown() {
        // The safe adapter refuses both whenever the backend reports outstanding quarantine state.
        let a = adapter(FakeIpcBackend {
            quarantined: true, // stands for "any Reserved or Occupied slot"
            shutdown: IpcShutdownResult::CleanShutdown,
            residue: IpcResidue::Zero,
            ..Default::default()
        });
        assert!(!a.confirm_shutdown_logic());
        assert_eq!(a.close_and_classify_residue_logic(), IpcResidue::NonZero);
    }

    #[test]
    fn drain_attempt_count_is_bounded_and_never_fabricates_completion() {
        let closes = std::rc::Rc::new(std::cell::Cell::new(0));
        let mk = || TrackedResource {
            closes: closes.clone(),
        };
        let mut quarantine = ManagedQuarantine::new();
        quarantine.admit(OwnedPendingIo {
            _handle: mk(),
            _event: mk(),
            _overlapped: mk(),
            _buffer: mk(),
        });
        // Repeated non-terminal drains stop consuming attempts at the ceiling and never release.
        for _ in 0..10 {
            quarantine.drain(false, 3);
        }
        assert_eq!(quarantine.unresolved(), 1);
        assert_eq!(closes.get(), 0);
    }

    #[test]
    fn wait_policy_is_bounded() {
        let a = adapter(FakeIpcBackend::default());
        assert!(a.wait_policy().max_attempts() <= crate::verification::MAX_ATTEMPTS_CEILING);
    }
}
