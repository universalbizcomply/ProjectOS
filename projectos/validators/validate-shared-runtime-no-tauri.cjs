"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-B. Prove the shared host runtime contract crate is
// Tauri-free and adapter-independent: no UI/adapter framework dependency in its manifest or lockfile,
// no Tauri/UI imports or types in its source, and no dependency on the Control Center. Structural
// source checks (comments stripped first) — no fragile line-number assertions.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "shared-host-runtime");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
// Strip block and line comments so documentation prose cannot trigger a code-pattern match.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
function rsFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "target") continue;
        walk(full);
      } else if (e.name.endsWith(".rs")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

// Code-level patterns that would indicate a Tauri / UI-adapter / Control-Center coupling.
const CODE_FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /\bAppHandle\b/, why: "tauri AppHandle" },
  { re: /\bRunEvent\b/, why: "tauri RunEvent" },
  { re: /\bWebview\w*/i, why: "webview type" },
  { re: /\bwindows\s*::/, why: "windows crate import" },
  // The shared runtime legitimately DEFINES the client role (e.g. `ControlCenterClientRole`); the
  // coupling we forbid is a dependency on the Control Center CRATE, matched by its package name.
  { re: /projectos[_-]control[_-]center/i, why: "Control Center crate dependency" },
  { re: /use\s+.*control[_-]center/i, why: "Control Center module import" },
  { re: /\bjavascript\b/i, why: "frontend/JS coupling" },
  { re: /\bfrontend\b/i, why: "frontend coupling" },
  { re: /\bDOM\b/, why: "DOM coupling" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) {
    return ["shared-host-runtime crate directory is missing: " + CRATE];
  }

  // 1. Manifest + lockfile: the crate must not name a UI/adapter framework as a dependency.
  for (const mf of ["Cargo.toml", "Cargo.lock"]) {
    const p = path.join(CRATE, mf);
    if (!fs.existsSync(p)) {
      errors.push(mf + " is missing in the shared-host-runtime crate");
      continue;
    }
    const text = read(p);
    // In the manifest, a description string legitimately explains the no-adapter policy; only a
    // dependency-shaped token must fail. Check dependency-line shapes and the lockfile package names.
    if (mf === "Cargo.lock") {
      if (/name\s*=\s*"tauri/i.test(text) || /\btauri\b/i.test(text)) {
        errors.push("Cargo.lock names a tauri package");
      }
    } else {
      // Cargo.toml: fail on a tauri dependency line, but tolerate the description prose.
      const depLines = text
        .split(/\r?\n/)
        .filter((l) => /^\s*tauri\b/i.test(l) || /^\s*[\w-]*tauri[\w-]*\s*=/i.test(l));
      if (depLines.length) errors.push("Cargo.toml declares a tauri dependency");
      if (/^\s*windows\s*=/im.test(text)) errors.push("Cargo.toml declares a windows dependency");
    }
  }

  // 2. Source + tests: no Tauri/UI/Control-Center code.
  const srcDirs = [path.join(CRATE, "src"), path.join(CRATE, "tests")];
  for (const d of srcDirs) {
    for (const f of rsFiles(d)) {
      const code = stripComments(read(f));
      for (const { re, why } of CODE_FORBIDDEN) {
        if (re.test(code)) {
          errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + why);
        }
      }
    }
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-shared-runtime-no-tauri] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-shared-runtime-no-tauri: PASS");
}
