//! The sealed witness that packaged identity was actually verified.
//!
//! WHY A TYPE AND NOT A BOOLEAN. `IdentityOutcome` has public fields, so any caller can write
//! `IdentityOutcome { state: PackagedIdentityVerified, .. }` and hand it onward. An authority that
//! trusted that struct would be trusting a claim, not a verification. `VerifiedPackagedIdentity`
//! cannot be built outside this module — it holds a private seal — so possessing one IS the
//! evidence. There is no `new`, no `From`, no public field, and no `Default`.
//!
//! WHAT IT IS NOT. It is not authority. It says one thing only: this build evaluated a manifest
//! under production policy against an embedded anchor and the whole pipeline succeeded. What that
//! entitles anyone to do is decided elsewhere, by the crate that owns launch authority.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use super::types::{IdentityOutcome, IdentityState, InstallationModel};
use super::{evaluate, EvalContext, IdentityFs};

/// Private seal. Its existence is what stops a literal being written elsewhere: a struct with a
/// private field cannot be constructed outside the module that declares it, whatever else is public.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Seal;

/// Proof that packaged identity verification SUCCEEDED under production policy.
///
/// Obtainable only from `evaluate_packaged_authority`. Every field is read-only through an accessor
/// so the proof cannot be edited into describing a different application after the fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedPackagedIdentity {
    application_id: String,
    application_version: String,
    signer_id: String,
    installation_model: InstallationModel,
    _seal: Seal,
}

impl VerifiedPackagedIdentity {
    /// The application this identity was verified FOR. An authority holder must be able to check it
    /// is about the application actually running, not merely that some verification happened.
    pub fn application_id(&self) -> &str {
        &self.application_id
    }

    pub fn application_version(&self) -> &str {
        &self.application_version
    }

    /// The signer the embedded anchor identified. Never key material.
    pub fn signer_id(&self) -> &str {
        &self.signer_id
    }

    pub fn installation_model(&self) -> InstallationModel {
        self.installation_model
    }
}

/// Evaluate packaged identity and, ONLY on production-verified success, mint the sealed proof.
///
/// Returns the failing `IdentityOutcome` otherwise, so the caller reports the real reason rather
/// than a generic failure. Note what cannot happen here: there is no branch that mints a proof from
/// `TestIdentityVerified`, from `PackagedHashesVerified`, or from any state other than the single
/// terminal success — and `evaluate` only reaches that state under production policy with a
/// production verifier, which requires an embedded anchor to exist.
pub fn evaluate_packaged_authority(
    raw_manifest: &[u8],
    ctx: &EvalContext<'_>,
    fs: &dyn IdentityFs,
) -> Result<VerifiedPackagedIdentity, Box<IdentityOutcome>> {
    // Belt and braces: a caller that handed us a non-production policy must never obtain a proof,
    // even if some future edit made a test policy reach a verified-looking state.
    if !ctx.policy.is_production() {
        return Err(Box::new(evaluate(raw_manifest, ctx, fs)));
    }
    let outcome = evaluate(raw_manifest, ctx, fs);
    if outcome.state != IdentityState::PackagedIdentityVerified {
        return Err(Box::new(outcome));
    }
    // The verified state is only reachable with all three of these present; if any is missing the
    // pipeline changed underneath us and the safe answer is to refuse rather than to fill in blanks.
    match (
        outcome.application_id.clone(),
        outcome.application_version.clone(),
        outcome.signer.as_ref().map(|s| s.signer_id.clone()),
        outcome.installation_model,
    ) {
        (
            Some(application_id),
            Some(application_version),
            Some(signer_id),
            Some(installation_model),
        ) => Ok(VerifiedPackagedIdentity {
            application_id,
            application_version,
            signer_id,
            installation_model,
            _seal: Seal,
        }),
        _ => Err(Box::new(outcome)),
    }
}

/// TEST-ONLY minting, for crates that must exercise a downstream authority boundary without
/// reimplementing a signing ceremony.
///
/// Gated behind `test-fixtures`, which never ships: a normal `cargo build` — default or release —
/// sets neither `test` nor that feature, so this function is not physically present in a packaged
/// artifact and no production path can call it.
#[cfg(any(test, feature = "test-fixtures"))]
pub fn test_only_verified_identity(
    application_id: &str,
    application_version: &str,
    signer_id: &str,
    installation_model: InstallationModel,
) -> VerifiedPackagedIdentity {
    VerifiedPackagedIdentity {
        application_id: application_id.to_string(),
        application_version: application_version.to_string(),
        signer_id: signer_id.to_string(),
        installation_model,
        _seal: Seal,
    }
}
