//! PROJECTOS-HOST-REVIEW-PATH1B — the production closure-facts and admitted-cost source FAILS CLOSED.
//!
//! WHAT THIS CAN AND CANNOT PROVE, stated rather than glossed. The positive leg needs the OWNER'S
//! signature over a version 2 manifest, and no owner has signed one - correctly: producing, signing or
//! installing a closure is an activation action, not this phase's. So nothing outside `host-identity`
//! can hold a verified closure, and the mapping from one to the three answers is proven THERE
//! (`a_verified_closure_yields_the_signed_policy_facts`). What is proven here is the half that matters
//! while the route is dormant: every way of not having an owner-signed closure yields NO model policy,
//! NO credential reference and NO admitted cost - never a default.

use std::cell::Cell;

use projectos_host_gatekeeper_attestation::operation::{CommittedBytesPort, TrustManifestPort};
use projectos_host_gatekeeper_review_composition::closure_facts::SignedClosureFacts;
use projectos_host_windows_local_ipc::{AdmittedCostSource, SignedExecutionClosureFacts};
use projectos_packaged_runtime_contract as contract;

struct Manifest(Option<Vec<u8>>);
impl TrustManifestPort for Manifest {
    fn manifest_bytes(&self) -> Option<Vec<u8>> {
        self.0.clone()
    }
}

/// Serves the same bytes for every contract path, and records every path it was asked for.
struct Committed {
    bytes: Option<Vec<u8>>,
    asked: Cell<Vec<String>>,
}
impl Committed {
    fn serving(bytes: Option<&[u8]>) -> Self {
        Self {
            bytes: bytes.map(<[u8]>::to_vec),
            asked: Cell::new(Vec::new()),
        }
    }
    fn asked(&self) -> Vec<String> {
        let v = self.asked.take();
        self.asked.set(v.clone());
        v
    }
}
impl CommittedBytesPort for Committed {
    fn committed_bytes(&self, path: &str) -> Option<Vec<u8>> {
        let mut v = self.asked.take();
        v.push(path.to_string());
        self.asked.set(v);
        self.bytes.clone()
    }
}

fn sha_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// A structurally complete manifest. `closure` is spliced in when the version carries one.
fn manifest(version: u32, signing_key_id: &str, signature: &str, closure: bool, hostile_path: bool) -> Vec<u8> {
    let d = sha_hex(b"committed");
    let broker = if hostile_path { "../../etc/passwd" } else { contract::BROKER_REPOSITORY_RELATIVE_PATH };
    let closure_json = if closure {
        format!(
            r#""executionClosure":{{"gatekeeperBroker":{{"repositoryRelativePath":"{broker}","sha256":"{d}"}},"installationProjectAllowlist":{{"repositoryRelativePath":"{a}","sha256":"{d}"}},"credentialAdapter":{{"repositoryRelativePath":"{c}","sha256":"{d}"}},"costPolicy":{{"admittedReviewCostMicroUsd":250000}},"modelPolicy":"openai/gpt-5.6-terra","credentialRef":"PROJECTOS_GATEKEEPER_OPENAI_KEY"}},"#,
            a = contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
            c = contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
        )
    } else {
        String::new()
    };
    format!(
        r#"{{"schemaVersion":1,"manifestVersion":{version},"applicationId":"com.universalbizcomply.projectos.control","applicationVersion":"1.0.0","buildId":"b1","installationModel":"PER_MACHINE","runtime":{{"relativePath":"runtime/node.exe","sha256":"{d}","expectedVersion":"v24.0.0","platform":"win32","architecture":"x64"}},"daemonArtefact":{{"relativePath":"daemon/daemon.cjs","sha256":"{d}","format":"single-bundle","buildId":"b1"}},"generatedAt":"2026-09-19T00:00:00Z","minimumProtocolVersion":1,"signatureAlgorithm":"ES256","signingKeyId":"{signing_key_id}",{closure_json}"signature":"{signature}"}}"#
    )
    .into_bytes()
}

/// NON-VACUITY. Every fixture that is meant to be refused FOR ITS SIGNATURE, VERSION OR CLOSURE must first
/// be a manifest the strict parser accepts - otherwise it is refused as malformed and proves nothing
/// about the gate it is named after. (The first draft of this file failed exactly that way.)
#[test]
fn the_fixtures_are_well_formed_manifests_so_each_refusal_is_for_its_stated_reason() {
    use projectos_host_identity::TrustManifest;
    for (version, closure) in [(1, false), (2, true)] {
        let bytes = manifest(version, "projectos-signing-20260812", "AAAA", closure, false);
        let parsed = TrustManifest::parse(&bytes).expect("the fixture parses under the strict contract");
        assert_eq!(parsed.check_versions(), Ok(()), "version {version} agrees with its shape");
    }
    // The hostile-path variant parses too: it is refused by the SIGNATURE, not by the parser.
    let hostile = manifest(2, "projectos-signing-20260812", "AAAA", true, true);
    assert!(TrustManifest::parse(&hostile).is_ok());
}

fn nothing_is_answered(facts: &SignedClosureFacts, why: &str) {
    assert!(!facts.is_established(), "{why}");
    assert_eq!(facts.model_policy(), None, "{why}: no model policy");
    assert_eq!(facts.credential_ref(), None, "{why}: no credential reference");
    assert_eq!(facts.admitted_cost_micro_usd(), None, "{why}: NO COST - never a default, never zero");
}

#[test]
fn every_way_of_not_having_an_owner_signed_closure_answers_nothing() {
    let committed = Committed::serving(Some(b"committed"));
    let cases: Vec<(&str, Option<Vec<u8>>)> = vec![
        ("no installed manifest", None),
        ("a manifest that is not JSON", Some(b"not json".to_vec())),
        ("a version 1 manifest, which never signed a closure", Some(manifest(1, "projectos-signing-20260812", "AAAA", false, false))),
        ("a version 2 manifest with no closure", Some(manifest(2, "projectos-signing-20260812", "AAAA", false, false))),
        ("a version 2 manifest that is not signed", Some(manifest(2, "projectos-signing-20260812", "", true, false))),
        ("a version 2 manifest with a signature that does not verify", Some(manifest(2, "projectos-signing-20260812", "AAAA", true, false))),
        ("a version 2 manifest signed by a TEST key, refused under production policy", Some(manifest(2, "test-key-1", "AAAA", true, false))),
    ];
    for (why, bytes) in cases {
        nothing_is_answered(&SignedClosureFacts::establish(&Manifest(bytes), &committed), why);
    }
}

#[test]
fn committed_bytes_that_cannot_be_established_answer_nothing() {
    let unreadable = Committed::serving(None);
    let bytes = manifest(2, "projectos-signing-20260812", "AAAA", true, false);
    nothing_is_answered(
        &SignedClosureFacts::establish(&Manifest(Some(bytes)), &unreadable),
        "the closure artefacts could not be read",
    );
}

/// THE READS ARE AIMED BY THE PACKAGING CONTRACT, NEVER BY THE MANIFEST. A manifest nobody has signed
/// names a hostile path; the Host still opens exactly the three contract paths and no other.
#[test]
fn an_unsigned_manifest_cannot_choose_which_file_the_host_opens() {
    let committed = Committed::serving(Some(b"committed"));
    let hostile = manifest(2, "projectos-signing-20260812", "AAAA", true, true);
    nothing_is_answered(&SignedClosureFacts::establish(&Manifest(Some(hostile)), &committed), "hostile path");
    assert_eq!(
        committed.asked(),
        [
            contract::BROKER_REPOSITORY_RELATIVE_PATH,
            contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH,
            contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH,
        ]
    );
}
