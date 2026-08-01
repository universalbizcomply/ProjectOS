//! The READ-ONLY installation plan: what an elevated installer would do, in what order, and what it
//! must never do on failure.
//!
//! A plan is a description. Holding one authorises nothing — the only write capability in this crate is
//! [`crate::IdentityWriteAuthorisation`], which is issued separately and only after every precondition
//! passes.

use projectos_host_windows_activation_plan::activation::ActivationStep;
use projectos_host_windows_service_installation_contract::contract::PreEffectCheck;

/// The ordered installation steps.
///
/// The order is the contract. In particular [`Self::WriteAndVerifyIdentityRecord`] precedes
/// [`Self::InstallOrConfigureService`]: a service must never exist for an installation that has no
/// canonical identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PlannedStep {
    /// 1. Confirm installer elevation and take the exclusive installation operation.
    ConfirmElevationAndExclusivity,
    /// 2. Resolve and validate the approved Known Folder anchors.
    ResolveAndValidateAnchors,
    /// 3. Validate the Program Files service-binary source.
    ValidateServiceBinarySource,
    /// 4. Prepare the ProgramData directory and the root-custody plan.
    PrepareStateRootAndCustody,
    /// 5. Prepare the ACL plan.
    PrepareAclPlan,
    /// 6. Derive the sealed installer target.
    DeriveInstallerTarget,
    /// 7. Generate the installation id from the system-preferred source.
    GenerateInstallationId,
    /// 8. Write and verify the canonical identity record.
    WriteAndVerifyIdentityRecord,
    /// 9. Install or configure the service — only after identity creation succeeded.
    InstallOrConfigureService,
    /// 10. Activation/start. Never performed without a separate owner gate.
    AwaitSeparateOwnerActivationGate,
}

/// What an installer may remove if a step fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupScope {
    /// Nothing may be removed. Pre-existing or unknown content is never cleaned up.
    Nothing,
    /// Only residue this installer itself created may be removed.
    InstallerOwnedTemporaryOnly,
}

/// What must be carried forward rather than silently undone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CarryForward {
    /// Nothing was prepared, so nothing carries forward.
    None,
    /// A directory may exist and be partially prepared. It is REPORTED, never deleted: it may already
    /// hold state that predates this installer.
    PartiallyPreparedDirectory,
    /// A canonical record exists and is authoritative. It is never rewritten.
    ExistingCanonicalRecord,
}

impl PlannedStep {
    /// Every step, in contract order.
    #[must_use]
    pub fn all() -> &'static [PlannedStep] {
        &[
            Self::ConfirmElevationAndExclusivity,
            Self::ResolveAndValidateAnchors,
            Self::ValidateServiceBinarySource,
            Self::PrepareStateRootAndCustody,
            Self::PrepareAclPlan,
            Self::DeriveInstallerTarget,
            Self::GenerateInstallationId,
            Self::WriteAndVerifyIdentityRecord,
            Self::InstallOrConfigureService,
            Self::AwaitSeparateOwnerActivationGate,
        ]
    }

    /// 1-based position in the contract order.
    #[must_use]
    pub fn order(self) -> usize {
        Self::all().iter().position(|s| *s == self).expect("total") + 1
    }

    /// The step that must have succeeded first.
    #[must_use]
    pub fn prerequisite(self) -> Option<PlannedStep> {
        let i = self.order();
        if i == 1 {
            None
        } else {
            Some(Self::all()[i - 2])
        }
    }

    /// Whether this step would mutate anything outside the installer's own temporary residue.
    #[must_use]
    pub fn is_mutating(self) -> bool {
        matches!(
            self,
            Self::PrepareStateRootAndCustody
                | Self::WriteAndVerifyIdentityRecord
                | Self::InstallOrConfigureService
        )
    }

    /// Whether a failure here halts every later step. Every mutating step does: this contract has no
    /// "continue past a failed effect" path.
    #[must_use]
    pub fn failure_halts_all_later_steps(self) -> bool {
        true
    }

    /// What may be removed if this step fails.
    #[must_use]
    pub fn cleanup_scope_on_failure(self) -> CleanupScope {
        match self {
            // The writer's own temporary is the ONLY thing any step may remove.
            Self::WriteAndVerifyIdentityRecord => CleanupScope::InstallerOwnedTemporaryOnly,
            _ => CleanupScope::Nothing,
        }
    }

    /// What a failure leaves behind for a human to reconcile.
    #[must_use]
    pub fn carry_forward_on_failure(self) -> CarryForward {
        match self {
            Self::PrepareStateRootAndCustody | Self::PrepareAclPlan => {
                CarryForward::PartiallyPreparedDirectory
            }
            Self::WriteAndVerifyIdentityRecord => CarryForward::ExistingCanonicalRecord,
            _ => CarryForward::None,
        }
    }

    /// Whether an automatic retry is permitted after this step fails.
    ///
    /// Identity writing is never retried automatically: a conflict means another identity already owns
    /// this installation, and retrying with a fresh id would mint a second identity for one machine.
    #[must_use]
    pub fn automatic_retry_permitted(self) -> bool {
        !matches!(
            self,
            Self::WriteAndVerifyIdentityRecord | Self::InstallOrConfigureService
        )
    }

    /// Whether an ACL may be weakened to let this step proceed. Never.
    #[must_use]
    pub fn permits_acl_weakening(self) -> bool {
        false
    }
}

/// The composed, read-only installation plan.
///
/// Non-`Clone` and carrying no path: it describes an intent, and every effect still requires a separate
/// authorisation that this crate only issues in a fixture graph.
#[derive(Debug)]
pub struct InstallationPlan {
    channel: &'static str,
    steps: Vec<PlannedStep>,
    activation_sequence: Vec<ActivationStep>,
    pre_effect_sequence: Vec<PreEffectCheck>,
    service_name: &'static str,
    service_relative_path: &'static str,
    symbolic_record_location: String,
}

impl InstallationPlan {
    /// Constructed only once every precondition has passed, which the frozen effect authority currently
    /// never permits in a pure default graph.
    #[cfg_attr(not(feature = "fixture-composition"), allow(dead_code))]
    pub(crate) fn new(
        channel: &'static str,
        service_name: &'static str,
        service_relative_path: &'static str,
        symbolic_record_location: String,
    ) -> Self {
        Self {
            channel,
            steps: PlannedStep::all().to_vec(),
            // The frozen orderings are REUSED wholesale, not restated: this plan composes them.
            activation_sequence: ActivationStep::all().to_vec(),
            pre_effect_sequence: PreEffectCheck::sequence().to_vec(),
            service_name,
            service_relative_path,
            symbolic_record_location,
        }
    }

    /// The channel this plan was composed for. One of the three accepted values; never free text.
    #[must_use]
    pub fn channel(&self) -> &'static str {
        self.channel
    }

    /// The ordered steps.
    #[must_use]
    pub fn steps(&self) -> &[PlannedStep] {
        &self.steps
    }

    /// The frozen activation ordering this plan composes.
    #[must_use]
    pub fn activation_sequence(&self) -> &[ActivationStep] {
        &self.activation_sequence
    }

    /// The frozen service-installation pre-effect ordering this plan composes.
    #[must_use]
    pub fn pre_effect_sequence(&self) -> &[PreEffectCheck] {
        &self.pre_effect_sequence
    }

    /// The frozen service name.
    #[must_use]
    pub fn service_name(&self) -> &'static str {
        self.service_name
    }

    /// The frozen service binary, relative to the install root.
    #[must_use]
    pub fn service_relative_path(&self) -> &'static str {
        self.service_relative_path
    }

    /// The approved record location, expressed SYMBOLICALLY. No production path is rendered.
    #[must_use]
    pub fn symbolic_record_location(&self) -> &str {
        &self.symbolic_record_location
    }

    /// Whether the identity record is written before any service step. Always true by construction;
    /// exposed so the ordering can be asserted rather than assumed.
    #[must_use]
    pub fn identity_precedes_service(&self) -> bool {
        PlannedStep::WriteAndVerifyIdentityRecord.order()
            < PlannedStep::InstallOrConfigureService.order()
    }
}
