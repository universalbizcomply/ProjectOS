//! Fail-closed proofs for the tagged v2 request/response model: schema v2 discipline, kind/status
//! specific fields, forbidden fields, contradictory combinations, and the durable SETUP_REQUIRED
//! reference.

use projectos_trust_contract::{ContractError, RequestEnvelope, ResponseEnvelope, SchemaVersion};

// ---- request fixtures (schema v2) ----------------------------------------------------------------

const PROTECTED_OK: &str = r#"{
  "schemaVersion": 2,
  "requestId": "req-1",
  "request": {
    "kind": "PROTECTED_OPERATION",
    "payload": {
      "requestedProject": "proj-alpha",
      "requestedEnvironment": "staging",
      "requestedProvider": "supabase",
      "requestedOperation": "read-only-validate",
      "operationFingerprint": "fp-0001"
    }
  }
}"#;

const OPERATION_STATUS_OK: &str = r#"{
  "schemaVersion": 2,
  "requestId": "req-2",
  "request": { "kind": "OPERATION_STATUS", "payload": { "operationReference": "op-1" } }
}"#;

const CREDENTIAL_SETUP_OK: &str = r#"{
  "schemaVersion": 2,
  "requestId": "req-3",
  "request": {
    "kind": "CREDENTIAL_SETUP_STATUS",
    "payload": {
      "requestedProject": "proj-alpha",
      "requestedEnvironment": "staging",
      "requestedProvider": "supabase",
      "credentialReference": "cred-1"
    }
  }
}"#;

fn req_err(json: &str) -> ContractError {
    RequestEnvelope::parse_json(json.as_bytes()).unwrap_err()
}
fn resp_err(json: &str) -> ContractError {
    ResponseEnvelope::parse_json(json.as_bytes()).unwrap_err()
}

// ---- schema version discipline -------------------------------------------------------------------

#[test]
fn valid_v2_requests_parse() {
    RequestEnvelope::parse_json(PROTECTED_OK.as_bytes()).unwrap();
    RequestEnvelope::parse_json(OPERATION_STATUS_OK.as_bytes()).unwrap();
    RequestEnvelope::parse_json(CREDENTIAL_SETUP_OK.as_bytes()).unwrap();
}

#[test]
fn version_one_rejected() {
    let json = PROTECTED_OK.replace("\"schemaVersion\": 2", "\"schemaVersion\": 1");
    assert_eq!(req_err(&json), ContractError::UnsupportedSchema);
}

#[test]
fn version_three_rejected() {
    let json = PROTECTED_OK.replace("\"schemaVersion\": 2", "\"schemaVersion\": 3");
    assert_eq!(req_err(&json), ContractError::UnsupportedSchema);
}

#[test]
fn schema_require_supported_rejects_other_versions() {
    assert_eq!(
        SchemaVersion(1).require_supported(),
        Err(ContractError::UnsupportedSchema)
    );
    assert_eq!(
        SchemaVersion(999).require_supported(),
        Err(ContractError::UnsupportedSchema)
    );
}

// ---- requests ------------------------------------------------------------------------------------

#[test]
fn protected_operation_rejects_operation_reference() {
    let json = PROTECTED_OK.replace(
        "\"operationFingerprint\": \"fp-0001\"",
        "\"operationFingerprint\": \"fp-0001\",\n      \"operationReference\": \"op-1\"",
    );
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn operation_status_requires_operation_reference() {
    let json = OPERATION_STATUS_OK.replace("\"operationReference\": \"op-1\"", "");
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn operation_status_rejects_protected_context_fields() {
    let json = OPERATION_STATUS_OK.replace(
        "\"operationReference\": \"op-1\"",
        "\"operationReference\": \"op-1\", \"requestedProject\": \"proj-alpha\"",
    );
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn credential_setup_requires_all_fields() {
    let json = CREDENTIAL_SETUP_OK.replace("\"requestedProvider\": \"supabase\",\n", "");
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn credential_setup_rejects_raw_credential() {
    let json = CREDENTIAL_SETUP_OK.replace(
        "\"credentialReference\": \"cred-1\"",
        "\"credentialReference\": \"cred-1\", \"password\": \"hunter2\"",
    );
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn credential_setup_rejects_owner_approved() {
    let json = CREDENTIAL_SETUP_OK.replace(
        "\"credentialReference\": \"cred-1\"",
        "\"credentialReference\": \"cred-1\", \"ownerApproved\": true",
    );
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn unknown_request_kind_fails_closed() {
    let json = PROTECTED_OK.replace("\"PROTECTED_OPERATION\"", "\"DO_EVERYTHING\"");
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn unknown_top_level_request_field_fails_closed() {
    let json = PROTECTED_OK.replace(
        "\"requestId\": \"req-1\",",
        "\"requestId\": \"req-1\", \"extra\": true,",
    );
    assert_eq!(req_err(&json), ContractError::MalformedRequest);
}

#[test]
fn malformed_identifier_rejected() {
    let json = PROTECTED_OK.replace("\"proj-alpha\"", "\"proj alpha\"");
    assert_eq!(req_err(&json), ContractError::InvalidIdentifier);
}

// ---- responses -----------------------------------------------------------------------------------

fn resp(status: &str, detail: &str) -> String {
    format!(
        "{{ \"schemaVersion\": 2, \"requestId\": \"r\", \"response\": {{ \"status\": \"{status}\", \"detail\": {detail} }} }}"
    )
}

const EVIDENCE_OK: &str = "{ \"evidenceRef\": \"ev\", \"status\": \"COMPLETED\", \"sequence\": 1, \"digest\": \"00ff\", \"redactedSummary\": \"x\", \"decisionNeeded\": \"NONE\" }";

#[test]
fn denied_requires_error() {
    assert_eq!(
        resp_err(&resp("DENIED", "{}")),
        ContractError::MalformedRequest
    );
}

#[test]
fn denied_rejects_operation_reference() {
    let json = resp(
        "DENIED",
        "{ \"error\": \"OPERATION_NOT_ALLOWED\", \"operationReference\": \"op-1\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn denied_rejects_evidence() {
    let json = resp(
        "DENIED",
        &format!("{{ \"error\": \"OPERATION_NOT_ALLOWED\", \"evidence\": {EVIDENCE_OK} }}"),
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn setup_required_valid_with_durable_reference() {
    let json = resp(
        "SETUP_REQUIRED",
        "{ \"operationReference\": \"op-blocked\", \"error\": \"CREDENTIAL_MISSING\", \"decisionNeeded\": \"CREDENTIAL_SETUP\" }",
    );
    ResponseEnvelope::parse_json(json.as_bytes()).unwrap();
}

#[test]
fn setup_required_requires_operation_reference() {
    let json = resp(
        "SETUP_REQUIRED",
        "{ \"error\": \"CREDENTIAL_MISSING\", \"decisionNeeded\": \"CREDENTIAL_SETUP\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn setup_required_malformed_reference_rejected() {
    let json = resp(
        "SETUP_REQUIRED",
        "{ \"operationReference\": \"op blocked\", \"error\": \"CREDENTIAL_MISSING\", \"decisionNeeded\": \"CREDENTIAL_SETUP\" }",
    );
    assert_eq!(resp_err(&json), ContractError::InvalidIdentifier);
}

#[test]
fn setup_required_rejects_evidence() {
    let json = resp(
        "SETUP_REQUIRED",
        &format!("{{ \"operationReference\": \"op-blocked\", \"error\": \"CREDENTIAL_MISSING\", \"decisionNeeded\": \"CREDENTIAL_SETUP\", \"evidence\": {EVIDENCE_OK} }}"),
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn setup_required_wrong_decision_needed_rejected() {
    let json = resp(
        "SETUP_REQUIRED",
        "{ \"operationReference\": \"op-blocked\", \"error\": \"CREDENTIAL_MISSING\", \"decisionNeeded\": \"OWNER_APPROVAL\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn approval_required_requires_operation_reference() {
    let json = resp(
        "APPROVAL_REQUIRED",
        "{ \"decisionNeeded\": \"OWNER_APPROVAL\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn approval_required_wrong_decision_needed_rejected() {
    let json = resp(
        "APPROVAL_REQUIRED",
        "{ \"operationReference\": \"op-1\", \"decisionNeeded\": \"NONE\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn accepted_requires_operation_reference() {
    assert_eq!(
        resp_err(&resp("ACCEPTED_FOR_PROCESSING", "{}")),
        ContractError::MalformedRequest
    );
}

#[test]
fn accepted_rejects_error_and_evidence() {
    let json = resp(
        "ACCEPTED_FOR_PROCESSING",
        "{ \"operationReference\": \"op-1\", \"error\": \"INTERNAL_REFUSAL\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn completed_requires_reference_and_evidence() {
    let json = resp("COMPLETED", "{ \"operationReference\": \"op-1\" }");
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn completed_rejects_error() {
    let json = resp(
        "COMPLETED",
        &format!("{{ \"operationReference\": \"op-1\", \"error\": \"INTERNAL_REFUSAL\", \"evidence\": {EVIDENCE_OK} }}"),
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn completed_with_mismatched_evidence_status_rejected() {
    let json = resp(
        "COMPLETED",
        "{ \"operationReference\": \"op-1\", \"evidence\": { \"evidenceRef\": \"ev\", \"status\": \"FAILED\", \"sequence\": 1, \"digest\": \"00ff\", \"redactedSummary\": \"x\", \"decisionNeeded\": \"NONE\" } }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn failed_requires_error() {
    assert_eq!(
        resp_err(&resp("FAILED", "{}")),
        ContractError::MalformedRequest
    );
}

#[test]
fn failed_evidence_may_not_claim_completion() {
    let json = resp(
        "FAILED",
        &format!("{{ \"error\": \"SERVICE_UNAVAILABLE\", \"evidence\": {EVIDENCE_OK} }}"),
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn unknown_response_state_fails_closed() {
    assert_eq!(
        resp_err(&resp("GRANT_ALL", "{}")),
        ContractError::MalformedRequest
    );
}

#[test]
fn unknown_response_field_fails_closed() {
    let json = resp(
        "DENIED",
        "{ \"error\": \"OPERATION_NOT_ALLOWED\", \"rawOutput\": \"leak\" }",
    );
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

#[test]
fn service_unverified_is_not_a_wire_error() {
    // SERVICE_UNVERIFIED belongs to a future client transport error model, NOT ContractError.
    let json = resp("DENIED", "{ \"error\": \"SERVICE_UNVERIFIED\" }");
    assert_eq!(resp_err(&json), ContractError::MalformedRequest);
}

// ---- general -------------------------------------------------------------------------------------

#[test]
fn serialized_field_names_are_stable() {
    assert!(PROTECTED_OK.contains("schemaVersion"));
    assert!(PROTECTED_OK.contains("requestedProject"));
    assert!(PROTECTED_OK.contains("operationFingerprint"));
    let parsed = RequestEnvelope::parse_json(PROTECTED_OK.as_bytes()).unwrap();
    let out = parsed.to_json().unwrap();
    for key in ["schemaVersion", "requestId", "request", "kind", "payload"] {
        assert!(out.contains(key), "missing key {key}");
    }
}
