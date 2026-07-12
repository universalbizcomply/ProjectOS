"use strict";
/**
 * Proves the Secret Operation Broker invariants using SYNTHETIC secrets only. Contract for
 * PROJECTOS-V3-SECRET-OPERATION-BROKER1A: if any invariant regresses, `run()` returns a non-empty
 * error list and validate-all fails.
 *
 * Invariants:
 *  1  unknown / non-allowlisted operation is refused (fail closed)
 *  2  an allowlisted operation runs and returns a correct NON-secret result (hmac-sign)
 *  3  the operation genuinely used the secret (result matches an independent HMAC) and never equals it
 *  4  fingerprint returns a short non-reversible id that is not the secret
 *  5  verify-candidate returns true for the right candidate, false for the wrong one
 *  6  a sensitive operation without owner confirmation is refused
 *  7  the underlying secret binding is enforced (wrong project fails, audited)
 *  8  malicious operations that smuggle the secret out are all blocked: verbatim string, nested string,
 *     Buffer, returned function, Map, and a non-enumerable/hidden property; caller receives nothing
 *  9  the audit trail records outcomes as metadata with no secret value
 * 10  duplicate operation registration is refused
 * 11  async / thenable operations are refused at registration
 * 12  a valid plain-object (non-secret) result passes through unchanged
 */

const { createSecretBroker } = require("../security/broker.cjs");
const { createOperationBroker, STANDARD_OPERATIONS } = require("../security/operation-broker.cjs");
const crypto = require("crypto");

const SYNTH = "synthetic-op-secret-7c1f2a";

function expectThrow(errors, label, fn) {
  try {
    fn();
    errors.push(label + ": expected failure but call succeeded");
  } catch (e) {
    if (String(e.message).includes(SYNTH)) errors.push(label + ": error message leaked the secret");
  }
}

function run() {
  const errors = [];

  const secretBroker = createSecretBroker({ namespace: "synthetic/op-broker", passphrase: "op-selftest-1234", actor: "validator" });
  const opBroker = createOperationBroker({ secretBroker, actor: "validator" });
  for (const op of STANDARD_OPERATIONS) opBroker.registerOperation(op);

  const { ref } = secretBroker.store({ projectId: "proj-a", environment: "dev", value: SYNTH, sensitivity: "standard" });
  const bind = { secretRef: ref, projectId: "proj-a", environment: "dev" };

  // 1: unknown operation refused.
  expectThrow(errors, "invariant 1 (unknown op)", () =>
    opBroker.execute({ operationName: "does-not-exist", ...bind }));

  // 2 + 3: hmac-sign runs, returns correct non-secret digest, actually used the secret.
  try {
    const out = opBroker.execute({ operationName: "hmac-sign", ...bind, params: { message: "hello" } });
    const expected = crypto.createHmac("sha256", SYNTH).update("hello").digest("hex");
    if (out.result !== expected) errors.push("invariant 2/3: hmac-sign result did not match independent HMAC");
    if (String(out.result).includes(SYNTH)) errors.push("invariant 3: hmac result contained the secret");
  } catch (e) {
    errors.push("invariant 2/3: hmac-sign failed: " + e.message);
  }

  // 4: fingerprint — 16 hex chars, not the secret.
  try {
    const out = opBroker.execute({ operationName: "fingerprint", ...bind });
    if (!/^[0-9a-f]{16}$/.test(out.result)) errors.push("invariant 4: fingerprint is not 16 hex chars");
    if (String(out.result).includes(SYNTH)) errors.push("invariant 4: fingerprint contained the secret");
  } catch (e) {
    errors.push("invariant 4: fingerprint failed: " + e.message);
  }

  // 5 + 6: verify-candidate is sensitive → needs owner confirmation; result is a boolean.
  const cap = { capability: { ownerConfirmation: true } };
  try {
    const right = opBroker.execute({ operationName: "verify-candidate", ...bind, ...cap, params: { candidate: SYNTH } });
    const wrong = opBroker.execute({ operationName: "verify-candidate", ...bind, ...cap, params: { candidate: "nope" } });
    if (right.result !== true) errors.push("invariant 5: verify-candidate did not accept the correct candidate");
    if (wrong.result !== false) errors.push("invariant 5: verify-candidate did not reject the wrong candidate");
  } catch (e) {
    errors.push("invariant 5: verify-candidate failed: " + e.message);
  }
  // 6: same op without owner confirmation is refused.
  expectThrow(errors, "invariant 6 (sensitive op, no owner confirmation)", () =>
    opBroker.execute({ operationName: "verify-candidate", ...bind, params: { candidate: SYNTH } }));

  // 7: binding enforced — wrong project cannot run the operation, AND the failure is audited.
  const before7 = opBroker.getAuditLog().length;
  expectThrow(errors, "invariant 7 (wrong binding)", () =>
    opBroker.execute({ operationName: "hmac-sign", secretRef: ref, projectId: "proj-b", environment: "dev", params: { message: "x" } }));
  const after7 = opBroker.getAuditLog().slice(before7);
  if (!after7.some((e) => e.ok === false && e.operation === "hmac-sign" && e.projectId === "proj-b")) {
    errors.push("invariant 7: wrong-binding failure was not recorded as an audited event");
  }

  // 8: every malicious exfiltration shape is blocked — including JSON-stringify-invisible carriers.
  opBroker.registerOperation({ name: "leak-string", run: (s) => s });
  opBroker.registerOperation({ name: "leak-nested", run: (s) => ({ note: "here", token: s }) });
  opBroker.registerOperation({ name: "leak-buffer", run: (s) => Buffer.from(s, "utf8") });
  opBroker.registerOperation({ name: "leak-function", run: (s) => () => s });
  opBroker.registerOperation({ name: "leak-map", run: (s) => new Map([["k", s]]) });
  opBroker.registerOperation({ name: "leak-hidden", run: (s) => {
    const o = { note: "ok" };
    Object.defineProperty(o, "raw", { value: s, enumerable: false });
    return o;
  } });
  for (const name of ["leak-string", "leak-nested", "leak-buffer", "leak-function", "leak-map", "leak-hidden"]) {
    expectThrow(errors, "invariant 8 (" + name + " blocked)", () =>
      opBroker.execute({ operationName: name, ...bind }));
  }
  // Confirm no blocked result actually handed back the secret (belt-and-braces).
  try {
    const out = opBroker.execute({ operationName: "leak-buffer", ...bind });
    if (JSON.stringify(out).includes(SYNTH)) errors.push("invariant 8: leak-buffer returned the secret");
  } catch (e) { /* expected throw */ }

  // 9: audit trail carries no secret value.
  const auditDump = JSON.stringify(opBroker.getAuditLog());
  if (auditDump.includes(SYNTH)) errors.push("invariant 9: operation audit leaked the secret");
  const hasLeakBlockEvent = opBroker.getAuditLog().some((e) => e.ok === false && e.reason === "result-leak-blocked");
  if (!hasLeakBlockEvent) errors.push("invariant 9: expected a result-leak-blocked audit event");

  // 10: duplicate registration refused.
  expectThrow(errors, "invariant 10 (duplicate registration)", () =>
    opBroker.registerOperation({ name: "hmac-sign", run: () => "x" }));

  // 11: async / thenable operations refused at registration.
  expectThrow(errors, "invariant 11 (async op refused)", () =>
    opBroker.registerOperation({ name: "async-op", run: async () => "x" }));

  // 12: a valid plain-object non-secret result passes through unchanged.
  opBroker.registerOperation({ name: "shape", run: (s, p) => ({ ok: true, len: String(p.n || 0), digest: "d" }) });
  try {
    const out = opBroker.execute({ operationName: "shape", ...bind, params: { n: 3 } });
    if (!out.result || out.result.ok !== true || out.result.len !== "3" || out.result.digest !== "d") {
      errors.push("invariant 12: valid plain-object result was altered or dropped");
    }
  } catch (e) {
    errors.push("invariant 12: valid plain-object result unexpectedly rejected: " + e.message);
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-secret-operation-broker: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-secret-operation-broker: PASS");
}
module.exports = { run };
