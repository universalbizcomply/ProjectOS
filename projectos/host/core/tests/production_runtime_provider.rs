//! Production runtime-provider behaviour (CD-B4-PRODUCTION-RUNTIME-PROVIDER1A).
//!
//! Exercises the sealed [`ProductionRuntimeInstanceVerifier`] and the grant-gated production-clock
//! binding with FIXTURE evidence (no Windows FFI): the R-matrix (runtime verification) and the
//! behavioural half of the B-matrix (clock binding). The compile-failure half of both matrices
//! (arbitrary-source binding, grant/verifier/capability construction, evidence→authority conversion,
//! fixture/default-graph exclusion, `bind` privacy, no grant `Clone`) is proven by
//! `val-cd-b4-production-runtime-provider1a.cjs`. The live Windows self-observation read-only proof
//! lives in the `windows-runtime-observation` crate. `VerifiedAuthorityTime` accessors are `pub(crate)`
//! (the value is opaque), so provider-identity/epoch properties are proven through runtime currentness.

#![cfg(feature = "test-fixtures")]

use projectos_host_core::{
    bind_production_clock, fixture_production_clock_binding_grant, FixtureClock,
    FixtureMonotonicTickSource, HostRole, ProductionRuntimeInstanceVerifier,
    ProductionTrustedClock, RuntimeInstanceError, RuntimeInstanceObservation,
    RuntimeInstanceVerifier, RuntimeSource, ServiceInstanceEvidence, SessionId, TrustedClock,
    VerifiedRuntimeInstance,
};

/// Bind a production clock from a fixture tick source at `start` under lineage `seed`, through the
/// grant-gated binder — the same public path the Windows provider uses.
fn prod_clock(start: u64, seed: u64) -> ProductionTrustedClock<FixtureMonotonicTickSource> {
    let grant = fixture_production_clock_binding_grant();
    bind_production_clock(
        grant,
        FixtureMonotonicTickSource::new(start, seed),
        1_000_000,
    )
}

fn fallback_obs(
    pid: u32,
    creation: u64,
    observed_at: u64,
    valid_until: u64,
) -> RuntimeInstanceObservation {
    RuntimeInstanceObservation {
        role: HostRole::InteractiveFallback,
        source: RuntimeSource::InteractiveFallback,
        pid,
        creation_tick: creation,
        session: None,
        observed_at,
        valid_until,
        service_evidence: None,
    }
}

fn service_obs(pid: u32, creation: u64) -> RuntimeInstanceObservation {
    RuntimeInstanceObservation {
        role: HostRole::InstalledService,
        source: RuntimeSource::WindowsService,
        pid,
        creation_tick: creation,
        session: Some(SessionId::new("svc-sess")),
        observed_at: 1_000,
        valid_until: 21_000,
        service_evidence: ServiceInstanceEvidence::new(pid, creation),
    }
}

// R1 — a valid Windows-service observation mints under consistent service evidence.
#[test]
fn r1_service_host_observation_mints() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri = v
        .verify(&service_obs(4242, 999), &clock.read_current())
        .unwrap();
    assert_eq!(ri.role(), HostRole::InstalledService);
    assert_eq!(ri.source(), RuntimeSource::WindowsService);
    ri.is_current(&v, &clock.read_current()).unwrap();
}

// R2 — a valid interactive-fallback observation mints and revalidates.
#[test]
fn r2_interactive_fallback_observation_mints() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri: VerifiedRuntimeInstance = v
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    assert_eq!(ri.role(), HostRole::InteractiveFallback);
    assert_eq!(ri.pid(), 4242);
    ri.is_current(&v, &clock.read_current()).unwrap();
}

// R3 — process identity is pid + creation time: the same pid with a different creation is a different
// instance (defeats pid reuse).
#[test]
fn r3_pid_reuse_with_different_creation_is_a_different_instance() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let a = v
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    let b = v
        .verify(
            &fallback_obs(4242, 111, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    assert!(!a.same_instance_as(&b));
}

// R4 — a verifier restart (a new per-start generation) invalidates prior runtime authority.
#[test]
fn r4_verifier_restart_invalidates_prior_authority() {
    let clock = prod_clock(1_000, 7);
    let v1 = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri = v1
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    let v2 = ProductionRuntimeInstanceVerifier::for_local_proof();
    assert_eq!(
        ri.is_current(&v2, &clock.read_current()).unwrap_err(),
        RuntimeInstanceError::GenerationMismatch
    );
}

// R5 / B6 / B7 / B9 — a clock/provider epoch restart (a new lineage) is refused as ProviderEpochMismatch
// (NOT ProviderMismatch): the provider IDENTITY is the shared core CONST (the grant cannot select it),
// while the per-start EPOCH differs by lineage (the grant cannot select it), and an old lineage cannot be
// replayed against fresh authority.
#[test]
fn r5_provider_epoch_restart_is_refused() {
    let clock_a = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri = v
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock_a.read_current(),
        )
        .unwrap();
    let clock_b = prod_clock(1_000, 999);
    assert_eq!(
        ri.is_current(&v, &clock_b.read_current()).unwrap_err(),
        RuntimeInstanceError::ProviderEpochMismatch
    );
}

// R6 — a wrong authenticated session is refused (proven through contract evidence; live v1 uses None).
#[test]
fn r6_wrong_session_is_refused() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let mut o = fallback_obs(4242, 999, 1_000, 21_000);
    o.session = Some(SessionId::new("sess-a"));
    let ri = v.verify(&o, &clock.read_current()).unwrap();
    assert_eq!(
        ri.matches_session(Some(&SessionId::new("sess-b")))
            .unwrap_err(),
        RuntimeInstanceError::SessionMismatch
    );
    ri.matches_session(Some(&SessionId::new("sess-a"))).unwrap();
}

// R7 — a role/source mismatch, and the Fixture source, are refused by the production verifier.
#[test]
fn r7_wrong_role_or_source_is_refused() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let mut o = fallback_obs(4242, 999, 1_000, 21_000);
    o.source = RuntimeSource::WindowsService;
    assert_eq!(
        v.verify(&o, &clock.read_current()).unwrap_err(),
        RuntimeInstanceError::RoleNotAccepted
    );
    let mut f = fallback_obs(4242, 999, 1_000, 21_000);
    f.source = RuntimeSource::Fixture;
    assert_eq!(
        v.verify(&f, &clock.read_current()).unwrap_err(),
        RuntimeInstanceError::SourceNotAccepted
    );
}

// R8 — an observation older than the verifier's staleness bound is refused.
#[test]
fn r8_stale_observation_is_refused() {
    // Clock reads 20_000; observed_at 1_000 → staleness 19_000 > the 10_000 bound. valid_until 25_000
    // keeps it un-expired and within the window, so staleness is the operative refusal.
    let clock = bind_production_clock(
        fixture_production_clock_binding_grant(),
        FixtureMonotonicTickSource::new(20_000, 7),
        1_000_000,
    );
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    assert_eq!(
        v.verify(
            &fallback_obs(4242, 999, 1_000, 25_000),
            &clock.read_current()
        )
        .unwrap_err(),
        RuntimeInstanceError::StaleObservation
    );
}

// R9 — a requested validity beyond the verifier's maximum window is refused.
#[test]
fn r9_excessive_validity_is_refused() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    // now = 1_000, max_window = 30_000; valid_until 41_000 exceeds 31_000.
    assert_eq!(
        v.verify(
            &fallback_obs(4242, 999, 1_000, 41_000),
            &clock.read_current()
        )
        .unwrap_err(),
        RuntimeInstanceError::ExpiryBeyondBound
    );
}

// R10 — service-evidence mismatch or absence is refused on the WindowsService path.
#[test]
fn r10_service_evidence_mismatch_is_refused() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let mut missing = service_obs(4242, 999);
    missing.service_evidence = None;
    assert_eq!(
        v.verify(&missing, &clock.read_current()).unwrap_err(),
        RuntimeInstanceError::ServiceEvidenceMissing
    );
    let mut inconsistent = service_obs(4242, 999);
    inconsistent.service_evidence = ServiceInstanceEvidence::new(1, 1);
    assert_eq!(
        v.verify(&inconsistent, &clock.read_current()).unwrap_err(),
        RuntimeInstanceError::ServiceEvidenceInconsistent
    );
}

// R11 — service-instance evidence is bounded, fail-closed evidence (never authority): the zero
// non-identity is rejected at construction, and evidence alone mints nothing (the verifier decides).
#[test]
fn r11_service_instance_evidence_is_non_authoritative() {
    assert!(ServiceInstanceEvidence::new(0, 999).is_none());
    assert!(ServiceInstanceEvidence::new(4242, 0).is_none());
    assert!(ServiceInstanceEvidence::new(4242, 999).is_some());
}

// R15 — verified authority and the verifier render redacted Debug (no raw pid leak).
#[test]
fn r15_debug_is_redacted() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri = v
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    let ri_dbg = format!("{ri:?}");
    assert!(ri_dbg.contains("[REDACTED]"));
    assert!(!ri_dbg.contains("4242"));
    assert!(format!("{v:?}").contains("[REDACTED]"));
}

// B4 — one grant binds one clock lineage (the grant is move-consumed; reuse is a compile error, proven
// by the validator). Here a fresh grant binds a working production clock that mints authority.
#[test]
fn b4_one_grant_binds_one_working_clock_lineage() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    v.verify(
        &fallback_obs(4242, 999, 1_000, 21_000),
        &clock.read_current(),
    )
    .unwrap();
}

// A DIFFERENT trusted-clock PROVIDER (a fixture clock, not the production clock) is refused as
// ProviderMismatch — the provider-identity comparison (not merely the epoch) is load-bearing.
#[test]
fn provider_identity_mismatch_is_refused() {
    let clock = prod_clock(1_000, 7);
    let v = ProductionRuntimeInstanceVerifier::for_local_proof();
    let ri = v
        .verify(
            &fallback_obs(4242, 999, 1_000, 21_000),
            &clock.read_current(),
        )
        .unwrap();
    let other_provider = FixtureClock::new(1_000);
    assert_eq!(
        ri.is_current(&v, &other_provider.read_current())
            .unwrap_err(),
        RuntimeInstanceError::ProviderMismatch
    );
}
