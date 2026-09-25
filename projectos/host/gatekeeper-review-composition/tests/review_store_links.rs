//! THE HOST REVIEW STORE NEVER FOLLOWS A LINK. PROJECTOS-HOST-REVIEW-PATH1A, from the security review.
//!
//! The inbox is writable by the identity that asks the questions, so a link left where a request
//! belongs is an attempt to aim a PRIVILEGED read; a link left where a record belongs is an attempt to
//! aim a privileged WRITE. Both adapters judge the open HANDLE and refuse to follow.
//!
//! Creating a symlink on Windows needs Developer Mode or a privilege an ordinary shell may not hold.
//! Where it cannot be created these proofs print `LEG: SKIPPED` and assert nothing - they never pass by
//! pretending. The check-then-open defect they guard is also pinned structurally by
//! `val-projectos-host-review-path1a` (P4), which needs no privilege.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use projectos_host_gatekeeper_attestation::{
    InboxReader, RequestFileIdentity, ResponseFileIdentity, ResponseRecordSink,
    INBOX_RELATIVE_ROOT, RESPONSE_RELATIVE_ROOT,
};
use projectos_host_gatekeeper_review_composition::review_dispatch::{
    FsRequestInbox, FsResponseOutbox,
};

const CORRELATION: [u8; 16] = [0x4d; 16];
static NEXT: AtomicU32 = AtomicU32::new(0);

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "projectos-host-review-links-{tag}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    for leaf in [INBOX_RELATIVE_ROOT, RESPONSE_RELATIVE_ROOT] {
        std::fs::create_dir_all(dir.join(leaf)).expect("leaf");
    }
    dir
}

fn cleanup(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
    assert!(!dir.exists(), "scratch residue at {}", dir.display());
}

/// `true` when this process may create file symlinks at all.
fn link(target: &Path, at: &Path) -> bool {
    match std::os::windows::fs::symlink_file(target, at) {
        Ok(()) => true,
        Err(e) => {
            println!("LEG: SKIPPED - this process cannot create a symlink ({e})");
            false
        }
    }
}

#[test]
fn a_link_where_a_request_belongs_is_never_followed() {
    let root = scratch("inbox");
    let secret = root.join("host-only.txt");
    std::fs::write(&secret, b"bytes the asker may not read").expect("secret");
    let identity = RequestFileIdentity::for_correlation(&CORRELATION);
    let at = root.join(INBOX_RELATIVE_ROOT).join(identity.file_name());

    if link(&secret, &at) {
        println!("LEG: PROVEN - a symlink in the inbox was refused");
        assert!(
            FsRequestInbox::beneath(&root).open_once(&identity).is_none(),
            "the inbox followed a link to a file outside it"
        );
    }
    cleanup(&root);
}

#[test]
fn a_dangling_link_where_a_record_belongs_never_creates_its_target() {
    let root = scratch("outbox");
    let target = root.join("written-through-a-link.txt");
    let identity = ResponseFileIdentity::for_correlation(&CORRELATION);
    let at = root.join(RESPONSE_RELATIVE_ROOT).join(identity.file_name());

    if link(&target, &at) {
        println!("LEG: PROVEN - a dangling symlink in the outbox was treated as existing");
        let mut outbox = FsResponseOutbox::beneath(&root);
        assert!(!outbox.store_once(&identity, b"record"), "a record was written through a link");
        assert!(!target.exists(), "the link's target was created");
    }
    cleanup(&root);
}
