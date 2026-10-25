//! ECDSA P-256 / SHA-256 signature verification, and nothing else.
//!
//! ONE ALGORITHM. `es256` is the whole supported set: no negotiation, no manifest-selected
//! algorithm, no provider registry, no fallback. The application owns the policy; a manifest that
//! names anything else is refused before a byte of it is verified. An algorithm a signer can choose
//! is an algorithm an attacker can downgrade.
//!
//! WHY THE OPERATING SYSTEM DOES THE MATHS. Verification runs through Windows CNG (BCrypt), which is
//! already a dependency of this crate and already used elsewhere in the workspace. The alternative
//! was pulling a third-party elliptic-curve crate onto a trust boundary — a supply-chain decision
//! that is not mine to take quietly, and one that is not even available offline here.
//!
//! NO ASN.1. The public key is an uncompressed X9.62 point and the signature is raw `r || s`, which
//! is exactly what BCrypt consumes. There is therefore no DER parser in this path — the classic
//! source of signature-verification bugs is absent because the code that would contain it does not
//! exist.
//!
//! THIS FILE VERIFIES. It never signs, never generates a key, never touches a private key, and holds
//! no key material of its own: the caller passes a public point in and gets a yes or no back.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use super::anchor::{RAW_P256_SIGNATURE_LEN, UNCOMPRESSED_P256_POINT_LEN};
use super::errors::IdentityError;

/// Verify a raw P-256 signature over `message` under the given uncompressed public point.
///
/// Returns `Ok(())` only for a genuine, well-formed, matching signature. Every other outcome —
/// malformed key, malformed signature, wrong key, altered message, unavailable provider — is
/// `ManifestSignatureInvalid`. The refusals are deliberately indistinguishable to a caller: telling
/// an attacker WHICH part of their forgery was wrong is free help.
#[cfg(windows)]
pub fn verify_es256(
    public_point: &[u8],
    message: &[u8],
    signature: &[u8],
) -> Result<(), IdentityError> {
    use super::hash::sha256_bytes;
    use windows::core::PCWSTR;
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptDestroyKey, BCryptImportKeyPair,
        BCryptOpenAlgorithmProvider, BCryptVerifySignature, BCRYPT_ALG_HANDLE,
        BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM, BCRYPT_FLAGS, BCRYPT_KEY_HANDLE,
        BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS,
    };

    // Shape first. A wrong-length key or signature is refused before any FFI call, so malformed
    // input never reaches the provider at all.
    if public_point.len() != UNCOMPRESSED_P256_POINT_LEN || public_point[0] != 0x04 {
        return Err(IdentityError::ManifestSignatureInvalid);
    }
    if signature.len() != RAW_P256_SIGNATURE_LEN {
        return Err(IdentityError::ManifestSignatureInvalid);
    }

    // BCRYPT_ECCKEY_BLOB: { magic: u32, cbKey: u32 } followed by X then Y — the 0x04 tag is dropped,
    // because CNG's blob format states the curve through the magic value instead of the tag byte.
    const BCRYPT_ECDSA_PUBLIC_P256_MAGIC: u32 = 0x3153_4345; // 'ECS1'
    const P256_COORD_LEN: u32 = 32;
    let mut blob = Vec::with_capacity(8 + 64);
    blob.extend_from_slice(&BCRYPT_ECDSA_PUBLIC_P256_MAGIC.to_le_bytes());
    blob.extend_from_slice(&P256_COORD_LEN.to_le_bytes());
    blob.extend_from_slice(&public_point[1..]);

    let digest = sha256_bytes(message);

    // SAFETY: every call below is a documented CNG entry point used with owned local buffers whose
    // lifetimes outlive the call, and every handle is closed on every path. `alg` and `key` are
    // written by the provider before use and are only read after a success check. No pointer
    // escapes this function and no buffer is aliased.
    unsafe {
        let mut alg = BCRYPT_ALG_HANDLE::default();
        if BCryptOpenAlgorithmProvider(
            &mut alg,
            BCRYPT_ECDSA_P256_ALGORITHM,
            PCWSTR::null(),
            BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
        )
        .is_err()
        {
            return Err(IdentityError::ManifestSignatureInvalid);
        }

        let mut key = BCRYPT_KEY_HANDLE::default();
        let imported = BCryptImportKeyPair(alg, None, BCRYPT_ECCPUBLIC_BLOB, &mut key, &blob, 0);
        if imported.is_err() {
            let _ = BCryptCloseAlgorithmProvider(alg, 0);
            return Err(IdentityError::ManifestSignatureInvalid);
        }

        // No padding info: ECDSA takes none. The digest is verified, never the message.
        let verified = BCryptVerifySignature(key, None, &digest, signature, BCRYPT_FLAGS(0));

        let _ = BCryptDestroyKey(key);
        let _ = BCryptCloseAlgorithmProvider(alg, 0);

        if verified.is_err() {
            return Err(IdentityError::ManifestSignatureInvalid);
        }
    }
    Ok(())
}

/// Non-Windows builds cannot verify a packaged Windows identity, and say so rather than pretending.
#[cfg(not(windows))]
pub fn verify_es256(
    _public_point: &[u8],
    _message: &[u8],
    _signature: &[u8],
) -> Result<(), IdentityError> {
    Err(IdentityError::ManifestSignatureInvalid)
}

/// One lower-case hex digit, or nothing. Upper case is refused on purpose — see `decode_hex`.
const fn digit(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    }
}

/// Decode lowercase hex into bytes. Returns `None` on any non-hex or odd-length input.
///
/// Present because the anchor and the manifest signature are both hex text, and a lenient decoder
/// that skipped junk would let a signature be padded with characters the verifier ignored.
pub fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < b.len() {
        // LOWER-CASE ONLY, deliberately. `to_digit(16)` accepts 'A'..='F', which would make two
        // different texts decode to the same signature — and the format this build states is
        // lower-case hex. A canonical format that quietly accepts non-canonical input is not one.
        // Caught in self-review: a test asserted upper-case was refused while the decoder accepted
        // it, and the test passed only because the bogus signature failed the maths afterwards.
        let hi = digit(b[i])?;
        let lo = digit(b[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_decoding_refuses_anything_that_is_not_exactly_hex() {
        assert_eq!(decode_hex("04ff"), Some(vec![0x04, 0xff]));
        assert_eq!(decode_hex(""), Some(vec![]));
        // Upper case is refused: the stated format is lower-case hex, and two different texts
        // decoding to one signature is not a property a canonical format should have.
        for bad in [
            "0", "0g", "zz", "04 ff", "04ff ", "0x04", "04\n", "04FF", "AB", "0A", "aB",
        ] {
            assert!(decode_hex(bad).is_none(), "{bad} must not decode");
        }
    }

    #[test]
    fn a_malformed_key_or_signature_is_refused_without_reaching_the_provider() {
        let msg = b"canonical manifest bytes";
        let good_sig = [0u8; RAW_P256_SIGNATURE_LEN];
        let good_key = {
            let mut k = [0u8; UNCOMPRESSED_P256_POINT_LEN];
            k[0] = 0x04;
            k
        };
        // Wrong key length, wrong tag, wrong signature length — each refused.
        assert!(verify_es256(&good_key[..64], msg, &good_sig).is_err());
        let mut compressed = good_key;
        compressed[0] = 0x02;
        assert!(verify_es256(&compressed, msg, &good_sig).is_err());
        assert!(verify_es256(&good_key, msg, &good_sig[..63]).is_err());
    }

    /// An all-zero point is not a valid curve point; CNG must refuse it rather than accept a
    /// signature under a degenerate key.
    #[test]
    #[cfg(windows)]
    fn a_degenerate_key_does_not_verify() {
        let mut k = [0u8; UNCOMPRESSED_P256_POINT_LEN];
        k[0] = 0x04;
        assert!(verify_es256(&k, b"m", &[0u8; RAW_P256_SIGNATURE_LEN]).is_err());
    }
}

/// TEST-ONLY ephemeral P-256 key material, generated in-process and never persisted.
///
/// WHY THIS EXISTS. Every negative test in this file passes just as well against a verifier that
/// rejects EVERYTHING, so on their own they prove nothing about verification working. A positive
/// control is the only thing that distinguishes "correctly refuses forgeries" from "broken".
///
/// WHY IT IS SAFE. The key pair is generated by CNG at test runtime, lives in memory for the length
/// of one test, is never written to disk, never enters the manifest, and cannot reach the production
/// graph: this module is `#[cfg(test)]`, and the production anchor is a separate `const` that stays
/// `None`. It is not a ProjectOS signing identity and never becomes one.
#[cfg(all(test, windows))]
mod fixture_key {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptDestroyKey, BCryptExportKey, BCryptFinalizeKeyPair,
        BCryptGenerateKeyPair, BCryptOpenAlgorithmProvider, BCryptSignHash, BCRYPT_ALG_HANDLE,
        BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM, BCRYPT_FLAGS, BCRYPT_KEY_HANDLE,
        BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS,
    };

    /// An ephemeral key pair: the uncompressed public point, and signatures it can produce.
    pub struct EphemeralKey {
        pub public_point: Vec<u8>,
        alg: BCRYPT_ALG_HANDLE,
        key: BCRYPT_KEY_HANDLE,
    }

    impl EphemeralKey {
        pub fn generate() -> EphemeralKey {
            // SAFETY: CNG entry points with owned locals; handles are stored and closed in Drop.
            unsafe {
                let mut alg = BCRYPT_ALG_HANDLE::default();
                BCryptOpenAlgorithmProvider(
                    &mut alg,
                    BCRYPT_ECDSA_P256_ALGORITHM,
                    PCWSTR::null(),
                    BCRYPT_OPEN_ALGORITHM_PROVIDER_FLAGS(0),
                )
                .ok()
                .ok()
                .expect("open ecdsa p256 provider");
                let mut key = BCRYPT_KEY_HANDLE::default();
                BCryptGenerateKeyPair(alg, &mut key, 256, 0)
                    .ok()
                    .expect("generate p256 pair");
                BCryptFinalizeKeyPair(key, 0)
                    .ok()
                    .expect("finalize p256 pair");

                // Export the public blob, then rebuild the uncompressed X9.62 point CNG omits.
                let mut needed = 0u32;
                BCryptExportKey(key, None, BCRYPT_ECCPUBLIC_BLOB, None, &mut needed, 0)
                    .ok()
                    .ok()
                    .expect("size public blob");
                let mut blob = vec![0u8; needed as usize];
                BCryptExportKey(
                    key,
                    None,
                    BCRYPT_ECCPUBLIC_BLOB,
                    Some(&mut blob),
                    &mut needed,
                    0,
                )
                .ok()
                .ok()
                .expect("export public blob");
                // { magic: u32, cbKey: u32 } then X || Y.
                let mut public_point = Vec::with_capacity(65);
                public_point.push(0x04);
                public_point.extend_from_slice(&blob[8..8 + 64]);
                EphemeralKey {
                    public_point,
                    alg,
                    key,
                }
            }
        }

        /// Sign a SHA-256 digest of `message`, returning the raw r||s signature.
        pub fn sign(&self, message: &[u8]) -> Vec<u8> {
            let digest = super::super::hash::sha256_bytes(message);
            // SAFETY: owned buffers; the key handle is live for the lifetime of `self`.
            unsafe {
                let mut needed = 0u32;
                BCryptSignHash(self.key, None, &digest, None, &mut needed, BCRYPT_FLAGS(0))
                    .ok()
                    .ok()
                    .expect("size signature");
                let mut sig = vec![0u8; needed as usize];
                BCryptSignHash(
                    self.key,
                    None,
                    &digest,
                    Some(&mut sig),
                    &mut needed,
                    BCRYPT_FLAGS(0),
                )
                .ok()
                .ok()
                .expect("sign digest");
                sig
            }
        }
    }

    impl Drop for EphemeralKey {
        fn drop(&mut self) {
            // SAFETY: both handles were produced by the matching CNG calls above and are closed once.
            unsafe {
                let _ = BCryptDestroyKey(self.key);
                let _ = BCryptCloseAlgorithmProvider(self.alg, 0);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod positive_control {
    use super::fixture_key::EphemeralKey;
    use super::*;

    const MESSAGE: &[u8] = b"{\"canonical\":\"trust manifest bytes\"}";

    /// THE POSITIVE CONTROL. Without this, every other test in this file would pass against a
    /// verifier that rejected everything.
    #[test]
    fn a_genuine_signature_verifies() {
        let k = EphemeralKey::generate();
        let sig = k.sign(MESSAGE);
        assert_eq!(
            sig.len(),
            RAW_P256_SIGNATURE_LEN,
            "CNG returns raw r||s for ECDSA"
        );
        assert!(verify_es256(&k.public_point, MESSAGE, &sig).is_ok());
    }

    /// Altering the signed bytes must break verification — this is what binds a signature to the
    /// manifest it was made over.
    #[test]
    fn an_altered_message_does_not_verify() {
        let k = EphemeralKey::generate();
        let sig = k.sign(MESSAGE);
        let mut tampered = MESSAGE.to_vec();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01; // one bit
        assert!(verify_es256(&k.public_point, &tampered, &sig).is_err());
    }

    /// A genuine signature by the WRONG key must not verify — the anchor identifies one signer.
    #[test]
    fn a_signature_by_another_key_does_not_verify() {
        let mine = EphemeralKey::generate();
        let theirs = EphemeralKey::generate();
        let sig = theirs.sign(MESSAGE);
        assert!(verify_es256(&mine.public_point, MESSAGE, &sig).is_err());
    }

    /// Flipping a bit anywhere in the signature must break it.
    #[test]
    fn an_altered_signature_does_not_verify() {
        let k = EphemeralKey::generate();
        let good = k.sign(MESSAGE);
        for byte in [0usize, 31, 32, 63] {
            let mut bad = good.clone();
            bad[byte] ^= 0x01;
            assert!(
                verify_es256(&k.public_point, MESSAGE, &bad).is_err(),
                "signature with byte {byte} flipped must not verify"
            );
        }
    }
}
