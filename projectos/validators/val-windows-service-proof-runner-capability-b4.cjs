"use strict";
// CD-B4-PROOF-RUNNER-INTEGRATION1A-REENTRY2 — boundary for the compile-only proof-runner orchestration.
//
// Proves the runner OWNS the proof and the dependencies own identity: the binding verdict is consumed
// internally and mapped into proof-runner vocabulary; the orchestration runs through the SIBLING
// FAÇADES rather than identity-proof transitions; the ServiceFixture stays compile-only; and a positive
// result requires shutdown acknowledgement, disconnect and exactly Zero residue on top of a Match.
//
// It also proves the runner cannot become a live proof: no binary, no Win32, no fixture surface in the
// default graph, and the frozen truthful constants unchanged.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-service-identity-proof-runner");
const SRC = path.join(CRATE, "src");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
// A forbidden NAME inside a string literal is a redaction assertion ("this must not leak"), not a use
// of the API. Strip literals before the bypass scan so proving absence never trips the check.
function stripStrings(src) {
  return src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

// The runner orchestrates; it must never perform an OS operation itself.
const FORBIDDEN_ANY = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /use\s+windows(::|\s|;)|windows::Win32|windows_sys/, why: "windows API reference" },
  { re: /extern\s+"system"|extern\s+"C"/, why: "extern FFI" },
  { re: /unsafe\s*(fn|\{)/, why: "unsafe code" },
  { re: /OpenSCManagerW?\s*\(|QueryServiceStatusEx\s*\(|CreateServiceW\s*\(|StartServiceW\s*\(|ControlService\s*\(/, why: "SCM API call" },
  { re: /CreateNamedPipeW?\s*\(|ConnectNamedPipe\s*\(|CreateFileW\s*\(/, why: "named-pipe API call" },
  { re: /OpenProcess\b|GetProcessTimes|GetNamedPipeClientProcessId/, why: "process/peer identity API" },
  { re: /CreateProcess|ShellExecute|std::process|Command::new/, why: "process launch" },
  { re: /RegCreateKey|RegSetValue|ProgramData|SetNamedSecurityInfo/, why: "registry/ProgramData/ACL" },
  { re: /TcpStream|TcpListener|std::net::|reqwest|hyper::/, why: "network API" },
  { re: /thread::sleep/, why: "sleep" },
];

// The runner must never reach around the façades into identity-proof transitions or raw identity.
const FORBIDDEN_BYPASS = [
  { re: /record_scm_before|record_ipc_peer|record_scm_after/, why: "direct identity-proof transition" },
  { re: /synthetic_observation|SyntheticInstanceSelector/, why: "direct synthetic observation" },
  { re: /from_observed_parts|ServiceInstanceToken/, why: "raw token surface" },
  { re: /windows_ffi/, why: "dependency FFI module" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["proof-runner crate missing: " + CRATE];

  // 1. Manifest: explicit non-default fixture feature, no binary, no new dependency.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-service-identity-proof-runner"/.test(toml))
    errors.push("wrong package name");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("crate no longer forbids unsafe");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  if (fs.existsSync(path.join(SRC, "main.rs"))) errors.push("has a main.rs");
  const fixFeat = (toml.match(/test-fixtures\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (!fixFeat) errors.push("no explicit test-fixtures feature");
  for (const sibling of [
    "projectos-host-windows-service-identity-proof/test-fixtures",
    "projectos-host-windows-service-control/test-fixtures",
    "projectos-host-windows-local-ipc/test-fixtures",
  ]) {
    if (!fixFeat.includes(sibling)) errors.push("test-fixtures does not enable " + sibling);
  }
  if (/windows-live-scm|windows-live-ipc|windows-live-instance-observation/.test(fixFeat))
    errors.push("test-fixtures enables a live feature");
  if (/^\s*default\s*=\s*\[[^\]]*test-fixtures/m.test(toml))
    errors.push("a default feature enables the fixtures");
  // Dependency set unchanged: exactly the three capability crates.
  const depBody = (stripComments(toml).split(/^\[dependencies\]/m)[1] || "").split(/\n\[/)[0];
  const deps = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) =>
    s.replace(/\s*=$/, "").trim()
  );
  const EXPECTED = [
    "projectos-host-windows-service-control",
    "projectos-host-windows-local-ipc",
    "projectos-host-windows-service-identity-proof",
  ];
  for (const d of deps) if (!EXPECTED.includes(d)) errors.push("unexpected dependency: " + d);
  for (const d of EXPECTED) if (!deps.includes(d)) errors.push("missing dependency: " + d);

  // 2. No OS operation anywhere in the crate; no façade bypass.
  for (const f of ["lib.rs", "plan.rs", "corroboration.rs", "fixture.rs", "controller.rs"]) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) {
      if (f !== "controller.rs" && f !== "fixture.rs" && f !== "corroboration.rs")
        errors.push("missing source file: " + f);
      continue;
    }
    const code = stripComments(read(p));
    for (const { re, why } of FORBIDDEN_ANY) if (re.test(code)) errors.push(f + ": " + why);
    // The controller may NAME the façades but must not reach past them.
    const bypassScan = stripStrings(code);
    for (const { re, why } of FORBIDDEN_BYPASS)
      if (re.test(bypassScan)) errors.push(f + ": " + why);
  }

  // 3. The frozen 19-stage plan is REUSED, not replaced.
  const plan = stripComments(read(path.join(SRC, "plan.rs")));
  if (!/pub enum ProofStage/.test(plan)) errors.push("ProofStage is missing");
  if (!/pub fn sequence\(\)/.test(plan)) errors.push("the frozen stage sequence is missing");

  // 4. Proof-runner-owned evidence vocabulary; the dependency verdict is mapped, never re-exported.
  const corr = stripComments(read(path.join(SRC, "corroboration.rs")));
  if (!/pub\(crate\) fn map_binding/.test(corr))
    errors.push("the binding mapping is not crate-private (a caller could supply the conclusion)");
  if (/pub fn map_binding/.test(corr)) errors.push("the binding mapping is public");
  for (const state of [
    "SameInstanceCorroborationConfirmed",
    "ServiceInstanceMismatch",
    "IpcInstanceEvidenceMissing",
    "ScmInstanceEvidenceMissing",
    "InstanceEvidenceStale",
    "ServiceInstanceAmbiguous",
    "InstanceBindingUnsupported",
    "CapabilityUnavailable",
    "InvalidProofSequence",
  ]) {
    if (!corr.includes(state)) errors.push("missing proof-runner state: " + state);
  }
  // Only Match may confirm.
  if (!/ServiceInstanceBinding::Match => InstanceCorroboration::SameInstanceCorroborationConfirmed/.test(corr))
    errors.push("Match is not the sole confirming mapping");
  // Stale and an expired window are one class; both must refuse.
  if (!/Stale \| ServiceInstanceBinding::ObservationWindowExpired/.test(corr))
    errors.push("stale and expired-window are not both mapped to InstanceEvidenceStale");
  // No wildcard: a new dependency verdict must break the build, not map to a default.
  if (/_\s*=>\s*InstanceCorroboration/.test(corr))
    errors.push("a wildcard mapping could silently absorb a new dependency verdict");
  const lib = stripComments(read(path.join(SRC, "lib.rs")));
  if (/pub use .*ServiceInstanceBinding/.test(lib))
    errors.push("the dependency binding enum is re-exported as proof-runner evidence");
  if (/pub use .*ServiceInstanceToken/.test(lib))
    errors.push("the dependency token is re-exported");

  // 5. The controller: fixture-gated, façade-driven, one positive path.
  const ctlPath = path.join(SRC, "controller.rs");
  if (!fs.existsSync(ctlPath)) {
    errors.push("the proof controller is missing");
  } else {
    const ctl = stripComments(read(ctlPath));
    if (!/#!\[cfg\(feature = "test-fixtures"\)\]/.test(ctl))
      errors.push("the controller is not gated to the fixture graph");
    // Sibling façades, in the required order.
    const order = [
      "sc::contribute_scm_before",
      "ipc::run_fixture_handshake",
      "contributor.contribute_ipc_peer",
      "sc::contribute_scm_after",
      "attempt.finalise()",
    ];
    let cursor = -1;
    for (const step of order) {
      const at = ctl.indexOf(step);
      if (at < 0) errors.push("the controller does not use " + step);
      else if (at < cursor) errors.push("the controller calls " + step + " out of order");
      else cursor = at;
    }
    // The confirmation must be obtained from the transition, never asserted.
    if (!/into_confirmed\(\)/.test(ctl))
      errors.push("the controller does not take the confirmation from the handshake transition");
    if (/handshake_confirmed\s*:\s*bool|confirmed\s*:\s*bool/.test(ctl))
      errors.push("the controller accepts a caller-asserted handshake boolean");
    // The request must be unable to carry evidence.
    if (!/pub struct CompileOnlyProofRequest\s*\{\s*_private: \(\),?\s*\}/.test(ctl))
      errors.push("the proof request can carry caller-supplied fields");
    // Shutdown, disconnect and residue are all required AFTER corroboration.
    const finalise = ctl.indexOf("attempt.finalise()");
    for (const [needle, why] of [
      ["request_shutdown()", "shutdown"],
      ["disconnected()", "disconnect"],
      ["classify_residue().is_zero()", "zero residue"],
    ]) {
      const at = ctl.indexOf(needle);
      if (at < 0) errors.push("the controller does not require " + why);
      else if (at < finalise) errors.push(why + " is checked before corroboration");
    }
    for (const r of [
      "ShutdownNotAcknowledged",
      "DisconnectNotCompleted",
      "ResidueNonZero",
    ]) {
      if (!ctl.includes(r)) errors.push("the controller cannot refuse with " + r);
    }
    // Exactly one positive return.
    const positives = (ctl.match(/CompileOnlyProofOutcome::CompileOnlySameInstanceCorroborated/g) || [])
      .length;
    if (positives < 1) errors.push("no positive outcome exists");
    // The positive name must not imply a live proof.
    for (const bad of [
      /LiveProofConfirmed/,
      /ServiceAuthorityConfirmed/,
      /TrustedProductionService/,
      /ProductionReady/,
      /InstallationReady/,
    ]) {
      if (bad.test(ctl) || bad.test(lib)) errors.push("an outcome name overstates the proof");
    }
  }

  // 6. The ServiceFixture stays compile-only and cannot assert a handshake.
  const fixPath = path.join(SRC, "fixture.rs");
  if (!fs.existsSync(fixPath)) {
    errors.push("the compile-only ServiceFixture is missing");
  } else {
    const fix = stripComments(read(fixPath));
    if (/ConfirmedIpcPeerHandshake|is_peer_confirmed/.test(fix))
      errors.push("the fixture participates in handshake confirmation");
    for (const residue of [
      "Zero",
      "PendingIo",
      "QuarantinedIo",
      "QuarantineReserved",
      "QuarantineOccupied",
      "Indeterminate",
    ]) {
      if (!fix.includes(residue)) errors.push("the fixture cannot model residue: " + residue);
    }
    if (!/matches!\(self, Self::Zero\)/.test(fix))
      errors.push("residue cleanliness is not restricted to exactly Zero");
  }

  // 7. The default graph exposes no orchestration, and the truthful constants are unchanged.
  if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*mod controller;/.test(lib))
    errors.push("the controller module is not fixture-gated in lib.rs");
  if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*pub use controller::/.test(lib))
    errors.push("the controller surface is not fixture-gated in lib.rs");
  for (const [re, why] of [
    [/PROOF_RUNNER_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/, "contract-only"],
    [/LIVE_PROOF_ORCHESTRATION_AUTHORISED:\s*bool\s*=\s*false/, "live orchestration unauthorised"],
    [/EXECUTION_READY:\s*bool\s*=\s*false/, "execution readiness false"],
  ]) {
    if (!re.test(lib)) errors.push("the truthful constant changed: " + why);
  }

  // 8. Tests must not reach past the façades or touch the OS.
  const testPath = path.join(CRATE, "tests", "fixture_orchestration.rs");
  if (!fs.existsSync(testPath)) {
    errors.push("the external orchestration test is missing");
  } else {
    const t = stripComments(read(testPath));
    for (const { re, why } of FORBIDDEN_ANY) if (re.test(t)) errors.push("test: " + why);
    const tScan = stripStrings(t);
    for (const { re, why } of FORBIDDEN_BYPASS)
      if (re.test(tScan)) errors.push("test: " + why);
    if (!/CompileOnlySameInstanceCorroborated/.test(t))
      errors.push("the test does not prove the positive compile-only outcome");
    for (const r of ["ShutdownNotAcknowledged", "DisconnectNotCompleted", "ResidueNonZero"]) {
      if (!t.includes(r)) errors.push("the test does not prove refusal: " + r);
    }
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-proof-runner-capability-b4] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-proof-runner-capability-b4: PASS");
}
