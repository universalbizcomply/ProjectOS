"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const INDEX = path.join(lib.ROOT, "knowledge", "ProjectOS Reports Index.md");
const INDEX_STATUSES = ["AWAITING-REVIEW", "AWAITING-CLOSURE", "BLOCKED", "DO-NOT-CLOSE", "CLOSED"];
const flags = lib.parseArgs(process.argv.slice(2));
function usage() {
  console.log("usage: node projectos/scripts/update-reports-index.cjs --date YYYY-MM-DD --project P --phase PH --status S --commit C --reportFile F --notes N [--dry-run] [--allow-duplicate]");
  console.log("statuses: " + INDEX_STATUSES.join(", "));
}
const req = ["date", "project", "phase", "status", "commit", "reportFile"];
const missing = req.filter(function (k) { return typeof flags[k] !== "string"; });
if (missing.length) { usage(); if (process.argv.length <= 2) process.exit(0); console.error("missing: " + missing.join(", ")); process.exit(1); }
if (INDEX_STATUSES.indexOf(flags.status) === -1) { console.error("unsupported status: " + flags.status); process.exit(1); }
const notes = typeof flags.notes === "string" ? flags.notes : "";
const row = "| " + [flags.date, flags.project, flags.phase, flags.status, flags.commit, "`" + flags.reportFile + "`", notes].join(" | ") + " |";
let text = fs.readFileSync(INDEX, "utf8");
if (text.indexOf(flags.phase) !== -1 && !flags["allow-duplicate"]) { console.error("refusing: phase '" + flags.phase + "' already in index (use --allow-duplicate)"); process.exit(1); }
if (flags["dry-run"]) { console.log("[dry-run] would append:\n" + row); process.exit(0); }
if (!text.endsWith("\n")) text += "\n";
text += row + "\n";
fs.writeFileSync(INDEX, text);
console.log("update-reports-index: appended row for " + flags.phase + " (no push)");