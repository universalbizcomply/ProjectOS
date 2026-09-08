//! Per-family persistence schema versions. Each store family has its OWN version, INDEPENDENT of the
//! wire-contract schema version (`projectos-trust-contract` is at 2). A DTO whose `schemaVersion`
//! does not equal its family constant is rejected (older/newer/zero all fail closed).

/// Trust-policy record schema version.
pub const TRUST_POLICY_SCHEMA: u32 = 1;
/// Project-registry record schema version.
pub const PROJECT_REGISTRY_SCHEMA: u32 = 1;
/// Operation-record schema version.
pub const OPERATION_RECORD_SCHEMA: u32 = 1;
/// Approval-record schema version.
pub const APPROVAL_RECORD_SCHEMA: u32 = 1;
/// Credential-metadata schema version.
pub const CREDENTIAL_METADATA_SCHEMA: u32 = 1;
/// Encrypted credential-envelope schema version.
pub const CREDENTIAL_ENVELOPE_SCHEMA: u32 = 1;
/// Emergency-stop state schema version.
pub const EMERGENCY_STOP_SCHEMA: u32 = 1;
/// Audit-record schema version.
pub const AUDIT_RECORD_SCHEMA: u32 = 1;
/// Approved-plan record schema version.
pub const PLAN_RECORD_SCHEMA: u32 = 1;
/// Durable owner-delegation lifecycle record schema version.
pub const DELEGATION_LIFECYCLE_SCHEMA: u32 = 1;
/// Protected-state manifest schema version.
pub const MANIFEST_SCHEMA: u32 = 1;
/// Journal/transaction record schema version.
pub const JOURNAL_RECORD_SCHEMA: u32 = 1;

use crate::error::PersistError;

/// Fail closed unless `got` equals `expected`.
///
/// # Errors
/// [`PersistError::UnsupportedSchema`] on any mismatch.
pub fn require_schema(got: u32, expected: u32) -> Result<(), PersistError> {
    if got == expected {
        Ok(())
    } else {
        Err(PersistError::UnsupportedSchema)
    }
}
