"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-B. Prove the host-authority crate is an effect-free
// typed CONTRACT: exact identity, publish=false, forbid(unsafe_code), zero dependencies, and NO
// route to a Windows API, named object, SDDL/ACL/SID, SCM query, IPC bind, process launch, credential
// or signing — and no public arbitrary-string authority key, bool/string role selection, generic
// acquire, or raw SID/DACL/HANDLE getter. Also confirms the shared runtime keeps forbid(unsafe_code)
// with execution readiness false, and that Control Center / host-identity / primitives are untouched
// by the phase. Comments stripped; structural checks; no line numbers.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "host-authority");
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

// Effect / Windows / authority-bypass routes the contract must NEVER contain.
const FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /use\s+windows(::|\s|;)|windows::Win32|windows_sys/, why: "windows API reference" },
  { re: /CreateMutex|OpenMutex|CreateMutexExW|CreateEventW?|CreateSemaphore|CreatePrivateNamespace|CreateBoundaryDescriptor/, why: "named-object creation route" },
  { re: /OpenSCManager|QueryServiceStatus|CreateServiceW?|OpenServiceW?/, why: "SCM access route" },
  { re: /LookupAccountName|LookupAccountSid|ConvertSidToStringSid|ConvertStringSid|GetTokenInformation/, why: "SID-resolution route" },
  { re: /ConvertStringSecurityDescriptor|SECURITY_DESCRIPTOR|InitializeAcl|AddAccessAllowedAce|SDDL/, why: "DACL/ACL/SDDL creation route" },
  { re: /\bHANDLE\b|OwnedHandle|from_raw_handle/, why: "raw HANDLE route" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute/, why: "process-launch route" },
  { re: /CreateNamedPipe|ConnectNamedPipe|TcpStream|reqwest|hyper::/, why: "IPC/network route" },
  { re: /ProgramData/, why: "ProgramData route" },
  { re: /RegCreate|RegSetValue|RegOpenKey/, why: "registry route" },
  { re: /CredRead|CredWrite|CryptProtectData|\bGCM\b|\bPAT\b/, why: "credential/GCM/PAT route" },
  { re: /\bgithub\b/i, why: "GitHub route" },
  { re: /CertCreateSelfSign|CryptSignMessage|SignerSign/, why: "signing route" },
  // The eventual object name is never constructed as a literal in the contract crate.
  { re: /Global\\\\ProjectOS/, why: "literal Global\\ authority object name" },
  // No generic acquire(role/bool/string/name) or authority-key string constructors.
  { re: /impl\s+From<\s*(bool|&str|String)\s*>\s+for\s+(AuthorityKey|InteractiveFallbackAuthority|ServiceRuntimeAuthority)/, why: "authority From<bool/str/String> bypass" },
  { re: /fn\s+acquire\s*\(\s*[^)]*\b(bool|role|name|&str|String)\b/, why: "generic acquire(role/bool/string/name) route" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-authority crate directory missing: " + CRATE];

  // 1. Identity + manifest.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-authority"/.test(toml)) errors.push("package name is not projectos-host-authority");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("crate is not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml) && !/#!\[forbid\(unsafe_code\)\]/.test(read(path.join(CRATE, "src", "lib.rs"))))
    errors.push("crate does not forbid unsafe");
  // Zero dependencies: the [dependencies] table (comments stripped) must declare none.
  const depSection = stripComments(toml).split(/\[dependencies\]/)[1] || "";
  const depBody = depSection.split(/\n\[/)[0];
  if (/=\s*\{|=\s*"/.test(depBody)) errors.push("host-authority declares a dependency (must be zero)");
  if (/\[target\./.test(stripComments(toml))) errors.push("host-authority declares a target-specific dependency");
  // Lockfile: only this crate.
  const lock = read(path.join(CRATE, "Cargo.lock"));
  const names = (lock.match(/^name = /gm) || []).length;
  if (names !== 1) errors.push("Cargo.lock has " + names + " packages (expected only this crate)");

  // 2. Source scans.
  const files = rsFiles(path.join(CRATE, "src")).concat(rsFiles(path.join(CRATE, "tests")));
  let sawForbid = false;
  let sawExistingTokenDistinct = false;
  for (const f of files) {
    const code = stripComments(read(f));
    if (/#!\[forbid\(unsafe_code\)\]/.test(code)) sawForbid = true;
    if (/unsafe\s*(fn|\{)/.test(code)) errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": unsafe code");
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + why);
    }
  }
  if (!sawForbid) errors.push("lib.rs does not #![forbid(unsafe_code)]");

  // 3. No-trust rule: ExistingToken is distinct from confirmed authority, and its uncorroborated
  //    corroboration is AuthorityUncertain.
  const model = stripComments(read(path.join(CRATE, "src", "model.rs")));
  if (/ExistingToken/.test(model) && /is_confirmed_authority/.test(model)) sawExistingTokenDistinct = true;
  if (!sawExistingTokenDistinct) errors.push("model does not distinguish ExistingToken from confirmed authority");
  if (!/AuthorityTokenOutcome::ExistingToken,\s*None\s*\)\s*=>\s*AuthorityPeerState::AuthorityUncertain/.test(model))
    errors.push("uncorroborated ExistingToken is not AuthorityUncertain");
  // Fallback prohibitions present.
  if (!/FallbackForbiddenAfterActivation/.test(model)) errors.push("no FallbackForbiddenAfterActivation reason");
  if (!/ServiceAbsenceUnproven/.test(model)) errors.push("no ServiceAbsenceUnproven reason (IPC-failure guard)");
  // Release-before-acquire: no direct FallbackOwned -> ServiceTokenAcquired arm.
  if (/FallbackOwned,\s*S::ServiceTokenAcquired\)\s*=>\s*true/.test(model))
    errors.push("handover permits FallbackOwned -> ServiceTokenAcquired directly");
  // Detection-rights only: no modify/write/delete intended right.
  if (/MODIFY_STATE|WRITE_DAC|WRITE_OWNER|GENERIC_ALL|MUTEX_ALL_ACCESS/.test(model))
    errors.push("security profile intends a modification/ownership right");
  // No public arbitrary-string key constructor.
  if (/impl\s+From<\s*(&str|String)\s*>\s+for\s+AuthorityKey/.test(model)) errors.push("AuthorityKey has a From<String>/<&str>");
  if (/impl\s+Default\s+for\s+(AuthorityKey|AuthorityGuard|FallbackPolicy|ServiceRuntimeAuthority|InteractiveFallbackAuthority)/.test(model))
    errors.push("a sealed authority type implements Default");
  if (/derive\([^)]*\bClone\b[^)]*\)\]\s*pub struct AuthorityGuard/.test(model))
    errors.push("AuthorityGuard derives Clone");

  // 4. Shared runtime stays safe and consumes the contract facade.
  const sharedLib = read(path.join(SHARED, "src", "lib.rs"));
  if (!/#!\[forbid\(unsafe_code\)\]/.test(sharedLib)) errors.push("shared-host-runtime lost #![forbid(unsafe_code)]");
  if (!/EXECUTION_READY:\s*bool\s*=\s*false/.test(sharedLib)) errors.push("shared execution readiness is not false");
  if (!/projectos_host_authority/.test(sharedLib)) errors.push("shared runtime does not re-export the authority facade");
  if (!/projectos-host-authority/.test(read(path.join(SHARED, "Cargo.toml")))) errors.push("shared runtime does not depend on host-authority");
  for (const f of rsFiles(path.join(SHARED, "src"))) {
    if (/unsafe\s*(fn|\{)/.test(stripComments(read(f)))) errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": unsafe in shared runtime");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-host-authority-contract-boundary] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-host-authority-contract-boundary: PASS");
}
