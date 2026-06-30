"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function render(req) {
  const L = [];
  L.push("# Drift Report — " + lib.f(req.phase) + " (skeleton)");
  L.push("");
  L.push("> Report skeleton only. No live inspection. No repair. Decision needed.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Status:** " + lib.f(req.approvalStatus, "NEEDS-SOURCE"));
  L.push("- **Target environment:** " + lib.f(req.targetEnvironment, "staging"));
  L.push(""); L.push("## Drift summary"); L.push("NEEDS SOURCE (no comparison run in skeleton)");
  L.push(""); L.push("## Findings"); L.push("- NEEDS SOURCE");
  L.push("## Blockers"); L.push("- none");
  L.push("## Forbidden refs detected"); L.push("- none");
  L.push("## Production touched?"); L.push("no");
  L.push("## Live inspection used?"); L.push("no");
  L.push("## Secrets used?"); L.push("no");
  L.push("## Repair attempted?"); L.push("no");
  L.push("## Risks"); L.push("- none (skeleton)");
  L.push("## Carry-forward"); L.push("- none");
  L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded, "Owner/advisor decision before any drift action."));
  L.push("");
  return L.join("\n");
}
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(flags.out || req.reportPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-drift-report-skeleton: wrote " + lib.rel(out) + " (no live inspection, no repair)");
} catch (e) { console.error("create-drift-report-skeleton ERROR: " + e.message); process.exit(1); }