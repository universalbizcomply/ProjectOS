//! Strictness proofs for the durable owner-delegation lifecycle DTO family.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION §10B. The record answers exactly one question — what lifecycle
//! state has the HOST recorded for one delegation — so the whole proof is that nothing else can be
//! smuggled into it, that only three states exist, and that one delegation has exactly one spelling.

use projectos_host_persistence::version::DELEGATION_LIFECYCLE_SCHEMA;
use projectos_host_persistence::{
    DelegationLifecycleRecordDto, DelegationLifecycleStateDto, PersistError,
};

const ID: &str = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";

fn record(id: &str, state: &str) -> String {
    format!(
        r#"{{"schemaVersion":1,"recordRevision":1,"delegationIdHex":"{id}","state":"{state}"}}"#
    )
}

fn parse(json: &str) -> Result<DelegationLifecycleRecordDto, PersistError> {
    DelegationLifecycleRecordDto::parse_json(json.as_bytes())
}

#[test]
fn the_three_accepted_states_round_trip() {
    for (word, state) in [
        ("ACTIVE", DelegationLifecycleStateDto::Active),
        ("REVOKED", DelegationLifecycleStateDto::Revoked),
        ("COMPLETED", DelegationLifecycleStateDto::Completed),
    ] {
        let dto = parse(&record(ID, word)).expect("parses");
        dto.validate().expect("valid");
        assert_eq!(dto.state, state);
        assert_eq!(dto.delegation_id_hex, ID);
        assert_eq!(dto.schema_version, DELEGATION_LIFECYCLE_SCHEMA);
        // Round-tripping must not change what it says.
        let again = parse(&dto.to_json().expect("serialises")).expect("re-parses");
        assert_eq!(again, dto);
    }
}

#[test]
fn a_fourth_state_word_is_a_parse_failure() {
    for word in ["SUSPENDED", "PAUSED", "active", "Active", ""] {
        assert!(
            parse(&record(ID, word)).is_err(),
            "an unknown state must never decode: {word:?}"
        );
    }
}

#[test]
fn an_unknown_field_is_refused_rather_than_ignored() {
    // A future writer must not be able to add meaning an older reader silently drops.
    for inject in [
        r#""override":true"#,
        r#""signature":"deadbeef""#,
        r#""expiresAtEpochS":0"#,
        r#""budgetMicroUsd":1"#,
    ] {
        let json = format!(
            r#"{{"schemaVersion":1,"recordRevision":1,"delegationIdHex":"{ID}","state":"ACTIVE",{inject}}}"#
        );
        assert_eq!(parse(&json), Err(PersistError::Malformed), "{inject}");
    }
}

#[test]
fn a_missing_field_is_refused() {
    for json in [
        format!(r#"{{"recordRevision":1,"delegationIdHex":"{ID}","state":"ACTIVE"}}"#),
        format!(r#"{{"schemaVersion":1,"delegationIdHex":"{ID}","state":"ACTIVE"}}"#),
        r#"{"schemaVersion":1,"recordRevision":1,"state":"ACTIVE"}"#.to_owned(),
        format!(r#"{{"schemaVersion":1,"recordRevision":1,"delegationIdHex":"{ID}"}}"#),
    ] {
        assert_eq!(parse(&json), Err(PersistError::Malformed), "{json}");
    }
}

#[test]
fn any_schema_version_but_the_family_constant_is_refused() {
    for version in [0u32, 2, 99, u32::MAX] {
        let json = format!(
            r#"{{"schemaVersion":{version},"recordRevision":1,"delegationIdHex":"{ID}","state":"ACTIVE"}}"#
        );
        let dto = parse(&json).expect("structurally fine");
        assert_eq!(
            dto.validate(),
            Err(PersistError::UnsupportedSchema),
            "schema {version} must fail closed"
        );
    }
}

#[test]
fn a_zero_revision_is_refused() {
    let json = format!(
        r#"{{"schemaVersion":1,"recordRevision":0,"delegationIdHex":"{ID}","state":"ACTIVE"}}"#
    );
    assert_eq!(
        parse(&json).expect("parses").validate(),
        Err(PersistError::InvalidRevision)
    );
}

#[test]
fn one_delegation_has_exactly_one_spelling() {
    // Two spellings of one id would be two storage keys for one delegation, which is precisely how a
    // terminal record gets bypassed by a second record that says ACTIVE.
    for id in [
        ID.to_uppercase(),
        format!("{}A1", &ID[..62]),
        "a1a1".to_owned(),
        format!("{ID}a1"),
        "z".repeat(64),
        String::new(),
    ] {
        assert_eq!(
            parse(&record(&id, "ACTIVE")).expect("parses").validate(),
            Err(PersistError::InvalidHex),
            "delegation id must be exactly 64 lowercase hex characters: {id:?}"
        );
    }
}

#[test]
fn the_record_carries_no_owner_authority_and_no_secret() {
    // The family has exactly four fields. A signature, key id, budget, expiry, project or repository
    // in this record would make it a second copy of the owner's delegation - and the host-local
    // state exists precisely to OVERRIDE that copy, not to duplicate it.
    let dto = parse(&record(ID, "ACTIVE")).expect("parses");
    let json = dto.to_json().expect("serialises");
    for forbidden in [
        "signature",
        "signingKeyId",
        "budget",
        "expires",
        "project",
        "repository",
        "credential",
        "token",
        "key",
    ] {
        assert!(
            !json.to_lowercase().contains(&forbidden.to_lowercase()),
            "{forbidden} must not be representable in a lifecycle record"
        );
    }
    assert_eq!(json.matches(':').count(), 4, "exactly four fields: {json}");
}
