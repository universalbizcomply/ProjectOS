//! Installation-classification + composite-integration proofs (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B).
//!
//! Proves the installation classifier never reaches `PerMachineVerified`, that corroborating
//! evidence at most reaches `PerMachineEvidenceMatched`, and that even an all-verified composite
//! stays protected-Disabled — all through the crate's `test-fixtures` surface. Classification only.

#![cfg(all(windows, feature = "test-fixtures"))]

use projectos_host_identity::test_fixtures::identity::{
    classify_path, CcSignature, CompositeIdentity, InstallationEvidence, InstallationIdentity,
    KnownRoots, ProtectedEligibility, ReleaseChannel, ReleaseFileIntegrity, ReleaseFreshness,
    ReleaseManifest, ReparseState,
};

fn roots() -> KnownRoots {
    KnownRoots::for_test(
        vec!["C:\\Program Files"],
        vec!["C:\\Users\\u\\AppData\\Local"],
    )
}

#[test]
fn program_files_matched_evidence_is_evidence_matched_not_verified() {
    let got = classify_path(
        "c:\\program files\\projectos\\app.exe",
        ReparseState::None,
        InstallationEvidence::Matched,
        &roots(),
    );
    assert_eq!(got, InstallationIdentity::PerMachineEvidenceMatched);
    assert_ne!(got, InstallationIdentity::PerMachineVerified);
}

#[test]
fn per_machine_verified_is_unreachable_for_every_input() {
    for (p, rp, ev) in [
        (
            "c:\\program files\\x\\a.exe",
            ReparseState::None,
            InstallationEvidence::Matched,
        ),
        (
            "c:\\program files\\x\\a.exe",
            ReparseState::None,
            InstallationEvidence::Unavailable,
        ),
        (
            "c:\\users\\u\\appdata\\local\\x\\a.exe",
            ReparseState::None,
            InstallationEvidence::Matched,
        ),
        (
            "d:\\portable\\a.exe",
            ReparseState::None,
            InstallationEvidence::Matched,
        ),
        (
            "\\\\server\\share\\a.exe",
            ReparseState::None,
            InstallationEvidence::Matched,
        ),
        (
            "c:\\program files\\x\\a.exe",
            ReparseState::Present,
            InstallationEvidence::Matched,
        ),
    ] {
        assert_ne!(
            classify_path(p, rp, ev, &roots()),
            InstallationIdentity::PerMachineVerified
        );
    }
}

/// The decisive composite invariant: even a hand-built all-verified packaged composite (which no
/// real 2B path can produce) derives protected-Disabled. Confirms the reducer is fail-closed and
/// that release channel/manifest/integrity/freshness stay unverified.
#[test]
fn even_verified_signature_and_evidence_stays_protected_disabled() {
    let c = CompositeIdentity::packaged(
        CcSignature::Verified,
        InstallationIdentity::PerMachineEvidenceMatched,
    );
    assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
    assert_eq!(c.channel(), ReleaseChannel::Unknown);
    assert_eq!(c.manifest(), ReleaseManifest::NotChecked);
    assert_eq!(c.integrity(), ReleaseFileIntegrity::NotChecked);
    assert_eq!(c.freshness(), ReleaseFreshness::Unknown);
    // The owner projection never claims the release is verified.
    let view = c.to_status_view();
    let json = serde_json::to_string(&view).unwrap();
    assert!(!json.to_lowercase().contains("release verified"));
}

/// A packaged candidate built from the fail-closed unsigned signature stays Disabled and unverified.
#[test]
fn unsigned_packaged_candidate_is_disabled() {
    let c = CompositeIdentity::packaged(
        CcSignature::Unsigned,
        InstallationIdentity::PortableOrCopied,
    );
    assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
    assert_eq!(c.signature(), CcSignature::Unsigned);
}
