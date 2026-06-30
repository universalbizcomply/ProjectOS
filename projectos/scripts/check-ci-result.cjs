"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = ["checkId", "category", "status", "summary", "filesChecked", "command", "externalToolsUsed", "secretsUsed", "productionTouched", "databaseTouched", "deployAttempted", "sendsOrPaymentsTouched", "blockers", "warnings", "evidence", "decisionNeeded"];
const STATUSES = ["PASS", "WARN", "FAIL", "BLOCKED", "SKIPPED", "NEEDS-SOURCE", "NOT-VERIFIED"];
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-ci-result.cjs --input <ci-check-result.json>"); process.exit(1); }
let raw, o;
try { raw = fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""); o = JSON.parse(raw); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in o)) e.push("missing field: " + k);
if (STATUSES.indexOf(o.status) === -1) e.push("status not allowed: " + o.status);
["externalToolsUsed", "secretsUsed", "productionTouched", "databaseTouched", "deployAttempted", "sendsOrPaymentsTouched"].forEach(function (k) { if (typeof o[k] !== "boolean") e.push("high-risk field missing/!boolean: " + k); });
SECRET.forEach(function (re) { if (re.test(raw)) e.push("secret-like value present"); });
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-ci-result: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-ci-result: PASS (status " + o.status + "; no secrets; no external call)");