"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const PROD_NAMES = ["production", "prod", "live", "prod-live", "prd"];
const KNOWN = ["staging", "preview", "development", "test", "local"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-proof-target.cjs --input <request.json> [--allow-unknown]"); process.exit(1); }
let req;
try { req = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const env = String(req.targetEnvironment || "").toLowerCase();
const url = String(req.targetUrl || "");
const allowUnknown = flags.allowUnknown === true || flags["allow-unknown"] === true;
const e = [];
if (PROD_NAMES.indexOf(env) !== -1) e.push("REFUSED: production-like targetEnvironment '" + env + "'");
if (/\bprod\b|production|\blive\b/i.test(url)) e.push("REFUSED: production-looking targetUrl");
if (KNOWN.indexOf(env) === -1 && PROD_NAMES.indexOf(env) === -1) {
  if (allowUnknown) console.error("WARN: unknown environment '" + env + "' allowed via --allow-unknown");
  else e.push("REFUSED: unknown environment '" + env + "' (pass --allow-unknown to override)");
}
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-proof-target: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-proof-target: PASS (" + env + "; no network check; no external call)");