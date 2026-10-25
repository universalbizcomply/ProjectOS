//! A2 — governed project root resolution, and everything it refuses.

#![cfg(windows)]

use projectos_project_registry::RegistryRefusal;

use super::{make_repository, registry_document, registry_document_raw, undecorated, TempTree};
use crate::{FixtureProjectRegistry, TrustedGovernedProjectRoot, TrustedRootRefusal};

fn resolve(
    document: Vec<u8>,
    project_id: &str,
) -> Result<TrustedGovernedProjectRoot, TrustedRootRefusal> {
    TrustedGovernedProjectRoot::resolve(&FixtureProjectRegistry::new(document), project_id)
}

/// The refusal a document + id produced.
///
/// A trusted root is deliberately not comparable — equality on a capability invites treating two of
/// them as interchangeable — so a refusal is extracted rather than compared inside a `Result`.
fn refused(document: Vec<u8>, project_id: &str) -> TrustedRootRefusal {
    resolve(document, project_id).expect_err("expected a refusal, got a trusted root")
}

#[test]
fn a_registered_project_resolves_to_its_attested_repository() {
    let tree = TempTree::new("gp-ok");
    let repo = make_repository(&tree, "repo-a", "proj-a");

    let root = resolve(registry_document(&[("proj-a", &repo)]), "proj-a").expect("governed root");

    assert_eq!(undecorated(root.path()), undecorated(&repo));
    // The root CARRIES the id it was attested for, so nothing downstream has to be told twice and
    // the two answers cannot disagree.
    assert_eq!(root.project_id(), "proj-a");
}

#[test]
fn an_unregistered_project_id_refuses() {
    let tree = TempTree::new("gp-unregistered");
    let repo = make_repository(&tree, "repo-a", "proj-a");

    // The registry is valid and simply does not carry this project. There is no nearest match, no
    // first entry and no default.
    assert_eq!(
        refused(registry_document(&[("proj-a", &repo)]), "proj-elsewhere"),
        TrustedRootRefusal::ProjectNotRegistered
    );
}

#[test]
fn one_project_can_never_reach_another_projects_root() {
    let tree = TempTree::new("gp-crossover");
    let repo_a = make_repository(&tree, "repo-a", "proj-a");
    let repo_b = make_repository(&tree, "repo-b", "proj-b");
    let document = registry_document(&[("proj-a", &repo_a), ("proj-b", &repo_b)]);

    let a = resolve(document.clone(), "proj-a").expect("root a");
    let b = resolve(document, "proj-b").expect("root b");

    assert_eq!(undecorated(a.path()), undecorated(&repo_a));
    assert_eq!(undecorated(b.path()), undecorated(&repo_b));
    assert_ne!(undecorated(a.path()), undecorated(b.path()));
}

#[test]
fn a_repository_that_names_a_different_project_refuses() {
    let tree = TempTree::new("gp-mismatch");
    // The registry entry claims `proj-a`; the repository's own configuration says otherwise. THE
    // REGISTRY DOES NOT WIN — a disagreement about identity is refused outright.
    let repo = make_repository(&tree, "repo-a", "proj-somebody-else");

    assert_eq!(
        refused(registry_document(&[("proj-a", &repo)]), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::ProjectIdMismatch)
    );
}

#[test]
fn a_root_that_is_not_a_repository_refuses() {
    let tree = TempTree::new("gp-not-a-repo");
    let plain = tree.dir("plain-directory");
    tree.write(
        "plain-directory/.projectops/project-config.json",
        b"{\"projectId\":\"proj-a\"}",
    );

    // No `.git` marker: a directory carrying a `.projectops` folder is not thereby a repository.
    assert_eq!(
        refused(registry_document(&[("proj-a", &plain)]), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::GitMarkerMissing)
    );
}

#[test]
fn a_repository_without_projectos_installed_refuses() {
    let tree = TempTree::new("gp-no-config");
    let repo = tree.dir("repo-a");
    tree.write("repo-a/.git", b"gitdir: elsewhere\n");

    assert_eq!(
        refused(registry_document(&[("proj-a", &repo)]), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::ProjectConfigMissing)
    );
}

#[test]
fn a_relative_registered_root_refuses() {
    assert_eq!(
        refused(registry_document_raw("proj-a", "relative\\repo"), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::RootNotAbsolute)
    );
}

#[test]
fn a_traversing_registered_root_refuses() {
    assert_eq!(
        refused(
            registry_document_raw("proj-a", "C:\\dev\\..\\dev\\repo"),
            "proj-a"
        ),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::RootTraversal)
    );
}

#[test]
fn a_registered_root_that_is_not_there_refuses() {
    let absent = format!("C:\\pos-trusted-roots-absent-{}", std::process::id());

    assert_eq!(
        refused(registry_document_raw("proj-a", &absent), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::RootNotADirectory)
    );
}

#[test]
fn two_entries_claiming_one_root_refuse_the_whole_registry() {
    let tree = TempTree::new("gp-duplicate");
    let repo = make_repository(&tree, "repo-a", "proj-a");

    // Not "the second one loses": a registry that is self-contradictory governs nothing.
    assert_eq!(
        refused(
            registry_document(&[("proj-a", &repo), ("proj-b", &repo)]),
            "proj-a"
        ),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::DuplicateRepositoryRoot)
    );
}

#[test]
fn a_malformed_registry_refuses() {
    assert_eq!(
        refused(b"{".to_vec(), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::Malformed)
    );
}

#[test]
fn a_registry_of_an_unknown_schema_version_refuses() {
    assert_eq!(
        refused(b"{\"schemaVersion\":2,\"projects\":[]}".to_vec(), "proj-a"),
        TrustedRootRefusal::RegistryRefused(RegistryRefusal::UnsupportedVersion)
    );
}

#[test]
fn an_empty_registry_governs_nothing() {
    assert_eq!(
        refused(b"{\"schemaVersion\":1,\"projects\":[]}".to_vec(), "proj-a"),
        TrustedRootRefusal::ProjectNotRegistered
    );
}

#[test]
fn revalidation_of_an_untouched_governed_root_succeeds() {
    let tree = TempTree::new("gp-revalidate");
    let repo = make_repository(&tree, "repo-a", "proj-a");

    let root = resolve(registry_document(&[("proj-a", &repo)]), "proj-a").expect("governed root");

    assert_eq!(root.revalidate(), Ok(()));
}

#[test]
fn resolution_writes_nothing_into_the_governed_repository() {
    let tree = TempTree::new("gp-readonly");
    let repo = make_repository(&tree, "repo-a", "proj-a");
    let before = listing(&repo);

    let _root = resolve(registry_document(&[("proj-a", &repo)]), "proj-a").expect("governed root");

    // NO LEDGER IS TOUCHED. Resolution reads the registry document and the project's own
    // configuration; it does not create `.projectops/gatekeeper-ledger.json`, take its lock, or add
    // anything else to the repository.
    assert_eq!(listing(&repo), before);
    assert!(!repo.join(".projectops/gatekeeper-ledger.json").exists());
    assert!(!repo.join(".projectops/gatekeeper-ledger.lock").exists());
}

fn listing(root: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(root)
        .expect("read dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}
