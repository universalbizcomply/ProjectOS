//! Integration surface tests: a SEPARATE crate that sees ONLY the public API. It proves the adapter is
//! inert from the outside — the opaque types are nameable but not constructible here (there is no public
//! constructor, no synthetic constructor, and no live entrypoint), the platform status is a status only,
//! and the error type is a usable typed enum. Compile-failure proofs that the missing constructors CANNOT
//! be reached live in the focused validator (rustc negative compiles).

use projectos_host_windows_owner_verification as owner;

// Naming the opaque public types in signatures proves they are part of the public API WITHOUT constructing
// them (no public constructor is reachable from a downstream crate). These functions are never called.
#[allow(dead_code)]
fn names_opaque_types(
    _e: &owner::VerifiedWindowsOwnerEvidence,
    _b: &owner::TrustedControlCentreWindowBinding,
    _s: owner::PlatformOwnerVerificationStatus,
    _err: owner::OwnerVerificationError,
) {
}

// A downstream crate can read a proof digest / generation off evidence it is GIVEN, but cannot mint one.
#[allow(dead_code)]
fn reads_public_evidence_getters(e: &owner::VerifiedWindowsOwnerEvidence) -> ([u8; 32], u64) {
    (e.proof_digest(), e.generation())
}

#[test]
#[allow(clippy::assertions_on_constants)]
fn crate_advertises_itself_inert() {
    assert!(owner::WINDOWS_OWNER_VERIFICATION_IS_INERT);
    assert!(!owner::LIVE_OWNER_VERIFICATION_RUN);
}

#[test]
fn platform_status_is_a_status_only() {
    let s = owner::platform_owner_verification_status();
    #[cfg(windows)]
    assert_eq!(s, owner::PlatformOwnerVerificationStatus::SupportedInert);
    #[cfg(not(windows))]
    assert_eq!(s, owner::PlatformOwnerVerificationStatus::Unsupported);
}

#[test]
fn error_type_is_public_typed_and_displayable() {
    // A representative spread of fail-closed reasons renders a non-empty message and compares by value.
    let reasons = [
        owner::OwnerVerificationError::ConsentNotVerified,
        owner::OwnerVerificationError::RemoteSession,
        owner::OwnerVerificationError::OwnerSidMismatch,
        owner::OwnerVerificationError::WorkerPanicked,
        owner::OwnerVerificationError::UnsupportedPlatform,
    ];
    for r in reasons {
        assert!(!format!("{r}").is_empty());
        assert!(!format!("{r:?}").is_empty());
    }
    assert_ne!(
        owner::OwnerVerificationError::ConsentNotVerified,
        owner::OwnerVerificationError::RemoteSession
    );
    // std::error::Error is implemented (usable as a boxed error).
    let boxed: Box<dyn std::error::Error> = Box::new(owner::OwnerVerificationError::WorkerTimedOut);
    assert!(!boxed.to_string().is_empty());
}

// A downstream crate MAY build an untrusted observation and read its (evidence-only) digest, but this
// grants no authority: there is no way to reach a verifier or a binding from here.
#[test]
fn untrusted_observation_is_constructible_but_inert() {
    let obs =
        owner::UntrustedControlCentreWindowObservation::new(owner::OwnerWindowObservationInput {
            label: owner::DESIGNATED_WINDOW_LABEL.to_string(),
            handle: owner::UntrustedOwnerWindowHandle::from_raw(0x4321),
            is_window: true,
            is_visible: true,
            is_minimized: false,
            is_focused: false,
            eligible: true,
            process_id: 10,
            thread_id: 11,
            session: 1,
            client_protocol_type: 0,
            active_console_session: 1,
            runtime_instance_digest: [0u8; 32],
            ipc_session_digest: [0u8; 32],
            project_digest: [0u8; 32],
            repository_digest: [0u8; 32],
            environment_digest: [0u8; 32],
            phase_digest: [0u8; 32],
            lifecycle_epoch: 1,
            capture_generation: 1,
            observed_at: 1,
        });
    // Evidence digest is available; the raw handle never appears in Debug.
    let _d: [u8; 32] = obs.observation_digest();
    assert!(format!("{obs:?}").contains("[REDACTED]"));
    assert!(!format!("{obs:?}").contains("4321"));
    // The verifier type is nameable but has no reachable constructor here (compile-fail proofs cover it).
    fn _names_verifier(_v: &owner::ControlCentreWindowVerifier) {}
    let _ = _names_verifier;
}

#[test]
fn opaque_type_signatures_are_reachable() {
    // Reference the signature-only helpers so the public opaque types are exercised as a public surface.
    let _f: fn(
        &owner::VerifiedWindowsOwnerEvidence,
        &owner::TrustedControlCentreWindowBinding,
        owner::PlatformOwnerVerificationStatus,
        owner::OwnerVerificationError,
    ) = names_opaque_types;
    let _g: fn(&owner::VerifiedWindowsOwnerEvidence) -> ([u8; 32], u64) =
        reads_public_evidence_getters;
}
