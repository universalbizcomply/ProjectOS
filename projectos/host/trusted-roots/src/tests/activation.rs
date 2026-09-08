//! The activation gate, and the runtime half of the two-root distinction.
//!
//! The COMPILE-TIME half — that neither activated type accepts the other's root, that neither
//! trusted root has a path-taking constructor, and that the boundary acceptance cannot be conjured —
//! is proven by the `compile_fail` doctests on the crate root. What is proven here is the part a
//! type system cannot state: that the two roots are different DIRECTORIES, resolved from different
//! authorities, and that activation adds a fact rather than a path.

#![cfg(windows)]

use super::{make_repository, registry_document, undecorated, TempTree};
use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};
use crate::{
    ActivatedGovernedProjectRoot, ActivatedHostStateRoot, FixtureInstallationAnchor,
    FixtureProjectRegistry, ProtectedInstallationBoundaryAcceptance, TrustedGovernedProjectRoot,
    TrustedHostStateRoot,
};

#[test]
fn activation_carries_the_resolved_host_state_root_and_adds_no_path() {
    let tree = TempTree::new("act-host");
    let expected = tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"));
    let trusted = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("host state root");
    let resolved = trusted.path().to_path_buf();

    let activated = ActivatedHostStateRoot::activate(
        trusted,
        &ProtectedInstallationBoundaryAcceptance::fixture(),
    );

    assert_eq!(activated.path(), resolved.as_path());
    assert_eq!(undecorated(activated.path()), undecorated(&expected));
    assert_eq!(activated.revalidate(), Ok(()));
}

#[test]
fn activation_carries_the_resolved_governed_root_its_id_and_adds_no_path() {
    let tree = TempTree::new("act-project");
    let repo = make_repository(&tree, "repo-a", "proj-a");
    let trusted = TrustedGovernedProjectRoot::resolve(
        &FixtureProjectRegistry::new(registry_document(&[("proj-a", &repo)])),
        "proj-a",
    )
    .expect("governed root");
    let resolved = trusted.path().to_path_buf();

    let activated = ActivatedGovernedProjectRoot::activate(
        trusted,
        &ProtectedInstallationBoundaryAcceptance::fixture(),
    );

    assert_eq!(activated.path(), resolved.as_path());
    assert_eq!(activated.project_id(), "proj-a");
    assert_eq!(undecorated(activated.path()), undecorated(&repo));
}

#[test]
fn the_host_state_root_and_the_governed_project_root_are_different_directories() {
    // ONE TREE, BOTH ROOTS, DIFFERENT ANSWERS. The point is not that a test can build them apart:
    // it is that even resolved from the same disposable tree, the two authorities land in different
    // places, because they are composed from different facts — frozen segments beneath an anchor,
    // versus a registry entry cross-checked against a repository's own configuration.
    let tree = TempTree::new("act-distinct");
    tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"));
    let repo = make_repository(&tree, "repo-a", "proj-a");

    let host = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("host state root");
    let project = TrustedGovernedProjectRoot::resolve(
        &FixtureProjectRegistry::new(registry_document(&[("proj-a", &repo)])),
        "proj-a",
    )
    .expect("governed root");

    assert_ne!(undecorated(host.path()), undecorated(project.path()));
    // Neither is beneath the other, so a consumer cannot reach one by walking from the other.
    assert!(!undecorated(host.path()).starts_with(&undecorated(project.path())));
    assert!(!undecorated(project.path()).starts_with(&undecorated(host.path())));
}

#[test]
fn a_governed_repository_laid_out_like_the_host_state_root_is_still_not_it() {
    // THE SHAPE IS NOT THE AUTHORITY. A repository that happens to contain `ProjectOS\host` gains
    // nothing by it: the Host state root is composed beneath the INSTALLATION ANCHOR, and a
    // registered repository is never an anchor.
    let tree = TempTree::new("act-lookalike");
    let repo = make_repository(&tree, "repo-a", "proj-a");
    std::fs::create_dir_all(repo.join(PRODUCT_SEGMENT).join(HOST_STATE_SEGMENT))
        .expect("look-alike layout");

    let project = TrustedGovernedProjectRoot::resolve(
        &FixtureProjectRegistry::new(registry_document(&[("proj-a", &repo)])),
        "proj-a",
    )
    .expect("governed root");

    // Resolving the project yields the REPOSITORY, never the decoy beneath it.
    assert_eq!(undecorated(project.path()), undecorated(&repo));

    // And the Host state root resolved from the real anchor is not inside that repository.
    tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"));
    let host = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("host state root");
    assert!(!undecorated(host.path()).starts_with(&undecorated(&repo)));
}
