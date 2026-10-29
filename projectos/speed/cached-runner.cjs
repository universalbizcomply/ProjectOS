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
const { buildInputMap, validatorsInvalidatedBy } = require("./input-map.cjs");
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
  // RUN-TO-COMPLETION HOST ATTESTATION §10I — first-start durable store custody.
  "val-host-store-custody-10i",
  "val-projectos-host-review-path1a",
  "val-projectos-host-review-path1b",
  "val-projectos-agent-workforce1a",
  // PROJECTOS-BOOT-CONTINUE1A — safe continuation across approved phases.
  "val-projectos-boot-continue1a",
  // ProjectOS Watchdog Core (merged from main).
  "val-watchdog-core1a",
  // PROJECTOS-KERNEL-HYGIENE1A — validators that existed in the tree but were never run here.
  "val-host-state-activation-wiring-10h",
  "validate-v2-closure-evidence",
  "validate-wsl2-provider",
  "val-projectos-kernel-role-review1a",
  "val-projectos-kernel-cost-cap1a",
  // PROJECTOS-KERNEL-PLATFORM-STOP1A — the platform emergency stop.
  "val-projectos-kernel-platform-stop1a",
  // PROJECTOS-KERNEL-FOLLOWUP1A — the registry pin and Codex reviewer rules; the cache validator once cached-runner was resynced.
  "val-projectos-kernel-followup1a",
  "validate-speed-validation-cache"
];

const REGISTERED_MODULE_COUNT = MODULES.length;

/**
 * The mechanically binding secret scanner, which must be the sweep's FIRST module.
 *
 * Named as a constant so the runner and `validate-speed-validation-cache` enforce the same thing.
 * See the snapshot note in `run()` for why its position is what makes the per-run hash memo safe for
 * it, and what happens when it is not first.
 */
const SECRET_SCANNER = "validate-no-secrets";

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runValidator(name) {
  try {
    const errs = require("../validators/" + name + ".cjs").run();
    // The same rule as validate-all: a result that is not an array (an async run() returns a Promise,
    // whose `.length` is undefined) is a CRASH, never a silent PASS.
    if (!Array.isArray(errs)) throw new Error("run() did not return an array of errors (async or malformed validator)");
    return errs;
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

  /**
   * VALIDATORS THE CALLER HAS DECLARED CHANGED, so the cache must not answer for them.
   *
   * WHY THIS EXISTS, AND WHY IT CANNOT MAKE THE CACHE LOOSER. The benchmark has to measure what a
   * data-only change and a targeted source change actually COST, and the only honest way to measure
   * that is to run the validators such a change would invalidate. The alternative — editing a file,
   * timing a run and reverting — mutates the governed checkout in the middle of a measurement, which
   * is exactly the kind of thing a benchmark must not do.
   *
   * IT ONLY EVER FORCES A RUN. There is no value of this option that turns a miss into a hit: it is
   * checked before the cache lookup and, when it matches, the lookup is skipped and the validator
   * executes. Every fail-toward-run rule below is untouched, and a caller passing nonsense gets a
   * SLOWER run, never a weaker one.
   */
  const forced = new Set(Array.isArray(opts.invalidate) ? opts.invalidate : []);

  /**
   * WHETHER A CHANGE WAS DECLARED AT ALL — which is not the same as whether it matched anything.
   *
   * A surface that projects onto zero validators would otherwise leave `forced` empty, take the
   * suite short-circuit, and return in fifty milliseconds — a number that would be recorded as the
   * cost of the declared scenario. That is the vacuous measurement this whole exercise exists to
   * eliminate, so the short-circuit is refused whenever a change was declared, matched or not.
   */
  const declaredChange = opts.declaredChange === true || forced.size > 0;

  const results = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let total = 0;

  // --- Suite-level fast path ---
  // SKIPPED ENTIRELY WHEN A CHANGE WAS DECLARED. The suite entry answers for all 141 at once, so
  // taking it would silently ignore the caller's declaration that some of them changed — and would
  // report a 50ms "measurement" of a scenario that never ran.
  if (useCache && !declaredChange) {
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

  // ONE SNAPSHOT OF THE TREE FOR THE WHOLE SWEEP. See `hashSnapshot` in validation-cache.cjs: the
  // fifteen distinct declared input paths were being re-hashed once per declaration — 59.9s of
  // identical digests where 1.8s of distinct ones would do. Closed at the end of the sweep, in a
  // `finally`, so a crashing validator cannot leave a stale snapshot behind for the next caller in
  // this process.
  //
  // AND ITS ONE RESIDUAL WINDOW, MADE INTO AN ENFORCED INVARIANT RATHER THAN AN ACCIDENT.
  //
  // Inside a snapshot the FIRST validator to touch a path fixes that path's digest for every later
  // validator declaring it. `projectos/agent/src` is declared by 79 of 141, so sharing is the rule,
  // not the exception — which means a late validator's cache decision is made against the tree as it
  // was when an EARLY one looked. If a file changed in between, that sweep answers from the earlier
  // digest and the change is caught by the NEXT sweep instead of this one.
  //
  // That needs a writer running concurrently with validation, which the operating model excludes: the
  // worker has finished by the time checks run and holds no shell grant, and the sweep is a single
  // synchronous read-only pass. It is still a WIDER window than the unmemoised code had, and the one
  // validator where a widened window is unacceptable is the mechanically binding secret scanner.
  //
  // So the safety of `validate-no-secrets` is no longer an emergent property of a hand-maintained
  // array. It is safe precisely when it is the sweep's FIRST module — then it is always the memo's
  // producer and never its consumer, and the snapshot changes nothing at all for it. That condition
  // is checked here, and when it does not hold the snapshot is simply not opened: hashing falls back
  // to the old unmemoised behaviour, which is slower and narrower. Raised as MEDIUM by the security
  // review of this change; the review's own recommendation was to make it mechanical rather than
  // ordering-dependent.
  //
  // A REORDERING IS THEREFORE LOUD, NOT SILENT. Losing the snapshot costs ~58s a run, which the
  // benchmark's five timing standards fail on immediately, and `validate-speed-validation-cache`
  // asserts the ordering directly.
  const snapshotSafe = MODULES[0] === SECRET_SCANNER;
  if (!snapshotSafe) {
    console.error(
      "cached-runner: '" + SECRET_SCANNER + "' is not the first module, so the per-run hash snapshot " +
      "is NOT used — every declared input is re-hashed per declaration, as it was before. Validation " +
      "is unaffected; only its speed is."
    );
  }
  if (snapshotSafe) cache.beginSnapshot();
  try {

  for (const m of MODULES) {
    // Check per-validator cache
    if (useCache && !forced.has(m)) {
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

  } finally {
    if (snapshotSafe) cache.endSnapshot();
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

// EXPORTED BEFORE THE CLI RUNS. `validate-speed-validation-cache` is now in MODULES and requires this
// file for MODULES and SECRET_SCANNER; run as the CLI, this module is that require's answer, and an
// export assigned after the sweep would hand it an empty object and crash it.
module.exports = { run, MODULES, REGISTERED_MODULE_COUNT, SECRET_SCANNER };

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

  /**
   * `--surface=<comma-separated paths>` — run as if exactly those paths had changed.
   *
   * THE BENCHMARK NEEDS ITS OWN PROCESS PER SCENARIO. Measuring several scenarios back to back
   * inside one process produced numbers that were wrong by a factor of six: a data-only run measured
   * 3.9s on its own and 23.8s after a warm-up in the same process. Whatever the cause — heap the
   * size of every file digest in the repository, module graph, disk still settling — an operator
   * runs validation once, in a fresh process, and that is what the standards describe. So the
   * scenario is passed on the command line and timed from the outside.
   *
   * IT ONLY EVER FORCES A RUN. `validatorsInvalidatedBy` is a projection of the input map onto a
   * declared change; the runner then refuses the cache for exactly those validators. Nothing here
   * can turn a miss into a hit.
   */
  const surfaceArg = args.find((a) => a.startsWith("--surface="));
  const surface = surfaceArg === undefined
    ? []
    : surfaceArg.slice("--surface=".length).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const invalidate = surface.length === 0 ? [] : validatorsInvalidatedBy(surface, MODULES);
  if (surface.length > 0) {
    console.log("cached-runner: declared change to " + surface.join(", ") + " invalidates " + invalidate.length + " validator(s)");
  }

  run({
    cache: !args.includes("--no-cache"),
    benchmark: args.includes("--benchmark"),
    invalidate,
    declaredChange: surface.length > 0,
    exit: true,
  });
}
