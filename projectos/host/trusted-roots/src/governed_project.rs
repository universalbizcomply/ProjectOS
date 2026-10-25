//! A2 — THE GOVERNED PROJECT ROOT: the ONE repository this installation may govern for a project.
//!
//! ## The question this answers
//!
//! "Which repository root holds the `.projectops/gatekeeper-ledger.json` that is the canonical
//! budget truth for THIS project?" It is not the same question as "where does the Host keep its own
//! state", and this module deliberately cannot answer that one — see [`crate::host_state`].
//!
//! ## The authority, in one line
//!
//! The canonical installed-project registry, which lives beside the installation's other
//! machine-local records and is the only thing in ProjectOS that may say where a governed project is.
//!
//! ## What the registry has already decided before this module sees a path
//!
//! The accepted registry refuses a root that is relative, that contains traversal, that is not an
//! existing directory, that carries no `.git` marker, that IS a reparse point (root or marker), that
//! carries no readable `.projectops/project-config.json`, or whose configuration names a DIFFERENT
//! project than the entry claims. None of that is re-implemented here. What this module adds is
//! selection by an exact id, handle-owned custody of the selected root, and the sealing that makes
//! the result unforgeable.
//!
//! ## Why a project id and not a path
//!
//! A path parameter would be caller path authority wearing a different name. An id is a SELECTOR:
//! the registry decides whether it is registered at all, and which single root it denotes. An id
//! that is not in the registry refuses; there is no nearest match, no first `.projectops` found by
//! scanning, and no default project.
//!
//! ## Project and repository crossover
//!
//! Two different projects cannot reach one root, because the registry refuses a duplicated
//! repository root. One project cannot reach another's root, because selection is by exact id and
//! the entry's root is cross-checked against the repository's own `projectId`. A repository that is
//! not a git repository at all is refused for its missing marker.

use std::path::{Path, PathBuf};

use projectos_host_windows_root_custody::WindowsRootCustody;

use crate::canonical::settle;
use crate::refusal::{from_custody, TrustedRootRefusal};
use crate::source::RegisteredProjectSource;

/// THE GOVERNED PROJECT ROOT for one attested project, resolved and sealed.
///
/// ## It is a capability, not a path
///
/// Every field is private and there is no constructor that takes a path, in any build. Possessing
/// one IS the evidence that the canonical registry carried this exact project id, that the entry it
/// named survived every attestation rule, and that a handle to the resulting directory is held.
///
/// ## It carries the id it was resolved for
///
/// Not decoration: a governed root with no identity is a directory, and the whole point of this type
/// is that it is a directory the installation attested FOR A NAMED PROJECT. Anything that later
/// composes a ledger transaction can state which project it is transacting for without having to be
/// told a second time — and without the two answers being able to disagree.
///
/// ## Not `Clone`, and not convertible
///
/// Same reasoning as the Host state root, and additionally: there is no route between the two types
/// in either direction. Swapping them is a compile error rather than a runtime check.
pub struct TrustedGovernedProjectRoot {
    /// The canonical path derived FROM the held handle — one spelling, whatever the registry's was.
    canonical: PathBuf,
    /// The project id this root was attested for.
    project_id: String,
    /// The root exactly as the canonical registry spelled it — what the installation SAYS it is.
    ///
    /// Kept because the redirection check compares where the object actually lives against where it
    /// was registered to live, and revalidation has to be able to ask that question again.
    registered: PathBuf,
    /// The retained handle. Dropping this value closes it; nothing else can.
    custody: WindowsRootCustody,
}

impl core::fmt::Debug for TrustedGovernedProjectRoot {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // The PROJECT ID is not private machine identity — it is the registry's own public selector,
        // and a report that cannot say which project refused is a report nobody can act on. The PATH
        // is redacted, exactly as the custody primitive redacts it.
        f.debug_struct("TrustedGovernedProjectRoot")
            .field("project_id", &self.project_id)
            .field("path", &"redacted")
            .finish()
    }
}

impl TrustedGovernedProjectRoot {
    /// Resolve the governed project root for one exact project id.
    ///
    /// The source is SEALED, so the only registries reachable are the canonical installed-project
    /// registry and — in a fixture graph that no shipped build compiles — a document a test owns,
    /// validated by the same real validator.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first failed check. There is no fallback path.
    pub fn resolve<S: RegisteredProjectSource>(
        source: &S,
        project_id: &str,
    ) -> Result<Self, TrustedRootRefusal> {
        let registered = source.repository_root(project_id)?;

        // CUSTODY ON TOP OF ATTESTATION, not instead of it. The registry has already refused a
        // reparse point at this path; taking a handle adds the thing a one-shot check cannot give —
        // a captured object identity that `revalidate` can compare against later, and a canonical
        // spelling that does not depend on how the registry file happened to spell the root.
        let custody = WindowsRootCustody::open(&registered).map_err(from_custody)?;
        // AND IT MUST LIVE WHERE THE REGISTRY SAID. The registry refuses a reparse point AT the
        // registered root, but an ANCESTOR of it is followed silently — so a registered
        // `C:\dev\repo` whose `C:\dev` is a junction is a repository whoever controls that junction
        // chooses. Settling compares where the object actually lives against the registered
        // spelling, so that is a refusal rather than a substitution.
        let canonical = settle(&custody, &registered)?;
        Ok(Self {
            canonical,
            project_id: project_id.to_string(),
            registered,
            custody,
        })
    }

    /// The canonical governed project root, in the ONE spelling every consumer will see.
    ///
    /// Derived from the held handle rather than from however the registry file spelled the root, and
    /// settled into an ordinary drive-rooted path rather than the verbatim `\\?\` form — which the
    /// canonical ledger's own path rules require. See this crate's `canonical` module.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.canonical
    }

    /// The project id this root was attested for.
    #[must_use]
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// Confirm the held object is still what resolution captured, and still where it was registered.
    ///
    /// # Errors
    /// [`TrustedRootRefusal`] naming the first divergence.
    pub fn revalidate(&self) -> Result<(), TrustedRootRefusal> {
        self.custody.revalidate().map_err(from_custody)?;
        let now = settle(&self.custody, &self.registered)?;
        if now != self.canonical {
            return Err(TrustedRootRefusal::RootRedirected);
        }
        Ok(())
    }
}
