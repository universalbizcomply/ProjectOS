// Validator: PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A
//
// Fails closed. Pins ATTEMPT-SCOPED canonical ownership of kernel peer identity.
//
// The architecture this validator defends: peer identity is captured INSIDE the bounded, ordered,
// consumable attempt that already owns the instance observations, is stored privately there, and never
// leaves. No contribution, binding, observation or handle is returned to any sibling crate; a consumer
// learns only that the attempt advanced into its next opaque state, or the closed redacted verdict that
// refused it.
//
// The threat each assertion answers (and the K-mutation it kills):
//   C1  the attempt-scoped capture surface exists at the committed paths
//   C2  windows-local-ipc acquires NO raw process or token identity itself            (K1)
//   C3  the canonical crate asks for the MINIMUM process and token rights             (K3, K4)
//   C4a impersonation is guaranteed to revert, and the revert is VERIFIED             (K6)
//   C5  no work other than the token reads happens inside the impersonation window    (K11)
//   C6  no token or process handle escapes; both close through RAII, never CloseHandle (K5)
//   C7  exact user and session identity are OPAQUE, crate-private and unreadable      (K7)
//   C8  classification is a fail-closed GATE derived from the user SID alone          (K12)
//   C9  integrity is non-authorising - it can neither establish nor invalidate identity (K12)
//   C10 nothing is publicly constructible and no fixture reaches the default graph    (K8, K9)
//   C11 the attempt returns no identity: only the next state or a closed verdict      (K1)
//   C12 process-creation identity still binds the peer, and C4 remains a hard stop    (K2, K10)
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CANON = path.join(ROOT, "projectos", "host", "windows-service-identity-proof");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const INSTANCE = path.join(CANON, "src", "instance.rs");
const FFI = path.join(CANON, "src", "instance_ffi.rs");
const CANON_LIB = path.join(CANON, "src", "lib.rs");
const MANIFEST = path.join(CANON, "Cargo.toml");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const IPC_FFI = path.join(IPC, "windows_ffi.rs");

/** Strip line and doc comments so a forbidden construct cannot hide in prose, and prose cannot fail a build. */
function stripComments(rust) {
  return rust
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/** The body of an item, from its signature to the next top-level `}`. */
function fnBody(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const rest = src.slice(at);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The `#[...]` attribute lines immediately preceding an item. */
function attributesAbove(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const before = src.slice(0, at).split("\n");
  const attrs = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    if (line === "") continue;
    if (line.startsWith("#[")) {
      attrs.push(line);
      continue;
    }
    break;
  }
  return attrs.join(" ");
}

/** The raw process/token APIs that belong to the canonical crate ALONE. */
const RAW_IDENTITY_APIS = [
  "GetNamedPipeClientProcessId",
  "GetNamedPipeClientSessionId",
  "GetProcessTimes",
  "OpenProcess",
  "OpenThreadToken",
  "OpenProcessToken",
  "GetTokenInformation",
  "ImpersonateNamedPipeClient",
  "RevertToSelf",
  "LookupAccountSid",
  "ConvertSidToStringSid",
];

/** The crate-private peer identity types. None may be named outside the canonical crate. */
const PEER_TYPES = [
  "PeerUserBinding",
  "PeerSessionBinding",
  "PeerPrincipalClass",
  "PeerIntegrityEvidence",
  "CanonicalPeerContribution",
  "PeerContributionOutcome",
  "PeerContributionRefusal",
];

function run() {
  const e = [];

  // C1 - the committed paths exist.
  for (const [f, label] of [
    [INSTANCE, "windows-service-identity-proof/src/instance.rs"],
    [FFI, "windows-service-identity-proof/src/instance_ffi.rs"],
    [CANON_LIB, "windows-service-identity-proof/src/lib.rs"],
    [MANIFEST, "windows-service-identity-proof/Cargo.toml"],
    [CONTRACT, "windows-local-ipc/src/operation_contract.rs"],
    [IPC_FFI, "windows-local-ipc/src/windows_ffi.rs"],
  ]) {
    if (!fs.existsSync(f)) {
      e.push("C1 a required file is missing: " + label);
      return e;
    }
  }
  const instance = stripComments(fs.readFileSync(INSTANCE, "utf8"));
  const ffi = stripComments(fs.readFileSync(FFI, "utf8"));
  const canonLib = stripComments(fs.readFileSync(CANON_LIB, "utf8"));
  const manifest = fs.readFileSync(MANIFEST, "utf8");
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const ipcFfi = stripComments(fs.readFileSync(IPC_FFI, "utf8"));

  for (const item of [
    "pub(crate) struct PeerUserBinding",
    "pub(crate) struct PeerSessionBinding",
    "pub(crate) enum PeerPrincipalClass",
    "pub(crate) enum PeerIntegrityEvidence",
    "pub(crate) struct CanonicalPeerContribution",
    "pub(crate) fn decide_peer_contribution(",
    "pub(crate) fn record_ipc_peer_identity(",
    "pub(crate) fn reconcile_ipc_peer_identity(",
  ]) {
    if (!instance.includes(item)) e.push("C1 the attempt-scoped capture surface is missing: " + item);
  }
  if (!/pub unsafe fn observe_ipc_peer_identity\(/.test(ffi)) {
    e.push("C1 the live capture is not an attempt transition (observe_ipc_peer_identity is missing)");
  }

  // C2 - windows-local-ipc acquires no raw identity itself. This is the b3 boundary, restated so a
  // future edit to THIS phase's code cannot quietly re-cross it.
  for (const api of RAW_IDENTITY_APIS) {
    if (contract.includes(api)) {
      e.push("C2 the peer contract acquires raw identity itself; that belongs to the canonical crate: " + api);
    }
    if (ipcFfi.includes(api)) {
      e.push("C2 windows-local-ipc/windows_ffi.rs acquires raw identity itself, which b3 forbids: " + api);
    }
  }

  // C3 - the canonical crate asks for the MINIMUM rights, and nothing wider.
  if (!/OpenProcess\(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id\)/.test(ffi)) {
    e.push("C3 the peer process is no longer opened with the limited query right only");
  }
  if (!/OpenThreadToken\(GetCurrentThread\(\), TOKEN_QUERY, false, &mut token\)/.test(ffi)) {
    e.push("C3 the client token is no longer opened read-only under the impersonated context");
  }
  for (const wide of [
    "PROCESS_ALL_ACCESS",
    "PROCESS_VM_READ",
    "PROCESS_QUERY_INFORMATION,",
    "TOKEN_ALL_ACCESS",
    "TOKEN_ADJUST_PRIVILEGES",
    "TOKEN_DUPLICATE",
    "TOKEN_IMPERSONATE",
    "TOKEN_ASSIGN_PRIMARY",
    "TOKEN_WRITE",
    "DuplicateToken",
    "SetThreadToken",
    "AdjustTokenPrivileges",
    "ImpersonateLoggedOnUser",
    "CreateProcessAsUser",
    "OpenProcessToken",
    "SeDebugPrivilege",
  ]) {
    if (ffi.includes(wide)) e.push("C3 the canonical capture reaches beyond read-only identity: " + wide);
  }
  // The manifest must declare exactly the security feature that was authorised, and no more.
  if (!/"Win32_Security",/.test(manifest)) {
    e.push("C3 the canonical manifest no longer declares the authorised Win32_Security feature");
  }
  for (const wide of [
    '"Win32_System_Registry"',
    '"Win32_Networking',
    '"Win32_Security_Cryptography"',
    '"Win32_Security_Authorization"',
  ]) {
    if (manifest.includes(wide)) e.push("C3 the canonical manifest gained an unauthorised Windows feature: " + wide);
  }

  // C4a - reversion is guaranteed by Drop and VERIFIED, not assumed.
  if (!/impl Drop for ImpersonatedPipeClient/.test(ffi)) {
    e.push("C4a the impersonation guard has no Drop; a failure path could leave the thread impersonating");
  }
  const drop = fnBody(ffi, "impl Drop for ImpersonatedPipeClient");
  if (!drop || !/RevertToSelf\(\)/.test(drop) || !/self\.reverted\.set\(/.test(drop)) {
    e.push("C4a the guard's Drop no longer reverts and records the result");
  }
  const decide = fnBody(instance, "pub(crate) fn decide_peer_contribution(");
  if (!decide) {
    e.push("C4a decide_peer_contribution is missing");
  } else {
    const revertAt = decide.indexOf("impersonation_reverted");
    const instanceAt = decide.indexOf("ServiceInstanceObservation::Observed");
    const userAt = decide.indexOf("token_user");
    if (revertAt === -1) e.push("C4a the decision core no longer checks that impersonation reverted");
    for (const [name, at] of [["the instance check", instanceAt], ["the user check", userAt]]) {
      if (at !== -1 && revertAt !== -1 && at < revertAt) {
        e.push("C4a " + name + " precedes the reversion check; an unreverted capture must be refused first");
      }
    }
    // C9 - integrity must not participate in ANY refusal. Positionally: every refusal branch must be
    // decided BEFORE integrity is first consulted, so integrity cannot gate a refusal no matter how the
    // branches are arranged.
    const lastRefusal = decide.lastIndexOf("PeerContributionOutcome::Refused(");
    const firstIntegrity = decide.search(/integrity/i);
    if (firstIntegrity !== -1 && lastRefusal !== -1 && firstIntegrity < lastRefusal) {
      e.push("C9 integrity is consulted before a refusal is decided; it must be non-authorising evidence only");
    }
  }

  // C5 - only the token reads happen inside the impersonation window.
  const capture = fnBody(ffi, "unsafe fn capture_peer_identity_facts(");
  if (!capture) {
    e.push("C5 the private impersonation-window helper is missing");
  } else {
    const from = capture.indexOf("ImpersonatedPipeClient::enter");
    const window = from === -1 ? "" : capture.slice(from, capture.indexOf("facts.impersonated = "));
    if (!/read_impersonated_token_facts\(\)/.test(window)) {
      e.push("C5 the impersonation window no longer performs the token read");
    }
    for (const bad of [
      "ReadFile",
      "WriteFile",
      "CreateFileW",
      "ConnectNamedPipe",
      "OpenProcess",
      "GetProcessTimes",
      "QueryServiceStatusEx",
      "RegOpenKey",
      "fs::",
    ]) {
      if (window.includes(bad)) e.push("C5 work other than the token read happens while impersonating: " + bad);
    }
    if (!/facts\.impersonation_reverted = reverted\.get\(\)/.test(capture)) {
      e.push("C5 the capture no longer records whether the revert actually succeeded");
    }
    // The process observation must be OUTSIDE the window: it is done by the transition, before the
    // guard is entered.
    if (/observe_named_pipe_peer_instance/.test(capture)) {
      e.push("C5 the process observation was moved inside the impersonation window");
    }
  }

  // C6 - no handle escapes, and both handles close through RAII rather than a manual CloseHandle.
  const tokenRead = fnBody(ffi, "unsafe fn read_impersonated_token_facts()");
  if (!tokenRead) {
    e.push("C6 read_impersonated_token_facts is missing");
  } else if (!/adopt\(token\)/.test(tokenRead) || !/win32\(&owned\)/.test(tokenRead)) {
    e.push("C6 the client token handle is not adopted into the RAII primitive");
  }
  if (/CloseHandle/.test(ffi)) {
    e.push("C6 a handle is closed manually instead of through the canonical RAII primitive");
  }
  if (!/adopt\(raw\)/.test(ffi)) {
    e.push("C6 the temporary process handle is no longer adopted into the RAII primitive");
  }
  for (const sig of ["pub unsafe fn observe_ipc_peer_identity(", "pub unsafe fn reobserve_ipc_peer_identity("]) {
    if (/->\s*(HANDLE|std::os::windows::io::OwnedHandle)/.test(fnBody(ffi, sig) || "")) {
      e.push("C6 an attempt transition returns a handle");
    }
  }

  // C7 - exact identity is opaque, crate-private and unreadable.
  for (const t of ["PeerUserBinding", "PeerSessionBinding"]) {
    const body = fnBody(instance, "pub(crate) struct " + t);
    if (!body) {
      e.push("C7 " + t + " is missing");
      continue;
    }
    if (/\n    pub [a-z_]+:/.test(body)) {
      e.push("C7 " + t + " has a public field, so its identity content is readable");
    }
  }
  for (const re of [
    /impl PeerUserBinding \{[\s\S]*?fn (bytes|as_bytes|as_slice|raw|sid|value)\s*\(\s*&self/,
    /impl PeerSessionBinding \{[\s\S]*?fn (session|raw|value|id)\s*\(\s*&self/,
    /->\s*&\[u8\]/,
  ]) {
    if (re.test(instance)) e.push("C7 a readable accessor is exposed on an opaque binding: " + re);
  }
  for (const t of ["PeerUserBinding", "PeerSessionBinding", "CanonicalPeerContribution"]) {
    if (!new RegExp("impl fmt::Debug for " + t).test(instance)) {
      e.push("C7 " + t + " does not have a redacted Debug");
    }
  }
  if (/impl fmt::Display for Peer(User|Session)Binding/.test(instance)) {
    e.push("C7 an opaque binding implements Display");
  }
  if (/Serialize|Deserialize|serde/.test(instance)) {
    e.push("C7 the canonical identity module references serialisation");
  }

  // C8 - classification is a FAIL-CLOSED GATE derived from the user SID alone. It never replaces exact
  // identity, and it never reads a group or an integrity level.
  const classify = fnBody(instance, "pub(crate) fn from_user_binding(");
  if (!classify) {
    e.push("C8 the bounded classification is missing");
  } else {
    if (!/user\.authority\(\)/.test(classify) || !/user\.first_sub_authority\(\)\?/.test(classify)) {
      e.push("C8 classification no longer derives from the token user SID alone");
    }
    for (const bad of ["integrity", "Integrity", "group", "Group", "TokenGroups", "elevat"]) {
      if (classify.includes(bad)) {
        e.push("C8 classification consults something other than the user SID: " + bad);
      }
    }
    if (!/->\s*Option<Self>/.test(classify)) {
      e.push("C8 an unclassifiable principal no longer fails closed");
    }
  }
  // Scoped to the method body alone: a neighbouring method in the same impl must not be able to
  // satisfy, or fail, this assertion on its behalf.
  const matchesM = instance.match(/fn identity_matches\([\s\S]*?\n    \}/);
  const matches = matchesM && matchesM[0];
  if (!matches) {
    e.push("C8 the attempt has no exact-identity comparison");
  } else {
    for (const part of ["instance", "user", "session", "connection_id", "handshake_generation"]) {
      if (!new RegExp("self\\." + part + "\\s*==\\s*bound\\." + part).test(matches)) {
        e.push("C8 exact-identity comparison no longer compares " + part);
      }
    }
    // C9 - integrity must not be compared: a peer that elevates keeps the identity it had.
    if (/integrity/.test(matches)) {
      e.push("C9 exact-identity comparison consults integrity; it must be non-authorising evidence only");
    }
  }
  if (!instance.includes("two_different_users_of_the_same_class_remain_distinguishable")) {
    e.push("C8 the exact-user separation test is missing; classification could silently replace identity");
  }

  // C10 - nothing is publicly constructible, and no fixture route reaches identity at all.
  const contrib = fnBody(instance, "pub(crate) struct CanonicalPeerContribution");
  if (!contrib || !/_sealed:\s*Sealed/.test(contrib)) {
    e.push("C10 CanonicalPeerContribution is not sealed; it could be fabricated by struct literal");
  }
  if (/impl CanonicalPeerContribution \{[\s\S]*?pub fn (new|from_parts|observed)\s*\(/.test(instance)) {
    e.push("C10 CanonicalPeerContribution gained a public constructor");
  }
  for (const t of PEER_TYPES) {
    if (new RegExp("\\bpub\\s+(struct|enum)\\s+" + t + "\\b").test(instance)) {
      e.push("C10 " + t + " is publicly declared; peer identity must stay crate-private");
    }
    if (new RegExp("\\b" + t + "\\b").test(canonLib)) {
      e.push("C10 " + t + " is re-exported from the canonical crate's lib.rs");
    }
  }
  // The identity types must be gated to the graph where identity can legitimately originate, and never
  // to the fixture feature, so no fixture build carries a peer identity at all.
  for (const t of ["PeerUserBinding", "CanonicalPeerContribution"]) {
    const gate = attributesAbove(instance, "pub(crate) struct " + t);
    if (gate === null) {
      e.push("C10 cannot inspect the gate on " + t);
    } else if (!/windows-live-instance-observation/.test(gate) || /test-fixtures/.test(gate)) {
      e.push("C10 " + t + " is not gated to the live observation graph alone: " + gate);
    }
  }
  if (/synthetic_peer/.test(instance) || /synthetic_peer/.test(canonLib)) {
    e.push("C10 a synthetic peer-identity fixture exists; identity must have no fixture route");
  }
  if (/^default = \[.*test-fixtures/m.test(manifest) || /^default = \[.*windows-live/m.test(manifest)) {
    e.push("C10 a default feature enables fixtures or live observation");
  }

  // C11 - the attempt returns NO identity: only the next opaque state, or a closed verdict.
  if (
    new RegExp("\\bpub\\s+fn[^\\n]*->[^\\n]*(" + PEER_TYPES.join("|") + ")").test(instance) ||
    new RegExp("\\bpub\\s+unsafe\\s+fn[^\\n]*->[^\\n]*(" + PEER_TYPES.join("|") + ")").test(ffi)
  ) {
    e.push("C11 a public function returns a peer identity, an internal record or a reusable contribution");
  }
  for (const [sig, label] of [
    ["pub unsafe fn observe_ipc_peer_identity(", "capture"],
    ["pub unsafe fn reobserve_ipc_peer_identity(", "reconciliation"],
  ]) {
    const body = fnBody(ffi, sig);
    if (!body) {
      e.push("C11 the attempt-scoped " + label + " transition is missing");
      continue;
    }
    if (!/->\s*AttemptOutcome<IpcPeerObserved>/.test(body)) {
      e.push("C11 the " + label + " transition does not return an attempt outcome");
    }
    if (!/\(\s*\n?\s*self,/.test(body)) {
      e.push("C11 the " + label + " transition does not consume the attempt");
    }
    if (!/&LiveInstanceObservationCapability/.test(body)) {
      e.push("C11 the " + label + " transition does not demand the sealed observation capability");
    }
  }
  // Peer refusals collapse onto ONE closed verdict, so no token fact is disclosed by the reason.
  const collapse = fnBody(instance, "fn peer_refusal_verdict(");
  if (!collapse) {
    e.push("C11 peer refusals are not collapsed onto a closed verdict");
  } else {
    if (/_\s*=>/.test(collapse)) {
      e.push("C11 the peer refusal collapse uses a wildcard instead of an exhaustive match");
    }
    if ((collapse.match(/ServiceInstanceBinding::/g) || []).length !== 1) {
      e.push("C11 the peer refusal collapse discloses more than one verdict");
    }
  }
  // The peer identity is stored INSIDE the attempt's private store.
  const inner = fnBody(instance, "struct AttemptInner {");
  if (!inner || !/\n\s*peer:\s*Option<Box<CanonicalPeerContribution>>,/.test(inner)) {
    e.push("C11 the attempt does not retain the captured peer identity internally");
  }

  // C12 - process-creation identity still binds the peer, and a captured peer still cannot bypass C4.
  const tokenDecl = fnBody(instance, "pub struct ServiceInstanceToken {");
  if (!tokenDecl || !/creation_time:\s*u64/.test(tokenDecl) || !/process_id:\s*u32/.test(tokenDecl)) {
    e.push("C12 the opaque instance no longer carries BOTH process id and creation time (PID reuse)");
  }
  if (!instance.includes("a_reused_pid_with_a_different_creation_identity_is_refused")) {
    e.push("C12 the PID-reuse test is missing");
  }
  const evalBody = fnBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("C12 evaluate_protected_operation is missing");
  } else {
    if (!/if !OwnerPresenceGate::current\(\)\.is_closed\(\) \{/.test(evalBody)) {
      e.push("C12 the C4 gate is no longer an unconditional hard stop");
    }
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("C12 evaluation can accept or complete a protected operation while C4 is open");
    }
  }

  return e;
}

module.exports = { run };
