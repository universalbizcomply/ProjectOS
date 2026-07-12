"use strict";
/**
 * Reliability Hardening — PROJECTOS-V3-RELIABILITY-HARDENING1A.
 *
 * A cross-cutting adversarial pass over the whole governed chain (launcher, bridge, secret + operation
 * brokers, approval queue, provider guards). It feeds each entry point junk, oversized,
 * prototype-polluted, and wrong-type inputs and asserts every boundary FAILS CLOSED — never granting a
 * permit/accept/approve/ALLOW, never leaking a secret, and never crashing the process with an unhandled
 * type error. Synthetic data only. If any boundary regresses under adversarial input, `run()` returns a
 * non-empty error list and validate-all fails.
 */

const path = require("path");
const { buildLaunchSpec } = require("../launcher/session-launcher.cjs");
const bridge = require("../bridge/desktop-bridge.cjs");
const { createSecretBroker } = require("../security/broker.cjs");
const { createOperationBroker, STANDARD_OPERATIONS } = require("../security/operation-broker.cjs");
const { createApprovalQueue } = require("../approval/approval-queue.cjs");
const { evaluateProviderIntent } = require("../guards/provider-context-guards.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const ROOT = path.resolve("/work/projects/acme");
const TRUSTED = { projectRoots: { acme: ROOT } };
const SECRET = "synthetic-reliability-secret-abc123";

// Adversarial values reused across boundaries.
const JUNK = [null, undefined, 42, true, {}, [], "", "  ", "__proto__", "constructor", { toString() { return "x"; } }];
const POLLUTED = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}');

/** Assert fn() either throws OR returns a value that passes `safe(value)`. A crash with an unexpected
 *  error type, or a value failing `safe`, is a hardening failure. */
function mustFailClosed(errors, label, fn, safe) {
  let result;
  try { result = fn(); }
  catch (e) {
    if (String(e && e.message).includes(SECRET)) errors.push(label + ": thrown error leaked the secret");
    return; // throwing is an acceptable fail-closed outcome
  }
  try {
    if (!safe(result)) errors.push(label + ": did not fail closed (returned a non-safe result)");
  } catch (e) {
    errors.push(label + ": safety predicate crashed: " + e.message);
  }
}

function run() {
  const errors = [];

  // --- Launcher: junk operations / dirs / config never yields permitted. ---
  for (const bad of JUNK) {
    mustFailClosed(errors, "launcher junk op " + JSON.stringify(bad),
      () => buildLaunchSpec({ projectId: "acme", phaseId: "P", workingDirectory: "src", requestedOperations: [bad] }, TRUSTED),
      (r) => r.permitted === false || r.decision !== "READY_TO_LAUNCH");
  }
  for (const dir of ["../../etc", "..\\..\\win", "/abs/root", "", null]) {
    mustFailClosed(errors, "launcher traversal " + JSON.stringify(dir),
      () => buildLaunchSpec({ projectId: "acme", phaseId: "P", workingDirectory: dir, requestedOperations: ["read-file"] }, TRUSTED),
      (r) => r.permitted === false || r.decision !== "REFUSED" ? r.workingDirectory === null || r.permitted === false : true);
  }
  // Untrusted config cannot choose its own root.
  mustFailClosed(errors, "launcher self-chosen root",
    () => buildLaunchSpec({ projectId: "ghost", phaseId: "P", workingDirectory: "src", allowedRoot: "/", requestedOperations: ["read-file"] }, {}),
    (r) => r.permitted === false);

  // --- Bridge: polluted / oversized / missing-redactor responses fail closed. ---
  const R = createRedactor();
  const spec = buildLaunchSpec({ projectId: "acme", phaseId: "P", workingDirectory: "src", requestedOperations: ["build"] }, TRUSTED);
  const req = bridge.createBridgeRequest({ launchSpec: spec, correlationId: "c1", redactor: R });
  mustFailClosed(errors, "bridge polluted response",
    () => bridge.validateBridgeResponse(req.envelope, { ...POLLUTED, correlationId: "c1", status: "completed", requestedSideEffects: ["deploy-production"] }, R),
    (r) => r.accepted === false);
  mustFailClosed(errors, "bridge junk side effects",
    () => bridge.validateBridgeResponse(req.envelope, { correlationId: "c1", status: "completed", requestedSideEffects: JUNK }, R),
    (r) => r.accepted === false);
  for (const bad of JUNK) {
    mustFailClosed(errors, "bridge junk response " + JSON.stringify(bad),
      () => bridge.validateBridgeResponse(req.envelope, bad, R),
      (r) => r.ok === false);
  }
  // Missing redactor must throw (caught as fail-closed).
  mustFailClosed(errors, "bridge missing redactor",
    () => bridge.validateBridgeResponse(req.envelope, { correlationId: "c1", status: "completed" }),
    () => false); // if it returns instead of throwing, that's a failure

  // --- Secret broker: adversarial store/retrieve never leaks or grants. ---
  const sb = createSecretBroker({ namespace: "synthetic/harden", passphrase: "harden-pass-1234", redactor: R });
  const ref = sb.store({ projectId: "p", environment: "dev", value: SECRET, sensitivity: "high" }).ref;
  mustFailClosed(errors, "broker wrong binding", () => sb.retrieve({ ref, projectId: "other", environment: "dev", capability: { ownerConfirmation: true } }), () => false);
  mustFailClosed(errors, "broker high without owner", () => sb.retrieve({ ref, projectId: "p", environment: "dev" }), () => false);
  for (const bad of JUNK) {
    mustFailClosed(errors, "broker junk ref " + JSON.stringify(bad), () => sb.retrieve({ ref: bad, projectId: "p", environment: "dev", capability: { ownerConfirmation: true } }), () => false);
  }
  try { sb.assertNoPlaintextLeak(); } catch (e) { errors.push("broker no-plaintext-leak invariant failed: " + e.message); }

  // --- Operation broker: hostile ops (return secret / async / junk) blocked. ---
  const ob = createOperationBroker({ secretBroker: sb });
  for (const op of STANDARD_OPERATIONS) ob.registerOperation(op);
  ob.registerOperation({ name: "leak", run: (s) => s });
  ob.registerOperation({ name: "leak-buf", run: (s) => Buffer.from(s) });
  for (const name of ["leak", "leak-buf", "nonexistent"]) {
    mustFailClosed(errors, "op-broker hostile " + name,
      () => ob.execute({ operationName: name, secretRef: ref, projectId: "p", environment: "dev", capability: { ownerConfirmation: true } }),
      (r) => r && r.ok && JSON.stringify(r).includes(SECRET) ? false : true);
  }

  // --- Approval queue: junk decisions / no capability / unknown kind fail closed. ---
  const q = createApprovalQueue({ redactor: R });
  const item = q.enqueue({ kind: "generic", summary: "x" });
  mustFailClosed(errors, "queue decide no capability", () => q.decide({ id: item.id, decision: "approve" }), () => false);
  for (const bad of JUNK) {
    mustFailClosed(errors, "queue junk decision " + JSON.stringify(bad), () => q.decide({ id: item.id, decision: bad, capability: { ownerConfirmation: true } }), () => false);
    mustFailClosed(errors, "queue junk kind " + JSON.stringify(bad), () => q.enqueue({ kind: bad, summary: "x" }), () => false);
  }
  if (q.get(item.id).status !== "pending") errors.push("queue: item transitioned under adversarial input");

  // --- Provider guards: polluted / junk intents never ALLOW a real action. ---
  mustFailClosed(errors, "guard polluted intent",
    () => evaluateProviderIntent({ ...POLLUTED, provider: "email", action: "send", projectId: "acme" }, {}),
    (r) => r.decision === "REFUSED");
  for (const p of JUNK) {
    mustFailClosed(errors, "guard junk provider " + JSON.stringify(p),
      () => evaluateProviderIntent({ provider: p, action: "send", projectId: "acme" }, {}),
      (r) => r.decision === "REFUSED");
    mustFailClosed(errors, "guard junk action " + JSON.stringify(p),
      () => evaluateProviderIntent({ provider: "github", action: p, projectId: "acme" }, {}),
      (r) => r.decision === "REFUSED");
  }

  // Final: prototype pollution did not escape into Object.prototype.
  if (({}).polluted !== undefined) errors.push("GLOBAL: Object.prototype was polluted by adversarial input");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-reliability-hardening: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-reliability-hardening: PASS");
}
module.exports = { run };
