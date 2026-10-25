"use strict";
/**
 * Proves the Project Session Launcher invariants (PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A). Synthetic
 * inputs only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  a clean request (allowed ops only) → READY_TO_LAUNCH and permitted
 *  2  a gated operation → BLOCKED_AWAITING_OWNER, listed with requiresOwnerApproval, NOT permitted
 *  3  a prohibited operation → REFUSED, listed, NOT permitted
 *  4  an unknown operation is refused (allowlist, not denylist), incl. case/whitespace variants
 *  5  a production-targeting op on a frozen project is refused
 *  6  working directory that escapes the registered root → REFUSED with an error, not launchable
 *  7  a working directory inside the registered root resolves and is retained
 *  8  sessionId is deterministic for equal inputs and differs for different inputs (delimiter-collision-safe)
 *  9  secrets appear only as references (no value field), never materialised
 * 10  missing projectId/phaseId throw (structural validation)
 * 11  the spec is plan-only: executed:false, no execution-capable export, and only crypto+path required
 * 12  the request CANNOT choose its own root; only the trusted registry can. Unregistered project refused.
 * 13  a "__proto__" projectId cannot pull a root via the prototype chain
 * 14  an over-long operation list is refused (bounded input)
 * 15  an over-long secret-ref list is refused (bounded input, fail closed not truncate)
 */

const fs = require("fs");
const path = require("path");
const launcher = require("../launcher/session-launcher.cjs");
const { buildLaunchSpec } = launcher;

const ROOT = path.resolve("/work/projects/acme");
const TRUSTED = { projectRoots: { acme: ROOT } };

function run() {
  const errors = [];
  const base = { projectId: "acme", phaseId: "ACME-P1A", role: "implementer", workingDirectory: "src" };
  const spec = (req) => buildLaunchSpec(req, TRUSTED);

  // 1: clean request.
  const clean = spec({ ...base, requestedOperations: ["read-file", "run-local-test", "build"] });
  if (clean.decision !== "READY_TO_LAUNCH" || clean.permitted !== true) {
    errors.push("invariant 1: clean request was not READY_TO_LAUNCH/permitted");
  }

  // 2: gated operation.
  const gated = spec({ ...base, requestedOperations: ["build", "close-phase"] });
  if (gated.decision !== "BLOCKED_AWAITING_OWNER" || gated.permitted !== false) {
    errors.push("invariant 2: gated op did not block for owner approval");
  }
  if (!gated.gatedOperations.some((g) => g.operation === "close-phase" && g.requiresOwnerApproval === true)) {
    errors.push("invariant 2: gated op not listed with requiresOwnerApproval");
  }

  // 3: prohibited operation.
  const prohibited = spec({ ...base, productionFrozen: false, requestedOperations: ["send-external"] });
  if (prohibited.decision !== "REFUSED" || prohibited.permitted !== false) {
    errors.push("invariant 3: prohibited op was not REFUSED");
  }
  if (!prohibited.refusedOperations.some((r) => r.operation === "send-external" && r.reason === "prohibited")) {
    errors.push("invariant 3: prohibited op not listed as refused");
  }

  // 4: unknown op refused, incl. case/whitespace variants of prohibited (must NOT become allowed).
  for (const op of ["frobnicate-widgets", "Deploy-Production", " deploy-production", "DEPLOY-PRODUCTION"]) {
    const s = spec({ ...base, productionFrozen: false, requestedOperations: [op] });
    if (s.permitted !== false || s.decision !== "REFUSED") {
      errors.push("invariant 4: variant '" + op + "' was not refused");
    }
  }

  // 5: production-targeting op on a frozen project refused.
  const frozen = spec({ ...base, productionFrozen: true, requestedOperations: ["deploy-staging"] });
  if (!frozen.refusedOperations.some((r) => r.operation === "deploy-staging" && r.reason === "production-frozen")) {
    errors.push("invariant 5: production-targeting op on frozen project not refused");
  }

  // 6: working directory escape.
  for (const wd of ["../../etc", "..", "../sibling"]) {
    const s = spec({ ...base, workingDirectory: wd, requestedOperations: ["read-file"] });
    if (s.decision !== "REFUSED" || s.workingDirectory !== null || !s.workingDirectoryError) {
      errors.push("invariant 6: working-directory escape '" + wd + "' was not refused");
    }
  }

  // 7: working directory inside root retained.
  if (typeof clean.workingDirectory !== "string" || !clean.workingDirectory) {
    errors.push("invariant 7: valid working directory was not resolved/retained");
  }

  // 8: deterministic + collision-safe sessionId.
  const a1 = spec({ ...base, requestedOperations: ["build"] });
  const a2 = spec({ ...base, requestedOperations: ["build"] });
  const b = spec({ ...base, phaseId: "ACME-P2A", requestedOperations: ["build"] });
  if (a1.sessionId !== a2.sessionId) errors.push("invariant 8: sessionId not deterministic");
  if (a1.sessionId === b.sessionId) errors.push("invariant 8: sessionId did not change for different inputs");
  const c1 = buildLaunchSpec({ projectId: "a|b", phaseId: "c", role: "r" }, { projectRoots: { "a|b": ROOT } });
  const c2 = buildLaunchSpec({ projectId: "a", phaseId: "b|c", role: "r" }, { projectRoots: { a: ROOT } });
  if (c1.sessionId === c2.sessionId) errors.push("invariant 8: delimiter collision in sessionId basis");

  // 9: secrets only as references.
  const withSecret = spec({ ...base, requestedOperations: ["build"], secretRefs: ["ref_abc123"] });
  if (!withSecret.secretPlan.some((s) => s.ref === "ref_abc123" && s.valueExposed === false)) {
    errors.push("invariant 9: secret reference not planned correctly");
  }
  if (withSecret.secretPlan.some((s) => "value" in s)) errors.push("invariant 9: secret plan contained a value field");

  // 10: structural validation.
  for (const bad of [{ phaseId: "X" }, { projectId: "Y" }, {}]) {
    try { buildLaunchSpec(bad, TRUSTED); errors.push("invariant 10: missing required field did not throw"); }
    catch (e) { /* expected */ }
  }

  // 11: plan-only — never executes; only crypto+path required; no execution-capable export.
  if (clean.executed !== false) errors.push("invariant 11: spec was marked executed");
  for (const k of Object.keys(launcher)) {
    if (/exec|spawn|run|launch(?!Spec)|deploy/i.test(k) && k !== "buildLaunchSpec") {
      errors.push("invariant 11: launcher exports a suspicious execution-capable symbol: " + k);
    }
  }
  try {
    const src = fs.readFileSync(path.join(__dirname, "..", "launcher", "session-launcher.cjs"), "utf8");
    const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).sort();
    const allowed = ["crypto", "path"];
    if (requires.some((r) => !allowed.includes(r))) {
      errors.push("invariant 11: launcher requires a module outside {crypto, path}: " + requires.join(", "));
    }
  } catch (e) {
    errors.push("invariant 11: could not scan launcher source: " + e.message);
  }

  // 12: request cannot choose its own root; unregistered project refused.
  const spoof = buildLaunchSpec({ projectId: "acme", phaseId: "P", workingDirectory: "src", allowedRoot: "/", requestedOperations: ["read-file"] }, { projectRoots: { acme: ROOT } });
  if (spoof.workingDirectory !== path.resolve(ROOT, "src")) {
    errors.push("invariant 12: request-supplied allowedRoot was honoured (should be ignored)");
  }
  const unregistered = spec({ projectId: "ghost", phaseId: "P", workingDirectory: "src", requestedOperations: ["read-file"] });
  if (unregistered.permitted !== false || unregistered.decision !== "REFUSED" || unregistered.workingDirectory !== null) {
    errors.push("invariant 12: unregistered project was not refused");
  }

  // 13: prototype-chain projectId cannot pull a root.
  const proto = buildLaunchSpec({ projectId: "__proto__", phaseId: "P", workingDirectory: "src", requestedOperations: ["read-file"] }, { projectRoots: {} });
  if (proto.workingDirectory !== null || proto.decision !== "REFUSED") {
    errors.push("invariant 13: __proto__ projectId resolved a root via the prototype chain");
  }

  // 14: over-long operation list refused.
  const many = spec({ ...base, requestedOperations: new Array(201).fill("build") });
  if (many.decision !== "REFUSED" || !many.refusedOperations.some((r) => r.reason === "too-many-operations")) {
    errors.push("invariant 14: over-long operation list was not refused");
  }

  // 15: over-long secret-ref list refused (fail closed, not silently truncated).
  const manySecrets = spec({ ...base, requestedOperations: ["build"], secretRefs: new Array(201).fill("ref_x") });
  if (manySecrets.decision !== "REFUSED" || !manySecrets.refusedOperations.some((r) => r.reason === "too-many-secret-refs")) {
    errors.push("invariant 15: over-long secret-ref list was not refused");
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-session-launcher: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-session-launcher: PASS");
}
module.exports = { run };
