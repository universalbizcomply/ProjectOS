//! THE installed-project registry, as the packaged host consumes it.
//!
//! WHAT THIS FILE IS. The one place the Control Centre learns which projects it may govern. It reads
//! the canonical protected registry — `<ProgramData>\ProjectOS\host\installation\projects.v1.json` —
//! through `projectos_project_registry`, which resolves ProgramData with `SHGetKnownFolderPath` and
//! validates every entry against the repository it names before believing a word of it.
//!
//! WHAT IT DOES NOT DO, and there is no code path for any of it: it does not read `process.cwd()`,
//! `bridge.config.json`, an environment variable, argv, a manifest field, the governed project
//! itself, or scan for `.projectops` directories. It takes NO caller-supplied path — the only
//! constructor here has no path parameter, so a redirected registry is not refused, it is
//! unrepresentable.
//!
//! FAIL CLOSED MEANS ZERO PROJECTS, NOT A DEAD APPLICATION. A missing, malformed, conflicting or
//! unreadable registry yields an empty set of governable projects and a token naming why. Every
//! governed action is then unavailable, which is the closed answer; refusing to start the worker at
//! all would leave the owner with no surface on which to see the problem, which is a worse closed
//! answer, not a safer one.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C.

use std::path::PathBuf;

use projectos_project_registry::{
    read_canonical_registry, RealRegistryFacts, RegistryRefusal, ValidatedProject,
};

/// A CLOSED vocabulary describing what happened when the registry was read.
///
/// Deliberately a fixed token rather than a message: it travels to the daemon and on to the owner
/// surface, and a free-text field on that route would be a channel for whatever produced it to write
/// arbitrary content into the host's own argv. It names no path and no machine fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RegistryStatus {
    /// The registry was read and validated. Zero projects is a legitimate `Ok`.
    Ok,
    /// ProgramData itself could not be resolved.
    AnchorUnresolved,
    /// No registry exists at the canonical location.
    Missing,
    /// The registry exists but could not be read.
    Unreadable,
    /// The registry is not a well-formed V1 document, or declares a version this build does not
    /// implement.
    Malformed,
    /// The registry parsed but contradicts itself or the repositories it names.
    Invalid,
}

impl RegistryStatus {
    /// The token handed to the daemon. Lower-case, hyphenated, from this closed set and nowhere else.
    pub(crate) const fn token(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::AnchorUnresolved => "anchor-unresolved",
            Self::Missing => "missing",
            Self::Unreadable => "unreadable",
            Self::Malformed => "malformed",
            Self::Invalid => "invalid",
        }
    }

    fn from_refusal(refusal: RegistryRefusal) -> Self {
        match refusal {
            RegistryRefusal::AnchorUnresolved => Self::AnchorUnresolved,
            RegistryRefusal::Missing => Self::Missing,
            RegistryRefusal::Unreadable => Self::Unreadable,
            RegistryRefusal::Malformed | RegistryRefusal::UnsupportedVersion => Self::Malformed,
            // Everything else is a registry that parsed and then contradicted itself, the machine,
            // or a repository it names. They are collapsed on purpose: the owner surface must not
            // become a report of exactly which check rejected a file it cannot edit anyway.
            _ => Self::Invalid,
        }
    }
}

/// The validated projects this installation may govern, plus why — sealed.
///
/// A private field and no public constructor taking paths, exactly like `GovernedSystemRoot`: a
/// holder of one of these has evidence the canonical registry produced it, not merely a list of
/// directories somebody liked the look of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RegisteredProjects {
    /// The registry-BOUND identity of each project, paired with its validated root.
    ///
    /// The id travels with the root deliberately. Without it the daemon could only re-derive an
    /// identity from the repository's own configuration, which the repository can rewrite — and a
    /// repository that renamed itself to a SIBLING project's id would then take that sibling's place
    /// in the daemon's inventory while the owner's selection still resolved. The bound id is what the
    /// daemon compares against, so a re-badged repository is dropped rather than promoted.
    projects: Vec<(String, PathBuf)>,
    status: RegistryStatus,
}

impl RegisteredProjects {
    /// The validated (bound project id, repository root) pairs, in registry order.
    pub(crate) fn projects(&self) -> &[(String, PathBuf)] {
        &self.projects
    }

    /// Why the registry read ended as it did.
    pub(crate) const fn status(&self) -> RegistryStatus {
        self.status
    }

    /// The closed, project-free outcome. Used for every refusal, so no refusal path can accidentally
    /// carry a root through.
    const fn refused(status: RegistryStatus) -> Self {
        Self {
            projects: Vec::new(),
            status,
        }
    }

    /// TEST-ONLY construction, so the argv boundary can be exercised without a real registry.
    /// `#[cfg(test)]` is the packaging boundary: a normal build — default or release — compiles no
    /// route by which roots could be supplied, so a shipped artefact cannot be handed a project list.
    #[cfg(test)]
    pub(crate) fn for_test(projects: Vec<(String, PathBuf)>, status: RegistryStatus) -> Self {
        Self { projects, status }
    }
}

/// Read the canonical registry for this machine.
///
/// Takes NOTHING. There is no parameter through which a renderer, a Tauri command, the governed
/// project or the environment could name a registry, a root or a project, so the only registry this
/// can read is the one the installed host owns. On a platform with no ProgramData the underlying
/// resolver refuses with `AnchorUnresolved`, so this needs no second implementation.
pub(crate) fn resolve_registered_projects() -> RegisteredProjects {
    match read_canonical_registry(&RealRegistryFacts) {
        Ok(registry) => RegisteredProjects {
            projects: registry
                .projects()
                .iter()
                .map(|project: &ValidatedProject| {
                    (
                        project.project_id().to_string(),
                        project.repository_root().to_path_buf(),
                    )
                })
                .collect(),
            status: RegistryStatus::Ok,
        },
        Err(refusal) => RegisteredProjects::refused(RegistryStatus::from_refusal(refusal)),
    }
}

/// The argv flag that carries ONE validated project root to the daemon.
///
/// Separate from `--root`, which names the governed SYSTEM root, because they are different things:
/// the system root is framework state the daemon may write, a project root is a repository it may
/// govern. One flag carrying two meanings is how a system root eventually gets treated as a project.
pub(crate) const PROJECT_ROOT_FLAG: &str = "--project-root";

/// The argv flag that carries the registry-BOUND identity of the project root that follows it.
///
/// Always emitted IMMEDIATELY before its `--project-root`, so the pair cannot be separated or
/// re-associated by anything downstream.
pub(crate) const PROJECT_ID_FLAG: &str = "--project-id";

/// The argv flag that carries the registry status token.
pub(crate) const REGISTRY_STATUS_FLAG: &str = "--project-registry-status";

/// Append the registry arguments to a daemon command line.
///
/// Extracted so both launch authorities produce the SAME shape and a test can assert it once. A root
/// that is not absolute is dropped rather than passed: the registry already refuses relative roots,
/// so this is the belt to that braces — and dropping is safe because the daemon governs only what it
/// is given.
pub(crate) fn append_registry_args(args: &mut Vec<String>, projects: &RegisteredProjects) {
    for (project_id, root) in projects.projects() {
        // Both halves are checked again here. The registry already refuses a relative root and a
        // blank id, so this is the belt to that braces: a future change that loosened the first
        // must not be able to silently hand the daemon an ambient path or a nameless project.
        if root.is_absolute() && is_argv_safe_id(project_id) {
            args.push(PROJECT_ID_FLAG.to_string());
            args.push(project_id.clone());
            args.push(PROJECT_ROOT_FLAG.to_string());
            args.push(root.to_string_lossy().to_string());
        }
    }
    args.push(REGISTRY_STATUS_FLAG.to_string());
    args.push(projects.status().token().to_string());
}

/// Whether an id is safe to place in argv: non-empty, bounded, and not itself flag-shaped.
///
/// A leading `-` is refused because a value that looks like a flag has no legitimate use as a
/// project id, and refusing it keeps the pairing above unambiguous whatever the parser on the other
/// side does with it.
fn is_argv_safe_id(project_id: &str) -> bool {
    !project_id.is_empty()
        && project_id.len() <= projectos_project_registry::MAX_ID_LEN
        && !project_id.starts_with('-')
        && !project_id
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every status maps to a token from the closed set — lower-case, hyphenated, no whitespace, no
    /// path, no machine fact. A token that could carry free text would be a channel into argv.
    #[test]
    fn every_status_token_is_a_closed_lower_case_word() {
        for status in [
            RegistryStatus::Ok,
            RegistryStatus::AnchorUnresolved,
            RegistryStatus::Missing,
            RegistryStatus::Unreadable,
            RegistryStatus::Malformed,
            RegistryStatus::Invalid,
        ] {
            let token = status.token();
            assert!(!token.is_empty());
            assert!(
                token.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'),
                "{token} must be a closed lower-case token"
            );
        }
    }

    /// A refusal carries NO roots. This is the property that makes "fail closed" mean something: a
    /// registry that could not be validated governs nothing, whatever else it contained.
    #[test]
    fn a_refusal_carries_no_project_roots() {
        for status in [
            RegistryStatus::AnchorUnresolved,
            RegistryStatus::Missing,
            RegistryStatus::Unreadable,
            RegistryStatus::Malformed,
            RegistryStatus::Invalid,
        ] {
            let refused = RegisteredProjects::refused(status);
            assert!(refused.projects().is_empty());
            assert_eq!(refused.status(), status);
        }
    }

    /// Refusals are distinguished, not collapsed into one. "Nothing is registered" and "the registry
    /// is broken" are different situations and only one of them suggests somebody is trying
    /// something.
    #[test]
    fn refusal_reasons_are_distinguished() {
        assert_eq!(
            RegistryStatus::from_refusal(RegistryRefusal::Missing),
            RegistryStatus::Missing
        );
        assert_eq!(
            RegistryStatus::from_refusal(RegistryRefusal::UnsupportedVersion),
            RegistryStatus::Malformed
        );
        assert_eq!(
            RegistryStatus::from_refusal(RegistryRefusal::ProjectIdMismatch),
            RegistryStatus::Invalid
        );
        assert_eq!(
            RegistryStatus::from_refusal(RegistryRefusal::DuplicateProjectId),
            RegistryStatus::Invalid
        );
    }

    /// The argv shape: one `--project-root <absolute>` pair per validated project, then exactly one
    /// status token. Nothing else is emitted.
    #[test]
    fn the_argv_shape_is_one_bound_pair_per_project_plus_one_status() {
        let projects = RegisteredProjects::for_test(
            vec![
                ("projectos".to_string(), PathBuf::from(r"C:\dev\ProjectOS")),
                ("dead-aisle".to_string(), PathBuf::from(r"C:\dev\DeadAisle")),
            ],
            RegistryStatus::Ok,
        );
        let mut args = Vec::new();
        append_registry_args(&mut args, &projects);
        assert_eq!(
            args,
            vec![
                PROJECT_ID_FLAG.to_string(),
                "projectos".to_string(),
                PROJECT_ROOT_FLAG.to_string(),
                r"C:\dev\ProjectOS".to_string(),
                PROJECT_ID_FLAG.to_string(),
                "dead-aisle".to_string(),
                PROJECT_ROOT_FLAG.to_string(),
                r"C:\dev\DeadAisle".to_string(),
                REGISTRY_STATUS_FLAG.to_string(),
                "ok".to_string(),
            ],
            "the registry-bound id must travel immediately before the root it binds"
        );
    }

    /// THE ID IS WHAT MAKES A ROOT'S IDENTITY NON-NEGOTIABLE DOWNSTREAM.
    ///
    /// Without it the daemon could only re-derive an identity from the repository's own
    /// configuration — which the repository can rewrite. A repository that renamed itself to a
    /// SIBLING project's id would then take that sibling's place in the daemon's inventory while the
    /// owner's selection still resolved, and governed work would run against the wrong repository
    /// under the right name.
    #[test]
    fn every_root_is_paired_with_the_id_the_registry_bound_it_to() {
        let projects = RegisteredProjects::for_test(
            vec![("projectos".to_string(), PathBuf::from(r"C:\dev\ProjectOS"))],
            RegistryStatus::Ok,
        );
        let mut args = Vec::new();
        append_registry_args(&mut args, &projects);
        let root_at = args
            .iter()
            .position(|a| a == PROJECT_ROOT_FLAG)
            .expect("a root is passed");
        assert_eq!(args[root_at - 2], PROJECT_ID_FLAG);
        assert_eq!(args[root_at - 1], "projectos");
    }

    /// A flag-shaped or blank id never reaches argv, so the pairing can never be desynchronised by
    /// a value that the parser on the other side would read as a flag.
    #[test]
    fn a_flag_shaped_or_blank_id_is_never_passed_to_the_daemon() {
        for bad in ["", "--force", "-f", "has space", "has\ttab"] {
            let projects = RegisteredProjects::for_test(
                vec![(bad.to_string(), PathBuf::from(r"C:\dev\ProjectOS"))],
                RegistryStatus::Ok,
            );
            let mut args = Vec::new();
            append_registry_args(&mut args, &projects);
            assert_eq!(
                args,
                vec![REGISTRY_STATUS_FLAG.to_string(), "ok".to_string()],
                "{bad:?} must not become a project id"
            );
        }
    }

    /// A relative root never reaches argv. The registry refuses one already; this is the second
    /// refusal, so a future change that loosened the first cannot silently hand the daemon an
    /// ambient path.
    #[test]
    fn a_relative_root_is_never_passed_to_the_daemon() {
        let projects = RegisteredProjects::for_test(
            vec![
                ("projectos".to_string(), PathBuf::from(r"dev\ProjectOS")),
                ("dead-aisle".to_string(), PathBuf::from("..")),
            ],
            RegistryStatus::Ok,
        );
        let mut args = Vec::new();
        append_registry_args(&mut args, &projects);
        assert_eq!(
            args,
            vec![REGISTRY_STATUS_FLAG.to_string(), "ok".to_string()],
            "no relative root may become a project root"
        );
    }

    /// A refused registry contributes no roots to argv at all — only the reason.
    #[test]
    fn a_refused_registry_contributes_only_its_reason() {
        let mut args = Vec::new();
        append_registry_args(
            &mut args,
            &RegisteredProjects::refused(RegistryStatus::Missing),
        );
        assert_eq!(
            args,
            vec![REGISTRY_STATUS_FLAG.to_string(), "missing".to_string()]
        );
    }

    /// PRODUCTION FAILS CLOSED ON THIS MACHINE, and does so without reading anything ambient. No
    /// installer has written a registry at the canonical location for this test binary, so the
    /// production route yields no projects. Nothing is written.
    #[test]
    fn production_governs_nothing_without_a_registry() {
        let resolved = resolve_registered_projects();
        if resolved.status() != RegistryStatus::Ok {
            assert!(resolved.projects().is_empty());
        }
    }
}
