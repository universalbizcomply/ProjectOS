//! PROJECTOS-HOST-REVIEW-PATH1B §10 - THE TRUSTED STARTUP COMPOSITION.
//!
//! # What this is
//!
//! The ONE production route from "this process started under the SCM" to the long-lived production
//! authority every governed review needs. It is a straight line, and every link is a component that
//! already existed and was already audited - what was missing was the line itself:
//!
//! ```text
//!   verified canonical installation        status::verified_canonical_installation()   [G1]
//!     -> machine-wide authority acquisition  host-authority::acquire_service_runtime_authority
//!        (which derives the service-runtime self proof internally and never accepts one)
//!     -> ConfirmedAuthorityGuard
//!     -> one-shot production clock authority core::establish_production_clock_authority [G2]
//!     -> live monotonic tick source          windows-clock
//!     -> ProductionClockBindingGrant         (minted by that one-shot authority, once)
//!     -> ProductionTrustedClock
//!     -> VerifiedAuthorityTime
//!     -> ONE ProviderAuthorityLease          core::open_provider_authority
//!     -> ONE long-lived ProviderCapabilitySet
//! ```
//!
//! # The guard is borrowed, then moved, and that ordering is the point
//!
//! `establish_production_clock_authority` BORROWS the confirmed guard; `open_provider_authority`
//! CONSUMES it. So one acquisition establishes one clock lineage and one provider lease, and the
//! machine-wide authority stays held for as long as any capability derived from it exists.
//!
//! # What is NOT here
//!
//! No owner approval workflow, no second authority system and no activation input. This composition
//! needs nothing from Murad: it is reachable the moment the service starts on an installation whose
//! canonical record verifies. What DOES need activation inputs is the review itself - the
//! owner-signed programme delegation, the attested installation programme and the operation ports -
//! and none of them appears in this file.
//!
//! # Fail closed, at every link
//!
//! Every refusal below stops the composition and names the link. There is no fallback authority, no
//! degraded clock and no "continue without a lease".

use projectos_host_core::{
    bind_production_clock, establish_production_clock_authority, open_provider_authority,
    ProviderCapabilitySet, ProductionTrustedClock, TrustedClock, VerifiedAuthorityTime,
};
use projectos_host_windows_clock::{LiveClockObservationCapability, WindowsMonotonicTickSource};
use projectos_host_windows_runtime_observation::{
    LiveRuntimeObservationCapability, WindowsRuntimeObservationSource,
};

use crate::status;

/// The longest forward discontinuity the production clock tolerates before it poisons its lineage,
/// in biased monotonic milliseconds. Ten minutes: long enough to survive an ordinary scheduling
/// stall or a short suspend, short enough that a long suspend invalidates authority rather than
/// silently extending it.
const MAX_CLOCK_FORWARD_JUMP_MS: u64 = 10 * 60 * 1_000;

/// The cold-start lease window, in trusted-clock units (milliseconds). A lease is a startup
/// handshake, not a session: it is opened and consumed in the same few instructions. Kept well
/// inside `core::provider_authority::MAX_LEASE_WINDOW`, which is the authority on the bound.
const LEASE_WINDOW: u64 = 60;

/// Why the trusted startup composition refused. Fail closed; payload-free - it names the LINK that
/// said no and never an object name, a handle, a digest, a SID or a reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TrustedStartupRefusal {
    /// The installed canonical identity record is absent, unparseable or did not verify. Nothing
    /// downstream can be scoped to an installation this Host cannot establish.
    CanonicalInstallationUnavailable,
    /// The machine-wide authority could not be acquired and confirmed. Includes the ordinary case of
    /// another process already holding the token, which is NEVER local authority.
    AuthorityUnavailable,
    /// The confirmed authority did not yield the one-shot production clock authority - it is not the
    /// service runtime, or a clock lineage was already established in this process.
    ClockAuthorityUnavailable,
    /// The live monotonic tick source could not be acquired.
    TickSourceUnavailable,
    /// The trusted clock could not produce a live reading, so there is no trusted time to bind
    /// authority against.
    TrustedTimeUnavailable,
    /// The provider-authority lease could not be opened.
    LeaseRefused,
    /// The lease could not be converted into the production capability set.
    CapabilitiesRefused,
    /// The Host own self-observation source could not be acquired, so the Host could never attest
    /// its own runtime instance and no session could ever be minted.
    RuntimeObservationUnavailable,
}

impl core::fmt::Display for TrustedStartupRefusal {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::CanonicalInstallationUnavailable => "canonical installation did not verify",
            Self::AuthorityUnavailable => "machine-wide host authority unavailable",
            Self::ClockAuthorityUnavailable => "production clock authority unavailable",
            Self::TickSourceUnavailable => "monotonic tick source unavailable",
            Self::TrustedTimeUnavailable => "trusted time unavailable",
            Self::LeaseRefused => "provider-authority lease refused",
            Self::CapabilitiesRefused => "provider capabilities refused",
            Self::RuntimeObservationUnavailable => "host self-observation unavailable",
        })
    }
}

impl std::error::Error for TrustedStartupRefusal {}

/// The production authority this service instance holds for its whole life.
///
/// ONE machine-wide authority, ONE trusted clock lineage, ONE provider lease, ONE capability set -
/// and MANY per-connection verifiers drawn from it. The capability set RETAINS the confirmed
/// authority guard, so dropping this value is what releases the machine-wide authority, and nothing
/// derived from it can outlive it.
///
/// The clock is held alongside because it is the lineage the capability set was established under:
/// a later reading from a DIFFERENT provider or epoch is refused by every currentness check, so the
/// clock must not be rebuilt per connection.
pub struct TrustedHostRuntime {
    clock: ProductionTrustedClock<WindowsMonotonicTickSource>,
    capabilities: ProviderCapabilitySet,
    installation:
        projectos_host_identity::canonical_record::VerifiedCanonicalInstallation,
    /// The Host OWN self-observation source.
    ///
    /// ACQUIRED AT STARTUP, under a BORROW of the confirmed authority guard, because that is the
    /// only moment the guard exists as a value: `open_provider_authority` consumes it and the
    /// capability set retains it privately and never exposes it - deliberately, so no capability can
    /// be extracted from the authority that justified it. Acquiring the source here and holding it
    /// keeps that property intact and still gives every connection a real self-observation.
    self_observation: WindowsRuntimeObservationSource,
}

impl core::fmt::Debug for TrustedHostRuntime {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("TrustedHostRuntime([REDACTED])")
    }
}

impl TrustedHostRuntime {
    /// The production capability set. Borrowed only: there is no accessor that yields a capability
    /// by value, so none can outlive the authority that justified it.
    #[must_use]
    pub fn capabilities(&self) -> &ProviderCapabilitySet {
        &self.capabilities
    }

    /// The CURRENT trusted reading from this runtime's clock lineage.
    ///
    /// Taken fresh on every call, never cached: a retained reading is exactly the replay the
    /// authority-time contract exists to prevent. A poisoned clock reports a distinct provider
    /// identity here, which every downstream currentness check refuses.
    #[must_use]
    pub fn now(&self) -> VerifiedAuthorityTime {
        self.clock.read_current()
    }

    /// Observe the Host OWN process identity, right now.
    ///
    /// UNTRUSTED EVIDENCE. `None` after shutdown or on a fail-closed read. It attests nothing: only
    /// the sealed production runtime verifier, reached through [`Self::capabilities`], can turn an
    /// observation into a `VerifiedRuntimeInstance`.
    #[must_use]
    pub fn observe_self(
        &self,
    ) -> Option<projectos_host_windows_runtime_observation::HostProcessObservation> {
        self.self_observation.observe_current_process()
    }

    /// The verified canonical installation this runtime is scoped to.
    ///
    /// The SAME value the authority was acquired under, so the enrolled-owner principal derived from
    /// it and the authority object it was scoped to can never disagree about which installation this
    /// is. It is not re-read and not re-verified - there is one verification, at startup.
    #[must_use]
    pub fn installation(
        &self,
    ) -> &projectos_host_identity::canonical_record::VerifiedCanonicalInstallation {
        &self.installation
    }
}

/// Establish the trusted host runtime for THIS service start.
///
/// Called once, from the service lifecycle, after the durable state root has been activated and
/// before anything is served. It takes NO argument: there is nothing for a caller to steer, because
/// every input is either read from this installation or derived from this process.
///
/// # Errors
/// [`TrustedStartupRefusal`] naming the first link that refused.
pub fn establish_trusted_host_runtime() -> Result<TrustedHostRuntime, TrustedStartupRefusal> {
    // 1. THE INSTALLATION. One read, one `verify_record`, and the value that call produced (G1).
    let installation = status::verified_canonical_installation()
        .ok_or(TrustedStartupRefusal::CanonicalInstallationUnavailable)?;

    // 2. THE MACHINE-WIDE AUTHORITY. The facade derives the object name, the security descriptor and
    //    the service-runtime self proof internally; a FRESH create with genuine corroboration is the
    //    only thing that confirms, and an existing token is never local authority.
    let guard = projectos_host_authority::acquire_service_runtime_authority(&installation)
        .map_err(|_| TrustedStartupRefusal::AuthorityUnavailable)?;

    // 3. THE ONE-SHOT CLOCK AUTHORITY (G2). BORROWED, so the guard is still available to open the
    //    lease below: one acquisition, one lineage, one lease.
    let clock_authority = establish_production_clock_authority(&guard)
        .map_err(|_| TrustedStartupRefusal::ClockAuthorityUnavailable)?;

    // 4. THE EVIDENCE TICK SOURCE, under the observation capability that same authority gates. A
    //    tick is evidence, never authority: only the sealed core clock turns ticks into time.
    let observation = LiveClockObservationCapability::for_production_clock_authority(&clock_authority);
    let source = WindowsMonotonicTickSource::acquire(&observation)
        .ok_or(TrustedStartupRefusal::TickSourceUnavailable)?;

    // 5. THE HOST OWN SELF-OBSERVATION SOURCE, under the SAME confirmed service-runtime authority.
    //    Acquired HERE, while the guard is still a value: the lease below consumes it and the
    //    capability set never gives it back. There is no second authority - this is the one root,
    //    borrowed, exactly as the clock authority borrowed it.
    let runtime_observation = LiveRuntimeObservationCapability::for_confirmed_service_runtime(&guard)
        .ok_or(TrustedStartupRefusal::RuntimeObservationUnavailable)?;
    let self_observation = WindowsRuntimeObservationSource::acquire(&runtime_observation)
        .ok_or(TrustedStartupRefusal::RuntimeObservationUnavailable)?;

    // 6. THE BINDING. The one-shot authority is CONSUMED here, so this process binds exactly one
    //    clock lineage however many times anything below is retried.
    let grant = clock_authority.into_clock_binding_grant();
    let clock = bind_production_clock(grant, source, MAX_CLOCK_FORWARD_JUMP_MS);

    // 7. TRUSTED TIME. A poisoned clock reports the POISONED provider identity, which the lease
    //    consumption below compares and refuses - so a faulted clock cannot produce capabilities.
    let issued = clock.try_read_current().map_err(|_| TrustedStartupRefusal::TrustedTimeUnavailable)?;

    // 8. THE LEASE. CONSUMES the guard, which the lease then retains.
    let lease = open_provider_authority(guard, &issued, LEASE_WINDOW)
        .map_err(|_| TrustedStartupRefusal::LeaseRefused)?;

    // 9. THE CAPABILITIES. A second live reading, re-checked against issuance for provider identity,
    //    epoch, regression and expiry. The guard MOVES into the set, so the machine-wide authority
    //    is held for as long as any production capability exists.
    let consumed = clock
        .try_read_current()
        .map_err(|_| TrustedStartupRefusal::TrustedTimeUnavailable)?;
    let capabilities = lease
        .into_provider_capabilities(&consumed)
        .map_err(|_| TrustedStartupRefusal::CapabilitiesRefused)?;

    Ok(TrustedHostRuntime {
        clock,
        capabilities,
        installation,
        self_observation,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_refusal_names_a_link_and_leaks_nothing() {
        // Payload-free by construction: the enum has no fields. Restated as a test so a future
        // variant carrying a handle, a name or a digest fails here rather than in a log file.
        for r in [
            TrustedStartupRefusal::CanonicalInstallationUnavailable,
            TrustedStartupRefusal::AuthorityUnavailable,
            TrustedStartupRefusal::ClockAuthorityUnavailable,
            TrustedStartupRefusal::TickSourceUnavailable,
            TrustedStartupRefusal::TrustedTimeUnavailable,
            TrustedStartupRefusal::LeaseRefused,
            TrustedStartupRefusal::CapabilitiesRefused,
            TrustedStartupRefusal::RuntimeObservationUnavailable,
        ] {
            let rendered = format!("{r:?} {r}");
            assert!(!rendered.is_empty());
            for leak in ["\\\\.\\pipe", "S-1-", "ProgramData", "0x"] {
                assert!(!rendered.contains(leak), "refusal leaked {leak}: {rendered}");
            }
        }
    }

    #[test]
    fn the_lease_window_is_inside_the_core_bound() {
        // The core owns the bound; this restates that the value chosen here is inside it, so a
        // future widening of the constant fails here instead of at runtime on a live service start.
        assert!(LEASE_WINDOW > 0);
        assert!(LEASE_WINDOW <= projectos_host_core::MAX_LEASE_WINDOW);
    }

    /// A NON-SERVICE process must never establish the trusted runtime.
    ///
    /// The test process is not ProjectOSHost running under the SCM, so the service-runtime self
    /// proof inside the acquisition facade cannot succeed and the composition must refuse. This is
    /// the strongest statement a unit test can make about it: the route exists, is compiled, and
    /// still yields nothing to a process that is not the service.
    #[test]
    fn a_process_that_is_not_the_service_establishes_no_runtime() {
        match establish_trusted_host_runtime() {
            Ok(_) => panic!("a test process must never obtain production host authority"),
            Err(
                TrustedStartupRefusal::CanonicalInstallationUnavailable
                | TrustedStartupRefusal::AuthorityUnavailable,
            ) => {}
            Err(other) => panic!("unexpected link refused before the authority gate: {other:?}"),
        }
    }
}
