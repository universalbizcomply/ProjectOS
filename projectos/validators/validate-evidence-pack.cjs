"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
const HEADINGS = [
  "Forbidden actions checked", "Validators", "Production touched",
  "External sends", "Residue", "Risks", "Carry-forward", "Decision needed"
];
function run() {
  const errors = [];
  const schemaPath = path.join(ROOT, "projectos/schemas/evidence-pack.schema.json");
  if (!fs.existsSync(schemaPath)) errors.push("missing evidence-pack.schema.json");
  else { try { JSON.parse(read(schemaPath)); } catch (e) { errors.push("evidence-pack schema not valid JSON: " + e.message); } }
  const mds = [
    "projectos/templates/evidence-pack.template.md",
    "projectos/examples/demo-evidence-pack.md"
  ];
  for (const rel of mds) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    const text = read(p);
    for (const h of HEADINGS) if (text.indexOf(h) === -1) errors.push(rel + " missing heading: " + h);
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-evidence-pack: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-evidence-pack: PASS");
}
module.exports = { run };