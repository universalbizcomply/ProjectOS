"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
const isCheck = process.argv.includes("--check");
function check() {
  const errors = [];
  const tpl = path.join(ROOT, "projectos/templates/evidence-pack.template.md");
  if (!fs.existsSync(tpl)) errors.push("missing evidence-pack.template.md");
  else { const t = read(tpl); ["Decision needed", "Carry-forward", "Production touched"].forEach(h => { if (t.indexOf(h) === -1) errors.push("evidence template missing heading: " + h); }); }
  const idx = path.join(ROOT, "knowledge/ProjectOS Reports Index.md");
  if (!fs.existsSync(idx)) errors.push("missing ProjectOS Reports Index.md");
  else { const t = read(idx); ["Date", "Project", "Phase", "Status", "Commit", "Report file", "Notes"].forEach(c => { if (t.indexOf(c) === -1) errors.push("reports index missing column: " + c); }); }
  if (errors.length) { errors.forEach(e => console.error("FAIL: " + e)); console.error("report:check: " + errors.length + " error(s)"); process.exit(1); }
  console.log("report:check: PASS");
}
function skeleton() {
  const tpl = path.join(ROOT, "projectos/templates/evidence-pack.template.md");
  if (fs.existsSync(tpl)) process.stdout.write(read(tpl));
  else console.error("template not found: " + tpl);
}
if (isCheck) check(); else skeleton();