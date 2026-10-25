"use strict";
/**
 * Claude Desktop Bridge (protocol contract) — PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A.
 *
 * Defines and validates the local, in-process handoff protocol between ProjectOS and a desktop/CLI
 * worker (e.g. a Claude Code session). It builds a REQUEST envelope from a Phase-7 launch spec and
 * validates the worker's RESPONSE envelope. It performs NO AI/metered-API call and NO network I/O — it
 * only defines, validates, and (for tests) simulates the protocol with a synthetic in-process worker.
 *
 * Security model (worker responses are UNTRUSTED, mirroring the Phase-2 authority model):
 *  - Only a launch spec that is READY_TO_LAUNCH can be dispatched; REFUSED/BLOCKED specs are not.
 *  - Side effects are ALLOWLISTED: a requested side effect is accepted only if it is on the launcher's
 *    AUTO_ALLOWED set. Anything else — owner-gated, prohibited, unknown, mistyped, or non-string — is
 *    refused and routed to owner approval, never auto-accepted.
 *  - A worker CANNOT grant authority/PLAN READY: forbidden fields are stripped recursively at every
 *    level of the response and never trusted.
 *  - Secrets are redacted in BOTH directions via a caller-supplied redactor (required — never a silent
 *    empty default), so no secret value crosses the bridge in cleartext.
 *  - The response is snapshotted once (JSON round-trip) before any check, so getters/Proxies cannot
 *    show one value to the size/shape check and another to the decision logic.
 *  - Correlation ids must match; malformed, oversized, or mis-correlated envelopes fail closed.
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no disk, no spawning.
 */

const { AUTO_ALLOWED } = require("../launcher/session-launcher.cjs");

const PROTOCOL_VERSION = "1.0";
const MAX_ENVELOPE_BYTES = 256 * 1024; // fail closed on oversized envelopes
// Fields a worker must never be able to assert; stripped (recursively) from any response.
const FORBIDDEN_RESPONSE_FIELDS = ["authoritative", "planReady", "grantPlanReady", "ownerApproved", "trusted"];
const VALID_STATUSES = new Set(["completed", "failed", "needs-owner"]);

function requireRedactor(redactor, who) {
  if (!redactor || typeof redactor.redactObject !== "function") {
    throw new Error("desktop-bridge: " + who + " requires an explicit redactor (no silent empty default)");
  }
  return redactor;
}

function serialize(obj) {
  // Returns the JSON string, or null if the value is not serialisable.
  try { return JSON.stringify(obj); } catch (e) { return null; }
}

/** Recursively drop forbidden authority keys at every level. Operates on an already-snapshotted plain value. */
function stripForbidden(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(stripForbidden);
  const out = Object.create(null);
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_RESPONSE_FIELDS.includes(k)) continue;
    out[k] = stripForbidden(v[k]);
  }
  return out;
}

/**
 * Build a request envelope to hand a launch spec to a worker. Returns { dispatchable, envelope, reason }.
 * A REFUSED spec is never dispatchable; a BLOCKED spec is returned marked requiresOwnerApproval and is
 * not dispatchable until the owner approves separately. `input.redactor` is required.
 */
function createBridgeRequest(input) {
  const { launchSpec, correlationId } = input || {};
  if (!launchSpec || typeof launchSpec !== "object") throw new Error("desktop-bridge: launchSpec required");
  if (typeof correlationId !== "string" || !correlationId) throw new Error("desktop-bridge: correlationId required");
  const redactor = requireRedactor(input && input.redactor, "createBridgeRequest");

  if (launchSpec.decision === "REFUSED") {
    return { dispatchable: false, envelope: null, reason: "launch-spec-refused" };
  }
  const requiresOwnerApproval = launchSpec.decision !== "READY_TO_LAUNCH";

  const envelope = redactor.redactObject({
    protocol: PROTOCOL_VERSION,
    kind: "launch-request",
    correlationId,
    projectId: launchSpec.projectId,
    phaseId: launchSpec.phaseId,
    sessionId: launchSpec.sessionId,
    role: launchSpec.role,
    workingDirectory: launchSpec.workingDirectory,
    // Only auto-allowed operations are dispatched; gated ones are surfaced for owner approval, not sent
    // as executable instructions.
    allowedOperations: Array.isArray(launchSpec.allowedOperations) ? launchSpec.allowedOperations : [],
    gatedOperationsForOwner: Array.isArray(launchSpec.gatedOperations) ? launchSpec.gatedOperations : [],
    // Secret references only — never values.
    secretPlan: Array.isArray(launchSpec.secretPlan) ? launchSpec.secretPlan : [],
    requiresOwnerApproval,
  });

  if ((serialize(envelope) || "").length > MAX_ENVELOPE_BYTES || serialize(envelope) === null) {
    return { dispatchable: false, envelope: null, reason: "envelope-too-large" };
  }
  return { dispatchable: !requiresOwnerApproval, envelope, reason: requiresOwnerApproval ? "requires-owner-approval" : null };
}

/**
 * Validate an untrusted worker response against a dispatched request envelope. `redactor` is required.
 * Returns { ok, accepted, correlationId, status, artifacts, allowedSideEffects, refusedSideEffects,
 * strippedFields, response, reason } — fail-closed.
 */
function validateBridgeResponse(requestEnvelope, response, redactor) {
  requireRedactor(redactor, "validateBridgeResponse");
  const out = { ok: false, accepted: false, correlationId: null, status: null, artifacts: [], allowedSideEffects: [], refusedSideEffects: [], strippedFields: [], response: null };

  if (!requestEnvelope || typeof requestEnvelope !== "object" || !requestEnvelope.correlationId) {
    out.reason = "no-request-context";
    return out;
  }
  if (!response || typeof response !== "object") { out.reason = "malformed-response"; return out; }

  // Snapshot once: this both enforces the size cap and defeats getter/Proxy TOCTOU — every subsequent
  // read is against the inert `safe` copy, never the live object.
  const serialized = serialize(response);
  if (serialized === null) { out.reason = "malformed-response"; return out; }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ENVELOPE_BYTES) { out.reason = "response-too-large"; return out; }
  const safe = JSON.parse(serialized);

  if (safe.correlationId !== requestEnvelope.correlationId) { out.reason = "correlation-mismatch"; return out; }
  if (typeof safe.status !== "string" || !VALID_STATUSES.has(safe.status)) { out.reason = "invalid-status"; return out; }

  // Allowlist side effects: accepted only if explicitly AUTO_ALLOWED. Everything else is refused.
  const requested = Array.isArray(safe.requestedSideEffects) ? safe.requestedSideEffects : [];
  const allowedSideEffects = requested.filter((a) => typeof a === "string" && AUTO_ALLOWED.has(a));
  const refusedSideEffects = requested
    .filter((a) => typeof a !== "string" || !AUTO_ALLOWED.has(a))
    .map((a) => (typeof a === "string" ? a : "(non-string)"));

  out.strippedFields = FORBIDDEN_RESPONSE_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(safe, f));
  const cleaned = redactor.redactObject(stripForbidden(safe));

  out.ok = true;
  out.accepted = safe.status === "completed" && refusedSideEffects.length === 0;
  out.correlationId = safe.correlationId;
  out.status = safe.status;
  out.artifacts = Array.isArray(cleaned.artifacts) ? cleaned.artifacts.filter((a) => a && typeof a === "object") : [];
  out.allowedSideEffects = allowedSideEffects;
  out.refusedSideEffects = refusedSideEffects;
  out.response = cleaned;
  return out;
}

/**
 * Simulate a worker in-process (no network, no AI). `handler(envelope) -> response` is a plain function;
 * the returned response goes straight back through validateBridgeResponse. For tests/local proof only.
 * `redactor` is required and should be the same one used to build the request.
 */
function runSyntheticWorker(requestEnvelope, handler, redactor) {
  if (typeof handler !== "function") throw new Error("desktop-bridge: synthetic worker handler required");
  requireRedactor(redactor, "runSyntheticWorker");
  const response = handler(requestEnvelope);
  return validateBridgeResponse(requestEnvelope, response, redactor);
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_ENVELOPE_BYTES,
  FORBIDDEN_RESPONSE_FIELDS,
  createBridgeRequest,
  validateBridgeResponse,
  runSyntheticWorker,
};
