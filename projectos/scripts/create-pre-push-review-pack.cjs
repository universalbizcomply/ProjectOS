"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
try {
  const req = lib.loadRequest(flags);
  const out = lib.guardOut(req.outputPath);
  lib.ensureDir(out);
  fs.writeFileSync(out, lib.renderPrePush(req));
  console.log("create-pre-push-review-pack: wrote " + lib.rel(out));
} catch (e) { console.error("create-pre-push-review-pack ERROR: " + e.message); process.exit(1); }