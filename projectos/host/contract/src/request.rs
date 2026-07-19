//! The request envelope + kind-specific tagged body. UNTRUSTED throughout.
//!
//! [`RequestBody`] is an adjacently-tagged enum (`kind` + `payload`) so each request kind admits ONLY
//! its own fields. Adjacently-tagged enums support `deny_unknown_fields`, so an unknown kind, an
//! unknown top-level field, and an unknown payload field all fail strict deserialisation.

use serde::{Deserialize, Serialize};

use crate::context::{
    CredentialSetupStatusRequest, OperationStatusRequest, ProtectedOperationRequest,
};
use crate::error::ContractError;
use crate::ids::RequestId;
use crate::version::SchemaVersion;

/// A lightweight discriminant for a request body (no payload). Useful for logging/routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
    /// A protected operation request.
    ProtectedOperation,
    /// An operation-status query.
    OperationStatus,
    /// A credential-setup-status query.
    CredentialSetupStatus,
}

/// The kind-specific request body. Exactly one variant is present per request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "payload",
    deny_unknown_fields,
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum RequestBody {
    /// Prepare a protected operation (the service verifies, gates, and decides).
    ProtectedOperation(ProtectedOperationRequest),
    /// Query the status of an operation by opaque reference.
    OperationStatus(OperationStatusRequest),
    /// Query whether a project/environment credential is set up (no value returned).
    CredentialSetupStatus(CredentialSetupStatusRequest),
}

impl RequestBody {
    /// The discriminant for this body.
    #[must_use]
    pub fn kind(&self) -> RequestKind {
        match self {
            RequestBody::ProtectedOperation(_) => RequestKind::ProtectedOperation,
            RequestBody::OperationStatus(_) => RequestKind::OperationStatus,
            RequestBody::CredentialSetupStatus(_) => RequestKind::CredentialSetupStatus,
        }
    }

    /// Validate the active payload's identifiers.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] for a malformed identifier.
    pub fn validate(&self) -> Result<(), ContractError> {
        match self {
            RequestBody::ProtectedOperation(p) => p.validate(),
            RequestBody::OperationStatus(p) => p.validate(),
            RequestBody::CredentialSetupStatus(p) => p.validate(),
        }
    }
}

/// A versioned request envelope carrying exactly one kind-specific body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RequestEnvelope {
    /// Wire schema version. Validated against [`crate::version::SCHEMA_VERSION`].
    pub schema_version: SchemaVersion,
    /// Candidate-chosen correlation id.
    pub request_id: RequestId,
    /// Exactly one kind-specific request body.
    pub request: RequestBody,
}

impl RequestEnvelope {
    /// Build an envelope at the current schema version.
    #[must_use]
    pub fn new(request_id: RequestId, request: RequestBody) -> Self {
        Self {
            schema_version: SchemaVersion::CURRENT,
            request_id,
            request,
        }
    }

    /// Validate schema version and identifier well-formedness. Well-formed is NOT authorised.
    ///
    /// # Errors
    /// [`ContractError::UnsupportedSchema`] for a wrong version; [`ContractError::InvalidIdentifier`]
    /// for a malformed identifier.
    pub fn validate(&self) -> Result<(), ContractError> {
        self.schema_version.require_supported()?;
        self.request_id.validate()?;
        self.request.validate()?;
        Ok(())
    }

    /// Fail-closed parse: strict JSON deserialise, then validate. Never trusts the payload.
    ///
    /// # Errors
    /// [`ContractError::MalformedRequest`] for non-strict JSON (bad JSON, unknown field, missing
    /// field, unknown kind); otherwise the first [`RequestEnvelope::validate`] error.
    pub fn parse_json(bytes: &[u8]) -> Result<Self, ContractError> {
        let envelope: RequestEnvelope =
            serde_json::from_slice(bytes).map_err(|_| ContractError::MalformedRequest)?;
        envelope.validate()?;
        Ok(envelope)
    }

    /// Serialise to JSON.
    ///
    /// # Errors
    /// [`ContractError::InternalRefusal`] if serialisation fails (should not occur for valid data).
    pub fn to_json(&self) -> Result<String, ContractError> {
        serde_json::to_string(self).map_err(|_| ContractError::InternalRefusal)
    }
}
