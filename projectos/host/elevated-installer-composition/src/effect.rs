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
    resolve_account_sid, AclPolicy, ApplyOutcome, WindowsAclPolicyService,
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
