"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function count(rel, ext) { const dir = path.join(ROOT, rel); if (!fs.existsSync(dir)) return 0; return fs.readdirSync(dir).filter(f => !ext || f.endsWith(ext)).length; }
function has(rel) { return fs.existsSync(path.join(ROOT, rel)) ? "yes" : "no"; }
console.log("ProjectOS — Universal Project Delivery OS");
console.log("Root: " + ROOT);
console.log("");
console.log("schemas    : " + count("projectos/schemas", ".json"));
console.log("templates  : " + count("projectos/templates"));
console.log("validators : " + count("projectos/validators", ".cjs"));
console.log("scripts    : " + count("projectos/scripts", ".cjs"));
console.log("adapters   : " + count("projectos/adapters"));
console.log("examples   : " + count("projectos/examples"));
console.log("docs       : " + count("projectos/docs", ".md"));
console.log("");
console.log("Phase reporter:");
console.log("  create-phase-report        : " + has("projectos/scripts/create-phase-report.cjs"));
console.log("  create-pre-push-review-pack: " + has("projectos/scripts/create-pre-push-review-pack.cjs"));
console.log("  create-closure-report      : " + has("projectos/scripts/create-closure-report.cjs"));
console.log("  update-reports-index       : " + has("projectos/scripts/update-reports-index.cjs"));
console.log("  check-report-status        : " + has("projectos/scripts/check-report-status.cjs"));
console.log("");
console.log("Local-only. No external calls. No credentials. Run: npm run validate");