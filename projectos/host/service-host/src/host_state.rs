//! The Host's durable state at service start — RUN-TO-COMPLETION HOST ATTESTATION §10H.
//!
//! The service reaches its durable delegation and replay authority through ONE call,
//! [`activate_installed_host_state`], and nothing else in this crate names a root, a store or a
//! boundary acceptance. That call takes no argument: argv, the environment and the working
//! directory are never consulted, the anchor is the approved Known Folder resolver, and the
//! protected boundary is verified live before any store is opened.
//!
//! A refusal is reported to the SCM as a service-specific exit code, one per refusal class, so an
//! operator can tell WHICH link refused without the service disclosing a path, a SID or a
//! descriptor.

use projectos_host_windows_local_ipc::{
    activate_installed_host_state, ActivatedHostDurableState, HostStateActivationRefusal,
};

/// The Host state root did not resolve.
pub const EXIT_ROOT_UNRESOLVED: u32 = 101;
/// The live protected-boundary verification refused the root.
pub const EXIT_BOUNDARY_NOT_ACCEPTED: u32 = 102;
/// The root changed between acceptance and the store handoff.
pub const EXIT_ROOT_CHANGED_AFTER_ACCEPTANCE: u32 = 103;
/// The durable delegation lifecycle store could not be opened.
pub const EXIT_DELEGATION_STORE_UNAVAILABLE: u32 = 104;
/// The durable request-replay store could not be opened.
pub const EXIT_REPLAY_STORE_UNAVAILABLE: u32 = 105;

/// The service-specific exit code for a refusal. Never zero: zero is a clean stop.
///
/// Exhaustive on purpose — a new refusal class must be given its own code before this compiles.
#[must_use]
pub fn service_exit_code(refusal: &HostStateActivationRefusal) -> u32 {
    match refusal {
        HostStateActivationRefusal::RootUnresolved(_) => EXIT_ROOT_UNRESOLVED,
        HostStateActivationRefusal::BoundaryNotAccepted(_) => EXIT_BOUNDARY_NOT_ACCEPTED,
        HostStateActivationRefusal::RootChangedAfterAcceptance(_) => {
            EXIT_ROOT_CHANGED_AFTER_ACCEPTANCE
        }
        HostStateActivationRefusal::DelegationStoreUnavailable(_) => {
            EXIT_DELEGATION_STORE_UNAVAILABLE
        }
        HostStateActivationRefusal::ReplayStoreUnavailable(_) => EXIT_REPLAY_STORE_UNAVAILABLE,
    }
}

/// Activate the installed Host's durable state for this service run, or name why not.
///
/// # Errors
/// The non-zero service-specific exit code of the refusal class. The refusal itself is not
/// returned: the SCM is the only consumer, and the code is what it records.
pub fn activate_for_service() -> Result<ActivatedHostDurableState, u32> {
    activate_installed_host_state().map_err(|refusal| service_exit_code(&refusal))
}

#[cfg(test)]
mod tests {
    use super::*;
    use projectos_host_windows_local_ipc::{
        BoundaryRefusal, DelegationStoreRefusal, ReplayRefusal, TrustedRootRefusal,
    };

    #[test]
    fn every_refusal_class_has_its_own_non_zero_code() {
        let codes: Vec<u32> = [
            HostStateActivationRefusal::RootUnresolved(TrustedRootRefusal::RootMissing),
            HostStateActivationRefusal::BoundaryNotAccepted(BoundaryRefusal::BoundaryUnreadable),
            HostStateActivationRefusal::RootChangedAfterAcceptance(
                TrustedRootRefusal::RootRedirected,
            ),
            HostStateActivationRefusal::DelegationStoreUnavailable(
                DelegationStoreRefusal::StateRootUnusable,
            ),
            HostStateActivationRefusal::ReplayStoreUnavailable(ReplayRefusal::StateRootUnusable),
        ]
        .iter()
        .map(service_exit_code)
        .collect();

        assert!(
            codes.iter().all(|c| *c != 0),
            "a refusal read as a clean stop"
        );
        let mut distinct = codes.clone();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            codes.len(),
            "two refusal classes share a code"
        );
    }

    #[test]
    fn the_code_does_not_depend_on_the_inner_refusal() {
        // The class is what the operator is told; the detail stays inside the process.
        assert_eq!(
            service_exit_code(&HostStateActivationRefusal::RootUnresolved(
                TrustedRootRefusal::RootMissing
            )),
            service_exit_code(&HostStateActivationRefusal::RootUnresolved(
                TrustedRootRefusal::ReparsePointRefused
            )),
        );
    }
}
