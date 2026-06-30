"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SCAN = [
  "projectos/templates/dashboard-static-html.template.html",
  "projectos/scripts/build-static-dashboard.cjs", "projectos/scripts/check-dashboard-data.cjs", "projectos/scripts/create-dashboard-report.cjs",
  "projectos/dashboard/dashboard-data.json", "projectos/dashboard/index.html",
  "projectos/examples/generated/demo-dashboard.html", "projectos/examples/generated/demo-dashboard-data.json"
];
const EXTERNAL = [/<script\s+src=/i, /<link[^>]+href=["']?https?:/i, /<a\s+href=["']?https?:/i, /https?:\/\/(cdn|unpkg|jsdelivr|cdnjs|fonts\.googleapis|ajax\.googleapis)/i, /\bfetch\s*\(/, /XMLHttpRequest/];
const NET = ["child_process", "execSync", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')"];
const DANGER = ["vercel deploy", "supabase db", "supabase functions deploy", "netlify deploy", "gh workflow", "git push"];
const PRODPATH = ["C:\\dev\\Polygo", "C:\\dev\\JD Project", "C:\\dev\\BizComply V2"];
function run() {
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
  });
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-dashboard-safety: " + e.length + " error(s)"); process.exit(1); } console.log("validate-dashboard-safety: PASS"); }
module.exports = { run };