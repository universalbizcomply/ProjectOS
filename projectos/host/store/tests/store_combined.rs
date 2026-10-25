//! Combined regression: operation + approval + credential metadata + credential envelope +
//! emergency-stop staged in ONE valid transaction. All consistency rules pass, every touched family
//! is journalled exactly once, the final manifest matches, and the snapshot exposes DTOs only.

mod common;

use projectos_host_persistence::TargetFamilyDto;
use projectos_host_store::{Store, EMERGENCY_KEY};

#[test]
fn one_valid_transaction_across_all_consistency_families() {
    let mut store = Store::new();
    let mut tx = store.begin().expect("begin");
    tx.insert("op-1", common::operation("op-1"))
        .expect("stage op");
    tx.insert("appr-1", common::approval("appr-1"))
        .expect("stage approval");
    tx.insert("cred-1", common::metadata("cred-1"))
        .expect("stage metadata"); // Active
    tx.insert("cred-1", common::envelope("cred-1"))
        .expect("stage envelope");
    tx.insert(EMERGENCY_KEY, common::emergency())
        .expect("stage emergency"); // state_revision 1

    let outcome = store.commit(&mut tx).expect("commit");
    assert_eq!(outcome.revision.value(), 1);
    // One journal record per touched family (5).
    assert_eq!(outcome.journal_records, 5);

    let snap = store.snapshot();
    // Every touched family journalled exactly once, in fixed order.
    let targets: Vec<TargetFamilyDto> = snap.journal().iter().map(|j| j.target_family).collect();
    assert_eq!(
        targets,
        vec![
            TargetFamilyDto::Operation,
            TargetFamilyDto::Approval,
            TargetFamilyDto::CredentialMetadata,
            TargetFamilyDto::CredentialEnvelope,
            TargetFamilyDto::EmergencyStop,
        ]
    );

    // Final manifest family revisions match the touched families.
    let manifest = snap.manifest().expect("manifest");
    let fr = &manifest.family_revisions;
    assert_eq!(fr.operation, 1);
    assert_eq!(fr.approval, 1);
    assert_eq!(fr.credential_metadata, 1);
    assert_eq!(fr.credential_envelope, 1);
    assert_eq!(fr.emergency_stop, 1);
    assert_eq!(fr.trust_policy, 0);
    assert_eq!(fr.audit, 0);

    // The snapshot exposes committed persistence DTOs only — no live authority object.
    assert!(snap.operation("op-1").is_some());
    assert!(snap.approval("appr-1").is_some());
    assert!(snap.credential_metadata("cred-1").is_some());
    assert!(snap.credential_envelope("cred-1").is_some());
    assert!(snap.emergency_stop().is_some());
}
