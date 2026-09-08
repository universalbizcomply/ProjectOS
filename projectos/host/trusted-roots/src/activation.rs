//! THE ACTIVATION GATE — resolved is not the same as usable, and this is where the difference lives.
//!
//! ## Why a gate exists between resolution and the stores
//!
//! §10E resolves roots. It does NOT accept the protected installation boundary, and the two are
//! genuinely different claims:
//!
//! * RESOLUTION says "this is the directory the installation means". That is what
//!   [`crate::host_state`] and [`crate::governed_project`] establish, and they establish it fully.
//! * ACCEPTANCE says "and its restricted ACL makes writing there mean something". Nothing in
//!   ProjectOS established that until §10F, and [`boundary`] is where it now happens.
//!
//! The durable delegation store, the durable replay ledger and the canonical budget adapter all rest
//! on the second claim, not the first. A store opened on a correctly-resolved directory that any
//! local user can write is not a durable security store; it is a directory. So resolution alone must
//! not be able to open one.
//!
//! ## How the gate is closed, and by what
//!
//! [`ProtectedInstallationBoundaryAcceptance`] has a private field, so it cannot be built outside
//! this crate. §10F adds the ONE production route that builds it —
//! [`ProtectedInstallationBoundaryAcceptance::verify`], documented in [`boundary`] — and that
//! route takes a sealed trusted root and nothing else. The seam is therefore closed by CONSTRUCTION:
//! a caller that cannot obtain a conforming boundary cannot obtain an activation, and cannot reach
//! the store constructors that consume one, whatever it asserts.
//!
//! ## Why ONE acceptance for both roots
//!
//! Both trust chains terminate at the same unaccepted fact. The Host state root IS the protected
//! subtree. The governed project root is not — a governed repository is user-writable by design, and
//! the agent writes its ledger — but the only thing that says WHICH repository it is is the
//! installed-project registry, which lives inside the protected subtree. So a governed root is
//! exactly as trustworthy as that boundary, and pretending it had an independent acceptance would
//! have been two names for one fact.
//!
//! Crossover is impossible regardless: the activated types take their own root type by value, so a
//! governed project root cannot be activated as a Host state root or the reverse. That is a compile
//! error, not a check.
//!
//! ## What the ACL phase added here, and only here
//!
//! One production mint on [`ProtectedInstallationBoundaryAcceptance`]. Nothing below it changed:
//! the activated types, their accessors, the store constructors and every consumer are exactly the
//! shape §10E froze, which is what the gate being a single seam was for.

#[cfg(windows)]
pub mod boundary;

use std::path::Path;

use crate::governed_project::TrustedGovernedProjectRoot;
use crate::host_state::TrustedHostStateRoot;
use crate::refusal::TrustedRootRefusal;

/// Private seal. A struct with a private field cannot be built outside the module that declares it.
#[derive(Debug)]
struct Seal;

/// PROOF THAT THE PROTECTED INSTALLATION BOUNDARY WAS ACCEPTED.
///
/// ## The production mint (§10F)
///
/// Accepting the boundary means reading the installed subtree's owner and DACL and deciding they
/// match the restricted policy the installer applied. [`Self::verify`] is that mint and the ONLY
/// one: it revalidates the trusted root, resolves the service identity through Windows, composes
/// the one accepted production policy, observes the real descriptor, judges it, revalidates the
/// root again, and only then returns a value. It is documented in [`boundary`].
///
/// There is no other route. The type has a private field, so it cannot be built outside this crate;
/// no public constructor takes a bool, a path, a policy, a SID, a security descriptor or a
/// caller-supplied verification result; and nothing stored INSIDE the boundary being judged is
/// consulted to decide whether that boundary is trustworthy.
#[derive(Debug)]
pub struct ProtectedInstallationBoundaryAcceptance {
    _seal: Seal,
}

impl ProtectedInstallationBoundaryAcceptance {
    /// THE SINGLE POINT AT WHICH THE SEAL IS CREATED, and the narrowest visibility Rust can give it.
    ///
    /// `pub(in crate::activation)` — NOT `pub(crate)`. The difference is the whole guarantee. A
    /// `pub(crate)` constructor is callable from ANY module in this crate, so a helper added
    /// anywhere later could mint an acceptance without resolving a SID, composing a policy or
    /// reading a descriptor, and the compiler would not object. Restricting visibility to this
    /// module and its descendants leaves exactly two places that can call it: this file, and
    /// [`boundary`] — which is a descendant precisely so that the restriction can be stated.
    /// A new sibling module cannot reach it at all.
    ///
    /// This is the crate's stated philosophy applied to itself: closed by construction, not by a
    /// convention someone could forget.
    pub(in crate::activation) fn mint() -> Self {
        Self { _seal: Seal }
    }

    /// FIXTURE ONLY: an acceptance for proofs of the shape BELOW the gate.
    ///
    /// Compiled for this crate's tests and the non-default `test-fixtures` graph, so no shipped
    /// build can reach it. It exists so activation, the accessors and the store constructors that
    /// consume them can be exercised without a conforming real boundary. It is NOT the production
    /// mint and never was: [`Self::verify`] is.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture() -> Self {
        Self::mint()
    }
}

/// A Host state root that may be OPENED, not merely named.
///
/// Holding one means the root resolved AND the protected boundary was accepted. It is the only
/// value the Host's durable state stores accept.
#[derive(Debug)]
pub struct ActivatedHostStateRoot {
    root: TrustedHostStateRoot,
}

impl ActivatedHostStateRoot {
    /// Activate a resolved Host state root against an accepted boundary.
    ///
    /// NO PATH PARAMETER, IN ANY BUILD. The root arrives already sealed and already resolved; this
    /// call adds the boundary fact and nothing else, so there is no argument here for a caller to
    /// choose even if it could obtain an acceptance.
    #[must_use]
    pub fn activate(
        root: TrustedHostStateRoot,
        _accepted: &ProtectedInstallationBoundaryAcceptance,
    ) -> Self {
        Self { root }
    }

    /// The canonical Host state root.
    #[must_use]
    pub fn path(&self) -> &Path {
        self.root.path()
    }

    /// Re-check the chain and the held object before relying on the root.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first divergence.
    pub fn revalidate(&self) -> Result<(), TrustedRootRefusal> {
        self.root.revalidate()
    }
}

/// A governed project root that may be TRANSACTED AGAINST, not merely named.
#[derive(Debug)]
pub struct ActivatedGovernedProjectRoot {
    root: TrustedGovernedProjectRoot,
}

impl ActivatedGovernedProjectRoot {
    /// Activate a resolved governed project root against an accepted boundary.
    ///
    /// NO PATH PARAMETER, IN ANY BUILD, for the same reason as above.
    #[must_use]
    pub fn activate(
        root: TrustedGovernedProjectRoot,
        _accepted: &ProtectedInstallationBoundaryAcceptance,
    ) -> Self {
        Self { root }
    }

    /// The canonical governed project root.
    #[must_use]
    pub fn path(&self) -> &Path {
        self.root.path()
    }

    /// The project id this root was attested for.
    #[must_use]
    pub fn project_id(&self) -> &str {
        self.root.project_id()
    }

    /// Re-check the held object before relying on the root.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first divergence.
    pub fn revalidate(&self) -> Result<(), TrustedRootRefusal> {
        self.root.revalidate()
    }
}
