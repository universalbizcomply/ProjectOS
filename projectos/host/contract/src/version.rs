//! Schema version. Fail-closed: only the exact supported version is accepted.
//!
//! Trust: a candidate-supplied number on the wire (UNTRUSTED INPUT). It is validated, never trusted
//! to select behaviour beyond accept/reject.

use serde::{Deserialize, Serialize};

use crate::error::ContractError;

/// The only supported schema version. A request or response carrying any other value is rejected.
pub const SCHEMA_VERSION: u32 = 1;

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
