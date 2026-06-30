"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function refuse(m) { console.error("create-staging-deploy-plan REFUSED: " + m); process.exit(1); }
function render(req) {
  const L = [];
  L.push("# Staging Deploy Plan — " + lib.f(req.phase));
  L.push("");
  L.push("> Plan only. No deploy was performed by ProjectOS. Approval is owner/advisor.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Target environment:** " + lib.f(req.targetEnvironment));
  L.push("- **Target URL:** " + lib.f(req.targetUrl, "URL_PLACEHOLDER"));
  L.push("- **Branch:** " + lib.f(req.branch));
  L.push("- **Commit:** " + lib.f(req.commit));
  L.push(""); L.push("## Files changed"); L.push(lib.list(req.filesChanged));
  L.push(""); L.push("## Scope"); L.push(lib.f(req.scope));
  L.push(""); L.push("## Validators required"); L.push(lib.list(req.validatorsRequired));
  L.push(""); L.push("## Reviews required"); L.push(lib.list(req.requiredReviews));
  L.push(""); L.push("## Forbidden actions checked"); L.push(lib.list(req.forbiddenActionsChecked));
  L.push(""); L.push("## Production touched?"); L.push(lib.yn(req.productionTouched));
  L.push("## Database touched?"); L.push(lib.yn(req.databaseTouched));
  L.push("## External sends / payments?"); L.push(lib.yn(req.externalSendsPlanned || req.paymentActionPlanned));
  L.push("## Secrets accessed?"); L.push(lib.yn(req.secretsAccessed));
  L.push("## External APIs required?"); L.push(lib.yn(req.externalApisRequired));
  L.push(""); L.push("## Rollback plan"); L.push(lib.f(req.rollbackPlan));
  L.push(""); L.push("## Staging proof plan"); L.push(lib.f(req.stagingProofPlan));
  L.push(""); L.push("## Approval status"); L.push(lib.f(req.approvalStatus, "DRAFT") + " (owner/advisor decision; not inferred)");
  L.push(""); L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded));
  L.push(""); L.push("> Deploy attempted: false. Deploy executed: false. ProjectOS does not run hosting CLIs or call external services.");
  L.push("");
  return L.join("\n");
}
try {
  if (!flags.input) refuse("provide --input <staging-deploy-request.json>");
  const req = lib.loadRequest(flags);
  if (req.targetEnvironment !== "staging") refuse("targetEnvironment must be staging (got " + req.targetEnvironment + ")");
  if (req.productionTouched === true) refuse("productionTouched must be false");
  if (req.secretsAccessed === true) refuse("secretsAccessed must be false");
  if (req.deployExecuted === true) refuse("deployExecuted must not be true");
  const out = lib.guardOut(req.reportPath || flags.out);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-staging-deploy-plan: wrote " + lib.rel(out) + " (no deploy performed)");
} catch (e) { console.error("create-staging-deploy-plan ERROR: " + e.message); process.exit(1); }