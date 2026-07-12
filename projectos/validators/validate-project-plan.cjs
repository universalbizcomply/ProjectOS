"use strict";
// Schema-shape validation for ProjectOS V3 project-plan records: every schema-required top-level key
// present on the template, the valid fixture, and the live ProjectOS V3 plan instance.
// Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/project-plan.schema.json");
  if (!fs.existsSync(schemaPath)) { errors.push("missing project-plan.schema.json"); return errors; }
  let schema;
  try { schema = readJSON(schemaPath); } catch (e) { errors.push("schema not valid JSON: " + e.message); return errors; }
  const required = schema.required || [];
  if (!required.length) errors.push("project-plan schema has no required[]");
  const targets = [
    "projectos/templates/project-plan.template.json",
    "projectos/examples/v3-plan-fixtures/plan-valid-approved-ready.json",
    "projectos/state/projectos-v3.plan.json"
  ];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const key of required) if (!(key in obj)) errors.push(rel + " missing required key: " + key);
    for (const err of engine.validateAgainstSchema(obj, schema, rel)) errors.push(err);
    const gov = obj.governance || {};
    if (Array.isArray(gov.forbiddenActions) && gov.forbiddenActions.length === 0) errors.push(rel + " governance.forbiddenActions is empty");
  }
  // Commit-semantics proof on the live ProjectOS V3 plan (pre-commit state).
  try {
    const live = readJSON(path.join(ROOT, "projectos/state/projectos-v3.plan.json"));
    const repo = live.repository || {};
    if (!/^[0-9a-f]{40}$/.test(repo.baselineCommit || "")) errors.push("live plan baselineCommit is not a 40-hex commit");
    if (repo.planPersistenceCommit !== null) errors.push("live plan planPersistenceCommit must be null before commit (got " + JSON.stringify(repo.planPersistenceCommit) + ")");
    const auth = (live.sourceDocuments || []).find((d) => d.authoritative && !d.superseded);
    if (!auth || !/^sha256:/.test(auth.sourceDocumentChecksum || "")) errors.push("live plan missing authoritative source-document sha256 checksum");
  } catch (e) { errors.push("live plan not readable for commit-semantics check: " + e.message); }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-project-plan: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-project-plan: PASS");
}
module.exports = { run };
