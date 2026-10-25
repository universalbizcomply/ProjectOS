//! Strongly-typed identifiers. Identifiers ONLY — they carry no authority.
//!
//! Each is an opaque, validated token (non-empty, bounded length, no control/whitespace characters).
//! Distinct newtypes prevent a project id being passed where an environment id is expected, etc.
//! Trust: every identifier arriving from the candidate is UNTRUSTED INPUT / an UNTRUSTED REFERENCE;
//! validation proves only that the string is well-formed, never that it refers to anything approved.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;

/// Maximum accepted identifier length (bytes). Bounds untrusted input; not a security guarantee.
pub const MAX_ID_LEN: usize = 256;

/// Validate an identifier token: non-empty, within [`MAX_ID_LEN`], no control or whitespace chars.
///
/// # Errors
/// [`ContractError::InvalidIdentifier`] if the token is empty, too long, or contains a control or
/// whitespace character.
pub fn validate_token(s: &str) -> Result<(), ContractError> {
    if s.is_empty() || s.len() > MAX_ID_LEN {
        return Err(ContractError::InvalidIdentifier);
    }
    if s.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(ContractError::InvalidIdentifier);
    }
    Ok(())
}

macro_rules! typed_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Construct a validated identifier.
            ///
            /// # Errors
            /// [`ContractError::InvalidIdentifier`] if the token is malformed.
            pub fn new(value: impl Into<String>) -> Result<Self, ContractError> {
                let value = value.into();
                validate_token(&value)?;
                Ok(Self(value))
            }

            /// Borrow the underlying token.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Re-validate (deserialised values are not validated by serde; envelopes call this).
            ///
            /// # Errors
            /// [`ContractError::InvalidIdentifier`] if the stored token is malformed.
            pub fn validate(&self) -> Result<(), ContractError> {
                validate_token(&self.0)
            }
        }
    };
}

typed_id!(
    /// A per-request correlation id chosen by the candidate. UNTRUSTED INPUT.
    RequestId
);
typed_id!(
    /// An opaque operation/session lookup reference issued by the future service. UNTRUSTED
    /// REFERENCE: meaningful only to the service, invalid outside its original authenticated
    /// session; possession alone grants nothing. It is opaque, which is NOT the same as
    /// non-forgeable — the service performs every authoritative check.
    OperationRef
);
typed_id!(
    /// A candidate-proposed project identifier. UNTRUSTED INPUT.
    ProjectId
);
typed_id!(
    /// A candidate-proposed environment identifier (e.g. staging). UNTRUSTED INPUT.
    EnvironmentId
);
typed_id!(
    /// An opaque reference to a credential held ONLY by the future service. UNTRUSTED REFERENCE;
    /// never a secret value.
    CredentialRef
);
typed_id!(
    /// A candidate-proposed provider identifier (e.g. supabase). UNTRUSTED INPUT.
    ProviderId
);
typed_id!(
    /// A candidate-proposed operation name (e.g. read-only-validate). UNTRUSTED INPUT.
    OperationName
);
typed_id!(
    /// A bounded digest of the exact requested operation parameters. UNTRUSTED INPUT; lets the
    /// service detect that a request differs from any previously approved one.
    OperationFingerprint
);
