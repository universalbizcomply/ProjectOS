"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function render(req) {
  const L = [];
  L.push("# Proof Evidence — " + lib.f(req.phase));
  L.push("");
  L.push("> Skeleton only. No proof was attempted or executed. ProjectOS does not run proof.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Status:** " + lib.f(req.approvalStatus, "DRAFT"));
  L.push("- **Environment:** " + lib.f(req.targetEnvironment, "staging"));
  L.push(""); L.push("## Proof attempted?"); L.push("false");
  L.push("## Proof executed?"); L.push("false");
  L.push("## Proof result"); L.push("NOT RUN");
  L.push("## Evidence items"); L.push(lib.list(req.evidenceItems, "none (not run)"));
  L.push("## Validators run"); L.push(lib.list(req.validatorsRun, "none"));
  L.push("## Database touched?"); L.push("no");
  L.push("## External sends / payments?"); L.push("no");
  L.push("## Production touched?"); L.push("no");
  L.push("## Residue"); L.push("NONE");
  L.push("## Cleanup status"); L.push(lib.f(req.cleanupStatus, "NOT-REQUIRED"));
  L.push("## Risks"); L.push(lib.list(req.risks, "none"));
  L.push("## Carry-forward"); L.push(lib.list(req.carryForward, "none"));
  L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded, "Owner/advisor decision before any real proof."));
  L.push("");
  return L.join("\n");
}
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(flags.out || req.proofEvidencePath);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-proof-evidence-skeleton: wrote " + lib.rel(out) + " (proofAttempted=false, proofExecuted=false, NOT RUN)");
} catch (e) { console.error("create-proof-evidence-skeleton ERROR: " + e.message); process.exit(1); }