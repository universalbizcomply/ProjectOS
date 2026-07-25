//! Repository identity + baseline authority (CD-B4-REPOSITORY-BASELINE-ADAPTER1A, Pattern C).
//!
//! The opaque [`VerifiedRepositoryIdentity`] and [`VerifiedRepositoryBaseline`] are the ONLY
//! repository authority values in the core. They are minted ONLY by [`verify_repository_baseline`],
//! which consumes an UNTRUSTED [`GitRepositoryObservation`] (what an allowlisted read-only Git adapter
//! measured) and checks it against a [`RequiredRepository`] policy. A path string, a commit string, a
//! caller "clean=true", or a report can never mint one: every field is re-checked here, and the opaque
//! types have private fields, no public constructor, no `Default`, no serde-as-authority, and a redacted
//! Debug that never renders a raw absolute path.
//!
//! ## Local-only freshness honesty
//!
//! This phase performs NO network fetch. A local tracking reference is NOT proof of live-remote
//! freshness. [`RepositoryFreshness`] preserves that distinction so a later remote-verification phase
//! can EXTEND (not overwrite) the classification.

#![allow(dead_code)]

use core::fmt;

use sha2::{Digest, Sha256};

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, OperationRef, ProjectId};

use crate::phase::PhaseId;
use crate::plan::ApprovedPlanBinding;

// ---------------------------------------------------------------------------------------------
// Untrusted observation (what the Git adapter measured)
// ---------------------------------------------------------------------------------------------

/// The parsed, still-UNTRUSTED result of running the allowlisted read-only Git commands. Every field is
/// adapter-supplied and re-validated by [`verify_repository_baseline`]; nothing here is authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRepositoryObservation {
    /// Canonical worktree root (`git rev-parse --show-toplevel`, canonicalized by the adapter).
    pub canonical_root: String,
    /// Common git dir identity (`git rev-parse --git-common-dir`, canonicalized).
    pub common_dir: String,
    /// Whether the path is inside a work tree (`git rev-parse --is-inside-work-tree`).
    pub is_worktree: bool,
    /// HEAD commit object id (`git rev-parse HEAD`).
    pub head_oid: String,
    /// Current branch short name, or `None` for detached HEAD.
    pub branch: Option<String>,
    /// Staged (index) change count.
    pub staged: u32,
    /// Unstaged tracked change count.
    pub unstaged: u32,
    /// Untracked file count.
    pub untracked: u32,
    /// Whether an upstream tracking reference is configured.
    pub tracking_present: bool,
    /// Ahead count vs the local tracking ref (`None` when no tracking ref).
    pub ahead: Option<u32>,
    /// Behind count vs the local tracking ref (`None` when no tracking ref).
    pub behind: Option<u32>,
    /// Whether any submodule reports a dirty/changed state.
    pub submodule_dirty: bool,
    /// A monotonic observation-generation marker (freshness ordering; not a timestamp).
    pub generation: u64,
}

// ---------------------------------------------------------------------------------------------
// Required policy (what a repository-governed operation demands)
// ---------------------------------------------------------------------------------------------

/// The branch requirement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchPolicy {
    /// HEAD must be on exactly this branch.
    Exact(String),
    /// A detached HEAD is explicitly permitted.
    AllowDetached,
}

/// How ahead/behind counts are required.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DivergencePolicy {
    /// Requires a tracking ref present and ahead == behind == 0 (locally reconciled).
    ReconciledZero,
    /// No ahead/behind requirement (tracking ref optional).
    Unrestricted,
}

/// The minimum acceptable local-reference freshness. Never claims live-remote freshness in this phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequiredFreshness {
    /// A tracking ref must be present and ahead/behind resolved (locally reconciled).
    LocallyReconciled,
    /// A tracking ref present is sufficient (age unverified).
    TrackingPresent,
    /// No tracking requirement.
    Any,
}

/// The exact repository baseline a repository-governed operation requires. Non-authoritative input to
/// [`verify_repository_baseline`]; validated and folded into the operation fingerprint upstream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredRepository {
    /// Expected canonical worktree root.
    pub expected_root: String,
    /// Expected project identity this repository is bound to.
    pub expected_project: ProjectId,
    /// Expected HEAD commit object id.
    pub expected_commit: String,
    /// Branch requirement.
    pub branch_policy: BranchPolicy,
    /// Whether the worktree must be fully clean (no staged/unstaged/untracked).
    pub require_clean: bool,
    /// Whether submodules must be clean.
    pub require_submodules_clean: bool,
    /// Ahead/behind requirement.
    pub divergence_policy: DivergencePolicy,
    /// Minimum local-reference freshness.
    pub required_freshness: RequiredFreshness,
}

impl RequiredRepository {
    /// A collision-resistant digest of every LOAD-BEARING repository requirement, for folding into the
    /// operation fingerprint. Changing any requirement changes this value.
    pub(crate) fn fingerprint_material(&self) -> [u8; 32] {
        fn seg(h: &mut Sha256, s: &str) {
            h.update((s.len() as u32).to_be_bytes());
            h.update(s.as_bytes());
        }
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:REPOSITORY-POLICY:V1");
        seg(&mut h, &self.expected_root);
        seg(&mut h, self.expected_project.as_str());
        seg(&mut h, &self.expected_commit);
        match &self.branch_policy {
            BranchPolicy::Exact(b) => {
                h.update([1u8]);
                seg(&mut h, b);
            }
            BranchPolicy::AllowDetached => h.update([2u8]),
        }
        h.update([
            u8::from(self.require_clean),
            u8::from(self.require_submodules_clean),
            match self.divergence_policy {
                DivergencePolicy::ReconciledZero => 1,
                DivergencePolicy::Unrestricted => 2,
            },
            match self.required_freshness {
                RequiredFreshness::LocallyReconciled => 1,
                RequiredFreshness::TrackingPresent => 2,
                RequiredFreshness::Any => 3,
            },
        ]);
        h.finalize().into()
    }
}

/// Fold a repository requirement into an already-bound operation fingerprint. Changing any load-bearing
/// repository requirement changes the fingerprint; a non-repository-governed operation is untouched.
#[must_use]
pub fn fold_repository_fingerprint(
    base: &OperationFingerprint,
    required: &RequiredRepository,
) -> OperationFingerprint {
    let mut h = Sha256::new();
    h.update(base.as_str().as_bytes());
    h.update(b"PROJECTOS:OPERATION-REPOSITORY:V1");
    h.update(required.fingerprint_material());
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    OperationFingerprint::new(hex).expect("a 64-hex-digit token is a valid OperationFingerprint")
}

// ---------------------------------------------------------------------------------------------
// Freshness classification (result)
// ---------------------------------------------------------------------------------------------

/// The classified local-reference freshness of a verified baseline. NEVER asserts live-remote freshness
/// in this phase; a later phase extends this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RepositoryFreshness {
    /// Tracking ref present and ahead/behind resolved (locally reconciled; remote NOT verified).
    LocallyReconciled,
    /// Tracking ref present but not fetched (age unverified).
    TrackingPresentNotFetched,
    /// No tracking ref configured.
    TrackingAbsent,
    /// Live remote not verified (default honest ceiling for this phase).
    LiveNotVerified,
}

/// Branch state of a verified baseline.
#[derive(Clone, PartialEq, Eq)]
pub enum BranchState {
    /// On a named branch.
    OnBranch(String),
    /// Detached HEAD (only in an AllowDetached policy).
    Detached,
}

impl fmt::Debug for BranchState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BranchState::OnBranch(_) => f.write_str("BranchState::OnBranch([REDACTED])"),
            BranchState::Detached => f.write_str("BranchState::Detached"),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Opaque authority: identity + baseline
// ---------------------------------------------------------------------------------------------

/// A collision-resistant digest of a canonical path (raw absolute paths never leave this layer).
fn path_digest(domain: &str, path: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(domain.as_bytes());
    h.update([0u8]);
    h.update(path.as_bytes());
    h.finalize().into()
}

/// The opaque, verified repository identity. Private fields; no public constructor; redacted Debug; no
/// raw path rendered. Carries digests of the canonical root and common dir plus the bound project.
#[derive(Clone, PartialEq, Eq)]
pub struct VerifiedRepositoryIdentity {
    root_digest: [u8; 32],
    common_dir_digest: [u8; 32],
    project: ProjectId,
}

impl fmt::Debug for VerifiedRepositoryIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("VerifiedRepositoryIdentity([REDACTED])")
    }
}

impl VerifiedRepositoryIdentity {
    /// The bound project.
    #[must_use]
    pub fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The root digest bytes (crate-internal; folded into the fingerprint, never rendered).
    pub(crate) fn root_digest(&self) -> &[u8; 32] {
        &self.root_digest
    }
}

/// The opaque, verified repository baseline. Private fields; no public constructor; no `Default`; no
/// serde-as-authority; redacted Debug. Binds the identity, the exact commit, branch state, cleanliness
/// counts, ahead/behind, tracking presence, freshness classification, and the observation generation.
#[derive(Clone)]
pub struct VerifiedRepositoryBaseline {
    identity: VerifiedRepositoryIdentity,
    commit_oid: String,
    branch_state: BranchState,
    staged: u32,
    unstaged: u32,
    untracked: u32,
    tracking_present: bool,
    ahead: Option<u32>,
    behind: Option<u32>,
    submodule_dirty: bool,
    freshness: RepositoryFreshness,
    generation: u64,
}

impl fmt::Debug for VerifiedRepositoryBaseline {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "VerifiedRepositoryBaseline({:?}, {:?}, [REDACTED])",
            self.freshness, self.branch_state
        )
    }
}

// Baseline CONTENT equality — identity + commit + branch + cleanliness + divergence + submodule. The
// observation `generation` and the derived `freshness` are NOT content; they are compared as their own
// distinct execution-context fields, so a generation-only change is reported as RepositoryGeneration.
impl PartialEq for VerifiedRepositoryBaseline {
    fn eq(&self, other: &Self) -> bool {
        self.identity == other.identity
            && self.commit_oid == other.commit_oid
            && self.branch_state == other.branch_state
            && self.staged == other.staged
            && self.unstaged == other.unstaged
            && self.untracked == other.untracked
            && self.tracking_present == other.tracking_present
            && self.ahead == other.ahead
            && self.behind == other.behind
            && self.submodule_dirty == other.submodule_dirty
    }
}
impl Eq for VerifiedRepositoryBaseline {}

impl VerifiedRepositoryBaseline {
    /// The verified identity.
    #[must_use]
    pub fn identity(&self) -> &VerifiedRepositoryIdentity {
        &self.identity
    }
    /// The verified commit object id.
    #[must_use]
    pub fn commit_oid(&self) -> &str {
        &self.commit_oid
    }
    /// The freshness classification.
    #[must_use]
    pub fn freshness(&self) -> RepositoryFreshness {
        self.freshness
    }
    /// Whether the worktree was clean (no staged/unstaged/untracked and clean submodules).
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.staged == 0 && self.unstaged == 0 && self.untracked == 0 && !self.submodule_dirty
    }
    /// The observation generation this baseline was measured at.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Re-check this ALREADY-VERIFIED baseline against a required policy. A fact minted for one policy
    /// fails when presented to an operation requiring a different one. Fail closed on the first
    /// violation. (This re-derives the same rules as [`verify_repository_baseline`] over the stored,
    /// verified fields.)
    ///
    /// # Errors
    /// A [`RepositoryError`] naming the first mismatch.
    pub fn satisfies(&self, r: &RequiredRepository) -> Result<(), RepositoryError> {
        if self.identity.root_digest != path_digest("PROJECTOS:REPO-ROOT:V1", &r.expected_root) {
            return Err(RepositoryError::RepositoryRootMismatch);
        }
        if self.identity.project != r.expected_project {
            return Err(RepositoryError::ProjectMismatch);
        }
        if self.commit_oid != r.expected_commit {
            return Err(RepositoryError::CommitMismatch);
        }
        match (&r.branch_policy, &self.branch_state) {
            (BranchPolicy::Exact(w), BranchState::OnBranch(h)) if w == h => {}
            (BranchPolicy::Exact(_), BranchState::OnBranch(_)) => {
                return Err(RepositoryError::BranchMismatch)
            }
            (BranchPolicy::Exact(_), BranchState::Detached) => {
                return Err(RepositoryError::DetachedHeadRefused)
            }
            (BranchPolicy::AllowDetached, _) => {}
        }
        if r.require_clean {
            if self.staged != 0 {
                return Err(RepositoryError::StagedChangesPresent);
            }
            if self.unstaged != 0 {
                return Err(RepositoryError::UnstagedChangesPresent);
            }
            if self.untracked != 0 {
                return Err(RepositoryError::UntrackedFilesPresent);
            }
        }
        if r.require_submodules_clean && self.submodule_dirty {
            return Err(RepositoryError::SubmoduleMismatch);
        }
        if let DivergencePolicy::ReconciledZero = r.divergence_policy {
            if !self.tracking_present {
                return Err(RepositoryError::TrackingReferenceMissing);
            }
            if self.ahead != Some(0) {
                return Err(RepositoryError::AheadMismatch);
            }
            if self.behind != Some(0) {
                return Err(RepositoryError::BehindMismatch);
            }
        }
        if !freshness_sufficient(self.freshness, r.required_freshness) {
            return Err(RepositoryError::FreshnessInsufficient);
        }
        Ok(())
    }

    /// The commit-oid digest bytes for folding into the operation fingerprint (never rendered).
    pub(crate) fn fingerprint_material(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"PROJECTOS:REPOSITORY-BASELINE:V1");
        h.update(self.identity.root_digest);
        h.update([0u8]);
        h.update(self.commit_oid.as_bytes());
        h.update([0u8]);
        h.update(match &self.branch_state {
            BranchState::OnBranch(b) => b.as_str(),
            BranchState::Detached => "\x01detached",
        });
        h.finalize().into()
    }
}

// ---------------------------------------------------------------------------------------------
// Operation-bound repository fact
// ---------------------------------------------------------------------------------------------

/// A repository fact BOUND to exactly one operation. A bare [`VerifiedRepositoryBaseline`] proves a repo
/// was in a required state, but says nothing about WHICH operation may consume it; presenting the same
/// verified baseline through a fact bound to a different operation must be refused. This wrapper binds
/// the baseline to the operation's project, environment, phase, approved-plan binding, operation
/// reference and (phase+plan+repository-)folded fingerprint, plus the baseline's own observation
/// generation and freshness (cached so the reducer can prove fact↔baseline consistency).
///
/// Authority: the ONLY constructor is [`ValidatedRepositoryFact::bind`], which CONSUMES a real
/// `VerifiedRepositoryBaseline` (itself mintable only by [`verify_repository_baseline`]). There is no
/// `Default`, no public field, no serde, no `From<Path>`/`From<&str>`/`From<GitRepositoryObservation>`,
/// and a redacted `Debug`. Fields are immutable after binding, so a report or caller cannot rebind an
/// existing fact to another operation; targeting another operation requires a fresh verified baseline.
#[derive(Clone, PartialEq, Eq)]
pub struct ValidatedRepositoryFact {
    baseline: VerifiedRepositoryBaseline,
    project: ProjectId,
    environment: EnvironmentId,
    phase: PhaseId,
    plan_binding: Option<ApprovedPlanBinding>,
    operation: OperationRef,
    fingerprint: OperationFingerprint,
    generation: u64,
    freshness: RepositoryFreshness,
}

impl fmt::Debug for ValidatedRepositoryFact {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ValidatedRepositoryFact({:?}, [REDACTED])",
            self.freshness
        )
    }
}

impl ValidatedRepositoryFact {
    /// Bind a verified baseline to exactly one operation. The generation and freshness are copied from
    /// the baseline (never caller-supplied), so `generation()`/`freshness()` are always the baseline's
    /// unless a test-only mutator rewrites the cached scalar. Consumes the baseline: an owned
    /// `VerifiedRepositoryBaseline` is the authority gate — it cannot be forged.
    #[must_use]
    pub fn bind(
        baseline: VerifiedRepositoryBaseline,
        project: &ProjectId,
        environment: &EnvironmentId,
        phase: &PhaseId,
        plan_binding: Option<&ApprovedPlanBinding>,
        operation: &OperationRef,
        fingerprint: &OperationFingerprint,
    ) -> Self {
        let generation = baseline.generation();
        let freshness = baseline.freshness();
        Self {
            baseline,
            project: project.clone(),
            environment: environment.clone(),
            phase: phase.clone(),
            plan_binding: plan_binding.cloned(),
            operation: operation.clone(),
            fingerprint: fingerprint.clone(),
            generation,
            freshness,
        }
    }

    /// The verified baseline (crate-internal; the reducer re-checks it against the required policy).
    pub(crate) fn baseline(&self) -> &VerifiedRepositoryBaseline {
        &self.baseline
    }
    /// The bound project.
    pub(crate) fn project(&self) -> &ProjectId {
        &self.project
    }
    /// The bound environment.
    pub(crate) fn environment(&self) -> &EnvironmentId {
        &self.environment
    }
    /// The bound phase identity.
    pub(crate) fn phase(&self) -> &PhaseId {
        &self.phase
    }
    /// The bound approved-plan binding (`None` for a non-plan-governed operation).
    pub(crate) fn plan_binding(&self) -> Option<&ApprovedPlanBinding> {
        self.plan_binding.as_ref()
    }
    /// The bound operation reference.
    pub(crate) fn operation(&self) -> &OperationRef {
        &self.operation
    }
    /// The bound (phase+plan+repository-)folded operation fingerprint.
    pub(crate) fn fingerprint(&self) -> &OperationFingerprint {
        &self.fingerprint
    }
    /// The cached observation generation (must equal the baseline's).
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    /// The cached freshness (must equal the baseline's).
    pub(crate) fn freshness(&self) -> RepositoryFreshness {
        self.freshness
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl ValidatedRepositoryFact {
    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `generation` scalar, leaving the embedded
    /// baseline untouched. Produces an intentionally inconsistent fact (cached generation ≠ baseline
    /// generation) used SOLELY to prove the reducer's fact↔baseline generation-consistency check is
    /// load-bearing. Feature-gated, unreachable in a live graph; mints no authority.
    #[must_use]
    pub fn with_generation_for_test(&self, generation: u64) -> Self {
        Self {
            generation,
            ..self.clone()
        }
    }

    /// TEST-ONLY: clone this fact but rewrite ONLY the cached `freshness` scalar. As above, isolates the
    /// reducer's fact↔baseline freshness-consistency check.
    #[must_use]
    pub fn with_freshness_for_test(&self, freshness: RepositoryFreshness) -> Self {
        Self {
            freshness,
            ..self.clone()
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Error taxonomy (bounded, redacted — no raw path/listing/stderr)
// ---------------------------------------------------------------------------------------------

/// Why repository verification failed. Fail closed; every variant is payload-free (no raw path, file
/// listing, credential-helper output, environment, or Git stderr).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RepositoryError {
    /// The observation is not a valid Git worktree.
    RepositoryInvalid,
    /// The canonical root does not match the expected root.
    RepositoryRootMismatch,
    /// The HEAD commit object id is malformed.
    MalformedOid,
    /// HEAD is on the wrong branch.
    BranchMismatch,
    /// HEAD is detached where a branch is required.
    DetachedHeadRefused,
    /// The HEAD commit does not match the expected baseline.
    CommitMismatch,
    /// Staged (index) changes are present where a clean baseline is required.
    StagedChangesPresent,
    /// Unstaged tracked changes are present.
    UnstagedChangesPresent,
    /// Untracked files are present.
    UntrackedFilesPresent,
    /// A submodule reports a dirty/changed state.
    SubmoduleMismatch,
    /// An upstream tracking reference is required but absent.
    TrackingReferenceMissing,
    /// The ahead count is not as required.
    AheadMismatch,
    /// The behind count is not as required.
    BehindMismatch,
    /// The local-reference freshness classification is insufficient.
    FreshnessInsufficient,
    /// The project binding does not match.
    ProjectMismatch,
}

/// A valid Git object id: 40 (SHA-1) or 64 (SHA-256) lowercase hex characters.
#[must_use]
pub fn is_valid_oid(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64)
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

// ---------------------------------------------------------------------------------------------
// Verify: the ONLY authority mint
// ---------------------------------------------------------------------------------------------

/// Verify an UNTRUSTED [`GitRepositoryObservation`] against a [`RequiredRepository`] policy, minting a
/// [`VerifiedRepositoryBaseline`] or failing closed. This is the ONLY origin of repository authority;
/// every field is re-checked. A missing tracking reference is NEVER treated as ahead/behind 0/0.
///
/// # Errors
/// A [`RepositoryError`] naming the first violated rule.
pub fn verify_repository_baseline(
    obs: &GitRepositoryObservation,
    required: &RequiredRepository,
) -> Result<VerifiedRepositoryBaseline, RepositoryError> {
    // 1. Valid worktree + well-formed HEAD.
    if !obs.is_worktree || obs.canonical_root.is_empty() || obs.common_dir.is_empty() {
        return Err(RepositoryError::RepositoryInvalid);
    }
    if !is_valid_oid(&obs.head_oid) {
        return Err(RepositoryError::MalformedOid);
    }
    // 2. Root + project binding (exact canonical match).
    if obs.canonical_root != required.expected_root {
        return Err(RepositoryError::RepositoryRootMismatch);
    }
    // 3. Branch policy.
    let branch_state = match (&required.branch_policy, &obs.branch) {
        (BranchPolicy::Exact(want), Some(have)) if want == have => {
            BranchState::OnBranch(have.clone())
        }
        (BranchPolicy::Exact(_), Some(_)) => return Err(RepositoryError::BranchMismatch),
        (BranchPolicy::Exact(_), None) => return Err(RepositoryError::DetachedHeadRefused),
        (BranchPolicy::AllowDetached, Some(have)) => BranchState::OnBranch(have.clone()),
        (BranchPolicy::AllowDetached, None) => BranchState::Detached,
    };
    // 4. Commit baseline.
    if !is_valid_oid(&required.expected_commit) {
        return Err(RepositoryError::MalformedOid);
    }
    if obs.head_oid != required.expected_commit {
        return Err(RepositoryError::CommitMismatch);
    }
    // 5. Cleanliness (each class distinctly reported).
    if required.require_clean {
        if obs.staged != 0 {
            return Err(RepositoryError::StagedChangesPresent);
        }
        if obs.unstaged != 0 {
            return Err(RepositoryError::UnstagedChangesPresent);
        }
        if obs.untracked != 0 {
            return Err(RepositoryError::UntrackedFilesPresent);
        }
    }
    if required.require_submodules_clean && obs.submodule_dirty {
        return Err(RepositoryError::SubmoduleMismatch);
    }
    // 6. Divergence (a missing tracking ref is NOT 0/0).
    match required.divergence_policy {
        DivergencePolicy::ReconciledZero => {
            if !obs.tracking_present {
                return Err(RepositoryError::TrackingReferenceMissing);
            }
            if obs.ahead != Some(0) {
                return Err(RepositoryError::AheadMismatch);
            }
            if obs.behind != Some(0) {
                return Err(RepositoryError::BehindMismatch);
            }
        }
        DivergencePolicy::Unrestricted => {}
    }
    // 7. Freshness classification + policy floor.
    let freshness = classify_freshness(obs);
    if !freshness_sufficient(freshness, required.required_freshness) {
        return Err(RepositoryError::FreshnessInsufficient);
    }
    // 8. Mint.
    let identity = VerifiedRepositoryIdentity {
        root_digest: path_digest("PROJECTOS:REPO-ROOT:V1", &obs.canonical_root),
        common_dir_digest: path_digest("PROJECTOS:REPO-COMMONDIR:V1", &obs.common_dir),
        project: required.expected_project.clone(),
    };
    Ok(VerifiedRepositoryBaseline {
        identity,
        commit_oid: obs.head_oid.clone(),
        branch_state,
        staged: obs.staged,
        unstaged: obs.unstaged,
        untracked: obs.untracked,
        tracking_present: obs.tracking_present,
        ahead: obs.ahead,
        behind: obs.behind,
        submodule_dirty: obs.submodule_dirty,
        freshness,
        generation: obs.generation,
    })
}

fn classify_freshness(obs: &GitRepositoryObservation) -> RepositoryFreshness {
    if !obs.tracking_present {
        RepositoryFreshness::TrackingAbsent
    } else if obs.ahead.is_some() && obs.behind.is_some() {
        RepositoryFreshness::LocallyReconciled
    } else {
        RepositoryFreshness::TrackingPresentNotFetched
    }
}

fn freshness_sufficient(actual: RepositoryFreshness, required: RequiredFreshness) -> bool {
    use RepositoryFreshness as A;
    use RequiredFreshness as R;
    match required {
        R::Any => true,
        R::TrackingPresent => {
            matches!(actual, A::LocallyReconciled | A::TrackingPresentNotFetched)
        }
        R::LocallyReconciled => actual == A::LocallyReconciled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid() -> String {
        "0123456789abcdef0123456789abcdef01234567".to_string()
    }

    fn obs() -> GitRepositoryObservation {
        GitRepositoryObservation {
            canonical_root: "C:/repo".into(),
            common_dir: "C:/repo/.git".into(),
            is_worktree: true,
            head_oid: oid(),
            branch: Some("main".into()),
            staged: 0,
            unstaged: 0,
            untracked: 0,
            tracking_present: true,
            ahead: Some(0),
            behind: Some(0),
            submodule_dirty: false,
            generation: 1,
        }
    }

    fn required() -> RequiredRepository {
        RequiredRepository {
            expected_root: "C:/repo".into(),
            expected_project: ProjectId::new("proj").unwrap(),
            expected_commit: oid(),
            branch_policy: BranchPolicy::Exact("main".into()),
            require_clean: true,
            require_submodules_clean: true,
            divergence_policy: DivergencePolicy::ReconciledZero,
            required_freshness: RequiredFreshness::LocallyReconciled,
        }
    }

    #[test]
    fn a_clean_reconciled_repository_verifies() {
        let b = verify_repository_baseline(&obs(), &required()).unwrap();
        assert!(b.is_clean());
        assert_eq!(b.freshness(), RepositoryFreshness::LocallyReconciled);
        assert_eq!(b.commit_oid(), oid());
    }

    #[test]
    fn a_non_worktree_is_refused() {
        let mut o = obs();
        o.is_worktree = false;
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::RepositoryInvalid)
        );
    }

    #[test]
    fn a_wrong_root_is_refused() {
        let mut o = obs();
        o.canonical_root = "C:/other".into();
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::RepositoryRootMismatch)
        );
    }

    #[test]
    fn a_malformed_oid_is_refused() {
        let mut o = obs();
        o.head_oid = "nothex".into();
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::MalformedOid)
        );
    }

    #[test]
    fn a_wrong_branch_and_detached_are_refused() {
        let mut o = obs();
        o.branch = Some("dev".into());
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::BranchMismatch)
        );
        let mut o = obs();
        o.branch = None;
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::DetachedHeadRefused)
        );
    }

    #[test]
    fn detached_allowed_only_under_policy() {
        let mut o = obs();
        o.branch = None;
        let mut r = required();
        r.branch_policy = BranchPolicy::AllowDetached;
        assert!(matches!(
            verify_repository_baseline(&o, &r).unwrap().branch_state,
            BranchState::Detached
        ));
    }

    #[test]
    fn a_wrong_commit_is_refused() {
        let mut o = obs();
        o.head_oid = "89abcdef0123456789abcdef0123456789abcdef".into();
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::CommitMismatch)
        );
    }

    #[test]
    fn staged_unstaged_untracked_each_refuse_distinctly() {
        for (mut o, e) in [
            (obs(), RepositoryError::StagedChangesPresent),
            (obs(), RepositoryError::UnstagedChangesPresent),
            (obs(), RepositoryError::UntrackedFilesPresent),
        ] {
            match e {
                RepositoryError::StagedChangesPresent => o.staged = 1,
                RepositoryError::UnstagedChangesPresent => o.unstaged = 1,
                RepositoryError::UntrackedFilesPresent => o.untracked = 1,
                _ => unreachable!(),
            }
            assert_eq!(verify_repository_baseline(&o, &required()), Err(e));
        }
    }

    #[test]
    fn a_dirty_submodule_is_refused() {
        let mut o = obs();
        o.submodule_dirty = true;
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::SubmoduleMismatch)
        );
    }

    #[test]
    fn a_missing_tracking_ref_is_not_zero_zero() {
        let mut o = obs();
        o.tracking_present = false;
        o.ahead = None;
        o.behind = None;
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::TrackingReferenceMissing)
        );
    }

    #[test]
    fn ahead_and_behind_mismatches_refuse() {
        let mut o = obs();
        o.ahead = Some(1);
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::AheadMismatch)
        );
        let mut o = obs();
        o.behind = Some(2);
        assert_eq!(
            verify_repository_baseline(&o, &required()),
            Err(RepositoryError::BehindMismatch)
        );
    }

    #[test]
    fn insufficient_freshness_is_refused() {
        let mut o = obs();
        o.tracking_present = false;
        o.ahead = None;
        o.behind = None;
        let mut r = required();
        r.divergence_policy = DivergencePolicy::Unrestricted;
        r.required_freshness = RequiredFreshness::LocallyReconciled;
        // Tracking absent → classified TrackingAbsent → insufficient for LocallyReconciled.
        assert_eq!(
            verify_repository_baseline(&o, &r),
            Err(RepositoryError::FreshnessInsufficient)
        );
    }

    #[test]
    fn is_valid_oid_accepts_40_and_64_lowercase_hex_only() {
        assert!(is_valid_oid(&"a".repeat(40)));
        assert!(is_valid_oid(&"0".repeat(64)));
        assert!(!is_valid_oid(&"A".repeat(40))); // uppercase
        assert!(!is_valid_oid(&"a".repeat(39))); // wrong length
        assert!(!is_valid_oid("xyz"));
    }

    #[test]
    fn debug_is_redacted() {
        let b = verify_repository_baseline(&obs(), &required()).unwrap();
        let s = format!("{b:?}");
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains("C:/repo"));
        assert!(!s.contains(&oid()));
        assert!(!format!("{:?}", b.identity()).contains("C:/repo"));
    }
}
