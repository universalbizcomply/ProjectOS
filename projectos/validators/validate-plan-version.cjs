"use strict";
// Plan-version immutability validation. A legal approved version records a valid X.Y version and,
// if it is an amendment, references a different superseded version; it can never supersede itself
// and can never be approved by the implementer. Ordinary current-state progress must not bump the
// approved plan version. Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(rel) { return JSON.parse(read(path.join(ROOT, rel))); }
const FIX = "projectos/examples/v3-plan-fixtures/";

const LEGAL = [
  FIX + "plan-valid-approved-ready.json",
  FIX + "plan-v1_1-amendment.json",
  "projectos/state/projectos-v3.plan.json"
];
// [relPath, requiredReasonSubstring]
const ILLEGAL = [
  [FIX + "plan-illegal-selfsupersede.json", "supersedes itself"],
  [FIX + "plan-claude-approved.json", "implementer"],
  [FIX + "plan-claude-variant-approved.json", "implementer"]
];

function run() {
  const errors = [];
  for (const rel of LEGAL) {
    let plan;
    try { plan = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const errs = engine.checkVersionRecord(plan);
    if (errs.length) errors.push(rel + " should be a legal version but reported: " + errs.join("; "));
  }
  for (const [rel, need] of ILLEGAL) {
    let plan;
    try { plan = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const errs = engine.checkVersionRecord(plan);
    if (!errs.length) errors.push(rel + " should be an illegal version but passed");
    else if (need && !errs.some((x) => x.indexOf(need) !== -1)) errors.push(rel + " illegal-version reason missing '" + need + "': " + errs.join("; "));
  }
  // Ordinary current-state progress must not change the approved plan version.
  const plan = readJSON("projectos/state/projectos-v3.plan.json");
  const state = readJSON("projectos/state/projectos-v3.current-state.json");
  if (state.activePlanVersion !== plan.planVersion) errors.push("current-state activePlanVersion (" + state.activePlanVersion + ") diverges from approved plan version (" + plan.planVersion + ")");
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-plan-version: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-plan-version: PASS");
}
module.exports = { run };
