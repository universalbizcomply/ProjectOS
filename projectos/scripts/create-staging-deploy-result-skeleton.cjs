"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function render(req) {
  const L = [];
  L.push("# Staging Deploy Result — " + lib.f(req.phase));
  L.push("");
  L.push("> Skeleton only. No deploy was attempted or executed. ProjectOS does not run deploy commands.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Target environment:** " + lib.f(req.targetEnvironment, "staging"));
  L.push(""); L.push("## Deploy attempted?"); L.push("false");
  L.push("## Deploy executed?"); L.push("false");
  L.push("## Deploy command"); L.push("NOT RUN");
  L.push("## Deploy status"); L.push("NOT RUN");
  L.push("## Deployed commit"); L.push("NOT RUN");
  L.push("## Staging URL"); L.push(lib.f(req.targetUrl, "URL_PLACEHOLDER"));
  L.push("## Validation before"); L.push(lib.f(req.validationBefore, "N/A"));
  L.push("## Validation after"); L.push(lib.f(req.validationAfter, "N/A"));
  L.push("## Staging proof"); L.push(lib.f(req.stagingProofPlan, "N/A"));
  L.push("## Rollback required?"); L.push("false");
  L.push("## Residue"); L.push("NONE");
  L.push("## Risks"); L.push(lib.list(req.risks, "none"));
  L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded, "Owner/advisor decision before any real deploy."));
  L.push("");
  return L.join("\n");
}
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(flags.out || req.reportPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-staging-deploy-result-skeleton: wrote " + lib.rel(out) + " (deployAttempted=false, deployExecuted=false, NOT RUN)");
} catch (e) { console.error("create-staging-deploy-result-skeleton ERROR: " + e.message); process.exit(1); }