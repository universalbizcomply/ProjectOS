//! THE PRODUCTION DRY RUN.
//!
//! CD-B4-INSTALLER-READINESS1A.
//!
//! This walks the real installer path as far as it can legitimately go: it resolves both approved
//! Known Folders read-only, derives the exact approved installation locations, verifies the packaged
//! artefact, and then stops at the frozen effect-authority gate.
//!
//! **It stops, and stopping is the correct result.** [`InstallationEffectAuthority::current`] is
//! `NotAuthorised`, so the dry run reports readiness and refuses. Nothing here creates a directory,
//! writes a record, applies an ACL, touches the registry or SCM, installs or starts a service,
//! elevates, or performs any protected effect.

use std::path::{Path, PathBuf};

use projectos_host_identity::canonical_record::EXPECTED_SERVICE_RELATIVE_PATH;
use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;

use crate::PlanRefusal;

/// Why the packaged artefact was not accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ArtefactRefusal {
    /// No file exists at the build-output location.
    Missing,
    /// The file name is not the frozen `ProjectOSHost.exe`.
    WrongName,
    /// The path is not a regular file.
    NotRegularFile,
    /// The artefact is inside a real production root. A dry run must never read an installed binary as
    /// if it were a build output, and must certainly never have put one there.
    InsideProductionRoot,
    /// The artefact is not beneath a build-output directory derived from committed source.
    NotBuildOutput,
}

/// Verified evidence that a packaged `ProjectOSHost.exe` exists, built from committed source.
///
/// Sealed: the private field means the only way to hold one is [`Self::from_build_output`], which
/// applies every check below.
#[derive(Debug)]
pub struct ArtefactEvidence {
    path: PathBuf,
}

impl ArtefactEvidence {
    /// Verify a build-output artefact.
    ///
    /// The path names a BUILD OUTPUT, never an installation destination — the installation location is
    /// derived internally and is never caller-supplied. The artefact is refused if it is missing, not a
    /// regular file, wrongly named, not under a `target` build directory, or inside a production root.
    ///
    /// # Errors
    /// [`ArtefactRefusal`] naming the first failed check.
    pub fn from_build_output(path: &Path) -> Result<Self, ArtefactRefusal> {
        let meta = std::fs::symlink_metadata(path).map_err(|_| ArtefactRefusal::Missing)?;
        if !meta.file_type().is_file() {
            return Err(ArtefactRefusal::NotRegularFile);
        }
        // The name comes from the frozen contract, so a differently named binary cannot pass as the
        // service artefact.
        if path.file_name().and_then(|n| n.to_str()) != Some(EXPECTED_SERVICE_RELATIVE_PATH) {
            return Err(ArtefactRefusal::WrongName);
        }
        let resolved = path.canonicalize().map_err(|_| ArtefactRefusal::Missing)?;
        // Built from committed source means it came out of a Cargo build directory, not an install.
        if !resolved.components().any(|c| c.as_os_str() == "target") {
            return Err(ArtefactRefusal::NotBuildOutput);
        }
        if is_inside_a_production_root(&resolved) {
            return Err(ArtefactRefusal::InsideProductionRoot);
        }
        Ok(Self { path: resolved })
    }

    /// The verified build-output path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Whether `candidate` sits inside either resolved production root. Read-only.
#[cfg(all(windows, feature = "installer-dry-run"))]
fn is_inside_a_production_root(candidate: &Path) -> bool {
    use projectos_windows_runtime_primitives::known_folder::{
        resolve_program_data, resolve_program_files,
    };
    [resolve_program_files(), resolve_program_data()]
        .into_iter()
        .flatten()
        .any(|root| candidate.starts_with(root))
}

/// Without the dry-run feature the production roots are not resolvable here, so the check fails
/// CLOSED: an artefact cannot be proven outside a production root, so it is treated as inside one.
#[cfg(not(all(windows, feature = "installer-dry-run")))]
fn is_inside_a_production_root(_candidate: &Path) -> bool {
    true
}

/// THE RELEASE MANIFEST.
///
/// One artefact, described canonically, so the same executable always yields the same digest on any
/// machine. The encoding is domain-separated and length-prefixed for the same reason the canonical
/// record encoding is: no field boundary can be forged by choosing a value that looks like a
/// separator.
///
/// The digest is the SHA-256 of those canonical bytes, computed with the SAME `sha256_hex` the
/// identity contract uses — this crate introduces no second hashing vocabulary.
#[derive(Debug)]
pub struct ReleaseManifest {
    canonical: Vec<u8>,
    digest: String,
}

/// The domain string. Changing it changes every digest, which is exactly what a schema change should
/// do.
const MANIFEST_DOMAIN: &str = "PROJECTOS:RELEASE-MANIFEST:V1";

impl ReleaseManifest {
    /// Build the manifest for a verified artefact.
    ///
    /// # Errors
    /// [`DryRunError::Artefact`] if the artefact bytes cannot be read.
    pub fn for_artefact(artefact: &ArtefactEvidence) -> Result<Self, DryRunError> {
        let bytes = std::fs::read(artefact.path())
            .map_err(|_| DryRunError::Artefact(ArtefactRefusal::Missing))?;
        let artefact_digest = projectos_host_identity::sha256_hex(&bytes);

        let mut canonical = Vec::new();
        put_field(&mut canonical, MANIFEST_DOMAIN);
        put_field(&mut canonical, "1");
        put_field(&mut canonical, EXPECTED_SERVICE_RELATIVE_PATH);
        put_field(&mut canonical, &artefact_digest);
        let digest = projectos_host_identity::sha256_hex(&canonical);
        Ok(Self { canonical, digest })
    }

    /// The canonical manifest bytes.
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical
    }

    /// The manifest digest as 64 lower-case hex characters.
    #[must_use]
    pub fn digest_hex(&self) -> &str {
        &self.digest
    }

    /// The digest as the writer's validated contract type, ready for an identity record.
    ///
    /// # Errors
    /// [`DryRunError::Artefact`] if the digest is not a valid release digest, which would mean the
    /// hash implementation changed shape.
    pub fn release_digest(
        &self,
    ) -> Result<
        projectos_host_canonical_installation_identity_writer::ReleaseManifestDigest,
        DryRunError,
    > {
        projectos_host_canonical_installation_identity_writer::ReleaseManifestDigest::parse(
            &self.digest,
        )
        .map_err(|_| DryRunError::Artefact(ArtefactRefusal::NotBuildOutput))
    }
}

/// Append one length-prefixed field.
fn put_field(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u64).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

/// Everything the dry run established before it stopped.
///
/// Non-`Clone` and carrying no write capability: it is a readiness report, not permission.
#[derive(Debug)]
pub struct DryRunReport {
    state_anchor_symbol: &'static str,
    install_anchor_symbol: &'static str,
    record_path: PathBuf,
    service_binary_path: PathBuf,
    artefact_path: PathBuf,
    release_manifest_digest: String,
    effect_authority: InstallationEffectAuthority,
    stopped_at: PlanRefusal,
}

impl DryRunReport {
    /// The symbolic label of the anchor production STATE is derived from.
    #[must_use]
    pub fn state_anchor_symbol(&self) -> &'static str {
        self.state_anchor_symbol
    }

    /// The symbolic label of the anchor the installed BINARY is derived from.
    #[must_use]
    pub fn install_anchor_symbol(&self) -> &'static str {
        self.install_anchor_symbol
    }

    /// The exact canonical identity record location this installation WOULD use. Derived, never
    /// created.
    #[must_use]
    pub fn record_path(&self) -> &Path {
        &self.record_path
    }

    /// The exact service-binary location this installation WOULD use. Derived, never created.
    #[must_use]
    pub fn service_binary_path(&self) -> &Path {
        &self.service_binary_path
    }

    /// The verified build-output artefact the installation would copy from.
    #[must_use]
    pub fn artefact_path(&self) -> &Path {
        &self.artefact_path
    }

    /// The deterministic release-manifest digest for the verified artefact.
    #[must_use]
    pub fn release_manifest_digest(&self) -> &str {
        &self.release_manifest_digest
    }

    /// The frozen effect authority the dry run stopped on.
    #[must_use]
    pub fn effect_authority(&self) -> InstallationEffectAuthority {
        self.effect_authority
    }

    /// The refusal the dry run ended with. Always [`PlanRefusal::ElevationAbsent`] while the frozen
    /// authority is `NotAuthorised`.
    #[must_use]
    pub fn stopped_at(&self) -> PlanRefusal {
        self.stopped_at
    }

    /// Whether every technical precondition the dry run can evaluate was satisfied, leaving ONLY the
    /// effect-authority gate. True here means "ready and correctly refused", never "may proceed".
    #[must_use]
    pub fn reached_effect_authority_gate(&self) -> bool {
        !self.effect_authority.is_authorised() && self.stopped_at == PlanRefusal::ElevationAbsent
    }
}

/// Why the dry run could not even reach the gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DryRunError {
    /// A Known Folder did not resolve, or a resolved root failed the boundary checks.
    AnchorUnresolved,
    /// A derived path escaped its approved root.
    PathEscapesApprovedRoot,
    /// A boundary is a reparse point.
    ReparsePointBoundary,
    /// The packaged artefact was refused.
    Artefact(ArtefactRefusal),
}

/// Run the production dry run.
///
/// Resolves both approved Known Folders read-only, derives the approved installation locations,
/// verifies the artefact, and then STOPS at the frozen effect-authority gate. It creates nothing,
/// writes nothing and starts nothing.
///
/// # Errors
/// [`DryRunError`] if the dry run could not reach the gate at all.
#[cfg(all(windows, feature = "installer-dry-run"))]
pub fn production_dry_run(artefact: &ArtefactEvidence) -> Result<DryRunReport, DryRunError> {
    use projectos_host_canonical_installation_identity_writer::{
        InstallerTarget, ResolvedInstallRoot, ResolvedProgramDataAnchor, WriteError,
    };
    use projectos_host_windows_activation_plan::root_plan::KnownFolderAnchor;

    let map = |e: WriteError| match e {
        WriteError::ReparsePointRefused => DryRunError::ReparsePointBoundary,
        WriteError::ContainmentRefused => DryRunError::PathEscapesApprovedRoot,
        _ => DryRunError::AnchorUnresolved,
    };

    // 1-2. Resolve and validate both approved anchors. Read-only; nothing is created.
    let state_anchor = ResolvedProgramDataAnchor::resolve_approved().map_err(map)?;
    let install_root = ResolvedInstallRoot::resolve_approved().map_err(map)?;

    // 3. Derive the exact approved locations from the frozen segments.
    let target = InstallerTarget::under_resolved_anchor(&state_anchor).map_err(map)?;
    let record_path = target.record_location();
    let service_binary_path = install_root.service_binary_path();

    // 4. The release manifest for the verified artefact. Deterministic, and validated by the writer's
    // own release-digest contract before it is carried.
    let manifest = ReleaseManifest::for_artefact(artefact)?;
    let _validated = manifest.release_digest()?;

    // 5. The FINAL pre-effect gate. The frozen authority refuses, so no write capability is issued and
    // no service step is reachable.
    let effect_authority = InstallationEffectAuthority::current();
    Ok(DryRunReport {
        state_anchor_symbol: KnownFolderAnchor::ProgramData.symbol(),
        install_anchor_symbol: KnownFolderAnchor::ProgramFiles.symbol(),
        record_path,
        service_binary_path,
        artefact_path: artefact.path().to_path_buf(),
        release_manifest_digest: manifest.digest_hex().to_string(),
        effect_authority,
        stopped_at: PlanRefusal::ElevationAbsent,
    })
}
