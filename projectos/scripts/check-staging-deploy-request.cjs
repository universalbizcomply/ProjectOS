"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = [
  "project", "phase", "requestedBy", "targetEnvironment", "targetUrl", "hostingProvider",
  "branch", "commit", "filesChanged", "scope", "validatorsRequired", "validatorsRun",
  "requiredReviews", "reviewStatus", "forbiddenActionsChecked", "productionTouched",
  "databaseTouched", "databaseMutationPlanned", "externalSendsPlanned", "paymentActionPlanned",
  "secretsAccessed", "externalApisRequired", "rollbackPlan", "stagingProofPlan",
  "approvalStatus", "ownerApprovalReference", "decisionNeeded", "reportPath"
];
const STATUSES = ["DRAFT", "READY-FOR-REVIEW", "BLOCKED", "APPROVED-FOR-STAGING-DEPLOY", "DEPLOYED-TO-STAGING", "REJECTED"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-staging-deploy-request.cjs --input <request.json>"); process.exit(1); }
let req;
try { req = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse request: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in req)) e.push("missing field: " + k);
if (req.targetEnvironment !== "staging") e.push("targetEnvironment must be staging");
if (req.productionTouched !== false) e.push("productionTouched must be false");
if (req.secretsAccessed !== false) e.push("secretsAccessed must be false");
["databaseMutationPlanned", "externalSendsPlanned", "paymentActionPlanned"].forEach(function (k) { if (typeof req[k] !== "boolean") e.push("declaration missing/!boolean: " + k); });
if (STATUSES.indexOf(req.approvalStatus) === -1) e.push("approvalStatus not explicit/allowed: " + req.approvalStatus);
if (typeof req.decisionNeeded !== "string" || !req.decisionNeeded) e.push("decisionNeeded missing");
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-staging-deploy-request: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-staging-deploy-request: PASS (no deploy; no external call)");