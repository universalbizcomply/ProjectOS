//! Schema version. Fail-closed: only the exact supported version is accepted.
//!
//! Trust: a candidate-supplied number on the wire (UNTRUSTED INPUT). It is validated, never trusted
//! to select behaviour beyond accept/reject.
//!
//! Version history:
//! * v1 — pre-integration committed contract (WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3B). It was
//!   never connected to a Host Service or a Control Centre client, and no production or persistent
//!   wire record relies on it, so it is superseded outright rather than migrated.
//! * v2 — the first resume-capable contract (RESUME1A): `SETUP_REQUIRED` now carries a durable
//!   `operationReference` so a credential-setup block can be located and resumed after restart.
//!
//! There is NO fallback parser for v1: a v1 message is rejected exactly like any other unsupported
//! version. No silent upgrade or downgrade is performed.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;

/// The only supported schema version. A request or response carrying any other value is rejected.
pub const SCHEMA_VERSION: u32 = 2;

/// A wire schema version. Serialised transparently as a bare integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SchemaVersion(pub u32);

impl SchemaVersion {
    /// The current supported version.
    pub const CURRENT: SchemaVersion = SchemaVersion(SCHEMA_VERSION);

    /// True only for the exact supported version.
    #[must_use]
    pub fn is_supported(self) -> bool {
        self.0 == SCHEMA_VERSION
    }

    /// Fail closed unless this is the exact supported version. A newer version is NOT accepted.
    ///
    /// # Errors
    /// [`ContractError::UnsupportedSchema`] if the version is not [`SCHEMA_VERSION`].
    pub fn require_supported(self) -> Result<(), ContractError> {
        if self.is_supported() {
            Ok(())
        } else {
            Err(ContractError::UnsupportedSchema)
        }
    }
}

impl Default for SchemaVersion {
    fn default() -> Self {
        SchemaVersion::CURRENT
    }
}
