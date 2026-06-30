"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function render(req) {
  const L = [];
  L.push("# Cleanup Plan — " + lib.f(req.phase));
  L.push("");
  L.push("> Cleanup plan only. This does not execute cleanup. No database/file/external cleanup is performed.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Environment:** " + lib.f(req.targetEnvironment, "staging"));
  L.push(""); L.push("## Cleanup required?"); L.push(lib.yn(req.cleanupRequired));
  L.push("## Residue items"); L.push(lib.list(req.residueItems, "none"));
  L.push("## Cleanup actions"); L.push(lib.list(req.cleanupActions, "DESCRIPTIVE ONLY — not executed by ProjectOS"));
  L.push("## Forbidden cleanup actions"); L.push(lib.list(req.forbiddenCleanupActions, "production-data-deletion"));
  L.push("## Database cleanup planned?"); L.push(lib.yn(req.databaseCleanupPlanned));
  L.push("## File cleanup planned?"); L.push(lib.yn(req.fileCleanupPlanned));
  L.push("## External cleanup planned?"); L.push(lib.yn(req.externalCleanupPlanned));
  L.push("## Approval required?"); L.push(lib.yn(req.approvalRequired === undefined ? true : req.approvalRequired));
  L.push("## Verification steps"); L.push(lib.list(req.verificationSteps, "NEEDS SOURCE"));
  L.push("## Cleanup status"); L.push(lib.f(req.cleanupStatus, "NOT-REQUIRED"));
  L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded, "Owner/advisor decision before any cleanup."));
  L.push("");
  L.push("> Cleanup is planned only. ProjectOS does not delete data, mutate databases, or call external services.");
  L.push("");
  return L.join("\n");
}
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(flags.out || req.cleanupPlanPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(req));
  console.log("create-cleanup-plan: wrote " + lib.rel(out) + " (cleanup planned only; not executed)");
} catch (e) { console.error("create-cleanup-plan ERROR: " + e.message); process.exit(1); }