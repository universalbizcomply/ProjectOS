"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = ["policyId", "enabled", "scope", "allowedCiProviders", "forbiddenCiProviders", "requiredChecks", "optionalChecks", "forbiddenActions", "secretPolicy", "deploymentPolicy", "databasePolicy", "sendPaymentPolicy", "reviewEvidencePolicy", "branchProtectionRecommendations", "ownerApprovalPolicy", "reportPolicy", "externalToolsPolicy", "mcpPolicy"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-ci-governance-policy.cjs --input <policy.json>"); process.exit(1); }
let p;
try { p = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in p)) e.push("missing field: " + k);
if (p.deploymentPolicy && p.deploymentPolicy.productionAutoDeploy === true) e.push("REFUSED: production auto-deploy must be disabled");
if (p.databasePolicy && p.databasePolicy.liveMutation === true) e.push("REFUSED: live DB mutation must be disabled");
if (p.sendPaymentPolicy && (p.sendPaymentPolicy.realSend === true || p.sendPaymentPolicy.payment === true)) e.push("REFUSED: real send/payment must be disabled");
if (!p.secretPolicy || p.secretPolicy.secretsInTemplates !== "prohibited") e.push("secretPolicy.secretsInTemplates must be 'prohibited'");
if (!p.ownerApprovalPolicy) e.push("ownerApprovalPolicy missing");
else if (p.ownerApprovalPolicy.inferApproval !== false) e.push("ownerApprovalPolicy.inferApproval must be false");
if (p.externalToolsPolicy && p.externalToolsPolicy.default !== "disabled") e.push("externalToolsPolicy.default must be disabled");
if (p.mcpPolicy && p.mcpPolicy.default !== "disabled") e.push("mcpPolicy.default must be disabled");
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-ci-governance-policy: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-ci-governance-policy: PASS (no prod auto-deploy; no live DB/send/payment; no secrets; no GitHub call)");