//! Tier 2 approved-plan authority (CD-B4-PROTECTED-PLAN-STORE1A + SHA256-AUTHORITY1A).
//!
//! Extends the Tier-1 operation-bound [`crate::phase::PhaseId`] with proof that the phase matches ONE
//! owner-approved, unchanged plan definition. A plan CANDIDATE (from `.projectops`, imported structured
//! data, or an owner draft) is UNTRUSTED: it is normalized into a canonical [`NormalizedPhaseDefinition`]
//! and digested into a [`PhaseDefinitionDigest`] with a COLLISION-RESISTANT SHA-256 over a
//! domain-separated, schema-versioned, length-prefixed canonical encoding; only owner approval converts
//! a normalized candidate into a protected [`ApprovedPlanRecord`]. A report, a plan file, a UI bool or a
//! caller string can never mint plan authority.
//!
//! Several authority producers (the crate-private approval mint, the reader-fact constructor, some
//! accessors) are consumed by the PENDING reducer/permit integration and by tests; until that
//! integration lands they are unused in a plain build, so a module-level dead-code allowance is honest.
#![allow(dead_code)]

use core::fmt;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, ProjectId};

use crate::error::RecordError;
use crate::facts::{validate_bounded_id, MAX_BOUNDED_ID_LEN};

/// Domain separator for the phase-definition digest. Binds the hash to this exact purpose so a digest
/// of anything else can never be mistaken for a phase-definition authority binding.
const DIGEST_DOMAIN_V1: &str = "PROJECTOS:PHASE-DEFINITION:V1";
/// Canonical-encoding schema version. A change here deliberately changes every digest.
const DIGEST_SCHEMA_V1: &str = "PHASE-DEFINITION-CANONICAL-V1";
/// The historical contract states exactly these nineteen authority fields, and no baseline.
const DIGEST_FIELDS_V1: u32 = 19;
/// VERSION 2 (PROJECTOS-HOST-REVIEW-PATH1B, owner-ratified): the contract that INCLUDES the
/// owner-approved baseline. Its own domain separator and schema label, so no V2 encoding can be read as
/// a V1 one and no V1 encoding can be read as stating a baseline.
const DIGEST_DOMAIN_V2: &str = "PROJECTOS:PHASE-DEFINITION:V2";
const DIGEST_SCHEMA_V2: &str = "PHASE-DEFINITION-CANONICAL-V2";
/// Version 2 states the nineteen fields AND `baseline`.
const DIGEST_FIELDS_V2: u32 = 20;

/// Which phase-definition contract a definition is digested under.
///
/// ONE DIGEST, TWO CONTRACT VERSIONS - not two digests. A definition has exactly one phase-definition
/// digest, and which contract it is computed under is a FACT ABOUT THE DEFINITION (does it state an
/// owner-approved baseline?), never an argument: no caller can ask for a baseline-bearing definition to
/// be hashed under V1, or for a historical one to be re-labelled V2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseDefinitionContract {
    /// The historical nineteen-field contract. Its bytes and digests are what they always were.
    /// It states NO baseline and can never satisfy an authority that requires one.
    V1,
    /// The contract that includes the owner-approved baseline B. Changing B changes the digest.
    V2,
}

// ---------------------------------------------------------------------------------------------
// Canonical, unambiguous, length-prefixed encoding
// ---------------------------------------------------------------------------------------------

/// Append a length-prefixed byte segment (u32 big-endian length + bytes). Length-prefixing makes the
/// encoding UNAMBIGUOUS: two different structured definitions cannot encode to the same bytes, because
/// no value can absorb a following field's bytes (as delimiter-only concatenation would allow).
fn put(buf: &mut Vec<u8>, seg: &[u8]) {
    buf.extend_from_slice(&(seg.len() as u32).to_be_bytes());
    buf.extend_from_slice(seg);
}

/// Append one canonical field: its name, its value count, and each value — all length-prefixed.
fn put_field(buf: &mut Vec<u8>, name: &str, values: &[&str]) {
    put(buf, name.as_bytes());
    buf.extend_from_slice(&(values.len() as u32).to_be_bytes());
    for v in values {
        put(buf, v.as_bytes());
    }
}

fn as_strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

// ---------------------------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------------------------

/// A bounded, validated approved-plan identity (service-private).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ApprovedPlanRef(String);

impl ApprovedPlanRef {
    /// Construct a validated approved-plan reference.
    ///
    /// # Errors
    /// [`RecordError`] if the token is empty, over-length, or contains an illegal character.
    pub fn new(value: impl Into<String>) -> Result<Self, RecordError> {
        let value = value.into();
        validate_bounded_id(&value)?;
        Ok(Self(value))
    }
    /// Borrow the token.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An opaque, monotonic approved-plan version. Interpreted by the service; a higher value supersedes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ApprovedPlanVersion(pub u64);

/// The opaque SHA-256 digest of a normalized phase definition. Fixed 32 bytes, private; the ONLY origin
/// is [`phase_definition_digest`]. No public constructor, no from-hex, no serde-as-authority, redacted
/// Debug (the full digest never renders in the clear).
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PhaseDefinitionDigest {
    bytes: [u8; 32],
}

impl fmt::Debug for PhaseDefinitionDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PhaseDefinitionDigest([REDACTED])")
    }
}

// ---------------------------------------------------------------------------------------------
// Structured phase definition
// ---------------------------------------------------------------------------------------------

/// The kind of phase. Closed; the caller cannot widen it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum PhaseType {
    /// Read-only source inspection.
    SourceOnly,
    /// Read-only observation (repository/process/service facts).
    Observation,
    /// Observation plus a temporary, fully-rolled-back service lifecycle.
    TemporaryServiceLifecycle,
}

/// The residue obligation. Only exact-zero is valid for an effectful phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum ResidueRequirement {
    /// Residue must be exactly zero.
    ExactlyZero,
}

/// How the phase may touch the repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum RepositoryPolicy {
    /// Read-only; no repository mutation.
    ReadOnly,
    /// Bound to a pinned baseline; still no mutation in this phase's scope.
    PinnedBaseline,
}

/// How the phase may touch external providers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum ProviderPolicy {
    /// No provider access.
    None,
    /// Read-only provider access.
    ReadOnly,
}

/// What effects the phase may perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum EffectPolicy {
    /// No effect.
    None,
    /// Observation only.
    ObservationOnly,
    /// Temporary lifecycle with mandatory rollback.
    TemporaryLifecycle,
}

/// A candidate phase definition — UNTRUSTED INPUT parsed from a plan file/import/draft. Every field is
/// caller-supplied; nothing here is authority until normalized, digested and owner-approved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhaseDefinitionCandidate {
    /// Stable phase identifier (untrusted).
    pub phase_id: String,
    /// Phase type (untrusted).
    pub phase_type: PhaseType,
    /// Project (untrusted).
    pub project: ProjectId,
    /// Environment (untrusted).
    pub environment: EnvironmentId,
    /// Authorised scope tokens (unordered set; deduplicated + sorted on normalize).
    pub scope: Vec<String>,
    /// Exact authorised path boundary (ORDER PRESERVED — order is semantically meaningful).
    pub path_boundary: Vec<String>,
    /// Allowed actions (unordered set).
    pub allowed_actions: Vec<String>,
    /// Prohibited actions (unordered set).
    pub prohibited_actions: Vec<String>,
    /// Dependency phase ids (unordered set).
    pub dependencies: Vec<String>,
    /// Predecessor phase ids (ordered list; predecessor order matters).
    pub predecessors: Vec<String>,
    /// Repository policy.
    pub repository_policy: RepositoryPolicy,
    /// Provider policy.
    pub provider_policy: ProviderPolicy,
    /// Effect policy.
    pub effect_policy: EffectPolicy,
    /// Rollback required on pass and failure.
    pub rollback_required: bool,
    /// Shutdown acknowledgement required before success.
    pub shutdown_required: bool,
    /// Disconnect required before success.
    pub disconnect_required: bool,
    /// Residue obligation.
    pub residue: ResidueRequirement,
    /// THE APPROVED BASELINE COMMIT of the phase (untrusted until normalized): exactly 40 lower-case hex
    /// characters, or `None` for a phase that is never reviewed against a candidate.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B. AUTHORITY-BEARING: it is the fixed point every candidate is measured
    /// from, so it enters the phase-definition digest the owner approves. Changing it changes the digest.
    pub approved_baseline: Option<String>,
}

/// The canonical, validated phase definition. Built ONLY by [`normalize_candidate`]; its fields are
/// crate-private so a caller cannot fabricate one.
#[derive(Clone, PartialEq, Eq)]
pub struct NormalizedPhaseDefinition {
    phase_id: String,
    phase_type: PhaseType,
    project: ProjectId,
    environment: EnvironmentId,
    scope: Vec<String>,              // sorted, deduplicated
    path_boundary: Vec<String>,      // order preserved
    allowed_actions: Vec<String>,    // sorted, deduplicated
    prohibited_actions: Vec<String>, // sorted, deduplicated
    dependencies: Vec<String>,       // sorted, deduplicated
    predecessors: Vec<String>,       // order preserved
    repository_policy: RepositoryPolicy,
    provider_policy: ProviderPolicy,
    effect_policy: EffectPolicy,
    rollback_required: bool,
    shutdown_required: bool,
    disconnect_required: bool,
    residue: ResidueRequirement,
    approved_baseline: Option<ApprovedBaselineCommit>,
}

impl fmt::Debug for NormalizedPhaseDefinition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("NormalizedPhaseDefinition([REDACTED])")
    }
}

impl NormalizedPhaseDefinition {
    /// The contract this definition is digested under: V2 exactly when it states an owner-approved
    /// baseline, V1 otherwise. Derived from the definition, so it cannot disagree with it.
    #[must_use]
    pub fn digest_contract(&self) -> PhaseDefinitionContract {
        match self.approved_baseline {
            Some(_) => PhaseDefinitionContract::V2,
            None => PhaseDefinitionContract::V1,
        }
    }
    /// The bound project.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The bound environment.
    #[must_use]
    pub fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    /// The stable phase id.
    #[must_use]
    pub fn phase_id(&self) -> &str {
        &self.phase_id
    }
    /// Whether an action token is in the approved allowed set.
    #[must_use]
    pub fn allows_action(&self, action: &str) -> bool {
        self.allowed_actions.iter().any(|a| a == action)
    }
    /// Whether an action token is in the approved prohibited set.
    #[must_use]
    pub fn prohibits_action(&self, action: &str) -> bool {
        self.prohibited_actions.iter().any(|a| a == action)
    }
    /// Evaluate a requested operation policy against this approved definition. Fail closed on the FIRST
    /// violation; a prohibited action wins over an allowed one. Consumed by the reducer.
    pub fn authorises(&self, p: &RequestedOperationPolicy) -> Result<(), PlanPolicyRefusal> {
        if self.prohibits_action(&p.requested_action) {
            return Err(PlanPolicyRefusal::ProhibitedAction);
        }
        if !self.allows_action(&p.requested_action) {
            return Err(PlanPolicyRefusal::AllowedActionMissing);
        }
        for s in &p.requested_scope {
            if !self.scope.iter().any(|a| a == s) {
                return Err(PlanPolicyRefusal::ScopeMismatch);
            }
        }
        for path in &p.requested_paths {
            if !path_within_boundary(&self.path_boundary, path) {
                return Err(PlanPolicyRefusal::PathBoundaryMismatch);
            }
        }
        for dep in &self.dependencies {
            if !p.completed_dependencies.iter().any(|d| d == dep) {
                return Err(PlanPolicyRefusal::DependencyIncomplete);
            }
        }
        for pre in &self.predecessors {
            if !p.closed_predecessors.iter().any(|c| c == pre) {
                return Err(PlanPolicyRefusal::PredecessorIncomplete);
            }
        }
        Ok(())
    }
}

/// Whether a requested repository-relative path is inside the approved boundary. Deterministic and
/// fail-closed: rejects empty/absolute/backslash/`..`-traversal paths, normalizes a trailing slash, and
/// requires an exact match or a proper child of an approved entry. No repository measurement.
#[must_use]
pub fn path_within_boundary(approved: &[String], requested: &str) -> bool {
    let req = requested.trim();
    if req.is_empty()
        || req.starts_with('/')
        || req.contains('\\')
        || req.split('/').any(|seg| seg == "..")
    {
        return false;
    }
    let req = req.trim_end_matches('/');
    approved.iter().any(|a| {
        let a = a.trim_end_matches('/');
        req == a || req.starts_with(&format!("{a}/"))
    })
}

/// A requested operation's policy inputs — NON-AUTHORITATIVE, caller/service-supplied, validated and
/// bounded, folded into the operation fingerprint and evaluated by the reducer against the approved
/// definition. It is not authority; it is what the operation asks to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestedOperationPolicy {
    /// The single action the operation performs.
    pub requested_action: String,
    /// The scope tokens the operation touches.
    pub requested_scope: Vec<String>,
    /// The repository-relative paths the operation touches.
    pub requested_paths: Vec<String>,
    /// Dependency phase ids the caller asserts complete (checked against the approved dependency set).
    pub completed_dependencies: Vec<String>,
    /// Predecessor phase ids the caller asserts closed (checked against the approved predecessor set).
    pub closed_predecessors: Vec<String>,
}

/// Why a requested operation policy was refused against the approved definition. Fail closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum PlanPolicyRefusal {
    /// The requested action is in the approved prohibited set.
    ProhibitedAction,
    /// The requested action is not in the approved allowed set.
    AllowedActionMissing,
    /// A requested scope item is not approved.
    ScopeMismatch,
    /// A requested path is outside the approved boundary (or a traversal/absolute path).
    PathBoundaryMismatch,
    /// An approved required dependency is not complete.
    DependencyIncomplete,
    /// An approved predecessor is not closed.
    PredecessorIncomplete,
}

/// Why a candidate could not be normalized. Fail closed.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum NormalizeError {
    /// A required field was empty.
    MissingRequiredField,
    /// An identifier token was malformed.
    InvalidIdentifier,
    /// The same action appears in both allowed and prohibited sets.
    ContradictoryActions,
    /// A duplicate path-boundary entry made the boundary ambiguous.
    AmbiguousPathBoundary,
    /// A dependency referenced the phase itself (a trivial cycle).
    DependencyCycle,
    /// A predecessor referenced the phase itself (a trivial cycle).
    PredecessorCycle,
    /// The candidate declared no project/environment binding.
    EnvironmentAmbiguous,
    /// An approved baseline was stated and is not an exact 40-character lower-case commit identity. A
    /// reference, an abbreviation or an upper-case identity is REFUSED, never normalized into one.
    ApprovedBaselineMalformed,
}

fn norm_token(s: &str) -> Result<String, NormalizeError> {
    let t = s.trim();
    validate_bounded_id(t).map_err(|_| NormalizeError::InvalidIdentifier)?;
    Ok(t.to_string())
}

/// A path-boundary entry allows the forward slash (paths need it) but still forbids control chars,
/// whitespace, backslashes and non-ASCII, and is length-bounded.
fn norm_path(s: &str) -> Result<String, NormalizeError> {
    let t = s.trim();
    if t.is_empty() || t.len() > MAX_BOUNDED_ID_LEN {
        return Err(NormalizeError::InvalidIdentifier);
    }
    if t.bytes().any(|b| !b.is_ascii_graphic() || b == b'\\') {
        return Err(NormalizeError::InvalidIdentifier);
    }
    Ok(t.to_string())
}

fn norm_set(items: &[String]) -> Result<Vec<String>, NormalizeError> {
    let mut out = Vec::with_capacity(items.len());
    for i in items {
        out.push(norm_token(i)?);
    }
    out.sort();
    out.dedup();
    Ok(out)
}

fn norm_id_list(items: &[String]) -> Result<Vec<String>, NormalizeError> {
    items.iter().map(|i| norm_token(i)).collect()
}

fn norm_path_list(items: &[String]) -> Result<Vec<String>, NormalizeError> {
    items.iter().map(|i| norm_path(i)).collect()
}

/// Normalize an untrusted candidate into the canonical definition. Fail closed on every listed defect.
///
/// # Errors
/// [`NormalizeError`] describing the first violated rule.
pub fn normalize_candidate(
    c: &PhaseDefinitionCandidate,
) -> Result<NormalizedPhaseDefinition, NormalizeError> {
    let phase_id = norm_token(&c.phase_id)?;
    if phase_id.is_empty() {
        return Err(NormalizeError::MissingRequiredField);
    }
    c.project
        .validate()
        .map_err(|_| NormalizeError::InvalidIdentifier)?;
    c.environment
        .validate()
        .map_err(|_| NormalizeError::InvalidIdentifier)?;
    if c.project.as_str().is_empty() || c.environment.as_str().is_empty() {
        return Err(NormalizeError::EnvironmentAmbiguous);
    }

    let scope = norm_set(&c.scope)?;
    let allowed_actions = norm_set(&c.allowed_actions)?;
    let prohibited_actions = norm_set(&c.prohibited_actions)?;
    // An action cannot be both allowed and prohibited.
    if allowed_actions
        .iter()
        .any(|a| prohibited_actions.contains(a))
    {
        return Err(NormalizeError::ContradictoryActions);
    }
    let dependencies = norm_set(&c.dependencies)?;
    if dependencies.contains(&phase_id) {
        return Err(NormalizeError::DependencyCycle);
    }
    let predecessors = norm_id_list(&c.predecessors)?;
    if predecessors.contains(&phase_id) {
        return Err(NormalizeError::PredecessorCycle);
    }
    // Path boundary: order preserved, but a duplicate makes the boundary ambiguous.
    let path_boundary = norm_path_list(&c.path_boundary)?;
    let mut seen = path_boundary.clone();
    seen.sort();
    let unique = {
        let mut u = seen.clone();
        u.dedup();
        u.len()
    };
    if unique != seen.len() {
        return Err(NormalizeError::AmbiguousPathBoundary);
    }

    let approved_baseline = match &c.approved_baseline {
        None => None,
        Some(hex) => Some(
            ApprovedBaselineCommit::parse(hex).ok_or(NormalizeError::ApprovedBaselineMalformed)?,
        ),
    };

    Ok(NormalizedPhaseDefinition {
        phase_id,
        phase_type: c.phase_type,
        project: c.project.clone(),
        environment: c.environment.clone(),
        scope,
        path_boundary,
        allowed_actions,
        prohibited_actions,
        dependencies,
        predecessors,
        repository_policy: c.repository_policy,
        provider_policy: c.provider_policy,
        effect_policy: c.effect_policy,
        rollback_required: c.rollback_required,
        shutdown_required: c.shutdown_required,
        disconnect_required: c.disconnect_required,
        residue: c.residue,
        approved_baseline,
    })
}

/// Digest the AUTHORITY-BEARING content of a normalized definition, together with the plan reference
/// and version, using SHA-256 over a domain-separated, schema-versioned, length-prefixed canonical
/// encoding. Collision-resistant, deterministic and format-insensitive: display prose, comments and
/// timestamps are not inputs, and every authority field is length-prefixed so no two distinct
/// definitions can encode to the same bytes.
#[must_use]
pub fn phase_definition_digest(
    n: &NormalizedPhaseDefinition,
    plan_ref: &ApprovedPlanRef,
    version: ApprovedPlanVersion,
) -> PhaseDefinitionDigest {
    let mut b: Vec<u8> = Vec::new();
    // THE CONTRACT VERSION IS DERIVED, NEVER CHOSEN (PROJECTOS-HOST-REVIEW-PATH1B, owner-ratified).
    //
    // V1 is the historical nineteen-field contract: a definition without a baseline encodes to the very
    // bytes it always did, so no digest that already exists changes and the V1 labels still mean what
    // they meant. V2 is the contract that INCLUDES the owner-approved baseline: its own domain
    // separator, its own schema label, twenty fields. The labels are the first bytes hashed, so a V1
    // encoding can never be read as stating a baseline, a V2 encoding can never be read as V1, and the
    // same definition with a different baseline - or with none - is a different digest.
    let (domain, schema, field_count) = match n.digest_contract() {
        PhaseDefinitionContract::V1 => (DIGEST_DOMAIN_V1, DIGEST_SCHEMA_V1, DIGEST_FIELDS_V1),
        PhaseDefinitionContract::V2 => (DIGEST_DOMAIN_V2, DIGEST_SCHEMA_V2, DIGEST_FIELDS_V2),
    };
    put(&mut b, domain.as_bytes());
    put(&mut b, schema.as_bytes());
    b.extend_from_slice(&field_count.to_be_bytes());
    let version_s = version.0.to_string();
    let phase_type = format!("{:?}", n.phase_type);
    let repo = format!("{:?}", n.repository_policy);
    let provider = format!("{:?}", n.provider_policy);
    let effect = format!("{:?}", n.effect_policy);
    let residue = format!("{:?}", n.residue);
    put_field(&mut b, "plan", &[plan_ref.as_str()]);
    put_field(&mut b, "version", &[&version_s]);
    put_field(&mut b, "project", &[n.project.as_str()]);
    put_field(&mut b, "environment", &[n.environment.as_str()]);
    put_field(&mut b, "phase", &[&n.phase_id]);
    put_field(&mut b, "type", &[&phase_type]);
    put_field(&mut b, "scope", &as_strs(&n.scope));
    put_field(&mut b, "path_boundary", &as_strs(&n.path_boundary));
    put_field(&mut b, "allowed", &as_strs(&n.allowed_actions));
    put_field(&mut b, "prohibited", &as_strs(&n.prohibited_actions));
    put_field(&mut b, "dependencies", &as_strs(&n.dependencies));
    put_field(&mut b, "predecessors", &as_strs(&n.predecessors));
    put_field(&mut b, "repository_policy", &[&repo]);
    put_field(&mut b, "provider_policy", &[&provider]);
    put_field(&mut b, "effect_policy", &[&effect]);
    put_field(
        &mut b,
        "rollback",
        &[if n.rollback_required { "1" } else { "0" }],
    );
    put_field(
        &mut b,
        "shutdown",
        &[if n.shutdown_required { "1" } else { "0" }],
    );
    put_field(
        &mut b,
        "disconnect",
        &[if n.disconnect_required { "1" } else { "0" }],
    );
    put_field(&mut b, "residue", &[&residue]);
    if let Some(baseline) = &n.approved_baseline {
        put_field(&mut b, "baseline", &[baseline.as_str()]);
    }

    let out = Sha256::digest(&b);
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&out);
    PhaseDefinitionDigest { bytes }
}

/// The lowercase-hex SHA-256 of a normalized definition + plan reference + version, for DURABLE
/// SERIALISATION only (the persisted `storedDigestHex`). This is the integrity value the durable store
/// WRITES; the reload path RECOMPUTES it and compares, so it is never trusted on read. It is an
/// integrity tag, not authentication material or a secret; the opaque [`PhaseDefinitionDigest`] Debug
/// stays redacted for logs. There is still no way to originate a `PhaseDefinitionDigest` from a caller
/// hex string — this is a one-way projection for persistence.
#[must_use]
pub fn phase_definition_digest_hex(
    n: &NormalizedPhaseDefinition,
    plan_ref: &ApprovedPlanRef,
    version: ApprovedPlanVersion,
) -> String {
    phase_definition_digest(n, plan_ref, version)
        .bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Approved-plan record + binding
// ---------------------------------------------------------------------------------------------

/// The lifecycle status of an approved plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApprovedPlanStatus {
    /// Active and current.
    Active,
    /// A newer approved version exists.
    Superseded,
    /// Explicitly revoked.
    Revoked,
    /// Past its validity window.
    Stale,
}

/// The identity of one approved plan phase. Two bindings differ if ANY component differs. Fields are
/// crate-private; the only origin is [`approve_normalized_definition`].
#[derive(Clone, PartialEq, Eq)]
pub struct ApprovedPlanBinding {
    plan_ref: ApprovedPlanRef,
    version: ApprovedPlanVersion,
    digest: PhaseDefinitionDigest,
    project: ProjectId,
    environment: EnvironmentId,
    phase_id: String,
}

impl fmt::Debug for ApprovedPlanBinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApprovedPlanBinding([REDACTED])")
    }
}

impl ApprovedPlanBinding {
    /// The bound project.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The bound environment.
    #[must_use]
    pub fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    /// The stable phase id.
    #[must_use]
    pub fn phase_id(&self) -> &str {
        &self.phase_id
    }
    /// The plan reference.
    #[must_use]
    pub fn plan_ref(&self) -> &ApprovedPlanRef {
        &self.plan_ref
    }
    /// The plan version.
    #[must_use]
    pub fn version(&self) -> ApprovedPlanVersion {
        self.version
    }
    /// The digest bytes of the ALREADY-VALIDATED phase definition.
    ///
    /// WIDENED FROM `pub(crate)` IN PROJECTOS-HOST-REVIEW-PATH1A, and deliberately the smallest change
    /// that works: the host's plan-authority adapter lives outside this crate and has to report this
    /// exact value as `HostResolvedFacts.plan_digest`. Every alternative was worse — a second digest
    /// algorithm, a new mint, or trusting `stored_digest_hex` off the disk record, which the reload path
    /// exists to distrust.
    ///
    /// READ-ONLY, AND IT MINTS NOTHING. A `ValidatedApprovedPlan` can only be produced by the reload
    /// path, which re-normalizes the candidate, recomputes `phase_definition_digest` and compares it to
    /// what was stored — so these bytes are reachable only after that comparison passed. Handing them
    /// out confers no authority: a digest is a value, and `PhaseDefinitionDigest` still has no public
    /// constructor, no from-hex and no serde route, so nothing can travel back the other way.
    #[must_use]
    pub fn digest_bytes(&self) -> &[u8; 32] {
        &self.digest.bytes
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl ApprovedPlanBinding {
    /// TEST-ONLY: clone this binding but override ONLY the [`ApprovedPlanVersion`], keeping the SAME
    /// definition digest, plan reference, project, environment and phase id. This produces an
    /// intentionally inconsistent binding (its digest was computed at the original version) used SOLELY
    /// to isolate the version field in equality / context-comparison mutation evidence. Feature-gated
    /// and unreachable in a live graph; it mints no authority — it only rewrites one field of an
    /// already-validated binding, so it cannot make an unapproved plan authoritative.
    #[must_use]
    pub fn with_version_for_test(&self, version: ApprovedPlanVersion) -> Self {
        Self {
            version,
            ..self.clone()
        }
    }
}

/// Fold the approved-plan binding and the requested-operation policy into an already phase-bound
/// operation fingerprint. Changing the plan reference, version, digest or the requested policy changes
/// the fingerprint; the raw digest is hashed in, never exposed.
pub(crate) fn fold_operation_fingerprint(
    base: &OperationFingerprint,
    binding: &ApprovedPlanBinding,
    policy: &RequestedOperationPolicy,
) -> OperationFingerprint {
    let mut b: Vec<u8> = Vec::new();
    put(&mut b, base.as_str().as_bytes());
    put(&mut b, b"PROJECTOS:OPERATION-PLAN-BINDING:V1");
    put(&mut b, binding.plan_ref.as_str().as_bytes());
    put(&mut b, &binding.version.0.to_be_bytes());
    put(&mut b, binding.digest_bytes());
    put_field(&mut b, "action", &[policy.requested_action.as_str()]);
    put_field(&mut b, "scope", &as_strs(&policy.requested_scope));
    put_field(&mut b, "paths", &as_strs(&policy.requested_paths));
    put_field(&mut b, "deps", &as_strs(&policy.completed_dependencies));
    put_field(&mut b, "preds", &as_strs(&policy.closed_predecessors));
    let out = Sha256::digest(&b);
    let hex: String = out.iter().map(|byte| format!("{byte:02x}")).collect();
    OperationFingerprint::new(hex).expect("a 64-hex-digit token is a valid OperationFingerprint")
}

/// A protected, owner-approved plan record. Built ONLY by [`approve_normalized_definition`] (the
/// synthetic stand-in for the future owner-presence + journaled store path). Not serializable as
/// authority; no report can recreate it; recovery must revalidate.
#[derive(Clone, PartialEq, Eq)]
pub struct ApprovedPlanRecord {
    binding: ApprovedPlanBinding,
    definition: NormalizedPhaseDefinition,
    status: ApprovedPlanStatus,
}

impl fmt::Debug for ApprovedPlanRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ApprovedPlanRecord({:?}, [REDACTED])", self.status)
    }
}

impl ApprovedPlanRecord {
    /// The approved-plan binding.
    #[must_use]
    pub fn binding(&self) -> &ApprovedPlanBinding {
        &self.binding
    }
    /// The current status.
    #[must_use]
    pub fn status(&self) -> ApprovedPlanStatus {
        self.status
    }
}

/// Approve a normalized definition into a protected record. CRATE-PRIVATE origin of authority: in
/// production this is reached only after owner presence is verified and the record is journaled; the
/// synthetic test path and the future real path both funnel through here, so a caller cannot mint one.
pub(crate) fn approve_normalized_definition(
    plan_ref: ApprovedPlanRef,
    version: ApprovedPlanVersion,
    definition: &NormalizedPhaseDefinition,
    status: ApprovedPlanStatus,
) -> ApprovedPlanRecord {
    let digest = phase_definition_digest(definition, &plan_ref, version);
    ApprovedPlanRecord {
        binding: ApprovedPlanBinding {
            plan_ref,
            version,
            digest,
            project: definition.project.clone(),
            environment: definition.environment.clone(),
            phase_id: definition.phase_id.clone(),
        },
        definition: definition.clone(),
        status,
    }
}

/// Reload path (§6): reconstruct a protected record from UNTRUSTED stored parts and RECOMPUTE the
/// digest, refusing if the stored digest does not match the recomputation. A stored hexadecimal digest
/// is never trusted; the binding's digest is always the freshly computed one. This is the only bridge
/// from durable bytes to authority, and it is crate-private.
pub(crate) fn revalidate_stored_record(
    plan_ref: ApprovedPlanRef,
    version: ApprovedPlanVersion,
    definition: &NormalizedPhaseDefinition,
    stored_digest_hex: &str,
    status: ApprovedPlanStatus,
) -> Option<ApprovedPlanRecord> {
    let recomputed = phase_definition_digest(definition, &plan_ref, version);
    let recomputed_hex: String = recomputed
        .bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if !recomputed_hex.eq_ignore_ascii_case(stored_digest_hex) {
        return None; // stored digest does not match the recomputed authority content — fail closed.
    }
    Some(approve_normalized_definition(
        plan_ref, version, definition, status,
    ))
}

/// THE APPROVED BASELINE COMMIT of a governed phase: the exact commit the owner approved the phase
/// against, and therefore the fixed lower endpoint of every candidate difference reviewed under it.
///
/// PROJECTOS-HOST-REVIEW-PATH1B. Forty lower-case hex characters and nothing else — not a branch, not
/// a remote-tracking reference, not `HEAD`, not an abbreviation. It is WRITTEN ONCE, with the approval,
/// into the durable record; it is never derived, advanced or re-resolved at run time, so a candidate
/// cannot move the point it is measured from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovedBaselineCommit {
    hex: String,
}

impl ApprovedBaselineCommit {
    /// Validate one baseline commit identity. `None` for anything but 40 lower-case hex characters.
    #[must_use]
    pub fn parse(hex: &str) -> Option<Self> {
        let ok = hex.len() == 40
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        ok.then(|| Self {
            hex: hex.to_string(),
        })
    }

    /// The validated lower-case hex identity.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.hex
    }
}

/// A service-validated approved-plan fact: the binding plus its verified status. Produced by an
/// [`ApprovedPlanReader`] adapter; never crosses IPC; not serializable as authority.
#[derive(Clone, PartialEq, Eq)]
pub struct ValidatedApprovedPlan {
    binding: ApprovedPlanBinding,
    definition: NormalizedPhaseDefinition,
    status: ApprovedPlanStatus,
    status_revision: u64,
}

impl fmt::Debug for ValidatedApprovedPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ValidatedApprovedPlan({:?}, [REDACTED])", self.status)
    }
}

impl ValidatedApprovedPlan {
    /// Build from a protected record (the reader's job) at status revision 0. Crate-private so only an
    /// adapter inside the crate can produce a fact.
    pub(crate) fn from_record(record: &ApprovedPlanRecord) -> Self {
        Self {
            binding: record.binding.clone(),
            definition: record.definition.clone(),
            status: record.status,
            status_revision: 0,
        }
    }
    /// Build from a reloaded record at a specific durable status revision.
    pub(crate) fn from_reloaded(record: &ApprovedPlanRecord, status_revision: u64) -> Self {
        Self {
            binding: record.binding.clone(),
            definition: record.definition.clone(),
            status: record.status,
            status_revision,
        }
    }
    /// The approved baseline commit of this phase, from the APPROVED DEFINITION - the same value the
    /// phase-definition digest binds, so it is covered by the owner's approval and re-proven on every
    /// reload. NEVER a caller's value and never resolved from the repository: `None` is "no baseline was
    /// approved", and a review without one is refused.
    ///
    /// V1 CANNOT ANSWER. A plan approved under the historical contract bound no baseline, so there is
    /// none to return: the contract is checked FIRST and a V1 plan yields `None` whatever else is true of
    /// it. Baseline-required authority (the unattended Host review) therefore fails closed for every V1
    /// approval, by construction rather than by a caller remembering to ask.
    #[must_use]
    pub fn approved_baseline(&self) -> Option<&ApprovedBaselineCommit> {
        match self.digest_contract() {
            PhaseDefinitionContract::V1 => None,
            PhaseDefinitionContract::V2 => self.definition.approved_baseline.as_ref(),
        }
    }
    /// The phase-definition contract this approval's digest was computed - and re-proven on reload -
    /// under.
    #[must_use]
    pub fn digest_contract(&self) -> PhaseDefinitionContract {
        self.definition.digest_contract()
    }
    /// The durable status revision (bumped by revocation/supersession/staleness). Participates in
    /// execution-context comparison so a later status change invalidates an already-issued permit.
    #[must_use]
    pub fn status_revision(&self) -> u64 {
        self.status_revision
    }
    /// Authorise a requested operation policy against the approved definition.
    ///
    /// # Errors
    /// [`PlanPolicyRefusal`] on the first violation.
    pub fn authorises(&self, policy: &RequestedOperationPolicy) -> Result<(), PlanPolicyRefusal> {
        self.definition.authorises(policy)
    }
    /// The approved-plan binding.
    #[must_use]
    pub fn binding(&self) -> &ApprovedPlanBinding {
        &self.binding
    }
    /// The approved, normalized phase definition (for scope/action enforcement).
    #[must_use]
    pub fn definition(&self) -> &NormalizedPhaseDefinition {
        &self.definition
    }
    /// The status.
    #[must_use]
    pub fn status(&self) -> ApprovedPlanStatus {
        self.status
    }
    /// Whether this fact is an ACTIVE approval bound to exactly `required`.
    #[must_use]
    pub fn is_active_for(&self, required: &ApprovedPlanBinding) -> bool {
        self.status == ApprovedPlanStatus::Active && self.binding == *required
    }
}

/// The reader an adapter implements to yield a validated approved-plan fact for an operation's required
/// plan binding. A `None` return is treated by the reducer as "plan not verified" and denies.
pub trait ApprovedPlanReader {
    /// The validated approved-plan fact for the given required binding, if the protected store holds a
    /// matching active record.
    fn approved_plan_for(&self, required: &ApprovedPlanBinding) -> Option<ValidatedApprovedPlan>;
}

// ---------------------------------------------------------------------------------------------
// Journaled Intent/Commit store (pure state model)
// ---------------------------------------------------------------------------------------------
//
// host/core is pure logic (no I/O), so the durable byte-framing + filesystem journal live in
// host/store; this is the AUTHORITY-CRITICAL Intent/Commit STATE and the untrusted reload path the
// durable layer wraps. A record is authority-bearing only when its journal entry is COMMITTED and its
// reload fully revalidates.

/// A non-authoritative durable plan DTO. Everything here is UNTRUSTED after reload — the reload path
/// re-normalizes, RECOMPUTES the SHA-256, and rechecks every binding before any authority exists. The
/// `stored_digest_hex` is kept ONLY for comparison; it never becomes authority. This carries no permit,
/// no live `ValidatedApprovedPlan`, no secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanDurableDto {
    /// Canonical schema version the record was written under.
    pub schema_version: u32,
    /// Approved plan reference.
    pub plan_ref: ApprovedPlanRef,
    /// Approved plan version.
    pub version: ApprovedPlanVersion,
    /// The untrusted candidate inputs (re-normalized on reload).
    pub candidate: PhaseDefinitionCandidate,
    /// The stored digest, hex — for comparison only, never trusted as authority.
    pub stored_digest_hex: String,
    /// Stored status.
    pub status: ApprovedPlanStatus,
    /// Stored monotonic status revision (revocation/supersession/staleness bump it).
    pub status_revision: u64,
    /// Whether the journal entry reached Commit. An uncommitted (Intent-only) entry is never authority.
    pub committed: bool,
}

/// The baseline the synthetic test approval path records when a test does not name one.
#[cfg(any(test, feature = "test-fixtures"))]
pub const FIXTURE_BASELINE_COMMIT: &str = "b45e11e0b45e11e0b45e11e0b45e11e0b45e11e0";

/// The current schema version durable plan records are written under.
///
/// REVISION 2 (PROJECTOS-HOST-REVIEW-PATH1B): the candidate a record carries may state the phase's
/// approved baseline commit, which the phase-definition digest binds. A revision 1 record predates
/// that and is refused rather than read as though it had been approved against one.
pub const PLAN_SCHEMA_VERSION: u32 = 2;

/// Reload an untrusted DTO into a validated approved-plan fact, or refuse (fail closed). This is the
/// ONLY bridge from durable bytes to authority:
///   - an uncommitted (Intent-only) entry is refused;
///   - a wrong schema version is refused;
///   - the candidate is re-normalized (rejecting any malformed/contradictory content);
///   - the SHA-256 is RECOMPUTED and compared to the stored digest (refuse on mismatch);
///   - the reload is bound to `required` and refused unless active and exactly matching.
pub(crate) fn reload_and_validate(
    dto: &PlanDurableDto,
    required: &ApprovedPlanBinding,
) -> Option<ValidatedApprovedPlan> {
    if !dto.committed {
        return None; // Intent without Commit is never authority.
    }
    if dto.schema_version != PLAN_SCHEMA_VERSION {
        return None;
    }
    let normalized = normalize_candidate(&dto.candidate).ok()?;
    // Recompute + compare the digest, then rebuild the record from validated parts.
    let record = revalidate_stored_record(
        dto.plan_ref.clone(),
        dto.version,
        &normalized,
        &dto.stored_digest_hex,
        dto.status,
    )?;
    let fact = ValidatedApprovedPlan::from_reloaded(&record, dto.status_revision);
    // The fact must be ACTIVE and bound exactly to what the operation requires.
    if !fact.is_active_for(required) {
        return None;
    }
    Some(fact)
}

/// Adapter-facing reload: validate an UNTRUSTED durable plan DTO against the operation's required
/// approved-plan binding, or refuse (fail closed). This is the ONLY public bridge from durable bytes to
/// a [`ValidatedApprovedPlan`]. It delegates to the crate-private [`reload_and_validate`], so an
/// external durable adapter cannot bypass any check: an uncommitted (Intent-only) entry, a wrong schema
/// version, a malformed/contradictory candidate, a stored digest that does not match the freshly
/// recomputed SHA-256, or anything not ACTIVE and bound EXACTLY to `required` all yield `None`. There is
/// no public `PlanDurableDto` → authority conversion; every gate runs here in core.
#[must_use]
pub fn validate_durable_plan(
    dto: &PlanDurableDto,
    required: &ApprovedPlanBinding,
) -> Option<ValidatedApprovedPlan> {
    reload_and_validate(dto, required)
}

/// An in-memory approved-plan journal modelling Intent → Commit, revocation, supersession, staleness
/// and fail-closed recovery. The durable `host/store` layer frames these entries to disk; the authority
/// semantics are exactly what this pure model enforces.
#[derive(Debug, Default)]
pub struct ApprovedPlanJournal {
    entries: Vec<PlanDurableDto>,
}

impl ApprovedPlanJournal {
    /// A fresh, empty journal.
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Begin a write intent from an approved write authority. The entry is stored UNCOMMITTED and is not
    /// yet authority. Only a service-produced [`ApprovedPlanRecord`] can originate the candidate/digest,
    /// so a caller cannot inject an entry: this takes the approved record, not raw fields.
    pub(crate) fn begin_write_intent(
        &mut self,
        record: &ApprovedPlanRecord,
        candidate: &PhaseDefinitionCandidate,
        status_revision: u64,
    ) -> usize {
        let stored_digest_hex = record
            .binding
            .digest
            .bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        self.entries.push(PlanDurableDto {
            schema_version: PLAN_SCHEMA_VERSION,
            plan_ref: record.binding.plan_ref.clone(),
            version: record.binding.version,
            candidate: candidate.clone(),
            stored_digest_hex,
            status: record.status,
            status_revision,
            committed: false,
        });
        self.entries.len() - 1
    }

    /// Commit a pending intent. A duplicate commit of an already-committed entry is idempotent.
    pub(crate) fn commit(&mut self, intent: usize) {
        if let Some(e) = self.entries.get_mut(intent) {
            e.committed = true;
        }
    }

    /// Drop every uncommitted entry — fail-closed recovery after an interrupted write. No partial-active
    /// plan can survive.
    pub(crate) fn recover(&mut self) {
        self.entries.retain(|e| e.committed);
    }

    /// Set a new status + bumped revision on the active version of a plan (revoke/supersede/stale).
    pub(crate) fn set_status(
        &mut self,
        plan_ref: &ApprovedPlanRef,
        version: ApprovedPlanVersion,
        status: ApprovedPlanStatus,
        status_revision: u64,
    ) {
        for e in &mut self.entries {
            if e.plan_ref == *plan_ref && e.version == version {
                e.status = status;
                e.status_revision = status_revision;
            }
        }
    }

    /// Resolve the active validated plan for an operation's required binding, if a committed, uncorrupt,
    /// active, exactly-matching record exists. Fail closed otherwise.
    #[must_use]
    pub fn resolve_active(&self, required: &ApprovedPlanBinding) -> Option<ValidatedApprovedPlan> {
        self.entries
            .iter()
            .find_map(|dto| reload_and_validate(dto, required))
    }

    /// TEST-ONLY synthetic owner-approval + Intent/Commit path: normalize the candidate, approve it,
    /// journal an Intent, Commit, set the given status/revision, and resolve the fact. Gated behind
    /// `test-fixtures`; a live graph never enables it, so this cannot mint production authority. It is
    /// the mechanism-neutral synthetic approval the integration test drives through the public journal.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn commit_approved_for_test(
        &mut self,
        candidate: &PhaseDefinitionCandidate,
        version: u64,
        status: ApprovedPlanStatus,
        status_revision: u64,
    ) -> ValidatedApprovedPlan {
        self.commit_candidate_for_test(candidate, version, status, status_revision)
    }

    /// [`ApprovedPlanJournal::commit_approved_for_test`] over the same candidate approved AGAINST A
    /// BASELINE. The baseline is part of the definition, so this is a different approval with a
    /// different digest - exactly as it would be for an owner.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn commit_approved_with_baseline_for_test(
        &mut self,
        candidate: &PhaseDefinitionCandidate,
        version: u64,
        status: ApprovedPlanStatus,
        status_revision: u64,
        baseline: &ApprovedBaselineCommit,
    ) -> ValidatedApprovedPlan {
        let with_baseline = PhaseDefinitionCandidate {
            approved_baseline: Some(baseline.as_str().to_string()),
            ..candidate.clone()
        };
        self.commit_candidate_for_test(&with_baseline, version, status, status_revision)
    }

    #[cfg(any(test, feature = "test-fixtures"))]
    fn commit_candidate_for_test(
        &mut self,
        candidate: &PhaseDefinitionCandidate,
        version: u64,
        status: ApprovedPlanStatus,
        status_revision: u64,
    ) -> ValidatedApprovedPlan {
        let normalized = normalize_candidate(candidate).expect("valid fixture candidate");
        let record = approve_normalized_definition(
            ApprovedPlanRef::new("plan-1").expect("valid ref"),
            ApprovedPlanVersion(version),
            &normalized,
            ApprovedPlanStatus::Active,
        );
        let required = record.binding().clone();
        let intent = self.begin_write_intent(&record, candidate, 0);
        self.commit(intent);
        if status != ApprovedPlanStatus::Active || status_revision != 0 {
            self.set_status(
                required.plan_ref(),
                required.version(),
                status,
                status_revision,
            );
        }
        // Resolve regardless of active status so the integration test can obtain the (possibly inactive)
        // fact and its binding; the reducer, not this fixture, enforces active status.
        self.entries
            .iter()
            .find(|d| d.plan_ref == required.plan_ref().clone() && d.version == required.version())
            .map(|d| {
                let n = normalize_candidate(&d.candidate).expect("valid");
                let rec = revalidate_stored_record(
                    d.plan_ref.clone(),
                    d.version,
                    &n,
                    &d.stored_digest_hex,
                    d.status,
                )
                .expect("consistent fixture");
                ValidatedApprovedPlan::from_reloaded(&rec, d.status_revision)
            })
            .expect("committed fixture resolves")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate() -> PhaseDefinitionCandidate {
        PhaseDefinitionCandidate {
            phase_id: "phase-x".into(),
            phase_type: PhaseType::SourceOnly,
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            scope: vec!["b".into(), "a".into(), "a".into()],
            path_boundary: vec!["src/x".into(), "src/y".into()],
            allowed_actions: vec!["read".into()],
            prohibited_actions: vec!["write".into()],
            dependencies: vec!["dep-1".into()],
            predecessors: vec!["pre-1".into()],
            repository_policy: RepositoryPolicy::ReadOnly,
            provider_policy: ProviderPolicy::None,
            effect_policy: EffectPolicy::ObservationOnly,
            rollback_required: true,
            shutdown_required: true,
            disconnect_required: true,
            residue: ResidueRequirement::ExactlyZero,
            approved_baseline: None,
        }
    }

    fn pref() -> ApprovedPlanRef {
        ApprovedPlanRef::new("plan-1").unwrap()
    }
    fn dig(c: &PhaseDefinitionCandidate, v: u64) -> PhaseDefinitionDigest {
        phase_definition_digest(
            &normalize_candidate(c).unwrap(),
            &pref(),
            ApprovedPlanVersion(v),
        )
    }

    #[test]
    fn sha256_known_answer_vector() {
        // Proves the underlying hash is genuine SHA-256, not FNV: SHA-256("abc").
        let out = Sha256::digest(b"abc");
        let hex: String = out.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn digest_is_thirty_two_bytes() {
        let d = dig(&candidate(), 1);
        assert_eq!(d.bytes.len(), 32);
    }

    #[test]
    fn normalization_sorts_sets_and_preserves_boundary_order() {
        let n = normalize_candidate(&candidate()).unwrap();
        assert_eq!(n.scope, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(
            n.path_boundary,
            vec!["src/x".to_string(), "src/y".to_string()]
        );
    }

    #[test]
    fn digest_is_stable_and_format_insensitive() {
        let mut a = candidate();
        a.scope = vec![" b ".into(), "a".into()];
        let mut b = candidate();
        b.scope = vec!["a".into(), "b".into()];
        assert_eq!(dig(&a, 1), dig(&b, 1));
    }

    #[test]
    fn digest_changes_with_every_authority_field() {
        let base = dig(&candidate(), 1);
        // version
        assert_ne!(base, dig(&candidate(), 2));
        let mut c = candidate();
        c.allowed_actions = vec!["read".into(), "delete".into()];
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.prohibited_actions = vec!["write".into(), "publish".into()];
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.project = ProjectId::new("other").unwrap();
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.environment = EnvironmentId::new("prod").unwrap();
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.phase_id = "phase-y".into();
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.phase_type = PhaseType::Observation;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.scope = vec!["a".into(), "b".into(), "c".into()];
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.path_boundary = vec!["src/y".into(), "src/x".into()]; // order is semantic
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.dependencies = vec!["dep-2".into()];
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.predecessors = vec!["pre-2".into()];
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.repository_policy = RepositoryPolicy::PinnedBaseline;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.provider_policy = ProviderPolicy::ReadOnly;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.effect_policy = EffectPolicy::None;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.rollback_required = false;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.shutdown_required = false;
        assert_ne!(base, dig(&c, 1));
        let mut c = candidate();
        c.disconnect_required = false;
        assert_ne!(base, dig(&c, 1));
    }

    #[test]
    fn plan_ref_change_changes_digest() {
        let n = normalize_candidate(&candidate()).unwrap();
        let a = phase_definition_digest(
            &n,
            &ApprovedPlanRef::new("plan-1").unwrap(),
            ApprovedPlanVersion(1),
        );
        let b = phase_definition_digest(
            &n,
            &ApprovedPlanRef::new("plan-2").unwrap(),
            ApprovedPlanVersion(1),
        );
        assert_ne!(a, b);
    }

    #[test]
    fn length_prefix_prevents_field_merge_collisions() {
        // Two definitions that would collide under delimiter-only concatenation must differ under the
        // length-prefixed encoding: moving a character from one field's value into the next.
        let mut a = candidate();
        a.allowed_actions = vec!["readmore".into()];
        a.prohibited_actions = vec!["x".into()];
        let mut b = candidate();
        b.allowed_actions = vec!["read".into()];
        b.prohibited_actions = vec!["morex".into()];
        assert_ne!(dig(&a, 1), dig(&b, 1));
    }

    #[test]
    fn contradictory_actions_are_rejected() {
        let mut c = candidate();
        c.prohibited_actions = vec!["read".into()];
        assert_eq!(
            normalize_candidate(&c),
            Err(NormalizeError::ContradictoryActions)
        );
    }

    #[test]
    fn ambiguous_path_boundary_is_rejected() {
        let mut c = candidate();
        c.path_boundary = vec!["src/x".into(), "src/x".into()];
        assert_eq!(
            normalize_candidate(&c),
            Err(NormalizeError::AmbiguousPathBoundary)
        );
    }

    #[test]
    fn dependency_and_predecessor_self_cycles_are_rejected() {
        let mut c = candidate();
        c.dependencies = vec!["phase-x".into()];
        assert_eq!(
            normalize_candidate(&c),
            Err(NormalizeError::DependencyCycle)
        );
        let mut c = candidate();
        c.predecessors = vec!["phase-x".into()];
        assert_eq!(
            normalize_candidate(&c),
            Err(NormalizeError::PredecessorCycle)
        );
    }

    fn stored_hex(c: &PhaseDefinitionCandidate, v: u64) -> String {
        dig(c, v).bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn reload_recomputes_the_digest_and_accepts_a_matching_store() {
        let n = normalize_candidate(&candidate()).unwrap();
        let rec = revalidate_stored_record(
            pref(),
            ApprovedPlanVersion(1),
            &n,
            &stored_hex(&candidate(), 1),
            ApprovedPlanStatus::Active,
        );
        assert!(rec.is_some());
    }

    #[test]
    fn reload_fails_closed_on_a_corrupt_or_mismatched_stored_digest() {
        let n = normalize_candidate(&candidate()).unwrap();
        // Wrong stored digest (as if the durable record were tampered) → refused.
        assert!(revalidate_stored_record(
            pref(),
            ApprovedPlanVersion(1),
            &n,
            "00000000000000000000000000000000000000000000000000000000000000ff",
            ApprovedPlanStatus::Active,
        )
        .is_none());
        // A stored digest for a DIFFERENT version does not match this reload → refused.
        assert!(revalidate_stored_record(
            pref(),
            ApprovedPlanVersion(1),
            &n,
            &stored_hex(&candidate(), 2),
            ApprovedPlanStatus::Active,
        )
        .is_none());
    }

    #[test]
    fn is_active_for_requires_active_status_and_the_exact_binding() {
        let n = normalize_candidate(&candidate()).unwrap();
        let active = ValidatedApprovedPlan::from_record(&approve_normalized_definition(
            pref(),
            ApprovedPlanVersion(1),
            &n,
            ApprovedPlanStatus::Active,
        ));
        let required = active.binding().clone();
        assert!(active.is_active_for(&required));

        // A non-active status never authorises, even with the exact binding.
        for status in [
            ApprovedPlanStatus::Revoked,
            ApprovedPlanStatus::Superseded,
            ApprovedPlanStatus::Stale,
        ] {
            let inactive = ValidatedApprovedPlan::from_record(&approve_normalized_definition(
                pref(),
                ApprovedPlanVersion(1),
                &n,
                status,
            ));
            assert!(
                !inactive.is_active_for(&required),
                "{status:?} must not authorise"
            );
        }

        // A different version's binding does not match.
        let other = ValidatedApprovedPlan::from_record(&approve_normalized_definition(
            pref(),
            ApprovedPlanVersion(2),
            &n,
            ApprovedPlanStatus::Active,
        ));
        assert!(!other.is_active_for(&required));
    }

    #[test]
    fn approved_definition_enforces_allowed_and_prohibited_actions() {
        let plan = ValidatedApprovedPlan::from_record(&approve_normalized_definition(
            pref(),
            ApprovedPlanVersion(1),
            &normalize_candidate(&candidate()).unwrap(),
            ApprovedPlanStatus::Active,
        ));
        assert!(plan.definition().allows_action("read"));
        assert!(!plan.definition().allows_action("delete"));
        assert!(plan.definition().prohibits_action("write"));
        assert!(!plan.definition().prohibits_action("read"));
    }

    fn approved(
        v: u64,
        status: ApprovedPlanStatus,
    ) -> (ApprovedPlanRecord, PhaseDefinitionCandidate) {
        let c = candidate();
        let n = normalize_candidate(&c).unwrap();
        (
            approve_normalized_definition(pref(), ApprovedPlanVersion(v), &n, status),
            c,
        )
    }

    #[test]
    fn intent_without_commit_is_never_authority() {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let required = rec.binding().clone();
        j.begin_write_intent(&rec, &cand, 1);
        // Not committed → no authority; recovery drops it.
        assert!(j.resolve_active(&required).is_none());
        j.recover();
        assert!(j.resolve_active(&required).is_none());
    }

    #[test]
    fn committed_active_plan_resolves_and_reload_revalidates() {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let required = rec.binding().clone();
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        let fact = j
            .resolve_active(&required)
            .expect("committed active plan resolves");
        assert!(fact.is_active_for(&required));
    }

    // ---- PROJECTOS-HOST-REVIEW-PATH1B: THE APPROVED BASELINE IS BOUND BY THE DEFINITION DIGEST --------

    fn with_baseline(hex: &str) -> PhaseDefinitionCandidate {
        PhaseDefinitionCandidate {
            approved_baseline: Some(hex.to_string()),
            ..candidate()
        }
    }

    // EVERY HEX VALUE BELOW WAS COMPUTED BY A SEPARATE IMPLEMENTATION written from the prose of the
    // encoding (`tools/pin_phase_definition_digest.py`, which first reproduces the historical V1 pin and
    // refuses to print anything if it cannot). None was copied from this crate's own output.
    const V1_HISTORICAL: &str = "26ab6bc977e0b5ccb4f217e7ce448174a5dcb7a781c12ec9eef11ce416cfc5e6";
    const V2_WITH_B: &str = "3a0f0d8236bba56529ab1a85864778825c71551864d4316d0ee96ecfca1a9a0e";
    const V2_WITH_OTHER_B: &str = "7120ffb9cda903f263f258cd85647834d4784e9918e99426510c0ad71d54f528";
    /// The twenty fields hashed under the V1 LABELS - what a baseline smuggled into V1 would produce.
    const V1_LABELS_OVER_A_BASELINE: &str =
        "9d53450338eef9fd22c33059f9cfda34070c0580a01985b99eaa5d2d7f240ded";
    /// The nineteen fields hashed under the V2 LABELS - what a V2 claim with no baseline would produce.
    const V2_LABELS_WITHOUT_A_BASELINE: &str =
        "971ae4c625acd41833b2b0cfc63ad3f6c5c34e869c0e84d910d80c09fb19ee44";

    fn hex_of(c: &PhaseDefinitionCandidate) -> String {
        phase_definition_digest_hex(&normalize_candidate(c).unwrap(), &pref(), ApprovedPlanVersion(1))
    }

    /// V1 COMPATIBILITY IS INTACT: the historical nineteen-field definition digests to exactly what it
    /// always did, under the contract it always had.
    #[test]
    fn v1_historical_digest_and_contract_are_unchanged() {
        let n = normalize_candidate(&candidate()).unwrap();
        assert_eq!(n.digest_contract(), PhaseDefinitionContract::V1);
        assert_eq!(hex_of(&candidate()), V1_HISTORICAL);
    }

    /// V2 BINDS THE BASELINE: a baseline-bearing definition is digested under V2, and changing B - by
    /// one nibble as much as by all of them - changes the V2 digest.
    #[test]
    fn v2_binds_the_approved_baseline_and_changing_it_changes_the_digest() {
        let n = normalize_candidate(&with_baseline(FIXTURE_BASELINE_COMMIT)).unwrap();
        assert_eq!(n.digest_contract(), PhaseDefinitionContract::V2);
        assert_eq!(hex_of(&with_baseline(FIXTURE_BASELINE_COMMIT)), V2_WITH_B);
        let other = format!("c{}", &FIXTURE_BASELINE_COMMIT[1..]);
        assert_eq!(hex_of(&with_baseline(&other)), V2_WITH_OTHER_B);
        assert_ne!(V2_WITH_B, V2_WITH_OTHER_B);
    }

    /// THE TWO CONTRACTS CANNOT BE READ AS ONE ANOTHER. No definition this crate can digest produces a
    /// baseline under the V1 labels, or the V2 labels without a baseline - and those are not merely
    /// "different values", they are the two specific cross-version encodings, computed independently.
    #[test]
    fn neither_contract_can_be_read_as_the_other() {
        for produced in [
            hex_of(&candidate()),
            hex_of(&with_baseline(FIXTURE_BASELINE_COMMIT)),
        ] {
            assert_ne!(produced, V1_LABELS_OVER_A_BASELINE);
            assert_ne!(produced, V2_LABELS_WITHOUT_A_BASELINE);
        }
    }

    /// THE WRONG VERSION FAILS CLOSED WHERE A BASELINE IS REQUIRED. A durable record that states a
    /// baseline but whose stored digest is a V1-LABELLED one - the historical digest of the same phase,
    /// or the twenty fields under V1 labels - is refused on reload: the stored digest is recomputed
    /// under the contract the DEFINITION demands (V2), and neither V1 value is that.
    #[test]
    fn a_v1_labelled_digest_cannot_authorise_a_baseline_bearing_record() {
        let approved = with_baseline(FIXTURE_BASELINE_COMMIT);
        let n = normalize_candidate(&approved).unwrap();
        let rec = approve_normalized_definition(pref(), ApprovedPlanVersion(1), &n, ApprovedPlanStatus::Active);
        let mut j = ApprovedPlanJournal::new();
        let intent = j.begin_write_intent(&rec, &approved, 1);
        j.commit(intent);
        // Non-vacuity: the honest V2 record reloads, and answers with its baseline.
        let honest = reload_and_validate(&j.entries[0], rec.binding()).expect("the V2 record reloads");
        assert_eq!(honest.digest_contract(), PhaseDefinitionContract::V2);
        assert_eq!(j.entries[0].stored_digest_hex, V2_WITH_B);

        for v1_labelled in [V1_HISTORICAL, V1_LABELS_OVER_A_BASELINE] {
            let mut dto = j.entries[0].clone();
            dto.stored_digest_hex = v1_labelled.to_string();
            assert!(
                reload_and_validate(&dto, rec.binding()).is_none(),
                "a V1-labelled digest authorised a baseline-bearing record"
            );
        }
    }

    /// V1 CANNOT SATISFY BASELINE-REQUIRED AUTHORITY. A V1 approval is valid - it still resolves, for
    /// what V1 always authorised - and it answers `None` for the baseline, which the unattended Host
    /// review refuses.
    #[test]
    fn a_v1_approval_stays_valid_and_never_yields_a_baseline() {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        let fact = j.resolve_active(rec.binding()).expect("a V1 approval still resolves");
        assert_eq!(fact.digest_contract(), PhaseDefinitionContract::V1);
        assert!(fact.approved_baseline().is_none());
    }

    /// WRONG B FAILS THE AUTHORITY CHECK. A record approved against one baseline cannot answer for a
    /// binding approved against another - or against none - because they are different digests.
    #[test]
    fn a_plan_approved_against_one_baseline_does_not_resolve_for_another() {
        let approve = |c: &PhaseDefinitionCandidate| {
            let n = normalize_candidate(c).unwrap();
            approve_normalized_definition(pref(), ApprovedPlanVersion(1), &n, ApprovedPlanStatus::Active)
        };
        let approved = with_baseline(FIXTURE_BASELINE_COMMIT);
        let rec = approve(&approved);
        let mut j = ApprovedPlanJournal::new();
        let intent = j.begin_write_intent(&rec, &approved, 1);
        j.commit(intent);

        let fact = j.resolve_active(rec.binding()).expect("the exact approval resolves");
        assert_eq!(
            fact.approved_baseline().map(ApprovedBaselineCommit::as_str),
            Some(FIXTURE_BASELINE_COMMIT)
        );

        let other = format!("c{}", &FIXTURE_BASELINE_COMMIT[1..]);
        assert!(j.resolve_active(approve(&with_baseline(&other)).binding()).is_none());
        assert!(j.resolve_active(approve(&candidate()).binding()).is_none());
    }

    /// A STORED RECORD WHOSE BASELINE WAS EDITED NO LONGER MATCHES ITS STORED DIGEST, so the reload
    /// refuses it. This is what store custody alone could not give: the edit is DETECTED, not trusted.
    #[test]
    fn a_baseline_edited_in_the_durable_record_fails_the_digest_recomputation() {
        let approved = with_baseline(FIXTURE_BASELINE_COMMIT);
        let n = normalize_candidate(&approved).unwrap();
        let rec = approve_normalized_definition(pref(), ApprovedPlanVersion(1), &n, ApprovedPlanStatus::Active);
        let mut j = ApprovedPlanJournal::new();
        let intent = j.begin_write_intent(&rec, &approved, 1);
        j.commit(intent);
        assert!(reload_and_validate(&j.entries[0], rec.binding()).is_some());

        let other = format!("c{}", &FIXTURE_BASELINE_COMMIT[1..]);
        for edited in [Some(other), None] {
            let mut dto = j.entries[0].clone();
            dto.candidate.approved_baseline = edited.clone();
            assert!(
                reload_and_validate(&dto, rec.binding()).is_none(),
                "{edited:?} was accepted although the owner approved another baseline"
            );
        }
    }

    /// A BASELINE THAT IS NOT AN EXACT COMMIT IS REFUSED AT NORMALIZATION, never coerced; absent is
    /// simply "no baseline", and a review without one is refused downstream.
    #[test]
    fn a_malformed_baseline_is_refused_and_an_absent_one_is_none() {
        for bad in [
            "",
            "HEAD",
            "main",
            "refs/remotes/origin/main",
            "b45e11e0",
            "B45E11E0B45E11E0B45E11E0B45E11E0B45E11E0",
            "b45e11e0b45e11e0b45e11e0b45e11e0b45e11e0b45e11e0b45e11e0b45e11e0",
            "b45e11e0b45e11e0b45e11e0b45e11e0b45e11e ",
        ] {
            assert_eq!(
                normalize_candidate(&with_baseline(bad)).unwrap_err(),
                NormalizeError::ApprovedBaselineMalformed,
                "{bad:?}"
            );
        }
        let (rec, _) = approved(1, ApprovedPlanStatus::Active);
        assert!(ValidatedApprovedPlan::from_record(&rec).approved_baseline().is_none());
        // Revision 1 records predate the field and are refused.
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        let mut old = j.entries[0].clone();
        old.schema_version = 1;
        assert!(reload_and_validate(&old, rec.binding()).is_none());
        assert_eq!(PLAN_SCHEMA_VERSION, 2);
    }

    #[test]
    fn revoked_superseded_stale_committed_plans_never_resolve_active() {
        for status in [
            ApprovedPlanStatus::Revoked,
            ApprovedPlanStatus::Superseded,
            ApprovedPlanStatus::Stale,
        ] {
            let mut j = ApprovedPlanJournal::new();
            let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
            let required = rec.binding().clone();
            let intent = j.begin_write_intent(&rec, &cand, 1);
            j.commit(intent);
            assert!(j.resolve_active(&required).is_some());
            // A durable status change to revoked/superseded/stale removes active authority.
            j.set_status(required.plan_ref(), required.version(), status, 2);
            assert!(
                j.resolve_active(&required).is_none(),
                "{status:?} must not resolve active"
            );
        }
    }

    // Status-specific isolation of the reload active-status guard: one test per non-active status so a
    // filtered invocation fails on exactly that status (never short-circuiting on Revoked first).
    fn committed_then_status(
        status: ApprovedPlanStatus,
    ) -> (ApprovedPlanJournal, ApprovedPlanBinding) {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let required = rec.binding().clone();
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        assert!(j.resolve_active(&required).is_some());
        j.set_status(required.plan_ref(), required.version(), status, 2);
        (j, required)
    }

    #[test]
    fn a_committed_revoked_plan_never_resolves_active() {
        let (j, required) = committed_then_status(ApprovedPlanStatus::Revoked);
        assert!(
            j.resolve_active(&required).is_none(),
            "Revoked must not resolve active"
        );
    }

    #[test]
    fn a_committed_superseded_plan_never_resolves_active() {
        let (j, required) = committed_then_status(ApprovedPlanStatus::Superseded);
        assert!(
            j.resolve_active(&required).is_none(),
            "Superseded must not resolve active"
        );
    }

    #[test]
    fn a_committed_stale_plan_never_resolves_active() {
        let (j, required) = committed_then_status(ApprovedPlanStatus::Stale);
        assert!(
            j.resolve_active(&required).is_none(),
            "Stale must not resolve active"
        );
    }

    #[test]
    fn a_corrupt_stored_digest_never_resolves() {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let required = rec.binding().clone();
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        // Tamper the durable digest directly (as a corrupt store would) — reload recompute refuses.
        j.entries[intent].stored_digest_hex =
            "00000000000000000000000000000000000000000000000000000000000000ff".into();
        assert!(j.resolve_active(&required).is_none());
    }

    #[test]
    fn a_wrong_required_binding_never_resolves() {
        let mut j = ApprovedPlanJournal::new();
        let (rec, cand) = approved(1, ApprovedPlanStatus::Active);
        let intent = j.begin_write_intent(&rec, &cand, 1);
        j.commit(intent);
        // A different version's required binding does not match the committed v1 record.
        let (other, _) = approved(2, ApprovedPlanStatus::Active);
        assert!(j.resolve_active(other.binding()).is_none());
    }

    fn policy() -> RequestedOperationPolicy {
        RequestedOperationPolicy {
            requested_action: "read".into(),
            requested_scope: vec!["a".into()],
            requested_paths: vec!["src/x/file".into()],
            completed_dependencies: vec!["dep-1".into()],
            closed_predecessors: vec!["pre-1".into()],
        }
    }

    #[test]
    fn a_conforming_policy_is_authorised() {
        let n = normalize_candidate(&candidate()).unwrap();
        assert_eq!(n.authorises(&policy()), Ok(()));
    }

    #[test]
    fn policy_violations_fail_closed_with_precise_reasons() {
        let n = normalize_candidate(&candidate()).unwrap();
        let mut p = policy();
        p.requested_action = "write".into(); // prohibited
        assert_eq!(n.authorises(&p), Err(PlanPolicyRefusal::ProhibitedAction));
        let mut p = policy();
        p.requested_action = "delete".into(); // not allowed
        assert_eq!(
            n.authorises(&p),
            Err(PlanPolicyRefusal::AllowedActionMissing)
        );
        let mut p = policy();
        p.requested_scope = vec!["z".into()];
        assert_eq!(n.authorises(&p), Err(PlanPolicyRefusal::ScopeMismatch));
        let mut p = policy();
        p.requested_paths = vec!["src/other/f".into()]; // outside boundary
        assert_eq!(
            n.authorises(&p),
            Err(PlanPolicyRefusal::PathBoundaryMismatch)
        );
        let mut p = policy();
        p.completed_dependencies = vec![];
        assert_eq!(
            n.authorises(&p),
            Err(PlanPolicyRefusal::DependencyIncomplete)
        );
        let mut p = policy();
        p.closed_predecessors = vec![];
        assert_eq!(
            n.authorises(&p),
            Err(PlanPolicyRefusal::PredecessorIncomplete)
        );
    }

    #[test]
    fn path_boundary_rejects_traversal_absolute_and_sibling() {
        let approved = vec!["src/x".to_string()];
        assert!(path_within_boundary(&approved, "src/x"));
        assert!(path_within_boundary(&approved, "src/x/deep/file"));
        assert!(!path_within_boundary(&approved, "src/y")); // sibling
        assert!(!path_within_boundary(&approved, "src/x/../y")); // traversal
        assert!(!path_within_boundary(&approved, "/etc/passwd")); // absolute
        assert!(!path_within_boundary(&approved, "src\\x")); // backslash bypass
        assert!(!path_within_boundary(&approved, "..")); // escape
        assert!(!path_within_boundary(&approved, "")); // empty
    }

    #[test]
    fn digest_and_record_debug_are_redacted() {
        let d = dig(&candidate(), 1);
        assert_eq!(format!("{d:?}"), "PhaseDefinitionDigest([REDACTED])");
        let rec = approve_normalized_definition(
            pref(),
            ApprovedPlanVersion(1),
            &normalize_candidate(&candidate()).unwrap(),
            ApprovedPlanStatus::Active,
        );
        assert!(format!("{rec:?}").contains("[REDACTED]"));
        assert!(!format!("{:?}", rec.binding()).contains("phase-x"));
        // The full 64-hex-char digest never appears: the Debug output is exactly the redacted marker.
        assert!(!format!("{d:?}").contains(
            &dig(&candidate(), 1)
                .bytes
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        ));
    }
}
