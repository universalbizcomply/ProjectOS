//! Strictness proof for the durable request-replay record DTO
//! (RUN-TO-COMPLETION HOST ATTESTATION §10C).
//!
//! THE PROPERTY UNDER TEST IS THAT NOTHING PARSES INTO "FRESH". This family has one state word, so
//! the only way a governed request can be fresh is for no record to exist; every malformed,
//! mis-schema'd, mis-spelled or unknown-variant body must therefore FAIL TO PARSE rather than
//! decode into something a reader might treat as permissive.

use projectos_host_persistence::request_replay::REQUEST_IDENTITY_HEX_LEN;
use projectos_host_persistence::version::REQUEST_REPLAY_SCHEMA;
use projectos_host_persistence::{RequestReplayRecordDto, RequestReplayStateDto};

const ID: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

fn well_formed() -> RequestReplayRecordDto {
    RequestReplayRecordDto {
        schema_version: REQUEST_REPLAY_SCHEMA,
        record_revision: 1,
        request_identity_hex: ID.to_owned(),
        state: RequestReplayStateDto::Consumed,
    }
}

fn json(body: &str) -> Result<RequestReplayRecordDto, projectos_host_persistence::PersistError> {
    RequestReplayRecordDto::parse_json(body.as_bytes())
}

fn canonical() -> String {
    well_formed().to_json().expect("serialise")
}

#[test]
fn a_well_formed_record_round_trips() {
    let text = canonical();
    let parsed = json(&text).expect("parse");
    parsed.validate().expect("validate");
    assert_eq!(parsed, well_formed());
}

#[test]
fn the_wire_names_are_camel_case_and_the_state_word_is_screaming() {
    let text = canonical();
    assert!(text.contains("\"schemaVersion\":1"));
    assert!(text.contains("\"recordRevision\":1"));
    assert!(text.contains(&format!("\"requestIdentityHex\":\"{ID}\"")));
    assert!(text.contains("\"state\":\"CONSUMED\""));
}

#[test]
fn the_identity_length_is_exactly_the_digest_width() {
    assert_eq!(REQUEST_IDENTITY_HEX_LEN, 64);
    assert_eq!(ID.len(), REQUEST_IDENTITY_HEX_LEN);
}

#[test]
fn a_wrong_schema_version_is_refused() {
    // Older, newer and zero all fail closed. A reader that accepted a future schema would be
    // guessing at the meaning of a state word it has never seen.
    for v in [0u32, 2, 99] {
        let mut dto = well_formed();
        dto.schema_version = v;
        assert!(dto.validate().is_err(), "schema {v} was accepted");
    }
}

#[test]
fn a_zero_revision_is_refused() {
    let mut dto = well_formed();
    dto.record_revision = 0;
    assert!(dto.validate().is_err());
}

#[test]
fn an_uppercase_identity_is_refused() {
    // Two spellings of one identity would be two storage keys for one governed request, and the
    // second key reads back ABSENT - which is indistinguishable from fresh.
    let mut dto = well_formed();
    dto.request_identity_hex = ID.to_uppercase();
    assert!(dto.validate().is_err());
}

#[test]
fn a_wrong_length_identity_is_refused() {
    for bad in [&ID[..62], &ID[..1], ""] {
        let mut dto = well_formed();
        dto.request_identity_hex = bad.to_owned();
        assert!(dto.validate().is_err(), "identity {bad:?} was accepted");
    }
    let mut long = well_formed();
    long.request_identity_hex = format!("{ID}00");
    assert!(long.validate().is_err());
}

#[test]
fn a_non_hex_identity_is_refused() {
    let mut dto = well_formed();
    dto.request_identity_hex = "z".repeat(REQUEST_IDENTITY_HEX_LEN);
    assert!(dto.validate().is_err());
}

#[test]
fn an_unknown_state_word_does_not_parse() {
    // The vocabulary is closed at ONE word. Anything else is a parse failure, so a future writer
    // cannot introduce a second meaning that an older reader treats permissively - and in
    // particular there is no word that could ever mean "no longer consumed".
    for word in ["FRESH", "RELEASED", "PENDING", "consumed", "Consumed", ""] {
        let text = canonical().replace("CONSUMED", word);
        assert!(json(&text).is_err(), "state {word:?} parsed");
    }
}

#[test]
fn an_unknown_field_does_not_parse() {
    // `deny_unknown_fields`. An injected `fresh`, `permit`, `secret` or `session` field is a parse
    // failure rather than something quietly ignored.
    for injected in [
        "\"fresh\":true,",
        "\"permit\":\"x\",",
        "\"secret\":\"x\",",
        "\"session\":\"x\",",
    ] {
        let text = canonical().replacen('{', &format!("{{{injected}"), 1);
        assert!(json(&text).is_err(), "field {injected} parsed");
    }
}

#[test]
fn a_missing_field_does_not_parse() {
    for missing in [
        "\"schemaVersion\":1,",
        "\"recordRevision\":1,",
        "\"state\":\"CONSUMED\"",
    ] {
        let text = canonical().replace(missing, "").replace(",}", "}");
        assert!(json(&text).is_err(), "record without {missing} parsed");
    }
}

#[test]
fn malformed_json_does_not_parse() {
    for text in ["", "}{", "null", "[]", "\"CONSUMED\"", "{"] {
        assert!(json(text).is_err(), "{text:?} parsed");
    }
}

#[test]
fn the_state_enum_has_exactly_one_variant() {
    // Stated as an exhaustive match: adding a variant makes this fail to compile, which is the point
    // - a second state word in this family would be a durable route from consumed back to fresh, and
    // it must not be possible to add one without this test being revisited.
    let state = RequestReplayStateDto::Consumed;
    let described = match state {
        RequestReplayStateDto::Consumed => "CONSUMED",
    };
    assert_eq!(described, "CONSUMED");
}
