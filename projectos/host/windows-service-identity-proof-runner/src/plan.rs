//! The closed proof-stage plan and fail-closed confirmation. No stage executes a Windows operation in
//! this contract phase.

use projectos_host_windows_local_ipc::IpcCorroboration;
use projectos_host_windows_service_identity_proof::{
    AuthorityHandoverState, ServiceIdentityEvidence, ServiceIdentityProofClass,
};

/// The fixed, ordered proof stages. There is no general-purpose or caller-supplied stage; the sequence
/// is closed. In this contract phase NO stage executes a Windows operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofStage {
    /// Read-only preflight (exact-name absence, proof-subtree absence).
    Preflight,
    /// Build the test-only service fixture + controller.
    BuildFixture,
    /// Create the approved proof ProgramData subtree.
    PrepareProofBoundary,
    /// Create the ProjectOSHost proof service.
    CreateService,
    /// Configure the service SID type (UNRESTRICTED).
    ConfigureServiceSid,
    /// Fallback fixture acquires the test authority.
    AcquireFallbackAuthority,
    /// Fallback stops accepting work and proves drain.
    DrainFallback,
    /// Fallback releases the authority.
    ReleaseFallbackAuthority,
    /// Start the service.
    StartService,
    /// Await typed IPC readiness + evidence.
    AwaitTypedIpc,
    /// Corroborate service state through SCM.
    CorroborateScm,
    /// Interactive controller attempts contention (must see an existing, non-authoritative token).
    AttemptInteractiveContention,
    /// Run the negative-corroboration checks.
    ExecuteNegativeCorroborationChecks,
    /// Stop the service.
    StopService,
    /// Verify authority release.
    VerifyAuthorityRelease,
    /// Delete the service.
    DeleteService,
    /// Remove proof-only residue.
    RemoveProofResidue,
    /// Verify zero residue.
    VerifyZeroResidue,
    /// The proof is complete.
    Complete,
}

impl ProofStage {
    /// The fixed ordered sequence.
    #[must_use]
    pub fn sequence() -> &'static [ProofStage] {
        &[
            Self::Preflight,
            Self::BuildFixture,
            Self::PrepareProofBoundary,
            Self::CreateService,
            Self::ConfigureServiceSid,
            Self::AcquireFallbackAuthority,
            Self::DrainFallback,
            Self::ReleaseFallbackAuthority,
            Self::StartService,
            Self::AwaitTypedIpc,
            Self::CorroborateScm,
            Self::AttemptInteractiveContention,
            Self::ExecuteNegativeCorroborationChecks,
            Self::StopService,
            Self::VerifyAuthorityRelease,
            Self::DeleteService,
            Self::RemoveProofResidue,
            Self::VerifyZeroResidue,
            Self::Complete,
        ]
    }

    /// Whether THIS contract phase executes a Windows operation for the stage. Always `false` — the
    /// runner is a contract; live execution belongs to later, separately-gated phases.
    #[must_use]
    pub fn contract_executes_windows_operation(self) -> bool {
        false
    }
}

/// The correction-cycle state. At most ONE correction cycle is permitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CorrectionState {
    /// No correction cycle has been used.
    NoneUsed,
    /// The single permitted correction cycle has been used.
    OneUsed,
    /// A second correction cycle was requested and refused.
    FurtherRefused,
}

impl CorrectionState {
    /// The maximum number of correction cycles.
    #[must_use]
    pub fn max_cycles() -> u8 {
        1
    }

    /// The next state after requesting a correction cycle.
    #[must_use]
    pub fn request_next(self) -> CorrectionState {
        match self {
            Self::NoneUsed => Self::OneUsed,
            Self::OneUsed | Self::FurtherRefused => Self::FurtherRefused,
        }
    }
}

/// The rollback requirement. Rollback is required on BOTH pass and failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RollbackRequirement;

impl RollbackRequirement {
    /// Whether rollback is required for a given confirmation outcome. Always `true`.
    #[must_use]
    pub fn required_for(_outcome: ProofRunnerClass) -> bool {
        true
    }
}

/// The SCM corroboration channel result (distinct from the IPC channel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ScmCorroboration {
    /// SCM corroborated the expected service state.
    Valid,
    /// SCM contradicted the expected state.
    Invalid,
    /// SCM was unavailable.
    Unavailable,
}

/// The exact typed proof-runner refusal reasons. Fieldless.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofRunnerRefusal {
    /// The redacted service-identity evidence did not confirm.
    ServiceIdentityEvidenceNotConfirmed,
    /// IPC corroboration was not valid.
    IpcCorroborationNotValid,
    /// SCM corroboration was not valid.
    ScmCorroborationNotValid,
    /// Release-before-acquire was not evidenced by the terminal handover state.
    ReleaseBeforeAcquireNotEvidenced,
    /// Residue was not proven zero.
    ResidueNotZero,
    /// A second correction cycle was requested.
    SecondCorrectionCycleRefused,
    /// Unexpected residue requires owner review.
    UnexpectedResidueRequiresOwnerReview,
}

/// The truthful proof-runner classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofRunnerClass {
    /// Only the effect-free contract exists; no live orchestration has run.
    ContractOnly,
    /// A live proof has not been run.
    NotRun,
    /// Every required condition is positively established.
    Confirmed,
    /// A required condition failed, with an exact reason.
    Refused(ProofRunnerRefusal),
    /// A required condition could not be established either way.
    Indeterminate,
    /// The evidence is internally contradictory.
    NonConforming,
}

/// The proof-runner confirmation logic. It delegates the token/SID/handover checks to the accepted
/// redacted evidence classifier and adds the runner-level dual-corroboration + zero-residue + handover
/// requirements. It reuses [`AuthorityHandoverState::ServiceReady`] — there is NO second handover
/// machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProofRunnerConfirmation;

impl ProofRunnerConfirmation {
    /// The terminal handover state that evidences release-before-acquire. Reuses the canonical enum.
    #[must_use]
    pub fn required_handover() -> AuthorityHandoverState {
        AuthorityHandoverState::ServiceReady
    }

    /// Evaluate the proof, fail closed.
    ///
    /// [`ProofRunnerClass::Confirmed`] requires: the redacted evidence classifies as `Confirmed`
    /// (which already enforces token-user / service-SID / SID-type / fresh acquisition / peer +
    /// evidence-embedded corroboration / release-before-acquire via `ServiceReady` / no-trust
    /// ExistingToken); AND the runner-level IPC and SCM channels are both `Valid`; AND residue is
    /// proven zero. Any other state fails closed.
    #[must_use]
    pub fn evaluate(
        evidence: &ServiceIdentityEvidence,
        ipc: IpcCorroboration,
        scm: ScmCorroboration,
        residue_is_zero: bool,
    ) -> ProofRunnerClass {
        // Delegate the identity/authority/handover judgement to the accepted classifier.
        match evidence.classify() {
            ServiceIdentityProofClass::Confirmed => {}
            ServiceIdentityProofClass::Refused(_) => {
                return ProofRunnerClass::Refused(
                    ProofRunnerRefusal::ServiceIdentityEvidenceNotConfirmed,
                )
            }
            ServiceIdentityProofClass::Indeterminate => return ProofRunnerClass::Indeterminate,
            ServiceIdentityProofClass::NonConforming => return ProofRunnerClass::NonConforming,
            ServiceIdentityProofClass::ContractOnly | ServiceIdentityProofClass::NotRun => {
                return ProofRunnerClass::NotRun
            }
            _ => {
                return ProofRunnerClass::Refused(
                    ProofRunnerRefusal::ServiceIdentityEvidenceNotConfirmed,
                )
            }
        }

        // Runner-level dual corroboration: BOTH channels must be Valid.
        match ipc {
            IpcCorroboration::Valid => {}
            // Invalid / Unavailable / any future non-valid variant fails closed.
            _ => return ProofRunnerClass::Refused(ProofRunnerRefusal::IpcCorroborationNotValid),
        }
        match scm {
            ScmCorroboration::Valid => {}
            ScmCorroboration::Invalid | ScmCorroboration::Unavailable => {
                return ProofRunnerClass::Refused(ProofRunnerRefusal::ScmCorroborationNotValid)
            }
        }

        // Release-before-acquire terminal evidence (belt-and-braces with the classifier).
        if evidence.handover != Self::required_handover() {
            return ProofRunnerClass::Refused(ProofRunnerRefusal::ReleaseBeforeAcquireNotEvidenced);
        }

        // Zero residue required.
        if !residue_is_zero {
            return ProofRunnerClass::Refused(ProofRunnerRefusal::ResidueNotZero);
        }

        ProofRunnerClass::Confirmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use projectos_host_windows_service_identity_proof::{
        AuthorityPeerState, AuthorityTokenOutcome, Corroboration, NonAuthorisingIntegrity,
        ResidueEvidence, Tristate,
    };

    fn confirmed_evidence() -> ServiceIdentityEvidence {
        ServiceIdentityEvidence {
            same_account: Tristate::False,
            same_session: Tristate::False,
            same_integrity_level: NonAuthorisingIntegrity::observed(Tristate::False),
            configured_virtual_account_is_token_user: Tristate::True,
            expected_service_sid_present_in_token_groups: Tristate::True,
            expected_service_sid_type_present: Tristate::True,
            token_outcome: AuthorityTokenOutcome::AcquiredToken,
            peer_state: AuthorityPeerState::ServiceRuntimeConfirmed,
            peer_corroboration: Corroboration::Valid,
            scm_corroboration: Corroboration::Valid,
            handover: AuthorityHandoverState::ServiceReady,
            residue: ResidueEvidence::Zero,
        }
    }

    #[test]
    fn the_stage_sequence_is_fixed_and_effect_free() {
        assert_eq!(ProofStage::sequence().len(), 19);
        assert_eq!(ProofStage::sequence().first(), Some(&ProofStage::Preflight));
        assert_eq!(ProofStage::sequence().last(), Some(&ProofStage::Complete));
        assert!(ProofStage::sequence()
            .iter()
            .all(|s| !s.contract_executes_windows_operation()));
    }

    #[test]
    fn canonical_handover_is_reused_no_second_machine() {
        // The required handover is the canonical AuthorityHandoverState::ServiceReady.
        assert_eq!(
            ProofRunnerConfirmation::required_handover(),
            AuthorityHandoverState::ServiceReady
        );
    }

    #[test]
    fn full_positive_confirms() {
        assert_eq!(
            ProofRunnerConfirmation::evaluate(
                &confirmed_evidence(),
                IpcCorroboration::Valid,
                ScmCorroboration::Valid,
                true
            ),
            ProofRunnerClass::Confirmed
        );
    }

    #[test]
    fn ipc_without_scm_cannot_confirm() {
        assert_eq!(
            ProofRunnerConfirmation::evaluate(
                &confirmed_evidence(),
                IpcCorroboration::Valid,
                ScmCorroboration::Unavailable,
                true
            ),
            ProofRunnerClass::Refused(ProofRunnerRefusal::ScmCorroborationNotValid)
        );
    }

    #[test]
    fn scm_without_ipc_cannot_confirm() {
        assert_eq!(
            ProofRunnerConfirmation::evaluate(
                &confirmed_evidence(),
                IpcCorroboration::Unavailable,
                ScmCorroboration::Valid,
                true
            ),
            ProofRunnerClass::Refused(ProofRunnerRefusal::IpcCorroborationNotValid)
        );
    }

    #[test]
    fn existing_token_cannot_confirm_authority() {
        let mut e = confirmed_evidence();
        e.token_outcome = AuthorityTokenOutcome::ExistingToken;
        e.handover = AuthorityHandoverState::ServiceActivationPending;
        assert_ne!(
            ProofRunnerConfirmation::evaluate(
                &e,
                IpcCorroboration::Valid,
                ScmCorroboration::Valid,
                true
            ),
            ProofRunnerClass::Confirmed
        );
    }

    #[test]
    fn release_before_acquire_is_required() {
        let mut e = confirmed_evidence();
        e.handover = AuthorityHandoverState::ServiceTokenAcquired; // not the terminal ServiceReady
        assert!(matches!(
            ProofRunnerConfirmation::evaluate(
                &e,
                IpcCorroboration::Valid,
                ScmCorroboration::Valid,
                true
            ),
            ProofRunnerClass::Refused(_)
        ));
    }

    #[test]
    fn nonzero_residue_cannot_confirm() {
        assert_eq!(
            ProofRunnerConfirmation::evaluate(
                &confirmed_evidence(),
                IpcCorroboration::Valid,
                ScmCorroboration::Valid,
                false
            ),
            ProofRunnerClass::Refused(ProofRunnerRefusal::ResidueNotZero)
        );
    }

    #[test]
    fn one_correction_cycle_is_the_maximum() {
        assert_eq!(CorrectionState::max_cycles(), 1);
        assert_eq!(
            CorrectionState::NoneUsed.request_next(),
            CorrectionState::OneUsed
        );
        assert_eq!(
            CorrectionState::OneUsed.request_next(),
            CorrectionState::FurtherRefused
        );
        assert_eq!(
            CorrectionState::FurtherRefused.request_next(),
            CorrectionState::FurtherRefused
        );
    }

    #[test]
    fn rollback_is_required_after_pass_and_failure() {
        assert!(RollbackRequirement::required_for(
            ProofRunnerClass::Confirmed
        ));
        assert!(RollbackRequirement::required_for(
            ProofRunnerClass::Refused(ProofRunnerRefusal::ResidueNotZero)
        ));
        assert!(RollbackRequirement::required_for(
            ProofRunnerClass::NonConforming
        ));
    }
}
