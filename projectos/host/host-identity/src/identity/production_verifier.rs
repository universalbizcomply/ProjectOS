//! The production manifest signature verifier.
//!
//! It is the only implementation of `TrustManifestSignatureVerifier` that reports
//! `is_production() == true`, and it does so ONLY when an embedded anchor actually exists. That
//! coupling is the point: `evaluate()` refuses a non-production verifier under production policy,
//! so a build with no anchor cannot accidentally satisfy the production path — it fails closed at
//! the step that asks for a production verifier, with `ProductionIdentityUnavailable`.
//!
//! WHAT IT CHECKS, in order, refusing at the first failure:
//!   1. an anchor is embedded at all;
//!   2. the anchor is structurally well-formed;
//!   3. the manifest's algorithm is exactly `es256` — the application's choice, not the manifest's;
//!   4. the manifest's `signingKeyId` names the embedded anchor;
//!   5. the signature is hex of the right length;
//!   6. the signature verifies over the CANONICAL bytes under the anchor's public key.
//!
//! THE FIXTURE VERIFIER CANNOT REACH THIS PATH. `DeterministicTestVerifier` is compiled only under
//! `test` or `test-fixtures`, reports `is_production() == false`, and its key ids carry the
//! `TEST-ONLY-` prefix that `evaluate()` rejects under production policy. Three independent
//! barriers, none of which depends on the others holding.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use super::anchor::{
    anchor_is_wellformed, EmbeddedAnchor, PRODUCTION_ALGORITHM, PRODUCTION_ANCHOR,
    RAW_P256_SIGNATURE_LEN,
};
use super::errors::IdentityError;
use super::es256::{decode_hex, verify_es256};
use super::types::VerifiedSigner;
use super::verifier::{SignatureInput, TrustManifestSignatureVerifier};

/// Verifier bound to one embedded anchor.
pub struct ProductionEs256Verifier {
    anchor: Option<EmbeddedAnchor>,
}

impl ProductionEs256Verifier {
    /// The shipping verifier, bound to whatever anchor this build embeds.
    pub const fn from_embedded() -> Self {
        Self {
            anchor: PRODUCTION_ANCHOR,
        }
    }

    /// Bind an explicit anchor. Used by tests to exercise the real verification path with a real
    /// key pair, and by nothing else — the shipping application always uses `from_embedded`.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub const fn with_anchor(anchor: EmbeddedAnchor) -> Self {
        Self {
            anchor: Some(anchor),
        }
    }

    /// The anchor this verifier would use, if it is usable at all.
    fn usable_anchor(&self) -> Option<&EmbeddedAnchor> {
        self.anchor.as_ref().filter(|a| anchor_is_wellformed(a))
    }
}

impl TrustManifestSignatureVerifier for ProductionEs256Verifier {
    fn verify(&self, input: &SignatureInput<'_>) -> Result<VerifiedSigner, IdentityError> {
        let anchor = match self.usable_anchor() {
            Some(a) => a,
            // No anchor, or a malformed one. There is nothing to verify against, and inventing a
            // fallback here is exactly how a trust chain becomes decorative.
            None => return Err(IdentityError::ProductionIdentityUnavailable),
        };
        // The APPLICATION owns the algorithm. A manifest naming anything else is refused here rather
        // than dispatched to some other implementation, because there is no other implementation.
        if input.algorithm != PRODUCTION_ALGORITHM {
            return Err(IdentityError::ManifestSignatureInvalid);
        }
        // The signature must be made by the key this build trusts, not merely by some key.
        if input.signing_key_id != anchor.key_id {
            return Err(IdentityError::ManifestSignerUnknown);
        }
        let signature = match decode_hex(input.signature) {
            Some(s) if s.len() == RAW_P256_SIGNATURE_LEN => s,
            _ => return Err(IdentityError::ManifestSignatureInvalid),
        };
        verify_es256(anchor.public_point, input.canonical, &signature)?;

        Ok(VerifiedSigner {
            signer_id: anchor.key_id.to_string(),
            // Deliberately fixed: this crate takes no clock, and a verifier that invented a
            // timestamp would be asserting a fact it did not observe.
            verified_at: "1970-01-01T00:00:00.000Z".to_string(),
            verifier_impl_id: "production-es256-cng".to_string(),
            signature_algorithm: PRODUCTION_ALGORITHM.to_string(),
            evidence_ref: "embedded-anchor".to_string(),
            production_grade: true,
        })
    }

    /// Production ONLY when an anchor is genuinely embedded and well-formed.
    ///
    /// Returning `true` with no anchor would let `evaluate()` past the "is there a production
    /// verifier?" gate and into a signature check that could never succeed — turning a clear
    /// `ProductionIdentityUnavailable` into a confusing signature failure. Worse, it would make a
    /// keyless build LOOK production-capable.
    fn is_production(&self) -> bool {
        self.usable_anchor().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_ID: &str = "projectos-signing-test";
    const POINT: [u8; 65] = {
        let mut p = [7u8; 65];
        p[0] = 0x04;
        p
    };

    fn anchored() -> ProductionEs256Verifier {
        ProductionEs256Verifier::with_anchor(EmbeddedAnchor {
            key_id: KEY_ID,
            public_point: &POINT,
        })
    }

    fn input<'a>(algorithm: &'a str, key_id: &'a str, signature: &'a str) -> SignatureInput<'a> {
        SignatureInput {
            canonical: b"canonical manifest bytes",
            algorithm,
            signing_key_id: key_id,
            signature,
        }
    }

    /// REPLACES `the_shipping_verifier_is_not_production_without_an_anchor`.
    ///
    /// That test asserted the keyless state: no anchor, therefore not a production verifier. The
    /// owner has provisioned the anchor, so the fact to protect is now the opposite one — the
    /// shipping build IS a production verifier, and it is bound to the owner's key specifically
    /// rather than to any key. The fail-closed-without-a-usable-anchor path has not stopped being
    /// covered: `a_malformed_anchor_is_not_production_either`, below, drives exactly that branch.
    #[test]
    fn the_shipping_verifier_is_production_and_bound_to_the_owner_key() {
        let v = ProductionEs256Verifier::from_embedded();
        assert!(
            v.is_production(),
            "the shipping build embeds the owner anchor and must be production-grade",
        );

        // Bound to THAT key: a manifest naming another signer is refused before any signature maths.
        let err = v
            .verify(&input("es256", "some-other-key", &"ab".repeat(64)))
            .unwrap_err();
        assert_eq!(err, IdentityError::ManifestSignerUnknown);

        // And the algorithm is the application's, not the manifest's. Named via the embedded anchor
        // rather than a repeated literal, so this asserts against the key the build actually has.
        let embedded = PRODUCTION_ANCHOR.expect("the production anchor is provisioned");
        let err = v
            .verify(&input("rs256", embedded.key_id, &"ab".repeat(64)))
            .unwrap_err();
        assert_eq!(err, IdentityError::ManifestSignatureInvalid);
    }

    #[test]
    fn a_malformed_anchor_is_not_production_either() {
        const SHORT: [u8; 10] = [0x04; 10];
        let v = ProductionEs256Verifier::with_anchor(EmbeddedAnchor {
            key_id: KEY_ID,
            public_point: &SHORT,
        });
        assert!(!v.is_production());
        assert_eq!(
            v.verify(&input("es256", KEY_ID, &"ab".repeat(64)))
                .unwrap_err(),
            IdentityError::ProductionIdentityUnavailable
        );
    }

    /// One algorithm. A manifest cannot select another, and there is nothing to select.
    #[test]
    fn only_es256_is_accepted() {
        let v = anchored();
        for alg in [
            "es384",
            "rs256",
            "eddsa",
            "ES256",
            "es256 ",
            "",
            "test-fixture-sha256",
        ] {
            assert_eq!(
                v.verify(&input(alg, KEY_ID, &"ab".repeat(64))).unwrap_err(),
                IdentityError::ManifestSignatureInvalid,
                "algorithm {alg} must be refused"
            );
        }
    }

    /// A signature by SOME key is not a signature by THIS key.
    #[test]
    fn a_manifest_naming_another_key_is_refused() {
        let v = anchored();
        for id in [
            "another-key",
            "TEST-ONLY-fixture",
            "",
            "projectos-signing-test-2",
        ] {
            assert_eq!(
                v.verify(&input("es256", id, &"ab".repeat(64))).unwrap_err(),
                IdentityError::ManifestSignerUnknown,
                "key id {id} must be refused"
            );
        }
    }

    #[test]
    fn a_malformed_signature_is_refused_before_any_crypto() {
        let v = anchored();
        for sig in [
            "",                                // absent
            "ab",                              // far too short
            &"ab".repeat(63),                  // one byte short
            &"ab".repeat(65),                  // one byte long
            &format!("{}zz", "ab".repeat(63)), // right length, not hex
            &"AB".repeat(64),                  // upper-case hex is not the stated format
        ] {
            assert_eq!(
                v.verify(&input("es256", KEY_ID, sig)).unwrap_err(),
                IdentityError::ManifestSignatureInvalid,
                "signature {sig:?} must be refused"
            );
        }
    }

    /// A well-formed but wrong signature under a well-formed but bogus key must not verify. This is
    /// the real CNG path: shape checks pass, and the maths refuses.
    #[test]
    #[cfg(windows)]
    fn a_wellformed_forgery_does_not_verify() {
        let v = anchored();
        assert_eq!(
            v.verify(&input("es256", KEY_ID, &"11".repeat(64)))
                .unwrap_err(),
            IdentityError::ManifestSignatureInvalid
        );
    }
}
