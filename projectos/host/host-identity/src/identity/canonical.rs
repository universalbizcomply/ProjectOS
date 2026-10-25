//! Canonical manifest serialization for signing/verification. The canonical form is the manifest
//! with the `signature` field removed, re-serialised in a FIXED field order. Because we parse into a
//! typed struct first, any field-order or whitespace differences in the source JSON collapse to the
//! same canonical bytes — so a signature over these bytes is stable regardless of source formatting.
//! Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use serde::Serialize;

use super::manifest::{
    DaemonArtefactManifest, ExecutionClosureManifest, RuntimeManifest, TrustManifest,
};
use super::types::InstallationModel;

/// A view of every signed field in a fixed declaration order, excluding `signature`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalView<'a> {
    schema_version: u32,
    manifest_version: u32,
    application_id: &'a str,
    application_version: &'a str,
    build_id: &'a str,
    installation_model: InstallationModel,
    runtime: &'a RuntimeManifest,
    daemon_artefact: &'a DaemonArtefactManifest,
    generated_at: &'a str,
    minimum_protocol_version: u32,
    signature_algorithm: &'a str,
    signing_key_id: &'a str,
    /// The execution closure, APPENDED LAST and omitted entirely when absent.
    ///
    /// BOTH OF THOSE ARE LOAD-BEARING. serde emits struct fields in declaration order, so a field
    /// inserted anywhere but the end would shift the bytes of every manifest that has one — and a
    /// field emitted as `null` rather than omitted would change the bytes of every manifest that
    /// does not. Appending it and skipping `None` is what makes a version 1 canonical subject
    /// byte-for-byte what it was before this contract existed, so every signature already made over
    /// a v1 manifest still verifies and none of them silently starts covering a closure it never
    /// signed.
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_closure: Option<&'a ExecutionClosureManifest>,
}

/// Deterministic canonical bytes over all fields except `signature`.
pub fn canonical_bytes(m: &TrustManifest) -> Vec<u8> {
    let view = CanonicalView {
        schema_version: m.schema_version,
        manifest_version: m.manifest_version,
        application_id: &m.application_id,
        application_version: &m.application_version,
        build_id: &m.build_id,
        installation_model: m.installation_model,
        runtime: &m.runtime,
        daemon_artefact: &m.daemon_artefact,
        generated_at: &m.generated_at,
        minimum_protocol_version: m.minimum_protocol_version,
        signature_algorithm: &m.signature_algorithm,
        signing_key_id: &m.signing_key_id,
        execution_closure: m.execution_closure.as_ref(),
    };
    // serde_json emits struct fields in declaration order → deterministic compact bytes.
    serde_json::to_vec(&view).unwrap_or_default()
}
