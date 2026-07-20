//! Reconciliation rules for an uncertain or non-conforming future installation outcome.
//!
//! Governing rule: this crate NEVER authorises an automatic destructive or corrective action. It
//! does not delete, overwrite, repair, rename, choose an alternative name, or retry. Every such
//! action requires its own separate owner/gatekeeper approval in a later phase. Reconciliation here
//! only CLASSIFIES the situation and names the human decision required.

/// The observed reconciliation situation after an uncertain or non-conforming outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReconciliationSituation {
    /// Nothing to reconcile: a clean pre-effect refusal, no effect occurred.
    NothingToReconcile,
    /// A service with the approved name exists but was not created by a verified effect.
    UnexplainedServicePresent,
    /// The effect is uncertain — success/timeout/crash without an authoritative re-read.
    EffectUncertain,
    /// A service exists but its configuration does not match the contract.
    ConfigurationMismatch,
    /// A partially-created or partially-configured service was observed.
    PartialInstallation,
    /// The approved name collides with a pre-existing unrelated service.
    NameCollisionWithForeignService,
}

/// The ONLY decisions reconciliation may yield. Every one either stops or escalates to a human; none
/// performs a destructive or corrective effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ReconciliationDecision {
    /// No action required; proceed with the normal (still un-authorised) flow.
    NoActionRequired,
    /// Stop and require an explicit owner/gatekeeper investigation. No effect.
    RequireOwnerInvestigation,
    /// Stop and require a separate, explicit rollback approval. No automatic delete.
    RequireSeparateRollbackApproval,
    /// Stop and require a separate, explicit re-configuration approval. No automatic overwrite.
    RequireSeparateReconfigurationApproval,
}

impl ReconciliationSituation {
    /// The mandated decision for this situation. Encodes the no-automatic-recovery rule directly:
    /// uncertain/partial/unexplained/mismatch/collision all STOP and escalate; only a clean
    /// no-effect situation needs nothing.
    #[must_use]
    pub fn decision(self) -> ReconciliationDecision {
        match self {
            Self::NothingToReconcile => ReconciliationDecision::NoActionRequired,
            Self::UnexplainedServicePresent | Self::NameCollisionWithForeignService => {
                ReconciliationDecision::RequireOwnerInvestigation
            }
            Self::EffectUncertain | Self::PartialInstallation => {
                ReconciliationDecision::RequireSeparateRollbackApproval
            }
            Self::ConfigurationMismatch => {
                ReconciliationDecision::RequireSeparateReconfigurationApproval
            }
        }
    }
}

impl ReconciliationDecision {
    /// Whether this decision performs any automatic destructive or corrective effect. Always
    /// `false` — no reconciliation decision deletes, overwrites, repairs, renames or retries.
    #[must_use]
    pub fn performs_automatic_effect(self) -> bool {
        false
    }

    /// Whether this decision requires a separate future approval before anything proceeds.
    #[must_use]
    pub fn requires_separate_approval(self) -> bool {
        matches!(
            self,
            Self::RequireOwnerInvestigation
                | Self::RequireSeparateRollbackApproval
                | Self::RequireSeparateReconfigurationApproval
        )
    }
}

/// A recovery action a naive implementation MIGHT attempt, paired with the fact it is forbidden here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ForbiddenAutomaticAction {
    /// Automatically deleting the service.
    AutomaticDelete,
    /// Automatically overwriting the service configuration.
    AutomaticOverwrite,
    /// Automatically repairing the service.
    AutomaticRepair,
    /// Automatically choosing an alternative or suffixed name.
    AutomaticAlternativeName,
    /// Automatically retrying the creation.
    AutomaticRetry,
    /// Automatically creating a second service.
    AutomaticSecondCreation,
}

impl ForbiddenAutomaticAction {
    /// Every action this crate forbids from happening automatically.
    #[must_use]
    pub fn all() -> &'static [ForbiddenAutomaticAction] {
        use ForbiddenAutomaticAction as F;
        &[
            F::AutomaticDelete,
            F::AutomaticOverwrite,
            F::AutomaticRepair,
            F::AutomaticAlternativeName,
            F::AutomaticRetry,
            F::AutomaticSecondCreation,
        ]
    }

    /// Whether this action is permitted automatically. Always `false`.
    #[must_use]
    pub fn is_permitted(self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_no_effect_situation_needs_no_action() {
        let d = ReconciliationSituation::NothingToReconcile.decision();
        assert_eq!(d, ReconciliationDecision::NoActionRequired);
        assert!(!d.requires_separate_approval());
    }

    #[test]
    fn uncertain_and_partial_require_separate_rollback_approval() {
        for s in [
            ReconciliationSituation::EffectUncertain,
            ReconciliationSituation::PartialInstallation,
        ] {
            assert_eq!(
                s.decision(),
                ReconciliationDecision::RequireSeparateRollbackApproval,
                "{s:?}"
            );
        }
    }

    #[test]
    fn a_mismatch_requires_separate_reconfiguration_approval() {
        assert_eq!(
            ReconciliationSituation::ConfigurationMismatch.decision(),
            ReconciliationDecision::RequireSeparateReconfigurationApproval
        );
    }

    #[test]
    fn foreign_collision_and_unexplained_service_require_owner_investigation() {
        for s in [
            ReconciliationSituation::NameCollisionWithForeignService,
            ReconciliationSituation::UnexplainedServicePresent,
        ] {
            assert_eq!(
                s.decision(),
                ReconciliationDecision::RequireOwnerInvestigation,
                "{s:?}"
            );
        }
    }

    #[test]
    fn no_reconciliation_decision_performs_an_automatic_effect() {
        for d in [
            ReconciliationDecision::NoActionRequired,
            ReconciliationDecision::RequireOwnerInvestigation,
            ReconciliationDecision::RequireSeparateRollbackApproval,
            ReconciliationDecision::RequireSeparateReconfigurationApproval,
        ] {
            assert!(!d.performs_automatic_effect(), "{d:?}");
        }
    }

    #[test]
    fn every_forbidden_automatic_action_is_never_permitted() {
        assert_eq!(ForbiddenAutomaticAction::all().len(), 6);
        for a in ForbiddenAutomaticAction::all() {
            assert!(!a.is_permitted(), "{a:?}");
        }
    }
}
