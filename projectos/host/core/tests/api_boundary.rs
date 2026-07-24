//! API-boundary + pure before-use comparison proofs.
//!
//! Honest scope (see crate docs): these prove CODEBASE-INTEGRITY properties and the pure comparison
//! operation — not operating-system security. `ExecutionPermit` has no public constructor and no
//! `Serialize`/`Deserialize`; `VerifiedExecutionContext` has neither; neither appears in the shared
//! `projectos-trust-contract` wire crate. No cryptographic non-forgeability is claimed.

use projectos_host_core::{
    reduce, ApprovalOutcome, ApprovalRecordId, AuthoritySnapshot, CollectedObservations,
    ContextComparison, ContextField, CredentialAvailabilityObservation, CredentialLifecycle,
    CredentialObservation, CredentialOutcome, CredentialScope, Disposition, EmergencyStateRevision,
    EmergencyStopState, ExecutableIdentity, ExpiryBoundary, InstallationId,
    InternalOperationRecord, OperationBinding, OperationInputs, OperationState, PhaseReference,
    PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision, ProcessObservation, PublisherIdentity,
    RecordPolicy, ReleaseFloor, ReleaseId, ReplayEvidenceId, ReportedAvailability, RepositoryRef,
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

// The authoritative binding is only ever produced by the operation-creation authority (which mints the
// phase); tests read it back from a record rather than fabricating a phase.
fn binding() -> OperationBinding {
    record().binding.clone()
}

fn full_facts() -> ServiceValidatedFacts {
    let b = binding();
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(b.phase.clone()),
        approved_plan: None,
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

fn record() -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        inputs(),
        &PhaseReference::new("phase-1").unwrap(),
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

fn ctx(facts: &ServiceValidatedFacts) -> VerifiedExecutionContext {
    match reduce(&record().to_request(), facts) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    }
}

/// Vary one aspect of a full, valid fact set and return the resulting (still-eligible) context.
fn varied_ctx(mutate: impl FnOnce(&mut ServiceValidatedFacts)) -> VerifiedExecutionContext {
    let mut facts = full_facts();
    mutate(&mut facts);
    ctx(&facts)
}

fn baseline() -> VerifiedExecutionContext {
    ctx(&full_facts())
}

// ---- API boundary --------------------------------------------------------------------------------

#[test]
fn permit_is_obtainable_only_from_the_reducer() {
    match reduce(&record().to_request(), &full_facts()) {
        Disposition::EligibleForServiceExecution(permit) => {
            assert_eq!(permit.operation_ref().as_str(), "op-1");
            assert_eq!(permit.context().executable().as_str(), "exe-1");
        }
        other => panic!("expected a permit, got {other:?}"),
    }
}

#[test]
fn operation_ref_alone_yields_no_eligibility() {
    let d = reduce(&record().to_request(), &ServiceValidatedFacts::default());
    assert!(!matches!(d, Disposition::EligibleForServiceExecution(_)));
}

#[test]
fn incomplete_facts_never_yield_a_permit() {
    let facts = ServiceValidatedFacts {
        session: None,
        ..full_facts()
    };
    assert!(!matches!(
        reduce(&record().to_request(), &facts),
        Disposition::EligibleForServiceExecution(_)
    ));
}

// ---- pure before-use comparison ------------------------------------------------------------------

#[test]
fn context_matches_itself() {
    let c = baseline();
    assert_eq!(c.compare(&c), ContextComparison::Match);
    assert!(c.compare(&c).is_match());
}

fn assert_mismatch(current: VerifiedExecutionContext, field: ContextField) {
    assert_eq!(
        baseline().compare(&current),
        ContextComparison::Mismatch(field)
    );
}

#[test]
fn executable_change_is_detected() {
    let c = varied_ctx(|f| {
        f.executable = Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-2"),
            installation: InstallationId::new("inst-1"),
        });
    });
    assert_mismatch(c, ContextField::Executable);
}

#[test]
fn publisher_policy_revision_and_revocation_changes_are_detected() {
    let c =
        varied_ctx(|f| f.publisher_policy.as_mut().unwrap().policy_revision = PolicyRevision(2));
    assert_mismatch(c, ContextField::PublisherPolicy);

    let c = varied_ctx(|f| {
        f.publisher_policy.as_mut().unwrap().revocation_revision = RevocationRevision(2)
    });
    assert_mismatch(c, ContextField::PublisherPolicy);
}

#[test]
fn freshness_floor_and_revision_changes_are_detected() {
    let c = varied_ctx(|f| f.freshness.as_mut().unwrap().release_floor = ReleaseFloor(2));
    assert_mismatch(c, ContextField::Freshness);

    let c = varied_ctx(|f| f.freshness.as_mut().unwrap().policy_floor = PolicyFloor(2));
    assert_mismatch(c, ContextField::Freshness);

    let c = varied_ctx(|f| f.freshness.as_mut().unwrap().policy_revision = PolicyRevision(2));
    assert_mismatch(c, ContextField::Freshness);
}

#[test]
fn authority_expiry_and_revocation_changes_are_detected() {
    let c = varied_ctx(|f| f.authority.as_mut().unwrap().authority_expiry = ExpiryBoundary(2000));
    assert_mismatch(c, ContextField::Authority);

    let c = varied_ctx(|f| {
        f.authority.as_mut().unwrap().revocation = RevocationStatus::Active(RevocationRevision(2))
    });
    assert_mismatch(c, ContextField::Authority);
}

#[test]
fn emergency_state_revision_change_is_detected() {
    let c = varied_ctx(|f| {
        f.authority.as_mut().unwrap().emergency_state_revision = EmergencyStateRevision(2)
    });
    assert_mismatch(c, ContextField::EmergencyStateRevision);
}

#[test]
fn approval_expiry_and_revocation_changes_are_detected() {
    let c = varied_ctx(|f| {
        if let ApprovalOutcome::Verified(a) = &mut f.approval {
            a.expiry = ExpiryBoundary(2000);
        }
    });
    assert_mismatch(c, ContextField::Approval);

    let c = varied_ctx(|f| {
        if let ApprovalOutcome::Verified(a) = &mut f.approval {
            a.revocation = RevocationStatus::Active(RevocationRevision(2));
        }
    });
    assert_mismatch(c, ContextField::Approval);
}

#[test]
fn credential_expiry_and_revocation_changes_are_detected() {
    let c = varied_ctx(|f| {
        if let CredentialOutcome::Available(s) = &mut f.credential {
            s.expiry = ExpiryBoundary(2000);
        }
    });
    assert_mismatch(c, ContextField::Credential);

    let c = varied_ctx(|f| {
        if let CredentialOutcome::Available(s) = &mut f.credential {
            s.revocation_revision = RevocationRevision(2);
        }
    });
    assert_mismatch(c, ContextField::Credential);
}

// ---- typed observations --------------------------------------------------------------------------

#[test]
fn observations_are_typed_metadata_only() {
    let cred = CredentialObservation {
        credential: CredentialRef::new("cred-1").unwrap(),
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        provider: ProviderId::new("supabase").unwrap(),
        required_operation: OperationName::new("op").unwrap(),
        availability: ReportedAvailability::Present,
    };
    let obs = CollectedObservations {
        process: ProcessObservation::Reported {
            pid: 1234,
            creation_tick: 42,
        },
        credential: CredentialAvailabilityObservation::Reported(cred),
        ..CollectedObservations::default()
    };
    assert!(matches!(
        obs.process,
        ProcessObservation::Reported { pid: 1234, .. }
    ));
    match &obs.credential {
        CredentialAvailabilityObservation::Reported(c) => {
            assert_eq!(c.credential.as_str(), "cred-1");
            assert_eq!(c.availability, ReportedAvailability::Present);
        }
        CredentialAvailabilityObservation::NotCollected => panic!("expected reported credential"),
    }
}
