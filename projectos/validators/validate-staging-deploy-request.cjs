"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const STATUSES = ["DRAFT", "READY-FOR-REVIEW", "BLOCKED", "APPROVED-FOR-STAGING-DEPLOY", "DEPLOYED-TO-STAGING", "REJECTED"];
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/staging-deploy-request.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing staging-deploy-request.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/staging-deploy-request.template.json", "projectos/examples/demo-staging-deploy-request.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let o; try { o = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in o)) e.push(rel + " missing field: " + k);
    if (o.targetEnvironment !== "staging") e.push(rel + " targetEnvironment must be staging");
    if (o.productionTouched !== false) e.push(rel + " productionTouched must be false");
    if (o.secretsAccessed !== false) e.push(rel + " secretsAccessed must be false");
    if ("deployExecuted" in o) e.push(rel + " must not contain deployExecuted");
    if (o.approvalStatus && STATUSES.indexOf(o.approvalStatus) === -1) e.push(rel + " bad approvalStatus: " + o.approvalStatus);
    if (rel.indexOf("demo") !== -1 && o.approvalStatus === "APPROVED-FOR-STAGING-DEPLOY") e.push(rel + " demo must not be pre-approved for deploy");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-staging-deploy-request: " + e.length + " error(s)"); process.exit(1); } console.log("validate-staging-deploy-request: PASS"); }
module.exports = { run };