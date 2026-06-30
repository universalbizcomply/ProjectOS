"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const REQUIRED = [
  "projectos/schemas/ci-governance-policy.schema.json", "projectos/schemas/ci-workflow-template.schema.json",
  "projectos/schemas/ci-check-result.schema.json", "projectos/schemas/ci-governance-report.schema.json",
  "projectos/templates/ci-governance-policy.template.json", "projectos/templates/ci-workflow-template.github-actions.template.yml",
  "projectos/templates/ci-required-checks.template.json", "projectos/templates/ci-governance-report.template.md",
  "projectos/templates/branch-protection-recommendations.template.md",
  "projectos/scripts/check-ci-governance-policy.cjs", "projectos/scripts/check-ci-workflow-template.cjs",
  "projectos/scripts/create-ci-governance-report.cjs", "projectos/scripts/check-ci-result.cjs", "projectos/scripts/check-ci-target.cjs",
  "projectos/docs/ci-governance.md",
  "projectos/examples/demo-ci-governance-policy.json", "projectos/examples/demo-ci-required-checks.json", "projectos/examples/demo-ci-check-result.json"
];
function run() {
  const e = [];
  for (const rel of REQUIRED) if (!fs.existsSync(path.join(ROOT, rel))) e.push("missing required CI file: " + rel);
  const rep = path.join(ROOT, "projectos/scripts/create-ci-governance-report.cjs");
  if (fs.existsSync(rep) && fs.readFileSync(rep, "utf8").indexOf("guardOut") === -1) e.push("create-ci-governance-report.cjs does not use guardOut (path guard)");
  const tplRep = path.join(ROOT, "projectos/templates/ci-governance-report.template.md");
  if (fs.existsSync(tplRep) && fs.readFileSync(tplRep, "utf8").toLowerCase().indexOf("not approval") === -1) e.push("ci-governance-report template must state it is not approval");
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-ci-governance: " + e.length + " error(s)"); process.exit(1); } console.log("validate-ci-governance: PASS"); }
module.exports = { run };