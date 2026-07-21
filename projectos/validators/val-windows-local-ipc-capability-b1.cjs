"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B1 — boundary for the effect-free
// local-IPC transport CONTRACT crate. Proves: exact identity, publish=false, library-only, no default
// features, forbid(unsafe_code), only the service-identity-proof dependency, no direct windows/extern/
// handle/SCM/service/token/registry/ACL/process/network route, no raw-identity/arbitrary field, and
// the local-only + remote-refusal + first-instance + nonce-replay-refusal + protected-allowlist +
// no-explicit-broad-allow guarantees. Comments stripped; structural.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-local-ipc");

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
      } else if (e.name.endsWith(".rs")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /use\s+windows(::|\s|;)|windows::Win32|windows_sys/, why: "windows API reference" },
  { re: /extern\s+"system"|extern\s+"C"/, why: "extern FFI" },
  { re: /\bHANDLE\b|OwnedHandle|from_raw_handle/, why: "raw handle route" },
  { re: /CreateNamedPipe|ConnectNamedPipe|CreateFileW/, why: "named-pipe FFI route" },
  { re: /OpenSCManager|CreateServiceW?/, why: "SCM route" },
  { re: /OpenProcessToken|GetTokenInformation/, why: "token route" },
  { re: /RegCreateKey|RegSetValue/, why: "registry route" },
  { re: /SetSecurityInfo|InitializeAcl/, why: "ACL mutation route" },
  { re: /std::process|Command::new|CreateProcess/, why: "process route" },
  { re: /TcpStream|TcpListener|std::net::|reqwest/, why: "network route" },
  { re: /control-center/, why: "control-center reference" },
];
const RAW_FIELD = [
  { re: /:\s*String\b/, why: "String field" },
  { re: /:\s*OsString\b/, why: "OsString field" },
  { re: /:\s*PathBuf\b/, why: "PathBuf field" },
  { re: /:\s*Vec<\s*u8\s*>/, why: "Vec<u8> / arbitrary byte payload field" },
  { re: /:\s*\[\s*u8\s*;/, why: "byte-array field" },
  { re: /:\s*(HashMap|BTreeMap)</, why: "map field" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["windows-local-ipc crate missing: " + CRATE];
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-local-ipc"/.test(toml)) errors.push("wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("does not forbid unsafe");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  if (/\[features\]/.test(toml)) errors.push("declares features (must be none in B1)");
  const depBody = (stripComments(toml).split(/\[dependencies\]/)[1] || "").split(/\n\[/)[0];
  const deps = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim());
  for (const d of deps) {
    if (d !== "projectos-host-windows-service-identity-proof") errors.push("unexpected dependency: " + d);
  }
  if (/\bwindows\s*=|windows-sys\s*=/.test(depBody)) errors.push("direct windows dependency");
  if (!fs.existsSync(path.join(CRATE, "Cargo.lock"))) errors.push("missing Cargo.lock");

  let sawForbid = false;
  for (const f of rsFiles(path.join(CRATE, "src"))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/#!\[forbid\(unsafe_code\)\]/.test(code)) sawForbid = true;
    if (/unsafe\s*(fn|\{)/.test(code)) errors.push(rel + ": unsafe code");
    for (const { re, why } of FORBIDDEN) if (re.test(code)) errors.push(rel + ": " + why);
    for (const { re, why } of RAW_FIELD) if (re.test(code)) errors.push(rel + ": " + why);
  }
  if (!sawForbid) errors.push("lib.rs does not forbid unsafe");

  // Crate-specific IPC guarantees.
  const c = stripComments(read(path.join(CRATE, "src", "contracts.rs")));
  if (!/NamedPipeLocalOnly/.test(c)) errors.push("not local-only");
  if (!/remote_clients_refused/.test(c)) errors.push("no remote-client refusal");
  if (!/FirstInstanceRequired/.test(c)) errors.push("no first-instance requirement");
  if (!/ReplayRefused/.test(c) || !/SingleUseNonceState/.test(c)) errors.push("no single-use nonce / replay refusal");
  if (!/StaleEndpointRefused|EndpointFreshness/.test(c)) errors.push("no stale-endpoint refusal");
  if (!/allows_broad[\s\S]*?false/.test(c)) errors.push("broad principals not refused an allow ACE");
  if (!/is_protected[\s\S]*?true/.test(c)) errors.push("allowlist not protected");
  if (!/requires_explicit_deny[\s\S]*?false/.test(c)) errors.push("explicit deny incorrectly required");
  const lib = read(path.join(CRATE, "src", "lib.rs"));
  if (!/LOCAL_IPC_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib)) errors.push("missing contract-only const");
  if (!/LIVE_LOCAL_IPC_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("live IPC must be unauthorised");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-local-ipc-capability-b1] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-local-ipc-capability-b1: PASS");
}
