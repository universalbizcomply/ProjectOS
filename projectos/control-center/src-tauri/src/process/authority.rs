//! Sealed daemon-launch authority (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! This is the ONLY thing in the crate that may launch the real Bridge Daemon, and it takes NO
//! caller input: no executable, no script, no arguments, no environment, no mode flag. React, Tauri
//! command payloads and every other caller can therefore never influence what is executed — not
//! because a check rejects them, but because there is no parameter to pass.
//!
//! The packaged variant is deliberately absent: `DaemonLaunchAuthority` has exactly one constructible
//! variant this phase, so a packaged launch is UNREPRESENTABLE rather than merely refused. Packaged
//! mode returns `ProductionIdentityUnavailable` and NEVER falls back to development.

use std::path::PathBuf;
use std::time::Duration;

use super::create::{ProcessSpec, SpecClassification};
use super::dev_runtime::{resolve_development_node, strip_verbatim, RealRuntimeFs, RuntimeFs};
use super::environment::{collect_system_vars, DAEMON_INSTANCE_ID_VAR};
use super::errors::ProcessError;

/// Bounded cooperative-shutdown grace for the real daemon.
pub(crate) const DAEMON_GRACEFUL_SHUTDOWN: Duration = Duration::from_secs(5);

/// How the application was started. Determined from build/packaging facts, never from an
/// environment variable, CLI flag, React payload, or working-directory name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AppMode {
    /// Running from a development tree. Always `DEVELOPMENT_UNVERIFIED`.
    Development,
    /// Running from a packaged installation. Requires verified packaged identity — unavailable.
    PackagedCandidate,
}

/// The closed launch authority. Only `Development` is constructible in this phase.
pub(crate) enum DaemonLaunchAuthority {
    Development(DevelopmentDaemonLaunchAuthority),
    // Packaged(VerifiedPackagedDaemonLaunchAuthority) — intentionally does not exist yet. Adding it
    // requires accepted packaged identity evidence (signed manifest + embedded anchor + runtime and
    // artefact hashes + app/version binding), not a boolean or a mode string.
}

/// Development launch authority: every field private, bound internally at construction.
pub(crate) struct DevelopmentDaemonLaunchAuthority {
    node_exe: PathBuf,
    host_script: PathBuf,
    dev_root: PathBuf,
    daemon_instance_id: String,
}

impl DevelopmentDaemonLaunchAuthority {
    pub(crate) fn daemon_instance_id(&self) -> &str {
        &self.daemon_instance_id
    }

    /// Build the fixed internal specification. The caller supplies nothing: executable, arguments,
    /// working directory and environment are all bound here.
    pub(crate) fn to_process_spec(&self) -> Result<ProcessSpec, ProcessError> {
        let mut env = collect_system_vars(&["SystemRoot"]);
        env.push((
            DAEMON_INSTANCE_ID_VAR.to_string(),
            self.daemon_instance_id.clone(),
        ));
        Ok(ProcessSpec {
            executable: self.node_exe.to_string_lossy().to_string(),
            // Fixed internal arguments only — the script path is authority-bound, never caller-set.
            args: vec![self.host_script.to_string_lossy().to_string()],
            current_dir: self.dev_root.to_string_lossy().to_string(),
            env,
            graceful_shutdown: DAEMON_GRACEFUL_SHUTDOWN,
            classification: SpecClassification::SyntheticTest,
        })
    }
}

/// Resolve the fixed development sidecar entry (`sidecar/host.mjs`) from a controlled development
/// root. No caller-selected JavaScript, no ambient cwd, no fallback to another script.
fn resolve_dev_sidecar(
    fs: &dyn RuntimeFs,
    roots: &[PathBuf],
) -> Result<(PathBuf, PathBuf), ProcessError> {
    for root in roots {
        let candidate = root.join("sidecar").join("host.mjs");
        if fs.is_file(&candidate) {
            // Strip the ? verbatim prefix: Node cannot parse it and fails with EISDIR.
            let script = strip_verbatim(
                fs.canonicalize(&candidate)
                    .ok_or(ProcessError::DevSidecarNotFound)?,
            );
            let dev_root = strip_verbatim(
                fs.canonicalize(root)
                    .ok_or(ProcessError::DevSidecarNotFound)?,
            );
            return Ok((script, dev_root));
        }
    }
    Err(ProcessError::DevSidecarNotFound)
}

/// Candidate development roots, derived from the running executable's location — never from the
/// ambient current directory.
fn development_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        // Walk up from the executable, never from the ambient cwd. The depth must cover both the
        // app binary (target/<profile>/app.exe) and a test binary, which sits one level deeper in
        // target/<profile>/deps/ — a 4-level walk missed `control-center` for tests.
        let mut p = exe.parent().map(|d| d.to_path_buf());
        for _ in 0..6 {
            match p {
                Some(ref d) => {
                    roots.push(d.clone());
                    p = d.parent().map(|x| x.to_path_buf());
                }
                None => break,
            }
        }
    }
    roots
}

/// The SOLE constructor of any launch authority.
///
/// Development ⇒ resolve an absolute local `node.exe` + the fixed sidecar, then bind them.
/// Packaged ⇒ `ProductionIdentityUnavailable`, with **no fallback to the development resolver**.
pub(crate) fn resolve_launch_authority(
    mode: AppMode,
    daemon_instance_id: String,
) -> Result<DaemonLaunchAuthority, ProcessError> {
    match mode {
        AppMode::PackagedCandidate => Err(ProcessError::ProductionIdentityUnavailable),
        AppMode::Development => {
            let fs = RealRuntimeFs;
            let node_exe = resolve_development_node(&fs)?;
            let (host_script, dev_root) = resolve_dev_sidecar(&fs, &development_roots())?;
            Ok(DaemonLaunchAuthority::Development(
                DevelopmentDaemonLaunchAuthority {
                    node_exe,
                    host_script,
                    dev_root,
                    daemon_instance_id,
                },
            ))
        }
    }
}

/// Detect the application mode from packaging facts only.
///
/// A development build is `debug_assertions`. A release build is treated as a packaged candidate,
/// which fails closed until packaged identity exists. Nothing here reads an env var, CLI flag,
/// React payload, or directory name.
pub(crate) fn detect_app_mode() -> AppMode {
    if cfg!(debug_assertions) {
        AppMode::Development
    } else {
        AppMode::PackagedCandidate
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    struct FakeFs {
        files: HashSet<PathBuf>,
        dirs: HashSet<PathBuf>,
    }
    impl RuntimeFs for FakeFs {
        fn is_file(&self, p: &std::path::Path) -> bool {
            self.files.contains(p)
        }
        fn canonicalize(&self, p: &std::path::Path) -> Option<PathBuf> {
            (self.files.contains(p) || self.dirs.contains(p)).then(|| p.to_path_buf())
        }
    }

    #[test]
    fn packaged_mode_fails_closed_and_never_falls_back_to_development() {
        let r = resolve_launch_authority(AppMode::PackagedCandidate, "h-1".into());
        assert!(matches!(
            r,
            Err(ProcessError::ProductionIdentityUnavailable)
        ));
        // And the error must not imply a process exists.
        assert!(!ProcessError::ProductionIdentityUnavailable.process_may_exist());
    }

    #[test]
    fn dev_sidecar_resolves_only_the_fixed_entry_point() {
        let root = PathBuf::from(r"C:\dev\cc");
        let fs = FakeFs {
            files: [root.join("sidecar").join("host.mjs")]
                .into_iter()
                .collect(),
            dirs: [root.clone()].into_iter().collect(),
        };
        let (script, dev_root) = resolve_dev_sidecar(&fs, std::slice::from_ref(&root)).unwrap();
        assert!(script.ends_with(r"sidecar\host.mjs"));
        assert_eq!(dev_root, root);
    }

    #[test]
    fn missing_dev_sidecar_is_typed_not_a_fallback() {
        let fs = FakeFs {
            files: HashSet::new(),
            dirs: HashSet::new(),
        };
        assert_eq!(
            resolve_dev_sidecar(&fs, &[PathBuf::from(r"C:\dev\cc")]),
            Err(ProcessError::DevSidecarNotFound)
        );
    }

    #[test]
    fn dev_spec_binds_everything_internally() {
        let a = DevelopmentDaemonLaunchAuthority {
            node_exe: PathBuf::from(r"C:\tools\node\node.exe"),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        assert_eq!(spec.executable, r"C:\tools\node\node.exe");
        assert_eq!(spec.args, vec![r"C:\dev\cc\sidecar\host.mjs".to_string()]);
        assert_eq!(spec.current_dir, r"C:\dev\cc");
        // The instance id is injected by the authority, never by a caller.
        assert!(spec
            .env
            .iter()
            .any(|(n, v)| n == DAEMON_INSTANCE_ID_VAR && v == "host1-1"));
        // No PATH, no secrets.
        assert!(!spec.env.iter().any(|(n, _)| n.eq_ignore_ascii_case("PATH")));
    }

    #[test]
    fn dev_spec_environment_is_accepted_by_the_explicit_builder() {
        let a = DevelopmentDaemonLaunchAuthority {
            node_exe: PathBuf::from(r"C:\tools\node\node.exe"),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        // The instance-id var must survive the secret-shaped rejection list.
        assert!(super::super::environment::build_environment_block(&spec.env).is_ok());
    }

    #[test]
    fn detect_app_mode_is_not_ambient() {
        // Under `cargo test` this is a debug build ⇒ Development. The point is that the decision
        // comes from the build, never from an env var a caller could set.
        std::env::set_var("PROJECTOS_MODE", "production");
        assert_eq!(detect_app_mode(), AppMode::Development);
        std::env::remove_var("PROJECTOS_MODE");
    }
}
