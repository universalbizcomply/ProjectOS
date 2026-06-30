"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(req.outputPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, lib.renderEvidence(req));
  console.log("create-phase-report: wrote " + lib.rel(out));
} catch (e) { console.error("create-phase-report ERROR: " + e.message); process.exit(1); }