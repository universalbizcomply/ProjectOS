"use strict";
// PLAN READY gate validation. Proves the evidence gate returns the correct verdict for the live
// ProjectOS V3 plan and for every PASS/FAIL fixture, including that the implementer cannot satisfy
// owner approval and that a raw secret, missing source commit, bad phase dependency, unapproved
// plan, incomplete plan or stale plan all block PLAN READY. Also proves the new-project start
// constraint (no ready plan -> not eligible for E2E). Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(rel) { return JSON.parse(read(path.join(ROOT, rel))); }
const FIX = "projectos/examples/v3-plan-fixtures/";

// [relPath, expectedReady, requiredReasonSubstringOrNull]
const CASES = [
  [FIX + "plan-valid-approved-ready.json", true, null],
  ["projectos/state/projectos-v3.plan.json", true, null],
  [FIX + "plan-incomplete.json", false, null],
  [FIX + "plan-unapproved.json", false, "approvalStatus"],
  [FIX + "plan-claude-approved.json", false, "implementer"],
  [FIX + "plan-missing-source-commit.json", false, "baseline commit"],
  [FIX + "plan-bad-phase-deps.json", false, "unknown phase"],
  [FIX + "plan-raw-secret.json", false, "raw secret"],
  [FIX + "plan-stale.json", false, "STALE"],
  [FIX + "plan-claude-variant-approved.json", false, "implementer"],
  [FIX + "plan-secret-dbpassword.json", false, "raw secret"],
  [FIX + "plan-approval-implementer-authority.json", false, "approvalAuthority"],
  [FIX + "plan-approval-manual-tamperproof.json", false, "tamperProof"],
  [FIX + "plan-approval-secure-no-evidence.json", false, "secureApprovalEvidence"],
  // Closure delegation: legal when scoped to its own project and closure-only; refused when it names
  // another project (that would let one project's plan grant closure over another) or hands closure to
  // the implementer. All three are schema-valid — the gate, not the shape, is what refuses.
  [FIX + "plan-delegation-legal.json", true, null],
  [FIX + "plan-delegation-escapes-project.json", false, "escape its project"],
  [FIX + "plan-delegation-to-implementer.json", false, "implementer"]
];

// Approval-binding shape checks (checkApprovalBinding directly): [relPath, expectLegal, needReason].
const BINDING_CASES = [
  [FIX + "plan-valid-approved-ready.json", true, null],
  [FIX + "plan-approval-secure-future.json", true, null],
  [FIX + "plan-approval-implementer-authority.json", false, "approvalAuthority"],
  [FIX + "plan-approval-manual-tamperproof.json", false, "tamperProof"],
  [FIX + "plan-approval-secure-no-evidence.json", false, "secureApprovalEvidence"]
];

function run() {
  const errors = [];
  for (const [rel, expectReady, needReason] of CASES) {
    let plan;
    try { plan = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const verdict = engine.evaluatePlanReady(plan);
    if (verdict.ready !== expectReady) {
      errors.push(rel + " expected ready=" + expectReady + " got " + verdict.ready + " [reasons: " + verdict.reasons.join("; ") + "]");
      continue;
    }
    if (!expectReady && needReason) {
      const hit = verdict.reasons.some((r) => r.indexOf(needReason) !== -1);
      if (!hit) errors.push(rel + " expected a failure reason containing '" + needReason + "' but got: " + verdict.reasons.join("; "));
    }
  }
  // Approval-binding shape checks.
  for (const [rel, expectLegal, needReason] of BINDING_CASES) {
    let plan;
    try { plan = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const errs = engine.checkApprovalBinding(plan);
    if (expectLegal && errs.length) errors.push(rel + " approval binding expected legal but got: " + errs.join("; "));
    if (!expectLegal) {
      if (!errs.length) errors.push(rel + " approval binding expected illegal but passed");
      else if (needReason && !errs.some((x) => x.indexOf(needReason) !== -1)) errors.push(rel + " binding reason missing '" + needReason + "': " + errs.join("; "));
    }
  }
  // New-project start constraint: a ready plan is eligible; an incomplete plan is not.
  const ready = engine.isEligibleForE2E(readJSON(FIX + "plan-valid-approved-ready.json"));
  if (!ready.eligible) errors.push("valid approved plan must be eligible for E2E");
  const notReady = engine.isEligibleForE2E(readJSON(FIX + "plan-incomplete.json"));
  if (notReady.eligible) errors.push("incomplete plan must NOT be eligible for E2E (new-project start constraint)");
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-plan-ready-gate: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-plan-ready-gate: PASS");
}
module.exports = { run };
