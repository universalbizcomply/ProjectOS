//! Fail-closed rejection matrix across DTO families.

use projectos_host_persistence::{
    AuditRecordDto, CredentialEnvelopeDto, EmergencyStopDto, OperationRecordDto, PersistError,
};

const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;
const ENVELOPE: &str = r#"{"schemaVersion":1,"recordRevision":3,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","keyVersion":1,"algorithm":"AES-256-GCM","nonce":"00112233445566778899aabb","ciphertext":"deadbeef","authTag":"aabbccddeeff00112233445566778899","associatedDataDigest":"0011","createdRevision":3,"revocation":"ACTIVE"}"#;

fn op_err(json: &str) -> PersistError {
    let parsed = OperationRecordDto::parse_json(json.as_bytes());
    match parsed {
        Err(e) => e,
        Ok(dto) => dto.validate().unwrap_err(),
    }
}
fn env_err(json: &str) -> PersistError {
    match CredentialEnvelopeDto::parse_json(json.as_bytes()) {
        Err(e) => e,
        Ok(dto) => dto.validate().unwrap_err(),
    }
}

#[test]
fn base_fixtures_parse_and_validate() {
    OperationRecordDto::parse_json(OPERATION.as_bytes())
        .unwrap()
        .validate()
        .unwrap();
    CredentialEnvelopeDto::parse_json(ENVELOPE.as_bytes())
        .unwrap()
        .validate()
        .unwrap();
}

#[test]
fn unknown_field_rejected() {
    let json = OPERATION.replace(
        "\"operationRef\":\"op-1\",",
        "\"operationRef\":\"op-1\",\"extra\":true,",
    );
    assert_eq!(op_err(&json), PersistError::Malformed);
}

#[test]
fn missing_field_rejected() {
    let json = OPERATION.replace(",\"project\":\"polygo\"", "");
    assert_eq!(op_err(&json), PersistError::Malformed);
}

#[test]
fn duplicate_field_rejected() {
    let json = OPERATION.replace(
        "\"schemaVersion\":1,",
        "\"schemaVersion\":1,\"schemaVersion\":1,",
    );
    assert_eq!(op_err(&json), PersistError::Malformed);
}

#[test]
fn old_and_zero_and_future_versions_rejected() {
    for v in ["0", "2"] {
        let json = OPERATION.replace("\"schemaVersion\":1,", &format!("\"schemaVersion\":{v},"));
        assert_eq!(op_err(&json), PersistError::UnsupportedSchema);
    }
}

#[test]
fn malformed_identifier_rejected() {
    // Whitespace / path separator in an id.
    let json = OPERATION.replace("\"project\":\"polygo\"", "\"project\":\"poly go\"");
    assert_eq!(op_err(&json), PersistError::InvalidIdentifier);
    let json = OPERATION.replace("\"project\":\"polygo\"", "\"project\":\"a/b\"");
    assert_eq!(op_err(&json), PersistError::InvalidIdentifier);
}

#[test]
fn overlong_identifier_rejected() {
    let long = "x".repeat(200);
    let json = OPERATION.replace(
        "\"operationRef\":\"op-1\"",
        &format!("\"operationRef\":\"{long}\""),
    );
    assert_eq!(op_err(&json), PersistError::InvalidIdentifier);
}

#[test]
fn zero_revision_rejected() {
    let json = OPERATION.replace("\"recordRevision\":5,", "\"recordRevision\":0,");
    assert_eq!(op_err(&json), PersistError::InvalidRevision);
}

#[test]
fn unknown_enum_variant_rejected() {
    let json = OPERATION.replace("\"READY_FOR_REVALIDATION\"", "\"DO_ANYTHING\"");
    assert_eq!(op_err(&json), PersistError::Malformed);
}

#[test]
fn revoked_without_reason_rejected() {
    let json = OPERATION.replace("\"revocation\":\"ACTIVE\"", "\"revocation\":\"REVOKED\"");
    assert_eq!(op_err(&json), PersistError::RevocationInconsistency);
}

#[test]
fn active_with_reason_rejected() {
    let json = OPERATION.replace(
        "\"revocation\":\"ACTIVE\",",
        "\"revocation\":\"ACTIVE\",\"revocationReason\":\"OWNER_REVOKED\",",
    );
    assert_eq!(op_err(&json), PersistError::RevocationInconsistency);
}

#[test]
fn duplicate_evidence_reference_rejected() {
    let json = OPERATION.replace("[\"ev-1\",\"ev-2\"]", "[\"ev-1\",\"ev-1\"]");
    assert_eq!(op_err(&json), PersistError::InvalidCollection);
}

#[test]
fn too_many_evidence_references_rejected() {
    let many: Vec<String> = (0..40).map(|i| format!("\"ev-{i}\"")).collect();
    let json = OPERATION.replace("[\"ev-1\",\"ev-2\"]", &format!("[{}]", many.join(",")));
    assert_eq!(op_err(&json), PersistError::InvalidCollection);
}

#[test]
fn envelope_malformed_hex_rejected() {
    let json = ENVELOPE.replace(
        "\"nonce\":\"00112233445566778899aabb\"",
        "\"nonce\":\"zznothex\"",
    );
    assert_eq!(env_err(&json), PersistError::InvalidHex);
}

#[test]
fn envelope_oversized_ciphertext_rejected() {
    let big = "ab".repeat(200_000); // 400_000 hex chars > MAX
    let json = ENVELOPE.replace(
        "\"ciphertext\":\"deadbeef\"",
        &format!("\"ciphertext\":\"{big}\""),
    );
    assert_eq!(env_err(&json), PersistError::InvalidHex);
}

#[test]
fn envelope_created_after_record_revision_rejected() {
    let json = ENVELOPE.replace("\"createdRevision\":3,", "\"createdRevision\":9,");
    assert_eq!(env_err(&json), PersistError::InvalidRevision);
}

#[test]
fn emergency_zero_state_revision_rejected() {
    let base = r#"{"schemaVersion":1,"recordRevision":1,"globalStop":false,"projectStops":[],"providerStops":[],"environmentStops":[],"stagingLock":false,"productionLock":true,"stateRevision":0,"ownerDecisionProvenance":"owner-decision-1"}"#;
    let e = match EmergencyStopDto::parse_json(base.as_bytes()) {
        Err(e) => e,
        Ok(d) => d.validate().unwrap_err(),
    };
    assert_eq!(e, PersistError::EmergencyInconsistency);
}

#[test]
fn audit_chain_contradiction_rejected() {
    // sequence > 0 but no prevHash.
    let base = r#"{"schemaVersion":1,"recordRevision":1,"sequence":5,"eventClass":"OPERATION_REQUESTED","evidenceRefs":[],"thisHash":"00ff","redactedSummary":"x"}"#;
    let e = match AuditRecordDto::parse_json(base.as_bytes()) {
        Err(e) => e,
        Ok(d) => d.validate().unwrap_err(),
    };
    assert_eq!(e, PersistError::InvalidChainReference);
}
