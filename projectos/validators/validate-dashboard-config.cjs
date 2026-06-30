"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/dashboard-config.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing dashboard-config.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/dashboard-config.template.json", "projectos/examples/demo-dashboard-config.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let o; try { o = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in o)) e.push(rel + " missing field: " + k);
    if (o.externalApisAllowed !== false) e.push(rel + " externalApisAllowed must be false");
    if (o.productRepoScanningAllowed !== false) e.push(rel + " productRepoScanningAllowed must be false");
    if (o.refreshMode !== "local-static") e.push(rel + " refreshMode must be local-static");
    if (!o.secretsPolicy || o.secretsPolicy.secretsAllowed !== false) e.push(rel + " secretsPolicy.secretsAllowed must be false");
    if (!o.approvalPolicy || o.approvalPolicy.dashboardCanApprove !== false || o.approvalPolicy.dashboardCanClose !== false) e.push(rel + " approvalPolicy must be false/false");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-dashboard-config: " + e.length + " error(s)"); process.exit(1); } console.log("validate-dashboard-config: PASS"); }
module.exports = { run };