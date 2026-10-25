//! Authority- and secret-exclusion proofs: injected authority/plaintext fields fail strict parsing,
//! copied references carry no authority, and validation errors never echo injected values.

use projectos_host_persistence::{CredentialMetadataDto, OperationRecordDto, PersistError};

const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1"]}"#;
const METADATA: &str = r#"{"schemaVersion":1,"recordRevision":2,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","permittedOperations":["read-only-validate"],"lifecycle":"ACTIVE","expiry":1000,"revocationRevision":1,"rotationRequired":false,"lastValidatedRevision":1}"#;

fn op_parse(json: &str) -> Result<OperationRecordDto, PersistError> {
    OperationRecordDto::parse_json(json.as_bytes())
}

#[test]
fn injected_authority_fields_are_rejected() {
    for inject in [
        "\"executionPermit\":\"x\"",
        "\"authenticatedSession\":\"x\"",
        "\"credentialLease\":\"x\"",
        "\"protectedEligibility\":\"ENABLED\"",
    ] {
        let json = OPERATION.replace(
            "\"operationRef\":\"op-1\",",
            &format!("\"operationRef\":\"op-1\",{inject},"),
        );
        assert_eq!(
            op_parse(&json),
            Err(PersistError::Malformed),
            "should reject {inject}"
        );
    }
}

#[test]
fn injected_secret_fields_are_rejected() {
    for inject in [
        "\"secret\":\"sbp_live_abc\"",
        "\"plaintext\":\"sbp_live_abc\"",
        "\"password\":\"hunter2\"",
        "\"token\":\"ghp_abc\"",
        "\"privateKey\":\"-----BEGIN\"",
    ] {
        let json = METADATA.replace(
            "\"credentialRef\":\"cred-1\",",
            &format!("\"credentialRef\":\"cred-1\",{inject},"),
        );
        assert_eq!(
            CredentialMetadataDto::parse_json(json.as_bytes()),
            Err(PersistError::Malformed),
            "should reject {inject}"
        );
    }
}

#[test]
fn copied_operation_ref_is_data_only() {
    // Two records with the same operationRef but different project bindings are just data; the DTO
    // exposes no ExecutionPermit/session/lease — there is no authority API on it at all.
    let a = op_parse(OPERATION).unwrap();
    let b_json = OPERATION.replace("\"project\":\"polygo\"", "\"project\":\"jdtesting\"");
    let b = op_parse(&b_json).unwrap();
    a.validate().unwrap();
    b.validate().unwrap();
    assert_eq!(a.operation_ref, b.operation_ref);
    assert_ne!(a.project, b.project);
    // Possession of a matching operationRef grants nothing: no permit/session/lease type exists here.
}

#[test]
fn validation_error_does_not_echo_injected_value() {
    // A rejected malformed record must surface only a coarse error, never the injected secret-like
    // value. `PersistError` is a fieldless enum, so it structurally cannot carry the value.
    let secret = "sbp_live_super_secret_value_1234567890";
    let json = METADATA.replace(
        "\"credentialRef\":\"cred-1\",",
        &format!("\"credentialRef\":\"cred-1\",\"secret\":\"{secret}\","),
    );
    let err = CredentialMetadataDto::parse_json(json.as_bytes()).unwrap_err();
    assert_eq!(err, PersistError::Malformed);
    let rendered = format!("{err}");
    assert!(!rendered.contains(secret));
}
