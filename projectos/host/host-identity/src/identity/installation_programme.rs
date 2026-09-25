//! THE TRUSTED INSTALLATION PROGRAMME — RUN-TO-COMPLETION HOST ATTESTATION §10A.
//!
//! ## The question this module answers
//!
//! "Which programme is THIS installation?" — asked and answered by the Host, from material an owner
//! signed, before any owner programme delegation is compared against anything.
//!
//! ## Why it cannot come from the delegation
//!
//! The delegation under test names a project and a repository. Comparing a record against values
//! copied out of that same record is a tautology, and the accepted design says so in as many words:
//! `ExpectedProgramme` has no production constructor precisely because the source below was not
//! wired. This is that source.
//!
//! ## Why it cannot come from the working tree
//!
//! The allowlist is one of the three artefacts inside the owner-signed EXECUTION CLOSURE. The bytes
//! this module reads are the bytes [`verify_execution_closure`] has just proven are (a) committed in
//! the installation's own object store and (b) named, by digest, in a manifest the owner's key
//! signed. A file sitting in the working tree satisfies neither, and there is no argument here
//! through which one could arrive: the caller hands over bytes, and bytes that do not match the
//! signed digest are refused before they are parsed.
//!
//! ## What it will not do
//!
//! It opens no file, runs no process, contacts nothing and holds no credential. It is a pure
//! function over bytes the caller has already read, so every property below is provable without a
//! disk, an installation or an owner key.

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::identity::errors::IdentityError;
use crate::identity::manifest::TrustManifest;
use crate::identity::mode::Policy;
use crate::identity::production_verifier::ProductionEs256Verifier;
use crate::identity::verifier::TrustManifestSignatureVerifier;
use crate::identity::{verify_execution_closure, CommittedClosureBytes};

/// Width of a programme identity digest, matching the owner programme delegation's fields.
pub const PROGRAMME_IDENTITY_DIGEST_LEN: usize = 32;

/// THE ONE domain tag under which a programme identity is digested.
///
/// A domain tag rather than a bare hash of the text, and a per-field tag beneath it, so a project
/// literally named `github.com/x/y` can never produce the same digest as a repository of that name.
/// Without the field tag, "the programme this installation is" and "the repository it lives in"
/// would share a namespace, and a delegation naming one would satisfy a comparison against the
/// other.
pub const PROGRAMME_IDENTITY_DOMAIN: &[u8] = b"projectos.programme-identity.v1";

/// The field tag for a project identity.
const FIELD_PROJECT: &[u8] = b"project";

/// The field tag for a canonical repository identity.
const FIELD_REPOSITORY: &[u8] = b"repository";

/// The field tag for a canonical approved-plan identity (the plan REFERENCE, never its contents).
///
/// A FOURTH, FIFTH AND SIXTH TAG UNDER THE SAME DOMAIN, NOT A SECOND IDENTITY SYSTEM. The owner
/// programme delegation names its plan, its phases, its model policy and its credential reference as
/// digests of those IDENTIFIERS, and until now only `project` and `repository` had a tag — so the two
/// sides of that record had no shared way to spell the rest. Adding tags beneath the existing domain
/// is exactly the extension this construction was built for ("a per-field tag beneath it"); inventing
/// a second domain, or a generic public `identity_digest`, would have been the drift this module
/// already exists to prevent.
const FIELD_PLAN: &[u8] = b"plan";

/// The field tag for a canonical phase identity (the phase id, never its definition).
///
/// DISTINCT FROM `phase_definition_digest`, DELIBERATELY. That digest is the integrity value over a
/// normalized phase DEFINITION's nineteen authority fields, and it answers "is this definition the one
/// that was approved". This tag answers a different question — "which phase is this" — which is what
/// the delegation's `allowed_phases` holds. Using one where the other is meant produces a permanent
/// refusal, so they are separate by construction.
const FIELD_PHASE: &[u8] = b"phase";

/// The field tag for a canonical model-policy identity.
const FIELD_MODEL_POLICY: &[u8] = b"model-policy";

/// The field tag for a canonical credential-reference identity. A PURPOSE, never a secret.
const FIELD_CREDENTIAL_REF: &[u8] = b"credential-ref";

/// The largest allowlist document this module will parse.
///
/// A BOUND, NOT A GUESS. The committed allowlist is about 2 KiB today and lists one project; 64 KiB
/// is far beyond any plausible growth and far too small to be a channel for anything else. The bytes
/// are already digest-bound by the time they reach the parser, so this is a belt on top of a brace —
/// but an unbounded parse is not a thing to leave to the next reader.
pub const MAX_ALLOWLIST_BYTES: usize = 64 * 1024;

/// The most entries an allowlist may carry.
pub const MAX_ALLOWLIST_ENTRIES: usize = 64;

/// THE ONE canonical identity digest: the domain tag, the field tag and the value, each
/// length-prefixed so no two distinct (field, value) pairs encode to the same bytes.
///
/// Length-prefixed rather than separator-joined: a separator can appear inside a value, and a value
/// containing one would let two different pairs hash identically. A big-endian `u32` length cannot.
#[must_use]
fn identity_digest(field: &[u8], value: &[u8]) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    let mut h = Sha256::new();
    h.update((PROGRAMME_IDENTITY_DOMAIN.len() as u32).to_be_bytes());
    h.update(PROGRAMME_IDENTITY_DOMAIN);
    h.update((field.len() as u32).to_be_bytes());
    h.update(field);
    h.update((value.len() as u32).to_be_bytes());
    h.update(value);
    h.finalize().into()
}

/// THE canonical project identity digest, exported so a signer cannot re-derive it from prose.
///
/// The owner's signing tooling has to write these exact 32 bytes into a delegation record, and it
/// lives outside this repository. Left as a private function documented in English, a second
/// implementation would have had to reproduce the domain tag, the field tag AND the length
/// prefixes from a paragraph — and the most natural mistakes (drop the field tag, join with a
/// separator instead of length-prefixing) are exactly the two this construction exists to prevent.
/// The likely outcome of drift is a permanent refusal rather than a forgery, but "our signer and our
/// verifier disagree and nobody can say why" is not a state worth designing in. Raised by the ECC
/// security review.
///
/// Exporting it grants nothing: a digest is not authority, and
/// [`AttestedInstallationProgramme`] still has exactly one production route.
#[must_use]
pub fn project_identity_digest(project_id: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_PROJECT, project_id.as_bytes())
}

/// THE canonical repository identity digest. Companion to [`project_identity_digest`]; the two are
/// separate functions rather than one taking a field name so a caller cannot put a repository under
/// the project tag by passing the wrong string.
#[must_use]
pub fn repository_identity_digest(repository: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_REPOSITORY, repository.as_bytes())
}

/// THE canonical approved-plan identity digest, over the plan REFERENCE.
///
/// ONE TYPED HELPER PER FIELD, and `identity_digest` stays private. A public
/// `identity_digest(field, value)` would let a caller choose the tag, which is the one thing the
/// per-field tag exists to stop: a plan reference placed under the phase tag would satisfy a
/// comparison it should never satisfy. Six tags therefore mean six functions, each of which can only
/// spell one kind of identity.
#[must_use]
pub fn plan_identity_digest(plan_ref: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_PLAN, plan_ref.as_bytes())
}

/// THE canonical phase identity digest, over the phase ID.
///
/// This is what an owner programme delegation's `allowed_phases` entries are, and what the host
/// resolves for `HostResolvedFacts.phase`. It is NOT `phase_definition_digest` — see [`FIELD_PHASE`].
#[must_use]
pub fn phase_identity_digest(phase_id: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_PHASE, phase_id.as_bytes())
}

/// THE canonical model-policy identity digest.
#[must_use]
pub fn model_policy_identity_digest(model_policy: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_MODEL_POLICY, model_policy.as_bytes())
}

/// THE canonical credential-reference identity digest.
///
/// A REFERENCE OR PURPOSE, NEVER A CREDENTIAL. The value hashed here is the name by which a
/// credential is looked up, which is why the delegation can carry it in the clear: it is the same
/// class of value as a project id. Nothing here reads, resolves or holds a secret.
#[must_use]
pub fn credential_ref_identity_digest(credential_ref: &str) -> [u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
    identity_digest(FIELD_CREDENTIAL_REF, credential_ref.as_bytes())
}

/// Why an installation programme could not be attested.
///
/// COARSE ON PURPOSE, in the same way every other refusal taxonomy in this tree is: it names the
/// gate that refused, never the value that failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProgrammeAttestationError {
    /// The manifest, its signature, its version or its execution closure did not verify. The
    /// underlying identity refusal is carried so an operator is not left guessing which gate spoke.
    ClosureRefused(IdentityError),
    /// The allowlist exceeded [`MAX_ALLOWLIST_BYTES`], carried too many entries, or did not parse
    /// under the strict contract.
    AllowlistMalformed,
    /// An entry carried a wildcard. This list can never be widened to "every project".
    AllowlistWildcard,
    /// The Host's own governed root was not a usable installation root.
    GovernedRootInvalid,
    /// No entry in the owner-signed allowlist is this installation.
    ProgrammeNotListed,
    /// More than one entry claims this installation's governed root. Ambiguity is refused, never
    /// resolved by picking the first.
    ProgrammeAmbiguous,
}

/// The Host's own governed root: the installation directory this Host is bound to.
///
/// SEALED, AND NORMALISED ONCE. There is no public field and no `Default`; the only route is
/// [`HostGovernedRoot::from_installation_root`], which normalises separator spelling and case so
/// that `C:\dev\ProjectOS` and `c:/dev/projectos` are the same root — which on Windows they are.
/// Two spellings of one root would otherwise be two programmes, and an installation could be told it
/// is not itself.
///
/// IT IS NOT CALLER DATA IN THE COMPOSED PATH. The composition takes it from the Host's own
/// installation configuration, never from a request; this type exists so that the value which
/// reaches the resolver has been through exactly one normalisation and one validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostGovernedRoot {
    normalised: String,
}

impl HostGovernedRoot {
    /// Normalise and validate one installation root.
    ///
    /// # Errors
    /// [`ProgrammeAttestationError::GovernedRootInvalid`] for an empty, over-long, non-graphic or
    /// wildcard-bearing root.
    pub fn from_installation_root(root: &str) -> Result<Self, ProgrammeAttestationError> {
        let normalised =
            normalise_root(root).ok_or(ProgrammeAttestationError::GovernedRootInvalid)?;
        Ok(Self { normalised })
    }

    /// The normalised root, for comparison only.
    #[must_use]
    pub fn as_normalised(&self) -> &str {
        &self.normalised
    }
}

/// Normalise a root, or refuse it.
///
/// Backslashes become forward slashes, ASCII case is folded, and a trailing separator is dropped —
/// the three ways the same Windows directory is routinely written down. Anything non-graphic, empty,
/// over-long or wildcard-bearing is refused rather than normalised into something.
///
/// IT DOES NOT CANONICALISE, AND THAT IS A WIRING OBLIGATION RATHER THAN A CHECK THIS CAN MAKE. `..`
/// segments, `.` segments, short (8.3) names, substituted drives, junctions and symlinks are all
/// left exactly as written, so two spellings of one real directory that differ in any of those ways
/// will not match. Both sides of the comparison are trusted here — one is owner-signed, the other is
/// the Host's own installation configuration — so this is an availability obligation, not a security
/// hole: a mismatch REFUSES. Whoever wires the real Windows resolver must hand this an already
/// canonicalised absolute path. Raised by the ECC security review.
fn normalise_root(root: &str) -> Option<String> {
    if root.is_empty() || root.len() > 512 {
        return None;
    }
    if !root.bytes().all(|b| b.is_ascii_graphic() || b == b' ') {
        return None;
    }
    if root.contains('*') || root.contains('?') {
        return None;
    }
    let swapped: String = root
        .chars()
        .map(|c| {
            if c == '\\' {
                '/'
            } else {
                c.to_ascii_lowercase()
            }
        })
        .collect();
    let trimmed = swapped.trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// One entry of the installation's committed project allowlist.
///
/// The prose fields the document carries (`note`, and anything a later revision adds) are ignored
/// rather than refused: this is a governance document written for people as much as for code, and a
/// strict `deny_unknown_fields` here would make adding an explanatory line a breaking change. What
/// is NOT tolerant is everything that decides anything — the three identity fields are required, and
/// a missing one is a parse failure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllowlistEntry {
    project_id: String,
    repository: String,
    governed_root: String,
}

/// The installation's committed project allowlist.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllowlistDocument {
    projects: Vec<AllowlistEntry>,
}

/// The programme THIS installation is, proven from owner-signed material.
///
/// SEALED. Private fields, no public constructor, no `Default`. The ONLY route is
/// [`attest_installation_programme`], so possession IS the proof that an owner-signed execution
/// closure named exactly this project and this repository for exactly this installation root.
///
/// It carries digests, never the names. A programme identity that rendered its own project id would
/// invite a comparison against a string somebody typed, which is the very thing the digest exists to
/// prevent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestedInstallationProgramme {
    _seal: Seal,
    project: [u8; PROGRAMME_IDENTITY_DIGEST_LEN],
    repository: [u8; PROGRAMME_IDENTITY_DIGEST_LEN],
}

/// Private seal. A value carrying this cannot be written outside this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Seal;

impl AttestedInstallationProgramme {
    /// FIXTURE ONLY. Compiled for this crate's tests and the non-default `test-fixtures` graph,
    /// never for a shipped build.
    ///
    /// It exists so a DOWNSTREAM authority boundary can be exercised without a signing ceremony —
    /// the Host composition needs an attested programme to compose anything, and no test anywhere
    /// can produce a production-signed manifest, because ProjectOS does not hold the owner's private
    /// key. It mints no owner authority of its own: an attested programme says which installation
    /// this is, and every gate that follows still has to agree.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(
        project: [u8; PROGRAMME_IDENTITY_DIGEST_LEN],
        repository: [u8; PROGRAMME_IDENTITY_DIGEST_LEN],
    ) -> Self {
        Self {
            _seal: Seal,
            project,
            repository,
        }
    }

    /// Digest of this installation's project identity.
    #[must_use]
    pub fn project(&self) -> &[u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
        &self.project
    }

    /// Digest of this installation's canonical repository identity.
    #[must_use]
    pub fn repository(&self) -> &[u8; PROGRAMME_IDENTITY_DIGEST_LEN] {
        &self.repository
    }
}

/// Attest the programme this installation is, from the owner-signed execution closure.
///
/// THE ORDER IS THE CONTROL:
///
/// 1. The manifest's signature and the whole execution closure are established FIRST, over the
///    committed bytes the caller supplies. Parsing the allowlist before this would mean reading a
///    governance document that nobody had yet shown was the owner's.
/// 2. Only then are the ALREADY-VERIFIED allowlist bytes parsed. They are the same slice — not a
///    re-read — so there is no window in which the file could change between the digest check and
///    the parse.
/// 3. The Host's own governed root selects the entry. The allowlist does not get to say which of its
///    entries this installation is, and neither does a request: an installation that is not listed
///    is refused, and an ambiguous list is refused rather than resolved.
///
/// FAILS CLOSED THROUGHOUT. There is no fallback, no default programme and no "if the closure could
/// not be established, trust the file anyway".
///
/// NO POLICY ARGUMENT AND NO VERIFIER ARGUMENT. Both are fixed here: the embedded production anchor
/// under production policy. A caller that could name either would be a caller who decides what a
/// valid owner signature is, and this crate exports no route to a verifier for exactly that reason.
///
/// # Errors
/// [`ProgrammeAttestationError`] naming the gate that refused.
pub fn attest_installation_programme(
    manifest: &TrustManifest,
    committed: &CommittedClosureBytes<'_>,
    governed_root: &HostGovernedRoot,
) -> Result<AttestedInstallationProgramme, ProgrammeAttestationError> {
    attest_under_policy(
        manifest,
        Policy::Production,
        &ProductionEs256Verifier::from_embedded(),
        committed,
        governed_root,
    )
}

/// The one verification order, shared by the production facade above and by this module's tests.
///
/// CRATE-PRIVATE, AND THE POLICY IS THE ONLY THING THAT VARIES. `TrustManifestSignatureVerifier` is
/// deliberately not exported by this crate, so no caller ANYWHERE can supply a verifier, and this
/// function is not public either, so no caller can select the weaker policy. It is `pub(crate)`
/// rather than module-private for one reason: the version-2 manifest fixtures live in this crate's
/// own test module, and a duplicate set of them here is how two fixtures quietly stop agreeing. A
/// test that exercised a parallel implementation would be evidence about the test, so there is
/// exactly one order and both entry points run it.
pub(crate) fn attest_under_policy(
    manifest: &TrustManifest,
    policy: Policy,
    verifier: &dyn TrustManifestSignatureVerifier,
    committed: &CommittedClosureBytes<'_>,
    governed_root: &HostGovernedRoot,
) -> Result<AttestedInstallationProgramme, ProgrammeAttestationError> {
    // 1. THE OWNER'S SIGNATURE OVER THE WHOLE CLOSURE, before a single byte is interpreted.
    verify_execution_closure(manifest, policy, verifier, committed)
        .map_err(ProgrammeAttestationError::ClosureRefused)?;

    // 2. The verified allowlist bytes. `verify_execution_closure` refuses a `None` here, so this is
    //    unreachable in practice — and is still a refusal rather than an `expect`, because a gate
    //    whose safety depends on another gate having run is a gate with a bypass.
    let bytes = committed
        .installation_project_allowlist
        .ok_or(ProgrammeAttestationError::AllowlistMalformed)?;
    resolve_attested_programme(bytes, governed_root)
}

/// Step 3, after the closure has been established: resolve the one entry that is this installation.
///
/// MODULE-PRIVATE, not merely crate-private. It ASSUMES the bytes are owner-signed, which is exactly
/// why nothing outside this module may call it — the assumption is discharged by
/// [`attest_installation_programme`] and nowhere else. It is a separate function so the selection
/// rules can be proven directly: no owner has signed a version 2 manifest yet, so a test that could
/// only enter through the production signature could never reach these branches at all.
fn resolve_attested_programme(
    bytes: &[u8],
    governed_root: &HostGovernedRoot,
) -> Result<AttestedInstallationProgramme, ProgrammeAttestationError> {
    if bytes.len() > MAX_ALLOWLIST_BYTES {
        return Err(ProgrammeAttestationError::AllowlistMalformed);
    }
    let doc: AllowlistDocument =
        serde_json::from_slice(bytes).map_err(|_| ProgrammeAttestationError::AllowlistMalformed)?;
    if doc.projects.is_empty() || doc.projects.len() > MAX_ALLOWLIST_ENTRIES {
        return Err(ProgrammeAttestationError::AllowlistMalformed);
    }

    // A WILDCARD ANYWHERE REFUSES THE WHOLE DOCUMENT, not just the entry carrying it. Skipping the
    // offending entry and carrying on would let a list that tried to widen itself still answer, and
    // the committed file's own trust basis says wildcards are refused by the reader.
    for entry in &doc.projects {
        if has_wildcard(&entry.project_id)
            || has_wildcard(&entry.repository)
            || has_wildcard(&entry.governed_root)
        {
            return Err(ProgrammeAttestationError::AllowlistWildcard);
        }
        if entry.project_id.is_empty() || entry.repository.is_empty() {
            return Err(ProgrammeAttestationError::AllowlistMalformed);
        }
    }

    let mut matched: Option<&AllowlistEntry> = None;
    for entry in &doc.projects {
        let normalised = normalise_root(&entry.governed_root)
            .ok_or(ProgrammeAttestationError::AllowlistMalformed)?;
        if normalised != governed_root.as_normalised() {
            continue;
        }
        // AMBIGUITY IS REFUSED, NOT RESOLVED. Two entries claiming one root disagree about what this
        // installation is; picking either would be choosing an answer nobody wrote down.
        if matched.is_some() {
            return Err(ProgrammeAttestationError::ProgrammeAmbiguous);
        }
        matched = Some(entry);
    }
    let entry = matched.ok_or(ProgrammeAttestationError::ProgrammeNotListed)?;

    Ok(AttestedInstallationProgramme {
        _seal: Seal,
        project: identity_digest(FIELD_PROJECT, entry.project_id.as_bytes()),
        repository: identity_digest(FIELD_REPOSITORY, entry.repository.as_bytes()),
    })
}

/// Whether a field carries a glob character. `*` and `?` are the two spellings that would turn one
/// entry into many.
fn has_wildcard(value: &str) -> bool {
    value.contains('*') || value.contains('?')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed allowlist's real shape, including the prose fields the parser must tolerate.
    const REAL_SHAPE: &str = r#"{
      "schemaVersion": "1.0.0",
      "policy": "installation-project-allowlist",
      "note": "prose a person wrote",
      "projects": [
        {
          "projectId": "projectos",
          "repository": "github.com/universalbizcomply/ProjectOS",
          "note": "more prose",
          "governedRoot": "C:/dev/ProjectOS"
        }
      ]
    }"#;

    /// The digest of project `projectos` under the canonical rule, fixed as a literal.
    const PINNED_PROJECT_PROJECTOS: &str =
        "5aff876321f8441e1e44560ac9a32a8d8df06a06405d34f88093cd5053bc004f";
    /// The digest of repository `github.com/universalbizcomply/ProjectOS`, likewise.
    const PINNED_REPOSITORY_PROJECTOS: &str =
        "4f5e35ee29360ca7dea67e8f48ea07b06023da2e544190cd754334a343b7f074";

    fn root(s: &str) -> HostGovernedRoot {
        HostGovernedRoot::from_installation_root(s).expect("valid root")
    }

    /// THE POSITIVE CASE: the real committed shape resolves, and resolves to digests rather than
    /// names.
    #[test]
    fn the_committed_allowlist_shape_resolves_this_installation() {
        let p = resolve_attested_programme(REAL_SHAPE.as_bytes(), &root(r"C:\dev\ProjectOS"))
            .expect("listed");
        assert_eq!(
            p.project(),
            &identity_digest(FIELD_PROJECT, b"projectos"),
            "the project digest must be the canonical rule's, not an ad-hoc hash"
        );
        assert_eq!(
            p.repository(),
            &identity_digest(FIELD_REPOSITORY, b"github.com/universalbizcomply/ProjectOS")
        );
    }

    /// SEPARATOR AND CASE SPELLINGS OF ONE ROOT ARE ONE ROOT. An installation must not be told it is
    /// not itself because a path was written the other way round.
    #[test]
    fn root_spelling_does_not_change_the_programme() {
        let a = resolve_attested_programme(REAL_SHAPE.as_bytes(), &root(r"C:\dev\ProjectOS"))
            .expect("listed");
        let b = resolve_attested_programme(REAL_SHAPE.as_bytes(), &root("c:/DEV/projectos/"))
            .expect("listed");
        assert_eq!(a, b);
    }

    /// A PINNED TEST VECTOR. The exported digest rule is now something an out-of-repo signer must
    /// reproduce byte-for-byte, so it is fixed by a literal rather than by whatever this code
    /// currently computes. Changing the domain tag, a field tag or the length prefixing breaks this
    /// assertion, which is the point: that change is a wire-format break and must be seen as one.
    #[test]
    fn the_exported_identity_digest_rule_is_pinned() {
        let hex = |d: [u8; PROGRAMME_IDENTITY_DIGEST_LEN]| {
            d.iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        assert_eq!(
            hex(project_identity_digest("projectos")),
            PINNED_PROJECT_PROJECTOS
        );
        assert_eq!(
            hex(repository_identity_digest(
                "github.com/universalbizcomply/ProjectOS"
            )),
            PINNED_REPOSITORY_PROJECTOS
        );
    }

    /// A PROJECT AND A REPOSITORY OF THE SAME TEXT MUST NOT COLLIDE. Without the field tag, a
    /// delegation naming one would satisfy the comparison against the other.
    #[test]
    fn the_project_and_repository_namespaces_are_separate() {
        assert_ne!(
            identity_digest(FIELD_PROJECT, b"same"),
            identity_digest(FIELD_REPOSITORY, b"same")
        );
    }

    /// LENGTH-PREFIXED, so no two distinct values encode to the same bytes.
    #[test]
    fn identity_digests_are_injective_across_a_boundary() {
        assert_ne!(
            identity_digest(FIELD_PROJECT, b"ab"),
            identity_digest(FIELD_PROJECT, b"a\0b")
        );
        assert_ne!(
            identity_digest(b"project-x", b"y"),
            identity_digest(b"project", b"xy")
        );
    }

    /// AN INSTALLATION THAT IS NOT LISTED IS REFUSED. There is no default programme.
    #[test]
    fn an_unlisted_installation_is_refused() {
        assert_eq!(
            resolve_attested_programme(REAL_SHAPE.as_bytes(), &root(r"D:\somewhere\else")),
            Err(ProgrammeAttestationError::ProgrammeNotListed)
        );
    }

    /// A WILDCARD REFUSES THE WHOLE DOCUMENT. This list cannot be widened to "every project".
    #[test]
    fn a_wildcard_entry_refuses_the_document() {
        let doc = r#"{"projects":[{"projectId":"*","repository":"r","governedRoot":"C:/dev/ProjectOS"}]}"#;
        assert_eq!(
            resolve_attested_programme(doc.as_bytes(), &root("C:/dev/ProjectOS")),
            Err(ProgrammeAttestationError::AllowlistWildcard)
        );
        // Even when the wildcard is on an entry this installation is NOT: a list that tried to widen
        // itself does not get to answer anything.
        let other = r#"{"projects":[
            {"projectId":"projectos","repository":"r","governedRoot":"C:/dev/ProjectOS"},
            {"projectId":"x","repository":"*","governedRoot":"D:/other"}]}"#;
        assert_eq!(
            resolve_attested_programme(other.as_bytes(), &root("C:/dev/ProjectOS")),
            Err(ProgrammeAttestationError::AllowlistWildcard)
        );
    }

    /// TWO ENTRIES FOR ONE ROOT IS A REFUSAL, never "take the first".
    #[test]
    fn an_ambiguous_allowlist_is_refused() {
        let doc = r#"{"projects":[
            {"projectId":"a","repository":"r1","governedRoot":"C:/dev/ProjectOS"},
            {"projectId":"b","repository":"r2","governedRoot":"c:\\dev\\projectos"}]}"#;
        assert_eq!(
            resolve_attested_programme(doc.as_bytes(), &root("C:/dev/ProjectOS")),
            Err(ProgrammeAttestationError::ProgrammeAmbiguous)
        );
    }

    /// MALFORMED, EMPTY, OVERSIZED AND STRUCTURALLY INCOMPLETE DOCUMENTS ALL REFUSE.
    #[test]
    fn malformed_allowlists_are_refused() {
        let r = root("C:/dev/ProjectOS");
        for doc in [
            "not json",
            "{}",
            r#"{"projects":[]}"#,
            r#"{"projects":[{"projectId":"a","repository":"r"}]}"#,
            r#"{"projects":[{"projectId":"","repository":"r","governedRoot":"C:/dev/ProjectOS"}]}"#,
        ] {
            assert_eq!(
                resolve_attested_programme(doc.as_bytes(), &r),
                Err(ProgrammeAttestationError::AllowlistMalformed),
                "{doc}"
            );
        }
        let big = vec![b'x'; MAX_ALLOWLIST_BYTES + 1];
        assert_eq!(
            resolve_attested_programme(&big, &r),
            Err(ProgrammeAttestationError::AllowlistMalformed)
        );
    }

    /// AN UNUSABLE GOVERNED ROOT IS REFUSED RATHER THAN NORMALISED INTO SOMETHING.
    #[test]
    fn an_invalid_governed_root_is_refused() {
        for bad in ["", "/", "\\", "C:/dev/*", "C:/dev/Proj\nectOS"] {
            assert_eq!(
                HostGovernedRoot::from_installation_root(bad),
                Err(ProgrammeAttestationError::GovernedRootInvalid),
                "{bad:?}"
            );
        }
        assert!(HostGovernedRoot::from_installation_root(&"x".repeat(513)).is_err());
    }
}
