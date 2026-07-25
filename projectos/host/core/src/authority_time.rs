//! Trusted temporal authority (CD-B4-OWNER-PRESENCE-AUTHORITY-TIME-REPLAY-AMENDMENT1A, Pattern C).
//!
//! A time-bounded lease (owner presence) is only trustworthy if authority evaluation uses the CURRENT
//! trusted time — not a value a caller retained. So the core never accepts a caller-supplied time
//! VALUE. Instead it obtains the current reading from an injected [`TrustedClock`] PROVIDER during
//! reducer and permit evaluation: the caller supplies the provider, never the reading, so a retained
//! historical [`VerifiedAuthorityTime`] cannot be replayed — there is nowhere to inject one.
//!
//! Each reading carries the provider identity and a monotonic epoch. The proof and permit record the
//! provider identity + epoch they were established under; evaluation refuses a reading from a different
//! provider (identity substitution) or an earlier epoch (provider restart / rollover). A [`TrustedClock`]
//! implementation must be monotonic and fail closed; it is the trust anchor.
//!
//! ## Production readiness
//!
//! This phase ships NO production clock — only the contract and a test-gated fixture provider. A
//! trustworthy monotonic clock provider is CARRY-FORWARD. `EXECUTION_READY` stays false. Time authority
//! is NOT owner-presence authority and NOT effect authority.

#![allow(dead_code)]

use core::fmt;

/// Why a trusted-time reading was rejected. Fail closed; payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityTimeError {
    /// The reading was earlier than a required floor (clock regressed / rewound).
    Regressed,
    /// The reading came from a different provider than the authority was established under.
    ProviderMismatch,
    /// The reading came from an earlier provider epoch (provider restart / rollover).
    EpochRegressed,
}

/// An opaque, verified reading from a [`TrustedClock`] — the sole temporal authority value, obtained
/// ONLY by calling a provider (never constructed by a caller). Carries the provider identity and a
/// monotonic epoch alongside the reading. Private fields, no public constructor, no `Default`, no serde,
/// no `From<u64>`, redacted Debug.
#[derive(Clone)]
pub struct VerifiedAuthorityTime {
    provider_id: String,
    epoch: u64,
    reading: u64,
}

impl fmt::Debug for VerifiedAuthorityTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("VerifiedAuthorityTime([REDACTED])")
    }
}

impl VerifiedAuthorityTime {
    pub(crate) fn provider_id(&self) -> &str {
        &self.provider_id
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }
    pub(crate) fn reading(&self) -> u64 {
        self.reading
    }

    /// Construct a reading. Crate-internal only: a [`TrustedClock`] provider (production or the fixture)
    /// mints readings this way, so no external caller can fabricate a current-time value.
    pub(crate) fn new(provider_id: impl Into<String>, epoch: u64, reading: u64) -> Self {
        Self {
            provider_id: provider_id.into(),
            epoch,
            reading,
        }
    }
}

/// Crate-private sealing marker. `sealed` is a PRIVATE module, so no external crate can name
/// `Sealed` and therefore none can satisfy the [`TrustedClock`] supertrait bound. Only crate-controlled
/// provider types (the test fixture now; a production provider later, added by an explicit core change)
/// may implement it. Not a documentation convention — the compiler enforces it.
mod sealed {
    pub trait Sealed {}
}

/// The injected trusted-clock PROVIDER. Authority evaluation calls [`TrustedClock::read_current`] to get
/// the CURRENT reading; a caller supplies the provider, never a reading. Implementations MUST be
/// monotonic (a later call never returns an earlier epoch, and never an earlier reading within an epoch)
/// and fail closed. There is NO production implementation in this phase — only a test-gated fixture.
///
/// SEALED: the `sealed::Sealed` supertrait is crate-private, so no external crate can implement this
/// trait. That closes the replay-laundering hole where a caller-authored clock returned a RETAINED
/// genuine [`VerifiedAuthorityTime`] (real provider id + epoch) to pass evaluation with stale time —
/// there is no external `read_current` to inject a retained reading through.
pub trait TrustedClock: sealed::Sealed {
    /// The current verified reading from this provider.
    fn read_current(&self) -> VerifiedAuthorityTime;
}

#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture::FixtureClock;

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture {
    use super::{TrustedClock, VerifiedAuthorityTime};
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering};
    use std::rc::Rc;

    /// The ONE authoritative state of a fixture provider. Every handle shares the SAME `Rc<ClockState>`,
    /// so a retained handle cannot lag behind another handle that advanced the reading.
    struct ClockState {
        provider_id: String,
        epoch: Cell<u64>,
        reading: Cell<u64>,
    }

    /// TEST-ONLY canonical monotonic clock provider (Model A). Its identity is NOT caller-selectable — a
    /// unique instance id is assigned at construction, so no caller can fabricate a second provider with
    /// the same identity. [`FixtureClock::handle`] returns another handle SHARING the same authoritative
    /// state; `advance_to` / `next_epoch` mutate that shared state, so all handles read the current value.
    /// A production graph never builds it.
    #[derive(Clone)]
    pub struct FixtureClock {
        state: Rc<ClockState>,
    }

    // Process-unique provider-instance ids. Deterministic ordering; a caller cannot select or duplicate.
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    impl FixtureClock {
        /// A fresh provider with a UNIQUE, non-caller-selectable identity, at `reading`, epoch 1.
        #[must_use]
        pub fn new(reading: u64) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            Self {
                state: Rc::new(ClockState {
                    provider_id: format!("fixture-clock-{id}"),
                    epoch: Cell::new(1),
                    reading: Cell::new(reading),
                }),
            }
        }

        /// Another handle to the SAME authoritative provider state (Model A: shared, not independent).
        #[must_use]
        pub fn handle(&self) -> Self {
            Self {
                state: Rc::clone(&self.state),
            }
        }

        /// Advance the reading forward (monotonic; a backward move is rejected so a test cannot model an
        /// impossible provider). Visible through every handle sharing this state.
        pub fn advance_to(&self, reading: u64) {
            assert!(
                reading >= self.state.reading.get(),
                "fixture clock must be monotonic"
            );
            self.state.reading.set(reading);
        }

        /// Simulate a provider restart / epoch rollover on the shared state.
        pub fn next_epoch(&self, reading: u64) {
            self.state.epoch.set(self.state.epoch.get() + 1);
            self.state.reading.set(reading);
        }
    }

    impl super::sealed::Sealed for FixtureClock {}
    impl TrustedClock for FixtureClock {
        fn read_current(&self) -> VerifiedAuthorityTime {
            VerifiedAuthorityTime::new(
                self.state.provider_id.clone(),
                self.state.epoch.get(),
                self.state.reading.get(),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clock_reads_current_time_and_advances_monotonically() {
        let c = FixtureClock::new(100);
        assert_eq!(c.read_current().reading(), 100);
        c.advance_to(111);
        let t = c.read_current();
        assert_eq!(t.reading(), 111);
        assert!(t.provider_id().starts_with("fixture-clock-"));
        assert_eq!(t.epoch(), 1);
    }

    #[test]
    fn every_handle_shares_the_same_authoritative_state() {
        // Model A: a retained handle cannot lag behind another handle that advanced the reading.
        let h1 = FixtureClock::new(105);
        let h2 = h1.handle();
        assert_eq!(h1.read_current().reading(), 105);
        h2.advance_to(111);
        // The retained handle now observes the CURRENT reading, not the historical 105.
        assert_eq!(h1.read_current().reading(), 111);
        // Both handles report the SAME provider identity.
        assert_eq!(
            h1.read_current().provider_id(),
            h2.read_current().provider_id()
        );
    }

    #[test]
    fn distinct_providers_have_distinct_identities() {
        // Identity is NOT caller-selectable: two fresh providers can never collide.
        let a = FixtureClock::new(100);
        let b = FixtureClock::new(100);
        assert_ne!(
            a.read_current().provider_id(),
            b.read_current().provider_id()
        );
    }

    #[test]
    fn an_epoch_rollover_bumps_the_epoch() {
        let c = FixtureClock::new(100);
        assert_eq!(c.read_current().epoch(), 1);
        c.next_epoch(5);
        assert_eq!(c.read_current().epoch(), 2);
    }

    #[test]
    fn debug_is_redacted() {
        let c = FixtureClock::new(12345);
        let s = format!("{:?}", c.read_current());
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains("12345"));
    }
}
