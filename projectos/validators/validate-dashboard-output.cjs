"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const EXTERNAL = [/<script\s+src=/i, /<link[^>]+href=["']?https?:/i, /<a\s+href=["']?https?:/i, /https?:\/\/(cdn|unpkg|jsdelivr|cdnjs|fonts\.googleapis|ajax\.googleapis)/i, /\bfetch\s*\(/, /XMLHttpRequest/];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function htmlCheck(rel, e) {
  if (!exists(rel)) { e.push("missing " + rel); return; }
  const t = read(rel);
  EXTERNAL.forEach(function (re) { if (re.test(t)) e.push(rel + " external asset/network pattern"); });
  SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " secret-like value"); });
  if (!/evidence/i.test(t)) e.push(rel + " must state evidence only");
  if (!/(cannot approve|no approval|has no approval)/i.test(t)) e.push(rel + " must state no approval authority");
}
function run() {
  const e = [];
  ["projectos/dashboard/index.html", "projectos/examples/generated/demo-dashboard.html"].forEach(function (rel) { htmlCheck(rel, e); });
  ["projectos/dashboard/dashboard-data.json", "projectos/dashboard/dashboard-generation-report.md"].forEach(function (rel) { if (!exists(rel)) e.push("missing output " + rel); else { const t = read(rel); SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " secret-like value"); }); } });
  const rep = "projectos/dashboard/dashboard-generation-report.md";
  if (exists(rep)) { const t = read(rep); ["Production touched?", "External APIs used?", "Product repos scanned?", "Secrets used?"].forEach(function (h) { if (t.indexOf(h) === -1) e.push(rep + " missing heading: " + h); if (!(new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]{0,6}no")).test(t)) e.push(rep + " " + h + " must be no"); }); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-dashboard-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-dashboard-output: PASS"); }
module.exports = { run };