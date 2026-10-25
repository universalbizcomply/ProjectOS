"use strict";
/**
 * Proves the Local Secret Broker security invariants using SYNTHETIC secrets only. This validator is
 * both the test suite and the enforced contract for PROJECTOS-V3-LOCAL-SECRET-BROKER1A: if any
 * invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants checked:
 *  1  encryption at rest — no plaintext in the stored record (ciphertext != value)
 *  2  no plaintext anywhere in the serialized store or audit trail
 *  3  correct binding + capability releases the value
 *  4  wrong projectId fails closed
 *  5  wrong environment fails closed
 *  6  high-sensitivity retrieval without owner confirmation fails closed
 *  7  high-sensitivity retrieval WITH owner confirmation succeeds
 *  8  revoked secret fails closed
 *  9  destroyed secret fails closed
 * 10  tampered ciphertext fails closed and leaks nothing
 * 11  non-synthetic namespace is refused at construction
 * 12  audit records the failures as metadata (ok:false) without any value
 * 13  redactor scrubs the value from a sample log line and object (incl. a literal __proto__ key)
 * 14  store rejects a value shorter than the redaction minimum (fail closed)
 * 15  revoke/destroy enforce the (projectId, environment) binding; refused ops leave the secret intact
 * 16  revoke/destroy on an unknown ref throw and are recorded as audited failures
 */

const { createSecretBroker, assertSyntheticNamespace, __internal } = require("../security/broker.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const SYNTH_VALUE = "synthetic-token-8f3a9c22-do-not-use";
const SYNTH_HIGH = "synthetic-high-secret-b41d77e0";

function expectThrow(errors, label, fn) {
  try {
    fn();
    errors.push(label + ": expected failure but call succeeded");
  } catch (e) {
    // expected; ensure the thrown message never contains a synthetic value
    if (String(e.message).includes(SYNTH_VALUE) || String(e.message).includes(SYNTH_HIGH)) {
      errors.push(label + ": error message leaked a secret value");
    }
  }
}

function run() {
  const errors = [];

  const redactor = createRedactor();
  let broker;
  try {
    broker = createSecretBroker({
      namespace: "synthetic/secret-broker-selftest",
      passphrase: "selftest-passphrase-1234",
      actor: "validator",
      redactor
    });
  } catch (e) {
    return ["broker construction failed: " + e.message];
  }

  // Store standard + high sensitivity secrets.
  const std = broker.store({ projectId: "proj-a", environment: "dev", value: SYNTH_VALUE, sensitivity: "standard" });
  const high = broker.store({ projectId: "proj-a", environment: "dev", value: SYNTH_HIGH, sensitivity: "high" });

  // 1 + 2: no plaintext at rest / in audit.
  const dump = JSON.stringify({ list: broker.list(), audit: broker.getAuditLog() });
  if (dump.includes(SYNTH_VALUE) || dump.includes(SYNTH_HIGH)) {
    errors.push("invariant 1/2: plaintext secret present in store/audit serialization");
  }
  try { broker.assertNoPlaintextLeak(); } catch (e) { errors.push("invariant 2: " + e.message); }

  // 3: correct binding + capability releases the value.
  try {
    const v = broker.retrieve({ ref: std.ref, projectId: "proj-a", environment: "dev" });
    if (v !== SYNTH_VALUE) errors.push("invariant 3: retrieved value did not match");
  } catch (e) {
    errors.push("invariant 3: correct retrieval failed: " + e.message);
  }

  // 4: wrong project.
  expectThrow(errors, "invariant 4 (wrong project)", () =>
    broker.retrieve({ ref: std.ref, projectId: "proj-b", environment: "dev" }));

  // 5: wrong environment.
  expectThrow(errors, "invariant 5 (wrong environment)", () =>
    broker.retrieve({ ref: std.ref, projectId: "proj-a", environment: "prod" }));

  // 6: high sensitivity without owner confirmation.
  expectThrow(errors, "invariant 6 (no owner confirmation)", () =>
    broker.retrieve({ ref: high.ref, projectId: "proj-a", environment: "dev" }));

  // 7: high sensitivity WITH owner confirmation.
  try {
    const v = broker.retrieve({ ref: high.ref, projectId: "proj-a", environment: "dev", capability: { ownerConfirmation: true } });
    if (v !== SYNTH_HIGH) errors.push("invariant 7: high-sensitivity retrieved value did not match");
  } catch (e) {
    errors.push("invariant 7: owner-confirmed retrieval failed: " + e.message);
  }

  // 8: revoke (bound) then retrieve.
  broker.revoke({ ref: std.ref, projectId: "proj-a", environment: "dev" });
  expectThrow(errors, "invariant 8 (revoked)", () =>
    broker.retrieve({ ref: std.ref, projectId: "proj-a", environment: "dev" }));

  // 9: destroy (bound) then retrieve.
  const tmp = broker.store({ projectId: "proj-a", environment: "dev", value: "synthetic-temp-1111", sensitivity: "standard" });
  broker.destroy({ ref: tmp.ref, projectId: "proj-a", environment: "dev" });
  expectThrow(errors, "invariant 9 (destroyed)", () =>
    broker.retrieve({ ref: tmp.ref, projectId: "proj-a", environment: "dev" }));

  // 10: tampered ciphertext genuinely exercises the GCM auth-failure path.
  const pass = "tamper-pass-1234";
  const body = __internal.encryptValue(pass, "synthetic-tamper-value-9999");
  if (__internal.decryptValue(pass, body) !== "synthetic-tamper-value-9999") {
    errors.push("invariant 10: baseline encrypt/decrypt round-trip failed");
  }
  const flipped = Buffer.from(body.ciphertext, "base64");
  flipped[0] ^= 0xff; // corrupt one ciphertext byte
  const tampered = { ...body, ciphertext: flipped.toString("base64") };
  expectThrow(errors, "invariant 10 (tampered ciphertext)", () =>
    __internal.decryptValue(pass, tampered));
  const badTag = Buffer.from(body.authTag, "base64");
  badTag[0] ^= 0xff; // corrupt the auth tag
  expectThrow(errors, "invariant 10 (tampered authTag)", () =>
    __internal.decryptValue(pass, { ...body, authTag: badTag.toString("base64") }));

  // 11: non-synthetic namespace refused.
  expectThrow(errors, "invariant 11 (non-synthetic namespace)", () =>
    assertSyntheticNamespace("production/real-secrets"));
  expectThrow(errors, "invariant 11 (broker non-synthetic)", () =>
    createSecretBroker({ namespace: "prod/creds", passphrase: "whatever-1234" }));

  // 12: failures recorded as metadata with no value.
  const auditDump = JSON.stringify(broker.getAuditLog());
  if (auditDump.includes(SYNTH_VALUE) || auditDump.includes(SYNTH_HIGH)) {
    errors.push("invariant 12: audit trail leaked a secret value");
  }
  const hasFailEvent = broker.getAuditLog().some((e) => e.ok === false && e.reason);
  if (!hasFailEvent) errors.push("invariant 12: expected at least one failed retrieval event with a reason");

  // 13: redactor scrubs value from text + object.
  const line = "connecting with token " + SYNTH_VALUE + " now";
  const redLine = redactor.redactText(line);
  if (redLine.includes(SYNTH_VALUE)) errors.push("invariant 13: redactText left the secret in place");
  if (!redLine.includes("«secret:")) errors.push("invariant 13: redactText did not insert a placeholder");
  const redObj = redactor.redactObject({ note: line, nested: { token: SYNTH_HIGH } });
  if (JSON.stringify(redObj).includes(SYNTH_VALUE) || JSON.stringify(redObj).includes(SYNTH_HIGH)) {
    errors.push("invariant 13: redactObject left a secret in place");
  }
  // 13b: a literal __proto__ own key must not corrupt output or drop the redaction.
  const protoObj = JSON.parse('{"__proto__":{"token":"' + SYNTH_VALUE + '"}}');
  if (redactor.containsSecret(redactor.redactObject(protoObj))) {
    errors.push("invariant 13b: redactObject left a secret behind a __proto__ key");
  }

  // 14: store rejects a value shorter than the redaction minimum (fail closed).
  expectThrow(errors, "invariant 14 (short value rejected)", () =>
    broker.store({ projectId: "proj-a", environment: "dev", value: "ab" }));

  // 15: revoke/destroy enforce the binding — a leaked ref cannot hit another project/environment.
  const bound = broker.store({ projectId: "proj-c", environment: "dev", value: "synthetic-bound-2222" });
  expectThrow(errors, "invariant 15 (revoke wrong binding)", () =>
    broker.revoke({ ref: bound.ref, projectId: "proj-x", environment: "dev" }));
  expectThrow(errors, "invariant 15 (destroy wrong binding)", () =>
    broker.destroy({ ref: bound.ref, projectId: "proj-c", environment: "prod" }));
  // Still retrievable after refused revoke/destroy.
  try {
    if (broker.retrieve({ ref: bound.ref, projectId: "proj-c", environment: "dev" }) !== "synthetic-bound-2222") {
      errors.push("invariant 15: bound secret altered despite refused revoke/destroy");
    }
  } catch (e) {
    errors.push("invariant 15: bound secret unexpectedly unavailable: " + e.message);
  }

  // 16: revoke/destroy on an unknown ref throw AND leave an audited failure event.
  const auditBefore = broker.getAuditLog().length;
  expectThrow(errors, "invariant 16 (revoke unknown ref)", () =>
    broker.revoke({ ref: "ref_does-not-exist", projectId: "proj-a", environment: "dev" }));
  expectThrow(errors, "invariant 16 (destroy unknown ref)", () =>
    broker.destroy({ ref: "ref_does-not-exist", projectId: "proj-a", environment: "dev" }));
  const newEvents = broker.getAuditLog().slice(auditBefore);
  const unknownRefAudited = newEvents.filter((e) => e.ok === false && e.reason === "unknown-ref").length;
  if (unknownRefAudited < 2) {
    errors.push("invariant 16: unknown-ref revoke/destroy were not both recorded as audited failures");
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-secret-broker: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-secret-broker: PASS");
}
module.exports = { run };
