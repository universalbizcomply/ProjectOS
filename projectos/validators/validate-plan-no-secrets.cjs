"use strict";
// Plan-memory no-secret validation. The live plan/current-state/session instances, their templates
// and the valid fixtures must carry NO raw secret; the raw-secret fixtures must be caught. This is a
// structured, field-level scan (credential-shaped keys + explicit marker) complementing the global
// regex-based validate-no-secrets. Created in PROJECTOS-V3-MASTER-PLAN-MEMORY1A.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const engine = require("./plan-governance-engine.cjs");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(rel) { return JSON.parse(read(path.join(ROOT, rel))); }
const FIX = "projectos/examples/v3-plan-fixtures/";

const MUST_BE_CLEAN = [
  "projectos/state/projectos-v3.plan.json",
  "projectos/state/projectos-v3.current-state.json",
  "projectos/state/projectos-v3.session.json",
  "projectos/templates/project-plan.template.json",
  "projectos/templates/current-project-state.template.json",
  "projectos/templates/active-execution-session.template.json",
  FIX + "plan-valid-approved-ready.json",
  FIX + "current-state-example.json",
  FIX + "active-session-example.json"
];
const MUST_BE_CAUGHT = [
  FIX + "plan-raw-secret.json",
  FIX + "session-raw-secret.json",
  FIX + "plan-secret-dbpassword.json"
];

function run() {
  const errors = [];
  for (const rel of MUST_BE_CLEAN) {
    let obj;
    try { obj = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const findings = engine.scanRawSecrets(obj);
    if (findings.length) errors.push(rel + " contains raw-secret-shaped values: " + findings.map((f) => f.path).join(", "));
  }
  for (const rel of MUST_BE_CAUGHT) {
    let obj;
    try { obj = readJSON(rel); } catch (e) { errors.push(rel + " not readable: " + e.message); continue; }
    const findings = engine.scanRawSecrets(obj);
    if (!findings.length) errors.push(rel + " should contain a detectable raw secret but none was found");
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-plan-no-secrets: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-plan-no-secrets: PASS");
}
module.exports = { run };
