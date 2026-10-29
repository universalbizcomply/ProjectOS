"use strict";
/**
 * HARD SPEND CAPS — PROJECTOS-KERNEL-COST-CAP1A.
 *
 * A monthly stop already refused the call that would cross it, before dispatch. What it could not do
 * was stop ONE phase, or ONE day, from spending the whole month first. This pins the shape of each rule
 * that closes that, because every way of undoing one reads reasonably in a diff:
 *
 *   CC-1 "a missing cap means no cap"                 — and an absent limit authorises unlimited spend
 *   CC-2 "the month is the only bound that matters"    — and one phase or one night spends the month
 *   CC-3 "an unreadable total is zero"                 — and the cap becomes a free pass
 *   CC-4 "the day is just a label"                     — and the day total silently counts nothing
 *   CC-5 "the working copy is the config"              — and a cap is raised without the commit gate
 *   CC-6 "the config loader need not check the caps"   — and a broken policy reaches the loop
 *   CC-7 "the day can be left out of the scope"        — and the serialised admission never sees it
 *
 * Added after the ECC SECURITY review (H1, H2, M1, M3, L1):
 *
 *   CC-8  "prices are just configuration"              — and a $0 working-copy price makes every cap unlimited
 *   CC-9  "an unreadable ledger is an empty one"        — and the caps reset and the history is overwritten
 *   CC-10 "any timestamp will do"                       — and a call is booked outside every day and month
 *   CC-11 "the display check is the enforcement check"  — and the caps are optional again
 *   CC-12 "the raise authority can live in the working copy" — and the pilot ceiling is self-raised
 *   CC-13 "a failed read, an unattributed entry, a NaN settlement" — each resets or bricks the caps
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT
 * rule fires. Comments are stripped first. Reads files; runs nothing, calls no provider.
 *
 * WHAT THIS DOES NOT COVER, stated: worker calls go through the owner's local Claude Code CLI, which
 * has no metered per-call price, so the caps govern the metered provider calls (gatekeeper, closure,
 * reconciliation) that pass through `authoriseRequestSpend`.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const LEDGER_REL = "projectos/core/src/gatekeeperCostLedger.ts";
const CONFIG_REL = "projectos/agent/src/loop/gatekeeperConfig.ts";
const TURN_REL = "projectos/agent/src/loop/gatekeeperTurn.ts";
const CLOSURE_TURN_REL = "projectos/agent/src/loop/closureTurn.ts";
const SOURCES = [LEDGER_REL, CONFIG_REL, TURN_REL, CLOSURE_TURN_REL];

const TESTS = {
  "projectos/agent/test/gatekeeperTurn.test.ts": [
    "refuses a call that would cross the PER-PHASE cap, with nothing sent, naming the cap and the total",
    "refuses a call that would cross the PER-DAY cap, counting another phase's spend that day",
    "refuses when a cap is MISSING, never treating it as unlimited",
  ],
  "projectos/agent/test/gatekeeperDelegationAuthority.test.ts": [
    "[COST-CAP] a cap raised in the working copy alone is refused; limits are read from the committed file",
    "[COST-CAP] a committed budget with no per-day cap is a refusal, not unlimited",
    "[COST-CAP] a price changed in the working copy alone is refused (ECC SECURITY H1)",
    "[COST-CAP] a committed price of zero is refused, because it would price every call at $0",
  ],
  "projectos/agent/test/gatekeeperSpendAdmission.test.ts": [
    "refuses a call that would cross the per-phase cap, naming the cap and what the phase has spent",
    "refuses a call that would cross the per-day cap, counting an offset timestamp on the same UTC day",
    "refuses an UNREADABLE ledger and leaves it exactly as it was",
    "refuses a request time that is not a canonical instant, so nothing can be booked outside every total",
    "[R1] refuses when the ledger EXISTS but its read failed, and keeps the history",
    "[R2] refuses an entry that cannot be attributed to a phase, day or month",
    "[L-c] settlement never writes a cost it could not compute",
  ],
  "projectos/core/test/gatekeeper-cost-ledger.test.ts": [
    "counts only the named day's spend, across every phase and project",
    "refuses a total it cannot read rather than reading it as nothing spent",
    "prices a call with an unusable rate card as NaN, never as free (H1)",
    "makes every total unreadable when one entry cost is unreadable, and the gate refuses (H2)",
    "groups days and months by the UTC instant, not the written prefix (M1)",
    "keeps a month-only display policy usable, while spend still refuses without the caps (M3)",
  ],
};

const PIN = {
  phaseCapRequired: "if (!usable(policy?.phaseHardStopAtMicroUsd)) {",
  dayCapRequired: "if (!usable(policy?.dayHardStopAtMicroUsd)) {",
  phaseBound: "['the phase', totals.phaseMicroUsd, 'the per-phase cap', policy.phaseHardStopAtMicroUsd as number],",
  dayBound: "['the day', totals.dayMicroUsd, 'the per-day cap', policy.dayHardStopAtMicroUsd as number],",
  monthBound: "['the month', verdict.spentMicroUsd, 'the hard stop', policy.hardStopAtMicroUsd],",
  allowedOnlyIfNoneCrossed: "return { allowed: crossed.length === 0, reasons: [...reasons, ...crossed] };",
  unreadable: "if (typeof spent !== 'number' || !Number.isFinite(spent) || spent < 0) {",
  dayTotal: "dayMicroUsd: scope.day === undefined ? month : day,",
  dayMatch: "if (scope.day !== undefined && instant !== null && instant.startsWith(scope.day)) day += cost;",
  capsCompared: "const capsDiffer = BUDGET_CAP_FIELDS.filter((f) => budgetRaw[f] !== committedBudget[f]);",
  committedPolicy: "budget: budgetPolicyFrom(committedBudget),",
  configRefusesBroken: "reasons.push(...policyProblems(budgetPolicyFrom(committedBudget)), ...capProblems(budgetPolicyFrom(committedBudget)));",
  admissionDay: "day: period.day,",
  turnDay: "...(ledgerPeriod(input.at) ?? { month: '' }),",
  pricingCompared: "const pricingDiffers = PRICING_FIELDS.filter((f) => JSON.stringify(raw[f]) !== JSON.stringify(committedGatekeeper?.[f]));",
  pricingCommitted: "rateCards: committedRateCards,",
  cardsValidated: "reasons.push(...rateCardProblems(card));",
  unusablePriceNaN: "if (rateCardProblems(rate).length > 0) return Number.NaN;",
  strictAdmission: "const read = readLedgerStrict(sys, root);\n      if (!read.ok) return { allowed: false,",
  unreadableCost: "if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) unreadable = true;",
  unreadableTotals: "if (unreadable) {",
  canonicalTime: "if (period === null) return { allowed: false,",
  utcGrouping: "const instant = utcInstant(entry.at);",
  capsEnforced: "const caps = capProblems(policy);",
  committedPilot: "initialCreditMicroUsd: committedBudget['initialCreditMicroUsd'],",
  committedAuthorities: "const authorities = Array.isArray(committedGatekeeper?.['budgetRaiseAuthorities'])",
  failedReadRefused: "return sys.exists(path) ? { ok: false, problem: `${GATEKEEPER_LEDGER_REL} exists but could not be read` } : { ok: true, entries: [] };",
  attributionRequired: "typeof r['projectId'] !== 'string' || typeof r['phaseId'] !== 'string' || utcInstant(r['at']) === null ||",
  attributionUnreadable: "if (typeof entry.projectId !== 'string' || typeof entry.phaseId !== 'string' || utcInstant(entry.at) === null) unreadable = true;",
  settleRefusesNonFinite: "if (entry !== null && !(typeof entry.costMicroUsd === 'number' && Number.isFinite(entry.costMicroUsd) && entry.costMicroUsd >= 0)) return;",
};

const MUTATIONS = [
  { name: "phase-cap-optional", rule: "CC-1", rel: LEDGER_REL, from: PIN.phaseCapRequired, to: "if (false) {" },
  { name: "day-cap-optional", rule: "CC-1", rel: LEDGER_REL, from: PIN.dayCapRequired, to: "if (false) {" },
  { name: "no-phase-bound", rule: "CC-2", rel: LEDGER_REL, from: PIN.phaseBound, to: "" },
  { name: "no-day-bound", rule: "CC-2", rel: LEDGER_REL, from: PIN.dayBound, to: "" },
  { name: "crossing-allowed", rule: "CC-2", rel: LEDGER_REL, from: PIN.allowedOnlyIfNoneCrossed, to: "return { allowed: true, reasons };" },
  { name: "unreadable-is-zero", rule: "CC-3", rel: LEDGER_REL, from: PIN.unreadable, to: "if (false) {" },
  { name: "day-counts-nothing", rule: "CC-4", rel: LEDGER_REL, from: PIN.dayTotal, to: "dayMicroUsd: 0," },
  { name: "working-copy-caps", rule: "CC-5", rel: CONFIG_REL, from: PIN.committedPolicy, to: "budget: budgetPolicyFrom(budgetRaw)," },
  { name: "caps-not-compared", rule: "CC-5", rel: CONFIG_REL, from: PIN.capsCompared, to: "const capsDiffer: string[] = [];" },
  { name: "config-accepts-broken-policy", rule: "CC-6", rel: CONFIG_REL, from: PIN.configRefusesBroken, to: "" },
  { name: "admission-without-day", rule: "CC-7", rel: CONFIG_REL, from: PIN.admissionDay, to: "" },
  { name: "turn-without-day", rule: "CC-7", rel: TURN_REL, from: PIN.turnDay, to: "month: input.at.slice(0, 7)," },
  { name: "failed-read-is-empty", rule: "CC-13", rel: CONFIG_REL, from: PIN.failedReadRefused, to: "return { ok: true, entries: [] };" },
  { name: "unattributed-entry-admitted", rule: "CC-13", rel: CONFIG_REL, from: PIN.attributionRequired, to: "" },
  { name: "unattributed-entry-excluded", rule: "CC-13", rel: LEDGER_REL, from: PIN.attributionUnreadable, to: "" },
  { name: "settle-writes-nan", rule: "CC-13", rel: CONFIG_REL, from: PIN.settleRefusesNonFinite, to: "" },
  { name: "working-copy-prices", rule: "CC-8", rel: CONFIG_REL, from: PIN.pricingCommitted, to: "rateCards," },
  { name: "prices-not-compared", rule: "CC-8", rel: CONFIG_REL, from: PIN.pricingCompared, to: "const pricingDiffers: string[] = [];" },
  { name: "cards-not-validated", rule: "CC-8", rel: CONFIG_REL, from: PIN.cardsValidated, to: "" },
  { name: "unusable-price-is-free", rule: "CC-8", rel: LEDGER_REL, from: PIN.unusablePriceNaN, to: "" },
  { name: "lenient-admission-read", rule: "CC-9", rel: CONFIG_REL, from: "const read = readLedgerStrict(sys, root);\n      if (!read.ok) return { allowed: false,", to: "const read = { ok: true, entries: readLedger(sys, root) } as const;\n      if (!read.ok) return { allowed: false," },
  { name: "unreadable-cost-is-zero", rule: "CC-9", rel: LEDGER_REL, from: PIN.unreadableCost, to: "" },
  { name: "any-request-time", rule: "CC-10", rel: CONFIG_REL, from: PIN.canonicalTime, to: "if (false) return { allowed: false," },
  { name: "prefix-grouping", rule: "CC-10", rel: LEDGER_REL, from: PIN.utcGrouping, to: "const instant = typeof entry.at === 'string' ? entry.at : null;" },
  { name: "caps-not-enforced", rule: "CC-11", rel: LEDGER_REL, from: PIN.capsEnforced, to: "const caps: string[] = [];" },
  { name: "working-copy-pilot", rule: "CC-12", rel: CONFIG_REL, from: PIN.committedPilot, to: "initialCreditMicroUsd: budgetRaw['initialCreditMicroUsd']," },
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings — the same walk `val-projectos-boot-continue1a` uses. */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  const src = {};
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("CC-0", `${rel} is missing`);
      return errors;
    }
    src[rel] = code(raw[rel]);
  }
  const ledger = src[LEDGER_REL];
  const config = src[CONFIG_REL];
  if (!ledger.includes(PIN.phaseCapRequired) || !ledger.includes(PIN.dayCapRequired)) {
    E("CC-1", "policyProblems no longer refuses a missing per-phase or per-day cap");
  }
  if (![PIN.phaseBound, PIN.dayBound, PIN.monthBound, PIN.allowedOnlyIfNoneCrossed].every((p) => ledger.includes(p))) {
    E("CC-2", "authoriseRequestSpend no longer refuses a call that crosses the phase, day or month cap");
  }
  if (!ledger.includes(PIN.unreadable)) E("CC-3", "an unreadable phase or day total is no longer refused");
  if (!ledger.includes(PIN.dayTotal) || !ledger.includes(PIN.dayMatch)) {
    E("CC-4", "summariseLedger no longer totals the named day, or counts less than the month without one");
  }
  if (!config.includes(PIN.capsCompared) || !config.includes(PIN.committedPolicy)) {
    E("CC-5", "the caps are not read from the committed gatekeeper config only");
  }
  if (!config.includes(PIN.configRefusesBroken)) E("CC-6", "the config loader no longer refuses a missing or unusable cap");
  if (!config.includes(PIN.admissionDay) || !src[TURN_REL].includes(PIN.turnDay) || !src[CLOSURE_TURN_REL].includes(PIN.turnDay)) {
    E("CC-7", "the admission or a turn no longer passes the day into the ledger scope");
  }
  if (![PIN.pricingCompared, PIN.pricingCommitted, PIN.cardsValidated].every((p) => config.includes(p)) || !ledger.includes(PIN.unusablePriceNaN)) {
    E("CC-8", "prices are not committed-only and validated, or an unusable price is not refused");
  }
  if (!config.includes(PIN.strictAdmission.replace('\\n', '\n')) || !ledger.includes(PIN.unreadableCost) || !ledger.includes(PIN.unreadableTotals)) {
    E("CC-9", "an unreadable ledger or cost is read as empty or zero");
  }
  if (!config.includes(PIN.canonicalTime) || !ledger.includes(PIN.utcGrouping)) {
    E("CC-10", "a non-canonical request time is admitted, or days are grouped by the written prefix");
  }
  if (!ledger.includes(PIN.capsEnforced)) E("CC-11", "authoriseRequestSpend no longer refuses without enforceable caps");
  if (![PIN.failedReadRefused, PIN.attributionRequired, PIN.settleRefusesNonFinite].every((p) => config.includes(p)) || !ledger.includes(PIN.attributionUnreadable)) {
    E("CC-13", "a failed read, an unattributed entry or a non-finite settlement can reset or brick the ledger");
  }
  if (!config.includes(PIN.committedPilot) || !config.includes(PIN.committedAuthorities)) {
    E("CC-12", "the pilot ceiling or its raise authority is read from the working copy");
  }
  return errors;
}

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || !text.includes(m.from)) {
      errors.push(`CC-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`CC-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`CC-9: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`CC-9: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-kernel-cost-cap1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-kernel-cost-cap1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
