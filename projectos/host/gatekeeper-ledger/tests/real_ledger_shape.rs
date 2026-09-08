//! THE REAL RECORD, READ AND RE-RENDERED — WITHOUT TOUCHING IT.
//!
//! `.projectops/gatekeeper-ledger.json` in this very checkout holds ProjectOS's real historical
//! spend: fifty-eight recorded calls at the time §10D was written, including reservations that were
//! never settled. If the Host's model of that document were wrong in any detail — a field it does not
//! know, a number it cannot represent, a key order it would rewrite — then the first Host admission
//! against a real project would either refuse or silently reformat the owner's own evidence.
//!
//! So this reads that file, parses it with the Host's strict model, renders it back, and compares
//! the bytes. It OPENS THE FILE READ-ONLY and writes nothing anywhere: the proof is that the two
//! strings are equal, which needs no write to establish.

use std::path::{Path, PathBuf};

use projectos_host_gatekeeper_ledger::LedgerDocument;

/// The repository's own ledger, four levels above this crate.
fn repository_ledger() -> Option<PathBuf> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join(".projectops")
        .join("gatekeeper-ledger.json");
    path.is_file().then_some(path)
}

#[test]
fn the_real_projectos_ledger_round_trips_byte_for_byte() {
    let Some(path) = repository_ledger() else {
        println!("SKIPPED: this checkout has no .projectops/gatekeeper-ledger.json");
        return;
    };
    let original = std::fs::read_to_string(&path).expect("readable");
    let parsed = LedgerDocument::parse(&original)
        .expect("the Host's model does not describe the real ProjectOS ledger");
    assert_eq!(
        parsed.render().expect("renders"),
        original,
        "re-rendering the real ledger would have changed its bytes"
    );

    // And the figures it reports are the ones the record actually carries.
    assert!(!parsed.entries.is_empty(), "the real ledger is empty");
    let months: Vec<&str> = parsed.entries.iter().map(|e| &e.at[..7]).collect();
    for month in months {
        assert!(
            parsed.month_total_micro_usd(month).is_ok(),
            "a real month could not be totalled"
        );
    }
}
