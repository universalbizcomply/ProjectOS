//! SHA-256 hashing for runtime and daemon-artefact identity.
//! Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use sha2::{Digest, Sha256};

/// Lower-case hex SHA-256 of the given bytes.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Constant-shape check that `actual` equals the manifest `expected` hash. The expected value must
/// be a 64-char lower-case hex string; anything else is treated as a mismatch (fail closed).
pub fn hash_matches(actual_bytes: &[u8], expected_hex: &str) -> bool {
    if expected_hex.len() != 64 || !expected_hex.bytes().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    sha256_hex(actual_bytes).eq_ignore_ascii_case(expected_hex)
}
