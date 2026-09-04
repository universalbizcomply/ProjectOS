"use strict";
/**
 * CACHED VALIDATION RUNNER — wraps the validate-all module list with cache support.
 *
 * This runner is an ALTERNATIVE to validate-all.cjs, not a replacement. validate-all.cjs
 * remains the authoritative, full uncached runner. This runner adds a cache layer:
 *
 * 1. SUITE FAST PATH: If HEAD is unchanged and tree is clean, return all cached results. (≤2s)
 * 2. PER-VALIDATOR CACHE: For each validator with declared inputs, check if inputs changed.
 *    Unchanged → cache hit. Changed/unknown → run the validator. (targeted ≤60s)
 * 3. UNCACHED FALLBACK: Validators without input declarations always run.
 *
 * NEVER weakens full validation. Every cache miss runs the real validator. Deleting the
 * cache directory only affects performance, never correctness.
 *
 * Usage:
 *   node projectos/speed/cached-runner.cjs              # Run with cache
 *   node projectos/speed/cached-runner.cjs --no-cache   # Force full uncached run
 *   node projectos/speed/cached-runner.cjs --benchmark  # Run + report timing
 *   node projectos/speed/cached-runner.cjs --clear      # Clear cache and exit
 *   node projectos/speed/cached-runner.cjs --stats      # Show cache stats and exit
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A.
 */
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

const cache = require("./validation-cache.cjs");
const { buildInputMap } = require("./input-map.cjs");
const scratch = require("../validators/lib/scratch.cjs");

// The same module list as validate-all.cjs. Kept in sync by the validator
// validate-speed-validation-cache.cjs.
const MODULES = [
  "validate-no-secrets", "validate-project-config", "validate-phase-manifest",
  "validate-evidence-pack", "validate-forbidden-actions", "validate-examples",
  "validate-review-agents", "validate-ecc-routing",
  "validate-report-request", "validate-report-index", "validate-report-output", "validate-phase-reporter",
  "validate-staging-deploy-request", "validate-staging-deploy-guard", "validate-staging-deploy-output",
  "validate-proof-request", "validate-proof-plan", "validate-proof-output", "validate-proof-factory",
  "validate-drift-request", "validate-drift-snapshot", "validate-drift-output", "validate-drift-detector",
  "validate-ci-governance-policy", "validate-ci-workflow-template", "validate-ci-output", "validate-ci-governance",
  "validate-dashboard-config", "validate-dashboard-data", "validate-dashboard-output", "validate-dashboard-safety", "validate-dashboard",
  "validate-project-plan", "validate-current-project-state", "validate-active-execution-session",
  "validate-plan-ready-gate", "validate-plan-status", "validate-plan-version", "validate-plan-staleness", "validate-plan-no-secrets",
  "validate-plan-discovery-import",
  "validate-projectos-recovery-plan-authority1a",
  "validate-secret-broker",
  "validate-secret-operation-broker",
  "validate-session-launcher",
  "validate-desktop-bridge",
  "validate-e2e-runner",
  "validate-approval-queue",
  "validate-provider-context-guards",
  "validate-desktop-e2e",
  "validate-reliability-hardening",
  "validate-forge-blueprint",
  "validate-forge-scaffold",
  "validate-forge-provisioner",
  "validate-forge-generation",
  "validate-forge-verify",
  "validate-forge-snapshot",
  "validate-forge-deploy",
  "validate-forge-integrations",
  "validate-forge-e2e",
  "validate-shared-runtime-no-tauri",
  "validate-runtime-no-raw-string-events",
  "validate-windows-runtime-primitives-boundary",
  "validate-host-identity-boundary",
  "validate-host-authority-contract-boundary",
  "validate-host-authority-windows-boundary",
  "val-windows-service-identity-proof-3kideb",
  "val-windows-service-control-capability-b1",
  "val-windows-local-ipc-capability-b1",
  "val-windows-service-proof-runner-capability-b1",
  "val-windows-service-control-capability-b2",
  "val-host-authority-pipe-security-contract1a",
  "val-windows-local-ipc-capability-b3",
  "val-cd-b4-binding-consumer-surface1a",
  "val-windows-service-proof-runner-capability-b4",
  "val-cd-b4-effect-witness-contract1a",
  "val-cd-b4-elevation-observation-engine1a",
  "val-cd-b4-operation-phase-binding1a",
  "val-cd-b4-protected-plan-store1a",
  "val-cd-b4-protected-plan-reducer-permit1a",
  "val-cd-b4-plan-durable-store1a",
  "val-cd-b4-repository-baseline-adapter1a",
  "val-cd-b4-repository-authority-integration1a",
  "val-cd-b4-owner-presence-integration1a",
  "val-cd-b4-elevation-integration1a",
  "val-cd-b4-effect-grant-integration1a",
  "val-cd-b4-runtime-instance-authority1a",
  "val-cd-b4-ipc-session-authority1a",
  "val-cd-b4-runtime-ipc-permit-integration1a",
  "val-cd-b4-production-trusted-clock1a",
  "val-cd-b4-production-runtime-provider1a",
  "val-cd-b4-production-ipc-provider1a",
  "val-cd-b4-production-owner-presence-provider1a",
  "val-cd-b4-windows-user-verification-adapter1a",
  "val-cd-b4-control-centre-window-observation-bridge1a",
  "val-cd-b4-provider-authority-seam1a",
  "val-cd-b4-sealed-expected-window-facts1a",
  "val-cd-b4-owner-presence-capability-bridge1a",
  "val-cd-b4-host-authority-acquisition1a",
  "val-cd-b4-canonical-installation-identity1a",
  "val-cd-b4-host-authority-observer1a",
  "val-cd-b4-installer-canonical-identity-writer1a",
  "val-cd-b4-installer-id-source-closeout1b",
  "val-cd-b4-elevated-installer-composition1a",
  "val-cd-b4-installer-readiness1a",
  "val-cd-b4-projectoshost-service-runtime1a",
  "val-cd-b4-installed-host-status-contract1a",
  "val-cd-b4-record-file-acl-correction1a",
  "val-cd-b4-release-currentness1a",
  "val-projectoshost-build-provenance1a",
  "val-projectoshost-ipc-operation-contract1a",
  "val-projectoshost-ipc-peer-authentication1a",
  "val-projectoshost-ipc-kernel-peer-capture1a",
  "val-projectoshost-ipc-peer-contract-reconciliation1a",
  "val-projectoshost-configured-owner-enrolment-record1a",
  "val-projectos-packaged-runtime-contract1a",
  "val-projectos-release-workspace-freshness1a",
  "val-projectos-validator-scratch-lifecycle1a",
  "val-projectos-credential-vault1a",
  "val-projectos-session-router1a",
  "val-projectos-credential-router-adversarial1a",
  "val-projectos-v3-owner-presence-confirmation-ux1a",
  "val-projectos-v3-active-phase-consistency1a",
  "val-projectos-v3-webdriver-e2e-isolation1a",
  "val-projectos-v3-validation-evidence1a",
  "validate-zero-relay-continuity",
  "val-projectos-v3-zero-relay-failure-matrix1a",
  "validate-v3.1-crosswalk",
  "validate-v3.2-ai-provider-independence",
  "val-projectos-gatekeeper-contract1a",
  "val-projectos-trust-boundary1a",
  "val-projectos-provider-key-shapes1a",
  "val-projectos-file-inbox-inert1a",
  "val-projectos-live-worker-truth1a",
  "val-projectos-gate-decision-evidence1a",
  "val-projectos-portfolio-read-only1a",
  "val-projectos-work-record-not-authority1a",
  "val-projectos-worker-lifecycle-bounded1a",
  "val-projectos-live-gate-owner-floor1a",
  "val-projectos-technical-continuation1a",
  "val-projectos-closure-transport1a",
];

const REGISTERED_MODULE_COUNT = MODULES.length;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runValidator(name) {
  try {
    return require("../validators/" + name + ".cjs").run();
  } catch (e) {
    console.error("[" + name + "] CRASH: " + e.message);
    return null; // null = crash
  }
}

function run(options) {
  const opts = options || {};
  const useCache = opts.cache !== false;
  const benchmark = opts.benchmark === true;
  const startTime = benchmark ? Date.now() : 0;

  const results = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let total = 0;

  // --- Suite-level fast path ---
  if (useCache) {
    const suiteResults = cache.checkSuiteCache(ROOT);
    if (suiteResults !== null && suiteResults.length === REGISTERED_MODULE_COUNT) {
      // Verify every expected module is present
      const suiteNames = new Set(suiteResults.map(r => r.name));
      const allPresent = MODULES.every(m => suiteNames.has(m));
      if (allPresent) {
        const totalErrors = suiteResults.reduce((sum, r) => sum + (r.passed ? 0 : r.errorCount), 0);
        // Report
        for (const r of suiteResults) {
          if (r.passed) console.log("[" + r.name + "] PASS (cached)");
          else console.error("[" + r.name + "] FAIL (cached)");
        }
        console.log(
          "cached-runner: " + REGISTERED_MODULE_COUNT + " registered module(s), " +
          suiteResults.filter(r => r.passed).length + " PASS, " +
          suiteResults.filter(r => !r.passed).length + " FAIL" +
          " (suite cache hit)"
        );
        if (benchmark) {
          const elapsed = Date.now() - startTime;
          console.log("cached-runner: benchmark " + elapsed + "ms (suite cache hit, " + REGISTERED_MODULE_COUNT + " modules)");
        }
        if (totalErrors) {
          console.error("cached-runner: " + totalErrors + " error(s)");
          if (opts.exit !== false) process.exit(1);
          return { results: suiteResults, cacheHits: REGISTERED_MODULE_COUNT, cacheMisses: 0, elapsed: benchmark ? Date.now() - startTime : null };
        }
        console.log("cached-runner: ALL PASS");
        return { results: suiteResults, cacheHits: REGISTERED_MODULE_COUNT, cacheMisses: 0, elapsed: benchmark ? Date.now() - startTime : null };
      }
    }
  }

  // --- Per-validator path ---
  const inputMap = buildInputMap();
  const envHash = cache.environmentFingerprint();
  const libHash = cache.sharedLibHash(ROOT);
  const gitBefore = cache.gitState(ROOT);

  for (const m of MODULES) {
    // Check per-validator cache
    if (useCache) {
      const validatorPath = path.join(ROOT, "projectos", "validators", m + ".cjs");
      const inputs = inputMap[m] || [];
      const keyResult = cache.computeCacheKey({
        root: ROOT,
        validatorName: m,
        validatorPath,
        inputPaths: inputs,
        envHash,
        libHash,
      });
      const cached = cache.checkValidatorCache(ROOT, m, keyResult);
      if (cached !== null) {
        if (cached.passed) console.log("[" + m + "] PASS (cached)");
        else {
          console.error("[" + m + "] FAIL (cached)");
          total += cached.errorCount;
        }
        results.push({ name: m, passed: cached.passed, errorCount: cached.errorCount });
        cacheHits++;
        continue;
      }
    }

    // Cache miss — run the validator
    cacheMisses++;
    const errs = runValidator(m);
    scratch.cleanupAll();

    if (errs === null) {
      // Crash
      total += 1;
      results.push({ name: m, passed: false, errorCount: 1 });
      continue;
    }

    if (errs.length) {
      errs.forEach(x => console.error("[" + m + "] FAIL: " + x));
      total += errs.length;
    } else {
      console.log("[" + m + "] PASS");
    }
    const passed = errs.length === 0;
    results.push({ name: m, passed, errorCount: errs.length });

    // Save to per-validator cache
    if (useCache) {
      const validatorPath = path.join(ROOT, "projectos", "validators", m + ".cjs");
      const inputs = inputMap[m] || [];
      const keyResult = cache.computeCacheKey({
        root: ROOT,
        validatorName: m,
        validatorPath,
        inputPaths: inputs,
        envHash,
        libHash,
      });
      cache.saveValidatorCache(ROOT, m, keyResult, passed, errs.length);
    }
  }

  // Save suite cache if tree is clean and HEAD hasn't drifted
  if (useCache) {
    const gitAfter = cache.gitState(ROOT);
    if (gitAfter.clean && gitAfter.head !== null && gitAfter.head === gitBefore.head) {
      cache.saveSuiteCache(ROOT, gitAfter.head, results);
    }
  }

  // Maintenance pass
  if (useCache) {
    cache.maintain(ROOT);
  }

  const pass = results.filter(r => r.passed).length;
  const fail = results.filter(r => !r.passed).length;
  console.log(
    "cached-runner: " + REGISTERED_MODULE_COUNT + " registered module(s), " +
    pass + " PASS, " + fail + " FAIL" +
    " (cache: " + cacheHits + " hit, " + cacheMisses + " miss)"
  );

  if (benchmark) {
    const elapsed = Date.now() - startTime;
    console.log("cached-runner: benchmark " + elapsed + "ms (" + cacheHits + " cache hits, " + cacheMisses + " misses)");
  }

  if (total) {
    console.error("cached-runner: " + total + " error(s)");
    if (opts.exit !== false) process.exit(1);
  } else {
    console.log("cached-runner: ALL PASS");
  }

  return { results, cacheHits, cacheMisses, elapsed: benchmark ? Date.now() - startTime : null };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--clear")) {
    cache.clear(ROOT);
    console.log("cached-runner: cache cleared");
    process.exit(0);
  }

  if (args.includes("--stats")) {
    const s = cache.stats(ROOT);
    console.log("cached-runner: " + s.entries + " entries, " + (s.totalBytes / 1024).toFixed(1) + " KB");
    process.exit(0);
  }

  run({
    cache: !args.includes("--no-cache"),
    benchmark: args.includes("--benchmark"),
    exit: true,
  });
}

module.exports = { run, MODULES, REGISTERED_MODULE_COUNT };
