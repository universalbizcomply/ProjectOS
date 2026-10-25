//! EXTERNAL-consumer proof of the opaque effect-witness and typed-grant contract
//! (3K-I-D-E-C-CAPABILITY-B4-EFFECT-WITNESS-CONTRACT1A).
//!
//! This runs as an external consumer, so it sees exactly the surface a dependent crate sees. It proves
//! the TYPE and OWNERSHIP contract only.
//!
//! It proves NOTHING about real owner approval, real elevation, repository verification, executable
//! verification or live authority — all four witnesses here are SYNTHETIC, no producer for a real one
//! exists, and nothing in this file touches Windows, a token, the SCM, a pipe or a process.

#![cfg(feature = "effect-witness-fixtures")]

use projectos_host_authority::effect_witness::{
    compose_verified_authorisation, synthetic_owner_witness, synthetic_witnesses,
    ApprovedEffectSet, EffectAuthorisationClassification, EffectAuthorisationRefusal,
    ExecutableIdentityClass, ResidueRequirement, RollbackRequirement, SyntheticEffectContext,
};

/// The full contract path: four witnesses → one transition → one attempt grant → three typed grants.
#[test]
fn the_witness_contract_composes_and_splits_exactly_once() {
    // 1. Four synthetic opaque witnesses for ONE common context.
    let (owner, elevation, repository, executable) =
        synthetic_witnesses(SyntheticEffectContext::valid());

    // 2. Consume all four into one verified authorisation transition.
    let transition = compose_verified_authorisation(owner, elevation, repository, executable);
    assert_eq!(
        transition.classification(),
        EffectAuthorisationClassification::Composed
    );

    // 3. Consume the transition into exactly one attempt grant.
    let attempt = transition
        .into_authorised_attempt_grant()
        .expect("agreeing witnesses must compose");

    // 4. Split atomically into exactly three typed grants.
    let (scm, ipc, observation) = attempt.into_typed_grants();

    // 5. All three describe the same opaque context — verified by equality, never by reading it.
    assert!(ipc.shares_context_with_scm(&scm));
    assert!(observation.shares_context_with_scm(&scm));

    // 6. No raw identity is exposed anywhere in the rendered contract surface.
    for rendered in [
        format!("{scm:?}"),
        format!("{ipc:?}"),
        format!("{observation:?}"),
    ] {
        assert!(rendered.contains("[REDACTED]"), "{rendered}");
        assert!(!rendered.chars().any(|c| c.is_ascii_digit()), "{rendered}");
    }

    // 7. The legacy OperationGate was not involved: this crate does not even depend on
    //    windows-service-control, so no gate, OwnerApproval or Elevation value could have reached here.
    println!("EFFECT_WITNESS_CONTRACT_OK");
}

/// A witness minted for a different context can never compose — the cross-context replay defence.
#[test]
fn witnesses_from_different_contexts_never_compose() {
    let valid = SyntheticEffectContext::valid();
    let variants = [
        valid.with_project(9),
        valid.with_phase(9),
        valid.with_repository_baseline(9),
        valid.with_environment(9),
        valid.with_service_context(9),
        valid.with_proof_attempt(9),
        valid.with_owner_session(9),
        valid.with_executable_class(ExecutableIdentityClass::Unverified),
        valid.with_effect_set(ApprovedEffectSet::ObservationAndTemporaryServiceLifecycle),
    ];
    for other in variants {
        let owner = synthetic_owner_witness(other);
        let (_, elevation, repository, executable) = synthetic_witnesses(valid);
        let transition = compose_verified_authorisation(owner, elevation, repository, executable);
        assert_eq!(
            transition.classification(),
            EffectAuthorisationClassification::Refused(EffectAuthorisationRefusal::ContextMismatch)
        );
        assert!(
            transition.into_authorised_attempt_grant().is_none(),
            "a mismatched composition must emit no grant"
        );
    }
}

/// An elapsed validity window refuses, even when every witness agrees.
#[test]
fn an_expired_window_emits_no_grant() {
    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid().expired());
    let transition = compose_verified_authorisation(o, e, r, x);
    assert_eq!(
        transition.classification(),
        EffectAuthorisationClassification::Refused(EffectAuthorisationRefusal::WindowExpired)
    );
    assert!(transition.into_authorised_attempt_grant().is_none());
}

/// A context that does not require rollback and exact-zero residue, or approves no effect, refuses.
#[test]
fn an_incomplete_effect_contract_emits_no_grant() {
    let cases = [
        SyntheticEffectContext::valid().with_rollback(RollbackRequirement::NotRequired),
        SyntheticEffectContext::valid().with_residue(ResidueRequirement::Unconstrained),
        SyntheticEffectContext::valid().with_effect_set(ApprovedEffectSet::None),
    ];
    for ctx in cases {
        let (o, e, r, x) = synthetic_witnesses(ctx);
        let transition = compose_verified_authorisation(o, e, r, x);
        assert_eq!(
            transition.classification(),
            EffectAuthorisationClassification::Refused(
                EffectAuthorisationRefusal::IncompleteEffectContract
            )
        );
        assert!(transition.into_authorised_attempt_grant().is_none());
    }
}

/// Two separate attempts produce grants that do not share a context, so nothing can be recombined.
#[test]
fn grants_from_separate_attempts_never_share_a_context() {
    let first = synthetic_witnesses(SyntheticEffectContext::valid());
    let (scm_a, _, _) = compose_verified_authorisation(first.0, first.1, first.2, first.3)
        .into_authorised_attempt_grant()
        .expect("first attempt composes")
        .into_typed_grants();

    let second = synthetic_witnesses(SyntheticEffectContext::valid().with_proof_attempt(2));
    let (_, ipc_b, _) = compose_verified_authorisation(second.0, second.1, second.2, second.3)
        .into_authorised_attempt_grant()
        .expect("second attempt composes")
        .into_typed_grants();

    assert!(!ipc_b.shares_context_with_scm(&scm_a));
}

/// Holding grants is not authority: this crate exposes no capability and no producer.
#[test]
fn the_contract_grants_no_live_authority() {
    let (o, e, r, x) = synthetic_witnesses(SyntheticEffectContext::valid());
    let (_scm, _ipc, _observation) = compose_verified_authorisation(o, e, r, x)
        .into_authorised_attempt_grant()
        .expect("composes")
        .into_typed_grants();
    // There is deliberately nothing to call: no from_grant, no capability, no producer exists yet.
    // The grants are inert contract values, which is the whole point of this phase.
}
