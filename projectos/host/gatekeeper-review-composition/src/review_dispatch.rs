//! PROJECTOS-HOST-REVIEW-PATH1A - THE HOST'S ANSWER TO ONE REVIEW REQUEST, and the three small
//! filesystem adapters it needs.
//!
//! ## The dispatch
//!
//! [`answer_review_request`] is what the service's review half calls with a decoded request. It is
//! an ORDER, not a decision: compose (the accepted §10A pass, unchanged), then run the execution rung
//! (the accepted single evidence mint, unchanged) over the one shipped seam implementation. Every
//! refusal either of them produces becomes a well-formed `Rejected`/`NotRun` response, so the caller
//! always learns that nothing ran rather than being left to guess from a closed connection.
//!
//! ## It is dormant, and nothing here can wake it
//!
//! Every input is a sealed value or a port that something else must supply: an OWNER-SIGNED delegation
//! record, the attested installation programme, a bound live session and its admitted peer, the
//! durable delegation and replay stores, the canonical ledger, and the review operation's own ports -
//! whose production entry still begins with the owner's signature over the installed manifest. This
//! crate can construct none of them. Supplying them is ACTIVATION, and it is owner-governed.
//!
//! ## The adapters
//!
//! Three leaf directories beneath a root the CALLER resolved (the trusted Host state root): the request
//! inbox, the response outbox and the attestation store. File names are DERIVED from the wire
//! correlation or the attestation id and are never supplied, so no request can aim a read or a write.
//! The adapters create no directory and change no ACL: provisioning the leaves is the installer's job.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use projectos_host_gatekeeper_attestation::envelope::attestation_record_bytes;
use projectos_host_gatekeeper_attestation::operation::{
    AttestationStorePort, HostAttestation, HostPorts, StoreOutcome,
};
use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestFileIdentity, RequestLifecycle, ResponseFileIdentity, ResponseRecordSink,
    RetainedRequestInbox, INBOX_RELATIVE_ROOT, MAX_RESPONSE_RECORD_BYTES, RESPONSE_RELATIVE_ROOT,
};
use projectos_host_identity::AttestedInstallationProgramme;
use projectos_host_core::{BoundIpcSession, RequestAdmissionStore};
use projectos_host_windows_local_ipc::{
    compose_protected_operation, run_authorised_review, AdmittedCostSource, CanonicalBudgetLedger,
    CommittedCandidateSource, CompositionRefusal, DurableDelegationStateStore, HostClockReading,
    HostPlanAuthority, HostRequestSources, HostReviewExecution, ProtectedOperationRequest,
    ProtectedOperationResponse, RejectionReason, RequestReplayLedger, SignedExecutionClosureFacts,
    SignedOwnerProgrammeDelegation, TerminalStatus, TrustedPeerContext,
};

/// The fixed attestation-store leaf beneath the Host state root.
pub const ATTESTATION_RELATIVE_ROOT: &str = "gatekeeper-attestations";
/// The fixed extension of a stored attestation.
pub const ATTESTATION_FILE_EXTENSION: &str = "attestation";

// -------------------------------------------------------------------------------------------------
// THE ADAPTERS
// -------------------------------------------------------------------------------------------------

/// `FILE_FLAG_OPEN_REPARSE_POINT`: open the ENTRY ITSELF, never what a symlink or another reparse
/// point in the final component resolves to.
#[cfg(windows)]
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

/// Make `options` refuse to follow a reparse point in the final path component.
///
/// ON WINDOWS this is what closes the race: with the flag set, a symlink is opened AS a symlink, so the
/// type read from the resulting HANDLE is the type of the very object that will be read - there is no
/// second lookup by name for a swap to land in. Elsewhere `std` offers no equivalent without a new
/// dependency, so the path is checked first and the handle again; ProjectOSHost is a Windows service
/// and this branch exists so the crate still builds and tests on another platform.
fn do_not_follow(options: &mut OpenOptions) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))]
    let _ = options;
}

/// Open a REGULAR FILE, and nothing that merely resolves to one - judged from the OPEN HANDLE.
///
/// CHECK-THEN-OPEN BY NAME WAS THE DEFECT HERE (ECC security review): whoever may write the inbox could
/// swap the checked file for a link between the two lookups and aim a privileged read - at a Host-only
/// file to confirm a guessed digest, or at a device that never returns, stalling the serve loop. The
/// file is now opened once, without following, and the type is read off that handle.
pub(crate) fn open_plain_file(path: &Path) -> Option<File> {
    #[cfg(not(windows))]
    if !fs::symlink_metadata(path).map(|m| m.file_type().is_file()).unwrap_or(false) {
        return None;
    }
    let mut options = OpenOptions::new();
    options.read(true);
    do_not_follow(&mut options);
    let file = options.open(path).ok()?;
    file.metadata().ok()?.file_type().is_file().then_some(file)
}

/// Write `bytes` to a file that MUST NOT already exist, durably. `Ok(false)` when it already existed.
///
/// A link left where the record belongs counts as EXISTING: without the no-follow flag, creating
/// "new" through a dangling link would create the link's TARGET, somewhere this adapter never named.
pub(crate) fn create_new_durably(path: &Path, bytes: &[u8]) -> std::io::Result<bool> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    do_not_follow(&mut options);
    let mut file = match options.open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(e),
    };
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(e) = written {
        // A partial record must not be left where a complete one is expected. Removal is best
        // effort: the write already failed, and that is what is reported.
        drop(file);
        let _ = fs::remove_file(path);
        return Err(e);
    }
    Ok(true)
}

/// The request inbox: `<root>/gatekeeper-inbox/<correlation-hex>.request`, opened read-only.
#[derive(Debug)]
pub struct FsRequestInbox {
    directory: PathBuf,
}

impl FsRequestInbox {
    /// The inbox beneath a Host state root the CALLER resolved. Nothing is opened or created here.
    #[must_use]
    pub fn beneath(host_state_root: &Path) -> Self {
        Self {
            directory: host_state_root.join(INBOX_RELATIVE_ROOT),
        }
    }
}

impl InboxReader for FsRequestInbox {
    fn open_once(&self, identity: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
        open_plain_file(&self.directory.join(identity.file_name()))
            .map(|f| Box::new(f) as Box<dyn Read + '_>)
    }
}

/// The response outbox: `<root>/gatekeeper-outbox/<correlation-hex>.response`, written once.
#[derive(Debug)]
pub struct FsResponseOutbox {
    directory: PathBuf,
}

impl FsResponseOutbox {
    /// The outbox beneath a Host state root the CALLER resolved. Nothing is opened or created here.
    #[must_use]
    pub fn beneath(host_state_root: &Path) -> Self {
        Self {
            directory: host_state_root.join(RESPONSE_RELATIVE_ROOT),
        }
    }
}

impl ResponseRecordSink for FsResponseOutbox {
    fn store_once(&mut self, identity: &ResponseFileIdentity, record: &[u8]) -> bool {
        if record.is_empty() || record.len() > MAX_RESPONSE_RECORD_BYTES {
            return false;
        }
        matches!(
            create_new_durably(&self.directory.join(identity.file_name()), record),
            Ok(true)
        )
    }
}

/// The attestation store: `<root>/gatekeeper-attestations/<attestation-id-hex>.attestation`.
#[derive(Debug)]
pub struct FsAttestationStore {
    directory: PathBuf,
}

impl FsAttestationStore {
    /// The store beneath a Host state root the CALLER resolved. Nothing is opened or created here.
    #[must_use]
    pub fn beneath(host_state_root: &Path) -> Self {
        Self {
            directory: host_state_root.join(ATTESTATION_RELATIVE_ROOT),
        }
    }
}

impl AttestationStorePort for FsAttestationStore {
    fn store_once(&mut self, attestation: &HostAttestation) -> StoreOutcome {
        let mut name = String::with_capacity(64 + 1 + ATTESTATION_FILE_EXTENSION.len());
        for b in attestation.attestation_id() {
            name.push_str(&format!("{b:02x}"));
        }
        name.push('.');
        name.push_str(ATTESTATION_FILE_EXTENSION);
        match create_new_durably(&self.directory.join(name), &attestation_record_bytes(attestation))
        {
            Ok(true) => StoreOutcome::Stored,
            Ok(false) => StoreOutcome::AlreadyStored,
            Err(_) => StoreOutcome::Failed,
        }
    }
}

// -------------------------------------------------------------------------------------------------
// THE DISPATCH
// -------------------------------------------------------------------------------------------------

/// Everything the Host needs to answer ONE review request. Every field is a sealed value or a port
/// supplied by the service's own composition; nothing here is, or can be derived from, a request.
pub struct HostReviewInputs<'a> {
    /// The OWNER-SIGNED programme delegation record.
    pub delegation_record: &'a SignedOwnerProgrammeDelegation,
    /// The programme this installation was attested as.
    pub attested_programme: &'a AttestedInstallationProgramme,
    /// The Host's own durable record of each delegation's lifecycle.
    pub delegation_state: &'a dyn DurableDelegationStateStore,
    /// The durable approved-plan authority.
    pub plan: &'a dyn HostPlanAuthority,
    /// The model and credential policy of the signed execution closure.
    pub closure: &'a dyn SignedExecutionClosureFacts,
    /// The immutable committed candidate the Host pinned for itself.
    pub candidate: &'a dyn CommittedCandidateSource,
    /// The admitted cost of this call.
    pub cost: &'a dyn AdmittedCostSource,
    /// The request inbox.
    pub inbox: &'a dyn InboxReader,
    /// The canonical budget ledger.
    pub ledger: &'a mut dyn CanonicalBudgetLedger,
    /// The bound live session this request arrived on.
    pub session: &'a BoundIpcSession,
    /// That session's ONE admission history.
    pub admissions: &'a mut dyn RequestAdmissionStore,
    /// The Host-wide durable replay history.
    pub replay: &'a mut dyn RequestReplayLedger,
    /// The admitted peer of this connection.
    pub peer: &'a TrustedPeerContext,
    /// This service instance's epoch.
    pub service_epoch: u64,
    /// The review operation's manifest, committed-bytes, executable-policy, execution, clock and
    /// candidate-evidence ports.
    /// Its `inbox` is REPLACED by the single-read adapter below; whatever is set here is not used.
    pub operation_ports: HostPorts<'a>,
    /// The operation's one-shot request lifecycle.
    pub lifecycle: &'a mut RequestLifecycle,
    /// The durable attestation store.
    pub attestations: &'a mut dyn AttestationStorePort,
    /// The response outbox.
    pub responses: &'a mut dyn ResponseRecordSink,
}

/// Answer ONE decoded review request. Always returns a well-formed response for THIS correlation.
pub fn answer_review_request(
    inputs: &mut HostReviewInputs<'_>,
    request: &ProtectedOperationRequest,
) -> ProtectedOperationResponse {
    // THE EPOCH, BEFORE ANYTHING IS CONSUMED. See `epoch_refusal`.
    if let Some(refusal) = epoch_refusal(request, inputs.service_epoch) {
        return refusal;
    }

    // ONE OPEN OF THE REQUEST FILE serves both the composition (which needs its digest before any
    // authority exists) and the operation (which executes those very bytes).
    let mut subject = RetainedRequestInbox::over(inputs.inbox);

    let now = match HostClockReading::now_from_host() {
        Ok(now) => now,
        Err(_) => return not_run(request, inputs.service_epoch, RejectionReason::PolicyRefused),
    };

    let composed = {
        let mut sources = HostRequestSources {
            plan: inputs.plan,
            closure: inputs.closure,
            candidate: inputs.candidate,
            cost: inputs.cost,
            subject: &mut subject,
        };
        compose_protected_operation(
            inputs.delegation_record,
            inputs.attested_programme,
            &now,
            inputs.delegation_state,
            &mut sources,
            &mut *inputs.ledger,
            inputs.session,
            &mut *inputs.admissions,
            &mut *inputs.replay,
            inputs.peer,
            request,
            inputs.service_epoch,
        )
    };

    let composed = match composed {
        Ok(composed) => composed,
        // The evaluator's own wire answer, reservation already released.
        Err(CompositionRefusal::Rejected(response)) => return response,
        Err(refusal) => {
            return not_run(request, inputs.service_epoch, reason_for(&refusal));
        }
    };

    let ports = HostPorts {
        manifest: inputs.operation_ports.manifest,
        committed: inputs.operation_ports.committed,
        executables: inputs.operation_ports.executables,
        inbox: &subject,
        execution: inputs.operation_ports.execution,
        clock: inputs.operation_ports.clock,
        evidence: inputs.operation_ports.evidence,
    };
    let mut execution = HostReviewExecution::new(
        ports,
        &mut *inputs.lifecycle,
        &mut *inputs.attestations,
        &mut *inputs.responses,
    );
    run_authorised_review(composed, &mut execution, &mut *inputs.ledger)
}

/// A request addressed to ANOTHER service instance is refused HERE, before the subject is read, before
/// the request is admitted, before the replay history records it and before any budget is reserved.
///
/// WHY IT IS NOT LEFT TO THE EVALUATOR. The evaluator makes the same comparison, but only at the end of
/// composition - after the one-shot subject, the admission and the replay identity have all been
/// spent. A client has no channel on which to learn this instance's epoch except the `service_epoch`
/// every response already carries, so its first request after a Host restart necessarily names a stale
/// one. Refusing that at the end would burn the correlation of a question nobody has answered; refusing
/// it here burns nothing, and the client may ask the SAME question again with the epoch this response
/// taught it. It is a refusal and only a refusal: a matching epoch proves nothing and skips nothing -
/// the evaluator still compares it.
#[must_use]
pub fn epoch_refusal(
    request: &ProtectedOperationRequest,
    service_epoch: u64,
) -> Option<ProtectedOperationResponse> {
    (request.claimed_service_epoch() != service_epoch)
        .then(|| not_run(request, service_epoch, RejectionReason::ServiceEpochMismatch))
}

/// THE CLOSED MAP from a composition refusal to the reason the wire carries. Deliberately COARSE: a
/// caller learns that the sequence was refused or that policy refused, and nothing about which
/// delegation ids the Host holds, which source was unavailable or how much budget remains.
fn reason_for(refusal: &CompositionRefusal) -> RejectionReason {
    match refusal {
        CompositionRefusal::AdmissionRefused(_) | CompositionRefusal::ReplayRefused(_) => {
            RejectionReason::SequenceRefused
        }
        _ => RejectionReason::PolicyRefused,
    }
}

fn not_run(
    request: &ProtectedOperationRequest,
    service_epoch: u64,
    reason: RejectionReason,
) -> ProtectedOperationResponse {
    ProtectedOperationResponse::rejected(
        *request.correlation(),
        reason,
        service_epoch,
        TerminalStatus::Terminal,
    )
}
