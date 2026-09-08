//! THE PROTECTED INSTALLATION BOUNDARY MINT — §10F, proven against DISPOSABLE roots.
//!
//! NOTHING HERE TOUCHES THE REAL PROGRAMDATA BOUNDARY. Every root is a `ProjectOS\host` pair created
//! under the process temp directory and removed when the guard drops, and NOTHING here changes a
//! security descriptor at all - these tests only create, remove and observe disposable directories.
//! The proofs that need a descriptor APPLIED, and the read-only observation of the real installed
//! boundary, live in `tests/`, because building those fixtures needs a process launch and a process
//! launch has no business in this crate's own sources.
//!
//! WHAT IS FIXTURE AND WHAT IS PRODUCTION. Only the ANCHOR is substituted — a disposable directory
//! instead of the resolved Known Folder. Everything after that is the shipped path, unmodified: the
//! segment composition, the ancestor walk, the custody opens, the canonical settling, the LIVE
//! `NT SERVICE\ProjectOSHost` SID resolution, the accepted production policy composition, the real
//! `GetSecurityInfo` observation and the accepted verifier's judgement.
//!
//! WHY THESE ROOTS REFUSE, AND WHY THAT IS THE POINT. A directory created under `%TEMP%` inherits
//! its parent's DACL, is owned by the creating user, and lists principals the accepted policy does
//! not. It is a perfectly ordinary directory — and it is exactly what an attacker would substitute
//! for a protected boundary. Every one of these tests says the same thing: a resolved root is not an
//! accepted boundary, and only an observed conforming descriptor makes it one.

#![cfg(windows)]

use projectos_host_windows_acl_policy::AclViolation;

use super::TempTree;
use crate::activation::boundary::BoundaryRefusal;
use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};
use crate::refusal::TrustedRootRefusal;
use crate::{
    FixtureInstallationAnchor, ProtectedInstallationBoundaryAcceptance, TrustedGovernedProjectRoot,
    TrustedHostStateRoot,
};

/// The `ProjectOS\host` pair beneath a disposable anchor, resolved through the REAL resolver.
fn disposable_host_root(tree: &TempTree) -> TrustedHostStateRoot {
    tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"));
    TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("disposable host state root")
}

/// The findings for a root that was read but did not conform. Any other outcome fails the test,
/// including acceptance.
fn non_conformance(root: &TrustedHostStateRoot) -> Vec<AclViolation> {
    match ProtectedInstallationBoundaryAcceptance::verify(root) {
        Err(BoundaryRefusal::NonConforming(v)) => v,
        other => panic!("expected a read, non-conforming boundary; got {other:?}"),
    }
}

/// A1 — AN ORDINARY DIRECTORY IS NOT A BOUNDARY, and the mint says so in the verifier's own terms.
///
/// This is the whole phase in one test. The root resolves perfectly: the anchor answered, the frozen
/// segments composed, no level was a reparse point, custody holds the leaf, and the canonical path
/// settled. §10E would call that a trusted root, and it is one. It is still not an accepted
/// boundary, because the descriptor Windows actually returned is a user-owned, inherited,
/// unprotected DACL naming principals the accepted policy does not permit.
#[test]
fn a_resolved_but_unprotected_root_is_read_and_refused() {
    let tree = TempTree::new("boundary-unprotected");
    let root = disposable_host_root(&tree);

    let found = non_conformance(&root);

    // WRONG OWNER. The accepted policy requires `NT AUTHORITY\SYSTEM`; a temp directory is owned by
    // whoever created it.
    assert!(
        found.contains(&AclViolation::OwnerMismatch),
        "expected an owner mismatch, got {found:?}"
    );
    // INHERITANCE WHERE POLICY FORBIDS IT. `AclPolicy::strict` requires `SE_DACL_PROTECTED`.
    assert!(
        found.contains(&AclViolation::DaclNotProtected),
        "expected an unprotected DACL, got {found:?}"
    );
    // AN UNEXPECTED WRITE-CAPABLE PRINCIPAL. The creating user holds an ACE the policy never lists.
    assert!(
        found.contains(&AclViolation::UnknownPrincipal),
        "expected an unknown principal, got {found:?}"
    );
}

/// A2 — A ROOT THAT VANISHES BETWEEN RESOLUTION AND THE MINT IS REFUSED, NOT ASSUMED.
///
/// The first revalidation is what catches this, and it runs BEFORE the service SID is resolved and
/// before any descriptor is read — so a boundary that no longer exists never reaches the verifier at
/// all. It is reported as a ROOT failure rather than as a non-conformance, because "the directory is
/// gone" and "the directory's ACL is wrong" are different repairs.
#[test]
fn a_root_removed_after_resolution_is_refused_as_a_root_failure() {
    let tree = TempTree::new("boundary-removed");
    let root = disposable_host_root(&tree);
    std::fs::remove_dir_all(tree.path().join(PRODUCT_SEGMENT)).expect("remove the disposable root");

    match ProtectedInstallationBoundaryAcceptance::verify(&root) {
        Err(BoundaryRefusal::Root(TrustedRootRefusal::RootMissing)) => {}
        other => panic!("expected a missing root to be refused as a root failure; got {other:?}"),
    }
}

/// A3 — A REPLACED ROOT IS REFUSED.
///
/// Same pathname, different object. Custody captured a handle-derived identity at resolution, and
/// the revalidation compares the object the pathname NOW denotes against it. A boundary whose
/// directory was destroyed and recreated — the cheapest way to drop a protected DACL and start again
/// with an inherited one — is therefore refused before its descriptor is ever read.
#[test]
fn a_root_replaced_by_a_new_directory_is_refused() {
    let tree = TempTree::new("boundary-replaced");
    let root = disposable_host_root(&tree);
    let leaf = tree.path().join(PRODUCT_SEGMENT).join(HOST_STATE_SEGMENT);
    std::fs::remove_dir_all(&leaf).expect("remove the leaf");
    std::fs::create_dir_all(&leaf).expect("recreate the leaf");

    match ProtectedInstallationBoundaryAcceptance::verify(&root) {
        Err(BoundaryRefusal::Root(
            TrustedRootRefusal::RootIdentityDrift | TrustedRootRefusal::RootMissing,
        )) => {}
        other => panic!("expected a replaced root to be refused; got {other:?}"),
    }
}

/// A4 — REPEATED REFUSAL IS STABLE, AND NEVER DRIFTS INTO ACCEPTANCE.
///
/// A gate that fails closed once and open later is not a gate. Nothing in the sequence caches, and
/// the SID resolution, the observation and the judgement all happen again on every call.
#[test]
fn refusal_is_stable_across_repeated_calls() {
    let tree = TempTree::new("boundary-stable");
    let root = disposable_host_root(&tree);

    let first = non_conformance(&root);
    for _ in 0..4 {
        assert_eq!(non_conformance(&root), first);
    }
}

/// A5 — THE HOST STATE BOUNDARY AND THE GOVERNED PROJECT ROOT STAY DISTINCT.
///
/// The governed repository is USER-WRITABLE BY DESIGN — the agent writes its ledger there — so the
/// Host ProgramData policy is neither applied to it nor asserted of it. What acceptance buys is
/// trust in the INSTALLED-PROJECT REGISTRY, which lives inside the protected subtree and is what
/// says which repository this installation may govern. This test pins both halves: the two roots are
/// different directories, and the repository is NOT judged against the Host policy — a repository
/// with an ordinary user DACL activates perfectly well once the boundary is accepted.
#[test]
fn the_governed_project_root_is_not_judged_against_the_host_boundary_policy() {
    use super::{make_repository, registry_document, undecorated};
    use crate::{ActivatedGovernedProjectRoot, FixtureProjectRegistry};

    let tree = TempTree::new("boundary-two-roots");
    let host = disposable_host_root(&tree);
    let repo = make_repository(&tree, "repo-a", "proj-a");
    let project = TrustedGovernedProjectRoot::resolve(
        &FixtureProjectRegistry::new(registry_document(&[("proj-a", &repo)])),
        "proj-a",
    )
    .expect("governed root");

    assert_ne!(undecorated(host.path()), undecorated(project.path()));

    // The repository has the ordinary user-writable DACL every repository has, and that is not a
    // defect to be corrected — the Host boundary is judged, the repository is not.
    let accepted = ProtectedInstallationBoundaryAcceptance::fixture();
    let activated = ActivatedGovernedProjectRoot::activate(project, &accepted);
    assert_eq!(undecorated(activated.path()), undecorated(&repo));
    assert_eq!(activated.project_id(), "proj-a");
}
