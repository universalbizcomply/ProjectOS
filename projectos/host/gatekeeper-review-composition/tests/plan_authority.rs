//! THE PRODUCTION PLAN AUTHORITY, proven against a really-validated approved plan.
//!
//! Written as an EXTERNAL consumer, so every route exercised here is one a real composition site can
//! reach. The plan is produced through host-core's own synthetic approval + Intent/Commit journal path,
//! so the `ValidatedApprovedPlan` under test is one the reload contract produced — not a struct assembled
//! to make an assertion pass.
//!
//! No disk, no pipe, no clock, no process, no network.

use projectos_host_core::{
    ApprovedPlanJournal, ApprovedPlanStatus, EffectPolicy, EnvironmentId, PhaseDefinitionCandidate,
    PhaseType, ProjectId, ProviderPolicy, RepositoryPolicy, ResidueRequirement,
};
use projectos_host_gatekeeper_review_composition::DurablePlanAuthority;
use projectos_host_identity::{phase_identity_digest, plan_identity_digest};
use projectos_host_windows_local_ipc::HostPlanAuthority;

const PHASE_ID: &str = "PROJECTOS-HOST-REVIEW-PATH1A";
/// The reference host-core's fixture approval path uses. Read from the binding in the assertions rather
/// than assumed, so this constant is documentation and not a second source of truth.
const PLAN_REF: &str = "plan-1";

fn candidate() -> PhaseDefinitionCandidate {
    PhaseDefinitionCandidate {
        phase_id: PHASE_ID.to_string(),
        phase_type: PhaseType::SourceOnly,
        project: ProjectId::new("projectos").expect("valid project"),
        environment: EnvironmentId::new("reference-development-pc").expect("valid environment"),
        // A scope entry is a bounded IDENTIFIER, so no slash: `validate_bounded_id` forbids `/`, and
        // only `path_boundary` goes through the path-aware normaliser that permits it.
        scope: vec!["host".to_string()],
        path_boundary: vec!["projectos/host".to_string()],
        allowed_actions: vec!["inspect-repository".to_string()],
        prohibited_actions: vec!["production-deploy".to_string()],
        dependencies: vec![],
        predecessors: vec![],
        repository_policy: RepositoryPolicy::ReadOnly,
        provider_policy: ProviderPolicy::None,
        effect_policy: EffectPolicy::None,
        rollback_required: false,
        shutdown_required: false,
        disconnect_required: false,
        residue: ResidueRequirement::ExactlyZero,
        approved_baseline: None,
    }
}

fn authority() -> (DurablePlanAuthority, [u8; 32]) {
    let mut journal = ApprovedPlanJournal::new();
    let validated = journal.commit_approved_for_test(&candidate(), 1, ApprovedPlanStatus::Active, 0);
    let definition_digest = *validated.binding().digest_bytes();
    (DurablePlanAuthority::from_validated(&validated), definition_digest)
}

/// `plan` is the canonical PROGRAMME IDENTITY of the plan reference — the same value an owner programme
/// delegation carries in its `plan` field.
#[test]
fn plan_is_the_programme_identity_of_the_plan_reference() {
    let (a, _) = authority();
    assert_eq!(a.plan(), Some(plan_identity_digest(PLAN_REF)));
}

/// `phase` is the canonical PROGRAMME IDENTITY of the phase ID, which is what a delegation's
/// `allowed_phases` entries hold.
#[test]
fn phase_is_the_programme_identity_of_the_phase_id() {
    let (a, _) = authority();
    assert_eq!(a.phase(), Some(phase_identity_digest(PHASE_ID)));
}

/// THE DISTINCTION THAT COST THIS PHASE A STOP. `phase` must NOT be the phase-definition digest: one
/// answers "which phase is this", the other "is this definition the approved one". Wiring the wrong one
/// in produces a permanent refusal nobody can explain, so it is asserted rather than assumed.
#[test]
fn phase_is_not_the_phase_definition_digest() {
    let (a, definition_digest) = authority();
    assert_ne!(a.phase(), Some(definition_digest));
    assert_eq!(a.plan_digest(), Some(definition_digest));
}

/// `plan_digest` is the ALREADY-VALIDATED phase-definition digest, read through the narrow accessor —
/// never recomputed here, and never read off the stored record's hex.
#[test]
fn plan_digest_is_the_validated_definition_digest() {
    let (a, definition_digest) = authority();
    assert_eq!(a.plan_digest(), Some(definition_digest));
}

/// Every fact is present for a validated plan. A `None` from this adapter would mean "could not
/// establish", which the composition turns into a refusal — so a validated plan must never produce one.
#[test]
fn a_validated_plan_establishes_all_three_facts() {
    let (a, _) = authority();
    assert!(a.plan().is_some() && a.plan_digest().is_some() && a.phase().is_some());
}

/// THE THREE FACTS ARE IN THREE DIFFERENT DIGEST SPACES. A transposition — plan where phase belongs —
/// would otherwise be invisible here and would fail only at the binding gate, with no way to tell why.
#[test]
fn the_three_facts_are_distinct() {
    let (a, _) = authority();
    let plan = a.plan().unwrap();
    let digest = a.plan_digest().unwrap();
    let phase = a.phase().unwrap();
    assert_ne!(plan, digest);
    assert_ne!(plan, phase);
    assert_ne!(digest, phase);
}

/// A DIFFERENT PHASE ID IS A DIFFERENT FACT. The adapter reads the binding, so a plan approved for
/// another phase cannot report this one's identity.
#[test]
fn another_phase_reports_another_identity() {
    let mut journal = ApprovedPlanJournal::new();
    let mut other = candidate();
    other.phase_id = "PROJECTOS-SOME-OTHER-PHASE1A".to_string();
    let validated = journal.commit_approved_for_test(&other, 1, ApprovedPlanStatus::Active, 0);
    let a = DurablePlanAuthority::from_validated(&validated);
    assert_eq!(
        a.phase(),
        Some(phase_identity_digest("PROJECTOS-SOME-OTHER-PHASE1A"))
    );
    assert_ne!(a.phase(), Some(phase_identity_digest(PHASE_ID)));
}

/// PROJECTOS-HOST-REVIEW-PATH1B. THE BASELINE IS THE ONE THE DURABLE RECORD WAS APPROVED AGAINST,
/// decoded byte for byte — and an authority built over a different approval states a different one.
#[test]
fn the_approved_baseline_is_the_durable_records_own() {
    use projectos_host_core::ApprovedBaselineCommit;

    let hex = "0123456789abcdef0123456789abcdef01234567";
    let mut journal = ApprovedPlanJournal::new();
    let validated = journal.commit_approved_with_baseline_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
        &ApprovedBaselineCommit::parse(hex).unwrap(),
    );
    let stated = DurablePlanAuthority::from_validated(&validated)
        .approved_baseline()
        .expect("a reloaded fact carries its baseline");
    assert_eq!(
        stated,
        [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd,
            0xef, 0x01, 0x23, 0x45, 0x67
        ]
    );

    // A PLAN APPROVED AGAINST NO BASELINE STATES NONE - and the composition refuses a review of it.
    let (without, _) = authority();
    assert_eq!(without.approved_baseline(), None);

    // THE BASELINE IS PART OF WHAT WAS APPROVED: the same definition against another baseline is another
    // approval, with another definition digest.
    let mut journal = ApprovedPlanJournal::new();
    let other = journal.commit_approved_with_baseline_for_test(
        &candidate(),
        1,
        ApprovedPlanStatus::Active,
        0,
        &ApprovedBaselineCommit::parse(&"c".repeat(40)).unwrap(),
    );
    assert_ne!(other.binding().digest_bytes(), validated.binding().digest_bytes());
    assert_ne!(
        DurablePlanAuthority::from_validated(&other).approved_baseline(),
        Some(stated)
    );
}
