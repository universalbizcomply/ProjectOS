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
//   O7  TrustedPeerContext is minted ONLY from the sealed canonical peer admission - never from
//       caller data, a boolean, or the public verdict enum
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

  // O7 - TrustedPeerContext may be minted ONLY from the sealed canonical peer admission.
  //
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - AUTHORITY REACHABILITY, gate-authorised).
  // O7 originally required NO constructor at all, because kernel-attested peer identity was a later
  // phase. That phase has now arrived, so the rule changes shape rather than disappearing: the
  // absence of a constructor is replaced by a constraint on WHICH constructor may exist. What must
  // never come back is a constructor a caller can satisfy from data it holds - the whole point is
  // that a peer is established by a completed canonical attempt, never asserted.
  if (!/pub struct TrustedPeerContext/.test(contract)) {
    e.push("O7 TrustedPeerContext is missing");
  }
  {
    // THE SCAN MUST COVER THE WHOLE TYPE, NOT THE FIRST BLOCK OF IT. Splitting on the first
    // `impl TrustedPeerContext {` and taking segment [1] reads only ONE inherent block: a second
    // block appended anywhere else in the file lands in segment [2] and was invisible, and a trait
    // impl (`impl From<(u64, u64)> for TrustedPeerContext`) never matched the split token at all.
    // Both bypasses were demonstrated against this very check. Rather than trying to parse every
    // block, the shape is PINNED: exactly one inherent block, and no trait impl for the type. A
    // second block is then a validator failure rather than a blind spot.
    const inherentBlocks = (contract.match(/impl TrustedPeerContext\s*\{/g) || []).length;
    if (inherentBlocks !== 1) {
      e.push("O7 expected exactly one `impl TrustedPeerContext` block, found " + inherentBlocks + "; the public-function enumeration below only covers one");
    }
    if (/impl(?:<[^>]*>)?\s+[^\n]*\bfor\s+TrustedPeerContext\b/.test(contract)) {
      e.push("O7 a trait impl for TrustedPeerContext exists; a trait could mint the type outside the enumerated block");
    }
    const impls = contract.split(/impl TrustedPeerContext\s*\{/)[1] || "";
    const body = impls.split(/\n\}/)[0];
    // AN ALLOWLIST, NOT A DENYLIST. Enumerating known-bad constructor names would pass anything
    // spelled differently - `from_ids(connection_id: u64, handshake_generation: u64)` names nothing
    // forbidden and would have sailed through. So every public function on the type is enumerated
    // and checked against the closed set that is allowed to exist; a new one fails until it is
    // ruled on by name.
    const ALLOWED = new Set([
      "from_verified_peer_admission", // the ONE mint: consumes the sealed canonical admission
      "connection_id", // read-only accessor
      "handshake_generation", // read-only accessor
      "is_bound_to", // read-only comparison
    ]);
    // GENERICS TOLERATED. `pub fn evil<T>(flag: bool)` put a `<...>` between the name and the paren,
    // so the old regex matched nothing and the function escaped both this enumeration AND the
    // bool/verdict checks below. Also demonstrated against this check.
    const publicFns = [...body.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
    for (const name of publicFns) {
      if (!ALLOWED.has(name)) {
        e.push("O7 TrustedPeerContext gained an unruled public function `" + name + "`; a peer must be proven, not asserted");
      }
    }
    // The ONE permitted mint MUST exist and MUST consume the sealed admission. Asserted rather than
    // checked-if-present: if it disappears or is reshaped, that is exactly when O7 must speak up.
    if (!/pub fn from_verified_peer_admission\s*\(\s*admission\s*:\s*&[^)]*VerifiedPeerAdmission\s*,?\s*\)/.test(body)) {
      e.push("O7 the sealed peer-admission mint is missing or no longer consumes a &VerifiedPeerAdmission");
    } else {
      // THE CALLS MUST BE THE FIELD VALUES, not merely present somewhere in the body. Checking that
      // `admission.connection_id()` appears anywhere was satisfied by
      // `let _ = admission.connection_id();` followed by `connection_id: 999` - a mint that consults
      // the admission and then ignores it. Anchoring the accessor to the struct-literal field
      // position is what makes "read off the admission" the thing actually checked.
      for (const field of ["connection_id", "handshake_generation"]) {
        const initialised = new RegExp(field + "\\s*:\\s*admission\\." + field + "\\s*\\(\\s*\\)");
        if (!initialised.test(body)) {
          e.push("O7 the peer mint does not initialise `" + field + "` from `admission." + field + "()`");
        }
      }
      if (/from_verified_peer_admission[\s\S]{0,200}?(connection_id|handshake_generation)\s*:\s*u64/.test(body)) {
        e.push("O7 the peer mint accepts a caller-supplied identifier alongside the admission");
      }
    }
    // NO MACRO MAY EXPAND INSIDE THE ENUMERATED BLOCK. A `macro_rules!` invocation is one token to a
    // text scan and an arbitrary `pub fn` to the compiler, so a forbidden constructor could be
    // written once elsewhere and invoked here while every check above saw nothing. The contract
    // needs no macro in this impl, so the honest rule is that there must not be one.
    if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
      e.push("O7 a macro is invoked inside the TrustedPeerContext impl; it could expand to a constructor this scan cannot see");
    }
    // And no shape that lets a caller assert the answer, whatever it is called.
    for (const [re, why] of [
      [/pub[^\n]*fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*bool/, "a public function taking a bool"],
      [/pub[^\n]*fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*&?ServiceInstanceBinding/, "a public function taking the verdict enum"],
    ]) {
      if (re.test(body)) {
        e.push("O7 TrustedPeerContext exposes " + why + "; a verdict is a description, not authority");
      }
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
