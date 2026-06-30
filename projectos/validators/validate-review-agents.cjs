"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const AGENT_REQUIRED = ["id", "provider", "category", "displayName", "allowedModes", "externalToolsAllowed", "requiresOwnerApprovalForExternalTools", "evidencePackSection", "enabledByDefault"];
const REVIEW_REQUIRED = ["reviewId", "category", "required", "agentRef", "evidenceTarget", "blocking", "externalToolsAllowed", "mcpAllowed", "ownerApprovalRequiredForExternalTools"];
const CATEGORIES = ["code-review", "security-review", "database-review", "build-lint-typecheck-review", "test-review", "quality-gate-review", "planner-review", "silent-failure-review"];
function run() {
  const errors = [];
  // 1) reviewAgents in project-config template + demo routing example
  const agentSources = [
    "projectos/templates/project-config.template.json",
    "projectos/examples/demo-ecc-review-routing.projectos.json"
  ];
  const agentIds = new Set();
  for (const rel of agentSources) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj; try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    const agents = obj.reviewAgents;
    if (!Array.isArray(agents) || agents.length === 0) { errors.push(rel + " has no reviewAgents[]"); continue; }
    for (const a of agents) {
      for (const k of AGENT_REQUIRED) if (!(k in a)) errors.push(rel + " reviewAgent missing field: " + k);
      if (a.category && !CATEGORIES.includes(a.category)) errors.push(rel + " reviewAgent bad category: " + a.category);
      if (a.externalToolsAllowed !== false) errors.push(rel + " reviewAgent " + a.id + " externalToolsAllowed must default false");
      if (typeof a.evidencePackSection !== "string" || !a.evidencePackSection) errors.push(rel + " reviewAgent " + a.id + " missing evidencePackSection");
      if (a.id) agentIds.add(a.id);
    }
  }
  // 2) requiredReviews in phase manifest template + demo manifest, mapping to agentRef
  const manifestSources = [
    "projectos/templates/phase-manifest.template.json",
    "projectos/examples/demo-phase-manifest.json"
  ];
  for (const rel of manifestSources) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj; try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    if (obj.autonomousReviewAllowed !== false) errors.push(rel + " autonomousReviewAllowed must be false");
    if (obj.externalToolsAllowed !== false) errors.push(rel + " externalToolsAllowed must default false");
    if (obj.mcpAllowed !== false) errors.push(rel + " mcpAllowed must default false");
    const reqs = obj.requiredReviews;
    if (!Array.isArray(reqs) || reqs.length === 0) { errors.push(rel + " has no requiredReviews[]"); continue; }
    const all = reqs.concat(Array.isArray(obj.optionalReviews) ? obj.optionalReviews : []);
    for (const rv of all) {
      for (const k of REVIEW_REQUIRED) if (!(k in rv)) errors.push(rel + " review missing field: " + k);
      if (rv.category && !CATEGORIES.includes(rv.category)) errors.push(rel + " review bad category: " + rv.category);
      if (rv.externalToolsAllowed !== false) errors.push(rel + " review " + rv.reviewId + " externalToolsAllowed must default false");
      if (rv.mcpAllowed !== false) errors.push(rel + " review " + rv.reviewId + " mcpAllowed must default false");
      if (!rv.evidenceTarget) errors.push(rel + " review " + rv.reviewId + " missing evidenceTarget");
      if (rv.agentRef && !agentIds.has(rv.agentRef)) errors.push(rel + " review " + rv.reviewId + " agentRef '" + rv.agentRef + "' has no matching reviewAgent");
    }
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-review-agents: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-review-agents: PASS");
}
module.exports = { run };