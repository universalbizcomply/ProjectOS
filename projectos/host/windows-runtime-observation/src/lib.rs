//! # ProjectOS host Windows runtime-observation (host-SELF evidence)
//!
//! CD-B4-PRODUCTION-RUNTIME-PROVIDER1A. Reads the CURRENT process's OWN identity — process id and
//! process creation time — as read-only, redacted [`HostProcessObservation`] evidence, and assembles a
//! core [`projectos_host_core::RuntimeInstanceObservation`] for the interactive-fallback role. It mints
//! NO authority: only the sealed core `ProductionRuntimeInstanceVerifier` turns an observation into a
//! `VerifiedRuntimeInstance`, and only a core `ProductionClockBindingGrant` binds a production clock.
//!
//! ## What this crate does NOT do
//!
//! No peer/other-process observation, no SID, no SCM, no pipe, no token, no Windows-session read
//! (`Win32_System_RemoteDesktop` is deferred — session is `None` in v1), no service install/start, no
//! ProgramData/ACL/registry mutation, no network. The live self-observation FFI is confined to the gated
//! private [`observation_ffi`] module; the default build calls no Windows API. `EXECUTION_READY` stays
//! false; installation stays `NotAuthorised`.

/// This crate ships the effect-free evidence contract; the default build performs no live observation.
pub const WINDOWS_RUNTIME_OBSERVATION_IS_CONTRACT_ONLY: bool = true;
/// No operational live observation is activated by shipping this crate.
pub const LIVE_RUNTIME_OBSERVATION_RUN: bool = false;

mod sealed {
    /// Crate-private witness: no external crate can name it, so it cannot construct a sealed capability.
    pub struct Private;
}

/// The sealed authority to acquire a LIVE Windows self-observation source. It has NO public constructor
/// and NO public fields, so no non-fixture graph can build one; compiling the live FFI is therefore not
/// authority to run it. It cannot be converted into runtime authority and cannot mint a
/// `ProductionClockBindingGrant`. Not `Clone`/`Copy`.
pub struct LiveRuntimeObservationCapability {
    _seal: sealed::Private,
    /// `!Send + !Sync`: an observation capability must not silently cross a thread boundary.
    _thread_bound: core::marker::PhantomData<*const ()>,
}

impl core::fmt::Debug for LiveRuntimeObservationCapability {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("LiveRuntimeObservationCapability([REDACTED])")
    }
}

impl LiveRuntimeObservationCapability {
    /// TEST-ONLY synthetic capability so the local read-only proof (and fixture tests) can drive the
    /// live source. Gated to `test-fixtures`; there is no other constructor in any graph.
    #[cfg(feature = "test-fixtures")]
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self {
            _seal: sealed::Private,
            _thread_bound: core::marker::PhantomData,
        }
    }
}

/// Read-only, redacted evidence of the host's OWN running process: its process id and OS-observed
/// creation time (together the process identity that defeats pid reuse). Private fields, no public
/// constructor, redacted `Debug`; it is EVIDENCE and cannot itself mint a `VerifiedRuntimeInstance`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct HostProcessObservation {
    pid: u32,
    creation_time: u64,
}

impl core::fmt::Debug for HostProcessObservation {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("HostProcessObservation([REDACTED])")
    }
}

impl HostProcessObservation {
    /// Crate-internal constructor. Rejects the zero-pid / zero-creation non-identities fail-closed, so a
    /// placeholder can never masquerade as a real observation. Used by the live FFI module and fixtures;
    /// the pure default graph builds no observation.
    #[allow(dead_code)] // used by the live FFI module + fixture tests; dead in the pure default graph
    pub(crate) fn new(pid: u32, creation_time: u64) -> Option<Self> {
        if pid == 0 || creation_time == 0 {
            return None;
        }
        Some(Self { pid, creation_time })
    }
    /// The observed host process id.
    #[must_use]
    pub fn pid(&self) -> u32 {
        self.pid
    }
    /// The observed host process creation time.
    #[must_use]
    pub fn creation_time(&self) -> u64 {
        self.creation_time
    }
}

/// Assemble a core [`RuntimeInstanceObservation`] for the INTERACTIVE-FALLBACK role from a host-self
/// process observation. Session is `None` (RemoteDesktop deferred); no service evidence. This is
/// UNTRUSTED evidence: only the sealed `ProductionRuntimeInstanceVerifier` may attest it.
///
/// [`RuntimeInstanceObservation`]: projectos_host_core::RuntimeInstanceObservation
#[must_use]
pub fn interactive_fallback_observation(
    observation: &HostProcessObservation,
    observed_at: u64,
    valid_until: u64,
) -> projectos_host_core::RuntimeInstanceObservation {
    projectos_host_core::RuntimeInstanceObservation {
        role: projectos_host_core::HostRole::InteractiveFallback,
        source: projectos_host_core::RuntimeSource::InteractiveFallback,
        pid: observation.pid,
        creation_tick: observation.creation_time,
        session: None,
        observed_at,
        valid_until,
        service_evidence: None,
    }
}

#[cfg(all(windows, feature = "windows-live-runtime-observation"))]
mod observation_ffi;

#[cfg(all(windows, feature = "windows-live-runtime-observation"))]
pub use live::WindowsRuntimeObservationSource;

#[cfg(all(windows, feature = "windows-live-runtime-observation"))]
mod live {
    use super::{observation_ffi, HostProcessObservation, LiveRuntimeObservationCapability};
    use core::cell::Cell;

    /// A live host-self observation source. Reads the CURRENT process only. Requires the sealed
    /// [`LiveRuntimeObservationCapability`] to acquire; `shutdown` revokes it so post-shutdown
    /// observation is refused fail-closed.
    pub struct WindowsRuntimeObservationSource {
        live: Cell<bool>,
        _thread_bound: core::marker::PhantomData<*const ()>,
    }

    impl WindowsRuntimeObservationSource {
        /// Acquire the source under a sealed capability. There is no capability constructor in a
        /// non-fixture graph, so this is unreachable in production without an owner-gated capability.
        #[must_use]
        pub fn acquire(_capability: &LiveRuntimeObservationCapability) -> Option<Self> {
            Some(Self {
                live: Cell::new(true),
                _thread_bound: core::marker::PhantomData,
            })
        }
        /// Observe the CURRENT process's own identity. Returns `None` after shutdown or on a fail-closed
        /// FFI result (query failure / zero non-identity).
        #[must_use]
        pub fn observe_current_process(&self) -> Option<HostProcessObservation> {
            if !self.live.get() {
                return None;
            }
            let pid = observation_ffi::current_process_id();
            let creation = observation_ffi::current_process_creation_time()?;
            HostProcessObservation::new(pid, creation)
        }
        /// Revoke the source; subsequent observation is refused.
        pub fn shutdown(&self) {
            self.live.set(false);
        }
        /// Whether the source is still live.
        #[must_use]
        pub fn is_live(&self) -> bool {
            self.live.get()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The contract is effect-free and the capability is sealed (no non-fixture constructor).
    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn contract_is_effect_free_and_capability_is_sealed() {
        assert!(WINDOWS_RUNTIME_OBSERVATION_IS_CONTRACT_ONLY);
        assert!(!LIVE_RUNTIME_OBSERVATION_RUN);
    }

    // A host-self observation is bounded, fail-closed evidence and assembles a fallback observation.
    #[cfg(feature = "test-fixtures")]
    #[test]
    fn host_observation_is_bounded_evidence() {
        assert!(HostProcessObservation::new(0, 1).is_none());
        assert!(HostProcessObservation::new(1, 0).is_none());
        let obs = HostProcessObservation::new(4242, 999).unwrap();
        assert_eq!(obs.pid(), 4242);
        assert!(format!("{obs:?}").contains("[REDACTED]"));
        let rio = interactive_fallback_observation(&obs, 1_000, 21_000);
        assert_eq!(rio.role, projectos_host_core::HostRole::InteractiveFallback);
        assert_eq!(rio.pid, 4242);
        assert!(rio.session.is_none());
        assert!(rio.service_evidence.is_none());
    }

    // LOCAL READ-ONLY WINDOWS PROOF: real self PID + creation time, real monotonic clock, minted ONLY
    // through the sealed production verifier; shutdown then refuses further observation. Read-only, no
    // machine mutation, no residue.
    #[cfg(all(
        windows,
        feature = "windows-live-runtime-observation",
        feature = "test-fixtures"
    ))]
    #[test]
    fn live_interactive_fallback_read_only_proof() {
        use projectos_host_core::{
            bind_production_clock, fixture_production_clock_binding_grant,
            ProductionRuntimeInstanceVerifier, RuntimeInstanceVerifier, TrustedClock,
        };
        use projectos_host_windows_clock::{
            LiveClockObservationCapability, WindowsMonotonicTickSource,
        };

        // Real host-self observation.
        let cap = LiveRuntimeObservationCapability::synthetic_for_fixture();
        let source = WindowsRuntimeObservationSource::acquire(&cap).expect("acquire self source");
        let obs1 = source.observe_current_process().expect("observe self");
        assert!(obs1.pid() != 0);
        assert!(obs1.creation_time() != 0);
        // Repeated observation identifies the SAME running process.
        let obs2 = source
            .observe_current_process()
            .expect("observe self again");
        assert_eq!(obs1, obs2);

        // Real monotonic clock, bound through a core grant (never regresses).
        let clock_cap = LiveClockObservationCapability::synthetic_for_fixture();
        let tick = WindowsMonotonicTickSource::acquire(&clock_cap).expect("acquire monotonic");
        let clock =
            bind_production_clock(fixture_production_clock_binding_grant(), tick, u64::MAX / 2);
        let now = clock.read_current();

        // Mint ONLY through the sealed production verifier. The observation window is expressed in the
        // monotonic clock domain: observed now, valid for a bounded span within the verifier's window.
        let verifier = ProductionRuntimeInstanceVerifier::for_local_proof();
        let observed_at = now.reading();
        let valid_until = observed_at + 20_000;
        let rio = interactive_fallback_observation(&obs1, observed_at, valid_until);
        let verified = verifier.verify(&rio, &now).expect("mint runtime instance");
        assert_eq!(verified.pid(), obs1.pid());
        verified
            .is_current(&verifier, &clock.read_current())
            .expect("runtime instance is current");

        // Shutdown revokes observation.
        source.shutdown();
        assert!(source.observe_current_process().is_none());
    }
}
