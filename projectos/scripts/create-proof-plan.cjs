"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const PROD = ["production", "prod", "live", "prd"];
function refuse(m) { console.error("create-proof-plan REFUSED: " + m); process.exit(1); }
function render(req) {
  const L = [];
  L.push("# Proof Plan — " + lib.f(req.phase));
  L.push("");
  L.push("> Plan only. This does not execute proof. ProjectOS runs no proof, seeds no data, mutates no database.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Environment:** " + lib.f(req.targetEnvironment));
  L.push("- **Proof objective:** " + lib.f(req.proofObjective));
  L.push("- **Proof type:** " + lib.f(req.proofType));
  L.push(""); L.push("## Preconditions"); L.push(lib.list(req.preconditions, "NEEDS SOURCE"));
  L.push(""); L.push("## Setup steps"); L.push(lib.list(req.setupSteps, "NEEDS SOURCE"));
  L.push(""); L.push("## Execution steps"); L.push(lib.list(req.executionSteps, "DESCRIPTIVE ONLY — not executed by ProjectOS"));
  L.push(""); L.push("## Validators"); L.push(lib.list(req.validatorsRequired));
  L.push(""); L.push("## Expected evidence"); L.push(lib.list(req.expectedEvidence, "NEEDS SOURCE"));
  L.push(""); L.push("## Data actions"); L.push(lib.list(req.allowedDataActions));
  L.push(""); L.push("## Forbidden actions"); L.push(lib.list(req.forbiddenDataActions));
  L.push(""); L.push("## Database touched?"); L.push(lib.yn(req.databaseTouched));
  L.push("## External sends / payments?"); L.push(lib.yn(req.externalSendsPlanned || req.paymentActionPlanned));
  L.push("## Production touched?"); L.push("no");
  L.push("## Secrets required?"); L.push(lib.yn(req.secretsRequired));
  L.push(""); L.push("## Rollback plan"); L.push(lib.f(req.rollbackPlan));
  L.push(""); L.push("## Cleanup plan"); L.push(lib.f(req.cleanupPlanPath, "not required"));
  L.push(""); L.push("## Residue plan"); L.push(lib.f(req.residuePlan, "Track any sandbox residue; cleanup planned separately."));
  L.push(""); L.push("## Risks"); L.push(lib.list(req.risks, "none"));
  L.push(""); L.push("## Approval status"); L.push(lib.f(req.approvalStatus, "DRAFT") + " (owner/advisor decision; not inferred)");
  L.push(""); L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded));
  L.push(""); L.push("> Proof attempted: false. Proof executed: false. No proof run, no seed, no DB mutation, no external call.");
  L.push("");
  return L.join("\n");
}
try {
  if (!flags.input) refuse("provide --input <proof-request.json>");
  const req = lib.loadRequest(flags);
  if (PROD.indexOf(String(req.targetEnvironment).toLowerCase()) !== -1) refuse("production target not allowed");
  if (req.secretsRequired === true) refuse("secretsRequired must be false");
  if (req.proofExecuted === true) refuse("proofExecuted must not be true");
  const out = lib.guardOut(req.reportPath || flags.out);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-proof-plan: wrote " + lib.rel(out) + " (no proof performed)");
} catch (e) { console.error("create-proof-plan ERROR: " + e.message); process.exit(1); }