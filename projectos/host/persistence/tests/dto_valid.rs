//! One valid fixture per DTO family: strict parse, validate, and JSON round-trip.

use projectos_host_persistence::{
    ApprovalRecordDto, AuditRecordDto, CredentialEnvelopeDto, CredentialMetadataDto,
    EmergencyStopDto, JournalRecordDto, OperationRecordDto, ProjectRegistryDto,
    ProtectedStateManifestDto, TrustPolicyDto,
};

const OPERATION: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;
const ENVELOPE: &str = r#"{"schemaVersion":1,"recordRevision":3,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","keyVersion":1,"algorithm":"AES-256-GCM","nonce":"00112233445566778899aabb","ciphertext":"deadbeef","authTag":"aabbccddeeff00112233445566778899","associatedDataDigest":"0011","createdRevision":3,"revocation":"ACTIVE"}"#;
const METADATA: &str = r#"{"schemaVersion":1,"recordRevision":2,"credentialRef":"cred-1","project":"polygo","provider":"supabase","environment":"staging","permittedOperations":["read-only-validate"],"lifecycle":"ACTIVE","expiry":1000,"revocationRevision":1,"rotationRequired":false,"lastValidatedRevision":1}"#;
const APPROVAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"approvalId":"appr-1","project":"polygo","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","release":"rel-1","expiry":1000,"replayIdentity":"nonce-1","revocation":"ACTIVE"}"#;
const TRUST: &str = r#"{"schemaVersion":1,"recordRevision":1,"approvedPublishers":["pub-1"],"signingPolicyId":"pol-1","policyRevision":2,"approvedInstallation":"inst-1","approvedRelease":"rel-1","minReleaseFloor":1,"minPolicyRevision":1,"emergencyRevocationFloor":1,"trustRootVersion":1}"#;
const REGISTRY: &str = r#"{"schemaVersion":1,"recordRevision":1,"project":"polygo","repositoryIdentity":"repo-1","approvedRemote":"https://github.com/universalbizcomply/PolyGo.git","permittedLocalRoot":"C:\\dev\\PolyGo","allowedEnvironments":["staging","production"],"providerBindings":["supabase"],"productionFreeze":false,"projectStatus":"ACTIVE","approvedConfigVersion":1}"#;
const EMERGENCY: &str = r#"{"schemaVersion":1,"recordRevision":1,"globalStop":false,"projectStops":[],"providerStops":[],"environmentStops":[],"stagingLock":false,"productionLock":true,"stateRevision":4,"ownerDecisionProvenance":"owner-decision-1"}"#;
const AUDIT: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"eventClass":"OPERATION_REQUESTED","evidenceRefs":["ev-1"],"thisHash":"00ff","redactedSummary":"operation requested for polygo staging"}"#;
const MANIFEST: &str = r#"{"schemaVersion":1,"storeRevision":7,"familyRevisions":{"trustPolicy":1,"projectRegistry":1,"operation":5,"approval":1,"credentialMetadata":2,"credentialEnvelope":3,"emergencyStop":4,"audit":6},"manifestMac":"aabbccdd","recordRevision":7}"#;
const JOURNAL: &str = r#"{"schemaVersion":1,"recordRevision":1,"sequence":0,"intentId":"intent-1","phase":"INTENT","targetFamily":"OPERATION","targetRevision":6}"#;

macro_rules! valid_roundtrip {
    ($name:ident, $dto:ty, $fixture:ident) => {
        #[test]
        fn $name() {
            let dto = <$dto>::parse_json($fixture.as_bytes()).expect("parse");
            dto.validate().expect("validate");
            // Round-trip: serialise then re-parse + re-validate.
            let json = dto.to_json().expect("to_json");
            let back = <$dto>::parse_json(json.as_bytes()).expect("re-parse");
            back.validate().expect("re-validate");
            assert_eq!(dto, back);
        }
    };
}

valid_roundtrip!(operation_ok, OperationRecordDto, OPERATION);
valid_roundtrip!(envelope_ok, CredentialEnvelopeDto, ENVELOPE);
valid_roundtrip!(metadata_ok, CredentialMetadataDto, METADATA);
valid_roundtrip!(approval_ok, ApprovalRecordDto, APPROVAL);
valid_roundtrip!(trust_ok, TrustPolicyDto, TRUST);
valid_roundtrip!(registry_ok, ProjectRegistryDto, REGISTRY);
valid_roundtrip!(emergency_ok, EmergencyStopDto, EMERGENCY);
valid_roundtrip!(audit_ok, AuditRecordDto, AUDIT);
valid_roundtrip!(manifest_ok, ProtectedStateManifestDto, MANIFEST);
valid_roundtrip!(journal_ok, JournalRecordDto, JOURNAL);
