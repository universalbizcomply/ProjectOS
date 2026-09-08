//! A1 — THE HOST STATE ROOT: the Host's own durable security-state root.
//!
//! ## The question this answers
//!
//! "Where does ProjectOSHost keep the state that decides whether a delegation is live and whether a
//! governed request has already run?" It is not the same question as "which project is being
//! governed", and this module deliberately cannot answer that one — see [`crate::governed_project`].
//!
//! ## The authority, in one line
//!
//! The registered ProgramData location, read from Windows through the approved Known Folder
//! primitive, with the SAME two segments the installation's own records already compose beneath it.
//!
//! ## Why those segments and not new ones
//!
//! `<ProgramData>\ProjectOS\host\installation\` already holds the canonical identity record, the
//! installed-application record and the installed-project registry. The Host state root is the
//! parent of that subtree — `<ProgramData>\ProjectOS\host` — and it is composed from the very
//! constants those three records are composed from. Inventing a segment here would have created a
//! second vocabulary for one location, and the day the two disagreed the installer and the Host
//! would stop meaning the same directory.
//!
//! ## What resolution refuses
//!
//! Every level this module composes THROUGH is opened as custody in its own right, so a junction or
//! symlink substituted for `ProgramData`, for `ProjectOS`, or for `host` is refused rather than
//! followed. The leaf's handle is retained for the life of the value, and [`TrustedHostStateRoot::revalidate`]
//! re-checks the whole chain plus the held object's identity — so a root that is re-aimed after
//! resolution is detected rather than trusted.
//!
//! ## What it never does
//!
//! It creates no directory (an absent root is a refusal, not something to manufacture), writes
//! nothing, changes no ACL, and reads no file. It takes no path, no environment variable, no working
//! directory, no argv entry and no request field.

use std::path::{Path, PathBuf};

use projectos_host_windows_root_custody::WindowsRootCustody;

use crate::canonical::settle;
use crate::refusal::{from_custody, TrustedRootRefusal};
use crate::source::InstallationAnchorSource;

/// The product segment beneath the installation anchor. Imported, never spelled here.
#[cfg(windows)]
pub const PRODUCT_SEGMENT: &str = projectos_host_identity::canonical_record::EXPECTED_PRODUCT;

/// The host-state segment beneath the product segment. Imported, never spelled here.
#[cfg(windows)]
pub const HOST_STATE_SEGMENT: &str =
    projectos_host_identity::canonical_record::HOST_STATE_DIRECTORY_SEGMENT;

/// THE HOST'S OWN DURABLE SECURITY-STATE ROOT, resolved and sealed.
///
/// ## It is a capability, not a path
///
/// Every field is private and there is no constructor that takes a path, in any build. Possessing
/// one IS the evidence that the approved anchor answered, that the frozen segments were composed
/// beneath it, that no level of the chain was a reparse point, and that a handle to the resulting
/// directory is held. None of that can be asserted; it can only be resolved.
///
/// ## Not `Clone`, and not convertible
///
/// A second owner of a trusted root is a second authority for the same directory, and the custody
/// handle it carries is deliberately single-owner. There is also no route from here to a
/// [`crate::governed_project::TrustedGovernedProjectRoot`] or back: the two roots answer different
/// questions, and making them interchangeable is the confusion §10E exists to prevent.
///
/// ## Holding one does not open anything
///
/// It is not an activation. The durable stores are reached through
/// [`crate::activation::ActivatedHostStateRoot`], whose production mint is absent until the ACL
/// boundary is accepted.
pub struct TrustedHostStateRoot {
    /// The canonical path derived FROM the held handle — one spelling, whatever the anchor's was.
    canonical: PathBuf,
    /// The retained leaf handle. Dropping this value closes it; nothing else can.
    custody: WindowsRootCustody,
    /// The levels composed through, in order, so revalidation can re-walk the whole chain.
    ancestors: Vec<PathBuf>,
    /// The composed leaf pathname — what the installation SAYS the root is.
    ///
    /// Kept because the decisive redirection check compares where the object actually lives against
    /// where it was composed to live, and revalidation has to be able to ask that question again.
    composed: PathBuf,
}

impl core::fmt::Debug for TrustedHostStateRoot {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // REDACTED, exactly as the custody primitive redacts: a machine location must not reach a
        // log, a report or a panic message merely because something derived `Debug`.
        f.write_str("TrustedHostStateRoot(redacted)")
    }
}

impl TrustedHostStateRoot {
    /// Resolve the Host state root from an installation anchor.
    ///
    /// The source is SEALED, so the only anchors reachable are the approved Known Folder one and —
    /// in a fixture graph that no shipped build compiles — a disposable directory a test owns.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first failed check. There is no fallback path.
    #[cfg(windows)]
    pub fn resolve<S: InstallationAnchorSource>(source: &S) -> Result<Self, TrustedRootRefusal> {
        let anchor = source.anchor()?;
        let product = anchor.join(PRODUCT_SEGMENT);
        let leaf = product.join(HOST_STATE_SEGMENT);
        let ancestors = vec![anchor, product];

        // EVERY LEVEL, NOT JUST THE LEAF. `FILE_FLAG_OPEN_REPARSE_POINT` describes the final
        // component only, so opening the leaf alone would still have FOLLOWED a junction substituted
        // for `ProgramData` or for `ProjectOS`. Each level is therefore opened as custody in its own
        // right and its reparse attribute inspected.
        //
        // WHAT THE PER-LEVEL OPEN BUYS, STATED WITHOUT FLATTERY. It catches an ancestor that IS a
        // reparse point right now. It does NOT stop one being substituted mid-walk: the accepted
        // primitive opens every handle with `FILE_SHARE_DELETE`, so retaining these handles does not
        // block a delete or a rename, and claiming otherwise would be a guarantee this code cannot
        // keep. They are retained only so the walk reflects one moment rather than three.
        //
        // THE DECISIVE CHECK IS ELSEWHERE, and deliberately so: `settle` asks the already-open LEAF
        // handle where it actually lives and compares that against the composed path. A junction
        // followed at any level lands the object somewhere the composed path does not name, and that
        // remains true however the interleaving went — including when the attacker restores the
        // ancestor afterwards, because the handle has already resolved. Timing cannot be raced when
        // the question is about the outcome.
        let _held: Vec<WindowsRootCustody> = ancestors
            .iter()
            .map(|level| WindowsRootCustody::open(level).map_err(from_custody))
            .collect::<Result<_, _>>()?;
        let custody = WindowsRootCustody::open(&leaf).map_err(from_custody)?;
        let canonical = settle(&custody, &leaf)?;
        Ok(Self {
            canonical,
            custody,
            ancestors,
            composed: leaf,
        })
    }

    /// Non-Windows builds have no Known Folder and no handle-owned custody, so there is no root.
    ///
    /// # Errors
    /// Always [`TrustedRootRefusal::PlatformUnsupported`].
    #[cfg(not(windows))]
    pub fn resolve<S: InstallationAnchorSource>(_source: &S) -> Result<Self, TrustedRootRefusal> {
        Err(TrustedRootRefusal::PlatformUnsupported)
    }

    /// The canonical Host state root, in the ONE spelling every consumer will see.
    ///
    /// TWO EQUIVALENT ANCHOR SPELLINGS PRODUCE ONE ANSWER, because this derives from
    /// `GetFinalPathNameByHandleW`'s normalised path for the object actually opened rather than from
    /// the text that was composed to reach it.
    ///
    /// AND IT IS AN ORDINARY DRIVE-ROOTED PATH, never the verbatim `\\?\` form Windows returns. That
    /// distinction is load-bearing rather than cosmetic: the accepted `validate_local_root` rule the
    /// durable store applies REFUSES the verbatim form, so a root published in it would resolve
    /// perfectly and then be unusable. The settling step is documented in this crate's `canonical`
    /// module.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.canonical
    }

    /// Confirm the chain and the held object are still what resolution captured.
    ///
    /// Re-walks every composed level holding each open, asks custody to check BOTH the held handle
    /// AND that the original pathname still denotes that same object, and re-proves that the object
    /// still lives at the composed path. Detects replacement, redirection, a newly-introduced
    /// reparse point at any level, and identity drift.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first divergence. A failure never re-opens or replaces the
    /// held custody.
    pub fn revalidate(&self) -> Result<(), TrustedRootRefusal> {
        let _held: Vec<WindowsRootCustody> = self
            .ancestors
            .iter()
            .map(|level| WindowsRootCustody::open(level).map_err(from_custody))
            .collect::<Result<_, _>>()?;
        self.custody.revalidate().map_err(from_custody)?;
        // AND STILL WHERE IT WAS. Custody proves the object is unchanged; this proves the object has
        // not been made reachable from somewhere else in the meantime.
        let now = settle(&self.custody, &self.composed)?;
        if now != self.canonical {
            return Err(TrustedRootRefusal::RootRedirected);
        }
        Ok(())
    }
}
