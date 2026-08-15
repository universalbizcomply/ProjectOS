//! The registry boundary, exercised entirely through the seam.
//!
//! No test here touches a real ProgramData, a real repository or a real installation: the filesystem
//! facts arrive through [`RegistryFacts`], so every refusal can be driven deliberately rather than
//! hoped for. The one test that DOES touch the machine reads the canonical path and asserts its
//! shape; it writes nothing.

use super::*;

const ROOT_A: &str = r"C:\dev\ProjectOS";
const ROOT_B: &str = r"C:\dev\DeadAisle";

/// A synthetic machine. Only what was explicitly placed on it exists.
#[derive(Default)]
struct FakeMachine {
    dirs: Vec<String>,
    files: Vec<String>,
    contents: Vec<(String, Vec<u8>)>,
    reparse_points: Vec<String>,
}

impl FakeMachine {
    /// A repository root carrying `.git` and a project configuration naming `project_id`.
    fn with_repository(mut self, root: &str, project_id: &str) -> Self {
        self.dirs.push(root.to_string());
        self.files.push(format!(r"{root}\.git"));
        let config = format!(
            r#"{{"projectId":"{project_id}","projectName":"{project_id} Display","productionFreeze":false}}"#
        );
        self.contents.push((
            format!(r"{root}\.projectops\project-config.json"),
            config.into_bytes(),
        ));
        self
    }

    /// Replace one file's bytes (or add it).
    fn with_file(mut self, path: &str, bytes: &[u8]) -> Self {
        self.contents
            .retain(|(existing, _)| !existing.eq_ignore_ascii_case(path));
        self.contents.push((path.to_string(), bytes.to_vec()));
        self
    }

    /// Mark a path as a reparse point (junction/symlink) without changing what it contains.
    fn with_reparse_point(mut self, path: &str) -> Self {
        self.reparse_points.push(path.to_string());
        self
    }

    /// Remove a path entirely, whatever kind it was.
    fn without(mut self, path: &str) -> Self {
        self.dirs.retain(|d| !d.eq_ignore_ascii_case(path));
        self.files.retain(|f| !f.eq_ignore_ascii_case(path));
        self.contents
            .retain(|(existing, _)| !existing.eq_ignore_ascii_case(path));
        self
    }

    fn key(path: &Path) -> String {
        path.to_string_lossy().replace('/', "\\").to_lowercase()
    }
}

impl RegistryFacts for FakeMachine {
    fn is_dir(&self, path: &Path) -> bool {
        let key = Self::key(path);
        self.dirs.iter().any(|d| d.to_lowercase() == key)
    }
    fn exists(&self, path: &Path) -> bool {
        let key = Self::key(path);
        self.dirs.iter().any(|d| d.to_lowercase() == key)
            || self.files.iter().any(|f| f.to_lowercase() == key)
            || self
                .contents
                .iter()
                .any(|(existing, _)| existing.to_lowercase() == key)
    }
    fn is_reparse_point(&self, path: &Path) -> bool {
        let key = Self::key(path);
        self.reparse_points.iter().any(|p| p.to_lowercase() == key)
    }
    fn read_file(&self, path: &Path) -> Option<Vec<u8>> {
        let key = Self::key(path);
        self.contents
            .iter()
            .find(|(existing, _)| existing.to_lowercase() == key)
            .map(|(_, bytes)| bytes.clone())
    }
}

fn machine() -> FakeMachine {
    FakeMachine::default()
        .with_repository(ROOT_A, "projectos")
        .with_repository(ROOT_B, "dead-aisle")
}

fn entry(project_id: &str, root: &str) -> RegisteredProjectV1 {
    RegisteredProjectV1 {
        project_id: project_id.to_string(),
        repository_root: root.to_string(),
        permitted_environments: vec!["development".into(), "staging".into()],
        production_frozen: true,
    }
}

fn registry_bytes(entries: &[RegisteredProjectV1]) -> Vec<u8> {
    to_canonical_json(&ProjectsRegistryV1 {
        schema_version: REGISTRY_SCHEMA_VERSION,
        projects: entries.to_vec(),
    })
}

// =============================================================================================
// [E1] A valid installed project is read and selectable.
// =============================================================================================

#[test]
fn e1_a_valid_installed_project_is_read_and_selectable() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A)]);
    let registry = validate_registry_bytes(&raw, &machine()).expect("a valid registry validates");
    assert_eq!(registry.projects().len(), 1);
    let project = registry.project("projectos").expect("selectable by id");
    assert_eq!(project.project_id(), "projectos");
    assert_eq!(project.project_name(), "projectos Display");
    assert_eq!(project.repository_root(), Path::new(ROOT_A));
}

// =============================================================================================
// [E2] A project id resolves ONLY to its registered root — never to another project's.
// =============================================================================================

#[test]
fn e2_a_project_id_resolves_only_to_its_registered_root() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A), entry("dead-aisle", ROOT_B)]);
    let registry = validate_registry_bytes(&raw, &machine()).expect("validates");
    assert_eq!(
        registry.repository_for("projectos"),
        Some(Path::new(ROOT_A))
    );
    assert_eq!(
        registry.repository_for("dead-aisle"),
        Some(Path::new(ROOT_B))
    );
    // An id nobody registered resolves to nothing. There is no nearest match and no search.
    assert_eq!(registry.repository_for("projecto"), None);
    assert_eq!(registry.repository_for("PROJECTOS"), None);
    assert_eq!(registry.repository_for(""), None);
}

/// An unregistered project permits no environment and is production-frozen. The fail-closed answers.
#[test]
fn e2b_an_unregistered_project_permits_nothing_and_is_frozen() {
    let registry = validate_registry_bytes(&registry_bytes(&[]), &machine()).expect("validates");
    assert!(!registry.environment_allowed("projectos", "development"));
    assert!(registry.is_production_frozen("projectos"));
}

// =============================================================================================
// [E7] A missing registry fails closed — and does NOT fall back to anything.
// =============================================================================================

#[test]
fn e7_a_missing_registry_fails_closed() {
    // The canonical path is not on this synthetic machine, so nothing can be read there.
    let outcome = read_canonical_registry(&machine());
    assert!(
        matches!(
            outcome,
            Err(RegistryRefusal::Missing | RegistryRefusal::AnchorUnresolved)
        ),
        "expected a closed refusal, got {outcome:?}"
    );
}

/// A registry that EXISTS and cannot be read is refused differently from one that is absent. Both
/// fail closed; only one of them means an administrator should go and look at the file.
#[test]
fn e7b_an_unreadable_registry_is_distinguished_from_an_absent_one() {
    struct PresentButUnreadable;
    impl RegistryFacts for PresentButUnreadable {
        fn is_dir(&self, _: &Path) -> bool {
            false
        }
        fn exists(&self, _: &Path) -> bool {
            true
        }
        fn is_reparse_point(&self, _: &Path) -> bool {
            false
        }
        fn read_file(&self, _: &Path) -> Option<Vec<u8>> {
            None
        }
    }
    if canonical_registry_path().is_ok() {
        assert_eq!(
            read_canonical_registry(&PresentButUnreadable),
            Err(RegistryRefusal::Unreadable)
        );
    }
}

/// A blank or shape-invalid identifier field is refused before anything touches the filesystem.
#[test]
fn a_malformed_identifier_or_root_field_fails_closed() {
    for mutate in [
        (|e: &mut RegisteredProjectV1| e.project_id = String::new())
            as fn(&mut RegisteredProjectV1),
        |e: &mut RegisteredProjectV1| e.project_id = "has space".into(),
        |e: &mut RegisteredProjectV1| e.project_id = "a".repeat(MAX_ID_LEN + 1),
        |e: &mut RegisteredProjectV1| e.project_id = "-force".into(),
        |e: &mut RegisteredProjectV1| e.project_id = ".hidden".into(),
        |e: &mut RegisteredProjectV1| e.project_id = "has/slash".into(),
        |e: &mut RegisteredProjectV1| e.repository_root = "   ".into(),
        |e: &mut RegisteredProjectV1| {
            e.repository_root = "C:\\".to_string() + &"a".repeat(MAX_ROOT_LEN)
        },
    ] {
        let mut e = entry("projectos", ROOT_A);
        mutate(&mut e);
        assert_eq!(
            validate_registry_bytes(&registry_bytes(&[e]), &machine()),
            Err(RegistryRefusal::InvalidField)
        );
    }
}

// =============================================================================================
// [E8] A malformed registry fails closed — every shape of malformed.
// =============================================================================================

#[test]
fn e8_a_malformed_registry_fails_closed() {
    let cases: &[(&[u8], RegistryRefusal)] = &[
        (b"", RegistryRefusal::Malformed),
        (b"not json", RegistryRefusal::Malformed),
        (b"[]", RegistryRefusal::Malformed),
        (br#"{"schemaVersion":1}"#, RegistryRefusal::Malformed),
        (
            br#"{"schemaVersion":2,"projects":[]}"#,
            RegistryRefusal::UnsupportedVersion,
        ),
        (
            br#"{"schemaVersion":0,"projects":[]}"#,
            RegistryRefusal::UnsupportedVersion,
        ),
    ];
    for (raw, expected) in cases {
        assert_eq!(
            validate_registry_bytes(raw, &machine()),
            Err(*expected),
            "{:?} must fail closed",
            String::from_utf8_lossy(raw)
        );
    }
}

/// An unknown field is REFUSED rather than ignored: a reader that skips what it does not understand
/// will happily accept a registry written for something else.
#[test]
fn e8b_an_unknown_field_is_refused_rather_than_ignored() {
    let raw = br#"{"schemaVersion":1,"projects":[],"trustedAnchor":"attacker-supplied"}"#;
    assert_eq!(
        validate_registry_bytes(raw, &machine()),
        Err(RegistryRefusal::Malformed)
    );
    let entry_raw = br#"{"schemaVersion":1,"projects":[{"projectId":"projectos",
        "repositoryRoot":"C:\\dev\\ProjectOS","permittedEnvironments":["development"],
        "productionFrozen":true,"planPath":"../../elsewhere/plan.json"}]}"#;
    assert_eq!(
        validate_registry_bytes(entry_raw, &machine()),
        Err(RegistryRefusal::Malformed)
    );
}

// =============================================================================================
// [E9] A missing `.git` or project configuration fails closed.
// =============================================================================================

#[test]
fn e9_a_missing_git_marker_fails_closed() {
    let no_git = machine().without(&format!(r"{ROOT_A}\.git"));
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &no_git),
        Err(RegistryRefusal::GitMarkerMissing)
    );
}

#[test]
fn e9b_a_missing_or_malformed_project_config_fails_closed() {
    let config = format!(r"{ROOT_A}\.projectops\project-config.json");

    let absent = machine().without(&config);
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &absent),
        Err(RegistryRefusal::ProjectConfigMissing)
    );

    for bad in [
        &b"not json"[..],
        &b"[]"[..],
        br#"{"projectName":"no id here"}"#,
        br#"{"projectId":""}"#,
        br#"{"projectId":"has space"}"#,
        br#"{"projectId":42}"#,
    ] {
        let broken = machine().with_file(&config, bad);
        assert_eq!(
            validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &broken),
            Err(RegistryRefusal::ProjectConfigMalformed),
            "{:?} must fail closed",
            String::from_utf8_lossy(bad)
        );
    }
}

#[test]
fn e9c_a_root_that_is_not_a_directory_fails_closed() {
    let gone = machine().without(ROOT_A);
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &gone),
        Err(RegistryRefusal::RootNotADirectory)
    );
}

// =============================================================================================
// [E10] Duplicate ids or roots fail closed — the WHOLE registry, not just the duplicate.
// =============================================================================================

#[test]
fn e10_duplicate_project_ids_fail_closed() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A), entry("projectos", ROOT_B)]);
    assert_eq!(
        validate_registry_bytes(&raw, &machine()),
        Err(RegistryRefusal::DuplicateProjectId)
    );
}

#[test]
fn e10b_duplicate_repository_roots_fail_closed_however_they_are_spelled() {
    for second_spelling in [
        ROOT_A,
        r"c:\dev\projectos",
        r"C:/dev/ProjectOS",
        r"C:\dev\ProjectOS\",
    ] {
        let raw = registry_bytes(&[
            entry("projectos", ROOT_A),
            entry("dead-aisle", second_spelling),
        ]);
        assert_eq!(
            validate_registry_bytes(&raw, &machine()),
            Err(RegistryRefusal::DuplicateRepositoryRoot),
            "{second_spelling} is the same root and must be refused"
        );
    }
}

// =============================================================================================
// [E11] A mismatched project identity fails closed. The registry may not rename a project.
// =============================================================================================

#[test]
fn e11_a_mismatched_project_identity_fails_closed() {
    // The registry claims `dead-aisle` lives at ProjectOS's root; the repository says otherwise.
    let raw = registry_bytes(&[entry("dead-aisle", ROOT_A)]);
    assert_eq!(
        validate_registry_bytes(&raw, &machine()),
        Err(RegistryRefusal::ProjectIdMismatch)
    );
}

// =============================================================================================
// [E12] An environment-policy violation fails closed.
// =============================================================================================

#[test]
fn e12_an_invalid_environment_policy_fails_closed() {
    for environments in [
        vec![],
        vec!["".to_string()],
        vec!["prod".to_string()],
        vec!["DEVELOPMENT".to_string()],
        vec!["development".to_string(), "development".to_string()],
        vec!["development".to_string(), "everything".to_string()],
        (0..MAX_ENVIRONMENTS + 1)
            .map(|_| "development".to_string())
            .collect(),
    ] {
        let mut e = entry("projectos", ROOT_A);
        e.permitted_environments = environments.clone();
        assert_eq!(
            validate_registry_bytes(&registry_bytes(&[e]), &machine()),
            Err(RegistryRefusal::EnvironmentPolicyInvalid),
            "{environments:?} must fail closed"
        );
    }
}

#[test]
fn e12b_a_permitted_environment_is_allowed_and_an_unpermitted_one_is_not() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A)]);
    let registry = validate_registry_bytes(&raw, &machine()).expect("validates");
    assert!(registry.environment_allowed("projectos", "development"));
    assert!(registry.environment_allowed("projectos", "staging"));
    assert!(!registry.environment_allowed("projectos", "production"));
    assert!(!registry.environment_allowed("projectos", "anything-else"));
}

/// Production freeze is a FAIL-CLOSED UNION: neither source can unfreeze the other.
#[test]
fn e12c_production_freeze_is_a_fail_closed_union() {
    let config = format!(r"{ROOT_A}\.projectops\project-config.json");

    let mut unfrozen_entry = entry("projectos", ROOT_A);
    unfrozen_entry.production_frozen = false;

    // Registry says no, repository says yes -> frozen.
    let repo_frozen = machine().with_file(
        &config,
        br#"{"projectId":"projectos","productionFreeze":true}"#,
    );
    let registry =
        validate_registry_bytes(&registry_bytes(&[unfrozen_entry.clone()]), &repo_frozen)
            .expect("validates");
    assert!(registry.is_production_frozen("projectos"));

    // Registry says yes, repository says no -> still frozen.
    let registry =
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &machine())
            .expect("validates");
    assert!(registry.is_production_frozen("projectos"));

    // Only both saying no yields unfrozen.
    let registry =
        validate_registry_bytes(&registry_bytes(&[unfrozen_entry]), &machine()).expect("validates");
    assert!(!registry.is_production_frozen("projectos"));
}

// =============================================================================================
// [E16] Single-project behaviour remains valid, and [E17] a second registration becomes visible
// without rebuilding or reinstalling anything.
// =============================================================================================

#[test]
fn e16_a_single_registered_project_is_the_ordinary_case() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A)]);
    let registry = validate_registry_bytes(&raw, &machine()).expect("validates");
    assert_eq!(registry.projects().len(), 1);
    assert_eq!(
        registry.projects()[0].project_id(),
        registry
            .project("projectos")
            .expect("the only project")
            .project_id()
    );
}

#[test]
fn e17_a_new_registration_is_visible_from_the_registry_bytes_alone() {
    let one = registry_bytes(&[entry("projectos", ROOT_A)]);
    let plan = plan_registration(Some(&one), &entry("dead-aisle", ROOT_B), &machine())
        .expect("a second project registers");
    let RegistrationPlan::Register(two) = plan else {
        panic!("expected a registration, not an already-registered outcome");
    };
    // Reading the NEW bytes — nothing was rebuilt, reinstalled or restarted — yields both projects.
    let registry = validate_registry_bytes(&two, &machine()).expect("validates");
    assert_eq!(registry.projects().len(), 2);
    assert_eq!(
        registry.repository_for("projectos"),
        Some(Path::new(ROOT_A))
    );
    assert_eq!(
        registry.repository_for("dead-aisle"),
        Some(Path::new(ROOT_B))
    );
}

// =============================================================================================
// [E18] The registry's location has no repository-controlled input.
// =============================================================================================

/// There is ONE canonical path, built from the Known Folder anchor plus the frozen segments — no
/// candidate list, no search, no first-valid-wins. The reader's whole input surface is that path, so
/// a registry nominated by a governed repository, an environment variable, argv or the working
/// directory is not refused: it is unrepresentable.
#[test]
fn e18_the_registry_location_is_fixed_and_has_no_ambient_source() {
    if let Ok(path) = canonical_registry_path() {
        let text = path.to_string_lossy().to_lowercase();
        assert!(path.is_absolute(), "{text}");
        assert!(
            text.ends_with(&format!(
                r"\{}\{}\{}\{}",
                EXPECTED_PRODUCT.to_lowercase(),
                HOST_STATE_DIRECTORY_SEGMENT,
                RECORD_SUBDIRECTORY,
                REGISTRY_FILE_NAME
            )),
            "{text}"
        );
    }

    // The production source consults no ambient channel. Comments and this test module are stripped
    // first: the file necessarily discusses environment variables and argv, and the list below
    // literally contains the strings being forbidden. A scan that reads its own forbidden list as
    // evidence is a scan that can only ever fail.
    let source = include_str!("lib.rs");
    let production = &source[..source.find("#[cfg(test)]").unwrap_or(source.len())];
    let code: String = production
        .lines()
        .filter(|line| {
            !line.trim_start().starts_with("//") && !line.trim_start().starts_with("//!")
        })
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "env::var",
        "env!(",
        "args()",
        "current_dir",
        "current_exe",
        "bridge.config",
        "ProgramData%",
    ] {
        assert!(
            !code.contains(forbidden),
            "the registry reader must not consult {forbidden}"
        );
    }
}

// =============================================================================================
// REGISTRATION — validate before writing, refuse conflicts, preserve existing entries.
// =============================================================================================

#[test]
fn registration_validates_the_proposal_before_producing_anything() {
    // A root with no repository at all.
    let empty = FakeMachine::default();
    assert_eq!(
        plan_registration(None, &entry("projectos", ROOT_A), &empty),
        Err(RegistrationRefusal::ProposedEntryInvalid(
            RegistryRefusal::RootNotADirectory
        ))
    );
    // A repository whose configuration names a different project.
    assert_eq!(
        plan_registration(None, &entry("dead-aisle", ROOT_A), &machine()),
        Err(RegistrationRefusal::ProposedEntryInvalid(
            RegistryRefusal::ProjectIdMismatch
        ))
    );
    // A relative root, and a traversing one.
    let mut relative = entry("projectos", ROOT_A);
    relative.repository_root = r"dev\ProjectOS".into();
    assert_eq!(
        plan_registration(None, &relative, &machine()),
        Err(RegistrationRefusal::ProposedEntryInvalid(
            RegistryRefusal::RootNotAbsolute
        ))
    );
    let mut traversing = entry("projectos", ROOT_A);
    traversing.repository_root = r"C:\dev\..\dev\ProjectOS".into();
    assert_eq!(
        plan_registration(None, &traversing, &machine()),
        Err(RegistrationRefusal::ProposedEntryInvalid(
            RegistryRefusal::RootTraversal
        ))
    );
}

#[test]
fn registration_refuses_id_and_root_conflicts_and_leaves_the_registry_alone() {
    let existing = registry_bytes(&[entry("projectos", ROOT_A)]);

    // Same id, different root. `dead-aisle`'s repository is re-badged so the proposal itself is
    // valid and the refusal can only come from the id already being taken.
    let rebadged = machine().with_file(
        &format!(r"{ROOT_B}\.projectops\project-config.json"),
        br#"{"projectId":"projectos","projectName":"Impostor"}"#,
    );
    assert_eq!(
        plan_registration(Some(&existing), &entry("projectos", ROOT_B), &rebadged),
        Err(RegistrationRefusal::ConflictingProjectId),
        "a registered id may not be moved to a second root by registering it again"
    );

    // Different id, SAME root. Reachable when a repository's own configuration changes identity
    // after it was registered: the proposal validates against the repository as it is now, and is
    // refused because that root is already spoken for under another id.
    let renamed = machine().with_file(
        &format!(r"{ROOT_A}\.projectops\project-config.json"),
        br#"{"projectId":"projectos-renamed","projectName":"Renamed"}"#,
    );
    assert_eq!(
        plan_registration(
            Some(&existing),
            &entry("projectos-renamed", ROOT_A),
            &renamed
        ),
        Err(RegistrationRefusal::ConflictingRepositoryRoot),
        "one root may never be registered twice under two ids"
    );
}

#[test]
fn registration_is_idempotent_for_an_identical_entry() {
    let existing = registry_bytes(&[entry("projectos", ROOT_A)]);
    assert_eq!(
        plan_registration(Some(&existing), &entry("projectos", ROOT_A), &machine()),
        Ok(RegistrationPlan::AlreadyRegistered)
    );
}

#[test]
fn registration_refuses_to_change_policy_for_an_existing_entry() {
    let existing = registry_bytes(&[entry("projectos", ROOT_A)]);
    let mut changed = entry("projectos", ROOT_A);
    changed.production_frozen = false;
    assert_eq!(
        plan_registration(Some(&existing), &changed, &machine()),
        Err(RegistrationRefusal::ConflictingPolicy),
        "unfreezing production is a policy change, and this contract does not perform one"
    );
}

#[test]
fn registration_preserves_every_existing_entry() {
    let existing = registry_bytes(&[entry("projectos", ROOT_A)]);
    let RegistrationPlan::Register(next) =
        plan_registration(Some(&existing), &entry("dead-aisle", ROOT_B), &machine())
            .expect("registers")
    else {
        panic!("expected a registration");
    };
    let parsed: ProjectsRegistryV1 = serde_json::from_slice(&next).expect("canonical bytes parse");
    assert_eq!(parsed.projects.len(), 2);
    assert_eq!(parsed.projects[0], entry("projectos", ROOT_A));
    assert_eq!(parsed.projects[1], entry("dead-aisle", ROOT_B));
}

#[test]
fn registration_refuses_to_rebuild_an_unusable_registry() {
    for bad in [&b"not json"[..], br#"{"schemaVersion":9,"projects":[]}"#] {
        let outcome = plan_registration(Some(bad), &entry("projectos", ROOT_A), &machine());
        assert!(
            matches!(
                outcome,
                Err(RegistrationRefusal::ExistingRegistryUnusable(_))
            ),
            "an unusable registry must never be silently rebuilt, got {outcome:?}"
        );
    }
}

#[test]
fn canonical_bytes_round_trip_through_the_reader() {
    let raw = registry_bytes(&[entry("projectos", ROOT_A), entry("dead-aisle", ROOT_B)]);
    assert!(raw.ends_with(b"\n"), "a config file ends with a newline");
    assert!(
        !raw.starts_with(b"\xEF\xBB\xBF"),
        "canonical bytes carry no BOM"
    );
    let registry = validate_registry_bytes(&raw, &machine()).expect("its own output validates");
    assert_eq!(registry.projects().len(), 2);
}

/// The bound is enforced, so a registry file cannot become an unbounded work list.
#[test]
fn the_project_bound_is_enforced() {
    let mut entries = Vec::new();
    for index in 0..=MAX_PROJECTS {
        entries.push(entry(&format!("p{index}"), &format!(r"C:\dev\p{index}")));
    }
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&entries), &machine()),
        Err(RegistryRefusal::TooManyProjects)
    );
}

// =============================================================================================
// THE ACCEPTED SEAM. Compiled only with `host-core-binding`.
// =============================================================================================

#[cfg(feature = "host-core-binding")]
mod seam {
    use super::*;
    use projectos_host_core::storage::ProjectRegistryReader;
    use projectos_host_core::{EnvironmentId, ProjectId};

    /// The validated registry answers the accepted service-private contract, with the same
    /// fail-closed behaviour the inherent methods have.
    #[test]
    fn the_validated_registry_is_a_project_registry_reader() {
        let raw = registry_bytes(&[entry("projectos", ROOT_A)]);
        let registry = validate_registry_bytes(&raw, &machine()).expect("validates");
        let reader: &dyn ProjectRegistryReader = &registry;

        let known = ProjectId::new("projectos").expect("valid id");
        let unknown = ProjectId::new("not-registered").expect("valid id");
        let development = EnvironmentId::new("development").expect("valid environment");
        let production = EnvironmentId::new("production").expect("valid environment");

        assert!(reader.repository_for(&known).is_some());
        assert!(reader.repository_for(&unknown).is_none());
        assert!(reader.environment_allowed(&known, &development));
        assert!(!reader.environment_allowed(&known, &production));
        assert!(!reader.environment_allowed(&unknown, &development));
        assert!(reader.is_production_frozen(&known));
        assert!(reader.is_production_frozen(&unknown));
    }
}

// =============================================================================================
// A REGISTERED ROOT MAY NOT BE RE-AIMABLE, AND THE DUPLICATE CHECK MAY NOT BE EVADED BY SPELLING.
// =============================================================================================

/// A junction at the registered root — or at its `.git` — is refused.
///
/// The point is not that a link is suspicious. It is that a link is a path SOMEBODY ELSE CAN AIM: if
/// the directory beside the registered one is writable by a lower-trust principal, they choose what
/// the registered root actually resolves to, and every later check then describes their content.
#[test]
fn a_reparse_point_on_the_root_or_its_git_marker_is_refused() {
    let linked_root = machine().with_reparse_point(ROOT_A);
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &linked_root),
        Err(RegistryRefusal::ReparsePointRefused)
    );

    let linked_git = machine().with_reparse_point(&format!(r"{ROOT_A}\.git"));
    assert_eq!(
        validate_registry_bytes(&registry_bytes(&[entry("projectos", ROOT_A)]), &linked_git),
        Err(RegistryRefusal::ReparsePointRefused)
    );
}

/// Win32 discards trailing spaces and dots from a path component, so two entries that differ only
/// by them name ONE directory and must collide.
#[test]
fn trailing_whitespace_cannot_evade_the_duplicate_root_refusal() {
    for spelling in [
        "C:\\dev\\ProjectOS ",
        "C:\\dev\\ProjectOS.",
        " C:\\dev\\ProjectOS",
        "C:\\dev\\ProjectOS \\",
    ] {
        assert_eq!(
            normalise_root(Path::new(spelling)),
            normalise_root(Path::new(ROOT_A)),
            "{spelling} is the same directory"
        );
        assert_eq!(
            validate_registry_bytes(
                &registry_bytes(&[entry("projectos", ROOT_A), entry("dead-aisle", spelling)]),
                &machine()
            ),
            Err(RegistryRefusal::DuplicateRepositoryRoot),
            "{spelling} must be refused as a duplicate"
        );
    }
}

// =============================================================================================
// REGISTRATION — the two guards that had no test of their own.
// =============================================================================================

/// The bound is enforced at REGISTRATION too, not only when reading a document that already
/// exceeds it. Without this, a registry could be grown one entry past the bound it validates against.
#[test]
fn registration_refuses_to_exceed_the_project_bound() {
    let mut entries = Vec::new();
    let mut full = FakeMachine::default();
    for index in 0..MAX_PROJECTS {
        let id = format!("p{index}");
        let root = format!(r"C:\dev\p{index}");
        full = full.with_repository(&root, &id);
        entries.push(entry(&id, &root));
    }
    full = full.with_repository(ROOT_A, "projectos");
    let existing = registry_bytes(&entries);
    assert_eq!(
        plan_registration(Some(&existing), &entry("projectos", ROOT_A), &full),
        Err(RegistrationRefusal::TooManyProjects)
    );
}

/// A PREVIOUSLY VALID entry that has gone stale on disk is reported as the EXISTING registry's
/// problem, not as the caller's — which is the whole reason the failure is re-attributed rather than
/// reported as whatever the merged validation happened to hit first.
#[test]
fn registration_blames_the_existing_registry_when_the_proposal_is_sound() {
    // `projectos` is registered and its repository has since lost its `.git`.
    let stale = machine().without(&format!(r"{ROOT_A}\.git"));
    let existing = registry_bytes(&[entry("projectos", ROOT_A)]);
    assert_eq!(
        plan_registration(Some(&existing), &entry("dead-aisle", ROOT_B), &stale),
        Err(RegistrationRefusal::ExistingRegistryUnusable(
            RegistryRefusal::GitMarkerMissing
        )),
        "the proposal is sound, so the refusal must name the entry that actually broke"
    );
}
