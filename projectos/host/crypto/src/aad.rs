//! The single canonical associated-data (AAD) builder. AAD binds project, provider, environment,
//! credentialRef, credential-envelope schema version, record revision, project-DEK version, and the
//! algorithm identifier. Encoding is deterministic and collision-resistant: a fixed context header,
//! then per field a 1-byte tag + 4-byte big-endian length + bytes (explicit length framing — never an
//! unframed `a|b|c` concatenation). No secret material ever enters AAD.

use projectos_host_persistence::version::CREDENTIAL_ENVELOPE_SCHEMA;
use std::fmt;

use crate::error::CryptoError;
use crate::policy::{CryptoAlgorithm, KeyVersion};
use crate::scope::CredentialScope;

/// Maximum associated-data size (bytes). Reference safety bound.
pub const MAX_AAD_BYTES: usize = 4096;

/// A fixed context header binding this AAD to the credential-material domain + a format version.
const AAD_CONTEXT: &[u8] = b"projectos.host.crypto.aad.v1";

// Explicit, ordered field tags. Reordering fields changes the tag sequence and therefore the bytes.
const TAG_PROJECT: u8 = 0x01;
const TAG_PROVIDER: u8 = 0x02;
const TAG_ENVIRONMENT: u8 = 0x03;
const TAG_CREDENTIAL_REF: u8 = 0x04;
const TAG_SCHEMA_VERSION: u8 = 0x05;
const TAG_RECORD_REVISION: u8 = 0x06;
const TAG_DEK_VERSION: u8 = 0x07;
const TAG_ALGORITHM: u8 = 0x08;

/// Deterministic associated data. Non-secret; `Debug` shows the length only.
#[derive(Clone, PartialEq, Eq)]
pub struct AssociatedData(Vec<u8>);

impl AssociatedData {
    /// The AAD bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    /// The AAD length.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// Whether empty (never true for a built value).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for AssociatedData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AssociatedData")
            .field("len", &self.0.len())
            .finish()
    }
}

fn push_field(buf: &mut Vec<u8>, tag: u8, bytes: &[u8]) -> Result<(), CryptoError> {
    let len = u32::try_from(bytes.len()).map_err(|_| CryptoError::InvalidAssociatedData)?;
    buf.push(tag);
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(bytes);
    if buf.len() > MAX_AAD_BYTES {
        return Err(CryptoError::ResourceLimit);
    }
    Ok(())
}

/// Build the canonical AAD. Rejects invalid identities, an unsupported schema version, and a zero
/// record revision. The DEK version and algorithm are already type-constrained.
///
/// # Errors
/// [`CryptoError::InvalidIdentity`] for a malformed scope; [`CryptoError::InvalidAssociatedData`] for
/// an unsupported schema version; [`CryptoError::InvalidRevision`] for a zero record revision;
/// [`CryptoError::ResourceLimit`] if the AAD would exceed [`MAX_AAD_BYTES`].
pub fn build_associated_data(
    scope: &CredentialScope,
    schema_version: u32,
    record_revision: u64,
    dek_version: KeyVersion,
    algorithm: CryptoAlgorithm,
) -> Result<AssociatedData, CryptoError> {
    scope.validate()?;
    if schema_version != CREDENTIAL_ENVELOPE_SCHEMA {
        return Err(CryptoError::InvalidAssociatedData);
    }
    if record_revision == 0 {
        return Err(CryptoError::InvalidRevision);
    }

    let mut buf = Vec::with_capacity(AAD_CONTEXT.len() + 64);
    buf.extend_from_slice(AAD_CONTEXT);
    push_field(&mut buf, TAG_PROJECT, scope.project().as_str().as_bytes())?;
    push_field(&mut buf, TAG_PROVIDER, scope.provider().as_str().as_bytes())?;
    push_field(
        &mut buf,
        TAG_ENVIRONMENT,
        scope.environment().as_str().as_bytes(),
    )?;
    push_field(
        &mut buf,
        TAG_CREDENTIAL_REF,
        scope.credential_ref().as_str().as_bytes(),
    )?;
    push_field(&mut buf, TAG_SCHEMA_VERSION, &schema_version.to_be_bytes())?;
    push_field(
        &mut buf,
        TAG_RECORD_REVISION,
        &record_revision.to_be_bytes(),
    )?;
    push_field(
        &mut buf,
        TAG_DEK_VERSION,
        &dek_version.value().to_be_bytes(),
    )?;
    push_field(&mut buf, TAG_ALGORITHM, algorithm.identifier().as_bytes())?;
    Ok(AssociatedData(buf))
}

#[cfg(test)]
mod tests {
    use super::*;
    use projectos_trust_contract::{CredentialRef, EnvironmentId, ProjectId, ProviderId};

    fn scope(project: &str, provider: &str, env: &str, cref: &str) -> CredentialScope {
        CredentialScope::new(
            ProjectId::new(project).unwrap(),
            ProviderId::new(provider).unwrap(),
            EnvironmentId::new(env).unwrap(),
            CredentialRef::new(cref).unwrap(),
        )
    }

    fn v(n: u64) -> KeyVersion {
        KeyVersion::new(n).unwrap()
    }

    #[test]
    fn deterministic_same_inputs_same_bytes() {
        let s = scope("polygo", "supabase", "staging", "cred-1");
        let a = build_associated_data(&s, 1, 7, v(1), CryptoAlgorithm::Aes256Gcm).unwrap();
        let b = build_associated_data(&s, 1, 7, v(1), CryptoAlgorithm::Aes256Gcm).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn every_field_change_changes_output() {
        let base = build_associated_data(
            &scope("polygo", "supabase", "staging", "cred-1"),
            1,
            7,
            v(1),
            CryptoAlgorithm::Aes256Gcm,
        )
        .unwrap();
        let variants = [
            build_associated_data(
                &scope("other", "supabase", "staging", "cred-1"),
                1,
                7,
                v(1),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
            build_associated_data(
                &scope("polygo", "vercel", "staging", "cred-1"),
                1,
                7,
                v(1),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
            build_associated_data(
                &scope("polygo", "supabase", "production", "cred-1"),
                1,
                7,
                v(1),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
            build_associated_data(
                &scope("polygo", "supabase", "staging", "cred-2"),
                1,
                7,
                v(1),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
            build_associated_data(
                &scope("polygo", "supabase", "staging", "cred-1"),
                1,
                8,
                v(1),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
            build_associated_data(
                &scope("polygo", "supabase", "staging", "cred-1"),
                1,
                7,
                v(2),
                CryptoAlgorithm::Aes256Gcm,
            )
            .unwrap(),
        ];
        for var in variants {
            assert_ne!(base, var);
        }
    }

    #[test]
    fn framing_prevents_delimiter_collision() {
        // "ab" + "c" vs "a" + "bc": an unframed a|b|c concatenation would collide; framing must not.
        let left = build_associated_data(
            &scope("ab", "c", "staging", "cred-1"),
            1,
            7,
            v(1),
            CryptoAlgorithm::Aes256Gcm,
        )
        .unwrap();
        let right = build_associated_data(
            &scope("a", "bc", "staging", "cred-1"),
            1,
            7,
            v(1),
            CryptoAlgorithm::Aes256Gcm,
        )
        .unwrap();
        assert_ne!(left, right);
    }

    #[test]
    fn unsupported_schema_rejected() {
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            build_associated_data(&s, 2, 7, v(1), CryptoAlgorithm::Aes256Gcm).unwrap_err(),
            CryptoError::InvalidAssociatedData
        );
    }

    #[test]
    fn zero_revision_rejected() {
        let s = scope("polygo", "supabase", "staging", "cred-1");
        assert_eq!(
            build_associated_data(&s, 1, 0, v(1), CryptoAlgorithm::Aes256Gcm).unwrap_err(),
            CryptoError::InvalidRevision
        );
    }

    #[test]
    fn aad_size_bound_enforced() {
        // The MAX_AAD_BYTES bound is not reachable through bounded identities, so exercise the
        // framing guard directly: a push that would exceed the bound fails closed.
        let mut buf = vec![0u8; MAX_AAD_BYTES - 2];
        assert_eq!(
            push_field(&mut buf, TAG_PROJECT, &[1, 2, 3, 4]).unwrap_err(),
            CryptoError::ResourceLimit
        );
    }
}
