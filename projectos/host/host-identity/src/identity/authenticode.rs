//! Native Authenticode verification of the running Control Centre (WINDOWS-PACKAGED-RUNTIME-
//! IDENTITY2B).
//!
//! Verifies ONLY the Control Centre executable: signature presence, cryptographic validity, chain
//! and revocation status, and the signer's public-key identity taken from the SAME WinVerifyTrust
//! verification state. It does NOT verify the release, the daemon, the runtime, resources, a
//! manifest, the channel, or freshness — those are later phases.
//!
//! WinVerifyTrust receives the canonical path; the binding to the exact on-disk file is: the
//! restrictive retained handle (no write/delete sharing) is ALSO passed as `WINTRUST_FILE_INFO.hFile`
//! so the OS verifies that file object, the canonical path is derived from that handle, and the
//! stable file identity is re-confirmed after verification. The signer is read from the verification
//! state (`WTHelper*`) — never by re-parsing a possibly-changed path. The verification state is
//! closed on EVERY exit path by an RAII guard.
//!
//! No approved production publisher exists this phase, so a normal build's signer never matches a
//! policy → `CcSignature::Verified` is unreachable and protected eligibility stays disabled.

#![cfg(windows)]

use core::ffi::c_void;

use sha2::{Digest, Sha256};
use windows::core::GUID;
use windows::Win32::Foundation::{
    CERT_E_CHAINING, CERT_E_EXPIRED, CERT_E_REVOCATION_FAILURE, CERT_E_REVOKED,
    CERT_E_UNTRUSTEDROOT, CRYPT_E_SECURITY_SETTINGS, HWND, TRUST_E_BAD_DIGEST, TRUST_E_NOSIGNATURE,
};
use windows::Win32::Security::Cryptography::{
    CryptEncodeObjectEx, CERT_PUBLIC_KEY_INFO, CRYPT_ENCODE_OBJECT_FLAGS, PKCS_7_ASN_ENCODING,
    X509_ASN_ENCODING, X509_PUBLIC_KEY_INFO,
};
use windows::Win32::Security::WinTrust::{
    WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData,
    WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
    WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE,
    WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
};

use super::composite::CcSignature;
use super::publisher_policy::PublisherOutcome;
use super::running_executable::{pre_verify_ok, RunningExecutable};
use projectos_windows_runtime_primitives::handles::win32;

/// Signature presence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignaturePresence {
    Unsigned,
    Present,
}

/// Cryptographic validity of the signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureCryptography {
    NotChecked,
    Invalid,
    Valid,
}

/// Certificate-chain validity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CertificateChain {
    NotChecked,
    Invalid,
    Valid,
}

/// Revocation status. This phase performs NO network revocation (`WTD_REVOKE_NONE`), so the normal
/// result is `NotChecked`; `Unknown`/`Revoked` arise only if the OS reports them regardless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Revocation {
    NotChecked,
    Good,
    Unknown,
    Revoked,
}

/// The separated native facts — NOT collapsed before the controlled reducer runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticodeFacts {
    pub presence: SignaturePresence,
    pub crypto: SignatureCryptography,
    pub chain: CertificateChain,
    pub revocation: Revocation,
    /// SPKI_SHA256: SHA-256 of the canonical DER-encoded `SubjectPublicKeyInfo` (algorithm + key),
    /// taken from the same verification state. Not a thumbprint, not the SKI, not raw key bytes.
    pub signer_spki_sha256: Option<[u8; 32]>,
}

impl AuthenticodeFacts {
    /// A fail-closed fact set (reparse rejected, identity changed, verify unavailable). Reduces to a
    /// clearly-unverified `CcSignature`.
    pub const fn unverifiable() -> AuthenticodeFacts {
        AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Invalid,
            chain: CertificateChain::NotChecked,
            revocation: Revocation::NotChecked,
            signer_spki_sha256: None,
        }
    }

    const fn unsigned() -> AuthenticodeFacts {
        AuthenticodeFacts {
            presence: SignaturePresence::Unsigned,
            crypto: SignatureCryptography::NotChecked,
            chain: CertificateChain::NotChecked,
            revocation: Revocation::NotChecked,
            signer_spki_sha256: None,
        }
    }
}

/// The verifier seam. Production is [`Win32Authenticode`]; tests script facts deterministically.
pub trait AuthenticodeVerifier {
    fn verify(&self, exe: &RunningExecutable) -> AuthenticodeFacts;
}

/// The production Windows implementation.
pub struct Win32Authenticode;

/// RAII guard that closes the WinVerifyTrust verification state on EVERY exit path (§8). Holds a raw
/// pointer to the stack `WINTRUST_DATA`, which outlives the guard within the calling scope.
struct TrustStateGuard {
    data: *mut WINTRUST_DATA,
    action: GUID,
}

impl Drop for TrustStateGuard {
    fn drop(&mut self) {
        // SAFETY: `data` points to the live stack WINTRUST_DATA that created the state; re-issuing
        // WinVerifyTrust with WTD_STATEACTION_CLOSE frees `hWVTStateData`. No pointer escapes.
        unsafe {
            (*self.data).dwStateAction = WTD_STATEACTION_CLOSE;
            let _ = WinVerifyTrust(
                HWND(core::ptr::null_mut()),
                &mut self.action,
                self.data as *mut c_void,
            );
        }
    }
}

/// Extract the signer's publisher fingerprint from the verification state: **SPKI_SHA256** — the
/// SHA-256 of the canonical DER encoding of the signer certificate's `SubjectPublicKeyInfo`
/// (algorithm identifier + parameters + public-key BIT STRING), NOT a certificate thumbprint, NOT
/// the Subject Key Identifier, and NOT the raw key bytes. Renewing a certificate with the same key
/// yields the same fingerprint; a different public key (or a materially different encoded algorithm)
/// yields a different fingerprint. Every pointer is null-checked; nothing is retained past this call.
fn signer_spki_sha256(state: windows::Win32::Foundation::HANDLE) -> Option<[u8; 32]> {
    // SAFETY: `state` is the `hWVTStateData` produced by a successful WinVerifyTrust; each pointer is
    // validated non-null before dereference. `CryptEncodeObjectEx` is called with the documented
    // two-call size pattern (no ALLOC flag, so no CryptMemFree is owed): a size query, then an encode
    // into a Vec whose length the first call reported. Only the reported bytes are hashed. No pointer
    // is retained beyond this function (the state guard closes afterwards).
    unsafe {
        let prov = WTHelperProvDataFromStateData(state);
        if prov.is_null() {
            return None;
        }
        let sgnr = WTHelperGetProvSignerFromChain(prov, 0, false, 0);
        if sgnr.is_null() {
            return None;
        }
        let cert = WTHelperGetProvCertFromChain(sgnr, 0);
        if cert.is_null() {
            return None;
        }
        let cert_ctx = (*cert).pCert;
        if cert_ctx.is_null() {
            return None;
        }
        let info = (*cert_ctx).pCertInfo;
        if info.is_null() {
            return None;
        }
        // Canonical DER-encode the whole SubjectPublicKeyInfo (algorithm + key), then SHA-256 it.
        let spki: *const CERT_PUBLIC_KEY_INFO = &(*info).SubjectPublicKeyInfo;
        let mut size: u32 = 0;
        // First call: size query (pvencoded = None).
        CryptEncodeObjectEx(
            X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
            X509_PUBLIC_KEY_INFO,
            spki as *const c_void,
            CRYPT_ENCODE_OBJECT_FLAGS(0),
            None,
            None,
            &mut size,
        )
        .ok()?;
        if size == 0 {
            return None;
        }
        let mut der = vec![0u8; size as usize];
        CryptEncodeObjectEx(
            X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
            X509_PUBLIC_KEY_INFO,
            spki as *const c_void,
            CRYPT_ENCODE_OBJECT_FLAGS(0),
            None,
            Some(der.as_mut_ptr() as *mut c_void),
            &mut size,
        )
        .ok()?;
        der.truncate(size as usize);
        let mut hasher = Sha256::new();
        hasher.update(&der);
        Some(hasher.finalize().into())
    }
}

/// Map a WinVerifyTrust return status to the separated native facts (signer filled on success).
fn facts_from_status(status: i32, state: windows::Win32::Foundation::HANDLE) -> AuthenticodeFacts {
    if status == 0 {
        return AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Valid,
            chain: CertificateChain::Valid,
            revocation: Revocation::NotChecked,
            signer_spki_sha256: signer_spki_sha256(state),
        };
    }
    let hr = status as u32;
    if hr == TRUST_E_NOSIGNATURE.0 as u32 {
        return AuthenticodeFacts::unsigned();
    }
    if hr == TRUST_E_BAD_DIGEST.0 as u32 {
        return AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Invalid,
            chain: CertificateChain::NotChecked,
            revocation: Revocation::NotChecked,
            signer_spki_sha256: None,
        };
    }
    if hr == CERT_E_UNTRUSTEDROOT.0 as u32
        || hr == CERT_E_CHAINING.0 as u32
        || hr == CERT_E_EXPIRED.0 as u32
    {
        return AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Valid,
            chain: CertificateChain::Invalid,
            revocation: Revocation::NotChecked,
            signer_spki_sha256: None,
        };
    }
    if hr == CERT_E_REVOKED.0 as u32 {
        return AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Valid,
            chain: CertificateChain::Valid,
            revocation: Revocation::Revoked,
            signer_spki_sha256: None,
        };
    }
    if hr == CERT_E_REVOCATION_FAILURE.0 as u32 || hr == CRYPT_E_SECURITY_SETTINGS.0 as u32 {
        return AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Valid,
            chain: CertificateChain::Valid,
            revocation: Revocation::Unknown,
            signer_spki_sha256: None,
        };
    }
    // Any other non-zero status: present but not cryptographically acceptable. Fail closed.
    AuthenticodeFacts {
        presence: SignaturePresence::Present,
        crypto: SignatureCryptography::Invalid,
        chain: CertificateChain::NotChecked,
        revocation: Revocation::NotChecked,
        signer_spki_sha256: None,
    }
}

impl AuthenticodeVerifier for Win32Authenticode {
    fn verify(&self, exe: &RunningExecutable) -> AuthenticodeFacts {
        let mut file_info = WINTRUST_FILE_INFO {
            cbStruct: core::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: exe.canonical_wide_ptr(),
            // Passing the retained handle binds verification to THIS file object, not a re-open.
            hFile: win32(exe.handle()),
            pgKnownSubject: core::ptr::null_mut(),
        };
        let mut data = WINTRUST_DATA {
            cbStruct: core::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 {
                pFile: &mut file_info,
            },
            dwStateAction: WTD_STATEACTION_VERIFY,
            dwProvFlags: WTD_REVOCATION_CHECK_NONE,
            ..Default::default()
        };
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;

        // SAFETY: `data` is a correctly-sized WINTRUST_DATA whose union points to the live
        // `file_info` (both outlive the call); `action` is a live GUID. The returned status is a
        // documented LONG. The guard below closes the resulting verification state on every path.
        let status = unsafe {
            WinVerifyTrust(
                HWND(core::ptr::null_mut()),
                &mut action,
                &mut data as *mut WINTRUST_DATA as *mut c_void,
            )
        };
        // Copy the state HANDLE (Copy) BEFORE the guard takes a mutable borrow of `data`.
        let state = data.hWVTStateData;
        let guard = TrustStateGuard {
            data: &mut data,
            action,
        };

        let facts = facts_from_status(status, state);
        // `file_info` must stay alive until the guard closes the state.
        let _ = &file_info;
        drop(guard);
        facts
    }
}

/// The bound verification flow: reject a reparse executable, verify, and re-confirm identity. Any
/// failure of the binding fails closed.
pub fn verify_bound(
    verifier: &dyn AuthenticodeVerifier,
    exe: &RunningExecutable,
) -> AuthenticodeFacts {
    if !pre_verify_ok(exe.reparse()) {
        return AuthenticodeFacts::unverifiable();
    }
    let facts = verifier.verify(exe);
    if !exe.reconfirm() {
        return AuthenticodeFacts::unverifiable();
    }
    facts
}

/// The controlled reduction of native facts + publisher outcome into the committed `CcSignature`.
///
/// `Verified` requires ALL of: signature present, cryptography valid, chain valid, publisher
/// `Expected`, AND revocation explicitly `Good`. `NotChecked` (the real `WTD_REVOKE_NONE` result)
/// and `Unknown` both project to `RevocationUnknown` and can NEVER reach `Verified` — an unchecked
/// certificate is not a confirmed one. `Expected` is only reachable under a test-fixture policy.
pub fn derive_cc_signature(facts: &AuthenticodeFacts, publisher: PublisherOutcome) -> CcSignature {
    match facts.presence {
        SignaturePresence::Unsigned => return CcSignature::Unsigned,
        SignaturePresence::Present => {}
    }
    match facts.crypto {
        SignatureCryptography::Invalid => return CcSignature::SignatureInvalid,
        SignatureCryptography::NotChecked => return CcSignature::SignatureInvalid,
        SignatureCryptography::Valid => {}
    }
    if matches!(facts.chain, CertificateChain::Invalid) {
        return CcSignature::ChainInvalid;
    }
    match facts.revocation {
        Revocation::Revoked => return CcSignature::Revoked,
        // Unchecked OR unknown revocation is unconfirmed — never Verified. Distinct read-only class.
        Revocation::Unknown | Revocation::NotChecked => return CcSignature::RevocationUnknown,
        // Only an explicitly-good revocation status may proceed to the publisher gate.
        Revocation::Good => {}
    }
    // Crypto + chain + revocation good: the publisher policy decides.
    match publisher {
        PublisherOutcome::Unavailable => CcSignature::PublisherPolicyUnavailable,
        PublisherOutcome::Unexpected => CcSignature::PublisherMismatch,
        PublisherOutcome::Expected => CcSignature::Verified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::publisher_policy::{PublisherKey, PublisherPolicy};

    fn facts_rev(revocation: Revocation, signer: Option<[u8; 32]>) -> AuthenticodeFacts {
        AuthenticodeFacts {
            presence: SignaturePresence::Present,
            crypto: SignatureCryptography::Valid,
            chain: CertificateChain::Valid,
            revocation,
            signer_spki_sha256: signer,
        }
    }
    /// Present + crypto-valid + chain-valid + revocation explicitly GOOD (the only path that can
    /// reach the publisher gate). Reachable only via the deterministic seam, never the real
    /// `WTD_REVOKE_NONE` native operation.
    fn good_facts(signer: Option<[u8; 32]>) -> AuthenticodeFacts {
        facts_rev(Revocation::Good, signer)
    }

    #[test]
    fn unsigned_reduces_to_unsigned() {
        assert_eq!(
            derive_cc_signature(
                &AuthenticodeFacts::unsigned(),
                PublisherOutcome::Unavailable
            ),
            CcSignature::Unsigned
        );
    }

    #[test]
    fn crypto_invalid_reduces_to_signature_invalid() {
        assert_eq!(
            derive_cc_signature(
                &AuthenticodeFacts::unverifiable(),
                PublisherOutcome::Unavailable
            ),
            CcSignature::SignatureInvalid
        );
    }

    #[test]
    fn policy_unavailable_never_verifies() {
        // Good revocation reaches the publisher gate; with no policy → PublisherPolicyUnavailable.
        let cc = derive_cc_signature(&good_facts(Some([1u8; 32])), PublisherOutcome::Unavailable);
        assert_eq!(cc, CcSignature::PublisherPolicyUnavailable);
        assert_ne!(cc, CcSignature::Verified);
    }

    #[test]
    fn unexpected_publisher_is_mismatch_not_verified() {
        assert_eq!(
            derive_cc_signature(&good_facts(Some([2u8; 32])), PublisherOutcome::Unexpected),
            CcSignature::PublisherMismatch
        );
    }

    /// ONLY the exact all-good fact set (present + valid + chain-valid + revocation GOOD + Expected)
    /// can produce Verified — the deterministic reducer proof (§5 case B).
    #[test]
    fn only_good_and_expected_verifies() {
        assert_eq!(
            derive_cc_signature(&good_facts(Some([3u8; 32])), PublisherOutcome::Expected),
            CcSignature::Verified
        );
    }

    /// Revocation NOT CHECKED (the real WTD_REVOKE_NONE result) can NEVER reach Verified, even with
    /// a matching Expected publisher — it projects RevocationUnknown (§3/§4).
    #[test]
    fn notchecked_revocation_never_verifies() {
        let cc = derive_cc_signature(
            &facts_rev(Revocation::NotChecked, Some([3u8; 32])),
            PublisherOutcome::Expected,
        );
        assert_eq!(cc, CcSignature::RevocationUnknown);
        assert_ne!(cc, CcSignature::Verified);
    }

    #[test]
    fn chain_invalid_and_revoked_and_unknown_map_distinctly() {
        let chain_bad = AuthenticodeFacts {
            chain: CertificateChain::Invalid,
            ..good_facts(None)
        };
        assert_eq!(
            derive_cc_signature(&chain_bad, PublisherOutcome::Expected),
            CcSignature::ChainInvalid
        );
        assert_eq!(
            derive_cc_signature(
                &facts_rev(Revocation::Revoked, None),
                PublisherOutcome::Expected
            ),
            CcSignature::Revoked
        );
        assert_eq!(
            derive_cc_signature(
                &facts_rev(Revocation::Unknown, None),
                PublisherOutcome::Expected
            ),
            CcSignature::RevocationUnknown
        );
    }

    /// The REAL native path against the running (unsigned) test binary: WinVerifyTrust must report
    /// no signature, reducing to `Unsigned` under the production (Unavailable) policy — the
    /// fail-closed smoke result.
    #[test]
    fn real_verify_of_unsigned_test_binary_is_unsigned() {
        let exe = std::env::current_exe().unwrap();
        let re = RunningExecutable::open_path_for_test(&exe).expect("open test exe");
        let facts = verify_bound(&Win32Authenticode, &re);
        assert_eq!(
            facts.presence,
            SignaturePresence::Unsigned,
            "the unsigned test binary must report no Authenticode signature"
        );
        let policy = PublisherPolicy::production();
        let cc = derive_cc_signature(&facts, policy.evaluate(facts.signer_spki_sha256));
        assert_eq!(cc, CcSignature::Unsigned);
        assert_ne!(cc, CcSignature::Verified);
    }

    /// Find an EMBEDDED-Authenticode-signed executable (catalog-only files like modern notepad.exe
    /// return no embedded signature to a file-based verify). Skips the test if none is present.
    fn find_embedded_signed_exe() -> Option<RunningExecutable> {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:/Program Files".into());
        let lad = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidates = [
            format!("{pf}/nodejs/node.exe"),
            format!("{pf}/Git/cmd/git.exe"),
            format!("{lad}/Programs/Microsoft VS Code/Code.exe"),
        ];
        for c in candidates {
            let p = std::path::PathBuf::from(&c);
            if !p.is_file() {
                continue;
            }
            if let Some(re) = RunningExecutable::open_path_for_test(&p) {
                let facts = verify_bound(&Win32Authenticode, &re);
                if facts.presence == SignaturePresence::Present
                    && facts.crypto == SignatureCryptography::Valid
                    && facts.signer_spki_sha256.is_some()
                {
                    return Some(re);
                }
            }
        }
        None
    }

    /// The REAL native path against an embedded-signed binary (no signing performed by us):
    /// exercises WinVerifyTrust success + same-state SPKI extraction. The real operation uses
    /// `WTD_REVOKE_NONE`, so revocation is NotChecked and — even under a matching test policy — the
    /// result is `RevocationUnknown`, NEVER Verified. This proves the native mechanism cannot reach
    /// Verified (§5 case A).
    #[test]
    fn real_signed_binary_extracts_spki_but_stays_unverified_due_to_notchecked_revocation() {
        let Some(re) = find_embedded_signed_exe() else {
            eprintln!("SKIP: no embedded-Authenticode-signed binary found on this machine");
            return;
        };
        let facts = verify_bound(&Win32Authenticode, &re);
        assert_eq!(facts.presence, SignaturePresence::Present);
        assert_eq!(facts.crypto, SignatureCryptography::Valid);
        assert_eq!(
            facts.revocation,
            Revocation::NotChecked,
            "the real WTD_REVOKE_NONE operation must not check revocation"
        );
        let spki = facts
            .signer_spki_sha256
            .expect("SPKI extracted from the same verification state");

        // Production (Unavailable) policy → RevocationUnknown (revocation gate precedes publisher).
        let prod = PublisherPolicy::production();
        assert_eq!(
            derive_cc_signature(&facts, prod.evaluate(facts.signer_spki_sha256)),
            CcSignature::RevocationUnknown
        );
        // Even a matching test policy cannot lift a NotChecked certificate to Verified.
        let matching = PublisherPolicy::test_only(vec![PublisherKey { spki_sha256: spki }]);
        let cc = derive_cc_signature(&facts, matching.evaluate(facts.signer_spki_sha256));
        assert_ne!(cc, CcSignature::Verified);
        assert_eq!(cc, CcSignature::RevocationUnknown);
    }

    /// SPKI_SHA256 is a stable, canonical fingerprint: re-extracting from the same binary yields the
    /// same 32-byte value; a different signer (a second embedded-signed binary, if present) yields a
    /// different value. No private key, path, or display name is involved.
    #[test]
    fn spki_fingerprint_is_stable_and_distinguishing() {
        let Some(re1) = find_embedded_signed_exe() else {
            eprintln!("SKIP: no embedded-signed binary");
            return;
        };
        let a = verify_bound(&Win32Authenticode, &re1).signer_spki_sha256;
        let b = verify_bound(&Win32Authenticode, &re1).signer_spki_sha256;
        assert!(a.is_some());
        assert_eq!(a, b, "same SPKI must produce the same fingerprint");
        assert_eq!(a.unwrap().len(), 32);

        // A second, differently-signed binary (Microsoft-signed Edge vs the first signer) should
        // differ. Best-effort: only asserts inequality when a distinct signer is actually found.
        let pfx86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
        let edge =
            std::path::PathBuf::from(format!("{pfx86}/Microsoft/Edge/Application/msedge.exe"));
        if let Some(re2) = RunningExecutable::open_path_for_test(&edge) {
            let c = verify_bound(&Win32Authenticode, &re2).signer_spki_sha256;
            if let (Some(x), Some(y)) = (a, c) {
                if x != y {
                    assert_ne!(
                        x, y,
                        "different signers must produce different fingerprints"
                    );
                }
            }
        }
    }
}
