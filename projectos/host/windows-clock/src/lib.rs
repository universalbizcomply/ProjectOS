//! Windows trusted-clock EVIDENCE crate (CD-B4-PRODUCTION-TRUSTED-CLOCK1A).
//!
//! This crate supplies the trusted host a NON-AUTHORITY source of biased monotonic ticks and a
//! per-start lineage seed, implementing [`projectos_host_core::MonotonicTickSource`]. It NEVER mints a
//! [`projectos_host_core::VerifiedAuthorityTime`], never implements [`projectos_host_core::TrustedClock`],
//! and never creates a permit, grant, runtime or IPC authority. Only the sealed core
//! [`projectos_host_core::ProductionTrustedClock`] turns these ticks into a verified reading, stamping the
//! crate-controlled provider identity and opaque per-start epoch.
//!
//! ## Security time
//!
//! The monotonic source is `GetTickCount64` — biased (COUNTS suspend/sleep duration, so a lease correctly
//! expires across a long suspend), monotonic, and immune to wall-clock (`SetSystemTime`) adjustment. It is
//! the sole currentness source. UTC is available only as optional redacted REPORTING evidence and is never
//! used for expiry or staleness.
//!
//! ## Production readiness
//!
//! No live acquisition ships: the sealed [`LiveClockObservationCapability`] has NO constructor in any
//! non-fixture graph, and the live FFI is gated behind `windows-live-clock`. `LIVE_CLOCK_RUN` is `false`;
//! `EXECUTION_READY` (in core) stays false; installation stays NotAuthorised.

use core::fmt;

/// This crate is an effect-free evidence contract; no live clock acquisition is reachable.
pub const WINDOWS_CLOCK_IS_CONTRACT_ONLY: bool = true;
/// No live clock observation runs in this phase.
pub const LIVE_CLOCK_RUN: bool = false;

/// Crate-private sealing marker for [`LiveClockObservationCapability`].
mod sealed {
    #[derive(Debug)]
    pub struct Private;
}

/// The sealed authority to acquire a LIVE Windows monotonic source. It has NO public constructor and NO
/// production constructor in this phase (only a fixture synthetic one under `test-fixtures`): compiling the
/// FFI is not authority to run it. Bound to the trusted host process; not copyable into another process.
pub struct LiveClockObservationCapability {
    _seal: sealed::Private,
    _thread_bound: core::marker::PhantomData<*const ()>,
}

impl fmt::Debug for LiveClockObservationCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LiveClockObservationCapability([REDACTED])")
    }
}

impl LiveClockObservationCapability {
    /// TEST-ONLY synthetic capability. A production graph never builds it, and it authorises no live read
    /// (the live source is additionally gated behind `windows-live-clock`).
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn synthetic_for_fixture() -> Self {
        Self {
            _seal: sealed::Private,
            _thread_bound: core::marker::PhantomData,
        }
    }
}

/// A bounded, redacted projection of one monotonic observation — EVIDENCE only. It carries the raw tick so
/// the core clock can enforce monotonicity, but it is NOT authority and has NO conversion into a
/// [`projectos_host_core::VerifiedAuthorityTime`], permit, grant, or runtime/IPC authority.
#[derive(Clone, Copy)]
pub struct ClockTickEvidence {
    tick: u64,
    seed: u64,
}

impl fmt::Debug for ClockTickEvidence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClockTickEvidence([REDACTED])")
    }
}

impl ClockTickEvidence {
    /// The raw biased monotonic tick (evidence only).
    #[must_use]
    pub fn tick(&self) -> u64 {
        self.tick
    }
    /// The lineage seed (evidence only).
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }
}

#[cfg(all(windows, feature = "windows-live-clock"))]
#[allow(unsafe_code)]
mod clock_ffi;

#[cfg(all(windows, feature = "windows-live-clock"))]
pub use live::WindowsMonotonicTickSource;

#[cfg(all(windows, feature = "windows-live-clock"))]
mod live {
    use super::{clock_ffi, LiveClockObservationCapability};
    use core::cell::Cell;
    use projectos_host_core::{MonotonicTickSource, TickSourceError};

    /// The LIVE Windows monotonic tick source. Acquired only with a sealed
    /// [`LiveClockObservationCapability`]; reads `GetTickCount64` (biased monotonic) and a one-time
    /// process-creation-time lineage seed. Implements the core `MonotonicTickSource`; it is EVIDENCE, not
    /// authority. `shutdown` revokes it so no further reading is produced.
    pub struct WindowsMonotonicTickSource {
        seed: u64,
        live: Cell<bool>,
        _thread_bound: core::marker::PhantomData<*const ()>,
    }

    impl WindowsMonotonicTickSource {
        /// Acquire the live source. Requires the sealed capability; captures the host process creation
        /// time once as the lineage seed.
        #[must_use]
        pub fn acquire(_capability: &LiveClockObservationCapability) -> Option<Self> {
            let seed = clock_ffi::process_creation_seed()?;
            Some(Self {
                seed,
                live: Cell::new(true),
                _thread_bound: core::marker::PhantomData,
            })
        }
        /// Revoke the source on host shutdown.
        pub fn shutdown(&self) {
            self.live.set(false);
        }
    }

    impl MonotonicTickSource for WindowsMonotonicTickSource {
        fn tick(&self) -> Result<u64, TickSourceError> {
            if !self.live.get() {
                return Err(TickSourceError::Unavailable);
            }
            Ok(clock_ffi::biased_monotonic_ticks())
        }
        fn epoch_seed(&self) -> u64 {
            self.seed
        }
        fn is_live(&self) -> bool {
            self.live.get()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn contract_is_effect_free_and_capability_is_sealed() {
        assert!(WINDOWS_CLOCK_IS_CONTRACT_ONLY);
        assert!(!LIVE_CLOCK_RUN);
        let cap = LiveClockObservationCapability::synthetic_for_fixture();
        assert!(format!("{cap:?}").contains("[REDACTED]"));
        let ev = ClockTickEvidence { tick: 42, seed: 7 };
        assert_eq!(ev.tick(), 42);
        assert!(format!("{ev:?}").contains("[REDACTED]"));
        assert!(!format!("{ev:?}").contains("42"));
    }

    /// LOCAL READ-ONLY WINDOWS PROOF: with the live feature on Windows, the real monotonic source returns
    /// a reading that does not regress, the lineage seed is non-zero, and shutdown refuses further reads.
    /// Read-only: no machine mutation, no handle/data escape, no residue.
    #[cfg(all(windows, feature = "windows-live-clock"))]
    #[test]
    fn live_monotonic_source_is_read_only_and_non_regressing() {
        use projectos_host_core::MonotonicTickSource;
        let cap = LiveClockObservationCapability::synthetic_for_fixture();
        let src = WindowsMonotonicTickSource::acquire(&cap).expect("live acquire");
        let a = src.tick().expect("first tick");
        let b = src.tick().expect("second tick");
        assert!(b >= a, "GetTickCount64 must be monotonic");
        assert!(src.epoch_seed() != 0, "process creation seed present");
        assert!(src.is_live());
        src.shutdown();
        assert!(!src.is_live());
        assert!(src.tick().is_err(), "no reading after shutdown");
    }
}
