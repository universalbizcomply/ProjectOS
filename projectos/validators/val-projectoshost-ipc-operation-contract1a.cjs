// Validator: PROJECTOSHOST-IPC-OPERATION-CONTRACT1A (F2/F3 phase 1)
//
// Fails closed. Pins the protected-operation contract so a later change cannot silently make the wire
// able to carry a secret, let caller data become authority, or open a path to a protected effect while
// C4 is still open.
//
// The threat each assertion answers:
//   O1  the contract module exists at the committed path
//   O2  the wire is SECRET-FREE BY CONSTRUCTION - no String, Vec<u8>, map, serde or free-form text, so a
//       credential/token/cookie/key/command/path is not merely rejected but unrepresentable
//   O3  no generic payload accessor exists (the same rule the status contract already enforces)
//   O4  both payload lengths are fixed constants and fit the accepted 471-byte ceiling
//   O5  the C4 gate cannot report closed - one variant, is_closed() returns false unconditionally
//   O6  evaluation checks C4 FIRST, so no later check can be failed into an acceptance
//   O7  TrustedPeerContext has NO constructor in this phase
//   O8  the trusted types are sealed against struct-literal fabrication
//   O9  Completed/Accepted require the host-held authority, so a caller cannot assert an effect ran
//   O10 InstalledHostStatus is NOT overloaded - its kind, discriminant and length are untouched
//   O11 the protected-operation kinds are registered with fixed discriminants and lengths
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const PROTOCOL = path.join(IPC, "protocol.rs");

/**
 * Strip line comments and doc comments before any "token must be absent" check, so prose describing a
 * forbidden construct can never fail the build and, more importantly, a forbidden construct can never
 * hide behind a comment.
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

/** The body of a function, from its signature to the next top-level `}`. */
function fnBody(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const rest = src.slice(at);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

function run() {
  const e = [];

  // O1
  if (!fs.existsSync(CONTRACT)) {
    e.push("O1 the protected-operation contract module is missing: windows-local-ipc/src/operation_contract.rs");
    return e;
  }
  if (!fs.existsSync(PROTOCOL)) {
    e.push("O1 protocol.rs is missing");
    return e;
  }
  const contractRaw = fs.readFileSync(CONTRACT, "utf8");
  const contract = stripComments(contractRaw);
  const protocol = stripComments(fs.readFileSync(PROTOCOL, "utf8"));

  // O2 - secret-free by construction. These are the shapes that could carry an unbounded or free-form
  // value. Absent from the contract module, a secret cannot be spelled on this wire.
  for (const bad of ["String", "Vec<u8>", "HashMap", "BTreeMap", "serde", "&str"]) {
    if (contract.includes(bad)) {
      e.push("O2 the operation contract gained a free-form or unbounded shape, so the wire is no longer secret-free: " + bad);
    }
  }

  // O3 - no generic payload accessor, matching the rule the status contract already enforces.
  for (const re of [/pub fn payload\s*\(/, /pub fn payload_bytes\s*\(/, /pub fn body\s*\(/, /pub fn as_bytes\s*\(/, /->\s*&\[u8\]/]) {
    if (re.test(contract)) e.push("O3 a generic payload accessor is exposed on the operation contract: " + re);
  }

  // O4 - fixed lengths, within the accepted ceiling, pinned at compile time.
  if (!/pub const PROTECTED_OPERATION_REQUEST_LEN: usize =/.test(protocol)) {
    e.push("O4 PROTECTED_OPERATION_REQUEST_LEN is not defined in protocol.rs");
  }
  if (!/pub const PROTECTED_OPERATION_RESPONSE_LEN: usize =/.test(protocol)) {
    e.push("O4 PROTECTED_OPERATION_RESPONSE_LEN is not defined in protocol.rs");
  }
  if (!/const _: \(\) = assert!\(PROTECTED_OPERATION_REQUEST_LEN <= MAX_PAYLOAD_LEN\);/.test(protocol)) {
    e.push("O4 the compile-time ceiling check for the request payload is gone");
  }
  if (!/const _: \(\) = assert!\(PROTECTED_OPERATION_RESPONSE_LEN <= MAX_PAYLOAD_LEN\);/.test(protocol)) {
    e.push("O4 the compile-time ceiling check for the response payload is gone");
  }

  // O5 - the C4 hard stop. One variant, and is_closed can only return false.
  if (!/pub enum OwnerPresenceGate \{\s*Open,\s*\}/.test(contract.replace(/\s+/g, " ").replace(/pub enum OwnerPresenceGate \{ Open, \}/, "pub enum OwnerPresenceGate {\n Open,\n}"))) {
    // Fall back to a direct structural check: exactly one variant named Open.
    const body = fnBody(contract, "pub enum OwnerPresenceGate");
    if (!body || !/\bOpen\b/.test(body) || /\bClosed\b/.test(body)) {
      e.push("O5 OwnerPresenceGate is no longer a single open variant");
    }
  }
  const isClosed = fnBody(contract, "pub fn is_closed(self) -> bool");
  if (!isClosed) {
    e.push("O5 OwnerPresenceGate::is_closed is missing");
  } else if (!/\bfalse\b/.test(isClosed) || /\btrue\b/.test(isClosed)) {
    e.push("O5 OwnerPresenceGate::is_closed no longer returns false unconditionally - the C4 hard stop is defeated");
  }

  // O6 - C4 is evaluated FIRST. Anything checked before it could be failed into bypassing it.
  const evalBody = fnBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("O6 evaluate_protected_operation is missing");
  } else {
    const gateAt = evalBody.indexOf("OwnerPresenceGate::current()");
    const peerAt = evalBody.indexOf("peer.is_none()");
    const epochAt = evalBody.indexOf("claimed_service_epoch()");
    if (gateAt === -1) {
      e.push("O6 evaluate_protected_operation no longer consults the C4 gate");
    }
    if (peerAt !== -1 && gateAt !== -1 && peerAt < gateAt) {
      e.push("O6 the peer check precedes the C4 gate; C4 must be checked first");
    }
    if (epochAt !== -1 && gateAt !== -1 && epochAt < gateAt) {
      e.push("O6 the epoch check precedes the C4 gate; C4 must be checked first");
    }
    // No path may mint an acceptance in this phase.
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("O6 evaluate_protected_operation can return an accepted or completed state while C4 is open");
    }
  }

  // O7 - TrustedPeerContext must have no constructor in this phase.
  if (!/pub struct TrustedPeerContext/.test(contract)) {
    e.push("O7 TrustedPeerContext is missing");
  }
  for (const re of [/impl TrustedPeerContext \{[\s\S]*?pub fn new\s*\(/, /impl TrustedPeerContext \{[\s\S]*?pub\(crate\) fn new\s*\(/]) {
    if (re.test(contract)) {
      e.push("O7 TrustedPeerContext gained a constructor; kernel-attested peer identity is phase 2, not phase 1");
    }
  }

  // O8 - the trusted types are sealed so no downstream crate can write a struct literal.
  if (!/mod sealed \{/.test(contract) || !/pub struct Seal;/.test(contract)) {
    e.push("O8 the private seal is missing; trusted types could be fabricated by struct literal");
  }
  for (const t of ["TrustedPeerContext", "AuthorisedProtectedOperation"]) {
    const body = fnBody(contract, "pub struct " + t);
    if (body && !/_seal:\s*Seal/.test(body)) {
      e.push("O8 " + t + " is no longer sealed");
    }
  }

  // O9 - Accepted and Completed require the host-held authority, never caller data.
  for (const fn of ["pub fn accepted(", "pub fn completed("]) {
    const body = fnBody(contract, fn);
    if (!body) {
      e.push("O9 " + fn + ") is missing from the response contract");
    } else if (!/authority:\s*&AuthorisedProtectedOperation/.test(body)) {
      e.push("O9 " + fn + ") no longer requires an AuthorisedProtectedOperation, so a caller could assert an effect");
    }
  }
  // Admission must not imply execution.
  const acceptedBody = fnBody(contract, "pub fn accepted(");
  if (acceptedBody && !/ResultClass::NotRun/.test(acceptedBody)) {
    e.push("O9 accepted() no longer reports NotRun; ACCEPTED must never imply an executed effect");
  }

  // O10 - InstalledHostStatus is untouched.
  if (!/Self::InstalledHostStatus => 8,/.test(protocol)) {
    e.push("O10 the InstalledHostStatus discriminant changed; it must stay 8");
  }
  if (!/MessageKind::InstalledHostStatus => INSTALLED_HOST_STATUS_LEN,/.test(protocol)) {
    e.push("O10 the InstalledHostStatus payload length binding changed");
  }

  // O11 - the new family is registered with fixed discriminants and lengths.
  if (!/Self::ProtectedOperationRequest => 9,/.test(protocol)) {
    e.push("O11 ProtectedOperationRequest is not registered at discriminant 9");
  }
  if (!/Self::ProtectedOperationResponse => 10,/.test(protocol)) {
    e.push("O11 ProtectedOperationResponse is not registered at discriminant 10");
  }
  if (!/MessageKind::ProtectedOperationRequest => PROTECTED_OPERATION_REQUEST_LEN,/.test(protocol)) {
    e.push("O11 the request kind has no fixed payload length in the length table");
  }
  if (!/MessageKind::ProtectedOperationResponse => PROTECTED_OPERATION_RESPONSE_LEN,/.test(protocol)) {
    e.push("O11 the response kind has no fixed payload length in the length table");
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectoshost-ipc-operation-contract1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectoshost-ipc-operation-contract1a: PASS");
}
