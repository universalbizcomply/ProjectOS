"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-B — boundary for the EFFECT-FREE service-identity
// proof contract crate. Proves it is a pure typed contract: exact identity, publish=false,
// forbid(unsafe_code), only the host-authority path dependency, NO Windows/extern/handle/SCM/token/
// service/registry/ProgramData/ACL/process/network route, NO raw-identity-capable field
// (String/OsString/PathBuf/Vec<u8>/byte-array/map), token-user vs service-SID-group vs SID-type as
// SEPARATE facts, integrity NON-AUTHORISING, ExistingToken never trusted, BOTH IPC and SCM
// corroboration required, residue-zero required, and the shared runtime reporting a truthful
// TEST/contract-only service-identity status with execution readiness still false. Comments stripped;
// structural checks; no line numbers.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-service-identity-proof");
const SHARED = path.join(ROOT, "projectos", "host", "shared-host-runtime");

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

// Effect / FFI / raw-identity routes the effect-free contract must NEVER contain.
const FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /use\s+windows(::|\s|;)|windows::Win32|windows_sys/, why: "windows API reference" },
  { re: /extern\s+"system"|extern\s+"C"/, why: "extern FFI" },
  { re: /\bHANDLE\b|OwnedHandle|from_raw_handle|RawHandle/, why: "raw handle route" },
  { re: /OpenSCManager|QueryServiceStatus|CreateServiceW?|OpenServiceW?|ControlService|StartServiceW?/, why: "SCM/service route" },
  { re: /OpenProcessToken|GetTokenInformation|LookupAccountName|ConvertSidToStringSid|CreateWellKnownSid/, why: "token/SID route" },
  { re: /RegCreateKey|RegSetValue|RegOpenKey/, why: "registry route" },
  { re: /ProgramData|SetSecurityInfo|SetNamedSecurityInfo|ConvertStringSecurityDescriptor|InitializeAcl/, why: "ProgramData/ACL route" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute/, why: "process-launch route" },
  { re: /TcpStream|TcpListener|std::net::|reqwest|hyper::|CreateNamedPipe/, why: "IPC/network route" },
  { re: /CredRead|CredWrite|CryptProtectData|\bGCM\b|\bPAT\b/, why: "credential route" },
];

// Public evidence must never be able to carry a raw identity or free text.
const RAW_IDENTITY_TYPES = [
  { re: /:\s*String\b/, why: "String field (raw identity capable)" },
  { re: /:\s*OsString\b/, why: "OsString field" },
  { re: /:\s*PathBuf\b/, why: "PathBuf field" },
  { re: /:\s*Vec<\s*u8\s*>/, why: "Vec<u8> field" },
  { re: /:\s*\[\s*u8\s*;/, why: "byte-array field" },
  { re: /:\s*HashMap<|:\s*BTreeMap</, why: "map field" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["service-identity-proof crate directory missing: " + CRATE];

  // 1. Identity + dependency footprint.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-service-identity-proof"/.test(toml))
    errors.push("package name is not projectos-host-windows-service-identity-proof");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("crate is not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("crate does not forbid unsafe in Cargo.toml lints");
  // Dependencies: ONLY projectos-host-authority (path). No windows, no Control Center, no others.
  const depSection = stripComments(toml).split(/\[dependencies\]/)[1] || "";
  const depBody = depSection.split(/\n\[/)[0];
  const depNames = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) =>
    s.replace(/\s*=$/, "").trim()
  );
  for (const n of depNames) {
    if (n !== "projectos-host-authority") errors.push("unexpected dependency: " + n);
  }
  if (!/projectos-host-authority\s*=\s*\{[^}]*path\s*=\s*"\.\.\/host-authority"/.test(toml))
    errors.push("does not depend on host-authority via the sibling path");
  if (/control-center|windows\s*=/.test(depBody)) errors.push("forbidden dependency (control-center/windows)");
  // Lockfile: only this crate + host-authority (host-authority default is zero-dep).
  const lock = read(path.join(CRATE, "Cargo.lock"));
  const pkgNames = (lock.match(/^name = "(.*)"$/gm) || []).map((s) => s.replace(/^name = "|"$/g, ""));
  for (const n of pkgNames) {
    if (
      n !== "projectos-host-windows-service-identity-proof" &&
      n !== "projectos-host-authority"
    ) {
      errors.push("Cargo.lock contains an unexpected package: " + n);
    }
  }

  // 2. Source scans: forbid(unsafe), no effect routes, no unsafe.
  const srcFiles = rsFiles(path.join(CRATE, "src"));
  let sawForbid = false;
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/#!\[forbid\(unsafe_code\)\]/.test(code)) sawForbid = true;
    if (/unsafe\s*(fn|\{)/.test(code)) errors.push(rel + ": unsafe code");
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) errors.push(rel + ": " + why);
    }
  }
  if (!sawForbid) errors.push("lib.rs does not #![forbid(unsafe_code)]");

  // 3. Redacted evidence: no raw-identity-capable field anywhere in the crate's public types.
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    for (const { re, why } of RAW_IDENTITY_TYPES) {
      if (re.test(code)) errors.push(rel + ": " + why);
    }
  }

  // 4. Structural separation + fail-closed model in the evidence + classify modules.
  const ev = stripComments(read(path.join(CRATE, "src", "evidence.rs")));
  if (!/configured_virtual_account_is_token_user/.test(ev))
    errors.push("missing token-user evidence field");
  if (!/expected_service_sid_present_in_token_groups/.test(ev))
    errors.push("missing service-SID group-membership evidence field");
  if (!/expected_service_sid_type_present/.test(ev))
    errors.push("missing service-SID-type evidence field");
  if (!/NonAuthorisingIntegrity/.test(ev)) errors.push("integrity is not modelled as non-authorising");
  if (!/enum Tristate/.test(ev)) errors.push("missing canonical Tristate");
  // The three token facts must be DISTINCT fields (separation).
  if (
    ev.indexOf("configured_virtual_account_is_token_user") ===
    ev.indexOf("expected_service_sid_present_in_token_groups")
  )
    errors.push("token-user and service-SID evidence are not separate");

  const cl = stripComments(read(path.join(CRATE, "src", "classify.rs")));
  // Integrity is never read in the classification LOGIC (the non-test portion). Tests legitimately
  // set the field to prove it is non-authorising, so scan only the production code.
  const clProd = cl.split(/#\[cfg\(test\)\]/)[0];
  if (/same_integrity_level/.test(clProd))
    errors.push("classification reads the non-authorising integrity observation");
  // ExistingToken never trusted.
  if (!/ExistingTokenNotTrusted/.test(cl)) errors.push("no ExistingToken-not-trusted refusal");
  if (!/ExistingToken/.test(cl)) errors.push("classification does not consider ExistingToken");
  // Both corroboration channels are required.
  if (!/peer_corroboration/.test(cl) || !/scm_corroboration/.test(cl))
    errors.push("classification does not require both IPC and SCM corroboration");
  // Residue zero required.
  if (!/ResidueEvidence::Zero/.test(cl) || !/ResidueNonZero/.test(cl))
    errors.push("residue-zero is not required");
  // Release-before-acquire via canonical handover terminal state.
  if (!/AuthorityHandoverState::ServiceReady/.test(cl))
    errors.push("release-before-acquire is not evidenced via ServiceReady");
  // Fail-closed Confirmed appears exactly at the end (no permissive aggregate boolean returning true).
  if (!/C::Confirmed\s*\}/.test(cl)) errors.push("Confirmed is not the final fully-checked outcome");

  // 5. Truthful crate consts.
  const lib = read(path.join(CRATE, "src", "lib.rs"));
  if (!/SERVICE_IDENTITY_PROOF_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib))
    errors.push("missing SERVICE_IDENTITY_PROOF_IS_CONTRACT_ONLY = true");
  if (!/LIVE_SERVICE_IDENTITY_PROOF_RUN:\s*bool\s*=\s*false/.test(lib))
    errors.push("LIVE_SERVICE_IDENTITY_PROOF_RUN must be false");

  // 6. Shared runtime reports a truthful contract-only status and stays not-execution-ready.
  const sharedRuntime = read(path.join(SHARED, "src", "runtime.rs"));
  if (!/ServiceIdentityProofContractScaffolded/.test(sharedRuntime))
    errors.push("shared runtime does not report ServiceIdentityProofContractScaffolded");
  if (/service_identity_proof:\s*ImplementationState::DeferredTo3KIDE/.test(sharedRuntime))
    errors.push("shared runtime still defers service_identity_proof (stale status)");
  const sharedLib = read(path.join(SHARED, "src", "lib.rs"));
  if (!/EXECUTION_READY:\s*bool\s*=\s*false/.test(sharedLib))
    errors.push("shared execution readiness is not false");
  // No overstated production status.
  if (/\b(Operational|ProductionReady|ServiceIdentityProven|ServiceReadyProven|InstallationReady)\b/.test(sharedRuntime))
    errors.push("shared runtime overstates service-identity readiness");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-identity-proof-3kideb] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-identity-proof-3kideb: PASS");
}
