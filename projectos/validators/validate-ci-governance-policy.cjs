"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/ci-governance-policy.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing ci-governance-policy.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/ci-governance-policy.template.json", "projectos/examples/demo-ci-governance-policy.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let o; try { o = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in o)) e.push(rel + " missing field: " + k);
    if (o.deploymentPolicy && o.deploymentPolicy.productionAutoDeploy !== false) e.push(rel + " productionAutoDeploy must be false");
    if (o.databasePolicy && o.databasePolicy.liveMutation !== false) e.push(rel + " liveMutation must be false");
    if (o.sendPaymentPolicy && (o.sendPaymentPolicy.realSend !== false || o.sendPaymentPolicy.payment !== false)) e.push(rel + " realSend/payment must be false");
    if (!o.secretPolicy || o.secretPolicy.secretsInTemplates !== "prohibited") e.push(rel + " secretsInTemplates must be prohibited");
    if (o.ownerApprovalPolicy && o.ownerApprovalPolicy.inferApproval !== false) e.push(rel + " inferApproval must be false");
    if (o.externalToolsPolicy && o.externalToolsPolicy.default !== "disabled") e.push(rel + " externalToolsPolicy.default must be disabled");
    if (o.mcpPolicy && o.mcpPolicy.default !== "disabled") e.push(rel + " mcpPolicy.default must be disabled");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-ci-governance-policy: " + e.length + " error(s)"); process.exit(1); } console.log("validate-ci-governance-policy: PASS"); }
module.exports = { run };