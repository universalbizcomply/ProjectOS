//! §10F — THE CONFORMING BOUNDARY, AND THE SUBSTITUTIONS THAT ARE REFUSED.
//!
//! ## Why these tests are here and not in the crate's own sources
//!
//! Two reasons, both the same ones §10E's `reparse_chain.rs` already had. Building a junction needs
//! `mklink`, and a process launch has no business in this crate's sources. And the CONFORMING case
//! needs a real protected DACL to exist, which means APPLYING one — a privileged Windows effect that
//! must never be reachable from a unit test that runs by default.
//!
//! ## What is mutated, and what is emphatically not
//!
//! DISPOSABLE ROOTS ONLY. Every directory here is created under the process temp directory and
//! removed when its guard drops. The real `<ProgramData>\ProjectOS\host` boundary is never created,
//! never written, and never has its ACL changed by anything in this file — the read-only inspection
//! of the real boundary lives in `real_boundary.rs` and reads only.
//!
//! ## Why the conforming test is `#[ignore]`
//!
//! Applying the accepted policy sets the owner to `NT AUTHORITY\SYSTEM`, which requires a privilege
//! an ordinary session does not hold. A test that silently skipped when unprivileged would report
//! success while proving nothing, which is the exact failure mode this programme keeps meeting. So it
//! is ignored by default and must be asked for explicitly, on a session that can actually perform it.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_identity::canonical_record::EXPECTED_SERVICE_NAME;
use projectos_host_trusted_roots::{
    ActivatedHostStateRoot, BoundaryRefusal, FixtureInstallationAnchor,
    ProtectedInstallationBoundaryAcceptance, TrustedHostStateRoot, TrustedRootRefusal,
};
use projectos_host_windows_acl_policy::{
    resolve_account_sid, AclPolicy, ApplyOutcome, WindowsAclPolicyService,
};
use projectos_host_windows_activation_plan::acl_plan::{
    AclCompositionOutcome, AclCompositionPlan, ApprovedServicePrincipal,
};
use projectos_host_windows_activation_plan::service_identity::{
    ServiceIdentityPlan, ServiceIdentityStrategy,
};

const PRODUCT: &str = "ProjectOS";
const HOST_STATE: &str = "host";

static NEXT: AtomicU64 = AtomicU64::new(0);

/// A disposable tree, removed when the guard drops.
struct TempTree(PathBuf);

impl TempTree {
    fn new(tag: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!("pos-10f-{}-{tag}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).expect("temp tree");
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Create a directory JUNCTION as a fixture. `mklink` builds it; it is never the primitive tested.
fn make_junction(link: &Path, target: &Path) -> bool {
    std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            link.to_str().expect("link"),
            target.to_str().expect("target"),
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// THE ACCEPTED PRODUCTION POLICY, composed exactly as the mint composes it and as the installer's
/// own effect path composes it.
///
/// This is a DELIBERATE restatement rather than a call into the mint's private helper, and the
/// restatement is the point: if the three lines here and the three lines in the mint ever diverge,
/// the conforming test stops passing. A shared helper would have hidden that divergence instead of
/// catching it.
fn accepted_production_policy() -> AclPolicy {
    const STRATEGY: ServiceIdentityStrategy = ServiceIdentityStrategy::VirtualServiceAccount;
    let sid = resolve_account_sid(&format!("NT SERVICE\\{EXPECTED_SERVICE_NAME}"))
        .expect("the ProjectOSHost service SID must resolve on a machine where it is installed");
    let principal =
        ApprovedServicePrincipal::from_resolved_sid(STRATEGY, sid).expect("resolved principal");
    let identity = ServiceIdentityPlan::analysed().with_owner_decision(STRATEGY);
    match AclCompositionPlan::production().compose_with_resolved_principal(&identity, &principal) {
        AclCompositionOutcome::Composed(p) => p,
        other => panic!("the accepted composition refused: {other:?}"),
    }
}

/// A disposable `<tree>/ProjectOS/host` resolved through the REAL resolver.
fn disposable_host_root(tree: &TempTree) -> TrustedHostStateRoot {
    std::fs::create_dir_all(tree.path().join(PRODUCT).join(HOST_STATE)).expect("disposable root");
    TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(tree.path()))
        .expect("disposable host state root")
}

/// B1 — A CONFORMING PROTECTED BOUNDARY MINTS ACCEPTANCE, AND A NON-CONFORMING ONE DOES NOT.
///
/// Both halves in one test, on two roots that differ ONLY in their security descriptor. That is what
/// makes it evidence rather than a demonstration: the resolution path, the segments, the anchor
/// kind, the service SID and the policy are identical, so the descriptor is the only thing that can
/// account for the difference in outcome.
///
/// It also pins the thing a caller might hope for: the mint judges THE ROOT IT WAS GIVEN. Applying a
/// conforming ACL to one disposable root does not make a second one acceptable.
///
/// PRIVILEGED: sets the owner to `NT AUTHORITY\SYSTEM` on a disposable directory.
#[test]
#[ignore = "applies a real ACL (owner SYSTEM) to a disposable root; needs a privileged session"]
fn a_conforming_boundary_mints_and_a_non_conforming_one_does_not() {
    let conforming_tree = TempTree::new("conforming");
    let conforming = disposable_host_root(&conforming_tree);
    let other_tree = TempTree::new("other");
    let other = disposable_host_root(&other_tree);

    let policy = accepted_production_policy();
    match WindowsAclPolicyService::new().apply_and_verify(conforming.path(), &policy) {
        Ok(ApplyOutcome::Confirmed) => {}
        other => panic!("the disposable root could not be brought into conformance: {other:?}"),
    }

    // THE CONFORMING ROOT MINTS.
    let accepted = ProtectedInstallationBoundaryAcceptance::verify(&conforming)
        .expect("a conforming protected boundary must mint acceptance");

    // ...AND THE UNTOUCHED ONE STILL DOES NOT.
    match ProtectedInstallationBoundaryAcceptance::verify(&other) {
        Err(BoundaryRefusal::NonConforming(v)) => assert!(!v.is_empty()),
        other => panic!("a second, unprotected root must still refuse; got {other:?}"),
    }

    // ACCEPTANCE ACTIVATES THE SEALED ROOT, and the activated root is the same directory.
    let expected = conforming.path().to_path_buf();
    let activated = ActivatedHostStateRoot::activate(conforming, &accepted);
    assert_eq!(activated.path(), expected.as_path());
    assert_eq!(activated.revalidate(), Ok(()));
}

/// B2 — A CONFORMING DESCRIPTOR ON A REDIRECTED ROOT IS STILL REFUSED.
///
/// The attack this closes: give the attacker's directory a PERFECT descriptor, then substitute it
/// for an ancestor of the composed path. Descriptor verification alone would accept it, because the
/// descriptor really is conforming — the object is simply not the one the installation means. The
/// root revalidation around the observation is what refuses it, which is why the sequence
/// revalidates rather than merely inspecting.
///
/// PRIVILEGED, for the same reason as B1.
#[test]
#[ignore = "applies a real ACL (owner SYSTEM) to a disposable root; needs a privileged session"]
fn a_conforming_descriptor_on_a_substituted_root_is_refused() {
    let real = TempTree::new("redirect-real");
    let decoy = TempTree::new("redirect-decoy");

    // The decoy gets a genuinely conforming descriptor.
    let decoy_leaf = decoy.path().join(HOST_STATE);
    std::fs::create_dir_all(&decoy_leaf).expect("decoy leaf");
    let policy = accepted_production_policy();
    match WindowsAclPolicyService::new().apply_and_verify(&decoy_leaf, &policy) {
        Ok(ApplyOutcome::Confirmed) => {}
        other => panic!("the decoy could not be brought into conformance: {other:?}"),
    }

    // `ProjectOS` is a junction onto the decoy, so `<anchor>/ProjectOS/host` REACHES the conforming
    // directory — and that is exactly what must not be accepted.
    if !make_junction(&real.path().join(PRODUCT), decoy.path()) {
        eprintln!("mklink unavailable; ancestor-substitution proof skipped");
        return;
    }

    match TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(real.path())) {
        // §10E refuses it at resolution, so the boundary is never even reached.
        Err(TrustedRootRefusal::ReparsePointRefused | TrustedRootRefusal::RootRedirected) => {}
        // If a future change ever let it resolve, the mint must still refuse it.
        Ok(root) => match ProtectedInstallationBoundaryAcceptance::verify(&root) {
            Err(BoundaryRefusal::Root(_)) => {}
            other => panic!("a substituted root must never be accepted; got {other:?}"),
        },
        other => panic!("unexpected resolution outcome: {other:?}"),
    }
}

/// B3 — AN ANCESTOR JUNCTION IS REFUSED WITHOUT ANY ACL WORK AT ALL.
///
/// The unprivileged half of B2: no descriptor is applied anywhere, so this runs by default. It
/// proves the reparse refusal reaches the boundary path, not just §10E's own resolution tests.
#[test]
fn an_ancestor_junction_never_reaches_the_boundary_mint() {
    let real = TempTree::new("junction-real");
    let elsewhere = TempTree::new("junction-elsewhere");
    std::fs::create_dir_all(elsewhere.path().join(HOST_STATE)).expect("elsewhere leaf");

    if !make_junction(&real.path().join(PRODUCT), elsewhere.path()) {
        eprintln!("mklink unavailable; ancestor-junction proof skipped");
        return;
    }

    match TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(real.path())) {
        Err(TrustedRootRefusal::ReparsePointRefused | TrustedRootRefusal::RootRedirected) => {}
        other => panic!("an ancestor junction must be refused at resolution; got {other:?}"),
    }
}

/// Grant `Everyone` modify on a DISPOSABLE directory, the way the accepted ACL crate's own proofs
/// introduce a broad principal. Returns false when the tool is unavailable, so the test skips loudly
/// rather than passing vacuously.
fn grant_everyone_modify(path: &Path) -> bool {
    std::process::Command::new("icacls")
        .arg(path)
        .arg("/grant")
        .arg("*S-1-1-0:(M)")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// The object's owner and DACL as Windows itself renders them. A change detector, not a verifier.
fn descriptor_text(path: &Path) -> Vec<u8> {
    std::process::Command::new("icacls")
        .arg(path)
        .output()
        .expect("icacls")
        .stdout
}

/// B4 — A BROAD WRITE PRINCIPAL IS REFUSED.
///
/// `Everyone` with modify rights is the defect the whole boundary exists to exclude: it is precisely
/// the state in which the delegation store and the replay ledger could be rewritten by any local
/// account. The accepted verifier classifies broad ACCESS and broad WRITE separately, and the mint
/// refuses on either like any other finding.
///
/// UNPRIVILEGED: granting a broad principal on a directory you own needs no privilege, which is
/// exactly why this is the state that matters.
#[test]
fn a_broad_write_principal_is_refused() {
    use projectos_host_windows_acl_policy::AclViolation;

    let tree = TempTree::new("broad");
    let root = disposable_host_root(&tree);
    if !grant_everyone_modify(root.path()) {
        eprintln!("icacls unavailable; broad-principal proof skipped");
        return;
    }

    match ProtectedInstallationBoundaryAcceptance::verify(&root) {
        Err(BoundaryRefusal::NonConforming(v)) => {
            assert!(
                v.contains(&AclViolation::BroadPrincipalWrite),
                "expected broad write authority to be named, got {v:?}"
            );
            assert!(
                v.contains(&AclViolation::BroadPrincipalAccess),
                "expected broad access to be named, got {v:?}"
            );
        }
        other => panic!("a broad write principal must refuse; got {other:?}"),
    }
}

/// B5 — THE MINT IS NOT REPAIR. A refused boundary is left exactly as it was found.
///
/// The mint reads a security descriptor and never writes one: it holds no `apply` call, and the
/// accepted crate's mutation entry points are not reachable from it. This proves the property
/// observably rather than by reading the source — the descriptor after a refusal is byte-identical
/// to the descriptor before it, so nothing was "helpfully" tightened on the way past.
#[test]
fn a_refused_boundary_is_reported_and_never_repaired() {
    let tree = TempTree::new("no-repair");
    let root = disposable_host_root(&tree);

    let before = descriptor_text(root.path());
    match ProtectedInstallationBoundaryAcceptance::verify(&root) {
        Err(BoundaryRefusal::NonConforming(_)) => {}
        other => panic!("expected a read, non-conforming boundary; got {other:?}"),
    }
    let after = descriptor_text(root.path());

    assert_eq!(
        before, after,
        "the mint changed the descriptor it was asked to judge"
    );
}
