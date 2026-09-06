//! # ProjectOS host — effect-free service-identity proof CONTRACT (3K-I-D-E-B)
//!
//! Freezes the REDACTED evidence shape a later, separately-authorised ProjectOSHost VirtualServiceAccount
//! LIVE proof must produce. It resolves no SID, inspects no token, installs/starts no service, creates
//! no authority object, mutates no ProgramData/ACL/registry, and handles no credential.
//!
//! Since 3K-I-D-E-C-CAPABILITY-B4-CROSS-SOURCE-BINDING-CONTRACT1A it additionally owns the opaque
//! OS-derived [`ServiceInstanceToken`] that binds the IPC-authenticated peer to the SCM-observed
//! service. That is the crate's only Windows-touching code: it is confined to a
//! single private module behind the `windows-live-instance-observation` feature, `unsafe_code` is
//! denied everywhere else, and every entry point demands the sealed, UNCONSTRUCTIBLE
//! [`LiveInstanceObservationCapability`] — so the default build still performs no observation and no
//! build can reach one.
//!
//! ## What this contract guarantees
//!
//! - **Separation of Windows token facts.** Token-user identity
//!   ([`ServiceIdentityEvidence::configured_virtual_account_is_token_user`]), per-service-SID GROUP
//!   membership ([`ServiceIdentityEvidence::expected_service_sid_present_in_token_groups`]) and
//!   service-SID-TYPE configuration ([`ServiceIdentityEvidence::expected_service_sid_type_present`])
//!   are three SEPARATE facts, even though Windows renders the account through one `NT SERVICE\<name>`
//!   form. The distinction is by token position and security role, not rendered name.
//! - **Integrity is non-authorising.** [`NonAuthorisingIntegrity`] is structurally excluded from every
//!   confirmation path: it can neither establish nor invalidate identity, SID, readiness or authority.
//! - **No trust from a name.** Authority evidence reuses the canonical
//!   [`projectos_host_authority::AuthorityTokenOutcome`] / [`projectos_host_authority::AuthorityPeerState`]:
//!   an [`AuthorityTokenOutcome::ExistingToken`] is never confirmed authority, and corroboration is
//!   mandatory.
//! - **Release-before-acquire** is evidenced only through the canonical
//!   [`projectos_host_authority::AuthorityHandoverState`]; a live proof requires the terminal
//!   `ServiceReady`, which is reachable only via the legal handover chain.
//! - **Dual corroboration.** Peer (typed IPC) AND SCM corroboration are BOTH required; either alone
//!   leaves the proof unconfirmed.
//! - **Fail closed.** A live proof is [`ServiceIdentityProofClass::Confirmed`] only when every required
//!   fact is positively established; any `False`/`Invalid`/`Unavailable`/`Indeterminate`/contradictory
//!   fact yields an exact typed refusal or `Indeterminate`, never a permissive aggregate.
//! - **Raw identity is unrepresentable.** No public field can carry a username, service-account name,
//!   machine name, SID (string or bytes), token/session/logon identifier, credential, ACL or arbitrary
//!   diagnostic string. All evidence is tri-state or a closed enum.
//!
//! ```
//! use projectos_host_windows_service_identity_proof::{
//!     contract_only, ServiceIdentityProofClass,
//! };
//! // The contract exists; no live proof has run.
//! assert_eq!(contract_only(), ServiceIdentityProofClass::ContractOnly);
//! assert_ne!(contract_only(), ServiceIdentityProofClass::Confirmed);
//! ```

#![deny(unsafe_code)]

mod classify;
mod evidence;
mod instance;
/// OS-derived instance observation. The ONLY unsafe in this crate, compiled only on Windows under the
/// `windows-live-instance-observation` feature and still unreachable without the sealed capability.
#[cfg(all(windows, feature = "windows-live-instance-observation"))]
mod instance_ffi;

pub use classify::{ProofRefusal, ServiceIdentityProofClass};
pub use evidence::{
    Corroboration, NonAuthorisingIntegrity, ResidueEvidence, ServiceIdentityEvidence,
    ServiceSidTypeBaseline, Tristate,
};
// The attempt-scoped binding surface. `bind_service_instance` and the raw observation entry points are
// deliberately NOT re-exported: since Contract1B the only route to a positive verdict is a bounded,
// ordered, consumable attempt, so no free-standing recombinable comparison is publicly reachable.
pub use instance::{
    LiveInstanceObservationCapability, ServiceInstanceBinding, ServiceInstanceRefusal,
    ServiceInstanceToken,
};
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A adds ATTEMPT-SCOPED kernel peer capture and deliberately
// EXPORTS NOTHING NEW. Every peer identity type is crate-private, the capture is an attempt transition
// rather than a callable entry point, and no contribution, binding, observation or handle is returned.
// A consumer learns only what every other transition tells it: the attempt advanced into its next
// opaque state, or the closed redacted verdict that refused it.
//
// The attempt typestate is the DEPENDENT CONSUMER CONTRACT: a future orchestrator must be able to
// name and drive it without enabling live Windows observation, so it is gated on `consumer-contract`
// (which live observation implies) rather than on the live feature itself.
#[cfg(any(test, feature = "consumer-contract"))]
pub use instance::{
    AttemptOutcome, IpcPeerObserved, Prepared, ScmAfterObserved, ScmBeforeObserved,
    ServiceInstanceBindingAttempt, ServiceInstanceObservation,
};
// THE SEALED POSITIVE ANSWER. `ServiceInstanceBinding::Match` is a public enum variant and therefore
// something any caller can write down; a consumer that treated it as peer authority would be
// trusting a value it could have produced itself. `VerifiedPeerAdmission` is the same answer in a
// form only a completed canonical attempt can produce, so a downstream crate can hold one and can
// never make one. It carries only host-issued identifiers — no process, user, session or token
// identity leaves the attempt.
#[cfg(any(test, feature = "consumer-contract"))]
pub use instance::VerifiedPeerAdmission;
// SYNTHETIC FIXTURES: explicit, non-default, never implied by the contract or by live observation.
#[cfg(any(test, feature = "test-fixtures"))]
pub use instance::{synthetic_observation, synthetic_refusal, SyntheticInstanceSelector};

// Re-export the canonical authority types this contract reuses, so consumers need not depend on
// host-authority directly to read the evidence.
pub use projectos_host_authority::{
    AuthorityHandoverState, AuthorityPeerState, AuthorityTokenOutcome, ConfirmedPeer,
};

/// This crate is an effect-free service-identity proof CONTRACT only — no live proof exists here.
pub const SERVICE_IDENTITY_PROOF_IS_CONTRACT_ONLY: bool = true;

/// No LIVE Windows service-identity proof has been run in this phase.
pub const LIVE_SERVICE_IDENTITY_PROOF_RUN: bool = false;

/// The ACCEPTED design baseline for the service-SID type (3K-I-D-E-A). This is a DESIGN INPUT only —
/// it is neither an observed live configuration nor an owner effect-approval; both remain separate and
/// deferred to an authorised live phase.
pub const ACCEPTED_SERVICE_SID_TYPE_BASELINE: ServiceSidTypeBaseline =
    ServiceSidTypeBaseline::Unrestricted;

/// The contract-only proof status: the typed contract + redacted evidence exist, but no live proof has
/// run.
#[must_use]
pub fn contract_only() -> ServiceIdentityProofClass {
    ServiceIdentityProofClass::ContractOnly
}
