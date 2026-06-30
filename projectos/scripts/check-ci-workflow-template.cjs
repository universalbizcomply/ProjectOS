"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const DANGER = ["vercel deploy", "supabase db", "supabase functions deploy", "netlify deploy", "gh workflow", "git push", "stripe", "resend", "twilio"];
const SECRET_REF = [/\$\{\{\s*secrets\./, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /sk_live_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /ghp_[A-Za-z0-9]{36,}/, /sbp_[a-f0-9]{40,}/];
const COMMENTS = ["template only", "not installed", "no deploy"];
const file = flags.input || flags.file;
if (!file) { console.error("usage: check-ci-workflow-template.cjs --input <template.yml>"); process.exit(1); }
const abs = path.resolve(file);
const norm = abs.replace(/\\/g, "/");
const e = [];
if (!lib.within(abs)) e.push("REFUSED: template outside C:\\dev\\ProjectOS");
if (norm.toLowerCase().indexOf(".github/workflows") !== -1) e.push("REFUSED: template under .github/workflows is not allowed in this phase");
if (norm.toLowerCase().indexOf("/projectos/templates/") === -1) e.push("REFUSED: workflow template must live under projectos/templates");
let t = "";
try { t = fs.readFileSync(abs, "utf8"); }
catch (x) { console.error("FAIL: cannot read: " + x.message); process.exit(1); }
const low = t.toLowerCase();
DANGER.forEach(function (d) { if (low.indexOf(d) !== -1) e.push("REFUSED: dangerous command present: " + d); });
SECRET_REF.forEach(function (re) { if (re.test(t)) e.push("REFUSED: secret reference present"); });
COMMENTS.forEach(function (c) { if (low.indexOf(c) === -1) e.push("missing required comment marker: '" + c + "'"); });
if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("check-ci-workflow-template: " + e.length + " issue(s)"); process.exit(1); }
console.log("check-ci-workflow-template: PASS (inert; under projectos/templates; no deploy/secret commands; no execution)");