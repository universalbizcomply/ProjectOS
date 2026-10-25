//! PROOF-RUNNER-OWNED corroboration vocabulary (3K-I-D-E-C-CAPABILITY-B4-PROOF-RUNNER-INTEGRATION1A).
//!
//! The binding crates own instance identity; the proof runner owns the PROOF. Their
//! `ServiceInstanceBinding` is therefore consumed INTERNALLY and translated into the closed states
//! below, so a dependency enum never becomes this crate's durable evidence contract and no token,
//! process identity or observation can reach a report, log, `Debug` rendering or serialised evidence.
//!
//! Nothing here carries a payload: every state is a fieldless label, so raw identity is not merely
//! withheld, it is unrepresentable.

#[cfg(any(test, feature = "test-fixtures"))]
use projectos_host_windows_service_identity_proof::ServiceInstanceBinding;

/// The proof-runner's own closed refusal vocabulary. Each maps a specific dependency outcome onto a
/// stable, redacted, NON-AUTHORISING reason. Materially different security failures stay distinct —
/// nothing collapses into a generic error where a precise answer exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProofRunnerInstanceRefusal {
    /// The IPC peer and the SCM-observed service were different running instances.
    ServiceInstanceMismatch,
    /// No OS-derived identity was obtained for the IPC peer.
    IpcInstanceEvidenceMissing,
    /// No OS-derived identity was obtained for the SCM service.
    ScmInstanceEvidenceMissing,
    /// The evidence did not describe one stable instant: the service changed across the window, or
    /// the bounded observation window elapsed.
    InstanceEvidenceStale,
    /// The service could not be resolved to a single unambiguous instance.
    ServiceInstanceAmbiguous,
    /// Instance binding is unsupported on this platform or in this build.
    InstanceBindingUnsupported,
    /// The sealed observation capability was unavailable.
    CapabilityUnavailable,
    /// Contributions arrived out of order, were duplicated, were replayed, or finalisation was misused.
    InvalidProofSequence,
    /// The bounded shutdown was never acknowledged.
    ShutdownNotAcknowledged,
    /// The transport did not disconnect.
    DisconnectNotCompleted,
    /// Residue was non-zero, unknown or unavailable.
    ResidueNonZero,
    /// Any other failure, redacted.
    UnexpectedFailure,
}

/// The proof-runner's closed corroboration verdict.
///
/// The positive value means EXACTLY: the compile-only orchestration completed, fake-backed IPC and SCM
/// evidence bound to one instance, shutdown was acknowledged and residue was Zero. It asserts no live
/// Windows proof, no service authority, no execution readiness and no installation readiness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InstanceCorroboration {
    /// Both independent evidence sources described the same running instance.
    SameInstanceCorroborationConfirmed,
    /// Corroboration was refused, with an exact closed reason.
    Refused(ProofRunnerInstanceRefusal),
}

impl InstanceCorroboration {
    /// Whether the two sources corroborated. Reveals nothing about either source's contents.
    #[must_use]
    pub fn is_confirmed(self) -> bool {
        matches!(self, Self::SameInstanceCorroborationConfirmed)
    }

    /// The closed refusal, when corroboration failed.
    #[must_use]
    pub fn refusal(self) -> Option<ProofRunnerInstanceRefusal> {
        match self {
            Self::SameInstanceCorroborationConfirmed => None,
            Self::Refused(r) => Some(r),
        }
    }
}

/// Translate the dependency-owned binding verdict into proof-runner vocabulary.
///
/// CRATE-PRIVATE on purpose: a caller must not be able to hand the runner a `ServiceInstanceBinding`
/// and receive a corroboration, because that would let a caller supply the very conclusion the proof
/// exists to establish. The only route is the controller, which obtains the binding by driving the
/// attempt itself.
#[cfg(any(test, feature = "test-fixtures"))]
pub(crate) fn map_binding(binding: ServiceInstanceBinding) -> InstanceCorroboration {
    use ProofRunnerInstanceRefusal as R;
    match binding {
        ServiceInstanceBinding::Match => InstanceCorroboration::SameInstanceCorroborationConfirmed,
        ServiceInstanceBinding::Mismatch => {
            InstanceCorroboration::Refused(R::ServiceInstanceMismatch)
        }
        ServiceInstanceBinding::MissingIpcObservation => {
            InstanceCorroboration::Refused(R::IpcInstanceEvidenceMissing)
        }
        ServiceInstanceBinding::MissingScmObservation => {
            InstanceCorroboration::Refused(R::ScmInstanceEvidenceMissing)
        }
        // A changed instance across the window and an elapsed window are the same class of defect:
        // the evidence does not describe one stable instant.
        ServiceInstanceBinding::Stale | ServiceInstanceBinding::ObservationWindowExpired => {
            InstanceCorroboration::Refused(R::InstanceEvidenceStale)
        }
        ServiceInstanceBinding::Ambiguous => {
            InstanceCorroboration::Refused(R::ServiceInstanceAmbiguous)
        }
        ServiceInstanceBinding::Unsupported => {
            InstanceCorroboration::Refused(R::InstanceBindingUnsupported)
        }
        ServiceInstanceBinding::CapabilityUnavailable => {
            InstanceCorroboration::Refused(R::CapabilityUnavailable)
        }
        // Ordering, duplication, cross-attempt recombination and finalise-twice are all one class:
        // the sequence itself was invalid.
        ServiceInstanceBinding::WrongObservationOrder
        | ServiceInstanceBinding::DuplicateObservation
        | ServiceInstanceBinding::CrossAttemptObservation
        | ServiceInstanceBinding::AlreadyFinalised => {
            InstanceCorroboration::Refused(R::InvalidProofSequence)
        }
        ServiceInstanceBinding::UnexpectedFailure => {
            InstanceCorroboration::Refused(R::UnexpectedFailure)
        } // Deliberately EXHAUSTIVE with no wildcard: if the dependency ever gains a verdict, this stops
          // compiling and forces an explicit decision, rather than silently mapping the unknown onto a
          // default. Fail-closed at compile time beats fail-open at run time.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_match_confirms() {
        assert!(map_binding(ServiceInstanceBinding::Match).is_confirmed());
        for b in [
            ServiceInstanceBinding::Mismatch,
            ServiceInstanceBinding::MissingIpcObservation,
            ServiceInstanceBinding::MissingScmObservation,
            ServiceInstanceBinding::Stale,
            ServiceInstanceBinding::ObservationWindowExpired,
            ServiceInstanceBinding::Ambiguous,
            ServiceInstanceBinding::Unsupported,
            ServiceInstanceBinding::CapabilityUnavailable,
            ServiceInstanceBinding::WrongObservationOrder,
            ServiceInstanceBinding::DuplicateObservation,
            ServiceInstanceBinding::CrossAttemptObservation,
            ServiceInstanceBinding::AlreadyFinalised,
            ServiceInstanceBinding::UnexpectedFailure,
        ] {
            assert!(!map_binding(b).is_confirmed(), "{b:?} must not confirm");
        }
    }

    #[test]
    fn materially_different_failures_map_to_distinct_reasons() {
        use ProofRunnerInstanceRefusal as R;
        let cases = [
            (ServiceInstanceBinding::Mismatch, R::ServiceInstanceMismatch),
            (
                ServiceInstanceBinding::MissingIpcObservation,
                R::IpcInstanceEvidenceMissing,
            ),
            (
                ServiceInstanceBinding::MissingScmObservation,
                R::ScmInstanceEvidenceMissing,
            ),
            (ServiceInstanceBinding::Stale, R::InstanceEvidenceStale),
            (
                ServiceInstanceBinding::ObservationWindowExpired,
                R::InstanceEvidenceStale,
            ),
            (
                ServiceInstanceBinding::Ambiguous,
                R::ServiceInstanceAmbiguous,
            ),
            (
                ServiceInstanceBinding::Unsupported,
                R::InstanceBindingUnsupported,
            ),
            (
                ServiceInstanceBinding::CapabilityUnavailable,
                R::CapabilityUnavailable,
            ),
            (
                ServiceInstanceBinding::WrongObservationOrder,
                R::InvalidProofSequence,
            ),
            (
                ServiceInstanceBinding::DuplicateObservation,
                R::InvalidProofSequence,
            ),
            (
                ServiceInstanceBinding::CrossAttemptObservation,
                R::InvalidProofSequence,
            ),
            (
                ServiceInstanceBinding::AlreadyFinalised,
                R::InvalidProofSequence,
            ),
        ];
        for (binding, expected) in cases {
            assert_eq!(
                map_binding(binding).refusal(),
                Some(expected),
                "{binding:?}"
            );
        }
    }

    #[test]
    fn corroboration_output_carries_no_identity() {
        // Fieldless labels only: no digits can appear, so no PID, creation time or timestamp can.
        for r in [
            InstanceCorroboration::SameInstanceCorroborationConfirmed,
            InstanceCorroboration::Refused(ProofRunnerInstanceRefusal::ServiceInstanceMismatch),
            InstanceCorroboration::Refused(ProofRunnerInstanceRefusal::InstanceEvidenceStale),
        ] {
            let rendered = format!("{r:?}");
            assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        }
    }
}
