"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const FORBIDDEN = ["child_process", "execSync", "spawnSync", "spawn(", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')", "fetch(", "https://", "vercel deploy", "supabase functions deploy", "netlify deploy", "INSERT INTO", "DELETE FROM", "DROP TABLE", "TRUNCATE TABLE"];
const SCRIPTS = ["check-drift-request.cjs", "check-drift-snapshot.cjs", "compare-drift-snapshots.cjs", "create-drift-report-skeleton.cjs", "check-drift-target.cjs"];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function lowHas(t, s) { return t.toLowerCase().indexOf(s) !== -1; }
function run() {
  const e = [];
  const rep = "projectos/examples/generated/demo-drift-report.md";
  const sk = "projectos/examples/generated/demo-drift-report-skeleton.md";
  if (!exists(rep)) e.push("missing " + rep);
  else { const t = read(rep); ["Production touched?", "Live inspection used?", "Secrets used?", "Repair attempted?", "Findings", "Decision needed"].forEach(function (h) { if (t.indexOf(h) === -1) e.push(rep + " missing heading: " + h); }); if (!lowHas(t, "no live service checked") && !lowHas(t, "live inspection used?\nno")) { if (!/Live inspection used\?[\s\S]{0,6}no/.test(t)) e.push(rep + " must state no live inspection"); } if (!/Repair attempted\?[\s\S]{0,6}no/.test(t)) e.push(rep + " must state repair=no"); }
  if (!exists(sk)) e.push("missing " + sk);
  else { const t = read(sk); if (!lowHas(t, "skeleton")) e.push(sk + " must say skeleton"); if (!/Live inspection used\?[\s\S]{0,6}no/.test(t)) e.push(sk + " must state no live inspection"); if (!/Repair attempted\?[\s\S]{0,6}no/.test(t)) e.push(sk + " must state repair=no"); if (t.indexOf("Decision needed") === -1) e.push(sk + " missing Decision needed"); }
  ["projectos/templates/drift-check-request.template.json", "projectos/templates/drift-snapshot.template.json", "projectos/templates/drift-finding.template.json", "projectos/templates/drift-report.template.md", "projectos/templates/drift-detector-report.template.md", "projectos/examples/demo-drift-check-request.json", "projectos/examples/demo-drift-expected-snapshot.json", "projectos/examples/demo-drift-observed-snapshot.json", rep, sk].forEach(function (rel) { if (exists(rel)) { const t = read(rel); SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " contains secret-like value"); }); } });
  for (const s of SCRIPTS) { const rel = "projectos/scripts/" + s; if (!exists(rel)) { e.push("missing script " + rel); continue; } const t = read(rel); FORBIDDEN.forEach(function (tok) { if (t.indexOf(tok) !== -1) e.push(rel + " contains forbidden token: " + tok); }); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-drift-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-drift-output: PASS"); }
module.exports = { run };