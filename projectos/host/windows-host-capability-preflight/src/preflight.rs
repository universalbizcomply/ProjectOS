//! Capability classification and the single preflight decision.
//!
//! The central discipline here: **API presence is not runtime proof.** Anything whose truth can only
//! be established by performing the very operation under consideration is classified
//! [`CapabilityStatus::DeferredUntilApprovedEffect`], never `ProvenSupported`. That is why this phase
//! cannot conclude "ready for installation".

use crate::error::PreflightViolation;
use crate::host::{WindowsClientProfile, WindowsEditionClass};
use crate::service_name::{ServiceNameAvailability, ServiceNameValidation};

/// How well a capability is established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CapabilityStatus {
    /// Established by direct read-only observation.
    ProvenSupported,
    /// Established, by direct observation, to be unavailable.
    ProvenUnsupported,
    /// The evidence is inconclusive. NEVER promoted to supported.
    Indeterminate,
    /// Provable only by performing a separately approved system effect.
    DeferredUntilApprovedEffect,
    /// Does not apply to this host or phase.
    NotApplicable,
}

/// The capabilities this preflight reports on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum CapabilityKind {
    /// Supported Windows client baseline.
    SupportedWindowsBaseline,
    /// OS version APIs available.
    VersionApisAvailable,
    /// Read-only SCM access available.
    ScmReadOnlyAccess,
    /// Service enumeration available.
    ServiceEnumeration,
    /// The selected candidate name is unused.
    CandidateNameUnused,
    /// The service-installation APIs exist on this platform.
    ServiceInstallationApisPresent,
    /// The virtual-service-account strategy is structurally compatible with the plan.
    VirtualAccountStructurallyCompatible,
    /// The virtual account actually works at runtime on this host.
    VirtualAccountRuntimeSupport,
    /// The authoritative per-service SID can be resolved.
    ServiceSidResolution,
    /// The final production ACL can be composed.
    FinalAclComposition,
    /// The service can be installed.
    ServiceInstallation,
    /// The service can be started.
    ServiceStartup,
    /// The production root can be created.
    ProgramDataCreation,
    /// The production ACL can be applied.
    ProductionAclApplication,
}

impl CapabilityKind {
    /// Every capability reported, in a stable order.
    #[must_use]
    pub fn all() -> &'static [CapabilityKind] {
        use CapabilityKind as K;
        &[
            K::SupportedWindowsBaseline,
            K::VersionApisAvailable,
            K::ScmReadOnlyAccess,
            K::ServiceEnumeration,
            K::CandidateNameUnused,
            K::ServiceInstallationApisPresent,
            K::VirtualAccountStructurallyCompatible,
            K::VirtualAccountRuntimeSupport,
            K::ServiceSidResolution,
            K::FinalAclComposition,
            K::ServiceInstallation,
            K::ServiceStartup,
            K::ProgramDataCreation,
            K::ProductionAclApplication,
        ]
    }

    /// Whether this capability can ONLY be proven by performing a gated system effect.
    ///
    /// These may never be reported as `ProvenSupported` by a preflight, however encouraging the
    /// read-only evidence looks.
    #[must_use]
    pub fn requires_approved_effect_to_prove(self) -> bool {
        use CapabilityKind as K;
        matches!(
            self,
            K::VirtualAccountRuntimeSupport
                | K::ServiceSidResolution
                | K::FinalAclComposition
                | K::ServiceInstallation
                | K::ServiceStartup
                | K::ProgramDataCreation
                | K::ProductionAclApplication
        )
    }
}

/// One capability and how it was established. The note is a fixed semantic string — never a path,
/// name, handle or Windows error message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityEvidence {
    /// Which capability.
    pub kind: CapabilityKind,
    /// Its status.
    pub status: CapabilityStatus,
    /// Why, in fixed semantic terms.
    pub note: &'static str,
}

/// What the preflight concluded. There is deliberately no `ReadyForInstallation`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PreflightDecision {
    /// A valid owner service-name decision has been recorded. This is authority-only and
    /// effect-free: no installation is authorised, no effect is ready, and the next gate is
    /// contract/commit review — NOT another owner-name decision.
    OwnerServiceNameDecisionRecorded,
    /// No owner decision is recorded yet; the owner may now choose a service name. NOT production
    /// readiness and NOT installation approval.
    ReadyForOwnerServiceNameDecision,
    /// The host baseline is not met.
    BlockedByHostCapability,
    /// The host facts could not be established.
    IndeterminateHostCapability,
    /// Every candidate collided with an existing service.
    ServiceNameCollision,
    /// Read-only inspection was unavailable, so nothing could be concluded.
    ReadOnlyInspectionUnavailable,
    /// Evidence conflicts and must be reconciled before proceeding.
    ReconciliationRequired,
}

/// Whether a valid owner service-name decision has been recorded for this preflight.
///
/// Constructed only from a [`crate::ServiceNameDecision`] that is genuinely owner-approved, so the
/// effect-free `OwnerServiceNameDecisionRecorded` outcome cannot be reached without one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum OwnerDecisionOverlay {
    /// No owner decision recorded — the effective state still requests one.
    OwnerDecisionRequired,
    /// A valid owner decision naming the recommended service is recorded.
    OwnerServiceNameDecisionRecorded,
}

/// The complete, redacted preflight result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostCapabilityReport {
    profile: WindowsClientProfile,
    capabilities: Vec<CapabilityEvidence>,
    validations: Vec<ServiceNameValidation>,
    services_inspected: usize,
    namespace_known: bool,
    owner_decision: OwnerDecisionOverlay,
    decision: PreflightDecision,
}

impl HostCapabilityReport {
    /// Assemble the report and derive the single decision.
    #[must_use]
    pub fn new(
        profile: WindowsClientProfile,
        capabilities: Vec<CapabilityEvidence>,
        validations: Vec<ServiceNameValidation>,
        services_inspected: usize,
        namespace_known: bool,
        owner_decision: OwnerDecisionOverlay,
    ) -> Self {
        let decision = derive_decision(&profile, &validations, namespace_known, owner_decision);
        Self {
            profile,
            capabilities,
            validations,
            services_inspected,
            namespace_known,
            owner_decision,
            decision,
        }
    }

    /// The effective owner-decision overlay (frozen 3K-D requirement vs recorded 3K-E decision).
    #[must_use]
    pub fn owner_decision(&self) -> OwnerDecisionOverlay {
        self.owner_decision
    }

    /// The semantic host profile.
    #[must_use]
    pub fn profile(&self) -> WindowsClientProfile {
        self.profile
    }

    /// Every capability row.
    #[must_use]
    pub fn capabilities(&self) -> &[CapabilityEvidence] {
        &self.capabilities
    }

    /// The status of one capability.
    #[must_use]
    pub fn status(&self, kind: CapabilityKind) -> Option<CapabilityStatus> {
        self.capabilities
            .iter()
            .find(|c| c.kind == kind)
            .map(|c| c.status)
    }

    /// Per-candidate verdicts.
    #[must_use]
    pub fn validations(&self) -> &[ServiceNameValidation] {
        &self.validations
    }

    /// How many services were inspected. A COUNT only — the list is never exposed.
    #[must_use]
    pub fn services_inspected(&self) -> usize {
        self.services_inspected
    }

    /// Whether the service namespace could be read at all.
    #[must_use]
    pub fn namespace_known(&self) -> bool {
        self.namespace_known
    }

    /// The single decision.
    #[must_use]
    pub fn decision(&self) -> PreflightDecision {
        self.decision
    }

    /// The recommended candidate, if one is usable. A recommendation, never an approval.
    #[must_use]
    pub fn recommended(&self) -> Option<&ServiceNameValidation> {
        crate::service_name::recommend(&self.validations)
    }

    /// Semantic non-conformances in this report.
    #[must_use]
    pub fn violations(&self) -> Vec<PreflightViolation> {
        let mut found = Vec::new();
        match self.profile.edition() {
            WindowsEditionClass::Indeterminate => {
                found.push(PreflightViolation::EditionIndeterminate);
            }
            WindowsEditionClass::Unsupported => found.push(PreflightViolation::BaselineUnsupported),
            _ => {}
        }
        if !self.namespace_known {
            found.push(PreflightViolation::ReadOnlyInspectionUnavailable);
        }
        if self.recommended().is_none() {
            found.push(PreflightViolation::NoUsableServiceName);
        }
        // The honesty invariant: nothing effect-provable may claim to be proven.
        if self.capabilities.iter().any(|c| {
            c.kind.requires_approved_effect_to_prove()
                && c.status == CapabilityStatus::ProvenSupported
        }) {
            found.push(PreflightViolation::ProofRequiresApprovedEffect);
        }
        found
    }
}

/// Derive the single decision from the collected evidence.
fn derive_decision(
    profile: &WindowsClientProfile,
    validations: &[ServiceNameValidation],
    namespace_known: bool,
    owner_decision: OwnerDecisionOverlay,
) -> PreflightDecision {
    if profile.edition() == WindowsEditionClass::Indeterminate {
        return PreflightDecision::IndeterminateHostCapability;
    }
    if !profile.meets_baseline() {
        return PreflightDecision::BlockedByHostCapability;
    }
    if !namespace_known {
        return PreflightDecision::ReadOnlyInspectionUnavailable;
    }
    if validations.iter().any(ServiceNameValidation::is_usable) {
        // A usable name AND a recorded owner decision → the decision is done. Otherwise the owner
        // still has to choose. Either way this remains authority-only and effect-free.
        return match owner_decision {
            OwnerDecisionOverlay::OwnerServiceNameDecisionRecorded => {
                PreflightDecision::OwnerServiceNameDecisionRecorded
            }
            OwnerDecisionOverlay::OwnerDecisionRequired => {
                PreflightDecision::ReadyForOwnerServiceNameDecision
            }
        };
    }
    // No usable candidate. Distinguish "all taken" from "all badly shaped".
    if validations
        .iter()
        .any(|v| v.availability == ServiceNameAvailability::Collision)
    {
        PreflightDecision::ServiceNameCollision
    } else {
        PreflightDecision::ReconciliationRequired
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{HostArchitecture, VER_NT_WORKSTATION};
    use crate::service_name::{default_candidates, evaluate_candidates};

    fn home_profile() -> WindowsClientProfile {
        WindowsClientProfile::classify(
            10,
            0,
            26_200,
            VER_NT_WORKSTATION,
            Some(0x0000_0065),
            HostArchitecture::X64,
        )
    }

    fn evidence(kind: CapabilityKind, status: CapabilityStatus) -> CapabilityEvidence {
        CapabilityEvidence {
            kind,
            status,
            note: "test",
        }
    }

    #[test]
    fn effect_provable_capabilities_are_identified_exactly() {
        use CapabilityKind as K;
        for kind in [
            K::VirtualAccountRuntimeSupport,
            K::ServiceSidResolution,
            K::FinalAclComposition,
            K::ServiceInstallation,
            K::ServiceStartup,
            K::ProgramDataCreation,
            K::ProductionAclApplication,
        ] {
            assert!(kind.requires_approved_effect_to_prove(), "{kind:?}");
        }
        for kind in [
            K::SupportedWindowsBaseline,
            K::VersionApisAvailable,
            K::ScmReadOnlyAccess,
            K::ServiceEnumeration,
            K::CandidateNameUnused,
            K::ServiceInstallationApisPresent,
            K::VirtualAccountStructurallyCompatible,
        ] {
            assert!(!kind.requires_approved_effect_to_prove(), "{kind:?}");
        }
        assert_eq!(CapabilityKind::all().len(), 14);
    }

    #[test]
    fn claiming_an_effect_provable_capability_as_proven_is_a_violation() {
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            vec![evidence(
                CapabilityKind::VirtualAccountRuntimeSupport,
                CapabilityStatus::ProvenSupported,
            )],
            v,
            10,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert!(report
            .violations()
            .contains(&PreflightViolation::ProofRequiresApprovedEffect));
    }

    #[test]
    fn deferring_an_effect_provable_capability_is_conforming() {
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            vec![evidence(
                CapabilityKind::VirtualAccountRuntimeSupport,
                CapabilityStatus::DeferredUntilApprovedEffect,
            )],
            v,
            10,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert!(report.violations().is_empty(), "{:?}", report.violations());
        assert_eq!(
            report.decision(),
            PreflightDecision::ReadyForOwnerServiceNameDecision
        );
    }

    #[test]
    fn a_healthy_host_without_an_owner_decision_asks_for_one() {
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            Vec::new(),
            v,
            250,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert_eq!(
            report.decision(),
            PreflightDecision::ReadyForOwnerServiceNameDecision
        );
        assert!(report.recommended().is_some());
        assert_eq!(report.services_inspected(), 250);
    }

    #[test]
    fn a_recorded_owner_decision_yields_the_recorded_state_not_a_new_request() {
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            Vec::new(),
            v,
            250,
            true,
            OwnerDecisionOverlay::OwnerServiceNameDecisionRecorded,
        );
        assert_eq!(
            report.decision(),
            PreflightDecision::OwnerServiceNameDecisionRecorded,
            "a recorded owner decision must not re-request one"
        );
        assert_eq!(
            report.owner_decision(),
            OwnerDecisionOverlay::OwnerServiceNameDecisionRecorded
        );
        // Still authority-only and effect-free: the decision is not installation readiness.
        assert_ne!(
            report.decision(),
            PreflightDecision::ReadyForOwnerServiceNameDecision
        );
    }

    #[test]
    fn an_indeterminate_edition_blocks_before_anything_else() {
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            WindowsClientProfile::indeterminate(),
            Vec::new(),
            v,
            0,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert_eq!(
            report.decision(),
            PreflightDecision::IndeterminateHostCapability
        );
        assert!(report
            .violations()
            .contains(&PreflightViolation::EditionIndeterminate));
    }

    #[test]
    fn a_below_baseline_host_is_blocked() {
        let old = WindowsClientProfile::classify(
            6,
            1,
            7601,
            VER_NT_WORKSTATION,
            Some(0x0000_0030),
            HostArchitecture::X64,
        );
        let v = evaluate_candidates(&default_candidates(), &[], true).unwrap();
        let report = HostCapabilityReport::new(
            old,
            Vec::new(),
            v,
            0,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert_eq!(
            report.decision(),
            PreflightDecision::BlockedByHostCapability
        );
    }

    #[test]
    fn an_unreadable_namespace_yields_read_only_inspection_unavailable() {
        let v = evaluate_candidates(&default_candidates(), &[], false).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            Vec::new(),
            v,
            0,
            false,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert_eq!(
            report.decision(),
            PreflightDecision::ReadOnlyInspectionUnavailable
        );
        assert!(report
            .violations()
            .contains(&PreflightViolation::ReadOnlyInspectionUnavailable));
    }

    #[test]
    fn every_candidate_colliding_yields_service_name_collision() {
        let observed: Vec<String> = default_candidates()
            .iter()
            .map(|c| c.as_str().to_string())
            .collect();
        let v = evaluate_candidates(&default_candidates(), &observed, true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            Vec::new(),
            v,
            500,
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        assert_eq!(report.decision(), PreflightDecision::ServiceNameCollision);
        assert!(report.recommended().is_none());
    }

    #[test]
    fn the_report_never_exposes_the_service_list() {
        let observed: Vec<String> = vec!["Spooler".into(), "AudioSrv".into()];
        let v = evaluate_candidates(&default_candidates(), &observed, true).unwrap();
        let report = HostCapabilityReport::new(
            home_profile(),
            Vec::new(),
            v,
            observed.len(),
            true,
            OwnerDecisionOverlay::OwnerDecisionRequired,
        );
        let text = format!("{report:?}");
        assert!(!text.contains("Spooler"), "no third-party service name");
        assert!(!text.contains("AudioSrv"));
        assert_eq!(report.services_inspected(), 2, "only a count is exposed");
    }
}
