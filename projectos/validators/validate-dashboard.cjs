"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
const REQUIRED = [
  "projectos/schemas/dashboard-config.schema.json", "projectos/schemas/dashboard-project.schema.json",
  "projectos/schemas/dashboard-phase.schema.json", "projectos/schemas/dashboard-data.schema.json", "projectos/schemas/dashboard-report.schema.json",
  "projectos/templates/dashboard-config.template.json", "projectos/templates/dashboard-data.template.json",
  "projectos/templates/dashboard-report.template.md", "projectos/templates/dashboard-static-html.template.html",
  "projectos/scripts/collect-dashboard-data.cjs", "projectos/scripts/build-static-dashboard.cjs",
  "projectos/scripts/check-dashboard-data.cjs", "projectos/scripts/check-dashboard-safety.cjs", "projectos/scripts/create-dashboard-report.cjs",
  "projectos/docs/multi-project-dashboard.md", "projectos/examples/demo-dashboard-config.json",
  "projectos/dashboard/dashboard-data.json", "projectos/dashboard/index.html", "projectos/dashboard/dashboard-generation-report.md"
];
const GUARDED = ["collect-dashboard-data.cjs", "build-static-dashboard.cjs", "create-dashboard-report.cjs"];
function run() {
  const e = [];
  for (const rel of REQUIRED) if (!fs.existsSync(path.join(ROOT, rel))) e.push("missing required dashboard file: " + rel);
  for (const g of GUARDED) { const p = path.join(ROOT, "projectos/scripts", g); if (fs.existsSync(p) && fs.readFileSync(p, "utf8").indexOf("guardOut") === -1) e.push(g + " does not use guardOut (path guard)"); }
  const cfg = path.join(ROOT, "projectos/templates/dashboard-config.template.json");
  if (fs.existsSync(cfg)) { let o; try { o = JSON.parse(read(cfg)); } catch (x) { o = null; } if (o && (o.externalApisAllowed !== false || o.productRepoScanningAllowed !== false)) e.push("dashboard config must disable external APIs and product repo scanning"); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-dashboard: " + e.length + " error(s)"); process.exit(1); } console.log("validate-dashboard: PASS"); }
module.exports = { run };