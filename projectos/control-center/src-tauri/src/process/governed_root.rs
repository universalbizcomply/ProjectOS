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
//! WHERE IT DOES COME FROM. `InstalledSystemRoot` reads the canonical installed-application record
//! that an installer writes to ONE ProgramData path — located through `SHGetKnownFolderPath`, never
//! `%ProgramData%` — and verified before any field is believed. The record must name the install
//! root it was written for, and that is compared against where this executable actually is, so a
//! record beside a copied tree describes a different installation and is refused.
//!
//! On a machine with no such record, production still fails closed here, and it does NOT fall back
//! to development.
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

/// The PRODUCTION source: the governed root named by the INSTALLER'S OWN RECORD.
///
/// It used to locate nothing, because no approved resolver existed. One does now — the canonical
/// installed-application record at a single ProgramData path, whose location comes from
/// `SHGetKnownFolderPath` rather than `%ProgramData%`, and whose contents are verified before any
/// field is believed.
///
/// WHY THIS IS NOT "A FILE DECIDES". The record must name the install root it was written for, and
/// that is compared against where this executable ACTUALLY is. So a record dropped beside a copied
/// tree describes a different installation and is refused; the only record that can name a governed
/// root is one written for the installation that is running. A whole-record digest makes editing one
/// field detectable, and unknown fields are refused rather than ignored.
///
/// It still cannot confer trust. The governed root it yields is passed to
/// `resolve_governed_system_root`, which demands the sealed `VerifiedPackagedIdentity` — so an
/// installer record without a verified application is worth nothing at all.
pub(crate) struct InstalledSystemRoot<'a> {
    /// The installed application version this build expects the record to describe.
    pub(crate) application_version: &'a str,
    /// Where this executable actually is, derived from `current_exe()` by the caller.
    pub(crate) observed_install_root: &'a std::path::Path,
}

impl GovernedSystemRootSource for InstalledSystemRoot<'_> {
    fn locate(&self, application_id: &str) -> Option<PathBuf> {
        #[cfg(windows)]
        {
            projectos_shared_host_runtime::identity::packaged::read_canonical_application_record(
                application_id,
                self.application_version,
                self.observed_install_root,
            )
            .ok()
            .map(|verified| verified.governed_system_root().to_path_buf())
        }
        #[cfg(not(windows))]
        {
            let _ = application_id;
            None
        }
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

    /// PRODUCTION FAILS CLOSED ON THIS MACHINE. No installer has written a canonical record for an
    /// installation rooted at this test binary's directory, so the production source yields nothing
    /// and a packaged run obtains no governed root — and never silently becomes a development run.
    ///
    /// This is a real exercise of the production path, not a stub: it resolves ProgramData through
    /// the Known Folder API and looks for the one canonical record. Nothing is written.
    #[test]
    fn production_refuses_without_an_installer_record_for_this_installation() {
        let here = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let got = resolve_governed_system_root(
            &identity("com.example.app"),
            &InstalledSystemRoot {
                application_version: "0.0.0-not-installed",
                observed_install_root: &here,
            },
        );
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
