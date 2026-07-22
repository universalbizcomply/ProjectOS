"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B3-SECURITY-PRINCIPAL-CONTRACT1A —
// current-tree boundary for the OPAQUE ProjectOSHost named-pipe security-principal contract.
//
// Proves host-authority owns a fixed, opaque, service-SID-backed proof-pipe security contract:
//   - a safe PORTABLE policy module (pipe_security.rs): fixed three-principal allowlist, every broad
//     principal refused, protected DACL, no default explicit-deny, a minimum pipe rights mask, and NO
//     arbitrary service-name / SID / SDDL / principal / mask input;
//   - the opaque descriptor + borrowed lease + live resolution live ONLY in the unsafe-authorised FFI
//     owner (security.rs), reuse the canonical resolver + a SINGLE SDDL→descriptor owner, expose no SID
//     or SDDL, transfer no ownership, are lifetime-bound, and fail closed (RequiresInstalledServiceProof,
//     never a LocalSystem/Administrators-only fallback);
//   - no pipe / SCM / token / registry / process API and no live identity lookup in tests;
//   - windows-local-ipc is NOT modified; execution/production readiness is not flipped.
// Comments stripped before scanning; structural checks.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "host-authority");
const SRC = path.join(CRATE, "src");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function run() {
  const errors = [];
  const pipePath = path.join(SRC, "pipe_security.rs");
  const secPath = path.join(SRC, "security.rs");
  const libPath = path.join(SRC, "lib.rs");
  const testPath = path.join(CRATE, "tests", "pipe_security_contract.rs");
  for (const [label, p] of [
    ["pipe_security.rs", pipePath],
    ["security.rs", secPath],
    ["tests/pipe_security_contract.rs", testPath],
  ]) {
    if (!fs.existsSync(p)) return [label + " missing: " + p];
  }

  const pipe = stripComments(read(pipePath));
  const sec = stripComments(read(secPath));
  const lib = read(libPath);
  const test = stripComments(read(testPath));

  // 1. Portable policy module is SAFE (no unsafe, no Windows FFI).
  if (/unsafe\s*(fn|\{)/.test(pipe)) errors.push("pipe_security.rs contains unsafe (must be safe/portable)");
  if (/use\s+windows(::|\s|;)|windows::Win32|PSID|OwnedSid|SECURITY_ATTRIBUTES|LookupAccountName/.test(pipe))
    errors.push("pipe_security.rs references Windows/SID types (must be portable)");

  // 2. Fixed three-principal allowlist; no arbitrary/explicit principal; no broad allow.
  for (const v of ["ExpectedServiceSid", "LocalSystem", "BuiltinAdministrators"]) {
    if (!new RegExp("ProjectOsHostPipeAllowPrincipal[\\s\\S]*?" + v).test(pipe))
      errors.push("allow principal missing: " + v);
  }
  if (/ProjectOsHostPipeAllowPrincipal[\s\S]*?(ExplicitSid|ArbitrarySid|Custom|Other)\b/.test(pipe))
    errors.push("allow-principal enum has an arbitrary/explicit variant");
  if (!/fn allows_broad\([^)]*\)\s*->\s*bool\s*\{\s*false\s*\}/.test(pipe))
    errors.push("allows_broad does not unconditionally return false");
  if (!/fn is_protected\(\)\s*->\s*bool\s*\{\s*true\s*\}/.test(pipe))
    errors.push("is_protected does not return true (protected DACL required)");
  if (!/fn requires_explicit_deny\(\)\s*->\s*bool\s*\{\s*false\s*\}/.test(pipe))
    errors.push("requires_explicit_deny does not return false");

  // 3. Minimum rights mask: excludes WRITE_DAC / WRITE_OWNER / DELETE.
  const rightsMatch = pipe.match(/PIPE_PROOF_RIGHTS:\s*u32\s*=\s*0x([0-9A-Fa-f_]+)/);
  if (!rightsMatch) {
    errors.push("PIPE_PROOF_RIGHTS constant missing");
  } else {
    const mask = parseInt(rightsMatch[1].replace(/_/g, ""), 16);
    if (mask & 0x0004_0000) errors.push("PIPE_PROOF_RIGHTS grants WRITE_DAC");
    if (mask & 0x0008_0000) errors.push("PIPE_PROOF_RIGHTS grants WRITE_OWNER");
    if (mask & 0x0001_0000) errors.push("PIPE_PROOF_RIGHTS grants DELETE");
    if ((mask & 0x0010_0000) === 0) errors.push("PIPE_PROOF_RIGHTS lacks SYNCHRONIZE");
  }

  // 4. Fail-closed classification: RequiresInstalledServiceProof present; no broad fallback.
  if (!/RequiresInstalledServiceProof/.test(pipe)) errors.push("no RequiresInstalledServiceProof status");
  for (const bad of [
    /Status::(Ready|Ok)\s*=>?[\s\S]{0,40}(LocalSystem|BuiltinAdministrators|Everyone)/,
  ]) {
    if (bad.test(pipe)) errors.push("policy appears to fall back to a broad security");
  }

  // 5. Opaque descriptor in the FFI owner: private field, redacted Debug, not Clone/serde, no SID/SDDL
  //    accessor, single SDDL→descriptor owner, lifetime-bound unsafe-only lease pointer.
  if (!/pub struct ProjectOsHostPipeSecurity\s*\{/.test(sec))
    errors.push("ProjectOsHostPipeSecurity struct missing from security.rs");
  if (/pub struct ProjectOsHostPipeSecurity\s*\{[^}]*\bpub\b/.test(sec))
    errors.push("ProjectOsHostPipeSecurity has a public field (must be opaque)");
  if (/#\[derive\([^)]*Clone[^)]*\)\]\s*(pub )?struct ProjectOsHostPipeSecurity/.test(sec))
    errors.push("ProjectOsHostPipeSecurity derives Clone (single descriptor ownership)");
  if (!/impl core::fmt::Debug for ProjectOsHostPipeSecurity[\s\S]*?<redacted>/.test(sec))
    errors.push("ProjectOsHostPipeSecurity lacks a redacted Debug");
  if (/impl\s+(serde|Serialize|Deserialize)/.test(sec) || /derive\([^)]*Serialize/.test(sec))
    errors.push("descriptor is serializable");
  // No public SID / SDDL / raw-descriptor accessor on the pipe surface.
  if (/pub fn\s+\w*(sid|sddl)\w*\s*\(/i.test(sec)) errors.push("public SID/SDDL accessor exists");
  if (/pub fn descriptor_ptr/.test(sec)) errors.push("descriptor_ptr is public (must be pub(crate))");
  // Single SDDL→descriptor conversion owner (no duplicated ConvertString / LocalFree ownership).
  // Count CALL sites only (the import mention is followed by a comma, not a `(`).
  const convHits = (sec.match(/ConvertStringSecurityDescriptorToSecurityDescriptorW\s*\(/g) || []).length;
  if (convHits !== 1) errors.push("SDDL→descriptor conversion is not centralised (found " + convHits + " call sites)");
  if (!/pub\(crate\) struct OwnedSecurityDescriptor/.test(sec))
    errors.push("shared OwnedSecurityDescriptor owner missing");

  // 6. Reuse the canonical resolver; no second/general SID resolver or ACL builder.
  if (!/resolve_projectos_host_service\(\)/.test(sec))
    errors.push("does not reuse the canonical resolve_projectos_host_service");
  if (/fn\s+\w*resolve\w*sid|LookupAccountName/i.test(pipe))
    errors.push("a general SID resolver leaked into the portable policy");

  // 7. Lifetime-bound, unsafe-only security-attributes lease; no safe raw pointer; no ownership transfer.
  if (!/pub struct BorrowedPipeSecurityAttributes<'/.test(sec))
    errors.push("BorrowedPipeSecurityAttributes lifetime-bound lease missing");
  if (!/PhantomData<&'[a-z]+ ProjectOsHostPipeSecurity>/.test(sec))
    errors.push("lease is not lifetime-bound to the owner via PhantomData");
  if (!/pub unsafe fn as_security_attributes_ptr\(&self\)\s*->\s*\*const SECURITY_ATTRIBUTES/.test(sec))
    errors.push("security-attributes pointer is not an unsafe, lifetime-bound method");
  if (/pub fn\s+\w*\s*\(&self\)\s*->\s*\*(const|mut)/.test(sec))
    errors.push("a SAFE method returns a raw pointer");

  // 8. No forbidden effect route in the pipe contract (belt-and-braces; windows-boundary also enforces).
  for (const { re, why } of [
    { re: /CreateNamedPipe|ConnectNamedPipe/, why: "named-pipe API" },
    { re: /OpenSCManager|CreateServiceW?|OpenServiceW?/, why: "SCM/service API" },
    { re: /OpenProcessToken|GetTokenInformation/, why: "token API" },
    { re: /RegCreateKey|RegOpenKey|RegSetValue/, why: "registry API" },
    { re: /CreateProcess|Command::new/, why: "process launch" },
    { re: /ProgramData/, why: "ProgramData route" },
  ]) {
    if (re.test(pipe) || re.test(sec)) errors.push("forbidden route in pipe contract: " + why);
  }

  // 9. Tests: no live identity lookup, no resolve() invocation, no unsafe, no pipe/SCM.
  if (/LookupAccountName/.test(test)) errors.push("test invokes a live identity API");
  if (/ProjectOsHostPipeSecurity::resolve\s*\(/.test(test)) errors.push("test invokes the live resolve() path");
  if (/unsafe\s*(fn|\{)/.test(test)) errors.push("test contains unsafe");
  if (/CreateNamedPipe|OpenSCManager/.test(test)) errors.push("test references a pipe/SCM API");

  // 10. lib.rs: portable types always re-exported; opaque descriptor gated to test-fixtures on Windows;
  //     production authority is NOT acquired; windows-local-ipc untouched by this contract.
  if (!/pub use pipe_security::\{[\s\S]*?ProjectOsHostPipeSecurityPolicy/.test(lib))
    errors.push("portable pipe policy types are not re-exported");
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*pub use security::\{[^}]*ProjectOsHostPipeSecurity/.test(lib))
    errors.push("opaque descriptor is not gated to test-fixtures on Windows");
  if (!/AUTHORITY_PRODUCTION_NAME_ACQUIRED_THIS_PHASE:\s*bool\s*=\s*false/.test(lib))
    errors.push("production authority acquisition flipped to true");
  // Execution readiness must not be flipped true anywhere in host-authority src.
  for (const f of ["lib.rs", "pipe_security.rs", "security.rs", "model.rs"]) {
    const fp = path.join(SRC, f);
    if (fs.existsSync(fp) && /EXECUTION_READY\s*:\s*bool\s*=\s*true/.test(stripComments(read(fp))))
      errors.push(f + ": execution readiness flipped true");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-host-authority-pipe-security-contract1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-host-authority-pipe-security-contract1a: PASS");
}
