//! LIVE, owner-approved repair of the installed STATE-ROOT directory ACLs.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10G-PREP. Modelled on `record_acl_repair_live.rs`.
//!
//! `#[ignore]`d: it acts on the real `<ProgramData>\ProjectOS`, `\host` and `\host\installation`, so it
//! never runs in an ordinary `cargo test`. It is run ONLY in the owner-approved §10G live step,
//! elevated, explicitly:
//!
//! ```text
//! cargo test --features installer-effect --test state_root_acl_repair_live -- --ignored --nocapture
//! ```
//!
//! It calls exactly the bounded operation — no script, no second implementation. It creates nothing,
//! deletes nothing, starts nothing, and opens no file.

#![cfg(all(windows, feature = "installer-effect"))]

use projectos_host_elevated_installer_composition::effect::{
    repair_installed_state_root_acl, StateRootAclRepairOutcome, StateRootRepairRefusal,
    STATE_ROOT_ACL_REPAIR_PHRASE,
};

#[test]
fn an_inexact_phrase_repairs_nothing() {
    for wrong in [
        "",
        "APPROVED",
        "approved: repair the projectoshost state root directory acls",
        "APPROVED: repair the ProjectOSHost state root directory ACLs ",
        " APPROVED: repair the ProjectOSHost state root directory ACLs",
        "APPROVED: repair the ProjectOSHost state root directory ACL",
        "APPROVED: repair the ProjectOSHost identity record file ACL",
    ] {
        assert_eq!(
            repair_installed_state_root_acl(wrong),
            StateRootAclRepairOutcome::Refused(StateRootRepairRefusal::PhraseMismatch),
            "an inexact phrase must refuse before any effect: {wrong:?}"
        );
    }
}

#[test]
#[ignore = "acts on the REAL ProgramData state root; run only in the owner-approved §10G live step"]
fn the_installed_state_root_acl_is_repaired_deepest_first() {
    let outcome = repair_installed_state_root_acl(STATE_ROOT_ACL_REPAIR_PHRASE);
    println!("LIVE STATE-ROOT ACL REPAIR: {outcome:?}");
    assert!(
        matches!(
            outcome,
            StateRootAclRepairOutcome::Repaired { .. }
                | StateRootAclRepairOutcome::AlreadyConforming
        ),
        "the repair did not succeed: {outcome:?}"
    );

    // Idempotent: running it again must report the policy already in force and change nothing.
    let again = repair_installed_state_root_acl(STATE_ROOT_ACL_REPAIR_PHRASE);
    assert_eq!(
        again,
        StateRootAclRepairOutcome::AlreadyConforming,
        "a second repair must be a no-op, got {again:?}"
    );
}
