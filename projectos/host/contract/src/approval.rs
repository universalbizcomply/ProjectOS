//! Owner-approval reference — mechanism-neutral and authority-free.
//!
//! This crate deliberately defines ONLY an opaque approval-evidence reference. It does not commit the
//! architecture to any owner-presence mechanism (WebAuthn, Windows Hello, FIDO, password, PIN, a UI
//! confirmation, or a candidate Boolean). A future phase selects and proves the trusted mechanism.
//!
//! The reference is an UNTRUSTED REFERENCE: presenting it is a CLAIM that some approval evidence
//! exists, never proof that the owner approved anything. Where no authoritative approval provenance
//! exists, the future Host Service refuses the protected operation and the response carries
//! [`crate::response::ResponseStatus::ApprovalRequired`].
//!
//! FORBIDDEN by construction: this contract contains no `ownerApproved`, `isApproved`,
//! `confirmedByOwner`, or `bypassApproval` field. No candidate-supplied Boolean can assert approval.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;
use crate::ids::MAX_ID_LEN;

/// An opaque reference to owner-approval evidence held/verified by the future service. UNTRUSTED
/// REFERENCE; mechanism-neutral; never contains owner-authentication material.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ApprovalEvidenceRef(String);

impl ApprovalEvidenceRef {
    /// Construct a validated approval-evidence reference.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if the token is empty, over-length, or contains control
    /// or whitespace characters.
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

    /// Re-validate the stored token.
    ///
    /// # Errors
    /// [`ContractError::InvalidIdentifier`] if malformed.
    pub fn validate(&self) -> Result<(), ContractError> {
        crate::ids::validate_token(&self.0)
    }
}

/// Compile-time sanity: the reference obeys the shared identifier bound.
const _: () = assert!(MAX_ID_LEN > 0);
