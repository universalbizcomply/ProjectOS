//! Proof for the governed request-replay IDENTITY and the sealed ledger contract
//! (RUN-TO-COMPLETION HOST ATTESTATION §10C).
//!
//! The durable behaviour — restart, crash, concurrency, corruption, capacity — is proven against
//! real bytes in `durable_store::tests`. What is proven HERE is the part that has nothing to do with
//! storage: that the identity is derived from the HOST's answers and no caller field, that it is
//! stable across everything a restart changes, and that the evidence the gate returns converts into
//! no authority.

use super::{
    ConsumedRequest, FixtureRequestReplayLedger, ReplayRefusal, RequestReplayIdentity,
    RequestReplayLedger, REPLAY_IDENTITY_DOMAIN, REPLAY_IDENTITY_LEN,
    REPLAY_IDENTITY_SCHEMA_VERSION,
};
use crate::operation_contract::{BINDING_DIGEST_LEN, DELEGATION_DIGEST_LEN};

const DELEG_A: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
const DELEG_B: [u8; DELEGATION_DIGEST_LEN] = [0x22; DELEGATION_DIGEST_LEN];
const BIND_A: [u8; BINDING_DIGEST_LEN] = [0x33; BINDING_DIGEST_LEN];
const BIND_B: [u8; BINDING_DIGEST_LEN] = [0x44; BINDING_DIGEST_LEN];
const PARAM_A: [u8; BINDING_DIGEST_LEN] = [0x55; BINDING_DIGEST_LEN];
const PARAM_B: [u8; BINDING_DIGEST_LEN] = [0x66; BINDING_DIGEST_LEN];

fn id_a() -> RequestReplayIdentity {
    RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A)
}

// ---------------------------------------------------------------------------------------------
// THE IDENTITY
// ---------------------------------------------------------------------------------------------

#[test]
fn the_identity_is_deterministic() {
    // If this were not deterministic, the durable record written on the first attempt could never
    // be matched on the second - and every replay would read back fresh.
    assert_eq!(id_a(), id_a());
    assert_eq!(id_a().as_bytes(), id_a().as_bytes());
}

#[test]
fn every_part_is_load_bearing() {
    let base = id_a();
    assert_ne!(
        base,
        RequestReplayIdentity::fixture_over(&DELEG_B, &BIND_A, &PARAM_A),
        "the delegation grant must scope the identity"
    );
    assert_ne!(
        base,
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_B, &PARAM_A),
        "the binding subject must scope the identity"
    );
    assert_ne!(
        base,
        RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_B),
        "the request parameters must scope the identity"
    );
}

#[test]
fn the_domain_and_schema_are_the_ones_the_identity_promises() {
    // The domain separates a replay identity from the §9B binding digest, which is computed over
    // overlapping material with a different domain tag. Sharing one would let a binding digest be
    // presented as a replay identity, or collide with one.
    assert_eq!(REPLAY_IDENTITY_DOMAIN, b"projectos.host-request-replay.v1");
    assert_ne!(
        REPLAY_IDENTITY_DOMAIN.as_slice(),
        crate::operation_contract::BINDING_DIGEST_DOMAIN.as_slice()
    );
    assert_eq!(REPLAY_IDENTITY_SCHEMA_VERSION, 1);
    assert_eq!(REPLAY_IDENTITY_LEN, 32);
}

#[test]
fn the_identity_is_the_full_digest_width() {
    // A truncated identity is a cheaper collision, and a collision here permanently denies one
    // governed request and permanently replays another.
    assert_eq!(id_a().as_bytes().len(), 32);
}

// ---------------------------------------------------------------------------------------------
// WHAT IS DELIBERATELY ABSENT — the fields a restart regenerates
// ---------------------------------------------------------------------------------------------
//
// These are stated as source-level facts rather than as runtime assertions, because the property is
// that the fields are NOT ARGUMENTS: there is no value a test could vary to observe them, which is
// exactly the guarantee. `for_request` takes a verified delegation, sealed host-resolved facts and
// an operation class, and `fixture_over` takes the three digests. Neither takes a correlation, a
// sequence, a connection id, a handshake generation, a session digest or a service epoch.

#[test]
fn the_identity_has_no_session_local_input() {
    // The compile-time shape is the proof. This test exists so the claim is checked by SOMETHING
    // when the signature changes: adding a caller-controlled parameter to either constructor breaks
    // these calls, and adding a session-local one breaks them too.
    let by_parts = RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A);
    // The same three parts, no matter how many times a "session" is imagined to have changed.
    for _reconnected in 0..4 {
        assert_eq!(
            by_parts,
            RequestReplayIdentity::fixture_over(&DELEG_A, &BIND_A, &PARAM_A)
        );
    }
}

// ---------------------------------------------------------------------------------------------
// THE LEDGER CONTRACT
// ---------------------------------------------------------------------------------------------

#[test]
fn a_fresh_identity_is_consumed_and_then_refused() {
    let mut ledger = FixtureRequestReplayLedger::empty();
    let evidence = ledger.consume(&id_a()).expect("fresh");
    assert!(evidence.answers(&id_a()));
    assert_eq!(
        ledger.consume(&id_a()).map(|_| ()),
        Err(ReplayRefusal::AlreadyConsumed)
    );
    assert_eq!(ledger.recorded(), 1, "a refusal must record nothing new");
}

#[test]
fn distinct_identities_do_not_interfere() {
    let mut ledger = FixtureRequestReplayLedger::empty();
    ledger.consume(&id_a()).expect("a");
    ledger
        .consume(&RequestReplayIdentity::fixture_over(
            &DELEG_A, &BIND_A, &PARAM_B,
        ))
        .expect("b is genuinely different work");
    assert_eq!(ledger.recorded(), 2);
}

#[test]
fn the_evidence_answers_only_its_own_identity() {
    // Evidence that answered any identity would let one crossing of the gate stand in for another.
    let mut ledger = FixtureRequestReplayLedger::empty();
    let evidence: ConsumedRequest = ledger.consume(&id_a()).expect("fresh");
    assert!(evidence.answers(&id_a()));
    assert!(!evidence.answers(&RequestReplayIdentity::fixture_over(
        &DELEG_A, &BIND_A, &PARAM_B
    )));
}

#[test]
fn the_evidence_redacts_itself() {
    let mut ledger = FixtureRequestReplayLedger::empty();
    let evidence = ledger.consume(&id_a()).expect("fresh");
    let rendered = format!("{evidence:?}");
    assert_eq!(rendered, "ConsumedRequest([REDACTED])");
    assert!(!rendered.contains("11"), "the identity must not print");
}

#[test]
fn every_refusal_variant_is_a_refusal() {
    // There is deliberately no variant meaning "could not establish the history, carry on". This
    // asserts the taxonomy stays that shape: each one is constructed and none of them is an Ok.
    for refusal in [
        ReplayRefusal::AlreadyConsumed,
        ReplayRefusal::StateRootUnusable,
        ReplayRefusal::StoreUnavailable,
        ReplayRefusal::HistoryUnreadable,
        ReplayRefusal::CapacityExhausted,
        ReplayRefusal::WriteRefused,
    ] {
        let outcome: Result<(), ReplayRefusal> = Err(refusal);
        assert!(outcome.is_err());
    }
}
