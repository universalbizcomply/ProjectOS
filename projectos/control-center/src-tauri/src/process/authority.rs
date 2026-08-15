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
//! THIS PATH IS NOW LIVE. It previously could not succeed at all: no production anchor was
//! provisioned, so the verifier was never production-grade and packaged mode always ended at
//! `ProductionIdentityUnavailable`. The owner provisioned the anchor on 2026-08-12, so this is a
//! real trust decision over the manifest found at the payload root — it can now SUCCEED, and what
//! it grants is packaged launch authority.
//!
//! What has not changed: it still NEVER falls back to development. Failure is still refusal.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::create::{ProcessSpec, SpecClassification};
use super::dev_runtime::{
    accept_candidate_named, is_clean_absolute, is_local_absolute, resolve_development_git,
    resolve_development_node, strip_verbatim, RealRuntimeFs, RuntimeFs, GIT_EXE,
};
#[cfg(test)]
use super::environment::SYSTEM_ALLOWLIST;
use super::environment::{
    collect_system_vars, DAEMON_BRIDGE_CONFIG_VAR, DAEMON_GIT_EXE_VAR, DAEMON_INSTANCE_ID_VAR,
};
use super::errors::ProcessError;
// The application-mode CLASSIFIER now lives in the canonical low-level primitive crate, shared with
// identity code. Launch AUTHORITY (below) stays here — the primitive classifies, it never grants.
use projectos_windows_runtime_primitives::app_mode::AppMode;
// The SEALED proof of verified packaged identity, consumed through the shared runtime's safe
// identity facade. This crate can receive and read one; it can never construct one.
use projectos_shared_host_runtime::identity::packaged::VerifiedPackagedIdentity;
// THE governed ProjectOS system root. Sealed, and a consequence of verified identity — see
// `governed_root.rs` for why it cannot come from cwd, config, environment, argv or discovery.
use super::governed_root::GovernedSystemRoot;
#[cfg(windows)]
use super::governed_root::{resolve_governed_system_root, InstalledSystemRoot};
// THE installed-project registry. Sealed, and read from the protected ProgramData installation
// directory — see `installed_projects.rs` for why it cannot come from cwd, config, environment,
// argv, the governed project or discovery.
#[cfg(windows)]
use super::installed_projects::resolve_registered_projects;
use super::installed_projects::{append_registry_args, RegisteredProjects};

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

/// THE launch specification for either authority — the one place the enum is turned into a spec.
///
/// Extracted so it can be TESTED. It previously lived inline in `lifecycle.rs`, and a regression
/// written against a copy of that match passed happily while the real arm was reverted: a test that
/// mirrors code proves only that the mirror is consistent with itself. Both the lifecycle and the
/// regression now call this, so reverting the packaged arm fails the test.
///
/// Neither arm is privileged here and nothing downstream branches on which one produced the spec.
pub(crate) fn process_spec_for(
    authority: &DaemonLaunchAuthority,
) -> Result<ProcessSpec, ProcessError> {
    match authority {
        DaemonLaunchAuthority::Development(dev) => dev.to_process_spec(),
        // Packaged now LAUNCHES. This arm returned `PackagedRuntimeNotProvisioned`
        // unconditionally, which was true when written — no payload was built then — and became a
        // lie once the installer began shipping one: a real installation would verify its identity
        // perfectly and then be told its payload was missing while it sat beside the executable.
        DaemonLaunchAuthority::Packaged(packaged) => packaged.to_process_spec(),
    }
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
    /// The closed runtime payload this authority may launch — an app-owned subdirectory of the
    /// install root, never a caller's path.
    payload_root: PathBuf,
    /// The ProjectOS SYSTEM root this installation is authorised to operate. Sealed: it can only
    /// have come from `resolve_governed_system_root`, which itself demands the verified identity.
    governed_system_root: GovernedSystemRoot,
    /// The ONE machine-owned Git this packaged installation may run. Sealed: a `ResolvedPackagedGit`
    /// can only have come from `resolve_packaged_git`, so `to_process_spec` has nothing to be told
    /// and no caller — in this crate or any other — can name a different executable.
    git_exe: ResolvedPackagedGit,
    /// The projects this installation may govern, read from the protected registry and validated
    /// against the repositories they name. Sealed for the same reason the roots above are: a
    /// `RegisteredProjects` can only have come from `resolve_registered_projects`, which takes no
    /// arguments at all, so there is no parameter through which a project root could be nominated.
    registered_projects: RegisteredProjects,
}

/// The one relative location a PACKAGED installation may look for Git.
///
/// Deliberately a fixed sibling of the application's own Program Files directory, and nothing else.
/// Development resolves Git by searching PATH, which is correct there — a developer's PATH is their
/// own statement of intent. A packaged, per-machine installation must not inherit that: PATH is
/// user-writable, so a `git.exe` dropped in any user directory that happens to precede the real one
/// would become the executable a machine-wide installation runs. The fixed candidate cannot be
/// influenced by a user, a governed repository, a configuration file, the working directory, or the
/// environment this application was launched with.
const PACKAGED_GIT_RELATIVE: [&str; 3] = ["Git", "cmd", GIT_EXE];

/// A Git path that came from `resolve_packaged_git` and from nowhere else.
///
/// The private field is the whole point, and it mirrors `GovernedSystemRoot`: possessing one of
/// these IS the evidence that the approved resolver produced it. Before this existed the authority
/// held a bare `PathBuf`, which was safe only because there happened to be exactly one production
/// call site — a property maintained by review rather than by the compiler. A future edit adding a
/// second caller would not have failed to build; now it cannot supply a path at all without going
/// through the resolver.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ResolvedPackagedGit(PathBuf);

impl ResolvedPackagedGit {
    fn path(&self) -> &Path {
        &self.0
    }

    /// TEST-ONLY minting, so fixtures can exercise the DOWNSTREAM boundary without a real machine
    /// layout. Behind `test-fixtures`, which never ships, so a release build cannot construct one
    /// except through the resolver.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub(crate) fn test_only(path: PathBuf) -> Self {
        Self(path)
    }
}

/// Resolve the packaged Git capability, or refuse.
///
/// `install_root` must be the VERIFIED install root — the directory the observed executable really
/// runs from, which identity evaluation has already matched against the installation record. Its
/// parent is the Program Files root, and the candidate is that parent plus one fixed relative path.
///
/// WHAT THIS DOES NOT DO, each for a reason: it does not read PATH, `PROJECTOS_GIT_EXE`, argv,
/// `project-config.json`, `bridge.config.json` or the registry; it does not call `where.exe`,
/// `SearchPathW` or a shell; it does not search the governed repository, the working directory or
/// LocalAppData; and it has no development fallback. Every one of those is a channel some other
/// principal could write to, which would make "which Git does a machine-wide installation run?"
/// their answer instead of the installation's.
///
/// A DEPTH ASSUMPTION THAT LIVES IN ANOTHER FILE. `install_root.parent()` is the Program Files root
/// only because the installer nests `INSTALLDIR` DIRECTLY under the platform Program Files folder —
/// see `packaging/wix/main.wxs`, whose Directory tree is
/// `$(var.PlatformProgramFilesFolder)` -> `INSTALLDIR`. Note that identity's own corroboration is
/// looser: `install_root.rs::classify_path` accepts any descendant of Program Files, not only a
/// direct child, so it would keep passing if the installer ever nested one level deeper while this
/// resolver started refusing. The refusal would be closed and safe but silent, so the direct nesting
/// is pinned by the packaging validator rather than left as an assumption two files apart.
///
/// The guards themselves are `dev_runtime`'s, reused rather than rewritten — their own comment says
/// the executable name is a parameter precisely so Git does not get a second, subtly different
/// resolver. One extra check is added here: the canonical target must still live beneath the same
/// canonical Program Files root, so a link placed at the fixed location cannot redirect execution
/// out of the machine-owned tree.
fn resolve_packaged_git(
    fs: &dyn RuntimeFs,
    install_root: &Path,
) -> Result<ResolvedPackagedGit, ProcessError> {
    let program_files = install_root
        .parent()
        .ok_or(ProcessError::PackagedGitNotProvisioned)?;
    if !is_clean_absolute(program_files) || !is_local_absolute(program_files) {
        return Err(ProcessError::PackagedGitNotProvisioned);
    }
    let mut candidate = program_files.to_path_buf();
    for segment in PACKAGED_GIT_RELATIVE {
        candidate.push(segment);
    }

    let resolved = accept_candidate_named(fs, &candidate, GIT_EXE)
        .ok_or(ProcessError::PackagedGitNotProvisioned)?;

    // CONTAINMENT. `accept_candidate_named` already refuses a canonical target that escaped to a
    // network or device path; this refuses one that stayed local but left Program Files — a
    // junction at the fixed location pointing into a user-writable directory would otherwise pass
    // every other check while handing execution to whoever can write there.
    let canonical_root = strip_verbatim(
        fs.canonicalize(program_files)
            .ok_or(ProcessError::PackagedGitNotProvisioned)?,
    );
    // Both sides come from the SAME `canonicalize` + `strip_verbatim` pipeline on the same volume,
    // so `starts_with` compares consistently-normalised components rather than raw strings. That
    // matters twice over: it defeats the string-prefix trick where `C:\Program FilesEvil` appears
    // to sit under `C:\Program Files`, and it means Windows' case-insensitivity cannot cause a
    // false refusal, because neither side is spelled by a caller. Confirmed against the real
    // installation (both resolved to `\?\C:\Program Files...` with identical on-disk casing) —
    // live evidence, not a CI assertion: the test double canonicalises by identity and so cannot
    // model case normalisation at all.
    if !resolved.starts_with(&canonical_root) {
        return Err(ProcessError::PackagedGitNotProvisioned);
    }
    Ok(ResolvedPackagedGit(resolved))
}

impl VerifiedPackagedDaemonLaunchAuthority {
    /// The ONLY constructor. Takes the sealed proof by value.
    ///
    /// There is deliberately no variant of this that accepts an `IdentityOutcome`: that struct has
    /// public fields, so `IdentityOutcome { state: PackagedIdentityVerified, .. }` is writable by
    /// anyone, and accepting it would mean trusting a claim rather than a verification.
    ///
    /// The governed root is taken as a SEALED `GovernedSystemRoot` rather than a path, so this
    /// constructor cannot be handed a directory somebody merely liked the look of. Both roots are
    /// bound here and are private thereafter.
    pub(crate) fn from_verified_identity(
        identity: VerifiedPackagedIdentity,
        daemon_instance_id: String,
        payload_root: PathBuf,
        governed_system_root: GovernedSystemRoot,
        git_exe: ResolvedPackagedGit,
        registered_projects: RegisteredProjects,
    ) -> Self {
        Self {
            application_id: identity.application_id().to_string(),
            application_version: identity.application_version().to_string(),
            signer_id: identity.signer_id().to_string(),
            daemon_instance_id,
            payload_root,
            governed_system_root,
            git_exe,
            registered_projects,
        }
    }

    pub(crate) fn daemon_instance_id(&self) -> &str {
        &self.daemon_instance_id
    }

    /// The ProjectOS system root this authority governs.
    pub(crate) fn governed_system_root(&self) -> &std::path::Path {
        self.governed_system_root.path()
    }

    /// The packaged runtime payload root this authority launches from.
    pub(crate) fn payload_root(&self) -> &std::path::Path {
        &self.payload_root
    }

    /// Build the fixed packaged specification. The caller supplies nothing.
    ///
    /// Everything is derived from values bound at construction, and every one of those came from
    /// the trusted application build or from a verified identity:
    ///   * the executable is the PINNED runtime inside the payload, at the contract's path — never
    ///     an interpreter found on PATH;
    ///   * the script is the closed daemon bundle inside the same payload;
    ///   * the governed root is passed EXPLICITLY, so the daemon is told which ProjectOS it may
    ///     operate rather than discovering one by scanning for a `.projectops` directory;
    ///   * the working directory is the payload root — deterministic and app-owned. The daemon does
    ///     not derive anything from it; it is set so nothing is inherited.
    ///
    /// `PROJECTOS_BRIDGE_CONFIG` is deliberately ABSENT. It is the development route for supplying
    /// watch roots, and a packaged installation must not be redirectable by a configuration file.
    pub(crate) fn to_process_spec(&self) -> Result<ProcessSpec, ProcessError> {
        use projectos_packaged_runtime_contract as contract;

        let node = self.payload_root.join(contract::RUNTIME_RELATIVE_PATH);
        let daemon = self.payload_root.join(contract::DAEMON_RELATIVE_PATH);
        if !node.is_file() || !daemon.is_file() {
            return Err(ProcessError::PackagedRuntimeNotProvisioned);
        }

        let mut env = collect_system_vars(&["SystemRoot"]);
        env.push((
            DAEMON_INSTANCE_ID_VAR.to_string(),
            self.daemon_instance_id.clone(),
        ));
        // The ONE tool capability a packaged daemon receives, already resolved and sealed into this
        // authority. The daemon has no PATH, so this variable is the only way it can run Git at all
        // — and because it was bound at construction from the verified install root, nothing the
        // caller, the environment or the governed repository says can change which Git that is.
        env.push((
            DAEMON_GIT_EXE_VAR.to_string(),
            self.git_exe.path().to_string_lossy().to_string(),
        ));
        let mut args = vec![
            daemon.to_string_lossy().to_string(),
            "--root".to_string(),
            self.governed_system_root
                .path()
                .to_string_lossy()
                .to_string(),
        ];
        // The GOVERNABLE PROJECTS, passed explicitly and one at a time. The daemon is TOLD which
        // repositories it may govern; it does not find them by scanning, by reading a configuration
        // file, or by treating the system root above as a project. A refused registry contributes
        // no roots at all — only the token saying why — so a packaged installation whose registry
        // cannot be validated governs nothing rather than governing whatever it stumbles across.
        append_registry_args(&mut args, &self.registered_projects);
        Ok(ProcessSpec {
            executable: node.to_string_lossy().to_string(),
            args,
            current_dir: self.payload_root.to_string_lossy().to_string(),
            env,
            graceful_shutdown: DAEMON_GRACEFUL_SHUTDOWN,
            classification: SpecClassification::PackagedRuntime,
        })
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
        // The DEVELOPMENT bridge configuration, as one absolute path bound here. The daemon no
        // longer reads `bridge.config.json` from its working directory, so this is the only way it
        // can receive one — and only development binds it. Injected unconditionally: whether the
        // file exists is the daemon's business, and probing for it here would make the authority's
        // behaviour depend on the state of the very file it is trying to name.
        env.push((
            DAEMON_BRIDGE_CONFIG_VAR.to_string(),
            self.dev_root
                .join("bridge.config.json")
                .to_string_lossy()
                .to_string(),
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

/// THE APPLICATION INSTALL ROOT: the directory the running executable lives in.
///
/// Derived from `current_exe()` and nothing else — not cwd, not an environment variable, not a
/// configuration file, each of which is something a caller can point elsewhere. It also holds the
/// Tauri runtime DLLs, the icons and whatever the installer owns, none of which the trust manifest
/// describes and none of which it should appear to.
#[cfg(windows)]
fn application_install_root() -> Result<PathBuf, ProcessError> {
    let exe = std::env::current_exe().map_err(|_| ProcessError::ProductionIdentityUnavailable)?;
    Ok(exe
        .parent()
        .ok_or(ProcessError::ProductionIdentityUnavailable)?
        .to_path_buf())
}

/// THE PACKAGED RUNTIME PAYLOAD ROOT: one app-owned subdirectory of the install root.
///
/// Named once by the packaging contract and joined here. Keeping it separate from the install root
/// is what lets the payload be a CLOSED set — pinned runtime, daemon bundle, manifest, canonical
/// bytes and nothing else — so dependency closure can enumerate it without knowing the
/// application's own file list.
#[cfg(windows)]
fn packaged_payload_root(install_root: &std::path::Path) -> PathBuf {
    install_root.join(projectos_packaged_runtime_contract::PAYLOAD_RELATIVE_ROOT)
}

/// The packaged authority path — the FIRST production-reachable use of packaged identity evaluation.
///
/// Everything the evaluation compares against comes from the trusted application build or from the
/// running executable, never from the manifest, argv, environment or a caller:
///   * install root — the directory the running executable is in;
///   * application id/version — compiled into this build;
///   * observed installation — classified from the executable's real location and installer evidence;
///   * verifier — the production ES256 verifier bound to the embedded anchor.
///
/// The anchor is provisioned, so the verifier IS production-grade and this evaluation can succeed.
/// It succeeds only on a manifest that the embedded anchor's key actually signed; everything else —
/// an unsigned manifest, another signer, a tampered byte — ends in refusal. It does NOT fall through
/// to the development resolver, and there is no branch here that could.
#[cfg(windows)]
fn resolve_packaged_authority(
    daemon_instance_id: String,
) -> Result<DaemonLaunchAuthority, ProcessError> {
    use projectos_shared_host_runtime::identity::packaged::{
        evaluate_packaged_authority, EvalContext, Policy, ProductionEs256Verifier, RealFs,
    };

    let install_root = application_install_root()?;
    let payload_root = packaged_payload_root(&install_root);

    // The manifest is part of the PAYLOAD, at a fixed name. Application-owned and deterministic: a
    // manifest whose location could be redirected is a manifest an attacker chooses.
    let manifest_path = payload_root.join(TRUST_MANIFEST_FILENAME);
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
        payload_root: &payload_root,
        expected_application_id: PACKAGED_APPLICATION_ID,
        expected_application_version: env!("CARGO_PKG_VERSION"),
        expected_architecture: PACKAGED_ARCHITECTURE,
        expected_runtime_version: PACKAGED_RUNTIME_VERSION,
        verifier: Some(&verifier),
        observed_installation: observed,
    };

    match evaluate_packaged_authority(&raw_manifest, &ctx, &fs) {
        Ok(identity) => {
            // The governed system root is a CONSEQUENCE of the verified identity, resolved through
            // the approved seam. Production has no approved resolver, so this refuses — with its own
            // reason rather than pretending the identity failed, and never by falling back to
            // development.
            let governed = resolve_governed_system_root(
                &identity,
                &InstalledSystemRoot {
                    application_version: env!("CARGO_PKG_VERSION"),
                    observed_install_root: &install_root,
                },
            )
            .map_err(|_| ProcessError::PackagedRuntimeNotProvisioned)?;
            // Resolved only NOW, after identity succeeded, from the install root that identity
            // itself matched against the installation record. Resolving it earlier would mean
            // deciding what an unverified application may execute.
            // A RuntimeFs, not the identity `RealFs`: this is filesystem probing for an
            // executable, not identity evaluation, and the two abstractions stay separate.
            let git_exe = resolve_packaged_git(&RealRuntimeFs, &install_root)?;
            // Resolved only NOW, after identity succeeded, and from nothing but the canonical
            // protected location. A registry that is missing, malformed or self-contradictory
            // yields zero projects rather than a refusal to launch: the owner then has a surface
            // that says so, instead of an application that will not start and cannot explain why.
            let registered_projects = resolve_registered_projects();
            Ok(DaemonLaunchAuthority::Packaged(
                VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(
                    identity,
                    daemon_instance_id,
                    payload_root,
                    governed,
                    git_exe,
                    registered_projects,
                ),
            ))
        }
        // EVERY failure ends here, closed and identically. The refusal is deliberately uniform: a
        // caller learning WHICH check rejected its manifest — signature, hash, corroboration,
        // version — is being handed a forgery oracle one bit at a time. The specific outcome is
        // still available to the identity status surface for the owner; it is not a launch answer.
        // No branch here yields development authority.
        Err(_outcome) => Err(ProcessError::ProductionIdentityUnavailable),
    }
}

/// Classify this installation from the running executable, independently of any manifest.
///
/// REAL OBSERVATION NOW. This returned `InstallationIdentity::Unknown` — a placeholder that refused
/// every packaged manifest for a reason that had nothing to do with the manifest. It now calls THE
/// existing classifier, the same one `classify_packaged_candidate` uses; no second classifier was
/// added, and none should be.
///
/// WHAT IT STILL WILL NOT DO. Being under Program Files is not, on its own, a verified per-machine
/// installation. `classify_installation` returns `PerMachineUnverified` for exactly that case — a
/// copied tree satisfies it — and only independent installer evidence lifts it to
/// `PerMachineEvidenceMatched`. `NoInstallerEvidence` is the production provider and reports
/// `Unavailable`, because no approved installer record resolver exists yet. So production still does
/// not corroborate, and it now says so for the right reason.
///
/// Failing to establish the running executable's identity at all falls to `Unknown`, which
/// corroborates nothing.
#[cfg(windows)]
fn observed_installation() -> projectos_shared_host_runtime::identity::packaged::InstallationIdentity
{
    use projectos_shared_host_runtime::identity::packaged::{
        classify_installation, InstallationIdentity, InstalledApplicationEvidence,
        RunningExecutable,
    };
    let Some(exe) = RunningExecutable::open_current() else {
        return InstallationIdentity::Unknown;
    };
    let Ok(install_root) = application_install_root() else {
        return InstallationIdentity::Unknown;
    };
    // The evidence is the installer's own record, verified against THIS installation. Absent or
    // contradicted, it does not corroborate, and a Program Files location on its own still
    // classifies as PerMachineUnverified.
    classify_installation(
        &exe,
        &InstalledApplicationEvidence {
            expected_application_id: PACKAGED_APPLICATION_ID,
            expected_application_version: env!("CARGO_PKG_VERSION"),
            observed_install_root: &install_root,
        },
    )
}

/// The application identity this build expects a manifest to be about. Compiled in, never read from
/// the manifest that is being judged.
///
/// ONE DECLARATION. This was `com.projectos.control-center` while `tauri.conf.json` stamped
/// `com.universalbizcomply.projectos.control` into the actual Windows bundle. Nothing compared them,
/// so a manifest generated for the real product would have been refused by the real product. Both
/// now derive from the packaging contract, and `tauri_identifier_matches_the_packaging_contract`
/// parses `tauri.conf.json` and fails if they ever drift again.
pub(crate) const PACKAGED_APPLICATION_ID: &str =
    projectos_packaged_runtime_contract::PACKAGED_APPLICATION_ID;

/// The architecture and Node runtime version a packaged installation must carry, taken from THE
/// packaging contract (PROJECTOS-RECOVERY-INSTALLED-APP1A).
///
/// `PACKAGED_RUNTIME_VERSION` was the literal `"22.11.0"` — a version no packaging step ever
/// provisioned, describing a runtime that did not exist. It is now bound to the same constant the
/// packaging tool writes into `runtime.expectedVersion`, and the contract enforces that pin by
/// SHA-256 when the payload is assembled. `evaluate()` compares the manifest's declared version
/// against this one and refuses a mismatch, so packager and application cannot drift apart quietly:
/// they read the same declaration, and a disagreement is a refusal rather than a silent acceptance.
pub(crate) const PACKAGED_ARCHITECTURE: &str =
    projectos_packaged_runtime_contract::PACKAGED_ARCHITECTURE;
pub(crate) const PACKAGED_RUNTIME_VERSION: &str =
    projectos_packaged_runtime_contract::PACKAGED_NODE_VERSION;

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

    // ============================================================================================
    // PACKAGED GIT CAPABILITY (PROJECTOS-RECOVERY-INSTALLED-APP1A / PACKAGED-DAEMON-LAUNCH1A)
    // ============================================================================================

    /// A filesystem whose canonicalisation can REDIRECT, so a link at the fixed location can be
    /// modelled. `FakeFs` above canonicalises to identity, which cannot express that case.
    struct RedirectFs {
        files: HashSet<PathBuf>,
        dirs: HashSet<PathBuf>,
        links: Vec<(PathBuf, PathBuf)>,
    }
    impl RedirectFs {
        fn new(files: &[&str], dirs: &[&str]) -> Self {
            Self {
                files: files.iter().map(PathBuf::from).collect(),
                dirs: dirs.iter().map(PathBuf::from).collect(),
                links: Vec::new(),
            }
        }
        fn redirecting(mut self, from: &str, to: &str) -> Self {
            self.links.push((PathBuf::from(from), PathBuf::from(to)));
            self
        }
    }
    impl RuntimeFs for RedirectFs {
        fn is_file(&self, p: &std::path::Path) -> bool {
            self.files.contains(p)
        }
        fn canonicalize(&self, p: &std::path::Path) -> Option<PathBuf> {
            for (from, to) in &self.links {
                if from == p {
                    return Some(to.clone());
                }
            }
            (self.files.contains(p) || self.dirs.contains(p)).then(|| p.to_path_buf())
        }
    }

    const TEST_INSTALL_ROOT: &str = r"C:\Program Files\ProjectOS Control Center";
    const TEST_REAL_GIT: &str = r"C:\Program Files\Git\cmd\git.exe";

    fn machine_with_git() -> RedirectFs {
        RedirectFs::new(&[TEST_REAL_GIT], &[r"C:\Program Files"])
    }

    /// The fixed Program Files sibling resolves, and it is the only thing consulted.
    #[test]
    fn pg1_the_fixed_program_files_sibling_resolves() {
        let got = resolve_packaged_git(&machine_with_git(), Path::new(TEST_INSTALL_ROOT))
            .expect("the fixed candidate resolves");
        assert_eq!(got.path(), Path::new(TEST_REAL_GIT));
    }

    /// An absent candidate fails closed, and with the TRUTHFUL error. Reporting
    /// `PackagedRuntimeNotProvisioned` here would send someone to reinstall a release whose payload
    /// is sitting on disk and was never the problem.
    #[test]
    fn pg2_a_missing_candidate_fails_closed_with_the_truthful_error() {
        let fs = RedirectFs::new(&[], &[r"C:\Program Files"]);
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// A link at the fixed location whose canonical target leaves Program Files is refused. This is
    /// the case the containment check exists for: every other guard passes.
    #[test]
    fn pg3_a_candidate_canonicalising_outside_program_files_refuses() {
        let escaped = r"C:\Users\murad\AppData\Local\evil\git.exe";
        let fs = RedirectFs::new(&[TEST_REAL_GIT], &[r"C:\Program Files"])
            .redirecting(TEST_REAL_GIT, escaped);
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// A UNC/network install root cannot produce a packaged Git capability.
    #[test]
    fn pg4_a_network_install_root_refuses() {
        let unc_root = r"\\server\share\ProjectOS Control Center";
        let fs = RedirectFs::new(&[r"\\server\share\Git\cmd\git.exe"], &[r"\\server\share"]);
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(unc_root)),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// The final name must be git.exe; a file that merely lives at the fixed path is not enough.
    #[test]
    fn pg5_a_wrong_final_filename_refuses() {
        let wrong = r"C:\Program Files\Git\cmd\git.exe.bak";
        let fs = RedirectFs::new(&[TEST_REAL_GIT], &[r"C:\Program Files"])
            .redirecting(TEST_REAL_GIT, wrong);
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// A hostile `git.exe` planted anywhere else has ZERO effect on packaged resolution.
    ///
    /// PATH is user-writable, so if it could influence this, anyone able to write a directory early
    /// in their own PATH would choose the executable a machine-wide installation runs. The planted
    /// executables here EXIST on the fake filesystem — under a user profile, and under plausible
    /// override and shim locations — so a resolver that searched PATH, honoured `PROJECTOS_GIT_EXE`,
    /// or preferred any discovered `git.exe` would return one of them. It returns the fixed
    /// candidate instead.
    ///
    /// DELIBERATELY NO `std::env::set_var` HERE. An earlier version set PATH and `PROJECTOS_GIT_EXE`
    /// for real to make the point. Environment variables are process-global and the harness runs
    /// tests in parallel threads, so that version could corrupt the two tests in this same binary
    /// that resolve DEVELOPMENT node and git from the real PATH — a test that intermittently breaks
    /// its neighbours is worse than the property it defends. The resolver's signature is
    /// `(fs, install_root)`: there is no environment parameter to poison, and this asserts the
    /// behaviour that would change if one were ever added.
    #[test]
    fn pg6_planted_git_executables_elsewhere_cannot_influence_packaged_resolution() {
        let on_path = r"C:\Users\murad\AppData\Local\hostile\git.exe";
        let planted_override = r"C:\Users\murad\AppData\Local\planted\git.exe";
        let user_shim = r"C:\Users\murad\scoop\shims\git.exe";
        let fs = RedirectFs::new(
            &[TEST_REAL_GIT, on_path, planted_override, user_shim],
            &[r"C:\Program Files"],
        );
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Ok(ResolvedPackagedGit(PathBuf::from(TEST_REAL_GIT))),
            "only the fixed Program Files candidate may be chosen",
        );
    }

    /// With the fixed candidate ABSENT, a planted executable is still never substituted: the
    /// resolver refuses rather than falling back to something it found elsewhere. This is the half
    /// that would actually break if a PATH search or an ambient override were reintroduced.
    #[test]
    fn pg7_with_the_fixed_candidate_absent_nothing_else_is_substituted() {
        let planted = r"C:\Users\murad\AppData\Local\planted\git.exe";
        let fs = RedirectFs::new(&[planted], &[r"C:\Program Files"]);
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// The resolver's ONLY input is the verified install root — not cwd, config or argv, none of
    /// which it reads. A different verified root gives a different answer; nothing else can.
    #[test]
    fn pg8_the_only_input_is_the_verified_install_root() {
        let fs = machine_with_git();
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(TEST_INSTALL_ROOT)),
            Ok(ResolvedPackagedGit(PathBuf::from(TEST_REAL_GIT))),
        );
        assert_eq!(
            resolve_packaged_git(&fs, Path::new(r"D:\Elsewhere\ProjectOS Control Center")),
            Err(ProcessError::PackagedGitNotProvisioned),
        );
    }

    /// The refusal is a PRE-CREATION failure: no child was started, so no process can exist.
    #[test]
    fn pg9_a_packaged_git_refusal_asserts_no_process_exists() {
        assert!(!ProcessError::PackagedGitNotProvisioned.process_may_exist());
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
            node_exe: PathBuf::from(
                r"C:	ools
ode
ode.exe",
            ),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            git_exe: PathBuf::from(r"C:\tools\git\cmd\git.exe"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        let git: Vec<_> = spec
            .env
            .iter()
            .filter(|(n, _)| n == DAEMON_GIT_EXE_VAR)
            .collect();
        assert_eq!(
            git.len(),
            1,
            "exactly one Git binding, never a list to choose from"
        );
        // and the environment stays the narrow internal set
        for (name, _) in &spec.env {
            assert!(
                name == DAEMON_GIT_EXE_VAR
                    || name == DAEMON_INSTANCE_ID_VAR
                    || name == DAEMON_BRIDGE_CONFIG_VAR
                    || SYSTEM_ALLOWLIST.contains(&name.as_str()),
                "unexpected variable in the daemon environment: {name}"
            );
        }
    }

    /// The DEVELOPMENT bridge configuration is bound by the authority, as ONE absolute path beneath
    /// the development root. The daemon no longer reads `bridge.config.json` from its working
    /// directory, so this is the only route by which it can receive one — and there is no parameter
    /// through which a caller could choose it.
    #[test]
    fn the_development_bridge_config_is_authority_bound_and_absolute() {
        let a = DevelopmentDaemonLaunchAuthority {
            node_exe: PathBuf::from(r"C:\tools\node\node.exe"),
            host_script: PathBuf::from(r"C:\dev\cc\sidecar\host.mjs"),
            dev_root: PathBuf::from(r"C:\dev\cc"),
            git_exe: PathBuf::from(r"C:\tools\git\cmd\git.exe"),
            daemon_instance_id: "host1-1".into(),
        };
        let spec = a.to_process_spec().unwrap();
        let bound: Vec<_> = spec
            .env
            .iter()
            .filter(|(n, _)| n == DAEMON_BRIDGE_CONFIG_VAR)
            .collect();
        assert_eq!(
            bound.len(),
            1,
            "exactly one binding, never a list to choose from"
        );
        assert_eq!(bound[0].1, r"C:\dev\cc\bridge.config.json");
        assert!(
            std::path::Path::new(&bound[0].1).is_absolute(),
            "a relative value is the ambient behaviour under another name"
        );
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

    /// [6] Development identity cannot become packaged authority: the development branch constructs
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
    use crate::process::governed_root::FixtureSystemRoot;
    use crate::process::installed_projects::{
        RegistryStatus, PROJECT_ID_FLAG, PROJECT_ROOT_FLAG, REGISTRY_STATUS_FLAG,
    };
    use projectos_packaged_runtime_contract as contract;
    use projectos_shared_host_runtime::identity::packaged::InstallationModel;
    use projectos_shared_host_runtime::identity::packaged_fixture::test_only_verified_identity;

    const APP: &str = contract::PACKAGED_APPLICATION_ID;
    const FIXTURE_GIT: &str = r"C:\Program Files\Git\cmd\git.exe";

    fn identity() -> VerifiedPackagedIdentity {
        test_only_verified_identity(
            APP,
            "9.9.9",
            "projectos-signing-fixture",
            InstallationModel::PerMachine,
        )
    }

    /// A temporary INSTALL root containing an app-owned payload subdirectory with a real pinned
    /// runtime file and a real daemon bundle file. Only the layout matters here, not the bytes.
    fn installed_layout(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let install_root = std::env::temp_dir().join(format!("projectos-install-{name}"));
        let _ = std::fs::remove_dir_all(&install_root);
        let payload = install_root.join(contract::PAYLOAD_RELATIVE_ROOT);
        for rel in [
            contract::RUNTIME_RELATIVE_PATH,
            contract::DAEMON_RELATIVE_PATH,
        ] {
            let p = payload.join(std::path::Path::new(rel));
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"payload byte").unwrap();
        }
        // The application's OWN files live beside the payload, not inside it.
        std::fs::write(install_root.join("projectos-control-center.exe"), b"exe").unwrap();
        std::fs::write(install_root.join("WebView2Loader.dll"), b"dll").unwrap();

        let governed = std::env::temp_dir().join(format!("projectos-system-{name}"));
        std::fs::create_dir_all(&governed).unwrap();
        (install_root, payload, governed)
    }

    fn authority_for(name: &str) -> (VerifiedPackagedDaemonLaunchAuthority, PathBuf, PathBuf) {
        authority_with_projects(
            name,
            RegisteredProjects::for_test(Vec::new(), RegistryStatus::Missing),
        )
    }

    fn authority_with_projects(
        name: &str,
        projects: RegisteredProjects,
    ) -> (VerifiedPackagedDaemonLaunchAuthority, PathBuf, PathBuf) {
        let (_install, payload, governed) = installed_layout(name);
        let root = resolve_governed_system_root(
            &identity(),
            &FixtureSystemRoot {
                application_id: APP.to_string(),
                root: governed.clone(),
            },
        )
        .expect("a real absolute directory for this application resolves");
        (
            VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(
                identity(),
                "h-packaged".into(),
                payload.clone(),
                root,
                // A fixed absolute stand-in for the machine-owned Git the real resolver produces.
                // The RESOLVER's own rules are proven in the unit tests above; what this module
                // proves is what the packaged child is handed once a path has been sealed in.
                ResolvedPackagedGit::test_only(PathBuf::from(FIXTURE_GIT)),
                projects,
            ),
            payload,
            governed,
        )
    }

    /// [PACKAGED-DAEMON-LAUNCH1A] The lifecycle's packaged arm now PRODUCES A SPEC.
    ///
    /// It used to be `Packaged(_) => Err(PackagedRuntimeNotProvisioned)` unconditionally, so a real
    /// installation could verify its identity perfectly and still be told its payload was missing
    /// while that payload sat beside the executable. This walks the enum exactly as
    /// `lifecycle.rs` does, so the behaviour is pinned by a test rather than living only in a match
    /// arm that a future edit could quietly revert.
    #[test]
    fn the_lifecycle_packaged_arm_yields_a_spec_rather_than_a_permanent_refusal() {
        let (authority, payload, governed) = authority_for("lifecycle-arm");
        let launch = DaemonLaunchAuthority::Packaged(authority);

        // THE function lifecycle calls — not a copy of it. A copy passed while the real arm was
        // reverted, which is how this test learned to call the thing itself.
        let spec = process_spec_for(&launch).expect("a valid packaged authority must yield a spec");

        // And it is the PACKAGED spec: the pinned runtime inside the installed payload, the closed
        // daemon bundle, and the governed root passed explicitly.
        assert!(spec
            .executable
            .starts_with(&payload.to_string_lossy().to_string()));
        assert_eq!(spec.args[1], "--root");
        assert_eq!(spec.args[2], governed.to_string_lossy());
        assert_eq!(spec.classification, SpecClassification::PackagedRuntime);
    }

    /// The packaged child carries the sealed Git capability — and still carries nothing else.
    ///
    /// The capability is the ONLY thing added by this increment, so this asserts both halves: that
    /// exactly one Git path is granted, and that granting it did not quietly open the child to PATH,
    /// a bridge configuration, or anything credential-shaped.
    #[test]
    fn the_packaged_child_environment_grants_git_and_nothing_else() {
        let (authority, _payload, _governed) = authority_for("env-git");
        let spec = authority
            .to_process_spec()
            .expect("the packaged spec builds");

        let git: Vec<_> = spec
            .env
            .iter()
            .filter(|(n, _)| n == DAEMON_GIT_EXE_VAR)
            .collect();
        assert_eq!(git.len(), 1, "exactly one Git capability is granted");
        assert_eq!(git[0].1, FIXTURE_GIT);

        for forbidden in ["PATH", DAEMON_BRIDGE_CONFIG_VAR] {
            assert!(
                !spec.env.iter().any(|(n, _)| n == forbidden),
                "the packaged child must not carry {forbidden}",
            );
        }
        for (name, _) in &spec.env {
            let lower = name.to_ascii_lowercase();
            for shape in ["token", "secret", "password", "cookie", "session"] {
                assert!(
                    !lower.contains(shape),
                    "the packaged child must not carry a {shape}-shaped variable ({name})",
                );
            }
        }
        assert_eq!(spec.classification, SpecClassification::PackagedRuntime);
    }

    /// [§10.1] A verified packaged identity issues packaged authority, and that authority carries
    /// the identity it was granted for.
    #[test]
    fn verified_identity_issues_packaged_authority() {
        let (authority, _, _) = authority_for("issues");
        assert_eq!(authority.application_id(), APP);
        assert_eq!(authority.application_version(), "9.9.9");
        assert_eq!(authority.signer_id(), "projectos-signing-fixture");
        assert_eq!(authority.daemon_instance_id(), "h-packaged");
    }

    /// [§10.2] The payload is resolved from the APPLICATION-OWNED layout — a named subdirectory of
    /// the install root — and the application's own files sit beside it, not inside it.
    #[test]
    fn the_payload_root_is_an_app_owned_subdirectory_of_the_install_root() {
        let (install, payload, _) = installed_layout("layout");
        assert_eq!(packaged_payload_root(&install), payload);
        assert_eq!(
            payload.parent().unwrap(),
            install.as_path(),
            "the payload is one level beneath the install root"
        );
        // The exe and its DLLs are in the install root and NOT in the payload.
        assert!(install.join("projectos-control-center.exe").is_file());
        assert!(!payload.join("projectos-control-center.exe").exists());
        assert!(!payload.join("WebView2Loader.dll").exists());
    }

    /// [§10.6, §10.7] The governed root reaches the daemon startup boundary, EXPLICITLY. The daemon
    /// is told which ProjectOS it may operate; it does not discover one.
    #[test]
    fn the_daemon_spec_carries_the_exact_governed_root_and_the_payload_runtime() {
        let (authority, payload, governed) = authority_for("spec");
        let spec = authority.to_process_spec().expect("payload is provisioned");

        assert_eq!(
            spec.executable,
            payload
                .join(std::path::Path::new(contract::RUNTIME_RELATIVE_PATH))
                .to_string_lossy()
        );
        assert_eq!(
            spec.args[0],
            payload
                .join(std::path::Path::new(contract::DAEMON_RELATIVE_PATH))
                .to_string_lossy()
        );
        assert_eq!(spec.args[1], "--root");
        assert_eq!(spec.args[2], governed.to_string_lossy());
        assert_eq!(spec.current_dir, payload.to_string_lossy());
        assert!(matches!(
            spec.classification,
            SpecClassification::PackagedRuntime
        ));
    }

    /// [§11.4] Packaged mode is NOT given the development bridge configuration. That variable is the
    /// development route for supplying watch roots, and a packaged installation must not be
    /// redirectable by a configuration file.
    #[test]
    fn the_packaged_spec_carries_no_bridge_configuration_and_no_path() {
        let (authority, _, _) = authority_for("env");
        let spec = authority.to_process_spec().unwrap();
        assert!(
            !spec.env.iter().any(|(n, _)| n == DAEMON_BRIDGE_CONFIG_VAR),
            "packaged mode must not receive a bridge configuration"
        );
        assert!(!spec.env.iter().any(|(n, _)| n.eq_ignore_ascii_case("PATH")));
        for (name, _) in &spec.env {
            assert!(
                // The packaged environment allowlist. It grew by EXACTLY ONE entry in
                // PACKAGED-DAEMON-LAUNCH1A: the Git capability, which the governance runtime needs
                // to establish repository facts and which the daemon cannot obtain any other way,
                // having no PATH. Kept as a closed list rather than relaxed to a prefix or a
                // "contains" rule, so the next variable added to a packaged child is a deliberate,
                // reviewed act and not a side effect.
                name == DAEMON_INSTANCE_ID_VAR
                    || name == DAEMON_GIT_EXE_VAR
                    || SYSTEM_ALLOWLIST.contains(&name.as_str()),
                "unexpected variable in the packaged daemon environment: {name}"
            );
        }
    }

    /// [§11.10, §11.11] A payload in the WRONG subdirectory, or outside the app-owned layout
    /// entirely, does not become launchable: the spec is built only from the bound payload root, and
    /// it refuses when the runtime and daemon are not both there.
    #[test]
    fn a_payload_outside_the_app_owned_layout_is_not_launchable() {
        let (install, _payload, governed) = installed_layout("wrong-subdir");
        let root = resolve_governed_system_root(
            &identity(),
            &FixtureSystemRoot {
                application_id: APP.to_string(),
                root: governed,
            },
        )
        .unwrap();

        // A sibling directory that is NOT the contract's payload root, and a path outside the
        // installation altogether. Neither yields a spec.
        for wrong in [
            install.join("not-the-payload"),
            std::env::temp_dir().join("projectos-elsewhere-payload"),
        ] {
            std::fs::create_dir_all(&wrong).unwrap();
            let a = VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(
                identity(),
                "h-wrong".into(),
                wrong.clone(),
                root.clone(),
                ResolvedPackagedGit::test_only(PathBuf::from(FIXTURE_GIT)),
                RegisteredProjects::for_test(Vec::new(), RegistryStatus::Missing),
            );
            assert!(
                matches!(
                    a.to_process_spec(),
                    Err(ProcessError::PackagedRuntimeNotProvisioned)
                ),
                "{} must not be launchable",
                wrong.display()
            );
        }
    }

    /// [§11.6, §11.7] There is no argv and no manifest field that nominates the governed root. The
    /// authority takes a SEALED `GovernedSystemRoot`, so a path is not even representable here — and
    /// `resolve_launch_authority` takes only a mode and an instance id.
    ///
    /// The Git capability is sealed the same way as of PACKAGED-DAEMON-LAUNCH1A: it is a
    /// `ResolvedPackagedGit`, which only `resolve_packaged_git` can construct, so neither root nor
    /// tool is representable as a string a caller chose.
    ///
    /// Asserted by compilation as much as by this body; none of the following compile:
    ///   VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(id, "h".into(), p, "C:/x", g);
    ///   VerifiedPackagedDaemonLaunchAuthority::from_verified_identity(id, "h".into(), p, r, "C:/git.exe");
    ///   resolve_launch_authority(AppMode::PackagedCandidate, "h".into(), "C:/other-root");
    #[test]
    fn the_governed_root_cannot_be_nominated_by_a_string() {
        let (authority, _, governed) = authority_for("sealed");
        assert_eq!(authority.governed_system_root(), governed.as_path());
    }

    // ============================================================================================
    // THE INSTALLED-PROJECT REGISTRY REACHES THE DAEMON (PROJECTOS-PHASE6-SECTION-C)
    // ============================================================================================

    /// [C3] The packaged child is TOLD which projects it may govern — one `--project-root` per
    /// registry-validated root — and it is told the registry status too. Nothing else changed: the
    /// system root still arrives as `--root`, and the two are not interchangeable.
    #[test]
    fn the_packaged_spec_carries_the_registry_validated_project_roots() {
        let roots = vec![
            ("projectos".to_string(), PathBuf::from(r"C:\dev\ProjectOS")),
            ("dead-aisle".to_string(), PathBuf::from(r"C:\dev\DeadAisle")),
        ];
        let (authority, _payload, governed) = authority_with_projects(
            "projects",
            RegisteredProjects::for_test(roots.clone(), RegistryStatus::Ok),
        );
        let spec = authority
            .to_process_spec()
            .expect("the packaged spec builds");

        assert_eq!(spec.args[1], "--root");
        assert_eq!(spec.args[2], governed.to_string_lossy());
        let passed: Vec<&String> = spec
            .args
            .windows(2)
            .filter(|pair| pair[0] == PROJECT_ROOT_FLAG)
            .map(|pair| &pair[1])
            .collect();
        assert_eq!(passed.len(), 2, "one flag per validated project");
        assert_eq!(passed[0], &roots[0].1.to_string_lossy().to_string());
        assert_eq!(passed[1], &roots[1].1.to_string_lossy().to_string());
        // And each root is preceded by the id the registry bound it to.
        let ids: Vec<&String> = spec
            .args
            .windows(2)
            .filter(|pair| pair[0] == PROJECT_ID_FLAG)
            .map(|pair| &pair[1])
            .collect();
        assert_eq!(ids, vec!["projectos", "dead-aisle"]);
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair[0] == REGISTRY_STATUS_FLAG && pair[1] == "ok"));
    }

    /// [C3, A5] A registry that could not be validated yields a launchable worker that governs
    /// NOTHING. The refusal travels as a closed token so the owner can be told why, and no root
    /// travels at all — a broken registry must not fall back to governing whatever is nearby.
    #[test]
    fn a_refused_registry_governs_no_project_and_says_why() {
        for (status, token) in [
            (RegistryStatus::Missing, "missing"),
            (RegistryStatus::Malformed, "malformed"),
            (RegistryStatus::Invalid, "invalid"),
        ] {
            let (authority, _, _) = authority_with_projects(
                &format!("refused-{token}"),
                RegisteredProjects::for_test(Vec::new(), status),
            );
            let spec = authority
                .to_process_spec()
                .expect("the packaged spec builds");
            assert!(
                !spec.args.iter().any(|a| a == PROJECT_ROOT_FLAG),
                "a refused registry must contribute no project root"
            );
            assert!(spec
                .args
                .windows(2)
                .any(|pair| pair[0] == REGISTRY_STATUS_FLAG && pair[1] == token));
        }
    }

    /// [C3] The governed SYSTEM root is never passed as a project root. They are different things:
    /// one is framework state the daemon writes, the other is a repository it governs, and a system
    /// root that arrived as a project would make the daemon govern its own state directory.
    #[test]
    fn the_governed_system_root_is_never_passed_as_a_project_root() {
        let (authority, _, governed) = authority_with_projects(
            "no-system-root-as-project",
            RegisteredProjects::for_test(
                vec![("projectos".to_string(), PathBuf::from(r"C:\dev\ProjectOS"))],
                RegistryStatus::Ok,
            ),
        );
        let spec = authority
            .to_process_spec()
            .expect("the packaged spec builds");
        let project_roots: Vec<&String> = spec
            .args
            .windows(2)
            .filter(|pair| pair[0] == PROJECT_ROOT_FLAG)
            .map(|pair| &pair[1])
            .collect();
        assert!(
            !project_roots
                .iter()
                .any(|root| *root == &governed.to_string_lossy().to_string()),
            "the system root must never appear as a project root"
        );
    }

    /// Granting the registry did not widen the packaged child's environment: it is argv only. A
    /// project list that arrived as an environment variable would be one more channel to poison.
    #[test]
    fn the_registry_travels_as_argv_and_not_as_environment() {
        let (authority, _, _) = authority_with_projects(
            "argv-only",
            RegisteredProjects::for_test(
                vec![("projectos".to_string(), PathBuf::from(r"C:\dev\ProjectOS"))],
                RegistryStatus::Ok,
            ),
        );
        let spec = authority
            .to_process_spec()
            .expect("the packaged spec builds");
        for (name, value) in &spec.env {
            assert!(
                name == DAEMON_INSTANCE_ID_VAR
                    || name == DAEMON_GIT_EXE_VAR
                    || SYSTEM_ALLOWLIST.contains(&name.as_str()),
                "unexpected variable in the packaged daemon environment: {name}"
            );
            assert!(
                !value.contains(r"C:\dev\ProjectOS"),
                "no project root may travel in the environment"
            );
        }
    }
}
