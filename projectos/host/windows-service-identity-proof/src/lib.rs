//! # ProjectOS host — effect-free service-identity proof CONTRACT (3K-I-D-E-B)
//!
//! Freezes the REDACTED evidence shape a later, separately-authorised ProjectOSHost VirtualServiceAccount
//! LIVE proof must produce — and NOTHING ELSE. It performs no Windows call, resolves no SID, queries no
//! SCM, inspects no token, installs/starts no service, creates no authority object, mutates no
//! ProgramData/ACL/registry, and handles no credential. `#![forbid(unsafe_code)]`.
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

#![forbid(unsafe_code)]

mod classify;
mod evidence;

pub use classify::{ProofRefusal, ServiceIdentityProofClass};
pub use evidence::{
    Corroboration, NonAuthorisingIntegrity, ResidueEvidence, ServiceIdentityEvidence,
    ServiceSidTypeBaseline, Tristate,
};

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
