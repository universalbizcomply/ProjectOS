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

/// Why a trusted-time reading was rejected. Fail closed; payload-free (no raw provider material, OS
/// error payload, handle, or epoch-construction input).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AuthorityTimeError {
    /// The reading was earlier than a required floor (clock regressed / rewound).
    Regressed,
    /// The reading came from a different provider than the authority was established under.
    ProviderMismatch,
    /// The reading came from an earlier provider epoch (provider restart / rollover).
    EpochRegressed,
    /// The trusted-clock source is unavailable (never live, or permanently poisoned by a prior fault).
    ClockUnavailable,
    /// The provider observed shutdown; no further readings are minted.
    ShutdownObserved,
    /// The monotonic reading regressed below the last accepted reading.
    ReadingRegressed,
    /// The forward jump between readings exceeded the accepted discontinuity bound (suspend/adjust).
    ClockDiscontinuity,
    /// A raw tick could not be converted into the bounded reading range.
    ConversionFailed,
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
    /// The MONOTONIC security reading (the value that drives issue time, expiry and staleness). Public so
    /// a runtime/effect provider legitimately holding a reading can bound its observation window; it is a
    /// value, not identity, and does not permit forging a [`VerifiedAuthorityTime`] (which has no public
    /// constructor). The opaque provider identity and epoch remain crate-private.
    #[must_use]
    pub fn reading(&self) -> u64 {
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

// ---------------------------------------------------------------------------------------------
// Production trusted clock (sealed) + its non-authority monotonic tick source
// ---------------------------------------------------------------------------------------------

/// Why a raw monotonic tick could not be produced. Fail closed; payload-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum TickSourceError {
    /// The underlying monotonic source is unavailable.
    Unavailable,
    /// The OS value could not be converted into a bounded `u64` tick.
    ConversionFailed,
}

/// A NON-AUTHORITY source of BIASED monotonic ticks (a `u64` that counts elapsed real time INCLUDING
/// suspend, is immune to wall-clock adjustment, and never regresses within a live provider lineage). It
/// supplies EVIDENCE only: it CANNOT mint a [`VerifiedAuthorityTime`], a permit, a grant, or any runtime
/// / IPC authority — only [`ProductionTrustedClock`] (a sealed [`TrustedClock`]) turns ticks into a
/// verified reading, stamping the crate-controlled provider identity + per-start epoch. The trait is
/// deliberately UNSEALED (a tick is evidence, not authority): a fixture or a future Windows source may
/// implement it; a fake or frozen source is a provisioning defect, never an authority forgery.
pub trait MonotonicTickSource {
    /// The current biased monotonic tick, or a fail-closed error.
    fn tick(&self) -> Result<u64, TickSourceError>;
    /// A per-provider-start lineage seed (e.g. the host process creation time) folded into the opaque
    /// provider epoch. A restart yields a different seed → a different epoch → prior authority refused.
    fn epoch_seed(&self) -> u64;
    /// Whether the source is still live. `false` after shutdown; a reading is then refused fail-closed.
    fn is_live(&self) -> bool;
}

/// The crate-controlled production provider identity. A CONST (identifies the approved implementation and
/// authority source), never caller-selectable. Distinct lineages are told apart by the opaque epoch.
const PRODUCTION_CLOCK_PROVIDER_ID: &str = "projectos:production-trusted-clock:v1";
/// The fail-closed provider identity a poisoned clock reports, so every consumer's currentness check
/// refuses with `ProviderMismatch` after any fault.
const POISONED_CLOCK_PROVIDER_ID: &str = "projectos:production-trusted-clock:POISONED";

/// Derive an OPAQUE, non-reconstructable per-start epoch from the lineage seed and a process-unique
/// nonce. Compared only for EXACT equality (never numeric ordering); an evidence report never exposes the
/// seed or nonce, so the epoch cannot be reconstructed.
fn derive_epoch(seed: u64) -> u64 {
    use core::sync::atomic::{AtomicU64, Ordering};
    use sha2::{Digest, Sha256};
    static NONCE: AtomicU64 = AtomicU64::new(1);
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:CLOCK-EPOCH:V1");
    h.update(seed.to_be_bytes());
    h.update(nonce.to_be_bytes());
    let d: [u8; 32] = h.finalize().into();
    u64::from_be_bytes(d[0..8].try_into().expect("8 bytes"))
}

/// A production trusted clock: the sealed [`TrustedClock`] that turns BIASED monotonic ticks from an
/// injected [`MonotonicTickSource`] into opaque [`VerifiedAuthorityTime`] readings under a crate-assigned
/// provider identity and a per-start opaque epoch. Monotonic time ALONE controls issue/expiry/staleness;
/// UTC is never consulted. Any fault (regression, excessive discontinuity, shutdown, conversion failure)
/// PERMANENTLY poisons the clock: it thereafter reports a distinct `POISONED` provider identity so every
/// downstream currentness check refuses — fail-closed at the infallible trait boundary. No public
/// constructor mints authority for a caller; no `Default`, no serde, no `From`, redacted Debug.
pub struct ProductionTrustedClock<S: MonotonicTickSource> {
    source: S,
    epoch: u64,
    last_reading: core::cell::Cell<u64>,
    max_forward_jump: u64,
    poisoned: core::cell::Cell<bool>,
    /// `!Send + !Sync`: an authority clock must not silently cross a thread boundary.
    _thread_bound: core::marker::PhantomData<*const ()>,
}

impl<S: MonotonicTickSource> fmt::Debug for ProductionTrustedClock<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProductionTrustedClock([REDACTED])")
    }
}

impl<S: MonotonicTickSource> ProductionTrustedClock<S> {
    /// Bind a production clock to a monotonic tick source. Crate-internal: only a crate-controlled
    /// acquisition path (a future host wiring, added by an explicit core change) may call this, so an
    /// ordinary external caller cannot select the provider identity or epoch. The epoch is derived from
    /// the source's lineage seed and is opaque.
    pub(crate) fn bind(source: S, max_forward_jump: u64) -> Self {
        let epoch = derive_epoch(source.epoch_seed());
        Self {
            source,
            epoch,
            last_reading: core::cell::Cell::new(0),
            max_forward_jump,
            poisoned: core::cell::Cell::new(false),
            _thread_bound: core::marker::PhantomData,
        }
    }

    fn poison(&self) {
        self.poisoned.set(true);
    }

    /// The checked read: the real fail-closed logic with a STRUCTURED error. `read_current` (the
    /// infallible trait method) delegates here and poisons on any error.
    ///
    /// PUBLIC SINCE PROJECTOS-HOST-REVIEW-PATH1B §10. The trusted startup composition must be able to
    /// STOP when the clock cannot produce a reading, rather than carry a poisoned reading forward and
    /// discover it two links later as a provider mismatch. Widening this grants nothing: it returns
    /// exactly the value `read_current` already returns, and differs only in reporting WHY a reading
    /// failed instead of silently substituting the poisoned provider identity. It still cannot be
    /// reached without holding a `ProductionTrustedClock`, which only `bind_production_clock` makes,
    /// which only a `ProductionClockBindingGrant` authorises.
    ///
    /// # Errors
    /// [`AuthorityTimeError`] naming the first failed invariant.
    pub fn try_read_current(&self) -> Result<VerifiedAuthorityTime, AuthorityTimeError> {
        if self.poisoned.get() {
            return Err(AuthorityTimeError::ClockUnavailable);
        }
        if !self.source.is_live() {
            self.poison();
            return Err(AuthorityTimeError::ShutdownObserved);
        }
        let tick = match self.source.tick() {
            Ok(t) => t,
            Err(TickSourceError::Unavailable) => {
                self.poison();
                return Err(AuthorityTimeError::ClockUnavailable);
            }
            Err(TickSourceError::ConversionFailed) => {
                self.poison();
                return Err(AuthorityTimeError::ConversionFailed);
            }
        };
        let last = self.last_reading.get();
        if tick < last {
            self.poison();
            return Err(AuthorityTimeError::ReadingRegressed);
        }
        if tick - last > self.max_forward_jump && last != 0 {
            // An excessive forward jump (suspend beyond bound / adjustment) invalidates the lineage.
            self.poison();
            return Err(AuthorityTimeError::ClockDiscontinuity);
        }
        self.last_reading.set(tick);
        Ok(VerifiedAuthorityTime::new(
            PRODUCTION_CLOCK_PROVIDER_ID,
            self.epoch,
            tick,
        ))
    }
}

impl<S: MonotonicTickSource> sealed::Sealed for ProductionTrustedClock<S> {}
impl<S: MonotonicTickSource> TrustedClock for ProductionTrustedClock<S> {
    fn read_current(&self) -> VerifiedAuthorityTime {
        // Fail-closed at the infallible boundary: a poisoned/faulted clock reports a distinct POISONED
        // provider identity (and a zero reading), so every downstream currentness check refuses.
        self.try_read_current().unwrap_or_else(|_| {
            self.poison();
            VerifiedAuthorityTime::new(POISONED_CLOCK_PROVIDER_ID, self.epoch, 0)
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Cross-crate production-clock binding authority (CD-B4-PRODUCTION-CLOCK-RUNTIME-BINDING-AMENDMENT1A)
// ---------------------------------------------------------------------------------------------

/// The AUTHORITY GATE for constructing a production [`ProductionTrustedClock`] from an evidence
/// [`MonotonicTickSource`] that lives OUTSIDE core (e.g. the Windows monotonic source).
///
/// [`MonotonicTickSource`] is deliberately UNSEALED — a tick is evidence, not authority — so an
/// arbitrary crate can supply ticks. That is only safe because binding a source into a production
/// clock (which then mints [`VerifiedAuthorityTime`]) is gated by this opaque, MOVE-CONSUMED, single-use
/// grant: an ordinary crate cannot construct it, so it cannot call [`bind_production_clock`], so it can
/// never turn arbitrary ticks into trusted temporal authority. Mirrors the `BoundedEffectGrant` posture:
/// private field, no public constructor, no `Default`, no `Clone`/`Copy`, no serde, redacted `Debug`,
/// thread-bound (`!Send + !Sync`). One grant binds exactly one clock lineage.
///
/// There is NO production/default-graph mint in this phase: the only mint is the test-fixtures
/// [`fixture_production_clock_binding_grant`], used for the local read-only proof and tests. A real
/// production mint (owner-gated, installed-service activation) is CARRY-FORWARD and deliberately absent,
/// so no production runtime authority can be minted here (`EXECUTION_READY` stays false).
pub struct ProductionClockBindingGrant {
    /// `!Send + !Sync`: a binding authority must not silently cross a thread boundary.
    _thread_bound: core::marker::PhantomData<*const ()>,
}

impl fmt::Debug for ProductionClockBindingGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProductionClockBindingGrant([REDACTED])")
    }
}

impl ProductionClockBindingGrant {
    /// The sole mint. Crate-private, so no external crate — in ANY graph — can construct a grant; the
    /// only reachable mint is the test-fixtures [`fixture_production_clock_binding_grant`].
    pub(crate) fn mint() -> Self {
        Self {
            _thread_bound: core::marker::PhantomData,
        }
    }
}

/// Bind an evidence [`MonotonicTickSource`] into a sealed production [`ProductionTrustedClock`],
/// CONSUMING (by move) a [`ProductionClockBindingGrant`]. This is the ONLY public path from an external
/// tick source to a production clock: the grant is the authority gate, so an arbitrary source without a
/// grant cannot produce a [`VerifiedAuthorityTime`]. The provider identity stays the core CONST and the
/// per-start epoch stays core-derived from `source.epoch_seed()`; the grant influences neither. Because
/// the grant is moved in and dropped, it is single-use: one grant binds one clock lineage.
#[must_use]
pub fn bind_production_clock<S: MonotonicTickSource>(
    grant: ProductionClockBindingGrant,
    source: S,
    max_forward_jump: u64,
) -> ProductionTrustedClock<S> {
    // Consume the grant by move: it authorises exactly this one binding and cannot be reused.
    let ProductionClockBindingGrant { _thread_bound } = grant;
    ProductionTrustedClock::bind(source, max_forward_jump)
}

/// TEST-ONLY mint of a [`ProductionClockBindingGrant`] for the local read-only proof and tests. Gated to
/// `test-fixtures`, so the default graph has NO way to obtain a grant and therefore cannot bind a
/// production clock. A production mint is CARRY-FORWARD and absent.
#[cfg(any(test, feature = "test-fixtures"))]
#[must_use]
pub fn fixture_production_clock_binding_grant() -> ProductionClockBindingGrant {
    ProductionClockBindingGrant::mint()
}

/// TEST-ONLY in-memory monotonic tick source for exercising [`ProductionTrustedClock`] WITHOUT the
/// Windows FFI: `advance`/`regress`/`jump` drive the tick, `set_seed` models a host restart, `shutdown`
/// models provider shutdown. A production graph never builds it.
#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture_tick::FixtureMonotonicTickSource;

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture_tick {
    use super::{MonotonicTickSource, TickSourceError};
    use core::cell::Cell;

    /// A controllable monotonic tick source (test only).
    pub struct FixtureMonotonicTickSource {
        tick: Cell<u64>,
        seed: Cell<u64>,
        live: Cell<bool>,
        fail_convert: Cell<bool>,
    }

    impl FixtureMonotonicTickSource {
        #[must_use]
        pub fn new(start: u64, seed: u64) -> Self {
            Self {
                tick: Cell::new(start),
                seed: Cell::new(seed),
                live: Cell::new(true),
                fail_convert: Cell::new(false),
            }
        }
        /// Advance the tick forward by `by`.
        pub fn advance(&self, by: u64) {
            self.tick.set(self.tick.get() + by);
        }
        /// Force the next raw tick to a lower value (models a monotonic regression).
        pub fn regress_to(&self, to: u64) {
            self.tick.set(to);
        }
        /// Model a host restart lineage change (new epoch seed).
        pub fn set_seed(&self, seed: u64) {
            self.seed.set(seed);
        }
        /// Model provider shutdown.
        pub fn shutdown(&self) {
            self.live.set(false);
        }
        /// Model a conversion failure on the next read.
        pub fn fail_conversion(&self) {
            self.fail_convert.set(true);
        }
    }

    impl MonotonicTickSource for FixtureMonotonicTickSource {
        fn tick(&self) -> Result<u64, TickSourceError> {
            if self.fail_convert.get() {
                return Err(TickSourceError::ConversionFailed);
            }
            Ok(self.tick.get())
        }
        fn epoch_seed(&self) -> u64 {
            self.seed.get()
        }
        fn is_live(&self) -> bool {
            self.live.get()
        }
    }
}

/// TEST-ONLY crate-internal binder so tests (and a future host) can construct a [`ProductionTrustedClock`]
/// from a tick source without a public authority constructor.
#[cfg(any(test, feature = "test-fixtures"))]
#[must_use]
pub fn fixture_bind_production_clock<S: MonotonicTickSource>(
    source: S,
    max_forward_jump: u64,
) -> ProductionTrustedClock<S> {
    ProductionTrustedClock::bind(source, max_forward_jump)
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

    // ---- ProductionTrustedClock (via the fixture tick source) ----------------------------------

    fn prod(
        start: u64,
        seed: u64,
        bound: u64,
    ) -> ProductionTrustedClock<FixtureMonotonicTickSource> {
        ProductionTrustedClock::bind(FixtureMonotonicTickSource::new(start, seed), bound)
    }

    // T1 — valid production evidence yields a monotonic reading under the crate provider identity.
    #[test]
    fn prod_valid_read_is_monotonic_under_the_crate_provider() {
        let c = prod(100, 7, 10_000);
        let t = c.try_read_current().unwrap();
        assert_eq!(t.reading(), 100);
        assert_eq!(t.provider_id(), PRODUCTION_CLOCK_PROVIDER_ID);
        c.source.advance(50);
        assert_eq!(c.try_read_current().unwrap().reading(), 150);
    }

    // T9 / M3 — a monotonic regression is refused and permanently poisons the clock.
    #[test]
    fn prod_regression_refused_and_poisons() {
        let c = prod(100, 7, 10_000);
        c.try_read_current().unwrap();
        c.source.regress_to(50);
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ReadingRegressed
        );
        // Poisoned thereafter.
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ClockUnavailable
        );
        // Fail-closed at the trait boundary: a POISONED provider identity every consumer refuses.
        assert_eq!(c.read_current().provider_id(), POISONED_CLOCK_PROVIDER_ID);
    }

    // T11 / M14 — an excessive forward discontinuity is refused.
    #[test]
    fn prod_discontinuity_refused() {
        let c = prod(10, 7, 100);
        c.try_read_current().unwrap();
        c.source.advance(10_000); // > max_forward_jump (100)
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ClockDiscontinuity
        );
    }

    // T13 / T14 / M8 — shutdown and post-shutdown reads are refused.
    #[test]
    fn prod_shutdown_refused() {
        let c = prod(100, 7, 10_000);
        c.try_read_current().unwrap();
        c.source.shutdown();
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ShutdownObserved
        );
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ClockUnavailable
        );
    }

    // T17 / M13 — a conversion failure is refused.
    #[test]
    fn prod_conversion_failure_refused() {
        let c = prod(100, 7, 10_000);
        c.source.fail_conversion();
        assert_eq!(
            c.try_read_current().unwrap_err(),
            AuthorityTimeError::ConversionFailed
        );
    }

    // T5 / T6 — different provider start (seed) yields a DIFFERENT opaque epoch; same crate provider id.
    #[test]
    fn prod_epoch_differs_per_start_but_provider_is_stable() {
        let a = prod(100, 7, 10_000);
        let b = prod(100, 999, 10_000);
        let ta = a.try_read_current().unwrap();
        let tb = b.try_read_current().unwrap();
        assert_eq!(ta.provider_id(), tb.provider_id()); // stable crate provider identity
        assert_ne!(ta.epoch(), tb.epoch()); // distinct opaque lineage epochs
    }

    // T23 / M12 — Debug is redacted.
    #[test]
    fn prod_debug_is_redacted() {
        let c = prod(12345, 7, 10_000);
        assert!(format!("{c:?}").contains("[REDACTED]"));
        assert!(!format!("{c:?}").contains("12345"));
    }
}

// ---------------------------------------------------------------------------------------------
// PROJECTOS-HOST-REVIEW-PATH1B G2 — THE PRODUCTION MINT OF THE CLOCK-BINDING GRANT
//
// The owner ruling, restated as code:
//
//   "A Cargo feature may COMPILE the production clock-binding route. A feature MUST NOT itself mint
//    trusted temporal authority. ProductionClockBindingGrant must be obtainable only from a
//    non-forgeable ONE-SHOT service-runtime authority proof originating from the SAME successful
//    fresh ProjectOSHost machine-authority acquisition."
//
// So the feature below compiles a route whose ONLY entry takes a borrowed `ConfirmedAuthorityGuard`
// whose corroborated state is `ServiceRuntimeConfirmed`. That guard is not constructible by any
// dependent crate: `ConfirmedAuthorityGuard::confirm` consumes an `AuthorityGuard`, which has no
// public constructor at all, and `confirm` additionally refuses anything but a FRESH `AcquiredToken`
// create — so the guard attests that THIS process acquired the machine-wide authority, now. The
// `ServiceRuntimeConfirmed` state additionally required here is derived inside host-authority from
// the real per-service-SID self proof, never from a value a caller wrote down.
//
// The feature therefore decides only whether the route EXISTS. It decides nothing about authority:
// with the feature on and no guard, there is still no grant.
// ---------------------------------------------------------------------------------------------

/// Why the production clock authority was refused. Fail closed; payload-free.
#[cfg(feature = "production-clock-binding")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProductionClockAuthorityRefusal {
    /// The confirmed authority is not the SERVICE RUNTIME. An interactive fallback confirms a real
    /// machine-wide authority, but it is not the installed ProjectOSHost service, and the production
    /// clock lineage belongs to the service.
    NotServiceRuntime,
    /// A production clock lineage was ALREADY established in this process. One service startup
    /// establishes one trusted clock lineage; a second attempt is refused rather than served.
    AlreadyEstablished,
}

#[cfg(feature = "production-clock-binding")]
impl fmt::Display for ProductionClockAuthorityRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NotServiceRuntime => "confirmed authority is not the service runtime",
            Self::AlreadyEstablished => "a production clock lineage is already established",
        })
    }
}

#[cfg(feature = "production-clock-binding")]
impl std::error::Error for ProductionClockAuthorityRefusal {}

/// THE ONE-SHOT SERVICE-RUNTIME AUTHORITY PROOF that a production clock lineage may be established.
///
/// Opaque and unforgeable: private field, no public constructor, no `Default`, no `Clone`, no `Copy`,
/// no serde, redacted `Debug`, `!Send + !Sync`. The ONLY way to obtain one is
/// [`establish_production_clock_authority`], and that is reachable at most ONCE per process.
///
/// It is deliberately a SEPARATE value from the grant it yields, so the two things the ruling
/// separates stay separate: holding this proves the service runtime was confirmed; converting it —
/// by move, exactly once — is what authorises ONE clock binding.
///
/// It is NOT a second authority system. It mints no time, holds no handle, releases nothing on drop
/// and cannot be turned back into a `ConfirmedAuthorityGuard`: it is a receipt for one already-made
/// decision, taken by the frozen confirmation rule that made it.
#[cfg(feature = "production-clock-binding")]
pub struct ProductionClockAuthority {
    /// `!Send + !Sync`: a temporal-authority proof must not silently cross a thread boundary.
    _thread_bound: core::marker::PhantomData<*const ()>,
}

#[cfg(feature = "production-clock-binding")]
impl fmt::Debug for ProductionClockAuthority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProductionClockAuthority([REDACTED])")
    }
}

/// The process-wide one-shot latch. `true` once a production clock lineage has been established.
///
/// ONE SERVICE STARTUP, ONE LINEAGE. The latch is set BEFORE the authority value is produced, with a
/// compare-and-exchange, so two threads racing the same startup cannot both be served — the loser is
/// told [`ProductionClockAuthorityRefusal::AlreadyEstablished`] rather than handed a second lineage.
#[cfg(feature = "production-clock-binding")]
static PRODUCTION_CLOCK_ESTABLISHED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// Establish THE production clock authority for this service process.
///
/// The ONLY input is a BORROWED `ConfirmedAuthorityGuard`. It is borrowed, not consumed, because the
/// very same guard must go on to open the provider-authority lease: one acquisition, one guard, one
/// lineage, one lease. Borrowing also means this call can never release the machine-wide authority,
/// and can never be mistaken for having acquired it.
///
/// WHAT IT REFUSES, AND WHY THERE IS NOTHING ELSE TO REFUSE. There is no other parameter: no bool,
/// no string, no enum a caller selects, no environment, no CLI, no request field, no Agent data, no
/// elevation check, no feature test and no verified-installation-shaped substitute. A caller that
/// does not already hold a service-runtime-confirmed machine authority has nothing to pass, and a
/// caller that does has nothing left to choose.
///
/// # Errors
/// [`ProductionClockAuthorityRefusal`] naming the first failed condition.
#[cfg(feature = "production-clock-binding")]
pub fn establish_production_clock_authority(
    confirmed: &projectos_host_authority::model::ConfirmedAuthorityGuard,
) -> Result<ProductionClockAuthority, ProductionClockAuthorityRefusal> {
    use core::sync::atomic::Ordering;
    use projectos_host_authority::model::AuthorityPeerState;

    // THE SERVICE, NOT MERELY AN AUTHORITY. Matched exhaustively against the one accepted state, so a
    // future peer state cannot join by default.
    match confirmed.peer_state() {
        AuthorityPeerState::ServiceRuntimeConfirmed => {}
        _ => return Err(ProductionClockAuthorityRefusal::NotServiceRuntime),
    }
    // ONE-SHOT. Claimed atomically before anything is produced.
    if PRODUCTION_CLOCK_ESTABLISHED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(ProductionClockAuthorityRefusal::AlreadyEstablished);
    }
    Ok(ProductionClockAuthority {
        _thread_bound: core::marker::PhantomData,
    })
}

#[cfg(feature = "production-clock-binding")]
impl ProductionClockAuthority {
    /// Convert the one-shot service-runtime authority proof into THE production
    /// [`ProductionClockBindingGrant`], CONSUMING it.
    ///
    /// This is the production mint the ruling authorises, and it is the only one: the grant's own
    /// `mint()` stays crate-private, so no dependent crate can reach it, and the fixture mint stays
    /// `test-fixtures`-only and is never enabled by this feature.
    ///
    /// Consumed by move, so one authority binds one lineage even within the single startup that was
    /// allowed to establish it.
    #[must_use]
    pub fn into_clock_binding_grant(self) -> ProductionClockBindingGrant {
        let ProductionClockAuthority { _thread_bound } = self;
        ProductionClockBindingGrant::mint()
    }
}

/// TEST-ONLY: clear the one-shot latch so a test can exercise the route more than once in the one
/// test process. `cfg(test)` alone — deliberately NOT behind `test-fixtures`, so no dependent crate
/// and no fixture graph can reset a production lineage.
#[cfg(all(test, feature = "production-clock-binding"))]
pub(crate) fn reset_production_clock_latch_for_test() {
    PRODUCTION_CLOCK_ESTABLISHED.store(false, core::sync::atomic::Ordering::SeqCst);
}

#[cfg(all(test, feature = "production-clock-binding"))]
mod production_clock_authority_tests {
    use super::*;
    use projectos_host_authority::model::{AuthorityPeerState, ConfirmedAuthorityGuard};

    /// The ONLY route to a confirmed guard inside core's own tests is host-authority's pure contract
    /// fixture, which core enables as a DEV dependency. It is not reachable from any shipped graph.
    fn confirmed(state: AuthorityPeerState) -> ConfirmedAuthorityGuard {
        ConfirmedAuthorityGuard::for_local_proof(state).expect("an authoritative state")
    }

    #[test]
    fn an_interactive_fallback_authority_cannot_mint_the_clock_grant() {
        reset_production_clock_latch_for_test();
        let guard = confirmed(AuthorityPeerState::InteractiveFallbackConfirmed);
        assert_eq!(
            establish_production_clock_authority(&guard).unwrap_err(),
            ProductionClockAuthorityRefusal::NotServiceRuntime
        );
        // And the latch was NOT consumed by the refusal: a refusal must not deny the real service.
        let service = confirmed(AuthorityPeerState::ServiceRuntimeConfirmed);
        assert!(establish_production_clock_authority(&service).is_ok());
        reset_production_clock_latch_for_test();
    }

    #[test]
    fn the_service_runtime_authority_establishes_exactly_one_lineage() {
        reset_production_clock_latch_for_test();
        let guard = confirmed(AuthorityPeerState::ServiceRuntimeConfirmed);
        let first = establish_production_clock_authority(&guard);
        assert!(first.is_ok(), "the first startup establishes the lineage");
        // A SECOND establishment in the same process is refused, with the SAME guard: one service
        // startup, one trusted clock lineage.
        assert_eq!(
            establish_production_clock_authority(&guard).unwrap_err(),
            ProductionClockAuthorityRefusal::AlreadyEstablished
        );
        // Even a freshly confirmed authority cannot establish a second one.
        let another = confirmed(AuthorityPeerState::ServiceRuntimeConfirmed);
        assert_eq!(
            establish_production_clock_authority(&another).unwrap_err(),
            ProductionClockAuthorityRefusal::AlreadyEstablished
        );
        reset_production_clock_latch_for_test();
    }

    #[test]
    fn the_authority_is_redacted_and_binds_a_real_lineage() {
        reset_production_clock_latch_for_test();
        let guard = confirmed(AuthorityPeerState::ServiceRuntimeConfirmed);
        let authority = establish_production_clock_authority(&guard).expect("service runtime");
        assert!(format!("{authority:?}").contains("[REDACTED]"));
        // The grant it yields binds a real production clock over an injected evidence tick source.
        let grant = authority.into_clock_binding_grant();
        let clock = bind_production_clock(grant, FixtureMonotonicTickSource::new(1_000, 7), 10_000);
        let reading = clock.try_read_current().expect("a live reading");
        assert_eq!(reading.reading(), 1_000);
        assert_eq!(reading.provider_id(), PRODUCTION_CLOCK_PROVIDER_ID);
        reset_production_clock_latch_for_test();
    }
}
