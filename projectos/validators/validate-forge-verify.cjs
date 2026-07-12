"use strict";
/**
 * Proves the Forge Verification Harness invariants (PROJECTOS-FORGE-VERIFY1A / F5). Synthetic verifiers
 * only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  all required checks pass → verified: true
 *  2  a failed required check → verified: false and it is listed in failedRequired
 *  3  ANTI-POTEMKIN: build + unit + route-smoke pass but the required `wired` check fails → NOT verified
 *  4  a verifier that throws on a check fails that check closed (never a pass)
 *  5  a missing required kind → NOT verified (missing-or-failed listed)
 *  6  a secret in a check detail is redacted
 *  7  deterministic (same checks + verifier → same result)
 *  8  a failing OPTIONAL check does not block verification
 *  9  fail-closed: a non-boolean / malformed verifier result is NOT counted as passed
 * 10  no network / metered API / spawn (only redaction is required)
 */

const fs = require("fs");
const path = require("path");
const { runVerification } = require("../forge/verify-harness.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-verify-secret-9x8y7z";
const CHECKS = [
  { id: "c-build", kind: "build" },
  { id: "c-unit", kind: "unit" },
  { id: "c-smoke", kind: "route-smoke", required: false },
  { id: "c-wired", kind: "wired" },
];

const passAll = () => ({ passed: true, detail: "ok" });

function run() {
  const errors = [];

  // 1: all pass → verified.
  const r1 = runVerification({ checks: CHECKS, verifier: passAll });
  if (r1.verified !== true || r1.failedRequired.length !== 0) errors.push("invariant 1: all-pass not verified");

  // 2: a failed required check.
  const failUnit = (c) => ({ passed: c.kind !== "unit", detail: "x" });
  const r2 = runVerification({ checks: CHECKS, verifier: failUnit });
  if (r2.verified !== false || !r2.failedRequired.includes("c-unit")) errors.push("invariant 2: failed required check not caught");

  // 3: anti-Potemkin — everything renders/builds but wired fails.
  const potemkin = (c) => ({ passed: c.kind !== "wired", detail: "renders" });
  const r3 = runVerification({ checks: CHECKS, verifier: potemkin });
  if (r3.verified !== false) errors.push("invariant 3: Potemkin app (unwired) was verified");
  if (!r3.failedRequired.includes("c-wired")) errors.push("invariant 3: failed wired check not listed");

  // 4: verifier throws on a check.
  const throwWired = (c) => { if (c.kind === "wired") throw new Error("boom"); return { passed: true }; };
  const r4 = runVerification({ checks: CHECKS, verifier: throwWired });
  if (r4.verified !== false) errors.push("invariant 4: a throwing verifier check was treated as verified");
  const wiredRes = r4.results.find((x) => x.kind === "wired");
  if (!wiredRes || wiredRes.passed !== false) errors.push("invariant 4: throwing check not failed-closed");

  // 5: missing required kind (no wired check supplied at all).
  const r5 = runVerification({ checks: [{ id: "b", kind: "build" }, { id: "u", kind: "unit" }], verifier: passAll });
  if (r5.verified !== false || !r5.failedRequired.some((f) => f.includes("wired"))) errors.push("invariant 5: missing required kind not caught");

  // 6: secret in detail redacted.
  const redactor = createRedactor();
  redactor.register(SECRET, "ref_v");
  const leaky = () => ({ passed: true, detail: "token=" + SECRET });
  const r6 = runVerification({ checks: CHECKS, verifier: leaky, redactor });
  if (JSON.stringify(r6).includes(SECRET)) errors.push("invariant 6: secret leaked through a check detail");

  // 7: deterministic.
  if (JSON.stringify(runVerification({ checks: CHECKS, verifier: passAll })) !== JSON.stringify(r1)) errors.push("invariant 7: verification is not deterministic");

  // 8: failing OPTIONAL check doesn't block.
  const failSmoke = (c) => ({ passed: c.kind !== "route-smoke", detail: "x" });
  const r8 = runVerification({ checks: CHECKS, verifier: failSmoke });
  if (r8.verified !== true) errors.push("invariant 8: a failing optional check blocked verification");

  // 9: malformed verifier results are not counted as passed.
  for (const bad of [null, undefined, {}, { passed: "true" }, { passed: 1 }, 42, "passed"]) {
    const r = runVerification({ checks: [{ id: "w", kind: "wired" }, { id: "b", kind: "build" }, { id: "u", kind: "unit" }], verifier: () => bad });
    if (r.verified !== false) errors.push("invariant 9: malformed verifier result counted as passed: " + JSON.stringify(bad));
  }

  // 10: no network / metered API / spawn.
  const src = fs.readFileSync(path.join(__dirname, "..", "forge", "verify-harness.cjs"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const rq of requires) if (!/^\.\.\//.test(rq)) errors.push("invariant 10: verify-harness requires a non-local module: " + rq);
  if (/https?:|child_process|\.spawn\(|openai|anthropic|fetch\(/i.test(src)) errors.push("invariant 10: verify-harness references network/AI-API/spawn");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-verify: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-verify: PASS");
}
module.exports = { run };
