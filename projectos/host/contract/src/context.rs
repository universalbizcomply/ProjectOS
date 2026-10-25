//! Kind-specific request payloads — UNTRUSTED INPUT in every field.
//!
//! Each request kind has its OWN payload struct exposing ONLY the fields relevant to that kind, so
//! an irrelevant or incomplete field combination is structurally impossible (and any stray field is
//! rejected by `deny_unknown_fields`). Nothing here is a fact: the future Host Service re-derives
//! project, environment, provider, operation, credential availability, and approval provenance from
//! its own verified process facts and protected state.

use serde::{Deserialize, Serialize};

use crate::approval::ApprovalEvidenceRef;
use crate::error::ContractError;
use crate::ids::{
    CredentialRef, EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId,
    ProviderId,
};

/// Payload for `PROTECTED_OPERATION`. Describes a protected operation the candidate wants performed.
/// Deliberately has NO operation-reference field — a new protected operation cannot carry one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProtectedOperationRequest {
    /// Requested project. UNTRUSTED INPUT.
    pub requested_project: ProjectId,
    /// Requested environment. UNTRUSTED INPUT.
    pub requested_environment: EnvironmentId,
    /// Requested provider. UNTRUSTED INPUT.
    pub requested_provider: ProviderId,
    /// Requested operation name. UNTRUSTED INPUT.
    pub requested_operation: OperationName,
    /// Bounded digest of the exact operation parameters. UNTRUSTED INPUT.
    pub operation_fingerprint: OperationFingerprint,
    /// Optional opaque credential reference (never a secret value). UNTRUSTED REFERENCE.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_reference: Option<CredentialRef>,
    /// Optional opaque approval-evidence reference. UNTRUSTED REFERENCE.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_evidence_reference: Option<ApprovalEvidenceRef>,
}

impl ProtectedOperationRequest {
    /// Validate identifier well-formedness (well-formed is NOT verified).
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if any identifier is malformed.
    pub fn validate(&self) -> Result<(), ContractError> {
        self.requested_project.validate()?;
        self.requested_environment.validate()?;
        self.requested_provider.validate()?;
        self.requested_operation.validate()?;
        self.operation_fingerprint.validate()?;
        if let Some(c) = &self.credential_reference {
            c.validate()?;
        }
        if let Some(a) = &self.approval_evidence_reference {
            a.validate()?;
        }
        Ok(())
    }
}

/// Payload for `OPERATION_STATUS`. Identifies the operation being queried by its opaque reference.
/// Carries NO protected-operation context. Possession of the reference is non-authoritative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OperationStatusRequest {
    /// Opaque operation reference to query. UNTRUSTED REFERENCE.
    pub operation_reference: OperationRef,
}

impl OperationStatusRequest {
    /// Validate the reference syntax only.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if malformed.
    pub fn validate(&self) -> Result<(), ContractError> {
        self.operation_reference.validate()
    }
}

/// Payload for `CREDENTIAL_SETUP_STATUS`. Asks whether a project/environment credential is set up.
/// Never carries raw credentials, an approval Boolean, an operation fingerprint, or an operation
/// reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CredentialSetupStatusRequest {
    /// Requested project. UNTRUSTED INPUT.
    pub requested_project: ProjectId,
    /// Requested environment. UNTRUSTED INPUT.
    pub requested_environment: EnvironmentId,
    /// Requested provider. UNTRUSTED INPUT.
    pub requested_provider: ProviderId,
    /// Opaque credential reference whose setup status is being queried. UNTRUSTED REFERENCE.
    pub credential_reference: CredentialRef,
}

impl CredentialSetupStatusRequest {
    /// Validate identifier well-formedness.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if any identifier is malformed.
    pub fn validate(&self) -> Result<(), ContractError> {
        self.requested_project.validate()?;
        self.requested_environment.validate()?;
        self.requested_provider.validate()?;
        self.credential_reference.validate()
    }
}
