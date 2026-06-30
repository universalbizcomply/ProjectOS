"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const FULL_HEADINGS = ["Files changed", "Scope", "Forbidden actions checked", "Validators", "Production touched?", "External sends", "Residue", "Carry-forward", "Decision needed", "Owner Approval Required", "MCP Used", "External Tools Used"];
function scan(rel, headings) {
  const e = [];
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { return ["missing " + rel]; }
  const t = fs.readFileSync(p, "utf8");
  headings.forEach(function (h) { if (t.indexOf(h) === -1) e.push(rel + " missing heading: " + h); });
  SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " contains secret-like value"); });
  return e;
}
function run() {
  let e = [];
  e = e.concat(scan("projectos/examples/generated/demo-phase-report.md", FULL_HEADINGS));
  e = e.concat(scan("projectos/examples/generated/demo-pre-push-review-pack.md", ["Files changed", "Validators", "Push decision needed"]));
  e = e.concat(scan("projectos/examples/generated/demo-closure-report.md", ["Closure decision", "Final status", "Decision needed"]));
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-report-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-report-output: PASS"); }
module.exports = { run };