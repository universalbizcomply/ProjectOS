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
/// PROVENANCE IS NOW VERIFIED. This digest is byte-identical to the `win-x64/node.exe` entry in the
/// official `SHASUMS256.txt` that nodejs.org publishes for v24.14.1, checked during
/// PROJECTOS-RECOVERY-INSTALLED-APP1A. The upstream file is committed beside this crate, so the
/// check is repeatable OFFLINE forever — see `UPSTREAM_CHECKSUMS_FILE`.
pub const PACKAGED_NODE_SHA256: &str =
    "58e74bf02fc5bbacc41dcb8bef089961cd5bddd37830b87784e4fc624d145d1f";

/// The upstream checksum file this pin was verified against, committed as evidence.
///
/// BUILD-TIME EVIDENCE, NOT A RUNTIME DEPENDENCY. An installed ProjectOS never contacts nodejs.org
/// to decide whether its own already-hashed runtime is trustworthy: the digest above is compared
/// against the bytes on disk and that is the whole runtime check. This file exists so a reviewer can
/// re-establish where the digest came from without taking anyone's word for it.
pub const UPSTREAM_CHECKSUMS_FILE: &str = "provenance/node-v24.14.1-SHASUMS256.txt";

/// SHA-256 of that checksum file, so the evidence itself is pinned and a silent edit is detectable.
pub const UPSTREAM_CHECKSUMS_SHA256: &str =
    "cbbb0113ad929e40430a7dd73f91ef1cffd18eec160af3ac592eba1924255bf3";

/// The entry within the checksum file that the runtime pin must equal.
pub const UPSTREAM_CHECKSUMS_ENTRY: &str = "win-x64/node.exe";

/// WHAT WAS *NOT* VERIFIED, stated plainly.
///
/// nodejs.org also publishes `SHASUMS256.txt.sig`, an OpenPGP signature over that checksum file. It
/// is committed beside the checksums, and it IS a valid signature — made by RSA key
/// `890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4`. It has not been VERIFIED, because no trusted copy of
/// the Node release keys exists on the build machine and importing one now would be trust on first
/// use: it would establish a brand-new trust root on the strength of the same network fetch it is
/// supposed to corroborate. That is a decision for an owner, not a side effect of a build.
///
/// So the chain today is: pinned digest == published digest. It is not: pinned digest == digest
/// signed by a key ProjectOS trusts. The difference is recorded rather than glossed.
pub const UPSTREAM_SIGNATURE_KEY_ID: &str = "890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4";
/// Whether the OpenPGP signature over the checksum file has been verified against a trusted key.
pub const UPSTREAM_SIGNATURE_VERIFIED: bool = false;

/// Size in bytes of the pinned runtime. A cheap, independent cross-check: a candidate of the wrong
/// length is rejected before 91 MB are hashed, and a transcription error in the digest above shows
/// up as a length disagreement rather than as a mysterious hash mismatch.
pub const PACKAGED_NODE_BYTES: u64 = 91_426_304;

/// Where the pinned runtime was taken from on the build machine. Recorded for audit: a pin whose
/// origin nobody wrote down cannot be re-derived by anyone else.
pub const PACKAGED_NODE_PROVENANCE: &str = r"C:\Program Files\nodejs\node.exe";

/// THE application identity of the packaged product.
///
/// ONE DECLARATION, because there were two. `tauri.conf.json` stamps
/// `com.universalbizcomply.projectos.control` into the Windows bundle — that is what the packaging
/// configuration actually produces, so that is the product's identity — while the Control Centre
/// compiled in `com.projectos.control-center` as the id a manifest must claim. Nothing compared
/// them, so a manifest generated for the product would have been refused by the product.
///
/// The Tauri value wins because it is the one the packaging toolchain emits; the other was a
/// parallel name nothing outside `authority.rs` used. A regression in the Control Centre parses
/// `tauri.conf.json` and asserts its identifier still equals this constant, so the two cannot drift
/// apart again in silence.
pub const PACKAGED_APPLICATION_ID: &str = "com.universalbizcomply.projectos.control";

/// The app-owned subdirectory of the APPLICATION INSTALL ROOT that holds the closed runtime payload.
///
/// THREE ROOTS, KEPT APART. They were being collapsed into one because development keeps everything
/// close together:
///
///   * APPLICATION INSTALL ROOT — the directory the running executable lives in. It also holds the
///     Tauri runtime DLLs, icons and whatever the installer owns. The trust manifest does not
///     describe those and must not pretend to.
///   * PACKAGED RUNTIME PAYLOAD ROOT — this subdirectory. The closed subject the manifest attests:
///     the pinned runtime, the daemon bundle, the manifest and its canonical signing bytes, and
///     nothing else. Keeping it separate is what lets dependency closure say "everything here is
///     attested" without having to know the application's own file list.
///   * GOVERNED PROJECTOS ROOT — what the daemon may operate on. Not this, and not derived from it.
///
/// On Windows a Tauri resource lands beside the executable, so a named subdirectory beside the
/// executable is the smallest layout the existing packaging can produce. It is fixed here rather
/// than configurable: a payload location a caller could redirect is a payload an attacker chooses.
pub const PAYLOAD_RELATIVE_ROOT: &str = "runtime-payload";

/// The only packaged platform.
pub const PACKAGED_PLATFORM: &str = "windows";

/// The only packaged architecture.
pub const PACKAGED_ARCHITECTURE: &str = "x86_64";

/// Where the pinned runtime sits inside the payload, relative to the PAYLOAD root.
///
/// Fixed, never configurable. A runtime whose LOCATION could be redirected is a runtime an attacker
/// chooses; `evaluate()` binds this relative path beneath the payload root and never consults PATH.
pub const RUNTIME_RELATIVE_PATH: &str = "runtime/node.exe";

/// Where the single closed daemon bundle sits inside the payload, relative to the PAYLOAD root.
pub const DAEMON_RELATIVE_PATH: &str = "daemon/projectos-daemon.mjs";

/// The manifest file name, inside the PAYLOAD root. Part of the closed subject, not of the
/// application's own directory: the manifest describes the payload and travels with it.
pub const TRUST_MANIFEST_FILENAME: &str = "projectos-trust-manifest.json";

/// The canonical signing payload, written beside the manifest for a later signing ceremony.
///
/// Emitted as its own file on purpose: the signing step must never re-derive the bytes it signs,
/// because a second derivation is a second implementation waiting to disagree with the verifier.
pub const CANONICAL_SIGNING_FILENAME: &str = "projectos-trust-manifest.canonical";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE GATEKEEPER EXECUTION CLOSURE — attested, and deliberately NOT packaged.
//
// WHAT THESE ARE. The three ProjectOS-controlled inputs that decide whether the installation's
// provider credential may be used at all: the trusted-side broker program, the installation's
// project allowlist, and the credential adapter the broker runs to resolve the value. Between them
// they answer every authority question on the paid path.
//
// WHY THEY ARE NOT PAYLOAD PATHS, AND WHY THAT IS NOT A GAP. The broker is never executed from a
// path. Its caller reads its bytes out of the installation's git object store, pins the trusted
// install root into the source, and runs THOSE BYTES via `node -e` — so the thing verified is
// literally the thing that runs, and there is no verify-then-spawn window to close. The broker then
// reads the allowlist and the adapter through the same committed-bytes reader. Copying any of the
// three into the payload would create a SECOND copy whose relationship to the executed bytes is
// unproven; the manifest would then attest bytes nobody runs, which is worse than attesting nothing
// because it looks like coverage.
//
// SO THESE PATHS ARE REPOSITORY-RELATIVE, NOT PAYLOAD-RELATIVE. They name a location inside the
// ProjectOS installation's own committed tree. `RUNTIME_RELATIVE_PATH` and `DAEMON_RELATIVE_PATH`
// above are a different kind of thing and the manifest keeps them in a different kind of field: one
// describes bytes shipped in the payload, the other describes bytes proven committed. Calling both
// "packaged" would make the trust model read as if the installation carried files it does not.
//
// WHAT THE ATTESTATION BUYS. A second, independent witness. Git already proves these bytes are the
// committed ones; the owner-signed manifest proves the committed ones are the ones the owner
// approved. Neither replaces the other: git alone cannot tell a genuine commit from an approved
// one, and a digest alone cannot tell you what actually executed.
//
// Declared here because this crate is the ONE place packaging path facts live. A second literal
// elsewhere is the drift this crate exists to prevent.
// Added for RUN-TO-COMPLETION HOST ATTESTATION — EXECUTION CLOSURE TRUST.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// The trusted-side gatekeeper transport broker, relative to the ProjectOS installation root.
pub const BROKER_REPOSITORY_RELATIVE_PATH: &str =
    "projectos/security/gatekeeper-transport-broker.cjs";

/// The installation's committed project allowlist — the first factor on every paid call.
pub const INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH: &str =
    "projectos/security/installation-project-allowlist.json";

/// The Windows credential-store adapter the broker executes to resolve the credential.
pub const CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH: &str =
    "projectos/credentials/windows-credential-store.ps1";

/// The complete closure, in one place, so "which files are attested?" has a single answer.
///
/// EXACT, NOT GENEROUS. Widening this to "every file in ProjectOS" would make the manifest
/// impossible to regenerate and the refusal impossible to diagnose; narrowing it below three would
/// leave an authority-bearing input outside the owner-signed subject.
pub const EXECUTION_CLOSURE_REPOSITORY_PATHS: [&str; 3] = [
    BROKER_REPOSITORY_RELATIVE_PATH,
    INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
    CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
];

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

    /// The payload root is a single app-owned segment beneath the install root: not absolute, not
    /// traversing, and not nested, so the layout an installer must produce is unambiguous.
    #[test]
    fn the_payload_root_is_one_plain_segment_beneath_the_install_root() {
        assert!(!PAYLOAD_RELATIVE_ROOT.is_empty());
        assert!(!PAYLOAD_RELATIVE_ROOT.contains(".."));
        assert!(!PAYLOAD_RELATIVE_ROOT.contains('/'));
        assert!(!PAYLOAD_RELATIVE_ROOT.contains('\\'));
        assert!(!std::path::Path::new(PAYLOAD_RELATIVE_ROOT).is_absolute());
    }

    /// The execution-closure paths are git pathspecs into the installation's own tree.
    ///
    /// They are handed to `git show HEAD:./<rel>` and compared against a manifest field, so they
    /// must be relative, traversal-free and forward-slashed. A backslash would name a different
    /// object to git than it does to the filesystem, and the two witnesses would silently diverge.
    #[test]
    fn the_execution_closure_paths_are_relative_forward_slashed_pathspecs() {
        for p in EXECUTION_CLOSURE_REPOSITORY_PATHS {
            assert!(!p.is_empty());
            assert!(!p.contains(".."), "{p} must not traverse");
            assert!(
                !p.contains('\\'),
                "{p} must be a forward-slashed git pathspec"
            );
            assert!(
                !p.starts_with('/'),
                "{p} must be relative to the install root"
            );
            assert!(
                !std::path::Path::new(p).is_absolute(),
                "{p} must be relative"
            );
        }
    }

    /// Three DISTINCT artefacts. A copy-paste that pointed two entries at one file would attest the
    /// same bytes twice and leave a real authority input unbound — and every digest check would
    /// still pass.
    #[test]
    fn the_execution_closure_names_three_distinct_artefacts() {
        let mut seen = EXECUTION_CLOSURE_REPOSITORY_PATHS.to_vec();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), EXECUTION_CLOSURE_REPOSITORY_PATHS.len());
    }

    /// The closure paths are REPOSITORY-relative and must never be confused with the PAYLOAD-relative
    /// ones. They describe different kinds of evidence and are verified by different mechanisms; a
    /// collision would let a payload file satisfy a committed-bytes check.
    #[test]
    fn payload_paths_and_execution_closure_paths_do_not_overlap() {
        for payload in [RUNTIME_RELATIVE_PATH, DAEMON_RELATIVE_PATH] {
            assert!(
                !EXECUTION_CLOSURE_REPOSITORY_PATHS.contains(&payload),
                "{payload} is a payload path and must not also be an attested committed path"
            );
        }
    }

    /// The application id is a reverse-DNS bundle identifier, the shape Windows packaging emits.
    #[test]
    fn the_application_id_is_a_reverse_dns_identifier() {
        assert!(PACKAGED_APPLICATION_ID.contains('.'));
        assert!(!PACKAGED_APPLICATION_ID.contains(' '));
        assert!(PACKAGED_APPLICATION_ID
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    }

    /// THE PROVENANCE PROOF, and it runs offline.
    ///
    /// The committed upstream checksum file must still hash to what we recorded, and the runtime pin
    /// must still be exactly the digest nodejs.org published for `win-x64/node.exe`. Both halves
    /// matter: without the file digest, the evidence could be edited to say anything; without the
    /// entry check, the file could be genuine and unrelated to what we ship.
    #[test]
    fn the_runtime_pin_is_the_digest_nodejs_org_published() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(UPSTREAM_CHECKSUMS_FILE);
        let bytes = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("committed provenance evidence missing at {path:?}: {e}"));

        // The evidence file is itself pinned.
        let digest = {
            use std::fmt::Write as _;
            let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
            sha2::Digest::update(&mut hasher, &bytes);
            sha2::Digest::finalize(hasher)
                .iter()
                .fold(String::with_capacity(64), |mut acc, b| {
                    let _ = write!(acc, "{b:02x}");
                    acc
                })
        };
        assert_eq!(
            digest, UPSTREAM_CHECKSUMS_SHA256,
            "the committed upstream checksum file has changed"
        );

        // And the pin is the published entry, matched as a whole line rather than as a substring.
        let text = String::from_utf8(bytes).expect("the checksum file is text");
        let expected_line = format!("{PACKAGED_NODE_SHA256}  {UPSTREAM_CHECKSUMS_ENTRY}");
        assert!(
            text.lines().any(|l| l.trim_end() == expected_line),
            "the pinned runtime digest is not the published {UPSTREAM_CHECKSUMS_ENTRY} digest"
        );
    }

    /// The unverified half is declared as such. If someone later verifies the signature against a
    /// trusted key, this flag changes deliberately — it does not drift.
    #[test]
    // The assertion IS on a constant, deliberately. It is a tripwire: flipping
    // `UPSTREAM_SIGNATURE_VERIFIED` to true must break a test, so that claiming the signature has
    // been verified is a decision somebody makes on purpose rather than a line that slips through.
    #[allow(clippy::assertions_on_constants)]
    fn the_upstream_signature_is_declared_unverified() {
        assert!(
            !UPSTREAM_SIGNATURE_VERIFIED,
            "if the Node release-key signature has genuinely been verified against a TRUSTED key, \
             update this test and say where the trust in that key comes from"
        );
        assert_eq!(UPSTREAM_SIGNATURE_KEY_ID.len(), 40);
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
