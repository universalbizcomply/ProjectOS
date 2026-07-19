//! CORRECTION1A hardening: pre-parse size limit, redacted-text boundary, and named cross-record
//! adversarial coverage.

use projectos_host_persistence::{
    validate_approval_for_operation, validate_envelope_metadata, validate_journal_targets_manifest,
    validate_manifest_covers_operation, ApprovalRecordDto, AuditRecordDto, CredentialEnvelopeDto,
    CredentialMetadataDto, JournalRecordDto, OperationRecordDto, PersistError,
    ProtectedStateManifestDto, MAX_DOCUMENT_BYTES,
};

const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1"]}"#;
const ENVELOPE: &str = r#"{"schemaVersion":1,"recordRevision":3,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","keyVersion":1,"algorithm":"AES-256-GCM","nonce":"0011","ciphertext":"deadbeef","authTag":"aabb","associatedDataDigest":"0011","createdRevision":3,"revocation":"ACTIVE"}"#;
const METADATA: &str = r#"{"schemaVersion":1,"recordRevision":2,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","permittedOperations":["read-only-validate"],"lifecycle":"ACTIVE","expiry":1000,"revocationRevision":1,"rotationRequired":false,"lastValidatedRevision":1}"#;
const APPROVAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"approvalId":"appr-1","project":"polygo","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","release":"rel-1","expiry":1000,"replayIdentity":"nonce-1","revocation":"ACTIVE"}"#;
const MANIFEST: &str = r#"{"schemaVersion":1,"storeRevision":7,"familyRevisions":{"trustPolicy":1,"projectRegistry":1,"operation":5,"approval":1,"credentialMetadata":2,"credentialEnvelope":3,"emergencyStop":4,"audit":6},"manifestMac":"aabbccdd","recordRevision":7}"#;
const JOURNAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"intentId":"intent-1","phase":"INTENT","targetFamily":"OPERATION","targetRevision":6}"#;

fn op(json: &str) -> OperationRecordDto {
    OperationRecordDto::parse_json(json.as_bytes()).unwrap()
}
fn env(json: &str) -> CredentialEnvelopeDto {
    CredentialEnvelopeDto::parse_json(json.as_bytes()).unwrap()
}
fn meta(json: &str) -> CredentialMetadataDto {
    CredentialMetadataDto::parse_json(json.as_bytes()).unwrap()
}
fn approval(json: &str) -> ApprovalRecordDto {
    ApprovalRecordDto::parse_json(json.as_bytes()).unwrap()
}
fn manifest(json: &str) -> ProtectedStateManifestDto {
    ProtectedStateManifestDto::parse_json(json.as_bytes()).unwrap()
}
fn journal(json: &str) -> JournalRecordDto {
    JournalRecordDto::parse_json(json.as_bytes()).unwrap()
}
fn audit_summary_err(summary: &str) -> PersistError {
    let json = format!(
        r#"{{"schemaVersion":1,"recordRevision":1,"sequence":0,"eventClass":"OPERATION_REQUESTED","evidenceRefs":[],"thisHash":"00ff","redactedSummary":"{summary}"}}"#
    );
    match AuditRecordDto::parse_json(json.as_bytes()) {
        Err(e) => e,
        Ok(d) => d.validate().unwrap_err(),
    }
}
fn audit_summary_ok(summary: &str) {
    let json = format!(
        r#"{{"schemaVersion":1,"recordRevision":1,"sequence":0,"eventClass":"OPERATION_REQUESTED","evidenceRefs":[],"thisHash":"00ff","redactedSummary":"{summary}"}}"#
    );
    AuditRecordDto::parse_json(json.as_bytes())
        .unwrap()
        .validate()
        .unwrap();
}

// ---- pre-deserialization size limit --------------------------------------------------------------

#[test]
fn document_exactly_at_bound_parses() {
    let pad = MAX_DOCUMENT_BYTES - OPERATION.len();
    let json = format!("{OPERATION}{}", " ".repeat(pad));
    assert_eq!(json.len(), MAX_DOCUMENT_BYTES);
    OperationRecordDto::parse_json(json.as_bytes())
        .unwrap()
        .validate()
        .unwrap();
}

#[test]
fn document_over_bound_rejected_before_deserialization() {
    let pad = MAX_DOCUMENT_BYTES - OPERATION.len() + 1;
    let json = format!("{OPERATION}{}", " ".repeat(pad));
    assert_eq!(
        OperationRecordDto::parse_json(json.as_bytes()),
        Err(PersistError::DocumentTooLarge)
    );
}

#[test]
fn oversized_malformed_input_is_document_too_large_not_malformed() {
    // Garbage (not JSON) but over the bound → DocumentTooLarge, proving the check runs first.
    let junk = "x".repeat(MAX_DOCUMENT_BYTES + 100);
    assert_eq!(
        OperationRecordDto::parse_json(junk.as_bytes()),
        Err(PersistError::DocumentTooLarge)
    );
}

#[test]
fn oversized_error_contains_no_supplied_content() {
    let secretish = "sbp_live_marker_1234567890";
    let junk = format!("{secretish}{}", "x".repeat(MAX_DOCUMENT_BYTES));
    let err = OperationRecordDto::parse_json(junk.as_bytes()).unwrap_err();
    assert_eq!(err, PersistError::DocumentTooLarge);
    assert!(!format!("{err}").contains(secretish));
}

// ---- redacted-text boundary ----------------------------------------------------------------------

#[test]
fn raw_token_in_summary_rejected() {
    assert_eq!(
        audit_summary_err("connection ok ghp_ABCDEF0123456789abcdef"),
        PersistError::InvalidText
    );
    assert_eq!(
        audit_summary_err("using sbp_live_secretvalue token"),
        PersistError::InvalidText
    );
}

#[test]
fn jwt_shaped_summary_rejected() {
    assert_eq!(
        audit_summary_err("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij"),
        PersistError::InvalidText
    );
}

#[test]
fn private_key_header_summary_rejected() {
    assert_eq!(
        audit_summary_err("-----BEGIN PRIVATE KEY-----"),
        PersistError::InvalidText
    );
}

#[test]
fn password_assignment_summary_rejected() {
    assert_eq!(
        audit_summary_err("password=hunter2"),
        PersistError::InvalidText
    );
}

#[test]
fn credential_bearing_url_summary_rejected() {
    assert_eq!(
        audit_summary_err("cloned https://user:pass@github.com/x/y"),
        PersistError::InvalidText
    );
}

#[test]
fn approved_placeholders_and_safe_summaries_accepted() {
    audit_summary_ok("validated 3 tables; token TOKEN_REDACTED");
    audit_summary_ok("secret stored: SECRET_REDACTED");
    audit_summary_ok("credential set up: CREDENTIAL_REDACTED at URL_PLACEHOLDER");
    audit_summary_ok("resumed PolyGo staging read-only validation");
    audit_summary_ok("project PROJECT_REF_PLACEHOLDER continued");
}

#[test]
fn redacted_text_error_does_not_echo_rejected_content() {
    let secret = "ghp_super_secret_marker_0123456789";
    let err = audit_summary_err(&format!("leak {secret}"));
    assert_eq!(err, PersistError::InvalidText);
    assert!(!format!("{err}").contains(secret));
}

// ---- named cross-record adversarial coverage -----------------------------------------------------

#[test]
fn credential_envelope_project_mismatch_rejected() {
    let e = env(ENVELOPE);
    let m = meta(&METADATA.replace("\"project\":\"polygo\"", "\"project\":\"jdtesting\""));
    assert_eq!(
        validate_envelope_metadata(&e, &m),
        Err(PersistError::ScopeMismatch)
    );
}

#[test]
fn credential_envelope_provider_mismatch_rejected() {
    let e = env(ENVELOPE);
    let m = meta(&METADATA.replace("\"provider\":\"supabase\"", "\"provider\":\"vercel\""));
    assert_eq!(
        validate_envelope_metadata(&e, &m),
        Err(PersistError::ScopeMismatch)
    );
}

#[test]
fn credential_envelope_environment_mismatch_rejected() {
    let e = env(ENVELOPE);
    let m = meta(&METADATA.replace(
        "\"environment\":\"staging\"",
        "\"environment\":\"production\"",
    ));
    assert_eq!(
        validate_envelope_metadata(&e, &m),
        Err(PersistError::ScopeMismatch)
    );
}

#[test]
fn envelope_metadata_consistent_pair_accepted() {
    validate_envelope_metadata(&env(ENVELOPE), &meta(METADATA)).unwrap();
}

#[test]
fn approval_scope_mismatch_rejected() {
    let a = approval(&APPROVAL.replace(
        "\"operation\":\"read-only-validate\"",
        "\"operation\":\"delete-all\"",
    ));
    assert_eq!(
        validate_approval_for_operation(&a, &op(OPERATION)),
        Err(PersistError::ScopeMismatch)
    );
}

#[test]
fn approval_expiry_contradiction_rejected() {
    // Operation window (2000) outlasts the approval expiry (1000) → contradiction.
    let o = op(&OPERATION.replace("\"operationExpiry\":1000", "\"operationExpiry\":2000"));
    assert_eq!(
        validate_approval_for_operation(&approval(APPROVAL), &o),
        Err(PersistError::ExpiryContradiction)
    );
}

#[test]
fn approval_matching_operation_accepted() {
    validate_approval_for_operation(&approval(APPROVAL), &op(OPERATION)).unwrap();
}

#[test]
fn invalid_manifest_reference_rejected() {
    // Operation revision ahead of the manifest's operation-family revision.
    let o = op(&OPERATION.replace("\"recordRevision\":5", "\"recordRevision\":9"));
    assert_eq!(
        validate_manifest_covers_operation(&manifest(MANIFEST), &o),
        Err(PersistError::InvalidChainReference)
    );
    // A covered record is accepted.
    validate_manifest_covers_operation(&manifest(MANIFEST), &op(OPERATION)).unwrap();
}

#[test]
fn invalid_journal_reference_rejected() {
    // Target revision at/below the current family revision (5) is a stale/rollback reference.
    let j = journal(&JOURNAL.replace("\"targetRevision\":6", "\"targetRevision\":5"));
    assert_eq!(
        validate_journal_targets_manifest(&j, &manifest(MANIFEST)),
        Err(PersistError::InvalidChainReference)
    );
    // A forward-advancing target is accepted.
    validate_journal_targets_manifest(&journal(JOURNAL), &manifest(MANIFEST)).unwrap();
}

#[test]
fn copied_credential_ref_is_data_only() {
    // Same credentialRef under two different projects is inert data; no envelope/metadata type
    // exposes a permit, session, lease, or live approval — there is no authority API at all.
    let a = meta(METADATA);
    let b = meta(&METADATA.replace("\"project\":\"polygo\"", "\"project\":\"jdtesting\""));
    a.validate().unwrap();
    b.validate().unwrap();
    assert_eq!(a.credential_ref, b.credential_ref);
    assert_ne!(a.project, b.project);
    // A mismatched envelope/metadata pair with the copied ref but different project is rejected.
    assert_eq!(
        validate_envelope_metadata(&env(ENVELOPE), &b),
        Err(PersistError::ScopeMismatch)
    );
}
