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
//!    bounded attempt and never crosses into this crate. **There is no production constructor at all**,
//!    so no shipped code path can produce one; minting it from a canonical attempt outcome is phase 4.
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
/// SEALED, and constructible only via [`HostResolvedRequestFacts::resolved_by_host`], which requires
/// a [`VerifiedOwnerProgrammeDelegation`]. Fabricated facts therefore mint nothing on their own: a
/// caller that cannot obtain a verified delegation cannot obtain facts either, and a caller that
/// somehow held a verified delegation is already past the rung that matters.
///
/// The caller's frame carries digests; these are the values the host derived for itself from
/// repository state, the plan record and the phase record. Any disagreement is a refusal.
/// NOT `Copy` AND NOT `Clone`, deliberately. These facts now carry the host's clock reading, and a
/// cacheable bundle containing a clock is a clock that goes stale: a caller could resolve one set
/// per phase for efficiency and reuse it across many correlations, silently freezing the expiry
/// check against a reading from long before real time passed `expires_at_epoch_s`. Without `Copy`
/// each request must construct its own, which is the natural place to take a fresh reading. Raised
/// by the Rust review as the trade this move introduced.
#[derive(Debug, PartialEq, Eq)]
pub struct HostResolvedRequestFacts {
    _seal: Seal,
    project: [u8; DELEGATION_DIGEST_LEN],
    repository: [u8; DELEGATION_DIGEST_LEN],
    plan: [u8; DELEGATION_DIGEST_LEN],
    plan_digest: [u8; DELEGATION_DIGEST_LEN],
    phase: [u8; DELEGATION_DIGEST_LEN],
    model_policy: [u8; DELEGATION_DIGEST_LEN],
    credential_ref: [u8; DELEGATION_DIGEST_LEN],
    committed_spend_micro_usd: u64,
    admitted_cost_micro_usd: Option<u64>,
    protected_effect_requested: bool,
    now_epoch_s: u64,
}

/// What the host resolved, as NAMED FIELDS.
///
/// The constructor used to take twelve positional arguments, seven of them `[u8; 32]` and three of
/// them `u64`. Transposing `project` and `repository`, or `plan` and `plan_digest`, would have
/// compiled silently and bound the delegation to the wrong thing — the compiler cannot tell one
/// digest from another. Named fields make that mistake a build error instead.
///
/// This struct is plain data and caller-constructible; it is not a rung of the authority ladder. The
/// SEALED thing is what comes out of [`HostResolvedRequestFacts::resolved_by_host`], which still
/// demands a verified delegation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostResolvedFacts {
    pub project: [u8; DELEGATION_DIGEST_LEN],
    pub repository: [u8; DELEGATION_DIGEST_LEN],
    pub plan: [u8; DELEGATION_DIGEST_LEN],
    pub plan_digest: [u8; DELEGATION_DIGEST_LEN],
    pub phase: [u8; DELEGATION_DIGEST_LEN],
    pub model_policy: [u8; DELEGATION_DIGEST_LEN],
    pub credential_ref: [u8; DELEGATION_DIGEST_LEN],
    pub committed_spend_micro_usd: u64,
    /// `None` when the cost could not be established. An unknown cost is refused, never spent as
    /// zero — that is how a ceiling stops being one.
    pub admitted_cost_micro_usd: Option<u64>,
    pub protected_effect_requested: bool,
    /// The HOST's own clock reading, taken for THIS request. A clock a caller could supply is a
    /// delegation that never expires.
    pub now_epoch_s: u64,
}

impl HostResolvedRequestFacts {
    /// Record what the host resolved. Requires a verified delegation, so facts are never a rung of
    /// their own.
    #[must_use]
    pub fn resolved_by_host(
        _delegation: &VerifiedOwnerProgrammeDelegation,
        f: HostResolvedFacts,
    ) -> Self {
        Self {
            _seal: Seal,
            project: f.project,
            repository: f.repository,
            plan: f.plan,
            plan_digest: f.plan_digest,
            phase: f.phase,
            model_policy: f.model_policy,
            credential_ref: f.credential_ref,
            committed_spend_micro_usd: f.committed_spend_micro_usd,
            admitted_cost_micro_usd: f.admitted_cost_micro_usd,
            protected_effect_requested: f.protected_effect_requested,
            now_epoch_s: f.now_epoch_s,
        }
    }
}

/// Everything the request-scoped C4 path needs, gathered so [`evaluate_protected_operation`] keeps
/// one optional authority argument rather than four.
///
/// The two authority members are sealed types, so assembling this is not a way around the ladder;
/// `requested_phase` is the caller's CLAIM and is checked against both of them.
#[derive(Debug, Clone, Copy)]
pub struct GatekeeperDelegationEvidence<'a> {
    /// The delegation whose provenance the host verified.
    pub delegation: &'a VerifiedOwnerProgrammeDelegation,
    /// What the host independently resolved for this request.
    pub facts: &'a HostResolvedRequestFacts,
    /// The phase this request CLAIMS. Untrusted by design — it is compared against the host's own
    /// resolution in `facts.phase` and against the delegation's allowed list, and a disagreement with
    /// either is a refusal.
    pub requested_phase: &'a [u8; DELEGATION_DIGEST_LEN],
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
    let requested_phase = evidence.requested_phase;

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
    // 5. A PHASE THE OWNER LISTED. The host's resolved phase and the phase this request claims must
    //    be the same phase, and it must be one the delegation names.
    if facts.phase != *requested_phase {
        return None;
    }
    let listed = delegation
        .allowed_phases
        .iter()
        .take(delegation.allowed_phase_count as usize)
        .any(|p| p == requested_phase);
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
/// work can produce an acceptance while owner presence is unproven. The gate is always open and
/// [`TrustedPeerContext`] has no production constructor, so the only reachable answer is a refusal and
/// `peer` is `None` on every shipped path.
#[must_use]
pub fn evaluate_protected_operation(
    request: &ProtectedOperationRequest,
    peer: Option<&TrustedPeerContext>,
    delegated: Option<&GatekeeperDelegationEvidence<'_>>,
    service_epoch: u64,
) -> ProtectedOperationResponse {
    // 1. C4 FIRST. Still a hard stop, now with exactly one narrow way past it.
    //
    //    The global gate is unchanged and still answers `false`, so every operation class keeps the
    //    unconditional stop it has today. The only alternative is a presence MINTED HERE, inside
    //    this call, from a VERIFIED owner programme delegation — and it is re-checked rather than
    //    trusted on sight: it must answer this exact correlation and this exact operation class.
    //
    //    The presence is minted and consumed within this expression and never escapes, which is why
    //    its type is crate-private and no caller can name it: there is no window in which a presence
    //    exists as a value someone could hold, store, or carry to a second request.
    let c4_satisfied = OwnerPresenceGate::current().is_closed()
        || delegated
            .and_then(|e| satisfy_c4_for_gatekeeper_request(e, request))
            .is_some_and(|p| p.answers(request.correlation(), request.operation()));
    if !c4_satisfied {
        return ProtectedOperationResponse::rejected(
            *request.correlation(),
            RejectionReason::OwnerPresenceGateOpen,
            service_epoch,
            TerminalStatus::Terminal,
        );
    }
    // 2. An admitted peer is mandatory. Canonical peer identity is established inside the
    //    identity-proof crate's attempt; wiring its outcome to a context here is phase 4.
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
        // The DTO carries a client_session_ref. It is a claim. Changing it must not reach the trusted
        // context, and there is no conversion from the request into one — there cannot be, because the
        // only constructor is test-only and takes host-issued values.
        let ctx = TrustedPeerContext::for_admitted_connection(77, 5);
        let mut r = request();
        r.client_session_ref = [0xFFu8; SESSION_REF_LEN];
        let resp = evaluate_protected_operation(&r, Some(&ctx), None, 42);
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
        let resp = evaluate_protected_operation(&request(), Some(&ctx), None, 42);
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
                let resp = evaluate_protected_operation(&r, Some(&ctx), None, 42);
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
        let resp = evaluate_protected_operation(&request(), None, None, 42);
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
        let resp = evaluate_protected_operation(&r, None, None, 42);
        assert_eq!(resp.reason(), RejectionReason::OwnerPresenceGateOpen);
    }

    #[test]
    fn no_evaluation_path_returns_accepted_or_completed() {
        for epoch in [0u64, 42, u64::MAX] {
            for seq in [0u64, 1, u64::MAX] {
                let mut r = request();
                r.sequence = seq;
                r.claimed_service_epoch = epoch;
                let resp = evaluate_protected_operation(&r, None, None, 42);
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
            [0u8; SESSION_REF_LEN],
            [0u8; BINDING_DIGEST_LEN],
        );
        let response = evaluate_protected_operation(&request, Some(&peer), None, 42);
        assert_eq!(response.state(), ResponseState::Rejected);
        assert_eq!(response.reason(), RejectionReason::OwnerPresenceGateOpen);
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
    const OTHER: [u8; DELEGATION_DIGEST_LEN] = [0x99; DELEGATION_DIGEST_LEN];

    /// One rewrite of the host's resolved facts, named so the table below stays readable.
    type FactRewrite = fn(&mut HostResolvedFacts);
    const D_MODEL: [u8; DELEGATION_DIGEST_LEN] = [0x66; DELEGATION_DIGEST_LEN];
    const D_CRED: [u8; DELEGATION_DIGEST_LEN] = [0x77; DELEGATION_DIGEST_LEN];
    const NOW: u64 = 1_000;

    /// A gatekeeper request. Correlation differs from the base fixture so a presence minted for one
    /// cannot silently satisfy the other.
    fn gatekeeper_request(correlation: u8) -> ProtectedOperationRequest {
        ProtectedOperationRequest::new(
            [correlation; CORRELATION_LEN],
            7,
            42,
            [2u8; BINDING_DIGEST_LEN],
            OperationClass::IndependentGatekeeperReview,
            [3u8; APPROVAL_REF_LEN],
            [4u8; SESSION_REF_LEN],
            [5u8; BINDING_DIGEST_LEN],
        )
    }

    fn delegation() -> OwnerProgrammeDelegation {
        let mut allowed = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
        allowed[0] = D_PHASE;
        OwnerProgrammeDelegation {
            delegation_id: [0xAA; DELEGATION_DIGEST_LEN],
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

    /// Host-resolved facts that agree with the delegation in every respect.
    fn base_facts() -> HostResolvedFacts {
        HostResolvedFacts {
            project: D_PROJECT,
            repository: D_REPO,
            plan: D_PLAN,
            plan_digest: D_PLAN_DIGEST,
            phase: D_PHASE,
            model_policy: D_MODEL,
            credential_ref: D_CRED,
            committed_spend_micro_usd: 3_659_841,
            admitted_cost_micro_usd: Some(200_000),
            protected_effect_requested: false,
            now_epoch_s: NOW,
        }
    }

    fn facts(v: &VerifiedOwnerProgrammeDelegation) -> HostResolvedRequestFacts {
        HostResolvedRequestFacts::resolved_by_host(v, base_facts())
    }

    fn facts_of(
        v: &VerifiedOwnerProgrammeDelegation,
        f: HostResolvedFacts,
    ) -> HostResolvedRequestFacts {
        HostResolvedRequestFacts::resolved_by_host(v, f)
    }

    fn evidence<'a>(
        v: &'a VerifiedOwnerProgrammeDelegation,
        f: &'a HostResolvedRequestFacts,
        phase: &'a [u8; DELEGATION_DIGEST_LEN],
    ) -> GatekeeperDelegationEvidence<'a> {
        GatekeeperDelegationEvidence {
            delegation: v,
            facts: f,
            requested_phase: phase,
        }
    }

    /// Does this exact case get past C4? The only question every proof below asks.
    fn admitted(
        v: &VerifiedOwnerProgrammeDelegation,
        f: &HostResolvedRequestFacts,
        phase: &[u8; DELEGATION_DIGEST_LEN],
        correlation: u8,
    ) -> bool {
        let ev = evidence(v, f, phase);
        let resp = evaluate_protected_operation(
            &gatekeeper_request(correlation),
            Some(&TrustedPeerContext::for_admitted_connection(5, 1)),
            Some(&ev),
            42,
        );
        resp.reason() != RejectionReason::OwnerPresenceGateOpen
    }

    /// The exact case, with one delegation field rewritten. Must be refused.
    fn refused_when(mutate: impl FnOnce(&mut OwnerProgrammeDelegation)) -> bool {
        let mut d = delegation();
        mutate(&mut d);
        let v = verified(d);
        let f = facts(&v);
        !admitted(&v, &f, &D_PHASE, 1)
    }

    /// The exact case, with one HOST-RESOLVED fact rewritten. Must be refused.
    fn refused_with_facts(mutate: impl FnOnce(&mut HostResolvedFacts)) -> bool {
        let v = verified(delegation());
        let mut raw = base_facts();
        mutate(&mut raw);
        let f = facts_of(&v, raw);
        let phase = raw.phase;
        !admitted(&v, &f, &phase, 1)
    }

    /// (8) THE ONE PATH THAT WORKS.
    #[test]
    fn an_exact_verified_delegation_and_request_gets_past_c4() {
        let v = verified(delegation());
        let f = facts(&v);
        assert!(
            admitted(&v, &f, &D_PHASE, 1),
            "the exact case must be admitted"
        );
    }

    /// (6) NO DELEGATION, NO PRESENCE. There is no phrase, flag or configuration that substitutes.
    #[test]
    fn a_gatekeeper_request_without_a_delegation_is_still_stopped_at_c4() {
        let resp = evaluate_protected_operation(
            &gatekeeper_request(1),
            Some(&TrustedPeerContext::for_admitted_connection(5, 1)),
            None,
            42,
        );
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
        raw.delegation_id = OTHER;

        // And it satisfies nothing: `evaluate_protected_operation` takes the sealed evidence, so a
        // raw record cannot even be offered to it. The only way to proceed is `for_test`, which is
        // `cfg(test)` and private — no shipped graph contains it.
        let resp = evaluate_protected_operation(
            &gatekeeper_request(1),
            Some(&TrustedPeerContext::for_admitted_connection(5, 1)),
            None,
            42,
        );
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
            admitted(&v, &f, &D_PHASE, 1),
            "the owner field is a name, not the control — the control is that `for_test` is the only \
             way to reach this rung, and it does not ship"
        );
    }

    /// (10) ANOTHER PLAN, A RE-AUTHORED PLAN DIGEST, ANOTHER PROJECT OR REPOSITORY, AN UNAPPROVED
    /// MODEL OR CREDENTIAL, OR A PROTECTED EFFECT.
    ///
    /// The plan DIGEST case matters most: a delegation following a plan id alone would keep
    /// authorising after the plan was re-authored into something the owner never read.
    #[test]
    fn facts_that_disagree_with_the_delegation_are_refused() {
        let cases: [(&str, FactRewrite); 7] = [
            ("another project", |f| f.project = OTHER),
            ("another repository", |f| f.repository = OTHER),
            ("another plan id", |f| f.plan = OTHER),
            ("a re-authored plan digest", |f| f.plan_digest = OTHER),
            ("an unapproved model policy", |f| f.model_policy = OTHER),
            ("an unapproved credential reference", |f| {
                f.credential_ref = OTHER
            }),
            ("a protected effect requested", |f| {
                f.protected_effect_requested = true
            }),
        ];
        for (what, mutate) in cases {
            assert!(refused_with_facts(mutate), "{what} must be refused");
        }
    }

    /// A phase the delegation does not list, and a host/claim phase disagreement.
    #[test]
    fn an_unlisted_or_disagreeing_phase_is_refused() {
        // Host resolved the other phase, and the request claims it: not listed by the delegation.
        assert!(refused_with_facts(|f| f.phase = D_OTHER_PHASE));

        // Host resolved the listed phase but the request claims another: they must agree.
        let v = verified(delegation());
        let f = facts(&v);
        assert!(!admitted(&v, &f, &D_OTHER_PHASE, 1));
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

    /// The CLOCK IS A SEALED HOST FACT, not an evidence field a wiring phase could source badly.
    ///
    /// Raised by the security review: `now_epoch_s` used to sit on the evidence struct as a plain
    /// public field, protected only by a comment saying a caller must never supply it. It now lives
    /// inside `HostResolvedRequestFacts`, whose fields are private and whose constructor already
    /// demands a verified delegation — so the reading is recorded beside the other things the host
    /// resolved, and there is no public field left to fill in from the wire.
    #[test]
    fn the_clock_is_a_sealed_host_resolved_fact() {
        let v = verified(delegation());

        // A reading before expiry is admitted; one at or after it is not. Same delegation, same
        // request, same everything else — only the host's own reading differs.
        let live = facts_of(&v, base_facts());
        assert!(admitted(&v, &live, &D_PHASE, 1));

        for reading in [NOW + 3_600, NOW + 3_601, u64::MAX] {
            assert!(
                refused_with_facts(|f| f.now_epoch_s = reading),
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
        let ev = evidence(&v, &f, &D_PHASE);

        for other in [
            OperationClass::ProviderIdentityRead,
            OperationClass::StagingRead,
        ] {
            let r = ProtectedOperationRequest::new(
                [1u8; CORRELATION_LEN],
                7,
                42,
                [2u8; BINDING_DIGEST_LEN],
                other,
                [3u8; APPROVAL_REF_LEN],
                [4u8; SESSION_REF_LEN],
                [5u8; BINDING_DIGEST_LEN],
            );
            let resp = evaluate_protected_operation(
                &r,
                Some(&TrustedPeerContext::for_admitted_connection(5, 1)),
                Some(&ev),
                42,
            );
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
    /// its own — and here it cannot, because the request it names is not the one being evaluated.
    #[test]
    fn the_same_evidence_does_not_admit_a_different_correlation() {
        let v = verified(delegation());
        let f = facts(&v);
        assert!(admitted(&v, &f, &D_PHASE, 1));

        // A different correlation is a different request. It still passes every delegation check —
        // which is exactly why the correlation re-check has to exist.
        let ev = evidence(&v, &f, &D_PHASE);
        let resp = evaluate_protected_operation(
            &gatekeeper_request(9),
            Some(&TrustedPeerContext::for_admitted_connection(5, 1)),
            Some(&ev),
            42,
        );
        assert_ne!(
            resp.reason(),
            RejectionReason::OwnerPresenceGateOpen,
            "the evidence is not correlation-bound; the presence minted from it is, and it is minted \
             for the request under evaluation"
        );
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
        assert!(!admitted(&v, &f, &D_OTHER_PHASE, 1));

        // And the zero padding is not a delegation for the all-zero phase.
        let zero = [0u8; DELEGATION_DIGEST_LEN];
        let v = verified(delegation());
        let mut raw = base_facts();
        raw.phase = zero;
        let f = facts_of(&v, raw);
        assert!(!admitted(&v, &f, &zero, 1));
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
}
