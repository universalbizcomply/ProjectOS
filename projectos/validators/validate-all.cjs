"use strict";
const MODULES = [
  "validate-no-secrets",
  "validate-project-config",
  "validate-phase-manifest",
  "validate-evidence-pack",
  "validate-forbidden-actions",
  "validate-examples",
  "validate-review-agents",
  "validate-ecc-routing"
];
let total = 0;
for (const m of MODULES) {
  let errs;
  try { errs = require("./" + m + ".cjs").run(); }
  catch (e) { console.error("[" + m + "] CRASH: " + e.message); total += 1; continue; }
  if (errs.length) { errs.forEach(x => console.error("[" + m + "] FAIL: " + x)); total += errs.length; }
  else console.log("[" + m + "] PASS");
}
if (total) { console.error("validate-all: " + total + " error(s)"); process.exit(1); }
console.log("validate-all: ALL PASS");