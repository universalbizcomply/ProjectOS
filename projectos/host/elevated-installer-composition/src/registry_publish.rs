//! THE ELEVATED PUBLICATION OF THE INSTALLED-PROJECT REGISTRY.
//!
//! `projectos install --target <path> --id <slug>` validates a project and PLANS a registration. It
//! runs as the owner, unelevated, and it cannot publish: the installation directory grants only
//! `NT SERVICE\ProjectOSHost`, `BUILTIN\Administrators` and `NT AUTHORITY\SYSTEM`, and gives ordinary
//! users nothing. This module is the other half — the one operation that may put the planned bytes
//! at the one canonical location.
//!
//! ## What makes it narrow
//!
//! * ONE owner-transcribed approval phrase, exactly as the record-ACL repair beside it requires. No
//!   silent elevation, and no boolean anywhere in the production API that could assert approval.
//! * An actual token-elevation check, so an unelevated attempt is REFUSED before any effect rather
//!   than failing halfway through a write.
//! * NO destination parameter. The path is derived from the approved ProgramData anchor through the
//!   frozen installer target, so there is nothing for a caller, a WebView, an environment variable,
//!   a working directory, a repository, argv or the registry payload itself to redirect.
//! * The caller's VALIDATION IS NOT TRUSTED. The whole registration is recomputed here, from the
//!   registry actually on disk and the repository actually on disk. The caller contributes a proposed
//!   entry and a digest of what it expected the result to be; the digest is used only to REFUSE a
//!   stale plan, never to skip a check.
//! * It creates no service, starts nothing, deletes nothing, and writes nowhere else.
//!
//! ## What it does not claim
//!
//! It does not resist a local administrator. Administrators and SYSTEM remain privileged exactly as
//! Windows defines. The registry is protected machine-local CONFIGURATION, not a signed artefact,
//! and nothing here may describe it as signed.
//!
//! Created in PROJECTOS-PHASE6-SECTION-C.

use projectos_host_windows_acl_policy::{AclPolicy, AclPrincipal, AllowedPrincipal, RightsClass};
use projectos_project_registry::{RegisteredProjectV1, RegistrationRefusal};

// The publication machinery itself. Imported only where it is compiled, so a default build links no
// anchor resolver, no ACL service, no replacement primitive and no digest.
#[cfg(all(windows, feature = "registry-publish-effect"))]
use projectos_host_canonical_installation_identity_writer as writer;
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
use projectos_host_windows_acl_policy::{ApplyOutcome, WindowsAclPolicyService};
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
use projectos_project_registry::{
    plan_registration, validate_registry_bytes, RealRegistryFacts, RegistrationPlan,
    REGISTRY_FILE_NAME,
};
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
use sha2::{Digest, Sha256};
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
use std::path::Path;

/// The exact phrase the owner must transcribe to authorise ONE registry publication.
pub const REGISTRY_PUBLISH_PHRASE: &str =
    "APPROVED: publish the ProjectOS installed-project registry";

/// What the unelevated planner produced.
///
/// The digest is of the canonical bytes the planner computed. It is a STALENESS DETECTOR and nothing
/// else: this module recomputes the bytes itself and refuses if they differ, so a registry that
/// changed between planning and publication cannot be silently overwritten with a plan made against
/// an older one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedRegistration {
    /// The project the planner proposes to register.
    pub proposed: RegisteredProjectV1,
    /// Lower-case hex SHA-256 of the canonical registry bytes the planner computed.
    pub planned_digest: String,
}

/// What the publication did. Every variant is terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RegistryPublishOutcome {
    /// No registry existed; one was created with the approved descriptor.
    Created,
    /// A registry existed and its CONTENTS were replaced. Its descriptor and object identity were
    /// preserved by the replacement primitive and re-verified afterwards.
    Replaced,
    /// The project was already registered and the bytes are already current. Nothing was written.
    AlreadyCurrent,
}

/// Why a publication was refused. Every variant leaves any previous valid registry usable.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RegistryPublishRefusal {
    /// The approval phrase did not match exactly. Nothing was read or written.
    ApprovalPhraseMismatch,
    /// The calling process is not elevated — or could not prove that it is, which is the same answer.
    NotElevated,
    /// The approved ProgramData anchor, or the installer target beneath it, did not resolve.
    DestinationUnresolved,
    /// The installation directory is absent, is a reparse point, or could not be inspected. It is
    /// NOT created here: authority over a file comes from its own descriptor AND from the directory
    /// that holds it, and a directory this operation created would carry whatever ACL it inherited.
    DirectoryUnusable,
    /// The existing registry could not be read, which is not the same as there not being one.
    ExistingRegistryUnreadable,
    /// The destination changed between being read and being replaced. Another publication won the
    /// race; this one refuses rather than discarding its result.
    DestinationChangedUnderneath,
    /// The elevated revalidation refused the registration. Carries the registry crate's own reason.
    RevalidationRefused(RegistrationRefusal),
    /// The bytes this operation computed differ from the ones the planner expected. The registry, or
    /// the repository, changed after the plan was made.
    PlanStale,
    /// The composed descriptor policy would itself grant broad write access. Refused before effect.
    PolicyRefused,
    /// The temporary file could not be written or made durable.
    WriteFailed,
    /// The descriptor could not be applied to the new file.
    DaclApplicationFailed,
    /// The replacement did not happen. The previous registry is untouched.
    ReplaceFailed,
    /// The published bytes are not the intended ones, or no longer validate.
    VerifyBytesFailed,
    /// The published file's descriptor does not conform. Reported, never retried or broadened.
    DaclNotConfirmed,
    /// The publication succeeded but temporary residue could not be removed. Reported, never
    /// converted into success.
    CleanupFailed,
}

/// The approved descriptor for the registry file.
///
/// SYSTEM and Administrators hold full control; `BUILTIN\Users` holds READ and nothing more, because
/// the Control Centre reads this file while running as an ordinary user. `allow_broad_principals_write`
/// stays FALSE, so the policy cannot be widened into a writable one without changing this function —
/// and a policy that granted broad write is refused before any effect by `grants_broad_write`.
///
/// Inheritance is protected: this file's authority may not be widened or narrowed by a later change
/// to a parent directory.
#[must_use]
pub fn registry_file_policy(expected_owner: AclPrincipal) -> AclPolicy {
    let mut policy = AclPolicy::strict(
        expected_owner,
        vec![
            AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::BuiltinAdministrators,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::BuiltinUsers,
                rights: RightsClass::Read,
            },
        ],
    );
    // The ONE deliberate relaxation, and the narrowest one available: a broad principal may hold
    // access at all. Write-like access for a broad principal stays forbidden, which is what keeps the
    // grant a read grant.
    policy.allow_broad_principals_any_access = true;
    policy
}

/// The PRODUCTION descriptor: owned by Administrators.
#[cfg(all(windows, feature = "registry-publish-effect"))]
fn production_policy() -> AclPolicy {
    registry_file_policy(AclPrincipal::BuiltinAdministrators)
}

#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
fn digest_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Strip the Windows extended-length `\\?\` prefix. The ACL service refuses that namespace, and the
/// prefix is a canonicalisation artefact rather than part of the frozen path contract.
#[cfg(all(windows, feature = "registry-publish-effect"))]
fn plain(path: &std::path::Path) -> std::path::PathBuf {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\")
        .map_or_else(|| path.to_path_buf(), std::path::PathBuf::from)
}

/// THE canonical destination: `<ProgramData>\ProjectOS\host\installation\projects.v1.json`.
///
/// Derived from the approved anchor through the frozen installer target, so the directory is the same
/// one the two existing installation records live in and the file name comes from the registry
/// contract. There is no parameter here, and no caller-supplied component anywhere in it.
///
/// # Errors
/// [`RegistryPublishRefusal::DestinationUnresolved`].
#[cfg(all(windows, feature = "registry-publish-effect"))]
pub fn production_destination() -> Result<std::path::PathBuf, RegistryPublishRefusal> {
    let anchor = writer::ResolvedProgramDataAnchor::resolve_approved()
        .map_err(|_| RegistryPublishRefusal::DestinationUnresolved)?;
    let target = writer::InstallerTarget::under_resolved_anchor(&anchor)
        .map_err(|_| RegistryPublishRefusal::DestinationUnresolved)?;
    // The record location names `identity.v1.json`; the registry is its sibling. Taking the parent
    // rather than re-deriving the directory keeps ONE path vocabulary: if the installation
    // subdirectory ever moved, both files would move together.
    let directory = plain(&target.record_location())
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or(RegistryPublishRefusal::DestinationUnresolved)?;
    Ok(directory.join(REGISTRY_FILE_NAME))
}

/// Publish ONE owner-approved registration into the canonical registry.
///
/// # Errors
/// [`RegistryPublishRefusal`] naming the first failure. Any previous valid registry is left usable.
#[cfg(all(windows, feature = "registry-publish-effect"))]
pub fn publish_project_registry(
    approval_phrase: &str,
    plan: &PlannedRegistration,
) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
    // 1. OWNER APPROVAL. Nothing below is reachable without it.
    if approval_phrase != REGISTRY_PUBLISH_PHRASE {
        return Err(RegistryPublishRefusal::ApprovalPhraseMismatch);
    }
    // 2. ELEVATION, established from the process token — never asserted by a caller. An unanswerable
    //    question counts as NOT elevated.
    if !matches!(
        projectos_host_protected_file_primitives::is_process_elevated(),
        Ok(true)
    ) {
        return Err(RegistryPublishRefusal::NotElevated);
    }
    let destination = production_destination()?;
    let policy = production_policy();
    // The SAME policy is applied and verified. The two are separate parameters below only so a
    // fixture can force a verification failure and prove the rollback; production has one policy and
    // passes it twice, so there is no route by which the thing applied and the thing checked could
    // ever differ in a shipped build.
    publish_into(&destination, &policy, &policy, plan)
}

#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
/// The shared publication sequence. Production supplies the derived destination and the production
/// policy; a fixture supplies a disposable root and a fixture-owner policy. Everything that decides
/// whether a publication is legitimate happens HERE, so the two callers cannot diverge on any of it.
fn publish_into(
    destination: &Path,
    policy: &AclPolicy,
    verify_policy: &AclPolicy,
    plan: &PlannedRegistration,
) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
    // 3. A policy that would itself grant broad write is refused BEFORE any effect: applying it would
    //    be the very defect verification exists to detect.
    if policy.grants_broad_write() {
        return Err(RegistryPublishRefusal::PolicyRefused);
    }
    let directory = destination
        .parent()
        .ok_or(RegistryPublishRefusal::DestinationUnresolved)?;
    // 4. The DIRECTORY is a write boundary too, and this operation does not create one.
    //
    // On NTFS the authority to delete or replace a file comes from EITHER the file's own descriptor
    // OR `FILE_DELETE_CHILD` on its parent. Hardening only the file would leave that second door
    // unexamined — and `create_dir_all` would have opened it: a directory materialised here inherits
    // whatever ProgramData grants, so on a machine where the installation directory was absent the
    // registry would land under an inherited descriptor while every check below still passed. The
    // directory is the installer's to create; if it is not already there, this refuses.
    let directory_meta = std::fs::symlink_metadata(directory)
        .map_err(|_| RegistryPublishRefusal::DirectoryUnusable)?;
    if !directory_meta.is_dir() || directory_meta.file_type().is_symlink() {
        return Err(RegistryPublishRefusal::DirectoryUnusable);
    }

    // 5. Read the registry that is ACTUALLY there. The caller's copy of it is never used, and an
    //    unreadable registry is distinguished from an absent one — collapsing them would route a
    //    permission problem into the create-a-new-registry branch.
    let existing = match std::fs::read(destination) {
        Ok(bytes) => Some(bytes),
        Err(_) if destination.symlink_metadata().is_ok() => {
            return Err(RegistryPublishRefusal::ExistingRegistryUnreadable)
        }
        Err(_) => None,
    };

    // 5. INDEPENDENT REVALIDATION. The whole registration is recomputed from the registry on disk and
    //    the repository on disk — schema, existing entries, project id, canonical root, `.git`,
    //    project configuration, the id binding, duplicate ids and roots, environment policy and the
    //    production-frozen union. Nothing the unelevated caller checked is taken on trust.
    let recomputed = plan_registration(existing.as_deref(), &plan.proposed, &RealRegistryFacts)
        .map_err(RegistryPublishRefusal::RevalidationRefused)?;
    let intended = match recomputed {
        RegistrationPlan::AlreadyRegistered => return Ok(RegistryPublishOutcome::AlreadyCurrent),
        RegistrationPlan::Register(bytes) => bytes,
    };

    // 6. STALENESS. The planner's digest must describe the bytes this operation just computed. A
    //    difference means the registry or a repository changed after the plan was made, and a plan
    //    made against an older world is not authority to overwrite the newer one.
    if digest_hex(&intended) != plan.planned_digest {
        return Err(RegistryPublishRefusal::PlanStale);
    }

    // 7. Write the new bytes to a SIBLING temporary. The destination is never opened for writing, so
    //    every failure from here on leaves the previous registry byte-for-byte intact.
    // A staging name unique to THIS invocation. A fixed name is a file two concurrent publishers
    // both believe they own: the second one's `remove_file` would delete the first one's staged bytes
    // between its write and its publish.
    let temporary = directory.join(format!(
        "{REGISTRY_FILE_NAME}.publishing.{}",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&temporary);
    write_durably(&temporary, &intended).map_err(|()| {
        // Residue is removed on EVERY failure path, including this one. A partially written staging
        // file left in a protected directory is not harmless just because the next run would clear it.
        let _ = std::fs::remove_file(&temporary);
        RegistryPublishRefusal::WriteFailed
    })?;

    let service = WindowsAclPolicyService::new();
    let created = existing.is_none();
    let published = if created {
        // 8a. FIRST PUBLICATION. The descriptor is applied to the temporary and confirmed BEFORE the
        //     file becomes reachable at the canonical name, so the registry is never briefly present
        //     under an inherited descriptor. `hard_link` gives the same file object a second name and
        //     fails if that name exists, so a registry that appeared meanwhile is never replaced.
        match service.apply_and_verify_file(&temporary, policy) {
            Ok(ApplyOutcome::Confirmed) => {}
            Ok(_) | Err(_) => {
                let _ = std::fs::remove_file(&temporary);
                return Err(RegistryPublishRefusal::DaclApplicationFailed);
            }
        }
        std::fs::hard_link(&temporary, destination)
            .map(|()| RegistryPublishOutcome::Created)
            .map_err(|_| RegistryPublishRefusal::ReplaceFailed)
    } else {
        // 8b. REPLACEMENT. `ReplaceFileW`, not a rename: it swaps the CONTENTS and preserves the
        //     destination's own security descriptor and object identity. A rename would put the
        //     temporary's descriptor in place instead, silently discarding the very protection this
        //     operation exists to maintain.
        // LAST-MOMENT RE-READ. `PlanStale` compares against the registry as it was when this
        // operation read it; between that read and this swap another elevated publication could have
        // landed, and replacing now would silently discard its entry. Two publishers that both read
        // the same registry cannot both win here — the second one refuses.
        match std::fs::read(destination) {
            Ok(now) if Some(&now) == existing.as_ref() => {}
            _ => {
                let _ = std::fs::remove_file(&temporary);
                return Err(RegistryPublishRefusal::DestinationChangedUnderneath);
            }
        }
        projectos_host_protected_file_primitives::replace_file(destination, &temporary)
            .map(|()| RegistryPublishOutcome::Replaced)
            .map_err(|_| RegistryPublishRefusal::ReplaceFailed)
    };
    let outcome = match published {
        Ok(outcome) => outcome,
        Err(refusal) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(refusal);
        }
    };

    // 9-10. VERIFY BEFORE REPORTING SUCCESS — the final path, not the temporary, re-read from disk,
    //       then the DESCRIPTOR authoritatively re-read from Windows. Owner, protected inheritance,
    //       SYSTEM, Administrators, Builtin Users read-only and the absence of any other or broader
    //       ACE are all decided by the policy this verifies against.
    //
    // FAILURE HERE UNDOES A FRESH CREATE. On the created path there was no previous registry, so the
    // safe state is the one this operation started from: absent. Leaving an unverified file at the
    // canonical, protected location while returning a refusal would mean a caller told "this did not
    // happen" and a machine where it partly did.
    let verified = verify_publication(destination, verify_policy, &intended, plan, &service);
    if let Err(refusal) = verified {
        let _ = std::fs::remove_file(&temporary);
        if created {
            let _ = std::fs::remove_file(destination);
        }
        return Err(refusal);
    }

    // 11. Residue. A cleanup failure is reported, never converted into success — but the registry IS
    //     published and verified at this point, and the refusal says only that a staging name could
    //     not be removed.
    if created {
        std::fs::remove_file(&temporary).map_err(|_| RegistryPublishRefusal::CleanupFailed)?;
    }
    Ok(outcome)
}

/// The four checks that stand between a completed write and a reported success. Extracted so every
/// one of them shares the same failure handling above, rather than each `return` having to remember
/// to clean up after itself.
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
fn verify_publication(
    destination: &Path,
    policy: &AclPolicy,
    intended: &[u8],
    plan: &PlannedRegistration,
    service: &WindowsAclPolicyService,
) -> Result<(), RegistryPublishRefusal> {
    let actual =
        std::fs::read(destination).map_err(|_| RegistryPublishRefusal::VerifyBytesFailed)?;
    if actual != intended || digest_hex(&actual) != plan.planned_digest {
        return Err(RegistryPublishRefusal::VerifyBytesFailed);
    }
    if validate_registry_bytes(&actual, &RealRegistryFacts).is_err() {
        return Err(RegistryPublishRefusal::VerifyBytesFailed);
    }
    match service.verify_file(destination, policy) {
        Ok(v) if v.is_conforming() => Ok(()),
        _ => Err(RegistryPublishRefusal::DaclNotConfirmed),
    }
}

/// Write bytes to a new file, flush and `sync_all` before closing.
#[cfg(all(
    windows,
    any(feature = "registry-publish-effect", feature = "fixture-composition")
))]
fn write_durably(path: &Path, bytes: &[u8]) -> Result<(), ()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| ())?;
    file.write_all(bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all())
        .map_err(|_| ())
}

/// FIXTURE-ONLY publication into a disposable directory the caller already owns.
///
/// Gated on `fixture-composition`, which never ships, so a release graph has no route to a
/// caller-supplied destination at all. It exists because the production sequence cannot be exercised
/// without an elevated process and a real installation, and a sequence nothing exercises is a
/// sequence nobody has checked.
///
/// The fixture differs from production in exactly two ways, both stated rather than hidden: the
/// destination is the supplied disposable one, and the expected OWNER is the calling account rather
/// than Administrators, because setting Administrators as owner is itself an elevated act. Every
/// granted ACE — SYSTEM, Administrators, Builtin Users read — is identical.
#[cfg(all(windows, feature = "fixture-composition"))]
pub mod fixture {
    use super::{
        publish_into, registry_file_policy, PlannedRegistration, RegistryPublishOutcome,
        RegistryPublishRefusal, REGISTRY_PUBLISH_PHRASE,
    };
    use projectos_host_windows_acl_policy::{AclPolicy, AclPrincipal};
    use std::path::Path;

    /// The fixture descriptor: the same grants, owned by the calling account.
    #[must_use]
    pub fn fixture_policy() -> AclPolicy {
        registry_file_policy(AclPrincipal::CurrentInteractiveUser)
    }

    /// Publish into an owned root, with elevation supplied rather than observed.
    ///
    /// # Errors
    /// [`RegistryPublishRefusal`] naming the first failure.
    pub fn publish_into_owned_root(
        destination: &Path,
        elevated: bool,
        approval_phrase: &str,
        plan: &PlannedRegistration,
    ) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
        // The same two gates production applies, in the same order, so a fixture cannot pass through
        // a door production would have closed.
        if approval_phrase != REGISTRY_PUBLISH_PHRASE {
            return Err(RegistryPublishRefusal::ApprovalPhraseMismatch);
        }
        if !elevated {
            return Err(RegistryPublishRefusal::NotElevated);
        }
        publish_into(destination, &fixture_policy(), &fixture_policy(), plan)
    }

    /// FIXTURE-ONLY: apply one policy and verify against another, so the post-publication rollback
    /// can be forced. Production has a single policy and cannot reach this shape.
    ///
    /// # Errors
    /// [`RegistryPublishRefusal`] naming the first failure.
    pub fn publish_with_divergent_verification(
        destination: &Path,
        apply: &AclPolicy,
        verify: &AclPolicy,
        plan: &PlannedRegistration,
    ) -> Result<RegistryPublishOutcome, RegistryPublishRefusal> {
        publish_into(destination, apply, verify, plan)
    }
}

#[cfg(all(windows, test, feature = "fixture-composition"))]
mod tests;
