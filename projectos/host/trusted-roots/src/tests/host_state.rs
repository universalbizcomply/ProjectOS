//! A1 — Host state root resolution, and everything it refuses.

#![cfg(windows)]

use std::path::{Path, PathBuf};

use super::{undecorated, TempTree};
use crate::host_state::{HOST_STATE_SEGMENT, PRODUCT_SEGMENT};
use crate::{FixtureInstallationAnchor, TrustedHostStateRoot, TrustedRootRefusal};

/// Lay out `<anchor>/ProjectOS/host` beneath a disposable tree, exactly as an installer would.
fn lay_out_host_state(tree: &TempTree) -> PathBuf {
    tree.dir(&format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"))
}

fn resolve_from(anchor: &Path) -> Result<TrustedHostStateRoot, TrustedRootRefusal> {
    TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(anchor))
}

/// The refusal an anchor produced.
///
/// A trusted root is deliberately not comparable — equality on a capability invites treating two of
/// them as interchangeable — so a refusal is extracted rather than compared inside a `Result`.
fn refused(anchor: &Path) -> TrustedRootRefusal {
    resolve_from(anchor).expect_err("expected a refusal, got a trusted root")
}

#[test]
fn a_correctly_laid_out_host_state_root_resolves() {
    let tree = TempTree::new("hs-ok");
    let expected = lay_out_host_state(&tree);

    let root = resolve_from(tree.path()).expect("host state root");

    // The canonical answer IS the composed pathname: the segments are joined beneath the anchor and
    // nothing redirects them.
    assert_eq!(undecorated(root.path()), undecorated(&expected));
}

#[test]
fn the_segments_are_composed_beneath_the_anchor_and_never_supplied() {
    let tree = TempTree::new("hs-segments");
    lay_out_host_state(&tree);

    let root = resolve_from(tree.path()).expect("host state root");

    let text = undecorated(root.path());
    assert!(
        text.ends_with(&format!(
            "\\{}\\{}",
            PRODUCT_SEGMENT.to_lowercase(),
            HOST_STATE_SEGMENT.to_lowercase()
        )),
        "resolved {text} is not <anchor>\\{PRODUCT_SEGMENT}\\{HOST_STATE_SEGMENT}"
    );
}

#[test]
fn two_equivalent_anchor_spellings_produce_one_canonical_identity() {
    let tree = TempTree::new("hs-spelling");
    lay_out_host_state(&tree);

    // Windows directory names are case-insensitive, so these are two spellings of one anchor.
    let as_written = tree.path().to_path_buf();
    let lower_cased = PathBuf::from(tree.path().to_string_lossy().to_lowercase());
    assert_ne!(
        as_written.to_string_lossy(),
        lower_cased.to_string_lossy(),
        "the fixture tree path must contain an upper-case character for this proof to mean anything"
    );

    let a = resolve_from(&as_written).expect("root from the written spelling");
    let b = resolve_from(&lower_cased).expect("root from the lower-cased spelling");

    // ONE canonical answer, whichever spelling reached it. This is what stops two Host components
    // deriving two identities — and, downstream, two ledgers — for one directory.
    assert_eq!(a.path(), b.path());
}

#[test]
fn an_absent_host_state_root_refuses_and_creates_nothing() {
    let tree = TempTree::new("hs-absent");

    assert_eq!(refused(tree.path()), TrustedRootRefusal::RootMissing);
    // THE CHAIN IS NOT MANUFACTURED. Creating the directories an installer is supposed to own — and
    // to ACL — is exactly the "invent installation truth" failure the capability type exists to
    // prevent.
    assert!(!tree.path().join(PRODUCT_SEGMENT).exists());
}

#[test]
fn an_absent_intermediate_level_refuses() {
    let tree = TempTree::new("hs-no-product");
    // `host` exists, but not beneath the product segment: the chain is what is composed, never a
    // search for a directory of the right name.
    tree.dir(HOST_STATE_SEGMENT);

    assert_eq!(refused(tree.path()), TrustedRootRefusal::RootMissing);
}

#[test]
fn a_host_state_root_that_is_a_file_refuses() {
    let tree = TempTree::new("hs-file");
    tree.dir(PRODUCT_SEGMENT);
    tree.write(
        &format!("{PRODUCT_SEGMENT}/{HOST_STATE_SEGMENT}"),
        b"not a directory",
    );

    assert_eq!(refused(tree.path()), TrustedRootRefusal::RootNotADirectory);
}

#[test]
fn a_relative_anchor_refuses() {
    // A relative root is the ambient working directory wearing a different hat.
    assert_eq!(
        refused(Path::new("relative\\anchor")),
        TrustedRootRefusal::UnsafePath
    );
}

#[test]
fn a_traversing_anchor_refuses() {
    let tree = TempTree::new("hs-traversal");
    lay_out_host_state(&tree);
    // A spelling that would resolve to the same place if it were followed. It is refused as WRITTEN.
    let traversing = tree
        .path()
        .join("..")
        .join(tree.path().file_name().expect("tree name"));

    assert_eq!(refused(&traversing), TrustedRootRefusal::UnsafePath);
}

#[test]
fn a_unc_anchor_refuses() {
    assert_eq!(
        refused(Path::new(r"\\server\share\ProjectOS")),
        TrustedRootRefusal::UnsafePath
    );
}

#[test]
fn a_device_namespace_anchor_refuses() {
    let tree = TempTree::new("hs-verbatim");
    lay_out_host_state(&tree);
    // The verbatim form bypasses Win32 path normalisation, so accepting it would mean accepting a
    // spelling whose meaning differs from every other spelling of the same location.
    let verbatim = PathBuf::from(format!(r"\\?\{}", tree.path().display()));

    assert_eq!(refused(&verbatim), TrustedRootRefusal::UnsafePath);
}

#[test]
fn a_forward_slash_anchor_refuses() {
    let tree = TempTree::new("hs-slash");
    lay_out_host_state(&tree);
    let slashed = PathBuf::from(tree.path().to_string_lossy().replace('\\', "/"));

    assert_eq!(refused(&slashed), TrustedRootRefusal::UnsafePath);
}

#[test]
fn an_alternate_data_stream_anchor_refuses() {
    let tree = TempTree::new("hs-ads");
    lay_out_host_state(&tree);
    let ads = PathBuf::from(format!("{}:stream", tree.path().display()));

    assert_eq!(refused(&ads), TrustedRootRefusal::UnsafePath);
}

#[test]
fn an_empty_anchor_refuses() {
    assert_eq!(refused(Path::new("")), TrustedRootRefusal::UnsafePath);
}

#[test]
fn revalidation_of_an_untouched_root_succeeds() {
    let tree = TempTree::new("hs-revalidate");
    lay_out_host_state(&tree);

    let root = resolve_from(tree.path()).expect("host state root");

    // The chain is re-walked and the held object re-checked; nothing has changed, so nothing refuses.
    assert_eq!(root.revalidate(), Ok(()));
}

#[test]
fn resolution_writes_nothing_into_a_correctly_laid_out_tree() {
    let tree = TempTree::new("hs-readonly");
    let leaf = lay_out_host_state(&tree);

    let _root = resolve_from(tree.path()).expect("host state root");

    // The Host state root is opened for FILE_READ_ATTRIBUTES and nothing else, so a correctly
    // laid-out tree is byte-identical afterwards: no leaf directory, no marker, no journal.
    let entries: Vec<_> = std::fs::read_dir(&leaf)
        .expect("read leaf")
        .map(|e| e.expect("entry").file_name())
        .collect();
    assert!(entries.is_empty(), "resolution created {entries:?}");
}

#[test]
fn the_published_path_is_an_ordinary_drive_rooted_path_the_host_rules_accept() {
    let tree = TempTree::new("hs-settled");
    lay_out_host_state(&tree);

    let root = resolve_from(tree.path()).expect("host state root");
    let text = root.path().to_string_lossy().to_string();

    // NOT THE VERBATIM FORM. `GetFinalPathNameByHandleW` returns the `\\?\C:\...` spelling, and the
    // accepted `validate_local_root` rule the durable protected store applies REFUSES it — so a root
    // published in that form resolves perfectly and then cannot open a store. Measured rather than
    // assumed, because it was discovered by the store refusing.
    assert!(
        !text.starts_with(r"\\?\"),
        "the published root is still in the verbatim form: {text}"
    );
    assert!(
        !text.starts_with(r"\\"),
        "the published root is a UNC path: {text}"
    );
    let bytes = text.as_bytes();
    assert!(
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\',
        "the published root is not drive-rooted: {text}"
    );
}
