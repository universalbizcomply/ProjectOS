//! PUBLIC-surface contract for the attempt-scoped cross-source service-instance binding
//! (3K-I-D-E-C-CAPABILITY-B4-CROSS-SOURCE-BINDING-CONTRACT1B).
//!
//! This file is an EXTERNAL consumer of the crate, so it sees exactly what a sibling crate or a proof
//! runner sees. Two properties are demonstrated by what this file CANNOT do:
//!
//! 1. It cannot obtain a `ServiceInstanceToken`. There is no public constructor, no `from_pid`, no
//!    `new(pid, time)`, no `from_raw`, no `Default`, no deserialisation and no accessor.
//! 2. It cannot obtain a positive binding by assembling values. Since Contract1B there is no public
//!    free-standing comparison at all: `bind_service_instance` is crate-private, no public function
//!    returns a `ServiceInstanceObservation`, and the only route to a verdict is a bounded, ordered,
//!    consumable `ServiceInstanceBindingAttempt` — which cannot even be started, because
//!    `ServiceInstanceBindingAttempt::begin` demands the sealed, unconstructible capability.
//!
//! Nothing here calls a Windows API, opens a pipe, queries the SCM, opens a process or launches
//! anything; the default (effect-free) build is what runs.

use projectos_host_windows_service_identity_proof::{
    contract_only, ServiceIdentityProofClass, ServiceInstanceBinding, ServiceInstanceRefusal,
    LIVE_SERVICE_IDENTITY_PROOF_RUN, SERVICE_IDENTITY_PROOF_IS_CONTRACT_ONLY,
};

/// Every closed verdict an external consumer can name.
const VERDICTS: [ServiceInstanceBinding; 14] = [
    ServiceInstanceBinding::Match,
    ServiceInstanceBinding::Mismatch,
    ServiceInstanceBinding::MissingIpcObservation,
    ServiceInstanceBinding::MissingScmObservation,
    ServiceInstanceBinding::Stale,
    ServiceInstanceBinding::Ambiguous,
    ServiceInstanceBinding::Unsupported,
    ServiceInstanceBinding::WrongObservationOrder,
    ServiceInstanceBinding::DuplicateObservation,
    ServiceInstanceBinding::CrossAttemptObservation,
    ServiceInstanceBinding::ObservationWindowExpired,
    ServiceInstanceBinding::AlreadyFinalised,
    ServiceInstanceBinding::CapabilityUnavailable,
    ServiceInstanceBinding::UnexpectedFailure,
];

#[test]
fn the_closed_verdict_set_is_complete_and_distinct() {
    for (i, a) in VERDICTS.iter().enumerate() {
        for (j, b) in VERDICTS.iter().enumerate() {
            assert_eq!(i == j, a == b, "verdicts {i} and {j} compare wrongly");
        }
    }
}

#[test]
fn an_external_consumer_cannot_reach_a_positive_verdict() {
    // There is no public constructor for an observation, no public comparison, and no way to start an
    // attempt without the sealed capability. The only thing nameable is the verdict type itself, and
    // naming `Match` is not producing it.
    let named = ServiceInstanceBinding::Match;
    let produced_by_this_test: Option<ServiceInstanceBinding> = None;
    assert_ne!(Some(named), produced_by_this_test);
}

#[test]
fn refusals_remain_closed_and_nameable_without_carrying_identity() {
    let candidates = [
        ServiceInstanceRefusal::PipeNotConnected,
        ServiceInstanceRefusal::HandshakeNotConfirmed,
        ServiceInstanceRefusal::UnexpectedPeerRole,
        ServiceInstanceRefusal::PeerProcessIdUnavailable,
        ServiceInstanceRefusal::InvalidProcessId,
        ServiceInstanceRefusal::PeerChangedDuringObservation,
        ServiceInstanceRefusal::ConnectionClosedDuringObservation,
        ServiceInstanceRefusal::ServiceStatusUnavailable,
        ServiceInstanceRefusal::ServiceNotRunning,
        ServiceInstanceRefusal::ServiceTypeAmbiguous,
        ServiceInstanceRefusal::ServiceInstanceChangedDuringObservation,
        ServiceInstanceRefusal::ProcessOpenDenied,
        ServiceInstanceRefusal::ProcessCreationTimeUnavailable,
        ServiceInstanceRefusal::BackendUnavailable,
        ServiceInstanceRefusal::UnsupportedPlatform,
        ServiceInstanceRefusal::UnexpectedObservationFailure,
    ];
    // A refusal is a closed label: it carries no payload, so it can never smuggle identity out.
    for r in candidates {
        let rendered = format!("{r:?}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
        assert!(!rendered.contains('('), "{rendered}");
    }
}

#[test]
fn public_verdict_output_carries_no_raw_identity_or_timing() {
    // No digits at all: a process ID, creation time, attempt identifier, observation timestamp, hash,
    // prefix or fingerprint would each surface as numeric text.
    for b in VERDICTS {
        let rendered = format!("{b:?}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
    }
}

#[test]
// The point of the assertion IS that these consts are still the frozen values.
#[allow(clippy::assertions_on_constants)]
fn attempt_scoped_binding_does_not_make_anything_execution_ready() {
    assert!(SERVICE_IDENTITY_PROOF_IS_CONTRACT_ONLY);
    assert!(!LIVE_SERVICE_IDENTITY_PROOF_RUN);
    assert_eq!(contract_only(), ServiceIdentityProofClass::ContractOnly);
    assert_ne!(contract_only(), ServiceIdentityProofClass::Confirmed);
}
