"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const CATEGORIES = ["code-review", "security-review", "database-review", "build-lint-typecheck-review", "test-review", "quality-gate-review", "planner-review", "silent-failure-review"];
const SECRET = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /sk_live_[A-Za-z0-9]{16,}/,
  /sk_test_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/,
  /sbp_[a-f0-9]{40,}/,
  /ghp_[A-Za-z0-9]{36,}/
];
function run() {
  const errors = [];
  // routing template
  const rtRel = "projectos/templates/ecc-review-routing.template.json";
  const rtPath = path.join(ROOT, rtRel);
  if (!fs.existsSync(rtPath)) errors.push("missing " + rtRel);
  else {
    let txt = read(rtPath), rt;
    for (const re of SECRET) if (re.test(txt)) errors.push(rtRel + " contains a real-secret-shaped value");
    try { rt = JSON.parse(txt); } catch (e) { errors.push(rtRel + " not valid JSON: " + e.message); rt = null; }
    if (rt) {
      if (rt.externalToolsDefault !== false) errors.push(rtRel + " externalToolsDefault must be false");
      if (rt.mcpDefault !== false) errors.push(rtRel + " mcpDefault must be false");
      if (rt.autonomousBehaviourDefault !== false) errors.push(rtRel + " autonomousBehaviourDefault must be false");
      const cats = rt.categories;
      if (!Array.isArray(cats) || cats.length === 0) errors.push(rtRel + " has no categories[]");
      else for (const c of cats) {
        if (!c.category || !CATEGORIES.includes(c.category)) errors.push(rtRel + " bad/missing category: " + c.category);
        if (!c.agentRef) errors.push(rtRel + " category " + c.category + " missing agentRef");
        if (!c.evidenceTarget) errors.push(rtRel + " category " + c.category + " missing evidenceTarget");
      }
    }
  }
  // demo routing project config policies
  const demoRel = "projectos/examples/demo-ecc-review-routing.projectos.json";
  const demoPath = path.join(ROOT, demoRel);
  if (!fs.existsSync(demoPath)) errors.push("missing " + demoRel);
  else {
    let txt = read(demoPath), d;
    for (const re of SECRET) if (re.test(txt)) errors.push(demoRel + " contains a real-secret-shaped value");
    try { d = JSON.parse(txt); } catch (e) { errors.push(demoRel + " not valid JSON: " + e.message); d = null; }
    if (d) {
      if (!d.externalToolsPolicy || d.externalToolsPolicy.default !== "disabled") errors.push(demoRel + " externalToolsPolicy.default must be 'disabled'");
      if (!d.mcpPolicy || d.mcpPolicy.default !== "disabled") errors.push(demoRel + " mcpPolicy.default must be 'disabled'");
      if (!d.autonomousBehaviourPolicy || d.autonomousBehaviourPolicy.default !== "disabled") errors.push(demoRel + " autonomousBehaviourPolicy.default must be 'disabled'");
      if (Array.isArray(d.reviewAgents)) for (const a of d.reviewAgents) if (a.externalToolsAllowed !== false) errors.push(demoRel + " agent " + a.id + " externalToolsAllowed must be false");
    }
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-ecc-routing: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-ecc-routing: PASS");
}
module.exports = { run };