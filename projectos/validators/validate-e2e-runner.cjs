"use strict";
/**
 * Proves the local E2E Runner (PROJECTOS-V3-E2E-RUNNER1A): every synthetic end-to-end scenario reaches
 * its expected governed outcome, and no secret leaks anywhere in the aggregate results. Synthetic data
 * only. If any scenario regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  every scenario passes (each governed path behaves as expected)
 *  2  all six named scenarios are present (happy path + each fail-closed path)
 *  3  no secret value appears anywhere in the aggregate results
 *  4  results are deterministic across runs
 */

const { runAllScenarios, SYNTH_SECRET } = require("../e2e/e2e-runner.cjs");

const EXPECTED = [
  "happy-path", "refused-spec", "owner-hold",
  "disallowed-side-effect", "secret-redaction", "correlation-mismatch",
];

function run() {
  const errors = [];
  const results = runAllScenarios();

  // 1: every scenario passes.
  for (const r of results) {
    if (!r.ok) errors.push("invariant 1: scenario '" + r.name + "' failed: " + r.detail);
  }

  // 2: all expected scenarios present.
  const names = results.map((r) => r.name);
  for (const n of EXPECTED) {
    if (!names.includes(n)) errors.push("invariant 2: missing scenario " + n);
  }
  if (results.length !== EXPECTED.length) {
    errors.push("invariant 2: expected " + EXPECTED.length + " scenarios, got " + results.length);
  }

  // 3: no secret in aggregate results.
  if (JSON.stringify(results).includes(SYNTH_SECRET)) {
    errors.push("invariant 3: a secret value leaked into the aggregate e2e results");
  }

  // 4: deterministic.
  if (JSON.stringify(runAllScenarios()) !== JSON.stringify(results)) {
    errors.push("invariant 4: e2e results are not deterministic across runs");
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-e2e-runner: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-e2e-runner: PASS");
}
module.exports = { run };
