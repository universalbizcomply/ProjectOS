//! THE HOST'S DURABLE STORE CUSTODY — RUN-TO-COMPLETION HOST ATTESTATION §10I.
//!
//! ## The defect this closes
//!
//! §10H opens the delegation-lifecycle and request-replay stores before ProjectOSHost reports
//! Running. On a first real start neither store exists, and the accepted Host state-root DACL
//! carries NO inheritable ACE — so every directory and file the durable engine then created would
//! have taken the service token's DEFAULT owner and DACL. Security-authority state whose descriptor
//! is whatever the token happened to say is not governed state.
//!
//! ## What custody means here
//!
//! EVERY object in a store — the store directory, its three fixed subdirectories, the lock file,
//! and every staging file the engine renames into a record, the manifest or a journal entry — comes
//! into existence WITH one committed descriptor, composed from the frozen production plan
//! (`AclCompositionPlan::compose_host_store_with_resolved_principal`):
//!
//! ```text
//! owner  NT SERVICE\ProjectOSHost              (created BY the service; no privilege involved)
//! DACL   PROTECTED, explicit ACEs only, none inheritable
//!        NT SERVICE\ProjectOSHost   Modify           read, traverse, create, write, delete
//!        OWNER RIGHTS               ReadAttributes   removes the owner's implicit WRITE_DAC
//!        BUILTIN\Administrators     FullControl
//!        NT AUTHORITY\SYSTEM        FullControl
//! ```
//!
//! The parent's inheritance is not consulted (the DACL is protected), the token's default DACL is
//! not used (a DACL is supplied), and the token's default owner is not used (an owner is supplied).
//! A renamed file keeps its own descriptor, so a governed staging file is what makes every published
//! record governed — a replacement can carry custody, never weaken it.
//!
//! ## What it will not do
//!
//! It never re-secures an object that already exists. An existing store that CONFORMS opens; one
//! that does not is REFUSED, whole, and left exactly as it was found — startup is not an ACL
//! remediation engine, and "repairing" state whose history is unknown would launder it. It takes no
//! path from a caller, no policy and no SID: the store is one of a closed enum, the state root comes
//! from an activated root, and the principal is resolved through Windows.
//!
//! ## Why the service may run it, and nobody else
//!
//! A creation may only name the CALLING account as owner — the accepted ACL primitive refuses any
//! other before Windows is asked — and the production custody names `NT SERVICE\ProjectOSHost`. So
//! the production stores can be first-created by ProjectOSHost itself and by no other process, and
//! no privilege — ambient or enabled — is ever what made a creation succeed.

use std::fs::File;
use std::path::{Path, PathBuf};

#[cfg(windows)]
use projectos_host_identity::canonical_record::EXPECTED_SERVICE_NAME;
#[cfg(windows)]
use projectos_host_windows_acl_policy::{
    resolve_account_sid, AclPolicy, AclPolicyError, AclVerification, AclViolation,
    GovernedCreation, OwnedSid, WindowsAclPolicyService,
};
#[cfg(windows)]
use projectos_host_windows_activation_plan::acl_plan::{
    AclCompositionOutcome, AclCompositionPlan, ApprovedServicePrincipal,
};
#[cfg(windows)]
use projectos_host_windows_activation_plan::service_identity::{
    ServiceIdentityPlan, ServiceIdentityStrategy,
};

use crate::activation::ActivatedHostStateRoot;

/// The most objects one store may hold before its custody check refuses rather than walks on.
///
/// DERIVED, NOT ROUND: the durable engine's own bounds — 4096 records, 8192 journal entries and a
/// 4096-entry temp scan — plus the store directory, its three fixed subdirectories, the lock file and
/// the manifest. A store bigger than the engine could have produced is not one to trust by walking.
pub const MAX_GOVERNED_OBJECTS: usize = 4096 + 8192 + 4096 + 6;

/// The Host's durable stores. CLOSED: a store not listed here has no custody, and no caller can name
/// a directory of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostStateStore {
    /// The owner-programme delegation lifecycle (§10B).
    DelegationLifecycle,
    /// The consumed-request replay history (§10C).
    RequestReplay,
}

impl HostStateStore {
    /// The ONE frozen segment beneath the Host state root that holds this store.
    #[must_use]
    pub const fn segment(self) -> &'static str {
        match self {
            Self::DelegationLifecycle => "delegation-state",
            Self::RequestReplay => "request-replay",
        }
    }
}

/// Why a store's custody could not be established. Every variant REFUSES.
///
/// SEMANTIC ONLY: no path, SID, account name, descriptor byte or OS error text appears in any
/// variant. `NonConforming` carries the accepted verifier's own fieldless findings.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum StoreCustodyRefusal {
    /// This platform has no Windows security descriptors, so no custody can be established.
    PlatformUnsupported,
    /// The service principal did not resolve, or the frozen plan would not compose its policy.
    ServiceIdentityUnresolved,
    /// The Host state root is not a directory this custody can create beneath.
    StateRootUnusable,
    /// A governed creation was refused — including because this process is not the account the
    /// custody names as owner.
    CreationRefused,
    /// An object's descriptor, or the store's contents, could not be read.
    StoreUnreadable,
    /// An object exists whose owner or DACL is not the committed one. Nothing was repaired.
    #[cfg(windows)]
    NonConforming(Vec<AclViolation>),
    /// An object the engine never creates: a reparse point, a directory below the fixed ones, or a
    /// file where the store directory belongs.
    UnexpectedObject,
    /// More objects than the engine's own bounds allow.
    TooManyObjects,
}

/// Whose account the custody names as owner and grants `Modify`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
enum CustodyPrincipal {
    /// `NT SERVICE\ProjectOSHost`, resolved through Windows at establishment.
    InstalledService,
    /// FIXTURE ONLY: the calling process's own account, so the SAME composition can be exercised on
    /// a disposable root by a process that is not the installed service.
    #[cfg(any(test, feature = "test-fixtures"))]
    CallingAccount,
}

/// THE CUSTODY OF THE HOST'S DURABLE STORES beneath one Host state root.
///
/// It holds the state root and whose custody it is, and nothing a caller supplied: the production
/// value comes only from [`ActivatedHostStateRoot::store_custody`], so it exists only where a root was
/// resolved AND its protected boundary accepted.
#[derive(Clone)]
pub struct HostStoreCustody {
    state_root: PathBuf,
    #[cfg_attr(not(windows), allow(dead_code))]
    principal: CustodyPrincipal,
}

impl core::fmt::Debug for HostStoreCustody {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // REDACTED: a machine location must not reach a log because something printed a value.
        f.write_str("HostStoreCustody(redacted)")
    }
}

impl ActivatedHostStateRoot {
    /// THE STORE CUSTODY beneath this activated root.
    ///
    /// For the installed Host's root — the only kind a shipped build can resolve — that is
    /// `NT SERVICE\ProjectOSHost`. In the fixture graph, a root resolved beneath a DISPOSABLE test
    /// anchor is custodied for the calling account instead, because a process can only create objects
    /// it owns and a test is not the installed service. Which one applies is a fact of how the root
    /// was RESOLVED, never a choice made here.
    ///
    /// Composes nothing and touches nothing yet: the principal is resolved, and the policy composed,
    /// when a store is actually established.
    #[must_use]
    pub fn store_custody(&self) -> HostStoreCustody {
        #[cfg(any(test, feature = "test-fixtures"))]
        if self.root.is_disposable() {
            return HostStoreCustody::fixture(self.path());
        }
        HostStoreCustody {
            state_root: self.path().to_path_buf(),
            principal: CustodyPrincipal::InstalledService,
        }
    }
}

impl HostStoreCustody {
    /// FIXTURE ONLY: custody for the CALLING account beneath a disposable directory the test owns.
    ///
    /// Same frozen composition, same creation and verification path; only the principal differs,
    /// because a process can only create objects it owns. No shipped build compiles it.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(owned_root: &Path) -> Self {
        Self {
            state_root: owned_root.to_path_buf(),
            principal: CustodyPrincipal::CallingAccount,
        }
    }

    /// The Host state root this custody governs stores beneath.
    #[must_use]
    pub fn state_root(&self) -> &Path {
        &self.state_root
    }

    /// Establish custody of one store: create its directory WITH the committed descriptor if it is
    /// absent, then judge EVERY object in it against that descriptor.
    ///
    /// ## The sequence
    ///
    /// 1. resolve the principal and compose the committed policy — an unresolved identity refuses
    ///    before anything is touched;
    /// 2. create the store directory with that descriptor, or find something already there — which
    ///    is never adopted, rewritten or re-secured;
    /// 3. judge the store directory and everything beneath it; any non-conforming, unexpected or
    ///    unreadable object refuses the whole store.
    ///
    /// Only then is a [`GovernedHostStore`] returned. Its creation calls are what the durable engine
    /// uses for every object it makes afterwards.
    ///
    /// # Errors
    /// [`StoreCustodyRefusal`] naming the first failure. Nothing is repaired on any path.
    #[cfg(windows)]
    pub fn establish(
        &self,
        store: HostStateStore,
    ) -> Result<GovernedHostStore, StoreCustodyRefusal> {
        let policy = self.policy()?;
        if !self.state_root.is_dir() {
            return Err(StoreCustodyRefusal::StateRootUnusable);
        }
        let dir = self.state_root.join(store.segment());
        match WindowsAclPolicyService::new().create_directory_governed(&dir, &policy) {
            Ok(GovernedCreation::Created | GovernedCreation::AlreadyExists) => {}
            Ok(_) | Err(_) => return Err(StoreCustodyRefusal::CreationRefused),
        }
        // The engine names its objects from the CANONICAL form of this directory; containment is
        // judged against the same form, so one spelling of the directory decides both.
        let canonical = std::fs::canonicalize(&dir)
            .ok()
            .and_then(|p| p.to_str().map(|s| undecorate(s).to_owned()))
            .ok_or(StoreCustodyRefusal::StoreUnreadable)?;
        let governed = GovernedHostStore {
            dir,
            canonical,
            policy,
        };
        governed.verify_contents()?;
        Ok(governed)
    }

    /// Off Windows there is no descriptor to govern with, so there is no store.
    ///
    /// # Errors
    /// Always [`StoreCustodyRefusal::PlatformUnsupported`].
    #[cfg(not(windows))]
    pub fn establish(
        &self,
        store: HostStateStore,
    ) -> Result<GovernedHostStore, StoreCustodyRefusal> {
        let _ = store;
        Err(StoreCustodyRefusal::PlatformUnsupported)
    }

    /// The committed store policy for this custody's principal.
    #[cfg(windows)]
    fn policy(&self) -> Result<AclPolicy, StoreCustodyRefusal> {
        let sid = match self.principal {
            // THE SAME RESOLUTION THE §10F BOUNDARY MINT PERFORMS: the account NAME is resolved to
            // the SID Windows holds for it; nothing is inferred from its spelling.
            CustodyPrincipal::InstalledService => {
                resolve_account_sid(&format!("NT SERVICE\\{EXPECTED_SERVICE_NAME}"))
            }
            #[cfg(any(test, feature = "test-fixtures"))]
            CustodyPrincipal::CallingAccount => {
                projectos_host_windows_acl_policy::AclPrincipal::CurrentInteractiveUser.resolve()
            }
        }
        .map_err(|_| StoreCustodyRefusal::ServiceIdentityUnresolved)?;
        compose(sid)
    }
}

/// Compose the committed store policy for a resolved service SID, through the frozen plan.
#[cfg(windows)]
fn compose(sid: OwnedSid) -> Result<AclPolicy, StoreCustodyRefusal> {
    // The owner decision (C5) is a repository fact, stated the way the installer and the §10F mint
    // state it.
    const STRATEGY: ServiceIdentityStrategy = ServiceIdentityStrategy::VirtualServiceAccount;
    let principal = ApprovedServicePrincipal::from_resolved_sid(STRATEGY, sid)
        .map_err(|_| StoreCustodyRefusal::ServiceIdentityUnresolved)?;
    let identity = ServiceIdentityPlan::analysed().with_owner_decision(STRATEGY);
    match AclCompositionPlan::production()
        .compose_host_store_with_resolved_principal(&identity, &principal)
    {
        AclCompositionOutcome::Composed(policy) => Ok(policy),
        _ => Err(StoreCustodyRefusal::ServiceIdentityUnresolved),
    }
}

/// Strip the verbatim prefix Windows returns from a drive-rooted path.
#[cfg(windows)]
fn undecorate(path: &str) -> &str {
    path.strip_prefix(r"\\?\").unwrap_or(path)
}

/// ONE STORE WHOSE CUSTODY WAS ESTABLISHED — the store directory exists with the committed
/// descriptor and every object in it conformed.
///
/// Its two creation calls are the ONLY way new objects should enter the store: each creates exactly
/// one object, beneath this store and nowhere else, with the committed descriptor, and refuses when
/// anything is already there.
#[derive(Clone)]
pub struct GovernedHostStore {
    dir: PathBuf,
    #[cfg(windows)]
    canonical: String,
    #[cfg(windows)]
    policy: AclPolicy,
}

impl core::fmt::Debug for GovernedHostStore {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("GovernedHostStore(redacted)")
    }
}

#[cfg(windows)]
impl GovernedHostStore {
    /// The store directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// Create ONE new directory beneath this store with the committed descriptor.
    ///
    /// # Errors
    /// `AlreadyExists` when anything is at `path` (it is not touched); `PermissionDenied` when `path`
    /// is not strictly beneath this store; any other refusal as `Other`.
    pub fn create_directory(&self, path: &Path) -> std::io::Result<()> {
        self.contain(path)?;
        match WindowsAclPolicyService::new().create_directory_governed(path, &self.policy) {
            Ok(GovernedCreation::Created) => Ok(()),
            Ok(_) => Err(std::io::ErrorKind::AlreadyExists.into()),
            Err(e) => Err(std::io::Error::other(e)),
        }
    }

    /// Create ONE new file beneath this store with the committed descriptor, opened for reading and
    /// writing.
    ///
    /// # Errors
    /// As [`Self::create_directory`].
    pub fn create_file(&self, path: &Path) -> std::io::Result<File> {
        self.contain(path)?;
        match WindowsAclPolicyService::new().create_file_governed(path, &self.policy) {
            Ok(Some(file)) => Ok(file),
            Ok(None) => Err(std::io::ErrorKind::AlreadyExists.into()),
            Err(e) => Err(std::io::Error::other(e)),
        }
    }

    /// Judge the store directory and EVERY object beneath it against the committed descriptor.
    ///
    /// Read-only. The first non-conforming, unexpected or unreadable object refuses the whole store;
    /// nothing is repaired, removed or re-secured.
    ///
    /// # Errors
    /// [`StoreCustodyRefusal`] naming the first failure.
    pub fn verify_contents(&self) -> Result<(), StoreCustodyRefusal> {
        let service = WindowsAclPolicyService::new();
        judge(service.verify_directory(&self.dir, &self.policy))?;
        let mut seen = 1usize;
        // (directory, depth below the store directory). The engine makes exactly one level of
        // subdirectory; anything deeper is not its object.
        let mut pending = vec![(self.dir.clone(), 0u8)];
        while let Some((dir, depth)) = pending.pop() {
            let entries =
                std::fs::read_dir(&dir).map_err(|_| StoreCustodyRefusal::StoreUnreadable)?;
            for entry in entries {
                let path = entry
                    .map_err(|_| StoreCustodyRefusal::StoreUnreadable)?
                    .path();
                seen += 1;
                if seen > MAX_GOVERNED_OBJECTS {
                    return Err(StoreCustodyRefusal::TooManyObjects);
                }
                let meta = std::fs::symlink_metadata(&path)
                    .map_err(|_| StoreCustodyRefusal::StoreUnreadable)?;
                if meta.is_dir() {
                    if depth >= 1 {
                        return Err(StoreCustodyRefusal::UnexpectedObject);
                    }
                    judge(service.verify_directory(&path, &self.policy))?;
                    pending.push((path, depth + 1));
                } else {
                    // A reparse point is not a directory to `symlink_metadata`, and the accepted
                    // file admission refuses it: it lands here and becomes `UnexpectedObject`.
                    judge(service.verify_file(&path, &self.policy))?;
                }
            }
        }
        Ok(())
    }

    /// Refuse any path that is not STRICTLY beneath this store directory.
    ///
    /// Judged textually against the canonical store directory, because the engine names its objects
    /// by joining fixed segments and hex names onto that canonical form. A `..`, `.`, empty or
    /// stream-bearing component, a forward slash, or the store directory itself is refused.
    fn contain(&self, path: &Path) -> std::io::Result<()> {
        let refuse = || -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "outside the governed store",
            ))
        };
        let Some(text) = path.to_str() else {
            return refuse();
        };
        let text = undecorate(text);
        let base = self.canonical.as_str();
        if text.len() <= base.len() + 1 || !text.is_char_boundary(base.len()) {
            return refuse();
        }
        let (head, tail) = text.split_at(base.len());
        let Some(rest) = tail.strip_prefix('\\') else {
            return refuse();
        };
        if !head.eq_ignore_ascii_case(base)
            || rest.contains('/')
            || rest
                .split('\\')
                .any(|c| c.is_empty() || c == "." || c == ".." || c.contains(':'))
        {
            return refuse();
        }
        Ok(())
    }
}

/// Off Windows no [`GovernedHostStore`] can be established, so none of these is ever reached; they
/// exist so the Host's store code has one shape on every platform, and they refuse.
#[cfg(not(windows))]
impl GovernedHostStore {
    /// The store directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// Refuses: no governed creation exists off Windows.
    ///
    /// # Errors
    /// Always `Unsupported`.
    pub fn create_directory(&self, _path: &Path) -> std::io::Result<()> {
        Err(std::io::ErrorKind::Unsupported.into())
    }

    /// Refuses: no governed creation exists off Windows.
    ///
    /// # Errors
    /// Always `Unsupported`.
    pub fn create_file(&self, _path: &Path) -> std::io::Result<File> {
        Err(std::io::ErrorKind::Unsupported.into())
    }

    /// Refuses: there is no descriptor to judge off Windows.
    ///
    /// # Errors
    /// Always [`StoreCustodyRefusal::PlatformUnsupported`].
    pub fn verify_contents(&self) -> Result<(), StoreCustodyRefusal> {
        Err(StoreCustodyRefusal::PlatformUnsupported)
    }
}

/// One verdict from the accepted verifier, as a custody refusal.
#[cfg(windows)]
fn judge(verdict: Result<AclVerification, AclPolicyError>) -> Result<(), StoreCustodyRefusal> {
    match verdict {
        Ok(v) if v.is_conforming() => Ok(()),
        Ok(v) => Err(StoreCustodyRefusal::NonConforming(v.violations().to_vec())),
        Err(
            AclPolicyError::ReparsePointRefused
            | AclPolicyError::NotADirectory
            | AclPolicyError::NotAFile
            | AclPolicyError::PathReplaced,
        ) => Err(StoreCustodyRefusal::UnexpectedObject),
        Err(_) => Err(StoreCustodyRefusal::StoreUnreadable),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// THE PRODUCTION CUSTODY, exercised on a disposable directory by a process that is not the
    /// installed service: it must refuse, and it must create nothing. If `NT SERVICE\ProjectOSHost`
    /// resolves on this machine the refusal is the owner rule (a creation may only name the calling
    /// account); if it does not, it is the unresolved identity. Either way: no store.
    #[test]
    fn production_custody_is_establishable_only_by_the_installed_service_itself() {
        let root =
            std::env::temp_dir().join(format!("pos-10i-production-custody-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let custody = HostStoreCustody {
            state_root: root.clone(),
            principal: CustodyPrincipal::InstalledService,
        };
        for store in [
            HostStateStore::DelegationLifecycle,
            HostStateStore::RequestReplay,
        ] {
            let err = custody
                .establish(store)
                .expect_err("not the installed service");
            assert!(
                matches!(
                    err,
                    StoreCustodyRefusal::CreationRefused
                        | StoreCustodyRefusal::ServiceIdentityUnresolved
                ),
                "{err:?}"
            );
            assert!(
                !root.join(store.segment()).exists(),
                "a refused custody created a store"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
