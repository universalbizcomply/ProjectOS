//! # ProjectOS Trust Contract (authority-free wire vocabulary)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3B.
//!
//! This crate defines ONLY the data exchanged across the future authenticated IPC boundary between:
//!
//! * the **candidate** ProjectOS Control Centre client (UNTRUSTED); and
//! * the future **independent** ProjectOS Host Service (the authority — NOT in this crate).
//!
//! ## What this crate is NOT
//!
//! It is not, and must never become, an authority source. It implements no Windows service, no IPC
//! transport, no process verification, no protected storage, no credentials, no secret leases, no
//! capabilities, no provider operations, no owner authentication, no signing, and no publisher
//! policy. It holds no trust root and no verified fact.
//!
//! ## Binding rules
//!
//! Every value a candidate sends is a REQUEST or a CLAIM, never proof. An [`ids::OperationRef`]
//! returned to the candidate is an UNTRUSTED lookup reference — not a bearer capability, not proof
//! of owner approval, not proof of process/project identity, and not proof that any operation is
//! authorised. A copied, guessed, or replayed reference grants nothing: the future Host Service
//! authorises an operation only when it finds matching protected state bound to the current
//! authenticated connection and independently verified process. The contract is deny-all by
//! construction — no type here can grant authority.
//!
//! ## Fail-closed parsing
//!
//! Envelopes deserialise strictly (unknown fields rejected, unknown enum variants rejected) and are
//! then [`request::RequestEnvelope::validate`]d against the supported [`version::SCHEMA_VERSION`]. A
//! newer or unknown schema is refused, never silently accepted.

#![forbid(unsafe_code)]

pub mod approval;
pub mod context;
pub mod error;
pub mod evidence;
pub mod ids;
pub mod request;
pub mod response;
pub mod version;

pub use approval::ApprovalEvidenceRef;
pub use context::{
    CredentialSetupStatusRequest, OperationStatusRequest, ProtectedOperationRequest,
};
pub use error::ContractError;
pub use evidence::{DecisionNeeded, EvidenceRef, RedactedEvidence};
pub use ids::{
    CredentialRef, EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId,
    ProviderId, RequestId,
};
pub use request::{RequestBody, RequestEnvelope, RequestKind};
pub use response::{
    AcceptedDetail, ApprovalRequiredDetail, CompletedDetail, DeniedDetail, FailedDetail,
    ResponseBody, ResponseEnvelope, ResponseStatus, SetupRequiredDetail,
};
pub use version::{SchemaVersion, SCHEMA_VERSION};
