//! Candidate service-name validation and collision checking. PURE.
//!
//! This is the ONE service-name validation authority in the crate. It never approves a name: the
//! strongest thing it produces is a RECOMMENDATION with reasons. Approval belongs to the owner, and
//! the accepted activation plan continues to report the service name as an unmade owner decision.
//!
//! Collision checking consumes OBSERVED names supplied by the caller. This module performs no
//! Windows call of its own, so every rule is testable on any platform.

use crate::error::HostPreflightError;

/// Windows bounds a service name at 256 characters.
const MAX_SERVICE_NAME_CHARS: usize = 256;

/// Names that are reserved, misleading, or would impersonate a system component.
const RESERVED_PREFIXES: [&str; 4] = ["nt service", "nt authority", "microsoft", "windows"];
/// Reserved device names, which are unusable and confusing as identifiers.
const RESERVED_DEVICE_NAMES: [&str; 6] = ["con", "prn", "aux", "nul", "com1", "lpt1"];
/// Product names that must not leak into the shared host service identity.
const PRODUCT_TOKENS: [&str; 3] = ["polygo", "bizcomply", "opsoft"];
/// Environment names — the same service name must be valid everywhere.
const ENVIRONMENT_TOKENS: [&str; 6] = ["production", "prod", "staging", "stage", "sandbox", "uat"];
/// Credential-, tenant- and machine-shaped tokens.
const SENSITIVE_TOKENS: [&str; 8] = [
    "password",
    "secret",
    "token",
    "credential",
    "apikey",
    "tenant",
    "desktop-",
    "laptop-",
];
/// A name must clearly identify the project.
const REQUIRED_PROJECT_PREFIX: &str = "projectos";

/// One candidate name under consideration. Construction does not imply approval.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceNameCandidate {
    name: String,
}

impl ServiceNameCandidate {
    /// Wrap a candidate for validation. This performs NO validation itself — call
    /// [`ServiceNameCandidate::validate`].
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into() }
    }

    /// The candidate text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.name
    }

    /// The case-folded form used for every comparison.
    #[must_use]
    pub fn folded(&self) -> String {
        self.name.to_ascii_lowercase()
    }

    /// Validate the candidate's SHAPE. Collision is a separate, observation-dependent question.
    ///
    /// # Errors
    /// [`HostPreflightError`] naming the exact rule that rejected it.
    pub fn validate(&self) -> Result<(), HostPreflightError> {
        let raw = &self.name;
        if raw.is_empty() {
            return Err(HostPreflightError::EmptyServiceName);
        }
        if raw.chars().count() > MAX_SERVICE_NAME_CHARS {
            return Err(HostPreflightError::ServiceNameTooLong);
        }
        if raw.trim() != raw {
            return Err(HostPreflightError::AmbiguousServiceName);
        }
        if raw.contains('/') || raw.contains('\\') {
            return Err(HostPreflightError::InvalidServiceNameCharacter);
        }
        if raw.chars().any(|c| c.is_control()) {
            return Err(HostPreflightError::InvalidServiceNameCharacter);
        }
        // Restrict to an unambiguous ASCII identifier alphabet: anything else risks two distinct
        // names normalising to one on some systems.
        if raw
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'))
        {
            return Err(HostPreflightError::InvalidServiceNameCharacter);
        }

        let folded = self.folded();
        if RESERVED_DEVICE_NAMES.contains(&folded.as_str())
            || RESERVED_PREFIXES.iter().any(|p| folded.starts_with(p))
        {
            return Err(HostPreflightError::ReservedServiceName);
        }
        if PRODUCT_TOKENS.iter().any(|t| folded.contains(t)) {
            return Err(HostPreflightError::ProductSpecificName);
        }
        if ENVIRONMENT_TOKENS.iter().any(|t| folded.contains(t)) {
            return Err(HostPreflightError::EnvironmentSpecificName);
        }
        if SENSITIVE_TOKENS.iter().any(|t| folded.contains(t)) {
            return Err(HostPreflightError::MachineOrCredentialLikeName);
        }
        if !folded.starts_with(REQUIRED_PROJECT_PREFIX) {
            return Err(HostPreflightError::NotProjectScoped);
        }
        Ok(())
    }
}

/// Whether the name is already taken in the observed service namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceNameAvailability {
    /// No observed service uses this name (case-insensitively).
    Available,
    /// An existing service already uses this name.
    Collision,
    /// The namespace could not be inspected, so availability is unknown. NOT "available".
    Unknown,
}

/// The complete verdict for one candidate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceNameValidation {
    /// The candidate judged.
    pub candidate: ServiceNameCandidate,
    /// Shape rejection, if any.
    pub shape_error: Option<HostPreflightError>,
    /// Availability against the observed namespace.
    pub availability: ServiceNameAvailability,
}

impl ServiceNameValidation {
    /// Whether this candidate is usable: correctly shaped AND proven unused.
    ///
    /// [`ServiceNameAvailability::Unknown`] is deliberately NOT usable.
    #[must_use]
    pub fn is_usable(&self) -> bool {
        self.shape_error.is_none() && self.availability == ServiceNameAvailability::Available
    }
}

/// How far a service-name decision has progressed.
///
/// `Recommended` and `OwnerApproved` are deliberately distinct so a recommendation can never be
/// mistaken for consent. There is exactly ONE route to `OwnerApproved`:
/// [`ServiceNameDecision::from_validated_owner_decision`], fed by a sealed
/// [`ValidatedOwnerServiceNameDecision`] the owner's decision actually produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceNameDecisionStatus {
    /// ProjectOS advises this name. **Not approval.**
    Recommended,
    /// The OWNER explicitly approved this exact name.
    OwnerApproved,
    /// The owner rejected every candidate. No name is approved.
    Rejected,
}

/// Who made the decision — semantically only. No account name, SID or machine identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DecisionOwner {
    /// The ProjectOS owner.
    Murad,
}

/// How a decision was arrived at.
///
/// The distinction is the whole safeguard: `OwnerApproved` may only be paired with
/// [`DecisionProvenance::DirectOwnerDecision`], which can ONLY originate from a
/// [`ValidatedOwnerServiceNameDecision`] — never a recommendation, prompt text, a ChatGPT relay, a
/// Claude report, an uploaded report, an environment variable, or session state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DecisionProvenance {
    /// ProjectOS's own analysis advised this name. Advisory only.
    ProjectOsRecommendation,
    /// The owner explicitly decided. Only reachable from a validated owner-decision authority.
    DirectOwnerDecision,
}

/// The scope an owner service-name decision settles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DecisionScope {
    /// The internal Windows SCM service name, and nothing else.
    InternalWindowsScmServiceNameOnly,
}

/// The sealed owner-decision authority.
///
/// A [`ValidatedOwnerServiceNameDecision`] is the ONLY thing that can produce a
/// [`DecisionProvenance::DirectOwnerDecision`]. Its fields are private and its constructor is private
/// to this module, so it cannot be built by an external crate, by recommendation code, by
/// availability code, by a default constructor, by parsing a report, prompt, environment variable or
/// session state, or by any general-purpose caller. Exactly one function constructs it —
/// [`projectos_v3_validated_service_name_owner_decision`] — and it hardcodes the reviewed facts of
/// Murad's direct decision. A future owner decision requires a new governed binding change here, not
/// a convenience call.
mod owner_authority {
    use super::{DecisionOwner, DecisionScope, HostPreflightError, ServiceNameCandidate};

    /// A validated record that Murad made a direct owner service-name decision, accepted by the
    /// ChatGPT binding gate. Immutable; not externally constructible; carries no secret or machine
    /// material.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct ValidatedOwnerServiceNameDecision {
        // All fields private: no external construction, no mutation, no field selection.
        name: ServiceNameCandidate,
        owner: DecisionOwner,
        scope: DecisionScope,
        // A plain marker that the source is a direct owner decision. It is set ONLY by the private
        // constructor below, so a caller can never assert it.
        from_direct_owner_decision: bool,
        // A plain marker that the ChatGPT binding gate accepted the decision.
        binding_gate_accepted: bool,
    }

    impl ValidatedOwnerServiceNameDecision {
        /// PRIVATE constructor. Reachable only from this module — i.e. only from the single
        /// authority function.
        fn new(name: ServiceNameCandidate) -> Result<Self, HostPreflightError> {
            name.validate()?;
            Ok(Self {
                name,
                owner: DecisionOwner::Murad,
                scope: DecisionScope::InternalWindowsScmServiceNameOnly,
                from_direct_owner_decision: true,
                binding_gate_accepted: true,
            })
        }

        /// The validated approved name.
        #[must_use]
        pub fn name(&self) -> &str {
            self.name.as_str()
        }

        /// A clone of the validated candidate, for building the concrete decision.
        pub(crate) fn candidate(&self) -> ServiceNameCandidate {
            self.name.clone()
        }

        /// Who decided.
        #[must_use]
        pub fn owner(&self) -> DecisionOwner {
            self.owner
        }

        /// The scope the decision settles.
        #[must_use]
        pub fn scope(&self) -> DecisionScope {
            self.scope
        }

        /// Whether the source is a direct owner decision. Always true for a validated record.
        #[must_use]
        pub fn is_direct_owner_decision(&self) -> bool {
            self.from_direct_owner_decision
        }

        /// Whether the ChatGPT binding gate accepted the decision. Always true for a validated
        /// record.
        #[must_use]
        pub fn binding_gate_accepted(&self) -> bool {
            self.binding_gate_accepted
        }
    }

    /// **The one ProjectOS V3 validated owner service-name decision authority.**
    ///
    /// Constructs the sealed record from the reviewed facts of Murad's direct decision
    /// (`APPROVE PROJECTOSHOST`, 2026-07-20) accepted by the ChatGPT binding gate. No input is taken
    /// from a caller, environment, session, report or prompt — the name is fixed here and validated.
    ///
    /// # Errors
    /// [`HostPreflightError`] if the fixed name fails validation, which the unit tests pin.
    pub fn projectos_v3_validated_service_name_owner_decision(
    ) -> Result<ValidatedOwnerServiceNameDecision, HostPreflightError> {
        ValidatedOwnerServiceNameDecision::new(ServiceNameCandidate::new("ProjectOSHost"))
    }
}

pub use owner_authority::{
    projectos_v3_validated_service_name_owner_decision, ValidatedOwnerServiceNameDecision,
};

/// Whether the name must be re-checked immediately before installation.
///
/// Availability observed during a preflight is a POINT-IN-TIME fact, never a reservation: Windows
/// does not hold a service name for anyone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstallationRecheck {
    /// The executing phase MUST re-check the exact name before creating the service.
    RequiredBeforeInstallation,
}

/// What a pre-installation re-check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RecheckOutcome {
    /// The approved name is still unused. This does NOT authorise installation.
    StillAvailable,
    /// The approved name is now taken. Installation must not proceed.
    NoLongerAvailable,
    /// The namespace could not be read, so nothing is known. Treated as blocking.
    NamespaceUnknown,
}

impl RecheckOutcome {
    /// Whether this outcome blocks installation. Only `StillAvailable` does not.
    ///
    /// Not blocking is NOT the same as being authorised — installation remains separately gated.
    #[must_use]
    pub fn blocks_installation(self) -> bool {
        self != Self::StillAvailable
    }
}

/// An immutable service-name decision record.
///
/// Carries no machine name, user name, domain, SID, service SID, timestamp, registry path,
/// executable path, credential or secret — there is no field for any of them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceNameDecision {
    candidate: ServiceNameCandidate,
    status: ServiceNameDecisionStatus,
    owner: DecisionOwner,
    provenance: DecisionProvenance,
    scope: DecisionScope,
    availability_at_decision: ServiceNameAvailability,
    recheck: InstallationRecheck,
}

impl ServiceNameDecision {
    /// Record the OWNER's approval, derived from a sealed [`ValidatedOwnerServiceNameDecision`].
    ///
    /// This is the ONLY route to [`ServiceNameDecisionStatus::OwnerApproved`] /
    /// [`DecisionProvenance::DirectOwnerDecision`]. The name, owner and scope come from the validated
    /// authority — a caller supplies no candidate, so nothing can approve an arbitrary name, and no
    /// general-purpose call can manufacture direct-owner provenance. Availability stays a
    /// point-in-time observation the caller passes in.
    ///
    /// # Errors
    /// [`HostPreflightError`] if the validated name fails re-validation (it cannot in practice, but
    /// the check is retained as defence in depth).
    pub fn from_validated_owner_decision(
        validated: &ValidatedOwnerServiceNameDecision,
        availability_at_decision: ServiceNameAvailability,
    ) -> Result<Self, HostPreflightError> {
        let candidate = validated.candidate();
        candidate.validate()?;
        Ok(Self {
            candidate,
            status: ServiceNameDecisionStatus::OwnerApproved,
            owner: validated.owner(),
            provenance: DecisionProvenance::DirectOwnerDecision,
            scope: validated.scope(),
            availability_at_decision,
            recheck: InstallationRecheck::RequiredBeforeInstallation,
        })
    }

    /// Record an advisory recommendation. Never approval; provenance is always
    /// [`DecisionProvenance::ProjectOsRecommendation`].
    ///
    /// # Errors
    /// [`HostPreflightError`] if the candidate does not pass validation.
    pub fn recommended(
        candidate: ServiceNameCandidate,
        availability_at_decision: ServiceNameAvailability,
    ) -> Result<Self, HostPreflightError> {
        candidate.validate()?;
        Ok(Self {
            candidate,
            status: ServiceNameDecisionStatus::Recommended,
            owner: DecisionOwner::Murad,
            provenance: DecisionProvenance::ProjectOsRecommendation,
            scope: DecisionScope::InternalWindowsScmServiceNameOnly,
            availability_at_decision,
            recheck: InstallationRecheck::RequiredBeforeInstallation,
        })
    }

    /// The provenance of this decision.
    #[must_use]
    pub fn provenance(&self) -> DecisionProvenance {
        self.provenance
    }

    /// The scope this decision settles.
    #[must_use]
    pub fn scope(&self) -> DecisionScope {
        self.scope
    }

    /// The exact approved or recommended name.
    #[must_use]
    pub fn name(&self) -> &str {
        self.candidate.as_str()
    }

    /// The decision status.
    #[must_use]
    pub fn status(&self) -> ServiceNameDecisionStatus {
        self.status
    }

    /// Whether the OWNER approved this name. A recommendation returns `false`.
    #[must_use]
    pub fn is_owner_approved(&self) -> bool {
        self.status == ServiceNameDecisionStatus::OwnerApproved
    }

    /// Whether the owner's direct service-name decision is still outstanding.
    ///
    /// True for a recommendation, false only once the owner has explicitly approved. This is the
    /// honest current state: ProjectOS may recommend, but only Murad may decide.
    #[must_use]
    pub fn owner_decision_outstanding(&self) -> bool {
        self.status != ServiceNameDecisionStatus::OwnerApproved
    }

    /// Who decided, semantically.
    #[must_use]
    pub fn owner(&self) -> DecisionOwner {
        self.owner
    }

    /// Availability observed when the decision was taken. A point-in-time fact.
    #[must_use]
    pub fn availability_at_decision(&self) -> ServiceNameAvailability {
        self.availability_at_decision
    }

    /// The mandatory pre-installation re-check requirement.
    #[must_use]
    pub fn recheck_requirement(&self) -> InstallationRecheck {
        self.recheck
    }

    /// Re-check the approved name against a fresh observation of the namespace.
    ///
    /// Never substitutes an alternative, never appends a number, and never picks a second choice —
    /// a collision returns [`RecheckOutcome::NoLongerAvailable`] and the owner must decide again.
    ///
    /// # Errors
    /// [`HostPreflightError::MalformedObservation`] if an observation is empty or contains a
    /// control character. Observations fail CLOSED.
    pub fn recheck(
        &self,
        observed: &[String],
        namespace_known: bool,
    ) -> Result<RecheckOutcome, HostPreflightError> {
        if !namespace_known {
            return Ok(RecheckOutcome::NamespaceUnknown);
        }
        let folded = self.candidate.folded();
        for name in observed {
            if name.is_empty() || name.chars().any(|c| c.is_control()) {
                return Err(HostPreflightError::MalformedObservation);
            }
            if name.to_ascii_lowercase() == folded {
                return Ok(RecheckOutcome::NoLongerAvailable);
            }
        }
        Ok(RecheckOutcome::StillAvailable)
    }
}

/// The bounded default candidate list. None is owner-approved.
#[must_use]
pub fn default_candidates() -> Vec<ServiceNameCandidate> {
    ["ProjectOSHost", "ProjectOSHostService", "ProjectOSService"]
        .into_iter()
        .map(ServiceNameCandidate::new)
        .collect()
}

/// Judge every candidate against the observed namespace.
///
/// `observed` is the set of existing service names; `namespace_known` states whether that set is
/// trustworthy. When it is not, availability is `Unknown` — never `Available`.
///
/// # Errors
/// [`HostPreflightError::DuplicateCandidate`] if the same name is supplied twice
/// (case-insensitively); [`HostPreflightError::MalformedObservation`] if an observation is empty or
/// contains a control character — observations fail CLOSED rather than being skipped.
pub fn evaluate_candidates(
    candidates: &[ServiceNameCandidate],
    observed: &[String],
    namespace_known: bool,
) -> Result<Vec<ServiceNameValidation>, HostPreflightError> {
    let mut seen: Vec<String> = Vec::with_capacity(candidates.len());
    for c in candidates {
        let folded = c.folded();
        if seen.contains(&folded) {
            return Err(HostPreflightError::DuplicateCandidate);
        }
        seen.push(folded);
    }

    let mut observed_folded: Vec<String> = Vec::with_capacity(observed.len());
    for name in observed {
        if name.is_empty() || name.chars().any(|c| c.is_control()) {
            return Err(HostPreflightError::MalformedObservation);
        }
        observed_folded.push(name.to_ascii_lowercase());
    }

    Ok(candidates
        .iter()
        .map(|c| {
            let availability = if !namespace_known {
                ServiceNameAvailability::Unknown
            } else if observed_folded.contains(&c.folded()) {
                ServiceNameAvailability::Collision
            } else {
                ServiceNameAvailability::Available
            };
            ServiceNameValidation {
                candidate: c.clone(),
                shape_error: c.validate().err(),
                availability,
            }
        })
        .collect())
}

/// The first usable candidate, in the caller's preference order. `None` if none is usable.
///
/// This is a RECOMMENDATION only — it is never marked owner-approved.
#[must_use]
pub fn recommend(validations: &[ServiceNameValidation]) -> Option<&ServiceNameValidation> {
    validations.iter().find(|v| v.is_usable())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observed(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn the_default_candidates_are_all_well_shaped() {
        for c in default_candidates() {
            assert!(c.validate().is_ok(), "{} must be well shaped", c.as_str());
        }
    }

    #[test]
    fn every_shape_rule_is_enforced_with_an_exact_classification() {
        for (name, expected) in [
            ("", HostPreflightError::EmptyServiceName),
            (
                "ProjectOS/Host",
                HostPreflightError::InvalidServiceNameCharacter,
            ),
            (
                "ProjectOS\\Host",
                HostPreflightError::InvalidServiceNameCharacter,
            ),
            (
                "ProjectOS\u{7}Host",
                HostPreflightError::InvalidServiceNameCharacter,
            ),
            (
                "ProjectOS Host",
                HostPreflightError::InvalidServiceNameCharacter,
            ),
            (" ProjectOSHost", HostPreflightError::AmbiguousServiceName),
            ("ProjectOSHost ", HostPreflightError::AmbiguousServiceName),
            (
                "NT SERVICE\\X",
                HostPreflightError::InvalidServiceNameCharacter,
            ),
            ("nul", HostPreflightError::ReservedServiceName),
            (
                "WindowsUpdateHelper",
                HostPreflightError::ReservedServiceName,
            ),
            (
                "ProjectOSPolyGoHost",
                HostPreflightError::ProductSpecificName,
            ),
            (
                "ProjectOSHostProduction",
                HostPreflightError::EnvironmentSpecificName,
            ),
            (
                "ProjectOSHostStaging",
                HostPreflightError::EnvironmentSpecificName,
            ),
            (
                "ProjectOSHostToken",
                HostPreflightError::MachineOrCredentialLikeName,
            ),
            (
                "ProjectOSHostTenantA",
                HostPreflightError::MachineOrCredentialLikeName,
            ),
            ("HostService", HostPreflightError::NotProjectScoped),
        ] {
            assert_eq!(
                ServiceNameCandidate::new(name).validate().unwrap_err(),
                expected,
                "candidate {name:?} must be classified exactly"
            );
        }
    }

    #[test]
    fn an_over_length_name_is_refused() {
        let long = format!("ProjectOS{}", "a".repeat(MAX_SERVICE_NAME_CHARS));
        assert_eq!(
            ServiceNameCandidate::new(long).validate().unwrap_err(),
            HostPreflightError::ServiceNameTooLong
        );
        let exact = format!("ProjectOS{}", "a".repeat(MAX_SERVICE_NAME_CHARS - 9));
        assert!(ServiceNameCandidate::new(exact).validate().is_ok());
    }

    #[test]
    fn collision_detection_is_case_insensitive() {
        let v = evaluate_candidates(
            &default_candidates(),
            &observed(&["PROJECTOSHOST", "Spooler"]),
            true,
        )
        .unwrap();
        assert_eq!(v[0].availability, ServiceNameAvailability::Collision);
        assert!(!v[0].is_usable());
        assert_eq!(v[1].availability, ServiceNameAvailability::Available);
        assert!(v[1].is_usable());
    }

    #[test]
    fn an_uninspectable_namespace_yields_unknown_not_available() {
        let v = evaluate_candidates(&default_candidates(), &[], false).unwrap();
        for entry in &v {
            assert_eq!(entry.availability, ServiceNameAvailability::Unknown);
            assert!(!entry.is_usable(), "unknown must never be usable");
        }
        assert!(recommend(&v).is_none());
    }

    #[test]
    fn a_duplicate_candidate_is_refused() {
        let dup = vec![
            ServiceNameCandidate::new("ProjectOSHost"),
            ServiceNameCandidate::new("projectoshost"),
        ];
        assert_eq!(
            evaluate_candidates(&dup, &[], true).unwrap_err(),
            HostPreflightError::DuplicateCandidate
        );
    }

    #[test]
    fn malformed_observations_fail_closed() {
        for bad in [vec![String::new()], vec!["with\u{1}control".to_string()]] {
            assert_eq!(
                evaluate_candidates(&default_candidates(), &bad, true).unwrap_err(),
                HostPreflightError::MalformedObservation
            );
        }
    }

    #[test]
    fn the_recommendation_is_the_first_usable_candidate_and_is_not_approval() {
        let v = evaluate_candidates(&default_candidates(), &observed(&["ProjectOSHost"]), true)
            .unwrap();
        let rec = recommend(&v).expect("a usable candidate must remain");
        assert_eq!(rec.candidate.as_str(), "ProjectOSHostService");
        assert!(rec.is_usable());
        // Nothing in this type records approval — there is no such field.
        let text = format!("{rec:?}");
        assert!(!text.to_ascii_lowercase().contains("approved"));
    }

    #[test]
    fn a_badly_shaped_candidate_is_never_recommended_even_when_unused() {
        let v = evaluate_candidates(
            &[ServiceNameCandidate::new("HostService")],
            &observed(&["Spooler"]),
            true,
        )
        .unwrap();
        assert_eq!(v[0].availability, ServiceNameAvailability::Available);
        assert_eq!(v[0].shape_error, Some(HostPreflightError::NotProjectScoped));
        assert!(!v[0].is_usable());
        assert!(recommend(&v).is_none());
    }
}
