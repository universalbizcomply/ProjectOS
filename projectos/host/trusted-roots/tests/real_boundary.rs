//! §10F — READ-ONLY OBSERVATION OF THE REAL INSTALLED BOUNDARY.
//!
//! ## What this is for
//!
//! To answer one question about the machine it runs on — does `<ProgramData>\ProjectOS\host` ALREADY
//! conform to the accepted policy? — using the production mint itself rather than a description of
//! it. An answer produced by any other route would be a claim about the mint instead of the mint's
//! own answer.
//!
//! ## Why it is `#[ignore]`, and why it still proves something
//!
//! It touches the real installed boundary, so it must never run as part of an ordinary suite: a test
//! that reaches production state by default is a test that will eventually reach it by accident.
//! Asked for explicitly, it does two things — it reports the semantic outcome, and it PROVES the
//! observation was read-only by comparing the boundary's owner and DACL before and after. The mint
//! holds no `apply` call; this is the observable confirmation of that, on the one directory where it
//! matters most.
//!
//! IT NEVER REPAIRS. A non-conforming result is printed and asserted about, never corrected:
//! changing the real ACL is a privileged, owner-gated protected action and is not performed here or
//! anywhere else in this crate.

#![cfg(windows)]

use std::path::Path;

use projectos_host_trusted_roots::{
    ApprovedKnownFolderAnchor, BoundaryRefusal, ProtectedInstallationBoundaryAcceptance,
    TrustedHostStateRoot,
};

/// The object's owner and DACL as Windows itself renders them. Used ONLY to compare a before with an
/// after — this is a change detector, not a second ACL verifier.
fn descriptor_text(path: &Path) -> Option<Vec<u8>> {
    let out = std::process::Command::new("icacls")
        .arg(path)
        .output()
        .ok()?;
    out.status.success().then_some(out.stdout)
}

#[test]
#[ignore = "reads the REAL installed ProjectOS host state root; read-only, never repairs"]
fn the_real_host_state_boundary_is_observed_read_only_and_judged() {
    let root = match TrustedHostStateRoot::resolve(&ApprovedKnownFolderAnchor) {
        Ok(r) => r,
        Err(e) => {
            println!("REAL BOUNDARY: CANNOT ESTABLISH - the root itself refused: {e:?}");
            return;
        }
    };

    let before = descriptor_text(root.path());

    match ProtectedInstallationBoundaryAcceptance::verify(&root) {
        Ok(_) => println!("REAL BOUNDARY: CONFORMS"),
        Err(BoundaryRefusal::NonConforming(v)) => {
            println!("REAL BOUNDARY: DOES NOT CONFORM - findings: {v:?}");
        }
        Err(other) => println!("REAL BOUNDARY: CANNOT ESTABLISH - {other:?}"),
    }

    // THE OBSERVATION CHANGED NOTHING. If the mint had repaired, tightened or otherwise written the
    // descriptor it was asked to judge, these two would differ.
    let after = descriptor_text(root.path());
    assert_eq!(
        before, after,
        "the boundary mint modified the real security descriptor it observed"
    );
}
