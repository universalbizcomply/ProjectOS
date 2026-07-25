//! EXTERNAL-consumer proof of the Tier-1 operation-bound phase identity
//! (CD-B4-OPERATION-PHASE-BINDING1A).
//!
//! Proves the phase authority contract from the public surface a dependent sees: one operation issues
//! one opaque `PhaseId`; it flows into the binding, approval, facts and execution context; the fingerprint
//! changes with the phase; the reducer fails closed (honestly) on a missing or mismatched phase; and no
//! approval, fact set or permit crosses operations even when the caller reuses the same `PhaseReference`.
//!
//! Tier 1 only: nothing here proves an approved plan, a plan version, a phase-definition digest, scope,
//! a path boundary, dependencies or predecessor closure.

use projectos_host_core::{
    reduce, ApprovalOutcome, ApprovalRecordId, AuthoritySnapshot, BindingKind, ContextComparison,
    ContextField, CredentialLifecycle, CredentialOutcome, CredentialScope, DenialReason,
    Disposition, EmergencyStateRevision, EmergencyStopState, ExecutableIdentity, ExpiryBoundary,
    InstallationId, InternalOperationRecord, MissingFact, OperationBinding, OperationInputs,
    OperationState, PhaseReference, PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision,
    PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId, ReplayEvidenceId, RepositoryRef,
    ResumePolicy, RevocationRevision, RevocationStatus, ServiceValidatedFacts, SessionId,
    ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness, ValidatedInstallation,
    ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease,
    ValidatedSession, ValidityStatus, VerifiedApproval, VerifiedExecutionContext,
};
use projectos_trust_contract::{
    CredentialRef, EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId,
    ProviderId,
};

fn inputs() -> OperationInputs {
    OperationInputs {
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        provider: ProviderId::new("supabase").unwrap(),
        operation: OperationName::new("op").unwrap(),
        fingerprint: OperationFingerprint::new("fp").unwrap(),
        release: ReleaseId::new("rel-1"),
    }
}

/// Create a ready-to-reduce record for a given operation ref and phase reference. The `PhaseId` is
/// minted internally; the caller never chooses it.
fn record(operation_ref: &str, phase_reference: &str) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new(operation_ref).unwrap(),
        inputs(),
        &PhaseReference::new(phase_reference).unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: true,
            credential_required: true,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    );
    r.state = OperationState::ReadyForRevalidation;
    r
}

/// A complete, valid fact set bound to the given binding's phase.
fn full_facts(b: &OperationBinding) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(b.phase.clone()),
        approved_plan: None,
        repository: None,
        session: Some(ValidatedSession {
            session: sid.clone(),
        }),
        process: Some(ValidatedProcess { session: sid }),
        executable: Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-1"),
            installation: inst.clone(),
        }),
        release: Some(ValidatedRelease {
            release: b.release.clone(),
        }),
        installation: Some(ValidatedInstallation {
            installation: inst.clone(),
        }),
        project: Some(ValidatedProjectContext {
            project: b.project.clone(),
            repository: RepositoryRef::new("repo-1"),
        }),
        environment: Some(ValidatedEnvironment {
            environment: b.environment.clone(),
        }),
        publisher_policy: Some(ValidatedPublisherPolicy {
            policy_id: PolicyId::new("pol-1"),
            policy_revision: PolicyRevision(1),
            publisher: PublisherIdentity::new("pub-1"),
            installation: inst.clone(),
            outcome: PolicyOutcome::Accepted,
            revocation_revision: RevocationRevision(1),
        }),
        freshness: Some(ValidatedFreshness {
            release: b.release.clone(),
            release_floor: ReleaseFloor(1),
            policy_revision: PolicyRevision(1),
            policy_floor: PolicyFloor(1),
            emergency_revocation_floor: RevocationRevision(1),
        }),
        authority: Some(AuthoritySnapshot {
            authority_expiry: ExpiryBoundary(1000),
            operation_expiry: Some(ExpiryBoundary(1000)),
            validity: ValidityStatus::Valid,
            revocation: RevocationStatus::Active(RevocationRevision(1)),
            emergency_state_revision: EmergencyStateRevision(1),
        }),
        approval: ApprovalOutcome::Verified(VerifiedApproval {
            approval_id: ApprovalRecordId::new("appr-1").unwrap(),
            phase: b.phase.clone(),
            project: b.project.clone(),
            repository: None,
            environment: b.environment.clone(),
            provider: b.provider.clone(),
            operation: b.operation.clone(),
            fingerprint: b.fingerprint.clone(),
            release: b.release.clone(),
            expiry: ExpiryBoundary(1000),
            replay_identity: ReplayEvidenceId::new("nonce-1").unwrap(),
            operation_count: None,
            revocation: RevocationStatus::Active(RevocationRevision(1)),
        }),
        credential: CredentialOutcome::Available(CredentialScope {
            credential: CredentialRef::new("cred-1").unwrap(),
            project: b.project.clone(),
            environment: b.environment.clone(),
            provider: b.provider.clone(),
            permitted_operation: b.operation.clone(),
            lifecycle: CredentialLifecycle::Active,
            expiry: ExpiryBoundary(1000),
            revocation_revision: RevocationRevision(1),
        }),
        emergency_stop: EmergencyStopState::Clear,
    }
}

fn context(r: &InternalOperationRecord, facts: &ServiceValidatedFacts) -> VerifiedExecutionContext {
    match reduce(&r.to_request(), facts) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    }
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn one_operation_issues_and_retains_one_phase() {
    let r = record("op-1", "phase-1");
    let phase = r.binding.phase.clone();
    // Immutable: a second read is the same identity.
    assert_eq!(r.binding.phase, phase);
    // The phase flows into a valid, eligible reduction and into the permit context.
    let facts = full_facts(&r.binding);
    match reduce(&r.to_request(), &facts) {
        Disposition::EligibleForServiceExecution(permit) => {
            assert_eq!(*permit.context().phase(), phase);
        }
        other => panic!("expected eligible, got {other:?}"),
    }
}

#[test]
fn fingerprint_changes_when_only_the_phase_changes() {
    // Same base inputs, different phase reference → different operation → different phase → different
    // phase-bound fingerprint.
    let a = record("op-A", "phase-1");
    let b = record("op-B", "phase-1"); // same reference, different operation
    assert_ne!(a.binding.phase, b.binding.phase);
    assert_ne!(a.binding.fingerprint, b.binding.fingerprint);
}

#[test]
fn permit_comparison_accepts_the_same_phase() {
    let r = record("op-1", "phase-1");
    let c = context(&r, &full_facts(&r.binding));
    assert_eq!(c.compare(&c), ContextComparison::Match);
}

// ---- REFUSAL ----------------------------------------------------------------------------------

#[test]
fn missing_phase_proof_denies_with_missing_fact_phase() {
    let r = record("op-1", "phase-1");
    let facts = ServiceValidatedFacts {
        phase: None,
        ..full_facts(&r.binding)
    };
    assert_eq!(
        reduce(&r.to_request(), &facts),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::Phase))
    );
}

#[test]
fn wrong_phase_proof_denies_with_binding_kind_phase() {
    // Facts bound to another operation's phase must not satisfy this operation.
    let r = record("op-1", "phase-1");
    let other = record("op-2", "phase-1");
    let facts = ServiceValidatedFacts {
        phase: Some(other.binding.phase.clone()),
        ..full_facts(&r.binding)
    };
    assert_eq!(
        reduce(&r.to_request(), &facts),
        Disposition::Denied(DenialReason::Mismatch(BindingKind::Phase))
    );
}

#[test]
fn approval_from_another_phase_is_refused() {
    let r = record("op-1", "phase-1");
    let other = record("op-2", "phase-1");
    let mut facts = full_facts(&r.binding);
    if let ApprovalOutcome::Verified(a) = &mut facts.approval {
        a.phase = other.binding.phase.clone();
    }
    assert_eq!(
        reduce(&r.to_request(), &facts),
        Disposition::Denied(DenialReason::ApprovalBindingMismatch)
    );
}

#[test]
fn facts_and_approval_from_one_operation_never_authorise_another() {
    // Cross-operation reuse with an IDENTICAL caller-chosen phase reference: op A's complete facts
    // (carrying op A's phase) are reduced against op B's record and refused, because the phases differ.
    let a = record("op-A", "phase-1");
    let b = record("op-B", "phase-1");
    assert_ne!(a.binding.phase, b.binding.phase);
    let a_facts = full_facts(&a.binding);
    assert_eq!(
        reduce(&b.to_request(), &a_facts),
        Disposition::Denied(DenialReason::Mismatch(BindingKind::Phase))
    );
}

#[test]
fn a_permit_from_one_operation_does_not_validate_another_phase() {
    let a = record("op-A", "phase-1");
    let b = record("op-B", "phase-1");
    let ctx_a = context(&a, &full_facts(&a.binding));
    let ctx_b = context(&b, &full_facts(&b.binding));
    assert_eq!(
        ctx_a.compare(&ctx_b),
        ContextComparison::Mismatch(ContextField::Phase)
    );
}

// ---- REDACTION --------------------------------------------------------------------------------

#[test]
fn phase_is_never_rendered_in_the_clear() {
    let r = record("op-1", "phase-1");
    let rendered = format!("{:?}", r.binding.phase);
    assert_eq!(rendered, "PhaseId([REDACTED])");
    // Neither the reference nor a digest leaks, even through a full binding render.
    assert!(!rendered.contains("phase-1"));
    assert!(!format!("{:?}", r.binding).contains("phase-1"));
    // The honest refusal for a wrong phase carries no raw phase reference either.
    let other = record("op-2", "phase-1");
    let facts = ServiceValidatedFacts {
        phase: Some(other.binding.phase.clone()),
        ..full_facts(&r.binding)
    };
    let refusal = format!("{:?}", reduce(&r.to_request(), &facts));
    assert!(!refusal.contains("phase-1"));
}
