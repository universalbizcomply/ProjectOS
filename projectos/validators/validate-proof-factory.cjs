"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const REQUIRED = [
  "projectos/schemas/proof-request.schema.json", "projectos/schemas/proof-plan.schema.json",
  "projectos/schemas/proof-evidence.schema.json", "projectos/schemas/cleanup-plan.schema.json",
  "projectos/schemas/proof-factory-policy.schema.json",
  "projectos/templates/proof-request.template.json", "projectos/templates/proof-plan.template.md",
  "projectos/templates/proof-evidence.template.md", "projectos/templates/cleanup-plan.template.md",
  "projectos/templates/proof-factory-report.template.md",
  "projectos/scripts/check-proof-request.cjs", "projectos/scripts/create-proof-plan.cjs",
  "projectos/scripts/create-proof-evidence-skeleton.cjs", "projectos/scripts/create-cleanup-plan.cjs",
  "projectos/scripts/check-proof-target.cjs",
  "projectos/docs/proof-factory.md", "projectos/examples/demo-proof-request.json"
];
const GUARDED = ["create-proof-plan.cjs", "create-proof-evidence-skeleton.cjs", "create-cleanup-plan.cjs"];
function run() {
  const e = [];
  for (const rel of REQUIRED) if (!fs.existsSync(path.join(ROOT, rel))) e.push("missing required proof-factory file: " + rel);
  for (const g of GUARDED) { const p = path.join(ROOT, "projectos/scripts", g); if (fs.existsSync(p) && fs.readFileSync(p, "utf8").indexOf("guardOut") === -1) e.push(g + " does not use guardOut (path guard)"); }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-proof-factory: " + e.length + " error(s)"); process.exit(1); } console.log("validate-proof-factory: PASS"); }
module.exports = { run };