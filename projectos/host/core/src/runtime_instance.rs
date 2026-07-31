//! Runtime-instance authority (CD-B4-RUNTIME-INSTANCE-AUTHORITY1A, Pattern C).
//!
//! A trusted ProjectOS host runs as exactly ONE process for exactly ONE start. This module mints the sole
//! runtime-instance authority value — the opaque [`VerifiedRuntimeInstance`] — that represents one exact
//! trusted host start, so a permit or effect grant bound to it (a LATER phase) can never be moved,
//! replayed or substituted across host restarts, concurrent host instances, or a different process.
//!
//! Authority is minted ONLY by a sealed [`RuntimeInstanceVerifier`] from an UNTRUSTED
//! [`RuntimeInstanceObservation`] a future adapter measured. A compiled ability to observe a runtime is
//! not authority; neither is a Boolean, a report, a raw PID, a [`ServiceInstanceEvidence`] projection, or
//! a caller-constructed value. Every opaque type has private fields, no public constructor, no `Default`,
//! no serde-as-authority, no broad `From`, a redacted `Debug`, and is thread-bound (`!Send + !Sync`).
//!
//! ## Relationship to `ServiceInstanceToken`
//!
//! The Windows `ServiceInstanceToken` (crate `projectos-host-windows-service-identity-proof`) is OS-derived
//! EVIDENCE, not authority. It never enters `core` and can never itself mint a [`VerifiedRuntimeInstance`].
//! Where a Windows-service host has such evidence, a future adapter projects it into the bounded
//! [`ServiceInstanceEvidence`] carried on the observation; the sealed verifier decides whether that
//! evidence is sufficient. An interactive-fallback host mints WITHOUT service evidence under its own
//! accepted role. This phase adds NO dependency on the Windows crate and performs no real observation.
//!
//! ## Production readiness
//!
//! This phase ships NO production runtime provider. The only verifier is the test-gated fixture. Runtime
//! authority is NOT integrated into [`crate::capability::VerifiedExecutionContext`], the permit, the
//! effect-grant issuance key, or any witness — those are CARRY-FORWARD. `EXECUTION_READY` stays false and
//! this authority never itself performs a protected action.

#![allow(dead_code)]

use core::fmt;
use core::marker::PhantomData;

use sha2::{Digest, Sha256};

use crate::authority_time::VerifiedAuthorityTime;
use crate::facts::{validate_bounded_id, SessionId};

/// `!Send + !Sync` marker, matching the crate's other opaque authority types: an authority value must not
/// silently cross a thread boundary.
type ThreadBound = PhantomData<*const ()>;

// ---------------------------------------------------------------------------------------------
// Bounded host role + observation source (never a bare Boolean / free string)
// ---------------------------------------------------------------------------------------------

/// The authoritative host role a runtime instance runs as. A closed enum, never a bare string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostRole {
    /// The host runs as the installed Windows service (`ProjectOSHost`).
    InstalledService,
    /// The host runs as an owner-interactive fallback (no installed service).
    InteractiveFallback,
}

/// Where a runtime observation originated. Closed; a production verifier never accepts `Fixture`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RuntimeSource {
    /// Observed from the Windows Service Control Manager path (service-instance evidence expected).
    WindowsService,
    /// Observed from the owner-interactive fallback path (no service-instance evidence).
    InteractiveFallback,
    /// Synthetic fixture observation (test-only; refused by any production verifier).
    Fixture,
}

impl HostRole {
    fn tag(self) -> u8 {
        match self {
            HostRole::InstalledService => 1,
            HostRole::InteractiveFallback => 2,
        }
    }
    /// Whether this role is consistent with an observation `source`.
    fn accepts_source(self, source: RuntimeSource) -> bool {
        matches!(
            (self, source),
            (HostRole::InstalledService, RuntimeSource::WindowsService)
                | (
                    HostRole::InteractiveFallback,
                    RuntimeSource::InteractiveFallback
                )
                | (_, RuntimeSource::Fixture)
        )
    }
}

impl RuntimeSource {
    fn tag(self) -> u8 {
        match self {
            RuntimeSource::WindowsService => 1,
            RuntimeSource::InteractiveFallback => 2,
            RuntimeSource::Fixture => 3,
        }
    }
    fn requires_service_evidence(self) -> bool {
        matches!(self, RuntimeSource::WindowsService)
    }
}

// ---------------------------------------------------------------------------------------------
// Bounded service-instance evidence projection (NOT the Windows ServiceInstanceToken itself)
// ---------------------------------------------------------------------------------------------

/// A bounded, core-side projection of a Windows `ServiceInstanceToken`. It carries only the two OS-observed
/// scalars (process id + process creation time) as EVIDENCE. It is NOT the Windows token, NOT authority,
/// and cannot mint a [`VerifiedRuntimeInstance`]; the sealed verifier decides whether it is sufficient and
/// internally consistent with the observed process identity. A future Windows adapter constructs it from a
/// real `ServiceInstanceToken`; this phase has no such adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceInstanceEvidence {
    process_id: u32,
    creation_time: u64,
}

impl ServiceInstanceEvidence {
    /// Construct an evidence projection. Rejects the zero PID / zero creation-time non-identities (mirroring
    /// the Windows token's fail-closed constructor), so a placeholder can never masquerade as evidence.
    #[must_use]
    pub fn new(process_id: u32, creation_time: u64) -> Option<Self> {
        if process_id == 0 || creation_time == 0 {
            return None;
        }
        Some(Self {
            process_id,
            creation_time,
        })
    }
    fn process_id(&self) -> u32 {
        self.process_id
    }
    fn creation_time(&self) -> u64 {
        self.creation_time
    }
}

// ---------------------------------------------------------------------------------------------
// Untrusted observation (what a runtime adapter measured)
// ---------------------------------------------------------------------------------------------

/// The parsed, still-UNTRUSTED runtime-instance reading a future adapter reports for ONE host start. Every
/// field is adapter-supplied and re-validated by a sealed [`RuntimeInstanceVerifier`]; nothing here is
/// authority. There is deliberately no `From<RuntimeInstanceObservation>` producing a verified value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeInstanceObservation {
    /// The host role this observation claims.
    pub role: HostRole,
    /// Where the observation originated (a production verifier refuses `Fixture`).
    pub source: RuntimeSource,
    /// Observed host process id.
    pub pid: u32,
    /// Observed host process creation tick (with `pid`, the process identity; defeats pid reuse / restart).
    pub creation_tick: u64,
    /// The authenticated Windows session the host runs in, where applicable.
    pub session: Option<SessionId>,
    /// Monotonic tick at which the runtime was observed (adapter clock domain).
    pub observed_at: u64,
    /// Monotonic tick after which the runtime authority is no longer valid.
    pub valid_until: u64,
    /// Corroborating service-instance evidence, present for a Windows-service host.
    pub service_evidence: Option<ServiceInstanceEvidence>,
}

// ---------------------------------------------------------------------------------------------
// Structured refusal taxonomy (never a bare Boolean failure)
// ---------------------------------------------------------------------------------------------

/// Why runtime-instance verification or currentness failed. Fail closed; every variant is payload-free
/// (no raw pid, handle, session or provider material).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RuntimeInstanceError {
    /// A bounded identifier was empty/over-long/illegal.
    Malformed,
    /// The observed process identity was invalid (zero pid or zero creation tick).
    InvalidProcessIdentity,
    /// The observation source is not accepted by this verifier (e.g. `Fixture` in production).
    SourceNotAccepted,
    /// The claimed host role is inconsistent with the observation source.
    RoleNotAccepted,
    /// The validity window was invalid (`valid_until <= observed_at`).
    ProofWindowInvalid,
    /// The runtime authority had expired at evaluation time (`now >= valid_until`).
    Expired,
    /// The requested validity exceeds the verifier's accepted maximum window.
    ExpiryBeyondBound,
    /// The observation was older than the verifier's accepted staleness bound.
    StaleObservation,
    /// A Windows-service observation lacked the required service-instance evidence.
    ServiceEvidenceMissing,
    /// The service-instance evidence disagreed with the observed process identity.
    ServiceEvidenceInconsistent,
    /// The current trusted-clock reading came from a DIFFERENT provider (temporal substitution).
    ProviderMismatch,
    /// The current trusted-clock reading came from an EARLIER/DIFFERENT provider epoch (provider restart).
    ProviderEpochMismatch,
    /// The runtime generation differed (a DIFFERENT trusted host start — e.g. after a restart).
    GenerationMismatch,
    /// The runtime authority was established under a DIFFERENT authenticated session.
    SessionMismatch,
}

// ---------------------------------------------------------------------------------------------
// Opaque verified runtime instance (the sole runtime-instance authority value)
// ---------------------------------------------------------------------------------------------

/// A verified runtime instance: the sole authority value representing one exact trusted host start.
/// Opaque — private fields, no public constructor, no `Default`, no serde-as-authority, no broad `From`,
/// redacted `Debug`. NOT `Copy` and NOT `Clone` (an authority value is neither duplicable nor copyable).
/// Thread-bound (`!Send + !Sync`). Minted ONLY by a sealed [`RuntimeInstanceVerifier`].
pub struct VerifiedRuntimeInstance {
    /// Domain-separated digest over the stable instance identity (pid ‖ creation_tick ‖ role ‖ source ‖
    /// provider ‖ generation). Redacted; equality of two instances is equality of this digest + generation.
    instance_digest: [u8; 32],
    /// The verifier-assigned per-start generation. A host restart yields a new verifier and a new
    /// generation; authority minted before a restart is never current after it.
    generation: u64,
    /// The trusted-clock provider identity + epoch this instance was established under.
    provider_id: String,
    provider_epoch: u64,
    role: HostRole,
    source: RuntimeSource,
    pid: u32,
    creation_tick: u64,
    session: Option<SessionId>,
    issued_at: u64,
    valid_until: u64,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for VerifiedRuntimeInstance {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "VerifiedRuntimeInstance(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl VerifiedRuntimeInstance {
    /// The verifier-assigned per-start runtime generation.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.generation
    }
    /// The authoritative host role this instance runs as.
    #[must_use]
    pub fn role(&self) -> HostRole {
        self.role
    }
    /// The observation source this instance was attested from.
    #[must_use]
    pub fn source(&self) -> RuntimeSource {
        self.source
    }
    /// The bound host process id.
    #[must_use]
    pub fn pid(&self) -> u32 {
        self.pid
    }
    /// The bound host process creation tick.
    #[must_use]
    pub fn creation_tick(&self) -> u64 {
        self.creation_tick
    }
    /// The validity boundary this instance was minted with.
    #[must_use]
    pub fn valid_until(&self) -> u64 {
        self.valid_until
    }
    pub(crate) fn provider_id(&self) -> &str {
        &self.provider_id
    }
    pub(crate) fn provider_epoch(&self) -> u64 {
        self.provider_epoch
    }
    pub(crate) fn session(&self) -> Option<&SessionId> {
        self.session.as_ref()
    }
    pub(crate) fn instance_digest(&self) -> [u8; 32] {
        self.instance_digest
    }

    /// Whether two verified instances denote the SAME trusted host start. Equality is the digest + the
    /// verifier-assigned generation; a different start (restart, concurrent host) never compares equal.
    #[must_use]
    pub fn same_instance_as(&self, other: &VerifiedRuntimeInstance) -> bool {
        self.instance_digest == other.instance_digest && self.generation == other.generation
    }

    /// Re-validate this authority against the CURRENT runtime provider and trusted-clock reading. Fail
    /// closed. Refuses a substituted clock provider, a provider-epoch restart, a DIFFERENT host start
    /// (generation), or an expired window. This is the runtime currentness gate a future permit/adapter
    /// calls before every use.
    ///
    /// # Errors
    /// [`RuntimeInstanceError`] naming the first failed invariant.
    #[must_use = "the currentness result must be checked"]
    pub fn is_current<V: RuntimeInstanceVerifier>(
        &self,
        verifier: &V,
        now: &VerifiedAuthorityTime,
    ) -> Result<(), RuntimeInstanceError> {
        if now.provider_id() != self.provider_id {
            return Err(RuntimeInstanceError::ProviderMismatch);
        }
        if now.epoch() != self.provider_epoch {
            return Err(RuntimeInstanceError::ProviderEpochMismatch);
        }
        if verifier.generation() != self.generation {
            return Err(RuntimeInstanceError::GenerationMismatch);
        }
        if now.reading() >= self.valid_until {
            return Err(RuntimeInstanceError::Expired);
        }
        Ok(())
    }

    /// Confirm this authority was established under the expected authenticated session. Refuses a runtime
    /// bound to a different Windows session. `None` expected = no session constraint.
    ///
    /// # Errors
    /// [`RuntimeInstanceError::SessionMismatch`] when the sessions differ.
    pub fn matches_session(
        &self,
        expected: Option<&SessionId>,
    ) -> Result<(), RuntimeInstanceError> {
        match (self.session.as_ref(), expected) {
            (_, None) => Ok(()),
            (Some(bound), Some(exp)) if bound == exp => Ok(()),
            _ => Err(RuntimeInstanceError::SessionMismatch),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The crate-internal mint + sealed verifier
// ---------------------------------------------------------------------------------------------

/// Crate-private sealing marker. `sealed` is a PRIVATE module, so no external crate can name `Sealed` and
/// therefore none can implement [`RuntimeInstanceVerifier`]: a caller cannot substitute a fake runtime
/// attestation source. Only crate-controlled verifiers (the fixture now; a production adapter later, added
/// by an explicit core change) may implement it.
mod sealed {
    pub trait Sealed {}
}

/// The maximum validity window and observation-staleness bound the fixture verifier accepts. A production
/// verifier chooses its own; this keeps the fixture path bounded and lets `ExpiryBeyondBound` /
/// `StaleObservation` be load-bearing.
const FIXTURE_MAX_WINDOW: u64 = 10_000;
const FIXTURE_MAX_STALENESS: u64 = 5_000;

/// The crate-internal mint. Validates an untrusted observation, checks role/source/process/evidence/window
/// invariants against the verifier's accepted bounds, and stamps the verifier-assigned generation and the
/// trusted-clock provider identity + epoch into an opaque [`VerifiedRuntimeInstance`]. Construction lives
/// ONLY here, so a verified runtime instance can be produced only through a sealed verifier.
fn mint<V: RuntimeInstanceVerifier + ?Sized>(
    verifier: &V,
    obs: &RuntimeInstanceObservation,
    now: &VerifiedAuthorityTime,
) -> Result<VerifiedRuntimeInstance, RuntimeInstanceError> {
    if let Some(s) = obs.session.as_ref() {
        validate_bounded_id(s.as_str()).map_err(|_| RuntimeInstanceError::Malformed)?;
    }
    if !verifier.accepts_source(obs.source) {
        return Err(RuntimeInstanceError::SourceNotAccepted);
    }
    if !obs.role.accepts_source(obs.source) {
        return Err(RuntimeInstanceError::RoleNotAccepted);
    }
    if obs.pid == 0 || obs.creation_tick == 0 {
        return Err(RuntimeInstanceError::InvalidProcessIdentity);
    }
    if obs.source.requires_service_evidence() {
        match obs.service_evidence {
            None => return Err(RuntimeInstanceError::ServiceEvidenceMissing),
            Some(ev) => {
                if ev.process_id() != obs.pid || ev.creation_time() != obs.creation_tick {
                    return Err(RuntimeInstanceError::ServiceEvidenceInconsistent);
                }
            }
        }
    }
    if obs.valid_until <= obs.observed_at {
        return Err(RuntimeInstanceError::ProofWindowInvalid);
    }
    if now.reading() >= obs.valid_until {
        return Err(RuntimeInstanceError::Expired);
    }
    if obs.valid_until > now.reading().saturating_add(verifier.max_window()) {
        return Err(RuntimeInstanceError::ExpiryBeyondBound);
    }
    if now.reading().saturating_sub(obs.observed_at) > verifier.max_staleness() {
        return Err(RuntimeInstanceError::StaleObservation);
    }
    let generation = verifier.generation();
    let mut h = Sha256::new();
    h.update(b"PROJECTOS:RUNTIME-INSTANCE:V1");
    h.update(obs.pid.to_be_bytes());
    h.update(obs.creation_tick.to_be_bytes());
    h.update([obs.role.tag(), obs.source.tag()]);
    h.update((now.provider_id().len() as u64).to_be_bytes());
    h.update(now.provider_id().as_bytes());
    h.update(generation.to_be_bytes());
    Ok(VerifiedRuntimeInstance {
        instance_digest: h.finalize().into(),
        generation,
        provider_id: now.provider_id().to_string(),
        provider_epoch: now.epoch(),
        role: obs.role,
        source: obs.source,
        pid: obs.pid,
        creation_tick: obs.creation_tick,
        session: obs.session.clone(),
        issued_at: now.reading(),
        valid_until: obs.valid_until,
        _thread_bound: PhantomData,
    })
}

/// The sealed runtime-instance VERIFIER contract. A verifier is the crate-controlled authority that decides
/// whether and how an UNTRUSTED [`RuntimeInstanceObservation`] becomes a [`VerifiedRuntimeInstance`], and it
/// owns the per-start `generation`. A caller may supply observation data, but only a sealed verifier may
/// attest it — there is no free public mint, and no external crate can implement this trait.
pub trait RuntimeInstanceVerifier: sealed::Sealed {
    /// The verifier-assigned per-start runtime generation (a host restart yields a new value; NOT
    /// caller-selectable).
    fn generation(&self) -> u64;
    /// The maximum validity window (from `now`) this verifier will attest.
    fn max_window(&self) -> u64;
    /// The maximum observation staleness this verifier will accept.
    fn max_staleness(&self) -> u64;
    /// Whether this verifier accepts observations from `source` (a production verifier refuses `Fixture`).
    fn accepts_source(&self, source: RuntimeSource) -> bool;

    /// Attest an untrusted observation into an opaque [`VerifiedRuntimeInstance`], stamping this verifier's
    /// per-start generation and the current trusted-clock provider identity + epoch.
    ///
    /// # Errors
    /// [`RuntimeInstanceError`] on the first failed invariant.
    fn verify(
        &self,
        obs: &RuntimeInstanceObservation,
        now: &VerifiedAuthorityTime,
    ) -> Result<VerifiedRuntimeInstance, RuntimeInstanceError> {
        mint(self, obs, now)
    }
}

// ---------------------------------------------------------------------------------------------
// Production runtime-instance verifier (CD-B4-PRODUCTION-RUNTIME-PROVIDER1A)
// ---------------------------------------------------------------------------------------------

/// The maximum validity window and observation-staleness bound the PRODUCTION verifier accepts.
const PRODUCTION_MAX_WINDOW: u64 = 30_000;
const PRODUCTION_MAX_STALENESS: u64 = 10_000;

/// The sole PRODUCTION runtime-instance verifier. It implements the sealed [`RuntimeInstanceVerifier`],
/// so an untrusted [`RuntimeInstanceObservation`] becomes a [`VerifiedRuntimeInstance`] only through it
/// (or the test fixture). It REFUSES [`RuntimeSource::Fixture`], accepts only the two closed production
/// modes, and owns a per-start `generation` assigned from a process-unique counter — never caller-chosen.
///
/// Opaque: private fields, redacted `Debug`, no serde, no evidence-to-authority conversion, thread-bound
/// (`!Send + !Sync`). Construction is crate-controlled: there is NO default-graph constructor, so an
/// external crate cannot build one (and the compile-failure suite proves it). The only reachable
/// constructor is the test-fixtures [`ProductionRuntimeInstanceVerifier::for_local_proof`], used by the
/// local read-only proof; a real production-activation constructor (owner-gated) is CARRY-FORWARD.
/// Safety does not rest on construction alone: even with a verifier, minting needs a real
/// [`VerifiedAuthorityTime`], which requires a grant-bound production clock.
pub struct ProductionRuntimeInstanceVerifier {
    generation: u64,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for ProductionRuntimeInstanceVerifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ProductionRuntimeInstanceVerifier(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl ProductionRuntimeInstanceVerifier {
    /// The crate-internal mint. The per-start `generation` is drawn from a process-unique counter, so a
    /// caller can neither choose it nor forge a matching one; a NEW verifier (a modelled restart) yields a
    /// new generation, invalidating authority minted before it.
    pub(crate) fn new_internal() -> Self {
        use core::sync::atomic::{AtomicU64, Ordering};
        // Disjoint from the fixture verifier's counter space so a fixture generation can never collide.
        static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
        let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed) | (1u64 << 63);
        Self {
            generation,
            _thread_bound: PhantomData,
        }
    }

    /// TEST-ONLY constructor for the local read-only proof, gated to `test-fixtures`.
    ///
    /// The production route is [`crate::provider_authority`]: `new_internal` above is reached ONLY by
    /// consuming a `ProviderAuthorityLease`, which requires a confirmed machine-wide host authority. The
    /// default graph still has no way to construct this verifier directly.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn for_local_proof() -> Self {
        Self::new_internal()
    }
}

impl sealed::Sealed for ProductionRuntimeInstanceVerifier {}
impl RuntimeInstanceVerifier for ProductionRuntimeInstanceVerifier {
    fn generation(&self) -> u64 {
        self.generation
    }
    fn max_window(&self) -> u64 {
        PRODUCTION_MAX_WINDOW
    }
    fn max_staleness(&self) -> u64 {
        PRODUCTION_MAX_STALENESS
    }
    fn accepts_source(&self, source: RuntimeSource) -> bool {
        // The two closed production modes ONLY; the synthetic fixture source is refused.
        matches!(
            source,
            RuntimeSource::WindowsService | RuntimeSource::InteractiveFallback
        )
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
pub use fixture::FixtureRuntimeInstanceVerifier;

#[cfg(any(test, feature = "test-fixtures"))]
mod fixture {
    use super::{
        sealed, RuntimeInstanceVerifier, RuntimeSource, FIXTURE_MAX_STALENESS, FIXTURE_MAX_WINDOW,
    };
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering};
    use std::rc::Rc;

    struct VerifierState {
        base: u64,
        generation: Cell<u64>,
    }

    /// TEST-ONLY sealed runtime-instance verifier modelling ONE host runtime. Its per-start generation is
    /// crate-assigned (unique base + a counter), never caller-selectable; `restart()` advances the
    /// generation to model a NEW trusted host start. Every handle/clone shares the same authoritative
    /// state. A production graph never builds it, and it accepts the `Fixture` source a production
    /// verifier must refuse.
    #[derive(Clone)]
    pub struct FixtureRuntimeInstanceVerifier {
        state: Rc<VerifierState>,
    }

    static NEXT_BASE: AtomicU64 = AtomicU64::new(1);

    impl FixtureRuntimeInstanceVerifier {
        /// A fresh runtime with a UNIQUE, non-caller-selectable per-start generation.
        #[must_use]
        pub fn new() -> Self {
            let base = NEXT_BASE.fetch_add(1_000_000, Ordering::Relaxed);
            Self {
                state: Rc::new(VerifierState {
                    base,
                    generation: Cell::new(base),
                }),
            }
        }
        /// Another handle to the SAME authoritative runtime state.
        #[must_use]
        pub fn handle(&self) -> Self {
            Self {
                state: Rc::clone(&self.state),
            }
        }
        /// Model a NEW trusted host start (restart): the per-start generation advances, so authority minted
        /// before the restart is no longer current.
        pub fn restart(&self) {
            self.state.generation.set(self.state.generation.get() + 1);
        }
    }

    impl Default for FixtureRuntimeInstanceVerifier {
        fn default() -> Self {
            Self::new()
        }
    }

    impl sealed::Sealed for FixtureRuntimeInstanceVerifier {}
    impl RuntimeInstanceVerifier for FixtureRuntimeInstanceVerifier {
        fn generation(&self) -> u64 {
            self.state.generation.get()
        }
        fn max_window(&self) -> u64 {
            FIXTURE_MAX_WINDOW
        }
        fn max_staleness(&self) -> u64 {
            FIXTURE_MAX_STALENESS
        }
        fn accepts_source(&self, source: RuntimeSource) -> bool {
            // The fixture accepts every source (incl. Fixture); a production verifier must refuse Fixture.
            matches!(
                source,
                RuntimeSource::WindowsService
                    | RuntimeSource::InteractiveFallback
                    | RuntimeSource::Fixture
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority_time::{FixtureClock, TrustedClock};

    fn obs() -> RuntimeInstanceObservation {
        RuntimeInstanceObservation {
            role: HostRole::InteractiveFallback,
            source: RuntimeSource::InteractiveFallback,
            pid: 4242,
            creation_tick: 999,
            session: Some(SessionId::new("sess-1")),
            observed_at: 100,
            valid_until: 5_000,
            service_evidence: None,
        }
    }

    #[test]
    fn a_valid_observation_mints_one_instance() {
        let clock = FixtureClock::new(150);
        let v = FixtureRuntimeInstanceVerifier::new();
        let ri = v.verify(&obs(), &clock.read_current()).unwrap();
        assert_eq!(ri.pid(), 4242);
        assert_eq!(ri.creation_tick(), 999);
        ri.is_current(&v, &clock.read_current()).unwrap();
    }

    #[test]
    fn windows_service_requires_consistent_evidence() {
        let clock = FixtureClock::new(150);
        let v = FixtureRuntimeInstanceVerifier::new();
        let mut o = obs();
        o.role = HostRole::InstalledService;
        o.source = RuntimeSource::WindowsService;
        assert_eq!(
            v.verify(&o, &clock.read_current()).unwrap_err(),
            RuntimeInstanceError::ServiceEvidenceMissing
        );
        o.service_evidence = ServiceInstanceEvidence::new(1, 1);
        assert_eq!(
            v.verify(&o, &clock.read_current()).unwrap_err(),
            RuntimeInstanceError::ServiceEvidenceInconsistent
        );
        o.service_evidence = ServiceInstanceEvidence::new(4242, 999);
        assert!(v.verify(&o, &clock.read_current()).is_ok());
    }

    #[test]
    fn restart_advances_generation_and_invalidates() {
        let clock = FixtureClock::new(150);
        let v = FixtureRuntimeInstanceVerifier::new();
        let ri = v.verify(&obs(), &clock.read_current()).unwrap();
        v.restart();
        assert_eq!(
            ri.is_current(&v, &clock.read_current()).unwrap_err(),
            RuntimeInstanceError::GenerationMismatch
        );
    }
}
