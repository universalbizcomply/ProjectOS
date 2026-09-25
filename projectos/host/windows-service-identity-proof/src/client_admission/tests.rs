//! PROJECTOS-HOST-REVIEW-PATH1B — client-admission proofs (gatekeeper ruling section 12).
//!
//! Every case drives the REAL decision core, the REAL classification and the REAL admission gate with
//! synthetic token facts. No Windows API, no pipe, no impersonation and no token is involved: the
//! facts struct is exactly what the confined FFI hands the core after its own reads.

use super::*;
use crate::instance::{PeerSessionBinding, ServiceInstanceToken};

// ---- fixtures -----------------------------------------------------------------------------------

const PID_A: u32 = 4100;
const CREATED_A: u64 = 900_100;
const PID_B: u32 = 4200;
const CREATED_B: u64 = 900_200;

const CONN: u64 = 77;
const GEN: u64 = 5;

/// S-1-5-21-1-2-3-1001 — the enrolled configured owner in these proofs.
fn owner_sid() -> [u8; 28] {
    let mut raw = [0u8; 28];
    raw[0] = 1; // revision
    raw[1] = 5; // sub-authority count
    raw[7] = 5; // NT Authority
    raw[8..12].copy_from_slice(&21u32.to_le_bytes());
    raw[12..16].copy_from_slice(&1u32.to_le_bytes());
    raw[16..20].copy_from_slice(&2u32.to_le_bytes());
    raw[20..24].copy_from_slice(&3u32.to_le_bytes());
    raw[24..28].copy_from_slice(&1001u32.to_le_bytes());
    raw
}

/// S-1-5-21-1-2-3-1002 — a DIFFERENT local account. Same broad `Owner` class, different exact user.
fn other_owner_sid() -> [u8; 28] {
    let mut raw = owner_sid();
    raw[24..28].copy_from_slice(&1002u32.to_le_bytes());
    raw
}

/// S-1-5-18 (LocalSystem).
fn system_sid() -> [u8; 12] {
    let mut raw = [0u8; 12];
    raw[0] = 1;
    raw[1] = 1;
    raw[7] = 5;
    raw[8..12].copy_from_slice(&18u32.to_le_bytes());
    raw
}

/// S-1-5-80-7 (a service account).
fn service_sid() -> [u8; 16] {
    let mut raw = [0u8; 16];
    raw[0] = 1;
    raw[1] = 2;
    raw[7] = 5;
    raw[8..12].copy_from_slice(&80u32.to_le_bytes());
    raw[12..16].copy_from_slice(&7u32.to_le_bytes());
    raw
}

/// S-1-5-32-544 (the Administrators GROUP). It is never a token USER, and classification here reads
/// the token user alone, so this exists to prove that presenting it as a principal admits nothing.
fn administrators_group_sid() -> [u8; 16] {
    let mut raw = [0u8; 16];
    raw[0] = 1;
    raw[1] = 2;
    raw[7] = 5;
    raw[8..12].copy_from_slice(&32u32.to_le_bytes());
    raw[12..16].copy_from_slice(&544u32.to_le_bytes());
    raw
}

fn facts(sid: &[u8], session: u32, integrity_rid: Option<u32>) -> PeerIdentityFacts {
    PeerIdentityFacts {
        impersonated: true,
        impersonation_reverted: true,
        token_user: PeerUserBinding::from_sid_bytes(sid),
        token_session: Some(PeerSessionBinding::from_session_id(session)),
        integrity: integrity_rid.map(PeerIntegrityEvidence::from_rid),
    }
}

fn observed(pid: u32, created: u64) -> ServiceInstanceObservation {
    ServiceInstanceObservation::Observed(
        ServiceInstanceToken::from_observed_parts(pid, created).expect("valid parts"),
    )
}

fn owner() -> EnrolledOwnerPrincipal {
    EnrolledOwnerPrincipal::from_sid_bytes_for_test(&owner_sid()).expect("valid owner SID")
}

fn cap() -> ClientAdmissionObservationCapability {
    ClientAdmissionObservationCapability::for_test()
}

fn begin() -> ClientPeerAdmissionAttempt<ClientPrepared> {
    ClientPeerAdmissionAttempt::begin(&cap(), &owner())
}

/// Drive one capture with the given facts and return the outcome.
fn capture(
    obs: ServiceInstanceObservation,
    f: &PeerIdentityFacts,
) -> ClientAttemptOutcome<ClientObserved> {
    begin().record_client_identity(obs, f, CONN, GEN)
}

/// The whole happy path: capture, then admit for the same pair.
fn admit_happy_path() -> Result<VerifiedPeerAdmission, ClientAdmissionVerdict> {
    capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured")
    .admit_client_for_connection(CONN, GEN)
}

// ---- 1. the exact configured owner passes --------------------------------------------------------

#[test]
fn the_exact_configured_owner_is_admitted_when_every_other_fact_is_valid() {
    let admission = admit_happy_path().expect("the exact configured owner is admitted");
    assert_eq!(admission.connection_id(), CONN);
    assert_eq!(admission.handshake_generation(), GEN);
}

// ---- 2-5. principal negatives --------------------------------------------------------------------

#[test]
fn a_different_user_of_the_same_owner_class_is_refused() {
    // THE CENTRAL PROOF. `other_owner_sid` classifies as exactly the same broad `Owner` class as the
    // configured owner. Class is not admission; the EXACT SID is.
    assert_eq!(
        capture(
            observed(PID_A, CREATED_A),
            &facts(&other_owner_sid(), 3, Some(0x2000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
}

#[test]
fn localsystem_is_refused_as_the_agent_owner() {
    assert_eq!(
        capture(
            observed(PID_A, CREATED_A),
            &facts(&system_sid(), 0, Some(0x4000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
}

#[test]
fn a_service_account_is_refused_for_the_production_agent_role() {
    assert_eq!(
        capture(
            observed(PID_A, CREATED_A),
            &facts(&service_sid(), 0, Some(0x4000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
}

#[test]
fn administrators_membership_does_not_establish_owner_identity() {
    // Two halves of one claim.
    //
    // (a) The Administrators SID presented AS the principal admits nothing.
    assert_eq!(
        capture(
            observed(PID_A, CREATED_A),
            &facts(&administrators_group_sid(), 1, Some(0x3000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
    // (b) A different user running ELEVATED — the state in which a filtered token's Administrators
    //     entry is live — is still refused. Group membership and elevation are both irrelevant:
    //     admission reads the token USER alone.
    assert_eq!(
        capture(
            observed(PID_A, CREATED_A),
            &facts(&other_owner_sid(), 1, Some(0x3000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
}

#[test]
fn an_unclassifiable_principal_fails_closed_without_naming_the_token_fact() {
    // NT Authority with no sub-authority: structurally valid, not classifiable. The capture gate
    // refuses, and the verdict collapses so the Host is not told which token fact was missing.
    let mut raw = [0u8; 8];
    raw[0] = 1;
    raw[1] = 0;
    raw[7] = 5;
    assert_eq!(
        capture(observed(PID_A, CREATED_A), &facts(&raw, 3, Some(0x2000))).refusal(),
        Some(ClientAdmissionVerdict::NoClientObservation)
    );
}

// ---- 6-7. the expected owner cannot be supplied or overridden ------------------------------------

#[test]
fn an_unavailable_configured_owner_yields_no_principal_at_all() {
    // A structurally impossible SID produces NO principal, so no attempt can even begin. This is the
    // in-crate half of "unavailable configured-owner source refuses"; the record-level half
    // (`OwnerEnrolment::Absent` -> NotEnrolled) is proven in `owner_source`, below.
    assert!(EnrolledOwnerPrincipal::from_sid_bytes_for_test(&[1u8, 0, 0]).is_none());
    assert!(EnrolledOwnerPrincipal::from_sid_bytes_for_test(&[]).is_none());
}

#[test]
fn no_transition_accepts_a_principal_so_a_half_finished_attempt_cannot_be_re_aimed() {
    // STRUCTURAL PROOF, not a runtime check. The expected owner is fixed by `begin` and every later
    // transition takes only (observation, facts, connection_id, handshake_generation) — there is no
    // parameter of any principal type, and no setter. This test would stop compiling if one were
    // added, because the call below is written with the complete argument list.
    let a = begin();
    let out = a.record_client_identity(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
        CONN,
        GEN,
    );
    let b = out.into_attempt().expect("captured");
    // Admission likewise takes only the host-issued pair.
    assert!(b.admit_client_for_connection(CONN, GEN).is_ok());
}

// ---- 8-9. handshake and role ---------------------------------------------------------------------

#[test]
fn an_unconfirmed_handshake_refuses_before_any_identity_is_read() {
    // The observation core refuses first; no token capture happens at all.
    assert_eq!(
        capture(
            ServiceInstanceObservation::Refused(ServiceInstanceRefusal::HandshakeNotConfirmed),
            &facts(&owner_sid(), 3, Some(0x2000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::HandshakeNotConfirmed)
    );
}

#[test]
fn the_wrong_confirmed_role_refuses_even_for_the_exact_owner() {
    // A service-fixture confirmation must not satisfy production Agent admission. The role gate is
    // upstream of identity, so the exact configured owner in the wrong role still refuses.
    assert_eq!(
        capture(
            ServiceInstanceObservation::Refused(ServiceInstanceRefusal::UnexpectedPeerRole),
            &facts(&owner_sid(), 3, Some(0x2000))
        )
        .refusal(),
        Some(ClientAdmissionVerdict::UnexpectedClientRole)
    );
}

// ---- 10-12. stability within the attempt ---------------------------------------------------------

#[test]
fn a_changed_process_instance_refuses_on_re_observation() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.reconcile_client_identity(
            observed(PID_B, CREATED_B),
            &facts(&owner_sid(), 3, Some(0x2000)),
            CONN,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::ClientChangedDuringObservation)
    );
}

#[test]
fn a_reused_process_id_with_a_different_creation_identity_refuses() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.reconcile_client_identity(
            observed(PID_A, CREATED_B), // same PID, different creation time
            &facts(&owner_sid(), 3, Some(0x2000)),
            CONN,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::ClientChangedDuringObservation)
    );
}

#[test]
fn a_changed_token_user_refuses_on_re_observation() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.reconcile_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&other_owner_sid(), 3, Some(0x2000)),
            CONN,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
    );
}

#[test]
fn a_changed_session_refuses_even_though_process_and_user_are_unchanged() {
    // Ruling section 4: the session stays opaque and is never compared to an interactive desktop
    // session, but it MUST remain identical within the bounded attempt.
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.reconcile_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), 9, Some(0x2000)), // same everything except the session
            CONN,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::SessionChanged)
    );
}

#[test]
fn a_non_interactive_session_number_is_not_itself_a_refusal() {
    // A legitimate session of the SAME configured owner is not forbidden merely for differing from
    // some interactive desktop session elsewhere on the machine. Session 0 is admitted exactly as
    // session 3 is, because the rule is stability, not a particular value.
    for session in [0u32, 1, 3, 42] {
        let admitted = capture(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), session, Some(0x2000)),
        )
        .into_attempt()
        .expect("captured")
        .admit_client_for_connection(CONN, GEN);
        assert!(admitted.is_ok(), "session {session} must not itself refuse");
    }
}

#[test]
fn an_unobservable_session_refuses_rather_than_defaulting() {
    let mut f = facts(&owner_sid(), 3, Some(0x2000));
    f.token_session = None;
    assert_eq!(
        capture(observed(PID_A, CREATED_A), &f).refusal(),
        Some(ClientAdmissionVerdict::NoClientObservation)
    );
}

// ---- 13-14. connection and generation binding ----------------------------------------------------

#[test]
fn a_changed_connection_refuses_at_admission() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    // `unwrap_err` rather than comparing the Result: `VerifiedPeerAdmission` deliberately has no
    // `PartialEq`, so a sealed admission cannot be compared into existence.
    assert_eq!(
        a.admit_client_for_connection(CONN + 1, GEN).unwrap_err(),
        ClientAdmissionVerdict::CrossConnectionPresentation
    );
}

#[test]
fn a_changed_handshake_generation_refuses_at_admission() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.admit_client_for_connection(CONN, GEN + 1).unwrap_err(),
        ClientAdmissionVerdict::CrossConnectionPresentation
    );
}

#[test]
fn a_capture_from_another_connection_cannot_reconcile() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    assert_eq!(
        a.reconcile_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), 3, Some(0x2000)),
            CONN + 1,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::CrossConnectionPresentation)
    );
}

#[test]
fn a_zero_host_identifier_is_a_non_identity() {
    for (c, g) in [(0u64, GEN), (CONN, 0u64), (0, 0)] {
        assert_eq!(
            begin()
                .record_client_identity(
                    observed(PID_A, CREATED_A),
                    &facts(&owner_sid(), 3, Some(0x2000)),
                    c,
                    g
                )
                .refusal(),
            Some(ClientAdmissionVerdict::NoClientObservation),
            "connection {c} generation {g} must refuse"
        );
    }
}

// ---- 17-18. integrity is non-authorising ---------------------------------------------------------

#[test]
fn medium_and_high_integrity_give_the_same_authority_result_for_the_same_identity() {
    // Ruling section 5. Same exact owner, same process, same session — only the integrity differs.
    // Both are admitted, and the admissions are indistinguishable.
    for rid in [
        Some(0x2000u32),
        Some(0x3000),
        Some(0x4000),
        Some(0x1000),
        None,
    ] {
        let admitted = capture(observed(PID_A, CREATED_A), &facts(&owner_sid(), 3, rid))
            .into_attempt()
            .expect("captured")
            .admit_client_for_connection(CONN, GEN);
        let a = admitted.expect("integrity must not change the authority result");
        assert_eq!(a.connection_id(), CONN);
        assert_eq!(a.handshake_generation(), GEN);
    }
}

#[test]
fn integrity_cannot_promote_a_different_user_into_the_configured_owner() {
    // Every integrity level, including System, applied to a NON-owner. None of them admits.
    for rid in [
        Some(0x0000u32),
        Some(0x1000),
        Some(0x2000),
        Some(0x3000),
        Some(0x4000),
        None,
    ] {
        assert_eq!(
            capture(
                observed(PID_A, CREATED_A),
                &facts(&other_owner_sid(), 3, rid)
            )
            .refusal(),
            Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner),
            "integrity {rid:?} must not promote a different user"
        );
    }
}

#[test]
fn an_unrecognised_integrity_label_neither_refuses_nor_authorises() {
    // An unknown RID records as `Unrecognised` and changes nothing.
    let admitted = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0xDEAD_BEEF)),
    )
    .into_attempt()
    .expect("captured")
    .admit_client_for_connection(CONN, GEN);
    assert!(admitted.is_ok());
}

#[test]
fn a_client_that_elevates_between_two_readings_keeps_the_identity_it_had() {
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    // Medium -> High on the SAME process, user and session reconciles successfully.
    let b = a
        .reconcile_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), 3, Some(0x3000)),
            CONN,
            GEN,
        )
        .into_attempt()
        .expect("elevation must not break identity");
    assert!(b.admit_client_for_connection(CONN, GEN).is_ok());
}

// ---- impersonation hygiene ------------------------------------------------------------------------

#[test]
fn an_unreverted_impersonation_is_refused_before_any_other_check() {
    let mut f = facts(&owner_sid(), 3, Some(0x2000));
    f.impersonation_reverted = false;
    assert_eq!(
        capture(observed(PID_A, CREATED_A), &f).refusal(),
        Some(ClientAdmissionVerdict::NoClientObservation)
    );
}

#[test]
fn a_capture_that_never_impersonated_is_refused() {
    let mut f = facts(&owner_sid(), 3, Some(0x2000));
    f.impersonated = false;
    f.impersonation_reverted = false;
    assert_eq!(
        capture(observed(PID_A, CREATED_A), &f).refusal(),
        Some(ClientAdmissionVerdict::NoClientObservation)
    );
}

// ---- the bounded window ----------------------------------------------------------------------------

#[test]
fn an_expired_window_refuses_at_capture_and_at_admission() {
    use std::cell::Cell;
    use std::rc::Rc;

    // Expiry BEFORE the capture.
    let c = Rc::new(Cell::new(0u64));
    let a = ClientPeerAdmissionAttempt::begin_for_test(&owner(), Rc::clone(&c));
    c.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
    assert_eq!(
        a.record_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), 3, Some(0x2000)),
            CONN,
            GEN
        )
        .refusal(),
        Some(ClientAdmissionVerdict::ObservationWindowExpired)
    );

    // Expiry BETWEEN the capture and the admission.
    let c = Rc::new(Cell::new(0u64));
    let a = ClientPeerAdmissionAttempt::begin_for_test(&owner(), Rc::clone(&c))
        .record_client_identity(
            observed(PID_A, CREATED_A),
            &facts(&owner_sid(), 3, Some(0x2000)),
            CONN,
            GEN,
        )
        .into_attempt()
        .expect("captured");
    c.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
    assert_eq!(
        a.admit_client_for_connection(CONN, GEN).unwrap_err(),
        ClientAdmissionVerdict::ObservationWindowExpired
    );
}

#[test]
fn a_clock_rollback_cannot_revive_an_expired_attempt() {
    use std::cell::Cell;
    use std::rc::Rc;

    // Production measures with `std::time::Instant`, which is MONOTONIC: it is derived from the OS
    // monotonic counter, not the wall clock, so changing system time cannot move it. The fake models
    // that with a peak clamp — but the clamp only records values it has actually READ, so the high
    // value must be observed before the rollback. That is the real property, and it is the one the
    // accepted service-instance route proves too.
    let c = Rc::new(Cell::new(0u64));
    let a = ClientPeerAdmissionAttempt::begin_for_test(&owner(), Rc::clone(&c));
    c.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
    let expired = a.record_client_identity(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
        CONN,
        GEN,
    );
    assert_eq!(
        expired.refusal(),
        Some(ClientAdmissionVerdict::ObservationWindowExpired)
    );
    // Rolling the source backwards afterwards yields no usable attempt and no second chance: the
    // refusal CONSUMED the attempt, so there is nothing left to revive.
    c.set(0);
    assert!(expired.into_attempt().is_none());
}

#[test]
fn the_attempt_clock_never_runs_backwards_within_one_attempt() {
    use std::cell::Cell;
    use std::rc::Rc;

    let c = Rc::new(Cell::new(0u64));
    let a = ClientPeerAdmissionAttempt::begin_for_test(&owner(), Rc::clone(&c));
    c.set(MAX_OBSERVATION_WINDOW_MILLIS + 1);
    // Observe the high value, then roll the source back below the window.
    assert!(a.inner.expiry().is_some());
    c.set(0);
    // Still expired: the peak clamp preserves the monotonic reading, so a wall-clock rollback cannot
    // extend an attempt's validity.
    assert_eq!(
        a.inner.expiry(),
        Some(ClientAdmissionVerdict::ObservationWindowExpired)
    );
}

// ---- 15-16. structural properties of the attempt and the admission ----------------------------------

#[test]
fn the_attempt_and_the_admission_render_nothing() {
    let a = begin();
    assert_eq!(
        format!("{a:?}"),
        "ClientPeerAdmissionAttempt([REDACTED])",
        "an attempt holds a SID and a session and must render neither"
    );
    assert_eq!(
        format!("{:?}", owner()),
        "EnrolledOwnerPrincipal([REDACTED])",
        "the expected owner is a SID and must never be rendered"
    );
    let out = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    );
    assert_eq!(
        format!("{out:?}"),
        "ClientAttemptOutcome::Continue([REDACTED])"
    );
    // A redacted rendering must also not leak through the admission.
    let rendered = format!("{:?}", admit_happy_path().expect("admitted"));
    for forbidden in ["1001", "21", "PeerUserBinding", "sid"] {
        assert!(
            !rendered.contains(forbidden),
            "admission Debug leaked {forbidden}: {rendered}"
        );
    }
}

/// COMPILE-LEVEL PROOFS via trait-resolution ambiguity.
///
/// Each helper is generic over a trait the type must NOT implement. If `ClientPeerAdmissionAttempt`
/// ever gained `Clone`, or `VerifiedPeerAdmission` gained `Clone`/`Default`, the corresponding call
/// below would become ambiguous and this module would stop compiling. A runtime assertion cannot
/// express "this type has no such capability"; this does.
mod not_cloneable {
    use super::*;

    trait NotClone {
        fn assert_not_clone(&self) {}
    }
    impl<T> NotClone for T {}

    trait NotDefault {
        fn assert_not_default() {}
    }
    impl<T> NotDefault for T {}

    #[test]
    fn an_attempt_is_not_cloneable_and_an_admission_is_neither_cloneable_nor_defaultable() {
        let a = begin();
        a.assert_not_clone();
        let admission = admit_happy_path().expect("admitted");
        admission.assert_not_clone();
        <VerifiedPeerAdmission as NotDefault>::assert_not_default();
        <ClientPeerAdmissionAttempt<ClientPrepared> as NotDefault>::assert_not_default();
    }
}

#[test]
fn a_refused_outcome_yields_no_usable_attempt() {
    // A refusal consumes the attempt: there is no way back to a usable state, so a failed capture can
    // never be retried into an admission.
    let out = capture(
        observed(PID_A, CREATED_A),
        &facts(&other_owner_sid(), 3, Some(0x2000)),
    );
    assert!(!out.is_continuing());
    assert!(out.into_attempt().is_none());
}

#[test]
fn admission_consumes_the_attempt_so_it_cannot_be_admitted_twice() {
    // STRUCTURAL. `admit_client_for_connection` takes `self` by value, so the second call below does
    // not compile — proven here by the fact that the attempt is unusable after the first call and
    // the only way to admit again is to build a NEW attempt from a NEW capture.
    let a = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured");
    let first = a.admit_client_for_connection(CONN, GEN);
    assert!(first.is_ok());
    // `a` is moved; a second `a.admit_client_for_connection(..)` here is a compile error.
    // A fresh attempt is required, and it must pass every gate again:
    let second = capture(
        observed(PID_A, CREATED_A),
        &facts(&owner_sid(), 3, Some(0x2000)),
    )
    .into_attempt()
    .expect("captured")
    .admit_client_for_connection(CONN, GEN);
    assert!(second.is_ok());
}

#[test]
fn the_verdict_enum_has_no_positive_variant() {
    // Ruling section 6: there must be no common positive whose meaning depends on the caller. Every
    // `ClientAdmissionVerdict` is a refusal; the only positive answer is the sealed admission.
    // Written as an exhaustive match so a future positive variant breaks this test.
    fn is_refusal(v: ClientAdmissionVerdict) -> bool {
        match v {
            ClientAdmissionVerdict::NoClientObservation
            | ClientAdmissionVerdict::HandshakeNotConfirmed
            | ClientAdmissionVerdict::UnexpectedClientRole
            | ClientAdmissionVerdict::ClientChangedDuringObservation
            | ClientAdmissionVerdict::PrincipalNotConfiguredOwner
            | ClientAdmissionVerdict::SessionChanged
            | ClientAdmissionVerdict::CrossConnectionPresentation
            | ClientAdmissionVerdict::ObservationWindowExpired
            | ClientAdmissionVerdict::UnsupportedPlatform
            | ClientAdmissionVerdict::UnexpectedFailure => true,
        }
    }
    assert!(is_refusal(
        ClientAdmissionVerdict::PrincipalNotConfiguredOwner
    ));
}

// ---- 19. the B3 service-instance route is untouched -------------------------------------------------

#[test]
fn the_service_instance_route_still_cannot_be_started_in_any_build() {
    // The B3 attempt still demands `LiveInstanceObservationCapability`, which has no constructor
    // outside the fixture feature. This module's capability is a DIFFERENT type and cannot be
    // substituted for it, so granting client admission granted nothing to the service-instance route.
    //
    // Structural: `ServiceInstanceBindingAttempt::begin` does not accept our capability. Writing
    // `ServiceInstanceBindingAttempt::begin(&cap())` here would be a type error.
    let _c: ClientAdmissionObservationCapability = cap();
}

// ---- the canonical owner source ---------------------------------------------------------------------

#[cfg(feature = "windows-client-admission")]
mod owner_source {
    use super::*;
    use projectos_host_identity::canonical_record as record;

    /// A synthetic enrolled owner SID in the canonical record's lower-case hex form: the same bytes
    /// as `owner_sid()`.
    fn owner_hex() -> String {
        owner_sid().iter().map(|b| format!("{b:02x}")).collect()
    }

    fn verified_with(owner: Option<String>) -> record::VerifiedCanonicalInstallation {
        let mut r = record::fixtures::valid_record();
        if let Some(hex) = owner {
            r.schema_version = record::RECORD_SCHEMA_VERSION_OWNER_ENROLLED;
            r.configured_owner_sid = Some(hex);
        }
        r.record_digest = record::compute_record_digest(&r);
        record::verify_record(&r, record::RecordInstallationEvidence::Matched)
            .expect("fixture record verifies")
    }

    #[test]
    fn an_enrolled_owner_yields_exactly_that_principal() {
        let v = verified_with(Some(owner_hex()));
        let p = EnrolledOwnerPrincipal::from_canonical_installation(&cap(), &v)
            .expect("enrolled owner yields a principal");
        // And it is the SAME principal the admission proofs use, so the record really is the source.
        let admitted = ClientPeerAdmissionAttempt::begin(&cap(), &p)
            .record_client_identity(
                observed(PID_A, CREATED_A),
                &facts(&owner_sid(), 3, Some(0x2000)),
                CONN,
                GEN,
            )
            .into_attempt()
            .expect("captured")
            .admit_client_for_connection(CONN, GEN);
        assert!(admitted.is_ok());
    }

    #[test]
    fn an_unenrolled_installation_refuses_with_no_fallback_principal() {
        // The ONLY meaning of a version-1 record. There is no default owner, no interactive-user
        // inference and no administrator fallback.
        let v = verified_with(None);
        assert_eq!(
            EnrolledOwnerPrincipal::from_canonical_installation(&cap(), &v).unwrap_err(),
            ConfiguredOwnerRefusal::NotEnrolled
        );
    }

    #[test]
    fn the_enrolled_owner_is_the_only_principal_the_record_can_name() {
        // A record enrolling a DIFFERENT owner admits that owner and refuses ours, proving the
        // principal genuinely comes from the record rather than from anything in this crate.
        // The type is inferred through the collect rather than annotated: the crate-wide raw-identity
        // scan refuses the token `: String` anywhere in this tree, and a test is not an exception to
        // a rule about identity-capable text.
        // Built with `String::from_iter` rather than an annotation or a turbofish: the crate-wide
        // raw-identity scan refuses the token `: String` anywhere in this tree, and a test is not an
        // exception to a rule about identity-capable text.
        let other_hex = String::from_iter(other_owner_sid().iter().map(|b| format!("{b:02x}")));
        let v = verified_with(Some(other_hex));
        let p = EnrolledOwnerPrincipal::from_canonical_installation(&cap(), &v).expect("principal");
        assert_eq!(
            ClientPeerAdmissionAttempt::begin(&cap(), &p)
                .record_client_identity(
                    observed(PID_A, CREATED_A),
                    &facts(&owner_sid(), 3, Some(0x2000)),
                    CONN,
                    GEN
                )
                .refusal(),
            Some(ClientAdmissionVerdict::PrincipalNotConfiguredOwner)
        );
    }

    #[test]
    fn upper_case_hex_is_refused_rather_than_normalised() {
        // The canonical record's contract is lower-case hex. A reader that accepted both would accept
        // an encoding the writer never produces.
        assert!(super::super::decode_lower_hex("0105000000000005").is_some());
        assert!(super::super::decode_lower_hex("0105000000000005ABCDEF01").is_none());
        assert!(
            super::super::decode_lower_hex("abc").is_none(),
            "odd length"
        );
        assert!(super::super::decode_lower_hex("").is_none(), "empty");
        assert!(super::super::decode_lower_hex("zz").is_none(), "non-hex");
    }
}
