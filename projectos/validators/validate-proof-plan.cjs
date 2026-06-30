"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const e = [];
  ["projectos/schemas/proof-plan.schema.json", "projectos/schemas/cleanup-plan.schema.json", "projectos/schemas/proof-evidence.schema.json"].forEach(function (rel) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); return; }
    try { readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); }
  });
  const pol = path.join(ROOT, "projectos/schemas/proof-factory-policy.schema.json");
  if (!fs.existsSync(pol)) e.push("missing proof-factory-policy.schema.json");
  else {
    let g; try { g = readJSON(pol); } catch (x) { e.push("policy schema invalid JSON: " + x.message); g = null; }
    if (g) {
      const props = g.properties || {};
      ["productionRefuseByDefault", "forbiddenEnvironments", "approvalPolicy", "cleanupPolicy"].forEach(function (k) { if (!(k in props)) e.push("policy schema missing property: " + k); });
      if ((g.required || []).indexOf("productionRefuseByDefault") === -1) e.push("policy schema must require productionRefuseByDefault");
    }
  }
  const tplPlan = path.join(ROOT, "projectos/templates/proof-plan.template.md");
  if (!fs.existsSync(tplPlan)) e.push("missing proof-plan.template.md");
  else { const t = read(tplPlan); ["Execution steps", "Forbidden actions", "Cleanup plan", "Decision needed"].forEach(function (h) { if (t.indexOf(h) === -1) e.push("proof-plan template missing: " + h); }); if (t.toLowerCase().indexOf("does not execute proof") === -1) e.push("proof-plan template must state it does not execute proof"); }
  const tplRep = path.join(ROOT, "projectos/templates/proof-factory-report.template.md");
  if (!fs.existsSync(tplRep)) e.push("missing proof-factory-report.template.md");
  else { const t = read(tplRep); if (t.toLowerCase().indexOf("recommendation is not approval") === -1) e.push("proof-factory-report template must state recommendation is not approval"); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-proof-plan: " + e.length + " error(s)"); process.exit(1); } console.log("validate-proof-plan: PASS"); }
module.exports = { run };