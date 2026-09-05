"use strict";
/**
 * VALIDATION CACHE BENCHMARK — measures timing for cache acceptance criteria.
 *
 * Targets (from plan):
 * - Warm unchanged validation: ≤2 seconds
 * - Proof/data-only validation: ≤5 seconds
 * - Targeted ProjectOS source validation: ≤60 seconds where safely possible
 *
 * Usage:
 *   node projectos/speed/benchmark.cjs
 *
 * Reports environment details alongside timing results.
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A.
 */
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const cache = require("./validation-cache.cjs");

function rustVersion() {
  try {
    return execFileSync("rustc", ["--version"], { timeout: 5000, encoding: "utf8" }).trim();
  } catch (_) {
    return "unknown";
  }
}

function environment() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    rustVersion: rustVersion(),
    osRelease: os.release(),
    osType: os.type(),
    cpuModel: os.cpus()[0] ? os.cpus()[0].model : "unknown",
    cpuCount: os.cpus().length,
    totalMemoryGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1),
    cwd: ROOT,
  };
}

function timeMs(fn) {
  const start = Date.now();
  const result = fn();
  const elapsed = Date.now() - start;
  return { elapsed, result };
}

function runBenchmark() {
  const env = environment();
  console.log("=== Validation Cache Benchmark ===");
  console.log("Environment:");
  for (const [k, v] of Object.entries(env)) {
    console.log("  " + k + ": " + v);
  }
  console.log("");

  const git = cache.gitState(ROOT);
  console.log("Git state:");
  console.log("  HEAD: " + (git.head || "unknown"));
  console.log("  Clean: " + git.clean);
  console.log("");

  // --- Benchmark 1: Suite cache check (warm path) ---
  console.log("--- Benchmark 1: Suite cache check ---");
  const b1 = timeMs(() => cache.checkSuiteCache(ROOT));
  const suiteHit = b1.result !== null;
  console.log("  Result: " + (suiteHit ? "HIT (" + b1.result.length + " modules)" : "MISS"));
  console.log("  Time: " + b1.elapsed + "ms");
  console.log("  Target: ≤2000ms");
  console.log("  " + (b1.elapsed <= 2000 ? "PASS" : "FAIL"));
  console.log("");

  // --- Benchmark 2: Full cached run ---
  console.log("--- Benchmark 2: Full cached run (with cache) ---");
  // Clear require cache for the runner so it gets a fresh load
  delete require.cache[require.resolve("./cached-runner.cjs")];
  const { run } = require("./cached-runner.cjs");
  const b2 = timeMs(() => run({ cache: true, benchmark: false, exit: false }));
  console.log("  Cache hits: " + b2.result.cacheHits);
  console.log("  Cache misses: " + b2.result.cacheMisses);
  console.log("  Time: " + b2.elapsed + "ms");
  if (b2.result.cacheMisses === 0) {
    console.log("  Target (warm unchanged): ≤2000ms");
    console.log("  " + (b2.elapsed <= 2000 ? "PASS" : "FAIL"));
  } else {
    console.log("  Target (targeted source): ≤60000ms");
    console.log("  " + (b2.elapsed <= 60000 ? "PASS" : "FAIL"));
  }
  console.log("");

  // --- Benchmark 3: Cache maintenance ---
  console.log("--- Benchmark 3: Cache maintenance ---");
  const b3 = timeMs(() => cache.maintain(ROOT));
  console.log("  Expired: " + b3.result.expired);
  console.log("  Evicted: " + b3.result.evicted);
  console.log("  Total bytes: " + b3.result.totalBytes);
  console.log("  Time: " + b3.elapsed + "ms");
  console.log("");

  // --- Cache stats ---
  const st = cache.stats(ROOT);
  console.log("Cache stats:");
  console.log("  Entries: " + st.entries);
  console.log("  Total size: " + (st.totalBytes / 1024).toFixed(1) + " KB");
  console.log("");

  // --- Summary ---
  const benchmarkResult = {
    environment: env,
    git: { head: git.head, clean: git.clean },
    suiteCheck: { elapsed: b1.elapsed, hit: suiteHit, target: 2000 },
    fullCachedRun: {
      elapsed: b2.elapsed,
      cacheHits: b2.result.cacheHits,
      cacheMisses: b2.result.cacheMisses,
      targetWarm: 2000,
      targetTargeted: 60000,
    },
    maintenance: { elapsed: b3.elapsed, expired: b3.result.expired, evicted: b3.result.evicted },
    cacheStats: st,
    timestamp: new Date().toISOString(),
  };

  console.log("=== Benchmark Complete ===");
  return benchmarkResult;
}

/**
 * WHETHER THE MEASUREMENT MET ITS TARGETS — as an exit code, so it can be a governed check.
 *
 * The benchmark printed "PASS" or "FAIL" per target and then exited 0 either way. A check that
 * cannot fail proves nothing, and this one exists precisely to prove an acceptance criterion that
 * is a MEASUREMENT: "warm unchanged validation at 2 seconds or less". Run by the loop as a
 * configured check, a silent zero would have recorded a pass for a target that was missed.
 *
 * The worker cannot do this itself: it holds Write and Edit only, no execution, so it can report
 * that the tooling exists and never that the timing holds. The loop runs checks; this is one.
 */
function benchmarkFailures(result) {
  const failures = [];
  // An absent measurement is a failure here too, for the same reason: "we did not measure it" and
  // "it met the target" must never produce the same exit code.
  const suite = result.suiteCheck;
  if (!suite || typeof suite.elapsed !== 'number' || typeof suite.target !== 'number') {
    failures.push('benchmark result carries no suite cache-check measurement, so no timing was proven');
  } else if (suite.elapsed > suite.target) {
    failures.push(`suite cache check took ${suite.elapsed}ms, target ${suite.target}ms`);
  }
  // READ BY THE NAME THE RESULT ACTUALLY USES. This branch never ran.
  //
  // `runBenchmark` returns `fullCachedRun` with `cacheMisses`; this function asked for `fullRun`
  // with `misses`. Both lookups were undefined, so the whole branch was skipped and the ONE target
  // this check exists to enforce could never fail it. The docstring above is right that a check
  // which cannot fail proves nothing — it just described a fix the wiring did not deliver, and the
  // benchmark printed "FAIL" on its own summary line while exiting 0 and reporting every target met.
  //
  // It is a configured check in the governed loop, so it reported PASS for validation-cache,
  // doctor-preflight and gatekeeper-replay without ever evaluating the timing.
  //
  // A missing or malformed section is now a FAILURE rather than a skip: if the result does not
  // carry the measurement, nothing measured it, and that is not a pass.
  const full = result.fullCachedRun;
  if (!full || typeof full.elapsed !== 'number') {
    failures.push('benchmark result carries no full cached run measurement, so no timing was proven');
  } else {
    // The warm target applies only when the run really was warm; a run with misses is measured
    // against the targeted-source target, which is what the plan says.
    const target = full.cacheMisses === 0 ? full.targetWarm : full.targetTargeted;
    if (typeof target !== 'number') {
      failures.push('full cached run records no applicable target, so it cannot be judged');
    } else if (full.elapsed > target) {
      const kind = full.cacheMisses === 0 ? 'warm' : 'targeted-source';
      failures.push(
        `full cached run took ${full.elapsed}ms against the ${kind} target of ${target}ms ` +
          `(${full.cacheHits} hit, ${full.cacheMisses} miss)`,
      );
    }
  }
  return failures;
}

if (require.main === module) {
  const result = runBenchmark();
  const failures = benchmarkFailures(result);
  if (failures.length > 0) {
    for (const f of failures) console.error("benchmark: MISSED TARGET: " + f);
    console.error("benchmark: " + failures.length + " target(s) missed");
    process.exit(1);
  }
  console.log("benchmark: every target met");
}

module.exports = { runBenchmark, environment, benchmarkFailures };
