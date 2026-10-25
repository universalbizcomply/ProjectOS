//! REPARSE SUBSTITUTION IS REFUSED AT EVERY LEVEL THE HOST STATE ROOT IS COMPOSED THROUGH.
//!
//! ## The property the custody primitive does not give on its own
//!
//! `FILE_FLAG_OPEN_REPARSE_POINT` describes the FINAL component of a path. Opening
//! `<anchor>/ProjectOS/host` therefore inspects `host` and silently FOLLOWS a junction substituted
//! for `<anchor>` or for `ProjectOS`. The accepted primitive already proves the leaf case
//! (`junction_root_refused`, `directory_symlink_root_refused`) and post-open replacement
//! (`root_replaced_by_junction_after_open_is_detected`); those are reused rather than rewritten.
//!
//! What is new in §10E is the ANCESTOR case, because §10E is the first thing that composes a path
//! through levels it did not open. That is what this file proves.
//!
//! ## Why this file is an integration test
//!
//! Building the fixture needs `mklink`, and a process launch has no business appearing anywhere in
//! this crate's own sources. `tests/` is outside the source scan, and the helper here is the same
//! one the custody primitive's accepted tests use.
//!
//! Junctions need no special privilege; if the machine refuses to create one anyway, the test says
//! so rather than passing silently.

#![cfg(all(windows, feature = "test-fixtures"))]

use std::path::{Path, PathBuf};

use projectos_host_trusted_roots::{
    FixtureInstallationAnchor, FixtureProjectRegistry, TrustedGovernedProjectRoot,
    TrustedHostStateRoot, TrustedRootRefusal,
};

/// Create a directory JUNCTION as a TEST FIXTURE only. `mklink` builds the fixture; it is never the
/// primitive under test.
fn make_junction(link: &Path, target: &Path) -> bool {
    std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            link.to_str().expect("link"),
            target.to_str().expect("target"),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        && link.exists()
}

fn unique_dir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "pos-trusted-roots-reparse-{}-{tag}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).expect("temp dir");
    p
}

fn cleanup(p: &Path) {
    let _ = std::fs::remove_dir_all(p);
}

#[test]
fn a_junction_substituted_for_the_anchor_is_refused_not_followed() {
    let parent = unique_dir("anchor");
    let real = parent.join("real");
    std::fs::create_dir_all(real.join("ProjectOS").join("host")).expect("real layout");
    let link = parent.join("anchor-link");

    assert!(
        make_junction(&link, &real),
        "the fixture junction could not be created; the proof cannot run"
    );

    // The LEAF beneath the junction is a perfectly ordinary directory. Custody on the leaf alone
    // would have accepted it. The chain walk refuses the anchor before the leaf is ever reached.
    let outcome = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(&link))
        .expect_err("expected a refusal, got a trusted root");

    assert_eq!(outcome, TrustedRootRefusal::ReparsePointRefused);
    cleanup(&parent);
}

#[test]
fn a_junction_substituted_for_the_product_segment_is_refused_not_followed() {
    let parent = unique_dir("product");
    let anchor = parent.join("anchor");
    let elsewhere = parent.join("elsewhere");
    std::fs::create_dir_all(&anchor).expect("anchor");
    std::fs::create_dir_all(elsewhere.join("host")).expect("elsewhere layout");
    let link = anchor.join("ProjectOS");

    assert!(
        make_junction(&link, &elsewhere),
        "the fixture junction could not be created; the proof cannot run"
    );

    // `<anchor>/ProjectOS/host` resolves to a real directory — somewhere else entirely. Refused.
    let outcome = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(&anchor))
        .expect_err("expected a refusal, got a trusted root");

    assert_eq!(outcome, TrustedRootRefusal::ReparsePointRefused);
    cleanup(&parent);
}

#[test]
fn a_junction_substituted_for_the_host_state_leaf_is_refused_not_followed() {
    let parent = unique_dir("leaf");
    let anchor = parent.join("anchor");
    let elsewhere = parent.join("elsewhere");
    std::fs::create_dir_all(anchor.join("ProjectOS")).expect("anchor layout");
    std::fs::create_dir_all(&elsewhere).expect("elsewhere");
    let link = anchor.join("ProjectOS").join("host");

    assert!(
        make_junction(&link, &elsewhere),
        "the fixture junction could not be created; the proof cannot run"
    );

    let outcome = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(&anchor))
        .expect_err("expected a refusal, got a trusted root");

    assert_eq!(outcome, TrustedRootRefusal::ReparsePointRefused);
    cleanup(&parent);
}

#[test]
fn a_chain_with_no_reparse_point_anywhere_resolves_and_revalidates() {
    let parent = unique_dir("clean");
    let anchor = parent.join("anchor");
    let leaf = anchor.join("ProjectOS").join("host");
    std::fs::create_dir_all(&leaf).expect("clean layout");

    let root = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(&anchor))
        .expect("clean chain resolves");

    // Revalidation re-walks the same chain and re-checks the held object through the accepted
    // primitive's two-sided check — which is where post-resolution replacement is detected.
    assert_eq!(root.revalidate(), Ok(()));
    drop(root);
    cleanup(&parent);
}

// -------------------------------------------------------------------------------------------------
// THE LEVEL THE FINAL-COMPONENT CHECK CANNOT SEE
// -------------------------------------------------------------------------------------------------
//
// The three tests above cover a junction AT a level the walk opens. A junction ABOVE the anchor is
// different in kind: nothing in the composed chain has it as a final component, so no reparse
// attribute anywhere in the walk is set, and every open succeeds. The same blind spot is what an
// attacker who wins the race gets — swapping an ancestor AFTER its own check passed but BEFORE the
// leaf is opened leaves exactly this situation, with no reparse point left to find.
//
// What catches it is not a check on the path but a question about the OUTCOME:
// `GetFinalPathNameByHandleW` reports where the object it opened actually lives, and a followed
// junction lands it somewhere the composed path does not name. That is decisive regardless of
// timing, which is why it is the answer to the race rather than a narrower window.

#[test]
fn a_junction_above_the_anchor_is_caught_by_the_composed_path_comparison() {
    let parent = unique_dir("above-anchor");
    let real = parent.join("real");
    let anchor_under_real = real.join("anchor");
    std::fs::create_dir_all(anchor_under_real.join("ProjectOS").join("host")).expect("real layout");
    let link = parent.join("link");

    assert!(
        make_junction(&link, &real),
        "the fixture junction could not be created; the proof cannot run"
    );

    // Every level the walk opens is an ordinary directory: `link\anchor`, `link\anchor\ProjectOS`
    // and the leaf all have non-reparse final components. The junction is the `link` component,
    // which the walk never opens as a final component and Windows silently traverses.
    let composed_anchor = link.join("anchor");
    let outcome = TrustedHostStateRoot::resolve(&FixtureInstallationAnchor::new(&composed_anchor))
        .expect_err("expected a refusal, got a trusted root");

    assert_eq!(outcome, TrustedRootRefusal::RootRedirected);
    cleanup(&parent);
}

#[test]
fn a_junction_above_a_registered_repository_is_caught_the_same_way() {
    let parent = unique_dir("above-repo");
    let real = parent.join("real");
    let repo = real.join("repo-a");
    std::fs::create_dir_all(repo.join(".projectops")).expect("repo layout");
    std::fs::write(repo.join(".git"), b"gitdir: elsewhere\n").expect("git marker");
    std::fs::write(
        repo.join(".projectops").join("project-config.json"),
        b"{\"projectId\":\"proj-a\",\"projectName\":\"Fixture\"}",
    )
    .expect("project config");
    let link = parent.join("link");

    assert!(
        make_junction(&link, &real),
        "the fixture junction could not be created; the proof cannot run"
    );

    // The registry registers the root THROUGH the junction. Its own reparse check looks at the
    // registered path's final component (`repo-a`), which is an ordinary directory, so the registry
    // accepts it — correctly, on the evidence it has. Whoever controls `link` still chooses which
    // repository that entry means, and that is what this refuses.
    let registered = link.join("repo-a");
    let document = format!(
        "{{\"schemaVersion\":1,\"projects\":[{{\"projectId\":\"proj-a\",\
         \"repositoryRoot\":\"{}\",\"permittedEnvironments\":[\"development\"],\
         \"productionFrozen\":false}}]}}",
        registered.to_string_lossy().replace('\\', "\\\\")
    )
    .into_bytes();

    let outcome =
        TrustedGovernedProjectRoot::resolve(&FixtureProjectRegistry::new(document), "proj-a")
            .expect_err("expected a refusal, got a trusted root");

    assert_eq!(outcome, TrustedRootRefusal::RootRedirected);
    cleanup(&parent);
}
