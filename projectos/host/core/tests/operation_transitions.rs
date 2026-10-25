//! Operation state-machine proofs: allowed transitions succeed, prohibited fail closed, terminals do
//! not reactivate, and a durable reference never bypasses revalidation.

use projectos_host_core::{
    reduce, Disposition, EvidenceRef, EvidenceReferences, ExpiryBoundary, InstallationId,
    InternalOperationRecord, OperationInputs, OperationState, PhaseReference, RecordError,
    RecordPolicy, ReleaseId, RepositoryRef, ResumePolicy, RevocationReason, RevocationRevision,
    RevocationStatus, ServiceValidatedFacts, MAX_EVIDENCE_REFS,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

fn fresh_record() -> InternalOperationRecord {
    InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        inputs(),
        &PhaseReference::new("phase-1").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
}

use OperationState::{
    ApprovalRequired, Completed, Created, EligibleForExecution, Executing, Expired, Failed,
    NeedsRevalidation, ReadyForRevalidation, Revoked, SetupRequired,
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

#[test]
fn approved_transitions_succeed() {
    let approved = [
        (Created, SetupRequired),
        (Created, ApprovalRequired),
        (Created, ReadyForRevalidation),
        (SetupRequired, ReadyForRevalidation),
        (ApprovalRequired, ReadyForRevalidation),
        (ReadyForRevalidation, EligibleForExecution),
        (EligibleForExecution, Executing),
        (Executing, Completed),
        (Executing, Failed),
        (Executing, NeedsRevalidation),
        (NeedsRevalidation, ReadyForRevalidation),
        (Created, Revoked),
        (Executing, Expired),
    ];
    for (from, to) in approved {
        assert!(
            from.can_transition_to(to),
            "{from:?} -> {to:?} should be allowed"
        );
        assert_eq!(from.transition(to).unwrap(), to);
    }
}

#[test]
fn prohibited_transitions_fail_closed() {
    let prohibited = [
        (Completed, Executing),
        (Failed, Executing),
        (Revoked, ReadyForRevalidation),
        (Expired, ReadyForRevalidation),
        (SetupRequired, Executing),
        (ApprovalRequired, Executing),
        (NeedsRevalidation, Executing),
        (Created, Executing),
        (ReadyForRevalidation, Completed),
    ];
    for (from, to) in prohibited {
        assert!(
            !from.can_transition_to(to),
            "{from:?} -> {to:?} should be prohibited"
        );
        assert!(from.transition(to).is_err());
    }
}

#[test]
fn terminal_states_cannot_reactivate() {
    for terminal in [Completed, Failed, Revoked, Expired] {
        assert!(terminal.is_terminal());
        for active in [
            Created,
            ReadyForRevalidation,
            EligibleForExecution,
            Executing,
        ] {
            assert!(
                terminal.transition(active).is_err(),
                "{terminal:?} must not reactivate"
            );
        }
    }
}

#[test]
fn uncertain_execution_moves_to_needs_revalidation() {
    assert_eq!(
        Executing.transition(NeedsRevalidation).unwrap(),
        NeedsRevalidation
    );
    // And NeedsRevalidation cannot jump straight back to Executing.
    assert!(NeedsRevalidation.transition(Executing).is_err());
}

#[test]
fn record_advance_is_fail_closed() {
    let mut r = fresh_record();
    assert_eq!(r.state, Created);
    r.advance(ReadyForRevalidation).unwrap();
    r.advance(EligibleForExecution).unwrap();
    // Illegal jump refused; state unchanged.
    assert!(r.advance(Completed).is_err());
    assert_eq!(r.state, EligibleForExecution);
}

#[test]
fn durable_reference_does_not_bypass_revalidation() {
    // A record in NeedsRevalidation must be revalidated regardless of the facts presented.
    let mut r = fresh_record();
    r.state = NeedsRevalidation;
    assert_eq!(
        reduce(&r.to_request(), &ServiceValidatedFacts::default()),
        Disposition::RevalidationRequired
    );
}

#[test]
fn durable_record_preserves_repository_and_installation_identity() {
    let r = fresh_record();
    assert_eq!(r.repository.as_str(), "repo-1");
    assert_eq!(r.required_installation.as_str(), "inst-1");
    // These identities are explicit on the record, not hidden inside the generic binding.
    let req = r.to_request();
    assert_eq!(req.repository.as_str(), "repo-1");
    assert_eq!(req.required_installation.as_str(), "inst-1");
}

#[test]
fn record_preserves_expiry_and_revocation_metadata_beyond_terminal_state() {
    let mut r = fresh_record();
    assert_eq!(r.operation_expiry, ExpiryBoundary(1000));
    assert_eq!(
        r.revocation,
        RevocationStatus::Active(RevocationRevision(0))
    );
    assert!(r.revocation_reason.is_none());
    r.validate().unwrap(); // active + no reason = consistent

    // Revoke with a typed reason from a non-terminal state; metadata persists past the terminal state.
    r.advance(ReadyForRevalidation).unwrap();
    r.revoke(RevocationReason::OwnerRevoked).unwrap();
    assert_eq!(r.state, Revoked);
    assert_eq!(r.revocation, RevocationStatus::Revoked);
    assert_eq!(r.revocation_reason, Some(RevocationReason::OwnerRevoked));
    assert_eq!(r.operation_expiry, ExpiryBoundary(1000));
    r.validate().unwrap(); // revoked + reason = consistent
}

#[test]
fn revocation_reason_consistency_is_enforced() {
    // Active + reason → invalid.
    let mut r = fresh_record();
    r.revocation_reason = Some(RevocationReason::OwnerRevoked);
    assert_eq!(r.validate(), Err(RecordError::RevocationReasonUnexpected));

    // Revoked + no reason → invalid.
    let mut r = fresh_record();
    r.revocation = RevocationStatus::Revoked;
    r.revocation_reason = None;
    assert_eq!(r.validate(), Err(RecordError::RevocationReasonMissing));

    // Revoked + reason → valid.
    let mut r = fresh_record();
    r.revocation = RevocationStatus::Revoked;
    r.revocation_reason = Some(RevocationReason::SecurityIncident);
    assert!(r.validate().is_ok());
}

#[test]
fn evidence_ref_syntax_is_bounded() {
    assert!(EvidenceRef::new("ev-1").is_ok());
    assert_eq!(EvidenceRef::new(""), Err(RecordError::EmptyIdentifier));
    assert_eq!(
        EvidenceRef::new("x".repeat(200)),
        Err(RecordError::IdentifierTooLong)
    );
    // Path separators / URLs / whitespace / control are rejected.
    assert_eq!(EvidenceRef::new("a/b"), Err(RecordError::IllegalCharacter));
    assert_eq!(
        EvidenceRef::new("https://user:pass@host/x"),
        Err(RecordError::IllegalCharacter)
    );
    assert_eq!(
        EvidenceRef::new("C:\\secret"),
        Err(RecordError::IllegalCharacter)
    );
    assert_eq!(EvidenceRef::new("a b"), Err(RecordError::IllegalCharacter));
}

#[test]
fn evidence_references_are_count_bounded_and_deduplicated() {
    let mut refs = EvidenceReferences::new();
    assert!(refs.is_empty());
    for i in 0..MAX_EVIDENCE_REFS {
        refs.push(EvidenceRef::new(format!("ev-{i}")).unwrap())
            .unwrap();
    }
    assert_eq!(refs.len(), MAX_EVIDENCE_REFS);
    // Over-limit is rejected.
    assert_eq!(
        refs.push(EvidenceRef::new("ev-overflow").unwrap()),
        Err(RecordError::TooManyEvidenceReferences)
    );
    // Duplicate is rejected deterministically.
    let mut two = EvidenceReferences::new();
    two.push(EvidenceRef::new("ev-a").unwrap()).unwrap();
    assert_eq!(
        two.push(EvidenceRef::new("ev-a").unwrap()),
        Err(RecordError::DuplicateEvidenceReference)
    );
}
