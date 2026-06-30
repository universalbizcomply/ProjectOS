"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(req.outputPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, lib.renderClosure(req));
  console.log("create-closure-report: wrote " + lib.rel(out) + " (closure requires Murad/ChatGPT approval; not closed by this script)");
} catch (e) { console.error("create-closure-report ERROR: " + e.message); process.exit(1); }