"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/report-request.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing report-request.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/report-request.template.json", "projectos/examples/demo-report-request.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let obj; try { obj = readJSON(p); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in obj)) e.push(rel + " missing field: " + k);
    const allowed = ["IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW", "BLOCKED", "DO NOT CLOSE", "ACCEPTED FOR CLOSURE", "CLOSED"];
    if (obj.status && allowed.indexOf(obj.status) === -1) e.push(rel + " bad status: " + obj.status);
    if (obj.reviews && obj.reviews.externalToolsUsed !== false) e.push(rel + " reviews.externalToolsUsed should be false");
    if (obj.reviews && obj.reviews.mcpUsed !== false) e.push(rel + " reviews.mcpUsed should be false");
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-report-request: " + e.length + " error(s)"); process.exit(1); } console.log("validate-report-request: PASS"); }
module.exports = { run };