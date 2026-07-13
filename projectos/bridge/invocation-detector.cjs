"use strict";
/**
 * Real tool-restriction DETECTION contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§5).
 *
 * Replaces a self-declared `verified: true` invocation profile with a VERIFICATION RECORD produced by a
 * detector. The record binds the restriction to the EXACT executable (content hash + version), the operation
 * mode, the sandbox provider, and the policy version, and records a safe NEGATIVE-CAPABILITY test (attempts
 * to invoke forbidden shell / network / git-write capabilities, expecting "DENIED BY TECHNICAL CONTROL").
 *
 * A manually-supplied profile with plausible strings and `verified:true` (but no detector record, or a record
 * bound to a different executable / version, or expired) is REJECTED. This module defines + verifies the
 * contract; the real detection runs on an owner machine. Synthetic providers prove the verifier.
 */

const crypto = require("crypto");
const { canonicalJson } = require("./attestation.cjs");

const DETECTOR_VERSION = "detector-1.0";
const NEGATIVE_TESTS = ["shell", "network", "git-write"];
const DENIED = "DENIED BY TECHNICAL CONTROL";
// Tool names that grant a forbidden capability; a permitted-tools list may never contain any of them, and a
// forbidden-tools list must contain at least the shell/web/git ones.
const DANGEROUS_TOOLS = ["Bash", "Shell", "Execute", "Run", "WebFetch", "WebSearch", "Git", "GitWrite", "Provider", "Database", "Deploy"];
const MUST_FORBID = ["Bash", "Shell", "WebFetch", "Git"];
const RECORD_FIELDS = [
  "detectorVersion", "resolvedExecutablePath", "executableContentHash", "cliVersion", "restrictionMechanism",
  "permittedTools", "forbiddenTools", "permittedCommands", "shellDisabled", "gitWriteDisabled",
  "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled",
  "commandExecutionDisabled", "negativeTests", "operationMode", "sandboxProviderId", "policyVersion",
  "timestamp", "expiry", "recordHash",
];
const MUST_DISABLE = ["shellDisabled", "gitWriteDisabled", "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled"];

function hashRecord(rec) { const c = Object.assign({}, rec); delete c.recordHash; return crypto.createHash("sha256").update(canonicalJson(c)).digest("hex"); }

/**
 * Verify a detection record against the current binding context. Returns { ok, errors }.
 * @param rec detection record (from a real detector, or syntheticRecord for tests)
 * @param ctx { executableContentHash, cliVersion, operationMode, sandboxProviderId, policyVersion, now, firstControlledChange }
 */
function verifyDetectionRecord(rec, ctx) {
  const errors = [];
  const c = ctx || {};
  if (!rec || typeof rec !== "object") return { ok: false, errors: ["detection: not a record (a bare verified:true profile fails)"] };
  for (const f of RECORD_FIELDS) if (!(f in rec)) errors.push("detection: missing '" + f + "'");
  if (rec.detectorVersion !== DETECTOR_VERSION) errors.push("detection: unknown detectorVersion");

  // binding — a missing ctx value is a failure (never a silently-skipped binding).
  const bind = ["executableContentHash", "cliVersion", "operationMode", "sandboxProviderId", "policyVersion"];
  for (const k of bind) { if (c[k] === undefined || c[k] === null) { errors.push("detection: incomplete verification context (missing " + k + ")"); continue; } if (rec[k] !== c[k]) errors.push("detection: " + k + " does not match (record bound to a different " + k + ")"); }
  if (!rec.executableContentHash) errors.push("detection: no executable content hash");

  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof rec.timestamp !== "number" || typeof rec.expiry !== "number") errors.push("detection: timestamp/expiry must be numbers");
  else if (rec.expiry <= now) errors.push("detection: verification record expired");

  // hard disables
  for (const k of MUST_DISABLE) if (rec[k] !== true) errors.push("detection: " + k + " is not proven true");

  // tool-LIST content must agree with the disable flags: no permitted tool may grant a forbidden capability,
  // and the forbidden list must include the dangerous ones (a self-contradictory record is refused).
  const permitted = Array.isArray(rec.permittedTools) ? rec.permittedTools.map(String) : [];
  const forbidden = Array.isArray(rec.forbiddenTools) ? rec.forbiddenTools.map(String) : [];
  for (const t of permitted) if (DANGEROUS_TOOLS.indexOf(t) >= 0) errors.push("detection: permittedTools contains a dangerous-capability tool '" + t + "'");
  for (const t of MUST_FORBID) if (forbidden.indexOf(t) < 0) errors.push("detection: forbiddenTools must include '" + t + "'");

  // negative-capability tests: each must be DENIED BY TECHNICAL CONTROL
  const nt = Array.isArray(rec.negativeTests) ? rec.negativeTests : [];
  for (const name of NEGATIVE_TESTS) {
    const t = nt.find((x) => x && x.capability === name);
    if (!t) { errors.push("detection: missing negative test for '" + name + "'"); continue; }
    if (t.result !== DENIED) errors.push("detection: negative test '" + name + "' did not report '" + DENIED + "'");
  }

  // first controlled-change: command execution disabled + no permitted commands
  if (c.firstControlledChange) {
    if (rec.commandExecutionDisabled !== true) errors.push("detection: commandExecutionDisabled must be true for the first proof");
    if (Array.isArray(rec.permittedCommands) && rec.permittedCommands.length > 0) errors.push("detection: permittedCommands must be empty for the first proof");
  }

  // integrity — recordHash MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash
  // fails; it never skips). Integrity, not authenticity (see report trust boundary).
  if (typeof rec.recordHash !== "string" || !/^[0-9a-f]{64}$/.test(rec.recordHash)) errors.push("detection: recordHash missing/invalid");
  else if (hashRecord(rec) !== rec.recordHash) errors.push("detection: recordHash mismatch (modified)");

  return { ok: errors.length === 0, errors };
}

/** Build a SYNTHETIC detection record (labelled) bound to a context — proves the verifier accepts a good one. */
function syntheticRecord(ctx, opts) {
  const o = opts || {};
  const c = ctx || {};
  const now = typeof o.now === "number" ? o.now : Date.now();
  const neg = NEGATIVE_TESTS.map((cap) => ({ capability: cap, attempted: "invoke " + cap, expected: DENIED, result: o.negFail === cap ? "ALLOWED" : DENIED }));
  const rec = {
    detectorVersion: DETECTOR_VERSION,
    resolvedExecutablePath: o.resolvedExecutablePath || "/sandbox/bin/claude",
    executableContentHash: c.executableContentHash || "exe-hash",
    cliVersion: c.cliVersion || "1.9.0", restrictionMechanism: o.restrictionMechanism || "--allowedTools",
    permittedTools: o.permittedTools || ["Read", "Edit"], forbiddenTools: o.forbiddenTools || ["Bash", "Shell", "WebFetch", "Git"],
    permittedCommands: o.permittedCommands || [],
    shellDisabled: o.shellDisabled !== false, gitWriteDisabled: o.gitWriteDisabled !== false, networkDisabled: o.networkDisabled !== false,
    providerToolsDisabled: o.providerToolsDisabled !== false, databaseToolsDisabled: o.databaseToolsDisabled !== false, deploymentToolsDisabled: o.deploymentToolsDisabled !== false,
    commandExecutionDisabled: o.commandExecutionDisabled !== false,
    negativeTests: neg, operationMode: c.operationMode || "first-controlled-change",
    sandboxProviderId: c.sandboxProviderId || null, policyVersion: c.policyVersion || "policy-1",
    timestamp: now, expiry: now + (o.ttlMs || 300000),
  };
  rec.recordHash = hashRecord(rec);
  if (o.tamper) rec.cliVersion = "9.9.9"; // do NOT re-hash → mismatch
  return rec;
}

module.exports = { verifyDetectionRecord, syntheticRecord, hashRecord, DETECTOR_VERSION, NEGATIVE_TESTS, DENIED, RECORD_FIELDS };
