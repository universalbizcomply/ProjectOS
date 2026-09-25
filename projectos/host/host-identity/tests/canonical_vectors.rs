//! THE CROSS-LANGUAGE PIN, from the Rust side.
//!
//! Both the host (here) and the agent (`projectos/core/test/hostIdentityDigests.test.ts`) read the SAME
//! committed vector file. Neither hand-authors its own expected values, which is the whole point: a
//! digest contract where each language keeps its own table of "what the answer should be" is two
//! contracts that happen to agree today.
//!
//! Written as an EXTERNAL consumer of the crate, so everything reached here is something a real caller
//! can reach. No network, no process, no clock, no disk beyond reading one committed fixture.

use std::fs;
use std::path::PathBuf;

use projectos_host_identity::{
    committed_candidate_digest, credential_ref_identity_digest, is_canonical_commit_oid,
    model_policy_identity_digest, phase_identity_digest, plan_identity_digest,
    project_identity_digest, repository_identity_digest, COMMITTED_CANDIDATE_DOMAIN,
    COMMITTED_CANDIDATE_SCHEMA_VERSION, PROGRAMME_IDENTITY_DOMAIN,
};

/// The committed contract file, found relative to this crate rather than to a working directory — a
/// test that depends on where it was launched from is a test that passes for the wrong reason.
fn vectors() -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("contracts")
        .join("host-identity-vectors.v1.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("the canonical vector file must be readable at {path:?}: {e}"));
    serde_json::from_str(&raw).expect("the canonical vector file must be valid JSON")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn the_declared_domains_match_the_implementation() {
    let v = vectors();
    assert_eq!(
        v["programmeIdentity"]["domain"].as_str().unwrap().as_bytes(),
        PROGRAMME_IDENTITY_DOMAIN,
        "the vector file and the implementation disagree about the programme identity domain"
    );
    assert_eq!(
        v["committedCandidate"]["domain"]
            .as_str()
            .unwrap()
            .as_bytes(),
        COMMITTED_CANDIDATE_DOMAIN,
        "the vector file and the implementation disagree about the committed-candidate domain"
    );
    assert_eq!(
        v["committedCandidate"]["schemaVersion"].as_u64().unwrap(),
        u64::from(COMMITTED_CANDIDATE_SCHEMA_VERSION)
    );
}

/// Every typed identity helper produces exactly the committed digest for its field.
///
/// The match on the field tag is exhaustive-by-panic: a tag added to the vector file with no helper
/// here fails loudly rather than being silently skipped, which is how a cross-pin quietly stops
/// covering a field.
#[test]
fn every_programme_identity_vector_matches() {
    let v = vectors();
    let rows = v["programmeIdentity"]["vectors"].as_array().unwrap();
    assert_eq!(rows.len(), 6, "all six field tags must be pinned");
    for row in rows {
        let field = row["field"].as_str().unwrap();
        let value = row["value"].as_str().unwrap();
        let expected = row["digest"].as_str().unwrap();
        let actual = match field {
            "project" => project_identity_digest(value),
            "repository" => repository_identity_digest(value),
            "plan" => plan_identity_digest(value),
            "phase" => phase_identity_digest(value),
            "model-policy" => model_policy_identity_digest(value),
            "credential-ref" => credential_ref_identity_digest(value),
            other => panic!("the vector file pins field '{other}' but no typed helper claims it"),
        };
        assert_eq!(hex(&actual), expected, "field '{field}' drifted");
    }
}

/// THE FIELD TAG IS LOAD-BEARING. The same text under two tags must not collide, or a plan reference
/// could satisfy a comparison meant for a phase id.
#[test]
fn the_same_text_under_different_tags_is_a_different_digest() {
    let same = "identical-text";
    let all = [
        hex(&project_identity_digest(same)),
        hex(&repository_identity_digest(same)),
        hex(&plan_identity_digest(same)),
        hex(&phase_identity_digest(same)),
        hex(&model_policy_identity_digest(same)),
        hex(&credential_ref_identity_digest(same)),
    ];
    let mut unique = all.clone().to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), all.len(), "two field tags share a digest space");
}

#[test]
fn every_accepted_committed_candidate_vector_matches() {
    let v = vectors();
    let rows = v["committedCandidate"]["accepted"].as_array().unwrap();
    assert!(!rows.is_empty());
    for row in rows {
        let oid = row["commitOid"].as_str().unwrap();
        let expected = row["digest"].as_str().unwrap();
        assert!(is_canonical_commit_oid(oid), "{oid} should be canonical");
        let actual = committed_candidate_digest(oid)
            .unwrap_or_else(|| panic!("{} must produce a digest", row["label"]));
        assert_eq!(hex(&actual), expected, "{} drifted", row["label"]);
    }
}

#[test]
fn every_refused_committed_candidate_vector_is_refused() {
    let v = vectors();
    for row in v["committedCandidate"]["refused"].as_array().unwrap() {
        let oid = row["commitOid"].as_str().unwrap();
        assert!(
            !is_canonical_commit_oid(oid),
            "{} must not be canonical",
            row["label"]
        );
        assert!(
            committed_candidate_digest(oid).is_none(),
            "{} must be refused, never digested",
            row["label"]
        );
    }
}
