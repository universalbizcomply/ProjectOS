//! Strict TrustManifest contract + parsing. Unknown fields are rejected (`deny_unknown_fields`) so
//! a tampered manifest cannot smuggle extra trust hints. The signature covers the canonical bytes of
//! every field EXCEPT `signature` (see canonical.rs). Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use serde::{Deserialize, Serialize};

use super::errors::IdentityError;
use super::types::InstallationModel;

/// Highest schema/manifest/protocol the code understands. A newer manifest fails closed.
pub const SUPPORTED_SCHEMA_VERSION: u32 = 1;
pub const SUPPORTED_MANIFEST_VERSION_MAX: u32 = 2;
pub const SUPPORTED_MIN_PROTOCOL_VERSION: u32 = 1;

/// The manifest version that carries the gatekeeper EXECUTION CLOSURE, and the only one that may
/// satisfy a host-attested gatekeeper execution.
///
/// A version 1 manifest is still a perfectly valid manifest of what it actually signed — a runtime
/// and a daemon. What it must never do is be read as though it had also covered the broker, the
/// allowlist and the credential adapter, because it did not: those bytes did not exist inside its
/// signed subject and no signature over it says anything about them. That is why the closure is
/// bound to a version rather than added as an optional extra to version 1 — an optional field would
/// make "closure absent" and "closure not required" the same state, and the difference between them
/// is the whole control.
pub const EXECUTION_CLOSURE_MANIFEST_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub relative_path: String,
    pub sha256: String,
    pub expected_version: String,
    pub platform: String,
    pub architecture: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DaemonArtefactManifest {
    pub relative_path: String,
    pub sha256: String,
    pub format: DaemonArtefactFormat,
    pub build_id: String,
}

/// The CLOSED set of daemon artefact formats this build understands.
///
/// It was a free `String` checked against one literal denylist entry (`"loose-modules"`), which is
/// the wrong shape for a trust decision: a denylist admits everything nobody thought to forbid, so
/// a manifest naming any new format would have been accepted as production identity by default.
/// An enum with `deny_unknown_fields` inverts that — an unrecognised format cannot be represented,
/// so it fails at parse rather than sailing through evaluation.
///
/// `LooseModules` remains representable ON PURPOSE. It is a real development shape, and deleting it
/// would only move the rejection from a place that explains itself to a parse error that does not.
/// Production refuses it explicitly in `evaluate()`.
///
/// Closed by the gatekeeper's PROJECTOS-RECOVERY-INSTALLED-APP1A preflight ruling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DaemonArtefactFormat {
    /// One bundled artefact whose bytes are hashed as a unit. The only production-eligible shape.
    SingleBundle,
    /// A directory of loose modules. Development only — hashing one file proves nothing about the
    /// rest, so it can never anchor production identity.
    LooseModules,
}

impl DaemonArtefactFormat {
    /// Whether this artefact shape may anchor production identity.
    pub const fn can_anchor_production(self) -> bool {
        matches!(self, DaemonArtefactFormat::SingleBundle)
    }
}

/// One artefact that is ATTESTED but NOT PACKAGED: bytes proven committed in the ProjectOS
/// installation's own git object store, hashed and named by the owner-signed manifest.
///
/// A DIFFERENT KIND OF EVIDENCE, IN A DIFFERENT KIND OF FIELD. `RuntimeManifest` and
/// `DaemonArtefactManifest` describe files that ship inside the payload, resolved beneath the
/// payload root and read off disk. These describe files that stay in the installation's repository
/// and are resolved through git. Sharing one type between them would make the manifest claim the
/// installation carries files it does not, and would let a payload-root read satisfy a check that
/// exists to require a committed one. The field name says `repositoryRelativePath` for the same
/// reason: it is a git pathspec, not a payload path.
///
/// NO FORMAT FIELD, DELIBERATELY. The daemon needs one because "one bundle" versus "a tree of loose
/// modules" changes what a single digest proves. Each of these is exactly one file by construction,
/// and a directory has no committed bytes to hash, so there is no second shape to distinguish.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommittedArtefactManifest {
    /// Forward-slashed path relative to the ProjectOS installation root, as git spells it.
    pub repository_relative_path: String,
    pub sha256: String,
}

/// The complete authority-bearing closure of a gatekeeper provider call.
///
/// ALL THREE OR NOTHING. They are one struct rather than three optional fields because they are one
/// fact: whether the ProjectOS-controlled inputs to a paid call are the owner-approved ones.
/// Attesting the broker alone would sign the program while leaving the allowlist that decides which
/// projects it will spend on, and the adapter it runs to reach the credential, outside the signed
/// subject — and both of those are read by the broker from the same place, through the same reader,
/// with the same consequences if they are wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExecutionClosureManifest {
    /// The trusted-side broker program whose bytes the caller executes via `node -e`.
    pub gatekeeper_broker: CommittedArtefactManifest,
    /// The installation's project allowlist — the first authority factor on every call.
    pub installation_project_allowlist: CommittedArtefactManifest,
    /// The adapter the broker runs to resolve the credential out of the Windows Credential Manager.
    pub credential_adapter: CommittedArtefactManifest,
    /// THE OWNER-SIGNED EXECUTION-COST POLICY. PROJECTOS-HOST-REVIEW-PATH1B.
    ///
    /// REQUIRED, WITH NO DEFAULT — deliberately not `Option` and deliberately without
    /// `#[serde(default)]`. A closure that does not state what a review may cost is not one the Host
    /// can reserve against, and "absent" must never be readable as "free". No owner has signed a
    /// version 2 manifest yet, so requiring these three fields invalidates no existing signature.
    pub cost_policy: ExecutionCostPolicyManifest,
    /// The MODEL POLICY, as canonical MACHINE-READABLE text: `<provider>/<model-id>`, for example
    /// `openai/gpt-5.6-terra`. See [`parse_model_policy`].
    ///
    /// IT IS THE HOST'S ONLY AUTHORITY FOR WHICH MODEL REVIEWS. The Host derives the model-policy
    /// identity digest from THESE EXACT BYTES under the owner's signature - the owner programme
    /// delegation's digest is only the cross-check, never the source - and resolves the model id from
    /// the same bytes. No agent, no broker and no default ever selects a model.
    pub model_policy: String,
    /// The CREDENTIAL REFERENCE, as canonical text: the NAME the Host resolves, never a credential.
    /// Same rule — the Host derives the identity digest from this signed text.
    pub credential_ref: String,
}

/// What the owner has signed that ONE independent review may be admitted to cost.
///
/// IT IS AN ADMITTED COST, NOT A BILL. The figure is what the Host reserves BEFORE a provider is
/// reached, because the fixed authority frames carry no cost and the Host holds no rate card. Nothing
/// here, and nothing derived from it, is ever described as actual or provider-billed cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExecutionCostPolicyManifest {
    /// The cost admitted for one independent review, in micro-USD. Non-zero and bounded.
    pub admitted_review_cost_micro_usd: u64,
}

/// Upper bound on the admitted cost of one review: 100 USD. A policy above it is refused as
/// malformed rather than obeyed, so a typo cannot authorise an unbounded reservation.
pub const MAX_ADMITTED_REVIEW_COST_MICRO_USD: u64 = 100_000_000;
/// Upper bound on the signed model-policy and credential-reference text.
pub const MAX_CLOSURE_POLICY_TEXT_LEN: usize = 256;

/// The providers a signed model policy may name. CLOSED: the trusted broker sends to one fixed provider
/// endpoint, so a policy naming any other provider is a policy nothing could carry out.
pub const MODEL_POLICY_PROVIDERS: &[&str] = &["openai"];

/// Resolve a signed model policy to `(provider, model id)`, or `None`.
///
/// ONE SPELLING, NO DEFAULTS. Exactly `<provider>/<model-id>`: a provider from the closed list, one
/// `/`, and a model id of 1..=64 characters drawn from lower-case letters, digits, `.`, `-` and `_`,
/// starting with a letter or digit. Anything else - an unknown provider, a missing part, upper case, a
/// second `/`, surrounding space - is `None`, and the closure is refused rather than read generously.
#[must_use]
pub fn parse_model_policy(text: &str) -> Option<(&str, &str)> {
    let (provider, model) = text.split_once('/')?;
    if !MODEL_POLICY_PROVIDERS.contains(&provider) {
        return None;
    }
    let first_ok = model
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    let rest_ok = model.len() <= 64
        && model.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_')
        });
    (first_ok && rest_ok).then_some((provider, model))
}

impl ExecutionClosureManifest {
    /// The signed policy facts, validated. `Err` names the field that is unusable.
    ///
    /// BOUNDED, NON-EMPTY, ASCII-GRAPHIC TEXT with no surrounding ambiguity: the identity digest is
    /// taken over these exact bytes, so there must be exactly one spelling of a given policy.
    pub fn check_policy_facts(&self) -> Result<(), IdentityError> {
        let cost = self.cost_policy.admitted_review_cost_micro_usd;
        if cost == 0 || cost > MAX_ADMITTED_REVIEW_COST_MICRO_USD {
            return Err(IdentityError::ExecutionCostPolicyInvalid);
        }
        let usable = |text: &str| {
            !text.is_empty()
                && text.len() <= MAX_CLOSURE_POLICY_TEXT_LEN
                && text.bytes().all(|b| b.is_ascii_graphic())
        };
        if !usable(&self.model_policy) || parse_model_policy(&self.model_policy).is_none() {
            return Err(IdentityError::ModelPolicyTextInvalid);
        }
        if !usable(&self.credential_ref) {
            return Err(IdentityError::CredentialReferenceTextInvalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TrustManifest {
    pub schema_version: u32,
    pub manifest_version: u32,
    pub application_id: String,
    pub application_version: String,
    pub build_id: String,
    pub installation_model: InstallationModel,
    pub runtime: RuntimeManifest,
    pub daemon_artefact: DaemonArtefactManifest,
    pub generated_at: String,
    pub minimum_protocol_version: u32,
    pub signature_algorithm: String,
    pub signing_key_id: String,
    /// The gatekeeper execution closure. Present exactly when `manifest_version` is 2.
    ///
    /// ABSENT MEANS ABSENT, NOT WAIVED. `check_versions` refuses a v2 manifest without it and a v1
    /// manifest with it, so this `Option` never expresses "the closure is optional here" — it
    /// expresses which version of the contract this manifest is written to. `skip_serializing_if`
    /// keeps it out of a v1 document entirely, which is what makes every signature ever produced
    /// over a v1 manifest still verify byte-for-byte.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_closure: Option<ExecutionClosureManifest>,
    /// Detached signature over the canonical bytes of all other fields. Never part of canonical.
    pub signature: String,
}

impl TrustManifest {
    /// Parse raw manifest bytes into a strict typed manifest. Malformed / unknown-field JSON fails.
    pub fn parse(raw: &[u8]) -> Result<TrustManifest, IdentityError> {
        serde_json::from_slice::<TrustManifest>(raw).map_err(|_| IdentityError::ManifestMalformed)
    }

    /// Reject a manifest whose schema/version/protocol the code does not understand (fail closed),
    /// and whose closure shape does not match the version it claims.
    pub fn check_versions(&self) -> Result<(), IdentityError> {
        if self.schema_version != SUPPORTED_SCHEMA_VERSION
            || self.manifest_version == 0
            || self.manifest_version > SUPPORTED_MANIFEST_VERSION_MAX
            || self.minimum_protocol_version < SUPPORTED_MIN_PROTOCOL_VERSION
        {
            return Err(IdentityError::ManifestVersionUnsupported);
        }
        // THE VERSION AND THE SHAPE MUST AGREE, and they are checked in both directions.
        //
        // v2 without a closure would be a manifest that announces the stronger contract and signs
        // the weaker subject — precisely the downgrade this version exists to make impossible.
        //
        // v1 WITH a closure is refused too, and that direction matters just as much: a v1 document
        // carrying closure fields would put them outside `canonical_bytes` (which omits the field at
        // v1 to keep historical signatures valid), so they would be decoration — present in the
        // JSON, covered by no signature, and free for anyone to edit. Refusing the shape is what
        // stops that from ever being mistaken for attestation.
        match (
            self.manifest_version >= EXECUTION_CLOSURE_MANIFEST_VERSION,
            self.execution_closure.is_some(),
        ) {
            (true, false) => Err(IdentityError::ExecutionClosureMissing),
            (false, true) => Err(IdentityError::ExecutionClosureUnexpected),
            _ => Ok(()),
        }
    }
}
