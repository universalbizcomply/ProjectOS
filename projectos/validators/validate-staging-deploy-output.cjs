"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const FORBIDDEN_IN_SCRIPTS = ["child_process", "execSync", "spawnSync", "spawn(", "require(\"http\")", "require('http')", "require(\"https\")", "require('https')", "fetch(", "vercel deploy", "supabase functions deploy", "netlify deploy", "https://"];
const DEPLOY_SCRIPTS = ["create-staging-deploy-plan.cjs", "check-staging-deploy-request.cjs", "create-staging-deploy-result-skeleton.cjs", "check-deploy-target.cjs"];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function run() {
  const e = [];
  const plan = "projectos/examples/generated/demo-staging-deploy-plan.md";
  const res = "projectos/examples/generated/demo-staging-deploy-result-skeleton.md";
  if (!exists(plan)) e.push("missing " + plan);
  else { const t = read(plan); ["Target environment", "Rollback plan", "Staging proof plan", "Approval status", "Decision needed", "Production touched?", "Secrets accessed?"].forEach(function (h) { if (t.indexOf(h) === -1) e.push(plan + " missing heading: " + h); }); if (t.indexOf("Deploy executed: false") === -1 && t.toLowerCase().indexOf("no deploy was performed") === -1) e.push(plan + " must state no deploy executed"); }
  if (!exists(res)) e.push("missing " + res);
  else { const t = read(res); if (t.indexOf("NOT RUN") === -1) e.push(res + " must contain NOT RUN deploy command"); if (!/Deploy attempted\?[\s\S]{0,8}false/.test(t)) e.push(res + " deployAttempted must be false"); if (!/Deploy executed\?[\s\S]{0,8}false/.test(t)) e.push(res + " deployExecuted must be false"); }
  // secret scan on deploy templates + examples
  ["projectos/templates/staging-deploy-request.template.json", "projectos/templates/staging-deploy-plan.template.md", "projectos/templates/staging-deploy-guard-report.template.md", "projectos/templates/staging-deploy-result.template.md", "projectos/examples/demo-staging-deploy-request.json", plan, res].forEach(function (rel) { if (exists(rel)) { const t = read(rel); SECRET.forEach(function (re) { if (re.test(t)) e.push(rel + " contains secret-like value"); }); } });
  // scripts must not invoke deploy CLIs or network
  for (const s of DEPLOY_SCRIPTS) {
    const rel = "projectos/scripts/" + s;
    if (!exists(rel)) { e.push("missing script " + rel); continue; }
    const t = read(rel);
    FORBIDDEN_IN_SCRIPTS.forEach(function (tok) { if (t.indexOf(tok) !== -1) e.push(rel + " contains forbidden token: " + tok); });
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-staging-deploy-output: " + e.length + " error(s)"); process.exit(1); } console.log("validate-staging-deploy-output: PASS"); }
module.exports = { run };