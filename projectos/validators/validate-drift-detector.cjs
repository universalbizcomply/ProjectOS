"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const REQUIRED = [
  "projectos/schemas/drift-snapshot.schema.json", "projectos/schemas/drift-check-request.schema.json",
  "projectos/schemas/drift-finding.schema.json", "projectos/schemas/drift-report.schema.json",
  "projectos/schemas/drift-detector-policy.schema.json",
  "projectos/templates/drift-check-request.template.json", "projectos/templates/drift-snapshot.template.json",
  "projectos/templates/drift-finding.template.json", "projectos/templates/drift-report.template.md",
  "projectos/templates/drift-detector-report.template.md",
  "projectos/scripts/check-drift-request.cjs", "projectos/scripts/check-drift-snapshot.cjs",
  "projectos/scripts/compare-drift-snapshots.cjs", "projectos/scripts/create-drift-report-skeleton.cjs",
  "projectos/scripts/check-drift-target.cjs",
  "projectos/docs/staging-drift-detector.md",
  "projectos/examples/demo-drift-expected-snapshot.json", "projectos/examples/demo-drift-observed-snapshot.json", "projectos/examples/demo-drift-check-request.json"
];
const GUARDED = ["compare-drift-snapshots.cjs", "create-drift-report-skeleton.cjs"];
function run() {
  const e = [];
  for (const rel of REQUIRED) if (!fs.existsSync(path.join(ROOT, rel))) e.push("missing required drift-detector file: " + rel);
  const pol = path.join(ROOT, "projectos/schemas/drift-detector-policy.schema.json");
  if (fs.existsSync(pol)) { let g; try { g = readJSON(pol); } catch (x) { e.push("policy schema invalid JSON: " + x.message); g = null; } if (g) { const props = g.properties || {}; ["productionRefuseByDefault", "forbiddenEnvironments", "liveInspectionPolicy", "repairPolicy", "approvalPolicy"].forEach(function (k) { if (!(k in props)) e.push("policy schema missing property: " + k); }); if ((g.required || []).indexOf("productionRefuseByDefault") === -1) e.push("policy schema must require productionRefuseByDefault"); } }
  const rep = path.join(ROOT, "projectos/templates/drift-detector-report.template.md");
  if (fs.existsSync(rep) && read(rep).toLowerCase().indexOf("recommendation is not approval") === -1) e.push("drift-detector-report template must state recommendation is not approval");
  for (const g of GUARDED) { const p = path.join(ROOT, "projectos/scripts", g); if (fs.existsSync(p) && fs.readFileSync(p, "utf8").indexOf("guardOut") === -1) e.push(g + " does not use guardOut (path guard)"); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-drift-detector: " + e.length + " error(s)"); process.exit(1); } console.log("validate-drift-detector: PASS"); }
module.exports = { run };