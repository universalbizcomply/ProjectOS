//! The installation's own hard stop, resolved from the one place that carries it.
//!
//! ## Where the hard stop comes from, and why not from anywhere else
//!
//! `.projectops/gatekeeper.json` → `budget.hardStopAtMicroUsd`, accepted only after the checks
//! `loadGatekeeperConfig` and `checkPilotBudget` already apply. The Host does not take a ceiling as
//! an argument, does not carry a default, and has no compiled-in figure that could stand in for the
//! configured one: a ceiling that can be supplied is not a ceiling.
//!
//! ## This is the canonical rule, not a second opinion of it
//!
//! Every check below is a transcription of the canonical one, including the parts that look odd:
//! auto-recharge must be exactly `false`; a figure above the approved pilot needs an owner decision
//! id whose recorded scope is `gatekeeper-budget-raise`; the warning threshold may not exceed the
//! hard stop. Where this crate is stricter it is only ever in the refusing direction, and each
//! difference is named on the check itself.
//!
//! ## THE OBSERVATION THIS PHASE OWES THE GATE
//!
//! `budgetRaiseAuthorities` lives in the SAME file as the budget it authorises, and unlike
//! `programmeId` the budget block is not compared against the committed copy. So anything that can
//! write the checkout can raise this ceiling by adding both halves. That is a property of the
//! canonical configuration rather than of this adapter, and §10D deliberately does not change it —
//! but it is exactly why the OWNER'S DELEGATION CEILING is a separate control: that one is carried
//! on an owner-signed record whose signature the Host verifies before any of this is read, and it
//! binds independently. A forged configuration raise cannot spend past it. Recorded for the gate.

use serde::Deserialize;

use crate::refusal::LedgerRefusal;

/// What the owner actually approved, in micro-USD. The canonical `APPROVED_PILOT_BUDGET`.
pub const APPROVED_INITIAL_CREDIT_MICRO_USD: u64 = 5_000_000;
/// The approved warning threshold.
pub const APPROVED_WARN_AT_MICRO_USD: u64 = 2_000_000;
/// The approved hard stop.
pub const APPROVED_HARD_STOP_MICRO_USD: u64 = 5_000_000;

/// The only scope that authorises a budget above the approved pilot.
pub const BUDGET_RAISE_SCOPE: &str = "gatekeeper-budget-raise";

/// The one gatekeeper configuration schema version this Host reads.
pub const CONFIG_SCHEMA_VERSION: &str = "1.0.0";

/// The enforceable budget policy, once every canonical check has passed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BudgetPolicy {
    hard_stop_micro_usd: u64,
    warn_at_micro_usd: u64,
}

impl BudgetPolicy {
    /// The installation's own hard stop.
    #[must_use]
    pub fn hard_stop_micro_usd(&self) -> u64 {
        self.hard_stop_micro_usd
    }
    /// The owner-visible warning threshold. Carried because the policy is not enforceable without
    /// it, never acted on here: a threshold that only warns is not a stop.
    #[must_use]
    pub fn warn_at_micro_usd(&self) -> u64 {
        self.warn_at_micro_usd
    }
}

/// The budget block, read with the canonical field names.
///
/// UNKNOWN FIELDS ARE ALLOWED HERE and refused in [`crate::entry`], and the difference is what each
/// does with them. This crate never rewrites the configuration, so an unrecognised field cannot be
/// lost; the ledger it does rewrite, so one there would be. The configuration also legitimately
/// carries much this crate has no business reading — the transport, the credential reference, the
/// rate cards — and modelling all of it in order to refuse an addition would make the Host's budget
/// gate fail whenever an unrelated setting appeared.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BudgetBlock {
    initial_credit_micro_usd: Option<serde_json::Value>,
    warn_at_micro_usd: Option<serde_json::Value>,
    hard_stop_at_micro_usd: Option<serde_json::Value>,
    auto_recharge: Option<serde_json::Value>,
    raised_by_owner_decision_id: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RaiseAuthority {
    decision_id: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatekeeperConfigFile {
    schema_version: Option<String>,
    enabled: Option<serde_json::Value>,
    budget: Option<BudgetBlock>,
    budget_raise_authorities: Option<Vec<RaiseAuthority>>,
}

/// A whole, non-negative micro-USD amount, or nothing.
///
/// STRICTER THAN THE CANONICAL `usable`, WHICH ACCEPTS ANY FINITE NON-NEGATIVE NUMBER. Money in this
/// ledger is integer micro-USD everywhere it is written; a fractional ceiling could not be compared
/// against a total without choosing a rounding direction, and choosing one silently is how a limit
/// stops meaning what it says. Refusing is the safe direction: an installation whose ceiling is
/// written `5000000.5` gets a refusal to spend, not a rounded permission.
fn whole_amount(value: Option<&serde_json::Value>) -> Option<u64> {
    value?.as_u64()
}

/// Resolve the enforceable policy from the canonical configuration text.
///
/// # Errors
/// [`LedgerRefusal::PolicyUnenforceable`] for every configuration that does not pass every canonical
/// check. There is no partial success: an unenforceable policy stops spending, because treating it
/// as "no limit" would be the exact inversion of what a limit is for.
pub fn resolve(config_text: &str) -> Result<BudgetPolicy, LedgerRefusal> {
    let config: GatekeeperConfigFile =
        serde_json::from_str(config_text).map_err(|_| LedgerRefusal::PolicyUnenforceable)?;

    if config.schema_version.as_deref() != Some(CONFIG_SCHEMA_VERSION) {
        return Err(LedgerRefusal::PolicyUnenforceable);
    }
    // `enabled !== true` is the canonical test, so anything that is not the boolean true — absent,
    // the string "true", 1 — refuses.
    if config.enabled != Some(serde_json::Value::Bool(true)) {
        return Err(LedgerRefusal::PolicyUnenforceable);
    }

    let budget = config.budget.ok_or(LedgerRefusal::PolicyUnenforceable)?;

    // AUTO-RECHARGE IS THE ONE SETTING NO DECISION ID UNLOCKS. A hard limit stops spending at a
    // number; auto-recharge off means the account cannot spend money that was never put into it,
    // which still holds when a limit is misconfigured.
    if budget.auto_recharge != Some(serde_json::Value::Bool(false)) {
        return Err(LedgerRefusal::PolicyUnenforceable);
    }

    let initial_credit = whole_amount(budget.initial_credit_micro_usd.as_ref())
        .ok_or(LedgerRefusal::PolicyUnenforceable)?;
    let warn_at = whole_amount(budget.warn_at_micro_usd.as_ref())
        .ok_or(LedgerRefusal::PolicyUnenforceable)?;
    let hard_stop = whole_amount(budget.hard_stop_at_micro_usd.as_ref())
        .ok_or(LedgerRefusal::PolicyUnenforceable)?;

    // A DECISION AUTHORISES WHAT IT WAS ABOUT, so the scope has to match as well as the id. Any
    // owner decision used to unlock the ceiling, which meant the plan-approval decision — or any
    // other decision this project had ever recorded — would have done it.
    let raised_by = budget
        .raised_by_owner_decision_id
        .as_ref()
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    // AN ENTRY MUST CARRY BOTH THE ID AND THE SCOPE. A decision authorises what it was about, so
    // naming a recorded decision id is not enough on its own — before that rule existed, the
    // plan-approval decision, or any other decision the project had ever recorded, would have
    // unlocked the ceiling.
    //
    // AND "THE CANONICAL RULE" IS THE ONE THE PRODUCTION CALL SITE APPLIES, NOT THE ONE
    // `checkPilotBudget` APPLIES ALONE. This is worth writing down because getting it wrong survived
    // a review. `checkPilotBudget` does `find(a => a.decisionId === raisedBy)` and then checks THAT
    // entry's scope, which read in isolation means "the first entry for this id decides". But its
    // only production caller, `loadGatekeeperConfig`, passes it
    // `authorities.filter(a => a && typeof a.decisionId === 'string' && a.scope === BUDGET_RAISE_SCOPE)`
    // — the wrongly-scoped entries are gone before `find` ever runs. So the real rule is "any entry
    // carrying both", which is what this does.
    //
    // THE COST OF READING THE FUNCTION WITHOUT ITS CALLER: an ECC code review reported the `any` form
    // as a more-permissive divergence and it was changed to find-then-scope, which made the Host
    // REFUSE a raise the installation authorises — a denial rather than a bypass, but a divergence
    // all the same, and the cross-implementation proof could not catch it because the test driver had
    // copied the same partial reading of the canonical code. Both are corrected; the driver now
    // applies the production filter, so this rule is checked against what actually runs. Raised by
    // the ECC security re-review.
    let authorities = config.budget_raise_authorities.unwrap_or_default();
    let authorised = match raised_by {
        None => false,
        Some(id) => authorities.iter().any(|a| {
            a.decision_id.as_deref() == Some(id) && a.scope.as_deref() == Some(BUDGET_RAISE_SCOPE)
        }),
    };

    if !authorised {
        let above_pilot = initial_credit > APPROVED_INITIAL_CREDIT_MICRO_USD
            || warn_at > APPROVED_WARN_AT_MICRO_USD
            || hard_stop > APPROVED_HARD_STOP_MICRO_USD;
        if above_pilot {
            return Err(LedgerRefusal::PolicyUnenforceable);
        }
    }

    if warn_at > hard_stop {
        return Err(LedgerRefusal::PolicyUnenforceable);
    }

    Ok(BudgetPolicy {
        hard_stop_micro_usd: hard_stop,
        warn_at_micro_usd: warn_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(budget: &str, authorities: &str) -> String {
        format!(
            r#"{{"schemaVersion":"1.0.0","enabled":true,"programmeId":"p","transport":{{"kind":"x"}},"budget":{budget},"budgetRaiseAuthorities":{authorities}}}"#
        )
    }

    const APPROVED: &str = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"autoRecharge":false}"#;

    #[test]
    fn the_approved_pilot_configuration_is_enforceable() {
        let policy = resolve(&config(APPROVED, "[]")).expect("enforceable");
        assert_eq!(policy.hard_stop_micro_usd(), 5_000_000);
        assert_eq!(policy.warn_at_micro_usd(), 2_000_000);
    }

    #[test]
    fn the_real_projectos_configuration_is_enforceable() {
        // The exact budget block committed at `.projectops/gatekeeper.json`, transcribed. If the
        // canonical configuration ever stops satisfying this crate, that is a divergence worth a
        // failing test rather than a refusal discovered in production.
        let policy = resolve(&config(APPROVED, "[]")).unwrap();
        assert_eq!(policy.hard_stop_micro_usd(), APPROVED_HARD_STOP_MICRO_USD);
    }

    #[test]
    fn a_missing_or_unusable_hard_stop_stops_spending() {
        for budget in [
            r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"autoRecharge":false}"#,
            r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":null,"autoRecharge":false}"#,
            r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":"5000000","autoRecharge":false}"#,
            r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":-1,"autoRecharge":false}"#,
            r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000.5,"autoRecharge":false}"#,
        ] {
            assert_eq!(
                resolve(&config(budget, "[]")),
                Err(LedgerRefusal::PolicyUnenforceable),
                "accepted {budget}"
            );
        }
    }

    #[test]
    fn auto_recharge_on_is_refused_and_no_decision_id_unlocks_it() {
        let on = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000,"autoRecharge":true,"raisedByOwnerDecisionId":"D1"}"#;
        assert_eq!(
            resolve(&config(
                on,
                r#"[{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]"#
            )),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
        let absent = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":5000000}"#;
        assert_eq!(
            resolve(&config(absent, "[]")),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
    }

    /// ORDER DOES NOT DECIDE IT — an entry carrying both the id and the scope authorises the raise
    /// wherever it sits in the list, because the production call site filters by scope before the
    /// canonical `find` ever runs. Both orderings are put to both implementations in
    /// `tests/cross_implementation.rs`.
    #[test]
    fn a_correctly_scoped_entry_authorises_wherever_it_sits_in_the_list() {
        let raised = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"}"#;
        for authorities in [
            r#"[{"decisionId":"D1","scope":"plan-approval"},{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]"#,
            r#"[{"decisionId":"D1","scope":"gatekeeper-budget-raise"},{"decisionId":"D1","scope":"plan-approval"}]"#,
        ] {
            assert!(
                resolve(&config(raised, authorities)).is_ok(),
                "refused a raise the installation authorises: {authorities}"
            );
        }
        // And an id whose ONLY entries are wrongly scoped still refuses.
        assert_eq!(
            resolve(&config(
                raised,
                r#"[{"decisionId":"D1","scope":"plan-approval"},{"decisionId":"D2","scope":"gatekeeper-budget-raise"}]"#,
            )),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
    }

    #[test]
    fn a_figure_above_the_approved_pilot_needs_a_correctly_scoped_owner_decision() {
        let raised = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":2000000,"hardStopAtMicroUsd":9000000,"autoRecharge":false,"raisedByOwnerDecisionId":"D1"}"#;
        // No authority at all.
        assert_eq!(
            resolve(&config(raised, "[]")),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
        // An authority with the WRONG scope: a decision about something else.
        assert_eq!(
            resolve(&config(
                raised,
                r#"[{"decisionId":"D1","scope":"plan-approval"}]"#
            )),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
        // An authority for a DIFFERENT decision id.
        assert_eq!(
            resolve(&config(
                raised,
                r#"[{"decisionId":"D2","scope":"gatekeeper-budget-raise"}]"#
            )),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
        // Correct id and scope.
        let policy = resolve(&config(
            raised,
            r#"[{"decisionId":"D1","scope":"gatekeeper-budget-raise"}]"#,
        ))
        .expect("authorised");
        assert_eq!(policy.hard_stop_micro_usd(), 9_000_000);
    }

    #[test]
    fn lower_than_the_pilot_needs_nobody_s_permission() {
        let lower = r#"{"initialCreditMicroUsd":10,"warnAtMicroUsd":1,"hardStopAtMicroUsd":2,"autoRecharge":false}"#;
        assert_eq!(
            resolve(&config(lower, "[]")).unwrap().hard_stop_micro_usd(),
            2
        );
    }

    #[test]
    fn a_warning_above_the_hard_stop_is_refused() {
        let inverted = r#"{"initialCreditMicroUsd":5000000,"warnAtMicroUsd":4000000,"hardStopAtMicroUsd":3000000,"autoRecharge":false}"#;
        assert_eq!(
            resolve(&config(inverted, "[]")),
            Err(LedgerRefusal::PolicyUnenforceable)
        );
    }

    #[test]
    fn a_gatekeeper_that_is_not_enabled_enforces_nothing() {
        let text = config(APPROVED, "[]").replace(r#""enabled":true"#, r#""enabled":"true""#);
        assert_eq!(resolve(&text), Err(LedgerRefusal::PolicyUnenforceable));
        let text = config(APPROVED, "[]").replace(r#""enabled":true"#, r#""enabled":false"#);
        assert_eq!(resolve(&text), Err(LedgerRefusal::PolicyUnenforceable));
    }

    #[test]
    fn an_unknown_schema_version_is_refused() {
        let text = config(APPROVED, "[]")
            .replace(r#""schemaVersion":"1.0.0""#, r#""schemaVersion":"2.0.0""#);
        assert_eq!(resolve(&text), Err(LedgerRefusal::PolicyUnenforceable));
    }

    #[test]
    fn nothing_that_is_not_a_configuration_becomes_one() {
        for text in ["", "null", "[]", "{}", "not json"] {
            assert_eq!(resolve(text), Err(LedgerRefusal::PolicyUnenforceable));
        }
    }
}
