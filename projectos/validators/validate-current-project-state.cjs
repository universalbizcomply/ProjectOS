"use strict";
// Schema-shape validation for ProjectOS V3 current-project-state records.
// Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/current-project-state.schema.json");
  if (!fs.existsSync(schemaPath)) { errors.push("missing current-project-state.schema.json"); return errors; }
  let schema;
  try { schema = readJSON(schemaPath); } catch (e) { errors.push("schema not valid JSON: " + e.message); return errors; }
  const required = schema.required || [];
  if (!required.length) errors.push("current-project-state schema has no required[]");
  const targets = [
    "projectos/templates/current-project-state.template.json",
    "projectos/examples/v3-plan-fixtures/current-state-example.json",
    "projectos/state/projectos-v3.current-state.json"
  ];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const key of required) if (!(key in obj)) errors.push(rel + " missing required key: " + key);
    for (const err of engine.validateAgainstSchema(obj, schema, rel)) errors.push(err);
    // Completion-calculation proof: only accepted phases count; active + pre-programme maintenance excluded.
    if (typeof obj.acceptedPhaseCount === "number" && typeof obj.totalPhaseCount === "number") {
      const completed = Array.isArray(obj.completedPhases) ? obj.completedPhases : [];
      if (obj.acceptedPhaseCount !== completed.length) errors.push(rel + " acceptedPhaseCount (" + obj.acceptedPhaseCount + ") != completedPhases length (" + completed.length + ")");
      if (obj.activePhase && completed.indexOf(obj.activePhase) !== -1) errors.push(rel + " active phase counted as completed");
      if (completed.indexOf("PROJECTOS-DESKTOP-ICON-FINALISE1A") !== -1) errors.push(rel + " pre-V3 maintenance phase counted toward completion");
      const expected = Math.round((obj.acceptedPhaseCount / obj.totalPhaseCount) * 1000) / 10;
      if (obj.completionPercentage !== expected) errors.push(rel + " completionPercentage " + obj.completionPercentage + " != accepted/total (" + expected + ")");
    }
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-current-project-state: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-current-project-state: PASS");
}
module.exports = { run };
