//! The embedded production verification anchor.
//!
//! WHAT THIS IS. One compile-time constant naming the ProjectOS public key that production manifest
//! signatures are checked against. It is embedded in the application because the whole point of the
//! trust chain is that the manifest does NOT get to nominate its own verifier: an anchor supplied by
//! the same untrusted package would verify anything that package chose to sign.
//!
//! IT IS NOW PROVISIONED. The owner created the production signing identity on 2026-08-12 and
//! approved embedding its PUBLIC half. Until then this was deliberately `None` and production
//! identity failed closed with `ProductionIdentityUnavailable` — a real key exists to be used for a
//! real release, not to make a test go green, so no placeholder was ever embedded. A dummy anchor
//! whose private half nobody holds is worse than none: it makes the production path look wired, so
//! the day the real key arrives nobody can tell whether verification ever worked.
//!
//! THE PRIVATE HALF IS NOT HERE AND NEVER WILL BE. It lives in the owner's Windows CNG current-user
//! store as a non-exportable key. ProjectOS has no code that reads, holds or produces a signature:
//! signing happens outside, and only the detached signature and this public point come back in.
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

/// The owner's production public key: the uncompressed P-256 point, `0x04 || X || Y`.
///
/// PUBLIC MATERIAL ONLY. This is half of a key pair whose private half lives in the owner's Windows
/// CNG current-user store as a non-exportable key and has never been read, copied or handled by
/// ProjectOS. Publishing a public key is what public keys are for; there is nothing secret here.
///
/// Written as bytes rather than a hex string because this build parses no hex at startup and no
/// ASN.1 anywhere — a trust boundary should not depend on a decoder. The bytes were generated
/// mechanically from the owner's `.hex` file and round-tripped, not transcribed by hand.
///
/// Full value, for one-glance comparison against the owner's file:
/// `04c8ddcd420db70a2868ee51ec34b507be8579ce9fb3cd7a392e364a974540976bb7bec77c9cbe04a92d2c202dc243d5af987b76ce09bfacd0bf6804b500880754`
const OWNER_PUBLIC_POINT: [u8; UNCOMPRESSED_P256_POINT_LEN] = [
    0x04, 0xc8, 0xdd, 0xcd, 0x42, 0x0d, 0xb7, 0x0a, //
    0x28, 0x68, 0xee, 0x51, 0xec, 0x34, 0xb5, 0x07, //
    0xbe, 0x85, 0x79, 0xce, 0x9f, 0xb3, 0xcd, 0x7a, //
    0x39, 0x2e, 0x36, 0x4a, 0x97, 0x45, 0x40, 0x97, //
    0x6b, 0xb7, 0xbe, 0xc7, 0x7c, 0x9c, 0xbe, 0x04, //
    0xa9, 0x2d, 0x2c, 0x20, 0x2d, 0xc2, 0x43, 0xd5, //
    0xaf, 0x98, 0x7b, 0x76, 0xce, 0x09, 0xbf, 0xac, //
    0xd0, 0xbf, 0x68, 0x04, 0xb5, 0x00, 0x88, 0x07, //
    0x54,
];

/// The identity of the key above. Must equal the `signingKeyId` a manifest declares, and that field
/// is INSIDE the canonical signed bytes — so a manifest cannot be re-pointed at another key without
/// invalidating its own signature.
pub const PRODUCTION_KEY_ID: &str = "projectos-signing-20260812";

/// The embedded production anchor.
///
/// PROVISIONED AT THE OWNER GATE on 2026-08-12, superseding the deliberate `None`. It changes what
/// the application will trust, so it is a visible source change reviewed like any other — not
/// configuration, not an environment variable, not a file beside the executable. Anything a running
/// machine could edit would defeat the anchor, which is the entire reason it is a constant.
pub const PRODUCTION_ANCHOR: Option<EmbeddedAnchor> = Some(EmbeddedAnchor {
    key_id: PRODUCTION_KEY_ID,
    public_point: &OWNER_PUBLIC_POINT,
});

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

    /// THIS REPLACES `no_production_anchor_is_embedded_yet`.
    ///
    /// That test asserted the anchor's ABSENCE, so that provisioning one could not happen quietly.
    /// The owner has now provisioned it, so the protection changes shape rather than disappearing:
    /// what used to be "there must be no anchor" becomes "there must be exactly this anchor, and it
    /// must be structurally sound". Deleting the old test without replacing its guarantee would have
    /// left the most security-relevant constant in the crate covered by nothing at all.
    #[test]
    fn the_production_anchor_is_the_owner_key_and_nothing_else() {
        let anchor = PRODUCTION_ANCHOR.expect("the production anchor is provisioned");

        assert_eq!(
            anchor.key_id, "projectos-signing-20260812",
            "the anchor's key id must be the owner's approved signing identity",
        );
        assert_eq!(
            anchor.public_point.len(),
            UNCOMPRESSED_P256_POINT_LEN,
            "the public point must be a 65-byte uncompressed P-256 point",
        );
        assert_eq!(
            anchor.public_point[0], 0x04,
            "the public point must carry the uncompressed X9.62 tag",
        );
        assert!(
            anchor_is_wellformed(&anchor),
            "the embedded anchor must pass the same wellformedness check as any other",
        );

        // A test key must never become the thing production trusts. `evaluate()` refuses this
        // prefix under production policy, but the anchor is checked here too so that the refusal
        // does not depend on a check somewhere else still being present.
        assert!(
            !anchor.key_id.starts_with("TEST-ONLY-"),
            "a TEST-ONLY key id must never be the production anchor",
        );
        assert!(
            !anchor.key_id.contains("unprovisioned") && !anchor.key_id.contains("placeholder"),
            "the placeholder key id must never reach the production anchor",
        );

        // Not the fixture key. The fixture point used throughout these tests is a constant fill;
        // a real public key is not, and confusing the two is precisely the mistake worth failing on.
        let uniform_fill = anchor.public_point[1..]
            .iter()
            .all(|b| *b == anchor.public_point[1]);
        assert!(
            !uniform_fill,
            "the anchor is a synthetic constant-fill point, not a real public key",
        );

        // The algorithm is the application's, fixed, with nothing to negotiate.
        assert_eq!(PRODUCTION_ALGORITHM, "es256");
    }

    /// There is ONE anchor. A second or fallback anchor would mean two keys could produce a trusted
    /// build, and the weaker of them would set the real security level.
    #[test]
    fn there_is_exactly_one_production_anchor_and_no_fallback() {
        // Cut the test module off first. This very test names the constant it forbids duplicates
        // of, so a scan that reads its own assertions counts itself and reports two anchors where
        // there is one. Comments go too, for the same reason: prose that mentions a forbidden token
        // is not the code doing the forbidden thing.
        let source = include_str!("anchor.rs");
        let production_source = match source.find("#[cfg(test)]") {
            Some(at) => &source[..at],
            None => source,
        };
        let code = production_source
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            code.matches("pub const PRODUCTION_ANCHOR").count(),
            1,
            "there must be exactly one production anchor constant",
        );
        for forbidden in ["FALLBACK_ANCHOR", "SECONDARY_ANCHOR", "ANCHORS:"] {
            assert!(
                !code.contains(forbidden),
                "a {forbidden} would make the weakest key the real security level",
            );
        }
        // The anchor must not be readable from anything a running machine can edit.
        for forbidden in ["env::var", "std::env", "read_to_string", "ProgramData"] {
            assert!(
                !code.contains(forbidden),
                "the anchor must be a compile-time constant, never sourced from {forbidden}",
            );
        }
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
