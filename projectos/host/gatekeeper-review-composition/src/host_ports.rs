//! PROJECTOS-HOST-REVIEW-PATH1B — THE PRODUCTION ADAPTERS BEHIND THE REVIEW OPERATION'S PORTS.
//!
//! Five ports had no shipped implementation: the installed trust manifest, the committed closure bytes,
//! the trusted-executable policy, the clock, and the execution of the review itself. They are here, and
//! each FAILS CLOSED while its live input is absent.
//!
//! ## What the execution port is, and is not
//!
//! [`PackagedBrokerExecution`] LAUNCHES ONLY THE CLOSURE-VERIFIED BROKER, UNDER THE PINNED PACKAGED
//! RUNTIME. It is handed a [`HostProviderRequest`] - a body the Host authored - and nothing else: there
//! is no parameter through which an executable, a script, an environment or an endpoint could arrive.
//! The broker bytes it runs are the ones it proved itself, by running the SAME closure verification the
//! review operation runs (owner's signature, production policy, embedded anchor) and keeping the very
//! bytes that verification matched; a value of this type therefore cannot exist for an unsigned
//! installation. The credential never enters this process - the broker resolves it in its own - and the
//! provider endpoint is the broker's fixed constant.
//!
//! Nothing here reads a credential or reaches a provider. While no owner has signed a version 2 manifest
//! [`PackagedBrokerExecution::establish`] returns `None`, which is the dormant state.
//!
//! ## The launcher seam
//!
//! [`BrokerLauncher`] is the one narrow seam: "run these exact source bytes under the runtime with this
//! request, and give me what it printed". The production implementation is [`PinnedNodeLauncher`]. The
//! seam exists so the path above it - request envelope, source pinning, answer normalisation - can be
//! proven with a fixture provider, without a credential and without a call.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use projectos_host_gatekeeper_attestation::operation::{
    ClockPort, CommittedBytesPort, ExecutablePolicyPort, ExecutionFailure, GatekeeperExecutionPort,
    ProviderOutcome, TrustManifestPort,
};
use projectos_host_gatekeeper_attestation::provider_request::{
    normalise_provider_response, HostProviderRequest, ReviewExecutionPolicy, BROKER_ASK_CLOSURE,
};
use projectos_host_identity::{
    verify_execution_closure, CommittedClosureBytes, Policy, ProductionEs256Verifier, TrustManifest,
};
use projectos_host_repository::{CommittedFileReader, CommittedPath};
use projectos_packaged_runtime_contract as contract;

use crate::review_dispatch::{create_new_durably, open_plain_file};

/// Upper bound on the installed trust manifest. A manifest is a few kilobytes; this refuses a file that
/// is not one before it is parsed.
pub const MAX_TRUST_MANIFEST_BYTES: u64 = 262_144;
/// Upper bound on what the broker may print.
pub const MAX_BROKER_OUTPUT_BYTES: usize = 8 * 1_048_576;
/// How long the broker may run. Above the broker's own 300 s ceiling on the provider call.
pub const BROKER_TIMEOUT: Duration = Duration::from_secs(330);
/// The timeout the broker is told to give the provider, in milliseconds.
const PROVIDER_TIMEOUT_MS: u64 = 300_000;

// -------------------------------------------------------------------------------------------------
// THE FOUR SMALL PORTS
// -------------------------------------------------------------------------------------------------

/// `CommittedBytesPort` over the ONE pinned committed-file reader. COMMITTED bytes, never the working
/// tree; a path the bounded path type cannot hold is `None`, never a wider read.
pub struct CommittedReaderBytes<'a> {
    reader: &'a CommittedFileReader,
}

impl<'a> CommittedReaderBytes<'a> {
    /// Committed bytes of the INSTALLATION's repository, at the commit `reader` pinned.
    #[must_use]
    pub fn over(reader: &'a CommittedFileReader) -> Self {
        Self { reader }
    }
}

impl CommittedBytesPort for CommittedReaderBytes<'_> {
    fn committed_bytes(&self, repository_relative_path: &str) -> Option<Vec<u8>> {
        let path = CommittedPath::new(repository_relative_path).ok()?;
        self.reader.committed_bytes(&path).ok()
    }
}

/// `TrustManifestPort` over the installed manifest file. The file NAME is the packaging contract's;
/// the caller resolves only the payload root it sits in. Opened without following a link, and bounded.
pub struct InstalledTrustManifest {
    path: PathBuf,
}

impl InstalledTrustManifest {
    /// The manifest beneath a payload root the CALLER resolved. Nothing is opened here.
    #[must_use]
    pub fn beneath(payload_root: &Path) -> Self {
        Self {
            path: payload_root.join(contract::TRUST_MANIFEST_FILENAME),
        }
    }
}

impl TrustManifestPort for InstalledTrustManifest {
    fn manifest_bytes(&self) -> Option<Vec<u8>> {
        let file = open_plain_file(&self.path)?;
        let mut bytes = Vec::new();
        file.take(MAX_TRUST_MANIFEST_BYTES + 1).read_to_end(&mut bytes).ok()?;
        (bytes.len() as u64 <= MAX_TRUST_MANIFEST_BYTES && !bytes.is_empty()).then_some(bytes)
    }
}

/// `ClockPort` over the system clock. A clock before the epoch reads as `0`, which no attestation
/// window accepts.
pub struct SystemClock;

impl ClockPort for SystemClock {
    fn now_epoch_s(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs())
    }
}

fn sha256_of_plain_file(path: &Path) -> Option<String> {
    let mut file = open_plain_file(path)?;
    let mut hasher = Sha256::new();
    let mut chunk = vec![0u8; 1_048_576];
    loop {
        let n = file.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&chunk[..n]);
    }
    Some(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Is `path` the pinned packaged runtime - an absolute path to a plain file whose bytes hash to the
/// packaging contract's pin?
fn is_pinned_runtime(path: &Path) -> bool {
    path.is_absolute() && sha256_of_plain_file(path).as_deref() == Some(contract::PACKAGED_NODE_SHA256)
}

/// `ExecutablePolicyPort`: the two executables a review depends on are the Host's own.
///
/// The RUNTIME must be the pinned packaged `node.exe`, byte for byte. GIT must be an absolute path to a
/// plain file - the same executable the repository reader was configured with, which that crate has
/// already verified. Neither path comes from a caller: the service composition resolves both.
pub struct PinnedExecutablePolicy {
    node_exe: PathBuf,
    git_exe: PathBuf,
}

impl PinnedExecutablePolicy {
    /// The policy over the two executables the service resolved.
    #[must_use]
    pub fn over(node_exe: &Path, git_exe: &Path) -> Self {
        Self {
            node_exe: node_exe.to_path_buf(),
            git_exe: git_exe.to_path_buf(),
        }
    }
}

impl ExecutablePolicyPort for PinnedExecutablePolicy {
    fn executables_are_trusted(&self) -> bool {
        is_pinned_runtime(&self.node_exe)
            && self.git_exe.is_absolute()
            && open_plain_file(&self.git_exe).is_some()
    }
}

// -------------------------------------------------------------------------------------------------
// THE LAUNCHER SEAM
// -------------------------------------------------------------------------------------------------

/// One launch: the exact source to run and the exact request it must find.
pub struct BrokerLaunch<'a> {
    /// The pinned prelude followed by the closure-verified broker source.
    pub source: &'a [u8],
    /// The broker request, as the file it will read.
    pub request_json: &'a [u8],
}

/// Why a launch produced nothing usable. Coarse: the caller retains its reservation in every case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchFailure {
    /// The runtime is not the pinned one, or could not be started. NOTHING RAN.
    NotStarted,
    /// The process ran and failed, timed out, or printed more than the bound.
    Failed,
}

/// Run the broker. The ONLY thing an implementation is given is the source and the request.
pub trait BrokerLauncher {
    /// The broker's standard output.
    ///
    /// # Errors
    /// [`LaunchFailure`].
    fn launch(&self, launch: &BrokerLaunch<'_>) -> Result<Vec<u8>, LaunchFailure>;
}

/// THE PRODUCTION LAUNCHER: the pinned packaged runtime, the source on standard input, the request in
/// a Host-owned scratch file, an environment the Host fixes, no shell.
pub struct PinnedNodeLauncher {
    node_exe: PathBuf,
    git_exe: PathBuf,
    working_dir: PathBuf,
    scratch_dir: PathBuf,
    timeout: Duration,
}

/// The only variables carried over from the Host process. Nothing else reaches the broker.
const LAUNCH_ENV_PASSTHROUGH: &[&str] = &["SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP"];

impl PinnedNodeLauncher {
    /// A launcher over paths the SERVICE resolved: the packaged runtime, the verified git executable,
    /// the installation root the broker runs in, and a Host-owned scratch directory for the request.
    #[must_use]
    pub fn new(node_exe: &Path, git_exe: &Path, working_dir: &Path, scratch_dir: &Path) -> Self {
        Self {
            node_exe: node_exe.to_path_buf(),
            git_exe: git_exe.to_path_buf(),
            working_dir: working_dir.to_path_buf(),
            scratch_dir: scratch_dir.to_path_buf(),
            timeout: BROKER_TIMEOUT,
        }
    }

    /// The same launcher with a shorter deadline.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

impl BrokerLauncher for PinnedNodeLauncher {
    fn launch(&self, launch: &BrokerLaunch<'_>) -> Result<Vec<u8>, LaunchFailure> {
        // THE RUNTIME IS RE-PROVEN AT EVERY LAUNCH. A file swapped after the policy check is refused
        // here rather than executed.
        if !is_pinned_runtime(&self.node_exe) {
            return Err(LaunchFailure::NotStarted);
        }
        // A NAME NOBODY CHOSE: the digest of the request. Created new, never through a link.
        let name: String = Sha256::digest(launch.request_json)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let request_file = self.scratch_dir.join(format!("{name}.broker-request"));
        if !matches!(create_new_durably(&request_file, launch.request_json), Ok(true)) {
            return Err(LaunchFailure::NotStarted);
        }
        let outcome = self.run(launch.source, &request_file);
        let _ = std::fs::remove_file(&request_file);
        outcome
    }
}

impl PinnedNodeLauncher {
    fn run(&self, source: &[u8], request_file: &Path) -> Result<Vec<u8>, LaunchFailure> {
        let mut child = Command::new(&self.node_exe)
            .arg("-")
            .current_dir(&self.working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear()
            .envs(
                LAUNCH_ENV_PASSTHROUGH
                    .iter()
                    .filter_map(|name| std::env::var_os(name).map(|value| (*name, value))),
            )
            .env("PROJECTOS_BROKER_REQUEST", request_file)
            .env("PROJECTOS_GIT_EXE", &self.git_exe)
            .spawn()
            .map_err(|_| LaunchFailure::NotStarted)?;

        // THE SOURCE GOES AS BYTES ON STANDARD INPUT - never as a path and never on a command line.
        let mut stdin = child.stdin.take().ok_or(LaunchFailure::Failed)?;
        let source = source.to_vec();
        let writer = std::thread::spawn(move || {
            let _ = stdin.write_all(&source);
        });
        let mut stdout = child.stdout.take().ok_or(LaunchFailure::Failed)?;
        let reader = std::thread::spawn(move || {
            let mut out = Vec::new();
            let mut chunk = [0u8; 65_536];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) => return Some(out),
                    Ok(n) if out.len() + n <= MAX_BROKER_OUTPUT_BYTES => out.extend_from_slice(&chunk[..n]),
                    _ => return None,
                }
            }
        });

        let deadline = Instant::now() + self.timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };
        let _ = writer.join();
        let output = reader.join().ok().flatten();
        match (status, output) {
            (Some(status), Some(output)) if status.success() => Ok(output),
            _ => Err(LaunchFailure::Failed),
        }
    }
}

// -------------------------------------------------------------------------------------------------
// THE EXECUTION PORT
// -------------------------------------------------------------------------------------------------

/// The roots the broker is pinned to. Resolved by the service composition, never by a request.
#[derive(Debug, Clone)]
pub struct BrokerRoots {
    /// The ProjectOS INSTALLATION root - pinned into the source as `TRUSTED_INSTALL_ROOT`.
    pub install_root: String,
    /// Where the installation counts what it spends - pinned as `TRUSTED_STATE_DIR`.
    pub state_dir: String,
    /// The governed project checkout the review is about.
    pub governed_root: String,
}

/// The request file the broker reads. FIXED field order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrokerRequest<'a> {
    kind: &'static str,
    governed_root: &'a str,
    project_id: &'a str,
    phase_id: &'a str,
    subject_commit: &'a str,
    ask: &'a str,
    request_id: &'a str,
    credential_ref: &'a str,
    body: &'a str,
    timeout_ms: u64,
}

#[derive(Deserialize)]
struct BrokerAnswer {
    status: Option<u16>,
    body: Option<String>,
    error: Option<String>,
}

/// THE PRODUCTION `GatekeeperExecutionPort`.
pub struct PackagedBrokerExecution<'a> {
    launcher: &'a dyn BrokerLauncher,
    clock: &'a dyn ClockPort,
    broker_source: Vec<u8>,
    policy: ReviewExecutionPolicy,
    roots: BrokerRoots,
}

impl<'a> PackagedBrokerExecution<'a> {
    /// Establish the execution over an OWNER-SIGNED installation, or `None`.
    ///
    /// IT PROVES THE BROKER ITSELF. The manifest is parsed, the three closure artefacts are read at the
    /// CONTRACT's paths, and the closure is verified under PRODUCTION policy against the embedded
    /// anchor. Only then are the broker bytes - the very bytes that verification just matched - and the
    /// owner's policy retained. Anything less is `None`: no manifest, a version 1 manifest, an unsigned
    /// or test-signed one, a closure artefact that differs, an unusable policy fact.
    #[must_use]
    pub fn establish(
        manifest: &dyn TrustManifestPort,
        committed: &dyn CommittedBytesPort,
        launcher: &'a dyn BrokerLauncher,
        clock: &'a dyn ClockPort,
        roots: BrokerRoots,
    ) -> Option<Self> {
        let parsed = TrustManifest::parse(&manifest.manifest_bytes()?).ok()?;
        let broker = committed.committed_bytes(contract::BROKER_REPOSITORY_RELATIVE_PATH)?;
        let allowlist =
            committed.committed_bytes(contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH)?;
        let adapter =
            committed.committed_bytes(contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH)?;
        let verified = verify_execution_closure(
            &parsed,
            Policy::Production,
            &ProductionEs256Verifier::from_embedded(),
            &CommittedClosureBytes {
                gatekeeper_broker: Some(&broker),
                installation_project_allowlist: Some(&allowlist),
                credential_adapter: Some(&adapter),
            },
        )
        .ok()?;
        Some(Self {
            launcher,
            clock,
            broker_source: broker,
            policy: ReviewExecutionPolicy::from_verified(&verified),
            roots,
        })
    }

    /// FIXTURE ONLY (`cfg(test)`): the same port over broker bytes and a policy a test states, because
    /// no owner has signed a version 2 manifest for [`PackagedBrokerExecution::establish`] to verify.
    #[cfg(test)]
    fn for_fixture(
        launcher: &'a dyn BrokerLauncher,
        clock: &'a dyn ClockPort,
        broker_source: Vec<u8>,
        policy: ReviewExecutionPolicy,
        roots: BrokerRoots,
    ) -> Self {
        Self { launcher, clock, broker_source, policy, roots }
    }

    /// The source that runs: three pinned constants, then the verified broker bytes, unchanged.
    fn pinned_source(&self, request_sha256: &str) -> Option<Vec<u8>> {
        let literal = |text: &str| serde_json::to_string(text).ok();
        let mut source = format!(
            "const TRUSTED_INSTALL_ROOT = {};\nconst TRUSTED_REQUEST_SHA256 = {};\nconst TRUSTED_STATE_DIR = {};\n",
            literal(&self.roots.install_root)?,
            literal(request_sha256)?,
            literal(&self.roots.state_dir)?,
        )
        .into_bytes();
        source.extend_from_slice(&self.broker_source);
        Some(source)
    }
}

impl GatekeeperExecutionPort for PackagedBrokerExecution<'_> {
    fn execute(&self, request: &HostProviderRequest) -> Result<ProviderOutcome, ExecutionFailure> {
        let unavailable = ExecutionFailure::ProviderUnavailable;
        let body = std::str::from_utf8(request.body()).map_err(|_| unavailable)?;
        let envelope = serde_json::to_vec(&BrokerRequest {
            kind: "gatekeeper",
            governed_root: &self.roots.governed_root,
            project_id: request.project_id(),
            phase_id: request.phase_id(),
            subject_commit: request.subject_commit(),
            ask: request.broker_ask(),
            request_id: request.request_id(),
            credential_ref: request.credential_ref(),
            body,
            timeout_ms: PROVIDER_TIMEOUT_MS,
        })
        .map_err(|_| unavailable)?;
        let request_sha256: String = Sha256::digest(&envelope).iter().map(|b| format!("{b:02x}")).collect();
        let source = self.pinned_source(&request_sha256).ok_or(unavailable)?;

        // EVERY LAUNCH FAILURE IS "MAY HAVE BEEN DISPATCHED". The broker reports a refusal before spend
        // and a failure mid-flight down the same channel, so the Host cannot tell them apart - and an
        // ambiguity about money is resolved towards retaining it, never towards handing it back.
        let printed = self
            .launcher
            .launch(&BrokerLaunch { source: &source, request_json: &envelope })
            .map_err(|_| unavailable)?;
        let answer: BrokerAnswer = serde_json::from_slice(&printed).map_err(|_| unavailable)?;
        if answer.error.is_some() {
            return Err(unavailable);
        }
        let (Some(status), Some(response_body)) = (answer.status, answer.body) else {
            return Err(unavailable);
        };
        let ask = if request.broker_ask() == BROKER_ASK_CLOSURE { "closure" } else { "gatekeeper" };
        normalise_provider_response(&self.policy, ask, status, &response_body, self.clock.now_epoch_s())
    }
}

#[cfg(test)]
#[path = "host_ports_tests.rs"]
mod tests;
