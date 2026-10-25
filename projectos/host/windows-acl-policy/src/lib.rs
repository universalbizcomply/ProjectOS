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
//! Since RUN-TO-COMPLETION HOST ATTESTATION §10I it can also **create** one new directory or file
//! WITH an explicit policy's owner and protected DACL, in the one creation call: privilege-free (the
//! owner must be the calling account), create-only (an existing object is reported, never adopted or
//! re-secured), and judged by an authoritative re-read.
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

use projectos_host_windows_root_custody::{
    RootCustodyError, WindowsFileCustody, WindowsRootCustody,
};

pub use descriptor::{AceKind, AceRecord, AclInspection, DaclState};
pub use error::AclPolicyError;
pub use policy::{AclPolicy, AllowedPrincipal, RightsClass};
pub use principal::{AclPrincipal, BroadPrincipal, OwnedSid};
pub use verify::{AclVerification, AclViolation, ApplyOutcome};
/// Activation-time account-SID resolution for a principal whose SID cannot be known in advance.
pub use windows::resolve_account_sid;

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
        RootCustodyError::NotAFile => AclPolicyError::NotAFile,
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
        let (owner, control, dacl) =
            windows::read_security(path, windows::SecuredObjectKind::Directory)?;
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
        windows::apply_security(path, &owner, &acl, windows::SecuredObjectKind::Directory)?;

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
    /// Admit a FILE through the same custody rule the directory path uses: absolute local-root
    /// syntax, existence, handle-derived type assertion, and reparse refusal.
    fn admit_file(path: &Path) -> Result<WindowsFileCustody, AclPolicyError> {
        WindowsFileCustody::open(path).map_err(map_custody)
    }

    /// Read the existing owner and DACL state of an explicitly supplied absolute FILE.
    ///
    /// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A: the canonical identity record is a file, and its ACL
    /// must be applied to that file directly — the protected parent directories carry non-inheritable
    /// ACEs, so nothing is inherited and a file created beneath them is governed by no policy at all.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal.
    pub fn inspect_file(&self, path: &Path) -> Result<AclInspection, AclPolicyError> {
        let custody = Self::admit_file(path)?;
        let (owner, control, dacl) =
            windows::read_security(path, windows::SecuredObjectKind::File)?;
        custody.revalidate().map_err(map_custody)?;
        AclInspection::from_raw(owner.as_deref(), control, dacl)
    }

    /// Compare an explicitly supplied absolute FILE's descriptor with an explicit policy.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal. A non-conforming ACL is NOT an error.
    pub fn verify_file(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<AclVerification, AclPolicyError> {
        let inspection = self.inspect_file(path)?;
        verify::verify(&inspection, policy)
    }

    /// Apply the policy to ONE file. Identical refusal ordering to the directory path: every refusal
    /// happens before any effect, and the DACL written is explicit, protected and non-inheritable.
    ///
    /// The file's CONTENTS are never opened for writing, read, truncated or rewritten — only its
    /// security descriptor is set.
    ///
    /// # Errors
    /// [`AclPolicyError`] classifying the refusal.
    pub fn apply_file_policy(&self, path: &Path, policy: &AclPolicy) -> Result<(), AclPolicyError> {
        let (owner, acl) = Self::intended_state(policy)?;
        let custody = Self::admit_file(path)?;
        windows::apply_security(path, &owner, &acl, windows::SecuredObjectKind::File)?;
        custody.revalidate().map_err(map_custody)
    }

    /// Apply the policy to ONE file and then RE-READ it from Windows for authoritative verification.
    /// A successful `Set` call alone is never reported as success.
    ///
    /// # Errors
    /// [`AclPolicyError`] for a PRE-EFFECT refusal (the ACL was not changed).
    pub fn apply_and_verify_file(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<ApplyOutcome, AclPolicyError> {
        self.apply_file_policy(path, policy)?;
        let observed = self.verify_file(path, policy)?;
        Ok(verify::classify_apply_outcome(observed))
    }

    // ---- §10I: GOVERNED CREATION ----
    //
    // The apply path above re-secures an object that ALREADY exists, so there is always a moment at
    // which it existed under whatever descriptor Windows gave it first, and assigning SYSTEM as owner
    // needs `SeRestorePrivilege`. The two calls below are the other shape: the object comes into
    // existence WITH the policy's owner and protected DACL, in the one creation call, so there is no
    // ambient moment and nothing to repair. Neither enables a privilege, and neither can rewrite an
    // object that already exists.

    /// The exact state a governed creation will write, refused PRE-EFFECT unless the caller may
    /// assign it WITHOUT a privilege.
    ///
    /// THE OWNER MUST BE THE CALLING PROCESS'S OWN ACCOUNT. Windows lets a token assign itself as
    /// owner and refuses a stranger unless `SeRestorePrivilege` is enabled — and whether it is enabled
    /// depends on how the process was launched (§10G-PRIV measured exactly that split). Refusing any
    /// other owner here, before Windows is asked, keeps the outcome identical in every shell and means
    /// no ambient privilege can ever be what made a creation succeed.
    fn creatable_state(policy: &AclPolicy) -> Result<(OwnedSid, Vec<u8>), AclPolicyError> {
        let (owner, acl) = Self::intended_state(policy)?;
        windows::refuse_impersonation()?;
        if owner != windows::current_account_sid()? {
            return Err(AclPolicyError::PolicyRefused);
        }
        Ok((owner, acl))
    }

    /// Create ONE new directory whose descriptor is exactly the policy's: its owner, a PROTECTED DACL
    /// and only non-inheritable allow ACEs — then RE-READ it from Windows and judge it.
    ///
    /// The parent's inheritable ACEs are NOT merged in (the DACL is protected) and the process
    /// token's default DACL is NOT used (a DACL is supplied), so the result depends on neither.
    ///
    /// Anything already at `path` is reported as [`GovernedCreation::AlreadyExists`] and is NOT
    /// touched: this never adopts, re-secures or repairs an existing object. Judging an existing one
    /// is [`Self::verify_directory`]'s job, and deciding what to do about it is the caller's.
    ///
    /// # Errors
    /// [`AclPolicyError::PolicyRefused`] PRE-EFFECT for a policy that would not verify, or whose owner
    /// is not the calling process's own account, or on an impersonating thread;
    /// [`AclPolicyError::RelativePath`] for a relative path;
    /// [`AclPolicyError::ReconciliationRequired`] if a directory was created and the authoritative
    /// re-read does not conform; otherwise the Windows classification.
    pub fn create_directory_governed(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<GovernedCreation, AclPolicyError> {
        if !path.is_absolute() {
            return Err(AclPolicyError::RelativePath);
        }
        let (owner, acl) = Self::creatable_state(policy)?;
        if !windows::create_directory_with_security(path, &owner, &acl)? {
            return Ok(GovernedCreation::AlreadyExists);
        }
        // AUTHORITATIVE: re-read from Windows, not the value handed to the creation call.
        let (observed_owner, control, dacl) =
            windows::read_security(path, windows::SecuredObjectKind::Directory)?;
        let observed = AclInspection::from_raw(observed_owner.as_deref(), control, dacl)?;
        if verify::verify(&observed, policy)?.is_conforming() {
            Ok(GovernedCreation::Created)
        } else {
            Err(AclPolicyError::ReconciliationRequired)
        }
    }

    /// Create ONE new FILE, opened for read and write, whose descriptor is exactly the policy's —
    /// then read that descriptor back FROM THE HANDLE JUST CREATED and judge it.
    ///
    /// `Ok(None)` when anything already exists at `path`: the existing object is not opened, not
    /// adopted and not re-secured. (Windows ignores a supplied descriptor when a creation call opens
    /// an existing file, which is exactly why this refuses to.)
    ///
    /// # Errors
    /// As [`Self::create_directory_governed`]. A created file that does not conform is closed and
    /// reported as [`AclPolicyError::ReconciliationRequired`]; removing it is the caller's decision.
    pub fn create_file_governed(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<Option<std::fs::File>, AclPolicyError> {
        if !path.is_absolute() {
            return Err(AclPolicyError::RelativePath);
        }
        let (owner, acl) = Self::creatable_state(policy)?;
        let Some(file) = windows::create_file_with_security(path, &owner, &acl)? else {
            return Ok(None);
        };
        let (observed_owner, control, dacl) = windows::read_file_security(&file)?;
        let observed = AclInspection::from_raw(observed_owner.as_deref(), control, dacl)?;
        if verify::verify(&observed, policy)?.is_conforming() {
            Ok(Some(file))
        } else {
            Err(AclPolicyError::ReconciliationRequired)
        }
    }
}

/// What a governed directory creation found at its target (§10I).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum GovernedCreation {
    /// A new object was created with exactly the policy's descriptor, and an authoritative re-read
    /// confirmed it.
    Created,
    /// Something already existed at the path. NOTHING was created, changed or re-secured.
    AlreadyExists,
}
