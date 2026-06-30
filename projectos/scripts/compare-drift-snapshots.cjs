"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const PROD = ["production", "prod", "live", "prd"];
function refuse(m) { console.error("compare-drift-snapshots REFUSED: " + m); process.exit(1); }
function readSnap(rel) {
  const p = path.resolve(lib.ROOT, rel);
  if (!lib.within(p)) throw new Error("snapshot path outside ProjectOS: " + rel);
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}
function diff(expArr, obsArr) {
  const ex = Array.isArray(expArr) ? expArr : [];
  const ob = Array.isArray(obsArr) ? obsArr : [];
  return { missing: ex.filter(function (x) { return ob.indexOf(x) === -1; }), extra: ob.filter(function (x) { return ex.indexOf(x) === -1; }) };
}
const SEV = {
  tables: { cat: "schema-drift", miss: "HIGH", extra: "MEDIUM" },
  columns: { cat: "schema-drift", miss: "HIGH", extra: "LOW" },
  functions: { cat: "function-drift", miss: "HIGH", extra: "MEDIUM" },
  routes: { cat: "route-drift", miss: "MEDIUM", extra: "MEDIUM" },
  migrations: { cat: "migration-drift", miss: "HIGH", extra: "MEDIUM" },
  envKeys: { cat: "env-config-drift", miss: "HIGH", extra: "LOW" },
  policies: { cat: "permission-policy-drift", miss: "HIGH", extra: "MEDIUM" }
};
function run() {
  if (!flags.input) refuse("provide --input <drift-check-request.json>");
  const req = lib.loadRequest(flags);
  if (PROD.indexOf(String(req.targetEnvironment).toLowerCase()) !== -1) refuse("production target not allowed");
  if (req.liveInspectionRequested === true) refuse("liveInspectionRequested must be false");
  if (req.secretsAccessed === true) refuse("secretsAccessed must be false");
  if (req.repairRequested === true) refuse("repairRequested must be false");
  const exp = readSnap(req.expectedSnapshotPath);
  const obs = readSnap(req.observedSnapshotPath);
  const findings = [];
  let id = 0;
  const pairs = [["tables", "expectedTables"], ["columns", "expectedColumns"], ["functions", "expectedFunctions"], ["routes", "expectedRoutes"], ["migrations", "expectedMigrations"], ["envKeys", "expectedEnvKeys"], ["policies", "expectedPolicies"]];
  pairs.forEach(function (pr) {
    const key = pr[0], field = pr[1], s = SEV[key];
    const d = diff(exp[field], obs[field]);
    d.missing.forEach(function (m) { findings.push({ id: ++id, category: s.cat, severity: s.miss, status: "DRIFT-DETECTED", expected: "present: " + m, observed: "MISSING", blocker: false }); });
    d.extra.forEach(function (m) { findings.push({ id: ++id, category: s.cat, severity: s.extra, status: "DRIFT-DETECTED", expected: "absent", observed: "extra: " + m, blocker: false }); });
  });
  if (String(exp.branch) !== String(obs.branch)) findings.push({ id: ++id, category: "branch-drift", severity: "MEDIUM", status: "DRIFT-DETECTED", expected: "branch " + exp.branch, observed: "branch " + obs.branch, blocker: false });
  if (String(exp.targetUrl) !== String(obs.targetUrl) || String(exp.projectRef) !== String(obs.projectRef)) findings.push({ id: ++id, category: "deploy-target-drift", severity: "HIGH", status: "DRIFT-DETECTED", expected: exp.targetUrl + " / " + exp.projectRef, observed: obs.targetUrl + " / " + obs.projectRef, blocker: false });
  // forbidden refs
  const forbidden = [].concat(Array.isArray(req.forbiddenRefs) ? req.forbiddenRefs : [], Array.isArray(exp.forbiddenRefs) ? exp.forbiddenRefs : []);
  const obsBlob = JSON.stringify(obs);
  const detected = [];
  forbidden.forEach(function (f) { if (f && obsBlob.indexOf(f) !== -1 && detected.indexOf(f) === -1) detected.push(f); });
  detected.forEach(function (f) { findings.push({ id: ++id, category: "forbidden-ref-drift", severity: "BLOCKER", status: "HARD-STOP", expected: "forbidden ref absent", observed: "forbidden ref present: " + f, blocker: true }); });
  const hasBlocker = findings.some(function (f) { return f.blocker; });
  const status = hasBlocker ? "HARD-STOP" : (findings.length ? "DRIFT-DETECTED" : "NO-DRIFT");
  const L = [];
  L.push("# Drift Report — " + lib.f(req.phase));
  L.push("");
  L.push("> Evidence only. This is not approval and does not repair drift. No live service was checked.");
  L.push("");
  L.push("- **Project:** " + lib.f(req.project));
  L.push("- **Phase:** " + lib.f(req.phase));
  L.push("- **Status:** " + status);
  L.push("- **Target environment:** " + lib.f(req.targetEnvironment));
  L.push("- **Expected snapshot:** " + lib.f(req.expectedSnapshotPath));
  L.push("- **Observed snapshot:** " + lib.f(req.observedSnapshotPath));
  L.push(""); L.push("## Drift summary"); L.push(findings.length + " finding(s); status " + status + (hasBlocker ? " (forbidden ref / blocker present)" : ""));
  L.push(""); L.push("## Findings");
  L.push("| # | Category | Severity | Status | Expected | Observed |");
  L.push("|---|----------|----------|--------|----------|----------|");
  if (findings.length) findings.forEach(function (f) { L.push("| " + f.id + " | " + f.category + " | " + f.severity + " | " + f.status + " | " + f.expected + " | " + f.observed + " |"); });
  else L.push("| - | - | - | NO-DRIFT | - | - |");
  L.push(""); L.push("## Blockers");
  const blk = findings.filter(function (f) { return f.blocker; });
  L.push(blk.length ? blk.map(function (f) { return "- " + f.category + ": " + f.observed; }).join("\n") : "- none");
  L.push(""); L.push("## Acceptable carry-forward"); L.push("- " + (req.acceptableCarryForward || "owner/advisor to classify non-blocking findings"));
  L.push(""); L.push("## Forbidden refs detected"); L.push(detected.length ? detected.map(function (x) { return "- " + x; }).join("\n") : "- none");
  L.push(""); L.push("## Production touched?"); L.push("no");
  L.push("## Live inspection used?"); L.push("no");
  L.push("## Secrets used?"); L.push("no");
  L.push("## Repair attempted?"); L.push("no");
  L.push(""); L.push("## Risks"); L.push("- Static comparison of supplied files only; observed snapshot accuracy is the owner's responsibility.");
  L.push(""); L.push("## Carry-forward"); L.push("- " + (hasBlocker ? "Resolve blocker(s) before any proof/deploy." : "Owner/advisor to classify findings as acceptable or blocking."));
  L.push(""); L.push("## Decision needed"); L.push(lib.f(req.decisionNeeded));
  L.push("");
  L.push("> No live service checked. No repair attempted. ProjectOS compares supplied files only.");
  L.push("");
  const out = lib.guardOut(req.reportPath || flags.out);
  lib.ensureDir(out);
  fs.writeFileSync(out, L.join("\n"));
  console.log("compare-drift-snapshots: wrote " + lib.rel(out) + " (status " + status + "; no live inspection; no repair)");
}
try { run(); } catch (e) { console.error("compare-drift-snapshots ERROR: " + e.message); process.exit(1); }