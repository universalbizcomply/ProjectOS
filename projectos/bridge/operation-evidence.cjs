"use strict";
/**
 * Post-execution OPERATION EXECUTION EVIDENCE — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D (§4B, §8).
 *
 * The two-stage attestation model splits (A) PROVIDER CAPABILITY ATTESTATION — proven up front, "the sandbox
 * CAN deny canonical/home/network and CAN terminate/clean" — from (B) OPERATION EXECUTION EVIDENCE — created
 * AFTER the actual operation ran and terminated, proving the result FOR THAT EXACT OPERATION. A capability
 * canary must never be accepted as proof that this specific operation was cleaned or terminated.
 *
 * This module builds + verifies (B). Operation-bound (operationId + workspaceId + providerId + argv/exe hash),
 * with an always-checked evidenceHash. Integrity, not authenticity (see report trust boundary).
 */

const { canonicalJson } = require("./attestation.cjs"); // reuse canonical serialisation

const REQUIRED = [
  "schemaVersion", "operationId", "workspaceId", "providerId", "providerVersion", "operationHandleType",
  "operationHandleIdRedacted", "executableContentHash", "argvHash", "startTimestamp", "exitTimestamp",
  "exitStatus", "terminationStatus", "operationProcessCount", "containedDescendants", "networkDenialResult",
  "canonicalAccessDenialResult", "otherProjectAccessDenialResult", "credentialAccessDenialResult",
  "outputRedactionResult", "disposalStatus", "residue", "evidenceHash",
];
const TERMINATION_STATUSES = ["NOT EXECUTED", "TERMINATED-CONFIRMED", "TERMINATION-UNCONFIRMED", "EMERGENCY-STOP-REQUIRED"];

function hashEvidence(ev) { const c = Object.assign({}, ev); delete c.evidenceHash; return require("crypto").createHash("sha256").update(canonicalJson(c)).digest("hex"); }

function buildOperationEvidence(f) {
  const ev = {
    schemaVersion: "op-evidence-1.0",
    operationId: f.operationId || null, workspaceId: f.workspaceId || null, providerId: f.providerId || null,
    providerVersion: f.providerVersion || null, operationHandleType: f.operationHandleType || null,
    operationHandleIdRedacted: f.operationHandleIdRedacted || null, executableContentHash: f.executableContentHash || null,
    argvHash: f.argvHash || null, startTimestamp: f.startTimestamp == null ? null : f.startTimestamp,
    exitTimestamp: f.exitTimestamp == null ? null : f.exitTimestamp, exitStatus: f.exitStatus == null ? null : f.exitStatus,
    terminationStatus: f.terminationStatus || "NOT EXECUTED", operationProcessCount: f.operationProcessCount == null ? null : f.operationProcessCount,
    containedDescendants: Array.isArray(f.containedDescendants) ? f.containedDescendants : [],
    networkDenialResult: f.networkDenialResult || "not-evaluated", canonicalAccessDenialResult: f.canonicalAccessDenialResult || "not-evaluated",
    otherProjectAccessDenialResult: f.otherProjectAccessDenialResult || "not-evaluated", credentialAccessDenialResult: f.credentialAccessDenialResult || "not-evaluated",
    outputRedactionResult: f.outputRedactionResult || "applied", disposalStatus: f.disposalStatus || "not-disposed",
    residue: Array.isArray(f.residue) ? f.residue : [],
  };
  ev.evidenceHash = hashEvidence(ev);
  return ev;
}

/** Verify operation evidence against the operation context. Returns { ok, errors }. */
function verifyOperationEvidence(ev, ctx) {
  const errors = []; const c = ctx || {};
  if (!ev || typeof ev !== "object") return { ok: false, errors: ["op-evidence: not an object"] };
  for (const f of REQUIRED) if (!(f in ev)) errors.push("op-evidence: missing '" + f + "'");
  if (ev.schemaVersion !== "op-evidence-1.0") errors.push("op-evidence: bad schemaVersion");
  for (const k of ["operationId", "workspaceId", "providerId", "executableContentHash", "argvHash"]) {
    if (c[k] === undefined || c[k] === null) { errors.push("op-evidence: incomplete context (missing " + k + ")"); continue; }
    if (ev[k] !== c[k]) errors.push("op-evidence: " + k + " does not match the operation");
  }
  if (typeof ev.startTimestamp !== "number" || typeof ev.exitTimestamp !== "number" || ev.exitTimestamp < ev.startTimestamp) errors.push("op-evidence: start/exit timestamps invalid");
  if (TERMINATION_STATUSES.indexOf(ev.terminationStatus) < 0) errors.push("op-evidence: bad terminationStatus enum");
  if (typeof ev.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(ev.evidenceHash)) errors.push("op-evidence: evidenceHash missing/invalid");
  else if (hashEvidence(ev) !== ev.evidenceHash) errors.push("op-evidence: evidenceHash mismatch (modified)");
  return { ok: errors.length === 0, errors };
}

module.exports = { buildOperationEvidence, verifyOperationEvidence, hashEvidence, REQUIRED, TERMINATION_STATUSES };
