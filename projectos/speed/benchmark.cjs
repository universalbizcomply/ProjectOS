"use strict";
/**
 * THE FIVE TIMING STANDARDS, MEASURED AND JUDGED.
 *
 * The approved plan states five, and this file used to measure two:
 *
 *   1. warm unchanged validation            ≤  2,000 ms
 *   2. proof/data-only validation           ≤  5,000 ms
 *   3. targeted ProjectOS source validation ≤ 60,000 ms
 *   4. Doctor preflight                     ≤ 10,000 ms
 *   5. gatekeeper replay                    ≤  2,000 ms, and zero provider spend
 *
 * Standards 2, 4 and 5 had no automated check at all. They were measured by hand, once, on the day
 * the readiness verdict was written — which is why that verdict was NOT READY. An autonomy proof
 * runs unattended, and a harness that measures three fifths of what it claims to police is how
 * unattended drift goes unnoticed.
 *
 * A MEASUREMENT THAT WAS NOT TAKEN IS NOT A PASS. Every standard below records whether it was
 * actually measured, and `benchmarkFailures` fails on absence, on a malformed section, and on an
 * excuse it cannot corroborate from the run's own recorded facts. There is exactly one excusable
 * condition — see `EXCUSABLE` — and it is checked against `git.clean`, not against the benchmark's
 * say-so, so this file cannot wave itself through.
 *
 * NOTHING HERE EDITS THE CHECKOUT. Standards 2 and 3 need a changed tree to be meaningful, and the
 * obvious way to get one — touch a file, time the run, revert — mutates a governed repository in the
 * middle of a measurement. Instead the changed surface is DECLARED and `validatorsInvalidatedBy`
 * projects it onto the input map; the runner is then told to skip the cache for exactly those
 * validators and run them for real. The timing is of real validator execution, not of a model of it.
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A; extended to all five standards for readiness.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const cache = require("./validation-cache.cjs");
const { validatorsInvalidatedBy } = require("./input-map.cjs");

/**
 * The targets, in one place, so the scorer and the report cannot disagree about what was promised.
 * Values are the approved plan's, restated nowhere else in this file.
 */
const TARGETS = {
  warmUnchanged: 2000,
  dataOnly: 5000,
  targetedSource: 60000,
  doctor: 10000,
  gatekeeperReplay: 2000,
};

/**
 * What "a proof/data-only change" and "a targeted source change" MEAN, as paths.
 *
 * `.projectops` is in BOTH because every governed run writes there — session, invocation, evidence
 * and phase records — so a scenario that pretended those records were static would measure a run
 * that never happens. Naming it explicitly is also what makes the eleven validators that declare the
 * whole of `.projectops` visible in the cost rather than hidden inside it.
 *
 * The source surface is `projectos/agent/src`, which is the WORST case: 79 validators declare it,
 * more than any other source path. A targeted-source standard proven against the widest source
 * declaration is proven for the narrower ones by construction.
 */
const SURFACES = {
  dataOnly: [".projectops", "projectos/examples"],
  targetedSource: [".projectops", "projectos/agent/src"],
};

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
  return { elapsed: Date.now() - start, result };
}

/**
 * HOW MANY TIMES EACH STANDARD IS MEASURED, and why it is not one.
 *
 * A single sample is not rigour, it is noise with a verdict attached. Measured on this machine after
 * an hour of sustained validation, the SAME data-only scenario reported 3,913 ms and 87,801 ms — a
 * 22x spread from thermal throttling, with every child process in the slow run about four times
 * slower than in the fast one. A harness that judged either of those alone would have been confidently
 * wrong in one direction or the other.
 *
 * THE MEDIAN IS JUDGED AND EVERY SAMPLE IS RECORDED. Best-of-N would be gaming; the median of three
 * with all three in the result cannot hide a standard that is genuinely missed — two of three
 * samples have to be inside the target — and a reader can see the spread rather than trust one
 * number. `samplesMs` is in the result for exactly that reason.
 */
const SAMPLES = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A standard that was measured. `elapsed` may be one timing or several; several are judged at the median. */
function measured(id, elapsed, method, extra) {
  const samples = Array.isArray(elapsed) ? elapsed : [elapsed];
  return Object.assign(
    {
      id,
      targetMs: TARGETS[id],
      measuredMs: median(samples),
      samplesMs: samples,
      measured: true,
      unmeasurableBecause: null,
      method,
    },
    extra || {},
  );
}

/** A standard that could not be measured, and exactly why. Never a pass on its own. */
function notMeasured(id, because, method, extra) {
  return Object.assign(
    { id, targetMs: TARGETS[id], measuredMs: null, measured: false, unmeasurableBecause: because, method },
    extra || {},
  );
}

/** A fresh cached-runner module. Required each time: it caches its own `require` graph. */
function freshRunner() {
  delete require.cache[require.resolve("./cached-runner.cjs")];
  return require("./cached-runner.cjs");
}

/** SHA-256 of a file, or a marker for absent — either way, a value that changes when the file does. */
function fileFingerprint(p) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (_) {
    return "absent";
  }
}

const LEDGER = path.join(ROOT, ".projectops", "gatekeeper-ledger.json");

/**
 * Run a command and time it, reporting failure rather than throwing.
 *
 * A COMMAND THAT DID NOT RUN IS NOT A FAST COMMAND. `execFileSync` throws on a non-zero exit, and
 * catching it to return the elapsed time would turn "Doctor refused" or "replay failed" into a
 * flattering 200 ms measurement. So the exit status comes back with the timing and the caller
 * decides — which is not the same for every standard. A validation run that ends non-zero because a
 * VALIDATOR failed still did the work being timed, and the timing stands; Doctor refusing, or replay
 * failing, means the thing the standard describes did not happen at all.
 *
 * A PROCESS THAT WOULD NOT START, OR RAN PAST ITS BOUND, IS NEVER A MEASUREMENT. Both come back with
 * `started:false` regardless of `allowNonZero`.
 */
function timeCommand(command, args, timeoutMs, allowNonZero) {
  const start = Date.now();
  try {
    execFileSync(command, args, { cwd: ROOT, timeout: timeoutMs, encoding: "utf8", stdio: "pipe" });
    return { elapsed: Date.now() - start, started: true, ok: true, problem: null };
  } catch (e) {
    const exited = e && typeof e.status === "number";
    const timedOut = e && (e.killed === true || e.signal !== null && e.signal !== undefined);
    const elapsed = Date.now() - start;
    if (exited && !timedOut) {
      return {
        elapsed,
        started: true,
        ok: allowNonZero === true,
        problem: `exited ${e.status}`,
      };
    }
    return {
      elapsed,
      started: false,
      ok: false,
      problem: `did not complete: ${e && e.message ? String(e.message).split("\n")[0] : "unknown"}`,
    };
  }
}

/** One validation run, in its own process, timed from the outside. */
function timeValidationRun(surface) {
  const args = [path.join(ROOT, "projectos", "speed", "cached-runner.cjs")];
  if (surface.length > 0) args.push("--surface=" + surface.join(","));
  // A FAILING VALIDATOR IS NOT A FAILED MEASUREMENT. The run happened and took what it took; whether
  // the repository passes validation is `validate-all`'s question, and answering it twice, in a
  // timing check, would report one defect as two.
  return timeCommand(process.execPath, args, 900000, true);
}

// ---------------------------------------------------------------------------
// The five measurements
// ---------------------------------------------------------------------------

/**
 * STANDARD 1 — warm unchanged validation, via the suite-level short-circuit.
 *
 * THE PRECONDITION IS THE STANDARD. "Warm UNCHANGED" requires an unchanged tree, and `checkSuiteCache`
 * returns null without one. On a dirty tree the scenario does not exist to be measured, which is
 * reported as such and corroborated against `git.clean` by the scorer — a benchmark cannot claim this
 * excuse for itself while recording a clean tree.
 *
 * A CLEAN TREE WITH NO SUITE ENTRY IS NOT EXCUSED. That is the warm-up not having happened, which is
 * a failure of this harness, not a fact about the machine.
 */
function measureWarmUnchanged(git) {
  const method = `checkSuiteCache on a clean tree at an unchanged HEAD, ${SAMPLES} samples, median judged`;
  const samples = [];
  let modules = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const b = timeMs(() => cache.checkSuiteCache(ROOT));
    if (b.result === null) {
      if (!git.clean || git.head === null) {
        return notMeasured("warmUnchanged", "working-tree-not-clean", method, { modules: 0 });
      }
      return notMeasured("warmUnchanged", "suite-cache-not-established", method, { modules: 0 });
    }
    modules = b.result.length;
    samples.push(b.elapsed);
  }
  return measured("warmUnchanged", samples, method, { modules });
}

/**
 * STANDARDS 2 and 3 — a declared change, projected onto the input map, and actually run.
 *
 * IN ITS OWN PROCESS, and that is not a detail. Measured in-process, back to back with the warm-up,
 * the data-only scenario reported 23,805 ms; the same scenario on its own reports under 4,000 ms.
 * An operator runs validation once, from a fresh process, so that is what is timed — and the two
 * scenarios cannot contaminate each other's numbers.
 */
function measureSurface(id, surface, modules) {
  const invalidated = validatorsInvalidatedBy(surface, modules);
  const method =
    `a fresh process per sample running the cached runner with the cache refused for the ` +
    `${invalidated.length} validator(s) that declare ${surface.join(" or ")}; ${SAMPLES} samples, median judged`;
  // A SCENARIO THAT INVALIDATES NOTHING MEASURES NOTHING. It would run, return quickly, and be
  // recorded as the cost of the declared change — the vacuous measurement in its purest form. Not
  // excusable, so the scorer fails on it.
  if (invalidated.length === 0) {
    return notMeasured(id, "declared-change-invalidates-no-validator", method, {
      changedSurface: surface,
      invalidatedCount: 0,
    });
  }
  const samples = [];
  let lastProblem = null;
  for (let i = 0; i < SAMPLES; i += 1) {
    const r = timeValidationRun(surface);
    lastProblem = r.problem;
    if (!r.started) {
      return notMeasured(id, `validation-run-did-not-start: ${r.problem}`, method, {
        changedSurface: surface,
        invalidatedCount: invalidated.length,
        exit: r.problem,
      });
    }
    samples.push(r.elapsed);
  }
  return measured(id, samples, method, {
    changedSurface: surface,
    invalidatedCount: invalidated.length,
    exit: lastProblem,
  });
}

/** STANDARD 4 — Doctor, measured the way an operator meets it: the whole command, wall clock. */
function measureDoctor() {
  const method = `node projectos/agent/bin/projectos.js doctor, wall clock including process start; ${SAMPLES} samples, median judged`;
  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    // NON-ZERO IS NOT ALLOWED HERE. Doctor exits non-zero only when it REFUSES — the machine is
    // unfit for governed work — and how quickly it said so is not the standard.
    const r = timeCommand(process.execPath, [path.join(ROOT, "projectos", "agent", "bin", "projectos.js"), "doctor"], 60000, false);
    if (!r.ok) return notMeasured("doctor", `doctor-did-not-pass: ${r.problem}`, method);
    samples.push(r.elapsed);
  }
  return measured("doctor", samples, method);
}

/**
 * STANDARD 5 — gatekeeper replay: fast, and costing nothing.
 *
 * MEASURED THROUGH THE VITEST BINARY, NOT THROUGH `npx`. Package resolution is not replay, and it is
 * 2.3-6.6 s of it. The method is recorded in the result so the choice can be disagreed with rather
 * than slipped past — which is the whole reason this field exists.
 *
 * ZERO SPEND IS PROVEN, NOT PROMISED. The provider ledger is fingerprinted either side of the run: a
 * call that reached a provider writes an entry, so an unchanged fingerprint is evidence no call was
 * made. The suite's own import-set assertion is the structural argument; this is the observation.
 */
function measureReplay() {
  const method = `vitest binary directly on test/replay, ledger fingerprinted either side; ${SAMPLES} samples, median judged`;
  const vitest = path.join(ROOT, "projectos", "agent", "node_modules", "vitest", "vitest.mjs");
  const before = fileFingerprint(LEDGER);
  const samples = [];
  let problem = null;
  for (let i = 0; i < SAMPLES; i += 1) {
    const r = timeCommand(process.execPath, [vitest, "run", "test/replay", "--root", path.join(ROOT, "projectos", "agent")], 120000, false);
    if (!r.ok) { problem = r.problem; break; }
    samples.push(r.elapsed);
  }
  // FINGERPRINTED ACROSS ALL THE SAMPLES, not each one: a call made by any of them moves the ledger,
  // and the claim being proven is that replay reaches no provider at all.
  const spendFree = before === fileFingerprint(LEDGER);
  if (problem !== null) return notMeasured("gatekeeperReplay", `replay-did-not-pass: ${problem}`, method, { spendFree });
  return measured("gatekeeperReplay", samples, method, { spendFree });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function runBenchmark() {
  const env = environment();
  console.log("=== Validation Timing Benchmark — all five standards ===");
  console.log("Environment:");
  for (const [k, v] of Object.entries(env)) console.log("  " + k + ": " + v);
  console.log("");

  // WARM-UP, AND IT IS NOT A MEASUREMENT. Standards 1-3 all describe what validation costs when the
  // cache holds current answers for everything that did not change. Measuring them against a cold
  // cache would measure the cold cache, so one plain cached run happens first and is timed only for
  // the report. Its cost is entirely the first run's; a second benchmark on the same tree skips it.
  const warmUp = timeValidationRun([]);
  console.log(`Warm-up: ${warmUp.elapsed}ms in its own process — not a measurement`);

  const git = cache.gitState(ROOT);
  console.log(`Git: HEAD ${git.head || "unknown"}, clean ${git.clean}`);
  console.log("");

  const modules = freshRunner().MODULES;
  const standards = {
    warmUnchanged: measureWarmUnchanged(git),
    dataOnly: measureSurface("dataOnly", SURFACES.dataOnly, modules),
    targetedSource: measureSurface("targetedSource", SURFACES.targetedSource, modules),
    doctor: measureDoctor(),
    gatekeeperReplay: measureReplay(),
  };

  for (const s of Object.values(standards)) {
    console.log(`--- ${s.id} (target ≤${s.targetMs}ms) ---`);
    console.log("  method: " + s.method);
    if (s.measured) {
      console.log(
        `  measured: ${s.measuredMs}ms — ${s.measuredMs <= s.targetMs ? "MET" : "MISSED"}` +
          ` (samples ${s.samplesMs.join(", ")}ms)`,
      );
    }
    else console.log(`  NOT MEASURED: ${s.unmeasurableBecause}`);
    if (s.invalidatedCount !== undefined) {
      console.log(`  invalidated ${s.invalidatedCount} of ${modules.length}${s.exit === null ? "" : ` (${s.exit})`}`);
    }
    if (s.spendFree !== undefined) console.log(`  provider ledger unchanged: ${s.spendFree}`);
    console.log("");
  }

  const maintenance = timeMs(() => cache.maintain(ROOT));
  const st = cache.stats(ROOT);
  console.log(`Cache: ${st.entries} entries, ${(st.totalBytes / 1024).toFixed(1)} KB; maintenance ${maintenance.elapsed}ms`);
  console.log("");

  return {
    environment: env,
    git: { head: git.head, clean: git.clean },
    warmUp: { elapsed: warmUp.elapsed, started: warmUp.started },
    standards,
    maintenance: { elapsed: maintenance.elapsed, expired: maintenance.result.expired, evicted: maintenance.result.evicted },
    cacheStats: st,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The scorer
// ---------------------------------------------------------------------------

/**
 * The ONLY conditions under which a standard may go unmeasured without failing, per standard.
 *
 * EMPTY FOR FOUR OF THE FIVE, and the one entry is a fact about the repository rather than about the
 * timing: "warm unchanged" is a claim about an unchanged tree, and a dirty tree is not a slow tree,
 * it is a different scenario. Every other reason a measurement is missing — the command failed, the
 * warm-up did not happen, the section is absent — is a failure, because "we did not measure it" and
 * "it met the target" must never produce the same exit code.
 *
 * AND THE EXCUSE IS CORROBORATED, NOT ACCEPTED. `benchmarkFailures` checks the claim against
 * `result.git.clean`, which is recorded independently by `runBenchmark`. A result asserting a dirty
 * tree while recording a clean one is refused — so this is not an escape hatch a future edit can
 * widen by writing a different string into `unmeasurableBecause`.
 */
const EXCUSABLE = {
  warmUnchanged: ["working-tree-not-clean"],
  dataOnly: [],
  targetedSource: [],
  doctor: [],
  gatekeeperReplay: [],
};

/** Every standard the scorer must find and judge. Missing one is a failure, not a shorter list. */
const REQUIRED_STANDARDS = Object.keys(TARGETS);

/**
 * WHETHER THE MEASUREMENT MET ITS TARGETS — as an exit code, so it can be a governed check.
 *
 * TWO DEFECTS PRODUCED THIS FUNCTION AS IT NOW STANDS. The first: it read `result.fullRun.misses`
 * while the benchmark returned `result.fullCachedRun.cacheMisses`, so the one branch that could fail
 * never executed and the check reported PASS for three phases while judging nothing. The second,
 * found by the owner reading the evidence: even repaired, it judged two of the five standards the
 * plan approved, so three could drift indefinitely with the suite green.
 *
 * Both had the same root cause — nothing tested the scorer. `speedBenchmarkScorer.test.ts` now
 * asserts that each of the five can independently FAIL, that the old shape is not silently accepted,
 * and that deleting any one rule from this function turns at least one test red.
 */
function benchmarkFailures(result) {
  const failures = [];
  if (result === null || typeof result !== "object") {
    return ["the benchmark produced no result object, so nothing was judged"];
  }
  const standards = result.standards;
  if (standards === null || typeof standards !== "object" || Array.isArray(standards)) {
    return ["the benchmark result carries no `standards` section, so not one of the five timing standards was judged"];
  }

  for (const id of REQUIRED_STANDARDS) {
    const s = standards[id];
    if (s === null || typeof s !== "object" || Array.isArray(s)) {
      failures.push(`the benchmark result carries no measurement for '${id}', so that standard was not judged`);
      continue;
    }
    if (typeof s.targetMs !== "number" || !Number.isFinite(s.targetMs)) {
      failures.push(`'${id}' records no numeric target, so it cannot be judged`);
      continue;
    }
    // AGREEMENT WITH THE APPROVED TARGET IS PART OF THE JUDGEMENT. A result carrying its own, softer
    // target would otherwise pass its own exam — which is precisely how a standard gets quietly
    // restated instead of being met or reported as missed.
    if (s.targetMs !== TARGETS[id]) {
      failures.push(`'${id}' claims a target of ${s.targetMs}ms; the approved standard is ${TARGETS[id]}ms`);
      continue;
    }
    if (s.measured !== true) {
      const why = typeof s.unmeasurableBecause === "string" ? s.unmeasurableBecause : "no reason recorded";
      const excusable = EXCUSABLE[id].includes(why);
      // THE ONE EXCUSE, AND ONLY WITH THE FACT THAT MAKES IT TRUE.
      const corroborated =
        why === "working-tree-not-clean" &&
        result.git !== null &&
        typeof result.git === "object" &&
        result.git.clean === false;
      if (!excusable) {
        failures.push(`'${id}' was not measured (${why}), and that is not a pass`);
      } else if (!corroborated) {
        failures.push(
          `'${id}' claims it could not be measured because the working tree was not clean, but the run ` +
            `recorded git.clean=${result.git === null || typeof result.git !== "object" ? "nothing" : String(result.git.clean)}`,
        );
      }
      continue;
    }
    if (typeof s.measuredMs !== "number" || !Number.isFinite(s.measuredMs) || s.measuredMs < 0) {
      failures.push(`'${id}' says it was measured but records no usable timing`);
      continue;
    }
    // THE JUDGED NUMBER MUST BE THE MEDIAN OF THE SAMPLES IT SHOWS. Otherwise "median of three" is
    // a claim in a method string rather than a property of the result, and a best-of-N — or a number
    // from nowhere — would read identically.
    const samples = s.samplesMs;
    if (!Array.isArray(samples) || samples.length === 0 || samples.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      failures.push(`'${id}' records no samples, so its timing cannot be checked against what was measured`);
      continue;
    }
    if (median(samples) !== s.measuredMs) {
      failures.push(
        `'${id}' judges ${s.measuredMs}ms, which is not the median of its own samples [${samples.join(", ")}]`,
      );
      continue;
    }
    if (s.measuredMs > s.targetMs) {
      failures.push(`'${id}' took ${s.measuredMs}ms against its ${s.targetMs}ms target`);
    }
  }

  // ZERO PROVIDER SPEND IS A SEPARATE PROMISE FROM THE TIMING, and a replay that was fast because it
  // called a provider would meet the second half of standard 5 while breaking the first.
  const replay = standards.gatekeeperReplay;
  if (replay !== null && typeof replay === "object" && !Array.isArray(replay)) {
    if (replay.spendFree !== true) {
      failures.push(
        "gatekeeper replay did not prove zero provider spend: the provider ledger changed across the run" +
          (replay.spendFree === undefined ? ", or was never fingerprinted" : ""),
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
    console.error("benchmark: " + failures.length + " of the five standards not proven");
    process.exit(1);
  }
  console.log("benchmark: all five standards proven on this machine");
}

module.exports = { runBenchmark, environment, benchmarkFailures, median, TARGETS, SURFACES, EXCUSABLE, REQUIRED_STANDARDS, SAMPLES };
