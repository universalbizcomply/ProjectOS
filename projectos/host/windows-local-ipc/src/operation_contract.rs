//! The PROTECTED-OPERATION contract — PROJECTOSHOST-IPC-OPERATION-CONTRACT1A (F2/F3 phase 1).
//!
//! Types and validation only. This module adds NO transport, opens NO channel, dispatches NO effect and
//! touches NO credential. It exists so that later phases have a boundary to authenticate against.
//!
//! ## The three-layer separation this module exists to enforce
//!
//! 1. [`ProtectedOperationRequest`] — the UNTRUSTED wire DTO. Everything in it is a *claim* made by a
//!    caller. Parsing it proves only that bytes were well formed.
//! 2. [`TrustedPeerContext`] — evidence that a peer was admitted for a HOST-ISSUED connection. It
//!    carries NO identity: peer identity is owned end-to-end by the canonical identity-proof crate's
//!    bounded attempt and never crosses into this crate. **The default graph has no constructor for
//!    it at all**; the one production mint reads a sealed canonical `VerifiedPeerAdmission` and is
//!    feature-gated with the attempt that produces it.
//! 3. [`AuthorisedProtectedOperation`] — minted ONLY by [`evaluate_protected_operation`], and only
//!    when EVERY sealed rung agrees: request-scoped C4 from a verified owner programme delegation,
//!    a trusted peer context, the current service instance, the Host's own binding of the exact
//!    subject and parameters, and a genuine canonical admission for this correlation and sequence
//!    on that peer's connection (RUN-TO-COMPLETION HOST ATTESTATION §9C). It is admission, not
//!    execution: it says this exact independent gatekeeper review MAY run, never that it ran.
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
//! There is deliberately no constructor, feature flag or test hook in this crate that produces a
//! closed gate, and that has not changed.
//!
//! What HAS changed is that the gate is no longer the only way owner presence can be established.
//! [`OperationClass::IndependentGatekeeperReview`] — and no other class — may additionally satisfy
//! C4 for ONE request, via a [`RequestScopedOwnerPresence`] derived from an exact owner programme
//! delegation the host validated for itself (see [`satisfy_c4_for_gatekeeper_request`]). That
//! presence is sealed, carries the correlation and class it was minted for, and is re-checked
//! against both inside [`evaluate_protected_operation`], so it cannot be reused for a second request
//! or presented for a different operation.
//!
//! For every other class the answer is still [`RejectionReason::OwnerPresenceGateOpen`], and a
//! request that arrives without a validated delegation is refused exactly as it was before. The
//! distinction this module now draws is between "C4 is closed" — which remains false — and "owner
//! presence was proven for this one review", which is what a delegation actually says.

use crate::protocol::{
    parse_single_frame, write_frame_header, FrameParseError, MessageKind, Nonce, HEADER_LEN,
    PROTECTED_OPERATION_REQUEST_LEN, PROTECTED_OPERATION_RESPONSE_LEN,
};
use projectos_host_core::AdmittedRequest;
use sha2::{Digest, Sha256};

/// Bounded correlation identity. Fixed width: a correlation is an opaque tag, never a message.
pub const CORRELATION_LEN: usize = 16;
/// Bounded reference to an owner-approval record. A REFERENCE, never approval material itself.
pub const APPROVAL_REF_LEN: usize = 32;
// `SESSION_REF_LEN` / `client_session_ref` were GOVERNED-REMOVED in RUN-TO-COMPLETION HOST
// ATTESTATION §9C. See the note on `ProtectedOperationRequest`.
/// A SHA-256 binding digest. The HOST computes one over the facts it resolved for a request
/// (see [`binding_digest`]) and compares it against the one the caller claimed on the wire.
pub const BINDING_DIGEST_LEN: usize = 32;

/// The correlation on the authority wire and the correlation the canonical session admits are the
/// SAME tag. Pinned at compile time so the two crates cannot drift apart silently.
const _: () = assert!(CORRELATION_LEN == projectos_host_core::REQUEST_CORRELATION_LEN);

/// The domain tag prefixed to every Host binding subject before it is hashed.
///
/// DOMAIN SEPARATION. The owner's key signs the trust manifest (JSON, begins with `{`) and the
/// programme delegation (its own tag); the phase-definition digest in `core` has its own. This
/// subject is a NEW cryptographic subject, so it gets a new tag that none of those bytes can begin
/// with, and a schema version INSIDE the hashed bytes so a future layout cannot reinterpret an old
/// digest.
pub const BINDING_DIGEST_DOMAIN: &[u8; 33] = b"projectos.host-request-binding.v1";

/// The schema version hashed into every binding subject.
pub const BINDING_DIGEST_SCHEMA_VERSION: u32 = 1;
/// Bounded reference to host-side evidence produced by a completed operation.
pub const EVIDENCE_REF_LEN: usize = 16;

/// Private seal. A type carrying this cannot be constructed outside this module, so no downstream
/// crate can fabricate a trusted value by writing a struct literal.
mod sealed {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Seal;
}

/// RUN-TO-COMPLETION HOST ATTESTATION §10A — THE HOST'S OWN PRODUCTION COMPOSITION.
///
/// A CHILD MODULE, DELIBERATELY. Composition must build a [`HostResolvedRequestFacts`], and the only
/// way to do that without a PUBLIC constructor is from inside this module's own subtree: Rust makes
/// private fields and the private [`sealed::Seal`] visible to descendants and to nobody else. So the
/// production route to facts is not `pub`, not `pub(crate)` and not reachable by any other module in
/// this crate — it is a private function in the child below, and running the composition's ordered
/// pass is the only way to reach it.
pub mod host_composition;

/// RUN-TO-COMPLETION HOST ATTESTATION §10C — THE HOST'S OWN DURABLE REQUEST-REPLAY HISTORY.
///
/// A CHILD MODULE FOR THE SAME REASON [`host_composition`] is one. The governed request identity is
/// derived from the Host's SEALED [`HostResolvedRequestFacts`] — its binding subject and its
/// parameter digest — and reading those without a public accessor is only possible from inside this
/// module's own subtree. Putting the replay history in a sibling module would have meant widening
/// the closed §9B facts type with public getters purely so persistence could reach it, which is the
/// kind of change §10C is explicitly not allowed to make.
///
/// IT CHANGES NOTHING ABOVE IT. This declaration is the only edit §10C makes to this file: no
/// authority type, no mint, no refusal variant, no evaluation order and no wire shape moves.
pub mod request_replay;
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
    /// ONE ProjectOS-governed independent review, executed under an exact owner programme delegation.
    ///
    /// WHAT IT IS NOT, and the name is chosen to make each of these unsayable: it is not a generic
    /// provider call, not generic HTTP, not "run the broker", not "execute a command", and not an
    /// arbitrary AI request. It names one thing — an independent review of a governed candidate — and
    /// a host that only knows how to do that cannot be talked into doing anything else.
    ///
    /// It is also the ONLY class for which C4 can be satisfied, and only per request. See
    /// [`satisfy_c4_for_gatekeeper_request`]. The other two classes keep the unconditional hard stop.
    ///
    /// Added for RUN-TO-COMPLETION HOST ATTESTATION — IPC / C4 INTEGRATION.
    IndependentGatekeeperReview,
}

impl OperationClass {
    /// The fixed wire discriminant.
    #[must_use]
    pub fn discriminant(self) -> u8 {
        match self {
            Self::ProviderIdentityRead => 1,
            Self::StagingRead => 2,
            Self::IndependentGatekeeperReview => 3,
        }
    }

    /// Decode a wire discriminant. Unknown fails closed.
    #[must_use]
    pub fn from_discriminant(value: u8) -> Option<Self> {
        Some(match value {
            1 => Self::ProviderIdentityRead,
            2 => Self::StagingRead,
            3 => Self::IndependentGatekeeperReview,
            _ => return None,
        })
    }

    /// Whether an owner PROGRAMME delegation may ever satisfy C4 for this class.
    ///
    /// Exactly one class, checked as a value rather than assumed by the caller. A delegation that
    /// somehow named another class must not be able to open the gate for it — which is the whole
    /// difference between "C4 can be closed for a gatekeeper review" and "C4 can be closed".
    #[must_use]
    pub const fn may_be_delegated_by_programme(self) -> bool {
        matches!(self, Self::IndependentGatekeeperReview)
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
///
/// ## `client_session_ref` — GOVERNED-REMOVED (RUN-TO-COMPLETION HOST ATTESTATION §9C)
///
/// The wire used to carry a 16-byte "client session reference", documented as evidence only and
/// never read by any gate. Once authority became reachable, an ignored caller-controlled field on
/// the successful path is not acceptable, so its meaning had to be settled first. Under the
/// accepted architecture it has none: the canonical session is established by the HOST
/// (`BoundIpcSession`, whose digest is host-private), peer identity never crosses into this crate,
/// and this request's membership in that session is already proven by the sealed `AdmittedRequest`
/// on the peer's host-issued connection and handshake generation. A caller-supplied reference could
/// only be compared against a value the caller cannot legitimately know (circular if it could), and
/// it duplicated exactly the identity channel the peer-contract reconciliation retired. It was
/// therefore removed from the authority-bearing contract rather than fake-bound: the frame is 16
/// bytes shorter, still fixed-width and deterministic, and the layout is pinned by the tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedOperationRequest {
    correlation: [u8; CORRELATION_LEN],
    sequence: u64,
    claimed_service_epoch: u64,
    binding_digest: [u8; BINDING_DIGEST_LEN],
    operation: OperationClass,
    approval_ref: [u8; APPROVAL_REF_LEN],
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
        parameter_digest: [u8; BINDING_DIGEST_LEN],
    ) -> Self {
        Self {
            correlation,
            sequence,
            claimed_service_epoch,
            binding_digest,
            operation,
            approval_ref,
            parameter_digest,
        }
    }

    /// The caller's correlation tag (claim).
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }

    /// The caller's sequence (claim). Compared against the sequence the canonical session ADMITTED
    /// for this correlation; a disagreement is [`RejectionReason::SequenceRefused`].
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// The service epoch the caller CLAIMS to be addressing. Never trusted; compared host-side.
    #[must_use]
    pub fn claimed_service_epoch(&self) -> u64 {
        self.claimed_service_epoch
    }

    /// The binding digest the caller CLAIMS: what it believes this request is about. The host does
    /// not read the subject out of it - it resolves the subject for itself, hashes that with
    /// [`binding_digest`], and refuses on disagreement. A caller may state a digest; it never
    /// decides what the digest means.
    #[must_use]
    pub fn binding_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.binding_digest
    }

    /// The requested operation class.
    #[must_use]
    pub fn operation(&self) -> OperationClass {
        self.operation
    }

    /// A REFERENCE to an owner-approval record. Not approval, and never usable as one. For a
    /// gatekeeper review it must NAME the verified delegation (its `delegation_id`); naming any other
    /// record is [`RejectionReason::BindingMismatch`].
    #[must_use]
    pub fn approval_ref(&self) -> &[u8; APPROVAL_REF_LEN] {
        &self.approval_ref
    }

    /// The caller's CLAIM about the exact review request body. Its meaning is fixed by the
    /// gatekeeper inbox contract: the Host reads the request body for this correlation ONE-SHOT from
    /// its own inbox by trusted identity, and the digest of those exact bytes is a host-resolved
    /// fact. This claim must equal that fact ([`RejectionReason::BindingMismatch`] otherwise), so a
    /// caller cannot be authorised for one body and have the Host act on another. Never a body,
    /// never a parameter value: 32 bytes naming bytes the Host already holds.
    #[must_use]
    pub fn parameter_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.parameter_digest
    }
}

// -------------------------------------------------------------------------------------------------
// LAYER 2 — TRUSTED PEER CONTEXT (no production constructor)
//
// PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A retired this crate's duplicate peer-identity model.
//
// The accepted production architecture (PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A) makes the canonical
// identity-proof crate the SOLE owner of peer identity: raw process and token identity is read only
// there, exact user and session identity is opaque and owned by a bounded attempt, and no reusable
// identity contribution ever crosses into this crate. A second identity model here would be duplicate
// and contradictory vocabulary, so it is gone rather than merely deprecated.
//
// REMOVED, with no replacement and no successor in this crate: raw fixed-size SID storage, raw Windows
// session identity, bounded integrity levels, an observed-evidence input model, peer classification,
// peer-authentication errors, and both authentication entry points. Nothing here reads, stores,
// compares or classifies identity.
//
// WHAT REMAINS is deliberately minimal and carries NO identity: a sealed marker recording that a peer
// was admitted for a HOST-ISSUED connection. It exists because [`evaluate_protected_operation`] must be
// able to distinguish "no peer" from "a peer", and because layer 3 is defined in terms of it.
//
// THERE IS NO PRODUCTION CONSTRUCTOR. Not public, not `pub(crate)`, not behind a feature — the only one
// is `cfg(test)`, so in every shipped graph `evaluate_protected_operation` can only ever be passed
// `None`. Minting a real context from a canonical attempt outcome is PHASE 4 and is not implemented,
// claimed or stubbed here.
// -------------------------------------------------------------------------------------------------

/// Evidence that a peer was admitted for one HOST-ISSUED connection.
///
/// Carries only the two identifiers the HOST issued — never anything the peer sent, and never any
/// identity. There is no SID, no session, no process, no integrity level and no classification here,
/// because those belong to the canonical identity-proof crate's attempt and never leave it.
///
/// Sealed, so no downstream crate can fabricate one with a struct literal, and with no production
/// constructor, so no shipped code path can produce one at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedPeerContext {
    _seal: Seal,
    /// Host-issued connection identity. Never supplied by the peer.
    connection_id: u64,
    /// Host-issued handshake generation. Never supplied by the peer.
    handshake_generation: u64,
}

impl TrustedPeerContext {
    /// TEST-ONLY. `cfg(test)` and private, so it exists in NO shipped graph — not the default build and
    /// not the non-default fixture build — and cannot be reached by any caller in any crate.
    ///
    /// It exists solely so the C4 hard stop can be exercised with a peer PRESENT, which is a strictly
    /// stronger test than exercising it with `None`.
    #[cfg(test)]
    fn for_admitted_connection(connection_id: u64, handshake_generation: u64) -> Self {
        Self {
            _seal: Seal,
            connection_id,
            handshake_generation,
        }
    }

    /// THE PRODUCTION MINT: one admitted peer, from the canonical identity proof.
    ///
    /// ## What it consumes, and why nothing weaker would do
    ///
    /// It takes a sealed `VerifiedPeerAdmission`, which only a COMPLETED canonical attempt can
    /// produce — a real OS-derived peer observation with agreeing SCM observations either side of
    /// it, inside the bounded window, finalised as a match for exactly the host-issued connection
    /// and handshake generation it carries.
    ///
    /// Every weaker shape was available and every one of them is a way to fake a peer:
    ///
    /// * `new(connection_id, handshake_generation)` — the caller states who the peer is.
    /// * `verified(bool)` — the caller states that somebody checked.
    /// * `from_match(ServiceInstanceBinding)` — the caller writes down the enum variant that means
    ///   success. A verdict is a description, and descriptions are constructible.
    ///
    /// None of those is implemented and none should be. The identifiers below are READ OFF the
    /// admission rather than accepted alongside it, so there is no argument through which a caller
    /// could pair a genuine admission with a different connection.
    ///
    /// ## What it is still not
    ///
    /// Being an admitted peer is not permission to do anything. This context satisfies exactly one
    /// gate in [`evaluate_protected_operation`] — that a peer was authenticated at all — and every
    /// other gate stands untouched in front of any effect.
    ///
    /// Gated with the attempt typestate it consumes, so a default build has neither.
    #[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
    #[must_use]
    pub fn from_verified_peer_admission(
        admission: &projectos_host_windows_service_identity_proof::VerifiedPeerAdmission,
    ) -> Self {
        Self {
            _seal: Seal,
            connection_id: admission.connection_id(),
            handshake_generation: admission.handshake_generation(),
        }
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

    /// Whether this context belongs to exactly the given host-issued connection and generation.
    ///
    /// Both must match. A context admitted for one connection is therefore not interchangeable with
    /// another, and a context from an earlier handshake generation cannot satisfy a later one.
    #[must_use]
    pub fn is_bound_to(&self, connection_id: u64, handshake_generation: u64) -> bool {
        self.connection_id == connection_id && self.handshake_generation == handshake_generation
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
// REQUEST-SCOPED C4 — the owner PROGRAMME delegation path
//
// RUN-TO-COMPLETION HOST ATTESTATION — C4 AUTHORITY BOUNDARY.
//
// WHAT THIS IS NOT. It is not a way to close C4. `OwnerPresenceGate` is untouched, still has one
// variant, and still returns `false` from `is_closed()` — every other protected operation keeps the
// unconditional hard stop it has today, and nothing here can change that.
//
// WHAT IT IS. A second, narrower route to owner presence for exactly one operation class, satisfied
// for exactly one request, derived from an owner programme delegation whose provenance the host
// verified. There is no configuration, no feature flag, no CLI flag, and no literal phrase whose
// possession is sufficient: a phrase can only ever be the human transcription that PRODUCES a durable
// delegation record, and it is the VERIFIED record that carries runtime authority. Replaying the
// words grants nothing.
//
// THE AUTHORITY LADDER, AND WHY EACH RUNG EXISTS.
//
//   OwnerProgrammeDelegation              a CLAIM. Caller-constructible on purpose — it is a parsed
//                                         record, and parsing proves only that bytes were well formed.
//                                         Alone it satisfies nothing.
//        ↓  host-verified provenance
//   VerifiedOwnerProgrammeDelegation      SEALED. No public constructor. This is the rung that makes
//                                         a delegation Murad's rather than merely a file saying so.
//        ↓  requires the sealed delegation
//   HostResolvedRequestFacts              SEALED. Constructible only while holding a verified
//                                         delegation, so fabricated facts mint nothing on their own.
//        ↓  request-scoped evaluation
//   RequestScopedOwnerPresence            SEALED and crate-private. Never named outside this crate.
//        ↓
//   evaluate_protected_operation
//
// A downstream crate can build the first rung and nothing above it. That is the property: an
// untrusted DTO is constructible, authority is not.
// -------------------------------------------------------------------------------------------------

/// Bounded length of an identity or record digest carried in these facts.
pub const DELEGATION_DIGEST_LEN: usize = 32;

/// The most phases one delegation may cover.
pub const MAX_DELEGATED_PHASES: usize = 32;

/// The owner's durable Run-to-Completion delegation, AS PARSED. **This is a claim, not authority.**
///
/// Public and caller-constructible deliberately: it is the untrusted DTO rung of the ladder above,
/// exactly as [`ProtectedOperationRequest`] is for the wire. Holding one grants nothing —
/// [`satisfy_c4_for_gatekeeper_request`] cannot be reached with it, because that function takes the
/// SEALED [`VerifiedOwnerProgrammeDelegation`] instead.
///
/// EVERY FIELD IS A BOUND, NOT A HINT. A delegation that names a plan is not a delegation to review
/// whatever the caller asks about; it authorises this programme, this plan at this digest, these
/// phases, this operation, this credential purpose, up to this ceiling, until it expires.
///
/// WHAT IT CAN NEVER IMPLY, and none of it is representable here: production deployment, database
/// mutation, destructive database action, real email or SMS, payment or refund, signing or any
/// private-key operation, material credential modification, force push or history rewrite, a
/// commercial or scope decision, a constitutional or governance change, or acceptance of an
/// unresolved CRITICAL or HIGH finding. There is no field through which any of those could arrive,
/// which is a stronger statement than a list of things this code promises not to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerProgrammeDelegation {
    /// Digest of the delegation record itself — its identity, and what an attestation cites.
    pub delegation_id: [u8; DELEGATION_DIGEST_LEN],
    /// Digest of the owner identity the record names. A NAME, never a proof: see
    /// [`VerifiedOwnerProgrammeDelegation`] for what actually makes this delegation the owner's.
    pub owner: [u8; DELEGATION_DIGEST_LEN],
    /// Digest of the project id this delegation is for.
    pub project: [u8; DELEGATION_DIGEST_LEN],
    /// Digest of the canonical repository identity (`host/owner/name`), so a project id alone cannot
    /// impersonate another checkout.
    pub repository: [u8; DELEGATION_DIGEST_LEN],
    /// Digest of the exact plan id.
    pub plan: [u8; DELEGATION_DIGEST_LEN],
    /// The exact plan digest. A delegation follows one plan, not a plan name that can be re-authored.
    pub plan_digest: [u8; DELEGATION_DIGEST_LEN],
    /// Digests of the phase ids this delegation covers. Bounded: a delegation that could name
    /// unlimited phases is a programme-wide delegation wearing a phase list.
    pub allowed_phases: [[u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES],
    /// How many entries of `allowed_phases` are real. Beyond this the array is padding.
    pub allowed_phase_count: u8,
    /// The ONE operation class this delegation may satisfy C4 for.
    pub operation: OperationClass,
    /// Digest of the allowed provider/model policy identity.
    pub model_policy: [u8; DELEGATION_DIGEST_LEN],
    /// Digest of the allowed credential reference/purpose. Never a credential, never a value.
    pub credential_ref: [u8; DELEGATION_DIGEST_LEN],
    /// Ceiling in micro-USD for the programme this delegation covers.
    pub budget_ceiling_micro_usd: u64,
    /// Expiry as a Unix epoch in seconds. Compared against the host's own clock, never a caller's.
    pub expires_at_epoch_s: u64,
    /// Whether the host observed this delegation as completed or revoked. Either ends it.
    pub revoked_or_completed: bool,
}

/// A delegation whose PROVENANCE the host established — the rung that makes it the owner's.
///
/// SEALED. No public constructor, no `Default`, no `From`, no serde. A downstream crate can hold one
/// and read nothing forgeable out of it, and cannot make one.
///
/// ## What mints this in production — and why it is a SIGNATURE, not a live presence
///
/// THIS SECTION PREVIOUSLY SAID THE MINT WAS DELIBERATELY ABSENT. It no longer is, and leaving that
/// prose in place would have been the most misleading kind of stale comment: a reader would have
/// concluded the type was still unreachable.
///
/// The route it described consumed an owned `projectos_host_core::owner_presence::VerifiedOwnerPresence`,
/// obtainable in production only through `verify_production_owner_presence` — a single-use grant from
/// the sealed `ProductionOwnerPresenceCapability`, ultimately a `VerifiedWindowsOwnerEvidence` digest
/// produced by an INTERACTIVE Windows owner-verification ceremony. That is the right answer to "is
/// Murad here now?" and the wrong one for Run-to-Completion, which exists for when he is not. It is
/// unchanged, unweakened, and still required wherever live presence is what matters.
///
/// The production mint is therefore [`crate::owner_programme_delegation::verify_owner_programme_delegation`],
/// which answers the OTHER question: did Murad, at some earlier moment, sign exactly this bounded
/// programme? The fact that makes the delegation his is an ECDSA-P256 signature over a
/// domain-separated canonical record, checked against the SAME embedded owner anchor the packaged
/// trust manifest uses. It is still not `delegation.owner`, and still not that an agent wrote a
/// record saying so — the agent cannot manufacture a signature any more than it can manufacture a
/// presence.
/// `PartialEq`/`Eq` compare the delegation a token carries; they mint nothing and are not a
/// construction route, exactly as they are not for [`HostResolvedRequestFacts`]. Deliberately NOT
/// `Clone`: a verified delegation is obtained by verifying, not by copying one somebody else holds.
#[derive(Debug, PartialEq, Eq)]
pub struct VerifiedOwnerProgrammeDelegation {
    _seal: Seal,
    delegation: OwnerProgrammeDelegation,
}

impl VerifiedOwnerProgrammeDelegation {
    /// TEST-ONLY. `cfg(test)` and private, so it exists in NO shipped graph — not the default build
    /// and not the non-default fixture build — and cannot be reached by any caller in any crate.
    ///
    /// It exists solely so the request-scoped C4 path can be exercised with a delegation PRESENT,
    /// which is a strictly stronger test than exercising it with `None`. It mints no owner presence
    /// of its own: everything below still has to agree.
    #[cfg(test)]
    fn for_test(delegation: OwnerProgrammeDelegation) -> Self {
        Self {
            _seal: Seal,
            delegation,
        }
    }

    /// THE PRODUCTION MINT, crate-private.
    ///
    /// Crate-visible, with exactly one call site: [`crate::owner_programme_delegation`], after that
    /// module has established the owner's signature over the domain-separated canonical subject and
    /// checked the delegation against this installation's programme and the host's clock.
    ///
    /// `pub(crate)` RATHER THAN SOMETHING TIGHTER, and the reason is Rust's, not a choice:
    /// `pub(in ...)` accepts only an ANCESTOR module, and the one legitimate caller is a SIBLING of
    /// this one, so it cannot be named. The narrowest expressible visibility is therefore the crate,
    /// and the guarantee that matters is unaffected — a downstream crate can hold one of these and
    /// can never make one.
    ///
    /// The seal is what makes that true rather than merely intended — this function is the only
    /// place outside the test constructor where `Seal` is applied to a delegation.
    pub(crate) fn from_verified_owner_signature(delegation: OwnerProgrammeDelegation) -> Self {
        Self {
            _seal: Seal,
            delegation,
        }
    }

    /// The delegation whose provenance was verified. Read-only; the fields are a copy of the record,
    /// and holding this reference confers nothing beyond reading it.
    #[must_use]
    pub fn delegation(&self) -> &OwnerProgrammeDelegation {
        &self.delegation
    }
}

/// What the HOST independently resolved about this request — never what the caller said about it.
///
/// SEALED. Private fields, no `Default`, no `From`, no serde. The caller's frame carries digests;
/// these are the values the host derived for itself, and the host hashes THESE into the binding
/// digest it compares the caller's claim against. Any disagreement is a refusal.
///
/// ## Where each fact must come from, and why there is no production mint in this checkpoint
///
/// RUN-TO-COMPLETION HOST ATTESTATION — HOST-RESOLVED BINDING AUTHORITY. The constructor used to
/// take a plain struct with public fields, and in a composition crate this compiled silently:
///
/// ```text
/// HostResolvedFacts { project: delegation.project, plan: delegation.plan, .. }   // "resolved"
/// ```
///
/// Facts copied out of the record under test agree with the record under test. That constructor
/// is gone from every shipped graph. The facts a production mint must READ OFF sealed, host-owned
/// sources — and each source is named here so the wiring rung cannot quietly substitute a claim:
///
/// * `project`, `repository` — the sealed [`crate::owner_programme_delegation::ExpectedProgramme`]
///   (the installation's own programme).
/// * `plan`, `plan_digest`, `phase` — the Host's validated approved-plan authority
///   (`projectos_host_core::ValidatedApprovedPlan` and its phase-definition digest), never a plan
///   name the request mentions.
/// * `candidate_digest` — the EXACT review candidate: the committed-byte reader's digest of the
///   bytes at an immutable commit. Not a path, not a branch, not `HEAD`, not caller bytes.
/// * `parameter_digest` — the digest of the exact request body the Host read ONE-SHOT from its own
///   gatekeeper inbox for this correlation (the accepted bounded-inbox contract). The caller's wire
///   claim must equal it; the Host never reads a body the caller hands it.
/// * `model_policy`, `credential_ref` — the installation's signed execution closure.
/// * `committed_spend_micro_usd`, `admitted_cost_micro_usd` — the Host's own budget ledger.
/// * `now_epoch_s` — the sealed [`crate::owner_programme_delegation::HostClockReading`], taken for
///   this request.
///
/// Until those sources are wired, no shipped path can produce facts, so
/// [`evaluate_protected_operation`] cannot get past C4 for a gatekeeper review in production: it
/// fails closed by construction rather than passing on values somebody typed in. The only
/// constructor is the fixture, compiled for tests alone.
///
/// NOT `Copy` AND NOT `Clone`, deliberately: these facts carry the host's clock reading, and a
/// cacheable bundle containing a clock is a clock that goes stale. Each request constructs its own.
#[derive(Debug, PartialEq, Eq)]
pub struct HostResolvedRequestFacts {
    _seal: Seal,
    project: [u8; DELEGATION_DIGEST_LEN],
    repository: [u8; DELEGATION_DIGEST_LEN],
    plan: [u8; DELEGATION_DIGEST_LEN],
    plan_digest: [u8; DELEGATION_DIGEST_LEN],
    phase: [u8; DELEGATION_DIGEST_LEN],
    candidate_digest: [u8; BINDING_DIGEST_LEN],
    parameter_digest: [u8; BINDING_DIGEST_LEN],
    model_policy: [u8; DELEGATION_DIGEST_LEN],
    credential_ref: [u8; DELEGATION_DIGEST_LEN],
    committed_spend_micro_usd: u64,
    admitted_cost_micro_usd: Option<u64>,
    protected_effect_requested: bool,
    now_epoch_s: u64,
}

/// THE HOST-RESOLVED MATERIAL for one request, as NAMED FIELDS so a transposed digest is a build
/// error rather than a wrong binding.
///
/// PLAIN DATA, AND IT AUTHORISES NOTHING. Holding one is not holding facts: it is a carrier, and the
/// only things that can turn it into a [`HostResolvedRequestFacts`] are
/// `HostResolvedRequestFacts::production_resolved` and the fixture beside it, both of which
/// additionally require SEALED values a caller cannot fabricate. It was gated to the test graph
/// while no production constructor existed; §10A gives it one, so the carrier ships — the seal that
/// matters was never on this type.
///
/// EVERY FIELD IS SOMETHING THE HOST RESOLVED FOR ITSELF. The composition that fills this in reads
/// each one off a named trusted source — the validated approved plan, the committed-byte reader at
/// an immutable commit, the exact one-shot inbox bytes, the signed execution closure and the Host's
/// own budget authority — and never off the request. A request carries digests; this carries
/// answers, and [`evaluate_protected_operation`] exists to refuse the two when they disagree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostResolvedFacts {
    pub plan: [u8; DELEGATION_DIGEST_LEN],
    pub plan_digest: [u8; DELEGATION_DIGEST_LEN],
    pub phase: [u8; DELEGATION_DIGEST_LEN],
    pub candidate_digest: [u8; BINDING_DIGEST_LEN],
    /// Digest of the exact inbox request body the Host read for this correlation.
    pub parameter_digest: [u8; BINDING_DIGEST_LEN],
    pub model_policy: [u8; DELEGATION_DIGEST_LEN],
    pub credential_ref: [u8; DELEGATION_DIGEST_LEN],
    pub committed_spend_micro_usd: u64,
    /// `None` when the cost could not be established. An unknown cost is refused, never spent as
    /// zero — that is how a ceiling stops being one.
    pub admitted_cost_micro_usd: Option<u64>,
    pub protected_effect_requested: bool,
}

impl HostResolvedRequestFacts {
    /// FIXTURE ONLY. The sealed sources that exist are consumed as sealed values — the programme
    /// and the clock reading — so even the fixture cannot take a project, a repository or a time
    /// as a bare number; the rest arrives as named fixture fields. Requires a verified delegation,
    /// so facts are never a rung of their own.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture_resolved(
        _delegation: &VerifiedOwnerProgrammeDelegation,
        programme: &crate::owner_programme_delegation::ExpectedProgramme,
        now: &crate::owner_programme_delegation::HostClockReading,
        f: HostResolvedFacts,
    ) -> Self {
        Self {
            _seal: Seal,
            project: *programme.project(),
            repository: *programme.repository(),
            plan: f.plan,
            plan_digest: f.plan_digest,
            phase: f.phase,
            candidate_digest: f.candidate_digest,
            parameter_digest: f.parameter_digest,
            model_policy: f.model_policy,
            credential_ref: f.credential_ref,
            committed_spend_micro_usd: f.committed_spend_micro_usd,
            admitted_cost_micro_usd: f.admitted_cost_micro_usd,
            protected_effect_requested: f.protected_effect_requested,
            now_epoch_s: now.epoch_s(),
        }
    }

    /// The binding digest the HOST expects for `operation` over these facts. Crate-private: the
    /// caller computes its own claim with [`binding_digest`] over whatever it believes, and the
    /// two are compared inside [`evaluate_protected_operation`].
    fn expected_binding_digest(&self, operation: OperationClass) -> [u8; BINDING_DIGEST_LEN] {
        binding_digest(&BindingSubject {
            project: self.project,
            repository: self.repository,
            plan: self.plan,
            plan_digest: self.plan_digest,
            phase: self.phase,
            candidate_digest: self.candidate_digest,
            operation,
            model_policy: self.model_policy,
            credential_ref: self.credential_ref,
        })
    }
}

/// The exact subject a binding digest is computed over. Plain data on purpose: it is what a
/// CALLER hashes to state its claim, and what the host hashes from its own facts. Neither side is
/// trusted for holding one; only the comparison inside the evaluator means anything.
///
/// EVERY FIELD IS BOUND. Nothing is omitted because "another layer checks it": the delegation
/// gate compares facts to the delegation, and the binding gate compares facts to the CALLER, and
/// those are different questions. Volatile values (clock, spend, cost, service epoch) are
/// deliberately NOT here — a digest that changes every second is a replay proof nobody can write
/// down — and each of them is checked separately.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindingSubject {
    pub project: [u8; DELEGATION_DIGEST_LEN],
    pub repository: [u8; DELEGATION_DIGEST_LEN],
    pub plan: [u8; DELEGATION_DIGEST_LEN],
    pub plan_digest: [u8; DELEGATION_DIGEST_LEN],
    pub phase: [u8; DELEGATION_DIGEST_LEN],
    /// The exact review candidate.
    pub candidate_digest: [u8; BINDING_DIGEST_LEN],
    pub operation: OperationClass,
    pub model_policy: [u8; DELEGATION_DIGEST_LEN],
    pub credential_ref: [u8; DELEGATION_DIGEST_LEN],
}

/// THE ONE canonical Host binding digest: SHA-256 over the domain tag, the schema version and the
/// subject's fixed-width fields in a fixed order. Deterministic — identical subjects always hash
/// identically — and every field is length-fixed, so no two distinct subjects encode to the same
/// bytes. There is no second algorithm and no parameter that selects one.
#[must_use]
pub fn binding_digest(subject: &BindingSubject) -> [u8; BINDING_DIGEST_LEN] {
    let mut h = Sha256::new();
    h.update(BINDING_DIGEST_DOMAIN);
    h.update(BINDING_DIGEST_SCHEMA_VERSION.to_be_bytes());
    h.update(subject.project);
    h.update(subject.repository);
    h.update(subject.plan);
    h.update(subject.plan_digest);
    h.update(subject.phase);
    h.update(subject.candidate_digest);
    h.update([subject.operation.discriminant()]);
    h.update(subject.model_policy);
    h.update(subject.credential_ref);
    h.finalize().into()
}

/// Everything the request-scoped C4 path needs, gathered so [`evaluate_protected_operation`] keeps
/// one optional authority argument rather than several.
///
/// Both members are sealed types, so assembling this is not a way around the ladder. There is no
/// longer a `requested_phase` here: the caller's ONLY claim about what it is asking for is the
/// binding digest on the wire, and a claim that arrived any other way would be a claim the wire
/// never carried.
#[derive(Debug, Clone, Copy)]
pub struct GatekeeperDelegationEvidence<'a> {
    /// The delegation whose provenance the host verified.
    pub delegation: &'a VerifiedOwnerProgrammeDelegation,
    /// What the host independently resolved for this request.
    pub facts: &'a HostResolvedRequestFacts,
}

/// Owner presence, satisfied for ONE request and nothing else.
///
/// CRATE-PRIVATE. It is never exported, never named by a downstream crate, and never returned across
/// a public boundary: [`evaluate_protected_operation`] mints it internally and consumes it in the
/// same call. Keeping it unnameable is stronger than keeping it unconstructible.
#[derive(Debug)]
struct RequestScopedOwnerPresence {
    correlation: [u8; CORRELATION_LEN],
    operation: OperationClass,
}

impl RequestScopedOwnerPresence {
    /// Whether this presence was minted for exactly this request and class.
    fn answers(&self, correlation: &[u8; CORRELATION_LEN], operation: OperationClass) -> bool {
        &self.correlation == correlation && self.operation == operation
    }

    /// The one class this presence was minted for.
    fn operation(&self) -> OperationClass {
        self.operation
    }
}

/// Derive request-scoped owner presence from a VERIFIED owner programme delegation, or `None`.
///
/// CRATE-PRIVATE, for the same reason the type it returns is: the only way to reach it is through
/// [`evaluate_protected_operation`], so there is no second entry point to keep in step.
///
/// `None` IS THE DEFAULT ANSWER. Every check below refuses; none of them grants. A reader should be
/// able to satisfy themselves that removing any single check makes something reachable that the owner
/// did not delegate.
#[must_use]
fn satisfy_c4_for_gatekeeper_request(
    evidence: &GatekeeperDelegationEvidence<'_>,
    request: &ProtectedOperationRequest,
) -> Option<RequestScopedOwnerPresence> {
    let delegation = evidence.delegation.delegation();
    let facts = evidence.facts;

    // 1. ONE CLASS, EVER. A delegation that named anything else cannot open the gate for it, and the
    //    request must be asking for that same class.
    if !delegation.operation.may_be_delegated_by_programme()
        || request.operation() != delegation.operation
    {
        return None;
    }
    // 2. STILL LIVE. Completed, revoked or expired all end it. `>=` because a delegation that expires
    //    at this instant has expired.
    if delegation.revoked_or_completed || facts.now_epoch_s >= delegation.expires_at_epoch_s {
        return None;
    }
    // 3. THE SAME PROGRAMME. Project AND canonical repository: a project id alone is a name another
    //    checkout can also use.
    if facts.project != delegation.project || facts.repository != delegation.repository {
        return None;
    }
    // 4. THE SAME PLAN, AT THE SAME DIGEST. A delegation follows the plan the owner read, not a plan
    //    id whose contents were re-authored afterwards.
    if facts.plan != delegation.plan || facts.plan_digest != delegation.plan_digest {
        return None;
    }
    // 5. A PHASE THE OWNER LISTED. The phase is the one the HOST resolved; whether the caller
    //    agrees is the binding gate's question, answered later against the wire digest.
    let listed = delegation
        .allowed_phases
        .iter()
        .take(delegation.allowed_phase_count as usize)
        .any(|p| *p == facts.phase);
    if !listed {
        return None;
    }
    // 6. THE OWNER'S MODEL AND CREDENTIAL POLICY, not the caller's preference.
    if facts.model_policy != delegation.model_policy
        || facts.credential_ref != delegation.credential_ref
    {
        return None;
    }
    // 7. NO PROTECTED EFFECT. A gatekeeper review executes a review. Anything else is out of scope
    //    for this delegation and there is no combination of the fields above that admits it.
    if facts.protected_effect_requested {
        return None;
    }
    // 8. BUDGET, WITH AN UNKNOWN COST REFUSED. Addition is checked, so a hostile or corrupt figure
    //    cannot wrap past the ceiling.
    let cost = facts.admitted_cost_micro_usd?;
    let projected = facts.committed_spend_micro_usd.checked_add(cost)?;
    if projected > delegation.budget_ceiling_micro_usd {
        return None;
    }

    Some(RequestScopedOwnerPresence {
        correlation: *request.correlation(),
        operation: delegation.operation,
    })
}

// -------------------------------------------------------------------------------------------------
// LAYER 3 — TRUSTED OPERATION AUTHORITY (RUN-TO-COMPLETION HOST ATTESTATION §9C)
// -------------------------------------------------------------------------------------------------

/// An authorised protected operation: **this exact independent gatekeeper review is admitted.**
///
/// SEALED. Private fields, no public or crate-visible constructor, no `Default`, no `Clone`, no
/// `From`/`TryFrom`, no serde. THE SOLE MINT is the tail of [`evaluate_protected_operation`], after
/// every gate in front of it has said yes, and the value carries what was proven rather than what
/// was asked: the correlation and sequence the canonical session admitted, the peer's host-issued
/// connection and handshake generation, the service epoch, the verified delegation's id, the Host's
/// own binding digest, candidate digest and parameter digest, and the cost the Host admitted. Every
/// accessor is read-only and there is no comparison that takes caller data on trust.
///
/// NOT `Clone`, DELIBERATELY. An authority answers one request. A copyable authority is how a
/// single admitted review comes to authorise several.
///
/// WHAT IT MEANS, AND WHAT IT DOES NOT. Holding one means the review MAY run. It does not mean the
/// review ran, that a provider answered, or that a phase closed — those are later, independently
/// evidenced facts, and [`ProtectedOperationResponse::completed`] refuses to say "completed" from
/// an authority alone.
#[derive(Debug)]
pub struct AuthorisedProtectedOperation {
    _seal: Seal,
    correlation: [u8; CORRELATION_LEN],
    sequence: u64,
    operation: OperationClass,
    service_epoch: u64,
    connection_id: u64,
    handshake_generation: u64,
    delegation_id: [u8; DELEGATION_DIGEST_LEN],
    binding_digest: [u8; BINDING_DIGEST_LEN],
    candidate_digest: [u8; BINDING_DIGEST_LEN],
    parameter_digest: [u8; BINDING_DIGEST_LEN],
    admitted_cost_micro_usd: u64,
}

impl AuthorisedProtectedOperation {
    /// The correlation this authority is bound to.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }

    /// The sequence the canonical session admitted for that correlation.
    #[must_use]
    pub fn sequence(&self) -> u64 {
        self.sequence
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

    /// Whether this authority belongs to exactly this host-issued connection and generation.
    #[must_use]
    pub fn is_bound_to(&self, connection_id: u64, handshake_generation: u64) -> bool {
        self.connection_id == connection_id && self.handshake_generation == handshake_generation
    }

    /// The verified delegation this review runs under.
    #[must_use]
    pub fn delegation_id(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.delegation_id
    }

    /// The Host's binding digest for the exact subject.
    #[must_use]
    pub fn binding_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.binding_digest
    }

    /// The exact review candidate, as the Host resolved it.
    #[must_use]
    pub fn candidate_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.candidate_digest
    }

    /// The exact inbox request body, as the Host resolved it.
    #[must_use]
    pub fn parameter_digest(&self) -> &[u8; BINDING_DIGEST_LEN] {
        &self.parameter_digest
    }

    /// The cost the Host admitted against the programme ceiling.
    #[must_use]
    pub fn admitted_cost_micro_usd(&self) -> u64 {
        self.admitted_cost_micro_usd
    }
}

/// Evidence that a Host-executed operation actually finished: its correlation, redacted result
/// class and bounded evidence reference.
///
/// SEALED, AND WITHOUT A PRODUCTION CONSTRUCTOR IN THIS CHECKPOINT. `Completed` must never be
/// rendered from an authority alone - an authority is admission, and the review has not run - so
/// [`ProtectedOperationResponse::completed`] demands this second, independent proof. The execution
/// rung that mints it is later. The only constructor here is gated `cfg(all(test, feature =
/// "test-fixtures"))` - narrower than `cfg(test)` - so no shipped graph can say "completed" about
/// anything.
#[derive(Debug)]
pub struct ExecutionOutcomeEvidence {
    _seal: Seal,
    correlation: [u8; CORRELATION_LEN],
    result: ResultClass,
    evidence_ref: [u8; EVIDENCE_REF_LEN],
}

impl ExecutionOutcomeEvidence {
    /// TEST-ONLY. `cfg(all(test, feature = "test-fixtures"))` and private, so it exists in NO
    /// shipped graph and only where an authority can be minted to pair it with.
    #[cfg(all(test, feature = "test-fixtures"))]
    fn for_test(
        correlation: [u8; CORRELATION_LEN],
        result: ResultClass,
        evidence_ref: [u8; EVIDENCE_REF_LEN],
    ) -> Self {
        Self {
            _seal: Seal,
            correlation,
            result,
            evidence_ref,
        }
    }

    /// THE ONE SHIPPED MINT (PROJECTOS-HOST-REVIEW-PATH1A, owner-ratified Amendment 1 to O6h).
    ///
    /// Until this phase the type had no shipped constructor at all, which made `Completed`
    /// unforgeable by making it impossible: nothing could ever be reported as finished. The
    /// property that mattered was never "zero mints" - it was "`Completed` cannot be rendered
    /// without execution" - and it is kept here by construction rather than by absence:
    ///
    /// * PRIVATE, so only this module and its descendants can name it, and the accepted
    ///   validator pins the crate to EXACTLY ONE call site: `run_authorised_review` in
    ///   `host_composition`, which calls it only after the SEALED execution seam reported that
    ///   an execution genuinely occurred.
    /// * THE CORRELATION IS TAKEN FROM THE AUTHORITY, never supplied. Evidence therefore cannot
    ///   be minted about a request nobody authorised, and `completed()` still independently
    ///   refuses evidence about any other correlation.
    /// * `NotRun` IS NOT MINTABLE. Evidence says an execution happened; a request that never ran
    ///   is a refusal, and a refusal is rendered by `rejected()`, which needs no evidence. A
    ///   mint that accepted `NotRun` would let "nothing happened" travel as `Completed`.
    ///
    /// There is no `Default`, `Clone`, `Copy`, `From`, serde or macro route to this type, and
    /// the validator refuses a second `impl` block, a trait impl or a named struct literal.
    fn from_completed_execution(
        authority: &AuthorisedProtectedOperation,
        result: ResultClass,
        evidence_ref: [u8; EVIDENCE_REF_LEN],
    ) -> Option<Self> {
        if result == ResultClass::NotRun {
            return None;
        }
        Some(Self {
            _seal: Seal,
            correlation: *authority.correlation(),
            result,
            evidence_ref,
        })
    }

    /// The correlation this outcome is about.
    #[must_use]
    pub fn correlation(&self) -> &[u8; CORRELATION_LEN] {
        &self.correlation
    }

    /// The redacted result class.
    #[must_use]
    pub fn result(&self) -> ResultClass {
        self.result
    }

    /// The bounded evidence reference.
    #[must_use]
    pub fn evidence_ref(&self) -> &[u8; EVIDENCE_REF_LEN] {
        &self.evidence_ref
    }
}

/// The CLOSED outcome of evaluating one request: refused with a wire answer, or authorised.
///
/// Two variants, nothing else. Authority is never carried inside a response - `Accepted` is
/// RENDERED from an authority by [`ProtectedOperationEvaluation::response`], and a response holds no
/// authority - so a caller that can build responses (it can; refusing is never privileged) still
/// cannot build the thing that admits an operation.
#[derive(Debug)]
#[must_use = "an evaluation outcome decides whether an operation may run"]
pub enum ProtectedOperationEvaluation {
    /// Refused. The wire answer names the gate that refused.
    Rejected(ProtectedOperationResponse),
    /// Admitted. The authority is the only thing the next rung may act on.
    Authorised(AuthorisedProtectedOperation),
}

impl ProtectedOperationEvaluation {
    /// The wire answer: the refusal as it stands, or `Accepted` / `NotRun` rendered FROM the
    /// authority. Rendering does not consume or copy the authority; it reports admission.
    #[must_use]
    pub fn response(&self) -> ProtectedOperationResponse {
        match self {
            Self::Rejected(response) => *response,
            Self::Authorised(authority) => ProtectedOperationResponse::accepted(authority),
        }
    }

    /// The authority, if this evaluation minted one.
    #[must_use]
    pub fn authority(&self) -> Option<&AuthorisedProtectedOperation> {
        match self {
            Self::Rejected(_) => None,
            Self::Authorised(authority) => Some(authority),
        }
    }

    /// Take the authority, or the refusal.
    ///
    /// # Errors
    /// The refusal response when the request was rejected.
    pub fn into_authority(
        self,
    ) -> Result<AuthorisedProtectedOperation, ProtectedOperationResponse> {
        match self {
            Self::Rejected(response) => Err(response),
            Self::Authorised(authority) => Ok(authority),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// RESPONSE
// -------------------------------------------------------------------------------------------------

/// A protected-operation response.
///
/// `Accepted` is rendered only FROM an [`AuthorisedProtectedOperation`] and reports `NotRun`.
/// `Completed` needs that authority AND sealed [`ExecutionOutcomeEvidence`] about the same
/// correlation, so neither a caller nor a holder of a fresh authority can assert that an operation
/// ran.
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

    /// Build a COMPLETION. Requires BOTH the host-held authority AND sealed evidence that the
    /// operation actually finished, about the same correlation. An authority alone renders
    /// nothing here - it is admission, not execution - and evidence about another correlation
    /// answers nothing, so `None` is returned rather than a response that would be untrue.
    #[must_use]
    pub fn completed(
        authority: &AuthorisedProtectedOperation,
        evidence: &ExecutionOutcomeEvidence,
    ) -> Option<Self> {
        if evidence.correlation() != authority.correlation() {
            return None;
        }
        Some(Self {
            correlation: *authority.correlation(),
            state: ResponseState::Completed,
            reason: RejectionReason::PolicyRefused,
            result: evidence.result(),
            service_epoch: authority.service_epoch(),
            evidence_ref: *evidence.evidence_ref(),
            terminal: TerminalStatus::Terminal,
        })
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

/// Evaluate an untrusted request: refuse with a wire answer, or mint the ONE authority.
///
/// Order is fail-closed and deliberate: the C4 gate is checked FIRST, so no amount of peer or binding
/// work can produce an acceptance while owner presence is unproven. Then the peer, then the service
/// instance, then WHAT the request is about (the host-resolved binding, parameter digest and
/// delegation reference against the caller's claims), then whether it is FRESH on the canonical
/// session (the §9A [`AdmittedRequest`]). Only when every one of those has said yes does the tail
/// mint an [`AuthorisedProtectedOperation`] - THE SOLE PRODUCTION MINT of that type - and it mints
/// it from the sealed evidence it consumed, never from a caller's word: there is no boolean
/// argument anywhere on this path, and every value stamped on the authority was read off a sealed
/// rung.
///
/// `admitted` is the sealed proof from `BoundIpcSession::admit_request`, taken BY VALUE so one
/// admission can back at most one evaluation. It is READ, never widened: it says the request was
/// fresh on this session, and it must answer this exact correlation on exactly the peer's
/// host-issued connection and handshake generation. Its meaning stays "fresh", not "authorised".
pub fn evaluate_protected_operation(
    request: &ProtectedOperationRequest,
    peer: Option<&TrustedPeerContext>,
    delegated: Option<&GatekeeperDelegationEvidence<'_>>,
    admitted: Option<AdmittedRequest>,
    service_epoch: u64,
) -> ProtectedOperationEvaluation {
    let refuse = |reason: RejectionReason| {
        ProtectedOperationEvaluation::Rejected(ProtectedOperationResponse::rejected(
            *request.correlation(),
            reason,
            service_epoch,
            TerminalStatus::Terminal,
        ))
    };
    // 1. C4 FIRST. Still a hard stop, with exactly one narrow way past it.
    //
    //    The global gate is unchanged and still answers `false`, so every operation class keeps the
    //    unconditional stop it has today. The only alternative is a presence MINTED HERE, inside
    //    this call, from a VERIFIED owner programme delegation — and it is re-checked rather than
    //    trusted on sight: it must answer this exact correlation and this exact operation class.
    //
    //    The presence is crate-private and never escapes this function: it is held only so the
    //    mint at the tail can REQUIRE it as a value. The global gate satisfies the stop; it never
    //    satisfies the mint.
    let presence = delegated
        .and_then(|e| satisfy_c4_for_gatekeeper_request(e, request))
        .filter(|p| p.answers(request.correlation(), request.operation()));
    let c4_satisfied = OwnerPresenceGate::current().is_closed() || presence.is_some();
    if !c4_satisfied {
        return refuse(RejectionReason::OwnerPresenceGateOpen);
    }
    // 2. An admitted peer is mandatory. Canonical peer identity is established inside the
    //    identity-proof crate's attempt and minted into a context from its sealed admission.
    //
    //    Kept as `peer.is_none()` on purpose: the accepted operation-contract validator anchors
    //    its "C4 before the peer check" ordering assertion on that exact spelling. A `let-else`
    //    here reads better and would silently turn that assertion into one that matches nothing.
    if peer.is_none() {
        return refuse(RejectionReason::PeerNotAuthenticated);
    }
    // 3. The claimed epoch must be this instance's.
    if request.claimed_service_epoch() != service_epoch {
        return refuse(RejectionReason::ServiceEpochMismatch);
    }
    // 4. WHAT IS THIS REQUEST ABOUT — ACCORDING TO THE HOST. C4 was satisfied above, and the only
    //    way it can be is through delegation evidence, so `delegated` is present here; a `None`
    //    is a refusal all the same rather than an assumption. The caller's binding digest, its
    //    approval reference and its parameter digest are CLAIMS. The host hashes the facts it
    //    resolved for itself and requires the claims to name that exact subject, that exact
    //    delegation and that exact inbox body. The caller never supplies a fact through these
    //    comparisons; it can only agree or be refused.
    let Some(evidence) = delegated else {
        return refuse(RejectionReason::BindingMismatch);
    };
    let expected = evidence.facts.expected_binding_digest(request.operation());
    if *request.binding_digest() != expected
        || *request.approval_ref() != evidence.delegation.delegation().delegation_id
        || *request.parameter_digest() != evidence.facts.parameter_digest
    {
        return refuse(RejectionReason::BindingMismatch);
    }
    // 5. IS THIS REQUEST FRESH ON THE CANONICAL SESSION. The §9A admission must exist, must answer
    //    this correlation on exactly the peer's host-issued connection and handshake generation —
    //    so an admission from another connection answers nothing here — and must have admitted the
    //    sequence this frame carries. The peer was required at step 2; a `None` here is a refusal
    //    all the same rather than an assumption.
    let Some(peer) = peer else {
        return refuse(RejectionReason::PeerNotAuthenticated);
    };
    let Some(admitted) = admitted else {
        return refuse(RejectionReason::CorrelationMismatch);
    };
    if !admitted.answers(
        request.correlation(),
        peer.connection_id(),
        peer.handshake_generation(),
    ) {
        return refuse(RejectionReason::CorrelationMismatch);
    }
    if admitted.sequence() != request.sequence() {
        return refuse(RejectionReason::SequenceRefused);
    }
    // 6. THE MINT. Every gate above said yes. The mint additionally REQUIRES the request-scoped
    //    presence as a value - so the global gate, even if it could ever close, would satisfy the
    //    stop and never the mint - and re-states the one delegable class at the point of minting.
    //    Everything stamped on the authority is read off a sealed rung: the presence, the
    //    delegation, the facts, the peer and the admission. Nothing is read off the request except
    //    the operation byte, which the presence and the binding digest have both already bound.
    let Some(presence) = presence else {
        return refuse(RejectionReason::OwnerPresenceGateOpen);
    };
    if !presence.operation().may_be_delegated_by_programme() {
        return refuse(RejectionReason::PolicyRefused);
    }
    let Some(admitted_cost_micro_usd) = evidence.facts.admitted_cost_micro_usd else {
        return refuse(RejectionReason::PolicyRefused);
    };
    ProtectedOperationEvaluation::Authorised(AuthorisedProtectedOperation {
        _seal: Seal,
        correlation: *admitted.correlation(),
        sequence: admitted.sequence(),
        operation: presence.operation(),
        service_epoch,
        connection_id: peer.connection_id(),
        handshake_generation: peer.handshake_generation(),
        delegation_id: evidence.delegation.delegation().delegation_id,
        binding_digest: expected,
        candidate_digest: evidence.facts.candidate_digest,
        parameter_digest: evidence.facts.parameter_digest,
        admitted_cost_micro_usd,
    })
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
    use crate::owner_programme_delegation::{ExpectedProgramme, HostClockReading};
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
            [5u8; BINDING_DIGEST_LEN],
        )
    }

    /// Evaluate and RENDER, for the proofs that ask about the wire answer. The authority itself is
    /// examined directly where the proof is about the authority.
    fn eval_response(
        request: &ProtectedOperationRequest,
        peer: Option<&TrustedPeerContext>,
        delegated: Option<&GatekeeperDelegationEvidence<'_>>,
        admitted: Option<AdmittedRequest>,
        service_epoch: u64,
    ) -> ProtectedOperationResponse {
        evaluate_protected_operation(request, peer, delegated, admitted, service_epoch).response()
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
        // The governed removal of the client-session reference shrank the request by exactly the
        // 16 bytes it occupied, and nothing else moved.
        assert_eq!(
            PROTECTED_OPERATION_REQUEST_LEN,
            16 + 8 + 8 + 32 + 1 + 32 + 32
        );
    }

    // ---- RECONCILIATION: what remains of the peer surface -------------------------------------
    //
    // PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A retired this crate's duplicate identity model.
    // The tests below prove what the reduced surface must still guarantee. What they deliberately no
    // longer test is identity itself: exact user, exact session, process instance, classification and
    // PID reuse are owned by the canonical identity-proof crate's attempt and are proven there.

    /// The legacy identity vocabulary, spelled in pieces so this test cannot match itself.
    ///
    /// A source scan is the right shape here: the point is that these constructs are ABSENT, and an
    /// absence cannot be expressed by calling them — code referencing them would not compile, which
    /// would be a build failure rather than a readable regression.
    #[test]
    fn legacy_peer_identity_model_is_not_present_in_production_graph() {
        let source = include_str!("operation_contract.rs");
        // Strip line comments, so prose describing the retired model cannot fail this test and, more
        // importantly, so a real construct cannot hide inside a comment.
        //
        // Deliberately UNANNOTATED: the accepted `val-projectoshost-ipc-operation-contract1a` O2
        // assertion forbids the free-form type NAMES appearing anywhere in this module's code, and
        // writing one here — even in a test — would break that accepted invariant.
        let code = source
            .lines()
            .map(|l| match l.find("//") {
                Some(i) => &l[..i],
                None => l,
            })
            .collect::<Vec<_>>()
            .join("\n");

        for part in [
            concat!("TokenUser", "Sid"),
            concat!("Observed", "PeerEvidence"),
            concat!("Peer", "AuthenticationError"),
            concat!("Integrity", "Level"),
            concat!("Integrity", "Mismatch"),
            concat!("SID_MAX", "_LEN"),
            concat!("authenticate", "_peer"),
            concat!("PeerUser", "Class"),
            concat!("from_kernel", "_bytes"),
            // §9C: the client-session reference was governed-removed from the authority-bearing
            // contract. It must not creep back as a second session model.
            concat!("client_session", "_ref"),
            concat!("SESSION_REF", "_LEN"),
        ] {
            assert!(
                !code.contains(part),
                "the retired peer identity model reappeared in this crate: {part}"
            );
        }
        // No raw identity storage, and no accessor that lends a byte slice back out. The free-form
        // shapes (`String`, `Vec<u8>`, maps, `serde`, `&str`) are deliberately NOT re-checked here:
        // O2 in the accepted operation-contract validator already forbids them module-wide, and
        // spelling them in this test would itself violate that invariant.
        for shape in [concat!("[u8;", " 68]"), concat!("-> &[", "u8]")] {
            assert!(
                !code.contains(shape),
                "a raw or free-form identity shape reappeared: {shape}"
            );
        }
    }

    #[test]
    fn a_trusted_peer_context_carries_no_identity_only_the_host_issued_connection() {
        // The whole remaining surface: two host-issued identifiers and nothing else. If this type ever
        // regains an identity field, this test is where the intent was recorded.
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        assert_eq!(ctx.connection_id(), 77);
        assert_eq!(ctx.handshake_generation(), 5);
        assert!(ctx.is_bound_to(77, 5));
    }

    #[test]
    fn different_connection_ids_are_not_interchangeable() {
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        assert!(!ctx.is_bound_to(78, 5));
        assert_ne!(ctx, TrustedPeerContext::for_admitted_connection(78, 5));
    }

    #[test]
    fn different_handshake_generations_are_not_interchangeable() {
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        assert!(!ctx.is_bound_to(77, 6));
        assert_ne!(ctx, TrustedPeerContext::for_admitted_connection(77, 6));
    }

    #[test]
    fn wire_values_cannot_establish_or_alter_a_peer_context() {
        // Every wire field is a claim. Changing the caller's digests must not reach the trusted
        // context, and there is no conversion from the request into one — there cannot be, because
        // the only constructor is test-only and takes host-issued values.
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        let mut r = request();
        r.parameter_digest = [0xFFu8; BINDING_DIGEST_LEN];
        r.binding_digest = [0xEEu8; BINDING_DIGEST_LEN];
        let resp = eval_response(&r, Some(&ctx), None, None, 42);
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
        assert!(
            ctx.is_bound_to(77, 5),
            "wire data must not alter the host-issued binding"
        );
    }

    #[test]
    fn an_admitted_peer_still_cannot_pass_c4() {
        // Strictly stronger than passing None: a peer IS present and the answer is still the C4 refusal,
        // with no effect, no acceptance and no completion.
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        let resp = eval_response(&request(), Some(&ctx), None, None, 42);
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
        assert_eq!(resp.result(), ResultClass::NotRun);
        assert_eq!(resp.terminal(), TerminalStatus::Terminal);
    }

    #[test]
    fn an_admitted_peer_cannot_reach_an_acceptance_by_any_epoch_or_sequence() {
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        for epoch in [0u64, 42, u64::MAX] {
            for seq in [0u64, 1, u64::MAX] {
                let mut r = request();
                r.sequence = seq;
                r.claimed_service_epoch = epoch;
                let resp = eval_response(&r, Some(&ctx), None, None, 42);
                assert_eq!(resp.state(), ResponseState::Rejected);
                assert_eq!(resp.result(), ResultClass::NotRun);
            }
        }
    }

    // ---- the C4 hard stop ----

    #[test]
    fn c4_gate_is_open_and_cannot_be_closed() {
        assert!(!OwnerPresenceGate::current().is_closed());
    }

    #[test]
    fn c4_open_request_is_always_rejected() {
        let resp = eval_response(&request(), None, None, None, 42);
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
        let resp = eval_response(&r, None, None, None, 42);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    #[test]
    fn no_undelegated_evaluation_path_returns_accepted_or_completed() {
        for epoch in [0u64, 42, u64::MAX] {
            for seq in [0u64, 1, u64::MAX] {
                let mut r = request();
                r.sequence = seq;
                r.claimed_service_epoch = epoch;
                let resp = eval_response(&r, None, None, None, 42);
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

    /// A TRUSTED PEER COMES FROM A CANONICAL ATTEMPT, AND FROM NOTHING ELSE.
    ///
    /// This drives the real identity-proof attempt to a match on one host-issued connection, takes
    /// the SEALED admission it produces, and mints the context from it. The identifiers on the
    /// context are the ones the ATTEMPT captured — they are read off the admission, never accepted
    /// as arguments, so there is no seam through which a genuine admission could be paired with a
    /// different connection.
    ///
    /// What this test cannot do is as important as what it does: there is no way here to write down
    /// a `TrustedPeerContext`, and no way to obtain an admission except by running an attempt that
    /// actually matched.
    #[cfg(feature = "test-fixtures")]
    #[test]
    fn a_trusted_peer_context_comes_only_from_a_sealed_canonical_admission() {
        use projectos_host_windows_service_identity_proof as idp;

        let service = idp::SyntheticInstanceSelector::new(1, 1);
        let capability = idp::LiveInstanceObservationCapability::synthetic_for_fixture();

        let admission = idp::ServiceInstanceBindingAttempt::begin(&capability)
            .record_scm_before(idp::synthetic_observation(service))
            .into_attempt()
            .expect("scm-before")
            .record_ipc_peer_on_connection(idp::synthetic_observation(service), 77, 5)
            .into_attempt()
            .expect("peer captured on the host-issued connection")
            .record_scm_after(idp::synthetic_observation(service))
            .into_attempt()
            .expect("scm-after")
            .admit_peer_for_connection(77, 5)
            .expect("a matching attempt admits its peer");

        let peer = TrustedPeerContext::from_verified_peer_admission(&admission);
        assert!(peer.is_bound_to(77, 5));
        assert!(
            !peer.is_bound_to(78, 5),
            "another connection is not this one"
        );
        assert!(
            !peer.is_bound_to(77, 6),
            "another generation is not this one"
        );
    }

    /// AN ADMITTED PEER IS NOT PERMISSION TO DO ANYTHING.
    ///
    /// With a genuine trusted peer present and the epoch correct, the evaluator still refuses,
    /// because C4 is checked first and no owner delegation was supplied. Being who you say you are
    /// and being allowed to do something remain separate questions.
    #[cfg(feature = "test-fixtures")]
    #[test]
    fn a_genuine_peer_still_reaches_only_the_owner_presence_refusal() {
        use projectos_host_windows_service_identity_proof as idp;

        let service = idp::SyntheticInstanceSelector::new(2, 1);
        let capability = idp::LiveInstanceObservationCapability::synthetic_for_fixture();
        let admission = idp::ServiceInstanceBindingAttempt::begin(&capability)
            .record_scm_before(idp::synthetic_observation(service))
            .into_attempt()
            .expect("scm-before")
            .record_ipc_peer_on_connection(idp::synthetic_observation(service), 90, 3)
            .into_attempt()
            .expect("peer captured")
            .record_scm_after(idp::synthetic_observation(service))
            .into_attempt()
            .expect("scm-after")
            .admit_peer_for_connection(90, 3)
            .expect("admitted");
        let peer = TrustedPeerContext::from_verified_peer_admission(&admission);

        let request = ProtectedOperationRequest::new(
            [1u8; CORRELATION_LEN],
            1,
            42,
            [0u8; BINDING_DIGEST_LEN],
            OperationClass::IndependentGatekeeperReview,
            [0u8; APPROVAL_REF_LEN],
            [0u8; BINDING_DIGEST_LEN],
        );
        let response = eval_response(&request, Some(&peer), None, None, 42);
        assert_eq!(response.state(), ResponseState::Rejected);
        assert_eq!(response.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    // =============================================================================================
    // REQUEST-SCOPED C4 — the owner PROGRAMME delegation path.
    //
    // Every proof below is a REFUSAL except one. That ratio is the design: a delegation is a narrow
    // permission to review one candidate in one phase of one plan, and everything else stays stopped.
    // =============================================================================================

    const D_PROJECT: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
    const D_REPO: [u8; DELEGATION_DIGEST_LEN] = [0x22; DELEGATION_DIGEST_LEN];
    const D_PLAN: [u8; DELEGATION_DIGEST_LEN] = [0x33; DELEGATION_DIGEST_LEN];
    const D_PLAN_DIGEST: [u8; DELEGATION_DIGEST_LEN] = [0x44; DELEGATION_DIGEST_LEN];
    const D_PHASE: [u8; DELEGATION_DIGEST_LEN] = [0x55; DELEGATION_DIGEST_LEN];
    const D_OTHER_PHASE: [u8; DELEGATION_DIGEST_LEN] = [0x56; DELEGATION_DIGEST_LEN];
    const D_CANDIDATE: [u8; BINDING_DIGEST_LEN] = [0x88; BINDING_DIGEST_LEN];
    const D_PARAMS: [u8; BINDING_DIGEST_LEN] = [0x5A; BINDING_DIGEST_LEN];
    const OTHER: [u8; DELEGATION_DIGEST_LEN] = [0x99; DELEGATION_DIGEST_LEN];
    const D_ID: [u8; DELEGATION_DIGEST_LEN] = [0xAA; DELEGATION_DIGEST_LEN];

    /// One rewrite of the host's resolved facts.
    type FactRewrite = fn(&mut HostResolvedFacts);
    /// One rewrite of the caller's claimed binding subject.
    type ClaimRewrite = fn(&mut BindingSubject);
    const D_MODEL: [u8; DELEGATION_DIGEST_LEN] = [0x66; DELEGATION_DIGEST_LEN];
    const D_CRED: [u8; DELEGATION_DIGEST_LEN] = [0x77; DELEGATION_DIGEST_LEN];
    const NOW: u64 = 1_000;
    const SEQ: u64 = 7;
    const PEER_CONN: u64 = 5;
    const PEER_GEN: u64 = 1;

    /// A gatekeeper request whose binding digest is a PLACEHOLDER claim, not the host's. It gets past
    /// C4 (the delegation gate does not read the wire digest) and is refused at the binding gate.
    fn gatekeeper_request(correlation: u8) -> ProtectedOperationRequest {
        ProtectedOperationRequest::new(
            [correlation; CORRELATION_LEN],
            SEQ,
            42,
            [2u8; BINDING_DIGEST_LEN],
            OperationClass::IndependentGatekeeperReview,
            [3u8; APPROVAL_REF_LEN],
            [5u8; BINDING_DIGEST_LEN],
        )
    }

    /// The subject the host resolves in the exact case. A CALLER that agrees with the host hashes
    /// exactly this.
    fn host_subject() -> BindingSubject {
        BindingSubject {
            project: D_PROJECT,
            repository: D_REPO,
            plan: D_PLAN,
            plan_digest: D_PLAN_DIGEST,
            phase: D_PHASE,
            candidate_digest: D_CANDIDATE,
            operation: OperationClass::IndependentGatekeeperReview,
            model_policy: D_MODEL,
            credential_ref: D_CRED,
        }
    }

    /// A request that CLAIMS exactly `subject`, NAMES the delegation and carries the parameter
    /// digest the host resolved. This is the correct claim.
    fn bound_request(correlation: u8, subject: &BindingSubject) -> ProtectedOperationRequest {
        ProtectedOperationRequest::new(
            [correlation; CORRELATION_LEN],
            SEQ,
            42,
            binding_digest(subject),
            subject.operation,
            D_ID,
            D_PARAMS,
        )
    }

    fn delegation() -> OwnerProgrammeDelegation {
        let mut allowed = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
        allowed[0] = D_PHASE;
        OwnerProgrammeDelegation {
            delegation_id: D_ID,
            owner: [0xBB; DELEGATION_DIGEST_LEN],
            project: D_PROJECT,
            repository: D_REPO,
            plan: D_PLAN,
            plan_digest: D_PLAN_DIGEST,
            allowed_phases: allowed,
            allowed_phase_count: 1,
            operation: OperationClass::IndependentGatekeeperReview,
            model_policy: D_MODEL,
            credential_ref: D_CRED,
            budget_ceiling_micro_usd: 5_000_000,
            expires_at_epoch_s: NOW + 3_600,
            revoked_or_completed: false,
        }
    }

    /// A delegation whose provenance is treated as verified. `for_test` is `cfg(test)` and private,
    /// so this rung is unreachable outside this module in any build.
    fn verified(d: OwnerProgrammeDelegation) -> VerifiedOwnerProgrammeDelegation {
        VerifiedOwnerProgrammeDelegation::for_test(d)
    }

    /// The installation's own programme, as the host resolved it.
    fn programme() -> ExpectedProgramme {
        ExpectedProgramme::fixture(D_PROJECT, D_REPO)
    }

    fn clock_at(epoch_s: u64) -> HostClockReading {
        HostClockReading::fixture(epoch_s)
    }

    /// Host-resolved facts that agree with the delegation in every respect.
    fn base_facts() -> HostResolvedFacts {
        HostResolvedFacts {
            plan: D_PLAN,
            plan_digest: D_PLAN_DIGEST,
            phase: D_PHASE,
            candidate_digest: D_CANDIDATE,
            parameter_digest: D_PARAMS,
            model_policy: D_MODEL,
            credential_ref: D_CRED,
            committed_spend_micro_usd: 3_659_841,
            admitted_cost_micro_usd: Some(200_000),
            protected_effect_requested: false,
        }
    }

    fn facts(v: &VerifiedOwnerProgrammeDelegation) -> HostResolvedRequestFacts {
        HostResolvedRequestFacts::fixture_resolved(v, &programme(), &clock_at(NOW), base_facts())
    }

    fn facts_of(
        v: &VerifiedOwnerProgrammeDelegation,
        f: HostResolvedFacts,
    ) -> HostResolvedRequestFacts {
        HostResolvedRequestFacts::fixture_resolved(v, &programme(), &clock_at(NOW), f)
    }

    fn evidence<'a>(
        v: &'a VerifiedOwnerProgrammeDelegation,
        f: &'a HostResolvedRequestFacts,
    ) -> GatekeeperDelegationEvidence<'a> {
        GatekeeperDelegationEvidence {
            delegation: v,
            facts: f,
        }
    }

    fn peer() -> TrustedPeerContext {
        TrustedPeerContext::for_admitted_connection(PEER_CONN, PEER_GEN)
    }

    /// The RENDERED answer for `request` under this evidence, with no §9A admission presented.
    fn evaluate(
        request: &ProtectedOperationRequest,
        v: &VerifiedOwnerProgrammeDelegation,
        f: &HostResolvedRequestFacts,
    ) -> ProtectedOperationResponse {
        let ev = evidence(v, f);
        eval_response(request, Some(&peer()), Some(&ev), None, 42)
    }

    /// Does this exact case get past C4? The question every DELEGATION proof below asks.
    fn admitted(
        v: &VerifiedOwnerProgrammeDelegation,
        f: &HostResolvedRequestFacts,
        correlation: u8,
    ) -> bool {
        evaluate(&gatekeeper_request(correlation), v, f).reason()
            != RejectionReason::OwnerPresenceGateOpen
    }

    /// The exact case, with one delegation field rewritten. Must be refused at C4.
    fn refused_when(mutate: impl FnOnce(&mut OwnerProgrammeDelegation)) -> bool {
        let mut d = delegation();
        mutate(&mut d);
        let v = verified(d);
        let f = facts(&v);
        !admitted(&v, &f, 1)
    }

    /// The exact case, with one HOST-RESOLVED fact rewritten. Must be refused at C4.
    fn refused_with_facts(mutate: impl FnOnce(&mut HostResolvedFacts)) -> bool {
        let v = verified(delegation());
        let mut raw = base_facts();
        mutate(&mut raw);
        let f = facts_of(&v, raw);
        !admitted(&v, &f, 1)
    }

    /// (8) THE ONE PATH THAT WORKS — past C4.
    #[test]
    fn an_exact_verified_delegation_and_request_gets_past_c4() {
        let v = verified(delegation());
        let f = facts(&v);
        assert!(admitted(&v, &f, 1), "the exact case must be admitted");
    }

    /// (6) NO DELEGATION, NO PRESENCE. There is no phrase, flag or configuration that substitutes.
    #[test]
    fn a_gatekeeper_request_without_a_delegation_is_still_stopped_at_c4() {
        let resp = eval_response(&gatekeeper_request(1), Some(&peer()), None, None, 42);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    /// (3)(4)(5) A RAW DELEGATION IS NOT AUTHORITY, and neither is a forged owner field or fabricated
    /// facts.
    ///
    /// This is the boundary correction stated as a test rather than as a comment. The rung that
    /// matters is `VerifiedOwnerProgrammeDelegation`, and there is no route to one from an
    /// `OwnerProgrammeDelegation` alone — including one that names any owner it likes. A downstream
    /// crate can build the record and the facts constructor is closed to it, because the facts
    /// constructor demands the verified rung first.
    #[test]
    fn a_raw_delegation_or_forged_owner_is_not_authority() {
        // The raw record is constructible — deliberately, it is the untrusted DTO rung.
        let mut raw = delegation();
        raw.owner = OTHER; // any owner at all

        // And it satisfies nothing: `evaluate_protected_operation` takes the sealed evidence, so a
        // raw record cannot even be offered to it. The only way to proceed is `for_test`, which is
        // `cfg(test)` and private — no shipped graph contains it.
        let resp = eval_response(&gatekeeper_request(1), Some(&peer()), None, None, 42);
        assert_eq!(
            resp.reason(),
            RejectionReason::OwnerPresenceGateOpen,
            "a raw delegation, whatever it claims, leaves C4 open"
        );

        // A forged owner does not change the answer once verified either: the owner FIELD is a name,
        // and every binding below is still checked against what the host resolved.
        let v = verified(raw);
        let f = facts(&v);
        assert!(
            admitted(&v, &f, 1),
            "the owner field is a name, not the control — the control is that `for_test` is the only \
             way to reach this rung, and it does not ship"
        );
    }

    /// (10) ANOTHER PLAN, A RE-AUTHORED PLAN DIGEST, AN UNAPPROVED MODEL OR CREDENTIAL, OR A
    /// PROTECTED EFFECT — as the HOST resolved them, disagreeing with the delegation.
    ///
    /// The plan DIGEST case matters most: a delegation following a plan id alone would keep
    /// authorising after the plan was re-authored into something the owner never read.
    #[test]
    fn facts_that_disagree_with_the_delegation_are_refused() {
        let cases: [FactRewrite; 5] = [
            |f| f.plan = OTHER,
            |f| f.plan_digest = OTHER,
            |f| f.model_policy = OTHER,
            |f| f.credential_ref = OTHER,
            |f| f.protected_effect_requested = true,
        ];
        for (i, mutate) in cases.into_iter().enumerate() {
            assert!(
                refused_with_facts(mutate),
                "host fact rewrite {i} must be refused"
            );
        }
    }

    /// ANOTHER PROJECT OR REPOSITORY, as the host resolved its own programme.
    #[test]
    fn a_programme_that_disagrees_with_the_delegation_is_refused() {
        let v = verified(delegation());
        for wrong in [
            ExpectedProgramme::fixture(OTHER, D_REPO),
            ExpectedProgramme::fixture(D_PROJECT, OTHER),
        ] {
            let f = HostResolvedRequestFacts::fixture_resolved(
                &v,
                &wrong,
                &clock_at(NOW),
                base_facts(),
            );
            assert!(!admitted(&v, &f, 1));
        }
    }

    /// A phase the delegation does not list — as the HOST resolved it.
    #[test]
    fn an_unlisted_phase_is_refused() {
        assert!(refused_with_facts(|f| f.phase = D_OTHER_PHASE));
    }

    /// (10) A DELEGATION FOR ANOTHER OPERATION CANNOT OPEN THE GATE FOR IT.
    #[test]
    fn a_delegation_for_another_operation_is_refused() {
        assert!(
            refused_when(|d| d.operation = OperationClass::StagingRead),
            "no delegation may satisfy C4 for a class that is not the gatekeeper review"
        );
        assert!(refused_when(
            |d| d.operation = OperationClass::ProviderIdentityRead
        ));
    }

    /// (7) EXPIRED, REVOKED OR COMPLETED. A delegation that has ended cannot be spent.
    #[test]
    fn an_expired_or_revoked_delegation_is_refused() {
        assert!(refused_when(|d| d.revoked_or_completed = true));
        // Exactly at the expiry instant it has expired.
        assert!(refused_when(|d| d.expires_at_epoch_s = NOW));
        assert!(refused_when(|d| d.expires_at_epoch_s = NOW - 1));
    }

    /// THE CLOCK IS A SEALED HOST READING, consumed as a sealed value even by the fixture.
    ///
    /// Same delegation, same request, same everything else — only the host's own reading differs,
    /// and there is no bare number left through which a caller could hand one in.
    #[test]
    fn the_clock_is_a_sealed_host_resolved_fact() {
        let v = verified(delegation());
        let live = HostResolvedRequestFacts::fixture_resolved(
            &v,
            &programme(),
            &clock_at(NOW),
            base_facts(),
        );
        assert!(admitted(&v, &live, 1));

        for reading in [NOW + 3_600, NOW + 3_601, u64::MAX] {
            let stale = HostResolvedRequestFacts::fixture_resolved(
                &v,
                &programme(),
                &clock_at(reading),
                base_facts(),
            );
            assert!(
                !admitted(&v, &stale, 1),
                "a reading of {reading} is at or past expiry and must refuse"
            );
        }
    }

    /// (10) A GENERIC PROTECTED OPERATION STAYS STOPPED while a gatekeeper delegation exists.
    ///
    /// This is the ruling's centre: C4 is not closed, it is satisfied for one request of one class.
    #[test]
    fn c4_remains_open_for_every_other_operation_class() {
        let v = verified(delegation());
        let f = facts(&v);
        let ev = evidence(&v, &f);

        for other in [
            OperationClass::ProviderIdentityRead,
            OperationClass::StagingRead,
        ] {
            let mut subject = host_subject();
            subject.operation = other;
            let r = bound_request(1, &subject);
            let resp = eval_response(&r, Some(&peer()), Some(&ev), None, 42);
            assert_eq!(
                resp.reason(),
                RejectionReason::OwnerPresenceGateOpen,
                "{other:?} must still meet the unconditional C4 stop"
            );
        }

        // And the global gate itself is untouched.
        assert!(!OwnerPresenceGate::current().is_closed());
    }

    /// (9) NOT REUSABLE ACROSS REQUESTS.
    ///
    /// The evidence is the same; only the correlation differs. Presence is minted per request inside
    /// the evaluator and never exists as a value a caller could carry, so a second request must earn
    /// its own.
    #[test]
    fn the_same_evidence_does_not_admit_a_different_correlation() {
        let v = verified(delegation());
        let f = facts(&v);
        assert!(admitted(&v, &f, 1));

        let ev = evidence(&v, &f);
        let resp = eval_response(&gatekeeper_request(9), Some(&peer()), Some(&ev), None, 42);
        assert_ne!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
        // The presence minted for correlation 9 answers correlation 9 — and nothing else, because it
        // is consumed in the same call and cannot be carried anywhere.
        assert_eq!(resp.correlation(), &[9u8; CORRELATION_LEN]);
    }

    /// AN UNKNOWN COST IS REFUSED, and a known one may not exceed the ceiling.
    #[test]
    fn an_unknown_or_excessive_cost_is_refused() {
        assert!(
            refused_with_facts(|f| f.admitted_cost_micro_usd = None),
            "an unknown cost must never be spent as zero"
        );
        assert!(
            refused_with_facts(|f| f.admitted_cost_micro_usd = Some(2_000_000)),
            "3.659841 + 2.000000 exceeds the 5.000000 ceiling"
        );
        assert!(
            refused_with_facts(|f| {
                f.committed_spend_micro_usd = u64::MAX;
                f.admitted_cost_micro_usd = Some(1);
            }),
            "must not wrap past the ceiling"
        );
    }

    /// A phase beyond `allowed_phase_count` is padding, not permission.
    ///
    /// Without the count the array's zero padding would read as a listed phase, and a phase id of all
    /// zeroes would be delegated by every delegation ever written.
    #[test]
    fn padding_beyond_the_declared_phase_count_is_not_permission() {
        // Present in the array, beyond the declared count.
        let mut d = delegation();
        d.allowed_phases[1] = D_OTHER_PHASE;
        let v = verified(d);
        let mut raw = base_facts();
        raw.phase = D_OTHER_PHASE;
        let f = facts_of(&v, raw);
        assert!(!admitted(&v, &f, 1));

        // And the zero padding is not a delegation for the all-zero phase.
        let v = verified(delegation());
        let mut raw = base_facts();
        raw.phase = [0u8; DELEGATION_DIGEST_LEN];
        let f = facts_of(&v, raw);
        assert!(!admitted(&v, &f, 1));
    }

    /// AN UNKNOWN OPERATION CLASS REMAINS UNREPRESENTABLE. Adding a third class did not open a
    /// numeric escape hatch.
    #[test]
    fn unknown_operation_discriminants_still_fail_closed() {
        assert_eq!(
            OperationClass::from_discriminant(3),
            Some(OperationClass::IndependentGatekeeperReview)
        );
        for v in [0u8, 4, 5, 9, 200, 255] {
            assert!(
                OperationClass::from_discriminant(v).is_none(),
                "{v} must not decode to an operation class"
            );
        }
        // And the new class round-trips on the wire without widening the frame.
        let r = gatekeeper_request(1);
        let bytes = encode_protected_operation_request(&nonce(), &r);
        assert_eq!(bytes.len(), HEADER_LEN + PROTECTED_OPERATION_REQUEST_LEN);
        let (decoded, _nonce) = decode_protected_operation_request(&bytes).expect("must decode");
        assert_eq!(
            decoded.operation(),
            OperationClass::IndependentGatekeeperReview
        );
    }

    /// Exactly one class may ever be delegated.
    #[test]
    fn only_the_gatekeeper_review_may_be_delegated_by_a_programme() {
        assert!(OperationClass::IndependentGatekeeperReview.may_be_delegated_by_programme());
        assert!(!OperationClass::ProviderIdentityRead.may_be_delegated_by_programme());
        assert!(!OperationClass::StagingRead.may_be_delegated_by_programme());
    }

    // =============================================================================================
    // HOST-RESOLVED BINDING AUTHORITY — RUN-TO-COMPLETION HOST ATTESTATION §9B.
    //
    // §9A asked "is this request fresh on this session?". These ask "what is this request about,
    // according to the HOST?" — and prove that the caller may state a digest but never decides
    // what it means. Every proof below reaches the binding gate: C4 is satisfied, a peer is
    // present and the epoch is right, so the only thing under test is the host's own binding.
    // =============================================================================================

    /// THE DIGEST IS DETERMINISTIC, AND EVERY BOUND FIELD CHANGES IT. One rewrite per field, each
    /// producing a digest distinct from the base and from every other single rewrite.
    #[test]
    fn the_binding_digest_is_deterministic_and_every_bound_field_changes_it() {
        let base = binding_digest(&host_subject());
        assert_eq!(
            base,
            binding_digest(&host_subject()),
            "same subject, same digest"
        );

        let rewrites: [ClaimRewrite; 9] = [
            |c| c.project = OTHER,
            |c| c.repository = OTHER,
            |c| c.plan = OTHER,
            |c| c.plan_digest = OTHER,
            |c| c.phase = OTHER,
            |c| c.candidate_digest = OTHER,
            |c| c.operation = OperationClass::StagingRead,
            |c| c.model_policy = OTHER,
            |c| c.credential_ref = OTHER,
        ];
        let mut seen = [[0u8; BINDING_DIGEST_LEN]; 9];
        for (i, rewrite) in rewrites.into_iter().enumerate() {
            let mut subject = host_subject();
            rewrite(&mut subject);
            let d = binding_digest(&subject);
            assert_ne!(d, base, "rewriting bound field {i} must change the digest");
            assert!(
                !seen[..i].contains(&d),
                "rewrite {i} collides with an earlier single-field rewrite"
            );
            seen[i] = d;
        }
    }

    /// CANDIDATE A != CANDIDATE B. Two subjects identical in every respect but the candidate bind
    /// differently, and the domain tag is what the subject starts with.
    #[test]
    fn candidate_a_and_candidate_b_bind_differently() {
        let a = binding_digest(&host_subject());
        let mut other = host_subject();
        other.candidate_digest = [0x89; BINDING_DIGEST_LEN];
        let b = binding_digest(&other);
        assert_ne!(a, b);
        // Flipping ONE bit of the candidate is enough.
        let mut bit = host_subject();
        bit.candidate_digest[BINDING_DIGEST_LEN - 1] ^= 0x01;
        assert_ne!(binding_digest(&bit), a);
        // The subject is its own signing space: not JSON, not the delegation tag.
        assert_ne!(BINDING_DIGEST_DOMAIN[0], b'{');
        assert_ne!(
            &BINDING_DIGEST_DOMAIN[..],
            &crate::owner_programme_delegation::DELEGATION_SIGNING_DOMAIN
                [..BINDING_DIGEST_DOMAIN.len()]
        );
    }

    /// THE CORRECT CLAIM REACHES THE BINDING GATE AND PASSES IT. With no §9A admission presented,
    /// the next gate refuses on correlation — which is the proof that binding was satisfied, since
    /// that gate stands behind it.
    #[test]
    fn a_claim_that_agrees_with_the_host_passes_the_binding_gate() {
        let v = verified(delegation());
        let f = facts(&v);
        let resp = evaluate(&bound_request(1, &host_subject()), &v, &f);
        assert_eq!(resp.reason(), RejectionReason::CorrelationMismatch);
        assert_eq!(resp.state(), ResponseState::Rejected);
    }

    /// A CALLER CANNOT SUBSTITUTE ITS CANDIDATE FOR THE HOST'S. The host resolved candidate A; the
    /// caller claims candidate B, correctly hashed. Refused at the binding gate.
    #[test]
    fn a_caller_cannot_substitute_its_candidate_for_the_hosts() {
        let v = verified(delegation());
        let f = facts(&v); // host resolved D_CANDIDATE
        let mut claim = host_subject();
        claim.candidate_digest = [0x89; BINDING_DIGEST_LEN];
        let resp = evaluate(&bound_request(1, &claim), &v, &f);
        assert_eq!(resp.reason(), RejectionReason::BindingMismatch);
    }

    /// A CLAIM THAT DISAGREES WITH THE HOST ON ANY BOUND FIELD IS REFUSED: project, repository,
    /// plan, plan digest, phase, candidate, model policy, credential reference — each on its own.
    ///
    /// Note what is NOT being tested: the delegation. Every one of these claims is evaluated
    /// against facts that AGREE with the delegation, so the only disagreement is caller vs host.
    #[test]
    fn a_claim_that_disagrees_with_the_host_on_any_field_is_refused() {
        let v = verified(delegation());
        let f = facts(&v);
        let rewrites: [ClaimRewrite; 8] = [
            |c| c.project = OTHER,
            |c| c.repository = OTHER,
            |c| c.plan = OTHER,
            |c| c.plan_digest = OTHER,
            |c| c.phase = D_OTHER_PHASE,
            |c| c.candidate_digest = OTHER,
            |c| c.model_policy = OTHER,
            |c| c.credential_ref = OTHER,
        ];
        for (i, rewrite) in rewrites.into_iter().enumerate() {
            let mut claim = host_subject();
            rewrite(&mut claim);
            let resp = evaluate(&bound_request(1, &claim), &v, &f);
            assert_eq!(
                resp.reason(),
                RejectionReason::BindingMismatch,
                "claim rewrite {i} must be refused at the binding gate"
            );
        }
    }

    /// THE OPERATION IS BOUND TOO, and it is bound through the wire's own class byte: a claim
    /// hashed for one class, sent under another, disagrees with the host.
    #[test]
    fn a_claim_hashed_for_another_operation_is_refused() {
        let v = verified(delegation());
        let f = facts(&v);
        let mut claim = host_subject();
        claim.operation = OperationClass::StagingRead;
        // Hash for StagingRead, send as the gatekeeper review.
        let r = ProtectedOperationRequest::new(
            [1u8; CORRELATION_LEN],
            SEQ,
            42,
            binding_digest(&claim),
            OperationClass::IndependentGatekeeperReview,
            D_ID,
            D_PARAMS,
        );
        assert_eq!(
            evaluate(&r, &v, &f).reason(),
            RejectionReason::BindingMismatch
        );
    }

    /// THE HOST-RESOLVED PHASE IS THE ONLY PHASE. The host resolved a phase the delegation does not
    /// list, and the caller's claim names the listed one: C4 refuses on the host's phase, and the
    /// caller's agreeable claim changes nothing.
    #[test]
    fn a_caller_cannot_name_a_listed_phase_the_host_did_not_resolve() {
        let v = verified(delegation());
        let mut raw = base_facts();
        raw.phase = D_OTHER_PHASE; // the host's word
        let f = facts_of(&v, raw);
        let resp = evaluate(&bound_request(1, &host_subject()), &v, &f); // claims D_PHASE
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    /// THE APPROVAL REFERENCE MUST NAME THE VERIFIED DELEGATION. A correct subject under a
    /// different approval reference is refused: the caller does not choose which delegation it
    /// runs under.
    #[test]
    fn an_approval_ref_that_does_not_name_the_delegation_is_refused() {
        let v = verified(delegation());
        let f = facts(&v);
        let r = ProtectedOperationRequest::new(
            [1u8; CORRELATION_LEN],
            SEQ,
            42,
            binding_digest(&host_subject()),
            OperationClass::IndependentGatekeeperReview,
            OTHER,
            D_PARAMS,
        );
        assert_eq!(
            evaluate(&r, &v, &f).reason(),
            RejectionReason::BindingMismatch
        );
    }

    /// THE PARAMETER DIGEST MUST BE THE HOST'S (§9C). The host resolved the digest of the exact
    /// request body it read from its own inbox; a claim naming any other body is refused at the
    /// binding gate, and one naming the host's passes it.
    #[test]
    fn a_parameter_digest_that_is_not_the_hosts_is_refused() {
        let v = verified(delegation());
        let f = facts(&v); // host resolved D_PARAMS
        let mut r = bound_request(1, &host_subject());
        r.parameter_digest = [0x5B; BINDING_DIGEST_LEN];
        assert_eq!(
            evaluate(&r, &v, &f).reason(),
            RejectionReason::BindingMismatch
        );
        // Same claim, host resolved a different body: refused too.
        let mut raw = base_facts();
        raw.parameter_digest = [0x5C; BINDING_DIGEST_LEN];
        assert_eq!(
            evaluate(&bound_request(1, &host_subject()), &v, &facts_of(&v, raw)).reason(),
            RejectionReason::BindingMismatch
        );
        // Positive control: agreeing digests pass the binding gate (next gate refuses).
        assert_eq!(
            evaluate(&bound_request(1, &host_subject()), &v, &f).reason(),
            RejectionReason::CorrelationMismatch
        );
    }

    /// FACTS ARE HASHED, NOT READ OFF THE CLAIM. The same claim evaluated against facts whose
    /// candidate the host resolved differently is refused — proving the host's digest comes from
    /// the host's facts and not from the request.
    #[test]
    fn the_host_digest_follows_the_hosts_facts_not_the_claim() {
        let v = verified(delegation());
        let claim = bound_request(1, &host_subject());
        assert_eq!(
            evaluate(&claim, &v, &facts(&v)).reason(),
            RejectionReason::CorrelationMismatch,
            "agreeing facts pass the binding gate"
        );
        let mut raw = base_facts();
        raw.candidate_digest = [0x89; BINDING_DIGEST_LEN];
        assert_eq!(
            evaluate(&claim, &v, &facts_of(&v, raw)).reason(),
            RejectionReason::BindingMismatch,
            "the host resolved another candidate; the unchanged claim now disagrees"
        );
    }

    /// BINDING IS CHECKED AFTER THE INSTANCE AND BEFORE FRESHNESS. A wrong epoch reports the
    /// epoch even with a wrong binding; a right binding with no admission reports correlation.
    #[test]
    fn binding_sits_between_the_instance_check_and_the_freshness_check() {
        let v = verified(delegation());
        let f = facts(&v);
        let ev = evidence(&v, &f);
        let mut wrong_epoch = gatekeeper_request(1);
        wrong_epoch.claimed_service_epoch = 41;
        assert_eq!(
            eval_response(&wrong_epoch, Some(&peer()), Some(&ev), None, 42).reason(),
            RejectionReason::ServiceEpochMismatch
        );
        assert_eq!(
            evaluate(&gatekeeper_request(1), &v, &f).reason(),
            RejectionReason::BindingMismatch
        );
        assert_eq!(
            evaluate(&bound_request(1, &host_subject()), &v, &f).reason(),
            RejectionReason::CorrelationMismatch
        );
    }

    /// NO ADMISSION, NO AUTHORITY. Every fact agreeing is not enough without the §9A proof, and the
    /// rendered answer is a refusal, not an acceptance.
    #[test]
    fn a_fully_bound_request_without_an_admission_mints_nothing() {
        let v = verified(delegation());
        let f = facts(&v);
        let ev = evidence(&v, &f);
        let outcome = evaluate_protected_operation(
            &bound_request(1, &host_subject()),
            Some(&peer()),
            Some(&ev),
            None,
            42,
        );
        assert!(outcome.authority().is_none());
        let resp = outcome.response();
        assert_eq!(resp.state(), ResponseState::Rejected);
        assert_eq!(resp.result(), ResultClass::NotRun);
    }

    // ---- §9A REUSE + §9C MINT: the canonical admission, read here and not widened ---------------
    //
    // These need a real `BoundIpcSession`, which only the core fixture verifier can mint, so they
    // run under the non-default `test-fixtures` graph. What they prove: the evaluator consumes the
    // §9A `AdmittedRequest` as the freshness proof, requires it to answer THIS correlation on THIS
    // peer's connection, requires the admitted sequence to be the frame's sequence — and, with
    // every rung present, mints exactly one authority that means admission and nothing more.

    #[cfg(feature = "test-fixtures")]
    mod admission {
        use super::*;
        use crate::fixture_session::fixture_bound_session;
        use projectos_host_core::{
            BoundIpcSession, FixtureClock, FixtureIpcSessionVerifier,
            InMemoryRequestAdmissionStore, IpcSessionVerifier, RequestAdmissionError,
        };

        /// One live canonical session on the fixture verifier's host-issued connection.
        fn session(c: &FixtureClock, v: &FixtureIpcSessionVerifier) -> BoundIpcSession {
            fixture_bound_session(c, v)
        }

        /// The peer context for the SAME host-issued connection the session is bound to.
        fn peer_for(v: &FixtureIpcSessionVerifier) -> TrustedPeerContext {
            TrustedPeerContext::for_admitted_connection(v.connection_id(), v.handshake_generation())
        }

        /// Everything the exact case needs, minted fresh: a session, its store, the verified
        /// delegation and agreeing facts.
        struct Exact {
            verifier: FixtureIpcSessionVerifier,
            session: BoundIpcSession,
            store: InMemoryRequestAdmissionStore,
            delegation: VerifiedOwnerProgrammeDelegation,
        }

        impl Exact {
            fn new() -> Self {
                let clock = FixtureClock::new(150);
                let verifier = FixtureIpcSessionVerifier::new();
                let session = session(&clock, &verifier);
                let store = InMemoryRequestAdmissionStore::for_session(&session);
                Self {
                    verifier,
                    session,
                    store,
                    delegation: verified(delegation()),
                }
            }
        }

        /// Admit `r` on the session (a free function over disjoint fields, so the delegation can
        /// stay borrowed by the evidence while the store is written).
        fn admit(
            session: &BoundIpcSession,
            store: &mut InMemoryRequestAdmissionStore,
            r: &ProtectedOperationRequest,
        ) -> AdmittedRequest {
            session
                .admit_request(store, *r.correlation(), r.sequence())
                .expect("fresh on this session")
        }

        /// THE ONE POSITIVE CASE. Delegation, peer, epoch, binding, parameter digest and a genuine
        /// §9A admission for this correlation on this connection: the evaluator mints an
        /// AuthorisedProtectedOperation that carries exactly what was proven, and renders as
        /// Accepted / NotRun.
        #[test]
        fn the_exact_gatekeeper_review_is_authorised_and_renders_as_accepted_not_run() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let admitted = admit(&x.session, &mut x.store, &r);

            let outcome = evaluate_protected_operation(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            );
            let authority = outcome
                .authority()
                .expect("the exact case must be authorised");
            assert_eq!(
                authority.operation(),
                OperationClass::IndependentGatekeeperReview
            );
            assert_eq!(authority.correlation(), r.correlation());
            assert_eq!(authority.sequence(), SEQ);
            assert_eq!(authority.service_epoch(), 42);
            assert!(authority.is_bound_to(
                x.verifier.connection_id(),
                x.verifier.handshake_generation()
            ));
            assert_eq!(authority.delegation_id(), &D_ID);
            assert_eq!(authority.binding_digest(), &binding_digest(&host_subject()));
            assert_eq!(authority.candidate_digest(), &D_CANDIDATE);
            assert_eq!(authority.parameter_digest(), &D_PARAMS);
            assert_eq!(authority.admitted_cost_micro_usd(), 200_000);

            // Rendered: admitted, and NOTHING RAN.
            let resp = outcome.response();
            assert_eq!(resp.state(), ResponseState::Accepted);
            assert_eq!(resp.result(), ResultClass::NotRun);
            assert_eq!(resp.correlation(), r.correlation());
            assert!(resp.answers(r.correlation(), 42));
        }

        /// AUTHORITY ALONE IS NOT COMPLETION. There is no execution evidence in this checkpoint and
        /// no production way to make one, so a holder of a fresh authority cannot render Completed.
        /// The only evidence constructor is `cfg(test)`, and even that must name the authority's
        /// own correlation.
        #[test]
        fn a_fresh_authority_alone_cannot_render_completed() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let admitted = admit(&x.session, &mut x.store, &r);
            let authority = evaluate_protected_operation(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            )
            .into_authority()
            .expect("authorised");

            // Evidence about ANOTHER correlation renders nothing.
            let foreign = ExecutionOutcomeEvidence::for_test(
                [2u8; CORRELATION_LEN],
                ResultClass::Succeeded,
                [6u8; EVIDENCE_REF_LEN],
            );
            assert!(ProtectedOperationResponse::completed(&authority, &foreign).is_none());

            // Evidence about THIS correlation - obtainable here only through the test constructor -
            // renders Completed, distinct from Accepted.
            let own = ExecutionOutcomeEvidence::for_test(
                *authority.correlation(),
                ResultClass::Succeeded,
                [6u8; EVIDENCE_REF_LEN],
            );
            let completed = ProtectedOperationResponse::completed(&authority, &own)
                .expect("evidence for this authority");
            assert_eq!(completed.state(), ResponseState::Completed);
            assert_eq!(completed.result(), ResultClass::Succeeded);
            let accepted = ProtectedOperationResponse::accepted(&authority);
            assert_eq!(accepted.state(), ResponseState::Accepted);
            assert_eq!(accepted.result(), ResultClass::NotRun);
            assert_ne!(accepted.state(), completed.state());
        }

        /// ONE ADMISSION, ONE AUTHORITY. The admission is CONSUMED by evaluation and cannot be
        /// presented again, and the session refuses to admit the same correlation twice - so a
        /// replayed frame can never reach a fresh authority.
        #[test]
        fn a_replayed_request_cannot_reach_a_fresh_authority() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let admitted = admit(&x.session, &mut x.store, &r);
            let first = evaluate_protected_operation(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            );
            assert!(first.authority().is_some());
            // The admission moved into `first`; the only way to evaluate again is a NEW admission,
            // and the session refuses one for a correlation it already admitted.
            assert_eq!(
                x.session
                    .admit_request(&mut x.store, *r.correlation(), r.sequence())
                    .unwrap_err(),
                RequestAdmissionError::SequenceNotAdvancing
            );
            assert_eq!(
                x.session
                    .admit_request(&mut x.store, *r.correlation(), r.sequence() + 1)
                    .unwrap_err(),
                RequestAdmissionError::CorrelationReplayed
            );
            // With no admission, the replay is refused before any authority.
            let replay =
                evaluate_protected_operation(&r, Some(&peer_for(&x.verifier)), Some(&ev), None, 42);
            assert!(replay.authority().is_none());
            assert_eq!(
                replay.response().reason(),
                RejectionReason::CorrelationMismatch
            );
        }

        /// AN ADMISSION FROM ANOTHER CONNECTION DOES NOT ANSWER THIS PEER. Same correlation, same
        /// sequence, admitted on a session bound to a different host-issued connection.
        #[test]
        fn an_admission_on_another_connection_is_refused() {
            let mut x = Exact::new();
            let this_conn = FixtureIpcSessionVerifier::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let foreign = admit(&x.session, &mut x.store, &r); // admitted on x's connection, presented for this_conn's peer
            let resp = eval_response(
                &r,
                Some(&peer_for(&this_conn)),
                Some(&ev),
                Some(foreign),
                42,
            );
            assert_eq!(resp.reason(), RejectionReason::CorrelationMismatch);
        }

        /// A PEER FROM ANOTHER HANDSHAKE GENERATION IS NOT THIS PEER. The admission is genuine for the
        /// connection; the peer context presented is from a re-handshake.
        #[test]
        fn a_peer_from_another_handshake_generation_is_refused() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let admitted = admit(&x.session, &mut x.store, &r);
            let stale_peer = TrustedPeerContext::for_admitted_connection(
                x.verifier.connection_id(),
                x.verifier.handshake_generation() + 1,
            );
            let resp = eval_response(&r, Some(&stale_peer), Some(&ev), Some(admitted), 42);
            assert_eq!(resp.reason(), RejectionReason::CorrelationMismatch);
        }

        /// AN ADMISSION FOR ANOTHER CORRELATION DOES NOT ANSWER THIS REQUEST.
        #[test]
        fn an_admission_for_another_correlation_is_refused() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let other = bound_request(2, &host_subject());
            let admitted = admit(&x.session, &mut x.store, &other);
            let r = bound_request(1, &host_subject());
            let resp = eval_response(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            );
            assert_eq!(resp.reason(), RejectionReason::CorrelationMismatch);
        }

        /// THE ADMITTED SEQUENCE MUST BE THE FRAME'S SEQUENCE. A genuine admission for this
        /// correlation at another sequence is a different request.
        #[test]
        fn an_admission_at_another_sequence_is_refused() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = bound_request(1, &host_subject());
            let admitted = x
                .session
                .admit_request(&mut x.store, *r.correlation(), SEQ + 1)
                .unwrap();
            let resp = eval_response(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            );
            assert_eq!(resp.reason(), RejectionReason::SequenceRefused);
        }

        /// ADMISSION IS READ, NOT WIDENED. A genuine admission with a WRONG binding is still refused
        /// on the binding — being fresh does not make a request about what the caller says.
        #[test]
        fn a_genuine_admission_does_not_rescue_a_wrong_binding() {
            let mut x = Exact::new();
            let f = facts(&x.delegation);
            let ev = evidence(&x.delegation, &f);
            let r = gatekeeper_request(1); // placeholder binding claim
            let admitted = admit(&x.session, &mut x.store, &r);
            let resp = eval_response(
                &r,
                Some(&peer_for(&x.verifier)),
                Some(&ev),
                Some(admitted),
                42,
            );
            assert_eq!(resp.reason(), RejectionReason::BindingMismatch);
        }

        /// EVERY OTHER RUNG STILL REFUSES WITH A GENUINE ADMISSION PRESENT. The admission is the last
        /// gate; it rescues nothing in front of it. One focused case per rung.
        #[test]
        fn a_genuine_admission_rescues_no_earlier_refusal() {
            // No peer.
            {
                let mut x = Exact::new();
                let f = facts(&x.delegation);
                let ev = evidence(&x.delegation, &f);
                let r = bound_request(1, &host_subject());
                let admitted = admit(&x.session, &mut x.store, &r);
                assert_eq!(
                    eval_response(&r, None, Some(&ev), Some(admitted), 42).reason(),
                    RejectionReason::PeerNotAuthenticated
                );
            }
            // Stale service epoch.
            {
                let mut x = Exact::new();
                let f = facts(&x.delegation);
                let ev = evidence(&x.delegation, &f);
                let mut r = bound_request(1, &host_subject());
                r.claimed_service_epoch = 41;
                let admitted = admit(&x.session, &mut x.store, &r);
                assert_eq!(
                    eval_response(
                        &r,
                        Some(&peer_for(&x.verifier)),
                        Some(&ev),
                        Some(admitted),
                        42
                    )
                    .reason(),
                    RejectionReason::ServiceEpochMismatch
                );
            }
            // Locally revoked delegation: the facts' clock is fine, but the C4 rung refuses on
            // the signed flag, and the delegation rung refuses locally-ended ones before facts
            // ever exist. Here: signed-ended.
            {
                let mut x = Exact::new();
                let mut d = delegation();
                d.revoked_or_completed = true;
                x.delegation = verified(d);
                let f = facts(&x.delegation);
                let ev = evidence(&x.delegation, &f);
                let r = bound_request(1, &host_subject());
                let admitted = admit(&x.session, &mut x.store, &r);
                assert_eq!(
                    eval_response(
                        &r,
                        Some(&peer_for(&x.verifier)),
                        Some(&ev),
                        Some(admitted),
                        42
                    )
                    .reason(),
                    RejectionReason::OwnerPresenceGateOpen
                );
            }
            // Unknown cost.
            {
                let mut x = Exact::new();
                let mut raw = base_facts();
                raw.admitted_cost_micro_usd = None;
                let f = facts_of(&x.delegation, raw);
                let ev = evidence(&x.delegation, &f);
                let r = bound_request(1, &host_subject());
                let admitted = admit(&x.session, &mut x.store, &r);
                assert_eq!(
                    eval_response(
                        &r,
                        Some(&peer_for(&x.verifier)),
                        Some(&ev),
                        Some(admitted),
                        42
                    )
                    .reason(),
                    RejectionReason::OwnerPresenceGateOpen
                );
            }
            // Another operation class, with everything else agreeing: never authorised.
            for other in [
                OperationClass::ProviderIdentityRead,
                OperationClass::StagingRead,
            ] {
                let mut x = Exact::new();
                let f = facts(&x.delegation);
                let ev = evidence(&x.delegation, &f);
                let mut subject = host_subject();
                subject.operation = other;
                let r = bound_request(1, &subject);
                let admitted = admit(&x.session, &mut x.store, &r);
                let outcome = evaluate_protected_operation(
                    &r,
                    Some(&peer_for(&x.verifier)),
                    Some(&ev),
                    Some(admitted),
                    42,
                );
                assert!(
                    outcome.authority().is_none(),
                    "{other:?} must never be authorised"
                );
                assert_eq!(
                    outcome.response().reason(),
                    RejectionReason::OwnerPresenceGateOpen
                );
            }
        }

        /// PROVIDER IDENTITY READ AND STAGING READ CANNOT USE THE DELEGATED AUTHORITY PATH, even
        /// with a delegation that (impossibly, but say it did) named them: the delegable set is
        /// closed at the class, not at the record.
        #[test]
        fn provider_identity_read_and_staging_read_cannot_use_the_delegated_authority() {
            for other in [
                OperationClass::ProviderIdentityRead,
                OperationClass::StagingRead,
            ] {
                let mut x = Exact::new();
                let mut d = delegation();
                d.operation = other;
                x.delegation = verified(d);
                let mut raw = base_facts();
                raw.protected_effect_requested = false;
                let f = facts_of(&x.delegation, raw);
                let ev = evidence(&x.delegation, &f);
                let mut subject = host_subject();
                subject.operation = other;
                let r = bound_request(1, &subject);
                let admitted = admit(&x.session, &mut x.store, &r);
                let outcome = evaluate_protected_operation(
                    &r,
                    Some(&peer_for(&x.verifier)),
                    Some(&ev),
                    Some(admitted),
                    42,
                );
                assert!(outcome.authority().is_none());
                assert_eq!(
                    outcome.response().reason(),
                    RejectionReason::OwnerPresenceGateOpen
                );
            }
        }
    }
}
