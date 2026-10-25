//! Shared synthetic fixtures for the store integration tests. Every value is parsed from a strict,
//! valid persistence-DTO JSON fixture (mirrors the accepted persistence test corpus) and wrapped as a
//! `StoredRecord`. Fields are mutated only to derive distinct-key or deliberately-broken variants.

#![allow(dead_code)]

use projectos_host_persistence::{
    ApprovalRecordDto, AuditRecordDto, CredentialEnvelopeDto, CredentialMetadataDto,
    EmergencyStopDto, OperationRecordDto, ProjectRegistryDto, TrustPolicyDto,
};
use projectos_host_store::StoredRecord;

pub const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;
pub const ENVELOPE: &str = r#"{"schemaVersion":1,"recordRevision":3,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","keyVersion":1,"algorithm":"AES-256-GCM","nonce":"00112233445566778899aabb","ciphertext":"deadbeef","authTag":"aabbccddeeff00112233445566778899","associatedDataDigest":"0011","createdRevision":3,"revocation":"ACTIVE"}"#;
pub const METADATA: &str = r#"{"schemaVersion":1,"recordRevision":2,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","permittedOperations":["read-only-validate"],"lifecycle":"ACTIVE","expiry":1000,"revocationRevision":1,"rotationRequired":false,"lastValidatedRevision":1}"#;
pub const APPROVAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"approvalId":"appr-1","project":"polygo","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","release":"rel-1","expiry":1000,"replayIdentity":"nonce-1","revocation":"ACTIVE"}"#;
pub const TRUST: &str = r#"{"schemaVersion":1,"recordRevision":1,"approvedPublishers":["pub-1"],"signingPolicyId":"pol-1","policyRevision":2,"approvedInstallation":"inst-1","approvedRelease":"rel-1","minReleaseFloor":1,"minPolicyRevision":1,"emergencyRevocationFloor":1,"trustRootVersion":1}"#;
pub const REGISTRY: &str = r#"{"schemaVersion":1,"recordRevision":1,"project":"polygo","repositoryIdentity":"repo-1","approvedRemote":"https://github.com/universalbizcomply/PolyGo.git","permittedLocalRoot":"C:\\dev\\PolyGo","allowedEnvironments":["staging","production"],"providerBindings":["supabase"],"productionFreeze":false,"projectStatus":"ACTIVE","approvedConfigVersion":1}"#;
pub const EMERGENCY: &str = r#"{"schemaVersion":1,"recordRevision":1,"globalStop":false,"projectStops":[],"providerStops":[],"environmentStops":[],"stagingLock":false,"productionLock":true,"stateRevision":4,"ownerDecisionProvenance":"owner-decision-1"}"#;
pub const AUDIT: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"eventClass":"OPERATION_REQUESTED","evidenceRefs":["ev-1"],"thisHash":"00ff","redactedSummary":"operation requested for polygo staging"}"#;

/// A valid operation DTO with the given reference key.
#[must_use]
pub fn operation_dto(op_ref: &str) -> OperationRecordDto {
    let mut dto = OperationRecordDto::parse_json(OPERATION.as_bytes()).expect("operation fixture");
    dto.operation_ref = op_ref.to_string();
    dto
}

/// A valid operation wrapped as a stored record.
#[must_use]
pub fn operation(op_ref: &str) -> StoredRecord {
    StoredRecord::Operation(operation_dto(op_ref))
}

/// A valid trust-policy record with the given signing-policy id.
#[must_use]
pub fn trust(policy_id: &str) -> StoredRecord {
    let mut dto = TrustPolicyDto::parse_json(TRUST.as_bytes()).expect("trust fixture");
    dto.signing_policy_id = policy_id.to_string();
    StoredRecord::TrustPolicy(dto)
}

/// A valid project-registry record with the given project key.
#[must_use]
pub fn registry(project: &str) -> StoredRecord {
    let mut dto = ProjectRegistryDto::parse_json(REGISTRY.as_bytes()).expect("registry fixture");
    dto.project = project.to_string();
    StoredRecord::ProjectRegistry(dto)
}

/// A valid approval record with the given approval id.
#[must_use]
pub fn approval(approval_id: &str) -> StoredRecord {
    let mut dto = ApprovalRecordDto::parse_json(APPROVAL.as_bytes()).expect("approval fixture");
    dto.approval_id = approval_id.to_string();
    StoredRecord::Approval(dto)
}

/// A valid credential-metadata record with the given credential reference.
#[must_use]
pub fn metadata(cred_ref: &str) -> StoredRecord {
    let mut dto = CredentialMetadataDto::parse_json(METADATA.as_bytes()).expect("metadata fixture");
    dto.credential_ref = cred_ref.to_string();
    StoredRecord::CredentialMetadata(dto)
}

/// A valid credential-envelope record with the given credential reference.
#[must_use]
pub fn envelope(cred_ref: &str) -> StoredRecord {
    let mut dto = CredentialEnvelopeDto::parse_json(ENVELOPE.as_bytes()).expect("envelope fixture");
    dto.credential_ref = cred_ref.to_string();
    StoredRecord::CredentialEnvelope(dto)
}

/// A raw credential-envelope DTO (for building deliberate scope mismatches).
#[must_use]
pub fn envelope_dto(cred_ref: &str) -> CredentialEnvelopeDto {
    let mut dto = CredentialEnvelopeDto::parse_json(ENVELOPE.as_bytes()).expect("envelope fixture");
    dto.credential_ref = cred_ref.to_string();
    dto
}

/// A raw approval DTO (for building deliberate scope/expiry mismatches).
#[must_use]
pub fn approval_dto(approval_id: &str) -> ApprovalRecordDto {
    let mut dto = ApprovalRecordDto::parse_json(APPROVAL.as_bytes()).expect("approval fixture");
    dto.approval_id = approval_id.to_string();
    dto
}

/// A raw credential-metadata DTO.
#[must_use]
pub fn metadata_dto(cred_ref: &str) -> CredentialMetadataDto {
    let mut dto = CredentialMetadataDto::parse_json(METADATA.as_bytes()).expect("metadata fixture");
    dto.credential_ref = cred_ref.to_string();
    dto
}

/// A raw emergency-stop DTO (for building state_revision transitions).
#[must_use]
pub fn emergency_dto() -> EmergencyStopDto {
    EmergencyStopDto::parse_json(EMERGENCY.as_bytes()).expect("emergency fixture")
}

/// The singleton emergency-stop record at the deterministic initial state_revision (1).
#[must_use]
pub fn emergency() -> StoredRecord {
    let mut dto = emergency_dto();
    dto.state_revision = 1;
    StoredRecord::EmergencyStop(dto)
}

/// An append-only audit record at the given sequence.
#[must_use]
pub fn audit(sequence: u64) -> StoredRecord {
    let mut dto = AuditRecordDto::parse_json(AUDIT.as_bytes()).expect("audit fixture");
    dto.sequence = sequence;
    StoredRecord::Audit(dto)
}
