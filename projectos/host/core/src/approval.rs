//! Mechanism-neutral owner-approval verification contract.
//!
//! No owner-presence technology (Windows Hello, WebAuthn, FIDO, PIN, password, elevation) is selected
//! or implemented here. A future adapter implementing [`OwnerPresenceVerifier`] produces a
//! [`VerifiedApproval`]; the core only defines the outcome shape and the bindings the reducer checks.
//! The core rejects candidate booleans, UI-only state, Claude/ChatGPT statements, and copied metadata
//! because none of those can produce a [`VerifiedApproval`] — only a verifier adapter can. No raw
//! owner-authentication evidence is stored.

use crate::facts::{
    ApprovalRecordId, ExpiryBoundary, ReleaseId, ReplayEvidenceId, RevocationStatus,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, ProjectId, ProviderId,
};

/// A verified, bounded owner-approval snapshot, bound to the exact operation it authorises. Produced
/// by a future [`OwnerPresenceVerifier`]; NOT serializable; never crosses IPC; holds no raw
/// owner-authentication evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedApproval {
    /// Approval/record identity (bounded, validated).
    pub approval_id: ApprovalRecordId,
    /// Project the approval authorises.
    pub project: ProjectId,
    /// Repository the approval authorises, where required.
    pub repository: Option<crate::facts::RepositoryRef>,
    /// Environment the approval authorises.
    pub environment: EnvironmentId,
    /// Provider the approval authorises.
    pub provider: ProviderId,
    /// Operation the approval authorises.
    pub operation: OperationName,
    /// Exact operation fingerprint the approval authorises.
    pub fingerprint: OperationFingerprint,
    /// Release the approval authorises.
    pub release: ReleaseId,
    /// Approval expiry boundary.
    pub expiry: ExpiryBoundary,
    /// Opaque replay-prevention identity (bounded, validated; e.g. a consumed single-use nonce id).
    pub replay_identity: ReplayEvidenceId,
    /// Maximum permitted operation count, where applicable.
    pub operation_count: Option<u32>,
    /// Protected revocation status.
    pub revocation: RevocationStatus,
}

/// The outcome of owner-approval verification for one operation. The fail-closed default is `Absent`
/// (an unread approval is never treated as verified).
///
/// The `Verified` variant carries the full bounded approval snapshot by value; an outcome is a
/// short-lived reducer input consumed immediately, so the size asymmetry is accepted rather than
/// boxed.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ApprovalOutcome {
    /// The operation needs no owner approval.
    NotRequired,
    /// Approval is required and none is present.
    #[default]
    Absent,
    /// Approval is required and a decision is pending.
    Pending,
    /// A verified, operation-bound approval.
    Verified(VerifiedApproval),
    /// A prior approval that has expired.
    Expired,
    /// A prior approval that has been revoked.
    Revoked,
    /// Evidence existed but did not bind to the requested operation.
    BindingMismatch,
}

/// Future contract for an owner-presence verifier. The core provides no production implementation and
/// selects no mechanism. An implementor must independently establish owner presence and bind the
/// resulting [`VerifiedApproval`] to the exact operation.
pub trait OwnerPresenceVerifier {
    /// Verify owner presence for the operation identified by the given bindings. Implementations must
    /// fail closed; a `None` return means "no verified approval".
    fn verify_owner_presence(
        &self,
        project: &ProjectId,
        environment: &EnvironmentId,
        provider: &ProviderId,
        operation: &OperationName,
        fingerprint: &OperationFingerprint,
        release: &ReleaseId,
    ) -> Option<VerifiedApproval>;
}
