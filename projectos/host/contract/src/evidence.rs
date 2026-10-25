//! Redacted evidence projection — the ONLY operation output the contract may carry.
//!
//! Typed fields only: no raw process output, no credential material, no unrestricted/arbitrary JSON.
//! Any secret must already have been scrubbed by the future service BEFORE building this projection.
//! Trust: EVIDENCE REQUIRING REVIEW.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;
use crate::response::ResponseStatus;

/// Maximum accepted length (bytes) for the redacted summary. Bounds payload size.
pub const MAX_SUMMARY_LEN: usize = 4096;
/// Maximum accepted length (bytes) for the digest string.
pub const MAX_DIGEST_LEN: usize = 128;

/// An opaque reference to a service-side evidence record. UNTRUSTED REFERENCE.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EvidenceRef(String);

impl EvidenceRef {
    /// Construct a validated evidence reference.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if malformed.
    pub fn new(value: impl Into<String>) -> Result<Self, ContractError> {
        let value = value.into();
        crate::ids::validate_token(&value)?;
        Ok(Self(value))
    }

    /// Borrow the underlying token.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What owner/operator action a piece of evidence indicates is still needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DecisionNeeded {
    /// No further decision required.
    None,
    /// Authoritative owner approval is required before the operation may proceed.
    OwnerApproval,
    /// A project/environment credential must be set up locally, outside prompts.
    CredentialSetup,
}

/// A minimal, redacted evidence projection. Contains only typed metadata + a redacted summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RedactedEvidence {
    /// Opaque evidence-record reference.
    pub evidence_ref: EvidenceRef,
    /// The status this evidence records.
    pub status: ResponseStatus,
    /// Monotonic sequence number for ordering evidence within a session.
    pub sequence: u64,
    /// Optional RFC3339 timestamp metadata (NOT raw output).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorded_at: Option<String>,
    /// Hex digest of the service-side evidence bytes.
    pub digest: String,
    /// Human-readable summary. Secrets MUST already be redacted by the service.
    pub redacted_summary: String,
    /// What decision, if any, is still required.
    pub decision_needed: DecisionNeeded,
}

impl RedactedEvidence {
    /// Validate structural bounds (reference well-formed, digest hex + bounded, summary bounded).
    /// This does not and cannot verify that redaction was performed — that is a service duty.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if the evidence reference is malformed;
    /// [`ContractError::MalformedRequest`] if the digest is not bounded lowercase/uppercase hex or
    /// the summary exceeds [`MAX_SUMMARY_LEN`].
    pub fn validate(&self) -> Result<(), ContractError> {
        crate::ids::validate_token(self.evidence_ref.as_str())?;
        if self.digest.is_empty()
            || self.digest.len() > MAX_DIGEST_LEN
            || !self.digest.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ContractError::MalformedRequest);
        }
        if self.redacted_summary.len() > MAX_SUMMARY_LEN {
            return Err(ContractError::MalformedRequest);
        }
        Ok(())
    }
}
