//! Opaque, service-issued key handles. A handle carries NO key bytes — only an adapter-issued id, the
//! adapter epoch (so a handle from a prior adapter instance / after restart is refused), its key role,
//! and (for a DEK) its project and version. Possession of a copied id alone grants nothing: the adapter
//! authorises use only against its live registry. A handle is capability-local to the crypto adapter —
//! it is NOT ProjectOS operation authority.

// Crate-private handle constructors/accessors are consumed by the adapter implementation. This phase
// ships only the `#[cfg(test)]` synthetic adapter, so they are unused in a pure lib build; a future
// in-crate production adapter will consume them.
#![cfg_attr(not(test), allow(dead_code))]

use projectos_trust_contract::ProjectId;

use crate::policy::KeyVersion;

/// An opaque, non-secret, service-issued crypto-operation correlation id. It correlates ONE protected
/// crypto operation (master/DEK rotation, DEK rewrap, credential re-encryption). It is NOT a key
/// handle, NOT a `CredentialRef`, NOT a ProjectOS `OperationRef`, and NOT a journal intent id. It
/// carries no secret and no key authority: a copied value alone grants no key use. Non-serializable in
/// this phase. `Debug` shows only the identifier value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CryptoOperationId(u64);

impl CryptoOperationId {
    /// Construct a non-zero operation id (issued only by the adapter's checked counter).
    pub(crate) fn new(value: u64) -> Result<Self, crate::error::CryptoError> {
        if value == 0 {
            return Err(crate::error::CryptoError::InvalidIdentity);
        }
        Ok(Self(value))
    }
    /// The opaque value (non-secret correlation id; grants no key use).
    #[must_use]
    pub fn value(self) -> u64 {
        self.0
    }
}

/// The role a key handle is bound to. A handle of one role can never act as another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRole {
    /// Level-1 service master key.
    Master,
    /// Level-2 project data-encryption key.
    ProjectDek,
}

/// Key-lifecycle state (SEPARATE from credential lifecycle).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyLifecycle {
    /// May wrap/unwrap/encrypt/decrypt per role.
    Active,
    /// May decrypt/unwrap but not encrypt/wrap new material.
    Retiring,
    /// May do nothing.
    Revoked,
}

/// An opaque handle to the service master key. Non-secret; carries no key bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceMasterKeyHandle {
    id: u64,
    epoch: u64,
}

impl ServiceMasterKeyHandle {
    pub(crate) fn new(id: u64, epoch: u64) -> Self {
        Self { id, epoch }
    }
    pub(crate) fn id(self) -> u64 {
        self.id
    }
    pub(crate) fn epoch(self) -> u64 {
        self.epoch
    }
    /// The key role (always [`KeyRole::Master`]).
    #[must_use]
    pub fn role(self) -> KeyRole {
        KeyRole::Master
    }
}

/// An opaque handle to a project-scoped DEK. Non-secret; carries no key bytes. Bound to one project
/// and one version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectDekHandle {
    id: u64,
    epoch: u64,
    project: ProjectId,
    key_version: KeyVersion,
}

impl ProjectDekHandle {
    pub(crate) fn new(id: u64, epoch: u64, project: ProjectId, key_version: KeyVersion) -> Self {
        Self {
            id,
            epoch,
            project,
            key_version,
        }
    }
    pub(crate) fn id(&self) -> u64 {
        self.id
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }
    /// The key role (always [`KeyRole::ProjectDek`]).
    #[must_use]
    pub fn role(&self) -> KeyRole {
        KeyRole::ProjectDek
    }
    /// The project this DEK is scoped to.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The DEK version.
    #[must_use]
    pub fn key_version(&self) -> KeyVersion {
        self.key_version
    }
}
