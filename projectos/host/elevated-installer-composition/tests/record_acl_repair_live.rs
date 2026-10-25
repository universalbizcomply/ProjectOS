//! LIVE, owner-approved repair of the installed record file's ACL.
//!
//! CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A (post-freeze installer correction).
//!
//! `#[ignore]`d: it acts on the real installation, so it never runs in an ordinary `cargo test`.
//! Run it explicitly, elevated:
//!
//! ```text
//! cargo test --features installer-effect --test record_acl_repair_live -- --ignored --nocapture
//! ```
//!
//! It calls exactly the operation the installer now performs at step 11b — no script, no second
//! implementation. It creates nothing, deletes nothing, starts nothing, and never opens the record
//! for writing.

#![cfg(all(windows, feature = "installer-effect"))]

use projectos_host_elevated_installer_composition::effect::{
    repair_installed_record_file_acl, RecordAclRepairOutcome, RECORD_ACL_REPAIR_PHRASE,
};

#[test]
fn an_inexact_phrase_repairs_nothing() {
    for wrong in [
        "",
        "APPROVED",
        "approved: repair the projectoshost identity record file acl",
        "APPROVED: repair the ProjectOSHost identity record file ACL ",
    ] {
        assert!(
            matches!(
                repair_installed_record_file_acl(wrong),
                RecordAclRepairOutcome::Refused(_)
            ),
            "an inexact phrase must refuse: {wrong:?}"
        );
    }
}

#[test]
#[ignore = "acts on the real installed ProjectOSHost identity record"]
fn the_installed_record_file_acl_is_repaired_without_touching_the_record() {
    let outcome = repair_installed_record_file_acl(RECORD_ACL_REPAIR_PHRASE);
    println!("LIVE ACL REPAIR: {outcome:?}");
    assert!(
        matches!(
            outcome,
            RecordAclRepairOutcome::Repaired | RecordAclRepairOutcome::AlreadyConforming
        ),
        "the repair did not succeed: {outcome:?}"
    );

    // Idempotent: running it again must report the policy already in force and change nothing.
    let again = repair_installed_record_file_acl(RECORD_ACL_REPAIR_PHRASE);
    assert_eq!(
        again,
        RecordAclRepairOutcome::AlreadyConforming,
        "a second repair must be a no-op, got {again:?}"
    );
}
