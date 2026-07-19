//! The credential scope binding. This is a GROUPING of the accepted authority-free identity newtypes
//! (`projectos_trust_contract::{ProjectId, ProviderId, EnvironmentId, CredentialRef}`) — it does NOT
//! define new identity types. A scope is not authority; it is the binding that credential material and
//! its associated data must agree on.

use projectos_trust_contract::{CredentialRef, EnvironmentId, ProjectId, ProviderId};

use crate::error::CryptoError;

/// The (project, provider, environment, credentialRef) a credential's material is bound to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialScope {
    project: ProjectId,
    provider: ProviderId,
    environment: EnvironmentId,
    credential_ref: CredentialRef,
}

impl CredentialScope {
    /// Bind a scope from validated identity newtypes.
    #[must_use]
    pub fn new(
        project: ProjectId,
        provider: ProviderId,
        environment: EnvironmentId,
        credential_ref: CredentialRef,
    ) -> Self {
        Self {
            project,
            provider,
            environment,
            credential_ref,
        }
    }

    /// The project binding.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The provider binding.
    #[must_use]
    pub fn provider(&self) -> &ProviderId {
        &self.provider
    }
    /// The environment binding.
    #[must_use]
    pub fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    /// The credential reference binding.
    #[must_use]
    pub fn credential_ref(&self) -> &CredentialRef {
        &self.credential_ref
    }

    /// Re-validate every identity token; reject any structurally invalid one.
    ///
    /// # Errors
    /// [`CryptoError::InvalidIdentity`] if any token is malformed.
    pub fn validate(&self) -> Result<(), CryptoError> {
        for ok in [
            self.project.validate().is_ok(),
            self.provider.validate().is_ok(),
            self.environment.validate().is_ok(),
            self.credential_ref.validate().is_ok(),
        ] {
            if !ok {
                return Err(CryptoError::InvalidIdentity);
            }
        }
        Ok(())
    }

    /// Whether two scopes bind identically.
    #[must_use]
    pub fn matches(&self, other: &CredentialScope) -> bool {
        self == other
    }
}
