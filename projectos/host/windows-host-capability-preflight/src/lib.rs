//! # ProjectOS Host Windows Capability Preflight (read-only)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-E.
//!
//! A bounded, READ-ONLY inspection of the Windows service environment: a semantic host profile,
//! collision checking for bounded ProjectOS service-name candidates, and an honest classification of
//! which activation prerequisites are proven, unsupported, indeterminate, or provable only by a
//! separately approved system effect.
//!
//! ## The accurate claim
//!
//! ProjectOS can **preflight the Windows service environment read-only, validate candidate service
//! names, and classify activation prerequisites**.
//!
//! ## What this crate does NOT claim
//!
//! It does NOT claim a virtual service account was created, that VirtualServiceAccount runtime
//! behaviour was proven, that a service SID was resolved, that a service was installed, configured
//! or started, that ProgramData was created, that an ACL was applied, that service-only custody
//! exists, or that the host is production-ready. **None of those is true.**
//!
//! ## Read-only by construction
//!
//! The SCM is opened with `SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE` and nothing else. No
//! service-creating, -configuring, -starting, -stopping or -deleting entry point exists anywhere in
//! the crate; there is no registry write, no ProgramData access, no ACL change, no key or credential
//! access, and no shell, PowerShell, `sc.exe` or `net.exe` invocation. This phase never proves a
//! capability by performing the operation under consideration.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! No raw SCM handle escapes:
//! ```compile_fail
//! fn f(r: &projectos_host_windows_capability_preflight::HostCapabilityReport) -> isize {
//!     r.scm_handle() // no such method
//! }
//! ```
//! The enumerated service list is never exposed — only a count:
//! ```compile_fail
//! fn f(r: &projectos_host_windows_capability_preflight::HostCapabilityReport) -> &[String] {
//!     r.service_names() // no such method
//! }
//! ```
//! Nothing here can install a service:
//! ```compile_fail
//! fn f(p: &projectos_host_windows_capability_preflight::WindowsHostPreflight) {
//!     p.install_service("ProjectOSHost") // no such method
//! }
//! ```
//! A capability that needs an effect to prove can never be reported as proven:
//! ```
//! use projectos_host_windows_capability_preflight::CapabilityKind;
//! assert!(CapabilityKind::VirtualAccountRuntimeSupport.requires_approved_effect_to_prove());
//! assert!(CapabilityKind::ServiceSidResolution.requires_approved_effect_to_prove());
//! ```
//! Owner approval cannot be forged from a candidate plus availability — that constructor is gone:
//! ```compile_fail
//! use projectos_host_windows_capability_preflight::{
//!     ServiceNameAvailability, ServiceNameCandidate, ServiceNameDecision,
//! };
//! fn f() -> ServiceNameDecision {
//!     // No such associated function: `owner_approved(candidate, availability)` was removed.
//!     ServiceNameDecision::owner_approved(
//!         ServiceNameCandidate::new("ProjectOSHost"),
//!         ServiceNameAvailability::Available,
//!     )
//!     .unwrap()
//! }
//! ```
//! The sealed validated authority has no public constructor and no settable provenance:
//! ```compile_fail
//! use projectos_host_windows_capability_preflight::ValidatedOwnerServiceNameDecision;
//! fn f() -> ValidatedOwnerServiceNameDecision {
//!     // Private fields — no struct literal, no `new`, no way to assert `DirectOwnerDecision`.
//!     ValidatedOwnerServiceNameDecision {}
//! }
//! ```
//! `DirectOwnerDecision` cannot be handed to the decision constructor as a free argument — the only
//! route takes a validated authority reference:
//! ```compile_fail
//! use projectos_host_windows_capability_preflight::{
//!     DecisionProvenance, ServiceNameAvailability, ServiceNameCandidate, ServiceNameDecision,
//! };
//! fn f() -> ServiceNameDecision {
//!     ServiceNameDecision::from_validated_owner_decision(
//!         DecisionProvenance::DirectOwnerDecision, // wrong type: needs &ValidatedOwnerServiceNameDecision
//!         ServiceNameAvailability::Available,
//!     )
//!     .unwrap()
//! }
//! ```
//! The one authority is reproducible only through itself, and it is genuinely owner-approved:
//! ```
//! use projectos_host_windows_capability_preflight::{
//!     projectos_v3_service_name_decision, DecisionProvenance,
//! };
//! let d = projectos_v3_service_name_decision().unwrap();
//! assert!(d.is_owner_approved());
//! assert_eq!(d.provenance(), DecisionProvenance::DirectOwnerDecision);
//! assert_eq!(d.name(), "ProjectOSHost");
//! ```

#![deny(unsafe_code)]

pub mod error;
pub mod host;
pub mod preflight;
pub mod service_name;

// The ONLY module permitted to use `unsafe` (minimal read-only Win32 primitives).
#[allow(unsafe_code)]
mod windows;

use projectos_host_windows_activation_plan::{
    AclCompositionOutcome, ActivationStep, ApprovalStatus, ExceptionalOperation,
    HostActivationPlan, IdentityDecisionStatus, ServiceIdentityStrategy, ServiceNameStatus,
    ServiceSidStatus, PLAN_CONTRACT_VERSION,
};

pub use error::{HostPreflightError, PreflightViolation};
pub use host::{HostArchitecture, WindowsClientProfile, WindowsEditionClass};
pub use preflight::{
    CapabilityEvidence, CapabilityKind, CapabilityStatus, HostCapabilityReport,
    OwnerDecisionOverlay, PreflightDecision,
};
pub use service_name::{
    default_candidates, projectos_v3_validated_service_name_owner_decision, recommend,
    DecisionOwner, DecisionProvenance, DecisionScope, InstallationRecheck, RecheckOutcome,
    ServiceNameAvailability, ServiceNameCandidate, ServiceNameDecision, ServiceNameDecisionStatus,
    ServiceNameValidation, ValidatedOwnerServiceNameDecision,
};

/// The plan contract version this preflight is written against.
pub const REQUIRED_PLAN_CONTRACT_VERSION: &str = "3K-D.3";

/// **The one production consumer of the sealed owner-decision authority.**
///
/// Builds the concrete owner-approved service-name decision from
/// [`projectos_v3_validated_service_name_owner_decision`] — the sealed
/// [`ValidatedOwnerServiceNameDecision`] that no general-purpose caller, recommendation, availability
/// value, report, prompt, environment variable or session state can construct. The name, owner and
/// scope come from the validated authority; this function passes only the point-in-time availability.
///
/// **Provenance.** Murad wrote `APPROVE PROJECTOSHOST` as a direct standalone owner message on
/// 2026-07-20, and ChatGPT accepted that decision and issued the binding gate. The result is
/// `OwnerApproved(ProjectOSHost)` with provenance [`DecisionProvenance::DirectOwnerDecision`].
///
/// **This binds the INTERNAL SCM SERVICE NAME and nothing else** — no display name, description,
/// executable path, install directory, startup-account config, recovery settings or service SID, and
/// no service installation, configuration, startup, deletion, ProgramData creation, ACL application,
/// key provisioning, IPC, credential migration, rollback or production activation. All remain
/// `NotAuthorised`, and this crate cannot perform any of them.
///
/// **Availability is point-in-time, not a reservation** — the record carries
/// [`InstallationRecheck::RequiredBeforeInstallation`]; the executing phase must re-check the exact
/// name before creating the service and refuse (never substitute) if it has since been taken.
///
/// # Errors
/// [`HostPreflightError`] if the validated name fails re-validation, which the unit tests pin.
pub fn projectos_v3_service_name_decision() -> Result<ServiceNameDecision, HostPreflightError> {
    let validated = projectos_v3_validated_service_name_owner_decision()?;
    ServiceNameDecision::from_validated_owner_decision(
        &validated,
        // Observed unused across the live service namespace during the 3K-E preflight, and re-checked
        // read-only at binding time. A point-in-time fact, never a reservation.
        ServiceNameAvailability::Available,
    )
}

/// The read-only Windows host preflight. Side-effect free apart from reading OS and SCM state.
#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsHostPreflight;

impl WindowsHostPreflight {
    /// A preflight value.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Verify the accepted frozen activation plan still holds the state this preflight assumes.
    ///
    /// This CONSUMES the accepted plan; it never duplicates it, never mutates it, and creates no
    /// second identity decision or service-name authority.
    ///
    /// # Errors
    /// [`HostPreflightError::PlanContractMismatch`] if any accepted fact has drifted.
    pub fn verify_accepted_plan(&self) -> Result<(), HostPreflightError> {
        let mismatch = || HostPreflightError::PlanContractMismatch;
        if PLAN_CONTRACT_VERSION != REQUIRED_PLAN_CONTRACT_VERSION {
            return Err(mismatch());
        }
        let generic = HostActivationPlan::canonical().map_err(|_| mismatch())?;
        let frozen = HostActivationPlan::projectos_v3_frozen().map_err(|_| mismatch())?;

        // The generic plan must remain recommendation-only.
        if generic.identity().is_owner_approved() {
            return Err(mismatch());
        }
        if !matches!(
            generic.identity().decision(),
            IdentityDecisionStatus::Recommended(_)
        ) {
            return Err(mismatch());
        }
        // The frozen plan must remain the owner-approved VirtualServiceAccount strategy.
        if frozen.identity().decision()
            != IdentityDecisionStatus::OwnerApproved(ServiceIdentityStrategy::VirtualServiceAccount)
        {
            return Err(mismatch());
        }
        // Name, identity and SID must remain unresolved; the ACL must remain uncomposable.
        if frozen.identity().service_name() != ServiceNameStatus::OwnerDecisionRequired {
            return Err(mismatch());
        }
        if frozen.identity().sid_status() != ServiceSidStatus::UnresolvedUntilActivation {
            return Err(mismatch());
        }
        if frozen.compose_acl() != AclCompositionOutcome::ServiceIdentityRequired {
            return Err(mismatch());
        }
        // Every effect gate must remain unauthorised.
        for step in ActivationStep::all() {
            if frozen.sequence().status(*step) != ApprovalStatus::NotAuthorised {
                return Err(mismatch());
            }
        }
        for op in ExceptionalOperation::all() {
            if frozen.sequence().exceptional_status(*op) != ApprovalStatus::NotAuthorised {
                return Err(mismatch());
            }
        }
        if frozen.is_execution_ready() {
            return Err(mismatch());
        }
        Ok(())
    }

    /// Run the read-only preflight against the live host.
    ///
    /// Reads the OS profile, opens the SCM read-only, enumerates service names solely for collision
    /// checking, and classifies every capability. The enumerated names never leave this function —
    /// only a count and per-candidate verdicts are reported.
    ///
    /// # Errors
    /// [`HostPreflightError`] only when the accepted plan has drifted or the platform is
    /// unsupported. Read-only inspection failures are CLASSIFIED into the report rather than
    /// returned as errors, so an inspection that cannot run is reported honestly instead of
    /// aborting.
    pub fn run(&self) -> Result<HostCapabilityReport, HostPreflightError> {
        self.verify_accepted_plan()?;
        // The owner service-name decision is RECORDED for the ProjectOS run: build it from the sealed
        // authority (this also re-validates the name), and overlay it onto the effective state.
        let _decision = projectos_v3_service_name_decision()?;
        self.run_with_overlay(
            &default_candidates(),
            OwnerDecisionOverlay::OwnerServiceNameDecisionRecorded,
        )
    }

    /// Run the preflight against an explicit candidate list, with no recorded owner decision.
    ///
    /// The effective state remains [`OwnerDecisionOverlay::OwnerDecisionRequired`], so a healthy host
    /// reports [`PreflightDecision::ReadyForOwnerServiceNameDecision`]. Used for generic inspection
    /// and tests.
    ///
    /// # Errors
    /// [`HostPreflightError::DuplicateCandidate`] or
    /// [`HostPreflightError::MalformedObservation`] from candidate evaluation.
    pub fn run_with_candidates(
        &self,
        candidates: &[ServiceNameCandidate],
    ) -> Result<HostCapabilityReport, HostPreflightError> {
        self.run_with_overlay(candidates, OwnerDecisionOverlay::OwnerDecisionRequired)
    }

    /// The shared read-only preflight body, parameterised by the owner-decision overlay.
    ///
    /// # Errors
    /// [`HostPreflightError::DuplicateCandidate`] or
    /// [`HostPreflightError::MalformedObservation`] from candidate evaluation.
    fn run_with_overlay(
        &self,
        candidates: &[ServiceNameCandidate],
        owner_decision: OwnerDecisionOverlay,
    ) -> Result<HostCapabilityReport, HostPreflightError> {
        // ---- OS profile ----
        let (profile, version_status) = match windows::collect_profile() {
            Ok(p) => (p, CapabilityStatus::ProvenSupported),
            Err(_) => (
                WindowsClientProfile::indeterminate(),
                CapabilityStatus::ProvenUnsupported,
            ),
        };

        // ---- read-only service namespace ----
        let (observed, scm_status, enum_status, namespace_known) =
            match windows::enumerate_service_names() {
                Ok(names) => (
                    names,
                    CapabilityStatus::ProvenSupported,
                    CapabilityStatus::ProvenSupported,
                    true,
                ),
                Err(HostPreflightError::ScmAccessDenied | HostPreflightError::ScmConnectFailed) => {
                    (
                        Vec::new(),
                        CapabilityStatus::ProvenUnsupported,
                        CapabilityStatus::NotApplicable,
                        false,
                    )
                }
                Err(_) => (
                    Vec::new(),
                    CapabilityStatus::ProvenSupported,
                    CapabilityStatus::ProvenUnsupported,
                    false,
                ),
            };
        let services_inspected = observed.len();

        let validations =
            service_name::evaluate_candidates(candidates, &observed, namespace_known)?;
        // `observed` is dropped here. The service list never reaches the report.
        drop(observed);

        let candidate_status = if !namespace_known {
            CapabilityStatus::Indeterminate
        } else if validations.iter().any(ServiceNameValidation::is_usable) {
            CapabilityStatus::ProvenSupported
        } else {
            CapabilityStatus::ProvenUnsupported
        };

        let baseline_status = match profile.edition() {
            WindowsEditionClass::Indeterminate => CapabilityStatus::Indeterminate,
            WindowsEditionClass::UnknownClient => CapabilityStatus::Indeterminate,
            _ if profile.meets_baseline() => CapabilityStatus::ProvenSupported,
            _ => CapabilityStatus::ProvenUnsupported,
        };

        use CapabilityKind as K;
        let capabilities = vec![
            CapabilityEvidence {
                kind: K::SupportedWindowsBaseline,
                status: baseline_status,
                note: "semantic edition class and major version",
            },
            CapabilityEvidence {
                kind: K::VersionApisAvailable,
                status: version_status,
                note: "os version entry point resolved and answered",
            },
            CapabilityEvidence {
                kind: K::ScmReadOnlyAccess,
                status: scm_status,
                note: "scm opened with connect+enumerate only",
            },
            CapabilityEvidence {
                kind: K::ServiceEnumeration,
                status: enum_status,
                note: "existing service names enumerated for collision checking",
            },
            CapabilityEvidence {
                kind: K::CandidateNameUnused,
                status: candidate_status,
                note: "at least one candidate is well shaped and unused",
            },
            CapabilityEvidence {
                kind: K::ServiceInstallationApisPresent,
                // Deliberately NOT probed: this crate does not link the installation APIs at all,
                // so their presence is unobserved rather than assumed either way.
                status: CapabilityStatus::Indeterminate,
                note: "installation apis are not linked by this read-only crate",
            },
            CapabilityEvidence {
                kind: K::VirtualAccountStructurallyCompatible,
                status: CapabilityStatus::ProvenSupported,
                note: "accepted frozen plan composes the strategy without a resolved sid",
            },
            // Everything below can only be established by performing the gated operation itself.
            CapabilityEvidence {
                kind: K::VirtualAccountRuntimeSupport,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "provable only by an approved service installation",
            },
            CapabilityEvidence {
                kind: K::ServiceSidResolution,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "per-service sid exists only after installation",
            },
            CapabilityEvidence {
                kind: K::FinalAclComposition,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "requires the authoritative resolved sid",
            },
            CapabilityEvidence {
                kind: K::ServiceInstallation,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "separately gated owner approval",
            },
            CapabilityEvidence {
                kind: K::ServiceStartup,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "separately gated owner approval",
            },
            CapabilityEvidence {
                kind: K::ProgramDataCreation,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "separately gated owner approval",
            },
            CapabilityEvidence {
                kind: K::ProductionAclApplication,
                status: CapabilityStatus::DeferredUntilApprovedEffect,
                note: "separately gated owner approval",
            },
        ];

        Ok(HostCapabilityReport::new(
            profile,
            capabilities,
            validations,
            services_inspected,
            namespace_known,
            owner_decision,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_accepted_plan_still_holds_every_state_this_preflight_assumes() {
        WindowsHostPreflight::new()
            .verify_accepted_plan()
            .expect("accepted frozen plan must be consistent");
        assert_eq!(PLAN_CONTRACT_VERSION, REQUIRED_PLAN_CONTRACT_VERSION);
    }

    #[test]
    fn no_capability_requiring_an_effect_is_ever_reported_as_proven() {
        // Exercised against the live host on Windows, and against the classification model
        // elsewhere; either way the invariant must hold.
        if let Ok(report) = WindowsHostPreflight::new().run() {
            for c in report.capabilities() {
                if c.kind.requires_approved_effect_to_prove() {
                    assert_eq!(
                        c.status,
                        CapabilityStatus::DeferredUntilApprovedEffect,
                        "{:?} must be deferred, never proven",
                        c.kind
                    );
                }
            }
            assert!(!report
                .violations()
                .contains(&PreflightViolation::ProofRequiresApprovedEffect));
        }
    }

    #[test]
    fn the_run_outcome_is_authority_only_and_never_installation_readiness() {
        // `PreflightDecision` has no `ReadyForInstallation` variant at all, so the match below is
        // exhaustive over every outcome this phase can produce. `run()` records the owner decision,
        // so on a healthy host the outcome is `OwnerServiceNameDecisionRecorded` — still effect-free.
        if let Ok(report) = WindowsHostPreflight::new().run() {
            let is_known = matches!(
                report.decision(),
                PreflightDecision::OwnerServiceNameDecisionRecorded
                    | PreflightDecision::ReadyForOwnerServiceNameDecision
                    | PreflightDecision::BlockedByHostCapability
                    | PreflightDecision::IndeterminateHostCapability
                    | PreflightDecision::ServiceNameCollision
                    | PreflightDecision::ReadOnlyInspectionUnavailable
                    | PreflightDecision::ReconciliationRequired
            );
            assert!(is_known, "decision must be one of the defined outcomes");
            // `run()` never leaves the effective state asking for a decision already made.
            assert_ne!(
                report.decision(),
                PreflightDecision::ReadyForOwnerServiceNameDecision,
                "run() records the owner decision, so it must not re-request one"
            );
            // Whatever the outcome, the host may never be activated by it.
            let frozen =
                projectos_host_windows_activation_plan::HostActivationPlan::projectos_v3_frozen()
                    .unwrap();
            assert!(!frozen.is_execution_ready());
            assert_eq!(
                frozen
                    .sequence()
                    .status(ActivationStep::InstallOrVerifyServiceIdentity),
                ApprovalStatus::NotAuthorised
            );
        }
    }
}
