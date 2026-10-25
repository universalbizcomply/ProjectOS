//! The elevated registry-publication boundary.
//!
//! These run the REAL sequence — real files, a real Windows descriptor applied and authoritatively
//! re-read, the real registry validator — against disposable directories under `%TEMP%`. Nothing here
//! touches ProgramData, Program Files, a service, or the machine's actual registry, and the fixture
//! route differs from production in exactly two stated ways: the destination is the disposable one,
//! and the expected OWNER is the calling account rather than Administrators, because setting
//! Administrators as owner is itself an elevated act.

use super::fixture::{
    fixture_policy, publish_into_owned_root, publish_with_divergent_verification,
};
use super::*;
use projectos_host_windows_acl_policy::{AclPrincipal, BroadPrincipal, WindowsAclPolicyService};
use projectos_project_registry::{
    plan_registration, to_canonical_json, ProjectsRegistryV1, RealRegistryFacts,
    RegisteredProjectV1, RegistrationPlan, RegistryRefusal, REGISTRY_SCHEMA_VERSION,
};
use std::path::{Path, PathBuf};

/// A disposable directory, emptied first so a previous run cannot influence this one.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-registry-publish-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the scratch directory is created");
    dir
}

/// A real repository on disk: `.git`, and a project configuration naming `project_id`.
fn repository(root: &Path, project_id: &str) {
    std::fs::create_dir_all(root.join(".projectops")).unwrap();
    std::fs::write(root.join(".git"), b"gitdir: elsewhere").unwrap();
    std::fs::write(
        root.join(".projectops").join("project-config.json"),
        format!(r#"{{"projectId":"{project_id}","projectName":"{project_id}"}}"#),
    )
    .unwrap();
}

fn entry(project_id: &str, root: &Path) -> RegisteredProjectV1 {
    RegisteredProjectV1 {
        project_id: project_id.to_string(),
        repository_root: root.to_string_lossy().to_string(),
        permitted_environments: vec!["development".into()],
        production_frozen: true,
    }
}

/// The plan an honest unelevated planner would produce for this proposal.
fn plan_for(destination: &Path, proposed: &RegisteredProjectV1) -> PlannedRegistration {
    let existing = std::fs::read(destination).ok();
    let bytes = match plan_registration(existing.as_deref(), proposed, &RealRegistryFacts) {
        Ok(RegistrationPlan::Register(bytes)) => bytes,
        other => panic!("the fixture plan must be a registration, got {other:?}"),
    };
    PlannedRegistration {
        proposed: proposed.clone(),
        planned_digest: digest_hex(&bytes),
    }
}

fn publish(
    destination: &Path,
    plan: &PlannedRegistration,
) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
    publish_into_owned_root(destination, true, REGISTRY_PUBLISH_PHRASE, plan)
}

// =============================================================================================
// [1, 2] ELEVATION AND EXPLICIT APPROVAL ARE BOTH REQUIRED, BEFORE ANY EFFECT.
// =============================================================================================

#[test]
fn t1_an_unelevated_publication_is_refused_and_writes_nothing() {
    let dir = scratch("unelevated");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    assert_eq!(
        publish_into_owned_root(&destination, false, REGISTRY_PUBLISH_PHRASE, &plan),
        Err(RegistryPublishRefusal::NotElevated)
    );
    assert!(
        !destination.exists(),
        "an unelevated attempt must not create the registry"
    );
    assert!(
        !dir.join("projects.v1.json.publishing").exists(),
        "and must leave no residue"
    );
}

#[test]
fn t2_explicit_owner_approval_is_required_and_must_match_exactly() {
    let dir = scratch("approval");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    for phrase in [
        "",
        "approved: publish the ProjectOS installed-project registry",
        "APPROVED: publish the ProjectOS installed-project registry ",
        "APPROVED: publish everything",
    ] {
        assert_eq!(
            publish_into_owned_root(&destination, true, phrase, &plan),
            Err(RegistryPublishRefusal::ApprovalPhraseMismatch),
            "{phrase:?} must not authorise a publication"
        );
    }
    assert!(!destination.exists());
}

// =============================================================================================
// [3, 4] THE DESTINATION IS DERIVED, NOT SUPPLIED.
// =============================================================================================

/// The PRODUCTION entry point takes an approval phrase and a plan. There is no destination
/// parameter, so an arbitrary path is not refused — it is unrepresentable. Neither of the following
/// compiles, which is a stronger statement than any assertion. They are prose rather than a
/// `compile_fail` doctest on purpose: this module is `cfg(test)`, and `cargo test --doc` compiles
/// without `--cfg test`, so a doctest here would never be extracted and would prove nothing.
///
///     publish_project_registry(PHRASE, &plan, Path::new(r"C:\attacker\projects.v1.json"));
///     publish_project_registry(PHRASE, &plan, elevated: true);
///
/// What this test can check at run time is the other half: the module reads no ambient source for a
/// destination. Comments and this test module are stripped first — the file necessarily discusses
/// environment variables and argv, and the list below literally contains the strings being
/// forbidden, so a scan that read its own forbidden list as evidence could only ever fail.
#[test]
fn t3_the_destination_has_no_ambient_or_caller_source() {
    let source = include_str!("../registry_publish.rs");
    let production = &source[..source.find("pub mod fixture").unwrap_or(source.len())];
    let code: String = production
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !trimmed.starts_with("//") && !trimmed.starts_with("///") && !trimmed.starts_with("//!")
        })
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "env::var",
        "env!(",
        "args()",
        "current_dir",
        "current_exe",
        "ProgramData%",
        "bridge.config",
    ] {
        assert!(
            !code.contains(forbidden),
            "the publisher must not consult {forbidden}"
        );
    }
}

/// The fixed destination is derived from the approved anchor plus the frozen segments, and lands
/// beside the two installation records rather than anywhere else.
#[cfg(feature = "registry-publish-effect")]
#[test]
fn t4_the_production_destination_is_the_one_canonical_path() {
    if let Ok(path) = production_destination() {
        let text = path.to_string_lossy().to_lowercase();
        assert!(path.is_absolute(), "{text}");
        assert!(
            text.ends_with(r"\projectos\host\installation\projects.v1.json"),
            "{text}"
        );
    }
}

// =============================================================================================
// [5] THE ELEVATED SIDE REVALIDATES INDEPENDENTLY.
// =============================================================================================

/// The caller's plan is not evidence. A proposal whose repository is not what the plan claimed is
/// refused HERE, by the elevated side's own recomputation, with the registry contract's own reason.
#[test]
fn t5_the_elevated_side_repeats_every_check_for_itself() {
    let dir = scratch("revalidate");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let proposed = entry("projectos", &root);
    let plan = plan_for(&destination, &proposed);

    // The repository changes AFTER the plan was made: its `.git` is removed. The plan still says the
    // project is fine; the elevated side finds otherwise.
    std::fs::remove_file(root.join(".git")).unwrap();
    assert_eq!(
        publish(&destination, &plan),
        Err(RegistryPublishRefusal::RevalidationRefused(
            RegistrationRefusal::ProposedEntryInvalid(RegistryRefusal::GitMarkerMissing)
        ))
    );
    assert!(!destination.exists());

    // And an identity that no longer matches is refused the same way.
    repository(&root, "renamed-behind-our-back");
    assert_eq!(
        publish(&destination, &plan),
        Err(RegistryPublishRefusal::RevalidationRefused(
            RegistrationRefusal::ProposedEntryInvalid(RegistryRefusal::ProjectIdMismatch)
        ))
    );
    assert!(!destination.exists());
}

// =============================================================================================
// [6] A STALE OR ALTERED PLAN IS REFUSED.
// =============================================================================================

#[test]
fn t6_a_stale_or_altered_plan_is_refused_and_changes_nothing() {
    let dir = scratch("stale");
    let first_root = dir.join("first");
    let second_root = dir.join("second");
    repository(&first_root, "first");
    repository(&second_root, "second");
    let destination = dir.join("projects.v1.json");

    // A plan made against an EMPTY registry...
    let stale = plan_for(&destination, &entry("second", &second_root));
    // ...while the registry meanwhile gained an entry.
    let now = plan_for(&destination, &entry("first", &first_root));
    assert_eq!(
        publish(&destination, &now),
        Ok(RegistryPublishOutcome::Created)
    );
    let published = std::fs::read(&destination).unwrap();

    assert_eq!(
        publish(&destination, &stale),
        Err(RegistryPublishRefusal::PlanStale),
        "a plan made against an older registry is not authority over the newer one"
    );
    assert_eq!(
        std::fs::read(&destination).unwrap(),
        published,
        "the previous valid registry is untouched"
    );

    // An ALTERED digest is refused for the same reason.
    let mut altered = plan_for(&destination, &entry("second", &second_root));
    altered.planned_digest = "0".repeat(64);
    assert_eq!(
        publish(&destination, &altered),
        Err(RegistryPublishRefusal::PlanStale)
    );
    assert_eq!(std::fs::read(&destination).unwrap(), published);
}

// =============================================================================================
// [7, 8, 9] THE DESCRIPTOR: CREATED EXACTLY, PRESERVED ACROSS REPLACEMENT, READ-ONLY FOR USERS.
// =============================================================================================

/// The Windows-observed rights an ACE grants a principal, if it holds one at all.
fn observed_rights(path: &Path, principal: &AclPrincipal) -> Option<u32> {
    let service = WindowsAclPolicyService::new();
    let inspection = service
        .inspect_file(path)
        .expect("the descriptor is readable");
    let sid = principal.resolve().expect("the principal resolves");
    inspection
        .aces
        .iter()
        .find(|ace| ace.sid.as_ref() == Some(&sid))
        .and_then(|ace| ace.raw_mask)
}

#[test]
fn t7_first_publication_creates_the_intended_descriptor() {
    let dir = scratch("create-dacl");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    assert_eq!(
        publish(&destination, &plan),
        Ok(RegistryPublishOutcome::Created)
    );

    let service = WindowsAclPolicyService::new();
    let verified = service
        .verify_file(&destination, &fixture_policy())
        .expect("the descriptor is readable");
    assert!(
        verified.is_conforming(),
        "the created descriptor must conform: {verified:?}"
    );
    // The residue is gone, and the registry reads back as a valid registry.
    assert!(!dir.join("projects.v1.json.publishing").exists());
    assert!(
        validate_registry_bytes(&std::fs::read(&destination).unwrap(), &RealRegistryFacts).is_ok()
    );
}

#[test]
fn t8_replacement_preserves_the_intended_descriptor_and_the_file_identity() {
    let dir = scratch("replace-dacl");
    let first_root = dir.join("first");
    let second_root = dir.join("second");
    repository(&first_root, "first");
    repository(&second_root, "second");
    let destination = dir.join("projects.v1.json");

    let first = plan_for(&destination, &entry("first", &first_root));
    assert_eq!(
        publish(&destination, &first),
        Ok(RegistryPublishOutcome::Created)
    );
    let created_at = std::fs::metadata(&destination).unwrap().created().ok();

    let second = plan_for(&destination, &entry("second", &second_root));
    assert_eq!(
        publish(&destination, &second),
        Ok(RegistryPublishOutcome::Replaced)
    );

    let service = WindowsAclPolicyService::new();
    let verified = service
        .verify_file(&destination, &fixture_policy())
        .expect("the descriptor is readable");
    assert!(
        verified.is_conforming(),
        "replacement must preserve the descriptor: {verified:?}"
    );
    // ReplaceFileW preserves the destination's object identity, which is why its descriptor survives.
    assert_eq!(
        std::fs::metadata(&destination).unwrap().created().ok(),
        created_at,
        "the destination is the same file object, not a new one wearing its name"
    );
    // Both projects are now registered, and the result validates.
    let registry =
        validate_registry_bytes(&std::fs::read(&destination).unwrap(), &RealRegistryFacts)
            .expect("the replaced registry validates");
    assert_eq!(registry.projects().len(), 2);
}

/// Builtin Users may READ and may not WRITE.
///
/// Asserted against the descriptor Windows actually reports, which is the checkable claim: the ACE
/// exists, its mask is the read class exactly, and it carries no write, delete, WRITE_DAC or
/// WRITE_OWNER bit. Proving it by attempting a write from a second account would need a second
/// account, which this test has no way to create.
#[test]
fn t9_builtin_users_hold_read_and_nothing_more() {
    let dir = scratch("users-read");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));
    assert_eq!(
        publish(&destination, &plan),
        Ok(RegistryPublishOutcome::Created)
    );

    let users = observed_rights(&destination, &AclPrincipal::BuiltinUsers)
        .expect("Builtin Users hold an ACE");
    assert_eq!(
        users,
        RightsClass::Read.mask(),
        "Builtin Users must hold exactly the read class"
    );
    assert_eq!(
        users & RightsClass::Modify.mask() & !RightsClass::Read.mask(),
        0,
        "and no write-like bit at all"
    );
    // SYSTEM and Administrators hold full control.
    for principal in [
        AclPrincipal::LocalSystem,
        AclPrincipal::BuiltinAdministrators,
    ] {
        assert_eq!(
            observed_rights(&destination, &principal),
            Some(RightsClass::FullControl.mask()),
            "{} must hold full control",
            principal.label()
        );
    }
    // The policy itself could never have been a writable one.
    assert!(!fixture_policy().grants_broad_write());
    assert_eq!(
        BroadPrincipal::classify(&AclPrincipal::BuiltinUsers.resolve().unwrap()),
        Some(BroadPrincipal::BuiltinUsers),
        "Builtin Users is a broad principal, and is granted read only by an explicit opt-in"
    );
}

// =============================================================================================
// [10, 11] FAILURE LEAVES THE PREVIOUS REGISTRY USABLE; SUCCESS FOLLOWS VERIFICATION.
// =============================================================================================

#[test]
fn t10_a_failed_publication_leaves_the_previous_registry_unchanged_and_usable() {
    let dir = scratch("rollback");
    let first_root = dir.join("first");
    let second_root = dir.join("second");
    repository(&first_root, "first");
    repository(&second_root, "second");
    let destination = dir.join("projects.v1.json");

    let first = plan_for(&destination, &entry("first", &first_root));
    assert_eq!(
        publish(&destination, &first),
        Ok(RegistryPublishOutcome::Created)
    );
    let before = std::fs::read(&destination).unwrap();

    // Every refusal that can happen once a registry exists.
    let second = plan_for(&destination, &entry("second", &second_root));
    std::fs::remove_file(second_root.join(".git")).unwrap();
    assert!(matches!(
        publish(&destination, &second),
        Err(RegistryPublishRefusal::RevalidationRefused(_))
    ));
    assert_eq!(std::fs::read(&destination).unwrap(), before);

    assert_eq!(
        publish_into_owned_root(&destination, false, REGISTRY_PUBLISH_PHRASE, &second),
        Err(RegistryPublishRefusal::NotElevated)
    );
    assert_eq!(std::fs::read(&destination).unwrap(), before);

    assert_eq!(
        publish_into_owned_root(&destination, true, "nope", &second),
        Err(RegistryPublishRefusal::ApprovalPhraseMismatch)
    );
    assert_eq!(std::fs::read(&destination).unwrap(), before);

    // And it is still a VALID registry, not merely unchanged bytes.
    assert!(validate_registry_bytes(&before, &RealRegistryFacts).is_ok());
    assert!(!dir.join("projects.v1.json.publishing").exists());
}

/// Publishing the same registration twice reports `AlreadyCurrent` and writes nothing at all.
#[test]
fn t11_an_already_current_registry_is_not_rewritten() {
    let dir = scratch("idempotent");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));
    assert_eq!(
        publish(&destination, &plan),
        Ok(RegistryPublishOutcome::Created)
    );
    let modified = std::fs::metadata(&destination).unwrap().modified().unwrap();

    assert_eq!(
        publish(&destination, &plan),
        Ok(RegistryPublishOutcome::AlreadyCurrent),
        "the project is already registered; nothing needs writing"
    );
    assert_eq!(
        std::fs::metadata(&destination).unwrap().modified().unwrap(),
        modified,
        "and nothing was written"
    );
}

/// A policy that would grant broad WRITE is refused before any effect — the defect verification
/// exists to catch is never applied in the first place.
#[test]
fn t12_a_policy_granting_broad_write_is_refused_before_any_effect() {
    let dir = scratch("broad-write");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    let mut writable = fixture_policy();
    writable.allow_broad_principals_write = true;
    assert!(writable.grants_broad_write());
    assert_eq!(
        publish_with_divergent_verification(&destination, &writable, &writable, &plan),
        Err(RegistryPublishRefusal::PolicyRefused)
    );
    assert!(!destination.exists());
}

/// The canonical bytes this operation publishes are the registry crate's own encoding, not a second
/// one produced here.
#[test]
fn t13_the_published_bytes_are_the_registry_contracts_own_encoding() {
    let dir = scratch("canonical");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let proposed = entry("projectos", &root);
    let plan = plan_for(&destination, &proposed);
    assert_eq!(
        publish(&destination, &plan),
        Ok(RegistryPublishOutcome::Created)
    );

    let expected = to_canonical_json(&ProjectsRegistryV1 {
        schema_version: REGISTRY_SCHEMA_VERSION,
        projects: vec![proposed],
    });
    assert_eq!(std::fs::read(&destination).unwrap(), expected);
    assert_eq!(digest_hex(&expected), plan.planned_digest);
}

/// SUCCESS IS NOT REPORTED BEFORE THE DESCRIPTOR IS VERIFIED.
///
/// `ReplaceFileW` preserves the destination's descriptor — which is exactly why the descriptor has
/// to be re-read afterwards rather than assumed. A destination whose descriptor was weakened between
/// publications keeps that weakened descriptor through the replacement, and the operation must say
/// so instead of returning an outcome that reads as "published and protected".
#[test]
fn t14_a_replacement_onto_a_non_conforming_descriptor_refuses_rather_than_reporting_success() {
    let dir = scratch("verify-dacl");
    let first_root = dir.join("first");
    let second_root = dir.join("second");
    repository(&first_root, "first");
    repository(&second_root, "second");
    let destination = dir.join("projects.v1.json");

    let first = plan_for(&destination, &entry("first", &first_root));
    assert_eq!(
        publish(&destination, &first),
        Ok(RegistryPublishOutcome::Created)
    );

    // Weaken the descriptor: drop Builtin Users' read grant, so the file no longer conforms.
    let mut weakened = fixture_policy();
    weakened
        .allowed
        .retain(|allowed| allowed.principal != AclPrincipal::BuiltinUsers);
    WindowsAclPolicyService::new()
        .apply_file_policy(&destination, &weakened)
        .expect("the weakened descriptor is applied");

    let second = plan_for(&destination, &entry("second", &second_root));
    assert_eq!(
        publish(&destination, &second),
        Err(RegistryPublishRefusal::DaclNotConfirmed),
        "a publication onto a non-conforming descriptor must not be reported as success"
    );
}

// =============================================================================================
// THE THREE GUARDS THE REVIEWS ADDED. Each has its own reason and its own refusal.
// =============================================================================================

/// The installation directory is a WRITE BOUNDARY too, and this operation does not create one.
///
/// On NTFS, permission to delete or replace a file comes from either the file's own descriptor or
/// `FILE_DELETE_CHILD` on its parent. A directory this operation created would carry whatever it
/// inherited, so the registry could land correctly protected inside a directory that let anyone
/// remove it. An absent directory is the installer's problem, not this operation's.
#[test]
fn t15_an_absent_installation_directory_is_refused_rather_than_created() {
    let dir = scratch("absent-directory");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let missing = dir.join("not-created-yet");
    let destination = missing.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    assert_eq!(
        publish(&destination, &plan),
        Err(RegistryPublishRefusal::DirectoryUnusable)
    );
    assert!(!missing.exists(), "the directory must not be created here");
}

/// A destination that changed between being read and being replaced belongs to another publication.
/// Discarding its entry silently is the lost update this refusal exists to prevent.
#[test]
fn t16_a_destination_that_changed_underneath_is_not_overwritten() {
    let dir = scratch("lost-update");
    let first_root = dir.join("first");
    let second_root = dir.join("second");
    let third_root = dir.join("third");
    repository(&first_root, "first");
    repository(&second_root, "second");
    repository(&third_root, "third");
    let destination = dir.join("projects.v1.json");

    let first = plan_for(&destination, &entry("first", &first_root));
    assert_eq!(
        publish(&destination, &first),
        Ok(RegistryPublishOutcome::Created)
    );

    // A plan is made against the registry as it is now...
    let second = plan_for(&destination, &entry("second", &second_root));
    // ...and a CONCURRENT publication lands before the swap. Rewriting the file directly is how a
    // test expresses "another elevated publisher won the race".
    let third = plan_for(&destination, &entry("third", &third_root));
    assert_eq!(
        publish(&destination, &third),
        Ok(RegistryPublishOutcome::Replaced)
    );
    let winner = std::fs::read(&destination).unwrap();

    assert_eq!(
        publish(&destination, &second),
        Err(RegistryPublishRefusal::PlanStale),
        "the plan is stale first, which is the earlier and more specific refusal"
    );
    assert_eq!(std::fs::read(&destination).unwrap(), winner);
}

/// A registry that exists and cannot be read is NOT treated as "there isn't one". Collapsing the two
/// would route a permission problem into the create-a-new-registry branch.
#[test]
fn t17_an_unreadable_existing_registry_is_distinguished_from_an_absent_one() {
    let dir = scratch("unreadable");
    let root = dir.join("repo");
    repository(&root, "projectos");
    // A DIRECTORY at the destination: it exists, and `read` on it fails.
    let destination = dir.join("projects.v1.json");
    std::fs::create_dir_all(&destination).unwrap();
    let plan = PlannedRegistration {
        proposed: entry("projectos", &root),
        planned_digest: "0".repeat(64),
    };

    assert_eq!(
        publish(&destination, &plan),
        Err(RegistryPublishRefusal::ExistingRegistryUnreadable)
    );
    assert!(destination.is_dir(), "nothing was replaced or removed");
}

/// A FIRST publication whose verification fails is rolled back to the state it started from: absent.
/// Reporting a refusal while leaving an unverified file at the canonical protected location would
/// tell the caller "this did not happen" about a machine where it partly did.
#[test]
fn t18_a_failed_first_publication_leaves_no_file_behind() {
    let dir = scratch("create-rollback");
    let root = dir.join("repo");
    repository(&root, "projectos");
    let destination = dir.join("projects.v1.json");
    let plan = plan_for(&destination, &entry("projectos", &root));

    // Apply the real descriptor, then verify against one it cannot satisfy. That forces the
    // post-publication check to fail at the exact point the rollback exists for — the only way to
    // reach it, since a descriptor that applies successfully also verifies successfully.
    let mut unsatisfiable = fixture_policy();
    unsatisfiable.allow_broad_principals_any_access = false;
    let outcome =
        publish_with_divergent_verification(&destination, &fixture_policy(), &unsatisfiable, &plan);
    assert_eq!(
        outcome,
        Err(RegistryPublishRefusal::DaclNotConfirmed),
        "verification must fail, which is what the rollback exists for"
    );
    assert!(
        !destination.exists(),
        "no unverified file may remain at the canonical name"
    );
    assert_eq!(
        std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains("publishing"))
            .count(),
        0,
        "and no staging residue may remain"
    );
}
