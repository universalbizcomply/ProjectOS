//! Durable-store behaviour tests over the PUBLIC API.
//! Synthetic, non-secret accepted DTOs only. Store-touching tests are `#[cfg(windows)]`. Journal recovery + durability fault tests live in the crate `#[cfg(test)]` unit tests (private seam);
//! this file is black-box over the public API only.

use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_persistence::{
    FamilyRevisionsDto, OperationRecordDto, ProtectedStateManifestDto, TargetFamilyDto,
};
use projectos_host_windows_durable_protected_store::{
    framing::{self, FrameKind},
    DurableProtectedStore, DurableStoreError, VerifiedRoot,
};

const SYNTH_OP: &str = r#"{"schemaVersion":1,"recordRevision":5,"operationRef":"op-1","project":"polygo","repository":"repo-1","environment":"staging","provider":"supabase","operation":"read-only-validate","fingerprint":"fp-1","requiredRelease":"rel-1","requiredInstallation":"inst-1","state":"READY_FOR_REVALIDATION","approvalRequired":true,"credentialRequired":true,"operationExpiry":1000,"revocation":"ACTIVE","resumePolicy":"RESUME_AFTER_REVALIDATION","evidenceRefs":["ev-1","ev-2"]}"#;

const FAMILY: TargetFamilyDto = TargetFamilyDto::Operation;
const CONTAINER_SCHEMA: u32 = 1;

static SEQ: AtomicU64 = AtomicU64::new(0);

fn unique_root() -> String {
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("pos-durable-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_str().unwrap().to_string()
}

fn cleanup(root: &str) {
    let _ = std::fs::remove_dir_all(root);
}

fn synth_payload() -> Vec<u8> {
    OperationRecordDto::parse_json(SYNTH_OP.as_bytes())
        .unwrap()
        .to_json()
        .unwrap()
        .into_bytes()
}

/// Craft a valid framed record directly (public framing) — used to simulate an ahead record without a
/// matching intent.
#[cfg(windows)]
fn place_record(root: &str, id: &[u8], revision: u64, payload: &[u8]) {
    let vr = VerifiedRoot::verify(root).unwrap();
    let framed =
        framing::encode(CONTAINER_SCHEMA, FrameKind::Record, id, revision, payload).unwrap();
    std::fs::write(vr.record_path(id).unwrap(), &framed).unwrap();
}

#[test]
fn invalid_roots_refused() {
    assert_eq!(
        DurableProtectedStore::open("relative\\x").unwrap_err(),
        DurableStoreError::InvalidRoot
    );
    assert_eq!(
        DurableProtectedStore::open("C:\\a\\..\\b").unwrap_err(),
        DurableStoreError::InvalidRoot
    );
}

#[cfg(windows)]
#[test]
fn create_reopen_reads_exact_dto() {
    let root = unique_root();
    let payload = synth_payload();
    {
        let mut s = DurableProtectedStore::open(&root).unwrap();
        assert_eq!(s.current_revision(), 0);
        assert_eq!(s.put_record(b"rec-a", FAMILY, None, &payload).unwrap(), 1);
    }
    {
        let s = DurableProtectedStore::open(&root).unwrap();
        assert_eq!(s.current_revision(), 1);
        let read = s.get_record(b"rec-a").unwrap();
        assert_eq!(read, payload);
        assert!(OperationRecordDto::parse_json(&read)
            .unwrap()
            .validate()
            .is_ok());
    }
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn replace_higher_and_reject_stale() {
    let root = unique_root();
    let payload = synth_payload();
    let mut s = DurableProtectedStore::open(&root).unwrap();
    assert_eq!(s.put_record(b"rec-a", FAMILY, None, &payload).unwrap(), 1);
    assert_eq!(
        s.put_record(b"rec-a", FAMILY, None, &payload).unwrap_err(),
        DurableStoreError::RevisionNotAdvanced
    );
    assert_eq!(
        s.put_record(b"rec-a", FAMILY, Some(1), &payload).unwrap(),
        2
    );
    assert_eq!(
        s.put_record(b"rec-a", FAMILY, Some(1), &payload)
            .unwrap_err(),
        DurableStoreError::RevisionNotAdvanced
    );
    drop(s);
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn family_mismatch_refused_before_journal() {
    let root = unique_root();
    let payload = synth_payload(); // an Operation DTO
    let mut s = DurableProtectedStore::open(&root).unwrap();
    // Declaring the wrong family for the payload is refused (no journal, no record).
    assert_eq!(
        s.put_record(b"rec-a", TargetFamilyDto::Audit, None, &payload)
            .unwrap_err(),
        DurableStoreError::InvalidInput
    );
    assert_eq!(s.current_revision(), 0);
    drop(s);
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn second_writer_refused() {
    let root = unique_root();
    let a = DurableProtectedStore::open(&root).unwrap();
    assert_eq!(
        DurableProtectedStore::open(&root).err(),
        Some(DurableStoreError::LockContention)
    );
    drop(a);
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn corruption_refused_on_reopen() {
    let root = unique_root();
    let payload = synth_payload();
    {
        let mut s = DurableProtectedStore::open(&root).unwrap();
        s.put_record(b"rec-a", FAMILY, None, &payload).unwrap();
    }
    let rp = VerifiedRoot::verify(&root)
        .unwrap()
        .record_path(b"rec-a")
        .unwrap();
    let mut bytes = std::fs::read(&rp).unwrap();
    let mid = bytes.len() / 2;
    bytes[mid] ^= 0x01;
    std::fs::write(&rp, &bytes).unwrap();
    assert_eq!(
        DurableProtectedStore::open(&root).unwrap_err(),
        DurableStoreError::CorruptionDetected
    );
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn one_ahead_without_matching_intent_reconciles() {
    let root = unique_root();
    let payload = synth_payload();
    {
        let mut s = DurableProtectedStore::open(&root).unwrap(); // rec-a @1, manifest 1, intent Committed@1
        s.put_record(b"rec-a", FAMILY, None, &payload).unwrap();
    }
    // Place a second record durably one ahead (rev 2) with NO matching Prepared intent.
    place_record(&root, b"rec-b", 2, &payload);
    assert_eq!(
        DurableProtectedStore::open(&root).unwrap_err(),
        DurableStoreError::ReconciliationRequired
    );
    cleanup(&root);
}

#[cfg(windows)]
#[test]
fn manifest_ahead_of_records_fails_closed() {
    let root = unique_root();
    let payload = synth_payload();
    {
        let mut s = DurableProtectedStore::open(&root).unwrap();
        s.put_record(b"rec-a", FAMILY, None, &payload).unwrap(); // record @1, manifest 1
    }
    // Overwrite the manifest to a revision ahead of every record.
    let vr = VerifiedRoot::verify(&root).unwrap();
    let dto = ProtectedStateManifestDto {
        schema_version: 1,
        store_revision: 9,
        family_revisions: FamilyRevisionsDto {
            trust_policy: 9,
            project_registry: 9,
            operation: 9,
            approval: 9,
            credential_metadata: 9,
            credential_envelope: 9,
            emergency_stop: 9,
            audit: 9,
        },
        manifest_mac: "00".to_string(),
        record_revision: 9,
    };
    let framed = framing::encode(
        CONTAINER_SCHEMA,
        FrameKind::Manifest,
        b"",
        9,
        dto.to_json().unwrap().as_bytes(),
    )
    .unwrap();
    std::fs::write(vr.manifest_path(), &framed).unwrap();
    assert_eq!(
        DurableProtectedStore::open(&root).unwrap_err(),
        DurableStoreError::ReconciliationRequired
    );
    cleanup(&root);
}
