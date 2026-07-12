"use strict";
/**
 * Proves the Forge E2E chain (PROJECTOS-FORGE-E2E-CLOSURE1A / F10): every synthetic end-to-end scenario
 * reaches its expected governed outcome, and no secret leaks in the aggregate. Synthetic data only.
 *
 * Invariants:
 *  1  every scenario passes (each governed path behaves as expected)
 *  2  all four named scenarios are present (happy path + each fail-closed path)
 *  3  no secret value appears anywhere in the aggregate results
 *  4  results are deterministic across runs
 */

const { runForgeE2E } = require("../forge/forge-e2e.cjs");

const EXPECTED = ["happy-path", "insecure-blocked", "potemkin-not-verified", "budget-cap"];

function run() {
  const errors = [];
  const results = runForgeE2E();
  for (const r of results) if (!r.ok) errors.push("invariant 1: scenario '" + r.name + "' failed: " + r.detail);
  const names = results.map((r) => r.name);
  for (const n of EXPECTED) if (!names.includes(n)) errors.push("invariant 2: missing scenario " + n);
  if (results.length !== EXPECTED.length) errors.push("invariant 2: expected " + EXPECTED.length + " scenarios, got " + results.length);
  if (/eyJ[A-Za-z0-9_-]{12,}|sb_secret_|-----BEGIN/.test(JSON.stringify(results))) errors.push("invariant 3: a secret value leaked into the aggregate e2e results");
  if (JSON.stringify(runForgeE2E()) !== JSON.stringify(results)) errors.push("invariant 4: e2e results are not deterministic");
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-e2e: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-e2e: PASS");
}
module.exports = { run };
