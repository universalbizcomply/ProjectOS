//! Runtime-instance authority proof (CD-B4-RUNTIME-INSTANCE-AUTHORITY1A).
//!
//! One trusted host start mints exactly one opaque [`VerifiedRuntimeInstance`] through the sealed fixture
//! verifier; restart, provider substitution, provider-epoch restart, PID reuse, wrong role/session, stale
//! or over-long observations, and missing/inconsistent service evidence are all refused fail-closed. No
//! permit/grant/IPC integration exists in this phase. Type-forgery properties (no ctor/Default/Clone/Copy/
//! serde/From, fixture-exclusion, evidence→authority) are proven by the compile-failure validator.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    FixtureClock, FixtureRuntimeInstanceVerifier, HostRole, RuntimeInstanceError,
    RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, ServiceInstanceEvidence,
    SessionId, TrustedClock, VerifiedAuthorityTime,
};

const PID: u32 = 4242;
const TICK: u64 = 999;

fn fallback_obs() -> RuntimeInstanceObservation {
    RuntimeInstanceObservation {
        role: HostRole::InteractiveFallback,
        source: RuntimeSource::InteractiveFallback,
        pid: PID,
        creation_tick: TICK,
        session: Some(SessionId::new("sess-1")),
        observed_at: 100,
        valid_until: 5_000,
        service_evidence: None,
    }
}

fn service_obs() -> RuntimeInstanceObservation {
    RuntimeInstanceObservation {
        role: HostRole::InstalledService,
        source: RuntimeSource::WindowsService,
        pid: PID,
        creation_tick: TICK,
        session: Some(SessionId::new("sess-1")),
        observed_at: 100,
        valid_until: 5_000,
        service_evidence: ServiceInstanceEvidence::new(PID, TICK),
    }
}

fn now(clock: &FixtureClock) -> VerifiedAuthorityTime {
    clock.read_current()
}

// R1 — a valid observation mints exactly one instance.
#[test]
fn r1_valid_observation_mints_one_instance() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    assert_eq!(ri.pid(), PID);
    ri.is_current(&v, &now(&clock)).unwrap();
}

// R4 — same verifier/provider/epoch/generation is current.
#[test]
fn r4_same_runtime_is_current() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    assert!(ri.is_current(&v, &now(&clock)).is_ok());
    // Two mints from the SAME verifier denote the same instance.
    let ri2 = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    assert!(ri.same_instance_as(&ri2));
}

// R5 — different runtime generation refused (concurrent/other host).
#[test]
fn r5_different_generation_refused() {
    let clock = FixtureClock::new(150);
    let a = FixtureRuntimeInstanceVerifier::new();
    let b = FixtureRuntimeInstanceVerifier::new();
    let ri_a = a.verify(&fallback_obs(), &now(&clock)).unwrap();
    let ri_b = b.verify(&fallback_obs(), &now(&clock)).unwrap();
    assert!(!ri_a.same_instance_as(&ri_b));
    assert_eq!(
        ri_a.is_current(&b, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::GenerationMismatch
    );
}

// R6 — host restart invalidates old authority.
#[test]
fn r6_host_restart_invalidates_old_authority() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    v.restart();
    assert_eq!(
        ri.is_current(&v, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::GenerationMismatch
    );
}

// R7 — provider identity substitution refused.
#[test]
fn r7_provider_substitution_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    let other_clock = FixtureClock::new(150); // distinct provider identity
    assert_eq!(
        ri.is_current(&v, &now(&other_clock)).unwrap_err(),
        RuntimeInstanceError::ProviderMismatch
    );
}

// R8 — provider epoch restart refused.
#[test]
fn r8_provider_epoch_restart_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    clock.next_epoch(150); // same provider identity, later epoch
    assert_eq!(
        ri.is_current(&v, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::ProviderEpochMismatch
    );
}

// R9 — PID mismatch (invalid process identity) refused.
#[test]
fn r9_invalid_process_identity_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let mut o = fallback_obs();
    o.pid = 0;
    assert_eq!(
        v.verify(&o, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::InvalidProcessIdentity
    );
}

// R10 — PID reuse with a different creation tick yields a DIFFERENT instance (not the same start).
#[test]
fn r10_pid_reuse_different_creation_tick_is_distinct() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    let mut o = fallback_obs();
    o.creation_tick = TICK + 1; // same pid, restarted process
    let ri2 = v.verify(&o, &now(&clock)).unwrap();
    assert!(!ri.same_instance_as(&ri2));
}

// R11 — Windows-session mismatch refused.
#[test]
fn r11_session_mismatch_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    ri.matches_session(Some(&SessionId::new("sess-1"))).unwrap();
    assert_eq!(
        ri.matches_session(Some(&SessionId::new("sess-2")))
            .unwrap_err(),
        RuntimeInstanceError::SessionMismatch
    );
}

// R12 — expired runtime authority refused.
#[test]
fn r12_expired_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    clock.advance_to(5_000); // == valid_until
    assert_eq!(
        ri.is_current(&v, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::Expired
    );
}

// R13 — requested expiry beyond the verifier bound refused.
#[test]
fn r13_expiry_beyond_bound_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let mut o = fallback_obs();
    o.valid_until = 150 + 10_001; // > now + max_window (10_000)
    assert_eq!(
        v.verify(&o, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::ExpiryBeyondBound
    );
}

// R14 — stale observation refused.
#[test]
fn r14_stale_observation_refused() {
    let clock = FixtureClock::new(6_000);
    let v = FixtureRuntimeInstanceVerifier::new();
    let mut o = fallback_obs();
    o.observed_at = 100; // now - observed_at = 5_900 > max_staleness (5_000)
    o.valid_until = 7_000;
    assert_eq!(
        v.verify(&o, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::StaleObservation
    );
}

// R15 — wrong host role (inconsistent with source) refused.
#[test]
fn r15_wrong_role_refused() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let mut o = fallback_obs();
    o.role = HostRole::InstalledService; // source is InteractiveFallback → inconsistent
    assert_eq!(
        v.verify(&o, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::RoleNotAccepted
    );
}

// R16 — interactive fallback mints without SCM evidence under its own accepted role.
#[test]
fn r16_interactive_fallback_no_service_evidence() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    assert_eq!(ri.role(), HostRole::InteractiveFallback);
    assert_eq!(ri.source(), RuntimeSource::InteractiveFallback);
}

// R17 — Windows-service observation requires valid bounded service evidence.
#[test]
fn r17_windows_service_requires_evidence() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let mut o = service_obs();
    o.service_evidence = None;
    assert_eq!(
        v.verify(&o, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::ServiceEvidenceMissing
    );
    // Inconsistent evidence (different pid) refused.
    let mut o2 = service_obs();
    o2.service_evidence = ServiceInstanceEvidence::new(1, 1);
    assert_eq!(
        v.verify(&o2, &now(&clock)).unwrap_err(),
        RuntimeInstanceError::ServiceEvidenceInconsistent
    );
    // Consistent evidence accepted.
    assert!(v.verify(&service_obs(), &now(&clock)).is_ok());
}

// R22 — Debug never renders sensitive proof material.
#[test]
fn r22_debug_is_redacted() {
    let clock = FixtureClock::new(150);
    let v = FixtureRuntimeInstanceVerifier::new();
    let ri = v.verify(&fallback_obs(), &now(&clock)).unwrap();
    let s = format!("{ri:?}");
    assert!(s.contains("[REDACTED]"));
    assert!(!s.contains("4242"));
    assert!(!s.contains("sess-1"));
}

// Bounded evidence projection rejects the zero non-identity.
#[test]
fn service_evidence_rejects_zero() {
    assert!(ServiceInstanceEvidence::new(0, 1).is_none());
    assert!(ServiceInstanceEvidence::new(1, 0).is_none());
    assert!(ServiceInstanceEvidence::new(1, 1).is_some());
}
