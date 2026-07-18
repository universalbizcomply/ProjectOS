//! Composite packaged-runtime identity integration proofs (WINDOWS-PACKAGED-RUNTIME-IDENTITY1B).
//!
//! Drives the closed composite model + the startup capture through the crate's `test-fixtures`
//! surface. Classification only: no verifier, no key, no manifest, no daemon, no protected path.

#![cfg(all(windows, feature = "test-fixtures"))]

use projectos_control_center::test_fixtures::identity::{
    capture_startup_identity, CcSignature, CompositeIdentity, ExecutionMode, ProtectedEligibility,
    ReleaseChannel, ReleaseManifest,
};

/// The composite must always classify, and eligibility must always derive Disabled.
#[test]
fn every_constructor_is_protected_disabled() {
    for c in [
        CompositeIdentity::development(),
        CompositeIdentity::test_fixture(true, true),
        CompositeIdentity::test_fixture(false, false),
        CompositeIdentity::packaged_unverified(),
    ] {
        assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
    }
}

/// A consistent test fixture is TEST-FIXTURE verified, never production verified, and never signed.
#[test]
fn test_fixture_never_reaches_production() {
    let c = CompositeIdentity::test_fixture(true, true);
    assert_eq!(c.execution(), ExecutionMode::TestFixture);
    assert_eq!(c.manifest(), ReleaseManifest::TestFixtureVerified);
    assert_ne!(c.manifest(), ReleaseManifest::Verified);
    assert_ne!(c.channel(), ReleaseChannel::SignedProduction);
    assert_ne!(c.channel(), ReleaseChannel::SignedStaging);
    assert_ne!(c.signature(), CcSignature::Verified);
    assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
}

/// A packaged candidate without a production verifier stays unverified and Disabled.
#[test]
fn packaged_candidate_is_unverified() {
    let c = CompositeIdentity::packaged_unverified();
    assert_eq!(c.execution(), ExecutionMode::PackagedCandidate);
    assert_eq!(c.signature(), CcSignature::NotChecked);
    assert_ne!(c.signature(), CcSignature::Verified);
    assert_eq!(c.channel(), ReleaseChannel::Unknown);
    assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
}

/// The startup capture yields a stable, Disabled, non-production classification. Under the
/// `test-fixtures` build it reports TestFixture; the projection is immutable across repeats.
#[test]
fn startup_capture_is_stable_and_disabled() {
    let a = capture_startup_identity();
    let b = capture_startup_identity();
    assert_eq!(a.protected_eligibility(), ProtectedEligibility::Disabled);
    assert_eq!(a.execution(), ExecutionMode::TestFixture); // this binary is a test-fixtures build
    assert_eq!(a.to_status_view(), b.to_status_view());
    // The safe projection carries the exact test-mode owner message and no identifier.
    let view = a.to_status_view();
    assert_eq!(view.execution_mode, "TEST_FIXTURE");
    assert_eq!(
        view.next_safe_action,
        "This ProjectOS build is running in test mode. Protected actions are disabled."
    );
    let json = serde_json::to_string(&view).unwrap();
    for forbidden in ["sha", "0x", "s-1-5", "c:\\", ".exe", "cert", "pubkey"] {
        assert!(
            !json.to_lowercase().contains(forbidden),
            "leaked {forbidden}: {json}"
        );
    }
}
