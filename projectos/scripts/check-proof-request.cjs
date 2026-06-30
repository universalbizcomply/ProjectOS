"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = [
  "project", "phase", "requestedBy", "targetEnvironment", "targetUrl", "branch", "commit",
  "scope", "proofObjective", "proofType", "proofDataRequired", "testDataClassification",
  "allowedDataActions", "forbiddenDataActions", "databaseTouched", "databaseMutationPlanned",
  "externalSendsPlanned", "paymentActionPlanned", "secretsRequired", "externalApisRequired",
  "validatorsRequired", "validatorsRun", "requiredReviews", "rollbackPlan", "cleanupRequired",
  "cleanupPlanPath", "proofEvidencePath", "approvalStatus", "ownerApprovalReference",
  "decisionNeeded", "reportPath"
];
const STATUSES = ["DRAFT", "READY-FOR-REVIEW", "BLOCKED", "APPROVED-FOR-STAGING-PROOF", "PROOF-RUN-RECORDED", "CLEANUP-REQUIRED", "CLEANUP-PLANNED", "CLEANUP-VERIFIED", "REJECTED"];
const PROD = ["production", "prod", "live", "prd"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-proof-request.cjs --input <request.json>"); process.exit(1); }
let req;
try { req = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in req)) e.push("missing field: " + k);
if (PROD.indexOf(String(req.targetEnvironment).toLowerCase()) !== -1) e.push("targetEnvironment must not be production");
if (req.secretsRequired !== false) e.push("secretsRequired must be false");
if ("proofExecuted" in req) e.push("must not contain proofExecuted");
["databaseMutationPlanned", "externalSendsPlanned", "paymentActionPlanned"].forEach(function (k) { if (typeof req[k] !== "boolean") e.push("declaration missing/!boolean: " + k); });
if (STATUSES.indexOf(req.approvalStatus) === -1) e.push("approvalStatus not explicit/allowed: " + req.approvalStatus);
if (typeof req.decisionNeeded !== "string" || !req.decisionNeeded) e.push("decisionNeeded missing");
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-proof-request: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-proof-request: PASS (no proof; no external call)");