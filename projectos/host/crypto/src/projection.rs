//! The single validated projection from a SEALED adapter-produced [`EncryptionArtifact`] into the
//! accepted `CredentialEnvelopeDto`. It computes NO digest of its own — the associated-data digest
//! comes from the adapter-produced binding inside the artifact. Scope, algorithm, key version, nonce,
//! ciphertext, and tag ALL come from the artifact, so a caller cannot swap any of them between
//! encryption and projection. It retains NO plaintext, performs NO persistence write, and returns NO
//! live authority. `recordRevision`/`createdRevision` are validated persistence data, not authority.

use projectos_host_persistence::version::CREDENTIAL_ENVELOPE_SCHEMA;
use projectos_host_persistence::{CredentialEnvelopeDto, RevocationStateDto};

use crate::error::CryptoError;
use crate::material::EncryptionArtifact;

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Project a sealed encryption artifact to a strictly-validated `CredentialEnvelopeDto`.
///
/// # Errors
/// [`CryptoError::ProjectionInvalid`] if the resulting DTO fails strict validation.
pub fn project_to_envelope_dto(
    artifact: &EncryptionArtifact,
    record_revision: u64,
    created_revision: u64,
) -> Result<CredentialEnvelopeDto, CryptoError> {
    let material = artifact.material();
    let scope = artifact.scope();
    let dto = CredentialEnvelopeDto {
        schema_version: CREDENTIAL_ENVELOPE_SCHEMA,
        record_revision,
        credential_ref: scope.credential_ref().as_str().to_string(),
        project: scope.project().as_str().to_string(),
        provider: scope.provider().as_str().to_string(),
        environment: scope.environment().as_str().to_string(),
        key_version: material.key_version().value(),
        algorithm: material.algorithm().identifier().to_string(),
        nonce: to_hex(material.nonce().as_bytes()),
        ciphertext: to_hex(material.ciphertext()),
        auth_tag: to_hex(material.tag().as_bytes()),
        // The digest is the ADAPTER-produced binding — this function computes no digest of its own.
        associated_data_digest: to_hex(artifact.aad_binding().as_bytes()),
        created_revision,
        revocation: RevocationStateDto::Active,
    };
    dto.validate().map_err(|_| CryptoError::ProjectionInvalid)?;
    Ok(dto)
}
