"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const DANGER = ["vercel deploy", "supabase db", "supabase functions deploy", "netlify deploy", "gh workflow", "git push", "stripe", "resend", "twilio"];
const SECRET_REF = [/\$\{\{\s*secrets\./, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /ghp_[A-Za-z0-9]{36,}/];
const COMMENTS = ["template only", "not installed", "no deploy"];
function hasGithubWorkflows(dir) {
  let found = false;
  (function walk(d) {
    if (found) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (x) { return; }
    for (const ent of ents) {
      if (found) return;
      if (ent.isDirectory()) {
        if (ent.name === ".git" || ent.name === "node_modules") continue;
        const p = path.join(d, ent.name);
        if (p.replace(/\\/g, "/").toLowerCase().indexOf(".github/workflows") !== -1) { found = true; return; }
        walk(p);
      }
    }
  })(dir);
  return found;
}
function run() {
  const e = [];
  if (hasGithubWorkflows(ROOT)) e.push("a .github/workflows path exists under ProjectOS (forbidden in this phase)");
  const rel = "projectos/templates/ci-workflow-template.github-actions.template.yml";
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { e.push("missing " + rel); return e; }
  const norm = p.replace(/\\/g, "/").toLowerCase();
  if (norm.indexOf(".github/workflows") !== -1) e.push("workflow template must not be under .github/workflows");
  if (norm.indexOf("/projectos/templates/") === -1) e.push("workflow template must live under projectos/templates");
  const t = fs.readFileSync(p, "utf8");
  const low = t.toLowerCase();
  DANGER.forEach(function (d) { if (low.indexOf(d) !== -1) e.push("workflow template contains dangerous command: " + d); });
  SECRET_REF.forEach(function (re) { if (re.test(t)) e.push("workflow template contains secret reference"); });
  COMMENTS.forEach(function (c) { if (low.indexOf(c) === -1) e.push("workflow template missing comment marker: '" + c + "'"); });
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-ci-workflow-template: " + e.length + " error(s)"); process.exit(1); } console.log("validate-ci-workflow-template: PASS"); }
module.exports = { run };