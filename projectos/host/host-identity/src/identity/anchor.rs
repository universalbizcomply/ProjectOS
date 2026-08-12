//! The embedded production verification anchor.
//!
//! WHAT THIS IS. One compile-time constant naming the ProjectOS public key that production manifest
//! signatures are checked against. It is embedded in the application because the whole point of the
//! trust chain is that the manifest does NOT get to nominate its own verifier: an anchor supplied by
//! the same untrusted package would verify anything that package chose to sign.
//!
//! IT IS ABSENT, AND THAT IS THE CORRECT STATE TODAY. The private half belongs to the owner and has
//! deliberately not been created — a production key exists to be used for a real release, not to
//! make a test go green. While the anchor is `None`, production identity fails closed with
//! `ProductionIdentityUnavailable`. The application runs read-only; it does not pretend.
//!
//! WHY THERE IS NO PLACEHOLDER. A dummy anchor whose private half nobody holds is worse than none:
//! it makes the production path look wired, so the day the real key arrives nobody can tell whether
//! verification ever worked. The absence is a fact the tests assert.
//!
//! FORMAT, fixed here so the owner gate is a single unambiguous operation:
//!   * key       — ECDSA P-256 public key as the UNCOMPRESSED X9.62 point, 65 bytes, `0x04 || X || Y`,
//!                 lowercase hex. Not SPKI, not PEM, not DER: this build parses no ASN.1, so there is
//!                 no ASN.1 parser to get wrong on a trust boundary.
//!   * key id    — `projectos-signing-<yyyymmdd>`, matching the manifest's `signingKeyId`.
//!   * algorithm — `es256` and nothing else. See `es256.rs`.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

/// The fixed, application-owned signature algorithm identifier. The manifest must declare exactly
/// this; there is no negotiation, no registry, and no fallback.
pub const PRODUCTION_ALGORITHM: &str = "es256";

/// Length of an uncompressed P-256 point: one tag byte plus two 32-byte coordinates.
pub const UNCOMPRESSED_P256_POINT_LEN: usize = 65;

/// Length of a raw P-256 signature: r || s, 32 bytes each. IEEE P1363 form, not DER.
pub const RAW_P256_SIGNATURE_LEN: usize = 64;

/// A production verification anchor: a key identity and the public point it names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmbeddedAnchor {
    /// Must equal the manifest's `signingKeyId` for the signature to be considered at all.
    pub key_id: &'static str,
    /// Uncompressed X9.62 point, exactly `UNCOMPRESSED_P256_POINT_LEN` bytes.
    pub public_point: &'static [u8],
}

/// The embedded production anchor, or `None` while the owner signing identity does not exist.
///
/// PROVISIONING THIS IS AN OWNER OPERATION. It changes what the application will trust, so it is a
/// visible source change reviewed like any other — not configuration, not an environment variable,
/// not a file beside the executable. Anything a running machine could edit would defeat the anchor.
pub const PRODUCTION_ANCHOR: Option<EmbeddedAnchor> = None;

/// Is this anchor structurally usable? A malformed anchor must never be treated as trust.
///
/// Checked at USE time rather than trusted from the constant, because the constant is edited by
/// hand at the owner gate and a wrong-length paste is exactly the mistake to expect.
pub const fn anchor_is_wellformed(a: &EmbeddedAnchor) -> bool {
    !a.key_id.is_empty()
        && a.public_point.len() == UNCOMPRESSED_P256_POINT_LEN
        && a.public_point[0] == 0x04
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The anchor is absent, and that is asserted rather than assumed. If someone provisions one,
    /// this test fails and forces the change to be a deliberate, reviewed act.
    #[test]
    fn no_production_anchor_is_embedded_yet() {
        assert!(
            PRODUCTION_ANCHOR.is_none(),
            "a production anchor was embedded; that is an owner-gated release decision"
        );
    }

    #[test]
    fn wellformedness_rejects_the_shapes_a_hand_edit_gets_wrong() {
        const GOOD: [u8; UNCOMPRESSED_P256_POINT_LEN] = [0x04; UNCOMPRESSED_P256_POINT_LEN];
        const SHORT: [u8; 64] = [0x04; 64];
        const COMPRESSED: [u8; UNCOMPRESSED_P256_POINT_LEN] = [0x02; UNCOMPRESSED_P256_POINT_LEN];

        assert!(anchor_is_wellformed(&EmbeddedAnchor {
            key_id: "projectos-signing-20260812",
            public_point: &GOOD,
        }));
        // Empty key id: nothing for the manifest's signingKeyId to match.
        assert!(!anchor_is_wellformed(&EmbeddedAnchor {
            key_id: "",
            public_point: &GOOD
        }));
        // Wrong length: a truncated paste.
        assert!(!anchor_is_wellformed(&EmbeddedAnchor {
            key_id: "k",
            public_point: &SHORT,
        }));
        // Compressed point: right length, wrong encoding — this build does not decompress.
        assert!(!anchor_is_wellformed(&EmbeddedAnchor {
            key_id: "k",
            public_point: &COMPRESSED,
        }));
    }
}
