//! §10H — the activation chain, proven over disposable trees.
//!
//! Nothing here resolves, reads or writes the live ProgramData directory. Every anchor is a
//! directory this test owns under the process temp directory, removed when its guard drops. The
//! boundary is judged either by the REAL §10F verifier — which must refuse a disposable tree — or by
//! the trusted-roots fixture acceptance, which exists only in this crate's dev-dependency graph and
//! proves the shape below the gate.

use std::path::PathBuf;

use projectos_host_trusted_roots::{
    BoundaryRefusal, FixtureInstallationAnchor, HostStateStore, HostStoreCustody,
    ProtectedInstallationBoundaryAcceptance, TrustedHostStateRoot,
};

use super::{activate, HostStateActivationRefusal};
use crate::operation_contract::request_replay::durable_store::REQUEST_REPLAY_RELATIVE_ROOT;
use crate::operation_contract::request_replay::{ReplayRefusal, RequestReplayIdentity};
use crate::owner_programme_delegation::durable_store::{
    DelegationStoreRefusal, DELEGATION_STATE_RELATIVE_ROOT,
};

/// A disposable tree this test owns outright, removed when the guard drops.
struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(tag: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("pos-10h-activation-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp tree");
        Self { path }
    }

    /// Lay out `<tree>\ProjectOS\host`, the frozen Host state segments, and return it.
    fn host_root(&self) -> PathBuf {
        let leaf = self.path.join("ProjectOS").join("host");
        std::fs::create_dir_all(&leaf).expect("host state layout");
        leaf
    }

    fn anchor(&self) -> FixtureInstallationAnchor {
        FixtureInstallationAnchor::new(&self.path)
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn fixture_acceptance(
    _root: &TrustedHostStateRoot,
) -> Result<ProtectedInstallationBoundaryAcceptance, BoundaryRefusal> {
    Ok(ProtectedInstallationBoundaryAcceptance::fixture())
}

fn must_not_be_consulted(
    _root: &TrustedHostStateRoot,
) -> Result<ProtectedInstallationBoundaryAcceptance, BoundaryRefusal> {
    panic!("the boundary was consulted for a root that never resolved");
}

#[test]
fn an_unresolved_root_refuses_before_the_boundary_is_consulted() {
    let tree = TempTree::new("unresolved");

    let err = activate(&tree.anchor(), must_not_be_consulted).expect_err("no layout, no root");

    assert!(
        matches!(err, HostStateActivationRefusal::RootUnresolved(_)),
        "{err:?}"
    );
    assert!(
        !tree.path.join("ProjectOS").exists(),
        "a refused activation manufactured part of the Host state layout"
    );
}

#[test]
fn the_real_boundary_verifier_refuses_a_disposable_root_and_no_store_is_opened() {
    let tree = TempTree::new("real-verifier");
    let host = tree.host_root();

    // The PRODUCTION verifier, unmodified. A temp directory is neither SYSTEM-owned nor carrying the
    // accepted protected DACL, so whatever this machine's service identity resolves to, the answer
    // must be a refusal - and it must come before either store is laid out.
    let err = activate(
        &tree.anchor(),
        ProtectedInstallationBoundaryAcceptance::verify,
    )
    .expect_err("a user-owned temp directory is not the protected installation boundary");

    assert!(
        matches!(err, HostStateActivationRefusal::BoundaryNotAccepted(_)),
        "{err:?}"
    );
    assert!(!host.join(DELEGATION_STATE_RELATIVE_ROOT).exists());
    assert!(!host.join(REQUEST_REPLAY_RELATIVE_ROOT).exists());
}

#[test]
fn an_accepted_boundary_opens_both_stores_beneath_the_resolved_root_and_grants_nothing() {
    let tree = TempTree::new("accepted");
    let host = tree.host_root();

    let mut state = activate(&tree.anchor(), fixture_acceptance).expect("activates");

    assert!(host.join(DELEGATION_STATE_RELATIVE_ROOT).is_dir());
    assert!(host.join(REQUEST_REPLAY_RELATIVE_ROOT).is_dir());
    state.revalidate().expect("still the resolved root");
    // A machine location must not reach a log because something printed the state: the root and
    // both stores redact, so the whole value does.
    let shown = format!("{state:?}").to_lowercase();
    let tree_text = tree.path.to_string_lossy().to_lowercase();
    assert!(
        !shown.contains(&tree_text),
        "Debug leaked the root: {shown}"
    );
    assert!(
        !shown.contains("projectos"),
        "Debug leaked a path segment: {shown}"
    );
    // An activated store knows no delegation. Activation is durability, not authority.
    let (delegation, _replay) = state.stores_for_composition();
    assert!(delegation.recorded_state(&[0u8; 32]).is_none());
}

#[test]
fn a_root_moved_after_acceptance_opens_no_store() {
    fn accept_then_move(
        root: &TrustedHostStateRoot,
    ) -> Result<ProtectedInstallationBoundaryAcceptance, BoundaryRefusal> {
        // The substitution happens AFTER the boundary was judged - the window the handoff
        // revalidation exists for.
        std::fs::rename(root.path(), root.path().with_file_name("host-moved"))
            .expect("move the accepted root");
        Ok(ProtectedInstallationBoundaryAcceptance::fixture())
    }
    let tree = TempTree::new("moved");
    let host = tree.host_root();
    let moved = host.with_file_name("host-moved");

    let err = activate(&tree.anchor(), accept_then_move).expect_err("the root moved");

    assert!(
        matches!(
            err,
            HostStateActivationRefusal::RootChangedAfterAcceptance(_)
        ),
        "{err:?}"
    );
    assert!(moved.is_dir(), "the move really happened");
    for dir in [&host, &moved] {
        assert!(!dir.join(DELEGATION_STATE_RELATIVE_ROOT).exists());
        assert!(!dir.join(REQUEST_REPLAY_RELATIVE_ROOT).exists());
    }
}

#[test]
fn a_delegation_store_that_cannot_open_stops_the_chain_before_the_replay_store() {
    let tree = TempTree::new("delegation-blocked");
    let host = tree.host_root();
    // A FILE where the delegation leaf belongs, so that store cannot lay itself out.
    std::fs::write(
        host.join(DELEGATION_STATE_RELATIVE_ROOT),
        b"not a directory",
    )
    .unwrap();

    let err = activate(&tree.anchor(), fixture_acceptance).expect_err("delegation leaf blocked");

    assert!(
        matches!(
            err,
            HostStateActivationRefusal::DelegationStoreUnavailable(_)
        ),
        "{err:?}"
    );
    assert!(
        !host.join(REQUEST_REPLAY_RELATIVE_ROOT).exists(),
        "the chain continued past the first refusal"
    );
}

#[test]
fn a_replay_store_that_cannot_open_releases_the_delegation_store_it_opened() {
    let tree = TempTree::new("replay-blocked");
    let host = tree.host_root();
    let blocker = host.join(REQUEST_REPLAY_RELATIVE_ROOT);
    std::fs::write(&blocker, b"not a directory").unwrap();

    let err = activate(&tree.anchor(), fixture_acceptance).expect_err("replay leaf blocked");
    assert!(
        matches!(err, HostStateActivationRefusal::ReplayStoreUnavailable(_)),
        "{err:?}"
    );
    // The delegation store DID open before the refusal. Had it survived, its single-writer lock
    // would refuse the next activation; that it does not is the proof nothing outlived the refusal.
    assert!(host.join(DELEGATION_STATE_RELATIVE_ROOT).is_dir());
    std::fs::remove_file(&blocker).unwrap();
    let _state =
        activate(&tree.anchor(), fixture_acceptance).expect("the refused attempt held nothing");
}

#[test]
fn a_second_activation_while_one_lives_is_refused_by_the_single_writer_lock() {
    let tree = TempTree::new("second");
    tree.host_root();

    let first = activate(&tree.anchor(), fixture_acceptance).expect("first activation");
    let err = activate(&tree.anchor(), fixture_acceptance).expect_err("a second authority");
    assert!(
        matches!(
            err,
            HostStateActivationRefusal::DelegationStoreUnavailable(_)
        ),
        "{err:?}"
    );

    drop(first);
    let _again = activate(&tree.anchor(), fixture_acceptance).expect("released on drop");
}

// ---------------------------------------------------------------------------------------------
// §10I — FIRST-START CUSTODY
// ---------------------------------------------------------------------------------------------

#[test]
fn a_first_activation_creates_both_stores_under_the_committed_custody() {
    let tree = TempTree::new("custody");
    let host = tree.host_root();

    let _state = activate(&tree.anchor(), fixture_acceptance).expect("activates");

    // Judged independently, from Windows: both store directories and every object the engine laid
    // out — subdirectories and lock file — carry the committed owner and protected DACL.
    let custody = HostStoreCustody::fixture(&host);
    for store in [
        HostStateStore::DelegationLifecycle,
        HostStateStore::RequestReplay,
    ] {
        let governed = custody.establish(store).expect("conforming");
        for fixed in ["records", "temp", "journal", "store.lock"] {
            assert!(governed.path().join(fixed).exists(), "{fixed} laid out");
        }
        governed.verify_contents().expect("every object conforms");
    }
}

#[test]
fn an_ambient_delegation_store_left_by_an_earlier_start_refuses_before_running() {
    let tree = TempTree::new("ambient-delegation");
    let host = tree.host_root();
    // What a pre-§10I first start would have left: a store directory with the token's defaults.
    std::fs::create_dir(host.join(DELEGATION_STATE_RELATIVE_ROOT)).unwrap();

    let err = activate(&tree.anchor(), fixture_acceptance).expect_err("ambient custody");
    assert_eq!(
        err,
        HostStateActivationRefusal::DelegationStoreUnavailable(
            DelegationStoreRefusal::CustodyRefused
        )
    );
    assert!(!host.join(REQUEST_REPLAY_RELATIVE_ROOT).exists());
    // Refused, not repaired: the next start refuses for the same reason.
    assert_eq!(
        activate(&tree.anchor(), fixture_acceptance).expect_err("still ambient"),
        err
    );
}

#[test]
fn an_ambient_replay_store_refuses_and_releases_the_delegation_store_it_opened() {
    let tree = TempTree::new("ambient-replay");
    let host = tree.host_root();
    let ambient = host.join(REQUEST_REPLAY_RELATIVE_ROOT);
    std::fs::create_dir(&ambient).unwrap();

    let err = activate(&tree.anchor(), fixture_acceptance).expect_err("ambient custody");
    assert_eq!(
        err,
        HostStateActivationRefusal::ReplayStoreUnavailable(ReplayRefusal::CustodyRefused)
    );
    // Only an operator removing the ambient history lets the Host start; the delegation store
    // opened before the refusal held nothing afterwards.
    std::fs::remove_dir(&ambient).unwrap();
    let _state = activate(&tree.anchor(), fixture_acceptance).expect("governed now");
}

#[test]
fn a_request_consumed_through_the_activated_state_stays_consumed_across_a_restart() {
    let tree = TempTree::new("restart");
    tree.host_root();
    let identity = RequestReplayIdentity::fixture_over(&[1u8; 32], &[2u8; 32], &[3u8; 32]);

    {
        let mut state = activate(&tree.anchor(), fixture_acceptance).expect("first start");
        let (_delegation, replay) = state.stores_for_composition();
        assert!(replay.consume(&identity).is_ok(), "fresh on first sight");
    }

    let mut restarted = activate(&tree.anchor(), fixture_acceptance).expect("second start");
    let (_delegation, replay) = restarted.stores_for_composition();
    assert!(matches!(
        replay.consume(&identity),
        Err(ReplayRefusal::AlreadyConsumed)
    ));
}
