"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const REQUIRED = ["dashboard", "generatedAt", "sourceMode", "projects", "phases", "risks", "carryForward", "blockers", "summary", "sourceLimitations", "decisionNeeded"];
const PROJ_ST = ["ACTIVE", "LIVE", "FROZEN", "PILOT", "BLUEPRINT", "BLOCKED", "PARKED", "UNKNOWN", "NEEDS-SOURCE", "NOT-VERIFIED"];
const PHASE_ST = ["CLOSED", "AWAITING-REVIEW", "BLOCKED", "IMPLEMENTED-LOCALLY", "ACCEPTED-FOR-CLOSURE", "DO-NOT-CLOSE", "NOT-STARTED", "UNKNOWN"];
function check(rel, e) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { e.push("missing " + rel); return; }
  let d; try { d = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); return; }
  for (const k of REQUIRED) if (!(k in d)) e.push(rel + " missing section: " + k);
  if (d.sourceMode !== "local-static") e.push(rel + " sourceMode must be local-static");
  ["externalApisUsed", "liveInspectionUsed", "productReposScanned", "secretsUsed"].forEach(function (k) { if (k in d && d[k] !== false) e.push(rel + " " + k + " must be false"); });
  (d.projects || []).forEach(function (pr, i) { if (!pr.status) e.push(rel + " project[" + i + "] missing status"); else if (PROJ_ST.indexOf(pr.status) === -1) e.push(rel + " project[" + i + "] bad status: " + pr.status); if (!pr.sourceConfidence) e.push(rel + " project[" + i + "] missing sourceConfidence"); });
  (d.phases || []).forEach(function (ph, i) { if (!ph.status) e.push(rel + " phase[" + i + "] missing status"); else if (PHASE_ST.indexOf(ph.status) === -1) e.push(rel + " phase[" + i + "] bad status: " + ph.status); if (!ph.reportFile) e.push(rel + " phase[" + i + "] missing reportFile"); });
}
function run() {
  const e = [];
  check("projectos/examples/generated/demo-dashboard-data.json", e);
  if (fs.existsSync(path.join(ROOT, "projectos/dashboard/dashboard-data.json"))) check("projectos/dashboard/dashboard-data.json", e);
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-dashboard-data: " + e.length + " error(s)"); process.exit(1); } console.log("validate-dashboard-data: PASS"); }
module.exports = { run };