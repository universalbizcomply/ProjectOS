"use strict";
/**
 * Proves the Claude Desktop Bridge protocol invariants (PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A). Synthetic
 * data only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  a READY launch spec builds a dispatchable request with a correlation id and allowed operations
 *  2  a REFUSED launch spec is NOT dispatchable (no envelope)
 *  3  a BLOCKED (owner-approval) launch spec is NOT dispatchable and is marked requiresOwnerApproval
 *  4  a request without a correlation id throws
 *  5  a response with a mismatched correlation id is rejected
 *  6  a response with an invalid/absent status is rejected
 *  7  a worker requesting an owner-gated, prohibited, UNKNOWN, or non-string side effect has it refused
 *  8  a worker requesting an allowlisted side effect (status completed) is accepted
 *  9  forbidden authority fields are stripped — at the top level AND nested in artifacts
 * 10  an oversized response envelope is rejected
 * 11  secrets are redacted in BOTH the request and the response — no cleartext secret crosses the bridge
 * 12  the synthetic in-process worker round-trips a benign completed response (accepted, artifacts kept)
 * 13  a malformed (non-object) response is rejected
 * 14  omitting the required redactor throws (no silent empty-redactor default)
 */

const bridge = require("../bridge/desktop-bridge.cjs");
const { createRedactor } = require("../security/redaction.cjs");
const { buildLaunchSpec } = require("../launcher/session-launcher.cjs");
const path = require("path");

const SECRET = "synthetic-bridge-secret-9a1c2b";
const ROOT = path.resolve("/work/projects/acme");
const TRUSTED = { projectRoots: { acme: ROOT } };
const CID = "corr-0001";

function readySpec(ops) {
  return buildLaunchSpec({ projectId: "acme", phaseId: "P1", workingDirectory: "src", requestedOperations: ops || ["build"] }, TRUSTED);
}

function run() {
  const errors = [];
  const R = createRedactor();
  const reqOf = (launchSpec, correlationId) => bridge.createBridgeRequest({ launchSpec, correlationId, redactor: R });
  const respOf = (env, response) => bridge.validateBridgeResponse(env, response, R);

  // 1: READY → dispatchable request.
  const ready = readySpec(["build", "read-file"]);
  const req = reqOf(ready, CID);
  if (!req.dispatchable || !req.envelope || req.envelope.correlationId !== CID) {
    errors.push("invariant 1: READY spec did not build a dispatchable request");
  }
  if (!Array.isArray(req.envelope && req.envelope.allowedOperations) || req.envelope.requiresOwnerApproval !== false) {
    errors.push("invariant 1: request envelope missing allowedOperations / wrong approval flag");
  }

  // 2: REFUSED → not dispatchable.
  const refusedSpec = buildLaunchSpec({ projectId: "acme", phaseId: "P1", workingDirectory: "src", requestedOperations: ["send-external"], productionFrozen: false }, TRUSTED);
  const refReq = reqOf(refusedSpec, CID);
  if (refReq.dispatchable !== false || refReq.envelope !== null || refReq.reason !== "launch-spec-refused") {
    errors.push("invariant 2: REFUSED spec was dispatchable");
  }

  // 3: BLOCKED → not dispatchable, requiresOwnerApproval.
  const blockedSpec = readySpec(["build", "close-phase"]); // close-phase is owner-gated → BLOCKED
  const blkReq = reqOf(blockedSpec, CID);
  if (blkReq.dispatchable !== false || !blkReq.envelope || blkReq.envelope.requiresOwnerApproval !== true) {
    errors.push("invariant 3: BLOCKED spec was not held for owner approval");
  }

  // 4: correlation id required.
  try { bridge.createBridgeRequest({ launchSpec: ready, redactor: R }); errors.push("invariant 4: missing correlationId did not throw"); }
  catch (e) { /* expected */ }

  // 5: correlation mismatch rejected.
  const mismatch = respOf(req.envelope, { correlationId: "other", status: "completed" });
  if (mismatch.ok !== false || mismatch.reason !== "correlation-mismatch") errors.push("invariant 5: correlation mismatch not rejected");

  // 6: invalid status rejected.
  const badStatus = respOf(req.envelope, { correlationId: CID, status: "whatever" });
  if (badStatus.ok !== false || badStatus.reason !== "invalid-status") errors.push("invariant 6: invalid status not rejected");

  // 7: disallowed / unknown / non-string side effects all refused (allowlist).
  const disallowed = respOf(req.envelope, {
    correlationId: CID, status: "completed",
    requestedSideEffects: ["deploy-production", "close-phase", "wipe-repo", 42, "read-file"],
  });
  if (disallowed.accepted !== false) errors.push("invariant 7: response with disallowed side effect was accepted");
  for (const bad of ["deploy-production", "close-phase", "wipe-repo", "(non-string)"]) {
    if (!disallowed.refusedSideEffects.includes(bad)) errors.push("invariant 7: side effect not refused: " + bad);
  }
  if (!disallowed.allowedSideEffects.includes("read-file")) errors.push("invariant 7: allowlisted side effect not surfaced");

  // 8: allowlisted side effect accepted.
  const allowed = respOf(req.envelope, { correlationId: CID, status: "completed", requestedSideEffects: ["read-file"] });
  if (allowed.accepted !== true || !allowed.allowedSideEffects.includes("read-file")) {
    errors.push("invariant 8: allowlisted side effect was not accepted");
  }

  // 9: forbidden authority fields stripped — top level AND nested.
  const spoof = respOf(req.envelope, {
    correlationId: CID, status: "completed", planReady: true, authoritative: true,
    artifacts: [{ name: "x", planReady: true, authoritative: true }],
  });
  if (!spoof.strippedFields.includes("planReady") || !spoof.strippedFields.includes("authoritative")) {
    errors.push("invariant 9: top-level forbidden fields not reported as stripped");
  }
  if (spoof.response && ("planReady" in spoof.response || "authoritative" in spoof.response)) {
    errors.push("invariant 9: forbidden authority field survived at top level");
  }
  const art0 = spoof.artifacts[0];
  if (art0 && ("planReady" in art0 || "authoritative" in art0)) {
    errors.push("invariant 9: forbidden authority field survived nested in an artifact");
  }

  // 10: oversized response rejected.
  const big = respOf(req.envelope, { correlationId: CID, status: "completed", blob: "x".repeat(300 * 1024) });
  if (big.ok !== false || big.reason !== "response-too-large") errors.push("invariant 10: oversized response not rejected");

  // 11: secrets redacted both directions (shared redactor with the secret registered).
  const RS = createRedactor();
  RS.register(SECRET, "ref_secret");
  const leakySpec = { ...ready, note: "uses " + SECRET };
  const leakyReq = bridge.createBridgeRequest({ launchSpec: leakySpec, correlationId: CID, redactor: RS });
  if (JSON.stringify(leakyReq.envelope).includes(SECRET)) errors.push("invariant 11: secret leaked into the request envelope");
  const resp = bridge.validateBridgeResponse(req.envelope, {
    correlationId: CID, status: "completed", artifacts: [{ name: "log", body: "token was " + SECRET }],
  }, RS);
  if (JSON.stringify(resp.artifacts).includes(SECRET)) errors.push("invariant 11: secret leaked through a response artifact");

  // 12: synthetic worker round-trip.
  const rt = bridge.runSyntheticWorker(req.envelope, (env) => ({
    correlationId: env.correlationId, status: "completed", artifacts: [{ name: "result", body: "ok" }], requestedSideEffects: ["read-file"],
  }), R);
  if (rt.ok !== true || rt.accepted !== true || rt.artifacts.length !== 1) {
    errors.push("invariant 12: synthetic worker round-trip did not accept a benign response");
  }

  // 13: malformed response rejected.
  const malformed = respOf(req.envelope, null);
  if (malformed.ok !== false || malformed.reason !== "malformed-response") errors.push("invariant 13: malformed response not rejected");

  // 14: required redactor.
  try { bridge.validateBridgeResponse(req.envelope, { correlationId: CID, status: "completed" }); errors.push("invariant 14: missing redactor did not throw"); }
  catch (e) { /* expected */ }
  try { bridge.createBridgeRequest({ launchSpec: ready, correlationId: CID }); errors.push("invariant 14: missing request redactor did not throw"); }
  catch (e) { /* expected */ }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-desktop-bridge: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-desktop-bridge: PASS");
}
module.exports = { run };
