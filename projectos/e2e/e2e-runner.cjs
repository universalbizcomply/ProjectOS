"use strict";
/**
 * Local E2E Runner — PROJECTOS-V3-E2E-RUNNER1A.
 *
 * Drives the whole governed chain deterministically and OFFLINE, composing the modules built in earlier
 * phases — with no real provider, no AI/metered API, no network, and no real worker spawn:
 *
 *   launch spec (launcher) → bridge request (desktop-bridge) → synthetic in-process worker → validated
 *   response, with the secret/operation brokers exercised via broker.use.
 *
 * It runs a fixed set of SYNTHETIC scenarios — the happy path plus each fail-closed path — and reports a
 * pass/fail plus detail for each. A shared redactor is threaded through the secret broker AND the bridge
 * so a secret can never cross the chain in cleartext. Pure composition of already-validated modules; the
 * runner adds no new trust.
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no disk, no spawning.
 */

const { createRedactor } = require("../security/redaction.cjs");
const { createSecretBroker } = require("../security/broker.cjs");
const { createOperationBroker, STANDARD_OPERATIONS } = require("../security/operation-broker.cjs");
const { buildLaunchSpec } = require("../launcher/session-launcher.cjs");
const bridge = require("../bridge/desktop-bridge.cjs");
const path = require("path");

const PROJECT = "acme";
const ROOT = path.resolve("/work/projects/acme");
const TRUSTED = { projectRoots: { [PROJECT]: ROOT } };
const SYNTH_SECRET = "synthetic-e2e-secret-4d5e6f";

/** Build a fresh, fully wired harness (shared redactor across broker + bridge). Deterministic. */
function makeHarness() {
  const redactor = createRedactor();
  const secretBroker = createSecretBroker({ namespace: "synthetic/e2e", passphrase: "e2e-passphrase-1234", redactor });
  const opBroker = createOperationBroker({ secretBroker });
  for (const op of STANDARD_OPERATIONS) opBroker.registerOperation(op);
  const secret = secretBroker.store({ projectId: PROJECT, environment: "dev", value: SYNTH_SECRET, sensitivity: "standard" });
  return { redactor, secretBroker, opBroker, secretRef: secret.ref };
}

function spec(ops, opts) {
  return buildLaunchSpec(
    { projectId: PROJECT, phaseId: "P1", workingDirectory: "src", requestedOperations: ops, ...(opts || {}) },
    TRUSTED,
  );
}

function ok(name, detail) { return { name, ok: true, detail: detail || "" }; }
function fail(name, detail) { return { name, ok: false, detail }; }

// --- Scenarios: each returns { name, ok, detail } ---

function scenarioHappyPath() {
  const h = makeHarness();
  const s = spec(["build", "read-file"]);
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-1", redactor: h.redactor });
  if (!req.dispatchable) return fail("happy-path", "launch not dispatchable");
  // The synthetic worker signs a message using the secret via the operation broker (secret never leaves).
  const result = bridge.runSyntheticWorker(req.envelope, (env) => {
    const sig = h.opBroker.execute({
      operationName: "hmac-sign", secretRef: h.secretRef, projectId: PROJECT, environment: "dev",
      params: { message: env.sessionId },
    });
    return { correlationId: env.correlationId, status: "completed", artifacts: [{ name: "signature", body: sig.result }], requestedSideEffects: ["read-file"] };
  }, h.redactor);
  if (!result.accepted) return fail("happy-path", "response not accepted");
  if (JSON.stringify(result).includes(SYNTH_SECRET)) return fail("happy-path", "secret leaked into e2e result");
  return ok("happy-path", "signed + accepted, no leak");
}

function scenarioRefusedSpec() {
  const h = makeHarness();
  const s = spec(["send-external"], { productionFrozen: false }); // prohibited → REFUSED
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-2", redactor: h.redactor });
  if (req.dispatchable || req.envelope !== null || req.reason !== "launch-spec-refused") {
    return fail("refused-spec", "prohibited op was dispatchable");
  }
  return ok("refused-spec", "prohibited op refused before dispatch");
}

function scenarioOwnerHold() {
  const h = makeHarness();
  const s = spec(["build", "close-phase"]); // owner-gated → BLOCKED_AWAITING_OWNER
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-3", redactor: h.redactor });
  if (req.dispatchable || !req.envelope || req.envelope.requiresOwnerApproval !== true) {
    return fail("owner-hold", "gated op was not held for owner approval");
  }
  return ok("owner-hold", "gated op held for owner");
}

function scenarioDisallowedSideEffect() {
  const h = makeHarness();
  const s = spec(["build"]);
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-4", redactor: h.redactor });
  const result = bridge.runSyntheticWorker(req.envelope, (env) => ({
    correlationId: env.correlationId, status: "completed", requestedSideEffects: ["deploy-production", "read-file"],
  }), h.redactor);
  if (result.accepted !== false || !result.refusedSideEffects.includes("deploy-production")) {
    return fail("disallowed-side-effect", "worker self-authorised a disallowed side effect");
  }
  return ok("disallowed-side-effect", "disallowed side effect refused");
}

function scenarioSecretRedaction() {
  const h = makeHarness();
  const s = spec(["build"]);
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-5", redactor: h.redactor });
  // A buggy/hostile worker tries to hand back the raw secret in an artifact.
  const result = bridge.runSyntheticWorker(req.envelope, (env) => ({
    correlationId: env.correlationId, status: "completed", artifacts: [{ name: "leak", body: "secret is " + SYNTH_SECRET }],
  }), h.redactor);
  if (JSON.stringify(result.artifacts).includes(SYNTH_SECRET)) {
    return fail("secret-redaction", "secret survived into the validated response");
  }
  return ok("secret-redaction", "secret redacted from response");
}

function scenarioCorrelationMismatch() {
  const h = makeHarness();
  const s = spec(["build"]);
  const req = bridge.createBridgeRequest({ launchSpec: s, correlationId: "e2e-6", redactor: h.redactor });
  const result = bridge.validateBridgeResponse(req.envelope, { correlationId: "not-e2e-6", status: "completed" }, h.redactor);
  if (result.ok !== false || result.reason !== "correlation-mismatch") {
    return fail("correlation-mismatch", "mis-correlated response was not rejected");
  }
  return ok("correlation-mismatch", "mis-correlated response rejected");
}

const SCENARIOS = [
  scenarioHappyPath,
  scenarioRefusedSpec,
  scenarioOwnerHold,
  scenarioDisallowedSideEffect,
  scenarioSecretRedaction,
  scenarioCorrelationMismatch,
];

/** Run every scenario and return an array of { name, ok, detail }. Deterministic. */
function runAllScenarios() {
  return SCENARIOS.map((fn) => {
    try { return fn(); }
    catch (e) { return { name: fn.name, ok: false, detail: "threw: " + e.message }; }
  });
}

module.exports = { runAllScenarios, SYNTH_SECRET };
