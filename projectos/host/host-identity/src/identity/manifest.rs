//! Strict TrustManifest contract + parsing. Unknown fields are rejected (`deny_unknown_fields`) so
//! a tampered manifest cannot smuggle extra trust hints. The signature covers the canonical bytes of
//! every field EXCEPT `signature` (see canonical.rs). Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use serde::{Deserialize, Serialize};

use super::errors::IdentityError;
use super::types::InstallationModel;

/// Highest schema/manifest/protocol the code understands. A newer manifest fails closed.
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
pub const SUPPORTED_MANIFEST_VERSION_MAX: u32 = 1;
pub const SUPPORTED_MIN_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub relative_path: String,
    pub sha256: String,
    pub expected_version: String,
    pub platform: String,
    pub architecture: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DaemonArtefactManifest {
    pub relative_path: String,
    pub sha256: String,
    pub format: String,
    pub build_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TrustManifest {
    pub schema_version: u32,
    pub manifest_version: u32,
    pub application_id: String,
    pub application_version: String,
    pub build_id: String,
    pub installation_model: InstallationModel,
    pub runtime: RuntimeManifest,
    pub daemon_artefact: DaemonArtefactManifest,
    pub generated_at: String,
    pub minimum_protocol_version: u32,
    pub signature_algorithm: String,
    pub signing_key_id: String,
    /// Detached signature over the canonical bytes of all other fields. Never part of canonical.
    pub signature: String,
}

impl TrustManifest {
    /// Parse raw manifest bytes into a strict typed manifest. Malformed / unknown-field JSON fails.
    pub fn parse(raw: &[u8]) -> Result<TrustManifest, IdentityError> {
        serde_json::from_slice::<TrustManifest>(raw).map_err(|_| IdentityError::ManifestMalformed)
    }

    /// Reject a manifest whose schema/version/protocol the code does not understand (fail closed).
    pub fn check_versions(&self) -> Result<(), IdentityError> {
        if self.schema_version != SUPPORTED_SCHEMA_VERSION
            || self.manifest_version == 0
            || self.manifest_version > SUPPORTED_MANIFEST_VERSION_MAX
            || self.minimum_protocol_version < SUPPORTED_MIN_PROTOCOL_VERSION
        {
            return Err(IdentityError::ManifestVersionUnsupported);
        }
        Ok(())
    }
}
