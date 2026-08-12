//! THE packaging contract for a packaged ProjectOS installation.
//!
//! WHY THIS CRATE EXISTS. `PACKAGED_RUNTIME_VERSION` used to be a bare literal inside the Control
//! Centre's launch authority, and the manifest generator would have had a literal of its own. Two
//! literals describing one fact is a drift waiting to happen: the day they disagree, a correctly
//! assembled payload is refused by the application that assembled it, and the failure looks like a
//! tampered manifest. There is now ONE declaration, and everything that needs the fact derives it.
//!
//! WHAT A PIN IS. `PACKAGED_NODE_SHA256` is the digest of the exact `node.exe` this build packages.
//! The assembler refuses to copy any other bytes under that name. So "pinned" is enforced rather
//! than asserted: a payload cannot carry a different runtime than the one named here, and a manifest
//! therefore cannot attest to a runtime nobody pinned.
//!
//! WHAT THIS CRATE IS NOT. It holds no key material, no anchor, no signature and no authority. It
//! describes bytes and file names. Knowing which runtime is packaged grants nothing.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

#![forbid(unsafe_code)]

/// The exact Node runtime version a packaged installation carries.
///
/// AUTHORITATIVE. The Control Centre's `PACKAGED_RUNTIME_VERSION` is bound to this constant, and the
/// manifest generator writes this value into `runtime.expectedVersion`. `evaluate()` compares the two
/// and refuses a mismatch, so a drift between packager and application is a refusal, never a silent
/// acceptance.
pub const PACKAGED_NODE_VERSION: &str = "24.14.1";

/// SHA-256 of the pinned `node.exe`, lower-case hex.
///
/// This is the digest of the runtime actually installed on the build machine at
/// `PACKAGED_NODE_PROVENANCE` and measured during PROJECTOS-RECOVERY-INSTALLED-APP1A. The assembler
/// verifies a candidate runtime against it and refuses on mismatch — that refusal is what makes the
/// word "pinned" mean something.
///
/// PROVENANCE IS NOT VERIFIED HERE. This digest pins WHICH bytes get packaged. It does not prove
/// those bytes are the official nodejs.org distribution: confirming that needs the upstream
/// `SHASUMS256.txt`, which is a network fetch this increment was not authorised to perform. Recorded
/// as an open risk rather than papered over.
pub const PACKAGED_NODE_SHA256: &str =
    "58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f";

/// Size in bytes of the pinned runtime. A cheap, independent cross-check: a candidate of the wrong
/// length is rejected before 91 MB are hashed, and a transcription error in the digest above shows
/// up as a length disagreement rather than as a mysterious hash mismatch.
pub const PACKAGED_NODE_BYTES: u64 = 91_426_304;

/// Where the pinned runtime was taken from on the build machine. Recorded for audit: a pin whose
/// origin nobody wrote down cannot be re-derived by anyone else.
pub const PACKAGED_NODE_PROVENANCE: &str = r"C:\Program Files\nodejs\node.exe";

/// The only packaged platform.
pub const PACKAGED_PLATFORM: &str = "windows";

/// The only packaged architecture.
pub const PACKAGED_ARCHITECTURE: &str = "x86_64";

/// Where the pinned runtime sits inside the payload, relative to the install root.
///
/// Fixed, never configurable. A runtime whose LOCATION could be redirected is a runtime an attacker
/// chooses; `evaluate()` binds this relative path beneath the install root and never consults PATH.
pub const RUNTIME_RELATIVE_PATH: &str = "runtime/node.exe";

/// Where the single closed daemon bundle sits inside the payload, relative to the install root.
pub const DAEMON_RELATIVE_PATH: &str = "daemon/projectos-daemon.mjs";

/// The manifest file name the application looks for beside its executable.
pub const TRUST_MANIFEST_FILENAME: &str = "projectos-trust-manifest.json";

/// The canonical signing payload, written beside the manifest for a later signing ceremony.
///
/// Emitted as its own file on purpose: the signing step must never re-derive the bytes it signs,
/// because a second derivation is a second implementation waiting to disagree with the verifier.
pub const CANONICAL_SIGNING_FILENAME: &str = "projectos-trust-manifest.canonical";

#[cfg(test)]
mod tests {
    use super::*;

    /// The digest must be well-formed lower-case hex of the right length. A pin that is quietly
    /// malformed would compare unequal to every real runtime and turn "pinned" into "never matches".
    #[test]
    fn the_runtime_pin_is_a_wellformed_sha256() {
        assert_eq!(PACKAGED_NODE_SHA256.len(), 64);
        assert!(PACKAGED_NODE_SHA256
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }

    /// Payload paths must be relative and traversal-free, because they are joined beneath an install
    /// root by the application. An absolute or traversing constant here would produce payloads the
    /// verifier refuses.
    #[test]
    fn payload_paths_are_relative_and_do_not_traverse() {
        for p in [RUNTIME_RELATIVE_PATH, DAEMON_RELATIVE_PATH] {
            assert!(!p.is_empty());
            assert!(!p.contains(".."), "{p} must not traverse");
            assert!(
                !std::path::Path::new(p).is_absolute(),
                "{p} must be relative"
            );
            // A bare name would sit directly in the install root; the layout is deliberately nested
            // so the runtime and the daemon are separable units.
            assert!(p.contains('/'), "{p} must be nested inside the payload");
        }
    }

    /// The version is a plain dotted release, never a range, a tag or a `v` prefix: `evaluate()`
    /// compares it for exact equality with the manifest's declared runtime version.
    #[test]
    fn the_node_version_is_an_exact_release_not_a_range() {
        assert!(!PACKAGED_NODE_VERSION.is_empty());
        assert!(!PACKAGED_NODE_VERSION.starts_with('v'));
        for forbidden in ['^', '~', '>', '<', '*', '|', ' '] {
            assert!(
                !PACKAGED_NODE_VERSION.contains(forbidden),
                "a pinned version cannot contain {forbidden}"
            );
        }
        assert_eq!(PACKAGED_NODE_VERSION.split('.').count(), 3);
    }
}
