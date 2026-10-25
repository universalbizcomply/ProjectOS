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
use core::marker::PhantomData;
use std::mem::size_of;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

// Fixture-only Win32 imports for the machine-wide authority DACL inspector (test-fixtures).
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
use windows::Win32::Foundation::HANDLE;
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
use windows::Win32::Security::Authorization::{GetSecurityInfo, SE_KERNEL_OBJECT};
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
use windows::Win32::Security::{
    GetAce, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION,
};

use projectos_host_identity::canonical_record::{production_canonical_identity, OwnerEnrolment};

use crate::model::ServiceSidResolution;
use crate::pipe_security::{ProjectOsHostPipeSecurityStatus, PIPE_PROOF_RIGHTS};
use crate::service_principal::{
    resolve_projectos_host_service, sid_string_from_binary, ResolvedServicePrincipal,
};

/// A `LocalAlloc`-backed security descriptor built from an INTERNALLY-generated SDDL string, freed
/// exactly once via `LocalFree`. This is the SINGLE owner of SDDL→descriptor conversion and descriptor
/// lifetime in this crate; every built descriptor (machine-wide authority and the proof pipe) delegates
/// to it, so `ConvertStringSecurityDescriptorToSecurityDescriptorW` and `LocalFree` ownership are never
/// duplicated. It exposes no SID, no SDDL and no owned pointer.
pub(crate) struct OwnedSecurityDescriptor {
    psd: PSECURITY_DESCRIPTOR,
}

impl OwnedSecurityDescriptor {
    /// Convert an INTERNALLY-generated SDDL string into an owned descriptor. The SDDL is never
    /// caller-supplied, so there is no injection surface.
    pub(crate) fn from_internal_sddl(sddl: &str) -> Option<Self> {
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
        Some(Self { psd })
    }

    /// CRATE-PRIVATE raw descriptor pointer, for building a borrowed `SECURITY_ATTRIBUTES` only. Never
    /// public; never a SID or SDDL accessor.
    pub(crate) fn descriptor_ptr(&self) -> *mut c_void {
        self.psd.0
    }

    /// `SECURITY_ATTRIBUTES` referencing this descriptor. Used only by the fixture-only machine-wide
    /// authority descriptor (the pipe path builds its lease directly from `descriptor_ptr`).
    #[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
    pub(crate) fn security_attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.psd.0,
            bInheritHandle: false.into(),
        }
    }
}

impl Drop for OwnedSecurityDescriptor {
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

// The machine-wide authority (existence-token mutex) security descriptor + DACL inspector below are used
// ONLY by the synthetic authority fixtures (existence.rs / windows_proof), so they are gated to
// `test-fixtures`. The NON-fixture `windows-pipe-security-runtime` build compiles only the opaque
// ProjectOSHost pipe-security runtime path (the shared `OwnedSecurityDescriptor` + `ProjectOsHostPipeSecurity`).

/// `SYNCHRONIZE` (0x0010_0000) — open/detect the existence token.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
pub const RIGHT_SYNCHRONIZE: u32 = 0x0010_0000;
/// `READ_CONTROL` (0x0002_0000) — read the object's security descriptor for cross-identity inspection.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
pub const RIGHT_READ_CONTROL: u32 = 0x0002_0000;
/// The ONLY rights the machine-wide profile grants: `SYNCHRONIZE | READ_CONTROL` (0x0012_0000).
/// Deliberately excludes `MODIFY_STATE` (0x0001), `WRITE_DAC` (0x0004_0000), `WRITE_OWNER`
/// (0x0008_0000), `DELETE` (0x0001_0000) and `MUTEX_ALL_ACCESS`.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
pub const AUTHORITY_DETECTION_RIGHTS: u32 = RIGHT_SYNCHRONIZE | RIGHT_READ_CONTROL;

/// `WRITE_DAC` (0x0004_0000). Never granted; used only by the OWNER_RIGHTS suppression proof to show a
/// request for it is denied.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
pub const RIGHT_WRITE_DAC: u32 = 0x0004_0000;

/// The `ACCESS_ALLOWED_ACE_TYPE` header value (0). A conforming DACL contains only this ACE type.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

/// The read-only classification of an existing object's DACL.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
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

/// The machine-wide authority security descriptor, owned by the shared [`OwnedSecurityDescriptor`].
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
pub struct MachineWideAuthoritySecurity {
    inner: OwnedSecurityDescriptor,
    /// Whether the service ACE was included (i.e. the service principal was resolvable).
    includes_service_ace: bool,
}

#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
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

    /// Wrap an internally-generated SDDL string in the shared owned descriptor. The SDDL is never
    /// caller-supplied, so there is no injection surface.
    fn from_sddl(sddl: &str, includes_service_ace: bool) -> Option<Self> {
        Some(Self {
            inner: OwnedSecurityDescriptor::from_internal_sddl(sddl)?,
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
        self.inner.security_attributes()
    }
}

/// The OPAQUE, service-SID-backed security for the fixed ProjectOSHost proof pipe.
///
/// Owns a protected DACL (`D:P`) granting the mask [`PIPE_PROOF_RIGHTS`] to exactly the ProjectOSHost
/// service SID, `LocalSystem` (`SY`) and `Builtin Administrators` (`BA`) — no broad principal, no
/// `INTERACTIVE`, no `OWNER_RIGHTS`. It exposes NO SID, SID bytes, SDDL, account name or owned pointer,
/// is not `Clone` (single descriptor ownership), and its `Debug` is redacted. It is CONSTRUCTED ONLY
/// from the read-only service-principal resolution (or a synthetic test fixture) and NEVER creates,
/// opens or connects a pipe.
pub struct ProjectOsHostPipeSecurity {
    inner: OwnedSecurityDescriptor,
}

impl core::fmt::Debug for ProjectOsHostPipeSecurity {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Never reveal the descriptor, SID or SDDL.
        f.write_str("ProjectOsHostPipeSecurity(<redacted>)")
    }
}

impl ProjectOsHostPipeSecurity {
    /// Resolve the fixed ProjectOSHost service principal (read-only) and, on success, build the
    /// protected proof-pipe descriptor. FAIL CLOSED: when the principal cannot be resolved (the common
    /// pre-installation case) the status is [`ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof`]
    /// with `None` — the caller receives NO descriptor and MUST NOT fall back to a broader security.
    ///
    /// This is the LIVE path (it performs the read-only `LookupAccountNameW` resolution). It is
    /// compile-only in this phase and is NEVER invoked by any test.
    #[must_use]
    pub fn resolve() -> (ProjectOsHostPipeSecurityStatus, Option<Self>) {
        let (class, principal) = resolve_projectos_host_service();
        match (class, principal) {
            (ServiceSidResolution::SupportedResolutionProven, Some(p))
            | (ServiceSidResolution::InstallerPreparedSid, Some(p)) => {
                match Self::build_for_service(&p) {
                    Some(sec) => (ProjectOsHostPipeSecurityStatus::Ready, Some(sec)),
                    None => (
                        ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed,
                        None,
                    ),
                }
            }
            (ServiceSidResolution::RequiresInstalledServiceProof, _)
            | (ServiceSidResolution::InstallerPreparedSid, None) => (
                ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof,
                None,
            ),
            (ServiceSidResolution::ResolutionUnavailable, _) => (
                ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable,
                None,
            ),
            _ => (
                ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure,
                None,
            ),
        }
    }

    /// Build the protected pipe DACL for a resolved service principal. SDDL: `D:P` then one
    /// access-allowed ACE at [`PIPE_PROOF_RIGHTS`] for `SY`, `BA` and the validated `S-1-…` service SID.
    /// The only variable is the already-validated SID string, so there is no injection surface.
    fn build_for_service(service: &ResolvedServicePrincipal) -> Option<Self> {
        let sid = service.sid_string();
        // Defensive: only a validated SID string ever reaches here.
        if !sid.starts_with("S-1-")
            || !sid
                .bytes()
                .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
        {
            return None;
        }
        Self::from_pipe_sddl(sid)
    }

    /// Build the fixed proof-pipe descriptor from a `S-1-…` service SID string.
    fn from_pipe_sddl(service_sid: &str) -> Option<Self> {
        let rights = format!("0x{PIPE_PROOF_RIGHTS:08X}");
        let mut sddl = String::from("D:P");
        for principal in ["SY", "BA"] {
            sddl.push_str(&format!("(A;;{rights};;;{principal})"));
        }
        sddl.push_str(&format!("(A;;{rights};;;{service_sid})"));
        Some(Self {
            inner: OwnedSecurityDescriptor::from_internal_sddl(&sddl)?,
        })
    }

    /// Resolve the security for the single fixed PRODUCTION endpoint (`\\.\pipe\ProjectOS.Host`,
    /// PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A): a protected DACL granting [`PIPE_PROOF_RIGHTS`]
    /// to EXACTLY four principals — `SY`, `BA`, the resolved ProjectOSHost service SID, and the EXACT
    /// enrolled configured-owner SID read from the CLOSED canonical installation record.
    ///
    /// FAIL CLOSED, owner first: when the canonical record is unavailable/invalid, no owner is
    /// enrolled, or the enrolled SID does not convert, the status is
    /// [`ProjectOsHostPipeSecurityStatus::ConfiguredOwnerUnavailable`] with `None` and NO live
    /// identity API is touched. There is no fallback to the interactive user, to `INTERACTIVE`, or
    /// to the three-principal proof shape. No caller-supplied SID exists on this path.
    #[must_use]
    pub fn resolve_production() -> (ProjectOsHostPipeSecurityStatus, Option<Self>) {
        // The configured owner is established FIRST: an unenrolled machine fails closed before any
        // service-principal resolution is attempted.
        let Some(owner_sid) = configured_owner_sid_string() else {
            return (
                ProjectOsHostPipeSecurityStatus::ConfiguredOwnerUnavailable,
                None,
            );
        };
        let (class, principal) = resolve_projectos_host_service();
        match (class, principal) {
            (ServiceSidResolution::SupportedResolutionProven, Some(p))
            | (ServiceSidResolution::InstallerPreparedSid, Some(p)) => {
                match Self::build_production(&p, &owner_sid) {
                    Some(sec) => (ProjectOsHostPipeSecurityStatus::Ready, Some(sec)),
                    None => (
                        ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed,
                        None,
                    ),
                }
            }
            (ServiceSidResolution::RequiresInstalledServiceProof, _)
            | (ServiceSidResolution::InstallerPreparedSid, None) => (
                ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof,
                None,
            ),
            (ServiceSidResolution::ResolutionUnavailable, _) => (
                ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable,
                None,
            ),
            _ => (
                ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure,
                None,
            ),
        }
    }

    /// Build the production pipe DACL for a resolved service principal plus the validated
    /// configured-owner SID. Both strings pass the same defensive `S-1-…` shape rule the proof path
    /// applies, so there is no injection surface.
    fn build_production(service: &ResolvedServicePrincipal, owner_sid: &str) -> Option<Self> {
        for sid in [service.sid_string(), owner_sid] {
            if !sid.starts_with("S-1-")
                || !sid
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S')
            {
                return None;
            }
        }
        Some(Self {
            inner: OwnedSecurityDescriptor::from_internal_sddl(&production_pipe_sddl(
                service.sid_string(),
                owner_sid,
            ))?,
        })
    }

    /// TEST-ONLY: build the proof-pipe descriptor from a SYNTHETIC well-known service SID (`S-1-5-80-0`,
    /// "all services"), NOT from a live identity lookup. Used to prove the descriptor and its borrowed
    /// lease behave correctly WITHOUT invoking `LookupAccountNameW` or any live Windows identity API.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn build_synthetic_for_test() -> Option<Self> {
        Self::from_pipe_sddl("S-1-5-80-0")
    }

    /// TEST-ONLY: build the four-principal PRODUCTION descriptor from SYNTHETIC service + owner SIDs
    /// (no live identity lookup, no record read, no machine effect).
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn build_synthetic_production_for_test() -> Option<Self> {
        Some(Self {
            inner: OwnedSecurityDescriptor::from_internal_sddl(&production_pipe_sddl(
                "S-1-5-80-0",
                "S-1-5-21-2222-3333-4444-1001",
            ))?,
        })
    }

    /// A borrowed Windows security-attributes lease, LIFETIME-BOUND to this owner so it cannot outlive
    /// the descriptor. Exposes no SID or SDDL. The future named-pipe FFI (windows-local-ipc) is the only
    /// intended consumer.
    #[must_use]
    pub fn borrowed_security_attributes(&self) -> BorrowedPipeSecurityAttributes<'_> {
        BorrowedPipeSecurityAttributes {
            sa: SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: self.inner.descriptor_ptr(),
                bInheritHandle: false.into(),
            },
            _owner: PhantomData,
        }
    }
}

/// The four-principal PRODUCTION pipe SDDL: `D:P` then one access-allowed ACE at
/// [`PIPE_PROOF_RIGHTS`] for `SY`, `BA`, the validated service SID and the validated
/// configured-owner SID. NO broad principal (`WD`/`BU`/`AU`), NO `IU`, NO `OW`. The only variables
/// are already-validated `S-1-…` strings, so there is no injection surface.
fn production_pipe_sddl(service_sid: &str, owner_sid: &str) -> String {
    let rights = format!("0x{PIPE_PROOF_RIGHTS:08X}");
    let mut sddl = String::from("D:P");
    for principal in ["SY", "BA", service_sid, owner_sid] {
        sddl.push_str(&format!("(A;;{rights};;;{principal})"));
    }
    sddl
}

/// The enrolled configured-owner SID as an `S-1-…` string, read from the CLOSED canonical
/// installation record route. `None` on EVERY failure — record unavailable/invalid, enrolment
/// absent, or a SID that does not convert — and the caller fails closed. Nothing here infers an
/// owner from the console user, the installing account or an administrator.
fn configured_owner_sid_string() -> Option<String> {
    let identity = production_canonical_identity().ok()?;
    owner_sid_string_from_enrolment(&identity.owner_enrolment())
}

/// Convert one [`OwnerEnrolment`] into the owner's `S-1-…` string. `Absent` (and any unknown future
/// variant) is `None` — fail closed, never a substitute principal.
fn owner_sid_string_from_enrolment(enrolment: &OwnerEnrolment) -> Option<String> {
    match enrolment {
        OwnerEnrolment::Enrolled(hex) => sid_string_from_binary(&decode_owner_sid_hex(hex)?),
        OwnerEnrolment::Absent => None,
        _ => None,
    }
}

/// Decode the record's bounded lower-case hex SID encoding into binary SID bytes. Strict: bounded
/// length, even length, lower-case hex only. Structural SID validation happens in
/// [`sid_string_from_binary`].
fn decode_owner_sid_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.is_empty() || hex.len() > 136 || !hex.len().is_multiple_of(2) {
        return None;
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for pair in hex.as_bytes().chunks_exact(2) {
        let hi = hex_nibble(pair[0])?;
        let lo = hex_nibble(pair[1])?;
        bytes.push((hi << 4) | lo);
    }
    Some(bytes)
}

/// One lower-case hex nibble. Upper-case is refused: the record contract is lower-case.
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

/// A borrowed `SECURITY_ATTRIBUTES` lease over a [`ProjectOsHostPipeSecurity`]. The `'a` lifetime binds
/// it to the owner, so the borrow checker forbids it (and any pointer taken from it) outliving the
/// descriptor. It transfers no ownership, exposes no SID/SDDL, and cannot free or mutate the descriptor.
pub struct BorrowedPipeSecurityAttributes<'a> {
    sa: SECURITY_ATTRIBUTES,
    _owner: PhantomData<&'a ProjectOsHostPipeSecurity>,
}

impl BorrowedPipeSecurityAttributes<'_> {
    /// A borrowed pointer to the `SECURITY_ATTRIBUTES`, for passing to the future `CreateNamedPipeW`
    /// call at the Windows FFI boundary.
    ///
    /// # Safety
    /// The pointer BORROWS this lease (and, transitively, the owning [`ProjectOsHostPipeSecurity`]'s
    /// descriptor). The caller MUST NOT store it beyond this lease's lifetime, MUST NOT free or mutate
    /// the descriptor, and MUST use it only to hand the attributes to a Windows call while the lease is
    /// alive. No safe method returns this pointer, and no accessor exposes the SID or SDDL.
    #[must_use]
    pub unsafe fn as_security_attributes_ptr(&self) -> *const SECURITY_ATTRIBUTES {
        &self.sa as *const SECURITY_ATTRIBUTES
    }
}

/// A `GetSecurityInfo`-allocated security descriptor, freed exactly once.
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
struct OwnedInfoDescriptor(PSECURITY_DESCRIPTOR);

#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
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
#[cfg(any(feature = "test-fixtures", feature = "windows-authority-acquisition"))]
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

// PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A production-security proofs. Gated to `test` only (the
// module itself already requires `windows-pipe-security-runtime`): everything here is SYNTHETIC —
// no live identity lookup, no record read, no pipe, no machine effect.
#[cfg(test)]
mod production_security_tests {
    use super::*;

    /// SYNTHETIC lower-case hex encoding of `S-1-5-21-2222-3333-4444-1001` — the exact byte form the
    /// canonical record stores. No real account.
    fn synthetic_owner_hex() -> String {
        let mut bytes = vec![1u8, 5, 0, 0, 0, 0, 0, 5];
        for sub in [21u32, 2222, 3333, 4444, 1001] {
            bytes.extend_from_slice(&sub.to_le_bytes());
        }
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn production_sddl_grants_exactly_the_four_principals_and_nothing_broad() {
        let sddl = production_pipe_sddl("S-1-5-80-0", "S-1-5-21-2222-3333-4444-1001");
        // Protected DACL, four ACEs, in DACL order: SY, BA, service SID, EXACT owner SID.
        let rights = format!("0x{PIPE_PROOF_RIGHTS:08X}");
        assert_eq!(
            sddl,
            format!(
                "D:P(A;;{rights};;;SY)(A;;{rights};;;BA)(A;;{rights};;;S-1-5-80-0)\
                 (A;;{rights};;;S-1-5-21-2222-3333-4444-1001)"
            )
        );
        assert_eq!(sddl.matches("(A;;").count(), 4, "exactly four allow ACEs");
        // No broad principal, no generic interactive grant, no owner-rights ACE, no deny/audit ACE.
        for absent in [
            ";;;WD)", ";;;BU)", ";;;AU)", ";;;IU)", ";;;OW)", "(D;;", "(AU;;",
        ] {
            assert!(!sddl.contains(absent), "{absent} must not appear: {sddl}");
        }
    }

    #[test]
    fn synthetic_production_descriptor_builds_and_is_redacted() {
        let sec = ProjectOsHostPipeSecurity {
            inner: OwnedSecurityDescriptor::from_internal_sddl(&production_pipe_sddl(
                "S-1-5-80-0",
                "S-1-5-21-2222-3333-4444-1001",
            ))
            .expect("the synthetic four-principal production descriptor must build"),
        };
        assert_eq!(format!("{sec:?}"), "ProjectOsHostPipeSecurity(<redacted>)");
        let lease = sec.borrowed_security_attributes();
        // SAFETY: `lease` (hence `sec`) is alive for this scope; the pointer is only read here.
        let ptr = unsafe { lease.as_security_attributes_ptr() };
        assert!(!ptr.is_null());
        // SAFETY: `ptr` points at the lease's `SECURITY_ATTRIBUTES`, valid while `lease` is alive.
        let sa = unsafe { &*ptr };
        assert!(!sa.lpSecurityDescriptor.is_null());
        assert!(!sa.bInheritHandle.as_bool());
    }

    #[test]
    fn an_enrolled_synthetic_owner_converts_to_its_exact_sid_string() {
        let enrolment = OwnerEnrolment::Enrolled(synthetic_owner_hex());
        assert_eq!(
            owner_sid_string_from_enrolment(&enrolment).as_deref(),
            Some("S-1-5-21-2222-3333-4444-1001")
        );
    }

    #[test]
    fn absent_or_malformed_owner_enrolment_fails_closed() {
        // No enrolment: no principal, never a substitute.
        assert!(owner_sid_string_from_enrolment(&OwnerEnrolment::Absent).is_none());
        // Malformed encodings: odd length, non-hex, truncated binary, empty, too-short, upper-case.
        for bad in [
            "abc",
            "zz",
            "0105000000000005",
            "",
            "01",
            "AB05000000000005",
        ] {
            assert!(
                owner_sid_string_from_enrolment(&OwnerEnrolment::Enrolled(bad.to_string()))
                    .is_none(),
                "malformed owner encoding must fail closed: {bad:?}"
            );
        }
        let oversize = "ab".repeat(69);
        assert!(
            owner_sid_string_from_enrolment(&OwnerEnrolment::Enrolled(oversize)).is_none(),
            "an oversize owner encoding must fail closed"
        );
    }

    #[test]
    fn an_unenrolled_machine_yields_no_configured_owner_and_fails_closed() {
        // The production canonical-identity route is fail-closed on this machine (no approved
        // resolver / no record), so the owner is unavailable. This performs NO account lookup and
        // NO filesystem access; it is the exact first gate `resolve_production` fails closed on.
        assert!(configured_owner_sid_string().is_none());
    }
}

// The machine-wide-authority tests exercise fixture-only items; the synthetic pipe test uses the
// fixture-only synthetic constructor — so the whole module is gated to `test-fixtures`.
#[cfg(all(test, feature = "test-fixtures"))]
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

    #[test]
    fn proof_pipe_descriptor_builds_from_a_synthetic_service_sid() {
        // Synthetic well-known service SID — no live LookupAccountNameW, no machine effect.
        let sec = ProjectOsHostPipeSecurity::build_synthetic_for_test()
            .expect("proof-pipe descriptor must build from a synthetic service SID");
        // Redacted Debug never reveals the descriptor.
        assert_eq!(format!("{sec:?}"), "ProjectOsHostPipeSecurity(<redacted>)");
        // The borrowed lease references a non-null, non-inheritable descriptor and is lifetime-bound.
        let lease = sec.borrowed_security_attributes();
        // SAFETY: `lease` (hence `sec`) is alive for this scope; the pointer is only read here.
        let ptr = unsafe { lease.as_security_attributes_ptr() };
        assert!(!ptr.is_null());
        // SAFETY: `ptr` points at the lease's `SECURITY_ATTRIBUTES`, valid while `lease` is alive.
        let sa = unsafe { &*ptr };
        assert!(
            !sa.lpSecurityDescriptor.is_null(),
            "pipe DACL must not be null"
        );
        assert!(
            !sa.bInheritHandle.as_bool(),
            "pipe handle must be non-inheritable"
        );
    }
}
