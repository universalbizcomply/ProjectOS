"use strict";
// Plan-status validation. Enforces the deterministic status enum and the key invariant that
// PLAN READY is computed from evidence, not asserted by writing the string: any record whose
// planStatus is "PLAN READY" must actually pass the gate, and a forged "PLAN READY" that fails the
// gate must be detected. Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(rel) { return JSON.parse(read(path.join(ROOT, rel))); }
const FIX = "projectos/examples/v3-plan-fixtures/";
const STATUSES = ["NO PLAN", "PLAN DISCOVERED", "PLAN CONFLICT", "PLAN DRAFTED", "AWAITING OWNER APPROVAL", "PLAN READY", "PLAN STALE", "PLAN BLOCKED"];

// Records whose recorded status must be consistent with the computed gate verdict.
const CONSISTENT = [
  FIX + "plan-valid-approved-ready.json",
  "projectos/state/projectos-v3.plan.json"
];

function run() {
  const errors = [];
  // Status enum + PLAN READY consistency on genuine records.
  for (const rel of CONSISTENT) {
    let plan;
    try { plan = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    if (STATUSES.indexOf(plan.planStatus) === -1) errors.push(rel + " invalid planStatus '" + plan.planStatus + "'");
    if (plan.planStatus === "PLAN READY" && !engine.evaluatePlanReady(plan).ready) {
      errors.push(rel + " claims PLAN READY but fails the evidence gate");
    }
  }
  // Guard: a forged PLAN READY (status string set, but evidence fails) MUST be caught by the gate.
  // This proves Claude cannot achieve PLAN READY merely by writing the status string.
  const forged = readJSON(FIX + "plan-forged-ready.json");
  if (forged.planStatus !== "PLAN READY") errors.push("forged fixture should carry planStatus PLAN READY");
  if (engine.evaluatePlanReady(forged).ready) errors.push("forged PLAN READY unexpectedly passed the gate (string-write must not grant readiness)");
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-plan-status: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-plan-status: PASS");
}
module.exports = { run };
