//! Fail-closed classification of redacted service-identity evidence.

use projectos_host_authority::{AuthorityHandoverState, AuthorityPeerState, AuthorityTokenOutcome};

use crate::evidence::{Corroboration, ResidueEvidence, ServiceIdentityEvidence, Tristate};

/// The exact typed reason a live proof is refused. Fieldless — it names no object, SID, account,
/// session or path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofRefusal {
    /// The token-user entry does not correspond to the configured virtual service account.
    TokenUserNotConfiguredAccount,
    /// The expected per-service SID is not present in the token's group entries.
    ServiceSidAbsentFromTokenGroups,
    /// The observed service-SID-type does not match the accepted baseline.
    ServiceSidTypeMismatch,
    /// The service did not freshly acquire the authority token.
    AuthorityNotAcquired,
    /// An existing token was observed; it is never trusted ownership.
    ExistingTokenNotTrusted,
    /// Release-before-acquire is not evidenced by the terminal handover state.
    ReleaseBeforeAcquireNotEvidenced,
    /// The corroborated peer role is not the service runtime.
    PeerRoleNotServiceRuntime,
    /// The typed-IPC peer corroboration contradicted the expected role.
    PeerCorroborationInvalid,
    /// The typed-IPC peer corroboration channel was unavailable.
    PeerCorroborationUnavailable,
    /// The SCM corroboration contradicted the expected state.
    ScmCorroborationInvalid,
    /// The SCM corroboration channel was unavailable.
    ScmCorroborationUnavailable,
    /// Residue remained after the proof run.
    ResidueNonZero,
    /// Residue could not be proven zero.
    ResidueIndeterminate,
}

/// The truthful classification of a service-identity proof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ServiceIdentityProofClass {
    /// Only the effect-free contract exists; no live proof has run.
    ContractOnly,
    /// A live proof has not been run.
    NotRun,
    /// Every required fact is positively established.
    Confirmed,
    /// A required fact is definitively negative or a required channel is absent — exact reason.
    Refused(ProofRefusal),
    /// A required fact could not be established either way.
    Indeterminate,
    /// The evidence is internally contradictory.
    NonConforming,
}

impl ServiceIdentityEvidence {
    /// Classify the evidence, fail closed.
    ///
    /// [`ServiceIdentityProofClass::Confirmed`] is returned ONLY when every required fact is positively
    /// established: token-user is the configured account, the per-service SID is present in the token
    /// groups, the SID-type matches the baseline, the service freshly ACQUIRED the token, the handover
    /// reached the terminal `ServiceReady` (release-before-acquire), the peer conclusion is
    /// `ServiceRuntimeConfirmed`, both corroboration channels are `Valid`, and residue is `Zero`.
    ///
    /// The NON-AUTHORISING integrity observation is deliberately never read here.
    #[must_use]
    pub fn classify(&self) -> ServiceIdentityProofClass {
        use ServiceIdentityProofClass as C;

        // 1. Internal contradictions fail as non-conforming before any positive fact is credited.
        if self.is_contradictory() {
            return C::NonConforming;
        }

        // 2. Required identity facts (positive). False → exact refusal; Indeterminate → Indeterminate.
        match self.configured_virtual_account_is_token_user {
            Tristate::True => {}
            Tristate::False => return C::Refused(ProofRefusal::TokenUserNotConfiguredAccount),
            Tristate::Indeterminate => return C::Indeterminate,
        }
        match self.expected_service_sid_present_in_token_groups {
            Tristate::True => {}
            Tristate::False => return C::Refused(ProofRefusal::ServiceSidAbsentFromTokenGroups),
            Tristate::Indeterminate => return C::Indeterminate,
        }
        match self.expected_service_sid_type_present {
            Tristate::True => {}
            Tristate::False => return C::Refused(ProofRefusal::ServiceSidTypeMismatch),
            Tristate::Indeterminate => return C::Indeterminate,
        }

        // 3. Fresh authority acquisition. An existing token is never trusted ownership.
        match self.token_outcome {
            AuthorityTokenOutcome::AcquiredToken => {}
            AuthorityTokenOutcome::ExistingToken => {
                return C::Refused(ProofRefusal::ExistingTokenNotTrusted)
            }
            AuthorityTokenOutcome::Refused => {
                return C::Refused(ProofRefusal::AuthorityNotAcquired)
            }
            _ => return C::Refused(ProofRefusal::AuthorityNotAcquired),
        }

        // 4. Release-before-acquire evidenced only by the terminal ServiceReady.
        if self.handover != AuthorityHandoverState::ServiceReady {
            return C::Refused(ProofRefusal::ReleaseBeforeAcquireNotEvidenced);
        }

        // 5. Corroborated peer conclusion must be the service runtime.
        match self.peer_state {
            AuthorityPeerState::ServiceRuntimeConfirmed => {}
            AuthorityPeerState::Uncorroborated => return C::Indeterminate,
            AuthorityPeerState::AuthorityUncertain => {
                return C::Refused(ProofRefusal::PeerRoleNotServiceRuntime)
            }
            // A confirmed but WRONG role (interactive fallback / client) is contradictory here.
            _ => return C::NonConforming,
        }

        // 6. Peer (typed IPC) and 7. SCM corroboration channels — BOTH required valid.
        match self.peer_corroboration {
            Corroboration::Valid => {}
            Corroboration::Invalid => return C::Refused(ProofRefusal::PeerCorroborationInvalid),
            Corroboration::Unavailable => {
                return C::Refused(ProofRefusal::PeerCorroborationUnavailable)
            }
        }
        match self.scm_corroboration {
            Corroboration::Valid => {}
            Corroboration::Invalid => return C::Refused(ProofRefusal::ScmCorroborationInvalid),
            Corroboration::Unavailable => {
                return C::Refused(ProofRefusal::ScmCorroborationUnavailable)
            }
        }

        // 8. Residue must be provably zero.
        match self.residue {
            ResidueEvidence::Zero => {}
            ResidueEvidence::NonZero => return C::Refused(ProofRefusal::ResidueNonZero),
            ResidueEvidence::Indeterminate => {
                return C::Refused(ProofRefusal::ResidueIndeterminate)
            }
        }

        C::Confirmed
    }

    /// Whether the evidence is internally contradictory.
    fn is_contradictory(&self) -> bool {
        use AuthorityHandoverState as H;
        use AuthorityPeerState as P;
        use AuthorityTokenOutcome as T;

        // Acquired-but-uncertain: a fresh acquisition can never corroborate to AuthorityUncertain.
        if matches!(self.token_outcome, T::AcquiredToken)
            && matches!(self.peer_state, P::AuthorityUncertain)
        {
            return true;
        }
        // Service confirmed while the token was refused.
        if matches!(self.peer_state, P::ServiceRuntimeConfirmed)
            && matches!(self.token_outcome, T::Refused)
        {
            return true;
        }
        // Service confirmed while the peer channel actively contradicted it.
        if matches!(self.peer_state, P::ServiceRuntimeConfirmed)
            && matches!(self.peer_corroboration, Corroboration::Invalid)
        {
            return true;
        }
        // Ready while the token was refused.
        if matches!(self.handover, H::ServiceReady) && matches!(self.token_outcome, T::Refused) {
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evidence::NonAuthorisingIntegrity;
    use ServiceIdentityProofClass as C;

    /// A fully-positive, internally-consistent evidence record → the ONLY Confirmed shape.
    fn confirmed() -> ServiceIdentityEvidence {
        ServiceIdentityEvidence {
            same_account: Tristate::False, // a service SHOULD differ; not a required positive fact
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
    fn the_fully_positive_record_is_confirmed() {
        assert_eq!(confirmed().classify(), C::Confirmed);
    }

    #[test]
    fn contract_only_and_not_run_are_not_confirmed() {
        assert_ne!(crate::contract_only(), C::Confirmed);
        assert_ne!(C::NotRun, C::Confirmed);
    }

    #[test]
    fn token_user_is_separate_from_service_sid_group_evidence() {
        // Token-user present but SID absent from groups → refused for the SID, not the token-user.
        let mut e = confirmed();
        e.expected_service_sid_present_in_token_groups = Tristate::False;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ServiceSidAbsentFromTokenGroups)
        );
    }

    #[test]
    fn service_sid_group_is_separate_from_sid_type_evidence() {
        let mut e = confirmed();
        e.expected_service_sid_type_present = Tristate::False;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ServiceSidTypeMismatch)
        );
    }

    #[test]
    fn integrity_true_cannot_compensate_for_missing_token_user() {
        let mut e = confirmed();
        e.same_integrity_level = NonAuthorisingIntegrity::observed(Tristate::True);
        e.configured_virtual_account_is_token_user = Tristate::False;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::TokenUserNotConfiguredAccount)
        );
    }

    #[test]
    fn integrity_false_cannot_invalidate_otherwise_valid_identity() {
        let mut e = confirmed();
        e.same_integrity_level = NonAuthorisingIntegrity::observed(Tristate::False);
        assert_eq!(e.classify(), C::Confirmed);
    }

    #[test]
    fn existing_token_alone_cannot_confirm_authority() {
        let mut e = confirmed();
        e.token_outcome = AuthorityTokenOutcome::ExistingToken;
        // ExistingToken with ServiceReady is contradictory-adjacent; ensure it never confirms.
        e.handover = AuthorityHandoverState::ServiceActivationPending;
        assert_ne!(e.classify(), C::Confirmed);
    }

    #[test]
    fn valid_ipc_without_scm_remains_unconfirmed() {
        let mut e = confirmed();
        e.scm_corroboration = Corroboration::Invalid;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ScmCorroborationInvalid)
        );
    }

    #[test]
    fn valid_scm_without_ipc_remains_unconfirmed() {
        let mut e = confirmed();
        // IPC unavailable → the peer conclusion cannot be ServiceRuntimeConfirmed in reality; model the
        // consistent uncorroborated conclusion → Indeterminate (fail closed).
        e.peer_corroboration = Corroboration::Unavailable;
        e.peer_state = AuthorityPeerState::Uncorroborated;
        assert_ne!(e.classify(), C::Confirmed);
    }

    #[test]
    fn unavailable_ipc_fails_closed() {
        let mut e = confirmed();
        e.peer_corroboration = Corroboration::Unavailable;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::PeerCorroborationUnavailable)
        );
    }

    #[test]
    fn unavailable_scm_fails_closed() {
        let mut e = confirmed();
        e.scm_corroboration = Corroboration::Unavailable;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ScmCorroborationUnavailable)
        );
    }

    #[test]
    fn false_token_user_fails_closed() {
        let mut e = confirmed();
        e.configured_virtual_account_is_token_user = Tristate::False;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::TokenUserNotConfiguredAccount)
        );
    }

    #[test]
    fn absent_service_sid_fails_closed() {
        let mut e = confirmed();
        e.expected_service_sid_present_in_token_groups = Tristate::False;
        assert!(matches!(e.classify(), C::Refused(_)));
    }

    #[test]
    fn wrong_sid_type_fails_closed() {
        let mut e = confirmed();
        e.expected_service_sid_type_present = Tristate::False;
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ServiceSidTypeMismatch)
        );
    }

    #[test]
    fn nonzero_residue_fails_closed() {
        let mut e = confirmed();
        e.residue = ResidueEvidence::NonZero;
        assert_eq!(e.classify(), C::Refused(ProofRefusal::ResidueNonZero));
    }

    #[test]
    fn indeterminate_residue_fails_closed() {
        let mut e = confirmed();
        e.residue = ResidueEvidence::Indeterminate;
        assert_eq!(e.classify(), C::Refused(ProofRefusal::ResidueIndeterminate));
    }

    #[test]
    fn required_indeterminate_identity_is_indeterminate() {
        let mut e = confirmed();
        e.configured_virtual_account_is_token_user = Tristate::Indeterminate;
        assert_eq!(e.classify(), C::Indeterminate);
    }

    #[test]
    fn not_acquired_authority_fails_closed() {
        let mut e = confirmed();
        // A refused token with a consistent (non-contradictory) uncertain peer + refused handover.
        e.token_outcome = AuthorityTokenOutcome::Refused;
        e.peer_state = AuthorityPeerState::AuthorityUncertain;
        e.peer_corroboration = Corroboration::Unavailable;
        e.scm_corroboration = Corroboration::Unavailable;
        e.handover = AuthorityHandoverState::ActivationRefused;
        assert_eq!(e.classify(), C::Refused(ProofRefusal::AuthorityNotAcquired));
    }

    #[test]
    fn release_before_acquire_must_be_evidenced() {
        let mut e = confirmed();
        e.handover = AuthorityHandoverState::ServiceTokenAcquired; // not yet the terminal ServiceReady
        assert_eq!(
            e.classify(),
            C::Refused(ProofRefusal::ReleaseBeforeAcquireNotEvidenced)
        );
    }

    #[test]
    fn contradictory_evidence_is_non_conforming() {
        // Ready + Refused token is internally contradictory.
        let mut e = confirmed();
        e.token_outcome = AuthorityTokenOutcome::Refused;
        assert_eq!(e.classify(), C::NonConforming);
    }

    #[test]
    fn service_confirmed_with_invalid_peer_channel_is_contradictory() {
        let mut e = confirmed();
        e.peer_corroboration = Corroboration::Invalid;
        assert_eq!(e.classify(), C::NonConforming);
    }

    #[test]
    fn a_wrong_confirmed_peer_role_is_non_conforming() {
        let mut e = confirmed();
        e.peer_state = AuthorityPeerState::InteractiveFallbackConfirmed;
        assert_eq!(e.classify(), C::NonConforming);
    }
}
