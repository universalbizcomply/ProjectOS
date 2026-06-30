"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const STATUSES = ["DRAFT", "READY-FOR-REVIEW", "BLOCKED", "APPROVED-FOR-STAGING-PROOF", "PROOF-RUN-RECORDED", "CLEANUP-REQUIRED", "CLEANUP-PLANNED", "CLEANUP-VERIFIED", "REJECTED"];
const PROD = ["production", "prod", "live", "prd"];
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/proof-request.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing proof-request.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/proof-request.template.json", "projectos/examples/demo-proof-request.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let o; try { o = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in o)) e.push(rel + " missing field: " + k);
    if (PROD.indexOf(String(o.targetEnvironment).toLowerCase()) !== -1) e.push(rel + " targetEnvironment must not be production");
    if (o.secretsRequired !== false) e.push(rel + " secretsRequired must be false");
    if ("proofExecuted" in o) e.push(rel + " must not contain proofExecuted");
    if (o.approvalStatus && STATUSES.indexOf(o.approvalStatus) === -1) e.push(rel + " bad approvalStatus: " + o.approvalStatus);
    if (rel.indexOf("demo") !== -1 && o.approvalStatus === "APPROVED-FOR-STAGING-PROOF") e.push(rel + " demo must not be pre-approved");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-proof-request: " + e.length + " error(s)"); process.exit(1); } console.log("validate-proof-request: PASS"); }
module.exports = { run };