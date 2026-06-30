"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const REQUIRED = [
  "projectos/schemas/report-request.schema.json",
  "projectos/schemas/report-index-entry.schema.json",
  "projectos/templates/report-request.template.json",
  "projectos/templates/report-index-entry.template.md",
  "projectos/scripts/_report-lib.cjs",
  "projectos/scripts/create-phase-report.cjs",
  "projectos/scripts/create-pre-push-review-pack.cjs",
  "projectos/scripts/create-closure-report.cjs",
  "projectos/scripts/update-reports-index.cjs",
  "projectos/scripts/check-report-status.cjs",
  "projectos/docs/phase-reporter.md",
  "projectos/examples/demo-report-request.json"
];
const GUARDED = ["create-phase-report.cjs", "create-pre-push-review-pack.cjs", "create-closure-report.cjs"];
function run() {
  const e = [];
  for (const rel of REQUIRED) if (!fs.existsSync(path.join(ROOT, rel))) e.push("missing required reporter file: " + rel);
  const lib = path.join(ROOT, "projectos/scripts/_report-lib.cjs");
  if (fs.existsSync(lib)) {
    const t = fs.readFileSync(lib, "utf8");
    if (t.indexOf("guardOut") === -1 || t.indexOf("refusing output outside") === -1) e.push("_report-lib.cjs missing output path guard");
  }
  for (const g of GUARDED) {
    const p = path.join(ROOT, "projectos/scripts", g);
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8").indexOf("guardOut") === -1) e.push(g + " does not use guardOut (path guard)");
  }
  const upd = path.join(ROOT, "projectos/scripts/update-reports-index.cjs");
  if (fs.existsSync(upd)) {
    const t = fs.readFileSync(upd, "utf8");
    if (t.indexOf("INDEX_STATUSES") === -1) e.push("update-reports-index.cjs missing status allow-list");
    if (t.indexOf("allow-duplicate") === -1) e.push("update-reports-index.cjs missing duplicate guard");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-phase-reporter: " + e.length + " error(s)"); process.exit(1); } console.log("validate-phase-reporter: PASS"); }
module.exports = { run };