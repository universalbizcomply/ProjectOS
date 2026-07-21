"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-C — current-tree boundary for the SYNTHETIC Windows
// host authority.
//
// Proves the host-authority crate implements the synthetic Windows existence-token authority WITHIN a
// tight boundary:
//   - identity + publish=false; the windows dependency is OPTIONAL and gated by the test-fixtures
//     feature (so a default/release build pulls no acquisition dependency);
//   - unsafe is CONFINED to the three named FFI files (token/security/service_principal) — model.rs,
//     key.rs, lib.rs and windows_proof.rs contain none;
//   - NO forbidden route anywhere: no SCM, no service install/start, no IPC/network, no registry, no
//     ProgramData, no credential/GCM/PAT, no signing, no GitHub. Process launch is forbidden in src and
//     allowed ONLY in the single authorised child-launch test file (windows_existence.rs);
//   - the guard adopts handles through the CANONICAL primitive (handles::adopt / handles::win32) — no
//     direct FromRawHandle, no CloseHandle, no duplicate handle wrapper or Drop in host-authority;
//   - the PRODUCTION object name literal appears only in key.rs (derivation) and NEVER in a test/proof;
//     tests use the Test-prefixed name;
//   - the machine-wide profile grants detection rights only, plus the OWNER_RIGHTS ("OW") ACE;
//   - the phase constants state the synthetic impl is present and the production name is NOT acquired.
// Comments stripped before scanning; structural checks; no line numbers.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "host-authority");
const SHARED = path.join(ROOT, "projectos", "host", "shared-host-runtime");

// Matched as dotted substrings (backslash-count independent): the production marker never appears in a
// Test-prefixed name, so there is no false positive between them.
const PRODUCTION_NAME = /ProjectOS\.HostAuthority\.v1/;
const TEST_NAME = /ProjectOS\.Test\.HostAuthority/;
// Files permitted to contain unsafe. `existence.rs` is the mutex existence-token FFI (named to avoid
// the repo's `*token*` gitignore rule for secret-token files).
const UNSAFE_ALLOWED = new Set(["existence.rs", "security.rs", "service_principal.rs"]);

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

// Effect routes the authority crate must NEVER contain — anywhere. (Process launch is handled
// separately: forbidden in src, allowed ONLY in the single authorised integration-test file.)
const FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /OpenSCManager|QueryServiceStatus|CreateServiceW?|OpenServiceW?|ChangeServiceConfig|StartServiceW?/, why: "SCM / service-control route" },
  { re: /CreateProcessW?|CreateProcessAsUser|ShellExecute/, why: "native process-launch route" },
  { re: /CreateNamedPipe|ConnectNamedPipe|TcpStream|TcpListener|reqwest|hyper::|std::net::/, why: "IPC/network route" },
  { re: /ProgramData/, why: "ProgramData route" },
  { re: /RegCreateKey|RegSetValue|RegOpenKey|RegCreateKeyEx/, why: "registry route" },
  { re: /CredRead|CredWrite|CryptProtectData|CryptUnprotectData|\bGCM\b|\bPAT\b/, why: "credential/GCM/PAT route" },
  { re: /\bgithub\b/i, why: "GitHub route" },
  { re: /CertCreateSelfSign|CryptSignMessage|SignerSign|WinVerifyTrust/, why: "signing/trust route" },
];

// Rust std process-launch. Allowed ONLY in the single authorised integration-test file.
const PROCESS_LAUNCH = /std::process::Command|Command::new/;
const CHILD_LAUNCH_FILE = "windows_existence.rs";

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-authority crate directory missing: " + CRATE];

  // 1. Identity + optional, feature-gated windows AND canonical-primitive dependencies.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-authority"/.test(toml)) errors.push("package name is not projectos-host-authority");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("crate is not publish=false");
  if (!/test-fixtures\s*=\s*\[[^\]]*"dep:windows"[^\]]*\]/.test(toml)) errors.push("test-fixtures feature does not gate dep:windows");
  if (!/test-fixtures\s*=\s*\[[^\]]*"dep:projectos-windows-runtime-primitives"[^\]]*\]/.test(toml))
    errors.push("test-fixtures feature does not gate dep:projectos-windows-runtime-primitives");
  if (!/windows\s*=\s*\{[^}]*optional\s*=\s*true/.test(toml)) errors.push("windows dependency is not optional");
  // Canonical primitive path dependency, optional, pointing at the sibling crate.
  if (!/projectos-windows-runtime-primitives\s*=\s*\{[^}]*path\s*=\s*"\.\.\/windows-runtime-primitives"[^}]*optional\s*=\s*true/.test(toml))
    errors.push("canonical primitive path dependency is not present as an optional path dep");
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(toml)) errors.push("windows dependency is not cfg(windows)-scoped");
  // The only permitted dependencies are windows + the canonical primitive.
  const depBlocks = toml.match(/^\s*([a-z0-9_-]+)\s*=\s*\{/gim) || [];
  for (const d of depBlocks) {
    const nameMatch = d.match(/([a-z0-9_-]+)\s*=/i);
    const name = nameMatch ? nameMatch[1] : "";
    if (name && !["windows", "test-fixtures", "projectos-windows-runtime-primitives"].includes(name)) {
      errors.push("unexpected dependency-like entry: " + name);
    }
  }

  // 2. Source scans: unsafe confinement, no forbidden routes, and per-file process-launch policy.
  const srcFiles = rsFiles(path.join(CRATE, "src"));
  const testFiles = rsFiles(path.join(CRATE, "tests"));
  const allFiles = srcFiles.concat(testFiles);
  let childLaunchSites = 0;
  for (const f of allFiles) {
    const base = path.basename(f);
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const isSrc = path.dirname(f).replace(/\\/g, "/").endsWith("/src");
    const code = stripComments(read(f));
    if (/unsafe\s*(fn|\{)/.test(code) && !UNSAFE_ALLOWED.has(base)) {
      errors.push(rel + ": unsafe outside the permitted FFI files");
    }
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) errors.push(rel + ": " + why);
    }
    // Process launch: never in src; in tests only in the single authorised file.
    if (PROCESS_LAUNCH.test(code)) {
      if (isSrc) errors.push(rel + ": process-launch route in src (forbidden)");
      else if (base !== CHILD_LAUNCH_FILE)
        errors.push(rel + ": process launch outside the authorised child-launch test file");
      else childLaunchSites += 1;
    }
    // Canonical handle boundary: host-authority src must NOT adopt handles directly or close them.
    if (isSrc) {
      if (/from_raw_handle/.test(code)) errors.push(rel + ": direct FromRawHandle ownership (use handles::adopt)");
      if (/CloseHandle/.test(code)) errors.push(rel + ": direct CloseHandle (the primitive owns the close)");
    }
  }
  if (childLaunchSites === 0) errors.push("no authorised child-launch site found in " + CHILD_LAUNCH_FILE);

  // 2b. AuthorityGuard uses the canonical primitive handle boundary — no duplicate wrapper/Drop.
  const model = stripComments(read(path.join(CRATE, "src", "model.rs")));
  const existence = stripComments(read(path.join(CRATE, "src", "existence.rs")));
  if (!/projectos_windows_runtime_primitives::handles/.test(existence))
    errors.push("existence.rs does not use the canonical primitive handles module");
  if (!/handles::adopt/.test(existence)) errors.push("existence.rs does not adopt via handles::adopt");
  if (!/handles::win32/.test(existence)) errors.push("existence.rs does not inspect via handles::win32");
  // No independent handle wrapper struct or Drop in host-authority src.
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/impl\s+Drop\s+for\s+\w*Handle/.test(code)) errors.push(rel + ": duplicate handle Drop implementation");
  }
  // AuthorityGuard has no OTHER Drop implementation (the OwnedHandle owns the single close).
  if (/impl\s+Drop\s+for\s+AuthorityGuard/.test(model))
    errors.push("AuthorityGuard has a manual Drop (must rely on the primitive's OwnedHandle)");

  // 3. Production name literal only in key.rs; never in a test/proof file.
  for (const f of allFiles) {
    const base = path.basename(f);
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (base === "key.rs") continue; // derivation lives here
    if (PRODUCTION_NAME.test(stripComments(read(f)))) {
      errors.push(rel + ": contains the production authority name literal");
    }
  }
  const keyRs = stripComments(read(path.join(CRATE, "src", "key.rs")));
  if (!PRODUCTION_NAME.test(keyRs)) errors.push("key.rs does not derive the production name prefix");
  if (!TEST_NAME.test(keyRs)) errors.push("key.rs lacks the Test-only name prefix");

  // 4. Security profile: detection rights only + OWNER_RIGHTS ACE; no all-access in the production path.
  const secRs = stripComments(read(path.join(CRATE, "src", "security.rs")));
  if (!/AUTHORITY_DETECTION_RIGHTS\s*:\s*u32\s*=\s*RIGHT_SYNCHRONIZE\s*\|\s*RIGHT_READ_CONTROL/.test(secRs))
    errors.push("detection rights are not exactly SYNCHRONIZE|READ_CONTROL");
  if (!/;;;OW\)/.test(secRs)) errors.push("machine-wide profile lacks the OWNER_RIGHTS (OW) ACE");
  // build_v1 must use the detection-rights constant (not an all-access literal).
  if (!/fn build_v1[\s\S]*?AUTHORITY_DETECTION_RIGHTS/.test(secRs))
    errors.push("build_v1 does not use AUTHORITY_DETECTION_RIGHTS");
  // Any MUTEX_ALL_ACCESS literal must be confined to a _for_test helper.
  const allAccessHits = secRs.match(/001F0001/g) || [];
  if (allAccessHits.length && !/_for_test[\s\S]*?001F0001/.test(secRs))
    errors.push("MUTEX_ALL_ACCESS literal outside a test-only helper");
  // existence.rs never grants all-access.
  if (/001F0001|MUTEX_ALL_ACCESS/.test(stripComments(read(path.join(CRATE, "src", "existence.rs")))))
    errors.push("existence.rs references MUTEX_ALL_ACCESS");

  // 5. Phase constants: synthetic implemented, production name NOT acquired.
  const lib = read(path.join(CRATE, "src", "lib.rs"));
  if (!/AUTHORITY_SYNTHETIC_WINDOWS_IMPLEMENTED:\s*bool\s*=\s*true/.test(lib))
    errors.push("missing AUTHORITY_SYNTHETIC_WINDOWS_IMPLEMENTED = true");
  if (!/AUTHORITY_PRODUCTION_NAME_ACQUIRED_THIS_PHASE:\s*bool\s*=\s*false/.test(lib))
    errors.push("production name must NOT be acquired this phase");
  // The FFI + proof surface is gated to test-fixtures (no acquisition ships by default).
  if (!/cfg\(all\(windows,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*mod existence/.test(lib))
    errors.push("existence module is not gated to the test-fixtures feature");
  if (!/cfg\(all\(windows,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*pub mod windows_proof/.test(lib))
    errors.push("windows_proof is not gated to the test-fixtures feature");

  // 6. No-trust rule survives: an existing token is never confirmed authority.
  if (!/ExistingToken/.test(model) || !/is_confirmed_authority/.test(model))
    errors.push("no-trust ExistingToken rule missing from model");

  // 6b. Multiprocess child proofs: independent test-prefix validation, bounded reaping, and both the
  //     contention and forced-child-crash tests present in the authorised child-launch file.
  const childFile = path.join(CRATE, "tests", CHILD_LAUNCH_FILE);
  if (!fs.existsSync(childFile)) {
    errors.push("authorised child-launch test file missing: tests/" + CHILD_LAUNCH_FILE);
  } else {
    const childCode = stripComments(read(childFile));
    if (!/is_test_object_name/.test(childCode))
      errors.push("child does not independently validate the test-object name");
    if (!/current_exe/.test(childCode)) errors.push("child launch does not use current_exe (no production exe)");
    if (!/--exact/.test(childCode)) errors.push("child launch does not restrict to a single test (--exact)");
    if (!/try_wait|wait_bounded/.test(childCode)) errors.push("child wait is not bounded");
    if (!/impl\s+Drop\s+for\s+ChildGuard/.test(childCode)) errors.push("no Drop-based child reaping guard");
    if (!/\.kill\(\)/.test(childCode)) errors.push("child is not force-terminated");
    if (!/same_user_multiprocess_contention/.test(childCode)) errors.push("missing same-user multiprocess contention test");
    if (!/same_user_child_crash_release/.test(childCode)) errors.push("missing forced-child-crash release test");
    // No graceful mutex ownership: never ReleaseMutex / WaitForSingleObject in the crate.
    for (const f of allFiles) {
      const c = stripComments(read(f));
      if (/ReleaseMutex|WaitForSingleObject/.test(c))
        errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": mutex ownership call (release/wait) forbidden");
    }
  }

  // 7. Shared runtime stays safe, reports a TEST-ONLY status, and is not execution-ready.
  const sharedLib = read(path.join(SHARED, "src", "lib.rs"));
  if (!/#!\[forbid\(unsafe_code\)\]/.test(sharedLib)) errors.push("shared-host-runtime lost forbid(unsafe_code)");
  if (!/EXECUTION_READY:\s*bool\s*=\s*false/.test(sharedLib)) errors.push("shared execution readiness is not false");
  if (!/projectos_host_authority/.test(sharedLib)) errors.push("shared runtime does not re-export the authority facade");
  for (const f of rsFiles(path.join(SHARED, "src"))) {
    if (/unsafe\s*(fn|\{)/.test(stripComments(read(f))))
      errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": unsafe in shared runtime");
  }
  // The synthetic Windows status MUST carry an explicit TestOnly / TestFixtureOnly qualifier, and the
  // ambiguous unqualified names must NOT appear.
  const sharedRuntime = read(path.join(SHARED, "src", "runtime.rs"));
  if (!/TestFixtureOnly|TestOnly/.test(sharedRuntime))
    errors.push("shared runtime status lacks a TestOnly/TestFixtureOnly qualifier");
  if (/\bSyntheticWindowsTokenImplemented\b/.test(sharedRuntime))
    errors.push("shared runtime still reports unqualified SyntheticWindowsTokenImplemented");
  if (/\bContractWithSyntheticWindowsAuthority\b/.test(sharedRuntime))
    errors.push("shared runtime still reports unqualified ContractWithSyntheticWindowsAuthority");
  if (/\b(Operational|ProductionReady|AuthorityConfirmed|ServiceReady|InstallationReady)\b/.test(sharedRuntime))
    errors.push("shared runtime reports a forbidden production-capability status");
  // Cross-user and cross-session proofs must be represented as NotRun.
  if (!/cross_user_proof:\s*ImplementationState::NotRun/.test(sharedRuntime))
    errors.push("cross_user_proof is not NotRun");
  if (!/cross_session_proof:\s*ImplementationState::NotRun/.test(sharedRuntime))
    errors.push("cross_session_proof is not NotRun");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-host-authority-windows-boundary] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-host-authority-windows-boundary: PASS");
}
