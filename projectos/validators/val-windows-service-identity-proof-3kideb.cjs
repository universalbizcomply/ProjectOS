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
  // Unsafe is DENIED crate-wide and re-allowed ONLY in the confined instance-observation FFI module.
  if (!/unsafe_code\s*=\s*"deny"/.test(toml)) errors.push("crate does not deny unsafe in Cargo.toml lints");
  if (!/unsafe_op_in_unsafe_fn\s*=\s*"deny"/.test(toml))
    errors.push("crate does not deny unsafe_op_in_unsafe_fn");
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
  // The lock may now also carry the OPTIONAL, feature-gated instance-observation dependencies
  // (windows + the canonical handle primitive and their build-time helpers). Nothing else.
  const LOCK_ALLOWED = new Set([
    "projectos-host-windows-service-identity-proof",
    "projectos-host-authority",
    "projectos-windows-runtime-primitives",
    "proc-macro2",
    "quote",
    "syn",
    "unicode-ident",
  ]);
  for (const n of pkgNames) {
    if (!LOCK_ALLOWED.has(n) && !/^windows(-|$)/.test(n)) {
      errors.push("Cargo.lock contains an unexpected package: " + n);
    }
  }

  // 2. Source scans. Every module EXCEPT the confined instance-observation FFI must remain a pure
  // typed contract with no unsafe and no effect route; the FFI module is the single audited exception.
  const FFI_REL = "projectos/host/windows-service-identity-proof/src/instance_ffi.rs";
  const srcFiles = rsFiles(path.join(CRATE, "src"));
  let sawDeny = false;
  let sawFfi = false;
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/#!\[deny\(unsafe_code\)\]/.test(code)) sawDeny = true;
    if (/#!\[forbid\(unsafe_code\)\]/.test(code))
      errors.push(rel + ": forbid(unsafe_code) cannot coexist with the confined FFI module");
    if (rel === FFI_REL) {
      sawFfi = true;
      continue;
    }
    if (/unsafe\s*(fn|\{)/.test(code))
      errors.push(rel + ": unsafe code outside the confined FFI module");
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) errors.push(rel + ": " + why);
    }
  }
  if (!sawDeny) errors.push("lib.rs does not #![deny(unsafe_code)]");
  if (!sawFfi) errors.push("the confined instance-observation FFI module is missing");

  // 3. Redacted evidence: no raw-identity-capable field anywhere in the crate's public types.
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    // The FFI module declares no public type; its locals are covered by the opacity checks below.
    if (rel === FFI_REL) continue;
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

  // 8. CROSS-SOURCE SERVICE-INSTANCE BINDING (3K-I-D-E-C-CAPABILITY-B4-CROSS-SOURCE-BINDING-CONTRACT1A).
  // This crate is the CANONICAL owner of the opaque instance identity that ties the IPC-authenticated
  // peer to the SCM-observed service. Proves the identity is OS-derived, unforgeable by any caller,
  // process-ID-reuse resistant, and incapable of leaking raw identity.
  const instPath = path.join(CRATE, "src", "instance.rs");
  if (!fs.existsSync(instPath)) {
    errors.push("canonical service-instance module (src/instance.rs) is missing");
  } else {
    const inst = stripComments(read(instPath));

    // 8a. Ownership + internal identity components. BOTH are required: a PID-only token would be
    // defeated by process-ID reuse.
    const tokenBody = inst.match(/pub\s+struct\s+ServiceInstanceToken\s*\{([\s\S]*?)\n\}/);
    if (!tokenBody) errors.push("instance.rs does not define the canonical ServiceInstanceToken");
    else {
      if (!/\n\s*process_id:\s*u32,/.test(tokenBody[1]))
        errors.push("ServiceInstanceToken does not carry an internal process id");
      if (!/\n\s*creation_time:\s*u64,/.test(tokenBody[1]))
        errors.push("ServiceInstanceToken does not carry an internal process creation time");
      // Both components are mandatory: a PID-only token would be defeated by process-ID reuse.
      if (/\bpub\b/.test(tokenBody[1]))
        errors.push("ServiceInstanceToken exposes a public identity field");
    }

    // 8b. No caller-forgeable construction. The single constructor is crate-private and rejects a
    // missing component, so there is no PID-only fallback anywhere.
    if (!/pub\(crate\)\s+fn\s+from_observed_parts/.test(inst))
      errors.push("the token constructor is not crate-private");
    if (/pub\s+fn\s+from_observed_parts/.test(inst))
      errors.push("the token constructor is public (caller-forgeable identity)");
    for (const bad of [
      /pub\s+fn\s+from_pid/,
      /pub\s+fn\s+from_raw/,
      /pub\s+fn\s+new\s*\(\s*process_id/,
      /pub\s+fn\s+new\s*\(\s*pid/,
      /impl\s+Default\s+for\s+ServiceInstanceToken/,
    ]) {
      if (bad.test(inst)) errors.push("ServiceInstanceToken has a forbidden public constructor");
    }
    if (!/if\s+process_id\s*==\s*0\s*\|\|\s*creation_time\s*==\s*0/.test(inst))
      errors.push("the token constructor does not fail closed on a missing identity component");

    // 8c. No raw accessor, no Display, no serialisation, no fingerprint.
    for (const bad of [
      /fn\s+process_id\s*\(&self\)/,
      /fn\s+creation_time\s*\(&self\)/,
      /fn\s+pid\s*\(&self\)/,
      /fn\s+into_inner\s*\(/,
      /fn\s+as_parts\s*\(/,
      /fn\s+as_u64\s*\(/,
    ]) {
      if (bad.test(inst)) errors.push("ServiceInstanceToken exposes a raw identity accessor");
    }
    if (/impl\s+fmt::Display\s+for\s+ServiceInstanceToken|impl\s+std::fmt::Display\s+for\s+ServiceInstanceToken/.test(inst))
      errors.push("ServiceInstanceToken implements Display");
    if (/Serialize|Deserialize|serde/.test(inst))
      errors.push("instance.rs references serialisation");
    // Debug must be a hand-written redaction, never derived. The check is scoped to the impl body so a
    // matching string elsewhere in the file (e.g. a test expectation) cannot satisfy it, and the body
    // must not read either identity component — a hash, prefix or fingerprint is also a leak.
    const dbg = inst.match(/impl\s+fmt::Debug\s+for\s+ServiceInstanceToken\s*\{([\s\S]*?)\n\}/);
    if (!dbg) errors.push("ServiceInstanceToken does not implement a redacted Debug");
    else {
      if (!/ServiceInstanceToken\(\[REDACTED\]\)/.test(dbg[1]))
        errors.push("ServiceInstanceToken Debug output is not redacted");
      if (/self\.process_id|self\.creation_time/.test(dbg[1]))
        errors.push("ServiceInstanceToken Debug reads a raw identity component");
    }
    // Identity components may be read ONLY where the token is built or compared.
    const strayReads = (inst.match(/self\.process_id|self\.creation_time/g) || []).length;
    if (strayReads > 0)
      errors.push("an identity component is read outside token construction (" + strayReads + " site(s))");
    const tokenDerive = inst.match(/#\[derive\(([^)]*)\)\]\s*pub\s+struct\s+ServiceInstanceToken/);
    if (!tokenDerive) errors.push("ServiceInstanceToken has no derive attribute to inspect");
    else if (/Debug|Hash|Serialize|Deserialize/.test(tokenDerive[1]))
      errors.push("ServiceInstanceToken derives a forbidden trait: " + tokenDerive[1]);

    // 8d. Closed binding decision, decided ONLY from observations.
    for (const v of [
      "Match",
      "Mismatch",
      "MissingIpcObservation",
      "MissingScmObservation",
      "Stale",
      "Ambiguous",
      "Unsupported",
    ]) {
      if (!new RegExp("\\n\\s*" + v + ",").test(inst))
        errors.push("ServiceInstanceBinding is missing the " + v + " variant");
    }
    // Since Contract1B the free-standing comparison is CRATE-PRIVATE: three separately-obtained
    // identities could otherwise be retained and recombined across proof attempts.
    const bindSig = inst.match(/pub\(crate\)\s+fn\s+bind_service_instance\s*\(([\s\S]*?)\)\s*->/);
    if (/pub\s+fn\s+bind_service_instance/.test(inst))
      errors.push("a free-standing PUBLIC comparison API remains (replayable positive path)");
    if (!bindSig) errors.push("the crate-private comparison bind_service_instance is missing");
    else {
      const params = bindSig[1];
      if ((params.match(/&ServiceInstanceObservation/g) || []).length !== 3)
        errors.push("bind_service_instance does not compare exactly three observations");
      if (/expected|u32|u64|&str|String/.test(params))
        errors.push("bind_service_instance accepts a caller-supplied expected value");
    }
    // Freshness: the SCM instance must be stable across the window BEFORE the peer is compared.
    if (!/if\s+before\s*!=\s*after\s*\{[\s\S]{0,120}Stale/.test(inst))
      errors.push("bind_service_instance does not reject a changed SCM instance as Stale");

    // 8e. Sealed, unconstructible observation capability.
    if (!/pub\s+struct\s+LiveInstanceObservationCapability\s*\{\s*_sealed:\s*Sealed,?\s*\}/.test(inst))
      errors.push("LiveInstanceObservationCapability is not sealed by a private marker");
    if (/fn\s+[a-z_]*\s*\([^)]*\)\s*->\s*LiveInstanceObservationCapability/.test(inst))
      errors.push("LiveInstanceObservationCapability has a constructor");
    if (/LiveInstanceObservationCapability\s*\{\s*_sealed:\s*Sealed\s*\}/.test(inst))
      errors.push("LiveInstanceObservationCapability is constructed somewhere");
  }

  // 8f. The confined OS observation FFI.
  const ffiPath = path.join(CRATE, "src", "instance_ffi.rs");
  if (!fs.existsSync(ffiPath)) {
    errors.push("instance_ffi.rs is missing");
  } else {
    const ffi = stripComments(read(ffiPath));
    if (!/#!\[cfg\(all\(windows,\s*feature\s*=\s*"windows-live-instance-observation"\)\)\]/.test(ffi))
      errors.push("instance_ffi.rs is not gated on windows + the observation feature");
    if (!/#!\[allow\(unsafe_code\)\]/.test(ffi))
      errors.push("instance_ffi.rs does not locally re-allow unsafe");

    // Correct pipe SIDE: this process owns the SERVER, so the peer is the CLIENT.
    if (!/GetNamedPipeClientProcessId/.test(ffi))
      errors.push("pipe peer identity is not read with GetNamedPipeClientProcessId");
    if (/GetNamedPipeServerProcessId/.test(ffi))
      errors.push("pipe observation queries the wrong side of the pipe");
    // The peer must be re-read after capture (stability), i.e. at least two reads.
    if ((ffi.match(/client_process_id\(/g) || []).length < 3)
      errors.push("the pipe peer is not re-read after the identity capture");

    // SCM: SERVICE_STATUS_PROCESS, running-only, own-process required, observed twice.
    if (!/QueryServiceStatusEx/.test(ffi) || !/SERVICE_STATUS_PROCESS/.test(ffi))
      errors.push("service identity is not read from SERVICE_STATUS_PROCESS");
    if (!/SERVICE_RUNNING/.test(ffi)) errors.push("the running state is not required");
    for (const bad of [/SERVICE_START_PENDING/, /SERVICE_STOP_PENDING/, /SERVICE_STOPPED/]) {
      if (bad.test(ffi)) errors.push("a non-running service state is referenced by the observation");
    }
    // Own-process is not merely referenced: BOTH observations must mask-test the service type, so a
    // shared-process service can never be pinned to a single instance.
    if (!/SERVICE_WIN32_OWN_PROCESS/.test(ffi))
      errors.push("the dedicated own-process requirement is not enforced");
    const ownTests = (ffi.match(/&\s*own_process\s*==\s*own_process/g) || []).length;
    if (ownTests < 2)
      errors.push("the own-process service type is not verified at both observations");
    if (!/first_own_process\s*=/.test(ffi) || !/second_own_process\s*=/.test(ffi))
      errors.push("the own-process fact is not established at both observations");
    if ((ffi.match(/query_status\(/g) || []).length < 3)
      errors.push("the SCM status is not observed both before and after the identity capture");

    // Process creation time via the MINIMUM query access; never elevation, never a PID-only fallback.
    // The creation time must come from a real OS call whose result actually reaches the facts — a
    // renamed or dropped call must not leave a PID-only identity behind.
    if (!/\bGetProcessTimes\s*\(/.test(ffi))
      errors.push("process creation time is not obtained from an OS query");
    if (!/fn\s+process_creation_time\s*\([\s\S]*?\bGetProcessTimes\s*\(/.test(ffi))
      errors.push("the creation-time helper does not call GetProcessTimes");
    if ((ffi.match(/creation_time\s*=\s*unsafe\s*\{\s*process_creation_time\(/g) || []).length < 2)
      errors.push("an observation path does not populate the creation time from the OS query");
    if (!/PROCESS_QUERY_LIMITED_INFORMATION/.test(ffi))
      errors.push("the process is not opened with the minimum query access");
    for (const bad of [
      /PROCESS_ALL_ACCESS/,
      /PROCESS_VM_READ/,
      /SeDebugPrivilege/,
      /AdjustTokenPrivileges/,
      /OpenProcessToken/,
      /GetTokenInformation/,
    ]) {
      if (bad.test(ffi)) errors.push("the observation escalates beyond the minimum query access");
    }
    // Deterministic handle cleanup through the canonical RAII primitive (no manual CloseHandle).
    if (!/projectos_windows_runtime_primitives::handles::\{\s*adopt,\s*win32\s*\}/.test(ffi))
      errors.push("the temporary process handle is not adopted into the canonical RAII primitive");
    if (/CloseHandle/.test(ffi))
      errors.push("instance_ffi.rs closes a handle manually instead of via RAII");
    // Since Contract1B the raw observations are CRATE-PRIVATE. The only public route is an attempt
    // transition, so no caller can obtain a free-standing observation to retain and recombine.
    for (const fn of ["observe_named_pipe_peer_instance", "observe_running_service_instance"]) {
      if (!new RegExp("pub\\(crate\\)\\s+unsafe\\s+fn\\s+" + fn).test(ffi))
        errors.push(fn + " is missing or is not a crate-private unsafe fn");
      if (new RegExp("pub\\s+unsafe\\s+fn\\s+" + fn).test(ffi))
        errors.push(fn + " is publicly reachable outside an attempt");
    }
    // Each attempt transition consumes the attempt (takes `self`) and returns the next state.
    const TRANSITIONS = [
      ["observe_scm_before", "Prepared", "ScmBeforeObserved"],
      ["observe_ipc_peer", "ScmBeforeObserved", "IpcPeerObserved"],
      ["observe_scm_after", "IpcPeerObserved", "ScmAfterObserved"],
    ];
    for (const [fn, from, to] of TRANSITIONS) {
      const impl = ffi.match(
        new RegExp("impl\\s+ServiceInstanceBindingAttempt<" + from + ">\\s*\\{([\\s\\S]*?)\\n\\}")
      );
      if (!impl) errors.push("no attempt transition is defined from " + from);
      else {
        const m = impl[1].match(new RegExp("pub\\s+unsafe\\s+fn\\s+" + fn + "\\s*\\(\\s*self,([\\s\\S]*?)\\)\\s*->\\s*AttemptOutcome<" + to + ">"));
        if (!m) errors.push(fn + " does not consume the attempt and advance " + from + " -> " + to);
      }
    }
    // Effect routes that must never appear even in the audited FFI module.
    for (const bad of [
      { re: /CreateServiceW|DeleteService|StartServiceW|ControlService|ChangeServiceConfig/, why: "SCM mutation" },
      { re: /CreateNamedPipe|CreateFileW|WriteFile/, why: "pipe creation/write" },
      { re: /RegCreateKey|RegSetValue/, why: "registry route" },
      { re: /ProgramData|SetNamedSecurityInfo/, why: "ProgramData/ACL route" },
      { re: /Command::new|CreateProcess|TerminateProcess/, why: "process launch/terminate" },
      { re: /TcpStream|std::net::/, why: "network route" },
    ]) {
      if (bad.re.test(ffi)) errors.push("instance_ffi.rs contains a forbidden " + bad.why);
    }
  }

  // 8g. Feature isolation: default stays effect-free; the observation feature is opt-in and pulls the
  // windows dependency only as an OPTIONAL, target-gated dependency.
  if (!/windows-live-instance-observation\s*=\s*\[/.test(toml))
    errors.push("the observation feature is not declared");
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(toml))
    errors.push("the windows dependency is not target-gated");
  if (!/windows\s*=\s*\{[^}]*optional\s*=\s*true/.test(toml))
    errors.push("the windows dependency is not optional");
  if (!/projectos-windows-runtime-primitives\s*=\s*\{[^}]*optional\s*=\s*true/.test(toml))
    errors.push("the runtime-primitives dependency is not optional");
  for (const forbiddenFeature of [
    "Win32_Security_Authorization",
    "Win32_System_Registry",
    "Win32_Networking",
  ]) {
    if (toml.includes(forbiddenFeature))
      errors.push("the windows dependency enables a forbidden feature: " + forbiddenFeature);
  }
  // The default build must have no path to an observation.
  const libSrc = stripComments(read(path.join(CRATE, "src", "lib.rs")));
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"windows-live-instance-observation"\)\)\]\s*mod\s+instance_ffi;/.test(libSrc))
    errors.push("the FFI module is not feature-gated in lib.rs");
  if (/pub\s+use\s+instance_ffi::/.test(libSrc))
    errors.push("raw observation entry points are re-exported (must be reachable only via an attempt)");
  if (/pub\s+use\s+instance::\{[^}]*bind_service_instance/.test(libSrc))
    errors.push("the free-standing comparison is re-exported");
  if (!/#\[cfg\(any\(test,\s*all\(windows,\s*feature\s*=\s*"windows-live-instance-observation"\)\)\)\]\s*pub\s+use\s+instance::\{[\s\S]*?ServiceInstanceBindingAttempt/.test(libSrc))
    errors.push("the attempt surface is not gated to builds where an observation could occur");

  // 8i. ATTEMPT-SCOPED BINDING (Contract1B). Equality between three separately-obtained identities is
  // not a proof: such values could be retained and recombined across attempts. The binding must be a
  // bounded, ordered, consumable attempt that owns its observations.
  if (fs.existsSync(instPath)) {
    const inst = stripComments(read(instPath));

    // The opaque attempt type: no Clone, no Copy, no serialisation, redacted Debug, private contents.
    const attemptDecl = inst.match(/(#\[derive\([^)]*\)\]\s*)?pub struct ServiceInstanceBindingAttempt<S>\s*\{([\s\S]*?)\n\}/);
    if (!attemptDecl) errors.push("the opaque ServiceInstanceBindingAttempt is missing");
    else {
      if (attemptDecl[1]) errors.push("ServiceInstanceBindingAttempt derives traits (must be opaque)");
      if (/\bpub\b/.test(attemptDecl[2]))
        errors.push("ServiceInstanceBindingAttempt exposes a public field");
    }
    for (const bad of [
      /impl<S>\s+Clone\s+for\s+ServiceInstanceBindingAttempt/,
      /impl<S>\s+Copy\s+for\s+ServiceInstanceBindingAttempt/,
      /derive\([^)]*\)\]\s*pub struct ServiceInstanceBindingAttempt/,
    ]) {
      if (bad.test(inst)) errors.push("ServiceInstanceBindingAttempt is Clone/Copy or derived");
    }
    if (!/impl<S>\s+fmt::Debug\s+for\s+ServiceInstanceBindingAttempt<S>/.test(inst))
      errors.push("ServiceInstanceBindingAttempt has no redacted Debug");
    if (!/ServiceInstanceBindingAttempt\(\[REDACTED\]\)/.test(inst))
      errors.push("ServiceInstanceBindingAttempt Debug is not redacted");

    // begin() demands the sealed capability; no Default, no caller-supplied clock/timestamp/identifier.
    const begin = inst.match(/pub\s+fn\s+begin\s*\(([\s\S]*?)\)\s*->\s*Self/);
    if (!begin) errors.push("ServiceInstanceBindingAttempt::begin is missing");
    else {
      if (!/&LiveInstanceObservationCapability/.test(begin[1]))
        errors.push("begin does not demand the sealed observation capability");
      if (/u64|u32|Instant|Duration|millis|timestamp|deadline/i.test(begin[1]))
        errors.push("begin accepts a caller-supplied time, deadline or identifier");
    }
    if (/impl\s+Default\s+for\s+ServiceInstanceBindingAttempt/.test(inst))
      errors.push("ServiceInstanceBindingAttempt has a Default constructor");
    // The test-only entry point must be crate-private AND cfg(test).
    if (/pub\s+fn\s+begin_for_test/.test(inst))
      errors.push("the test attempt constructor is public");
    if (!/#\[cfg\(test\)\]\s*pub\(crate\)\s+fn\s+begin_for_test/.test(inst))
      errors.push("the test attempt constructor is not cfg(test) + crate-private");

    // Type-state ordering: uninhabited markers, and each record_* consumes self from exactly one state.
    for (const st of ["Prepared", "ScmBeforeObserved", "IpcPeerObserved", "ScmAfterObserved"]) {
      if (!new RegExp("pub enum " + st + " \\{\\}").test(inst))
        errors.push("the " + st + " state marker is not an uninhabited type");
    }
    const ORDER = [
      ["Prepared", "record_scm_before", "ScmBeforeObserved"],
      ["ScmBeforeObserved", "record_ipc_peer", "IpcPeerObserved"],
      ["IpcPeerObserved", "record_scm_after", "ScmAfterObserved"],
    ];
    for (const [from, fn, to] of ORDER) {
      const block = inst.match(
        new RegExp("impl\\s+ServiceInstanceBindingAttempt<" + from + ">\\s*\\{([\\s\\S]*?)\\n\\}")
      );
      if (!block) errors.push("no attempt state block for " + from);
      else {
        const m = block[1].match(
          new RegExp("fn\\s+" + fn + "\\s*\\(\\s*mut self,([\\s\\S]*?)\\)\\s*->\\s*AttemptOutcome<" + to + ">")
        );
        if (!m) errors.push(fn + " does not consume the attempt and advance " + from + " -> " + to);
        if (block[1].includes("fn finalise")) errors.push(from + " can finalise (skips observations)");
      }
    }
    // Finalisation is legal ONLY from the last state and CONSUMES the attempt.
    const finalBlock = inst.match(/impl\s+ServiceInstanceBindingAttempt<ScmAfterObserved>\s*\{([\s\S]*?)\n\}/);
    if (!finalBlock) errors.push("no finalisation state block");
    else if (!/pub\s+fn\s+finalise\s*\(\s*self\s*\)\s*->\s*ServiceInstanceBinding/.test(finalBlock[1]))
      errors.push("finalise does not consume the attempt or does not return the closed verdict");
    if (/fn\s+finalise\s*\(\s*&/.test(inst))
      errors.push("finalise borrows instead of consuming (attempt could be finalised twice)");

    // Observations are OWNED by the attempt and never handed back.
    const innerDecl = inst.match(/struct AttemptInner\s*\{([\s\S]*?)\n\}/);
    if (!innerDecl) errors.push("the attempt has no private observation store");
    else {
      for (const f of ["scm_before", "ipc_peer", "scm_after", "clock"]) {
        if (!new RegExp("\\n\\s*" + f + ":").test(innerDecl[1]))
          errors.push("the attempt does not retain " + f + " internally");
      }
      if (/\bpub\b/.test(innerDecl[1])) errors.push("the attempt's observation store is public");
    }
    // No PUBLIC route hands a stored observation back; an internal helper is fine, escaping is not.
    for (const bad of [
      /pub\s+fn\s+\w*token\w*\s*\(/,
      /pub\s+fn\s+into_observations\s*\(/,
      /pub\s+fn\s+scm_before\s*\(/,
      /pub\s+fn\s+ipc_peer\s*\(/,
      /pub\s+fn\s+scm_after\s*\(/,
      /pub\(crate\)\s+fn\s+\w*token\w*\s*\(/,
    ]) {
      if (bad.test(inst)) errors.push("the attempt returns a stored observation to the caller");
    }
    // The only public results are the next state and the closed verdict.
    const outcome = inst.match(/pub enum AttemptOutcome<S>\s*\{([\s\S]*?)\n\}/);
    if (!outcome) errors.push("AttemptOutcome is missing");
    else if (!/Continue\(ServiceInstanceBindingAttempt<S>\)/.test(outcome[1]) || !/Refused\(ServiceInstanceBinding\)/.test(outcome[1]))
      errors.push("AttemptOutcome does not carry exactly the next state or the closed verdict");
    if (/->\s*bool\s*\{[\s\S]{0,80}finalise/.test(inst))
      errors.push("a bool is returned as a binding result");

    // Bounded freshness from an internal MONOTONIC source; expiry fails closed at every step.
    if (!/const MAX_OBSERVATION_WINDOW_MILLIS:\s*u64\s*=/.test(inst))
      errors.push("no bounded observation window is defined");
    if (!/Monotonic\(std::time::Instant\)/.test(inst))
      errors.push("the attempt's production clock is not a monotonic Instant");
    for (const bad of [/SystemTime/, /UNIX_EPOCH/, /Utc::now/, /chrono/]) {
      if (bad.test(inst)) errors.push("the attempt depends on wall-clock time");
    }
    if (!/fn\s+expiry\(&self\)\s*->\s*Option<ServiceInstanceBinding>/.test(inst))
      errors.push("the attempt has no closed expiry check");
    if (!/ServiceInstanceBinding::ObservationWindowExpired/.test(inst))
      errors.push("expiry does not produce ObservationWindowExpired");
    // EVERY transition must check the window itself — a global count would let one be removed while
    // the others still satisfy a threshold.
    for (const [, fn] of ORDER) {
      const body = inst.match(new RegExp("fn\\s+" + fn + "\\s*\\([\\s\\S]*?\\n    \\}"));
      if (!body) errors.push("cannot inspect the body of " + fn);
      else if (!/if let Some\(expired\) = self\.inner\.expiry\(\)/.test(body[0]))
        errors.push(fn + " does not check the observation window");
    }
    if (!/pub\s+fn\s+finalise[\s\S]{0,200}self\.inner\.expiry\(\)/.test(inst))
      errors.push("finalisation does not re-check the observation window");
    if (/thread::sleep|std::thread::sleep/.test(inst)) errors.push("the attempt sleeps");

    // Closed Contract1B verdicts.
    for (const v of [
      "WrongObservationOrder",
      "DuplicateObservation",
      "CrossAttemptObservation",
      "ObservationWindowExpired",
      "AlreadyFinalised",
      "CapabilityUnavailable",
      "UnexpectedFailure",
    ]) {
      if (!new RegExp("\\n\\s*" + v + ",").test(inst))
        errors.push("ServiceInstanceBinding is missing the " + v + " verdict");
    }

    // Cross-attempt and replay coverage must be exercised by tests.
    for (const t of [
      "observations_from_two_attempts_are_kept_apart",
      "a_prior_attempts_identity_cannot_complete_a_new_attempt",
      "an_attempt_never_yields_its_observations",
      "a_clock_rollback_cannot_revive_an_expired_attempt",
      "expiry_after_the_last_observation_but_before_finalise_is_refused",
    ]) {
      if (!inst.includes(t)) errors.push("missing attempt-scoping test: " + t);
    }
  }

  // 8h. Tests must never touch a live OS object.
  const testFiles = rsFiles(path.join(CRATE, "tests"));
  for (const f of testFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    for (const bad of [
      /GetNamedPipeClientProcessId/,
      /QueryServiceStatusEx/,
      /OpenProcess/,
      /GetProcessTimes/,
      /Command::new/,
      /thread::sleep/,
    ]) {
      if (bad.test(code)) errors.push(rel + ": a test invokes a live OS operation");
    }
  }

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
