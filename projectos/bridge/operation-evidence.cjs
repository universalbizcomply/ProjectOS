"use strict";
/**
 * Post-execution OPERATION EXECUTION EVIDENCE — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E (§8, §14, §15).
 *
 * Two-stage attestation splits (A) PROVIDER CAPABILITY ATTESTATION — proven up front, "the sandbox CAN deny
 * canonical/home/network and CAN terminate/clean" — from (B) OPERATION EXECUTION EVIDENCE — created AFTER the
 * exact operation ran and terminated. A capability canary must NEVER be presented as an operation-observed
 * result. This module (B) therefore keeps two clearly-labelled sections:
 *   • capabilityDerived  — what the sandbox CAN enforce (from the attestation canaries)
 *   • operationObserved  — what was ACTUALLY observed for THIS operation (identity, processes, termination,
 *                          disposal, residue; the first-proof run does not instrument the worker's syscalls, so
 *                          network/canonical/credential ATTEMPTS are honestly "NOT OBSERVABLE", never "denied")
 *
 * Operation-bound (operationId + workspaceId + providerId + argv/exe hash) with an always-checked evidenceHash.
 * Integrity, not authenticity (see report trust boundary).
 */

const { canonicalJson } = require("./attestation.cjs"); // reuse canonical serialisation

const SCHEMA_VERSION = "op-evidence-2.0";
const TERMINATION_STATUSES = ["NOT EXECUTED", "TERMINATED-CONFIRMED", "TERMINATION-UNCONFIRMED", "EMERGENCY-STOP-REQUIRED"];
const DISPOSAL_STATUSES = ["disposed", "disposal-failed", "not-disposed", "not-disposed-evidence-preserved", "not-disposed-evidence-preservation-failed"];
const OBSERVATION_VALUES = ["NOT OBSERVABLE", "OBSERVED", "NONE OBSERVED"];
const SUCCESS_OUTCOMES = ["COMPLETED", "FAILED"]; // outcomes that require a fully clean, disposed operation
const CAP_DERIVED_FIELDS = ["canonicalDenialCapability", "otherProjectDenialCapability", "credentialDenialCapability", "networkDenialCapability"];
const OBSERVED_FIELDS = [
  "actualWorkspaceIdentity", "actualExecutableIdentity", "actualArgvHash", "operationProcessObservations",
  "networkAttemptsObserved", "canonicalAccessAttemptsObserved", "credentialAccessAttemptsObserved",
  "terminationResult", "disposalResult", "residue",
];
const TOP_REQUIRED = [
  "schemaVersion", "operationId", "workspaceId", "providerId", "providerVersion", "preparedOperationId",
  "operationHandleType", "operationHandleIdRedacted", "executableContentHash", "argvHash", "startTimestamp",
  "exitTimestamp", "exitStatus", "outcome", "capabilityDerived", "operationObserved", "evidenceHash",
];
// Canary-flavoured tokens that must NEVER appear as an operation-OBSERVED termination value (a canary substituted
// for a real observation).
const CANARY_TOKENS = new Set(["denied", "allowed", "contained", "complete", "confirmed", "reachable", "escaped", "residue"]);

function hashEvidence(ev) { const c = Object.assign({}, ev); delete c.evidenceHash; return require("crypto").createHash("sha256").update(canonicalJson(c)).digest("hex"); }

function buildOperationEvidence(f) {
  const g = f || {};
  const processCount = g.operationProcessCount == null ? null : g.operationProcessCount;
  const ev = {
    schemaVersion: SCHEMA_VERSION,
    operationId: g.operationId || null, workspaceId: g.workspaceId || null, providerId: g.providerId || null,
    providerVersion: g.providerVersion || null, preparedOperationId: g.preparedOperationId || null,
    operationHandleType: g.operationHandleType || null, operationHandleIdRedacted: g.operationHandleIdRedacted || null,
    executableContentHash: g.executableContentHash || null, argvHash: g.argvHash || null,
    startTimestamp: g.startTimestamp == null ? null : g.startTimestamp,
    exitTimestamp: g.exitTimestamp == null ? null : g.exitTimestamp,
    exitStatus: g.exitStatus == null ? null : g.exitStatus,
    outcome: g.outcome || "unknown",
    // (A) what the sandbox CAN enforce — derived from the capability attestation canaries.
    capabilityDerived: {
      canonicalDenialCapability: g.canonicalDenialCapability || "not-evaluated",
      otherProjectDenialCapability: g.otherProjectDenialCapability || "not-evaluated",
      credentialDenialCapability: g.credentialDenialCapability || "not-evaluated",
      networkDenialCapability: g.networkDenialCapability || "not-evaluated",
    },
    // (B) what was ACTUALLY observed for THIS operation.
    operationObserved: {
      actualWorkspaceIdentity: g.workspaceId || null,
      actualExecutableIdentity: g.executableIdentityHash || null,
      actualArgvHash: g.argvHash || null,
      operationProcessObservations: { processCount, containedDescendants: Array.isArray(g.containedDescendants) ? g.containedDescendants : [] },
      networkAttemptsObserved: g.networkAttemptsObserved || "NOT OBSERVABLE",
      canonicalAccessAttemptsObserved: g.canonicalAccessAttemptsObserved || "NOT OBSERVABLE",
      credentialAccessAttemptsObserved: g.credentialAccessAttemptsObserved || "NOT OBSERVABLE",
      terminationResult: g.terminationStatus || "NOT EXECUTED",
      disposalResult: g.disposalStatus || "not-disposed",
      residue: Array.isArray(g.residue) ? g.residue : [],
    },
  };
  ev.evidenceHash = hashEvidence(ev);
  return ev;
}

/**
 * Verify operation evidence against the operation context. Returns { ok, errors }.
 * @param ev  the operation-evidence object
 * @param ctx { operationId, workspaceId, providerId, executableContentHash, argvHash }
 * @param opts { requireSuccess } — when the run is reported COMPLETED/FAILED, demand a fully clean, disposed op.
 */
function verifyOperationEvidence(ev, ctx, opts) {
  const errors = []; const c = ctx || {}; const o = opts || {};
  if (!ev || typeof ev !== "object") return { ok: false, errors: ["op-evidence: not an object"] };
  for (const f of TOP_REQUIRED) if (!(f in ev)) errors.push("op-evidence: missing '" + f + "'");
  if (ev.schemaVersion !== SCHEMA_VERSION) errors.push("op-evidence: bad schemaVersion");
  const cap = ev.capabilityDerived || {}; const obs = ev.operationObserved || {};
  if (!ev.capabilityDerived || typeof ev.capabilityDerived !== "object") errors.push("op-evidence: capabilityDerived missing/malformed");
  if (!ev.operationObserved || typeof ev.operationObserved !== "object") errors.push("op-evidence: operationObserved missing/malformed");
  for (const f of CAP_DERIVED_FIELDS) if (!(f in cap)) errors.push("op-evidence: capabilityDerived missing '" + f + "'");
  for (const f of OBSERVED_FIELDS) if (!(f in obs)) errors.push("op-evidence: operationObserved missing '" + f + "'");

  // binding — a missing ctx field is a failure (never silently skipped).
  for (const k of ["operationId", "workspaceId", "providerId", "executableContentHash", "argvHash"]) {
    if (c[k] === undefined || c[k] === null) { errors.push("op-evidence: incomplete context (missing " + k + ")"); continue; }
    if (ev[k] !== c[k]) errors.push("op-evidence: " + k + " does not match the operation");
  }
  // the OBSERVED identity/argv must echo the same operation (not borrowed from elsewhere).
  if (obs.actualWorkspaceIdentity !== ev.workspaceId) errors.push("op-evidence: operationObserved.actualWorkspaceIdentity does not match the operation workspace");
  if (obs.actualArgvHash !== ev.argvHash) errors.push("op-evidence: operationObserved.actualArgvHash does not match the operation argv");

  // timestamps ordered; evidence must not be generated before exit.
  if (typeof ev.startTimestamp !== "number" || typeof ev.exitTimestamp !== "number" || ev.exitTimestamp < ev.startTimestamp) errors.push("op-evidence: start/exit timestamps invalid (evidence generated before exit?)");

  // termination enum + a canary value must never be substituted for a real observation.
  if (TERMINATION_STATUSES.indexOf(obs.terminationResult) < 0) errors.push("op-evidence: operationObserved.terminationResult is not a valid termination status" + (CANARY_TOKENS.has(String(obs.terminationResult)) ? " (a capability canary was substituted)" : ""));
  if (DISPOSAL_STATUSES.indexOf(obs.disposalResult) < 0) errors.push("op-evidence: operationObserved.disposalResult is not a valid disposal status");
  for (const k of ["networkAttemptsObserved", "canonicalAccessAttemptsObserved", "credentialAccessAttemptsObserved"]) {
    if (CANARY_TOKENS.has(String(obs[k]))) errors.push("op-evidence: operationObserved." + k + " carries a capability-canary value (must be an observation, e.g. NOT OBSERVABLE)");
  }

  // contradictions (always checked):
  const procCount = obs.operationProcessObservations && obs.operationProcessObservations.processCount;
  if (obs.terminationResult === "TERMINATED-CONFIRMED" && !(procCount === 0)) errors.push("op-evidence: TERMINATED-CONFIRMED but operation process count is not 0");
  if (obs.disposalResult === "disposed" && Array.isArray(obs.residue) && obs.residue.length > 0) errors.push("op-evidence: disposalResult 'disposed' but residue is non-empty");

  // integrity
  if (typeof ev.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(ev.evidenceHash)) errors.push("op-evidence: evidenceHash missing/invalid");
  else if (hashEvidence(ev) !== ev.evidenceHash) errors.push("op-evidence: evidenceHash mismatch (modified)");

  // a reported success requires a fully clean, disposed operation with a concrete (non-NOT-OBSERVABLE) termination.
  if (o.requireSuccess || SUCCESS_OUTCOMES.indexOf(ev.outcome) >= 0) {
    if (obs.terminationResult !== "TERMINATED-CONFIRMED") errors.push("op-evidence: a completed operation requires TERMINATED-CONFIRMED");
    if (procCount !== 0) errors.push("op-evidence: a completed operation requires operation process count 0");
    if (obs.disposalResult !== "disposed") errors.push("op-evidence: a completed operation requires disposalResult 'disposed'");
    if (Array.isArray(obs.residue) && obs.residue.length > 0) errors.push("op-evidence: a completed operation requires empty residue");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { buildOperationEvidence, verifyOperationEvidence, hashEvidence, SCHEMA_VERSION, TOP_REQUIRED, TERMINATION_STATUSES, DISPOSAL_STATUSES, CAP_DERIVED_FIELDS, OBSERVED_FIELDS };
