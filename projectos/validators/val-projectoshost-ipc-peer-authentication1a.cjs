// Validator: PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A (F2/F3 phase 2)
//
// SUPERSEDED IN PART. Read this header before adding anything back.
//
// This validator originally pinned a peer-authentication CONTRACT that lived in `windows-local-ipc`:
// raw fixed-size SID storage, raw Windows session identity, bounded integrity levels, an
// observed-evidence input model, peer classification, and `authenticate_peer` / `reauthenticate_peer`.
//
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A (`b8cca6d`) made the canonical identity-proof crate the SOLE
// owner of peer identity: identity is captured inside a bounded attempt, compared there, and never
// crosses into this crate in any form. PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A then RETIRED
// the duplicate model here, because two identity vocabularies would be contradictory rather than
// redundant.
//
// Accordingly the assertions that described the retired model are GONE, and their replacement is
// ABSENCE, enforced by `val-projectoshost-ipc-peer-contract-reconciliation1a`. Nothing was weakened to
// let the retirement pass: what was removed here no longer exists to assert, and what is still true is
// asserted below unchanged.
//
// WHAT SURVIVES, because it was never about the identity model:
//   P9  an admitted peer still cannot bypass C4, and nothing can become ACCEPTED or COMPLETED
//   P10 this crate does not acquire live process or token identity itself (the b3 boundary, restated
//       locally so a future edit to THIS crate's code cannot quietly cross it)
//
// DELIBERATELY NOT RE-ADDED: P1-P8. Reinstating any of them would require reinstating the retired
// model, which is exactly what the reconciliation validator forbids.
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

function run() {
  const e = [];

  for (const [f, label] of [[CONTRACT, "operation_contract.rs"], [FFI, "windows_ffi.rs"], [LIB, "lib.rs"]]) {
    if (!fs.existsSync(f)) {
      e.push("P1 a required source file is missing: windows-local-ipc/src/" + label);
      return e;
    }
  }
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const ffi = stripComments(fs.readFileSync(FFI, "utf8"));

  // P9 - an admitted peer is still not authority.
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
      e.push("P9 the peer check precedes the C4 gate; an admitted peer must not be able to bypass C4");
    }
    // The hard stop must be UNCONDITIONAL. Any extra term on the gate condition - most obviously a peer
    // test - would let an admitted peer skip it, which is exactly the bypass this must not create.
    if (!/if !OwnerPresenceGate::current\(\)\.is_closed\(\) \{/.test(evalBody)) {
      e.push("P9 the C4 gate is no longer an unconditional hard stop; its condition gained an extra term");
    }
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("P9 evaluation can accept or complete a protected operation while C4 is open");
    }
  }

  // P10 - the b3 boundary, restated locally. This crate must not acquire identity itself.
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
