//! # ProjectOS host — bounded Windows local named-pipe transport (3K-I-D-E-C-CAPABILITY-B3)
//!
//! The DEFAULT build is the effect-free CD-B1 contract plus the safe transport adapter, protocol,
//! security-decision and verification logic — it performs NO Windows call. The live Windows named-pipe
//! backend compiles ONLY under the `windows-live-ipc` feature and even then invokes nothing without a
//! sealed [`adapter::LiveIpcOperationCapability`]. That capability has exactly ONE production route —
//! `owner-approved-status-read`, which consumes an exact-phrase owner approval and authorises only the
//! READ-ONLY installed-host status read (CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A). It is non-default and
//! is not implied by `windows-live-ipc`, so compiled capability is still never runtime authority.
//!
//! Unsafe is confined to `windows_ffi.rs` (crate lint `unsafe_code = "deny"`, re-allowed only there).
//! The adapter/protocol/security/verification modules contain no Windows call. Win32 errors are redacted
//! immediately to closed classifications; no raw handle/endpoint/SID/SDDL/name/error escapes. This crate
//! resolves NO SID and builds NO ACL/SDDL — it consumes host-authority's opaque pipe-security contract.
//! IPC alone never confirms authority; SCM corroboration remains independently required.
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     LocalOnlyTransport, LocalIpcTransportState, LOCAL_IPC_TRANSPORT_STATE,
//!     LIVE_LOCAL_IPC_AUTHORISED,
//! };
//! // The Windows transport is IMPLEMENTED but compile-only — no live IPC is authorised or reachable.
//! assert_eq!(
//!     LOCAL_IPC_TRANSPORT_STATE,
//!     LocalIpcTransportState::WindowsTransportImplementedCompileOnly
//! );
//! assert!(!LIVE_LOCAL_IPC_AUTHORISED);
//! assert_eq!(LocalOnlyTransport::policy(), LocalOnlyTransport::NamedPipeLocalOnly);
//! ```
//!
//! The sealed live-IPC capability has no public constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::LiveIpcOperationCapability;
//! let _ = LiveIpcOperationCapability { _sealed: () };
//! ```
//!
//! …and there is no factory either — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::LiveIpcOperationCapability;
//! let _ = LiveIpcOperationCapability::new();
//! ```
//!
//! There is no public arbitrary-bytes nonce constructor — this MUST NOT compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::Nonce;
//! let _ = Nonce::from_fixed_bytes([0u8; 32]);
//! ```
//!
//! ## The request-scoped C4 authority ladder is not forgeable from outside
//!
//! These examples are compiled as an EXTERNAL consumer of this crate, so they are a proof rather
//! than a claim: the ones marked `compile_fail` genuinely do not build, and `cargo test` fails if
//! any of them ever starts building.
//!
//! The untrusted rung IS reachable, deliberately — a parsed delegation record is a claim, and
//! claims are meant to be constructible:
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     OperationClass, OwnerProgrammeDelegation, DELEGATION_DIGEST_LEN, MAX_DELEGATED_PHASES,
//! };
//! let _claim = OwnerProgrammeDelegation {
//!     delegation_id: [0u8; DELEGATION_DIGEST_LEN],
//!     owner: [0u8; DELEGATION_DIGEST_LEN],
//!     project: [0u8; DELEGATION_DIGEST_LEN],
//!     repository: [0u8; DELEGATION_DIGEST_LEN],
//!     plan: [0u8; DELEGATION_DIGEST_LEN],
//!     plan_digest: [0u8; DELEGATION_DIGEST_LEN],
//!     allowed_phases: [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES],
//!     allowed_phase_count: 0,
//!     operation: OperationClass::IndependentGatekeeperReview,
//!     model_policy: [0u8; DELEGATION_DIGEST_LEN],
//!     credential_ref: [0u8; DELEGATION_DIGEST_LEN],
//!     budget_ceiling_micro_usd: 0,
//!     expires_at_epoch_s: 0,
//!     revoked_or_completed: false,
//! };
//! ```
//!
//! A VERIFIED delegation cannot be fabricated — the seal field is private and there is no
//! constructor:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::VerifiedOwnerProgrammeDelegation;
//! let _forged = VerifiedOwnerProgrammeDelegation { delegation: todo!(), _seal: todo!() };
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::VerifiedOwnerProgrammeDelegation;
//! let _forged: VerifiedOwnerProgrammeDelegation = VerifiedOwnerProgrammeDelegation::for_test(todo!());
//! ```
//!
//! Host-resolved facts cannot be fabricated without one either — the constructor demands it, and the
//! fields are private:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::HostResolvedRequestFacts;
//! let _forged = HostResolvedRequestFacts { project: todo!(), _seal: todo!() };
//! ```
//!
//! Owner presence itself is not even NAMEABLE from outside this crate, which is stronger than being
//! unconstructible:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::RequestScopedOwnerPresence;
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::satisfy_c4_for_gatekeeper_request;
//! ```
//!
//! And an authorised operation has no constructor at all - the evaluator is its sole mint (§9C):
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::AuthorisedProtectedOperation;
//! let _forged = AuthorisedProtectedOperation { _seal: todo!(), correlation: todo!(), operation: todo!(), service_epoch: todo!() };
//! ```
//!
//! ## Operation authority is admission, not execution (RUN-TO-COMPLETION §9C)
//!
//! `Completed` cannot be rendered from an authority alone: it needs sealed execution evidence,
//! which has no production constructor in this checkpoint -
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     AuthorisedProtectedOperation, ExecutionOutcomeEvidence, ProtectedOperationResponse,
//! };
//! // Pinning the signature is the proof: there is no way to ask for `Completed` without also
//! // presenting sealed execution evidence, and the result is optional because the evidence must
//! // be about this authority's own correlation.
//! let _completed: fn(&AuthorisedProtectedOperation, &ExecutionOutcomeEvidence)
//!     -> Option<ProtectedOperationResponse> = ProtectedOperationResponse::completed;
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{ExecutionOutcomeEvidence, ResultClass};
//! let _ran = ExecutionOutcomeEvidence { correlation: [0u8; 16], result: ResultClass::Succeeded, evidence_ref: [0u8; 16] };
//! ```
//!
//! …and the evaluation outcome cannot be written down as `Authorised` by a caller, because the
//! authority it would wrap cannot be (positive control: the outcome type is nameable and readable):
//!
//! ```
//! use projectos_host_windows_local_ipc::{ProtectedOperationEvaluation, ProtectedOperationResponse};
//! fn render(e: &ProtectedOperationEvaluation) -> ProtectedOperationResponse { e.response() }
//! ```
//!
//! The governed-removed client-session reference is gone from the wire contract - no accessor, no
//! constant:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::SESSION_REF_LEN;
//! ```
//!
//! ## The host-resolved binding inputs are not caller-suppliable (RUN-TO-COMPLETION §9B)
//!
//! The expected programme cannot be written down from a delegation's fields — the fields are
//! private and there is no constructor in a shipped graph, so "compare the record to a copy of
//! itself" does not compile:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::ExpectedProgramme;
//! let _echo = ExpectedProgramme { project: [0u8; 32], repository: [0u8; 32] };
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{ExpectedProgramme, OwnerProgrammeDelegation};
//! fn echo(d: &OwnerProgrammeDelegation) -> ExpectedProgramme { d.into() }
//! ```
//!
//! (The fixture constructors are `cfg`-gated to tests and the non-default `test-fixtures` graph,
//! which is a build-configuration property rather than one a doctest can state for every feature
//! set; a default build simply has no such function.)
//!
//! The clock is a sealed host reading, not a number: the verifier no longer accepts a `u64`, and a
//! reading cannot be written as a literal:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{
//!     verify_owner_programme_delegation, ExpectedProgramme, HostDelegationStatus,
//!     SignedOwnerProgrammeDelegation,
//! };
//! fn f(r: &SignedOwnerProgrammeDelegation, e: &ExpectedProgramme, s: &HostDelegationStatus) {
//!     let _ = verify_owner_programme_delegation(r, e, 1_700_000_000u64, s);
//! }
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::HostClockReading;
//! let _forever = HostClockReading { epoch_s: 0 };
//! ```
//!
//! The host-local delegation status cannot be selected by a caller either:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{DelegationLocalState, HostDelegationStatus};
//! let _chosen = HostDelegationStatus { delegation_id: [0u8; 32], state: DelegationLocalState::Active };
//! ```
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10B. Now that a REAL durable store exists, the seal matters
//! more than it did when the trait had no implementation at all. A downstream crate still cannot
//! supply a rival store, because the sealing supertrait is unnameable outside this crate:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{DelegationLocalState, DurableDelegationStateStore};
//! struct AlwaysLive;
//! impl DurableDelegationStateStore for AlwaysLive {
//!     fn recorded_state(&self, _id: &[u8; 32]) -> Option<DelegationLocalState> {
//!         Some(DelegationLocalState::Active)
//!     }
//! }
//! ```
//!
//! …and it cannot point the production store at a directory of its own choosing, because the root
//! is a capability with private fields and no public constructor:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::HostOwnedDelegationStateRoot;
//! let _mine = HostOwnedDelegationStateRoot { root: std::path::PathBuf::from("C:\\attacker") };
//! ```
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::DurableDelegationStateFileStore;
//! let _ = DurableDelegationStateFileStore::open("C:\\attacker");
//! ```
//!
//! …and it cannot record a lifecycle state, because the mutation engine is crate-private:
//!
//! ```compile_fail
//! use projectos_host_windows_local_ipc::{
//!     DelegationLocalState, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
//! };
//! fn f(store: &mut DurableDelegationStateFileStore) {
//!     let _ = store.record_lifecycle(&[0u8; 32], DelegationLocalState::Active);
//! }
//! ```
//!
//! …and the positive controls, so each refusal above is about the SEAL and not about a name that
//! does not resolve. The production clock reading exists and takes nothing; the sealed types are
//! nameable and readable; the binding digest is a public pure function over plain data:
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     binding_digest, BindingSubject, DelegationLocalState, ExpectedProgramme,
//!     HostClockReading, HostDelegationStatus, OperationClass, BINDING_DIGEST_LEN,
//! };
//! let now = HostClockReading::now_from_host().expect("host clock");
//! assert!(now.epoch_s() > 0);
//! fn read(e: &ExpectedProgramme, s: &HostDelegationStatus) -> (u8, DelegationLocalState) {
//!     (e.project()[0], s.state())
//! }
//! let d: [u8; BINDING_DIGEST_LEN] = binding_digest(&BindingSubject {
//!     project: [1; 32], repository: [2; 32], plan: [3; 32], plan_digest: [4; 32],
//!     phase: [5; 32], candidate_digest: [6; 32],
//!     operation: OperationClass::IndependentGatekeeperReview,
//!     model_policy: [7; 32], credential_ref: [8; 32],
//! });
//! assert_ne!(d, [0u8; BINDING_DIGEST_LEN]);
//! ```
//!
//! The §10B names are all nameable and readable, so the refusals above are about the seal:
//!
//! ```
//! use projectos_host_windows_local_ipc::{
//!     DelegationStoreRefusal, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
//!     DELEGATION_STATE_RELATIVE_ROOT, MAX_DELEGATION_RECORDS, MAX_DELEGATION_RECORD_BYTES,
//! };
//! fn open(r: &HostOwnedDelegationStateRoot)
//!     -> Result<DurableDelegationStateFileStore, DelegationStoreRefusal> {
//!     DurableDelegationStateFileStore::open(r)
//! }
//! assert_eq!(DELEGATION_STATE_RELATIVE_ROOT, "delegation-state");
//! assert!(MAX_DELEGATION_RECORDS > 0 && MAX_DELEGATION_RECORD_BYTES > 0);
//! ```

mod adapter;
mod contracts;
// TEST-ONLY fixture session minter for the §9B request-binding proofs. Compiled for this crate's
// tests under the non-default `test-fixtures` graph and for nothing else.
#[cfg(all(test, feature = "test-fixtures"))]
mod fixture_session;
mod operation_contract;
mod owner_programme_delegation;
mod protocol;
mod security;
mod verification;

// The live Windows named-pipe backend — the ONLY module with unsafe. Compiled only under the feature.
#[cfg(all(windows, feature = "windows-live-ipc"))]
mod windows_ffi;

pub use contracts::{
    EndpointFreshness, FirstInstanceRequired, IpcAllowPrincipal, IpcBroadPrincipal,
    IpcCorroboration, IpcEvidence, IpcRefusal, IpcResidue, IpcSecurityPolicy, IpcShutdownResult,
    LocalOnlyTransport, PeerRoleClass, ProtocolVersion, ReadinessClass, ReplayClassification,
    SingleUseNonceState, PROTOCOL_V1,
};

pub use adapter::{
    ConnectionState, EndpointOutcome, HandshakeObservation, HandshakeOutcome, HandshakeReceipt,
    IpcBackend, LiveIpcOperationCapability, LocalIpcAdapter, ReceivedFrame, SendOutcome,
    ServerPreparation, StatusReceipt,
};

pub use protocol::{
    parse_single_frame, FrameHeader, FrameParseError, MessageKind, Nonce, FRAME_MAGIC,
    MAX_FRAME_SIZE, NONCE_LEN, WIRE_PROTOCOL_VERSION,
};

// The OWNER-APPROVED read-only status capability surface. Present only under the non-default feature
// that gates it, so a default or merely-live build exposes no route to a capability at all.
#[cfg(feature = "owner-approved-status-read")]
pub use adapter::{CapabilityScope, OwnerStatusReadApproval, StatusApprovalRefused};

// The ONE read-only status response added by CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A: a fixed-width
// closed record, its canonical encoder and its strict decoder. No generic payload accessor is exported.
pub use protocol::{
    decode_installed_host_status, encode_installed_host_status, ChannelReport,
    IdentityVerificationReport, InstalledHostStatus, ProtectedOperationsReport, ReadinessReport,
    ServiceStateReport, INSTALLED_HOST_STATUS_LEN, INSTALLED_HOST_STATUS_RUN_ID, STATUS_PREFIX_LEN,
};

pub use security::{evaluate_pipe_security, EndpointSecurityDecision};

pub use verification::{
    classify_ipc_error, default_wait_policy, verify_clean_shutdown, verify_endpoint_fresh,
    verify_not_replayed, verify_peer_role, verify_zero_residue, CancellationTerminalState,
    IpcFailure, PeerRole, RetryPolicy, MAX_ATTEMPTS_CEILING,
};

// Re-export the redacted evidence + canonical no-trust authority types the IPC payload carries.
pub use projectos_host_windows_service_identity_proof::{
    AuthorityTokenOutcome, ConfirmedPeer, ServiceIdentityEvidence, ServiceIdentityProofClass,
};

// Re-export the CANONICAL cross-source service-instance identity, owned by the identity-proof crate.
// A confirmed handshake proves only that the PEER holds the nonce; the opaque token is what later ties
// that peer to the SCM-observed service instance. Nothing here can construct or inspect a token.
pub use projectos_host_windows_service_identity_proof::{
    LiveInstanceObservationCapability, ServiceInstanceBinding, ServiceInstanceRefusal,
    ServiceInstanceToken,
};
// The attempt state machine, available only where an observation could occur.
#[cfg(any(feature = "test-fixtures", all(windows, feature = "windows-live-ipc")))]
pub use projectos_host_windows_service_identity_proof::{
    AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved, ScmBeforeObserved,
    ServiceInstanceBindingAttempt,
};

// Re-export the OPAQUE host-authority pipe-security status this transport consumes (it never resolves a
// SID or builds an ACL/SDDL of its own).
pub use projectos_host_authority::{
    ProjectOsHostPipeSecurityPolicy, ProjectOsHostPipeSecurityStatus,
};

// NARROW CONTRIBUTION FAÇADE. Only this opaque wrapper is re-exported; `windows_ffi`, the pipe backend
// and every Win32 function stay private, and the wrapper has no public constructor, so a production
// caller can name it but never obtain one.
#[cfg(all(windows, feature = "windows-live-ipc"))]
pub use windows_ffi::LiveIpcPeerContributor;
// The CLIENT half of the read-only status workflow. Present only when the owner-approved feature is
// enabled too, and every method still demands the sealed capability: naming the type grants nothing.
#[cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read"
))]
pub use windows_ffi::{
    ClientStatusReadOutcome, ServeStatusOutcome, WindowsInstalledHostStatusClient,
    WindowsInstalledHostStatusServer,
};
// PROOF-ONLY refusal probes. `test-fixtures` is non-default and is enabled by NEITHER the installed
// service nor the Control Centre, so no production graph can reach them.
#[cfg(all(
    windows,
    feature = "windows-live-ipc",
    feature = "owner-approved-status-read",
    feature = "test-fixtures"
))]
pub use windows_ffi::RefusalProbe;

// The PROTECTED-OPERATION contract (PROJECTOSHOST-IPC-OPERATION-CONTRACT1A). Types and validation
// only: no transport, no channel, no effect. `OwnerPresenceGate` still cannot report closed; since
// RUN-TO-COMPLETION §9C the ONE way past it is a request-scoped presence from a VERIFIED owner
// programme delegation, and the evaluator is the sole mint of `AuthorisedProtectedOperation` - for
// `IndependentGatekeeperReview` only, and meaning admission, never execution. An admitted peer
// without that delegation still reaches only the C4 refusal.
//
// PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A RETIRED THIS CRATE'S DUPLICATE PEER-IDENTITY MODEL.
// Raw SID storage, raw Windows session identity, bounded integrity levels, the observed-evidence input
// model, peer classification and both authentication entry points are GONE, with no replacement and no
// successor here. Peer identity is owned end-to-end by the canonical identity-proof crate's bounded
// attempt: it is captured there, compared there, and never crosses into this crate in any form.
// `TrustedPeerContext` therefore carries only the two HOST-ISSUED identifiers and has no production
// constructor at all, so `evaluate_protected_operation` receives `None` on every shipped path.
pub use operation_contract::{
    decode_protected_operation_request, decode_protected_operation_response,
    encode_protected_operation_request, encode_protected_operation_response,
    evaluate_protected_operation, AuthorisedProtectedOperation, ExecutionOutcomeEvidence,
    OperationClass, OwnerPresenceGate, ProtectedOperationEvaluation, ProtectedOperationRequest,
    ProtectedOperationResponse, RejectionReason, ResponseState, ResultClass, TerminalStatus,
    TrustedPeerContext, APPROVAL_REF_LEN, BINDING_DIGEST_LEN, CORRELATION_LEN, EVIDENCE_REF_LEN,
};

// The REQUEST-SCOPED C4 surface, exported at the narrowest shape that still lets the host use it.
//
// WHAT IS DELIBERATELY ABSENT, and it is the whole point of this list: `RequestScopedOwnerPresence`
// and `satisfy_c4_for_gatekeeper_request` are NOT here. They are crate-private, so owner presence is
// a value no downstream crate can name, hold, store or carry between requests — it is minted inside
// `evaluate_protected_operation` and consumed in the same expression.
//
// WHAT IS HERE, and why each is safe to expose:
//   * `OwnerProgrammeDelegation` — the UNTRUSTED parsed record. Constructible on purpose; it is a
//     claim, and holding one satisfies nothing because the evaluator will not accept it.
//   * `VerifiedOwnerProgrammeDelegation` — sealed, no public constructor. A consumer can receive and
//     read one; it can never make one.
//   * `HostResolvedRequestFacts` — sealed: private fields, no `Default`, no `From`, no serde. Its
//     sole production mint is private to the Host composition module (§10A), so no other module in
//     this crate and no crate anywhere can call it; the `cfg`-gated fixture is the only other route.
//     Both demand the verified delegation, the sealed programme and the sealed clock reading.
//     Fabricated facts are not a rung of their own.
//   * `GatekeeperDelegationEvidence` — a borrow of the two sealed values. The caller's only claim
//     about the subject is the binding digest on the wire. Assembling it is not a way around the
//     ladder.
//
// So a downstream crate can build the untrusted DTO and nothing above it. That is the property.
pub use operation_contract::{
    GatekeeperDelegationEvidence, HostResolvedRequestFacts, OwnerProgrammeDelegation,
    VerifiedOwnerProgrammeDelegation, DELEGATION_DIGEST_LEN, MAX_DELEGATED_PHASES,
};

// RUN-TO-COMPLETION HOST ATTESTATION — §9B HOST-RESOLVED BINDING AUTHORITY.
//
// WHAT IS HERE, and why each is safe to expose:
//   * `BindingSubject` / `binding_digest` — the ONE canonical Host binding digest, as a public pure
//     function over plain data. A caller uses it to hash what it CLAIMS; the host hashes the facts
//     it RESOLVED with the same function; only the comparison inside `evaluate_protected_operation`
//     means anything. Holding a digest is not authority, and there is no second algorithm.
//   * `HostClockReading` — sealed; the one production route reads the system clock inside.
//   * `HostDelegationStatus` / `DelegationLocalState` — sealed status about ONE delegation id. No
//     production constructor in this checkpoint (the durable record is the persistence rung), so a
//     shipped graph cannot present a status and verification fails closed by construction.
//
// RUN-TO-COMPLETION HOST ATTESTATION §10A. `HostResolvedFacts` is a PUBLIC, PLAIN CARRIER of the
// material the Host resolved for one request, and it is NOT authority: it carries no seal, and
// stating one grants nothing. It ships (it was `test-fixtures`-only while no production constructor
// existed) because the composition fills it from its own trusted sources. Turning one into the
// sealed `HostResolvedRequestFacts` is the separate, guarded step — see the mint note above.
pub use operation_contract::HostResolvedFacts;
pub use operation_contract::{
    binding_digest, BindingSubject, BINDING_DIGEST_DOMAIN, BINDING_DIGEST_SCHEMA_VERSION,
};
pub use owner_programme_delegation::{
    DelegationLocalState, HostClockReading, HostDelegationStatus,
};

// RUN-TO-COMPLETION HOST ATTESTATION §10A — THE HOST'S OWN PRODUCTION COMPOSITION.
//
// `compose_protected_operation` is the ONE ordered pass in which the Host assembles, from its own
// trusted sources, every prerequisite the closed §9 chain requires — and then asks that chain. It
// mints no authority: the sole mint is still the tail of `evaluate_protected_operation`, which
// re-checks each of these against the caller's claims and against the owner's record.
//
// WHAT IS DELIBERATELY ABSENT FROM THIS LIST, and it is the point of it: the production routes to
// `ExpectedProgramme`, `HostDelegationStatus` and `HostResolvedRequestFacts`. The first two are
// `pub(crate)` and the third is private to the composition's own module, so no crate in the
// workspace — and, for the facts, no other module in THIS crate — can state what programme this
// installation is, whether a delegation is still live, or what the Host resolved for a request.
//
// The ports ARE here, because a port is Host code and an adapter has to be wireable. Each one's own
// documentation names the cross-check that makes a wrong answer a refusal rather than an escalation.
pub use operation_contract::host_composition::{
    compose_protected_operation, AdmittedCostSource, BudgetRefusal, BudgetReservation,
    CanonicalBudgetLedger, CommittedCandidateSource, ComposedProtectedOperation,
    CompositionRefusal, HostPlanAuthority, HostRequestSources, OneShotRequestSubject,
    SignedExecutionClosureFacts, COMPOSED_OPERATION, MAX_OUTSTANDING_RESERVATIONS,
};

/// FIXTURE ONLY. Non-default graph; a shipped build cannot name it, so it cannot state a budget
/// position.
#[cfg(feature = "test-fixtures")]
pub use operation_contract::host_composition::FixtureBudgetLedger;

// RUN-TO-COMPLETION HOST ATTESTATION §10A — THE HOST-OWNED DELEGATION STATE SEAM.
//
// `DurableDelegationStateStore` is exported so the Host composition can be handed one; it is SEALED
// by a private supertrait, so exporting the name lets a caller NAME a store and never implement one.
// §10A shipped no implementation at all, deliberately: an in-memory map behind this trait would
// have resurrected every revoked programme on restart while looking like durability. §10B below
// supplies the real restart-safe one.
pub use owner_programme_delegation::DurableDelegationStateStore;

// RUN-TO-COMPLETION HOST ATTESTATION §10B — THE PRODUCTION DURABLE LIFECYCLE STORE.
//
// The seam above is now backed by a REAL restart-safe store: `DurableDelegationStateFileStore`
// persists one bounded lifecycle record per delegation through the accepted durable protected-store
// engine (single-writer OS lock, SHA-256 framing, Prepared->Committed journal, write-through atomic
// replacement, journal-aware recovery) and the accepted `DelegationLifecycleRecordDto`. Revoked and
// Completed are TERMINAL and survive restart; every unknown, unreadable, mis-schema'd, unknown-state
// or mis-filed record answers None, which is a refusal.
//
// IT IS STILL UNREACHABLE IN A DEFAULT BUILD, and deliberately so. Opening it requires a
// `HostOwnedDelegationStateRoot`, whose PRODUCTION mint is absent: resolving the real ProgramData
// state root is installation composition, and inventing one here from an environment variable, a
// literal or a request field would be fabricating installation truth. The lifecycle mutation engine
// is `pub(crate)` and has no production caller, so nothing in the workspace can record a state.
pub use owner_programme_delegation::durable_store::{
    DelegationStoreRefusal, DurableDelegationStateFileStore, HostOwnedDelegationStateRoot,
    DELEGATION_STATE_RELATIVE_ROOT, MAX_DELEGATION_RECORDS, MAX_DELEGATION_RECORD_BYTES,
};

/// FIXTURE ONLY. Non-default graph; a shipped build cannot name it.
#[cfg(feature = "test-fixtures")]
pub use owner_programme_delegation::FixtureDurableDelegationStateStore;

// THE DURABLE OWNER PROGRAMME DELEGATION — the record the owner signs once and the host verifies
// while the owner is away. This is the production provenance for
// `VerifiedOwnerProgrammeDelegation`, and it is a SECOND, DISTINCT question from live owner
// presence, which keeps its own semantics untouched.
//
// WHAT IS DELIBERATELY ABSENT, and it is the whole point of this list: `OwnerSignatureOracle`, its
// production implementation and `verify_delegation_with_oracle` are NOT here. They are
// module-private, so no downstream crate can name the trait, implement it as `true`, or choose
// which verifier decides whether the owner signed. The only route in is
// `verify_owner_programme_delegation`, which takes no verifier and consults the embedded anchor.
//
// WHAT IS HERE, and why each is safe to expose:
//   * `decode_signed_owner_programme_delegation` / `SignedOwnerProgrammeDelegation` — the UNTRUSTED
//     parsed record. Public on purpose; it is a claim, and holding one satisfies nothing.
//   * `ExpectedProgramme` — SEALED since §9B: private fields, fixture-only constructor, no
//     production mint until the installation programme source is wired. Supplying one could never
//     make an unsigned record verify (the signature is checked first), and now it cannot be copied
//     out of the record under test either.
//   * `verify_owner_programme_delegation` — the one mint. No verifier parameter, no bypass.
//   * the refusal taxonomy, the domain tag, and the frozen layout constants, so the eventual
//     signing ceremony can produce exactly the bytes this verifier will check.
pub use owner_programme_delegation::{
    decode_signed_owner_programme_delegation, verify_owner_programme_delegation, DelegationRefusal,
    ExpectedProgramme, SignedOwnerProgrammeDelegation, DELEGATION_BODY_LEN,
    DELEGATION_SCHEMA_VERSION, DELEGATION_SIGNATURE_ALGORITHM, DELEGATION_SIGNING_DOMAIN,
    SIGNED_DELEGATION_RECORD_LEN,
};
/// Resolve the ProjectOSHost pipe security STATUS, read-only.
///
/// The installed service needs the status to gate `prepare_server`, and the descriptor itself is
/// resolved independently inside the transport when the endpoint is created. Since
/// PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A the installed-host exchange lives on the single
/// fixed production endpoint, so this gate reports the PRODUCTION resolution — four principals,
/// failing closed (`ConfiguredOwnerUnavailable`) when no owner is enrolled — matching the exact
/// descriptor the transport will build. Only the closed status crosses this boundary: no descriptor,
/// SID or SDDL is ever returned.
#[cfg(all(windows, feature = "windows-live-ipc"))]
#[must_use]
pub fn resolve_installed_host_pipe_security() -> ProjectOsHostPipeSecurityStatus {
    projectos_host_authority::ProjectOsHostPipeSecurity::resolve_production().0
}
// The opaque confirmed-handshake proof and its transition object. A consumer can hold and consume
// them but can never construct one; only this crate's verification path mints a confirmation.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub use adapter::{ConfirmedIpcPeerHandshake, HandshakeTransition};
// FIXTURE-ONLY handshake runner and peer contributor: explicit, non-default, no pipe, no Win32.
#[cfg(feature = "test-fixtures")]
pub use adapter::{
    assemble_same_connection_ipc_peer_fixture, outcome_is_confirmed, run_fixture_handshake,
    synthetic_controller_hello, FixtureIpcPeerContributor,
};

// The opaque same-connection IPC peer evidence bundle (CD-B4-PRODUCTION-IPC-PROVIDER1A): pairs the
// confirmed handshake with the co-observed peer identity for ONE connection and projects into the core
// evidence the sealed core ProductionIpcSessionVerifier consumes. Gated with the confirmed handshake it
// requires, so it is unreachable in the default graph.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
mod observation;
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub use observation::ConfirmedSameConnectionIpcPeerEvidence;
// PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A: the ONE guarded crossing from a COMPLETED
// canonical kernel-peer attempt to the core session evidence. It consumes the attempt (the
// Match/refusal verdict is derived inside, never caller-supplied), correlates the bundle against the
// sealed verifier's live connection + handshake generation, and yields evidence ONLY on Match.
// Same gate as the bundle it consumes, so it is equally unreachable in the default graph.
#[cfg(any(feature = "test-fixtures", feature = "windows-live-ipc"))]
pub use observation::{bind_canonical_peer_to_session_evidence, CanonicalSessionCrossingRefusal};

/// The truthful current state of this crate. CD-B1 was contract-only; the bounded Windows named-pipe
/// transport is now IMPLEMENTED but compile-only — the implementation exists yet no runtime capability
/// is reachable (no sealed [`adapter::LiveIpcOperationCapability`] is constructible).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum LocalIpcTransportState {
    /// Only the CD-B1 effect-free contract exists (the frozen B1 state).
    ContractOnly,
    /// The bounded Windows named-pipe transport is implemented, compiled behind `windows-live-ipc`, but
    /// no live pipe is reachable and no live IPC has been proven.
    WindowsTransportImplementedCompileOnly,
}

/// The current state: the Windows transport is implemented, compile-only. NOT entirely contract-only.
pub const LOCAL_IPC_TRANSPORT_STATE: LocalIpcTransportState =
    LocalIpcTransportState::WindowsTransportImplementedCompileOnly;

/// The crate is no longer entirely contract-only — a Windows transport implementation now exists (but is
/// compile-only). Retained (false) for callers that checked the CD-B1 boolean; consult
/// [`LOCAL_IPC_TRANSPORT_STATE`] for the truthful state.
pub const LOCAL_IPC_IS_CONTRACT_ONLY: bool = false;

/// No live IPC endpoint has been created or authorised in this phase.
pub const LIVE_LOCAL_IPC_AUTHORISED: bool = false;
