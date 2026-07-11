"use strict";
// Guards the integrity of the ProjectOS V2 final closure evidence pack. Structured, section-level
// checks over the closure report, requirement-evidence matrix, final risk register and the report
// index. NOT auto-discovered by validate-all.cjs (which uses a fixed module list); run explicitly:
//   node projectos/validators/validate-v2-closure-evidence.cjs
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

const REPORT_REL = "knowledge/reports/2026-07-11_ProjectOS_PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A_AWAITING-CLOSURE.md";
const MATRIX_REL = "docs/architecture/projectos-v2-requirement-evidence-matrix.md";
const RISK_REL = "docs/architecture/projectos-v2-final-risk-register.md";
const INDEX_REL = "knowledge/ProjectOS Reports Index.md";
const PHASE = "PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A";

const MATRIX_STATUSES = ["COMPLETE AND PROVEN", "COMPLETE WITH MANUAL EVIDENCE", "OPTIONAL CARRY-FORWARD", "OUT OF V2 SCOPE"];
const BANNED_MATRIX = ["PARTIAL", "UNKNOWN", "UNPROVEN"];

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function tableRows(md) {
  // Return cell arrays for table data rows (excludes separator rows). Header rows included;
  // callers skip by known first-cell label.
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|[\s|:\-]+$/.test(t)) continue; // separator row
    out.push(t.split("|").slice(1, -1).map((c) => c.trim()));
  }
  return out;
}

function run() {
  const e = [];

  // 1. Files exist.
  const report = read(REPORT_REL);
  const matrix = read(MATRIX_REL);
  const risk = read(RISK_REL);
  const index = read(INDEX_REL);
  if (report === null) e.push("missing closure report: " + REPORT_REL);
  if (matrix === null) e.push("missing requirement-evidence matrix: " + MATRIX_REL);
  if (risk === null) e.push("missing final risk register: " + RISK_REL);
  if (index === null) e.push("missing report index: " + INDEX_REL);
  if (e.length) return e; // cannot continue without the files

  // 2. Closure report section-level checks.
  const need = [
    [PHASE, "report missing phase id"],
    ["AWAITING CLOSURE", "report missing AWAITING CLOSURE status"],
    ["Murad and ChatGPT only", "report missing owner/gatekeeper closure authority"],
    ["18/18", "report missing login-wall desktop evidence (18/18)"],
    ["76/76", "report missing authenticated Mission Control evidence (76/76)"],
    ["3/3", "report missing repeatability evidence (3/3)"],
    [".vscode-test", "report missing no-secrets validator correction (.vscode-test)"],
    ["fba757a", "report missing accepted corrective commit fba757a"],
    ["Production touched: NO", "report missing 'Production touched: NO'"],
    ["Deploy: NO", "report missing 'Deploy: NO'"],
    ["Database mutation: NO", "report missing 'Database mutation: NO'"],
    ["External sends: NO", "report missing 'External sends: NO'"],
    ["Payments: NO", "report missing 'Payments: NO'"],
  ];
  for (const [s, msg] of need) if (report.indexOf(s) === -1) e.push(msg);
  if (!/Claude[^\n]*not the closure authority/i.test(report)) e.push("report must state Claude is not the closure authority");
  if (!/desktop-automation prerequisite[^\n.]*COMPLETE/i.test(report)) e.push("report must record desktop-automation prerequisite COMPLETE");
  if (!/exact decision required/i.test(report)) e.push("report missing an exact decision required");
  if (/\bclosed by Claude\b|\bClaude closed\b/i.test(report)) e.push("report must not state ProjectOS V2 was closed by Claude");

  // 3. Requirement-evidence matrix: every data-row status is allowed; none PARTIAL/UNKNOWN/UNPROVEN.
  let matrixData = 0;
  for (const cells of tableRows(matrix)) {
    if (cells[0] === "Requirement") continue; // header
    if (cells.length < 2) continue;
    matrixData += 1;
    const status = cells[1];
    if (MATRIX_STATUSES.indexOf(status) === -1) e.push("matrix bad status '" + status + "' for: " + cells[0]);
    for (const b of BANNED_MATRIX) if (status.toUpperCase().indexOf(b) !== -1) e.push("matrix mandatory-forbidden status '" + b + "' for: " + cells[0]);
  }
  if (matrixData < 20) e.push("matrix has too few requirement rows (" + matrixData + ")");

  // 4. Risk register: every data row closure-blocker = NO; no CRITICAL/HIGH severity present.
  let riskData = 0;
  for (const cells of tableRows(risk)) {
    if (cells[0] === "ID") continue; // header
    if (cells.length < 9) continue;
    riskData += 1;
    const severity = (cells[3] || "").toUpperCase();
    const blocker = (cells[8] || "").toUpperCase();
    if (blocker !== "NO") e.push("risk " + cells[0] + " closure blocker is not NO ('" + cells[8] + "')");
    if (severity === "CRITICAL" || severity === "HIGH") e.push("risk " + cells[0] + " has unresolved " + severity + " severity");
  }
  if (riskData < 10) e.push("risk register has too few rows (" + riskData + ")");

  // 5. Report-index row present, AWAITING-CLOSURE, path matches the report.
  const reportFile = REPORT_REL.replace(/^knowledge\//, "");
  let indexRowOk = false;
  for (const cells of tableRows(index)) {
    if (cells.length !== 7) continue;
    if (cells[2] !== PHASE) continue;
    if (cells[3] !== "AWAITING-CLOSURE") { e.push("index row status for " + PHASE + " is '" + cells[3] + "' (want AWAITING-CLOSURE)"); }
    if (cells[5].indexOf(reportFile) === -1 && cells[5].indexOf(path.basename(REPORT_REL)) === -1) {
      e.push("index row report-file does not match the report path");
    } else {
      indexRowOk = true;
    }
  }
  if (!indexRowOk) e.push("report index missing an AWAITING-CLOSURE row for " + PHASE + " pointing at the report file");

  return e;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-v2-closure-evidence: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-v2-closure-evidence: PASS");
}
module.exports = { run };
