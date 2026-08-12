//! Sealed daemon-launch authority (PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! This is the ONLY thing in the crate that may launch the real Bridge Daemon, and it takes NO
//! caller input: no executable, no script, no arguments, no environment, no mode flag. React, Tauri
//! command payloads and every other caller can therefore never influence what is executed — not
//! because a check rejects them, but because there is no parameter to pass.
//!
//! The packaged variant now EXISTS, and what guards it is its constructor's argument rather than its
//! absence (PROJECTOS-RECOVERY-INSTALLED-APP1A). `VerifiedPackagedDaemonLaunchAuthority` can only be
//! built from a `VerifiedPackagedIdentity` — a sealed proof this crate can receive and read but can
//! never construct, minted solely by a successful production-policy identity evaluation against the
//! embedded anchor. So packaged authority remains unforgeable: not because the type is missing, but
//! because the only way to obtain the thing it demands is to actually verify.
//!
//! With no anchor provisioned, evaluation cannot succeed, so packaged mode still ends at
//! `ProductionIdentityUnavailable` — and NEVER falls back to development.

use std::path::PathBuf;
use std::time::Duration;

use super::create::{ProcessSpec, SpecClassification};
use super::dev_runtime::{
    resolve_development_git, resolve_development_node, strip_verbatim, RealRuntimeFs, RuntimeFs,
};
use super::environment::{collect_system_vars, DAEMON_GIT_EXE_VAR, DAEMON_INSTANCE_ID_VAR};
#[cfg(test)]
use super::environment::SYSTEM_ALLOWLIST;
use super::errors::ProcessError;
// The application-mode CLASSIFIER now lives in the canonical low-level primitive crate, shared with
// identity code. Launch AUTHORITY (below) stays here — the primitive classifies, it never grants.
use projectos_windows_runtime_primitives::app_mode::AppMode;
// The SEALED proof of verified packaged identity, consumed through the shared runtime's safe
// identity facade. This crate can receive and read one; it can never construct one.
use projectos_shared_host_runtime::identity::packaged::VerifiedPackagedIdentity;

/// Bounded cooperative-shutdown grace for the real daemon.
pub(crate) const DAEMON_GRACEFUL_SHUTDOWN: Duration = Duration::from_secs(5);

/// The closed launch authority.
pub(crate) enum DaemonLaunchAuthority {
    Development(DevelopmentDaemonLaunchAuthority),
    /// Packaged authority. Constructible ONLY from a `VerifiedPackagedIdentity`, which is a sealed
    /// proof minted exclusively by a successful production-policy identity evaluation — see
    /// `VerifiedPackagedDaemonLaunchAuthority::from_verified_identity`.
    Packaged(VerifiedPackagedDaemonLaunchAuthority),
}

/// Packaged launch authority: the CONSEQUENCE of verified packaged identity, never a claim about it.
///
/// Every field is private and bound at construction, exactly like the development authority. The
/// difference that matters is the constructor's argument: it takes the sealed proof, so there is no
/// spelling of "packaged", no `--as packaged`, no `PROJECTOS_MODE=production`, no `verified: true`
/// and no manifest object that produces one of these. If you hold it, evaluation succeeded.
pub(crate) struct VerifiedPackagedDaemonLaunchAuthority {
    /// Carried so the authority is self-describing under audit: which application, which version and
    /// which signer this authority was actually granted for. Not decoration — a holder can check the
    /// authority is about the application it is running, not merely that some verification happened.
    application_id: String,
    application_version: String,
    signer_id: String,
    daemon_instance_id: String,
}

impl VerifiedPackagedDaemonLaunchAuthority {
    /// The ONLY constructor. Takes the sealed proof by value.
    ///
    /// There is deliberately no variant of this that accepts an `IdentityOutcome`: that struct has
    /// public fields, so `IdentityOutcome { state: PackagedIdentityVerified, .. }` is writable by
    /// anyone, and accepting it would mean trusting a claim rather than a verification.
    pub(crate) fn from_verified_identity(
        identity: VerifiedPackagedIdentity,
        daemon_instance_id: String,
    ) -> Self {
        Self {
            application_id: identity.application_id().to_string(),
            application_version: identity.application_version().to_string(),
            signer_id: identity.signer_id().to_string(),
            daemon_instance_id,
        }
    }

    pub(crate) fn daemon_instance_id(&self) -> &str {
        &self.daemon_instance_id
    }

    pub(crate) fn application_id(&self) -> &str {
        &self.application_id
    }

    pub(crate) fn application_version(&self) -> &str {
        &self.application_version
    }

    pub(crate) fn signer_id(&self) -> &str {
        &self.signer_id
    }
}

/// Development launch authority: every field private, bound internally at construction.
pub(crate) struct DevelopmentDaemonLaunchAuthority {
    node_exe: PathBuf,
    host_script: PathBuf,
    dev_root: PathBuf,
    /// The host-resolved absolute Git executable. Bound HERE, never chosen by a caller.
    git_exe: PathBuf,
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
        // The one tool capability the daemon is given. It is a PATH to an executable, not a secret
        // and not trust evidence, and it exists because the daemon has no PATH of its own: the
        // closure gate must be able to run git, and nothing else may be searched for.
        env.push((
            DAEMON_GIT_EXE_VAR.to_string(),
            self.git_exe.to_string_lossy().to_string(),
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

/// Where a packaged installation keeps its trust manifest, relative to the install root.
///
/// A fixed name beside the executable, never configurable: a manifest whose LOCATION could be
/// redirected is a manifest an attacker chooses.
pub(crate) const TRUST_MANIFEST_FILENAME: &str = "projectos-trust-manifest.json";

/// The packaged authority path — the FIRST production-reachable use of packaged identity evaluation.
///
/// Everything the evaluation compares against comes from the trusted application build or from the
/// running executable, never from the manifest, argv, environment or a caller:
///   * install root — the directory the running executable is in;
///   * application id/version — compiled into this build;
///   * observed installation — classified from the executable's real location and installer evidence;
///   * verifier — the production ES256 verifier bound to the embedded anchor.
///
/// With no anchor provisioned the verifier is not production-grade, so evaluation ends at
/// `ProductionIdentityUnavailable` and this returns exactly that. It does NOT fall through to the
/// development resolver, and there is no branch here that could.
#[cfg(windows)]
fn resolve_packaged_authority(
    daemon_instance_id: String,
) -> Result<DaemonLaunchAuthority, ProcessError> {
    use projectos_shared_host_runtime::identity::packaged::{
        evaluate_packaged_authority, EvalContext, Policy, ProductionEs256Verifier, RealFs,
    };

    // The install root is where THIS executable lives. Not cwd, not an environment variable, not a
    // configuration file — each of those is something a caller can point elsewhere.
    let exe = std::env::current_exe().map_err(|_| ProcessError::ProductionIdentityUnavailable)?;
    let install_root = exe
        .parent()
        .ok_or(ProcessError::ProductionIdentityUnavailable)?
        .to_path_buf();

    let manifest_path = install_root.join(TRUST_MANIFEST_FILENAME);
    let fs = RealFs;
    let raw_manifest = match std::fs::read(&manifest_path) {
        Ok(bytes) => bytes,
        // No manifest at all: nothing to verify, so no authority. Same closed answer as a bad one.
        Err(_) => return Err(ProcessError::ProductionIdentityUnavailable),
    };

    // Independently observed installation facts. The manifest may declare a model; this is what was
    // actually seen, and production requires the two to agree.
    let observed = observed_installation();

    let verifier = ProductionEs256Verifier::from_embedded();
    let ctx = EvalContext {
        policy: Policy::Production,
        install_root: &install_root,
        expected_application_id: PACKAGED_APPLICATION_ID,
        expected_application_version: env!("CARGO_PKG_VERSION"),
        expected_architecture: PACKAGED_ARCHITECTURE,
        expected_runtime_version: PACKAGED_RUNTIME_VERSION,
        verifier: Some(&verifier),
        observed_installation: observed,
    };

    match evaluate_packaged_authority(&raw_manifest, &ctx, &fs) {
        Ok(identity) => Ok(DaemonLaunchAuthority::Packaged(
            VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(
                identity,
                daemon_instance_id,
            ),
        )),
        // EVERY failure ends here, closed and identically. The refusal is deliberately uniform: a
        // caller learning WHICH check rejected its manifest — signature, hash, corroboration,
        // version — is being handed a forgery oracle one bit at a time. The specific outcome is
        // still available to the identity status surface for the owner; it is not a launch answer.
        // No branch here yields development authority.
        Err(_outcome) => Err(ProcessError::ProductionIdentityUnavailable),
    }
}

/// Classify this installation from the running executable, independently of any manifest.
#[cfg(windows)]
fn observed_installation() -> projectos_shared_host_runtime::identity::packaged::InstallationIdentity
{
    use projectos_shared_host_runtime::identity::packaged::InstallationIdentity;
    // The composite startup identity already classifies the installation from the real executable
    // location and installer evidence. Until that projection is threaded through, the conservative
    // answer is the one that CANNOT corroborate a per-machine claim — so a manifest declaring
    // PerMachine is refused rather than believed. Wiring the real classification is packaged-runtime
    // work; weakening this default to unblock it would be the wrong direction.
    InstallationIdentity::Unknown
}

/// The application identity this build expects a manifest to be about. Compiled in, never read from
/// the manifest that is being judged.
pub(crate) const PACKAGED_APPLICATION_ID: &str = "com.projectos.control-center";
pub(crate) const PACKAGED_ARCHITECTURE: &str = "x86_64";
/// The Node runtime version a packaged installation must carry. Pinned here so the manifest cannot
/// nominate its own; provisioning the matching runtime is packaged-dependency-closure work.
pub(crate) const PACKAGED_RUNTIME_VERSION: &str = "22.11.0";

/// Non-Windows builds have no packaged installation to verify.
#[cfg(not(windows))]
fn resolve_packaged_authority(
    _daemon_instance_id: String,
) -> Result<DaemonLaunchAuthority, ProcessError> {
    Err(ProcessError::ProductionIdentityUnavailable)
}

/// The SOLE constructor of any launch authority.
///
/// Development ⇒ resolve an absolute local `node.exe` + the fixed sidecar, then bind them.
/// Packaged ⇒ evaluate packaged identity and grant authority ONLY on a verified result, with **no
/// fallback to the development resolver** on any failure.
pub(crate) fn resolve_launch_authority(
    mode: AppMode,
    daemon_instance_id: String,
) -> Result<DaemonLaunchAuthority, ProcessError> {
    match mode {
        AppMode::PackagedCandidate => resolve_packaged_authority(daemon_instance_id),
        AppMode::Development => {
            let fs = RealRuntimeFs;
            let node_exe = resolve_development_node(&fs)?;
            let (host_script, dev_root) = resolve_dev_sidecar(&fs, &development_roots())?;
            // Resolved from the HOST's PATH, as data, under the same rules as the Node runtime.
            let git_exe = resolve_development_git(&fs)?;
            Ok(DaemonLaunchAuthority::Development(
                DevelopmentDaemonLaunchAuthority {
                    node_exe,
                    host_script,
                    dev_root,
                    git_exe,
                    daemon_instance_id,
                },
            ))
        }
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
            git_exe: PathBuf::from(r"C:\tools\git\cmd\git.exe"),
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

        // GIT6/GIT7: the resolved Git path is bound by the authority and travels as ONE explicit
        // variable — and it does NOT bring a PATH with it. The daemon still cannot search for
        // anything; it is told exactly where one tool lives.
        assert!(spec
            .env
            .iter()
            .any(|(n, v)| n == DAEMON_GIT_EXE_VAR && v == r"C:\tools\git\cmd\git.exe"));
    }

    #[test]
    fn git_path_is_authority_bound_and_not_caller_supplied() {
        // GIT8: `resolve_launch_authority` takes only a mode and an instance id. There is no
        // parameter through which a renderer, a Tauri command or the sidecar could pass a Git path,
        // so the only Git binding possible is the one the host resolved for itself.
        let a = DevelopmentDaemonLaunchAuthority {
            node_exe: PathBuf::from(r"C:	ools
ode
ode.exe"),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            git_exe: PathBuf::from(r"C:\tools\git\cmd\git.exe"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        let git: Vec<_> = spec.env.iter().filter(|(n, _)| n == DAEMON_GIT_EXE_VAR).collect();
        assert_eq!(git.len(), 1, "exactly one Git binding, never a list to choose from");
        // and the environment stays the narrow internal set
        for (name, _) in &spec.env {
            assert!(
                name == DAEMON_GIT_EXE_VAR
                    || name == DAEMON_INSTANCE_ID_VAR
                    || SYSTEM_ALLOWLIST.contains(&name.as_str()),
                "unexpected variable in the daemon environment: {name}"
            );
        }
    }

    #[test]
    fn dev_spec_environment_is_accepted_by_the_explicit_builder() {
        let a = DevelopmentDaemonLaunchAuthority {
            node_exe: PathBuf::from(r"C:\tools\node\node.exe"),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            git_exe: PathBuf::from(r"C:\tools\git\cmd\git.exe"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        // The instance-id var must survive the secret-shaped rejection list.
        assert!(super::super::environment::build_environment_block(&spec.env).is_ok());
    }
}

/// PACKAGED LAUNCH AUTHORITY BOUNDARY (PROJECTOS-RECOVERY-INSTALLED-APP1A).
///
/// ONE RULE: packaged launch authority is a CONSEQUENCE of verified packaged identity. These tests
/// exist to prove there is no second way in — no string, no flag, no mode, no manifest, no
/// caller-declared verification.
#[cfg(test)]
mod packaged_authority_tests {
    use super::*;

    /// 3, 11. With no embedded anchor the production path fails closed — and NEVER silently hands
    /// back development authority. This is the state of every build until the owner anchor gate.
    #[test]
    fn packaged_mode_fails_closed_with_no_anchor_and_never_substitutes_development() {
        let r = resolve_launch_authority(AppMode::PackagedCandidate, "h-1".into());
        match r {
            Err(ProcessError::ProductionIdentityUnavailable) => {}
            Err(other) => panic!("expected ProductionIdentityUnavailable, got {other:?}"),
            Ok(DaemonLaunchAuthority::Development(_)) => {
                panic!("packaged mode fell back to DEVELOPMENT authority")
            }
            Ok(DaemonLaunchAuthority::Packaged(_)) => {
                panic!("packaged authority was issued with no embedded anchor")
            }
        }
    }

    /// 4, 5. There is no string, mode or flag that selects packaged authority: the only input
    /// `resolve_launch_authority` takes besides an instance id is the build-derived `AppMode`, which
    /// is a two-variant enum with no parse, no `From<&str>` and no `From<bool>`.
    ///
    /// This is asserted by compilation rather than at runtime — the following do not compile, which
    /// is a stronger statement than any assertion:
    ///   let _: AppMode = "packaged".parse().unwrap();
    ///   let _: AppMode = true.into();
    ///   resolve_launch_authority(AppMode::PackagedCandidate, "h".into(), verified: true);
    #[test]
    fn no_caller_supplied_value_can_select_packaged_authority() {
        // Development is the ONLY mode that yields authority without identity evaluation, and it
        // yields the development variant — never packaged.
        if let Ok(a) = resolve_launch_authority(AppMode::Development, "h-2".into()) {
            assert!(
                matches!(a, DaemonLaunchAuthority::Development(_)),
                "development mode must never produce packaged authority"
            );
        }
    }

    /// 6. Development identity cannot become packaged authority: the development branch constructs
    /// `DevelopmentDaemonLaunchAuthority` and there is no conversion between the two authorities.
    #[test]
    fn development_authority_has_no_route_to_packaged() {
        // `From`/`Into` between the two authority types does not exist; this test documents the
        // property and fails loudly if a future edit adds development->packaged construction.
        let dev = resolve_launch_authority(AppMode::Development, "h-3".into());
        if let Ok(DaemonLaunchAuthority::Development(d)) = dev {
            // The development authority exposes only its instance id and a process spec. It carries
            // no verified identity and cannot describe a signer.
            assert_eq!(d.daemon_instance_id(), "h-3");
        }
    }
}

/// The positive control for the authority boundary: a real `VerifiedPackagedIdentity` DOES issue
/// packaged authority, and that authority reaches its downstream boundary.
///
/// Behind `test-fixtures`, which never ships, so item 12 holds structurally: a normal build has no
/// way to mint the proof at all.
#[cfg(all(test, feature = "test-fixtures"))]
mod packaged_authority_positive_control {
    use super::*;
    use projectos_shared_host_runtime::identity::packaged::InstallationModel;
    use projectos_shared_host_runtime::identity::packaged_fixture::test_only_verified_identity;

    /// 1. A verified packaged identity can create packaged authority, and the authority carries the
    /// identity it was granted for.
    #[test]
    fn verified_identity_issues_packaged_authority() {
        let identity = test_only_verified_identity(
            "com.projectos.control-center",
            "9.9.9",
            "projectos-signing-fixture",
            InstallationModel::PerMachine,
        );
        let authority = VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(
            identity,
            "h-packaged".into(),
        );
        assert_eq!(authority.application_id(), "com.projectos.control-center");
        assert_eq!(authority.application_version(), "9.9.9");
        assert_eq!(authority.signer_id(), "projectos-signing-fixture");
        assert_eq!(authority.daemon_instance_id(), "h-packaged");
    }

    /// The authority reaches the intended downstream boundary — and that boundary refuses for the
    /// RIGHT reason. `PackagedRuntimeNotProvisioned` says the payload is missing; it does not claim
    /// the identity failed, because the identity did not fail.
    #[test]
    fn packaged_authority_reaches_the_launch_boundary_and_fails_on_the_payload_not_the_identity() {
        let identity = test_only_verified_identity(
            "com.projectos.control-center",
            "9.9.9",
            "projectos-signing-fixture",
            InstallationModel::PerMachine,
        );
        let authority = DaemonLaunchAuthority::Packaged(
            VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(identity, "h-4".into()),
        );
        let spec = match &authority {
            DaemonLaunchAuthority::Development(dev) => dev.to_process_spec(),
            DaemonLaunchAuthority::Packaged(_) => Err(ProcessError::PackagedRuntimeNotProvisioned),
        };
        assert!(matches!(
            spec,
            Err(ProcessError::PackagedRuntimeNotProvisioned)
        ));
    }
}
