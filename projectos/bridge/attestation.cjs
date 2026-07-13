"use strict";
/**
 * Operation-bound sandbox attestation contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§4).
 *
 * Replaces the boolean `attest().enforced === true` with a STRUCTURED, OPERATION-BOUND attestation that a
 * real provider produces by running CANARIES through the SAME sandbox boundary that will run the worker.
 * The adapter verifies the attestation belongs to THIS operation + workspace + provider instance, is
 * unexpired, covers every mandatory canary with no FAIL, matches the executable + policy, and is unmodified
 * (evidenceHash). A provider returning only `{ enforced: true }` fails every check.
 *
 * This module defines + VERIFIES the contract. It does NOT run a real sandbox; the mock provider generates a
 * SYNTHETIC attestation (labelled) that is still refused for real runs by the sandbox gate.
 */

const crypto = require("crypto");

const SCHEMA_VERSION = "attestation-1.0";
const MANDATORY_CANARIES = [
  "canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary",
  "networkCanary", "writablePathCanary", "childProcessContainmentCanary", "cleanupCanary",
  "emergencyTerminationCanary",
];
const REQUIRED_FIELDS = [
  "schemaVersion", "providerId", "providerVersion", "providerImplementationHash", "operationId",
  "projectId", "phaseId", "workspaceId", "workspacePathInsideSandbox", "executableResolvedPathInsideSandbox",
  "timestamp", "expiry", "overallResult", "evidenceHash",
].concat(MANDATORY_CANARIES);

// Canaries whose EXPECTED result is that the access is denied / not reachable.
const DENY_CANARIES = ["canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary", "networkCanary"];
// The ONLY safe `expected` value per canary — pinned by the verifier so a provider cannot self-choose a
// permissive expectation and pass. actual must equal this exact value (and result must be PASS).
const CANARY_EXPECTED = { canonicalPathCanary: "denied", otherProjectPathCanary: "denied", homePathCanary: "denied", credentialPathCanary: "denied", networkCanary: "denied", writablePathCanary: "allowed", childProcessContainmentCanary: "contained", cleanupCanary: "complete", emergencyTerminationCanary: "confirmed" };
// Context fields the caller MUST supply for binding — a missing one is a verification failure, never skipped.
const REQUIRED_CTX = ["providerId", "operationId", "projectId", "phaseId", "workspaceId", "executableResolvedPathInsideSandbox"];

function canonicalJson(obj) {
  // deterministic stringify (sorted keys) so the hash is stable across key order
  const seen = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null; seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      const out = {}; for (const k of Object.keys(v).sort()) out[k] = norm(v[k]); return out;
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}
function hashAttestation(att) {
  const copy = Object.assign({}, att); delete copy.evidenceHash;
  return crypto.createHash("sha256").update(canonicalJson(copy)).digest("hex");
}

/** A well-formed canary result. */
function makeCanary(attempted, expected, actual, evidence) {
  const pass = String(actual) === String(expected);
  return { attempted, expected, actual, result: pass ? "PASS" : "FAIL", evidence: String(evidence || "").slice(0, 200) };
}

/**
 * Verify an attestation against the CURRENT operation context. Returns { ok, errors }.
 * @param att  the attestation object returned by provider.attest(ctx)
 * @param ctx  { providerId, operationId, projectId, phaseId, workspaceId, executableResolvedPathInsideSandbox, now }
 */
function verifyAttestation(att, ctx) {
  const errors = [];
  const c = ctx || {};
  if (!att || typeof att !== "object") return { ok: false, errors: ["attestation: not an object (a bare { enforced:true } fails)"] };
  for (const f of REQUIRED_FIELDS) if (!(f in att)) errors.push("attestation: missing '" + f + "'");
  if (att.schemaVersion !== SCHEMA_VERSION) errors.push("attestation: bad schemaVersion");

  // binding to THIS operation / workspace / provider / executable — the ctx MUST be complete (a missing ctx
  // field is a failure, not a silently-skipped binding).
  for (const k of REQUIRED_CTX) { if (c[k] === undefined || c[k] === null) { errors.push("attestation: incomplete verification context (missing " + k + ")"); continue; } if (att[k] !== c[k]) errors.push("attestation: " + k + " does not match the current operation"); }

  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof att.timestamp !== "number" || typeof att.expiry !== "number") errors.push("attestation: timestamp/expiry must be numbers");
  else { if (att.expiry <= now) errors.push("attestation: expired"); if (att.timestamp > now + 60000) errors.push("attestation: timestamp is in the future"); }

  // every mandatory canary present, well-formed, PASS, and pinned to its ONLY safe expected value — a
  // provider cannot self-choose a permissive `expected`.
  for (const name of MANDATORY_CANARIES) {
    const k = att[name];
    if (!k || typeof k !== "object") { errors.push("attestation: canary '" + name + "' missing/malformed"); continue; }
    if (!("attempted" in k) || !("expected" in k) || !("actual" in k) || !("result" in k)) errors.push("attestation: canary '" + name + "' incomplete");
    if (k.result !== "PASS") errors.push("attestation: canary '" + name + "' is not PASS");
    if (String(k.expected) !== CANARY_EXPECTED[name]) errors.push("attestation: canary '" + name + "' expected must be '" + CANARY_EXPECTED[name] + "'");
    if (String(k.actual) !== CANARY_EXPECTED[name]) errors.push("attestation: canary '" + name + "' actual is not '" + CANARY_EXPECTED[name] + "'");
  }
  if (att.overallResult !== "PASS") errors.push("attestation: overallResult is not PASS");

  // integrity — the hash MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash fails,
  // it never skips the check). NOTE: this is an INTEGRITY hash, not an authenticity MAC — it detects post-hoc
  // mutation, not a compromised provider (see the module header / report trust boundary).
  if (typeof att.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(att.evidenceHash)) errors.push("attestation: evidenceHash missing/invalid");
  else if (hashAttestation(att) !== att.evidenceHash) errors.push("attestation: evidenceHash mismatch (modified)");

  return { ok: errors.length === 0, errors };
}

/**
 * Build a SYNTHETIC attestation for a mock provider (labelled). Bound to the supplied context; all deny
 * canaries "PASS" by asserting the access was denied/unreachable. Refused for real runs by the sandbox gate
 * (kind: mock) regardless — this only proves the VERIFIER accepts a well-formed operation-bound attestation.
 */
function syntheticAttestation(ctx, opts) {
  const o = opts || {};
  const now = typeof (o.now) === "number" ? o.now : Date.now();
  const c = ctx || {};
  const denied = (what) => makeCanary("access " + what, "denied", o.fail === what ? "reachable" : "denied", "synthetic");
  const contained = (what) => makeCanary(what, "contained", o.fail === what ? "escaped" : "contained", "synthetic");
  const att = {
    schemaVersion: SCHEMA_VERSION,
    providerId: c.providerId || null, providerVersion: o.providerVersion || "mock-0", providerImplementationHash: o.providerImplementationHash || "mock-hash",
    operationId: c.operationId || null, projectId: c.projectId || null, phaseId: c.phaseId || null,
    workspaceId: c.workspaceId || null, workspacePathInsideSandbox: o.workspacePathInsideSandbox || "/sandbox/workspace",
    executableResolvedPathInsideSandbox: c.executableResolvedPathInsideSandbox || "/sandbox/bin/claude",
    timestamp: now, expiry: now + (o.ttlMs || 300000),
    canonicalPathCanary: denied("canonical-repo"), otherProjectPathCanary: denied("other-projects"),
    homePathCanary: denied("home"), credentialPathCanary: denied("credentials"), networkCanary: denied("network"),
    writablePathCanary: makeCanary("write inside workspace", "allowed", o.fail === "writable" ? "denied" : "allowed", "synthetic"),
    childProcessContainmentCanary: contained("child-process"), cleanupCanary: makeCanary("cleanup", "complete", o.fail === "cleanup" ? "residue" : "complete", "synthetic"),
    emergencyTerminationCanary: makeCanary("emergency-terminate", "confirmed", o.fail === "emergency" ? "unconfirmed" : "confirmed", "synthetic"),
    overallResult: "PASS",
  };
  // overallResult reflects the canaries
  const anyFail = MANDATORY_CANARIES.some((n) => att[n].result !== "PASS");
  att.overallResult = anyFail ? "FAIL" : "PASS";
  if (o.omitCanary) delete att[o.omitCanary];
  att.evidenceHash = hashAttestation(att);
  if (o.tamper) att.workspacePathInsideSandbox = "/tampered"; // do NOT re-hash → evidenceHash mismatch
  return att;
}

module.exports = { verifyAttestation, syntheticAttestation, makeCanary, hashAttestation, canonicalJson, SCHEMA_VERSION, MANDATORY_CANARIES, REQUIRED_FIELDS, DENY_CANARIES, CANARY_EXPECTED, REQUIRED_CTX };
