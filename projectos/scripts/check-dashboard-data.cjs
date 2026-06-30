"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = ["dashboard", "generatedAt", "sourceMode", "projects", "phases", "risks", "carryForward", "blockers", "summary", "sourceLimitations", "decisionNeeded"];
const file = flags.input || flags.file || "projectos/dashboard/dashboard-data.json";
const p = path.resolve(lib.ROOT, file);
let d;
try { d = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in d)) e.push("missing section: " + k);
if (d.sourceMode !== "local-static") e.push("sourceMode must be local-static");
["externalApisUsed", "liveInspectionUsed", "productReposScanned", "secretsUsed"].forEach(function (k) { if (k in d && d[k] !== false) e.push(k + " must be false"); });
(d.projects || []).forEach(function (pr, i) { if (!pr.status) e.push("project[" + i + "] missing status"); if (!pr.sourceConfidence) e.push("project[" + i + "] missing sourceConfidence"); });
(d.phases || []).forEach(function (ph, i) { if (!ph.status) e.push("phase[" + i + "] missing status"); if (!ph.reportFile) e.push("phase[" + i + "] missing reportFile"); });
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-dashboard-data: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-dashboard-data: PASS (local-static; no external/live/scan/secrets)");