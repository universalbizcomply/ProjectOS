"use strict";
// Schema-shape validation for ProjectOS V3 active-execution-session records, plus the safety
// invariant that every session proves no forbidden side-effect and no raw secret storage.
// Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const MUST_BE_FALSE = ["productionTouched", "deploymentOccurred", "databaseMutationOccurred", "externalSendOccurred", "paymentOccurred", "secretCapabilityUsed", "rawSecretStored"];
function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/active-execution-session.schema.json");
  if (!fs.existsSync(schemaPath)) { errors.push("missing active-execution-session.schema.json"); return errors; }
  let schema;
  try { schema = readJSON(schemaPath); } catch (e) { errors.push("schema not valid JSON: " + e.message); return errors; }
  const required = schema.required || [];
  if (!required.length) errors.push("active-execution-session schema has no required[]");
  const targets = [
    "projectos/templates/active-execution-session.template.json",
    "projectos/examples/v3-plan-fixtures/active-session-example.json",
    "projectos/state/projectos-v3.session.json"
  ];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const key of required) if (!(key in obj)) errors.push(rel + " missing required key: " + key);
    for (const err of engine.validateAgainstSchema(obj, schema, rel)) errors.push(err);
    for (const flag of MUST_BE_FALSE) if (obj[flag] !== false) errors.push(rel + " " + flag + " must be false");
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-active-execution-session: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-active-execution-session: PASS");
}
module.exports = { run };
