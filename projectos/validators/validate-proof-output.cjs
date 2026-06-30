"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const FORBIDDEN = ["child_process", "execSync", "spawnSync", "spawn(", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')", "fetch(", "https://", "vercel deploy", "supabase functions deploy", "netlify deploy", "INSERT INTO", "DELETE FROM", "DROP TABLE", "TRUNCATE TABLE"];
const SCRIPTS = ["check-proof-request.cjs", "create-proof-plan.cjs", "create-proof-evidence-skeleton.cjs", "create-cleanup-plan.cjs", "check-proof-target.cjs"];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function run() {
  const e = [];
  const plan = "projectos/examples/generated/demo-proof-plan.md";
  const ev = "projectos/examples/generated/demo-proof-evidence-skeleton.md";
  const cu = "projectos/examples/generated/demo-cleanup-plan.md";
  if (!exists(plan)) e.push("missing " + plan);
  else { const t = read(plan); if (t.indexOf("Proof executed: false") === -1 && t.toLowerCase().indexOf("no proof performed") === -1 && t.toLowerCase().indexOf("does not execute proof") === -1) e.push(plan + " must state no proof executed"); ["Execution steps", "Decision needed"].forEach(function (h) { if (t.indexOf(h) === -1) e.push(plan + " missing heading: " + h); }); }
  if (!exists(ev)) e.push("missing " + ev);
  else { const t = read(ev); if (t.indexOf("NOT RUN") === -1) e.push(ev + " must contain NOT RUN"); if (!/Proof attempted\?[\s\S]{0,8}false/.test(t)) e.push(ev + " proofAttempted must be false"); if (!/Proof executed\?[\s\S]{0,8}false/.test(t)) e.push(ev + " proofExecuted must be false"); }
  if (!exists(cu)) e.push("missing " + cu);
  else { const t = read(cu); if (t.toLowerCase().indexOf("does not execute cleanup") === -1 && t.toLowerCase().indexOf("not executed") === -1) e.push(cu + " must state cleanup not executed"); }
  ["projectos/templates/proof-request.template.json", "projectos/templates/proof-plan.template.md", "projectos/templates/proof-evidence.template.md", "projectos/templates/cleanup-plan.template.md", "projectos/templates/proof-factory-report.template.md", "projectos/examples/demo-proof-request.json", plan, ev, cu].forEach(function (rel) { if (exists(rel)) { const t = read(rel); SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " contains secret-like value"); }); } });
  for (const s of SCRIPTS) {
    const rel = "projectos/scripts/" + s;
    if (!exists(rel)) { e.push("missing script " + rel); continue; }
    const t = read(rel);
    FORBIDDEN.forEach(function (tok) { if (t.indexOf(tok) !== -1) e.push(rel + " contains forbidden token: " + tok); });
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-proof-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-proof-output: PASS"); }
module.exports = { run };