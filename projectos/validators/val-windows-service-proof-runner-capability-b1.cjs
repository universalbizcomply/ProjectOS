"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B1 — boundary for the effect-free
// proof-runner CONTRACT crate. Proves: exact identity, publish=false, library-only (no [[bin]]), no
// default features, forbid(unsafe_code), only the two capability + evidence dependencies, no direct
// windows/extern/handle/SCM/service/token/pipe/registry/ACL/process/network route, no raw-identity/
// arbitrary field, canonical AuthorityHandoverState reuse (no second handover machine), dual IPC+SCM
// corroboration, one-correction-cycle max, rollback required, zero-residue required, exec-ready false,
// and no general orchestrator. Comments stripped; structural.
const fs = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-service-identity-proof-runner");
const SRC = path.join(CRATE, "src");

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
  // Require the FFI call form (W-suffix / call paren) so the proof STAGE labels CreateService /
  // StartService / DeleteService are not mistaken for Win32 calls.
  { re: /OpenSCManagerW?\s*\(|CreateServiceW\b|StartServiceW\b|DeleteService\s*\(|ChangeServiceConfig/, why: "SCM/service FFI route" },
  { re: /OpenProcessToken|GetTokenInformation/, why: "token route" },
  { re: /CreateNamedPipe|ConnectNamedPipe/, why: "pipe route" },
  { re: /RegCreateKey|RegSetValue/, why: "registry route" },
  { re: /SetSecurityInfo|InitializeAcl/, why: "ACL mutation route" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute/, why: "process/shell route" },
  { re: /TcpStream|std::net::|reqwest/, why: "network route" },
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
  if (!fs.existsSync(CRATE)) return ["proof-runner crate missing: " + CRATE];
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-service-identity-proof-runner"/.test(toml)) errors.push("wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("does not forbid unsafe");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  // FEATURE RULE — scoped (CD-B4-PROOF-RUNNER-INTEGRATION1A-REENTRY2).
  //
  // B1 froze a BLANKET ban: the crate declared no features at all. That was correct then. The
  // authorised B4 integration adds exactly ONE non-default `test-fixtures` feature, so the blanket ban
  // is replaced by the STRONGER scoped rule below — exactly one permitted feature, empty default, no
  // live feature reachable through it — and the historical section further down proves the frozen B1
  // commit still carries the original no-feature state.
  {
    const afterFeatures = stripComments(toml).split(/^\[features\]/m)[1];
    const featBlock = afterFeatures === undefined ? "" : afterFeatures.split(/\n\[/)[0];
    if (featBlock.trim()) {
      const names = (featBlock.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) =>
        s.replace(/\s*=$/, "").trim()
      );
      for (const n of names) {
        if (n !== "test-fixtures")
          errors.push("declares an unauthorised proof-runner feature: " + n);
      }
      if (names.filter((n) => n === "test-fixtures").length > 1)
        errors.push("test-fixtures is declared more than once");
      // Default must stay empty: the fixtures may never be reachable without an explicit opt-in.
      if (/^\s*default\s*=/m.test(featBlock))
        errors.push("declares a default feature (must remain empty)");
      // The fixture expansion may enable ONLY the three prerequisite fixture features.
      const fixExpansion = (featBlock.match(/test-fixtures\s*=\s*\[[\s\S]*?\]/) || [""])[0];
      const REQUIRED_FIXTURE_EDGES = [
        "projectos-host-windows-service-identity-proof/test-fixtures",
        "projectos-host-windows-service-control/test-fixtures",
        "projectos-host-windows-local-ipc/test-fixtures",
      ];
      for (const edge of REQUIRED_FIXTURE_EDGES) {
        if (!fixExpansion.includes(edge))
          errors.push("test-fixtures does not enable the prerequisite fixture feature: " + edge);
      }
      for (const entry of fixExpansion.match(/"([^"]+)"/g) || []) {
        const value = entry.slice(1, -1);
        if (!REQUIRED_FIXTURE_EDGES.includes(value))
          errors.push("test-fixtures enables an unauthorised entry: " + value);
      }
      // No live feature may be reachable through the fixtures, and no dependency may be added by them.
      if (/windows-live-|dep:/.test(fixExpansion))
        errors.push("test-fixtures reaches a live feature or activates a dependency");
      // The orchestration must be ABSENT from the default graph.
      const libSrc = stripComments(read(path.join(SRC, "lib.rs")));
      if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*mod controller;/.test(libSrc))
        errors.push("the proof controller is not gated out of the default graph");
      if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*pub use controller::/.test(libSrc))
        errors.push("the controller surface is not gated out of the default graph");
      // No live capability producer may appear anywhere in the crate.
      for (const f of ["lib.rs", "plan.rs", "corroboration.rs", "fixture.rs", "controller.rs"]) {
        const p = path.join(SRC, f);
        if (!fs.existsSync(p)) continue;
        const code = stripComments(read(p));
        if (/fn\s+\w*\s*\([^)]*\)\s*->\s*Live\w*Capability/.test(code))
          errors.push(f + ": declares a live capability producer");
      }
    }
  }

  // HISTORICAL ACCEPTED STATE — read the FROZEN B1 commit directly, so the evolved tree cannot rewrite
  // what was accepted at closure. This commit is authoritative because it ADDED both this validator and
  // the proof-runner crate itself, and both sibling B1 validators already anchor the same hash.
  {
    const B1_COMMIT = "35d357b9901e60a677ea6fba73c10003133fa99c";
    const REL = "projectos/host/windows-service-identity-proof-runner";
    const show = (p) =>
      execFileSync("git", ["show", `${B1_COMMIT}:${p}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    let histToml = null;
    let histLib = null;
    try {
      histToml = show(`${REL}/Cargo.toml`);
      histLib = show(`${REL}/src/lib.rs`);
    } catch (e) {
      errors.push("cannot read the frozen B1 commit " + B1_COMMIT + " (historical evidence lost)");
    }
    if (histToml !== null && histLib !== null) {
      // At closure the crate declared NO features at all — the original blanket rule.
      if (/^\[features\]/m.test(histToml))
        errors.push("the frozen B1 commit already declared features (history misread)");
      if (/test-fixtures/.test(histToml))
        errors.push("the frozen B1 commit is being misreported as containing the fixture feature");
      // …and it was contract-only: no controller, no fixture orchestration, no capability producer.
      for (const p of [`${REL}/src/controller.rs`, `${REL}/src/fixture.rs`]) {
        let present = true;
        try {
          show(p);
        } catch (e) {
          present = false;
        }
        if (present) errors.push("the frozen B1 commit is misreported as containing " + p);
      }
      if (!/PROOF_RUNNER_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(histLib))
        errors.push("the frozen B1 commit was not contract-only");
      if (!/LIVE_PROOF_ORCHESTRATION_AUTHORISED:\s*bool\s*=\s*false/.test(histLib))
        errors.push("the frozen B1 commit did not keep live orchestration unauthorised");
      if (!/EXECUTION_READY:\s*bool\s*=\s*false/.test(histLib))
        errors.push("the frozen B1 commit did not keep execution readiness false");
    }
  }
  const depBody = (stripComments(toml).split(/\[dependencies\]/)[1] || "").split(/\n\[/)[0];
  const deps = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim());
  const allowed = [
    "projectos-host-windows-service-control",
    "projectos-host-windows-local-ipc",
    "projectos-host-windows-service-identity-proof",
  ];
  for (const d of deps) if (!allowed.includes(d)) errors.push("unexpected dependency: " + d);
  // Dependency direction: the runner depends on the lower crates; they must NOT depend on the runner.
  const lowerToml = [
    path.join(ROOT, "projectos", "host", "windows-service-control", "Cargo.toml"),
    path.join(ROOT, "projectos", "host", "windows-local-ipc", "Cargo.toml"),
  ];
  for (const lt of lowerToml) {
    if (fs.existsSync(lt) && /service-identity-proof-runner/.test(read(lt))) {
      errors.push("dependency cycle: a lower crate depends on the proof runner");
    }
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

  // Crate-specific proof-runner guarantees.
  const c = stripComments(read(path.join(CRATE, "src", "plan.rs")));
  if (!/AuthorityHandoverState::ServiceReady/.test(c)) errors.push("does not reuse canonical AuthorityHandoverState");
  // No SECOND handover state machine defined in this crate.
  if (/enum\s+\w*Handover\w*State/.test(c)) errors.push("defines a second handover state machine");
  if (!/IpcCorroboration/.test(c) || !/ScmCorroboration/.test(c)) errors.push("no dual IPC+SCM corroboration");
  if (!/max_cycles[\s\S]*?1\b/.test(c)) errors.push("correction cycle max is not 1");
  if (!/RollbackRequirement/.test(c) || !/required_for[\s\S]*?true/.test(c)) errors.push("rollback not always required");
  if (!/residue_is_zero|ResidueNotZero/.test(c)) errors.push("zero-residue requirement missing");
  if (!/contract_executes_windows_operation[\s\S]*?false/.test(c)) errors.push("a stage may execute a windows operation");
  const lib = read(path.join(CRATE, "src", "lib.rs"));
  if (!/PROOF_RUNNER_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib)) errors.push("missing contract-only const");
  if (!/LIVE_PROOF_ORCHESTRATION_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("live orchestration must be unauthorised");
  if (!/EXECUTION_READY:\s*bool\s*=\s*false/.test(lib)) errors.push("execution readiness not false");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-proof-runner-capability-b1] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-proof-runner-capability-b1: PASS");
}
