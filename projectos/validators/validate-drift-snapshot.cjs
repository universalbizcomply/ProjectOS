"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const SOURCE = ["static-file", "manual-export", "owner-provided"];
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
function run() {
  const e = [];
  const sp = path.join(ROOT, "projectos/schemas/drift-snapshot.schema.json");
  if (!fs.existsSync(sp)) { e.push("missing drift-snapshot.schema.json"); return e; }
  let schema; try { schema = readJSON(sp); } catch (x) { e.push("schema invalid JSON: " + x.message); return e; }
  const req = schema.required || [];
  const targets = ["projectos/templates/drift-snapshot.template.json", "projectos/examples/demo-drift-expected-snapshot.json", "projectos/examples/demo-drift-observed-snapshot.json"];
  for (const rel of targets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { e.push("missing " + rel); continue; }
    let raw, o; try { raw = read(p); o = JSON.parse(raw); } catch (x) { e.push(rel + " invalid JSON: " + x.message); continue; }
    for (const k of req) if (!(k in o)) e.push(rel + " missing field: " + k);
    if (o.sourceType && SOURCE.indexOf(o.sourceType) === -1) e.push(rel + " bad sourceType: " + o.sourceType);
    if (!Array.isArray(o.forbiddenRefs)) e.push(rel + " forbiddenRefs must be array");
    SECRET.forEach(function (re) { if (re.test(raw)) e.push(rel + " contains secret-like value"); });
  }
  return e;
}
if (require.main === module) { const e = run(); if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-drift-snapshot: " + e.length + " error(s)"); process.exit(1); } console.log("validate-drift-snapshot: PASS"); }
module.exports = { run };