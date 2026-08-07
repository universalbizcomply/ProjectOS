//! Effect-free contract tests for the FIXED ProjectOSHost proof-pipe security principal
//! (3K-I-D-E-C-CAPABILITY-B3-SECURITY-PRINCIPAL-CONTRACT1A).
//!
//! No test resolves the live service principal, invokes `LookupAccountNameW`, creates or connects a
//! pipe, queries the SCM, or touches any machine state. The portable policy is exercised directly; the
//! opaque descriptor (Windows + `test-fixtures`) is built ONLY from a synthetic well-known service SID.

use projectos_host_authority::{
    ProjectOsHostPipeAllowPrincipal, ProjectOsHostPipeBroadPrincipal,
    ProjectOsHostPipeSecurityPolicy, ProjectOsHostPipeSecurityStatus, PIPE_PROOF_RIGHTS,
};

#[test]
fn allowlist_is_exactly_the_three_fixed_principals() {
    assert_eq!(
        ProjectOsHostPipeSecurityPolicy::allowlist(),
        &[
            ProjectOsHostPipeAllowPrincipal::ExpectedServiceSid,
            ProjectOsHostPipeAllowPrincipal::LocalSystem,
            ProjectOsHostPipeAllowPrincipal::BuiltinAdministrators,
        ]
    );
}

#[test]
fn production_allowlist_is_exactly_the_four_fixed_principals() {
    // PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A: the production endpoint adds EXACTLY the
    // enrolled configured owner to the three machine principals — nothing broader.
    assert_eq!(
        ProjectOsHostPipeSecurityPolicy::production_allowlist(),
        &[
            ProjectOsHostPipeAllowPrincipal::ExpectedServiceSid,
            ProjectOsHostPipeAllowPrincipal::LocalSystem,
            ProjectOsHostPipeAllowPrincipal::BuiltinAdministrators,
            ProjectOsHostPipeAllowPrincipal::ConfiguredOwner,
        ]
    );
}

#[test]
fn a_missing_or_invalid_configured_owner_fails_closed() {
    assert!(!ProjectOsHostPipeSecurityStatus::ConfiguredOwnerUnavailable.is_ready());
}

#[test]
fn no_broad_principal_is_ever_allowed() {
    for b in [
        ProjectOsHostPipeBroadPrincipal::Everyone,
        ProjectOsHostPipeBroadPrincipal::BuiltinUsers,
        ProjectOsHostPipeBroadPrincipal::AuthenticatedUsers,
        ProjectOsHostPipeBroadPrincipal::Guests,
        ProjectOsHostPipeBroadPrincipal::AnonymousLogon,
        ProjectOsHostPipeBroadPrincipal::CurrentInteractiveUser,
    ] {
        assert!(!ProjectOsHostPipeSecurityPolicy::allows_broad(b));
    }
}

#[test]
fn dacl_is_protected_and_needs_no_explicit_deny() {
    assert!(ProjectOsHostPipeSecurityPolicy::is_protected());
    assert!(!ProjectOsHostPipeSecurityPolicy::requires_explicit_deny());
}

#[test]
fn granted_rights_are_minimal() {
    assert_eq!(
        ProjectOsHostPipeSecurityPolicy::granted_rights(),
        PIPE_PROOF_RIGHTS
    );
    // No re-secure / take-ownership / delete right.
    assert_eq!(PIPE_PROOF_RIGHTS & 0x0004_0000, 0); // WRITE_DAC
    assert_eq!(PIPE_PROOF_RIGHTS & 0x0008_0000, 0); // WRITE_OWNER
    assert_eq!(PIPE_PROOF_RIGHTS & 0x0001_0000, 0); // DELETE
}

#[test]
fn unresolved_principal_fails_closed_and_is_never_ready() {
    // RequiresInstalledServiceProof (and every non-Ready status) yields no usable descriptor.
    assert!(!ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof.is_ready());
    assert!(!ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable.is_ready());
    assert!(!ProjectOsHostPipeSecurityStatus::AccessDenied.is_ready());
    assert!(!ProjectOsHostPipeSecurityStatus::UnsupportedPlatform.is_ready());
    assert!(!ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed.is_ready());
    assert!(!ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure.is_ready());
    assert!(ProjectOsHostPipeSecurityStatus::Ready.is_ready());
}

// Windows + NON-fixture runtime feature: the opaque descriptor, its `resolve()` entry point and the
// borrowed lease type are EXPORTED without enabling synthetic fixtures. Export visibility is proven at
// the type level only — `resolve()` is NEVER invoked here (it would perform a live identity lookup).
#[cfg(all(windows, feature = "windows-pipe-security-runtime"))]
#[test]
fn runtime_feature_exports_the_opaque_descriptor_without_invoking_resolution() {
    use projectos_host_authority::{
        BorrowedPipeSecurityAttributes, ProjectOsHostPipeSecurity, ProjectOsHostPipeSecurityStatus,
    };
    let _resolver: fn() -> (
        ProjectOsHostPipeSecurityStatus,
        Option<ProjectOsHostPipeSecurity>,
    ) = ProjectOsHostPipeSecurity::resolve;
    // The PRODUCTION resolution entry point takes NO argument: no caller can supply an owner SID, a
    // service SID or any principal. Visibility is proven at the type level only — never invoked here
    // (it would perform a live identity lookup once an owner is enrolled).
    let _production_resolver: fn() -> (
        ProjectOsHostPipeSecurityStatus,
        Option<ProjectOsHostPipeSecurity>,
    ) = ProjectOsHostPipeSecurity::resolve_production;
    fn _accepts_lease(_l: &BorrowedPipeSecurityAttributes<'_>) {}
}

// Windows + test-fixtures: the opaque descriptor builds from a SYNTHETIC service SID (no live identity
// lookup), is redacted in Debug, and yields a borrowed lease — all via SAFE calls only. The synthetic
// constructor is available ONLY under test-fixtures (not under the runtime feature alone).
#[cfg(all(windows, feature = "test-fixtures"))]
#[test]
fn opaque_descriptor_builds_from_synthetic_sid_and_is_redacted() {
    use projectos_host_authority::ProjectOsHostPipeSecurity;
    let sec = ProjectOsHostPipeSecurity::build_synthetic_for_test()
        .expect("synthetic proof-pipe descriptor must build");
    assert_eq!(format!("{sec:?}"), "ProjectOsHostPipeSecurity(<redacted>)");
    // A borrowed lease can be obtained (safe); it is lifetime-bound to `sec` by the borrow checker.
    let _lease = sec.borrowed_security_attributes();
}

// Windows + test-fixtures: the FOUR-PRINCIPAL production descriptor builds from SYNTHETIC service +
// owner SIDs (no live identity lookup, no record read), stays redacted, and yields a borrowed lease.
#[cfg(all(windows, feature = "test-fixtures"))]
#[test]
fn production_descriptor_builds_from_synthetic_parts_and_is_redacted() {
    use projectos_host_authority::ProjectOsHostPipeSecurity;
    let sec = ProjectOsHostPipeSecurity::build_synthetic_production_for_test()
        .expect("synthetic production descriptor must build");
    assert_eq!(format!("{sec:?}"), "ProjectOsHostPipeSecurity(<redacted>)");
    let _lease = sec.borrowed_security_attributes();
}
