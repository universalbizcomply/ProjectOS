"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const e = [];
  const gp = path.join(ROOT, "projectos/schemas/staging-deploy-guard.schema.json");
  if (!fs.existsSync(gp)) { e.push("missing staging-deploy-guard.schema.json"); }
  else {
    let g; try { g = readJSON(gp); } catch (x) { e.push("guard schema invalid JSON: " + x.message); g = null; }
    if (g) {
      const props = g.properties || {};
      ["productionRefuseByDefault", "forbiddenTargetEnvironments", "approvalPolicy", "allowedTargetEnvironments"].forEach(function (k) { if (!(k in props)) e.push("guard schema missing property: " + k); });
      const reqd = g.required || [];
      if (reqd.indexOf("productionRefuseByDefault") === -1) e.push("guard schema must require productionRefuseByDefault");
    }
  }
  const tpl = path.join(ROOT, "projectos/templates/staging-deploy-guard-report.template.md");
  if (!fs.existsSync(tpl)) e.push("missing staging-deploy-guard-report.template.md");
  else { const t = read(tpl); ["Recommendation", "Decision needed", "Target validation", "Policy validation"].forEach(function (h) { if (t.indexOf(h) === -1) e.push("guard report template missing: " + h); }); if (t.toLowerCase().indexOf("recommendation is not approval") === -1) e.push("guard report template must state recommendation is not approval"); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-staging-deploy-guard: " + e.length + " error(s)"); process.exit(1); } console.log("validate-staging-deploy-guard: PASS"); }
module.exports = { run };