//! THE INSTALLATION EFFECT ADAPTER.
//!
//! CD-B4-LOCAL-INSTALL-AND-LIVE-PROOF1A.
//!
//! The minimum real installer, gated behind ONE explicit owner approval. It performs the effects the
//! owner approved and nothing else: create the approved directories, copy the verified release
//! executable, create the service, configure the unrestricted service SID, resolve that SID, apply the
//! approved ACL, mint one installation id from the system CSPRNG, write and verify the canonical
//! identity record, and prove start/stop/restart.
//!
//! Every step is delegated to the crate that already owns it — the SCM adapter, the ACL policy
//! service, the activation plan, the identity writer. This module is orchestration only: it defines no
//! second path, ACL, service-name, schema, random or authority vocabulary.
//!
//! On failure it stops at the failing step, preserves the original reason, and removes ONLY what this
//! installer created.

use std::path::{Path, PathBuf};

use projectos_host_canonical_installation_identity_writer as writer;
use projectos_host_identity::canonical_record::{
    verify_record, RecordInstallationEvidence, EXPECTED_SERVICE_NAME,
};
use projectos_host_windows_acl_policy::{
    resolve_account_sid, AclPolicy, AclPolicyError, AclViolation, ApplyOutcome, OwnedSid,
    WindowsAclPolicyService,
};
use projectos_host_windows_activation_plan::acl_plan::{
    AclCompositionOutcome, AclCompositionPlan, ApprovedServicePrincipal,
};
use projectos_host_windows_activation_plan::service_identity::{
    ServiceIdentityPlan, ServiceIdentityStrategy,
};
use projectos_host_windows_service_control::{
    LifecycleOutcome, LiveOperationCapability, OwnerInstallationApproval, RunStateObservation,
    ScmServiceAdapter, SidPolicyObservation, WindowsScmBackend,
};

use crate::dry_run::{ArtefactEvidence, ReleaseManifest};
use crate::PlanRefusal;

/// The approved virtual service account. Derived from the frozen service name, never free text.
fn approved_account() -> String {
    format!("NT SERVICE\\{EXPECTED_SERVICE_NAME}")
}

/// Which step failed. The step is named so a failure is never ambiguous about how far it got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallStep {
    OwnerApproval,
    ResolveAnchors,
    CreateDirectories,
    CopyExecutable,
    VerifyExecutable,
    CreateService,
    ConfigureSidType,
    VerifySidType,
    ResolveServiceSid,
    ComposeAclPlan,
    ApplyAcl,
    GenerateInstallationId,
    WriteIdentityRecord,
    VerifyIdentityRecord,
    ApplyRecordFileAcl,
    StartService,
    StopService,
    RestartService,
}

/// A failure, with the step that produced it and a closed reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallFailure {
    /// Where it failed.
    pub step: InstallStep,
    /// The original reason, preserved verbatim as a closed classification.
    pub reason: String,
    /// What the rollback did afterwards.
    pub rollback: RollbackOutcome,
}

/// What rollback removed. It only ever removes installer-owned things.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollbackOutcome {
    /// Nothing had been created yet.
    NothingToRollBack,
    /// Installer-owned changes were removed.
    RemovedInstallerOwned,
    /// Rollback itself could not complete; the failure is reported rather than hidden.
    Incomplete,
}

/// Everything a successful installation established, for proof.
#[derive(Debug)]
pub struct InstallationOutcome {
    pub service_name: &'static str,
    pub account: String,
    pub binary_path: PathBuf,
    pub record_path: PathBuf,
    pub installation_id: String,
    pub release_manifest_digest: String,
    pub record_digest: String,
    pub sid_policy: SidPolicyObservation,
    pub acl_outcome: ApplyOutcome,
    pub start_state: RunStateObservation,
    pub stop_state: RunStateObservation,
    pub restart_state: RunStateObservation,
}

/// What this installer created, so rollback removes only these.
#[derive(Debug, Default)]
struct OwnedChanges {
    service_created: bool,
    install_dir: Option<PathBuf>,
    state_dir: Option<PathBuf>,
}

fn fail(
    step: InstallStep,
    reason: impl Into<String>,
    owned: &OwnedChanges,
    adapter: Option<&ScmServiceAdapter<WindowsScmBackend>>,
    cap: &LiveOperationCapability,
) -> InstallFailure {
    InstallFailure {
        step,
        reason: reason.into(),
        rollback: roll_back(owned, adapter, cap),
    }
}

/// Remove ONLY installer-owned changes. Never touches unknown or pre-existing content.
fn roll_back(
    owned: &OwnedChanges,
    adapter: Option<&ScmServiceAdapter<WindowsScmBackend>>,
    cap: &LiveOperationCapability,
) -> RollbackOutcome {
    if !owned.service_created && owned.install_dir.is_none() && owned.state_dir.is_none() {
        return RollbackOutcome::NothingToRollBack;
    }
    let mut complete = true;
    if owned.service_created {
        if let Some(a) = adapter {
            // Stop first if it is running; a normal stop, never a process kill.
            let _ = a.stop(cap);
            if a.delete(cap) != LifecycleOutcome::Confirmed {
                complete = false;
            }
        } else {
            complete = false;
        }
    }
    // Only directories this installer created are removed, and only if they are still ours to remove.
    //
    // A bounded retry, because a service that has just been stopped may still hold its executable open
    // for a moment; the first live run left the installed binary behind for exactly that reason. This
    // waits for the handle to close — it never kills a process and never widens what may be removed.
    for dir in [owned.install_dir.as_ref(), owned.state_dir.as_ref()]
        .into_iter()
        .flatten()
    {
        let mut removed = !dir.exists();
        for attempt in 0..25 {
            if removed {
                break;
            }
            if std::fs::remove_dir_all(dir).is_ok() {
                removed = true;
                break;
            }
            if attempt < 24 {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
        if !removed {
            complete = false;
        }
    }
    if complete {
        RollbackOutcome::RemovedInstallerOwned
    } else {
        RollbackOutcome::Incomplete
    }
}

/// Wait, bounded, for the service to reach an expected run state.
fn await_state(
    adapter: &ScmServiceAdapter<WindowsScmBackend>,
    cap: &LiveOperationCapability,
    want: RunStateObservation,
) -> RunStateObservation {
    // Bounded and deterministic: at most 30 polls of 200ms. No unbounded loop.
    for _ in 0..30 {
        let observed = adapter.query(cap);
        if observed == want {
            return observed;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    adapter.query(cap)
}

/// The topmost ancestor of `dir` (including `dir`) that does not yet exist.
///
/// `create_dir_all` creates every missing level, so this is what the installer will actually have
/// brought into existence and therefore the only thing it may remove again. Returns `None` when `dir`
/// already exists, in which case the installer created nothing here and must remove nothing.
fn topmost_missing_ancestor(dir: &Path) -> Option<PathBuf> {
    if dir.exists() {
        return None;
    }
    let mut topmost = dir.to_path_buf();
    let mut cursor = dir;
    while let Some(parent) = cursor.parent() {
        if parent.exists() {
            break;
        }
        topmost = parent.to_path_buf();
        cursor = parent;
    }
    Some(topmost)
}

/// Strip the Windows extended-length `\\?\` prefix for handing a path to an API that rejects that
/// namespace.
///
/// The anchors are canonicalised, which yields the extended-length form; the ACL service refuses it as
/// an unsupported namespace. Only the PREFIX is removed — the path itself, and the frozen path
/// contract it came from, are unchanged.
fn without_extended_length_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\")
        .map_or_else(|| path.to_path_buf(), PathBuf::from)
}

/// Perform ONE owner-approved installation.
///
/// # Errors
/// [`InstallFailure`] naming the exact failed step, its original reason, and what rollback removed.
#[allow(clippy::too_many_lines)] // One linear installation sequence; splitting it would hide the order.
pub fn install_once(
    approval_phrase: &str,
    artefact: &ArtefactEvidence,
) -> Result<InstallationOutcome, InstallFailure> {
    let mut owned = OwnedChanges::default();

    // 1. OWNER APPROVAL. Nothing below is reachable without it.
    let approval =
        OwnerInstallationApproval::transcribe(approval_phrase).map_err(|_| InstallFailure {
            step: InstallStep::OwnerApproval,
            reason: "the approval phrase did not match exactly".into(),
            rollback: RollbackOutcome::NothingToRollBack,
        })?;
    let cap = LiveOperationCapability::from_owner_approval(approval);

    // 2. Resolve the approved anchors (read-only).
    let state_anchor =
        writer::ResolvedProgramDataAnchor::resolve_approved().map_err(|e| InstallFailure {
            step: InstallStep::ResolveAnchors,
            reason: format!("{e:?}"),
            rollback: RollbackOutcome::NothingToRollBack,
        })?;
    let install_root =
        writer::ResolvedInstallRoot::resolve_approved().map_err(|e| InstallFailure {
            step: InstallStep::ResolveAnchors,
            reason: format!("{e:?}"),
            rollback: RollbackOutcome::NothingToRollBack,
        })?;
    let target = writer::InstallerTarget::under_resolved_anchor(&state_anchor).map_err(|e| {
        InstallFailure {
            step: InstallStep::ResolveAnchors,
            reason: format!("{e:?}"),
            rollback: RollbackOutcome::NothingToRollBack,
        }
    })?;
    // The anchors are canonicalised, so the derived paths carry the Windows extended-length prefix.
    // Every path this installer HANDS OUT — the SCM image path, the copy destination, the paths it
    // reports — is normalised to the plain approved form. The prefix is a canonicalisation artefact,
    // not part of the frozen path contract, and leaving it in the service configuration would register
    // an image path no later check could compare literally.
    let record_path = without_extended_length_prefix(&target.record_location());
    let binary_path = without_extended_length_prefix(&install_root.service_binary_path());
    // The canonical PRODUCTION ROOT the approved ACL plan governs: `<ProgramData>\ProjectOS`, i.e.
    // three levels above the record (installation -> host -> ProjectOS). The ACL is applied there, not
    // at a deeper subdirectory, so it matches `ProductionRootPlan::canonical`.
    let production_root = record_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| InstallFailure {
            step: InstallStep::ResolveAnchors,
            reason: "the derived record path has no production root".into(),
            rollback: RollbackOutcome::NothingToRollBack,
        })?;

    // 3. Create the approved directory structure.
    //
    // Rollback precision matters more than convenience: `create_dir_all` may create several levels, so
    // the TOPMOST directory that did not already exist is recorded, not merely the leaf. Removing only
    // the leaf would leave installer-created parents behind — a real gap this installer's first live
    // run exposed.
    let install_dir = install_root.install_dir().to_path_buf();
    let installation_dir = record_path
        .parent()
        .map(Path::to_path_buf)
        .expect("the derived record path always has a parent");
    let host_dir = installation_dir
        .parent()
        .map(Path::to_path_buf)
        .expect("the installation directory always sits beneath the host state directory");
    owned.install_dir = topmost_missing_ancestor(&install_dir);
    owned.state_dir = topmost_missing_ancestor(&installation_dir);
    for dir in [&install_dir, &installation_dir] {
        if let Err(e) = std::fs::create_dir_all(dir) {
            return Err(fail(
                InstallStep::CreateDirectories,
                format!("{e:?}"),
                &owned,
                None,
                &cap,
            ));
        }
    }

    // 4-5. Copy the verified release executable and confirm the copy byte-for-byte.
    if let Err(e) = std::fs::copy(artefact.path(), &binary_path) {
        return Err(fail(
            InstallStep::CopyExecutable,
            format!("{e:?}"),
            &owned,
            None,
            &cap,
        ));
    }
    {
        let src = std::fs::read(artefact.path()).unwrap_or_default();
        let dst = std::fs::read(&binary_path).unwrap_or_default();
        if src.is_empty() || src != dst {
            return Err(fail(
                InstallStep::VerifyExecutable,
                "the installed executable does not match the verified artefact",
                &owned,
                None,
                &cap,
            ));
        }
    }

    // The SCM adapter is bound to the INSTALLED path, never the build output.
    let adapter = ScmServiceAdapter::new(WindowsScmBackend::for_owner_approved_installation(
        &binary_path,
    ));

    // 6. Create the service. Demand-start and stopped: it cannot run until this installer starts it,
    // which happens only after the identity record exists.
    match adapter.create(&cap) {
        LifecycleOutcome::Confirmed => owned.service_created = true,
        other => {
            return Err(fail(
                InstallStep::CreateService,
                format!("{other:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    }

    // 7. Configure the UNRESTRICTED service SID type, confirmed by an authoritative re-read.
    if let other @ (LifecycleOutcome::Refused(_) | LifecycleOutcome::Indeterminate) =
        adapter.configure_sid(&cap)
    {
        return Err(fail(
            InstallStep::ConfigureSidType,
            format!("{other:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }
    let sid_policy = adapter.sid_policy(&cap);
    if sid_policy != SidPolicyObservation::UnrestrictedObserved {
        return Err(fail(
            InstallStep::VerifySidType,
            format!("{sid_policy:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }

    // 8. Resolve the service SID. It exists only now that the service does.
    let account = approved_account();
    let service_sid = match resolve_account_sid(&account) {
        Ok(s) => s,
        Err(e) => {
            return Err(fail(
                InstallStep::ResolveServiceSid,
                format!("{e:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };

    // 9. Compose and apply the approved ACL to the state root ONLY.
    let identity = ServiceIdentityPlan::analysed()
        .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
    let principal = match ApprovedServicePrincipal::from_resolved_sid(
        ServiceIdentityStrategy::VirtualServiceAccount,
        service_sid,
    ) {
        Ok(p) => p,
        Err(e) => {
            return Err(fail(
                InstallStep::ComposeAclPlan,
                format!("{e:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };
    let policy: AclPolicy = match AclCompositionPlan::production()
        .compose_with_resolved_principal(&identity, &principal)
    {
        AclCompositionOutcome::Composed(p) => p,
        other => {
            return Err(fail(
                InstallStep::ComposeAclPlan,
                format!("{other:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };
    // The approved policy is applied to EVERY level the installer created, DEEPEST FIRST.
    //
    // Both details were forced by the live run. The accepted ACL service applies a PROTECTED DACL
    // whose ACEs carry no inheritance flags — that is deliberate ("no inherited ACEs") — so a child
    // created beforehand inherits nothing and ends up with an empty DACL that denies everyone. And it
    // must be deepest-first: once the root is protected, the installer no longer has WRITE_DAC on a
    // child whose DACL is already empty, so a root-first order locks itself out.
    //
    // This is the same approved policy at each level. Nothing is weakened and no second policy exists.
    let acl_service = WindowsAclPolicyService::new();
    let mut acl_outcome = None;
    for level in [&installation_dir, &host_dir, &production_root] {
        let path = without_extended_length_prefix(level);
        match acl_service.apply_and_verify(&path, &policy) {
            Ok(o) => acl_outcome = Some(o),
            Err(e) => {
                return Err(fail(
                    InstallStep::ApplyAcl,
                    format!("{e:?} at {}", path.display()),
                    &owned,
                    Some(&adapter),
                    &cap,
                ))
            }
        }
    }
    // The outcome reported is the PRODUCTION ROOT's, applied last.
    let acl_outcome = match acl_outcome {
        Some(o) => o,
        None => {
            return Err(fail(
                InstallStep::ApplyAcl,
                "no ACL level was applied",
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };

    // 10. ONE system-preferred RNG draw for the installation id.
    let installation_id =
        match writer::InstallationId::generate(&writer::SystemPreferredInstallationIdSource) {
            Ok(id) => id,
            Err(e) => {
                return Err(fail(
                    InstallStep::GenerateInstallationId,
                    format!("{e:?}"),
                    &owned,
                    Some(&adapter),
                    &cap,
                ))
            }
        };

    // 11. Write the canonical identity record, then verify it through the CLOSED reader.
    let manifest = match ReleaseManifest::for_artefact(artefact) {
        Ok(m) => m,
        Err(e) => {
            return Err(fail(
                InstallStep::WriteIdentityRecord,
                format!("{e:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };
    let release = match manifest.release_digest() {
        Ok(d) => d,
        Err(e) => {
            return Err(fail(
                InstallStep::WriteIdentityRecord,
                format!("{e:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };
    if let Err(e) = writer::write_identity_record(
        &target,
        &installation_id,
        writer::InstallationChannel::Stable,
        &release,
    ) {
        return Err(fail(
            InstallStep::WriteIdentityRecord,
            format!("{e:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }
    let record_digest = {
        let bytes = std::fs::read(&record_path).unwrap_or_default();
        let parsed = match writer::parse_canonical_json(&bytes) {
            Ok(r) => r,
            Err(e) => {
                return Err(fail(
                    InstallStep::VerifyIdentityRecord,
                    format!("{e:?}"),
                    &owned,
                    Some(&adapter),
                    &cap,
                ))
            }
        };
        if let Err(e) = verify_record(&parsed, RecordInstallationEvidence::Matched) {
            return Err(fail(
                InstallStep::VerifyIdentityRecord,
                format!("{e:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ));
        }
        parsed.record_digest
    };

    // 11b. Apply the approved FILE ACL to the published, verified record.
    //
    // Forced by the first live status read: the protected parent directories carry NON-INHERITABLE
    // ACEs, so the record file created beneath them inherited nothing and the service could not read
    // its own identity. Inheritance is therefore never relied on — the policy is applied to the file
    // itself, AFTER publication and verification, and only its security descriptor is touched.
    //
    // A failure here fails the installation: rollback runs, the service is never activated, and the
    // record's contents are never rewritten.
    let record_acl_outcome = match AclCompositionPlan::production()
        .compose_record_file_with_resolved_principal(&identity, &principal)
    {
        AclCompositionOutcome::Composed(p) => {
            match acl_service.apply_and_verify_file(&record_path, &p) {
                Ok(ApplyOutcome::Confirmed) => ApplyOutcome::Confirmed,
                Ok(other) => {
                    return Err(fail(
                        InstallStep::ApplyRecordFileAcl,
                        format!("{other:?}"),
                        &owned,
                        Some(&adapter),
                        &cap,
                    ))
                }
                Err(e) => {
                    return Err(fail(
                        InstallStep::ApplyRecordFileAcl,
                        format!("{e:?}"),
                        &owned,
                        Some(&adapter),
                        &cap,
                    ))
                }
            }
        }
        other => {
            return Err(fail(
                InstallStep::ApplyRecordFileAcl,
                format!("{other:?}"),
                &owned,
                Some(&adapter),
                &cap,
            ))
        }
    };
    let _ = record_acl_outcome;

    // 12-13. The identity exists, so the service may now run. Start, stop, restart.
    if let other @ (LifecycleOutcome::Refused(_) | LifecycleOutcome::Indeterminate) =
        adapter.start(&cap)
    {
        return Err(fail(
            InstallStep::StartService,
            format!("{other:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }
    let start_state = await_state(&adapter, &cap, RunStateObservation::Running);
    if start_state != RunStateObservation::Running {
        return Err(fail(
            InstallStep::StartService,
            format!("{start_state:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }

    if let other @ (LifecycleOutcome::Refused(_) | LifecycleOutcome::Indeterminate) =
        adapter.stop(&cap)
    {
        return Err(fail(
            InstallStep::StopService,
            format!("{other:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }
    let stop_state = await_state(&adapter, &cap, RunStateObservation::Stopped);
    if stop_state != RunStateObservation::Stopped {
        return Err(fail(
            InstallStep::StopService,
            format!("{stop_state:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }

    if let other @ (LifecycleOutcome::Refused(_) | LifecycleOutcome::Indeterminate) =
        adapter.start(&cap)
    {
        return Err(fail(
            InstallStep::RestartService,
            format!("{other:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }
    let restart_state = await_state(&adapter, &cap, RunStateObservation::Running);
    if restart_state != RunStateObservation::Running {
        return Err(fail(
            InstallStep::RestartService,
            format!("{restart_state:?}"),
            &owned,
            Some(&adapter),
            &cap,
        ));
    }

    Ok(InstallationOutcome {
        service_name: EXPECTED_SERVICE_NAME,
        account,
        binary_path,
        record_path,
        installation_id: installation_id.as_str().to_string(),
        release_manifest_digest: manifest.digest_hex().to_string(),
        record_digest,
        sid_policy,
        acl_outcome,
        start_state,
        stop_state,
        restart_state,
    })
}

/// The refusal a caller sees if it asks to install without approval. Kept so the effect module and the
/// planner speak the same refusal vocabulary.
#[must_use]
pub fn refusal_without_approval() -> PlanRefusal {
    PlanRefusal::ElevationAbsent
}

// ---------------------------------------------------------------------------------------------
// NARROW ACL REPAIR for an EXISTING installation.
//
// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A (post-freeze installer correction).
//
// The same policy `install_once` now applies at step 11b, applied to an installation that predates
// that step. It is the ONLY thing this operation does: it creates nothing, deletes nothing, starts
// nothing, configures nothing, and never opens the record for writing. The record's bytes and digest
// are read and verified BEFORE and AFTER, so a repair that altered them would be reported, not hidden.
// ---------------------------------------------------------------------------------------------

/// The exact phrase the owner must transcribe to authorise ONE record-file ACL repair.
pub const RECORD_ACL_REPAIR_PHRASE: &str =
    "APPROVED: repair the ProjectOSHost identity record file ACL";

/// What the repair did. Every variant is terminal; nothing is retried and no policy is broadened.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RecordAclRepairOutcome {
    /// The approved policy is now in force and was authoritatively re-read from Windows.
    Repaired,
    /// The approved policy was already in force. Nothing was changed.
    AlreadyConforming,
    /// Refused before any effect. The descriptor was NOT changed.
    Refused(String),
    /// The descriptor was changed but does not conform. Reported, never retried or broadened.
    ReconciliationRequired(String),
}

/// Repair the canonical identity record file's ACL on an EXISTING installation.
///
/// # Errors
/// Never returns `Err`: every refusal is a closed [`RecordAclRepairOutcome`] variant so a caller
/// cannot mistake a refusal for success by ignoring an error type.
#[must_use]
pub fn repair_installed_record_file_acl(approval_phrase: &str) -> RecordAclRepairOutcome {
    if approval_phrase != RECORD_ACL_REPAIR_PHRASE {
        return RecordAclRepairOutcome::Refused("the approval phrase did not match exactly".into());
    }

    let Ok(state_anchor) = writer::ResolvedProgramDataAnchor::resolve_approved() else {
        return RecordAclRepairOutcome::Refused("the approved state anchor did not resolve".into());
    };
    let Ok(target) = writer::InstallerTarget::under_resolved_anchor(&state_anchor) else {
        return RecordAclRepairOutcome::Refused("the installer target did not resolve".into());
    };
    let record_path = without_extended_length_prefix(&target.record_location());

    // The record must already exist, parse and verify. A repair never creates or fixes a record.
    let Ok(before_bytes) = std::fs::read(&record_path) else {
        return RecordAclRepairOutcome::Refused("no canonical record is installed".into());
    };
    let Ok(before) = writer::parse_canonical_json(&before_bytes) else {
        return RecordAclRepairOutcome::Refused("the installed record does not parse".into());
    };
    if verify_record(&before, RecordInstallationEvidence::Matched).is_err() {
        return RecordAclRepairOutcome::Refused("the installed record does not verify".into());
    }

    let account = approved_account();
    let Ok(service_sid) = resolve_account_sid(&account) else {
        return RecordAclRepairOutcome::Refused("the service principal did not resolve".into());
    };
    let identity = ServiceIdentityPlan::analysed()
        .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
    let Ok(principal) = ApprovedServicePrincipal::from_resolved_sid(
        ServiceIdentityStrategy::VirtualServiceAccount,
        service_sid,
    ) else {
        return RecordAclRepairOutcome::Refused("the service principal was not approved".into());
    };
    let AclCompositionOutcome::Composed(policy) = AclCompositionPlan::production()
        .compose_record_file_with_resolved_principal(&identity, &principal)
    else {
        return RecordAclRepairOutcome::Refused("the record file policy did not compose".into());
    };

    let service = WindowsAclPolicyService::new();
    // Already in force? Then there is nothing to do and no effect is performed at all.
    if let Ok(v) = service.verify_file(&record_path, &policy) {
        if v.is_conforming() {
            return RecordAclRepairOutcome::AlreadyConforming;
        }
    }

    let outcome = match service.apply_and_verify_file(&record_path, &policy) {
        Ok(o) => o,
        Err(e) => return RecordAclRepairOutcome::Refused(format!("{e:?}")),
    };

    // The CONTENTS must be untouched. This is checked after the effect, not assumed.
    match std::fs::read(&record_path) {
        Ok(after) if after == before_bytes => {}
        _ => {
            return RecordAclRepairOutcome::ReconciliationRequired(
                "the record bytes changed during ACL repair".into(),
            )
        }
    }

    match outcome {
        ApplyOutcome::Confirmed => RecordAclRepairOutcome::Repaired,
        other => RecordAclRepairOutcome::ReconciliationRequired(format!("{other:?}")),
    }
}

// ---------------------------------------------------------------------------------------------
// BOUNDED STATE-ROOT DIRECTORY ACL REPAIR for an EXISTING installation.
//
// RUN-TO-COMPLETION HOST ATTESTATION §10G-PREP.
//
// An installation that predates the SYSTEM-ownership correction carries the accepted DACL on its
// three state-root directories but the wrong NTFS owner. This reapplies the SAME accepted production
// policy `install_once` applies at step 9, to the SAME three levels, in the SAME deepest-first order,
// through the SAME `WindowsAclPolicyService::apply_and_verify`. It is the ONLY thing this operation
// does: it creates nothing, deletes nothing, starts nothing, configures nothing, opens no file, and
// never addresses anything beneath or beside the three levels.
//
// WHAT IT ESTABLISHES, AND WHAT IT DOES NOT. SYSTEM ownership removes the SERVICE'S OWNERSHIP as an
// implicit source of authority, so the reviewed DACL becomes the complete statement of what the
// service may do. It takes NOTHING away from the service's explicit `FullControl` ACE, which still
// grants `WRITE_DAC`, `WRITE_OWNER`, `DELETE` and `FILE_DELETE_CHILD` on these directories. The
// anti-rollback property it supports is against ORDINARY NON-PRIVILEGED LOCAL ACCOUNTS; it is not a
// claim against ProjectOSHost itself, Administrators, SYSTEM, a kernel compromise, or offline disk
// modification.
// ---------------------------------------------------------------------------------------------

/// The exact phrase the owner must transcribe to authorise ONE state-root directory ACL repair.
///
/// A human confirmation guard, compared byte for byte. It is not a secret and not a cryptographic
/// authority token: it proves only that the caller typed the published sentence.
pub const STATE_ROOT_ACL_REPAIR_PHRASE: &str =
    "APPROVED: repair the ProjectOSHost state root directory ACLs";

/// One of the three ProjectOS-managed state-root directories. A closed semantic name, so an outcome
/// reports WHICH level without carrying a path a caller could mistake for authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateRootLevel {
    /// `<ProgramData>\ProjectOS\host\installation`.
    Installation,
    /// `<ProgramData>\ProjectOS\host`.
    Host,
    /// `<ProgramData>\ProjectOS`.
    ProjectOs,
}

impl StateRootLevel {
    /// The ONLY order the repair visits the levels: DEEPEST FIRST, exactly as `install_once` applies
    /// them. The accepted policy's ACEs are non-inheritable, so securing a parent first could leave
    /// the repairing token without the access it needs on a child it has not reached yet.
    pub const REPAIR_ORDER: [Self; 3] = [Self::Installation, Self::Host, Self::ProjectOs];
}

/// Why the repair refused. Each variant is PROVEN to precede every effect of the invocation that
/// returned it; a refusal that follows an effect is reported as reconciliation instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StateRootRepairRefusal {
    /// The approval phrase did not match exactly.
    PhraseMismatch,
    /// The approved ProgramData anchor did not resolve.
    AnchorUnresolved,
    /// The three levels could not be derived from the resolved anchor.
    TargetNotDerivable,
    /// `NT SERVICE\ProjectOSHost` did not resolve to a SID.
    ServicePrincipalUnresolved,
    /// The resolved SID was not accepted as the approved service principal.
    ServicePrincipalNotApproved,
    /// The accepted production policy did not compose.
    PolicyNotComposed,
    /// A fresh derivation of the three levels no longer matches the one being repaired.
    TargetChanged { level: StateRootLevel },
    /// The level is missing, not a directory, a reparse point, or does not live where its path says.
    TargetIdentityUnconfirmed { level: StateRootLevel },
    /// The level's descriptor could not be read, so its conformance is unknown.
    TargetUnverifiable {
        level: StateRootLevel,
        class: AclPolicyError,
    },
}

/// Why a repair needs a human to reconcile the state root. Nothing here is retried, broadened or
/// rolled back.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum StateRootReconciliationDetail {
    /// The failed level was refused BEFORE its own effect, so ITS descriptor was not written — but
    /// every level in `repaired` was.
    RefusedBeforeLevelEffect(StateRootRepairRefusal),
    /// `apply_and_verify` returned an error. Its error classes do not separate a refusal before
    /// `SetSecurityInfo` from a failure during or after it, so whether this level's descriptor
    /// changed CANNOT BE PROVEN and it is never reported as a refusal.
    EffectOutcomeUnknown(AclPolicyError),
    /// Applied, authoritatively re-read, and it does not conform.
    NonConformingAfterApply(Vec<AclViolation>),
    /// `apply_and_verify` returned an outcome this crate does not recognise.
    EffectOutcomeUnrecognised,
    /// Every attempted level confirmed, but the final read of this level does not conform.
    FinalConfirmationNonConforming(Vec<AclViolation>),
    /// Every attempted level confirmed, but the final read of this level failed.
    FinalConfirmationUnreadable(AclPolicyError),
}

/// What the repair did. Every variant is terminal.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum StateRootAclRepairOutcome {
    /// Every level now conforms, confirmed by an authoritative re-read. `repaired` lists the levels
    /// whose descriptor this invocation wrote, deepest first; any other level already conformed and
    /// was not written.
    Repaired { repaired: Vec<StateRootLevel> },
    /// All three levels already conformed. No descriptor was written.
    AlreadyConforming,
    /// Refused before ANY effect. No descriptor was written.
    Refused(StateRootRepairRefusal),
    /// The state root needs reconciliation. `repaired` WERE written and confirmed; `failed` is the
    /// level the repair stopped at (see `detail` for whether it was written); `not_attempted` are
    /// non-conforming levels never submitted. Any level in none of the three already conformed.
    ReconciliationRequired {
        repaired: Vec<StateRootLevel>,
        failed: StateRootLevel,
        not_attempted: Vec<StateRootLevel>,
        detail: StateRootReconciliationDetail,
    },
}

/// The three level paths, derived ONLY from a resolved anchor through the sealed installer target —
/// the same derivation `install_once` performs.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StateRootLevels {
    installation: PathBuf,
    host: PathBuf,
    project_os: PathBuf,
}

impl StateRootLevels {
    fn from_anchor(anchor: &writer::ResolvedProgramDataAnchor) -> Option<Self> {
        let target = writer::InstallerTarget::under_resolved_anchor(anchor).ok()?;
        let record = without_extended_length_prefix(&target.record_location());
        let installation = record.parent()?.to_path_buf();
        let host = installation.parent()?.to_path_buf();
        let project_os = host.parent()?.to_path_buf();
        Some(Self {
            installation,
            host,
            project_os,
        })
    }

    fn path(&self, level: StateRootLevel) -> &Path {
        match level {
            StateRootLevel::Installation => &self.installation,
            StateRootLevel::Host => &self.host,
            StateRootLevel::ProjectOs => &self.project_os,
        }
    }
}

/// What one read of a level found.
#[derive(Debug)]
enum LevelObservation {
    Conforming,
    NonConforming(Vec<AclViolation>),
}

/// What one application to a level produced, translated from the accepted crate's outcome.
#[derive(Debug)]
enum LevelApplication {
    Confirmed,
    NonConforming(Vec<AclViolation>),
    Unrecognised,
}

/// The two ACL operations the repair performs. Private: production implements it ONLY by delegating
/// to [`WindowsAclPolicyService`], and it exists so the ordering and classification can be proven
/// against scripted failures the real service cannot be made to produce on demand.
trait StateRootAcl {
    fn observe_level(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<LevelObservation, AclPolicyError>;
    fn apply_level(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<LevelApplication, AclPolicyError>;
}

impl StateRootAcl for WindowsAclPolicyService {
    fn observe_level(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<LevelObservation, AclPolicyError> {
        let verification = self.verify_directory(path, policy)?;
        Ok(if verification.is_conforming() {
            LevelObservation::Conforming
        } else {
            LevelObservation::NonConforming(verification.violations().to_vec())
        })
    }

    fn apply_level(
        &self,
        path: &Path,
        policy: &AclPolicy,
    ) -> Result<LevelApplication, AclPolicyError> {
        Ok(
            match WindowsAclPolicyService::apply_and_verify(self, path, policy)? {
                ApplyOutcome::Confirmed => LevelApplication::Confirmed,
                ApplyOutcome::ReconciliationRequired(v) => {
                    LevelApplication::NonConforming(v.violations().to_vec())
                }
                // Non-exhaustive: an outcome not recognised here is never read as success.
                _ => LevelApplication::Unrecognised,
            },
        )
    }
}

/// A failure BEFORE a level's own effect: a refusal only while nothing has been written yet.
fn refused_before_level_effect(
    repaired: Vec<StateRootLevel>,
    failed: StateRootLevel,
    not_attempted: Vec<StateRootLevel>,
    refusal: StateRootRepairRefusal,
) -> StateRootAclRepairOutcome {
    if repaired.is_empty() {
        return StateRootAclRepairOutcome::Refused(refusal);
    }
    StateRootAclRepairOutcome::ReconciliationRequired {
        repaired,
        failed,
        not_attempted,
        detail: StateRootReconciliationDetail::RefusedBeforeLevelEffect(refusal),
    }
}

/// The repair sequence: confirm and read all three levels, write only the non-conforming ones
/// deepest first, stop at the first failure, then read all three again.
fn repair_state_root_levels(
    levels: &StateRootLevels,
    policy: &AclPolicy,
    acl: &impl StateRootAcl,
    revalidate: &dyn Fn(StateRootLevel) -> Result<(), StateRootRepairRefusal>,
) -> StateRootAclRepairOutcome {
    // 1. VERIFY FIRST. Every level's identity is confirmed and its descriptor read before any effect.
    let mut pending = Vec::new();
    for level in StateRootLevel::REPAIR_ORDER {
        if let Err(refusal) = revalidate(level) {
            return StateRootAclRepairOutcome::Refused(refusal);
        }
        match acl.observe_level(levels.path(level), policy) {
            Ok(LevelObservation::Conforming) => {}
            Ok(LevelObservation::NonConforming(_)) => pending.push(level),
            Err(class) => {
                return StateRootAclRepairOutcome::Refused(
                    StateRootRepairRefusal::TargetUnverifiable { level, class },
                )
            }
        }
    }
    if pending.is_empty() {
        return StateRootAclRepairOutcome::AlreadyConforming;
    }

    // 2. THE EFFECT, deepest first, one attempt per level, stopping at the first failure.
    let mut repaired = Vec::new();
    for (index, &level) in pending.iter().enumerate() {
        let not_attempted = pending[index + 1..].to_vec();
        if let Err(refusal) = revalidate(level) {
            return refused_before_level_effect(repaired, level, not_attempted, refusal);
        }
        // ---- EFFECT BOUNDARY: from here on an error is never proof that nothing changed ----
        let detail = match acl.apply_level(levels.path(level), policy) {
            Ok(LevelApplication::Confirmed) => {
                repaired.push(level);
                continue;
            }
            Ok(LevelApplication::NonConforming(violations)) => {
                StateRootReconciliationDetail::NonConformingAfterApply(violations)
            }
            Ok(LevelApplication::Unrecognised) => {
                StateRootReconciliationDetail::EffectOutcomeUnrecognised
            }
            Err(class) => StateRootReconciliationDetail::EffectOutcomeUnknown(class),
        };
        return StateRootAclRepairOutcome::ReconciliationRequired {
            repaired,
            failed: level,
            not_attempted,
            detail,
        };
    }

    // 3. FINAL CONFIRMATION of the complete three-level end state, read-only.
    for level in StateRootLevel::REPAIR_ORDER {
        let detail = match acl.observe_level(levels.path(level), policy) {
            Ok(LevelObservation::Conforming) => continue,
            Ok(LevelObservation::NonConforming(violations)) => {
                StateRootReconciliationDetail::FinalConfirmationNonConforming(violations)
            }
            Err(class) => StateRootReconciliationDetail::FinalConfirmationUnreadable(class),
        };
        return StateRootAclRepairOutcome::ReconciliationRequired {
            repaired,
            failed: level,
            not_attempted: Vec::new(),
            detail,
        };
    }
    StateRootAclRepairOutcome::Repaired { repaired }
}

/// Whether `path` is a real directory, is not itself a reparse point, and is where Windows actually
/// finds it.
///
/// The last check is the one that matters for an ANCESTOR: a junction at `ProjectOS` leaves `host`
/// looking like an ordinary directory, but the object Windows opens for `...\ProjectOS\host` then lives
/// under another parent, so its final path no longer spells the composed one. Asking where the object
/// lives catches the redirection without asking about timing.
fn names_itself(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.is_dir() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return false;
    }
    let Ok(resolved) = path.canonicalize() else {
        return false;
    };
    // Unicode case folding: a redirection always changes an ANCESTOR's text, so folding cannot hide
    // one, and ASCII-only folding would refuse a legitimate non-ASCII spelling.
    without_extended_length_prefix(&resolved)
        .to_string_lossy()
        .to_lowercase()
        == path.to_string_lossy().to_lowercase()
}

/// Confirm that `level` is still the level being repaired: a fresh derivation matches the one being
/// repaired, and the directory names itself.
fn confirm_level(
    derived: &StateRootLevels,
    fresh: &StateRootLevels,
    level: StateRootLevel,
) -> Result<(), StateRootRepairRefusal> {
    if fresh != derived {
        return Err(StateRootRepairRefusal::TargetChanged { level });
    }
    if names_itself(derived.path(level)) {
        Ok(())
    } else {
        Err(StateRootRepairRefusal::TargetIdentityUnconfirmed { level })
    }
}

/// The production revalidation: resolve the approved anchor AGAIN, derive the levels AGAIN, and
/// confirm the level against both.
fn revalidate_production_level(
    derived: &StateRootLevels,
    level: StateRootLevel,
) -> Result<(), StateRootRepairRefusal> {
    let anchor = writer::ResolvedProgramDataAnchor::resolve_approved()
        .map_err(|_| StateRootRepairRefusal::AnchorUnresolved)?;
    let fresh =
        StateRootLevels::from_anchor(&anchor).ok_or(StateRootRepairRefusal::TargetNotDerivable)?;
    confirm_level(derived, &fresh, level)
}

/// The accepted production DIRECTORY policy for a resolved service SID — composed, never restated.
fn compose_state_root_policy_for(
    service_sid: OwnedSid,
) -> Result<AclPolicy, StateRootRepairRefusal> {
    let identity = ServiceIdentityPlan::analysed()
        .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
    let principal = ApprovedServicePrincipal::from_resolved_sid(
        ServiceIdentityStrategy::VirtualServiceAccount,
        service_sid,
    )
    .map_err(|_| StateRootRepairRefusal::ServicePrincipalNotApproved)?;
    match AclCompositionPlan::production().compose_with_resolved_principal(&identity, &principal) {
        AclCompositionOutcome::Composed(policy) if !policy.grants_broad_write() => Ok(policy),
        _ => Err(StateRootRepairRefusal::PolicyNotComposed),
    }
}

/// The accepted production DIRECTORY policy for the LIVE service SID, resolved through the approved
/// Windows lookup from the frozen service name.
fn compose_state_root_policy() -> Result<AclPolicy, StateRootRepairRefusal> {
    let service_sid = resolve_account_sid(&approved_account())
        .map_err(|_| StateRootRepairRefusal::ServicePrincipalUnresolved)?;
    compose_state_root_policy_for(service_sid)
}

/// The exact-match phrase gate. Nothing is resolved, read or written before it passes.
fn state_root_phrase_gate(approval_phrase: &str) -> Result<(), StateRootRepairRefusal> {
    if approval_phrase == STATE_ROOT_ACL_REPAIR_PHRASE {
        Ok(())
    } else {
        Err(StateRootRepairRefusal::PhraseMismatch)
    }
}

/// Repair the three state-root directory ACLs of an EXISTING installation.
///
/// Takes ONLY the approval phrase. The levels come from the approved ProgramData anchor, the service
/// SID from `NT SERVICE\ProjectOSHost` through the approved lookup, and the policy from
/// `AclCompositionPlan::production()`; a caller chooses none of them, nor their order.
///
/// # Errors
/// Never returns `Err`: every result is a closed [`StateRootAclRepairOutcome`] so a caller cannot
/// mistake a refusal or a partial repair for success by ignoring an error type.
#[must_use]
pub fn repair_installed_state_root_acl(approval_phrase: &str) -> StateRootAclRepairOutcome {
    if let Err(refusal) = state_root_phrase_gate(approval_phrase) {
        return StateRootAclRepairOutcome::Refused(refusal);
    }
    let Ok(anchor) = writer::ResolvedProgramDataAnchor::resolve_approved() else {
        return StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::AnchorUnresolved);
    };
    let Some(levels) = StateRootLevels::from_anchor(&anchor) else {
        return StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::TargetNotDerivable);
    };
    let policy = match compose_state_root_policy() {
        Ok(policy) => policy,
        Err(refusal) => return StateRootAclRepairOutcome::Refused(refusal),
    };
    repair_state_root_levels(
        &levels,
        &policy,
        &WindowsAclPolicyService::new(),
        &|level| revalidate_production_level(&levels, level),
    )
}

#[cfg(test)]
mod state_root_repair_tests {
    //! NOTHING HERE CALLS `repair_installed_state_root_acl` WITH THE CORRECT PHRASE. That is the live
    //! repair of the real ProgramData state root, reachable only from the ignored live harness. Every
    //! effect below lands on a disposable directory under `%TEMP%` or on a scripted fake.

    use super::StateRootLevel::{Host, Installation, ProjectOs};
    use super::*;
    use projectos_host_windows_acl_policy::{AclPrincipal, RightsClass};
    use std::cell::RefCell;

    const ALL: [StateRootLevel; 3] = StateRootLevel::REPAIR_ORDER;

    /// Every `AclPolicyError` variant at `65f8563`, plus the two §10G-PRIV privilege classes. The enum
    /// is `#[non_exhaustive]`, so the compiler cannot enforce this list: a variant added to
    /// `windows-acl-policy/src/error.rs` MUST be added here too, or
    /// `no_error_after_the_effect_boundary_is_ever_a_refusal` stops being exhaustive.
    const EVERY_ACL_ERROR: [AclPolicyError; 18] = [
        AclPolicyError::UnsupportedPlatform,
        AclPolicyError::EmptyPath,
        AclPolicyError::RelativePath,
        AclPolicyError::UnsupportedNamespace,
        AclPolicyError::NotFound,
        AclPolicyError::NotADirectory,
        AclPolicyError::NotAFile,
        AclPolicyError::ReparsePointRefused,
        AclPolicyError::PathReplaced,
        AclPolicyError::AccessDenied,
        AclPolicyError::SecurityDescriptorUnavailable,
        AclPolicyError::MalformedDescriptor,
        AclPolicyError::InvalidSid,
        AclPolicyError::PolicyRefused,
        AclPolicyError::ReconciliationRequired,
        AclPolicyError::WindowsApiFailure,
        AclPolicyError::PrivilegeUnavailable,
        AclPolicyError::PrivilegeRestoreFailed,
    ];

    fn index(level: StateRootLevel) -> usize {
        ALL.iter().position(|l| *l == level).expect("a known level")
    }

    /// `S-1-5-80-1-1-1-1`: the NT SERVICE authority shape a virtual service account resolves to. Not
    /// broad, not well known, and not this machine's real service SID.
    fn synthetic_service_sid() -> OwnedSid {
        let mut bytes = vec![1u8, 5, 0, 0, 0, 0, 0, 5];
        for sub in [80u32, 1, 1, 1, 1] {
            bytes.extend_from_slice(&sub.to_le_bytes());
        }
        OwnedSid::from_bytes(&bytes).expect("a well-formed service SID")
    }

    fn accepted_policy() -> AclPolicy {
        compose_state_root_policy_for(synthetic_service_sid())
            .expect("the accepted policy composes")
    }

    // ---- a scripted fake, for failures the real service cannot be made to produce on demand ----

    #[derive(Clone, Copy)]
    enum Scripted {
        Confirm,
        NonConforming,
        Unrecognised,
        Fail(AclPolicyError),
    }

    struct FakeAcl {
        levels: StateRootLevels,
        policy: AclPolicy,
        conforming: RefCell<[bool; 3]>,
        apply: [Scripted; 3],
        unreadable: Option<StateRootLevel>,
        final_non_conforming: Option<StateRootLevel>,
        log: RefCell<Vec<(&'static str, StateRootLevel)>>,
    }

    impl FakeAcl {
        fn new(conforming: [bool; 3]) -> Self {
            Self {
                levels: StateRootLevels {
                    installation: PathBuf::from(r"C:\fake\ProjectOS\host\installation"),
                    host: PathBuf::from(r"C:\fake\ProjectOS\host"),
                    project_os: PathBuf::from(r"C:\fake\ProjectOS"),
                },
                policy: accepted_policy(),
                conforming: RefCell::new(conforming),
                apply: [Scripted::Confirm; 3],
                unreadable: None,
                final_non_conforming: None,
                log: RefCell::new(Vec::new()),
            }
        }

        fn level_of(&self, path: &Path) -> StateRootLevel {
            ALL.into_iter()
                .find(|l| self.levels.path(*l) == path)
                .expect("the repair addressed a path outside the three derived levels")
        }

        fn applied(&self) -> Vec<StateRootLevel> {
            self.log
                .borrow()
                .iter()
                .filter(|(kind, _)| *kind == "apply")
                .map(|(_, level)| *level)
                .collect()
        }

        fn run(
            &self,
            revalidate: &dyn Fn(StateRootLevel) -> Result<(), StateRootRepairRefusal>,
        ) -> StateRootAclRepairOutcome {
            repair_state_root_levels(&self.levels, &self.policy, self, revalidate)
        }
    }

    impl StateRootAcl for FakeAcl {
        fn observe_level(
            &self,
            path: &Path,
            policy: &AclPolicy,
        ) -> Result<LevelObservation, AclPolicyError> {
            assert_eq!(
                policy, &self.policy,
                "the repair must use exactly the composed policy"
            );
            let level = self.level_of(path);
            let after_an_effect = !self.applied().is_empty();
            self.log.borrow_mut().push(("observe", level));
            if self.unreadable == Some(level) {
                return Err(AclPolicyError::AccessDenied);
            }
            if after_an_effect && self.final_non_conforming == Some(level) {
                return Ok(LevelObservation::NonConforming(vec![
                    AclViolation::OwnerMismatch,
                ]));
            }
            Ok(if self.conforming.borrow()[index(level)] {
                LevelObservation::Conforming
            } else {
                LevelObservation::NonConforming(vec![AclViolation::OwnerMismatch])
            })
        }

        fn apply_level(
            &self,
            path: &Path,
            policy: &AclPolicy,
        ) -> Result<LevelApplication, AclPolicyError> {
            assert_eq!(
                policy, &self.policy,
                "the repair must use exactly the composed policy"
            );
            let level = self.level_of(path);
            self.log.borrow_mut().push(("apply", level));
            match self.apply[index(level)] {
                Scripted::Confirm => {
                    self.conforming.borrow_mut()[index(level)] = true;
                    Ok(LevelApplication::Confirmed)
                }
                Scripted::NonConforming => Ok(LevelApplication::NonConforming(vec![
                    AclViolation::OwnerMismatch,
                ])),
                Scripted::Unrecognised => Ok(LevelApplication::Unrecognised),
                Scripted::Fail(class) => Err(class),
            }
        }
    }

    fn always_valid(_: StateRootLevel) -> Result<(), StateRootRepairRefusal> {
        Ok(())
    }

    // ---- the phrase gate and the public surface ----

    #[test]
    fn only_the_exact_phrase_passes_the_gate() {
        let p = STATE_ROOT_ACL_REPAIR_PHRASE;
        assert_eq!(state_root_phrase_gate(p), Ok(()));
        let wrong = [
            String::new(),
            p.to_lowercase(),
            p.to_uppercase(),
            format!(" {p}"),
            format!("{p} "),
            format!("\t{p}"),
            format!("{p}\n"),
            p[..p.len() - 1].to_string(),
            format!("{p}."),
            p.replace("ACLs", "ACL"),
            p.replace(' ', "\u{a0}"),
            RECORD_ACL_REPAIR_PHRASE.to_string(),
            "APPROVED".to_string(),
        ];
        for w in &wrong {
            assert_eq!(
                state_root_phrase_gate(w),
                Err(StateRootRepairRefusal::PhraseMismatch),
                "{w:?}"
            );
            // The public route refuses AT the gate: nothing is resolved, read or written.
            assert_eq!(
                repair_installed_state_root_acl(w),
                StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::PhraseMismatch),
                "{w:?}"
            );
        }
    }

    #[test]
    fn the_public_route_takes_only_the_phrase() {
        // Compile-time proof: no path, directory, policy, SID, principal, owner, rights, order or
        // verification can be handed to the route, because its signature has room for none.
        let route: fn(&str) -> StateRootAclRepairOutcome = repair_installed_state_root_acl;
        let _ = route;
    }

    #[test]
    fn there_are_exactly_three_levels_visited_deepest_first() {
        assert_eq!(
            StateRootLevel::REPAIR_ORDER,
            [Installation, Host, ProjectOs]
        );
    }

    #[test]
    fn the_policy_is_the_accepted_production_composition_unchanged() {
        let identity = ServiceIdentityPlan::analysed()
            .with_owner_decision(ServiceIdentityStrategy::VirtualServiceAccount);
        let principal = ApprovedServicePrincipal::from_resolved_sid(
            ServiceIdentityStrategy::VirtualServiceAccount,
            synthetic_service_sid(),
        )
        .expect("the approved strategy binds");
        let AclCompositionOutcome::Composed(accepted) =
            AclCompositionPlan::production().compose_with_resolved_principal(&identity, &principal)
        else {
            panic!("the accepted production policy must compose");
        };
        let policy = accepted_policy();
        assert_eq!(
            policy, accepted,
            "the route must not restate or alter the accepted policy"
        );

        // …and the accepted policy is the one the Gatekeeper froze: SYSTEM-owned, exactly the
        // service, Administrators and SYSTEM, each FullControl — not reduced, not broadened.
        assert_eq!(policy.expected_owner, AclPrincipal::LocalSystem);
        assert_eq!(policy.allowed.len(), 3);
        for principal in [
            AclPrincipal::ExplicitSid(synthetic_service_sid()),
            AclPrincipal::BuiltinAdministrators,
            AclPrincipal::LocalSystem,
        ] {
            let entry = policy
                .allowed
                .iter()
                .find(|a| a.principal == principal)
                .unwrap_or_else(|| panic!("{principal:?} is present"));
            assert_eq!(entry.rights, RightsClass::FullControl);
        }
        assert!(policy.require_protected_dacl);
        assert!(!policy.allow_inherited_aces);
        assert!(!policy.allow_unknown_principals);
        assert!(!policy.allow_deny_aces);
        assert!(!policy.allow_broad_principals_any_access);
        assert!(!policy.allow_broad_principals_write);
        assert!(!policy.grants_broad_write());
    }

    #[test]
    fn the_route_states_no_policy_and_uses_only_the_accepted_mechanisms() {
        let source = include_str!("effect.rs");
        let start = source
            .find("pub const STATE_ROOT_ACL_REPAIR_PHRASE")
            .expect("the route is present");
        let end = source
            .find("mod state_root_repair_tests {")
            .expect("the tests follow the route");
        let route: String = source[start..end]
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for stated in [
            "AclPolicy::strict(",
            "AllowedPrincipal {",
            "RightsClass::",
            "AclPrincipal::",
            "expected_owner",
        ] {
            assert!(!route.contains(stated), "the route states policy: {stated}");
        }
        for effect in [
            "fs::write",
            "OpenOptions",
            "remove_",
            "create_dir",
            "rename",
            "set_permissions",
            "Command",
            "SetSecurityInfo",
            "apply_directory_policy",
            "apply_file_policy",
            "apply_and_verify_file",
            "sleep",
            "loop",
        ] {
            assert!(
                !route.contains(effect),
                "the route performs another effect: {effect}"
            );
        }
        for required in [
            "AclCompositionPlan::production().compose_with_resolved_principal(&identity, &principal)",
            "resolve_account_sid(&approved_account())",
            "WindowsAclPolicyService::apply_and_verify(self, path, policy)",
            "self.verify_directory(path, policy)",
            "writer::InstallerTarget::under_resolved_anchor(anchor)",
        ] {
            assert!(route.contains(required), "the route bypasses: {required}");
        }
        assert_eq!(
            route.matches("apply_and_verify(").count(),
            1,
            "exactly one ACL effect call site"
        );
        assert_eq!(
            route.matches("resolve_approved()").count(),
            2,
            "the anchor is resolved by the entry point and again by each revalidation, nowhere else"
        );
    }

    // ---- ordering, classification and partial progress, against the scripted fake ----

    #[test]
    fn a_fully_conforming_state_root_is_left_untouched() {
        let fake = FakeAcl::new([true; 3]);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::AlreadyConforming
        );
        assert!(
            fake.applied().is_empty(),
            "AlreadyConforming performs no effect"
        );
        assert_eq!(fake.log.borrow().len(), 3, "exactly one read per level");
    }

    #[test]
    fn every_non_conforming_level_is_repaired_deepest_first_then_confirmed() {
        let fake = FakeAcl::new([false; 3]);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::Repaired {
                repaired: ALL.to_vec()
            }
        );
        let expected: Vec<(&str, StateRootLevel)> = ALL
            .iter()
            .map(|l| ("observe", *l))
            .chain(ALL.iter().map(|l| ("apply", *l)))
            .chain(ALL.iter().map(|l| ("observe", *l)))
            .collect();
        assert_eq!(*fake.log.borrow(), expected);
    }

    #[test]
    fn a_conforming_level_is_never_rewritten() {
        let fake = FakeAcl::new([true, false, true]);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::Repaired {
                repaired: vec![Host]
            }
        );
        assert_eq!(fake.applied(), vec![Host]);
    }

    #[test]
    fn a_failure_stops_later_levels_and_reports_partial_progress() {
        let mut fake = FakeAcl::new([false; 3]);
        fake.apply[index(Host)] = Scripted::Fail(AclPolicyError::WindowsApiFailure);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::ReconciliationRequired {
                repaired: vec![Installation],
                failed: Host,
                not_attempted: vec![ProjectOs],
                detail: StateRootReconciliationDetail::EffectOutcomeUnknown(
                    AclPolicyError::WindowsApiFailure
                ),
            }
        );
        // One attempt at the failed level (no retry), nothing after it, and no second write to the
        // level already repaired (no rollback).
        assert_eq!(fake.applied(), vec![Installation, Host]);
    }

    #[test]
    fn no_error_after_the_effect_boundary_is_ever_a_refusal() {
        // Including the classes that LOOK pre-effect: `apply_and_verify` can return every one of them
        // after `SetSecurityInfo` too, so none of them proves nothing changed.
        for class in EVERY_ACL_ERROR {
            let mut fake = FakeAcl::new([false; 3]);
            fake.apply[index(Installation)] = Scripted::Fail(class);
            assert_eq!(
                fake.run(&always_valid),
                StateRootAclRepairOutcome::ReconciliationRequired {
                    repaired: Vec::new(),
                    failed: Installation,
                    not_attempted: vec![Host, ProjectOs],
                    detail: StateRootReconciliationDetail::EffectOutcomeUnknown(class),
                },
                "{class:?}"
            );
            assert_eq!(fake.applied(), vec![Installation], "{class:?}");
        }
    }

    #[test]
    fn an_unrecognised_apply_outcome_is_reconciliation_never_success() {
        let mut fake = FakeAcl::new([false; 3]);
        fake.apply[index(Host)] = Scripted::Unrecognised;
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::ReconciliationRequired {
                repaired: vec![Installation],
                failed: Host,
                not_attempted: vec![ProjectOs],
                detail: StateRootReconciliationDetail::EffectOutcomeUnrecognised,
            }
        );
        assert_eq!(fake.applied(), vec![Installation, Host]);
    }

    #[test]
    fn a_non_conforming_re_read_is_reconciliation() {
        let mut fake = FakeAcl::new([false; 3]);
        fake.apply[index(Installation)] = Scripted::NonConforming;
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::ReconciliationRequired {
                repaired: Vec::new(),
                failed: Installation,
                not_attempted: vec![Host, ProjectOs],
                detail: StateRootReconciliationDetail::NonConformingAfterApply(vec![
                    AclViolation::OwnerMismatch
                ]),
            }
        );
    }

    #[test]
    fn an_unreadable_level_refuses_before_any_effect() {
        let mut fake = FakeAcl::new([false; 3]);
        fake.unreadable = Some(ProjectOs);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::TargetUnverifiable {
                level: ProjectOs,
                class: AclPolicyError::AccessDenied,
            })
        );
        assert!(fake.applied().is_empty());
    }

    #[test]
    fn a_level_that_fails_revalidation_up_front_refuses_before_any_effect() {
        let fake = FakeAcl::new([false; 3]);
        let outcome = fake.run(&|level| {
            if level == Host {
                Err(StateRootRepairRefusal::TargetIdentityUnconfirmed { level })
            } else {
                Ok(())
            }
        });
        assert_eq!(
            outcome,
            StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::TargetIdentityUnconfirmed {
                level: Host
            })
        );
        assert!(fake.applied().is_empty());
    }

    /// A revalidation that passes the up-front check for every level and fails `level`'s SECOND
    /// check — the one immediately before its effect.
    fn fails_second_check_of(
        level: StateRootLevel,
    ) -> impl Fn(StateRootLevel) -> Result<(), StateRootRepairRefusal> {
        let calls = RefCell::new([0u32; 3]);
        move |checked| {
            let mut calls = calls.borrow_mut();
            calls[index(checked)] += 1;
            if checked == level && calls[index(checked)] == 2 {
                Err(StateRootRepairRefusal::TargetChanged { level: checked })
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn a_revalidation_failure_after_an_effect_is_reconciliation_not_refusal() {
        let fake = FakeAcl::new([false; 3]);
        assert_eq!(
            fake.run(&fails_second_check_of(Host)),
            StateRootAclRepairOutcome::ReconciliationRequired {
                repaired: vec![Installation],
                failed: Host,
                not_attempted: vec![ProjectOs],
                detail: StateRootReconciliationDetail::RefusedBeforeLevelEffect(
                    StateRootRepairRefusal::TargetChanged { level: Host }
                ),
            }
        );
        assert_eq!(fake.applied(), vec![Installation]);
    }

    #[test]
    fn a_revalidation_failure_before_the_first_effect_is_still_a_refusal() {
        let fake = FakeAcl::new([false; 3]);
        assert_eq!(
            fake.run(&fails_second_check_of(Installation)),
            StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::TargetChanged {
                level: Installation
            })
        );
        assert!(fake.applied().is_empty());
    }

    #[test]
    fn a_final_confirmation_failure_is_reconciliation() {
        let mut fake = FakeAcl::new([false, true, true]);
        fake.final_non_conforming = Some(ProjectOs);
        assert_eq!(
            fake.run(&always_valid),
            StateRootAclRepairOutcome::ReconciliationRequired {
                repaired: vec![Installation],
                failed: ProjectOs,
                not_attempted: Vec::new(),
                detail: StateRootReconciliationDetail::FinalConfirmationNonConforming(vec![
                    AclViolation::OwnerMismatch
                ]),
            }
        );
    }

    // ---- the real ACL service, on DISPOSABLE directories only ----

    /// A disposable directory under `%TEMP%`, removed on drop.
    struct Disposable(PathBuf);

    impl Disposable {
        fn new(tag: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!(
                "projectos-state-root-repair-{tag}-{}-{n}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("a disposable root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Disposable {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The real service, counting every application it is asked to make. Used only by the
    /// fixture-gated disposable tests, so it is gated with them.
    #[cfg(feature = "fixture-composition")]
    struct Counting {
        inner: WindowsAclPolicyService,
        applied: RefCell<Vec<PathBuf>>,
    }

    #[cfg(feature = "fixture-composition")]
    impl Counting {
        fn new() -> Self {
            Self {
                inner: WindowsAclPolicyService::new(),
                applied: RefCell::new(Vec::new()),
            }
        }
    }

    #[cfg(feature = "fixture-composition")]
    impl StateRootAcl for Counting {
        fn observe_level(
            &self,
            path: &Path,
            policy: &AclPolicy,
        ) -> Result<LevelObservation, AclPolicyError> {
            self.inner.observe_level(path, policy)
        }

        fn apply_level(
            &self,
            path: &Path,
            policy: &AclPolicy,
        ) -> Result<LevelApplication, AclPolicyError> {
            self.applied.borrow_mut().push(path.to_path_buf());
            self.inner.apply_level(path, policy)
        }
    }

    #[test]
    fn only_a_real_directory_that_lives_where_it_is_named_names_itself() {
        let root = Disposable::new("names");
        let canonical = without_extended_length_prefix(&root.path().canonicalize().unwrap());
        std::fs::create_dir(canonical.join("sub")).unwrap();
        std::fs::write(canonical.join("file"), b"x").unwrap();
        assert!(names_itself(&canonical.join("sub")));
        assert!(!names_itself(&canonical.join("missing")), "absent");
        assert!(!names_itself(&canonical.join("file")), "not a directory");
        assert!(
            !names_itself(&canonical.join("sub").join("..").join("sub")),
            "a different spelling of the object is not the composed path"
        );
    }

    #[cfg(feature = "fixture-composition")]
    mod disposable {
        use super::*;
        use projectos_host_windows_acl_policy::AllowedPrincipal;

        /// A disposable tree whose three levels are derived exactly as production derives them, from
        /// an anchor, through the sealed installer target.
        fn tree(tag: &str) -> (Disposable, StateRootLevels) {
            let root = Disposable::new(tag);
            let anchor = writer::ResolvedProgramDataAnchor::fixture(root.path()).unwrap();
            let levels = StateRootLevels::from_anchor(&anchor).unwrap();
            std::fs::create_dir_all(&levels.installation).unwrap();
            (root, levels)
        }

        /// The production revalidation with the Known Folder swapped for the disposable anchor.
        fn revalidation<'a>(
            root: &'a Path,
            levels: &'a StateRootLevels,
        ) -> impl Fn(StateRootLevel) -> Result<(), StateRootRepairRefusal> + 'a {
            move |level| {
                let anchor = writer::ResolvedProgramDataAnchor::fixture(root)
                    .map_err(|_| StateRootRepairRefusal::AnchorUnresolved)?;
                let fresh = StateRootLevels::from_anchor(&anchor)
                    .ok_or(StateRootRepairRefusal::TargetNotDerivable)?;
                confirm_level(levels, &fresh, level)
            }
        }

        /// TEST-ONLY policy owned by the test's own account, so an unprivileged run can apply it and
        /// clean up. The ACCEPTED policy is exercised by the reconciliation test below.
        fn fixture_policy() -> AclPolicy {
            AclPolicy::strict(
                AclPrincipal::CurrentInteractiveUser,
                vec![
                    AllowedPrincipal {
                        principal: AclPrincipal::CurrentInteractiveUser,
                        rights: RightsClass::FullControl,
                    },
                    AllowedPrincipal {
                        principal: AclPrincipal::LocalSystem,
                        rights: RightsClass::FullControl,
                    },
                    AllowedPrincipal {
                        principal: AclPrincipal::BuiltinAdministrators,
                        rights: RightsClass::FullControl,
                    },
                ],
            )
        }

        #[test]
        fn the_levels_derive_only_from_the_anchor_through_the_installer_target() {
            let root = Disposable::new("derive");
            let anchor = writer::ResolvedProgramDataAnchor::fixture(root.path()).unwrap();
            let levels = StateRootLevels::from_anchor(&anchor).unwrap();
            let canonical = without_extended_length_prefix(&root.path().canonicalize().unwrap());
            assert_eq!(levels.project_os, canonical.join("ProjectOS"));
            assert_eq!(levels.host, levels.project_os.join("host"));
            assert_eq!(levels.installation, levels.host.join("installation"));
            let record = without_extended_length_prefix(
                &writer::InstallerTarget::under_resolved_anchor(&anchor)
                    .unwrap()
                    .record_location(),
            );
            assert_eq!(record.parent(), Some(levels.installation.as_path()));
            for level in ALL {
                assert!(
                    !levels.path(level).to_string_lossy().starts_with(r"\\?\"),
                    "the ACL service refuses the extended-length namespace"
                );
            }
        }

        #[test]
        fn a_disposable_tree_is_repaired_deepest_first_and_then_idempotent() {
            let (root, levels) = tree("repair");
            let policy = fixture_policy();
            let service = WindowsAclPolicyService::new();

            // A record-like canary beneath `installation`, carrying its OWN protected DACL exactly as
            // the installed identity record does.
            let canary = levels.installation.join("canary.json");
            std::fs::write(&canary, b"{\"canary\":true}").unwrap();
            assert_eq!(
                service.apply_and_verify_file(&canary, &policy),
                Ok(ApplyOutcome::Confirmed)
            );
            let canary_descriptor = service.inspect_file(&canary).unwrap();

            for level in ALL {
                assert!(
                    matches!(
                        service.observe_level(levels.path(level), &policy),
                        Ok(LevelObservation::NonConforming(_))
                    ),
                    "the disposable {level:?} must start non-conforming"
                );
            }

            let revalidate = revalidation(root.path(), &levels);
            let acl = Counting::new();
            assert_eq!(
                repair_state_root_levels(&levels, &policy, &acl, &revalidate),
                StateRootAclRepairOutcome::Repaired {
                    repaired: ALL.to_vec()
                }
            );
            let deepest_first: Vec<PathBuf> =
                ALL.iter().map(|l| levels.path(*l).to_path_buf()).collect();
            assert_eq!(*acl.applied.borrow(), deepest_first);

            // Only descriptors of the three levels changed: the file beneath keeps its bytes AND its
            // own descriptor.
            assert_eq!(std::fs::read(&canary).unwrap(), b"{\"canary\":true}");
            assert_eq!(service.inspect_file(&canary).unwrap(), canary_descriptor);

            // Idempotent: a second run finds the policy in force and performs no effect at all.
            let again = Counting::new();
            assert_eq!(
                repair_state_root_levels(&levels, &policy, &again, &revalidate),
                StateRootAclRepairOutcome::AlreadyConforming
            );
            assert!(again.applied.borrow().is_empty());
        }

        #[test]
        fn a_real_effect_failure_is_reconciliation_required_even_when_nothing_changed() {
            // The ACCEPTED policy (SYSTEM-owned) against a disposable tree. Since §10G-PRIV the accepted
            // crate enables SeRestorePrivilege around its one ownership write, so a token that HOLDS
            // it repairs; one that does not is refused `PrivilegeUnavailable` before any write, as an
            // `Err`. Nothing changes, and the outcome must STILL be reconciliation: to this route that
            // error is indistinguishable from one raised after an effect.
            let (root, levels) = tree("uncertain");
            let policy = accepted_policy();
            let service = WindowsAclPolicyService::new();
            let before: Vec<_> = ALL
                .iter()
                .map(|l| service.inspect_directory(levels.path(*l)).unwrap())
                .collect();

            let revalidate = revalidation(root.path(), &levels);
            let acl = Counting::new();
            let outcome = repair_state_root_levels(&levels, &policy, &acl, &revalidate);
            println!("ACCEPTED POLICY ON A DISPOSABLE TREE: {outcome:?}");
            match outcome {
                // A token that MAY assign SYSTEM as owner completes the repair.
                StateRootAclRepairOutcome::Repaired { repaired } => {
                    assert_eq!(repaired, ALL.to_vec());
                }
                StateRootAclRepairOutcome::ReconciliationRequired {
                    repaired,
                    failed,
                    not_attempted,
                    detail,
                } => {
                    assert!(repaired.is_empty());
                    assert_eq!(failed, Installation);
                    assert_eq!(not_attempted, vec![Host, ProjectOs]);
                    assert!(
                        matches!(
                            detail,
                            StateRootReconciliationDetail::EffectOutcomeUnknown(_)
                        ),
                        "{detail:?}"
                    );
                    assert_eq!(acl.applied.borrow().len(), 1, "one attempt, no retry");
                    let after: Vec<_> = ALL
                        .iter()
                        .map(|l| service.inspect_directory(levels.path(*l)).unwrap())
                        .collect();
                    assert_eq!(after, before, "the failed attempt changed nothing");
                }
                other => {
                    panic!("an error inside apply_and_verify must never be a refusal: {other:?}")
                }
            }
        }

        #[test]
        fn a_junctioned_ancestor_is_refused_before_any_effect() {
            let root = Disposable::new("junction");
            let canonical = without_extended_length_prefix(&root.path().canonicalize().unwrap());
            let elsewhere = canonical.join("elsewhere");
            std::fs::create_dir_all(elsewhere.join("host").join("installation")).unwrap();
            let anchor_dir = canonical.join("anchor");
            std::fs::create_dir(&anchor_dir).unwrap();
            // A junction needs no privilege, so any local account can plant one.
            let made = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(anchor_dir.join("ProjectOS"))
                .arg(&elsewhere)
                .output()
                .expect("cmd runs");
            assert!(made.status.success(), "the junction fixture was created");

            let anchor = writer::ResolvedProgramDataAnchor::fixture(&anchor_dir).unwrap();
            let levels = StateRootLevels::from_anchor(&anchor).unwrap();
            // Every level is refused — `ProjectOS` because it IS the junction, the two beneath it
            // because they no longer live where their paths say.
            for level in ALL {
                assert_eq!(
                    confirm_level(&levels, &levels, level),
                    Err(StateRootRepairRefusal::TargetIdentityUnconfirmed { level })
                );
            }
            let acl = Counting::new();
            assert_eq!(
                repair_state_root_levels(
                    &levels,
                    &fixture_policy(),
                    &acl,
                    &revalidation(&anchor_dir, &levels)
                ),
                StateRootAclRepairOutcome::Refused(
                    StateRootRepairRefusal::TargetIdentityUnconfirmed {
                        level: Installation
                    }
                )
            );
            assert!(acl.applied.borrow().is_empty());
        }
    }
}
