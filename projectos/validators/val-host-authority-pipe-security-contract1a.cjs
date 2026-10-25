"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B3-SECURITY-PRINCIPAL-CONTRACT1A —
// current-tree boundary for the OPAQUE ProjectOSHost named-pipe security-principal contract.
//
// AMENDED by PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A (owner-authorised): the accepted contract
// narrowly evolves to admit the EXACT enrolled configured-owner SID on the single fixed production
// endpoint. The proof-pipe (test-namespace) contract is unchanged: fixed three-principal machine
// allowlist. The PRODUCTION policy is exactly four principals (service SID, LocalSystem, Builtin
// Administrators, ConfiguredOwner); the owner SID is consumed ONLY from the CLOSED canonical
// installation record (host-identity, activated for windows-pipe-security-runtime), converted through
// the EXISTING ConvertSidToStringSidW handling, and its absence FAILS CLOSED
// (ConfiguredOwnerUnavailable) — never a fallback to the interactive user or any broad principal.
//
// Proves host-authority owns a fixed, opaque, service-SID-backed pipe security contract:
//   - a safe PORTABLE policy module (pipe_security.rs): fixed three-principal proof allowlist plus the
//     fixed four-principal production allowlist, every broad principal refused, protected DACL, no
//     default explicit-deny, a minimum pipe rights mask, and NO arbitrary service-name / SID / SDDL /
//     principal / mask input;
//   - the opaque descriptor + borrowed lease + live resolution live ONLY in the unsafe-authorised FFI
//     owner (security.rs), reuse the canonical resolver + a SINGLE SDDL→descriptor owner, expose no SID
//     or SDDL, transfer no ownership, are lifetime-bound, and fail closed (RequiresInstalledServiceProof
//     / ConfiguredOwnerUnavailable, never a LocalSystem/Administrators-only fallback);
//   - no pipe / SCM / token / registry / process API and no live identity lookup in tests;
//   - execution/production readiness is not flipped.
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

  // 2. Fixed allowlists; no arbitrary/explicit principal; no broad allow.
  for (const v of ["ExpectedServiceSid", "LocalSystem", "BuiltinAdministrators", "ConfiguredOwner"]) {
    if (!new RegExp("ProjectOsHostPipeAllowPrincipal[\\s\\S]*?" + v).test(pipe))
      errors.push("allow principal missing: " + v);
  }
  if (/ProjectOsHostPipeAllowPrincipal[\s\S]*?(ExplicitSid|ArbitrarySid|Custom|Other)\b/.test(pipe))
    errors.push("allow-principal enum has an arbitrary/explicit variant");
  // The PROOF allowlist stays exactly the three machine principals (no ConfiguredOwner there).
  const proofList = pipe.match(/fn allowlist\(\)[\s\S]*?&\[([\s\S]*?)\]\s*\}/);
  if (!proofList) errors.push("proof allowlist not found");
  else {
    if (/ConfiguredOwner/.test(proofList[1]))
      errors.push("the proof-pipe allowlist gained the configured owner (must stay machine-only)");
    for (const v of ["ExpectedServiceSid", "LocalSystem", "BuiltinAdministrators"]) {
      if (!proofList[1].includes(v)) errors.push("proof allowlist missing: " + v);
    }
  }
  // AMENDMENT1A: the PRODUCTION allowlist is EXACTLY four principals, in DACL order, ending with the
  // configured owner. No fifth principal and no broad principal can appear.
  const prodList = pipe.match(/fn production_allowlist\(\)[\s\S]*?&\[([\s\S]*?)\]\s*\}/);
  if (!prodList) {
    errors.push("production_allowlist missing (four-principal production policy required)");
  } else {
    const entries = (prodList[1].match(/ProjectOsHostPipeAllowPrincipal::(\w+)/g) || []).map((s) =>
      s.replace("ProjectOsHostPipeAllowPrincipal::", "")
    );
    if (
      entries.join(",") !==
      "ExpectedServiceSid,LocalSystem,BuiltinAdministrators,ConfiguredOwner"
    )
      errors.push("production allowlist is not exactly the four fixed principals: " + entries.join(","));
  }
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

  // 6b. AMENDMENT1A (PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A): configured-owner consumption.
  //   - The production resolution takes NO argument: no caller can supply an owner/service SID.
  if (!/pub fn resolve_production\(\)\s*->\s*\(ProjectOsHostPipeSecurityStatus,\s*Option<Self>\)/.test(sec))
    errors.push("resolve_production missing or accepts caller input (no-arg entry point required)");
  //   - The owner comes ONLY from the CLOSED canonical installation record route.
  if (!/production_canonical_identity\(\)/.test(sec))
    errors.push("configured owner is not read via the canonical production_canonical_identity route");
  if (!/owner_enrolment\(\)/.test(sec))
    errors.push("configured owner is not read via OwnerEnrolment");
  if (!/OwnerEnrolment::Enrolled\(/.test(sec))
    errors.push("the EXACT enrolled owner SID is not the consumed principal");
  if (!/OwnerEnrolment::Absent\s*=>\s*None/.test(sec))
    errors.push("an absent owner enrolment does not fail closed to None");
  //   - Absence/malformation FAILS CLOSED to the dedicated status; the status exists in the policy.
  if (!/ConfiguredOwnerUnavailable/.test(pipe))
    errors.push("ConfiguredOwnerUnavailable status missing from the portable policy");
  if (!/ConfiguredOwnerUnavailable/.test(sec))
    errors.push("the runtime layer never fails closed to ConfiguredOwnerUnavailable");
  //   - Reuses the EXISTING host-authority SID->string conversion (no second conversion owner).
  const principalSrc = stripComments(read(path.join(SRC, "service_principal.rs")));
  if (!/sid_string_from_binary/.test(sec))
    errors.push("owner bytes are not converted via the shared sid_string_from_binary helper");
  if (!/pub\(crate\) fn sid_string_from_binary/.test(principalSrc))
    errors.push("sid_string_from_binary is missing from service_principal.rs or is public");
  if (!/ConvertSidToStringSidW/.test(principalSrc))
    errors.push("the SID->string conversion no longer reuses ConvertSidToStringSidW");
  //   - The four-principal PRODUCTION SDDL: protected, SY + BA + service SID + owner SID, and no
  //     broad/interactive/owner-rights ACE token anywhere in the builder.
  const prodSddl = sec.match(/fn production_pipe_sddl\(service_sid: &str, owner_sid: &str\)[\s\S]*?\n\}/);
  if (!prodSddl) {
    errors.push("production_pipe_sddl builder missing");
  } else {
    const body = prodSddl[0];
    if (!/"D:P"/.test(body)) errors.push("production SDDL is not a protected DACL");
    if (!/"SY",\s*"BA",\s*service_sid,\s*owner_sid/.test(body))
      errors.push("production SDDL does not grant exactly SY, BA, service SID and owner SID in order");
    for (const bad of ['"IU"', '"WD"', '"BU"', '"AU"', '"OW"']) {
      if (body.includes(bad)) errors.push("production SDDL grants a forbidden principal token: " + bad);
    }
    if (!/PIPE_PROOF_RIGHTS/.test(body)) errors.push("production SDDL does not use the minimum rights mask");
  }
  //   - No interactive-user fallback anywhere in the runtime security layer.
  if (/CurrentInteractiveUser/.test(sec))
    errors.push("the runtime security layer references the interactive user (forbidden fallback)");
  //   - The host-identity dependency is activated by the runtime feature (checked with the feature
  //     split in section 10b below).

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

  // 9. Tests: no live identity lookup, no resolve()/resolve_production() invocation, no unsafe, no
  //    pipe/SCM. (Fn-pointer visibility references without a call are permitted.)
  if (/LookupAccountName/.test(test)) errors.push("test invokes a live identity API");
  if (/ProjectOsHostPipeSecurity::resolve\s*\(/.test(test)) errors.push("test invokes the live resolve() path");
  if (/resolve_production\s*\(\s*\)/.test(test)) errors.push("test invokes the live resolve_production() path");
  if (/unsafe\s*(fn|\{)/.test(test)) errors.push("test contains unsafe");
  if (/CreateNamedPipe|OpenSCManager/.test(test)) errors.push("test references a pipe/SCM API");

  // 10. lib.rs: portable types always re-exported; opaque descriptor gated to the NON-fixture runtime
  //     feature on Windows; production authority is NOT acquired.
  if (!/pub use pipe_security::\{[\s\S]*?ProjectOsHostPipeSecurityPolicy/.test(lib))
    errors.push("portable pipe policy types are not re-exported");
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"windows-pipe-security-runtime"\)\)\]\s*pub use security::\{[^}]*ProjectOsHostPipeSecurity/.test(lib))
    errors.push("opaque descriptor is not gated to the windows-pipe-security-runtime feature");
  if (!/AUTHORITY_PRODUCTION_NAME_ACQUIRED_THIS_PHASE:\s*bool\s*=\s*false/.test(lib))
    errors.push("production authority acquisition flipped to true");

  // 10b. RUNTIME/FIXTURE FEATURE SPLIT (B3-HOST-AUTHORITY-RUNTIME-FEATURE-CONTRACT1A).
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/^\s*default\s*=\s*\[\s*\]/m.test(toml)) errors.push("default features are not empty");
  const runtimeLine = (toml.match(/windows-pipe-security-runtime\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (!runtimeLine) errors.push("windows-pipe-security-runtime feature is missing");
  if (/test-fixtures/.test(runtimeLine)) errors.push("runtime feature depends on test-fixtures (forbidden direction)");
  if (!/"dep:windows"/.test(runtimeLine)) errors.push("runtime feature does not enable the windows dependency");
  // AMENDMENT1A: the runtime feature activates the ALREADY-DECLARED host-identity dependency (the
  // configured-owner source). It must be this dependency, not a new one, and not a fixtures edge.
  if (!/"dep:projectos-host-identity"/.test(runtimeLine))
    errors.push("runtime feature does not activate the host-identity configured-owner source");
  const fixturesLine = (toml.match(/\btest-fixtures\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (!/windows-pipe-security-runtime/.test(fixturesLine)) errors.push("test-fixtures does not include the runtime feature");
  // The security FFI + service_principal modules are gated to the runtime feature (not test-fixtures).
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"windows-pipe-security-runtime"\)\)\]\s*mod security/.test(lib))
    errors.push("security module is not gated to the runtime feature");
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"windows-pipe-security-runtime"\)\)\]\s*mod service_principal/.test(lib))
    errors.push("service_principal module is not gated to the runtime feature");
  // Synthetic constructors + fixture modules remain test-fixtures-only.
  if (!/#\[cfg\(feature\s*=\s*"test-fixtures"\)\]\s*(#\[must_use\]\s*)?pub fn build_synthetic_for_test/.test(sec))
    errors.push("build_synthetic_for_test is not gated to test-fixtures");
  // PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A) - THE DECLARED AMENDMENT.
  //
  //   OLD: `mod existence` was gated to `test-fixtures` ALONE, so the existence-token acquisition
  //        shipped in no release graph at all - which is why the production session route was
  //        unreachable and `compose_protected_operation` was uncallable.
  //   NEW: `any(test-fixtures, windows-authority-acquisition)`. NO logic moved; only the cfg.
  //
  // The permitted gate is matched EXACTLY, so a third feature - or a bare `cfg(windows)` - cannot
  // slip in unnamed, and the SYNTHETIC surface below is separately proven still fixture-only.
  if (!/#\[cfg\(all\(\s*windows,\s*any\(feature\s*=\s*"test-fixtures",\s*feature\s*=\s*"windows-authority-acquisition"\)\s*\)\)\]\s*mod existence/.test(lib))
    errors.push("existence module is not gated to exactly any(test-fixtures, windows-authority-acquisition)");
  // The synthetic proof surface must NOT have been widened with it.
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*pub mod windows_proof/.test(lib))
    errors.push("windows_proof is no longer confined to test-fixtures");
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*pub mod windows_proof/.test(lib))
    errors.push("windows_proof fixture module is not gated to test-fixtures");
  // The runtime feature must not (indirectly) export a synthetic constructor: build_synthetic_for_test
  // must carry a test-fixtures cfg, never a windows-pipe-security-runtime cfg.
  if (/#\[cfg\(feature\s*=\s*"windows-pipe-security-runtime"\)\]\s*(#\[must_use\]\s*)?pub fn build_synthetic_for_test/.test(sec))
    errors.push("synthetic constructor exposed under the runtime feature");
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
