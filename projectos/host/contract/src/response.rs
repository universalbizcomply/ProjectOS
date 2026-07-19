//! The response envelope + status-specific tagged body.
//!
//! [`ResponseBody`] is an adjacently-tagged enum (`status` + `detail`) so each status admits ONLY the
//! fields valid for it — contradictory combinations (e.g. `DENIED` with an operation reference, or
//! `COMPLETED` without evidence) are structurally impossible. Cross-field semantics that structure
//! alone cannot express (e.g. `decisionNeeded` consistency, evidence status matching) are enforced by
//! [`ResponseBody::validate`]. A response is a SERVICE-GENERATED CLAIM the client consumes — it grants
//! the candidate NO local authority.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;
use crate::evidence::{DecisionNeeded, RedactedEvidence};
use crate::ids::{OperationRef, RequestId};
use crate::version::SchemaVersion;

/// Lightweight status discriminant. Also used as [`RedactedEvidence::status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResponseStatus {
    /// The request is refused.
    Denied,
    /// A project/environment credential must be set up locally before proceeding.
    SetupRequired,
    /// Authoritative owner approval is required before proceeding.
    ApprovalRequired,
    /// The service created protected internal state (NOT a grant of authority to the candidate).
    AcceptedForProcessing,
    /// The operation completed; see the redacted evidence.
    Completed,
    /// The operation failed; see the error code.
    Failed,
}

/// `DENIED`: refusal. Error required; no operation reference; no evidence (structurally absent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeniedDetail {
    /// Stable refusal code (no sensitive detail).
    pub error: ContractError,
}

/// `SETUP_REQUIRED`: a credential must be set up locally. No operation reference, no evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetupRequiredDetail {
    /// Stable reason code (typically [`ContractError::CredentialMissing`]).
    pub error: ContractError,
    /// Must be [`DecisionNeeded::CredentialSetup`].
    pub decision_needed: DecisionNeeded,
}

/// `APPROVAL_REQUIRED`: resumable pending record awaiting owner approval. Reference required; grants
/// nothing. No evidence, no error, no success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalRequiredDetail {
    /// Opaque reference to the service-side pending record. UNTRUSTED REFERENCE; not authority.
    pub operation_reference: OperationRef,
    /// Must be [`DecisionNeeded::OwnerApproval`].
    pub decision_needed: DecisionNeeded,
}

/// `ACCEPTED_FOR_PROCESSING`: protected service-side state exists. Reference required; no error, no
/// evidence. Does NOT grant the candidate capability authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AcceptedDetail {
    /// Opaque reference to the protected record. UNTRUSTED REFERENCE; not authority.
    pub operation_reference: OperationRef,
}

/// `COMPLETED`: operation completed. Reference + redacted evidence required; no error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CompletedDetail {
    /// Opaque reference to the completed record. UNTRUSTED REFERENCE; not authority.
    pub operation_reference: OperationRef,
    /// Redacted evidence. A digest is metadata, NOT proof the operation was authorised.
    pub evidence: RedactedEvidence,
}

/// `FAILED`: operation failed. Error required; optional reference (only where a record existed) and
/// optional redacted failure evidence; never a success implication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FailedDetail {
    /// Stable failure code (no sensitive detail).
    pub error: ContractError,
    /// Optional reference to a protected record, if one existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_reference: Option<OperationRef>,
    /// Optional redacted failure evidence (never a completion).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<RedactedEvidence>,
}

/// The status-specific response body. Exactly one variant is present per response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    content = "detail",
    deny_unknown_fields,
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum ResponseBody {
    /// Refused.
    Denied(DeniedDetail),
    /// Credential setup required.
    SetupRequired(SetupRequiredDetail),
    /// Owner approval required.
    ApprovalRequired(ApprovalRequiredDetail),
    /// Protected state created.
    AcceptedForProcessing(AcceptedDetail),
    /// Completed with evidence.
    Completed(CompletedDetail),
    /// Failed with an error.
    Failed(FailedDetail),
}

impl ResponseBody {
    /// The status discriminant for this body.
    #[must_use]
    pub fn status(&self) -> ResponseStatus {
        match self {
            ResponseBody::Denied(_) => ResponseStatus::Denied,
            ResponseBody::SetupRequired(_) => ResponseStatus::SetupRequired,
            ResponseBody::ApprovalRequired(_) => ResponseStatus::ApprovalRequired,
            ResponseBody::AcceptedForProcessing(_) => ResponseStatus::AcceptedForProcessing,
            ResponseBody::Completed(_) => ResponseStatus::Completed,
            ResponseBody::Failed(_) => ResponseStatus::Failed,
        }
    }

    /// Enforce the cross-field semantics structure alone cannot express.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] for a malformed reference; [`ContractError::MalformedRequest`]
    /// for a `decisionNeeded`/status mismatch or a contradictory evidence status.
    pub fn validate(&self) -> Result<(), ContractError> {
        match self {
            ResponseBody::Denied(_) => Ok(()),
            ResponseBody::SetupRequired(d) => {
                if d.decision_needed == DecisionNeeded::CredentialSetup {
                    Ok(())
                } else {
                    Err(ContractError::MalformedRequest)
                }
            }
            ResponseBody::ApprovalRequired(d) => {
                d.operation_reference.validate()?;
                if d.decision_needed == DecisionNeeded::OwnerApproval {
                    Ok(())
                } else {
                    Err(ContractError::MalformedRequest)
                }
            }
            ResponseBody::AcceptedForProcessing(d) => d.operation_reference.validate(),
            ResponseBody::Completed(d) => {
                d.operation_reference.validate()?;
                d.evidence.validate()?;
                if d.evidence.status != ResponseStatus::Completed
                    || d.evidence.decision_needed != DecisionNeeded::None
                {
                    return Err(ContractError::MalformedRequest);
                }
                Ok(())
            }
            ResponseBody::Failed(d) => {
                if let Some(op) = &d.operation_reference {
                    op.validate()?;
                }
                if let Some(ev) = &d.evidence {
                    ev.validate()?;
                    // Failure evidence must never claim completion.
                    if ev.status == ResponseStatus::Completed {
                        return Err(ContractError::MalformedRequest);
                    }
                }
                Ok(())
            }
        }
    }
}

/// A versioned response envelope carrying exactly one status-specific body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResponseEnvelope {
    /// Wire schema version.
    pub schema_version: SchemaVersion,
    /// The correlated request id.
    pub request_id: RequestId,
    /// Exactly one status-specific response body.
    pub response: ResponseBody,
}

impl ResponseEnvelope {
    /// Build a response envelope at the current schema version.
    #[must_use]
    pub fn new(request_id: RequestId, response: ResponseBody) -> Self {
        Self {
            schema_version: SchemaVersion::CURRENT,
            request_id,
            response,
        }
    }

    /// Validate schema version, identifier well-formedness, and status-specific semantics.
    ///
    /// # Errors
    /// [`ContractError::UnsupportedSchema`], [`ContractError::InvalidIdentifier`], or
    /// [`ContractError::MalformedRequest`] for a contradictory combination.
    pub fn validate(&self) -> Result<(), ContractError> {
        self.schema_version.require_supported()?;
        self.request_id.validate()?;
        self.response.validate()?;
        Ok(())
    }

    /// Fail-closed parse: strict JSON deserialise, then validate.
    ///
    /// # Errors
    /// [`ContractError::MalformedRequest`] for non-strict JSON (bad JSON, unknown field, missing
    /// field, unknown status); otherwise the first [`ResponseEnvelope::validate`] error.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, ContractError> {
        let envelope: ResponseEnvelope =
            serde_json::from_slice(bytes).map_err(|_| ContractError::MalformedRequest)?;
        envelope.validate()?;
        Ok(envelope)
    }

    /// Serialise to JSON.
    ///
    /// # Errors
    /// [`ContractError::InternalRefusal`] if serialisation fails.
    pub fn to_json(&self) -> Result<String, ContractError> {
        serde_json::to_string(self).map_err(|_| ContractError::InternalRefusal)
    }
}
