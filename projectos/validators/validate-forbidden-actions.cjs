"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
function read(p) { return fs.readFileSync(p, "utf8").replace(/^﻿/, ""); }
function readJSON(p) { return JSON.parse(read(p)); }
const REQUIRED_GATES = [
  "productionDeployGate", "productionDbMutationGate", "realMessagingGate",
  "paymentGate", "secretsHandlingGate", "forcePushProhibition",
  "externalServiceGate", "closureAuthorityGate"
];
const REQUIRED_FORBIDDEN = [
  "production-deploy", "production-db-mutation", "real-email-sms-whatsapp",
  "payment-or-live-charge", "force-push"
];
function run() {
  const errors = [];
  const gatesPath = path.join(ROOT, "projectos/schemas/safety-gates.schema.json");
  if (!fs.existsSync(gatesPath)) errors.push("missing safety-gates.schema.json");
  else {
    let g;
    try { g = readJSON(gatesPath); } catch (e) { errors.push("safety-gates schema not valid JSON: " + e.message); g = null; }
    if (g) {
      const props = (g.properties) || {};
      for (const gate of REQUIRED_GATES) if (!(gate in props)) errors.push("safety-gates schema missing gate: " + gate);
    }
  }
  const cfgTargets = [
    "projectos/templates/project-config.template.json",
    "projectos/templates/phase-manifest.template.json",
    "projectos/examples/demo-saas.projectos.json"
  ];
  for (const rel of cfgTargets) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { errors.push("missing " + rel); continue; }
    let obj;
    try { obj = readJSON(p); } catch (e) { errors.push(rel + " not valid JSON: " + e.message); continue; }
    const fa = obj.forbiddenActions || [];
    for (const need of REQUIRED_FORBIDDEN) if (!fa.includes(need)) errors.push(rel + " forbiddenActions missing: " + need);
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-forbidden-actions: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forbidden-actions: PASS");
}
module.exports = { run };