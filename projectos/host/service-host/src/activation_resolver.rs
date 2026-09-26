//! THE SERVICE-ENTRY ACTIVATION RESOLVER — PROJECTOS-HOST-REVIEW-PATH1B, criterion 21.
//!
//! ## The one question this module answers
//!
//! "If the already-defined protected activation inputs are supplied and ProjectOSHost is started, is
//! any further production source code required for unattended Host review?" — this module is what
//! makes the answer NO. At service start it READS every activation input from its fixed, durable
//! location and resolves the governed-review authorities from them. It takes no argument a caller
//! could steer: no path, no flag, no environment variable, no wire value.
//!
//! ## The inputs, and where each one lives
//!
//! | input | fixed location | trust source |
//! |---|---|---|
//! | owner-signed programme delegation | `<host state root>/owner-delegation/gatekeeper-review.delegation` | the owner's ECDSA-P256 signature, verified against the embedded anchor |
//! | installed trust manifest | `<payload root>/projectos-trust-manifest.json` | the owner's signature over the execution closure |
//! | governed repository root | the canonical installed-project registry (ProgramData) | matched to the DELEGATION's signed project/repository digests through the attested programme |
//! | approved plan (identity, version, digest, baseline) | the COMMITTED record at `.projectops/host-approved-plan.v2.json` of the pinned candidate | the delegation's signed `plan`, `plan_digest` and `allowed_phases` |
//! | packaged node / git | fixed payload-relative contract paths | node hash-pinned; git bounded by the reader's closed vocabulary |
//!
//! ## Dormant by absence, never by build
//!
//! Every refusal here is `GovernedActivationUnavailable`, and the service then serves the STATUS
//! loop exactly as before — the byte-for-byte behaviour of an installation nobody activated. No
//! refusal invents a fallback authority, and nothing here mints one: the review capability's only
//! mint still consumes a delegation the owner signed.

#![cfg(windows)]

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use projectos_host_gatekeeper_review_composition::committed_plan::{
    ingest_committed_plan, CommittedPlanAuthority,
};
use projectos_host_identity::{
    attest_installation_programme, AttestedInstallationProgramme, CommittedClosureBytes,
    HostGovernedRoot, RunningExecutable, TrustManifest,
};
use projectos_packaged_runtime_contract as contract;
use projectos_project_registry::{read_canonical_registry, RealRegistryFacts};
use projectos_host_repository::{
    CommittedFileReader, CommittedPath, CommittedRevision, RepositoryAdapterConfig,
};
use projectos_host_windows_local_ipc::{
    decode_signed_owner_programme_delegation,
    verify_owner_programme_delegation_for_installation, ActivatedHostDurableState,
    HostReviewIpcCapability, SignedOwnerProgrammeDelegation, VerifiedOwnerProgrammeDelegation,
    SIGNED_DELEGATION_RECORD_LEN,
};

/// The fixed leaf of the owner-signed gatekeeper-review delegation, beneath the Host state root.
pub const OWNER_DELEGATION_RELATIVE_PATH: &str = "owner-delegation/gatekeeper-review.delegation";

/// The fixed leaf of the Host's durable approved-plan store, beneath the Host state root.
pub const PLAN_STORE_RELATIVE_ROOT: &str = "approved-plans";

/// The fixed leaf the broker launcher may scratch in, beneath the Host state root.
pub const BROKER_SCRATCH_RELATIVE_ROOT: &str = "broker-scratch";

/// Why the governed review route is NOT live for this service start. Payload-free: it names the
/// missing or refusing input class and never a path, a digest or a record byte.
///
/// `DelegationAbsent` is the ORDINARY state of every installation nobody has activated, and it is
/// how the resolver says "serve the status loop, exactly as today".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum GovernedActivationUnavailable {
    /// No delegation record at the fixed leaf: nothing was activated. The dormant case.
    DelegationAbsent,
    /// A record is present but is not exactly one well-formed signed delegation, or its signature,
    /// programme, liveness or lifecycle refused.
    DelegationRefused,
    /// The running executable, the payload root or the packaged executables could not be
    /// established.
    PayloadUnavailable,
    /// The installed trust manifest could not be read or parsed.
    ManifestUnavailable,
    /// The canonical installed-project registry could not be read, or no registered project
    /// attests to the delegation's signed programme.
    ProgrammeUnresolvable,
    /// The governed repository could not be opened, or its committed closure bytes are unreadable.
    RepositoryUnavailable,
    /// The committed approved-plan record refused ingestion against the signed delegation.
    PlanRefused,
}

/// Everything the governed serve loop needs that the STARTUP can establish once.
///
/// The per-exchange values — the pinned candidate reader, the plan authority, the operation ports —
/// are deliberately NOT here: the unattended route commits a local candidate before every review,
/// so HEAD moves between exchanges and anything pinned at startup would answer about a stale commit.
pub struct ResolvedGovernedActivation {
    /// The governed-review IPC capability, minted from the verified delegation.
    pub review: HostReviewIpcCapability,
    /// The verified delegation itself, for the per-exchange plan ingestion cross-check.
    pub verified: VerifiedOwnerProgrammeDelegation,
    /// The signed delegation record, for the per-request composition.
    pub record: SignedOwnerProgrammeDelegation,
    /// The sealed attested installation programme.
    pub attested: AttestedInstallationProgramme,
    /// The governed repository root the attested programme names.
    pub governed_root: PathBuf,
    /// The registered project id that attested to the delegation's programme.
    pub project_id: String,
    /// The packaged payload root (manifest, node, git live beneath it).
    pub payload_root: PathBuf,
    /// The pinned packaged node.
    pub node_exe: PathBuf,
    /// The packaged git.
    pub git_exe: PathBuf,
}

impl core::fmt::Debug for ResolvedGovernedActivation {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ResolvedGovernedActivation([REDACTED])")
    }
}

/// `FILE_FLAG_OPEN_REPARSE_POINT`: open the entry itself, never what a link resolves to.
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

/// Read the delegation record: EXACTLY the signed-record length, from a plain file, no follow.
fn read_delegation_record(path: &Path) -> Result<Vec<u8>, GovernedActivationUnavailable> {
    use std::os::windows::fs::OpenOptionsExt;
    let mut options = OpenOptions::new();
    options.read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    let mut file: File = match options.open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(GovernedActivationUnavailable::DelegationAbsent)
        }
        Err(_) => return Err(GovernedActivationUnavailable::DelegationRefused),
    };
    if !file
        .metadata()
        .map(|m| m.file_type().is_file())
        .unwrap_or(false)
    {
        return Err(GovernedActivationUnavailable::DelegationRefused);
    }
    let mut bytes = Vec::new();
    file.take(SIGNED_DELEGATION_RECORD_LEN as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| GovernedActivationUnavailable::DelegationRefused)?;
    if bytes.len() != SIGNED_DELEGATION_RECORD_LEN {
        return Err(GovernedActivationUnavailable::DelegationRefused);
    }
    Ok(bytes)
}

/// The three committed execution-closure files, read at the PINNED commit of `reader`.
fn closure_bytes(
    reader: &CommittedFileReader,
) -> Result<(Vec<u8>, Vec<u8>, Option<Vec<u8>>), GovernedActivationUnavailable> {
    let read = |rel: &str| -> Result<Vec<u8>, GovernedActivationUnavailable> {
        let path = CommittedPath::new(rel)
            .map_err(|_| GovernedActivationUnavailable::RepositoryUnavailable)?;
        reader
            .committed_bytes(&path)
            .map_err(|_| GovernedActivationUnavailable::RepositoryUnavailable)
    };
    let broker = read(contract::BROKER_REPOSITORY_RELATIVE_PATH)?;
    let allowlist = read(contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH)?;
    // The credential adapter is OPTIONAL in the closure model; absent is a fact, not a failure.
    let adapter = CommittedPath::new(contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH)
        .ok()
        .and_then(|p| reader.committed_bytes(&p).ok());
    Ok((broker, allowlist, adapter))
}

/// Attest ONE registered project against the manifest, or say why not. `None` = not this project.
fn attest_project(
    manifest: &TrustManifest,
    git_exe: &Path,
    repository_root: &Path,
) -> Option<(AttestedInstallationProgramme, CommittedFileReader)> {
    let root_text = repository_root.to_str()?;
    let cfg = RepositoryAdapterConfig::new(git_exe.to_str()?, root_text).ok()?;
    let reader = CommittedFileReader::open(&cfg, CommittedRevision::Head).ok()?;
    let (broker, allowlist, adapter) = closure_bytes(&reader).ok()?;
    let committed = CommittedClosureBytes {
        gatekeeper_broker: Some(&broker),
        installation_project_allowlist: Some(&allowlist),
        credential_adapter: adapter.as_deref(),
    };
    let governed = HostGovernedRoot::from_installation_root(root_text).ok()?;
    let attested = attest_installation_programme(manifest, &committed, &governed).ok()?;
    Some((attested, reader))
}

/// RESOLVE the governed activation for this service start, or say which input class is not live.
///
/// Order: the delegation record first (its ABSENCE is the ordinary dormant answer and touches
/// nothing else), then the payload, the manifest, the programme, and the delegation's verification
/// and lifecycle — provenance always before any durable read, exactly as the verifier orders it.
///
/// # Errors
/// [`GovernedActivationUnavailable`] naming the first input class that is not live.
pub fn resolve_governed_activation(
    state: &mut ActivatedHostDurableState,
) -> Result<ResolvedGovernedActivation, GovernedActivationUnavailable> {
    // 1. THE DELEGATION RECORD, or dormancy.
    let delegation_path = state
        .host_state_root()
        .join(OWNER_DELEGATION_RELATIVE_PATH.replace('/', "\\"));
    let bytes = read_delegation_record(&delegation_path)?;
    let record = decode_signed_owner_programme_delegation(&bytes)
        .map_err(|_| GovernedActivationUnavailable::DelegationRefused)?;

    // 2. THE PAYLOAD: this executable's own verified location, and the two packaged tools.
    let exe = RunningExecutable::open_current()
        .ok_or(GovernedActivationUnavailable::PayloadUnavailable)?;
    let install_root = exe
        .canonical_path()
        .parent()
        .ok_or(GovernedActivationUnavailable::PayloadUnavailable)?
        .to_path_buf();
    let payload_root = install_root.join(contract::PAYLOAD_RELATIVE_ROOT);
    let node_exe = payload_root.join(contract::RUNTIME_RELATIVE_PATH.replace('/', "\\"));
    let git_exe = payload_root.join(contract::PACKAGED_GIT_RELATIVE_PATH.replace('/', "\\"));
    if !node_exe.is_file() || !git_exe.is_file() {
        return Err(GovernedActivationUnavailable::PayloadUnavailable);
    }

    // 3. THE MANIFEST, parsed once.
    let manifest_path = payload_root.join(contract::TRUST_MANIFEST_FILENAME);
    let manifest_bytes =
        std::fs::read(&manifest_path).map_err(|_| GovernedActivationUnavailable::ManifestUnavailable)?;
    let manifest = TrustManifest::parse(&manifest_bytes)
        .map_err(|_| GovernedActivationUnavailable::ManifestUnavailable)?;

    // 4. THE PROGRAMME: the ONE registered project whose committed closure attests to the
    //    delegation's signed project and repository digests. The registry names candidates; the
    //    owner's signatures decide.
    let registry = read_canonical_registry(&RealRegistryFacts)
        .map_err(|_| GovernedActivationUnavailable::ProgrammeUnresolvable)?;
    let claimed = record.claimed_delegation();
    let mut resolved = None;
    for project in registry.projects() {
        if let Some((attested, reader)) =
            attest_project(&manifest, &git_exe, project.repository_root())
        {
            if attested.project() == &claimed.project
                && attested.repository() == &claimed.repository
            {
                resolved = Some((
                    attested,
                    reader,
                    project.repository_root().to_path_buf(),
                    project.project_id().to_string(),
                ));
                break;
            }
        }
    }
    let (attested, _startup_reader, governed_root, project_id) =
        resolved.ok_or(GovernedActivationUnavailable::ProgrammeUnresolvable)?;

    // 5. THE LIFECYCLE, THEN THE VERIFICATION, THEN THE MINT. Activation is idempotent for a record
    //    already Active and refuses a terminal one; verification runs the one O12-pinned order; the
    //    capability mint demands the verified value and the review operation class.
    state
        .activate_delegation(&record, &attested)
        .map_err(|_| GovernedActivationUnavailable::DelegationRefused)?;
    let verified = {
        let (delegation_store, _replay) = state.stores_for_composition();
        verify_owner_programme_delegation_for_installation(&record, &attested, delegation_store)
            .map_err(|_| GovernedActivationUnavailable::DelegationRefused)?
    };
    let review = HostReviewIpcCapability::from_owner_programme_delegation(&verified)
        .map_err(|_| GovernedActivationUnavailable::DelegationRefused)?;

    Ok(ResolvedGovernedActivation {
        review,
        verified,
        record,
        attested,
        governed_root,
        project_id,
        payload_root,
        node_exe,
        git_exe,
    })
}

/// Pin the candidate and ingest the committed plan FOR ONE EXCHANGE.
///
/// Re-run per exchange because the unattended route commits a local candidate before every review:
/// the reader pins HEAD once here, and the plan record is read AT that pinned commit, so the plan,
/// the candidate and the evidence all describe the same commit.
///
/// # Errors
/// [`GovernedActivationUnavailable`] when the repository or the committed plan is not usable.
pub fn pin_exchange(
    activation: &ResolvedGovernedActivation,
) -> Result<(CommittedFileReader, CommittedPlanAuthority), GovernedActivationUnavailable> {
    let root_text = activation
        .governed_root
        .to_str()
        .ok_or(GovernedActivationUnavailable::RepositoryUnavailable)?;
    let git_text = activation
        .git_exe
        .to_str()
        .ok_or(GovernedActivationUnavailable::PayloadUnavailable)?;
    let cfg = RepositoryAdapterConfig::new(git_text, root_text)
        .map_err(|_| GovernedActivationUnavailable::RepositoryUnavailable)?;
    let reader = CommittedFileReader::open(&cfg, CommittedRevision::Head)
        .map_err(|_| GovernedActivationUnavailable::RepositoryUnavailable)?;
    let plan = ingest_committed_plan(&reader, &activation.verified)
        .map_err(|_| GovernedActivationUnavailable::PlanRefused)?;
    Ok((reader, plan))
}
