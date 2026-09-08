//! Proof for the trusted host roots (RUN-TO-COMPLETION HOST ATTESTATION §10E).
//!
//! EVERY TEST USES A DISPOSABLE TEMPORARY TREE. Nothing here creates, resolves, reads or writes the
//! live ProjectOS ProgramData directory, the live installed-project registry, or any real governed
//! repository; nothing touches a service, an ACL, a credential, a provider or a socket. The trees
//! are created under the process temp directory, keyed by process id and a counter so two tests in
//! the same run can never share one, and removed when the guard drops.
//!
//! WHAT IS SUBSTITUTED, AND WHAT IS NOT. Only the two SOURCES are fixtures: the anchor is a
//! disposable directory instead of the resolved Known Folder, and the registry document is bytes the
//! test wrote instead of bytes at the canonical path. Everything after that — the segment
//! composition, the ancestor-chain walk, every custody open, the reparse refusal, the identity
//! capture, the canonical path, and the whole registry validator — is the production code path,
//! unmodified.
//!
//! The ambient-input refusals (an environment variable and a working directory, against the REAL
//! production sources) and the reparse-substitution refusal (which needs a junction) live in the
//! integration tests, where they get their own process and are outside this crate's source scan.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

mod activation;
mod governed_project;
mod host_state;

static NEXT: AtomicU64 = AtomicU64::new(0);

/// A disposable directory tree this test owns outright, removed when the guard drops.
pub(crate) struct TempTree {
    path: PathBuf,
}

impl TempTree {
    pub(crate) fn new(tag: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "pos-trusted-roots-{}-{tag}-{n}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp tree");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Create a directory beneath the tree and return it.
    pub(crate) fn dir(&self, relative: &str) -> PathBuf {
        let p = self.path.join(relative);
        std::fs::create_dir_all(&p).expect("temp dir");
        p
    }

    /// Write a file beneath the tree, creating its parents.
    pub(crate) fn write(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let p = self.path.join(relative);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("temp parent");
        }
        std::fs::write(&p, bytes).expect("temp file");
        p
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Build a directory that the canonical registry will accept as a governed repository: a `.git`
/// marker and a `.projectops/project-config.json` naming `config_project_id`.
///
/// The config id is a SEPARATE parameter from the registry id on purpose — the disagreement between
/// them is one of the refusals under test.
pub(crate) fn make_repository(tree: &TempTree, relative: &str, config_project_id: &str) -> PathBuf {
    let root = tree.dir(relative);
    // A FILE, which is what a linked worktree leaves behind; the registry tests existence, never
    // "is a directory".
    tree.write(&format!("{relative}/.git"), b"gitdir: elsewhere\n");
    tree.write(
        &format!("{relative}/.projectops/project-config.json"),
        format!("{{\"projectId\":\"{config_project_id}\",\"projectName\":\"Fixture\"}}").as_bytes(),
    );
    root
}

/// Render a path into a JSON string body, escaping Windows separators.
pub(crate) fn json_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "\\\\")
}

/// Build a registry document naming `(project_id, repository_root)` pairs.
pub(crate) fn registry_document(entries: &[(&str, &Path)]) -> Vec<u8> {
    let projects: Vec<String> = entries
        .iter()
        .map(|(id, root)| {
            format!(
                "{{\"projectId\":\"{id}\",\"repositoryRoot\":\"{}\",\
                 \"permittedEnvironments\":[\"development\"],\"productionFrozen\":false}}",
                json_path(root)
            )
        })
        .collect();
    format!(
        "{{\"schemaVersion\":1,\"projects\":[{}]}}",
        projects.join(",")
    )
    .into_bytes()
}

/// Build a registry document whose entry names a root spelled exactly as given (used for the
/// relative / traversing / absent-root refusals, where no real directory exists).
pub(crate) fn registry_document_raw(project_id: &str, repository_root: &str) -> Vec<u8> {
    format!(
        "{{\"schemaVersion\":1,\"projects\":[{{\"projectId\":\"{project_id}\",\
         \"repositoryRoot\":\"{}\",\"permittedEnvironments\":[\"development\"],\
         \"productionFrozen\":false}}]}}",
        repository_root.replace('\\', "\\\\")
    )
    .into_bytes()
}

/// Strip the verbatim prefix so a canonical path can be compared with a composed one.
///
/// COMPARISON ONLY. Nothing in the crate's own sources reasons about paths textually; this exists so
/// a test can state what came back.
pub(crate) fn undecorated(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\")
        .unwrap_or(&text)
        .replace('/', "\\")
        .to_lowercase()
}

// -------------------------------------------------------------------------------------------------
// THE FROZEN PLAN AGREEMENT
// -------------------------------------------------------------------------------------------------

/// The segments this crate composes ARE the one authoritative frozen production-root plan.
///
/// The plan crate is a DEV dependency: §10E may not put its ACL-policy edge into the Host's runtime
/// graph, and the agreement is a fact to prove rather than a capability to ship. If somebody later
/// edits either the plan or the record vocabulary, this fails rather than letting the installer and
/// the Host quietly mean two directories.
#[cfg(windows)]
#[test]
fn the_composed_host_state_root_is_the_frozen_production_root_plan() {
    use projectos_host_windows_activation_plan::{
        KnownFolderAnchor, ProductionRootPlan, RootSegment, RootSubtree,
    };

    use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};

    let plan = ProductionRootPlan::canonical().expect("canonical plan");

    // The anchor this crate resolves is the plan's anchor.
    assert_eq!(plan.anchor(), KnownFolderAnchor::ProgramData);
    // The product segment this crate joins is the plan's only segment.
    assert_eq!(
        plan.segments(),
        &[RootSegment::parse(PRODUCT_SEGMENT).expect("segment")]
    );
    assert_eq!(
        plan.symbolic_path(),
        format!(
            "{}\\{PRODUCT_SEGMENT}",
            KnownFolderAnchor::ProgramData.symbol()
        )
    );
    // The host-state subtree is planned, authorised, and spelled the way this crate spells it.
    assert!(plan.includes(RootSubtree::HostState));
    assert_eq!(RootSubtree::HostState.segment(), HOST_STATE_SEGMENT);
}

/// The Host state root is the PARENT of the subtree the installation's own records live in.
///
/// Stated as a test because it is the reason the two segments are imported rather than invented: if
/// the record contract ever moved its records, the Host state root would move with them.
#[cfg(windows)]
#[test]
fn the_host_state_root_is_the_parent_of_the_installation_record_subtree() {
    use projectos_host_identity::canonical_record::symbolic_record_location;

    use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};

    let location = symbolic_record_location();
    assert!(
        location.contains(&format!("{PRODUCT_SEGMENT}\\{HOST_STATE_SEGMENT}\\")),
        "record location {location} is not beneath the composed host state root"
    );
}
