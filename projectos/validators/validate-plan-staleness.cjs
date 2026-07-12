"use strict";
// Plan-staleness validation. Proves BOTH directions deterministically:
//  (a) a material change to a recorded plan input (e.g. the human-readable plan document) => PLAN STALE;
//  (b) ordinary implementation progress (HEAD advancing, a phase completing) => NOT stale.
// Only inputs recorded in staleness.materialPlanInputs can stale the plan. Created in
// PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(rel) { return JSON.parse(read(path.join(ROOT, rel))); }

function run() {
  const errors = [];
  const plan = readJSON("projectos/state/projectos-v3.plan.json");
  const inputs = (plan.staleness && plan.staleness.materialPlanInputs) || [];
  if (inputs.length === 0) { errors.push("live plan has no materialPlanInputs"); return errors; }

  // Baseline current fingerprints = the recorded fingerprints (nothing material changed).
  const baseline = {};
  for (const i of inputs) baseline[i.inputId] = i.fingerprint;

  // (b) Ordinary progress: same material inputs, but HEAD advanced and a phase completed.
  // These non-material keys are not in materialPlanInputs, so they must not stale the plan.
  const ordinary = Object.assign({}, baseline, {
    currentHead: "9999999999999999999999999999999999999999",
    completionPercentage: "66.6",
    lastEvidenceReference: "knowledge/reports/new-report.md"
  });
  const ordinaryVerdict = engine.computeStaleness(plan, ordinary);
  if (ordinaryVerdict.stale) errors.push("ordinary progress incorrectly staled the plan: " + ordinaryVerdict.reasons.join("; "));

  // (a) Material change: the authoritative plan document fingerprint changed.
  const material = Object.assign({}, baseline, { "human-readable-plan": "sha256:CHANGED-CONTENT-0000" });
  const materialVerdict = engine.computeStaleness(plan, material);
  if (!materialVerdict.stale) errors.push("material plan-document change failed to stale the plan");
  else if (!materialVerdict.reasons.some((r) => r.indexOf("human-readable-plan") !== -1)) errors.push("stale reason missing the changed input: " + materialVerdict.reasons.join("; "));

  // A second material input (owner gates) changing must also stale.
  const gatesChanged = Object.assign({}, baseline, { "owner-gates": "commit|push" });
  if (!engine.computeStaleness(plan, gatesChanged).stale) errors.push("owner-gates change failed to stale the plan");

  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-plan-staleness: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-plan-staleness: PASS");
}
module.exports = { run };
