//! The reducer defaults to DENIED and only yields eligibility for the complete verified context.

use projectos_host_core::{
    reduce, ApprovalOutcome, ApprovalRecordId, AuthoritySnapshot, CredentialLifecycle,
    CredentialOutcome, CredentialScope, DenialReason, Disposition, EmergencyStateRevision,
    EmergencyStopState, ExecutableIdentity, ExpiryBoundary, InstallationId,
    InternalOperationRecord, MissingFact, OperationBinding, OperationState, PolicyFloor, PolicyId,
    PolicyOutcome, PolicyRevision, PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId,
    ReplayEvidenceId, RepositoryRef, ResumePolicy, RevocationRevision, RevocationStatus,
    ServiceValidatedFacts, SessionId, ValidatedEnvironment, ValidatedExecutable,
    ValidatedFreshness, ValidatedInstallation, ValidatedProcess, ValidatedProjectContext,
    ValidatedPublisherPolicy, ValidatedRelease, ValidatedSession, ValidityStatus, VerifiedApproval,
};
use projectos_trust_contract::{
    CredentialRef, EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId,
    ProviderId,
};

pub fn binding() -> OperationBinding {
    OperationBinding {
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        provider: ProviderId::new("supabase").unwrap(),
        operation: OperationName::new("read-only-validate").unwrap(),
        fingerprint: OperationFingerprint::new("fp-1").unwrap(),
        release: ReleaseId::new("rel-1"),
    }
}

pub fn full_facts(b: &OperationBinding) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        session: Some(ValidatedSession {
            session: sid.clone(),
        }),
        process: Some(ValidatedProcess {
            session: sid.clone(),
        }),
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

pub fn record(b: &OperationBinding) -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        b.clone(),
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

fn reduce_with(b: &OperationBinding, facts: &ServiceValidatedFacts) -> Disposition {
    reduce(&record(b).to_request(), facts)
}

#[test]
fn complete_facts_are_eligible() {
    let b = binding();
    assert!(matches!(
        reduce_with(&b, &full_facts(&b)),
        Disposition::EligibleForServiceExecution(_)
    ));
}

#[test]
fn default_facts_deny() {
    let b = binding();
    assert!(matches!(
        reduce_with(&b, &ServiceValidatedFacts::default()),
        Disposition::Denied(_)
    ));
}

#[test]
fn missing_each_fact_denies() {
    let b = binding();
    let base = full_facts(&b);
    let cases: Vec<ServiceValidatedFacts> = vec![
        ServiceValidatedFacts {
            session: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            process: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            executable: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            release: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            installation: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            project: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            environment: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            publisher_policy: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            freshness: None,
            ..base.clone()
        },
        ServiceValidatedFacts {
            authority: None,
            ..base.clone()
        },
    ];
    for facts in cases {
        assert!(matches!(
            reduce_with(&b, &facts),
            Disposition::Denied(DenialReason::MissingFact(_))
        ));
    }
}

#[test]
fn missing_authority_denies() {
    let b = binding();
    let facts = ServiceValidatedFacts {
        authority: None,
        ..full_facts(&b)
    };
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::MissingFact(MissingFact::Authority))
    );
}

#[test]
fn publisher_policy_refused_denies() {
    let b = binding();
    let mut facts = full_facts(&b);
    if let Some(pp) = facts.publisher_policy.as_mut() {
        pp.outcome = PolicyOutcome::Refused;
    }
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::PublisherPolicyRefused)
    );
}

#[test]
fn expired_authority_denies() {
    let b = binding();
    let mut facts = full_facts(&b);
    if let Some(a) = facts.authority.as_mut() {
        a.validity = ValidityStatus::Expired;
    }
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::AuthorityExpired)
    );
}

#[test]
fn unknown_revocation_denies() {
    let b = binding();
    let mut facts = full_facts(&b);
    if let Some(a) = facts.authority.as_mut() {
        a.revocation = RevocationStatus::Unknown;
    }
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::RevocationUnknown)
    );
}

#[test]
fn revoked_authority_denies() {
    let b = binding();
    let mut facts = full_facts(&b);
    if let Some(a) = facts.authority.as_mut() {
        a.revocation = RevocationStatus::Revoked;
    }
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::Revoked)
    );
}

#[test]
fn unknown_or_stopped_emergency_denies() {
    let b = binding();
    let facts = ServiceValidatedFacts {
        emergency_stop: EmergencyStopState::Unknown,
        ..full_facts(&b)
    };
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::EmergencyStopUnverified)
    );
    let facts = ServiceValidatedFacts {
        emergency_stop: EmergencyStopState::Stopped,
        ..full_facts(&b)
    };
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::EmergencyStopped)
    );
}

#[test]
fn missing_credential_is_setup_required() {
    let b = binding();
    let facts = ServiceValidatedFacts {
        credential: CredentialOutcome::Missing,
        ..full_facts(&b)
    };
    assert_eq!(reduce_with(&b, &facts), Disposition::SetupRequired);
}

#[test]
fn missing_approval_is_approval_required() {
    let b = binding();
    let facts = ServiceValidatedFacts {
        approval: ApprovalOutcome::Absent,
        ..full_facts(&b)
    };
    assert_eq!(reduce_with(&b, &facts), Disposition::ApprovalRequired);
}

#[test]
fn credential_lifecycle_expired_or_revoked_denies() {
    let b = binding();
    for (lc, expected) in [
        (CredentialLifecycle::Expired, DenialReason::Expired),
        (CredentialLifecycle::Revoked, DenialReason::Revoked),
    ] {
        let mut facts = full_facts(&b);
        if let CredentialOutcome::Available(scope) = &mut facts.credential {
            scope.lifecycle = lc;
        }
        assert_eq!(reduce_with(&b, &facts), Disposition::Denied(expected));
    }
}

#[test]
fn approval_revoked_denies() {
    let b = binding();
    let mut facts = full_facts(&b);
    if let ApprovalOutcome::Verified(a) = &mut facts.approval {
        a.revocation = RevocationStatus::Revoked;
    }
    assert_eq!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::ApprovalRevoked)
    );
}

#[test]
fn binding_and_identity_mismatches_deny() {
    let b = binding();

    // Executable identity mismatch is a context change, but here we prove executable/installation
    // inconsistency denies.
    let facts = ServiceValidatedFacts {
        executable: Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-1"),
            installation: InstallationId::new("inst-9"),
        }),
        ..full_facts(&b)
    };
    assert!(matches!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::Mismatch(_))
    ));

    // Repository mismatch.
    let facts = ServiceValidatedFacts {
        project: Some(ValidatedProjectContext {
            project: b.project.clone(),
            repository: RepositoryRef::new("other-repo"),
        }),
        ..full_facts(&b)
    };
    assert!(matches!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::Mismatch(_))
    ));

    // Installation mismatch vs the record's required installation.
    let facts = ServiceValidatedFacts {
        installation: Some(ValidatedInstallation {
            installation: InstallationId::new("inst-2"),
        }),
        executable: Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-1"),
            installation: InstallationId::new("inst-2"),
        }),
        publisher_policy: Some(ValidatedPublisherPolicy {
            policy_id: PolicyId::new("pol-1"),
            policy_revision: PolicyRevision(1),
            publisher: PublisherIdentity::new("pub-1"),
            installation: InstallationId::new("inst-2"),
            outcome: PolicyOutcome::Accepted,
            revocation_revision: RevocationRevision(1),
        }),
        ..full_facts(&b)
    };
    assert!(matches!(
        reduce_with(&b, &facts),
        Disposition::Denied(DenialReason::Mismatch(_))
    ));
}

#[test]
fn permit_context_contains_all_facts() {
    let b = binding();
    match reduce_with(&b, &full_facts(&b)) {
        Disposition::EligibleForServiceExecution(permit) => {
            let c = permit.context();
            assert_eq!(c.executable().as_str(), "exe-1");
            assert_eq!(c.publisher_policy().policy_id.as_str(), "pol-1");
            assert_eq!(c.freshness().release_floor, ReleaseFloor(1));
            assert_eq!(c.authority().authority_expiry(), ExpiryBoundary(1000));
            assert_eq!(c.authority().revocation_revision(), RevocationRevision(1));
            assert_eq!(c.emergency_state(), EmergencyStopState::Clear);
            assert_eq!(c.emergency_state_revision(), EmergencyStateRevision(1));
            assert!(c.approval().is_some());
            assert!(c.credential().is_some());
        }
        other => panic!("expected eligible, got {other:?}"),
    }
}
