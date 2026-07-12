"use strict";
const MODULES = [
  "validate-no-secrets", "validate-project-config", "validate-phase-manifest",
  "validate-evidence-pack", "validate-forbidden-actions", "validate-examples",
  "validate-review-agents", "validate-ecc-routing",
  "validate-report-request", "validate-report-index", "validate-report-output", "validate-phase-reporter",
  "validate-staging-deploy-request", "validate-staging-deploy-guard", "validate-staging-deploy-output",
  "validate-proof-request", "validate-proof-plan", "validate-proof-output", "validate-proof-factory",
  "validate-drift-request", "validate-drift-snapshot", "validate-drift-output", "validate-drift-detector",
  "validate-ci-governance-policy", "validate-ci-workflow-template", "validate-ci-output", "validate-ci-governance",
  "validate-dashboard-config", "validate-dashboard-data", "validate-dashboard-output", "validate-dashboard-safety", "validate-dashboard",
  "validate-project-plan", "validate-current-project-state", "validate-active-execution-session",
  "validate-plan-ready-gate", "validate-plan-status", "validate-plan-version", "validate-plan-staleness", "validate-plan-no-secrets"
];
let total = 0;
for (const m of MODULES) {
  let errs;
  try { errs = require("./" + m + ".cjs").run(); }
  catch (e) { console.error("[" + m + "] CRASH: " + e.message); total += 1; continue; }
  if (errs.length) { errs.forEach(x => console.error("[" + m + "] FAIL: " + x)); total += errs.length; }
  else console.log("[" + m + "] PASS");
}
if (total) { console.error("validate-all: " + total + " error(s)"); process.exit(1); }
console.log("validate-all: ALL PASS");