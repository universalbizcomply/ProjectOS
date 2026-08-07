// Validator: PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A
//
// Fails closed. Pins the ABSENCE of a duplicate peer-identity model in `windows-local-ipc`.
//
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A (`b8cca6d`) made the canonical identity-proof crate the sole
// owner of peer identity: it is captured inside a bounded attempt, compared there, and no reusable
// contribution ever crosses a crate boundary. This phase retired the superseded model that still lived
// in `windows-local-ipc`. Two identity vocabularies would be contradictory, not merely redundant, so the
// invariant this validator defends is that the retired one does not come back.
//
// The threat each assertion answers (and the R-mutation it kills):
//   N1  the reduced surface exists at the committed paths
//   N2  no raw SID storage and no raw session identity in production local-ipc      (R1, R2)
//   N3  no integrity vocabulary at all - so integrity cannot authorise or refuse    (R3)
//   N4  the ONLY TrustedPeerContext constructor is cfg(test); no shipped graph has one (R4)
//   N5  no production mint and no authentication entry point in this crate          (R5)
//   N6  wire values cannot reach a peer context - no conversion, no deserialisation (R6)
//   N7  C4 is still the first unconditional hard stop, with no acceptance path      (R7)
//   N8  the regression test that proves the retired vocabulary is absent still exists
//   N9  lib.rs re-exports none of the retired names
//   N10 the canonical crate still owns identity, so nothing was merely relocated here
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const LIB = path.join(IPC, "lib.rs");
const CANON = path.join(ROOT, "projectos", "host", "windows-service-identity-proof", "src");
const INSTANCE = path.join(CANON, "instance.rs");

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
  return attrs;
}

/**
 * The retired vocabulary. Each entry is assembled from pieces so this validator's own source can be
 * scanned by the same rule without matching itself.
 */
const RETIRED = [
  ["TokenUser", "Sid"],
  ["Observed", "PeerEvidence"],
  ["Peer", "AuthenticationError"],
  ["Integrity", "Level"],
  ["Integrity", "Mismatch"],
  ["SID_MAX", "_LEN"],
  ["authenticate", "_peer"],
  ["reauthenticate", "_peer"],
  ["PeerUser", "Class"],
  ["from_kernel", "_bytes"],
  ["client_creation", "_tick"],
  ["token_user", "_sid"],
];

/** Canonical peer types. None may be named in this crate: identity must not be relocated, only removed. */
const CANONICAL_PEER_TYPES = [
  "CanonicalPeerContribution",
  "PeerUserBinding",
  "PeerSessionBinding",
  "PeerPrincipalClass",
  "PeerIntegrityEvidence",
  "PeerContributionOutcome",
  "PeerContributionRefusal",
];

function run() {
  const e = [];

  // N1
  for (const [f, label] of [
    [CONTRACT, "windows-local-ipc/src/operation_contract.rs"],
    [LIB, "windows-local-ipc/src/lib.rs"],
    [INSTANCE, "windows-service-identity-proof/src/instance.rs"],
  ]) {
    if (!fs.existsSync(f)) {
      e.push("N1 a required file is missing: " + label);
      return e;
    }
  }
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const lib = stripComments(fs.readFileSync(LIB, "utf8"));
  const instance = stripComments(fs.readFileSync(INSTANCE, "utf8"));

  if (!/pub struct TrustedPeerContext/.test(contract)) {
    e.push("N1 TrustedPeerContext is missing; the sealed marker layer 3 is defined against must remain");
  }
  const ctx = fnBody(contract, "pub struct TrustedPeerContext");
  if (!ctx) {
    e.push("N1 cannot inspect TrustedPeerContext");
  } else {
    if (!/_seal:\s*Seal/.test(ctx)) {
      e.push("N1 TrustedPeerContext is no longer sealed; it could be fabricated by struct literal");
    }
    // Only the two HOST-ISSUED identifiers may remain. Any other field is identity creeping back.
    const fields = (ctx.match(/\n\s+([a-z_]+):\s*[^\n]+/g) || []).map((s) => s.trim().split(":")[0]);
    for (const f of fields) {
      if (!["_seal", "connection_id", "handshake_generation"].includes(f)) {
        e.push("N1 TrustedPeerContext regained a field beyond the host-issued binding: " + f);
      }
    }
  }

  // N2 / N3 - the retired vocabulary must be absent from production local-ipc.
  for (const parts of RETIRED) {
    const name = parts.join("");
    if (contract.includes(name)) {
      e.push("N2 the retired peer identity model reappeared in the contract module: " + name);
    }
    if (lib.includes(name)) {
      e.push("N9 the retired peer identity model is re-exported from lib.rs: " + name);
    }
  }
  // Raw identity storage of any shape, and any accessor that would lend one back out.
  for (const re of [
    /:\s*\[u8;\s*68\]/,
    /:\s*\[u8;\s*SID/,
    /->\s*&\[u8\]/,
    /\bsession_id\s*:/,
    /\bclient_pid\s*:/,
    /fn\s+(as_bytes|bytes|raw|sid|classify)\s*\(\s*&self/,
  ]) {
    if (re.test(contract)) {
      e.push("N2 a raw identity shape or accessor reappeared in the contract module: " + re);
    }
  }

  // N4 - the ONLY constructor is cfg(test). No shipped graph, not even the fixture graph, has one.
  for (const re of [
    /impl TrustedPeerContext \{[\s\S]*?pub fn new\s*\(/,
    /impl TrustedPeerContext \{[\s\S]*?pub\(crate\) fn new\s*\(/,
    /impl From<[^>]*> for TrustedPeerContext/,
    /fn mint\s*\(/,
  ]) {
    if (re.test(contract)) {
      e.push("N4 TrustedPeerContext gained a construction route: " + re);
    }
  }
  const ctorAttrs = attributesAbove(contract, "    fn for_admitted_connection(");
  if (ctorAttrs === null) {
    e.push("N4 the test-only TrustedPeerContext constructor is missing");
  } else {
    if (!ctorAttrs.includes("#[cfg(test)]")) {
      e.push("N4 the TrustedPeerContext constructor is not gated to cfg(test), so a shipped graph can mint one");
    }
    if (ctorAttrs.some((a) => a.includes("test-fixtures"))) {
      e.push("N4 the TrustedPeerContext constructor is reachable from the non-default fixture graph");
    }
  }
  if (/pub fn for_admitted_connection|pub\(crate\) fn for_admitted_connection/.test(contract)) {
    e.push("N4 the test-only constructor became publicly reachable");
  }

  // N5 - no authentication entry point and no relocated canonical identity type.
  for (const t of CANONICAL_PEER_TYPES) {
    if (contract.includes(t) || lib.includes(t)) {
      e.push("N5 a canonical peer identity type was relocated into this crate: " + t);
    }
  }
  if (/projectos_host_windows_service_identity_proof/.test(contract)) {
    e.push("N5 the contract module depends on the canonical identity crate; identity must not cross");
  }

  // N6 - wire values cannot reach a peer context.
  for (const re of [/serde/, /Deserialize/, /impl From<ProtectedOperationRequest>/]) {
    if (re.test(contract)) {
      e.push("N6 a deserialisation or wire-conversion route into a trusted value appeared: " + re);
    }
  }
  if (!contract.includes("wire_values_cannot_establish_or_alter_a_peer_context")) {
    e.push("N6 the wire-non-authority test is missing");
  }

  // N7 - C4 first, unconditional, with no acceptance path.
  const evalBody = fnBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("N7 evaluate_protected_operation is missing");
  } else {
    if (!/if !OwnerPresenceGate::current\(\)\.is_closed\(\) \{/.test(evalBody)) {
      e.push("N7 the C4 gate is no longer an unconditional hard stop");
    }
    const gateAt = evalBody.indexOf("OwnerPresenceGate::current()");
    const peerAt = evalBody.indexOf("peer.is_none()");
    if (peerAt !== -1 && gateAt !== -1 && peerAt < gateAt) {
      e.push("N7 the peer check precedes the C4 gate");
    }
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("N7 evaluation can accept or complete a protected operation while C4 is open");
    }
  }
  if (!contract.includes("an_admitted_peer_still_cannot_pass_c4")) {
    e.push("N7 the C4-with-a-peer-present test is missing");
  }

  // N8 - the regression test itself.
  if (!contract.includes("legacy_peer_identity_model_is_not_present_in_production_graph")) {
    e.push("N8 the legacy-model regression test is missing");
  }
  for (const t of [
    "different_connection_ids_are_not_interchangeable",
    "different_handshake_generations_are_not_interchangeable",
    "a_trusted_peer_context_carries_no_identity_only_the_host_issued_connection",
  ]) {
    if (!contract.includes(t)) e.push("N8 a retained reconciliation test is missing: " + t);
  }

  // N10 - identity was RETIRED here, not lost: the canonical attempt must still own and enforce it.
  for (const item of [
    "pub(crate) fn record_ipc_peer_identity(",
    "pub(crate) fn reconcile_ipc_peer_identity(",
    "pub(crate) struct CanonicalPeerContribution",
    "fn identity_matches(",
  ]) {
    if (!instance.includes(item)) {
      e.push("N10 the canonical attempt no longer owns peer identity: " + item + " is missing");
    }
  }
  const matches = (instance.match(/fn identity_matches\([\s\S]*?\n    \}/) || [])[0];
  if (!matches) {
    e.push("N10 cannot inspect the canonical exact-identity comparison");
  } else {
    for (const part of ["user", "session", "connection_id", "handshake_generation"]) {
      if (!new RegExp("self\\." + part + "\\s*==\\s*bound\\." + part).test(matches)) {
        e.push("N10 the canonical comparison no longer enforces " + part);
      }
    }
  }

  return e;
}

module.exports = { run };
