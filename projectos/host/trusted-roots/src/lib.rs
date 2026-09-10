//! # ProjectOS Host Trusted Roots — RUN-TO-COMPLETION HOST ATTESTATION §10E, §10F
//!
//! ## The two roots, and why they are two
//!
//! ProjectOSHost needs two trusted directories, and conflating them is the failure this crate exists
//! to make impossible.
//!
//! | | [`TrustedHostStateRoot`] | [`TrustedGovernedProjectRoot`] |
//! |---|---|---|
//! | answers | where the HOST keeps its own security state | which REPOSITORY is being governed |
//! | authority | the registered ProgramData location + the frozen installation segments | the canonical installed-project registry |
//! | one per | machine | registered project |
//! | consumers | durable delegation lifecycle (§10B), durable request replay (§10C) | the canonical budget ledger (§10D) |
//!
//! They are separate types with no conversion in either direction, so substituting one for the other
//! is a compile error rather than a check that could be forgotten. That is [`ACCEPTANCE MATRIX A4`]
//! discharged by the type system.
//!
//! [`ACCEPTANCE MATRIX A4`]: crate#what-this-crate-refuses
//!
//! ## What this crate refuses
//!
//! Neither root may be nominated. There is no public constructor taking a path, in any build and on
//! either type — not even a fixture one, which is where §10B, §10C and §10D each had to leave a
//! `fixture(&Path)` door. A caller cannot supply a path, an environment variable cannot redirect one,
//! the working directory is never consulted, argv is never read, and no request field reaches here.
//! The only inputs the public API accepts are a SEALED source (whose implementor set is closed at
//! compile time) and, for the governed root, a project id that the registry either recognises or
//! refuses.
//!
//! Every failure is a refusal. Unknown, missing, unregistered, mismatched, unsafe and unresolvable
//! all stop; none of them falls back to the working directory, a repository guess, a temporary
//! directory, the first matching project or a default project — not because a check rejects those,
//! but because no function here takes one as an input.
//!
//! ## Resolution is not activation
//!
//! Resolving a root says "this is the directory the installation means". It does NOT say "and its
//! restricted ACL makes writing there mean something", and the durable stores rest on the second
//! claim. [`crate::activation`] is the gate between them, and [`crate::activation::boundary`] is the ONE
//! production route through it: an observation of the real Windows owner and DACL, judged against
//! the frozen accepted policy. A build whose boundary does not conform resolves both roots correctly
//! and still cannot open a store.
//!
//! ## What acceptance protects against — and what it does not (§10F)
//!
//! The accepted policy leaves the Host state root owned by `NT AUTHORITY\SYSTEM` with a PROTECTED,
//! non-inherited DACL carrying exactly three allow ACEs: the service principal, `BUILTIN\
//! Administrators` and SYSTEM, each full control. No `Everyone`, `Authenticated Users`, `Users` or
//! `INTERACTIVE` ACE exists, and no ACE is inherited from `ProgramData`, whose default DACL DOES
//! grant `CREATOR OWNER` and `Users` create rights. So an ordinary non-privileged local account —
//! including the interactive owner's own logged-on session while it is not elevated — cannot write,
//! append to, rename, delete or re-secure the delegation store, the replay ledger or the
//! installed-project registry. That is the tamper and rollback risk §10B and §10C carried, and this
//! is what closes it.
//!
//! It closes NOTHING against a local administrator, SYSTEM, a kernel-level compromise, or offline
//! disk access. `BUILTIN\Administrators` holds an explicit full-control ACE by design: removing it
//! would not remove an administrator — who can take ownership, restore a backup or load a driver —
//! it would only make the host unserviceable while proving nothing. Anti-rollback here means
//! "an unprivileged actor cannot roll the Host's state back", and it is not stated more broadly.
//!
//! ## What it reuses rather than rebuilds
//!
//! * path syntax, traversal, UNC/device/ADS refusal, reparse refusal, handle-derived identity, the
//!   canonical final path and two-sided revalidation — the accepted handle-owned custody primitive;
//! * the registered ProgramData location — the approved read-only Known Folder primitive;
//! * the frozen `ProjectOS` / `host` segment vocabulary — the canonical installation record contract;
//! * which projects this installation may govern, and every rule that makes a registered root usable
//!   — the canonical installed-project registry.
//!
//! There is no second path-security framework here, and no second installation registry.
//!
//! ## What it never does
//!
//! It creates no directory, writes no file, changes no ACL, installs or starts no service, reads no
//! credential, contacts no provider, launches no process and opens no socket. The only filesystem
//! effect it can have is opening directory handles for `FILE_READ_ATTRIBUTES`, inside the custody
//! primitive.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! Neither trusted root has a path-taking constructor, in any build:
//! ```compile_fail
//! use projectos_host_trusted_roots::TrustedHostStateRoot;
//! let _ = TrustedHostStateRoot::new(std::path::Path::new("C:\\Windows"));
//! ```
//! ```compile_fail
//! use projectos_host_trusted_roots::TrustedGovernedProjectRoot;
//! let _ = TrustedGovernedProjectRoot::new(std::path::Path::new("C:\\Windows"));
//! ```
//! Not even a fixture one — unlike the store roots this crate feeds, a fixture proof here goes
//! through the REAL resolver:
//! ```compile_fail
//! use projectos_host_trusted_roots::TrustedGovernedProjectRoot;
//! let _ = TrustedGovernedProjectRoot::fixture(std::path::Path::new("C:\\Windows"));
//! ```
//! A downstream crate cannot become an anchor authority (the source traits are sealed):
//! ```compile_fail
//! use projectos_host_trusted_roots::{InstallationAnchorSource, TrustedRootRefusal};
//! struct MyAnchor;
//! impl InstallationAnchorSource for MyAnchor {
//!     fn anchor(&self) -> Result<std::path::PathBuf, TrustedRootRefusal> { unimplemented!() }
//! }
//! ```
//! ...nor a project authority:
//! ```compile_fail
//! use projectos_host_trusted_roots::{RegisteredProjectSource, TrustedRootRefusal};
//! struct MyRegistry;
//! impl RegisteredProjectSource for MyRegistry {
//!     fn repository_root(&self, _id: &str) -> Result<std::path::PathBuf, TrustedRootRefusal> {
//!         unimplemented!()
//!     }
//! }
//! ```
//! A trusted root cannot be duplicated into a second authority for one directory:
//! ```compile_fail
//! use projectos_host_trusted_roots::TrustedHostStateRoot;
//! fn f(r: &TrustedHostStateRoot) -> TrustedHostStateRoot { r.clone() }
//! ```
//! The two root classes cannot be substituted for each other:
//! ```compile_fail
//! use projectos_host_trusted_roots::{
//!     ActivatedHostStateRoot, ProtectedInstallationBoundaryAcceptance, TrustedGovernedProjectRoot,
//! };
//! fn f(
//!     g: TrustedGovernedProjectRoot,
//!     a: &ProtectedInstallationBoundaryAcceptance,
//! ) -> ActivatedHostStateRoot {
//!     ActivatedHostStateRoot::activate(g, a)
//! }
//! ```
//! ...and the reverse is equally refused:
//! ```compile_fail
//! use projectos_host_trusted_roots::{
//!     ActivatedGovernedProjectRoot, ProtectedInstallationBoundaryAcceptance, TrustedHostStateRoot,
//! };
//! fn f(
//!     h: TrustedHostStateRoot,
//!     a: &ProtectedInstallationBoundaryAcceptance,
//! ) -> ActivatedGovernedProjectRoot {
//!     ActivatedGovernedProjectRoot::activate(h, a)
//! }
//! ```
//! The boundary acceptance cannot be conjured, in any build:
//! ```compile_fail
//! use projectos_host_trusted_roots::ProtectedInstallationBoundaryAcceptance;
//! let _ = ProtectedInstallationBoundaryAcceptance::new();
//! ```
//! …nor minted from a caller's own verdict, however it is spelled — §10F adds exactly one route and
//! it is not this one:
//! ```compile_fail
//! use projectos_host_trusted_roots::ProtectedInstallationBoundaryAcceptance;
//! let _ = ProtectedInstallationBoundaryAcceptance::from_verified(true);
//! ```
//! The crate-private seal constructor is not reachable from outside, even by name:
//! ```compile_fail
//! use projectos_host_trusted_roots::ProtectedInstallationBoundaryAcceptance;
//! let _ = ProtectedInstallationBoundaryAcceptance::mint();
//! ```
pub mod activation;
mod canonical;
pub mod governed_project;
pub mod host_state;
pub mod refusal;
pub mod source;

#[cfg(test)]
mod tests;

#[cfg(windows)]
pub use activation::boundary::BoundaryRefusal;
pub use activation::store_custody::{
    GovernedHostStore, HostStateStore, HostStoreCustody, StoreCustodyRefusal, MAX_GOVERNED_OBJECTS,
};
pub use activation::{
    ActivatedGovernedProjectRoot, ActivatedHostStateRoot, ProtectedInstallationBoundaryAcceptance,
};
pub use governed_project::TrustedGovernedProjectRoot;
pub use host_state::TrustedHostStateRoot;
pub use refusal::TrustedRootRefusal;
pub use source::{
    ApprovedKnownFolderAnchor, CanonicalProjectRegistry, InstallationAnchorSource,
    RegisteredProjectSource,
};

#[cfg(any(test, feature = "test-fixtures"))]
pub use source::{FixtureInstallationAnchor, FixtureProjectRegistry};
