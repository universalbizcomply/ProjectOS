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
//!   ProjectOS establishes that yet.
//!
//! The durable delegation store, the durable replay ledger and the canonical budget adapter all rest
//! on the second claim, not the first. A store opened on a correctly-resolved directory that any
//! local user can write is not a durable security store; it is a directory. So resolution alone must
//! not be able to open one.
//!
//! ## How the gate is closed, and by what
//!
//! [`ProtectedInstallationBoundaryAcceptance`] has a private field and, in every shipped graph, NO
//! constructor at all. It is therefore uninhabitable in production, which makes
//! [`ActivatedHostStateRoot`] and [`ActivatedGovernedProjectRoot`] uninhabitable too, which makes the
//! store constructors that consume them unreachable. The seam is closed by CONSTRUCTION rather than
//! by a runtime check somebody could forget to call.
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
//! ## What the ACL phase adds here, and only here
//!
//! One production mint on [`ProtectedInstallationBoundaryAcceptance`], taking whatever evidence that
//! phase defines. Nothing below it changes: the activated types, the store constructors and every
//! consumer are already written against this shape.

use std::path::Path;

use crate::governed_project::TrustedGovernedProjectRoot;
use crate::host_state::TrustedHostStateRoot;
use crate::refusal::TrustedRootRefusal;

/// Private seal. A struct with a private field cannot be built outside the module that declares it.
#[derive(Debug)]
struct Seal;

/// PROOF THAT THE PROTECTED INSTALLATION BOUNDARY WAS ACCEPTED.
///
/// ## The production mint is ABSENT, and that is the phase's result rather than an omission
///
/// Accepting the boundary means reading the installed subtree's owner and DACL and deciding they
/// match the restricted policy the installer is supposed to have applied. ProjectOS has the
/// inspection primitive for that and has NOT accepted the policy, so there is no honest value to
/// return. Manufacturing one — by assuming the installer ran, by checking that the directory merely
/// exists, or by trusting a record that lives inside the directory being judged — would be asserting
/// the one fact the whole boundary depends on.
///
/// Until that phase lands, no value of this type exists in a shipped build, and everything gated
/// behind it fails closed.
#[derive(Debug)]
pub struct ProtectedInstallationBoundaryAcceptance {
    _seal: Seal,
}

impl ProtectedInstallationBoundaryAcceptance {
    /// FIXTURE ONLY: stand in for an acceptance the ACL phase has not yet been built to produce.
    ///
    /// Compiled for this crate's tests and the non-default `test-fixtures` graph, so no shipped
    /// build can reach it. It exists so the shape BELOW the gate — activation, the accessors, and
    /// the store constructors that consume them — can be proven now rather than designed twice.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture() -> Self {
        Self { _seal: Seal }
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
