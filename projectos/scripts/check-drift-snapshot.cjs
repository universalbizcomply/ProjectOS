"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const REQUIRED = ["snapshotId", "project", "environment", "sourceType", "capturedBy", "capturedAt", "sourceLimitations", "branch", "commit", "targetUrl", "hostingProvider", "databaseProvider", "projectRef", "forbiddenRefs", "expectedTables", "expectedColumns", "expectedFunctions", "expectedRoutes", "expectedMigrations", "expectedEnvKeys", "expectedPolicies", "notes"];
const SOURCE = ["static-file", "manual-export", "owner-provided"];
const SECRET = [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /sbp_[a-f0-9]{40,}/, /ghp_[A-Za-z0-9]{36,}/];
const LIVE_KEYS = ["connectionString", "password", "serviceRoleKey", "accessToken", "apiKey"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-drift-snapshot.cjs --input <snapshot.json>"); process.exit(1); }
let raw, snap;
try { raw = fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""); snap = JSON.parse(raw); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
for (const k of REQUIRED) if (!(k in snap)) e.push("missing field: " + k);
if (SOURCE.indexOf(snap.sourceType) === -1) e.push("sourceType must be static-file|manual-export|owner-provided");
if (!Array.isArray(snap.forbiddenRefs)) e.push("forbiddenRefs must be an explicit array");
LIVE_KEYS.forEach(function (k) { if (k in snap) e.push("live-connection/secret field present: " + k); });
SECRET.forEach(function (re) { if (re.test(raw)) e.push("secret-like value present"); });
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-drift-snapshot: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-drift-snapshot: PASS (static file; no live connection; no secrets)");