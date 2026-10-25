"use strict";
/**
 * Forge Verification Harness — PROJECTOS-FORGE-VERIFY1A (F5).
 *
 * Proves a generated app actually WORKS before it is called "done" — the anti-"Potemkin" gate (a UI that
 * renders but isn't wired: mocked data, dead handlers). It runs an ordered checklist of verification steps
 * (build, unit tests, route smoke, and a "wired" data-round-trip check) through a LOCAL verifier — the
 * owner's Claude Code worker / local test runner over the bridge, NOT a metered API. Verification is
 * fail-closed: a step counts as passed ONLY on an explicit `passed === true`; anything else (fail, throw,
 * malformed, missing) is a failure. An app is verified only when every REQUIRED kind is present AND passed
 * — so a route that renders but whose `wired` check fails is correctly NOT verified.
 *
 * Deterministic, zero-dependency beyond redaction. No network, no disk, no spawning, no metered API.
 */

const { createRedactor } = require("../security/redaction.cjs");

// The kinds that MUST be present and pass for an app to be verified. `wired` is the anti-Potemkin check:
// it proves data actually round-trips (write → read back), not merely that the page renders.
const DEFAULT_REQUIRED_KINDS = Object.freeze(["build", "unit", "wired"]);

function runVerification(opts) {
  const o = opts || {};
  if (!Array.isArray(o.checks)) throw new Error("verify-harness: checks[] required");
  if (typeof o.verifier !== "function") throw new Error("verify-harness: verifier function required");
  const redactor = o.redactor || createRedactor();
  const requiredKinds = Array.isArray(o.requiredKinds) ? o.requiredKinds : DEFAULT_REQUIRED_KINDS;

  const results = [];
  const failedRequired = [];
  const passedKinds = new Set();

  for (const c of o.checks) {
    const id = c && typeof c.id === "string" && c.id ? c.id : String((c && c.kind) || "check");
    const kind = c && typeof c.kind === "string" ? c.kind : "unknown";
    const required = !c || c.required !== false; // default: required
    let passed = false;
    let detail = "";
    try {
      const r = o.verifier({ id, kind });
      passed = !!(r && r.passed === true); // fail-closed: only an explicit true passes
      detail = redactor.redactText(String((r && r.detail) || ""));
    } catch (e) {
      passed = false;
      detail = "verifier-error"; // a thrown verifier is a failed check, never a pass
    }
    results.push({ id, kind, required, passed, detail });
    if (passed) passedKinds.add(kind);
    if (required && !passed) failedRequired.push(id);
  }

  // Every required kind must have been present AND passed.
  for (const k of requiredKinds) {
    if (!passedKinds.has(k)) failedRequired.push("missing-or-failed:" + k);
  }

  return { verified: failedRequired.length === 0, results, failedRequired: [...new Set(failedRequired)] };
}

module.exports = { runVerification, DEFAULT_REQUIRED_KINDS };
