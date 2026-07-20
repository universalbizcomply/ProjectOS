//! # ProjectOS Host Windows ACL Policy (inspection, verification and application foundation)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-C.
//!
//! Inspects the owner and DACL of an explicitly supplied absolute directory through a handle opened
//! WITHOUT following reparse points, converts the Windows-owned descriptor into an owned redacted
//! model, verifies it against an explicit fail-closed [`AclPolicy`], and — only where the caller
//! explicitly asks for mutation — applies a policy and RE-READS it from Windows for authoritative
//! verification.
//!
//! ## The accurate claim
//!
//! ProjectOS can **inspect, classify, apply and verify an explicit Windows directory ACL policy on an
//! isolated synthetic root**.
//!
//! ## What this crate does NOT claim
//!
//! It does NOT provide resistance to a local administrator, service-only access, production
//! ProgramData protection, service identity, authenticated caller identity, race-free child-path
//! custody, secure physical deletion, credential custody, complete effective-access calculation for
//! every Windows security feature, protection against offline disk access, or protection against
//! kernel-level compromise. Administrators and SYSTEM remain privileged exactly as Windows security
//! defines. It performs no ProgramData placement, no repository or user-profile ACL change, no service
//! install, no registry access, no IPC, and touches no credential or key material.
//!
//! ## Boundaries that are enforced, not merely documented
//!
//! * every security operation is performed on a HANDLE opened with `FILE_FLAG_OPEN_REPARSE_POINT`,
//!   so a junction or symlink is refused rather than followed;
//! * a successful `Set` call is never treated as proof — only an authoritative re-read is;
//! * a policy that would not itself verify is refused BEFORE any effect;
//! * absent, null, protected and inherited DACL states are distinguished, never collapsed;
//! * an ACE shape this verifier does not interpret fails closed;
//! * no SID, account name, path, descriptor byte, pointer or handle appears in any error or `Debug`.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! Raw ACL and descriptor material is CONTAINED: a dependent crate receives semantic evidence only.
//!
//! No raw security descriptor escapes:
//! ```compile_fail
//! fn f(i: &projectos_host_windows_acl_policy::AclInspection) -> *mut core::ffi::c_void {
//!     i.raw_descriptor() // no such method
//! }
//! ```
//! No raw SID bytes escape:
//! ```compile_fail
//! fn f(s: &projectos_host_windows_acl_policy::OwnedSid) -> &[u8] {
//!     s.as_bytes() // crate-private
//! }
//! ```
//! No raw SID pointer escapes:
//! ```compile_fail
//! fn f(s: &projectos_host_windows_acl_policy::OwnedSid) -> *const core::ffi::c_void {
//!     s.as_ptr() // no such method
//! }
//! ```
//! The arbitrary-byte ACL parser is not callable:
//! ```compile_fail
//! fn f(bytes: &[u8]) {
//!     let _ = projectos_host_windows_acl_policy::descriptor::parse_acl(bytes); // crate-private
//! }
//! ```
//! The raw DACL carrier cannot even be named:
//! ```compile_fail
//! fn f() -> projectos_host_windows_acl_policy::descriptor::RawDacl { // crate-private type
//!     unimplemented!()
//! }
//! ```
//! ACL bytes cannot be constructed into an observation:
//! ```compile_fail
//! fn f(bytes: Vec<u8>) {
//!     let _ = projectos_host_windows_acl_policy::AclInspection::from_raw(None, 4, bytes); // crate-private
//! }
//! ```
//! ACL bytes cannot be read back out of an observation — the public DACL evidence is a fieldless
//! semantic state that carries nothing:
//! ```compile_fail
//! fn f(i: &projectos_host_windows_acl_policy::AclInspection) -> &[u8] {
//!     match i.dacl {
//!         projectos_host_windows_acl_policy::DaclState::Present(bytes) => bytes, // no payload
//!         _ => &[],
//!     }
//! }
//! ```
//! …and the semantic state is still a real three-way distinction, not a collapsed boolean:
//! ```
//! use projectos_host_windows_acl_policy::DaclState;
//! assert_ne!(DaclState::Absent, DaclState::Null);
//! assert_ne!(DaclState::Null, DaclState::Present);
//! assert_ne!(DaclState::Absent, DaclState::Present);
//! ```

#![deny(unsafe_code)]

pub mod descriptor;
pub mod error;
pub mod policy;
pub mod principal;
pub mod verify;

// The ONLY module permitted to use `unsafe` (the minimal Win32 security-descriptor primitives).
#[allow(unsafe_code)]
mod windows;

use std::path::Path;

use projectos_host_windows_root_custody::{RootCustodyError, WindowsRootCustody};

pub use descriptor::{AceKind, AceRecord, AclInspection, DaclState};
pub use error::AclPolicyError;
pub use policy::{AclPolicy, AllowedPrincipal, RightsClass};
pub use principal::{AclPrincipal, BroadPrincipal, OwnedSid};
pub use verify::{AclVerification, AclViolation, ApplyOutcome};

use descriptor::{build_allow_acl, AllowEntry, RawDacl, SE_DACL_PRESENT, SE_DACL_PROTECTED};

/// Translate the ACCEPTED root-custody classification into this crate's classification.
///
/// The wildcard arm fails CLOSED: `RootCustodyError` is `#[non_exhaustive]`, so a future variant must
/// never be silently treated as success.
fn map_custody(err: RootCustodyError) -> AclPolicyError {
    match err {
        RootCustodyError::UnsupportedPlatform => AclPolicyError::UnsupportedPlatform,
        RootCustodyError::EmptyPath => AclPolicyError::EmptyPath,
        RootCustodyError::RelativePath => AclPolicyError::RelativePath,
        RootCustodyError::UnsupportedNamespace => AclPolicyError::UnsupportedNamespace,
        RootCustodyError::NotFound => AclPolicyError::NotFound,
        RootCustodyError::NotADirectory => AclPolicyError::NotADirectory,
        RootCustodyError::ReparsePointRefused => AclPolicyError::ReparsePointRefused,
        RootCustodyError::IdentityMismatch | RootCustodyError::PathReplaced => {
            AclPolicyError::PathReplaced
        }
        _ => AclPolicyError::WindowsApiFailure,
    }
}

/// Inspect, verify and (only on explicit request) apply an explicit ACL policy on ONE directory.
///
/// The service never creates or deletes the directory, never changes file contents, never recurses
/// into children, never accepts a relative path or a repository root implicitly, and derives no
/// authority from the current working directory.
#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsAclPolicyService;

impl WindowsAclPolicyService {
    /// A service value. Side-effect free.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Admit the root through the ACCEPTED custody rule: absolute local-root syntax, existence,
    /// directory-ness, and reparse refusal — all handle-derived, none from the pathname's spelling.
    fn admit(path: &Path) -> Result<WindowsRootCustody, AclPolicyError> {
        WindowsRootCustody::open(path).map_err(map_custody)
    }

    /// Read the existing owner and DACL state of an explicitly supplied absolute directory.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal.
    pub fn inspect_directory(&self, path: &Path) -> Result<AclInspection, AclPolicyError> {
        let custody = Self::admit(path)?;
        let (owner, control, dacl) = windows::read_security(path)?;
        // The pathname must still denote the object that was admitted; otherwise the observation
        // describes a different object and must not be returned as if it described this one.
        custody.revalidate().map_err(map_custody)?;
        AclInspection::from_raw(owner.as_deref(), control, dacl)
    }

    /// Compare the observed descriptor with an explicit policy.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal. A non-conforming ACL is NOT an error — it is a
    /// populated [`AclVerification`].
    pub fn verify_directory(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<AclVerification, AclPolicyError> {
        let inspection = self.inspect_directory(path)?;
        verify::verify(&inspection, policy)
    }

    /// Encode the exact state a policy intends, and refuse it PRE-EFFECT unless that state would
    /// itself verify against the same policy.
    fn intended_state(policy: &AclPolicy) -> Result<(OwnedSid, Vec<u8>), AclPolicyError> {
        let owner = policy.expected_owner.resolve()?;
        let mut sids = Vec::with_capacity(policy.allowed.len());
        for entry in &policy.allowed {
            sids.push((entry.principal.resolve()?, entry.rights.mask()));
        }
        let entries: Vec<AllowEntry<'_>> = sids
            .iter()
            .map(|(sid, mask)| AllowEntry { sid, mask: *mask })
            .collect();
        let acl = build_allow_acl(&entries)?;

        // Self-consistency: never apply a state this crate would then reject. This is what refuses a
        // policy granting a broad principal any access or write-like authority, before any effect.
        let intended = AclInspection::from_raw(
            Some(owner.as_bytes()),
            SE_DACL_PRESENT | SE_DACL_PROTECTED,
            RawDacl::Acl(acl.clone()),
        )?;
        if !verify::verify(&intended, policy)?.is_conforming() {
            return Err(AclPolicyError::PolicyRefused);
        }
        Ok((owner, acl))
    }

    /// Apply the policy. Mutation happens ONLY through this call (or [`Self::apply_and_verify`]).
    ///
    /// The DACL written is explicit, non-null, never absent, protected from inheritance, contains only
    /// non-inheritable allow ACEs, and is applied to the admitted object without recursion.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal. Any error returned before `SetSecurityInfo` means
    /// the ACL was NOT changed; [`AclPolicyError::PathReplaced`] afterwards means the effect landed on
    /// an object that is no longer the admitted one and must be reconciled, not retried.
    pub fn apply_directory_policy(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<(), AclPolicyError> {
        // ---- every refusal happens here, before any effect ----
        let (owner, acl) = Self::intended_state(policy)?;
        let custody = Self::admit(path)?;

        // ---- the single effect ----
        windows::apply_security(path, &owner, &acl)?;

        custody.revalidate().map_err(map_custody)
    }

    /// Apply the policy and then RE-READ it from Windows for authoritative verification.
    ///
    /// A successful `Set` call alone is never reported as success.
    ///
    /// # Errors
    /// [`AclPolicyError`] for a PRE-EFFECT refusal (the ACL was not changed). A changed-but-non-
    /// conforming state is reported as [`ApplyOutcome::ReconciliationRequired`], never as an error and
    /// never as success: nothing is retried, no policy is broadened, and no guessed prior state is
    /// restored. This crate does NOT implement snapshot or rollback and claims none.
    pub fn apply_and_verify(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<ApplyOutcome, AclPolicyError> {
        self.apply_directory_policy(path, policy)?;
        // AUTHORITATIVE: re-read from Windows, convert, and judge. Not the value we just wrote.
        let observed = self.verify_directory(path, policy)?;
        Ok(verify::classify_apply_outcome(observed))
    }
}
