//! THE §10E WIRING, END TO END: a resolved root reaching all three durable seams.
//!
//! ## What this file proves that the trusted-roots crate cannot
//!
//! That crate proves the roots RESOLVE and refuse. This proves the three capabilities this crate
//! owns can be minted from them, that each lands in the right place, and — the part that matters
//! most — that the two root classes cannot be crossed over: the Host state root reaches the
//! delegation and replay stores and CANNOT reach the canonical ledger, while the governed project
//! root reaches the ledger and CANNOT reach either store. Those are type errors, restated here as
//! executable evidence that the wiring actually uses the types that way.
//!
//! ## Disposable roots only
//!
//! Every directory here is created under the process temp directory and removed when the guard
//! drops. Nothing resolves, reads, creates or writes the live ProjectOS ProgramData directory, the
//! live installed-project registry, a real governed repository, the real canonical
//! `.projectops/gatekeeper-ledger.json`, or its lock. No service is started, no ACL is read or
//! changed, no credential is touched and no provider is contacted.
//!
//! The BOUNDARY ACCEPTANCE used here is the trusted-roots fixture, enabled through this crate's
//! dev-dependencies so it exists in no graph a consumer can select. That is the whole reason a
//! default build still cannot reach any of this.

#![cfg(windows)]

use std::path::{Path, PathBuf};

use projectos_host_trusted_roots::{
    ActivatedGovernedProjectRoot, ActivatedHostStateRoot, FixtureInstallationAnchor,
    FixtureProjectRegistry, ProtectedInstallationBoundaryAcceptance, TrustedGovernedProjectRoot,
    TrustedHostStateRoot,
};
use projectos_host_windows_local_ipc::{
    DurableDelegationStateFileStore, DurableRequestReplayFileStore, HostOwnedDelegationStateRoot,
    HostOwnedGatekeeperProjectRoot, HostOwnedRequestReplayRoot, DELEGATION_STATE_RELATIVE_ROOT,
    REQUEST_REPLAY_RELATIVE_ROOT,
};

/// A disposable tree this test owns outright, removed when the guard drops.
struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(tag: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pos-10e-wiring-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp tree");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn undecorated(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\")
        .unwrap_or(&text)
        .replace('/', "\\")
        .to_lowercase()
}

/// Lay out `<tree>/ProjectOS/host` and resolve it as the Host state root.
fn activated_host_state_root(tree: &TempTree) -> (ActivatedHostStateRoot, PathBuf) {
    let leaf = tree.path().join("ProjectOS").join("host");
    std::fs::create_dir_all(&leaf).expect("host state layout");
    let trusted = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("host state root resolves");
    (
        ActivatedHostStateRoot::activate(
            trusted,
            &ProtectedInstallationBoundaryAcceptance::fixture(),
        ),
        leaf,
    )
}

/// Lay out a governed repository and resolve it through the real registry validator.
fn activated_governed_project_root(tree: &TempTree) -> (ActivatedGovernedProjectRoot, PathBuf) {
    let repo = tree.path().join("repo-a");
    std::fs::create_dir_all(repo.join(".projectops")).expect("repo layout");
    std::fs::write(repo.join(".git"), b"gitdir: elsewhere\n").expect("git marker");
    std::fs::write(
        repo.join(".projectops").join("project-config.json"),
        b"{\"projectId\":\"proj-a\",\"projectName\":\"Fixture\"}",
    )
    .expect("project config");
    let document = format!(
        "{{\"schemaVersion\":1,\"projects\":[{{\"projectId\":\"proj-a\",\"repositoryRoot\":\"{}\",\
         \"permittedEnvironments\":[\"development\"],\"productionFrozen\":false}}]}}",
        repo.to_string_lossy().replace('\\', "\\\\")
    )
    .into_bytes();
    let trusted =
        TrustedGovernedProjectRoot::resolve(&FixtureProjectRegistry::new(document), "proj-a")
            .expect("governed project root resolves");
    (
        ActivatedGovernedProjectRoot::activate(
            trusted,
            &ProtectedInstallationBoundaryAcceptance::fixture(),
        ),
        repo,
    )
}

#[test]
fn a_resolved_host_state_root_opens_the_durable_delegation_store() {
    let tree = TempTree::new("delegation");
    let (activated, leaf) = activated_host_state_root(&tree);

    let root = HostOwnedDelegationStateRoot::from_activated(&activated).expect("mint revalidates");
    let store = DurableDelegationStateFileStore::open(&root).expect("delegation store opens");

    // The store laid out its own frozen leaf BENEATH the resolved Host state root, and nowhere else.
    assert!(leaf.join(DELEGATION_STATE_RELATIVE_ROOT).is_dir());
    // An open store knows no delegation. Resolving a root grants nothing.
    assert_eq!(store.current_revision(), 0);
}

#[test]
fn a_resolved_host_state_root_opens_the_durable_replay_store() {
    let tree = TempTree::new("replay");
    let (activated, leaf) = activated_host_state_root(&tree);

    let root = HostOwnedRequestReplayRoot::from_activated(&activated).expect("mint revalidates");
    let _store = DurableRequestReplayFileStore::open(&root).expect("replay store opens");

    assert!(leaf.join(REQUEST_REPLAY_RELATIVE_ROOT).is_dir());
}

#[test]
fn the_two_state_leaves_are_separate_beneath_one_resolved_root() {
    let tree = TempTree::new("both");
    let (activated, leaf) = activated_host_state_root(&tree);

    let delegation_root =
        HostOwnedDelegationStateRoot::from_activated(&activated).expect("mint revalidates");
    let replay_root =
        HostOwnedRequestReplayRoot::from_activated(&activated).expect("mint revalidates");
    let delegation =
        DurableDelegationStateFileStore::open(&delegation_root).expect("delegation store opens");
    let replay = DurableRequestReplayFileStore::open(&replay_root).expect("replay store opens");

    // ONE state root, TWO frozen leaves. Neither family can read or overwrite the other's records,
    // and each can carry its own narrow ACE when the installer ACLs the state root.
    assert_ne!(DELEGATION_STATE_RELATIVE_ROOT, REQUEST_REPLAY_RELATIVE_ROOT);
    assert!(leaf.join(DELEGATION_STATE_RELATIVE_ROOT).is_dir());
    assert!(leaf.join(REQUEST_REPLAY_RELATIVE_ROOT).is_dir());
    drop((delegation, replay));
}

#[test]
fn a_resolved_governed_project_root_names_the_repository_and_touches_no_ledger() {
    let tree = TempTree::new("ledger");
    let (activated, repo) = activated_governed_project_root(&tree);

    let root =
        HostOwnedGatekeeperProjectRoot::from_activated(&activated).expect("mint revalidates");

    // Minting the capability opens, locks and reads NOTHING: the canonical transaction happens
    // inside each ledger call, and no call is made here.
    assert!(!repo
        .join(".projectops")
        .join("gatekeeper-ledger.json")
        .exists());
    assert!(!repo
        .join(".projectops")
        .join("gatekeeper-ledger.lock")
        .exists());
    // The capability is the repository the registry attested, not the Host's own state root.
    assert_eq!(undecorated(activated.path()), undecorated(&repo));
    assert_eq!(activated.project_id(), "proj-a");
    let _ = root;
}

#[test]
fn the_host_state_root_and_the_governed_project_root_reach_different_seams() {
    let tree = TempTree::new("crossover");
    let (host, host_leaf) = activated_host_state_root(&tree);
    let (project, repo) = activated_governed_project_root(&tree);

    // Both capabilities exist at once, and they name different directories.
    let _delegation =
        HostOwnedDelegationStateRoot::from_activated(&host).expect("mint revalidates");
    let _replay = HostOwnedRequestReplayRoot::from_activated(&host).expect("mint revalidates");
    let _ledger =
        HostOwnedGatekeeperProjectRoot::from_activated(&project).expect("mint revalidates");

    assert_ne!(undecorated(host.path()), undecorated(project.path()));
    assert_eq!(undecorated(host.path()), undecorated(&host_leaf));
    assert_eq!(undecorated(project.path()), undecorated(&repo));

    // THE CROSSOVER IS A COMPILE ERROR, not a runtime check. Neither of these compiles, in any build:
    //
    //     HostOwnedDelegationStateRoot::from_activated(&project);   // project root -> state store
    //     HostOwnedGatekeeperProjectRoot::from_activated(&host);    // state root  -> canonical ledger
    //
    // What is asserted here is the consequence: the durable state never lands in a governed
    // repository, and the canonical ledger transaction never lands in the protected installation
    // subtree.
    assert!(!undecorated(&host_leaf).starts_with(&undecorated(&repo)));
    assert!(!undecorated(&repo).starts_with(&undecorated(&host_leaf)));
}

#[test]
fn an_unlaid_out_host_state_root_never_becomes_a_store() {
    let tree = TempTree::new("absent");

    // No `ProjectOS\host` beneath the anchor: resolution refuses, so there is nothing to activate
    // and no capability to mint. The failure happens before any store is reachable.
    assert!(TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path())).is_err());
    assert!(!tree.path().join("ProjectOS").exists());
}
