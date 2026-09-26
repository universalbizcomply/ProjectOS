//! Serving the READ-ONLY installed-host status over the EXISTING named pipe.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A.
//!
//! This is the whole of what the installed service does beyond staying alive. It adds no protocol,
//! no request kind, no second pipe and no generic payload route: the existing `ControllerHello` IS
//! the request, and exactly one closed status record is the answer.
//!
//! Everything protected stays refused. The capability this loop holds has a single scope — the
//! read-only status read — so it cannot start, stop, configure or reconfigure anything, cannot write
//! a file, and cannot put any other message on the wire.

use std::sync::atomic::{AtomicBool, Ordering};

use projectos_host_windows_local_ipc::{
    resolve_installed_host_pipe_security, LiveIpcOperationCapability, OwnerStatusReadApproval,
    ServeStatusOutcome, ServiceStateReport, WindowsInstalledHostStatusServer,
};

use crate::status;

/// Bounded pause after a refused or failed exchange, so a service that cannot serve never spins.
const REFUSAL_BACKOFF_MS: u64 = 200;

/// Serve status exchanges until the SCM asks the service to stop.
///
/// Each iteration is a COMPLETE, independent exchange on a freshly created first-instance endpoint
/// with a freshly derived single-use nonce, so a nonce is never reused across clients and a refused
/// request cannot poison the next one.
///
/// The loop observes nothing until a request has been confirmed: `status::observe` is passed as a
/// callback into the transport façade and is invoked only after the handshake accepted.
pub fn serve_installed_host_status_until_stop(stop: &AtomicBool) {
    // The capability is minted from the exact frozen owner phrase. Its ONLY scope is the read-only
    // status read; there is no other capability in this process and no other thing it can authorise.
    let Ok(approval) =
        OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE)
    else {
        // The phrase did not transcribe. Fail closed: serve nothing rather than serve unapproved.
        return;
    };
    let capability = LiveIpcOperationCapability::from_owner_status_read_approval(approval);

    while !stop.load(Ordering::SeqCst) {
        // Resolved read-only, per attempt, from host-authority. Only `Ready` lets the endpoint exist;
        // every other status refuses inside `prepare_server` with no weaker fallback.
        let security = resolve_installed_host_pipe_security();
        let server = WindowsInstalledHostStatusServer::for_installed_host();

        let outcome = server.serve_one_status_exchange(&capability, security, || {
            // The service is Running by construction: this loop runs only between the lifecycle's
            // `running()` and its stop. The state is not guessed from the SCM or from a caller.
            status::observe(ServiceStateReport::Running)
        });

        if outcome != ServeStatusOutcome::StatusServed {
            // A refusal is normal (no client connected within the bounded wait, or a request failed
            // closed). Pause briefly rather than immediately re-creating the endpoint.
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
        }
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1A - THE HOST REVIEW DISPATCH. COMPLETE, AND DORMANT.
//
// The loop below is the status loop above with ONE addition: after the accepted status exchange it
// reads at most one fixed-width review request and hands it to the Host's production responder.
//
// NOTHING CALLS IT, and nothing in a shipped graph can. It demands a `HostReviewIpcCapability`, and
// that type has no production mint - no constructor, no phrase, no feature. The SCM entry therefore
// still starts the status loop above, byte for byte as accepted. What stands between this function and
// use is an owner-governed activation that supplies the capability and the responder's sealed inputs;
// it is not another implementation bridge.
// ---------------------------------------------------------------------------------------------

use projectos_host_windows_local_ipc::{
    HostReviewIpcCapability, InstalledHostStatus, ProtectedOperationRequest,
    ProtectedOperationResponse, ProtectedOperationsReport, ServeExchangeOutcome,
    ServeReviewOutcome, WindowsHostReviewServer,
};

/// Serve status exchanges AND independent gatekeeper reviews until the SCM asks the service to stop.
///
/// `respond` is the Host's production responder
/// (`projectos_host_gatekeeper_review_composition::review_dispatch::answer_review_request`, closed over
/// its sealed inputs). It is called at most once per exchange, only after a confirmed handshake and a
/// served status record, and only with a request the strict decoder accepted.
#[allow(dead_code)] // DORMANT BY CONSTRUCTION: reachable only with a capability no shipped graph mints.
pub fn serve_status_and_reviews_until_stop(
    stop: &AtomicBool,
    review: &HostReviewIpcCapability,
    respond: &mut dyn FnMut(&ProtectedOperationRequest) -> ProtectedOperationResponse,
) {
    let Ok(approval) =
        OwnerStatusReadApproval::transcribe(OwnerStatusReadApproval::REQUIRED_PHRASE)
    else {
        return;
    };
    let capability = LiveIpcOperationCapability::from_owner_status_read_approval(approval);

    while !stop.load(Ordering::SeqCst) {
        let security = resolve_installed_host_pipe_security();
        let server = WindowsHostReviewServer::for_installed_host();

        let outcome = server.serve_one_exchange(
            &capability,
            review,
            security,
            || accepting_reviews(status::observe(ServiceStateReport::Running)),
            respond,
        );

        let served = matches!(
            outcome,
            ServeExchangeOutcome::ReviewHalf(
                ServeReviewOutcome::Answered | ServeReviewOutcome::NoRequest(_)
            )
        );
        if !served {
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
        }
    }
}

/// The observed record, restated with protected operations AUTHORISED.
///
/// ONLY the review-serving loop calls this, so only a Host that actually holds the review capability
/// ever tells a client it may send a request. Every other field is the observer's, unchanged; if the
/// record cannot be restated the observer's own record - which says REFUSED - is served instead, so a
/// failure here withholds requests rather than inviting them.
#[allow(dead_code)]
fn accepting_reviews(observed: InstalledHostStatus) -> InstalledHostStatus {
    InstalledHostStatus::new(
        observed.service_state(),
        observed.identity(),
        observed.channel(),
        observed.readiness(),
        ProtectedOperationsReport::Authorised,
        *observed.build_prefix(),
        *observed.manifest_prefix(),
    )
    .unwrap_or(observed)
}

// =================================================================================================
// PROJECTOS-HOST-REVIEW-PATH1B §10 - THE GOVERNED REVIEW SERVE LOOP.
//
// The two loops above are PATH1A: the status loop the installed service runs today, and the dormant
// status-and-review loop whose `respond(&request)` callback shape gave the Host no way to hand a
// responder the connection trust chain.
//
// This loop is the complete production route. It is NOT dormant for want of code: it is reachable
// the moment the caller can present the two ACTIVATION INPUTS below, and neither of them is
// something ProjectOS can manufacture.
// =================================================================================================

use projectos_host_windows_local_ipc::{
    GovernedChannelContext, GovernedReviewAdmissionAuthority, GovernedReviewConnectionInputs,
    ServeGovernedReviewOutcome,
};

use crate::trusted_startup::TrustedHostRuntime;

/// How long a per-connection session authority may live, in trusted-clock milliseconds.
///
/// One exchange, not a session: the client connects, asks one question and is answered. Kept short
/// so a connection that stalls expires rather than holding authority, and re-bounded by the sealed
/// verifier regardless - this constant can only ever make the window SMALLER than the verifier
/// permits, never larger.
const SESSION_WINDOW_MS: u64 = 120_000;

/// Why the governed review loop could not start.
///
/// It is a STARTUP refusal, not a per-connection one: once the loop is running, a connection that
/// fails is refused and the loop continues.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum GovernedReviewStartRefusal {
    /// This installation has no enrolled ProjectOS owner, or its enrolment is malformed. There is no
    /// principal to admit a client against, so no connection could ever be admitted.
    NoEnrolledOwner,
    /// The Host own channel facts could not be resolved - its approved-plan authority could not
    /// establish the phase or the approved baseline.
    ChannelUnavailable,
    /// The Host own runtime instance could not be observed, or the sealed production verifier
    /// refused to attest it.
    RuntimeUnavailable,
}

impl core::fmt::Display for GovernedReviewStartRefusal {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::NoEnrolledOwner => "no enrolled ProjectOS owner on this installation",
            Self::ChannelUnavailable => "host channel facts unavailable",
            Self::RuntimeUnavailable => "host runtime instance unavailable",
        })
    }
}

impl std::error::Error for GovernedReviewStartRefusal {}

/// Serve governed review exchanges until the SCM asks the service to stop.
///
/// # The two activation inputs
///
/// `review` is the governed-review IPC capability. Its ONLY mint is
/// `HostReviewIpcCapability::from_owner_programme_delegation`, which takes the sealed
/// `VerifiedOwnerProgrammeDelegation` - an ECDSA-P256 signature by the owner over a
/// domain-separated canonical record, checked against the embedded owner anchor, addressing this
/// installation programme, and live in the Host own durable record.
///
/// `attested` is the sealed `AttestedInstallationProgramme` - the installed trust manifest
/// signature and its whole execution closure over the installation COMMITTED bytes.
///
/// Both are OWNER SIGNATURES. ProjectOS does not hold the owner private key and must never hold it,
/// so no amount of code in this repository can produce either. That is what "dormant until
/// activation" means here, and it is a property of the authority, not a missing function.
///
/// # What the loop does per connection
///
/// Everything in the ruling per-connection chain, through
/// `WindowsHostReviewServer::serve_one_governed_review_exchange`: accept, handshake, status record,
/// W1 exact-configured-owner client admission, real same-connection evidence, the canonical
/// crossing, the sealed session and peer mints, then the responder.
///
/// # Errors
/// [`GovernedReviewStartRefusal`] if the loop cannot be started at all.
#[allow(clippy::too_many_arguments)]
pub fn serve_governed_reviews_until_stop(
    stop: &AtomicBool,
    runtime: &TrustedHostRuntime,
    review: &HostReviewIpcCapability,
    attested: &projectos_host_identity::AttestedInstallationProgramme,
    plan: &dyn projectos_host_windows_local_ipc::HostPlanAuthority,
    respond: &mut dyn FnMut(
        &ProtectedOperationRequest,
        &projectos_host_core::BoundIpcSession,
        &projectos_host_windows_local_ipc::TrustedPeerContext,
    ) -> ProtectedOperationResponse,
) -> Result<(), GovernedReviewStartRefusal> {
    // THE TRANSPORT CAPABILITY IS THE REVIEW AUTHORITY OWN. It is NOT the owner status-read phrase:
    // a status approval has never authorised a review, and this loop never transcribes one.
    let transport = review.issue_transport_capability();

    // The admission authority: the live client-admission capability PAIRED with the EXACT enrolled
    // configured owner of the ONE installation the whole runtime is scoped to.
    let admission = GovernedReviewAdmissionAuthority::for_installation(runtime.installation())
        .map_err(|_| GovernedReviewStartRefusal::NoEnrolledOwner)?;

    // The Host own channel facts, from the owner-signed attested programme and the Host own
    // approved-plan authority. Resolved ONCE: they describe the installation, not the connection.
    let channel = GovernedChannelContext::for_governed_review(attested, plan)
        .ok_or(GovernedReviewStartRefusal::ChannelUnavailable)?;

    while !stop.load(Ordering::SeqCst) {
        let security = resolve_installed_host_pipe_security();
        let server = WindowsHostReviewServer::for_installed_host();

        // THE CLOCK READING IS TAKEN PER CONNECTION, never cached: a retained reading is exactly the
        // replay the authority-time contract exists to prevent.
        let now = runtime.now();

        // The Host own runtime instance, re-observed and re-attested per connection so a session
        // never outlives the runtime proof it was minted under.
        let Some(verified_runtime) = observe_verified_runtime(runtime, &now) else {
            // Fail closed and pause: a Host that cannot attest its own runtime serves nothing, and
            // it must not spin while that is true.
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
            continue;
        };

        // A FRESH per-connection verifier from the ONE capability set. Its identity is
        // crate-assigned; nothing here or on the wire can choose it.
        let verifier = runtime.capabilities().begin_connection();

        let inputs = GovernedReviewConnectionInputs {
            verifier: &verifier,
            runtime: &verified_runtime,
            now: &now,
            session_window: SESSION_WINDOW_MS,
            admission: &admission,
            channel: &channel,
        };

        let outcome = server.serve_one_governed_review_exchange(
            &transport,
            review,
            security,
            &inputs,
            || accepting_reviews(status::observe(ServiceStateReport::Running)),
            respond,
        );

        let served = matches!(
            outcome,
            ServeGovernedReviewOutcome::ReviewHalf(
                ServeReviewOutcome::Answered | ServeReviewOutcome::NoRequest(_)
            )
        );
        if !served {
            // Every other outcome - a refused scope, an unconfirmed handshake, a client that is not
            // the configured owner, a refused crossing, a refused session - is a REFUSAL. Pause
            // briefly rather than immediately re-creating the endpoint.
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
        }
    }
    Ok(())
}

/// Observe the Host OWN process and attest it through the SEALED production runtime verifier.
///
/// The observation is evidence: role/source agreement, the process identity, the service-evidence
/// consistency, the proof window, expiry, staleness and the clock lineage are all decided by the
/// verifier. `None` means the Host could not attest itself, which is a refusal, never a default.
fn observe_verified_runtime(
    runtime: &TrustedHostRuntime,
    now: &projectos_host_core::VerifiedAuthorityTime,
) -> Option<projectos_host_core::VerifiedRuntimeInstance> {
    use projectos_host_core::RuntimeInstanceVerifier as _;

    // The self-observation source was acquired at STARTUP, under a borrow of the confirmed
    // service-runtime authority - the only moment that guard exists as a value. There is no second
    // authority here and no way to acquire another source now.
    let observed = runtime.observe_self()?;
    let observation = projectos_host_windows_runtime_observation::installed_service_observation(
        &observed,
        now.reading(),
        now.reading().saturating_add(RUNTIME_WINDOW_MS),
    )?;
    runtime
        .capabilities()
        .runtime()
        .verify(&observation, now)
        .ok()
}

/// How long a runtime attestation may live, in trusted-clock milliseconds. Re-bounded by the sealed
/// verifier own maximum window, so this can only ever be the smaller of the two.
const RUNTIME_WINDOW_MS: u64 = 120_000;

// =================================================================================================
// PROJECTOS-HOST-REVIEW-PATH1B, CRITERION 21 - THE SERVICE-ENTRY GOVERNED LOOP.
//
// `serve_governed_reviews_until_stop` above proves the per-connection TRUST chain over a responder a
// caller composed. This is the caller: it resolves the activation inputs from their durable
// locations (`activation_resolver`), establishes the trusted runtime, and composes the Host's answer
// PER EXCHANGE - because the unattended route commits a local candidate before every review, so the
// candidate reader, the plan authority and the operation ports must all be pinned per exchange or
// they would answer about a stale commit.
//
// It supplies no input itself. Everything it wires is either an owner-signed activation input, a
// Windows fact, or a production port that already existed; a missing or refusing input means the
// service serves the STATUS loop, byte for byte as an unactivated installation always has.
// =================================================================================================

use std::path::Path;

use projectos_host_gatekeeper_attestation::operation::HostPorts;
use projectos_host_gatekeeper_attestation::{RequestLifecycle, RetainedRequestInbox};
use projectos_host_gatekeeper_review_composition::candidate_evidence::PinnedCommitEvidence;
use projectos_host_gatekeeper_review_composition::closure_facts::SignedClosureFacts;
use projectos_host_gatekeeper_review_composition::host_ports::{
    BrokerRoots, CommittedReaderBytes, InstalledTrustManifest, PackagedBrokerExecution,
    PinnedExecutablePolicy, PinnedNodeLauncher, SystemClock,
};
use projectos_host_gatekeeper_review_composition::review_dispatch::{
    FsAttestationStore, FsRequestInbox, FsResponseOutbox,
};
use projectos_host_gatekeeper_review_composition::PinnedCommitCandidateSource;
use projectos_host_windows_local_ipc::{
    activate_governed_project_ledger_root, ActivatedHostDurableState, CanonicalGatekeeperLedger,
    HostClockReading,
};

use crate::activation_resolver::{
    pin_exchange, resolve_governed_activation, GovernedActivationUnavailable,
    ResolvedGovernedActivation, BROKER_SCRATCH_RELATIVE_ROOT, PLAN_STORE_RELATIVE_ROOT,
};
use crate::governed_review_activation::GovernedReviewActivation;

/// Serve the installed service: the governed review loop when every activation input is live, and
/// the accepted status-only loop otherwise. ONE decision, taken at start; the inputs are durable, so
/// re-deciding per request would only let a half-removed activation flap between the two.
pub fn serve_resolved_until_stop(stop: &AtomicBool, state: &mut ActivatedHostDurableState) {
    match resolve_governed_activation(state) {
        Ok(activation) => {
            if run_governed_until_stop(stop, state, &activation).is_err() {
                // The governed loop could not START. Fall back to the status loop rather than
                // serving nothing: dormancy is the fail-safe state.
                serve_installed_host_status_until_stop(stop);
            }
        }
        Err(GovernedActivationUnavailable::DelegationAbsent) => {
            // THE ORDINARY CASE: nobody activated this installation. Exactly today's behaviour.
            serve_installed_host_status_until_stop(stop);
        }
        Err(_) => {
            // Inputs exist but refused. Fail closed INTO dormancy - the status record keeps saying
            // protected operations are refused, and no review is served.
            serve_installed_host_status_until_stop(stop);
        }
    }
}

/// The governed loop proper. `Err(())` only when it could not start at all.
fn run_governed_until_stop(
    stop: &AtomicBool,
    state: &mut ActivatedHostDurableState,
    activation: &ResolvedGovernedActivation,
) -> Result<(), ()> {
    // THE TRUSTED RUNTIME: installation -> machine authority -> clock lineage -> capability set.
    let runtime = crate::trusted_startup::establish_trusted_host_runtime().map_err(|_| ())?;

    // THE GOVERNED PROJECT LEDGER ROOT resolves through the ONE activation module, per exchange
    // (see `activate_governed_project_ledger_root`); proving it resolvable is part of starting.
    activate_governed_project_ledger_root(&activation.project_id).map_err(|_| ())?;

    // THE SERVICE EPOCH: one per start, from the trusted clock lineage's own reading, so a client
    // holding last start's epoch is refused and taught the current one.
    let service_epoch = runtime.now().reading();

    let transport = activation.review.issue_transport_capability();
    let admission = GovernedReviewAdmissionAuthority::for_installation(runtime.installation())
        .map_err(|_| ())?;
    let state_root = state.host_state_root().to_path_buf();

    while !stop.load(Ordering::SeqCst) {
        let security = resolve_installed_host_pipe_security();
        let server = WindowsHostReviewServer::for_installed_host();
        let now = runtime.now();
        let Some(verified_runtime) = observe_verified_runtime(&runtime, &now) else {
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
            continue;
        };
        let verifier = runtime.capabilities().begin_connection();

        // PER EXCHANGE: pin the candidate, ingest the committed plan at that commit, and resolve
        // the channel facts from it - so channel, plan, candidate and evidence are one commit.
        let Ok((reader, plan)) = pin_exchange(activation) else {
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
            continue;
        };
        let Some(channel) = GovernedChannelContext::for_governed_review(&activation.attested, &plan)
        else {
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
            continue;
        };

        let inputs = GovernedReviewConnectionInputs {
            verifier: &verifier,
            runtime: &verified_runtime,
            now: &now,
            session_window: SESSION_WINDOW_MS,
            admission: &admission,
            channel: &channel,
        };

        let outcome = serve_one_governed_exchange(
            &server,
            &transport,
            activation,
            state,
            &state_root,
            &reader,
            &plan,
            service_epoch,
            security,
            &inputs,
        );
        let served = matches!(
            outcome,
            Some(ServeGovernedReviewOutcome::ReviewHalf(
                ServeReviewOutcome::Answered | ServeReviewOutcome::NoRequest(_)
            ))
        );
        if !served {
            std::thread::sleep(std::time::Duration::from_millis(REFUSAL_BACKOFF_MS));
        }
    }
    Ok(())
}

/// ONE exchange: build every per-exchange port over the pinned reader and answer through the
/// accepted per-connection chain. `None` when a port could not be composed - the exchange is
/// refused, the loop continues.
#[allow(clippy::too_many_arguments)]
fn serve_one_governed_exchange(
    server: &WindowsHostReviewServer,
    transport: &LiveIpcOperationCapability,
    activation: &ResolvedGovernedActivation,
    state: &mut ActivatedHostDurableState,
    state_root: &Path,
    reader: &projectos_host_repository::CommittedFileReader,
    plan: &projectos_host_gatekeeper_review_composition::committed_plan::CommittedPlanAuthority,
    service_epoch: u64,
    security: projectos_host_windows_local_ipc::ProjectOsHostPipeSecurityStatus,
    inputs: &GovernedReviewConnectionInputs<'_>,
) -> Option<ServeGovernedReviewOutcome> {
    // The Host's durable plan-store mirror of the ingested record, beneath its own state root.
    let plan_store_root = state_root.join(PLAN_STORE_RELATIVE_ROOT);
    let _ = std::fs::create_dir_all(&plan_store_root);
    if let Ok(mut plan_store) =
        projectos_host_plan_durable_store::PlanDurableStore::open(plan_store_root.to_str()?)
    {
        // Divergence refuses the exchange: a durable copy that disagrees is a question for the
        // owner, never something a serve loop overwrites.
        plan.mirror_into(&mut plan_store).ok()?;
    }

    // The operation ports, all over the ONE pinned reader and the resolved payload.
    let manifest = InstalledTrustManifest::beneath(&activation.payload_root);
    let committed = CommittedReaderBytes::over(reader);
    let closure = SignedClosureFacts::establish(&manifest, &committed);
    let evidence = PinnedCommitEvidence::over(reader);
    let candidate = PinnedCommitCandidateSource::from_reader(reader);
    let executables = PinnedExecutablePolicy::over(&activation.node_exe, &activation.git_exe);
    let clock = SystemClock;
    let scratch = state_root.join(BROKER_SCRATCH_RELATIVE_ROOT);
    let _ = std::fs::create_dir_all(&scratch);
    let launcher = PinnedNodeLauncher::new(
        &activation.node_exe,
        &activation.git_exe,
        &activation.governed_root,
        &scratch,
    );
    let execution = PackagedBrokerExecution::establish(
        &manifest,
        &committed,
        &launcher,
        &clock,
        BrokerRoots {
            install_root: activation.payload_root.to_str()?.to_string(),
            state_dir: state_root.to_str()?.to_string(),
            governed_root: activation.governed_root.to_str()?.to_string(),
        },
    )?;

    let ledger_root = activate_governed_project_ledger_root(&activation.project_id).ok()?;
    let ledger_now = HostClockReading::now_from_host().ok()?;
    let mut ledger = CanonicalGatekeeperLedger::open(ledger_root, &ledger_now);

    let inbox_store = FsRequestInbox::beneath(state_root);
    let retained = RetainedRequestInbox::over(&inbox_store);
    let mut attestations = FsAttestationStore::beneath(state_root);
    let mut responses = FsResponseOutbox::beneath(state_root);
    let mut lifecycle = RequestLifecycle::new();

    let (delegation_state, replay) = state.stores_for_composition();

    let mut governed = GovernedReviewActivation {
        delegation_record: &activation.record,
        attested_programme: &activation.attested,
        delegation_state,
        plan,
        closure: &closure,
        candidate: &candidate,
        cost: &closure,
        inbox: &retained,
        ledger: &mut ledger,
        replay,
        service_epoch,
        operation_ports: HostPorts {
            manifest: &manifest,
            committed: &committed,
            executables: &executables,
            inbox: &retained,
            execution: &execution,
            clock: &clock,
            evidence: &evidence,
        },
        lifecycle: &mut lifecycle,
        attestations: &mut attestations,
        responses: &mut responses,
    };

    Some(server.serve_one_governed_review_exchange(
        transport,
        &activation.review,
        security,
        inputs,
        || accepting_reviews(status::observe(ServiceStateReport::Running)),
        &mut |request, session, peer| governed.answer(request, session, peer),
    ))
}
