//! Synthetic machine-wide security proofs (feature `test-fixtures`, Windows only).
//!
//! Proves: the machine-wide-v1 DACL inspects as Matched; the OWNER_RIGHTS ACE suppresses the owner's
//! implicit WRITE_DAC (a WRITE_DAC reopen is denied while a detection-rights reopen succeeds); an
//! object granting rights outside the detection mask inspects as Mismatch; a NULL DACL inspects as
//! UntrustedAuthorityObject; and the read-only service-SID resolution attempt classifies without any
//! SCM query or install. All names are TEST-ONLY.

#![cfg(all(windows, feature = "test-fixtures"))]

use projectos_host_authority::windows_proof as wp;
use projectos_host_authority::{AuthorityRefusal, ServiceSidResolution};
use wp::{
    acquire_existence_token, guard_handle, inspect_object_security, resolve_projectos_host_service,
    synthetic_object_name, try_open, MachineWideAuthoritySecurity, SecurityProfileInspection,
    WindowsTokenAcquisition, AUTHORITY_DETECTION_RIGHTS, RIGHT_WRITE_DAC,
};

fn acquired_guard(
    name: &str,
    sec: &MachineWideAuthoritySecurity,
) -> projectos_host_authority::AuthorityGuard {
    match acquire_existence_token(name, sec) {
        WindowsTokenAcquisition::Acquired(g) => g,
        other => panic!("expected Acquired, got {other:?}"),
    }
}

#[test]
fn machine_wide_v1_object_inspects_as_matched() {
    let sec = MachineWideAuthoritySecurity::build_v1(None).expect("descriptor builds");
    let name = synthetic_object_name("inspect-matched");
    let guard = acquired_guard(&name, &sec);
    let inspection = inspect_object_security(guard_handle(&guard));
    assert_eq!(
        inspection,
        SecurityProfileInspection::Matched,
        "machine-wide-v1 DACL must inspect as Matched"
    );
}

#[test]
fn owner_rights_ace_suppresses_write_dac_but_permits_detection_rights() {
    let sec = MachineWideAuthoritySecurity::build_v1(None).expect("descriptor builds");
    let name = synthetic_object_name("owner-rights-suppression");
    let _guard = acquired_guard(&name, &sec);

    // WRITE_DAC is granted to no principal, and the OWNER_RIGHTS ACE suppresses the owner's implicit
    // WRITE_DAC — so a reopen requesting it is denied.
    let write_dac = try_open(&name, RIGHT_WRITE_DAC);
    assert!(
        matches!(write_dac, Err(AuthorityRefusal::AccessDenied)),
        "WRITE_DAC reopen must be denied, got {write_dac:?}"
    );

    // The detection rights ARE granted (Administrators / Interactive / OwnerRights), so this succeeds.
    let detection = try_open(&name, AUTHORITY_DETECTION_RIGHTS);
    assert!(
        detection.is_ok(),
        "detection-rights reopen must succeed, got {detection:?}"
    );
}

#[test]
fn every_excessive_right_is_refused_on_reopen() {
    // No principal is granted a modify/take-ownership right, and the OWNER_RIGHTS ACE caps the owner at
    // the detection mask — so each of these is denied while SYNCHRONIZE|READ_CONTROL succeeds.
    const WRITE_OWNER: u32 = 0x0008_0000;
    const MUTEX_MODIFY_STATE: u32 = 0x0000_0001;
    const GENERIC_ALL: u32 = 0x1000_0000;

    let sec = MachineWideAuthoritySecurity::build_v1(None).expect("descriptor builds");
    let name = synthetic_object_name("excessive-rights");
    let _guard = acquired_guard(&name, &sec);

    for (label, right) in [
        ("WRITE_DAC", RIGHT_WRITE_DAC),
        ("WRITE_OWNER", WRITE_OWNER),
        ("MUTEX_MODIFY_STATE", MUTEX_MODIFY_STATE),
        ("GENERIC_ALL", GENERIC_ALL),
    ] {
        let r = try_open(&name, right);
        assert!(
            matches!(r, Err(AuthorityRefusal::AccessDenied)),
            "{label} reopen must be AccessDenied, got {r:?}"
        );
    }

    // The exact detection mask remains allowed.
    assert!(
        try_open(&name, AUTHORITY_DETECTION_RIGHTS).is_ok(),
        "SYNCHRONIZE|READ_CONTROL must remain allowed"
    );
}

#[test]
fn an_object_granting_more_than_detection_rights_is_mismatch() {
    let all_access = MachineWideAuthoritySecurity::build_all_access_everyone_for_test()
        .expect("all-access descriptor builds");
    let name = synthetic_object_name("inspect-mismatch");
    let guard = acquired_guard(&name, &all_access);
    let inspection = inspect_object_security(guard_handle(&guard));
    assert_eq!(
        inspection,
        SecurityProfileInspection::Mismatch,
        "an all-access DACL must inspect as Mismatch"
    );
}

#[test]
fn a_null_dacl_is_untrusted() {
    let null_dacl = MachineWideAuthoritySecurity::build_null_dacl_for_test()
        .expect("null DACL descriptor builds");
    let name = synthetic_object_name("inspect-null-dacl");
    let guard = acquired_guard(&name, &null_dacl);
    let inspection = inspect_object_security(guard_handle(&guard));
    assert_eq!(
        inspection,
        SecurityProfileInspection::UntrustedAuthorityObject,
        "a NULL DACL must inspect as UntrustedAuthorityObject"
    );
}

#[test]
fn service_sid_resolution_is_read_only_and_classifies() {
    let (class, principal) = resolve_projectos_host_service();
    match class {
        ServiceSidResolution::SupportedResolutionProven => {
            assert!(principal.is_some(), "proven resolution yields a principal");
        }
        ServiceSidResolution::RequiresInstalledServiceProof
        | ServiceSidResolution::ResolutionUnavailable => {
            assert!(principal.is_none(), "unresolved yields no principal");
        }
        ServiceSidResolution::InstallerPreparedSid => {
            panic!("read-only resolution never claims InstallerPreparedSid");
        }
        _ => panic!("unexpected ServiceSidResolution variant"),
    }
}
