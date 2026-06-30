"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const JSON_EXAMPLES = [
  "projectos/examples/demo-saas.projectos.json",
  "projectos/examples/demo-booking-platform.projectos.json",
  "projectos/examples/demo-ops-tool.projectos.json",
  "projectos/examples/demo-phase-manifest.json"
];
const MD_EXAMPLES = ["projectos/examples/demo-evidence-pack.md"];
const REAL_SECRET = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /sk_live_[A-Za-z0-9]{16,}/,
  /whsec_[A-Za-z0-9]{16,}/,
  /sbp_[a-f0-9]{40,}/,
  /ghp_[A-Za-z0-9]{36,}/
];
function run() {
  const errors = [];
  for (const rel of JSON_EXAMPLES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let txt;
    try { txt = read(p); JSON.parse(txt); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    for (const re of REAL_SECRET) if (re.test(txt)) errors.push(rel + " contains a real-secret-shaped value");
  }
  for (const rel of MD_EXAMPLES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    const txt = read(p);
    for (const re of REAL_SECRET) if (re.test(txt)) errors.push(rel + " contains a real-secret-shaped value");
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-examples: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-examples: PASS");
}
module.exports = { run };