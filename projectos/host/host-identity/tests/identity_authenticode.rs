//! Native Authenticode verifier integration proofs (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B).
//!
//! Drives the real running-file identity + WinVerifyTrust path (against the unsigned test binary and
//! any embedded-signed binary present) plus the controlled reducer through the crate's
//! `test-fixtures` surface. No signing is performed; no production publisher exists. The real native
//! operation uses `WTD_REVOKE_NONE`, so its revocation fact is `NotChecked` and it can never reach
//! `Verified`; only a deterministic seam with an explicit `Good` revocation can (§5).

#![cfg(all(windows, feature = "test-fixtures"))]

use projectos_host_identity::test_fixtures::identity::{
    derive_cc_signature, verify_bound, AuthenticodeFacts, CcSignature, CertificateChain,
    PublisherKey, PublisherOutcome, PublisherPolicy, Revocation, RunningExecutable,
    SignatureCryptography, SignaturePresence, Win32Authenticode,
};

/// Present + valid + chain-valid + revocation GOOD — the only fact set that can reach the publisher
/// gate. Reachable only through this deterministic seam, never the real WTD_REVOKE_NONE operation.
fn good_facts(signer: Option<[u8; 32]>) -> AuthenticodeFacts {
    AuthenticodeFacts {
        presence: SignaturePresence::Present,
        crypto: SignatureCryptography::Valid,
        chain: CertificateChain::Valid,
        revocation: Revocation::Good,
        signer_spki_sha256: signer,
    }
}

/// No policy + good revocation → PublisherPolicyUnavailable, never Verified.
#[test]
fn no_policy_never_verifies() {
    let cc = derive_cc_signature(&good_facts(Some([1u8; 32])), PublisherOutcome::Unavailable);
    assert_eq!(cc, CcSignature::PublisherPolicyUnavailable);
    assert_ne!(cc, CcSignature::Verified);
}

/// Unavailable is distinct from Unexpected (mismatch).
#[test]
fn unavailable_distinct_from_mismatch() {
    assert_eq!(
        derive_cc_signature(&good_facts(Some([1u8; 32])), PublisherOutcome::Unexpected),
        CcSignature::PublisherMismatch
    );
}

/// Revocation NotChecked can never reach Verified even with a matching Expected publisher.
#[test]
fn notchecked_revocation_blocks_verified() {
    let facts = AuthenticodeFacts {
        revocation: Revocation::NotChecked,
        ..good_facts(Some([1u8; 32]))
    };
    let cc = derive_cc_signature(&facts, PublisherOutcome::Expected);
    assert_eq!(cc, CcSignature::RevocationUnknown);
    assert_ne!(cc, CcSignature::Verified);
}

/// Only the exact all-good set + Expected reaches Verified (deterministic reducer, §5 case B).
#[test]
fn only_good_and_expected_verifies() {
    assert_eq!(
        derive_cc_signature(&good_facts(Some([2u8; 32])), PublisherOutcome::Expected),
        CcSignature::Verified
    );
}

/// REAL native path: the unsigned test binary reports no signature and reduces to Unsigned under
/// the production policy — the fail-closed smoke result. Exercises WinVerifyTrust + the trust-state
/// guard end to end.
#[test]
fn real_unsigned_binary_is_unsigned() {
    let exe = std::env::current_exe().unwrap();
    let re = RunningExecutable::open_path_for_test(&exe).expect("open test exe");
    let facts = verify_bound(&Win32Authenticode, &re);
    assert_eq!(facts.presence, SignaturePresence::Unsigned);
    let policy = PublisherPolicy::production();
    let cc = derive_cc_signature(&facts, policy.evaluate(facts.signer_spki_sha256));
    assert_eq!(cc, CcSignature::Unsigned);
}

/// REAL native path: an embedded-signed binary (node/git/code) extracts an SPKI fingerprint from the
/// same verification state, but the real WTD_REVOKE_NONE operation leaves revocation NotChecked, so
/// even a matching test policy yields RevocationUnknown — never Verified. Skips if none present.
#[test]
fn real_signed_binary_spki_extracted_but_notchecked_revocation_blocks_verified() {
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
        let re = match RunningExecutable::open_path_for_test(&p) {
            Some(re) => re,
            None => continue,
        };
        let facts = verify_bound(&Win32Authenticode, &re);
        if facts.presence != SignaturePresence::Present || facts.signer_spki_sha256.is_none() {
            continue;
        }
        assert_eq!(facts.revocation, Revocation::NotChecked);
        // Production policy: RevocationUnknown, not Verified.
        let prod = PublisherPolicy::production();
        assert_ne!(
            derive_cc_signature(&facts, prod.evaluate(facts.signer_spki_sha256)),
            CcSignature::Verified
        );
        // Matching test policy: still not Verified — the certificate is unchecked.
        let key = facts.signer_spki_sha256.unwrap();
        let test = PublisherPolicy::test_only(vec![PublisherKey { spki_sha256: key }]);
        let cc = derive_cc_signature(&facts, test.evaluate(facts.signer_spki_sha256));
        assert_eq!(cc, CcSignature::RevocationUnknown);
        assert_ne!(cc, CcSignature::Verified);
        assert_eq!(key.len(), 32); // stable 32-byte SPKI fingerprint
        return;
    }
    eprintln!("SKIP: no embedded-signed binary on this machine");
}
