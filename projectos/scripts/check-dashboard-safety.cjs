"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const ROOT = lib.ROOT;
// Scan the render/output surfaces. The sanitizer (collect-dashboard-data) and this scanner itself
// legitimately contain pattern literals and are excluded.
const SCAN = [
  "projectos/templates/dashboard-static-html.template.html",
  "projectos/scripts/build-static-dashboard.cjs", "projectos/scripts/check-dashboard-data.cjs", "projectos/scripts/create-dashboard-report.cjs",
  "projectos/examples/demo-dashboard-config.json", "projectos/examples/generated/demo-dashboard-data.json", "projectos/examples/generated/demo-dashboard.html",
  "projectos/dashboard/dashboard-data.json", "projectos/dashboard/index.html", "projectos/dashboard/dashboard-generation-report.md"
];
const EXTERNAL = [/<script\s+src=/i, /<link[^>]+href=["']?https?:/i, /<a\s+href=["']?https?:/i, /https?:\/\/(cdn|unpkg|jsdelivr|cdnjs|fonts\.googleapis|ajax\.googleapis)/i, /\bfetch\s*\(/, /XMLHttpRequest/];
const NET = ["child_process", "execSync", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')"];
const DANGER = ["vercel deploy", "supabase db", "supabase functions deploy", "netlify deploy", "gh workflow", "git push", "stripe charge", "twilio"];
const PRODPATH = ["C:\\dev\\Polygo", "C:\\dev\\JD Project", "C:\\dev\\BizComply V2"];
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const APPROVAL = [/dashboard\s+(can|may|will)\s+(approve|close)/i, /dashboardCanApprove["']?\s*:\s*true/i, /dashboardCanClose["']?\s*:\s*true/i];
const e = [];
SCAN.forEach(function (rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const t = fs.readFileSync(p, "utf8");
  const isScript = rel.indexOf("/scripts/") !== -1;
  EXTERNAL.forEach(function (re) { if (re.test(t)) e.push(rel + " external asset/network pattern"); });
  if (isScript) NET.forEach(function (tok) { if (t.indexOf(tok) !== -1) e.push(rel + " network token: " + tok); });
  DANGER.forEach(function (tok) { if (t.toLowerCase().indexOf(tok) !== -1) e.push(rel + " dangerous command: " + tok); });
  if (isScript) PRODPATH.forEach(function (pp) { if (t.indexOf(pp) !== -1) e.push(rel + " references product path: " + pp); });
  SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " secret-like value"); });
  APPROVAL.forEach(function (re) { if (re.test(t)) e.push(rel + " claims approval/closure authority"); });
});
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-dashboard-safety: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-dashboard-safety: PASS (no external assets/network/secrets/dangerous commands/approval claims)");