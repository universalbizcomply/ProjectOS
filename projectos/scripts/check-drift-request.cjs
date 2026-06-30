"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = ["project", "phase", "targetEnvironment", "expectedSnapshotPath", "observedSnapshotPath", "driftCategories", "forbiddenRefs", "productionTouched", "databaseTouched", "liveInspectionRequested", "secretsAccessed", "externalApisRequired", "repairRequested", "approvalStatus", "ownerApprovalReference", "decisionNeeded", "reportPath"];
const STATUSES = ["DRAFT", "READY-FOR-REVIEW", "BLOCKED", "NEEDS-SOURCE", "NOT-VERIFIED", "REJECTED"];
const PROD = ["production", "prod", "live", "prd"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-drift-request.cjs --input <request.json>"); process.exit(1); }
let req;
try { req = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in req)) e.push("missing field: " + k);
if (PROD.indexOf(String(req.targetEnvironment).toLowerCase()) !== -1) e.push("targetEnvironment must not be production");
if (req.productionTouched !== false) e.push("productionTouched must be false");
if (req.liveInspectionRequested !== false) e.push("liveInspectionRequested must be false");
if (req.secretsAccessed !== false) e.push("secretsAccessed must be false");
if (req.repairRequested !== false) e.push("repairRequested must be false");
[req.expectedSnapshotPath, req.observedSnapshotPath].forEach(function (p) { if (typeof p === "string" && !lib.within(path.resolve(lib.ROOT, p))) e.push("snapshot path outside ProjectOS: " + p); });
if (STATUSES.indexOf(req.approvalStatus) === -1) e.push("approvalStatus not explicit/allowed: " + req.approvalStatus);
if (typeof req.decisionNeeded !== "string" || !req.decisionNeeded) e.push("decisionNeeded missing");
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-drift-request: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-drift-request: PASS (no live inspection; no repair; no external call)");