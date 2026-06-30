"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const BASE = path.join(ROOT, "projectos");
function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name === "node_modules") continue; walk(p, out); }
    else out.push(path.relative(ROOT, p).replace(/\\/g, "/"));
  }
}
const files = [];
walk(BASE, files);
files.sort();
files.forEach(f => console.log(f));
console.log("");
console.log("total: " + files.length + " files under projectos/");