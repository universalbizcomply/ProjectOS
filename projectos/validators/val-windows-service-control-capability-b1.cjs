"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B1 — boundary for the effect-free
// service-control CONTRACT crate. Proves: exact identity, publish=false, library-only (no [[bin]]),
// no default features, forbid(unsafe_code), only the service-installation-contract dependency, NO
// direct windows dep / extern / handle / SCM / service / token / registry / ACL / process / network
// route, NO raw-identity/arbitrary field, VirtualServiceAccount-only + no-password + demand-start-only
// + exact-name + verified deletion, and NotAuthorised effect authority. Comments stripped; structural.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-service-control");

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
  { re: /OpenSCManager|CreateServiceW?|StartServiceW?|DeleteService|ControlService|ChangeServiceConfig/, why: "SCM/service route" },
  { re: /OpenProcessToken|GetTokenInformation|LookupAccountName/, why: "token/SID route" },
  { re: /RegCreateKey|RegSetValue|RegOpenKey/, why: "registry route" },
  { re: /SetSecurityInfo|SetNamedSecurityInfo|InitializeAcl/, why: "ACL mutation route" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute/, why: "process/shell route" },
  { re: /TcpStream|std::net::|reqwest|CreateNamedPipe/, why: "network/pipe route" },
  { re: /control-center/, why: "control-center reference" },
];
const RAW_FIELD = [
  { re: /:\s*String\b/, why: "String field" },
  { re: /:\s*OsString\b/, why: "OsString field" },
  { re: /:\s*PathBuf\b/, why: "PathBuf field" },
  { re: /:\s*Vec<\s*u8\s*>/, why: "Vec<u8> field" },
  { re: /:\s*\[\s*u8\s*;/, why: "byte-array field" },
  { re: /:\s*(HashMap|BTreeMap)</, why: "map field" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["windows-service-control crate missing: " + CRATE];
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-service-control"/.test(toml)) errors.push("wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("does not forbid unsafe");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  if (/\[features\]/.test(toml)) errors.push("declares features (must be none in B1)");
  // Dependency footprint: only the installation contract.
  const depBody = (stripComments(toml).split(/\[dependencies\]/)[1] || "").split(/\n\[/)[0];
  const deps = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim());
  for (const d of deps) {
    if (d !== "projectos-host-windows-service-installation-contract") errors.push("unexpected dependency: " + d);
  }
  if (/\bwindows\s*=|windows-sys\s*=/.test(depBody)) errors.push("direct windows dependency");
  // Lockfile present (per-crate convention).
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

  // Crate-specific: single fixed identity + policies + verified deletion.
  const c = stripComments(read(path.join(CRATE, "src", "contracts.rs")));
  if (!/VirtualServiceAccountNoPassword/.test(c)) errors.push("no VirtualServiceAccount-no-password policy");
  if (/\bLocalSystem\b|\bLocalService\b|\bNetworkService\b/.test(c)) errors.push("an alternate built-in identity is representable");
  if (!/DemandStartOnly/.test(c)) errors.push("no demand-start-only policy");
  if (/AutomaticStart\b(?!Refused)/.test(c) && !/AutomaticStartRefused/.test(c)) errors.push("automatic start representable");
  if (!/is_approved_name/.test(c)) errors.push("no exact-name check");
  if (!/ConfirmDeleted/.test(c)) errors.push("no verified-deletion step");
  if (!/NotAuthorised/.test(c)) errors.push("effect authority is not NotAuthorised");
  if (!/CompiledCapabilityNotAuthority/.test(c)) errors.push("compiled-capability-not-authority rule missing");
  if (!/ElevationWithoutOwnerApproval/.test(c)) errors.push("elevation-without-owner rule missing");
  if (!/OwnerApprovalWithoutElevation/.test(c)) errors.push("owner-without-elevation rule missing");
  const lib = read(path.join(CRATE, "src", "lib.rs"));
  if (!/SERVICE_CONTROL_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib)) errors.push("missing contract-only const");
  if (!/LIVE_SERVICE_CONTROL_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("live control must be unauthorised");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-control-capability-b1] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-control-capability-b1: PASS");
}
