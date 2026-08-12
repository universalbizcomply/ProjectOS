//! THE governed ProjectOS system root, and the seam that supplies it.
//!
//! WHAT IT IS. A verified packaged application still has to know WHICH ProjectOS it is authorised to
//! operate. That is a third root, and it is not either of the other two: the APPLICATION INSTALL
//! ROOT is where the executable lives, the PACKAGED RUNTIME PAYLOAD ROOT is the closed subject the
//! trust manifest attests, and this is the ProjectOS SYSTEM root whose framework state the daemon
//! may read and write.
//!
//! WHAT IT IS NOT. It is not a product repository. The installed application is expected to govern
//! several registered projects over time, and binding it permanently to one checkout would make that
//! impossible. Project SELECTION happens above this root, through the canonical ProjectOS registry
//! that lives inside it. This type establishes the trusted system root and stops there.
//!
//! WHERE IT MAY NOT COME FROM, and there is no code path for any of them: `process.cwd()`, a
//! `bridge.config.json`, an environment variable, argv, a manifest field, the governed project
//! itself, or scanning for the first `.projectops` directory. Every one of those lets the thing
//! being governed choose its own governor. The root arrives through one seam or not at all.
//!
//! WHY PRODUCTION REFUSES TODAY. `InstalledSystemRoot` locates nothing. That is the honest state of
//! the machine, not a stub pretending to work: the approved location for installed ProjectOS state
//! is a Known Folder anchor that `canonical_record::symbolic_record_location` still expresses
//! SYMBOLICALLY, because no approved resolver exists and writing one would be installer work this
//! increment is not authorised to do. So a packaged run fails closed here — and it does NOT fall
//! back to development.
//!
//! WHY IT DEMANDS THE SEALED PROOF. `resolve_governed_system_root` takes a `&VerifiedPackagedIdentity`.
//! A governed root is a CONSEQUENCE of verified packaged identity, exactly as launch authority is:
//! there is no route to one that does not begin with a successful production-policy evaluation.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};

use projectos_shared_host_runtime::identity::packaged::VerifiedPackagedIdentity;

/// Private seal. A struct with a private field cannot be built outside the module that declares it,
/// so possessing a `GovernedSystemRoot` IS the evidence that one was resolved rather than asserted.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Seal;

/// The trusted ProjectOS system root this installation is authorised to operate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GovernedSystemRoot {
    path: PathBuf,
    _seal: Seal,
}

impl GovernedSystemRoot {
    /// The absolute system root. Read-only: there is no setter, so an authority that carries one
    /// cannot be edited afterwards into describing somewhere else.
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

/// Why a governed system root could not be established. Every variant is a refusal; none of them is
/// recoverable by looking somewhere else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GovernedRootRefusal {
    /// No approved resolver exists for the installed ProjectOS system location. The production
    /// reality until an installer writes one and a resolver is approved.
    NoApprovedResolver,
    /// The source produced a relative path. A relative system root is the ambient working directory
    /// wearing a different hat.
    NotAbsolute,
    /// The source produced a path that is not an existing directory.
    NotADirectory,
}

/// The seam that locates the installed ProjectOS system root.
///
/// It takes the application id so a source can never hand back the root belonging to some other
/// installed application, and it returns a path rather than a `GovernedSystemRoot` — validating and
/// sealing is this module's job, not the source's.
pub(crate) trait GovernedSystemRootSource {
    fn locate(&self, application_id: &str) -> Option<PathBuf>;
}

/// The PRODUCTION source. It locates nothing, because nothing approved exists to locate.
///
/// Deliberately not a lookup that happens to fail: there is no filesystem access here at all, so
/// there is no directory an attacker could create to make it succeed.
pub(crate) struct InstalledSystemRoot;

impl GovernedSystemRootSource for InstalledSystemRoot {
    fn locate(&self, _application_id: &str) -> Option<PathBuf> {
        None
    }
}

/// Establish the governed system root for a VERIFIED packaged identity.
///
/// The identity is required rather than merely convenient: a governed root is something a verified
/// installation HAS, and an unverified one must not be able to obtain by asking politely. The
/// application id used to query the seam comes from that identity, so a source cannot be induced to
/// answer for a different application.
pub(crate) fn resolve_governed_system_root(
    identity: &VerifiedPackagedIdentity,
    source: &dyn GovernedSystemRootSource,
) -> Result<GovernedSystemRoot, GovernedRootRefusal> {
    let Some(path) = source.locate(identity.application_id()) else {
        return Err(GovernedRootRefusal::NoApprovedResolver);
    };
    if !path.is_absolute() {
        return Err(GovernedRootRefusal::NotAbsolute);
    }
    if !path.is_dir() {
        return Err(GovernedRootRefusal::NotADirectory);
    }
    Ok(GovernedSystemRoot { path, _seal: Seal })
}

/// TEST/FIXTURE-ONLY source, so the boundary can be exercised without an installer.
///
/// Behind `test-fixtures`, which never ships: a normal build — default or release — compiles neither
/// this type nor any route to it, so a packaged artefact has no way to be handed a system root by a
/// fixture.
#[cfg(any(test, feature = "test-fixtures"))]
pub(crate) struct FixtureSystemRoot {
    pub(crate) application_id: String,
    pub(crate) root: PathBuf,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl GovernedSystemRootSource for FixtureSystemRoot {
    fn locate(&self, application_id: &str) -> Option<PathBuf> {
        // Even a fixture answers only for the application it was built for: a test that accidentally
        // proved cross-application resolution would be proving the wrong thing.
        (application_id == self.application_id).then(|| self.root.clone())
    }
}

/// Behind `test-fixtures` because minting a `VerifiedPackagedIdentity` requires the fixture surface,
/// which never ships. The production refusal is proved in `authority.rs`, where no identity is
/// needed to observe that packaged mode fails closed.
#[cfg(all(test, feature = "test-fixtures"))]
mod tests {
    use super::*;
    use projectos_shared_host_runtime::identity::packaged::InstallationModel;
    use projectos_shared_host_runtime::identity::packaged_fixture::test_only_verified_identity;

    fn identity(app: &str) -> VerifiedPackagedIdentity {
        test_only_verified_identity(
            app,
            "0.1.0",
            "projectos-signing-fixture",
            InstallationModel::PerMachine,
        )
    }

    /// PRODUCTION FAILS CLOSED. There is no approved resolver, so a packaged run cannot obtain a
    /// governed root at all — and it never silently becomes a development run.
    #[test]
    fn production_has_no_approved_resolver_and_refuses() {
        let got = resolve_governed_system_root(&identity("com.example.app"), &InstalledSystemRoot);
        assert_eq!(got, Err(GovernedRootRefusal::NoApprovedResolver));
    }

    #[test]
    fn a_relative_root_is_refused() {
        let src = FixtureSystemRoot {
            application_id: "com.example.app".into(),
            root: PathBuf::from("relative/system"),
        };
        assert_eq!(
            resolve_governed_system_root(&identity("com.example.app"), &src),
            Err(GovernedRootRefusal::NotAbsolute)
        );
    }

    #[test]
    fn a_path_that_is_not_a_directory_is_refused() {
        let src = FixtureSystemRoot {
            application_id: "com.example.app".into(),
            root: std::env::temp_dir().join("projectos-governed-root-absent"),
        };
        let _ = std::fs::remove_dir_all(&src.root);
        assert_eq!(
            resolve_governed_system_root(&identity("com.example.app"), &src),
            Err(GovernedRootRefusal::NotADirectory)
        );
    }

    /// A source built for another application cannot supply this one's root.
    #[test]
    fn a_source_for_another_application_does_not_answer() {
        let root = std::env::temp_dir().join("projectos-governed-root-other");
        std::fs::create_dir_all(&root).unwrap();
        let src = FixtureSystemRoot {
            application_id: "com.example.other".into(),
            root,
        };
        assert_eq!(
            resolve_governed_system_root(&identity("com.example.app"), &src),
            Err(GovernedRootRefusal::NoApprovedResolver)
        );
    }

    /// The positive control: a real absolute directory, for the right application, seals.
    #[test]
    fn a_real_absolute_directory_for_this_application_resolves() {
        let root = std::env::temp_dir().join("projectos-governed-root-ok");
        std::fs::create_dir_all(&root).unwrap();
        let src = FixtureSystemRoot {
            application_id: "com.example.app".into(),
            root: root.clone(),
        };
        let got = resolve_governed_system_root(&identity("com.example.app"), &src).unwrap();
        assert_eq!(got.path(), root.as_path());
    }
}
