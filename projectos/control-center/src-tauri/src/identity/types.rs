//! Shared identity types: closed states, installation model, and the verified-identity view.
//! Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use serde::Serialize;

/// Closed identity-classification states. `PACKAGED_HASHES_VERIFIED` is deliberately NOT equal to
/// `PACKAGED_IDENTITY_VERIFIED`: the latter additionally requires an authentic signature and a safe
/// installation model. On a machine without a production signing ceremony or protected install, the
/// terminal real result is `PRODUCTION_IDENTITY_UNAVAILABLE`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IdentityState {
    DevelopmentUnverified,
    TestIdentityVerified,
    PackagedManifestParsed,
    PackagedHashesVerified,
    PackagedSignatureVerified,
    PackagedIdentityVerified,
    ProductionIdentityUnavailable,
    IdentityBlocked,
}

/// How the application was installed. Only `PerMachine` can ever anchor production identity; a
/// per-user or development tree is mutable by the interactive user and can never be a trust anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstallationModel {
    PerMachine,
    PerUser,
    Development,
}

impl InstallationModel {
    /// Whether this model is permitted to anchor production identity.
    pub const fn can_anchor_production(self) -> bool {
        matches!(self, InstallationModel::PerMachine)
    }
}

/// Verifier verdict on the manifest signature — safe metadata only, never key material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VerifiedSigner {
    pub signer_id: String,
    pub verified_at: String,
    pub verifier_impl_id: String,
    pub signature_algorithm: String,
    pub evidence_ref: String,
    /// True only for a production-grade verifier. A test verifier is always false and is rejected
    /// under production policy.
    pub production_grade: bool,
}

/// The safe, serialisable outcome of an identity evaluation. Carries no paths, keys, or secrets
/// beyond the already-safe manifest metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IdentityOutcome {
    pub state: IdentityState,
    pub application_id: Option<String>,
    pub application_version: Option<String>,
    pub installation_model: Option<InstallationModel>,
    pub signer: Option<VerifiedSigner>,
    /// Present when the outcome is a failure classification.
    pub failure: Option<crate::identity::errors::IdentityError>,
    pub read_only_operation_safe: bool,
    pub protected_approvals_disabled: bool,
    pub next_safe_action: String,
}
