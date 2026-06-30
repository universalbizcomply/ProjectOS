"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-ci-target.cjs --input <target.json>"); process.exit(1); }
let o;
try { o = JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, "")); }
catch (e) { console.error("FAIL: cannot read/parse: " + e.message); process.exit(1); }
const e = [];
const out = String(o.outputPath || "").replace(/\\/g, "/").toLowerCase();
if (out.indexOf(".github/workflows") !== -1) e.push("REFUSED: .github/workflows output path not allowed in this phase");
if (o.status === "INSTALLED-IN-PROJECT" || o.installTarget === "live") e.push("REFUSED: live installation target not allowed in this phase (templates only)");
if (o.productionAutoDeploy === true) e.push("REFUSED: production auto-deploy not allowed");
if (!o.provider) e.push("missing provider");
if (!o.status) e.push("missing status");
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-ci-target: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-ci-target: PASS (template target; no live install; no .github/workflows; no production auto-deploy)");