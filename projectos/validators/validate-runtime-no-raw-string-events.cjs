"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-B. Prove the shared host runtime public API never
// exposes a raw/untyped event or message channel: no Receiver<String>/Sender<String>, no
// Vec<String> event queue, no serde_json / untyped JSON, no raw child stdout/stderr handle, and no
// generic String message method. It also asserts the typed event channel Receiver<HostRuntimeEvent>
// IS present, so the event API is the typed one. Comments are stripped first; checks are structural,
// not line-numbered.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "shared-host-runtime");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
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

const FORBIDDEN = [
  { re: /Receiver\s*<\s*String\s*>/, why: "raw Receiver<String> channel" },
  { re: /Sender\s*<\s*String\s*>/, why: "raw Sender<String> channel" },
  { re: /Receiver\s*<\s*Vec\s*<\s*u8/, why: "raw byte Receiver channel" },
  { re: /Sender\s*<\s*Vec\s*<\s*u8/, why: "raw byte Sender channel" },
  { re: /(Receiver|Sender)\s*<\s*Vec\s*<\s*String/, why: "raw String queue channel" },
  { re: /serde_json/, why: "untyped serde_json in the API" },
  { re: /Receiver\s*<\s*serde_json/, why: "raw JSON Receiver channel" },
  { re: /Iterator\s*<\s*Item\s*=\s*String/, why: "raw String iterator API" },
  { re: /Stream\s*<\s*Item\s*=\s*String/, why: "raw String stream API" },
  { re: /ChildStdout|ChildStderr/, why: "raw child stdout/stderr handle" },
  { re: /std::process::Child/, why: "raw process child handle" },
  { re: /pub\s+fn\s+messages\b/, why: "generic messages() String method" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) {
    return ["shared-host-runtime crate directory is missing: " + CRATE];
  }

  const srcDir = path.join(CRATE, "src");
  const files = rsFiles(srcDir);
  if (!files.length) {
    return ["shared-host-runtime src has no Rust source"];
  }

  let sawTypedEventChannel = false;
  for (const f of files) {
    const code = stripComments(read(f));
    if (/Receiver\s*<\s*HostRuntimeEvent\s*>/.test(code)) sawTypedEventChannel = true;
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) {
        errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + why);
      }
    }
  }

  if (!sawTypedEventChannel) {
    errors.push(
      "the typed event channel Receiver<HostRuntimeEvent> was not found — the event API must be typed"
    );
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-runtime-no-raw-string-events] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-runtime-no-raw-string-events: PASS");
}
