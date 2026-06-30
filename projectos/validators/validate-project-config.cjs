"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/project-config.schema.json");
  if (!fs.existsSync(schemaPath)) { errors.push("missing project-config.schema.json"); return errors; }
  let schema;
  try { schema = readJSON(schemaPath); } catch (e) { errors.push("schema not valid JSON: " + e.message); return errors; }
  const required = schema.required || [];
  if (!required.length) errors.push("project-config schema has no required[]");
  const targets = [
    "projectos/templates/project-config.template.json",
    "projectos/examples/demo-saas.projectos.json",
    "projectos/examples/demo-booking-platform.projectos.json",
    "projectos/examples/demo-ops-tool.projectos.json"
  ];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const key of required) if (!(key in obj)) errors.push(rel + " missing required key: " + key);
    if (Array.isArray(obj.forbiddenActions) && obj.forbiddenActions.length === 0) errors.push(rel + " forbiddenActions is empty");
    if (Array.isArray(obj.approvalGates) && obj.approvalGates.length === 0) errors.push(rel + " approvalGates is empty");
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-project-config: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-project-config: PASS");
}
module.exports = { run };