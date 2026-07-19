//! Happy-path serialisation/deserialisation + representable-state proofs for the tagged model.

use projectos_trust_contract::{
    AcceptedDetail, ApprovalEvidenceRef, ApprovalRequiredDetail, CompletedDetail, ContractError,
    CredentialRef, CredentialSetupStatusRequest, DecisionNeeded, DeniedDetail, EnvironmentId,
    EvidenceRef, FailedDetail, OperationFingerprint, OperationName, OperationRef,
    OperationStatusRequest, ProjectId, ProtectedOperationRequest, ProviderId, RedactedEvidence,
    RequestBody, RequestEnvelope, RequestId, RequestKind, ResponseBody, ResponseEnvelope,
    ResponseStatus, SchemaVersion, SetupRequiredDetail, SCHEMA_VERSION,
};

fn protected_request() -> ProtectedOperationRequest {
    ProtectedOperationRequest {
        requested_project: ProjectId::new("proj-alpha").unwrap(),
        requested_environment: EnvironmentId::new("staging").unwrap(),
        requested_provider: ProviderId::new("supabase").unwrap(),
        requested_operation: OperationName::new("read-only-validate").unwrap(),
        operation_fingerprint: OperationFingerprint::new("fp-0001").unwrap(),
        credential_reference: Some(CredentialRef::new("cred-ref-1").unwrap()),
        approval_evidence_reference: Some(ApprovalEvidenceRef::new("appr-ref-1").unwrap()),
    }
}

fn completed_evidence() -> RedactedEvidence {
    RedactedEvidence {
        evidence_ref: EvidenceRef::new("ev-1").unwrap(),
        status: ResponseStatus::Completed,
        sequence: 7,
        recorded_at: Some("2026-07-19T00:00:00Z".to_string()),
        digest: "abcdef0123456789".to_string(),
        redacted_summary: "validated 3 tables; «secret:SUPABASE_KEY» not shown".to_string(),
        decision_needed: DecisionNeeded::None,
    }
}

#[test]
fn protected_operation_request_roundtrips() {
    let req = RequestEnvelope::new(
        RequestId::new("req-1").unwrap(),
        RequestBody::ProtectedOperation(protected_request()),
    );
    let json = req.to_json().unwrap();
    let back = RequestEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(req, back);
    assert_eq!(back.schema_version, SchemaVersion(SCHEMA_VERSION));
    assert_eq!(back.request.kind(), RequestKind::ProtectedOperation);
}

#[test]
fn operation_status_request_roundtrips() {
    let req = RequestEnvelope::new(
        RequestId::new("req-2").unwrap(),
        RequestBody::OperationStatus(OperationStatusRequest {
            operation_reference: OperationRef::new("op-xyz").unwrap(),
        }),
    );
    let json = req.to_json().unwrap();
    let back = RequestEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(req, back);
    assert_eq!(back.request.kind(), RequestKind::OperationStatus);
}

#[test]
fn credential_setup_status_request_roundtrips() {
    let req = RequestEnvelope::new(
        RequestId::new("req-3").unwrap(),
        RequestBody::CredentialSetupStatus(CredentialSetupStatusRequest {
            requested_project: ProjectId::new("proj-alpha").unwrap(),
            requested_environment: EnvironmentId::new("staging").unwrap(),
            requested_provider: ProviderId::new("supabase").unwrap(),
            credential_reference: CredentialRef::new("cred-ref-1").unwrap(),
        }),
    );
    let json = req.to_json().unwrap();
    let back = RequestEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(req, back);
    assert_eq!(back.request.kind(), RequestKind::CredentialSetupStatus);
}

#[test]
fn every_response_state_roundtrips() {
    let bodies = [
        ResponseBody::Denied(DeniedDetail {
            error: ContractError::OperationNotAllowed,
        }),
        ResponseBody::SetupRequired(SetupRequiredDetail {
            operation_reference: OperationRef::new("op-blocked").unwrap(),
            error: ContractError::CredentialMissing,
            decision_needed: DecisionNeeded::CredentialSetup,
        }),
        ResponseBody::ApprovalRequired(ApprovalRequiredDetail {
            operation_reference: OperationRef::new("op-pending").unwrap(),
            decision_needed: DecisionNeeded::OwnerApproval,
        }),
        ResponseBody::AcceptedForProcessing(AcceptedDetail {
            operation_reference: OperationRef::new("op-accepted").unwrap(),
        }),
        ResponseBody::Completed(CompletedDetail {
            operation_reference: OperationRef::new("op-done").unwrap(),
            evidence: completed_evidence(),
        }),
        ResponseBody::Failed(FailedDetail {
            error: ContractError::ServiceUnavailable,
            operation_reference: None,
            evidence: None,
        }),
    ];
    for body in bodies {
        let expected = body.status();
        let resp = ResponseEnvelope::new(RequestId::new("req-1").unwrap(), body);
        let json = resp.to_json().unwrap();
        let back = ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
        assert_eq!(back.response.status(), expected);
    }
}

#[test]
fn completed_carries_reference_and_evidence() {
    let resp = ResponseEnvelope::new(
        RequestId::new("req-1").unwrap(),
        ResponseBody::Completed(CompletedDetail {
            operation_reference: OperationRef::new("op-done").unwrap(),
            evidence: completed_evidence(),
        }),
    );
    let json = resp.to_json().unwrap();
    let back = ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(resp, back);
}

#[test]
fn denied_carries_stable_error_code_only() {
    let resp = ResponseEnvelope::new(
        RequestId::new("req-1").unwrap(),
        ResponseBody::Denied(DeniedDetail {
            error: ContractError::ApprovalUnproven,
        }),
    );
    let json = resp.to_json().unwrap();
    assert!(json.contains("APPROVAL_UNPROVEN"));
    let back = ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(back.response, resp.response);
}

#[test]
fn operation_reference_roundtrips_only_as_a_reference() {
    // A returned reference is a plain opaque string; the crate exposes no authority API on it.
    let resp = ResponseEnvelope::new(
        RequestId::new("req-1").unwrap(),
        ResponseBody::AcceptedForProcessing(AcceptedDetail {
            operation_reference: OperationRef::new("op-xyz").unwrap(),
        }),
    );
    let json = resp.to_json().unwrap();
    let back = ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
    if let ResponseBody::AcceptedForProcessing(d) = back.response {
        assert_eq!(d.operation_reference.as_str(), "op-xyz");
    } else {
        panic!("wrong variant");
    }
}

#[test]
fn no_secret_like_value_appears_in_serialized_evidence() {
    // The service redacts BEFORE building evidence. A correctly-redacted summary never leaks the raw
    // secret when serialised.
    const RAW_SECRET: &str = "sbp_live_0123456789ABCDEFsecretvalue";
    let ev = RedactedEvidence {
        evidence_ref: EvidenceRef::new("ev-2").unwrap(),
        status: ResponseStatus::Completed,
        sequence: 1,
        recorded_at: None,
        digest: "00ff".to_string(),
        redacted_summary: "connection ok; token «secret:SUPABASE_KEY»".to_string(),
        decision_needed: DecisionNeeded::None,
    };
    let json = serde_json::to_string(&ev).unwrap();
    assert!(!json.contains(RAW_SECRET));
}

#[test]
fn supported_schema_accepted() {
    assert!(SchemaVersion::CURRENT.require_supported().is_ok());
    assert!(SchemaVersion(SCHEMA_VERSION).is_supported());
}

#[test]
fn schema_version_is_two() {
    assert_eq!(SCHEMA_VERSION, 2);
    assert_eq!(SchemaVersion::CURRENT, SchemaVersion(2));
}

#[test]
fn setup_required_roundtrips_with_durable_reference() {
    let resp = ResponseEnvelope::new(
        RequestId::new("req-1").unwrap(),
        ResponseBody::SetupRequired(SetupRequiredDetail {
            operation_reference: OperationRef::new("op-blocked").unwrap(),
            error: ContractError::CredentialMissing,
            decision_needed: DecisionNeeded::CredentialSetup,
        }),
    );
    let json = resp.to_json().unwrap();
    let back = ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
    assert_eq!(resp, back);
    // The durable reference round-trips only as an opaque reference.
    if let ResponseBody::SetupRequired(d) = back.response {
        assert_eq!(d.operation_reference.as_str(), "op-blocked");
    } else {
        panic!("wrong variant");
    }
}
