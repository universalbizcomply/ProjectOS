"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const STATUSES = ["AWAITING-REVIEW", "AWAITING-CLOSURE", "BLOCKED", "DO-NOT-CLOSE", "CLOSED"];
function run() {
  const e = [];
  const idx = path.join(ROOT, "knowledge/ProjectOS Reports Index.md");
  if (!fs.existsSync(idx)) { e.push("missing ProjectOS Reports Index.md"); return e; }
  const t = fs.readFileSync(idx, "utf8");
  ["Date", "Project", "Phase", "Status", "Commit", "Report file", "Notes"].forEach(function (c) { if (t.indexOf(c) === -1) e.push("index missing column: " + c); });
  const lines = t.split(/\r?\n/).filter(function (l) { return /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l); });
  for (const l of lines) {
    const cells = l.split("|").slice(1, -1).map(function (c) { return c.trim(); });
    if (cells.length !== 7) { e.push("row not 7 columns: " + l.trim().slice(0, 60)); continue; }
    if (STATUSES.indexOf(cells[3]) === -1) e.push("row bad status '" + cells[3] + "' in: " + cells[2]);
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-report-index: " + e.length + " error(s)"); process.exit(1); } console.log("validate-report-index: PASS"); }
module.exports = { run };