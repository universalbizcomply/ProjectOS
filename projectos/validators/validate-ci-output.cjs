"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const FORBIDDEN = ["child_process", "execSync", "spawnSync", "spawn(", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')", "fetch("];
const SCRIPTS = ["check-ci-governance-policy.cjs", "check-ci-workflow-template.cjs", "create-ci-governance-report.cjs", "check-ci-result.cjs", "check-ci-target.cjs"];
const STATUSES = ["PASS", "WARN", "FAIL", "BLOCKED", "SKIPPED", "NEEDS-SOURCE", "NOT-VERIFIED"];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function falseField(t, label) { const re = new RegExp(label + "[\\s\\S]{0,8}no"); return re.test(t); }
function run() {
  const e = [];
  const rep = "projectos/examples/generated/demo-ci-governance-report.md";
  if (!exists(rep)) e.push("missing " + rep);
  else { const t = read(rep); ["Production touched?", "Deploy attempted?", "Database touched?", "External sends / payments?", "Secrets used?", "External tools used?", "MCP used?"].forEach(function (h) { if (t.indexOf(h) === -1) e.push(rep + " missing heading: " + h); if (!falseField(t, h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) e.push(rep + " " + h + " must be no"); }); if (t.toLowerCase().indexOf("ci not installed") === -1) e.push(rep + " must state CI not installed"); if (t.toLowerCase().indexOf("no github actions") === -1) e.push(rep + " must state no GitHub Actions created"); }
  const bp = "projectos/examples/generated/demo-branch-protection-recommendations.md";
  if (!exists(bp)) e.push("missing " + bp);
  else { const t = read(bp).toLowerCase(); if (t.indexOf("recommendation only") === -1) e.push(bp + " must say recommendation only"); if (t.indexOf("does not configure github") === -1) e.push(bp + " must say does not configure GitHub"); if (t.indexOf("owner approval required") === -1) e.push(bp + " must say owner approval required"); }
  const cr = "projectos/examples/demo-ci-check-result.json";
  if (!exists(cr)) e.push("missing " + cr);
  else { let o; try { o = JSON.parse(read(cr).replace(/^﻿/, "")); } catch (x) { e.push(cr + " invalid JSON: " + x.message); o = null; } if (o) { ["productionTouched", "deployAttempted", "databaseTouched", "secretsUsed", "externalToolsUsed", "sendsOrPaymentsTouched"].forEach(function (k) { if (o[k] !== false) e.push(cr + " " + k + " must be false"); }); if (o.mcpUsed !== undefined && o.mcpUsed !== false) e.push(cr + " mcpUsed must be false"); if (STATUSES.indexOf(o.status) === -1) e.push(cr + " bad status: " + o.status); } }
  ["projectos/templates/ci-governance-policy.template.json", "projectos/templates/ci-required-checks.template.json", "projectos/templates/ci-governance-report.template.md", "projectos/templates/branch-protection-recommendations.template.md", "projectos/examples/demo-ci-governance-policy.json", "projectos/examples/demo-ci-required-checks.json", "projectos/examples/demo-ci-check-result.json", rep, bp].forEach(function (rel) { if (exists(rel)) { const t = read(rel); SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " contains secret-like value"); }); } });
  for (const s of SCRIPTS) { const rel = "projectos/scripts/" + s; if (!exists(rel)) { e.push("missing script " + rel); continue; } const t = read(rel); FORBIDDEN.forEach(function (tok) { if (t.indexOf(tok) !== -1) e.push(rel + " contains forbidden token: " + tok); }); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-ci-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-ci-output: PASS"); }
module.exports = { run };