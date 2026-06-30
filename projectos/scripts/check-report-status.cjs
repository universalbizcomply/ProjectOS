"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const HEADINGS = [
  "Files changed", "Scope", "Forbidden actions checked", "Validators",
  "Security review", "Code review", "Database", "Production touched?",
  "External sends", "Residue", "Risks", "Carry-forward", "Decision needed",
  "External Tools Used", "MCP Used", "Owner Approval Required"
];
const SECRET = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /sk_test_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/
];
function check(file) {
  const e = [];
  if (!fs.existsSync(file)) { return ["missing report: " + file]; }
  const t = fs.readFileSync(file, "utf8");
  HEADINGS.forEach(function (h) { if (t.indexOf(h) === -1) e.push("missing section: " + h); });
  const hasStatus = lib.STATUSES.some(function (s) { return t.indexOf(s) !== -1; }) || /Status:/.test(t);
  if (!hasStatus) e.push("no recognised status line");
  SECRET.forEach(function (re) { if (re.test(t)) e.push("secret-like pattern present"); });
  return e;
}
const file = typeof flags.file === "string" ? path.resolve(flags.file) : null;
if (!file) { console.error("usage: node projectos/scripts/check-report-status.cjs --file <path>"); process.exit(1); }
const e = check(file);
if (e.length) { e.forEach(function (x) { console.error("FAIL: " + x); }); console.error("check-report-status: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-report-status: PASS (" + lib.rel(file) + ")");