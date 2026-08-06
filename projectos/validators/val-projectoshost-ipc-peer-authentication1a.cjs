// Validator: PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A (F2/F3 phase 2, Option-A amended)
//
// Fails closed. Pins the peer-authentication CONTRACT.
//
// SCOPE NOTE, stated so this file cannot be misread as claiming more than it proves: live kernel peer
// capture is NOT part of this phase. The accepted invariant `val-windows-local-ipc-capability-b3`
// assigns raw process and token identity to the canonical identity-proof crate, and that invariant is
// not amended here. Accordingly this validator asserts nothing about `windows_ffi.rs`, which is
// byte-identical to its committed state, and it actively FORBIDS a live capture appearing in this crate.
//
// The threat each assertion answers:
//   P1 the peer-authentication surface exists at the committed path
//   P2 TrustedPeerContext has NO public constructor - the only mint is private with exactly one caller,
//      so a trusted context cannot be fabricated from anything but authenticated evidence
//   P3 ObservedPeerEvidence is PRODUCTION-INERT - private fields, sealed, and constructible only under
//      cfg(test) or the non-default fixture graph, so no production path can forge evidence
//   P4 peer identity stays secret-free and byte-bounded - a SID is bounded bytes with no slice accessor
//   P5 PID is bound to process creation identity, and a dead process is refused - PID reuse cannot
//      promote a later process into an earlier peer's context
//   P6 wire data cannot reach identity - expectations are caller/host parameters, never the DTO
//   P7 classification uses the user SID alone - not integrity, not groups, so a filtered administrator
//      token cannot promote an ordinary user
//   P8 re-authentication refuses a changed SID, session, integrity or process, and unknown values fail
//      closed rather than being coerced
//   P9 an authenticated peer still cannot bypass C4, and nothing can become ACCEPTED or COMPLETED
//   P10 this crate does not acquire live process or token identity itself (the b3 boundary, restated
//      locally so a future edit to THIS phase's code cannot quietly cross it)
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const FFI = path.join(IPC, "windows_ffi.rs");
const LIB = path.join(IPC, "lib.rs");

/**
 * Strip line and doc comments before any "token must be absent" check, so prose describing a forbidden
 * construct cannot fail the build and, more importantly, a forbidden construct cannot hide in a comment.
 */
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
  return attrs;
}

/** The single non-default gate under which synthetic peer evidence may be built. */
const EVIDENCE_GATE = '#[cfg(any(test, feature = "test-fixtures"))]';

function run() {
  const e = [];

  // P1
  for (const [f, label] of [[CONTRACT, "operation_contract.rs"], [FFI, "windows_ffi.rs"], [LIB, "lib.rs"]]) {
    if (!fs.existsSync(f)) {
      e.push("P1 a required source file is missing: windows-local-ipc/src/" + label);
      return e;
    }
  }
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const ffi = stripComments(fs.readFileSync(FFI, "utf8"));
  const lib = stripComments(fs.readFileSync(LIB, "utf8"));

  for (const item of [
    "pub fn authenticate_peer(",
    "pub fn reauthenticate_peer(",
    "pub struct ObservedPeerEvidence",
    "pub struct TokenUserSid",
    "pub enum PeerAuthenticationError",
    "pub enum IntegrityLevel",
  ]) {
    if (!contract.includes(item)) e.push("P1 the peer-authentication surface is missing: " + item);
  }
  if (!/pub use operation_contract::\{[\s\S]{0,500}?authenticate_peer/.test(lib)) {
    e.push("P1 authenticate_peer is not re-exported from lib.rs");
  }

  // P2 - a trusted context cannot be fabricated. The mint stays private with exactly one caller.
  if (/pub fn mint\s*\(/.test(contract) || /pub\(crate\) fn mint\s*\(/.test(contract)) {
    e.push("P2 TrustedPeerContext::mint became reachable outside the contract module; peer identity could be fabricated");
  }
  if (!/\n    fn mint\(/.test(contract)) {
    e.push("P2 the private TrustedPeerContext mint is missing");
  }
  const mintCalls = (contract.match(/TrustedPeerContext::mint\s*\(/g) || []).length;
  if (mintCalls !== 1) {
    e.push("P2 TrustedPeerContext::mint has " + mintCalls + " call sites; exactly one (inside authenticate_peer) is allowed");
  }
  const authBody = fnBody(contract, "pub fn authenticate_peer(");
  if (!authBody) {
    e.push("P2 authenticate_peer is missing");
  } else if (!/TrustedPeerContext::mint\s*\(/.test(authBody)) {
    e.push("P2 the single mint call is not inside authenticate_peer");
  }
  for (const re of [
    /impl TrustedPeerContext \{[\s\S]*?pub fn new\s*\(/,
    /impl TrustedPeerContext \{[\s\S]*?pub\(crate\) fn new\s*\(/,
    /impl From<[^>]*> for TrustedPeerContext/,
  ]) {
    if (re.test(contract)) e.push("P2 TrustedPeerContext gained a public construction route: " + re);
  }

  // P3 - ObservedPeerEvidence is production-inert. This is what keeps the contract from becoming a
  // forgery route while live capture is deferred to the canonical crate.
  const evidenceBody = fnBody(contract, "pub struct ObservedPeerEvidence");
  if (!evidenceBody) {
    e.push("P3 ObservedPeerEvidence is missing");
  } else {
    if (/\n    pub [a-z_]+:/.test(evidenceBody)) {
      e.push("P3 ObservedPeerEvidence has a public field, so production code could construct evidence by struct literal");
    }
    if (!/_seal:\s*Seal/.test(evidenceBody)) {
      e.push("P3 ObservedPeerEvidence is not sealed; it could be fabricated by struct literal from another module");
    }
  }
  const observedAttrs = attributesAbove(contract, "    pub fn observed(");
  if (observedAttrs === null) {
    e.push("P3 the ObservedPeerEvidence constructor is missing");
  } else if (!observedAttrs.includes(EVIDENCE_GATE)) {
    e.push("P3 the ObservedPeerEvidence constructor is not gated to tests/fixtures, so a production build can forge peer evidence");
  }
  const sidCtorAttrs = attributesAbove(contract, "    pub fn from_kernel_bytes(");
  if (sidCtorAttrs === null) {
    e.push("P3 TokenUserSid::from_kernel_bytes is missing");
  } else if (!sidCtorAttrs.includes(EVIDENCE_GATE)) {
    e.push("P3 TokenUserSid::from_kernel_bytes is not gated to tests/fixtures, so a production build can mint an identity from arbitrary bytes");
  }
  for (const re of [/serde/, /Deserialize/, /impl From<ProtectedOperationRequest> for ObservedPeerEvidence/]) {
    if (re.test(contract)) {
      e.push("P3 peer evidence gained a deserialisation or wire-conversion route: " + re);
    }
  }

  // P4 - a SID is bounded bytes, never text, and exposes no slice.
  for (const bad of ["String", "Vec<u8>", "HashMap", "BTreeMap", "&str"]) {
    if (contract.includes(bad)) {
      e.push("P4 the contract module gained a free-form or unbounded shape, so peer identity is no longer secret-free: " + bad);
    }
  }
  for (const re of [/->\s*&\[u8\]/, /pub fn bytes\s*\(/, /pub fn as_bytes\s*\(/, /pub fn raw\s*\(/]) {
    if (re.test(contract)) e.push("P4 a byte accessor is exposed on the peer surface: " + re);
  }
  if (!/pub const SID_MAX_LEN: usize = 68;/.test(contract)) {
    e.push("P4 SID_MAX_LEN is no longer pinned to the 68-byte SECURITY_MAX_SID_SIZE bound");
  }
  const sidCtor = fnBody(contract, "pub fn from_kernel_bytes(");
  if (!sidCtor || !/raw\.len\(\) < Self::MIN_LEN \|\| raw\.len\(\) > SID_MAX_LEN/.test(sidCtor)) {
    e.push("P4 TokenUserSid::from_kernel_bytes no longer bounds the SID length on both sides");
  }

  // P5 - creation identity, not PID alone; a dead process refused.
  if (authBody) {
    if (!/live_pid != evidence\.client_pid \|\| live_tick != evidence\.client_creation_tick/.test(authBody)) {
      e.push("P5 authenticate_peer no longer binds PID to process creation identity; a reused PID could inherit an earlier peer");
    }
    if (!/ClientProcessExited/.test(authBody)) {
      e.push("P5 authenticate_peer no longer refuses a process that has exited");
    }
    // P6 - expectations are parameters supplied by the host, never anything the peer sent.
    if (!/expected_connection_id:\s*u64/.test(contract) || !/expected_handshake_generation:\s*u64/.test(contract)) {
      e.push("P6 the connection/handshake expectations are no longer explicit caller-supplied parameters");
    }
    if (/ProtectedOperationRequest/.test(authBody)) {
      e.push("P6 authenticate_peer reads the wire DTO; peer identity must never come from anything the peer sent");
    }
  }

  // P7 - the class comes from the SID alone.
  const classify = fnBody(contract, "    fn classify(&self)");
  if (!classify) {
    e.push("P7 TokenUserSid::classify is missing or became public");
  } else {
    for (const bad of ["integrity", "IntegrityLevel", "session", "group", "Group"]) {
      if (classify.includes(bad)) {
        e.push("P7 peer classification consults something other than the token SID: " + bad);
      }
    }
    for (const cls of ["PeerUserClass::System", "PeerUserClass::Service", "PeerUserClass::Owner"]) {
      if (!classify.includes(cls)) e.push("P7 the bounded peer classes are no longer derived in classify(): " + cls);
    }
  }

  // P8 - a bound connection refuses a changed identity, and unknown values fail closed.
  const rebind = fnBody(contract, "pub fn reauthenticate_peer(");
  if (!rebind) {
    e.push("P8 reauthenticate_peer is missing");
  } else {
    for (const [field, err] of [
      ["token_user_sid()", "UserSidMismatch"],
      ["client_session()", "SessionMismatch"],
      ["integrity()", "IntegrityMismatch"],
      ["client_pid()", "ProcessCreationMismatch"],
    ]) {
      if (!rebind.includes(field) || !rebind.includes(err)) {
        e.push("P8 re-authentication no longer refuses a changed " + field + " (expected " + err + ")");
      }
    }
    if (!/authenticate_peer\(/.test(rebind)) {
      e.push("P8 re-authentication skips the full first-observation checks; a replayed observation could arrive second and bypass them");
    }
  }
  const fromRid = fnBody(contract, "pub fn from_rid(rid: u32) -> Option<Self>");
  if (!fromRid) {
    e.push("P8 IntegrityLevel::from_rid is missing or no longer returns Option");
  } else if (!/_ => return None,/.test(fromRid)) {
    e.push("P8 an unknown integrity RID no longer fails closed");
  }
  if (authBody && !/UnknownPeerClass/.test(authBody)) {
    e.push("P8 an unclassifiable SID no longer fails closed");
  }

  // P9 - authenticated identity is still not authority.
  const evalBody = fnBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("P9 evaluate_protected_operation is missing");
  } else {
    const gateAt = evalBody.indexOf("OwnerPresenceGate::current()");
    const peerAt = evalBody.indexOf("peer.is_none()");
    if (gateAt === -1) {
      e.push("P9 evaluation no longer consults the C4 gate");
    }
    if (peerAt !== -1 && gateAt !== -1 && peerAt < gateAt) {
      e.push("P9 the peer check precedes the C4 gate; an authenticated peer must not be able to bypass C4");
    }
    // The hard stop must be UNCONDITIONAL. Any extra term on the gate condition - most obviously a peer
    // test - would let an authenticated peer skip it, which is exactly the bypass this phase must not create.
    if (!/if !OwnerPresenceGate::current\(\)\.is_closed\(\) \{/.test(evalBody)) {
      e.push("P9 the C4 gate is no longer an unconditional hard stop; its condition gained an extra term");
    }
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("P9 evaluation can accept or complete a protected operation while C4 is open");
    }
  }

  // P10 - the b3 boundary, restated locally. This phase must not acquire identity itself.
  const OWNED_BY_CANONICAL = [
    "GetNamedPipeClientProcessId",
    "GetNamedPipeClientSessionId",
    "GetProcessTimes",
    "OpenProcess",
    "OpenThreadToken",
    "GetTokenInformation",
    "ImpersonateNamedPipeClient",
    "RevertToSelf",
  ];
  for (const api of OWNED_BY_CANONICAL) {
    if (contract.includes(api)) {
      e.push("P10 the contract module acquires live identity itself; that belongs to the canonical identity-proof crate: " + api);
    }
    if (ffi.includes(api)) {
      e.push("P10 windows_ffi.rs acquires live identity itself, which val-windows-local-ipc-capability-b3 forbids: " + api);
    }
  }

  return e;
}

module.exports = { run };
