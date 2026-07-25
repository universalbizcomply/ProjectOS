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
  "validate-plan-ready-gate", "validate-plan-status", "validate-plan-version", "validate-plan-staleness", "validate-plan-no-secrets",
  "validate-plan-discovery-import",
  "validate-secret-broker",
  "validate-secret-operation-broker",
  "validate-session-launcher",
  "validate-desktop-bridge",
  "validate-e2e-runner",
  "validate-approval-queue",
  "validate-provider-context-guards",
  "validate-desktop-e2e",
  "validate-reliability-hardening",
  "validate-forge-blueprint",
  "validate-forge-scaffold",
  "validate-forge-provisioner",
  "validate-forge-generation",
  "validate-forge-verify",
  "validate-forge-snapshot",
  "validate-forge-deploy",
  "validate-forge-integrations",
  "validate-forge-e2e",
  "validate-shared-runtime-no-tauri",
  "validate-runtime-no-raw-string-events",
  "validate-windows-runtime-primitives-boundary",
  "validate-host-identity-boundary",
  "validate-host-authority-contract-boundary",
  "validate-host-authority-windows-boundary",
  "val-windows-service-identity-proof-3kideb",
  "val-windows-service-control-capability-b1",
  "val-windows-local-ipc-capability-b1",
  "val-windows-service-proof-runner-capability-b1",
  "val-windows-service-control-capability-b2",
  "val-host-authority-pipe-security-contract1a",
  "val-windows-local-ipc-capability-b3",
  "val-cd-b4-binding-consumer-surface1a",
  "val-windows-service-proof-runner-capability-b4",
  "val-cd-b4-effect-witness-contract1a",
  "val-cd-b4-elevation-observation-engine1a",
  "val-cd-b4-operation-phase-binding1a",
  "val-cd-b4-protected-plan-store1a",
  "val-cd-b4-protected-plan-reducer-permit1a",
  "val-cd-b4-plan-durable-store1a",
  "val-cd-b4-repository-baseline-adapter1a",
  "val-cd-b4-repository-authority-integration1a"
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