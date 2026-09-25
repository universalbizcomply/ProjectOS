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
const { execFileSync } = require("child_process");
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
/**
 * Whitespace collapsed onto one line, so a check cannot be defeated by where rustfmt happens to
 * wrap. Any pattern using this must bound itself (e.g. `[^{;]`) rather than relying on newlines.
 */
function flatten(src) {
  return src.replace(/\s+/g, " ");
}

/**
 * The inside of the `{ .. }` that follows `header`, by BRACE BALANCING rather than by splitting on
 * the first newline-plus-close-brace.
 *
 * `split(/\n}/)[0]` reads only as far as the first closing brace at column 0, so a
 * deliberately or accidentally mis-indented brace inside the block truncates the scan and hides
 * everything after it from every check that consumes the body. Balancing is not parsing Rust - it
 * makes no claim about strings or char literals containing braces, which the scanned declarations
 * do not have - but it does mean indentation no longer decides what the controls can see.
 */
function blockBody(src, header) {
  const at = src.indexOf(header);
  if (at === -1) return "";
  const open = src.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1); // unbalanced: hand back the rest, so nothing hides in the tail
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
      } else if (e.isFile() && e.name.endsWith(".rs")) out.push(full);
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
  // PROJECTOS-HOST-REVIEW-PATH1B (ROUTE 1, W1) - THE DECLARED AMENDMENT.
  //
  //   OLD: EXACTLY ONE dependency was permitted, `projectos-host-authority`.
  //   NEW: `projectos-host-identity` is ALSO permitted, and ONLY as an OPTIONAL, feature-gated
  //        dependency of the client-admission route.
  //
  // WHY. The canonical CLIENT-ADMISSION attempt must compare the connected client's token user for
  // EXACT equality against the enrolled configured owner, and the ONLY place that owner exists is
  // the canonical installation record, behind host-identity's sealed
  // `VerifiedCanonicalInstallation`. Resolving an owner any other way here would be a SECOND owner
  // authority on the machine - which is the thing this crate exists to make impossible. The edge is
  // the narrow one that keeps ONE enrolled owner.
  //
  // NOTHING ELSE IS WEAKENED: the list is still compared exactly, `control-center` and a direct
  // `windows` dependency are still forbidden, and the new edge is checked below to be optional.
  const ALLOWED_DEPS = new Set(["projectos-host-authority", "projectos-host-identity"]);
  for (const n of depNames) {
    if (!ALLOWED_DEPS.has(n)) errors.push("unexpected dependency: " + n);
  }
  if (!/projectos-host-authority\s*=\s*\{[^}]*path\s*=\s*"\.\.\/host-authority"/.test(toml))
    errors.push("does not depend on host-authority via the sibling path");
  // The identity edge is a SIBLING PATH and is OPTIONAL, so the default graph does not pull it.
  const identityDep = /projectos-host-identity\s*=\s*\{([^}]*)\}/.exec(depBody);
  if (!identityDep) {
    errors.push("the client-admission identity edge is missing or is not a table dependency");
  } else {
    if (!/path\s*=\s*"\.\.\/host-identity"/.test(identityDep[1]))
      errors.push("host-identity is not depended on via the sibling path");
    if (!/optional\s*=\s*true/.test(identityDep[1]))
      errors.push("the host-identity edge is not optional, so the default graph pulls it");
  }
  // It is reachable ONLY through the client-admission feature, never by default.
  if (/^default\s*=\s*\[[^\]]*projectos-host-identity/m.test(stripComments(toml)))
    errors.push("the default feature set enables the host-identity edge");
  if (!/windows-client-admission\s*=\s*\[[^\]]*dep:projectos-host-identity/.test(stripComments(toml)))
    errors.push("the host-identity edge is not enabled by the client-admission feature");
  if (/control-center|windows\s*=/.test(depBody)) errors.push("forbidden dependency (control-center/windows)");
  // Lockfile: only this crate + host-authority (host-authority default is zero-dep).
  const lock = read(path.join(CRATE, "Cargo.lock"));
  const pkgNames = (lock.match(/^name = "(.*)"$/gm) || []).map((s) => s.replace(/^name = "|"$/g, ""));
  // The lock may now also carry the OPTIONAL, feature-gated instance-observation dependencies
  // (windows + the canonical handle primitive and their build-time helpers). Nothing else.
  //   OLD: the lockfile carried only this crate, host-authority, the handle primitive and the three
  //        proc-macro helpers.
  //   NEW: it additionally carries host-identity and the SHA-256 / serde chain it needs to read the
  //        canonical installation record. Every added name is a transitive of THAT one edge; the set
  //        is still compared exactly, so an unrelated package still fails here.
  const LOCK_ALLOWED = new Set([
    "projectos-host-windows-service-identity-proof",
    "projectos-host-authority",
    "projectos-host-identity",
    "projectos-windows-runtime-primitives",
    "proc-macro2",
    "quote",
    "syn",
    "unicode-ident",
    // sha2 and its dependency chain - the canonical record's digest.
    "sha2",
    "digest",
    "block-buffer",
    "crypto-common",
    "generic-array",
    "typenum",
    "cfg-if",
    "cpufeatures",
    "libc",
    "version_check",
    // serde and its chain - the canonical record is strict JSON with denied unknown fields.
    "serde",
    "serde_core",
    "serde_derive",
    "serde_json",
    "itoa",
    "memchr",
    "ryu",
    "zmij",
    // The packaging contract host-identity reads its fixed artefact paths from.
    "projectos-packaged-runtime-contract",
  ]);
  for (const n of pkgNames) {
    if (!LOCK_ALLOWED.has(n) && !/^windows(-|$)/.test(n)) {
      errors.push("Cargo.lock contains an unexpected package: " + n);
    }
  }

  // 2. Source scans. Every module EXCEPT the confined instance-observation FFI must remain a pure
  // typed contract with no unsafe and no effect route; the FFI module is the single audited exception.
  const FFI_REL = "projectos/host/windows-service-identity-proof/src/instance_ffi.rs";
  const INSTANCE_REL = "projectos/host/windows-service-identity-proof/src/instance.rs";
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
  //
  // AMENDED by PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A under explicit gatekeeper authority, narrowly:
  // ONE bounded private byte buffer is permitted, and only as the SID storage of the crate-private
  // opaque `PeerUserBinding`. Exact-user reconciliation needs equality over a SID, and a SID is bytes;
  // the safety property was never "no bytes exist" but "no raw identity is READABLE". So the exact
  // authorised declaration is excised from the scanned text and the ORIGINAL blanket rule then runs
  // unchanged over everything else — a second byte-array field, or the same field under a different
  // type, still fails — and the opacity of the excised type is proven separately in 8j below.
  const AUTHORISED_OPAQUE_SID_FIELD = /\n\s*sid:\s*\[u8;\s*PEER_SID_MAX_LEN\],/;
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    // The FFI module declares no public type; its locals are covered by the opacity checks below.
    if (rel === FFI_REL) continue;
    let code = stripComments(read(f));
    if (rel === INSTANCE_REL) {
      const authorised = code.match(new RegExp(AUTHORISED_OPAQUE_SID_FIELD, "g")) || [];
      if (authorised.length > 1)
        errors.push(rel + ": more than one bounded opaque SID field is declared");
      code = code.replace(AUTHORISED_OPAQUE_SID_FIELD, "\n");
    }
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
    // Identity components may be read ONLY where the token is built or compared, plus the ONE
    // bounded projection named below. The projection is excised first and the remaining count must
    // still be zero, so a second reader cannot hide behind the amendment.
    const PROJECTION =
      /pub\(crate\) fn observed_parts\(&self\) -> \(u32, u64\) \{\s*\(self\.process_id, self\.creation_time\)\s*\}/;
    if (!PROJECTION.test(inst))
      errors.push("the bounded process projection is missing or is not exactly the two scalars");
    if (/pub fn observed_parts/.test(inst))
      errors.push("the bounded process projection is public; it must stay crate-private");
    const projections = (inst.match(/fn observed_parts/g) || []).length;
    if (projections !== 1)
      errors.push("there are " + projections + " process projections; exactly 1 is allowed");
    const strayReads = (inst.replace(PROJECTION, " ").match(/self\.process_id|self\.creation_time/g) || []).length;
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
    // AMENDED by PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A under explicit gatekeeper authority: the
    // original rule assumed NO token access at all. Bounded read-only token capture is now authorised,
    // so the blanket `GetTokenInformation` ban is replaced by EXACT least-rights checks. Every other
    // escalation route stays banned, including `OpenProcessToken` — the client token is reached through
    // impersonation and the THREAD token, never by opening the peer process's token.
    for (const bad of [
      /PROCESS_ALL_ACCESS/,
      /PROCESS_VM_READ/,
      /SeDebugPrivilege/,
      /AdjustTokenPrivileges/,
      /OpenProcessToken/,
    ]) {
      if (bad.test(ffi)) errors.push("the observation escalates beyond the minimum query access");
    }
    if (/GetTokenInformation/.test(ffi)) {
      // Token reads are authorised ONLY under the exact minimum rights.
      if (!/OpenThreadToken\(\s*GetCurrentThread\(\),\s*TOKEN_QUERY,\s*false,/.test(ffi))
        errors.push(
          "the client token is not opened with TOKEN_QUERY and OpenAsSelf=false under impersonation"
        );
      // Only ACCESS-MASK names are inspected; the Windows record types and this module's own buffer
      // constant are not access rights.
      const ACCESS_MASKS =
        /\bTOKEN_(QUERY|QUERY_SOURCE|ALL_ACCESS|DUPLICATE|IMPERSONATE|ASSIGN_PRIMARY|ADJUST_PRIVILEGES|ADJUST_GROUPS|ADJUST_DEFAULT|ADJUST_SESSIONID|READ|WRITE|EXECUTE)\b/g;
      for (const right of new Set(ffi.match(ACCESS_MASKS) || [])) {
        if (right !== "TOKEN_QUERY")
          errors.push("the token is opened with more than TOKEN_QUERY: " + right);
      }
      for (const bad of [
        /DuplicateTokenEx?/,
        /SetThreadToken/,
        /CreateProcessAsUser/,
        /ImpersonateLoggedOnUser/,
        /LogonUserW?\s*\(/,
        /PrivilegeCheck/,
      ]) {
        if (bad.test(ffi))
          errors.push("the token capture creates, duplicates, assigns or elevates a token");
      }
      // Impersonation is entered ONLY through the pipe, and reversion is guaranteed by RAII Drop.
      if (!/ImpersonateNamedPipeClient/.test(ffi))
        errors.push("token facts are read without impersonating the pipe client");
      if (!/impl Drop for ImpersonatedPipeClient/.test(ffi))
        errors.push("the impersonation window has no RAII guard");
      if (!/fn drop\(&mut self\)\s*\{[\s\S]{0,400}RevertToSelf\(\)/.test(ffi))
        errors.push("the impersonation guard's Drop does not revert");
      // The raw capture helper must remain PRIVATE: a peer identity is reachable only through an
      // attempt transition, never as a callable entry point.
      if (/pub(\(crate\))?\s+unsafe\s+fn\s+capture_peer_identity_facts/.test(ffi))
        errors.push("the raw peer-identity capture helper is publicly reachable outside an attempt");
      if (!/\n\s*unsafe fn capture_peer_identity_facts\(/.test(ffi))
        errors.push("the private peer-identity capture helper is missing");
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
  // CD-B4-BINDING-CONSUMER-SURFACE1A separated three concerns Contract1B had fused into one feature:
  // contract visibility, live Windows observation, and synthetic fixtures. The attempt surface is now
  // gated on the NON-LIVE consumer contract so a dependent orchestrator can name and drive it without
  // enabling any Win32 code. Security is unchanged and is NOT the feature flag — the forgery-resistance
  // assertions immediately below are what enforce it.
  if (!/#\[cfg\(any\(test,\s*feature\s*=\s*"consumer-contract"\)\)\]\s*pub\s+use\s+instance::\{[\s\S]*?ServiceInstanceBindingAttempt/.test(libSrc))
    errors.push("the attempt surface is not gated to the dependent consumer contract");
  // The synthetic fixture surface is a THIRD, explicit, non-default gate — never the contract gate and
  // never the live gate.
  if (!/#\[cfg\(any\(test,\s*feature\s*=\s*"test-fixtures"\)\)\]\s*pub\s+use\s+instance::\{[^}]*synthetic_observation/.test(libSrc))
    errors.push("the synthetic fixture surface is not gated to an explicit test-fixtures feature");
  // The three features must remain distinct, with live and fixtures each implying only the contract.
  if (!/consumer-contract\s*=\s*\[\]/.test(toml))
    errors.push("the consumer contract is not a standalone dependency-free feature");
  if (!/windows-live-instance-observation\s*=\s*\[\s*"consumer-contract",/.test(toml))
    errors.push("live observation does not imply the consumer contract");
  if (!/test-fixtures\s*=\s*\["consumer-contract"\]/.test(toml))
    errors.push("test-fixtures is not an explicit contract-only feature");
  if (/windows-live-instance-observation\s*=\s*\[[^\]]*test-fixtures/.test(toml))
    errors.push("live observation reaches the synthetic fixtures");
  if (/test-fixtures\s*=\s*\[[^\]]*windows-live-instance-observation/.test(toml))
    errors.push("the fixture feature reaches live Windows observation");

  // 8h-bis. HISTORICAL CLOSURE EVIDENCE. The current tree has legitimately evolved past Contract1B, so
  // proving the evolved shape alone would silently erase what was actually accepted at closure. Read the
  // FROZEN commit directly and assert it carried the ORIGINAL single-feature gate that was correct then.
  // This keeps the two states distinguishable: accepted history vs authorised current surface.
  {
    const CONTRACT1B_COMMIT = "fb284a624a813e2d6636990d657632439ff91db0";
    const REL = "projectos/host/windows-service-identity-proof/src/lib.rs";
    let historical = null;
    try {
      historical = execFileSync("git", ["show", `${CONTRACT1B_COMMIT}:${REL}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (e) {
      errors.push(
        "cannot read the frozen Contract1B commit " + CONTRACT1B_COMMIT + " (historical evidence lost)"
      );
    }
    if (historical !== null) {
      // At closure the attempt surface WAS gated to the live-observation feature. That is the accepted
      // historical fact; it must remain readable from history even though the tree has moved on.
      if (!/#\[cfg\(any\(test,\s*all\(windows,\s*feature\s*=\s*"windows-live-instance-observation"\)\)\)\]\s*pub\s+use\s+instance::\{[\s\S]*?ServiceInstanceBindingAttempt/.test(historical))
        errors.push("the frozen Contract1B commit does not carry its original attempt-surface gate");
      // And it must NOT be retro-described as containing the later three-way split.
      if (/feature\s*=\s*"consumer-contract"/.test(historical))
        errors.push("the frozen Contract1B commit is being misreported as containing the consumer contract");
      if (/feature\s*=\s*"test-fixtures"/.test(historical))
        errors.push("the frozen Contract1B commit is being misreported as containing the fixture feature");
    }
  }

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

  // 8j. ATTEMPT-SCOPED PEER IDENTITY (PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A).
  //
  // The counterpart to the two narrow amendments above. Bounded private SID storage is permitted ONLY
  // because every one of these holds: the type is crate-private, unconstructible outside this crate,
  // unreadable, unrenderable, unhashable, unserialisable, owned by the attempt and never returned.
  if (fs.existsSync(instPath)) {
    const inst = stripComments(read(instPath));
    const libSrcRaw = stripComments(read(path.join(CRATE, "src", "lib.rs")));

    /** The contiguous `#[...]` attribute lines immediately above a declaration. */
    const gateAbove = (src, decl) => {
      const at = src.indexOf(decl);
      if (at === -1) return null;
      const lines = src.slice(0, at).split("\n");
      const attrs = [];
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line === "") continue;
        if (line.startsWith("#[")) {
          attrs.push(line);
          continue;
        }
        break;
      }
      return attrs.join(" ");
    };

    const PEER_TYPES = ["PeerUserBinding", "PeerSessionBinding", "CanonicalPeerContribution"];

    // The identity types are CRATE-PRIVATE. Nothing sibling-facing may name them.
    for (const t of PEER_TYPES) {
      if (!new RegExp("pub\\(crate\\)\\s+(struct|enum)\\s+" + t + "\\b").test(inst))
        errors.push(t + " is not a crate-private opaque type");
      if (new RegExp("\\bpub\\s+(struct|enum)\\s+" + t + "\\b").test(inst))
        errors.push(t + " is publicly declared (identity would cross the crate boundary)");
      if (new RegExp("\\b" + t + "\\b").test(libSrcRaw))
        errors.push(t + " is re-exported from lib.rs");
      // Redacted, hand-written Debug; never derived, never rendering content.
      const dbg = inst.match(
        new RegExp("impl\\s+fmt::Debug\\s+for\\s+" + t + "\\s*\\{([\\s\\S]*?)\\n\\}")
      );
      if (!dbg) errors.push(t + " does not implement a redacted Debug");
      else if (!new RegExp(t + "\\(\\[REDACTED\\]\\)").test(dbg[1]))
        errors.push(t + " Debug output is not redacted");
      const derive = inst.match(
        new RegExp("#\\[derive\\(([^)]*)\\)\\]\\s*(?:#\\[[^\\]]*\\]\\s*)*pub\\(crate\\)\\s+(?:struct|enum)\\s+" + t + "\\b")
      );
      if (derive && /Debug|Hash|Serialize|Deserialize|Default/.test(derive[1]))
        errors.push(t + " derives a forbidden trait: " + derive[1]);
      // No conversion, borrow or raw-parts escape hatch.
      for (const trait of ["AsRef", "Borrow", "Deref", "Into", "From", "Hash", "fmt::Display"]) {
        if (new RegExp("impl[^\\n]*\\b" + trait.replace(".", "\\.") + "\\b[^\\n]*for\\s+" + t).test(inst))
          errors.push(t + " implements " + trait + ", which would leak or rebuild identity");
      }
      // The type is gated to where identity can legitimately originate, and NEVER to the fixture
      // feature: a default or fixture graph must contain no identity storage at all.
      const gate = gateAbove(inst, "pub(crate) struct " + t) || gateAbove(inst, "pub(crate) enum " + t);
      if (gate === null) errors.push(t + " declaration not found for gate inspection");
      else {
        if (!/windows-live-instance-observation/.test(gate))
          errors.push(t + " is not gated to the live observation graph");
        if (/test-fixtures/.test(gate))
          errors.push(t + " is reachable from the non-default fixture graph");
      }
    }

    // Private fields, private construction, no accessor of any kind.
    const bindingBody = inst.match(/pub\(crate\)\s+struct\s+PeerUserBinding\s*\{([\s\S]*?)\n\}/);
    if (!bindingBody) errors.push("the opaque user binding is missing");
    else if (/\bpub\b/.test(bindingBody[1]))
      errors.push("the opaque user binding exposes a public field");
    if (!/pub\(crate\)\s+fn\s+from_sid_bytes/.test(inst))
      errors.push("the user binding constructor is not crate-private");
    if (/\bpub\s+fn\s+from_sid_bytes|\bpub\s+fn\s+from_session_id/.test(inst))
      errors.push("an opaque binding has a public constructor");
    // Struct-literal construction is legal only in the declaration and the constructor; anywhere else
    // would be a second, unchecked route from raw bytes to an identity.
    if ((inst.match(/(?<!struct |impl |for )PeerUserBinding\s*\{/g) || []).length > 0)
      errors.push("the opaque user binding is constructed by struct literal outside its constructor");
    for (const bad of [
      /fn\s+(bytes|as_bytes|as_slice|to_bytes|raw|raw_parts|into_inner|as_parts)\s*\(\s*&?self/,
      /fn\s+(fingerprint|digest|hash_value|to_hex)\s*\(\s*&?self/,
      /->\s*&\[u8\]/,
    ]) {
      if (bad.test(inst)) errors.push("an opaque identity value has a readable accessor");
    }
    // No PUBLIC route returns identity, an internal record or the internal outcome.
    if (
      new RegExp(
        "\\bpub\\s+fn[^\\n]*->[^\\n]*(" + PEER_TYPES.join("|") + "|PeerContributionOutcome)"
      ).test(inst)
    )
      errors.push("a public function returns a stored peer identity or a reusable contribution");
    if (/pub\(crate\)\s+fn\s+\w*peer\w*\s*\(\s*&self/.test(inst))
      errors.push("the attempt hands its recorded peer identity back");

    // The attempt OWNS the recorded identity: private field, boxed inside the private store.
    const innerPeer = inst.match(/struct AttemptInner\s*\{([\s\S]*?)\n\}/);
    if (!innerPeer || !/\n\s*peer:\s*Option<Box<CanonicalPeerContribution>>,/.test(innerPeer[1]))
      errors.push("the attempt does not retain the peer identity internally");

    // Capture and reconciliation are ATTEMPT TRANSITIONS that consume the attempt.
    const captureBlock = inst.match(
      /impl\s+ServiceInstanceBindingAttempt<ScmBeforeObserved>\s*\{([\s\S]*?)\n\}/
    );
    if (!captureBlock || !/fn\s+record_ipc_peer_identity\s*\(\s*mut self,[\s\S]*?\)\s*->\s*AttemptOutcome<IpcPeerObserved>/.test(captureBlock[1]))
      errors.push("the peer-identity capture is not an attempt transition from ScmBeforeObserved");
    const reconcileBlock = inst.match(
      /impl\s+ServiceInstanceBindingAttempt<IpcPeerObserved>\s*\{([\s\S]*?)\n\}/
    );
    if (!reconcileBlock || !/fn\s+reconcile_ipc_peer_identity\s*\(\s*self,[\s\S]*?\)\s*->\s*AttemptOutcome<IpcPeerObserved>/.test(reconcileBlock[1]))
      errors.push("the peer-identity reconciliation is not an attempt transition");
    for (const fn of ["record_ipc_peer_identity", "reconcile_ipc_peer_identity"]) {
      const body = inst.match(new RegExp("fn\\s+" + fn + "\\s*\\([\\s\\S]*?\\n    \\}"));
      if (!body) errors.push("cannot inspect the body of " + fn);
      else if (!/if let Some\(expired\) = self\.inner\.expiry\(\)/.test(body[0]))
        errors.push(fn + " does not check the observation window");
    }

    // Reversion is decided FIRST, and integrity decides NOTHING.
    const decide = inst.match(/fn\s+decide_peer_contribution\([\s\S]*?\n\}/);
    if (!decide) errors.push("the portable peer decision core is missing");
    else {
      const revertAt = decide[0].indexOf("impersonation_reverted");
      const userAt = decide[0].indexOf("token_user");
      const instAt = decide[0].indexOf("ServiceInstanceObservation::Observed");
      if (revertAt === -1) errors.push("the peer decision core does not check that impersonation reverted");
      for (const [name, at] of [["the instance check", instAt], ["the user check", userAt]]) {
        if (at !== -1 && revertAt !== -1 && at < revertAt)
          errors.push(name + " precedes the reversion check in the peer decision core");
      }
      const lastRefusal = decide[0].lastIndexOf("PeerContributionOutcome::Refused(");
      const firstIntegrity = decide[0].search(/integrity/);
      if (firstIntegrity !== -1 && lastRefusal !== -1 && firstIntegrity < lastRefusal)
        errors.push("integrity is consulted before a peer refusal is decided");
    }
    const matches = inst.match(/fn\s+identity_matches\([\s\S]*?\n    \}/);
    if (!matches) errors.push("the attempt has no exact-identity comparison");
    else {
      for (const part of ["instance", "user", "session", "connection_id", "handshake_generation"]) {
        if (!new RegExp("self\\." + part + "\\s*==\\s*bound\\." + part).test(matches[0]))
          errors.push("exact-identity comparison no longer compares " + part);
      }
      if (/integrity/.test(matches[0]))
        errors.push("exact-identity comparison consults integrity, which must authorise nothing");
    }
    // Every peer refusal collapses to ONE closed verdict, exhaustively.
    const collapse = inst.match(/fn\s+peer_refusal_verdict\([\s\S]*?\n\}/);
    if (!collapse) errors.push("peer refusals are not collapsed onto a closed verdict");
    else {
      if (/_\s*=>/.test(collapse[0]))
        errors.push("the peer refusal collapse uses a wildcard instead of an exhaustive match");
      if ((collapse[0].match(/ServiceInstanceBinding::/g) || []).length !== 1)
        errors.push("the peer refusal collapse discloses more than one verdict");
    }

    // Exact-user separation and the non-authorising integrity ruling must be exercised by tests.
    for (const t of [
      "two_different_users_of_the_same_class_remain_distinguishable",
      "integrity_never_refuses_and_never_alters_identity",
      "an_unreverted_impersonation_is_refused_before_any_other_check",
      "a_reused_pid_with_a_different_creation_identity_is_refused",
      "a_recorded_peer_identity_is_never_rendered",
    ]) {
      if (!inst.includes(t)) errors.push("missing peer-capture test: " + t);
    }
  }

  // 8k. SEALED PEER ADMISSION (RUN-TO-COMPLETION HOST ATTESTATION - AUTHORITY REACHABILITY RUNG 2).
  //
  // WHY THIS EXISTS. The authority-reachability checkpoint added `VerifiedPeerAdmission` - the sealed
  // positive answer to "was this peer admitted for this connection?" - and its canonical mint
  // `ServiceInstanceBindingAttempt::admit_peer_for_connection`. It shipped with NO regression control
  // here, while the SIBLING crate's consumer of it (`TrustedPeerContext`) was given a deliberately
  // adversarial one in the same commit. The ECC security review called that asymmetry out: the type is
  // correctly sealed today, so nothing is exploitable, but a later `impl Clone`, a dropped `_sealed`, or
  // a second mint taking a caller-supplied identifier pair would pass CI in silence - and
  // `TrustedPeerContext::from_verified_peer_admission` would become forgeable end to end through it.
  //
  // WHAT THIS DOES NOT CLAIM. It does not prove the binding logic. That three separately-obtained
  // identities must agree, that an unreverted impersonation is refused first, and that a reused PID with
  // a different creation identity is refused, are proven by the behavioural tests pinned in 8i/8j above
  // and by module privacy. This pins the AUTHORITY SURFACE: which constructors may exist, what they may
  // consume, and that nothing else can mint the type.
  //
  // CRATE-WIDE, NOT FILE-WIDE. Rust permits an inherent `impl` in ANY module of the defining crate, and
  // a private-field struct can be built by struct literal from the defining module or any DESCENDANT of
  // it. A second mint in a new `mod admission;` file would be invisible to a single-file scan - an
  // ordinary refactor, not an exploit - so the counts below run over every `.rs` in the crate.
  if (fs.existsSync(instPath)) {
    const inst = stripComments(read(instPath));
    const crateRs = rsFiles(path.join(CRATE, "src"));
    const crateSrc = crateRs.map((f) => stripComments(read(f))).join("\n");

    /**
     * The attribute blocks immediately above a declaration, joined and whitespace-collapsed.
     *
     * A BALANCED-BRACKET SCAN, NOT A PER-LINE PREFIX TEST: a rustfmt-wrapped `#[derive(\n ..\n)]` puts
     * `)]` immediately above the declaration, which a per-line `startsWith("#[")` test rejects, and the
     * derive checks below would then have found nothing to match and passed in silence.
     */
    const attrsAbove = (src, decl) => {
      const at = src.indexOf(decl);
      if (at === -1) return "";
      let cursor = at;
      let collected = "";
      for (;;) {
        let j = cursor - 1;
        while (j >= 0 && /\s/.test(src[j])) j--;
        if (j < 0 || src[j] !== "]") break;
        let depth = 0;
        let k = j;
        for (; k >= 0; k--) {
          if (src[k] === "]") depth++;
          else if (src[k] === "[") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (k < 1 || src[k - 1] !== "#") break;
        collected = src.slice(k - 1, j + 1) + " " + collected;
        cursor = k - 1;
      }
      return collected.replace(/\s+/g, " ").trim();
    };

    if (!/pub struct VerifiedPeerAdmission\s*\{/.test(inst)) {
      errors.push("VerifiedPeerAdmission is missing; the sealed peer admission is the rung TrustedPeerContext consumes");
    } else {
      const structBody = blockBody(inst, "pub struct VerifiedPeerAdmission");
      // The seal, and private identifiers. A public field is a struct-literal mint in disguise.
      if (!/_sealed\s*:\s*Sealed/.test(structBody)) {
        errors.push("VerifiedPeerAdmission lost its private seal; it could be fabricated by struct literal");
      }
      for (const field of ["connection_id", "handshake_generation"]) {
        if (!new RegExp(field + "\\s*:\\s*u64").test(structBody)) {
          errors.push("VerifiedPeerAdmission no longer carries a private " + field);
        }
      }
      if (/\bpub\s+[a-z_]/.test(structBody)) {
        errors.push("VerifiedPeerAdmission gained a public field; an admission could be written directly");
      }
      // DERIVES. Debug is permitted (it renders only host-issued identifiers). Clone/Copy would let a
      // holder duplicate an admission rather than earn it; Default would mint one from nothing; serde
      // would mint one from bytes.
      const derives = attrsAbove(inst, "pub struct VerifiedPeerAdmission");
      for (const bad of ["Clone", "Copy", "Default", "Serialize", "Deserialize"]) {
        if (new RegExp("derive\\s*\\([^)]*\\b" + bad + "\\b").test(derives)) {
          errors.push("VerifiedPeerAdmission derives " + bad + "; an admission must be proven by an attempt, never copied, defaulted or deserialised");
        }
      }
      // NO TRAIT IMPL ANYWHERE IN THE CRATE. From/TryFrom/Into/Default/Clone are all trait routes to a
      // value, and naming the forbidden ones would pass whichever was thought of next.
      if (/impl[^{;]*?\bfor\s+VerifiedPeerAdmission\b/.test(flatten(crateSrc))) {
        errors.push("a trait impl for VerifiedPeerAdmission exists; a trait could mint the type outside the enumerated block");
      }
      // ONE INHERENT BLOCK IN THE WHOLE CRATE, so the enumeration below cannot be bypassed by appending
      // a second one in this file or in any other module.
      const blocks = (crateSrc.match(/impl VerifiedPeerAdmission\s*\{/g) || []).length;
      if (blocks !== 1) {
        errors.push("expected exactly one `impl VerifiedPeerAdmission` block in the crate, found " + blocks + "; the enumeration below only covers one");
      }
      const body = blockBody(inst, "impl VerifiedPeerAdmission {");
      // A CLOSED ALLOWLIST, covering pub(crate) too, with generics tolerated so `fn evil<T>(..)` cannot
      // slip past the way it once did against the sibling crate's O7.
      const ALLOWED_ADMISSION = new Set([
        "connection_id",
        "handshake_generation",
        "for_admitted_client",
      ]);
      // THE SECOND MINT IS CRATE-PRIVATE AND HAS EXACTLY ONE CALL SITE.
      if (!/pub\(crate\) fn for_admitted_client\(connection_id: u64, handshake_generation: u64\) -> Self/.test(inst))
        errors.push("the client-admission mint is missing, public, or does not take exactly the two host-issued identifiers");
      {
        const decl = /\bfn\s+for_admitted_client/g;
        const callSites = crateSrc
          .replace(decl, "DECLARATION")
          .match(/for_admitted_client\s*\(/g) || [];
        if (callSites.length !== 1)
          errors.push("the client-admission mint has " + callSites.length + " call site(s); exactly 1 (the final admission gate) is allowed");
        const admit = blockBody(read(path.join(CRATE, "src", "client_admission.rs")), "pub fn admit_client_for_connection(");
        if (!/for_admitted_client\(/.test(admit))
          errors.push("the client-admission mint is not reached from the final admission gate");
      }
      const fns = [...body.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
      for (const name of fns) {
        if (!ALLOWED_ADMISSION.has(name)) {
          errors.push("VerifiedPeerAdmission gained an unruled function `" + name + "`; an admission must be proven, not asserted");
        }
      }
      for (const required of ALLOWED_ADMISSION) {
        if (!fns.includes(required)) {
          errors.push("VerifiedPeerAdmission lost its `" + required + "` accessor");
        }
      }
      // ITS OWN IMPL MINTS NOTHING. The accessors are the whole block, so a `Self { .. }` appearing here
      // would be a mint reachable without going through the attempt - including from a private helper
      // the public-function allowlist never sees.
      //   OLD: the impl minted NOTHING - zero `Self {` - because its only mint lived elsewhere.
      //   NEW: exactly ONE, the crate-private client-admission mint proven above. The count stays
      //        exact, so a third construction still fails here.
      const selfMints = (body.match(/(?<!-> )(?<!let )Self\s*\{/g) || []).length;
      if (selfMints !== 1) {
        errors.push("the VerifiedPeerAdmission impl constructs " + selfMints + " value(s) via `Self {`; exactly 1 (the crate-private client-admission mint) is allowed");
      }
      // No shape that lets a caller state the answer, whatever it is called.
      // Flattened, so a wrapped signature cannot slip past; `[^{;]` keeps each pattern inside one
      // signature. Redundant with the name allowlist above by design - a dead check is still a lie.
      const flatBody = flatten(body);
      for (const [re, why] of [
        [/pub[^{;]*?fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*bool/, "a function taking a bool"],
        [/pub[^{;]*?fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*&?ServiceInstanceBinding/, "a function taking the verdict enum"],
        // The u64 rule now excludes the ONE crate-private mint, which is proven above to be
        // unreachable from any consumer and to have a single call site inside the admission gate.
        // Every PUBLIC function is still forbidden to take one.
        [/pub\s+fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*u64/, "a function taking a raw identifier"],
      ]) {
        if (re.test(flatBody)) {
          errors.push("VerifiedPeerAdmission exposes " + why + "; a verdict is a description, not authority");
        }
      }
      // NO MACRO inside the authority impl: one token to this scan, an arbitrary `fn` to the compiler.
      if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
        errors.push("a macro is invoked inside the VerifiedPeerAdmission impl; it could expand to a constructor this scan cannot see");
      }
    }

    // THE GATE ITSELF, pinned the way section 8j pins it for the sibling peer types - and pinned
    // EXACTLY, not merely "mentions consumer-contract and not test-fixtures". A fourth OR'd feature
    // would satisfy a substring test while making the admission reachable from a graph nobody
    // audited, which is precisely the widening this rule exists to refuse. Raised by the ECC
    // security review, twice: once to add the rule, once because the first version of it was looser
    // than the comment describing it.
    const EXPECTED_ADMISSION_GATE = '#[cfg(any(test, feature = "consumer-contract"))]';
    const cfgOf = (attrs) => {
      const m = attrs.match(/#\[cfg\([^\]]*\)\]/);
      return m ? m[0].replace(/\s+/g, " ") : null;
    };
    for (const [decl, what] of [
      ["pub struct VerifiedPeerAdmission", "the VerifiedPeerAdmission declaration"],
      ["impl VerifiedPeerAdmission {", "the VerifiedPeerAdmission impl"],
    ]) {
      const gate = cfgOf(attrsAbove(inst, decl));
      if (gate === null) {
        errors.push(what + " carries no cfg gate; the sealed admission must not become unconditionally available");
      } else if (gate !== EXPECTED_ADMISSION_GATE) {
        errors.push(what + " gate changed to " + gate + "; it must be exactly " + EXPECTED_ADMISSION_GATE);
      }
    }
    {
      const libSrc = stripComments(read(path.join(CRATE, "src", "lib.rs")));
      const gate = cfgOf(attrsAbove(libSrc, "pub use instance::VerifiedPeerAdmission;"));
      if (gate === null) {
        errors.push("the VerifiedPeerAdmission re-export in lib.rs carries no cfg gate");
      } else if (gate !== EXPECTED_ADMISSION_GATE) {
        errors.push("the VerifiedPeerAdmission re-export gate changed to " + gate + "; it must be exactly " + EXPECTED_ADMISSION_GATE);
      }
    }

    // NO REBINDING OF THE SEALED TYPE NAMES, ANYWHERE IN THE CRATE.
    //
    // Every structural check above keys on the LITERAL type name - `impl Type {`, `Type {`. Rust
    // lets an inherent impl be written against a type ALIAS, and a struct with private fields can
    // be built from any module that can see those fields. So this, in the defining module, is a
    // complete forgery route that every one of those checks reads straight past:
    //
    //     type Alias = SealedType;
    //     impl Alias {
    //         pub(crate) fn forged(..) -> Self { Self { _seal: Seal, .. } }
    //     }
    //
    // Demonstrated by the ECC security review and reproduced here against rustc 1.96.1: it
    // compiles, runs, and yields a sealed value with no signature, programme or liveness check.
    // Rather than teaching every scan to resolve aliases - which is parsing Rust - the rebinding
    // itself is refused. Production has no legitimate reason to rename these types, so the honest
    // rule is that it must not happen.
    for (const sealedType of ["VerifiedPeerAdmission"]) {
      const aliased = new RegExp("\\btype\\s+\\w+\\s*(?:<[^>]*>)?\\s*=\\s*(?:[\\w]+::)*" + sealedType + "\\b");
      if (aliased.test(crateSrc)) {
        errors.push(sealedType + " is rebound by a type alias; an inherent impl on the alias would be invisible to every check that names the type");
      }
      const renamed = new RegExp("\\buse\\s+[^;]*\\b" + sealedType + "\\s+as\\s+\\w+");
      if (renamed.test(crateSrc)) {
        errors.push(sealedType + " is imported under another name; an inherent impl on that name would be invisible to every check that names the type");
      }
    }

    // EXACTLY ONE MINT IN THE WHOLE CRATE, AND IT IS THE CANONICAL FINALISATION. Writing the struct
    // literal is what minting IS, so the number of places that write one is the number of mints. The
    // `struct` and `impl` headers are excluded because they are declarations; `-> Type {` is excluded
    // because a return type followed by a function body is not a construction either.
    const literals = (crateSrc.match(/(?<!struct )(?<!impl )(?<!-> )VerifiedPeerAdmission\s*\{/g) || []).length;
    if (literals !== 1) {
      errors.push("expected exactly 1 VerifiedPeerAdmission construction site in the crate, found " + literals);
    }
    // SIGNATURE + BRACE-BALANCED BODY. This used the same `\n    }` indentation idiom the rest of
    // this round replaced: truncation could only fail closed here, but a control should not depend on
    // where a brace sits when the helper to avoid that exists three lines up.
    const mintAt = inst.indexOf("pub fn admit_peer_for_connection(");
    const mint =
      mintAt === -1
        ? null
        : [
            inst.slice(mintAt, inst.indexOf("{", mintAt)),
            "{",
            blockBody(inst, "pub fn admit_peer_for_connection("),
            "}",
          ].join("");
    if (!mint) {
      errors.push("the canonical mint `admit_peer_for_connection` is missing");
    } else {
      const m = mint;
      // It must CONSUME the attempt. `&self` would let one attempt mint an unbounded number of
      // admissions, which is a different property from the one the attempt proves.
      if (!/pub fn admit_peer_for_connection\(\s*self\s*,/.test(m)) {
        errors.push("admit_peer_for_connection no longer consumes the attempt by value; one attempt could mint many admissions");
      }
      // It must DELEGATE to the one verdict implementation rather than re-deciding, and it must do so
      // for the SAME connection and handshake generation the admission will carry.
      if (!/self\.finalise_for_connection\(\s*connection_id\s*,\s*handshake_generation\s*,?\s*\)/.test(m)) {
        errors.push("admit_peer_for_connection does not delegate to finalise_for_connection for the requested connection and handshake generation");
      }
      // Only the accepting verdict may produce it, and only inside that arm.
      if (!/ServiceInstanceBinding::Match\s*=>\s*Ok\(VerifiedPeerAdmission\s*\{/.test(m)) {
        errors.push("the admission is no longer produced solely by the ServiceInstanceBinding::Match arm");
      }
      if (!/(?:_|refused)\s*=>/.test(m)) {
        errors.push("admit_peer_for_connection has no refusing arm; every non-Match verdict must refuse");
      }
      // A VERDICT VALUE IS NOT AUTHORITY. If the mint accepted a ServiceInstanceBinding, a caller could
      // write down the enum variant that means success and be admitted on the strength of the word.
      const sig = m.slice(0, m.indexOf(")") + 1);
      if (/ServiceInstanceBinding/.test(sig) || /:\s*bool/.test(sig)) {
        errors.push("admit_peer_for_connection accepts a caller-supplied verdict or flag; a Match value must never itself be sufficient authority");
      }
      // The identifiers must be the mint's own parameters, carried by shorthand, so there is no seam to
      // pair a genuine finalisation with a different connection.
      const literal = m.slice(m.indexOf("Ok(VerifiedPeerAdmission"));
      for (const field of ["connection_id", "handshake_generation"]) {
        if (new RegExp(field + "\\s*:").test(literal)) {
          errors.push("the admission sets `" + field + "` explicitly instead of carrying the finalised parameter by shorthand");
        }
      }
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
