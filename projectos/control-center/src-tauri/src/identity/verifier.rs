//! Manifest signature-verifier abstraction.
//!
//! Production must eventually verify the manifest signature against a trust anchor EMBEDDED IN THE
//! SIGNED TAURI APPLICATION (or an equivalently protected release mechanism) — never a public key
//! supplied by the same untrusted manifest. No production verifier exists in this phase, so the
//! configured verifier is `None` and production fails closed.
//!
//! A deterministic TEST-ONLY verifier is provided for fixtures. It is not production-grade and is
//! rejected under production policy. It performs NO real cryptography — it recomputes a fixed hash so
//! tests can exercise the accept/reject wiring without a signing dependency.
//! Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use super::errors::IdentityError;
use super::hash::sha256_hex;
use super::types::VerifiedSigner;

/// Inputs to signature verification: canonical bytes (excluding the signature field) + the
/// manifest's declared algorithm, key id, and detached signature.
pub struct SignatureInput<'a> {
    pub canonical: &'a [u8],
    pub algorithm: &'a str,
    pub signing_key_id: &'a str,
    pub signature: &'a str,
}

/// A manifest signature verifier. Real production implementations will be added in a later phase
/// and MUST report `is_production() == true`.
pub trait TrustManifestSignatureVerifier {
    fn verify(&self, input: &SignatureInput<'_>) -> Result<VerifiedSigner, IdentityError>;
    /// True only for a genuine production verifier bound to an embedded trust anchor.
    fn is_production(&self) -> bool;
}

/// The TEST-ONLY key id prefix. Any manifest whose `signingKeyId` begins with this is a test
/// manifest and is rejected in production.
pub const TEST_KEY_ID_PREFIX: &str = "TEST-ONLY-";
/// The TEST-ONLY algorithm label. Never a real algorithm.
pub const TEST_ALGORITHM: &str = "test-fixture-sha256";
/// Fixed, non-secret salt so the deterministic test "signature" is reproducible in fixtures.
/// This is NOT a key and NOT a ProjectOS secret — it exists only to wire accept/reject tests.
const TEST_FIXTURE_SALT: &str = "projectos-packaged-identity-test-fixture";

/// Deterministic TEST-ONLY verifier. Not production-grade. Rejected by production policy.
pub struct DeterministicTestVerifier;

impl DeterministicTestVerifier {
    /// Compute the deterministic test "signature" for canonical bytes + key id. Test fixtures use
    /// the same function to produce a matching value. Not cryptographic.
    pub fn expected_signature(canonical: &[u8], signing_key_id: &str) -> String {
        let mut buf = Vec::with_capacity(canonical.len() + signing_key_id.len() + 16);
        buf.extend_from_slice(TEST_FIXTURE_SALT.as_bytes());
        buf.extend_from_slice(signing_key_id.as_bytes());
        buf.extend_from_slice(canonical);
        sha256_hex(&buf)
    }
}

impl TrustManifestSignatureVerifier for DeterministicTestVerifier {
    fn verify(&self, input: &SignatureInput<'_>) -> Result<VerifiedSigner, IdentityError> {
        if input.algorithm != TEST_ALGORITHM {
            return Err(IdentityError::ManifestSignatureInvalid);
        }
        if !input.signing_key_id.starts_with(TEST_KEY_ID_PREFIX) {
            return Err(IdentityError::ManifestSignerUnknown);
        }
        let expected = Self::expected_signature(input.canonical, input.signing_key_id);
        if !expected.eq_ignore_ascii_case(input.signature) {
            return Err(IdentityError::ManifestSignatureInvalid);
        }
        Ok(VerifiedSigner {
            signer_id: input.signing_key_id.to_string(),
            verified_at: "1970-01-01T00:00:00.000Z".to_string(),
            verifier_impl_id: "deterministic-test-verifier".to_string(),
            signature_algorithm: input.algorithm.to_string(),
            evidence_ref: "test".to_string(),
            production_grade: false,
        })
    }

    fn is_production(&self) -> bool {
        false
    }
}
