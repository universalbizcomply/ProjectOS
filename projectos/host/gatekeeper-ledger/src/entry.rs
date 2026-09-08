//! The canonical ledger document, read strictly and written back in the canonical shape.
//!
//! ## The schema is not this crate's to choose
//!
//! `.projectops/gatekeeper-ledger.json` already exists, holds real historical spend, and is written
//! by `writeLedger` in `projectos/agent/src/loop/gatekeeperConfig.ts` as
//! `JSON.stringify({ schemaVersion, entries }, null, 2) + "\n"`. Every type below is a transcription
//! of what that file already contains — nothing is added, renamed, reordered or migrated. The field
//! ORDER of the structs is load-bearing: `serde`'s derive emits fields in declaration order, so the
//! order here is what makes a Host-written document byte-identical to a Node-written one, which
//! `tests/canonical_bytes.rs` checks against the real file.
//!
//! ## Strict where the canonical reader is forgiving, and only in the refusing direction
//!
//! `readLedger` answers `[]` for a file it cannot parse. That is right for the agent — an absent
//! ledger really is an empty one — but "unparseable" and "empty" are the same answer there, and an
//! empty ledger is an OPEN BUDGET. A Host that read a corrupted ledger as empty would admit spending
//! that the true record forbids, which is the one direction a budget must never fail in. So an
//! ABSENT file is empty here too, and anything else that is not exactly the canonical document is a
//! refusal.
//!
//! `deny_unknown_fields` is the same argument applied to rewriting: this crate writes the whole
//! document back, so a field it did not model would be silently dropped from the record of what was
//! spent. Refusing to spend is better than quietly editing the evidence.

use serde::{Deserialize, Serialize};

use crate::refusal::LedgerRefusal;

/// The one schema version this Host reads and writes. A different one is a refusal, never a guess.
pub const LEDGER_SCHEMA_VERSION: &str = "1.0.0";

/// The token shape of one gatekeeper call, exactly as the canonical `TokenUsage` carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    /// Present only when the provider reported it. `skip_serializing_if` keeps an entry that had no
    /// cached-token figure from acquiring one on rewrite.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: u64,
}

impl TokenUsage {
    /// A reservation's usage: the zero pair the canonical admission writes.
    #[must_use]
    pub fn none_yet() -> Self {
        Self {
            input_tokens: 0,
            cached_input_tokens: None,
            output_tokens: 0,
        }
    }

    /// WHAT MAKES AN ENTRY A CALL RATHER THAN A RESERVATION IS RECORDED USAGE.
    ///
    /// The canonical implementation's own rule, in its own words, and this crate uses the same one
    /// rather than the `unresolved` mark: the mark is a note a process leaves for itself and can be
    /// missing for honest reasons (every entry written before it existed carries none), while usage
    /// is the thing only a real answer produces.
    #[must_use]
    pub fn is_a_call(&self) -> bool {
        self.input_tokens != 0 || self.output_tokens != 0
    }
}

/// One recorded call or one outstanding reservation.
///
/// FIELD ORDER IS THE CANONICAL WRITE ORDER. `admitGatekeeperSpend` writes
/// `requestId, projectId, phaseId, model, usage, costMicroUsd, unresolved, at`; `recordCall` writes
/// the same without `unresolved`. One struct with an optional, skipped `unresolved` reproduces both
/// exactly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LedgerEntry {
    pub request_id: String,
    pub project_id: String,
    pub phase_id: String,
    pub model: String,
    pub usage: TokenUsage,
    pub cost_micro_usd: u64,
    /// Set when a reservation was admitted and no answer has been recorded against it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unresolved: Option<bool>,
    /// ISO-8601. Its leading `YYYY-MM` is what the monthly total groups on.
    pub at: String,
}

impl LedgerEntry {
    /// Whether this entry counts toward the month the canonical rule names.
    ///
    /// PREFIX MATCH, NEVER A PARSE, and that is the canonical rule rather than an optimisation:
    /// parsing would silently reinterpret a malformed timestamp into some real month and attribute
    /// spend to it.
    #[must_use]
    pub fn falls_in_month(&self, month: &str) -> bool {
        self.at.starts_with(month)
    }

    /// Whether this entry is an outstanding reservation rather than a call that happened.
    #[must_use]
    pub fn is_outstanding(&self) -> bool {
        !self.usage.is_a_call()
    }
}

/// The whole canonical document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LedgerDocument {
    pub schema_version: String,
    pub entries: Vec<LedgerEntry>,
}

impl LedgerDocument {
    /// The document an absent ledger stands for.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            schema_version: LEDGER_SCHEMA_VERSION.to_owned(),
            entries: Vec::new(),
        }
    }

    /// Parse the canonical document, refusing anything that is not exactly it.
    ///
    /// # Errors
    /// [`LedgerRefusal::LedgerMalformed`] for a document, an entry or a number that is not canonical;
    /// [`LedgerRefusal::TooManyEntries`] beyond the bound.
    pub fn parse(text: &str) -> Result<Self, LedgerRefusal> {
        let document: Self =
            serde_json::from_str(text).map_err(|_| LedgerRefusal::LedgerMalformed)?;
        if document.schema_version != LEDGER_SCHEMA_VERSION {
            return Err(LedgerRefusal::LedgerMalformed);
        }
        if document.entries.len() > crate::MAX_LEDGER_ENTRIES {
            return Err(LedgerRefusal::TooManyEntries);
        }
        for entry in &document.entries {
            // AN ENTRY WHOSE ID COULD NOT ADDRESS A RECORD IS NOT AN ENTRY THIS HOST WILL ACCOUNT
            // FOR. The canonical implementation applies exactly this rule before an id becomes a
            // filename; applying it on the way in means a ledger cannot hold an identity that no
            // process could ever settle or release.
            crate::check_request_id(&entry.request_id)?;
            crate::check_label(&entry.project_id)?;
            crate::check_label(&entry.phase_id)?;
            crate::check_label(&entry.model)?;
            crate::check_label(&entry.at)?;
        }
        Ok(document)
    }

    /// Render the canonical document exactly as `JSON.stringify(doc, null, 2) + "\n"` does.
    ///
    /// # Errors
    /// [`LedgerRefusal::LedgerMalformed`] if the document cannot be rendered, which nothing in this
    /// crate can construct.
    pub fn render(&self) -> Result<String, LedgerRefusal> {
        let mut text =
            serde_json::to_string_pretty(self).map_err(|_| LedgerRefusal::LedgerMalformed)?;
        text.push('\n');
        Ok(text)
    }

    /// The entries that count, with repeats of a request id dropped.
    ///
    /// FIRST WINS, which is the canonical `dedupeEntries` rule and its reasoning: a restart replays
    /// a call that already succeeded, the original entry is the true one, and letting a replay
    /// overwrite it would let a retry quietly restate what something cost.
    ///
    /// LINEAR, NOT QUADRATIC, AND THE DIFFERENCE IS PAID UNDER THE LOCK. This ran a `Vec::contains`
    /// per entry, and it is called twice per admission — for the month total and for the in-flight
    /// count — while holding the lock that serialises every other writer, Host and agent alike. At
    /// the entry bound that is on the order of 2 x 8192^2 string comparisons of latency imposed on
    /// everybody else. A set costs nothing and removes it. Raised by the ECC security review.
    #[must_use]
    pub fn deduplicated(&self) -> Vec<&LedgerEntry> {
        let mut seen: std::collections::HashSet<&str> =
            std::collections::HashSet::with_capacity(self.entries.len());
        let mut out = Vec::with_capacity(self.entries.len());
        for entry in &self.entries {
            if seen.insert(entry.request_id.as_str()) {
                out.push(entry);
            }
        }
        out
    }

    /// Everything charged to one month: committed spend PLUS every outstanding reservation.
    ///
    /// THE MONTHLY TOTAL IS THE SPEND LIMIT'S TOTAL, AND A SPEND LIMIT IS PER ACCOUNT. It is summed
    /// across every project in the ledger, which is the canonical `summariseLedger` rule.
    ///
    /// RESERVATIONS ARE COUNTED AT THEIR ESTIMATE, also canonically: a provisional entry carries the
    /// estimate as its cost, so a second admission sees the first call's cost already counted and is
    /// refused by the same hard stop. That is the whole of the concurrency defence.
    ///
    /// # Errors
    /// [`LedgerRefusal::ArithmeticOverflow`] if the sum does not fit.
    pub fn month_total_micro_usd(&self, month: &str) -> Result<u64, LedgerRefusal> {
        let mut total: u64 = 0;
        for entry in self.deduplicated() {
            if entry.falls_in_month(month) {
                total = total
                    .checked_add(entry.cost_micro_usd)
                    .ok_or(LedgerRefusal::ArithmeticOverflow)?;
            }
        }
        Ok(total)
    }

    /// How many reservations are in flight, across every request id.
    #[must_use]
    pub fn outstanding_count(&self) -> usize {
        self.deduplicated()
            .into_iter()
            .filter(|e| e.is_outstanding())
            .count()
    }

    /// The entry for one request id, if the ledger holds one.
    #[must_use]
    pub fn find(&self, request_id: &str) -> Option<&LedgerEntry> {
        self.entries.iter().find(|e| e.request_id == request_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANONICAL: &str = r#"{
  "schemaVersion": "1.0.0",
  "entries": [
    {
      "requestId": "GKREQ-aabc540265765c58d9c8e98b",
      "projectId": "projectos",
      "phaseId": "PHASE-ONE",
      "model": "gpt-5.6-terra",
      "usage": {
        "inputTokens": 1599,
        "cachedInputTokens": 0,
        "outputTokens": 463
      },
      "costMicroUsd": 6629,
      "at": "2026-08-18T02:12:28.226Z"
    },
    {
      "requestId": "GKHOST-0011223344556677",
      "projectId": "projectos",
      "phaseId": "PHASE-ONE",
      "model": "gpt-5.6-luna",
      "usage": {
        "inputTokens": 0,
        "outputTokens": 0
      },
      "costMicroUsd": 1333,
      "unresolved": true,
      "at": "2026-09-05T16:10:17.422Z"
    }
  ]
}
"#;

    #[test]
    fn the_canonical_document_round_trips_byte_for_byte() {
        let parsed = LedgerDocument::parse(CANONICAL).expect("canonical");
        assert_eq!(parsed.render().unwrap(), CANONICAL);
    }

    #[test]
    fn usage_decides_whether_an_entry_is_a_call() {
        let parsed = LedgerDocument::parse(CANONICAL).unwrap();
        assert!(parsed.entries[0].usage.is_a_call());
        assert!(!parsed.entries[1].usage.is_a_call());
        assert_eq!(parsed.outstanding_count(), 1);
    }

    #[test]
    fn the_month_total_is_a_prefix_match_over_deduplicated_entries() {
        let parsed = LedgerDocument::parse(CANONICAL).unwrap();
        assert_eq!(parsed.month_total_micro_usd("2026-08").unwrap(), 6629);
        assert_eq!(parsed.month_total_micro_usd("2026-09").unwrap(), 1333);
        assert_eq!(parsed.month_total_micro_usd("2026-10").unwrap(), 0);
    }

    #[test]
    fn a_repeat_of_a_request_id_is_counted_once_and_the_first_wins() {
        let text = CANONICAL.replace("GKHOST-0011223344556677", "GKREQ-aabc540265765c58d9c8e98b");
        let parsed = LedgerDocument::parse(&text).unwrap();
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.deduplicated().len(), 1);
        // The FIRST entry is the one that counts, so August keeps its cost and September gains none.
        assert_eq!(parsed.month_total_micro_usd("2026-08").unwrap(), 6629);
        assert_eq!(parsed.month_total_micro_usd("2026-09").unwrap(), 0);
    }

    #[test]
    fn an_unknown_field_is_refused_rather_than_dropped_on_rewrite() {
        let text = CANONICAL.replace(
            r#""costMicroUsd": 6629,"#,
            r#""costMicroUsd": 6629,
      "somethingNewer": 1,"#,
        );
        assert_eq!(
            LedgerDocument::parse(&text),
            Err(LedgerRefusal::LedgerMalformed)
        );
    }

    #[test]
    fn a_malformed_ledger_is_never_an_empty_budget() {
        for text in [
            "",
            "null",
            "[]",
            "{}",
            r#"{"schemaVersion":"1.0.0"}"#,
            r#"{"schemaVersion":"2.0.0","entries":[]}"#,
            r#"{"schemaVersion":"1.0.0","entries":{}}"#,
            r#"{"schemaVersion":"1.0.0","entries":[{"requestId":"GKREQ-aa"}]}"#,
        ] {
            assert!(
                LedgerDocument::parse(text).is_err(),
                "parsed what is not a canonical ledger: {text}"
            );
        }
    }

    #[test]
    fn a_negative_or_fractional_cost_is_refused_rather_than_treated_as_zero() {
        for bad in ["-1", "1.5", "1e3", "null", r#""6629""#] {
            let text = CANONICAL.replace(
                "\"costMicroUsd\": 6629",
                &format!("\"costMicroUsd\": {bad}"),
            );
            assert_eq!(
                LedgerDocument::parse(&text),
                Err(LedgerRefusal::LedgerMalformed),
                "accepted cost {bad}"
            );
        }
    }

    #[test]
    fn an_entry_whose_id_could_never_address_a_record_is_refused() {
        let text = CANONICAL.replace("GKHOST-0011223344556677", "../../escape");
        assert_eq!(
            LedgerDocument::parse(&text),
            Err(LedgerRefusal::RequestIdMalformed)
        );
    }

    #[test]
    fn an_overflowing_month_is_refused_rather_than_wrapped() {
        let text = CANONICAL
            .replace(
                "\"costMicroUsd\": 6629",
                &format!("\"costMicroUsd\": {}", u64::MAX),
            )
            .replace("2026-09-05T16:10:17.422Z", "2026-08-05T16:10:17.422Z")
            .replace("\"costMicroUsd\": 1333", "\"costMicroUsd\": 2");
        let parsed = LedgerDocument::parse(&text).unwrap();
        assert_eq!(
            parsed.month_total_micro_usd("2026-08"),
            Err(LedgerRefusal::ArithmeticOverflow)
        );
    }

    #[test]
    fn too_many_entries_is_a_refusal() {
        let one = r#"{"requestId":"GKREQ-aaaa","projectId":"p","phaseId":"f","model":"m","usage":{"inputTokens":0,"outputTokens":0},"costMicroUsd":0,"at":"2026-09-01T00:00:00Z"}"#;
        let many = vec![one; crate::MAX_LEDGER_ENTRIES + 1].join(",");
        let text = format!(r#"{{"schemaVersion":"1.0.0","entries":[{many}]}}"#);
        assert_eq!(
            LedgerDocument::parse(&text),
            Err(LedgerRefusal::TooManyEntries)
        );
    }
}
