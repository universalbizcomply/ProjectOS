"use strict";
// Validator: PROJECTOS-V3-VALIDATION-EVIDENCE1A
//
// Proves the mechanism that turns "the plan requires validator X" into something the closure gate can
// refuse on. Three separate things have to hold, and this file proves each of them mechanically:
//
//   1. the PRODUCER refuses to write anything untrue — no head, dirty tree, or a result list that
//      does not match the registry it claims to have run;
//   2. the RECORD SHAPE check catches every way a record can be malformed, wrong-subject or
//      self-contradictory, so a gate reading it cannot be fooled into seeing a pass;
//   3. the RUNNER is actually wired to the producer, is opt-in, and reports the registered module
//      count as its own number rather than conflating it with the aggregate command.
//
// Point 3 matters because 1 and 2 are worthless if nothing calls them. Point 1 is proven against
// SYNTHETIC repository facts, never the live tree: a validator whose result depends on whether the
// developer happens to have uncommitted work is not a control.
//
// Created in PROJECTOS-V3-RELIABILITY-HARDENING1A.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const LIB = require("./lib/validation-record.cjs");
const RUNNER = path.join(ROOT, "projectos", "validators", "validate-all.cjs");
const CORE_ELIGIBILITY = path.join(ROOT, "projectos", "core", "src", "closureEligibility.ts");
const GATE = path.join(ROOT, "projectos", "agent", "src", "closureGate.ts");

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const NOW = "2026-08-10T00:00:00.000Z";

function results(n, failIndex) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ name: "validate-m" + i, passed: i !== failIndex, errorCount: i === failIndex ? 3 : 0 });
  return out;
}

/** The producer must refuse every input it cannot honestly describe. */
function producerRefusals(e) {
  const clean = { head: HEAD_A, workingTreeClean: true };
  const cases = [
    ["no head", { head: null, workingTreeClean: true }, results(2), 2, "HEAD could not be established"],
    ["short head", { head: "abc", workingTreeClean: true }, results(2), 2, "HEAD could not be established"],
    ["uppercase head", { head: "A".repeat(40), workingTreeClean: true }, results(2), 2, "HEAD could not be established"],
    ["dirty tree", { head: HEAD_A, workingTreeClean: false }, results(2), 2, "working tree is not clean"],
    ["git failure is not clean", { head: HEAD_A, workingTreeClean: null }, results(2), 2, "working tree is not clean"],
    ["fewer results than modules", clean, results(1), 2, "1 result(s) for 2 registered"],
    ["more results than modules", clean, results(3), 2, "3 result(s) for 2 registered"],
    ["zero registered modules", clean, [], 0, "positive integer"],
    ["no facts at all", null, results(2), 2, "repository facts were not established"],
  ];
  for (const [label, facts, res, count, needle] of cases) {
    const d = LIB.planRecordWrite(facts, res, count, NOW);
    if (d.write) e.push("producer wrote a record it should have refused: " + label);
    else if (String(d.reason).indexOf(needle) === -1) e.push("producer refusal for '" + label + "' does not say why: " + d.reason);
  }
  // And the one case that must succeed carries the real outcomes, not a summary.
  const good = LIB.planRecordWrite(clean, results(3, 1), 3, NOW);
  if (!good.write) { e.push("producer refused a clean, consistent run: " + good.reason); return; }
  const r = good.record;
  if (r.subjectHead !== HEAD_A) e.push("record subjectHead is not the head it was produced at");
  if (r.registeredModuleCount !== 3) e.push("record registeredModuleCount is wrong");
  if (r.results.length !== 3) e.push("record does not carry one result per registered module");
  if (r.aggregatePassed !== false) e.push("a record containing a failing module must not claim aggregatePassed");
  if (LIB.passingNames(r).join(",") !== "validate-m0,validate-m2") e.push("passingNames must list exactly the passing modules: " + LIB.passingNames(r).join(","));
  // A fully passing run does say so.
  const allPass = LIB.planRecordWrite(clean, results(3), 3, NOW);
  if (!allPass.record.aggregatePassed) e.push("an all-passing run must record aggregatePassed");
  // The AGGREGATE is nameable but is NOT a module: plans require `validate-all`, and counting the
  // wrapper among the modules is the conflation that produced a wrong module count in prose.
  if (allPass.record.aggregate.name !== LIB.AGGREGATE_NAME) e.push("the record does not name the aggregate command");
  if (allPass.record.aggregate.passed !== true) e.push("an all-passing run must record the aggregate as passing");
  if (allPass.record.registeredModuleCount !== 3) e.push("the aggregate was counted as a registered module");
  if (LIB.passingNames(allPass.record).indexOf(LIB.AGGREGATE_NAME) === -1) e.push("passingNames omits the aggregate command of an all-passing run");
  if (LIB.passingNames(r).indexOf(LIB.AGGREGATE_NAME) !== -1) e.push("a run with a failing module lent its name to the aggregate requirement");
}

/** Every malformed / mis-bound / self-contradictory record must be caught. */
function shapeMutations(e) {
  const base = LIB.buildRecord({
    subjectHead: HEAD_A,
    generatedAt: NOW,
    workingTreeCleanAtRunStart: true,
    registeredModuleCount: 2,
    // Module names only — `validate-all` is the AGGREGATE and may never appear here.
    results: [
      { name: "validate-project-plan", passed: true, errorCount: 0 },
      { name: "validate-zero-relay-continuity", passed: true, errorCount: 0 },
    ],
  });
  const clean = LIB.checkRecordShape(base, HEAD_A);
  if (clean.length) e.push("a well-formed record was rejected: " + clean.join("; "));
  if (LIB.passingNames(base).indexOf("validate-zero-relay-continuity") === -1) e.push("passingNames lost a passing validator");

  const mut = (label, f, needle) => {
    const copy = JSON.parse(JSON.stringify(base));
    f(copy);
    const errs = LIB.checkRecordShape(copy, HEAD_A);
    if (!errs.length) e.push("mutation survived unchecked: " + label);
    else if (needle && !errs.some((x) => x.indexOf(needle) !== -1)) e.push("mutation '" + label + "' caught for the wrong reason: " + errs.join("; "));
  };
  mut("wrong schemaVersion", (r) => { r.schemaVersion = "9.9.9"; }, "schemaVersion");
  mut("missing subjectHead", (r) => { delete r.subjectHead; }, "subjectHead");
  mut("subjectHead is not 40-hex", (r) => { r.subjectHead = "nope"; }, "subjectHead");
  mut("subjectHead disagrees with the expected subject", (r) => { r.subjectHead = HEAD_B; }, "does not match");
  mut("no generatedAt", (r) => { delete r.generatedAt; }, "generatedAt");
  mut("dirty-tree run", (r) => { r.workingTreeCleanAtRunStart = false; }, "clean working tree");
  mut("aggregatePassed not boolean", (r) => { r.aggregatePassed = "yes"; }, "aggregatePassed");
  mut("registeredModuleCount zero", (r) => { r.registeredModuleCount = 0; }, "positive integer");
  mut("results length disagrees with the count", (r) => { r.results.pop(); }, "!= registeredModuleCount");
  mut("results not an array", (r) => { r.results = {}; }, "not an array");
  mut("a result with no name", (r) => { delete r.results[1].name; }, "name missing");
  mut("a duplicated validator name", (r) => { r.results[1].name = r.results[0].name; }, "duplicate");
  mut("passed is not a boolean", (r) => { r.results[1].passed = "true"; }, "passed");
  mut("errorCount is not an integer", (r) => { r.results[1].errorCount = 1.5; }, "errorCount");
  mut("claims aggregate pass over a failing module", (r) => { r.results[1].passed = false; }, "at least one module result is not passing");
  mut("no aggregate command result", (r) => { delete r.aggregate; }, "aggregate command result is missing");
  mut("aggregate renamed", (r) => { r.aggregate.name = "something-else"; }, "aggregate.name");
  mut("aggregate contradicts the summary", (r) => { r.aggregate.passed = false; }, "contradicts aggregatePassed");
  mut("aggregate smuggled in as a module", (r) => { r.results[1].name = LIB.AGGREGATE_NAME; }, "listed as a registered module");
  // A record naming a validator that did NOT pass must not leak into passingNames.
  const failing = JSON.parse(JSON.stringify(base));
  failing.results[1].passed = false;
  if (LIB.passingNames(failing).indexOf("validate-zero-relay-continuity") !== -1) e.push("a failing validator appeared in passingNames");
}

/** The record path must be exactly what the closure tail admits, and nothing broader. */
function pathShape(e) {
  const rel = LIB.recordRelPath(HEAD_A);
  if (rel !== ".projectops/validation/" + HEAD_A + ".json") e.push("record path shape changed: " + rel);
  if (!/^\.projectops\/validation\/[0-9a-f]{40}\.json$/.test(rel)) e.push("record path no longer matches the subject-bound shape the closure tail admits");
  const abs = LIB.recordPath(ROOT, HEAD_A);
  if (path.relative(ROOT, abs).replace(/\\/g, "/") !== rel) e.push("absolute and relative record paths disagree");
}

/** The producer is worthless unless the authoritative runner actually calls it, opt-in. */
function runnerWiring(e) {
  let src;
  try { src = fs.readFileSync(RUNNER, "utf8"); } catch (x) { e.push("validate-all.cjs not readable: " + x.message); return; }
  if (src.indexOf("lib/validation-record.cjs") === -1) e.push("validate-all does not load the validation-record producer");
  if (src.indexOf("--record-evidence") === -1) e.push("validate-all has no --record-evidence opt-in");
  if (src.indexOf("writeRecord(") === -1) e.push("validate-all never calls writeRecord");
  if (!/REGISTERED_MODULE_COUNT\s*=\s*MODULES\.length/.test(src)) e.push("the registered module count is not derived from the registry itself");
  if (!/results\.push\(\{\s*name:\s*m,\s*passed:\s*false/.test(src)) e.push("a CRASHED module must be recorded as a FAILING result, never omitted");
  if (src.indexOf("registered module(s)") === -1) e.push("validate-all does not report the registered module count distinctly from the aggregate verdict");
  // The evidence must not be produced by default: an ordinary dirty-tree dev run would leave residue.
  if (!/const RECORD_EVIDENCE = process\.argv/.test(src)) e.push("evidence production is not gated on an explicit flag");
}

/** The gate side must read the record BY SUBJECT and take required names from the PLAN. */
function gateWiring(e) {
  let elig, gate;
  try { elig = fs.readFileSync(CORE_ELIGIBILITY, "utf8"); } catch (x) { e.push("closureEligibility.ts not readable: " + x.message); return; }
  try { gate = fs.readFileSync(GATE, "utf8"); } catch (x) { e.push("closureGate.ts not readable: " + x.message); return; }
  if (elig.indexOf("'G4-17'") === -1) e.push("the required-validator predicate G4-17 is not defined");
  if (!/G4_PREDICATE_COUNT\s*=\s*17/.test(elig)) e.push("G4_PREDICATE_COUNT does not match the predicate set");
  if (elig.indexOf("requiredValidators") === -1) e.push("G4Facts carries no plan-required validator list");
  if (!/VALIDATION_RECORD_PATH\s*=\s*\/\^\\\.projectops\\\/validation\\\/\[0-9a-f\]\{40\}\\\.json\$\//.test(elig)) {
    e.push("the closure tail admits validation evidence by something other than the exact subject-named shape");
  }
  if (elig.indexOf("'.projectops/validation/'") !== -1) e.push("the closure tail admits the whole validation DIRECTORY, which would make any file under it non-substantive");
  if (gate.indexOf("validationRecordPath") === -1) e.push("the deriving layer does not locate the record by subject commit");
  if (!/planPhase\?\.requiredValidators|planPhase\.requiredValidators/.test(gate)) e.push("required validator names are not read from the active approved plan phase");
  // The names must come from the plan, never from the closure evidence record the caller writes.
  if (/evidence\.requiredValidators/.test(gate)) e.push("required validator names are read from the caller-authored closure evidence");
}

function run() {
  const e = [];
  producerRefusals(e);
  shapeMutations(e);
  pathShape(e);
  runnerWiring(e);
  gateWiring(e);
  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectos-v3-validation-evidence1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectos-v3-validation-evidence1a: PASS");
}
