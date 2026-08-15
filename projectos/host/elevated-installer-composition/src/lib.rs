//! # THE ELEVATED-INSTALLER IDENTITY COMPOSITION BOUNDARY
//!
//! CD-B4-ELEVATED-INSTALLER-IDENTITY-COMPOSITION1A.
//!
//! This crate composes the closed canonical identity writer into the future elevated installer. It
//! evaluates the installation preconditions, derives the sealed production target from the approved
//! ProgramData anchor, and produces a READ-ONLY [`InstallationPlan`].
//!
//! ## What it does not do
//!
//! It performs no installation effect whatsoever: no Known Folder resolution, no ProgramData or Program
//! Files write, no directory creation under a production root, no ACL/registry/SCM mutation, no service
//! installation or start, no elevation request, no production RNG, and no record write outside a
//! disposable fixture root. The production entry point refuses before any write capability exists,
//! because [`InstallationEffectAuthority::current`] is `NotAuthorised` — a frozen contract value, not a
//! caller-supplied flag.
//!
//! ## Reuse, not restatement
//!
//! Every vocabulary is imported: the record schema, digest, product/service/path constants and
//! symbolic location from `host-identity`; the target, id, channel and release-digest types from the
//! writer; the activation ordering and ACL composition from `windows-host-activation-plan`; the
//! pre-effect ordering and effect authority from `windows-service-installation-contract`; root custody
//! from `windows-root-custody`. This crate defines no second path, ACL, service-name, schema, random or
//! installation-state vocabulary.
//!
//! ## No caller booleans
//!
//! No production API accepts a "was elevated" / "custody is fine" flag. Elevation comes from the frozen
//! effect-authority contract, and every other precondition is proven by a value that cannot be forged
//! from the outside.

#![forbid(unsafe_code)]

pub mod dry_run;
#[cfg(all(windows, feature = "installer-effect"))]
pub mod effect;
pub mod plan;
/// PROJECTOS-PHASE6-SECTION-C: the elevated publication of the installed-project registry. The
/// production entry point is gated on `registry-publish-effect`; the contract types, the descriptor
/// policy and the fixture route are always compiled so they can be reviewed and tested.
pub mod registry_publish;

use std::sync::atomic::{AtomicBool, Ordering};

use projectos_host_canonical_installation_identity_writer as writer;
use projectos_host_identity::canonical_record::{
    EXPECTED_SERVICE_NAME, EXPECTED_SERVICE_RELATIVE_PATH,
};
use projectos_host_windows_activation_plan::acl_plan::AclCompositionOutcome;
use projectos_host_windows_service_installation_contract::contract::InstallationEffectAuthority;

pub use plan::{CarryForward, CleanupScope, InstallationPlan, PlannedStep};
pub use writer::{InstallationChannel, ReleaseManifestDigest};

/// Why the composition refused. One variant per precondition; the FIRST failure wins, and no variant
/// can be bypassed by a caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PlanRefusal {
    /// Installer elevation / installation-effect authority is absent.
    ElevationAbsent,
    /// Another installation operation is already in progress in this process.
    InstallationAlreadyInProgress,
    /// The approved ProgramData or Program Files anchor could not be resolved.
    AnchorUnresolved,
    /// A resolved path escaped the approved roots.
    PathEscapesApprovedRoot,
    /// A boundary directory is a reparse point.
    ReparsePointBoundary,
    /// No root-custody plan is available for the state root.
    CustodyPlanUnavailable,
    /// No ACL plan is available (the owner has not decided, or the service SID does not exist).
    AclPlanUnavailable,
    /// The ACL plan is inconsistent with the approved policy — for example it grants broad write.
    AclPlanInconsistent,
    /// The service name differs from the frozen contract.
    ServiceNameMismatch,
    /// The service binary path differs from the frozen contract.
    ServiceBinaryPathMismatch,
    /// The release-manifest digest is missing or malformed.
    ReleaseDigestMissingOrMalformed,
    /// The installation channel is unsupported.
    UnsupportedChannel,
    /// A canonical record already exists and describes a different identity.
    ConflictingIdentityExists,
    /// The sealed target could not be derived from the resolved anchor.
    TargetNotDerivable,
}

/// A validated installation request. Both fields are already-parsed contract types, so a malformed
/// digest or an unsupported channel cannot reach the planner at all.
#[derive(Debug)]
pub struct InstallationRequest {
    channel: InstallationChannel,
    release: ReleaseManifestDigest,
}

impl InstallationRequest {
    /// Parse a request. This is the ONLY constructor: the strings are validated by the frozen writer
    /// contract, never by a second implementation here.
    ///
    /// # Errors
    /// [`PlanRefusal::UnsupportedChannel`] or [`PlanRefusal::ReleaseDigestMissingOrMalformed`].
    pub fn parse(channel: &str, release_manifest_digest: &str) -> Result<Self, PlanRefusal> {
        let channel =
            InstallationChannel::parse(channel).map_err(|_| PlanRefusal::UnsupportedChannel)?;
        let release = ReleaseManifestDigest::parse(release_manifest_digest)
            .map_err(|_| PlanRefusal::ReleaseDigestMissingOrMalformed)?;
        Ok(Self { channel, release })
    }

    #[must_use]
    pub fn channel(&self) -> InstallationChannel {
        self.channel
    }

    #[must_use]
    pub fn release(&self) -> &ReleaseManifestDigest {
        &self.release
    }
}

/// Process-wide exclusivity for the installation operation.
static OPERATION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// The exclusive installation operation. Move-only and released on drop, so a panic mid-plan cannot
/// leave the operation permanently claimed.
#[derive(Debug)]
pub struct ExclusiveInstallationOperation {
    _private: (),
}

impl ExclusiveInstallationOperation {
    /// Claim the operation.
    ///
    /// # Errors
    /// [`PlanRefusal::InstallationAlreadyInProgress`] if another operation holds it.
    pub fn claim() -> Result<Self, PlanRefusal> {
        OPERATION_IN_PROGRESS
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self { _private: () })
            .map_err(|_| PlanRefusal::InstallationAlreadyInProgress)
    }
}

impl Drop for ExclusiveInstallationOperation {
    fn drop(&mut self) {
        OPERATION_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

/// The frozen service facts an installer must match. Both come from the canonical record contract, so
/// a caller cannot select either one.
#[must_use]
pub fn frozen_service_name() -> &'static str {
    EXPECTED_SERVICE_NAME
}

/// The frozen service binary, relative to the install root.
#[must_use]
pub fn frozen_service_relative_path() -> &'static str {
    EXPECTED_SERVICE_RELATIVE_PATH
}

/// Compose the ACL plan from the frozen production composition, and classify the outcome.
///
/// Reachable only once the effect authority permits planning to continue, which the frozen contract
/// currently never does — hence unused in a pure default graph.
#[cfg_attr(not(feature = "fixture-composition"), allow(dead_code))]
fn evaluate_acl(outcome: &AclCompositionOutcome) -> Result<(), PlanRefusal> {
    match outcome {
        AclCompositionOutcome::OwnerDecisionRequired
        | AclCompositionOutcome::ServiceIdentityRequired => Err(PlanRefusal::AclPlanUnavailable),
        AclCompositionOutcome::Composed(policy) => {
            if policy.grants_broad_write() {
                return Err(PlanRefusal::AclPlanInconsistent);
            }
            Ok(())
        }
        // The outcome enum is non-exhaustive. An outcome this crate does not recognise is treated as
        // no usable plan at all, never as permission to continue.
        _ => Err(PlanRefusal::AclPlanUnavailable),
    }
}

/// The PRODUCTION composition entry point.
///
/// It refuses at the first precondition, every time: [`InstallationEffectAuthority::current`] is
/// `NotAuthorised`, so no installation effect is authorised and no write capability is ever issued.
/// This is the honest production reality, not a placeholder — the owner gate that would change it does
/// not exist yet.
///
/// # Errors
/// [`PlanRefusal`] naming the first failed precondition.
pub fn plan_production_installation(
    _request: &InstallationRequest,
) -> Result<InstallationPlan, PlanRefusal> {
    if !InstallationEffectAuthority::current().is_authorised() {
        return Err(PlanRefusal::ElevationAbsent);
    }
    // Unreachable while the frozen authority is NotAuthorised. Kept as the real ordering rather than
    // omitted, so the next phase extends a correct sequence instead of inventing one.
    let _operation = ExclusiveInstallationOperation::claim()?;
    Err(PlanRefusal::AnchorUnresolved)
}

/// How an anchor-resolution failure becomes a refusal.
///
/// Named rather than inlined so the mapping can be proven exhaustively: a live reparse-point directory
/// cannot be created without `SeCreateSymbolicLinkPrivilege`, so the boundary is proven here and by
/// mutation rather than by a privileged filesystem effect this phase is forbidden to perform.
#[must_use]
pub fn refusal_for_anchor(e: writer::WriteError) -> PlanRefusal {
    match e {
        writer::WriteError::ReparsePointRefused => PlanRefusal::ReparsePointBoundary,
        writer::WriteError::ContainmentRefused => PlanRefusal::PathEscapesApprovedRoot,
        _ => PlanRefusal::AnchorUnresolved,
    }
}

/// How a target-derivation failure becomes a refusal.
#[must_use]
pub fn refusal_for_target(e: writer::WriteError) -> PlanRefusal {
    match e {
        writer::WriteError::ContainmentRefused => PlanRefusal::PathEscapesApprovedRoot,
        writer::WriteError::ReparsePointRefused => PlanRefusal::ReparsePointBoundary,
        _ => PlanRefusal::TargetNotDerivable,
    }
}

/// FIXTURE-ONLY composition and execution against a disposable owned root.
///
/// Non-default. Nothing here can name, resolve or touch a production location: the anchor is the
/// caller's own disposable directory, and the id source is deterministic, so no production RNG runs.
#[cfg(feature = "fixture-composition")]
pub mod fixture {
    use super::*;
    use projectos_host_identity::canonical_record::symbolic_record_location;
    use projectos_host_windows_activation_plan::acl_plan::AclCompositionPlan;
    use projectos_host_windows_root_custody::WindowsRootCustody;
    use std::path::Path;
    use writer::{
        FixtureInstallationIdSource, InstallationId, InstallerTarget, ResolvedProgramDataAnchor,
        WriteError, WriteOutcome,
    };

    /// The observable facts a fixture installer presents. Each field stands in for a REAL check, and
    /// each can be made to fail so the refusal is proven rather than assumed.
    #[derive(Debug)]
    pub struct FixtureInstallerEvidence<'a> {
        /// The disposable root that stands in for the resolved ProgramData anchor.
        pub owned_root: &'a Path,
        /// Whether the fixture installer is elevated. FIXTURE ONLY — the production path takes this
        /// from the frozen effect-authority contract and accepts no flag.
        pub elevated: bool,
        /// Whether a root-custody plan could be established for the state root.
        pub custody_available: bool,
        /// The composed ACL outcome.
        pub acl: AclCompositionOutcome,
        /// The service name the installer intends to use.
        pub service_name: &'a str,
        /// The service binary path the installer intends to use, relative to the install root.
        pub service_relative_path: &'a str,
    }

    /// A single authorisation to write ONE identity record.
    ///
    /// Move-only, non-`Clone`, and consumed by [`Self::write`]. It is issued only after every
    /// precondition has passed, so no code path can write without having planned first.
    #[derive(Debug)]
    pub struct IdentityWriteAuthorisation {
        target: InstallerTarget,
    }

    impl IdentityWriteAuthorisation {
        /// Consume the authorisation and write the record.
        ///
        /// # Errors
        /// [`WriteError`] from the closed writer contract, unchanged.
        pub fn write(
            self,
            id: &InstallationId,
            request: &InstallationRequest,
        ) -> Result<WriteOutcome, WriteError> {
            writer::write_identity_record(&self.target, id, request.channel(), request.release())
        }

        /// The record path, for fixture verification only.
        #[must_use]
        pub fn record_path_for_test(&self) -> std::path::PathBuf {
            self.target.record_path_for_test()
        }
    }

    /// What a completed fixture composition yields: the read-only plan, and — separately — the single
    /// write authorisation. Splitting them is the point: a plan alone can never write.
    #[derive(Debug)]
    pub struct ComposedInstallation {
        pub plan: InstallationPlan,
        pub authorisation: IdentityWriteAuthorisation,
        _operation: ExclusiveInstallationOperation,
    }

    /// Evaluate every precondition against fixture evidence and, only if all pass, compose the plan and
    /// issue exactly one write authorisation.
    ///
    /// The order matches the plan's own ordering, so a refusal names the first genuinely failing step.
    ///
    /// # Errors
    /// [`PlanRefusal`] naming the first failed precondition.
    pub fn compose_fixture_installation(
        evidence: &FixtureInstallerEvidence<'_>,
        request: &InstallationRequest,
    ) -> Result<ComposedInstallation, PlanRefusal> {
        // 1. Elevation, then exclusivity.
        if !evidence.elevated {
            return Err(PlanRefusal::ElevationAbsent);
        }
        let operation = ExclusiveInstallationOperation::claim()?;

        // 2. Anchor resolution + reparse/containment checks, delegated to the writer's sealed anchor.
        let anchor =
            ResolvedProgramDataAnchor::fixture(evidence.owned_root).map_err(refusal_for_anchor)?;

        // 3. Service binary source and name must match the frozen contract exactly.
        if evidence.service_name != frozen_service_name() {
            return Err(PlanRefusal::ServiceNameMismatch);
        }
        if evidence.service_relative_path != frozen_service_relative_path() {
            return Err(PlanRefusal::ServiceBinaryPathMismatch);
        }

        // 4. Root custody. The plan REQUIRES one; a real custody handle is opened against the
        // disposable root only, never a production root.
        if !evidence.custody_available {
            return Err(PlanRefusal::CustodyPlanUnavailable);
        }
        let _custody = WindowsRootCustody::open(evidence.owned_root)
            .map_err(|_| PlanRefusal::CustodyPlanUnavailable)?;

        // 5. ACL plan.
        evaluate_acl(&evidence.acl)?;

        // 6. Derive the sealed target. Every segment comes from the frozen contract.
        let target = InstallerTarget::under_resolved_anchor(&anchor).map_err(refusal_for_target)?;

        // 7. Any existing record refuses BEFORE an authorisation is issued, so a conflict can never be
        // converted into an overwrite downstream. This is deliberately strict: the installation id is
        // not minted until a later step, so the planner cannot know that an existing record describes
        // THIS installation, and fail-closed is the only honest answer. A genuine re-run with the same
        // identity is still handled idempotently by the writer itself.
        if target.record_already_exists() {
            return Err(PlanRefusal::ConflictingIdentityExists);
        }

        Ok(ComposedInstallation {
            plan: InstallationPlan::new(
                request.channel().as_str(),
                frozen_service_name(),
                frozen_service_relative_path(),
                symbolic_record_location(),
            ),
            authorisation: IdentityWriteAuthorisation { target },
            _operation: operation,
        })
    }

    /// The deterministic fixture installation-id source. Never the production RNG.
    #[must_use]
    pub fn fixture_id(pattern: u8) -> InstallationId {
        InstallationId::generate(&FixtureInstallationIdSource([pattern; 16]))
            .expect("non-zero fixture pattern")
    }

    /// The ACL outcome a passing fixture uses: the frozen production composition, decided.
    #[must_use]
    pub fn production_acl_plan() -> AclCompositionPlan {
        AclCompositionPlan::production()
    }
}

#[cfg(all(test, feature = "fixture-composition"))]
mod tests;
