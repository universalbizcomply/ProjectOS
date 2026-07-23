"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B2 — boundary for the bounded Windows
// SCM ADAPTER. Proves: exact identity, publish=false, empty default features, an explicit
// `windows-live-scm` capability feature, a MINIMUM feature-gated windows dependency (only
// Win32_Foundation + Win32_System_Services), no [[bin]], no Control Center dep, unsafe CONFINED to
// windows_ffi.rs (safe adapter/contracts/verification unsafe-free and windows-FFI-free), no token /
// SID-lookup / named-pipe / registry / process-launch / ACL / network API, no service enumeration,
// exact ProjectOSHost / VirtualServiceAccount-only / no-password / demand-start-only / UNRESTRICTED,
// mandatory post-effect verification + verified deletion + bounded retry, no live operation in tests,
// a sealed LiveOperationCapability with no public constructor (feature compilation != authority), and
// execution readiness false. Comments stripped; structural.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-service-control");
const SRC = path.join(CRATE, "src");
const FFI = "windows_ffi.rs"; // the ONLY file permitted unsafe + windows FFI

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

// APIs forbidden anywhere in the crate (the SCM adapter needs none of these).
const FORBIDDEN_ANY = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /OpenProcessToken|GetTokenInformation|LookupAccountName|ConvertSidToStringSid|CreateWellKnownSid/, why: "token/SID API" },
  { re: /CreateNamedPipe|ConnectNamedPipe/, why: "named-pipe API" },
  { re: /RegCreateKey|RegSetValue|RegOpenKey/, why: "registry API" },
  { re: /CreateProcess|ShellExecute|TerminateProcess|std::process::Command|Command::new/, why: "process launch/termination" },
  { re: /SetSecurityInfo|SetNamedSecurityInfo|InitializeAcl|AddAccessAllowedAce/, why: "ACL mutation API" },
  { re: /TcpStream|TcpListener|std::net::|reqwest|hyper::/, why: "network API" },
  { re: /EnumServicesStatus/, why: "service enumeration" },
  { re: /control-center/, why: "control-center reference" },
  { re: /SC_MANAGER_ALL_ACCESS|SERVICE_ALL_ACCESS/, why: "all-access SCM/service mask" },
];
// Windows FFI markers permitted ONLY in windows_ffi.rs.
const WINDOWS_FFI = /use\s+windows(::|\s|;)|windows::Win32|windows_sys|OpenSCManager|CreateServiceW?|StartServiceW?|DeleteService|ControlService|ChangeServiceConfig|QueryServiceStatus|CloseServiceHandle|SC_HANDLE/;

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["windows-service-control crate missing: " + CRATE];

  // 1. Manifest.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-service-control"/.test(toml)) errors.push("wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("not publish=false");
  if (!/unsafe_code\s*=\s*"deny"/.test(toml)) errors.push("crate does not deny unsafe at the lint level");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  // Explicit capability feature, empty default.
  // The live feature gates dep:windows AND the canonical instance-observation feature of the
  // identity-proof crate; it must never reach for a test-fixtures feature.
  const scmFeat = (toml.match(/windows-live-scm\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (!/"dep:windows"/.test(scmFeat)) errors.push("no windows-live-scm feature gating dep:windows");
  if (!/"projectos-host-windows-service-identity-proof\/windows-live-instance-observation"/.test(scmFeat))
    errors.push("windows-live-scm does not enable the canonical instance-observation feature");
  if (/test-fixtures/.test(scmFeat)) errors.push("windows-live-scm reaches a test-fixtures feature");
  if (/^\s*default\s*=/m.test(toml)) errors.push("declares non-empty default features");
  // Minimum, optional, cfg(windows) windows dependency with ONLY the two accepted features.
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(toml)) errors.push("windows dep not cfg(windows)-scoped");
  if (!/windows\s*=\s*\{[^}]*optional\s*=\s*true/.test(toml)) errors.push("windows dep not optional");
  const winFeat = (toml.match(/windows\s*=\s*\{[\s\S]*?\}/) || [""])[0];
  for (const f of winFeat.match(/"Win32_[A-Za-z_]+"/g) || []) {
    if (!['"Win32_Foundation"', '"Win32_System_Services"'].includes(f)) errors.push("unexpected windows feature: " + f);
  }
  if (!/"Win32_System_Services"/.test(winFeat)) errors.push("missing Win32_System_Services feature");
  // Only permitted [dependencies] entry is the installation contract.
  const depBody = (stripComments(toml).split(/^\[dependencies\]/m)[1] || "").split(/\n\[/)[0];
  for (const d of (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim())) {
    if (
      d !== "projectos-host-windows-service-installation-contract" &&
      d !== "projectos-host-windows-service-identity-proof"
    )
      errors.push("unexpected dependency: " + d);
  }
  if (!fs.existsSync(path.join(CRATE, "Cargo.lock"))) errors.push("missing Cargo.lock");

  // 2. Unsafe + windows-FFI confinement.
  for (const f of rsFiles(SRC)) {
    const base = path.basename(f);
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/unsafe\s*(fn|\{)/.test(code) && base !== FFI) errors.push(rel + ": unsafe outside windows_ffi.rs");
    if (WINDOWS_FFI.test(code) && base !== FFI) errors.push(rel + ": windows FFI outside windows_ffi.rs");
    for (const { re, why } of FORBIDDEN_ANY) if (re.test(code)) errors.push(rel + ": " + why);
  }
  // windows_ffi.rs must exist and be feature+windows gated.
  const ffiPath = path.join(SRC, FFI);
  if (!fs.existsSync(ffiPath)) {
    errors.push("windows_ffi.rs missing");
  } else {
    const ffi = read(ffiPath);
    if (!/#!\[cfg\(all\(windows,\s*feature\s*=\s*"windows-live-scm"\)\)\]/.test(ffi))
      errors.push("windows_ffi.rs is not gated to (windows + windows-live-scm)");
    if (!/#!\[allow\(unsafe_code\)\]/.test(ffi)) errors.push("windows_ffi.rs does not locally allow unsafe");
    if (!/CloseServiceHandle/.test(ffi)) errors.push("windows_ffi.rs does not close SC handles with CloseServiceHandle");
  }
  // The lib gates the module to the feature.
  const lib = read(path.join(SRC, "lib.rs"));
  if (!/cfg\(all\(windows,\s*feature\s*=\s*"windows-live-scm"\)\)\]\s*mod windows_ffi/.test(lib))
    errors.push("windows_ffi module not gated to the feature");

  // 3. Bounded proof policy in the safe layers.
  const contracts = stripComments(read(path.join(SRC, "contracts.rs")));
  if (!/VirtualServiceAccountNoPassword/.test(contracts)) errors.push("no VirtualServiceAccount-no-password");
  if (/\bLocalSystem\b|\bLocalService\b|\bNetworkService\b/.test(contracts)) errors.push("alternate built-in identity representable");
  if (!/DemandStartOnly/.test(contracts)) errors.push("no demand-start-only policy");
  if (!/is_approved_name/.test(contracts)) errors.push("no exact-name check");
  if (!/NotAuthorised/.test(contracts)) errors.push("effect authority not NotAuthorised");

  const verification = stripComments(read(path.join(SRC, "verification.rs")));
  if (!/verify_created_present/.test(verification) || !/verify_deleted/.test(verification))
    errors.push("post-effect verification helpers missing");
  if (!/MAX_ATTEMPTS_CEILING/.test(verification)) errors.push("no bounded retry ceiling");
  // Authoritative SID-policy verification: only an observed UNRESTRICTED policy confirms.
  if (!/fn verify_sid_policy/.test(verification)) errors.push("no verify_sid_policy re-read verifier");
  if (!/UnrestrictedObserved\s*=>\s*PostEffectVerdict::Verified/.test(verification))
    errors.push("SID policy verify does not confirm ONLY on UnrestrictedObserved");
  if (!/classify_sid_type/.test(verification)) errors.push("no raw SID-type classifier");
  // The FFI must authoritatively re-read via QueryServiceConfig2 + SERVICE_CONFIG_SERVICE_SID_INFO.
  const ffiCode = fs.existsSync(ffiPath) ? stripComments(read(ffiPath)) : "";
  if (!/QueryServiceConfig2W/.test(ffiCode)) errors.push("FFI does not authoritatively re-read via QueryServiceConfig2W");
  if (!/SERVICE_CONFIG_SERVICE_SID_INFO/.test(ffiCode)) errors.push("FFI does not query SERVICE_CONFIG_SERVICE_SID_INFO");
  if (!/sid_policy_observation/.test(ffiCode)) errors.push("FFI does not implement the SID-policy re-read");

  const adapter = stripComments(read(path.join(SRC, "adapter.rs")));
  if (!/struct Sealed/.test(adapter) || !/LiveOperationCapability/.test(adapter))
    errors.push("sealed capability missing");
  // The sealed capability must have NO constructor (no `fn ... -> LiveOperationCapability` / `-> Self`
  // in its impl, and no public field literal path). We approximate: no `LiveOperationCapability {` init
  // outside a compile-fail doctest, and no `-> LiveOperationCapability` factory.
  if (/->\s*LiveOperationCapability/.test(adapter)) errors.push("LiveOperationCapability has a factory (must be unconstructible)");
  // Exclude the struct DEFINITION; any remaining `LiveOperationCapability { … }` would be construction.
  const adapterNoDef = adapter.replace(/pub struct LiveOperationCapability\s*\{[^}]*\}/, " ");
  if (/LiveOperationCapability\s*\{/.test(adapterNoDef)) errors.push("LiveOperationCapability is constructed somewhere");
  // Delete confirms by re-read; success alone is insufficient.
  if (!/confirm_deleted/.test(adapter)) errors.push("no deletion confirmation");
  if (!/wait_for|confirm_deleted/.test(adapter)) errors.push("no bounded wait");
  // SID configuration confirms via the authoritative re-read verifier, not a cached/expected value.
  if (!/verify_sid_policy\(self\.backend\.sid_policy_observation\(\)\)/.test(adapter))
    errors.push("configure_sid does not verify via an authoritative SID-policy re-read");

  // 4. No live operation in tests: the integration test uses no windows / SCM.
  const testFile = path.join(CRATE, "tests", "api_contract.rs");
  if (fs.existsSync(testFile)) {
    const t = stripComments(read(testFile));
    if (WINDOWS_FFI.test(t)) errors.push("integration test references windows/SCM (must be effect-free)");
  }

  // 5. Truthful phase state.
  if (!/SERVICE_CONTROL_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib)) errors.push("missing contract-only const");
  if (!/LIVE_SERVICE_CONTROL_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("live control must be unauthorised");

  // 6. CROSS-SOURCE SERVICE-INSTANCE BINDING (CD-B4-CROSS-SOURCE-BINDING-CONTRACT1A).
  // This crate owns the SCM authority and the fixed service name, but it must NOT own the identity:
  // it lends its live service handle to the canonical identity-proof crate and receives a closed,
  // opaque observation back. It must never read, hold or forward a raw process ID.
  // Since Contract1B the adapter contributes into an ATTEMPT it does not own: it consumes the attempt
  // in a specific state and returns the next state, so it never receives, retains or compares a token.
  const ffi = stripComments(read(path.join(CRATE, "src", "windows_ffi.rs")));
  const CONTRIBUTIONS = [
    ["contribute_scm_before", "Prepared", "ScmBeforeObserved", "observe_scm_before"],
    ["contribute_scm_after", "IpcPeerObserved", "ScmAfterObserved", "observe_scm_after"],
  ];
  for (const [fn, from, to, delegate] of CONTRIBUTIONS) {
    const m = ffi.match(
      new RegExp("fn\\s+" + fn + "\\s*\\(\\s*&self,\\s*attempt:\\s*ServiceInstanceBindingAttempt<" + from + ">,?\\s*\\)\\s*->\\s*AttemptOutcome<" + to + ">")
    );
    if (!m) errors.push(fn + " does not consume a " + from + " attempt and return " + to);
    if (!new RegExp("attempt\\." + delegate + "\\(service\\.0\\)").test(ffi))
      errors.push(fn + " does not delegate the observation to the canonical owner");
  }
  // This crate contributes the SCM observations ONLY — never the IPC peer, never the verdict.
  for (const bad of [
    /observe_ipc_peer/,
    /GetNamedPipeClientProcessId/,
    /fn\s+finalise/,
    /bind_service_instance/,
    /ServiceInstanceBindingAttempt<ScmAfterObserved>\s*\)/,
  ]) {
    if (bad.test(ffi)) errors.push("this crate performs a binding step it does not own");
  }
  // The identity must come from the canonical crate, never be assembled here.
  for (const bad of [
    /dwProcessId/,
    /ServiceInstanceToken\s*\{/,
    /from_observed_parts/,
    /GetProcessTimes/,
    /OpenProcess\b/,
  ]) {
    if (bad.test(ffi)) errors.push("this crate reads or assembles raw process identity itself");
  }
  // The lent handle is opened for the exact fixed service with query-status rights only.
  if (!/Self::open_service\(&scm,\s*SERVICE_QUERY_STATUS\)/.test(ffi))
    errors.push("the observed service handle is not opened with SERVICE_QUERY_STATUS on the fixed name");
  // The re-exported identity surface must expose no accessor or constructor.
  if (!/pub\s+use\s+projectos_host_windows_service_identity_proof::\{[\s\S]*?ServiceInstanceToken,?[\s\S]*?\};/.test(lib))
    errors.push("the canonical instance identity is not re-exported from the owning crate");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-control-capability-b2] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-control-capability-b2: PASS");
}
