//! AMBIENT INPUT CANNOT REDIRECT EITHER AUTHORITY — proven against the REAL production sources.
//!
//! ## Why this is an integration test and not a unit one
//!
//! It mutates the process environment and the working directory, which is a whole-process effect. An
//! integration test gets its own binary, so nothing else in the crate's test run can observe the
//! poisoned state; and it lives outside `src/`, so the crate's own source scan stays free of any
//! environment or working-directory reference.
//!
//! ## What is actually being proven
//!
//! The two fixture SOURCES prove the resolution algorithm. They cannot prove that the PRODUCTION
//! sources ignore ambient input, because a fixture is not what production uses. So this file uses
//! [`ApprovedKnownFolderAnchor`] and [`CanonicalProjectRegistry`] — the real ones — against a tree
//! that is laid out to be irresistible if either of them consulted the environment: a complete
//! `ProjectOS/host` subtree, and a complete, well-formed installed-project registry at the exact
//! relative location the canonical path would name, registering a real repository.
//!
//! If `%ProgramData%` or the working directory could redirect either authority, both assertions
//! below would fail. The registry probe is the sharper of the two: it names a project id that only
//! the poisoned registry carries, so a pass means the production source did not read that file.
//!
//! ## What it does NOT do
//!
//! It writes only inside its own disposable tree. `SHGetKnownFolderPath` is asked for the registered
//! ProgramData location and the result is READ — a directory handle for `FILE_READ_ATTRIBUTES`, and
//! at most an attempt to read one registry file. Nothing under the real ProgramData is created,
//! written, deleted, re-permissioned or locked, and the assertions hold whether or not this machine
//! has ProjectOS installed at all.

#![cfg(windows)]

use std::path::{Path, PathBuf};

use projectos_host_trusted_roots::{
    ApprovedKnownFolderAnchor, CanonicalProjectRegistry, TrustedGovernedProjectRoot,
    TrustedHostStateRoot, TrustedRootRefusal,
};

/// A disposable tree this test owns outright, removed when the guard drops.
struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "pos-trusted-roots-amb-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("temp tree");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn dir(&self, relative: &str) -> PathBuf {
        let p = self.path.join(relative);
        std::fs::create_dir_all(&p).expect("temp dir");
        p
    }

    fn write(&self, relative: &str, bytes: &[u8]) {
        let p = self.path.join(relative);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("temp parent");
        }
        std::fs::write(&p, bytes).expect("temp file");
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn lower(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_lowercase()
}

/// ONE test, because the poisoned state is process-wide and two of them would race each other.
#[test]
fn neither_the_environment_nor_the_working_directory_can_redirect_a_trusted_root() {
    let tree = TempTree::new("poison");

    // A COMPLETE, VALID DECOY. Everything a redirected authority would happily accept.
    let decoy_host_state = tree.dir("ProjectOS/host");
    let repo = tree.dir("repo-poison");
    tree.write("repo-poison/.git", b"gitdir: elsewhere\n");
    let poisoned_id = format!("proj-poison-{}", std::process::id());
    tree.write(
        "repo-poison/.projectops/project-config.json",
        format!("{{\"projectId\":\"{poisoned_id}\",\"projectName\":\"Decoy\"}}").as_bytes(),
    );
    tree.write(
        "ProjectOS/host/installation/projects.v1.json",
        format!(
            "{{\"schemaVersion\":1,\"projects\":[{{\"projectId\":\"{poisoned_id}\",\
             \"repositoryRoot\":\"{}\",\"permittedEnvironments\":[\"development\"],\
             \"productionFrozen\":false}}]}}",
            repo.to_string_lossy().replace('\\', "\\\\")
        )
        .as_bytes(),
    );

    let restore_cwd = std::env::current_dir().ok();
    let previous_program_data = std::env::var("ProgramData").ok();

    // POISON BOTH AMBIENT CHANNELS.
    std::env::set_var("ProgramData", tree.path());
    std::env::set_var("PROGRAMDATA", tree.path());
    let _ = std::env::set_current_dir(tree.path());

    let host = TrustedHostStateRoot::resolve(&ApprovedKnownFolderAnchor);
    let project = TrustedGovernedProjectRoot::resolve(&CanonicalProjectRegistry, &poisoned_id);

    // RESTORE BEFORE ASSERTING, so a failure cannot leave the process poisoned for anything else.
    if let Some(cwd) = restore_cwd {
        let _ = std::env::set_current_dir(cwd);
    }
    match previous_program_data {
        Some(v) => {
            std::env::set_var("ProgramData", &v);
            std::env::set_var("PROGRAMDATA", &v);
        }
        None => {
            std::env::remove_var("ProgramData");
            std::env::remove_var("PROGRAMDATA");
        }
    }

    // THE HOST STATE ROOT. Either it refused, or it resolved somewhere that is NOT the decoy. What
    // it must never do is land inside a directory the environment nominated.
    match host {
        Ok(root) => assert_ne!(
            lower(root.path()),
            lower(&decoy_host_state),
            "the environment redirected the Host state root"
        ),
        Err(refusal) => assert!(
            matches!(
                refusal,
                TrustedRootRefusal::RootMissing
                    | TrustedRootRefusal::AnchorUnresolved
                    | TrustedRootRefusal::RootNotADirectory
                    | TrustedRootRefusal::ReparsePointRefused
                    | TrustedRootRefusal::RootIdentityDrift
                    | TrustedRootRefusal::UnsafePath
                    | TrustedRootRefusal::RootUnresolvable
            ),
            "unexpected refusal {refusal:?}"
        ),
    }

    // THE GOVERNED PROJECT ROOT. This id exists ONLY in the poisoned registry, so resolving it at
    // all would mean the canonical registry read the file the environment pointed at.
    assert!(
        matches!(
            project,
            Err(TrustedRootRefusal::ProjectNotRegistered)
                | Err(TrustedRootRefusal::RegistryRefused(_))
        ),
        "the environment or the working directory reached the project registry: {project:?}"
    );
}
