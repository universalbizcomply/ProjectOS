//! The machine-wide authority object's security descriptor (build) and a read-only DACL inspector.
//!
//! Two jobs:
//!  - BUILD `MachineWideAuthoritySecurityV1`: an explicit, protected DACL granting exactly
//!    `SYNCHRONIZE | READ_CONTROL` (detection rights only) to SYSTEM, Administrators, INTERACTIVE and
//!    — when resolvable — the ProjectOSHost service principal, PLUS an OWNER_RIGHTS ACE that suppresses
//!    the object owner's implicit `WRITE_DAC`/`WRITE_OWNER`. No principal ever receives a modify,
//!    delete or take-ownership right, so the object cannot be silently re-secured after creation.
//!  - INSPECT an existing object's DACL (read-only, cross-identity): confirm every ACE is
//!    access-ALLOWED and grants no right outside the detection mask, classifying the object as matched,
//!    mismatched, untrusted or uninspectable.
//!
//! This is ACCESS CONTROL, not identity or trust: a matching DACL means the object was created with
//! the expected containment shape, never that a trusted ProjectOS peer owns it.

#![cfg(windows)]

use core::ffi::c_void;
use std::mem::size_of;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
    SE_KERNEL_OBJECT,
};
use windows::Win32::Security::{
    GetAce, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    SECURITY_ATTRIBUTES,
};

use crate::service_principal::ResolvedServicePrincipal;

/// `SYNCHRONIZE` (0x0010_0000) — open/detect the existence token.
pub const RIGHT_SYNCHRONIZE: u32 = 0x0010_0000;
/// `READ_CONTROL` (0x0002_0000) — read the object's security descriptor for cross-identity inspection.
pub const RIGHT_READ_CONTROL: u32 = 0x0002_0000;
/// The ONLY rights the machine-wide profile grants: `SYNCHRONIZE | READ_CONTROL` (0x0012_0000).
/// Deliberately excludes `MODIFY_STATE` (0x0001), `WRITE_DAC` (0x0004_0000), `WRITE_OWNER`
/// (0x0008_0000), `DELETE` (0x0001_0000) and `MUTEX_ALL_ACCESS`.
pub const AUTHORITY_DETECTION_RIGHTS: u32 = RIGHT_SYNCHRONIZE | RIGHT_READ_CONTROL;

/// `WRITE_DAC` (0x0004_0000). Never granted; used only by the OWNER_RIGHTS suppression proof to show a
/// request for it is denied.
pub const RIGHT_WRITE_DAC: u32 = 0x0004_0000;

/// The `ACCESS_ALLOWED_ACE_TYPE` header value (0). A conforming DACL contains only this ACE type.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

/// The read-only classification of an existing object's DACL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum SecurityProfileInspection {
    /// Every ACE is access-allowed and grants no right outside the detection mask.
    Matched,
    /// An ACE grants a right outside the detection mask, or is a deny/audit ACE.
    Mismatch,
    /// The object's security could not be read (e.g. insufficient access) — fail closed.
    InspectionUnavailable,
    /// The object exists but presents no DACL (a NULL DACL grants everyone everything) — untrusted.
    UntrustedAuthorityObject,
}

/// The machine-wide authority security descriptor, freed exactly once.
pub struct MachineWideAuthoritySecurity {
    psd: PSECURITY_DESCRIPTOR,
    /// Whether the service ACE was included (i.e. the service principal was resolvable).
    includes_service_ace: bool,
}

impl MachineWideAuthoritySecurity {
    /// Build `MachineWideAuthoritySecurityV1`.
    ///
    /// SDDL shape: `D:P` then one access-allowed ACE per principal, all with mask
    /// `0x00120000` (`SYNCHRONIZE | READ_CONTROL`):
    ///  - `SY` SYSTEM, `BA` Administrators, `IU` INTERACTIVE (cross-user detection),
    ///  - the ProjectOSHost service SID when `service` is `Some`,
    ///  - `OW` OWNER_RIGHTS — its presence makes the owner's rights EXACTLY this mask, suppressing the
    ///    implicit `WRITE_DAC`/`WRITE_OWNER` an owner would otherwise hold.
    ///
    /// The SDDL is generated INTERNALLY; the only variable is a validated `S-1-…` SID string, so there
    /// is no injection surface.
    #[must_use]
    pub fn build_v1(service: Option<&ResolvedServicePrincipal>) -> Option<Self> {
        let rights = format!("0x{AUTHORITY_DETECTION_RIGHTS:08X}");
        let mut sddl = String::from("D:P");
        for principal in ["SY", "BA", "IU"] {
            sddl.push_str(&format!("(A;;{rights};;;{principal})"));
        }
        let includes_service_ace = if let Some(p) = service {
            let sid = p.sid_string();
            // Defensive: only a validated SID string ever reaches here.
            if sid.starts_with("S-1-")
                && sid
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
            {
                sddl.push_str(&format!("(A;;{rights};;;{sid})"));
                true
            } else {
                false
            }
        } else {
            false
        };
        // OWNER_RIGHTS last — the suppression ACE.
        sddl.push_str(&format!("(A;;{rights};;;OW)"));

        Self::from_sddl(&sddl, includes_service_ace)
    }

    /// Convert an internally-generated SDDL string into an owned descriptor. The SDDL is never
    /// caller-supplied, so there is no injection surface.
    fn from_sddl(sddl: &str, includes_service_ace: bool) -> Option<Self> {
        let wide: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
        let mut psd = PSECURITY_DESCRIPTOR::default();
        // SAFETY: `wide` is a NUL-terminated wide string alive for the call; `psd` is a valid writable
        // slot receiving a `LocalAlloc` descriptor wrapped immediately for RAII release.
        let built = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(wide.as_ptr()),
                SDDL_REVISION_1,
                &mut psd,
                None,
            )
        };
        if built.is_err() || psd.is_invalid() {
            return None;
        }
        Some(Self {
            psd,
            includes_service_ace,
        })
    }

    /// TEST-ONLY: an empty protected DACL (`D:P`) granting NOBODY. Used to prove same-process
    /// `AccessDenied`: the owner's implicit rights do not include `SYNCHRONIZE`, so a second acquire is
    /// denied.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn build_empty_dacl_for_test() -> Option<Self> {
        Self::from_sddl("D:P", false)
    }

    /// TEST-ONLY: a DACL granting Everyone `MUTEX_ALL_ACCESS` (0x1F0001). Used to prove the DACL
    /// inspector rejects rights outside the detection mask as `Mismatch`.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn build_all_access_everyone_for_test() -> Option<Self> {
        Self::from_sddl("D:P(A;;0x001F0001;;;WD)", false)
    }

    /// TEST-ONLY: a NULL DACL (`D:NO_ACCESS_CONTROL`, everyone full access). Used to prove the
    /// inspector classifies a null DACL as `UntrustedAuthorityObject`.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn build_null_dacl_for_test() -> Option<Self> {
        Self::from_sddl("D:NO_ACCESS_CONTROL", false)
    }

    /// Whether the built descriptor included the service ACE.
    #[must_use]
    pub fn includes_service_ace(&self) -> bool {
        self.includes_service_ace
    }

    /// `SECURITY_ATTRIBUTES` referencing this descriptor. Borrowed from `&self`, so it cannot outlive
    /// the descriptor. `bInheritHandle = FALSE`: the authority handle is never inherited.
    #[must_use]
    pub fn security_attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.psd.0,
            bInheritHandle: false.into(),
        }
    }
}

impl Drop for MachineWideAuthoritySecurity {
    fn drop(&mut self) {
        if !self.psd.is_invalid() {
            // SAFETY: allocated by `ConvertStringSecurityDescriptorToSecurityDescriptorW`, whose
            // documented deallocator is `LocalFree`; `Drop` runs once, so no double free.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.psd.0)));
            }
        }
    }
}

/// A `GetSecurityInfo`-allocated security descriptor, freed exactly once.
struct OwnedInfoDescriptor(PSECURITY_DESCRIPTOR);

impl Drop for OwnedInfoDescriptor {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: allocated by `GetSecurityInfo`, whose documented deallocator is `LocalFree`;
            // `Drop` runs once.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0)));
            }
        }
    }
}

/// Inspect an object's DACL, read-only, and classify its security profile.
///
/// Reads the DACL via `GetSecurityInfo` (which needs `READ_CONTROL` on the handle) and walks every
/// ACE. A conforming object has only access-ALLOWED ACEs whose masks lie within the detection rights;
/// any additional right, any deny/audit ACE, or a NULL DACL is a rejection. The handle is BORROWED —
/// nothing is opened, modified or closed here.
#[must_use]
pub fn inspect_object_security(handle: HANDLE) -> SecurityProfileInspection {
    let mut pdacl: *mut ACL = std::ptr::null_mut();
    let mut psd = PSECURITY_DESCRIPTOR::default();
    // SAFETY: `handle` is a valid object handle opened with READ_CONTROL; the out-params are valid
    // writable slots. On success `psd` is a `LocalAlloc` descriptor wrapped immediately for RAII.
    let status = unsafe {
        GetSecurityInfo(
            handle,
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut pdacl),
            None,
            Some(&mut psd),
        )
    };
    if status.is_err() {
        return SecurityProfileInspection::InspectionUnavailable;
    }
    let _owned = OwnedInfoDescriptor(psd);

    if pdacl.is_null() {
        // A NULL DACL grants everyone full access — never our profile.
        return SecurityProfileInspection::UntrustedAuthorityObject;
    }

    // SAFETY: `pdacl` is a non-null ACL pointer returned by a successful `GetSecurityInfo`, valid for
    // the lifetime of `_owned`.
    let ace_count = unsafe { (*pdacl).AceCount } as u32;
    if ace_count == 0 {
        // An empty (non-null) DACL grants nobody anything: not our profile, but not "everyone" either.
        return SecurityProfileInspection::Mismatch;
    }

    for i in 0..ace_count {
        let mut ace_ptr: *mut c_void = std::ptr::null_mut();
        // SAFETY: `pdacl` is valid and `i < AceCount`; `ace_ptr` is a valid writable slot.
        if unsafe { GetAce(pdacl, i, &mut ace_ptr) }.is_err() || ace_ptr.is_null() {
            return SecurityProfileInspection::InspectionUnavailable;
        }
        // SAFETY: `ace_ptr` points at a valid ACE within the DACL; its first field is an ACE_HEADER.
        let ace_type = unsafe { (*(ace_ptr as *const ACE_HEADER)).AceType };
        if ace_type != ACCESS_ALLOWED_ACE_TYPE {
            // A deny or audit ACE is not part of the detection-only profile.
            return SecurityProfileInspection::Mismatch;
        }
        // SAFETY: an access-allowed ACE begins with an `ACCESS_ALLOWED_ACE` whose `Mask` is readable.
        let mask = unsafe { (*(ace_ptr as *const ACCESS_ALLOWED_ACE)).Mask };
        if mask & !AUTHORITY_DETECTION_RIGHTS != 0 {
            // Grants a right outside SYNCHRONIZE|READ_CONTROL — a modify/delete/take-ownership hazard.
            return SecurityProfileInspection::Mismatch;
        }
    }

    SecurityProfileInspection::Matched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_rights_are_synchronize_and_read_control_only() {
        assert_eq!(AUTHORITY_DETECTION_RIGHTS, 0x0012_0000);
        // No modify/write/delete bit is present.
        assert_eq!(AUTHORITY_DETECTION_RIGHTS & RIGHT_WRITE_DAC, 0);
        assert_eq!(AUTHORITY_DETECTION_RIGHTS & 0x0001, 0); // MODIFY_STATE
        assert_ne!(AUTHORITY_DETECTION_RIGHTS, 0x001F_0001); // not MUTEX_ALL_ACCESS
    }

    #[test]
    fn descriptor_builds_without_a_service_principal() {
        let sec = MachineWideAuthoritySecurity::build_v1(None)
            .expect("machine-wide descriptor must build without the service ACE");
        assert!(!sec.includes_service_ace());
        let sa = sec.security_attributes();
        assert!(!sa.lpSecurityDescriptor.is_null(), "DACL must not be null");
        assert!(
            !sa.bInheritHandle.as_bool(),
            "handle must be non-inheritable"
        );
    }
}
