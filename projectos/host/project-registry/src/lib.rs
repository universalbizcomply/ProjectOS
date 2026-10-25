//! THE CANONICAL INSTALLED-PROJECT REGISTRY (V1).
//!
//! WHAT IT IS. One versioned file of protected machine-local configuration, beside the two records
//! the installation directory already holds:
//!
//! ```text
//! <ProgramData>\ProjectOS\host\installation\identity.v1.json     the host service's identity
//! <ProgramData>\ProjectOS\host\installation\application.v1.json  the installed application record
//! <ProgramData>\ProjectOS\host\installation\projects.v1.json     THIS — which projects are installed
//! ```
//!
//! WHAT IT IS NOT. It is not part of the signed release manifest, and nothing here may describe it
//! as signed. Its protection is the protected installation directory it lives in, which on a real
//! installation grants `NT SERVICE\ProjectOSHost`, `BUILTIN\Administrators` and `NT AUTHORITY\SYSTEM`
//! full control and grants ordinary users NOTHING — so a governed repository, and the user account
//! that owns it, cannot write it. It is also not evidence: an entry says where a project is, never
//! that the project, its plan, its code or its owner were verified.
//!
//! WHY A REGISTRY AT ALL. The installed application governs several projects over time.
//! `governed_root.rs` establishes the ProjectOS SYSTEM root and deliberately stops there; project
//! SELECTION happens above it, and this is what selection selects from. Reading a project from the
//! registry is the ONLY way a root reaches the daemon: not `process.cwd()`, not `bridge.config.json`
//! in a packaged build, not an environment variable, not argv, not a manifest field, not the governed
//! project itself, and not by scanning for the first `.projectops` directory.
//!
//! FAIL CLOSED, ALWAYS. A registry that is missing, unreadable, malformed, self-contradictory or
//! internally duplicated yields NO projects. There is no fallback to the working directory, to the
//! environment, to argv, to repository scanning or to development configuration — not because a check
//! rejects them, but because no function here takes one as an input.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C (installed-project registry).

#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

// The frozen path vocabulary. Imported from the canonical record contract so this crate spells no
// segment of its own — two spellings of one location drift, and the day they do, one writer and one
// reader stop agreeing about where the truth lives.
use projectos_host_identity::canonical_record::{
    EXPECTED_PRODUCT, HOST_STATE_DIRECTORY_SEGMENT, RECORD_SUBDIRECTORY,
};

/// The registry's file name inside the installation subtree. Distinct from the two records already
/// there: they describe the installation, this describes what the installation may govern.
pub const REGISTRY_FILE_NAME: &str = "projects.v1.json";

/// The only supported schema version. There is no permissive "newer than I know" branch.
pub const REGISTRY_SCHEMA_VERSION: u32 = 1;

/// Upper bound on registered projects. Bounds untrusted file content; not a security guarantee.
pub const MAX_PROJECTS: usize = 64;

/// Upper bound on permitted environments per project.
pub const MAX_ENVIRONMENTS: usize = 8;

/// Upper bound on a repository-root field, in bytes.
pub const MAX_ROOT_LEN: usize = 512;

/// Upper bound on an identifier, in bytes.
///
/// 256 deliberately, matching `projectos_trust_contract::MAX_ID_LEN`. A longer id would validate
/// here and then be unrepresentable as a `ProjectId` through the accepted seam — a project that
/// exists and can never be looked up.
pub const MAX_ID_LEN: usize = 256;

/// The CLOSED set of environment names a registry entry may permit.
///
/// A closed set rather than free text: an environment name that nothing recognises is not a policy,
/// it is a typo that silently permits nothing or — worse, if the comparison were ever loosened —
/// everything. `production` is representable so a registry can state that a project genuinely has
/// one; whether work may proceed there is a separate question answered by `production_frozen`.
pub const PERMITTED_ENVIRONMENT_NAMES: [&str; 3] = ["development", "staging", "production"];

/// The project's own configuration file, relative to its repository root.
const PROJECT_CONFIG_RELATIVE: [&str; 2] = [".projectops", "project-config.json"];

/// The marker that makes a directory a git repository. A file in a linked worktree, a directory in
/// an ordinary clone — so existence is the test, never "is a directory".
const GIT_MARKER: &str = ".git";

/// Why the registry, or one entry in it, was refused. Every variant is a refusal; none of them is
/// recoverable by looking somewhere else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RegistryRefusal {
    /// ProgramData itself could not be resolved, so no canonical location exists.
    AnchorUnresolved,
    /// No registry file at the one canonical path.
    Missing,
    /// The registry exists but its bytes could not be read.
    Unreadable,
    /// Not a well-formed registry — bad JSON, or a field this schema does not define.
    Malformed,
    /// A schema version this build does not implement.
    UnsupportedVersion,
    /// More projects than the bound allows.
    TooManyProjects,
    /// A required field was blank, over-long, or carried control/whitespace characters.
    InvalidField,
    /// Two entries claim the same project id.
    DuplicateProjectId,
    /// Two entries claim the same repository root.
    DuplicateRepositoryRoot,
    /// A repository root that is not absolute. A relative root is the ambient working directory
    /// wearing a different hat.
    RootNotAbsolute,
    /// A repository root containing traversal.
    RootTraversal,
    /// A repository root that is not an existing directory.
    RootNotADirectory,
    /// The repository root carries no `.git`, so it is not a repository.
    GitMarkerMissing,
    /// The repository root, or its `.git` marker, is a reparse point. A registered root that can be
    /// re-aimed by whoever can write its parent directory is not a fixed location.
    ReparsePointRefused,
    /// The repository root carries no readable `.projectops/project-config.json`, so ProjectOS is
    /// not installed into it.
    ProjectConfigMissing,
    /// The project configuration is not a JSON object, or carries no usable `projectId`.
    ProjectConfigMalformed,
    /// The registry and the project's own configuration name different projects. The registry does
    /// not win: a disagreement about identity is refused.
    ProjectIdMismatch,
    /// The permitted-environment list is empty, over-long, duplicated, or names something outside
    /// [`PERMITTED_ENVIRONMENT_NAMES`].
    EnvironmentPolicyInvalid,
}

/// One entry exactly as the registry file carries it. Plain data with NO authority: holding one
/// proves nothing until [`validate_registry_bytes`] accepts it.
///
/// `deny_unknown_fields` so an unexpected key is refused rather than ignored — a reader that skips
/// fields it does not understand will happily accept a record written for something else.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisteredProjectV1 {
    /// The stable project identifier. Must equal the `projectId` in the project's own configuration.
    pub project_id: String,
    /// The absolute canonical repository root.
    pub repository_root: String,
    /// The environments this project may be operated in. Closed vocabulary; see
    /// [`PERMITTED_ENVIRONMENT_NAMES`].
    pub permitted_environments: Vec<String>,
    /// Whether production work is frozen for this project.
    pub production_frozen: bool,
}

/// The registry file. Only the information required to identify and validate installed projects —
/// no display preferences, no per-project settings, no second configuration system.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectsRegistryV1 {
    /// Must equal [`REGISTRY_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// The registered projects. May be empty: an installation that governs nothing yet is a valid
    /// state, and it offers nothing, which is the correct behaviour rather than a defect.
    pub projects: Vec<RegisteredProjectV1>,
}

/// A registered project that passed EVERY check, including the ones that needed the filesystem.
///
/// Private fields and no public constructor: holding one is the evidence that a registry entry was
/// validated against a real repository, not merely parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProject {
    project_id: String,
    project_name: String,
    repository_root: PathBuf,
    permitted_environments: Vec<String>,
    production_frozen: bool,
}

impl ValidatedProject {
    /// The stable project id. The ONLY thing a selector ever submits.
    #[must_use]
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// The project's display name, taken from its own configuration. Falls back to the id when the
    /// configuration names none, so a selector never has to invent one.
    #[must_use]
    pub fn project_name(&self) -> &str {
        &self.project_name
    }

    /// The validated absolute repository root. Read-only: there is no setter, so a caller holding a
    /// validated project cannot edit it afterwards into describing somewhere else.
    #[must_use]
    pub fn repository_root(&self) -> &Path {
        &self.repository_root
    }

    /// The permitted environments, in registry order.
    #[must_use]
    pub fn permitted_environments(&self) -> &[String] {
        &self.permitted_environments
    }

    /// Whether production work is frozen.
    ///
    /// A FAIL-CLOSED UNION of the registry entry and the project's own `productionFreeze`. Neither
    /// source can unfreeze the other: a registry that says `false` beside a repository that says
    /// `true` yields frozen, and so does the reverse. There is deliberately no "the registry wins"
    /// rule, because the safe answer to two sources disagreeing about a freeze is the frozen one.
    #[must_use]
    pub fn is_production_frozen(&self) -> bool {
        self.production_frozen
    }
}

/// The validated registry. Sealed for the same reason [`ValidatedProject`] is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedProjectRegistry {
    projects: Vec<ValidatedProject>,
}

impl ValidatedProjectRegistry {
    /// Every validated project, in registry order.
    #[must_use]
    pub fn projects(&self) -> &[ValidatedProject] {
        &self.projects
    }

    /// The project with this id, if it is registered and valid.
    #[must_use]
    pub fn project(&self, project_id: &str) -> Option<&ValidatedProject> {
        self.projects.iter().find(|p| p.project_id == project_id)
    }

    /// The verified repository bound to a project, if registered.
    ///
    /// The shape of `ProjectRegistryReader::repository_for`, answered from validated state. A
    /// project id resolves to its registered root or to nothing at all; there is no second lookup,
    /// no nearest match and no search.
    #[must_use]
    pub fn repository_for(&self, project_id: &str) -> Option<&Path> {
        self.project(project_id)
            .map(ValidatedProject::repository_root)
    }

    /// Whether an environment is permitted for a project. An unregistered project permits nothing.
    #[must_use]
    pub fn environment_allowed(&self, project_id: &str, environment: &str) -> bool {
        self.project(project_id)
            .is_some_and(|p| p.permitted_environments.iter().any(|e| e == environment))
    }

    /// Whether a project is production-frozen. An unregistered project is frozen: the fail-closed
    /// answer to "may production work proceed for something I have never heard of" is no.
    #[must_use]
    pub fn is_production_frozen(&self, project_id: &str) -> bool {
        self.project(project_id)
            .is_none_or(ValidatedProject::is_production_frozen)
    }
}

/// The filesystem facts validation needs. A seam, so the whole boundary is exercisable without a
/// real machine layout — and so this crate reads exactly three things and nothing else.
pub trait RegistryFacts {
    /// Whether the path is an existing directory.
    fn is_dir(&self, path: &Path) -> bool;
    /// Whether the path exists at all (file, directory or reparse point).
    fn exists(&self, path: &Path) -> bool;
    /// Whether the path IS a reparse point (symlink, junction, mount point) — checked WITHOUT
    /// following it.
    fn is_reparse_point(&self, path: &Path) -> bool;
    /// The file's bytes, or `None` if it cannot be read.
    fn read_file(&self, path: &Path) -> Option<Vec<u8>>;
}

/// The PRODUCTION facts source: the real filesystem, through `std::fs` and nothing else.
pub struct RealRegistryFacts;

impl RegistryFacts for RealRegistryFacts {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn exists(&self, path: &Path) -> bool {
        path.symlink_metadata().is_ok()
    }
    fn is_reparse_point(&self, path: &Path) -> bool {
        // `symlink_metadata` does not follow the link, so this describes the path itself rather than
        // whatever it points at — which is the whole question being asked.
        path.symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink())
    }
    fn read_file(&self, path: &Path) -> Option<Vec<u8>> {
        std::fs::read(path).ok()
    }
}

/// A bounded identifier: leading alphanumeric, then alphanumerics and `. _ : -`, within bounds.
///
/// DELIBERATELY THE SAME SHAPE the governed-command channel accepts (`governedCommands.ts`'s
/// `ID_PATTERN`). Two layers disagreeing about what an identifier is produces a project that appears
/// in the selector and can never be selected — a fail-closed dead end rather than a vulnerability,
/// but a dead end nonetheless. The leading-alphanumeric anchor is what stops `--force` and `-f` being
/// valid identifiers.
fn is_valid_token(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    s.len() <= MAX_ID_LEN
        && first.is_ascii_alphanumeric()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// The two facts a project's own configuration contributes: its identity and its display name, plus
/// whether it declares its own production freeze.
struct ProjectConfigFacts {
    project_id: String,
    project_name: String,
    production_freeze: bool,
}

/// Read and minimally validate `.projectops/project-config.json`.
///
/// DELIBERATELY MINIMAL. The project configuration has a full schema, validated by the canonical
/// project-config validator; re-implementing that here would be a second, drifting copy. What this
/// establishes is only what the registry needs to bind: that the file exists, parses as an object,
/// and names a usable project id.
fn read_project_config(
    facts: &dyn RegistryFacts,
    root: &Path,
) -> Result<ProjectConfigFacts, RegistryRefusal> {
    let mut path = root.to_path_buf();
    for segment in PROJECT_CONFIG_RELATIVE {
        path.push(segment);
    }
    let raw = facts
        .read_file(&path)
        .ok_or(RegistryRefusal::ProjectConfigMissing)?;
    // A UTF-8 BOM is what Windows editors leave behind, and serde_json refuses it. Stripping the BOM
    // is not leniency about the schema: every other malformed byte still refuses.
    let text = raw.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&raw);
    let value: serde_json::Value =
        serde_json::from_slice(text).map_err(|_| RegistryRefusal::ProjectConfigMalformed)?;
    let object = value
        .as_object()
        .ok_or(RegistryRefusal::ProjectConfigMalformed)?;
    let project_id = object
        .get("projectId")
        .and_then(serde_json::Value::as_str)
        .ok_or(RegistryRefusal::ProjectConfigMalformed)?
        .to_string();
    if !is_valid_token(&project_id) {
        return Err(RegistryRefusal::ProjectConfigMalformed);
    }
    let project_name = object
        .get("projectName")
        .and_then(serde_json::Value::as_str)
        .filter(|n| !n.trim().is_empty() && n.len() <= MAX_ROOT_LEN)
        .unwrap_or(&project_id)
        .to_string();
    Ok(ProjectConfigFacts {
        project_id,
        project_name,
        production_freeze: object.get("productionFreeze") == Some(&serde_json::Value::Bool(true)),
    })
}

/// Validate the environment policy: non-empty, bounded, unique, and entirely inside the closed set.
fn validate_environments(environments: &[String]) -> Result<(), RegistryRefusal> {
    if environments.is_empty() || environments.len() > MAX_ENVIRONMENTS {
        return Err(RegistryRefusal::EnvironmentPolicyInvalid);
    }
    let mut seen = BTreeSet::new();
    for environment in environments {
        if !PERMITTED_ENVIRONMENT_NAMES.contains(&environment.as_str()) {
            return Err(RegistryRefusal::EnvironmentPolicyInvalid);
        }
        if !seen.insert(environment.as_str()) {
            return Err(RegistryRefusal::EnvironmentPolicyInvalid);
        }
    }
    Ok(())
}

/// Normalise a root for the duplicate comparison: unify separators, drop a trailing separator, and
/// lower-case. Windows spells the same directory several ways and two entries that differ only in
/// spelling are still the same root.
fn normalise_root(path: &Path) -> String {
    let text = path.to_string_lossy();
    let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
    // Trailing spaces and dots are stripped as well as separators. Win32 silently discards them from
    // a path component when there is no `\\?\` prefix, so `C:\dev\X` and `C:\dev\X ` are the SAME
    // directory on disk — and two entries that resolve to one directory must collide here, or the
    // duplicate-root refusal is evadable by typing a space.
    text.replace('/', "\\")
        .trim()
        .trim_end_matches(['\\', ' ', '.'])
        .to_lowercase()
}

/// Validate one entry against the filesystem and the project's own configuration.
fn validate_entry(
    facts: &dyn RegistryFacts,
    entry: &RegisteredProjectV1,
) -> Result<ValidatedProject, RegistryRefusal> {
    if !is_valid_token(&entry.project_id) {
        return Err(RegistryRefusal::InvalidField);
    }
    if entry.repository_root.trim().is_empty() || entry.repository_root.len() > MAX_ROOT_LEN {
        return Err(RegistryRefusal::InvalidField);
    }
    validate_environments(&entry.permitted_environments)?;

    let root = PathBuf::from(&entry.repository_root);
    // ABSOLUTE, not "absolute and local". A UNC root is deliberately IN SCOPE: unlike the packaged
    // Git resolver — which refuses a network root because it decides which executable a machine-wide
    // installation runs — this decides which repository the owner is looking at, and a project
    // legitimately living on a network share is a configuration to support rather than to refuse.
    // The protection for both is the same: the entry is in a registry only an elevated principal can
    // write.
    if !root.is_absolute() {
        return Err(RegistryRefusal::RootNotAbsolute);
    }
    // Textual, before the filesystem is touched: a traversing root is refused as written rather than
    // canonicalised into something that happens to exist.
    if entry
        .repository_root
        .split(['\\', '/'])
        .any(|segment| segment == "..")
    {
        return Err(RegistryRefusal::RootTraversal);
    }
    // The reparse check comes FIRST, before anything follows the path. A registered root that is a
    // junction is a root somebody else can re-aim: every later check would then describe whatever it
    // currently points at, which is not the directory that was registered.
    if facts.is_reparse_point(&root) {
        return Err(RegistryRefusal::ReparsePointRefused);
    }
    if !facts.is_dir(&root) {
        return Err(RegistryRefusal::RootNotADirectory);
    }
    let git_marker = root.join(GIT_MARKER);
    if !facts.exists(&git_marker) {
        return Err(RegistryRefusal::GitMarkerMissing);
    }
    if facts.is_reparse_point(&git_marker) {
        return Err(RegistryRefusal::ReparsePointRefused);
    }

    let config = read_project_config(facts, &root)?;
    // THE BINDING CHECK. An entry may not rename a project: if the registry and the repository
    // disagree about identity, neither is believed.
    if config.project_id != entry.project_id {
        return Err(RegistryRefusal::ProjectIdMismatch);
    }

    Ok(ValidatedProject {
        project_id: entry.project_id.clone(),
        project_name: config.project_name,
        repository_root: root,
        permitted_environments: entry.permitted_environments.clone(),
        // The fail-closed union — see `ValidatedProject::is_production_frozen`.
        production_frozen: entry.production_frozen || config.production_freeze,
    })
}

/// Parse and validate raw registry bytes.
///
/// Ordered so the most specific refusal wins, and so nothing touches the filesystem until the shape,
/// the version and the internal uniqueness of the document are settled. The FIRST failure wins, and
/// ONE bad entry refuses the WHOLE registry: a partially-honoured registry would silently govern a
/// different set of projects than the file describes, which is worse than governing none.
///
/// # Errors
/// [`RegistryRefusal`] naming the first failed check.
pub fn validate_registry_bytes(
    raw: &[u8],
    facts: &dyn RegistryFacts,
) -> Result<ValidatedProjectRegistry, RegistryRefusal> {
    let registry = parse_registry_document(raw)?;
    let mut projects = Vec::with_capacity(registry.projects.len());
    for entry in &registry.projects {
        projects.push(validate_entry(facts, entry)?);
    }
    Ok(ValidatedProjectRegistry { projects })
}

/// The DOCUMENT half of validation: shape, version, bounds and internal uniqueness. It touches no
/// filesystem, so it answers "is this a well-formed registry" separately from "does it describe
/// repositories that are actually there" — which lets registration report a conflict as a conflict
/// instead of as a filesystem problem.
fn parse_registry_document(raw: &[u8]) -> Result<ProjectsRegistryV1, RegistryRefusal> {
    let registry: ProjectsRegistryV1 =
        serde_json::from_slice(raw).map_err(|_| RegistryRefusal::Malformed)?;
    if registry.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err(RegistryRefusal::UnsupportedVersion);
    }
    if registry.projects.len() > MAX_PROJECTS {
        return Err(RegistryRefusal::TooManyProjects);
    }
    let mut ids = BTreeSet::new();
    let mut roots = BTreeSet::new();
    for entry in &registry.projects {
        if !ids.insert(entry.project_id.as_str()) {
            return Err(RegistryRefusal::DuplicateProjectId);
        }
        if !roots.insert(normalise_root(Path::new(&entry.repository_root))) {
            return Err(RegistryRefusal::DuplicateRepositoryRoot);
        }
    }
    Ok(registry)
}

/// THE one canonical registry path:
/// `<ProgramData>\ProjectOS\host\installation\projects.v1.json`.
///
/// ProgramData comes from `SHGetKnownFolderPath` through the shared primitive — never from
/// `%ProgramData%`, which is an environment variable and therefore something a caller can move. The
/// segments are the ones the two existing installation records already use, so there is one path
/// vocabulary rather than two.
///
/// # Errors
/// [`RegistryRefusal::AnchorUnresolved`] when ProgramData itself cannot be resolved.
#[cfg(windows)]
pub fn canonical_registry_path() -> Result<PathBuf, RegistryRefusal> {
    let program_data = projectos_windows_runtime_primitives::known_folder::resolve_program_data()
        .map_err(|_| RegistryRefusal::AnchorUnresolved)?;
    Ok(program_data
        .join(EXPECTED_PRODUCT)
        .join(HOST_STATE_DIRECTORY_SEGMENT)
        .join(RECORD_SUBDIRECTORY)
        .join(REGISTRY_FILE_NAME))
}

/// Non-Windows builds have no ProgramData and therefore no canonical registry.
///
/// # Errors
/// Always [`RegistryRefusal::AnchorUnresolved`].
#[cfg(not(windows))]
pub fn canonical_registry_path() -> Result<PathBuf, RegistryRefusal> {
    Err(RegistryRefusal::AnchorUnresolved)
}

/// Read and validate the canonical registry for this machine.
///
/// The whole input surface is the canonical path: no environment variable, no argv, no manifest
/// field and no caller-supplied path, so a registry injected by any of those is not refused — it is
/// unrepresentable.
///
/// # Errors
/// [`RegistryRefusal`] naming the first failed check.
pub fn read_canonical_registry(
    facts: &dyn RegistryFacts,
) -> Result<ValidatedProjectRegistry, RegistryRefusal> {
    let path = canonical_registry_path()?;
    let raw = match facts.read_file(&path) {
        Some(raw) => raw,
        // ABSENT and UNREADABLE are different situations and only one of them suggests somebody is
        // trying something: no registry means nothing has been registered yet, while a registry that
        // exists and cannot be read means the file or its permissions are wrong. Both fail closed;
        // collapsing them would send an administrator to look for a file that is right there.
        None if facts.exists(&path) => return Err(RegistryRefusal::Unreadable),
        None => return Err(RegistryRefusal::Missing),
    };
    validate_registry_bytes(&raw, facts)
}

// -------------------------------------------------------------------------------------------
// REGISTRATION — the pure half.
//
// This plans a registration and produces the exact bytes a new registry file must contain. It does
// NOT publish them: writing into the protected installation directory requires rights an ordinary
// user does not have (the live directory grants NT SERVICE\ProjectOSHost, Administrators and SYSTEM
// full control and grants Users nothing), and applying or preserving the explicit file ACL is an
// elevated operation. Splitting the pure half out means the validation, the conflict rules and the
// canonical encoding are all provable here, and the elevated boundary that eventually publishes them
// adds no second copy of any of it.
// -------------------------------------------------------------------------------------------

/// The outcome of planning a registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistrationPlan {
    /// The project is not registered yet; these are the exact bytes the registry must become.
    Register(Vec<u8>),
    /// An identical entry already exists. Nothing needs to change.
    AlreadyRegistered,
}

/// Why a registration was refused. Every variant leaves any existing registry untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RegistrationRefusal {
    /// The existing registry could not be read or validated. A registry that cannot be understood is
    /// never replaced: doing so would silently discard entries.
    ExistingRegistryUnusable(RegistryRefusal),
    /// The proposed entry did not pass validation.
    ProposedEntryInvalid(RegistryRefusal),
    /// The id is taken by an entry naming a different root.
    ConflictingProjectId,
    /// The root is taken by an entry with a different id.
    ConflictingRepositoryRoot,
    /// The id and root already match an entry, but the POLICY differs. Changing an existing
    /// project's environment policy or freeze state is not a registration, and this contract does
    /// not perform one — reporting it as an id conflict would be untrue.
    ConflictingPolicy,
    /// Adding this entry would exceed the bound.
    TooManyProjects,
}

/// Serialise a registry to canonical V1 JSON: UTF-8, no BOM, two-space indent, trailing newline,
/// fields in the frozen order.
///
/// Indented rather than compact, deliberately: this is machine-local CONFIGURATION an administrator
/// may have to read during an incident, not a digest-bound record whose bytes are compared. The
/// field order is fixed by the struct declaration, and `serde_json` preserves it, so the same
/// registry always serialises the same way.
#[must_use]
pub fn to_canonical_json(registry: &ProjectsRegistryV1) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(registry)
        .expect("ProjectsRegistryV1 is String/Vec/bool/u32 only and always serialises");
    bytes.push(b'\n');
    bytes
}

/// Plan the registration of one project.
///
/// `existing` is the current registry's bytes, or `None` when no registry exists yet. Every existing
/// valid entry is preserved verbatim; the proposed entry is appended. The proposed entry is
/// validated against the real repository BEFORE anything is produced, so a plan can never describe a
/// project that is not actually there.
///
/// # Errors
/// [`RegistrationRefusal`] naming the first failure.
pub fn plan_registration(
    existing: Option<&[u8]>,
    proposed: &RegisteredProjectV1,
    facts: &dyn RegistryFacts,
) -> Result<RegistrationPlan, RegistrationRefusal> {
    // 1. The existing DOCUMENT, as written. Shape, version, bounds and internal uniqueness only —
    //    an unusable registry is refused rather than rebuilt, because rebuilding it would silently
    //    drop the entries it could not parse.
    let mut registry = match existing {
        None => ProjectsRegistryV1 {
            schema_version: REGISTRY_SCHEMA_VERSION,
            projects: Vec::new(),
        },
        Some(raw) => {
            parse_registry_document(raw).map_err(RegistrationRefusal::ExistingRegistryUnusable)?
        }
    };

    // 2. Conflicts, decided against the document. Deliberately BEFORE the filesystem: a conflict is
    //    a conflict, and reporting it as "the repository looks wrong" would send someone to fix the
    //    wrong thing.
    let proposed_root = normalise_root(Path::new(&proposed.repository_root));
    for entry in &registry.projects {
        let same_id = entry.project_id == proposed.project_id;
        let same_root = normalise_root(Path::new(&entry.repository_root)) == proposed_root;
        match (same_id, same_root) {
            (true, true) if entry == proposed => return Ok(RegistrationPlan::AlreadyRegistered),
            // Same id AND same root, but a different policy. This is a POLICY CHANGE, not a
            // registration, and this contract does not perform one.
            (true, true) => return Err(RegistrationRefusal::ConflictingPolicy),
            (true, false) => return Err(RegistrationRefusal::ConflictingProjectId),
            (false, true) => return Err(RegistrationRefusal::ConflictingRepositoryRoot),
            (false, false) => {}
        }
    }
    if registry.projects.len() + 1 > MAX_PROJECTS {
        return Err(RegistrationRefusal::TooManyProjects);
    }

    // 3. VALIDATE BEFORE WRITING, and validate the WHOLE result — not just the new entry. Bytes are
    //    produced only if the registry they describe reads back as entirely valid, so a registration
    //    can never publish a document the reader would then refuse in full.
    registry.projects.push(proposed.clone());
    let bytes = to_canonical_json(&registry);
    match validate_registry_bytes(&bytes, facts) {
        Ok(_) => Ok(RegistrationPlan::Register(bytes)),
        // Something in the merged registry is invalid. The proposal is the only entry that was not
        // already there, so re-checking it alone says truthfully WHICH of the two failed instead of
        // blaming the caller's project for an entry that was already broken.
        Err(refusal) => Err(match validate_entry(facts, proposed) {
            Err(proposal_refusal) => RegistrationRefusal::ProposedEntryInvalid(proposal_refusal),
            Ok(_) => RegistrationRefusal::ExistingRegistryUnusable(refusal),
        }),
    }
}

// -------------------------------------------------------------------------------------------
// THE ACCEPTED SERVICE-PRIVATE SEAM.
//
// `projectos_host_core::storage::ProjectRegistryReader` is the contract the future Host Service
// reads a project registry through. Binding to it here proves the validated registry answers exactly
// that shape. It is feature-gated because the Control Centre — the only thing that reads the registry
// today — does not depend on `projectos-host-core`, and forcing that dependency into the desktop
// graph to satisfy a trait nothing in that graph consumes would be cost without a consumer.
// -------------------------------------------------------------------------------------------

#[cfg(feature = "host-core-binding")]
mod host_core_binding {
    use super::ValidatedProjectRegistry;
    use projectos_host_core::facts::RepositoryRef;
    use projectos_host_core::storage::ProjectRegistryReader;
    // Through core's own re-export, so this crate needs no direct dependency on the identifier crate
    // and cannot drift onto a different version of it.
    use projectos_host_core::{EnvironmentId, ProjectId};

    impl ProjectRegistryReader for ValidatedProjectRegistry {
        fn repository_for(&self, project: &ProjectId) -> Option<RepositoryRef> {
            Self::repository_for(self, project.as_str())
                .map(|root| RepositoryRef::new(root.to_string_lossy().to_string()))
        }

        fn environment_allowed(&self, project: &ProjectId, environment: &EnvironmentId) -> bool {
            Self::environment_allowed(self, project.as_str(), environment.as_str())
        }

        fn is_production_frozen(&self, project: &ProjectId) -> bool {
            Self::is_production_frozen(self, project.as_str())
        }
    }
}

#[cfg(test)]
mod tests;
