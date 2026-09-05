/**
 * THE BENCHMARK'S VERDICT, TESTED — because for three phases it had none, and could not fail.
 *
 * `benchmarkFailures` is what turns a measurement into a governed check: the loop runs
 * `speed-benchmark` and reads its exit code, and the plan's acceptance criterion is a TIMING, so
 * this function is the only thing standing between "we measured it" and "it met the target".
 *
 * It read `result.fullRun.misses`. `runBenchmark` returns `result.fullCachedRun.cacheMisses`. Both
 * lookups were undefined, so the entire branch was skipped, no timing was ever judged, and the
 * process exited 0 reporting "every target met" — on a run whose own summary line printed FAIL at
 * 92,849ms against a 60,000ms target. It reported PASS as a configured check for validation-cache,
 * doctor-preflight and gatekeeper-replay without evaluating a single target.
 *
 * Nothing tested it. That is why the rot was silent, and it is the whole reason this file exists:
 * the scorer is now asserted to REFUSE, not merely to run.
 *
 * Pure function, no benchmark executed: these are shaped results, so the suite stays fast and
 * deterministic and does not depend on the machine it runs on.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { benchmarkFailures } = require_('../../speed/benchmark.cjs') as {
  benchmarkFailures: (r: unknown) => readonly string[];
};

/** A measurement that is comfortably inside its target, so only the field under test decides. */
const FAST_SUITE = { elapsed: 10, target: 2000 };
const WARM_RUN = { elapsed: 1500, cacheHits: 141, cacheMisses: 0, targetWarm: 2000, targetTargeted: 60000 };

describe('the speed benchmark judges its own measurements', () => {
  test('a warm run inside the 2s target passes', () => {
    expect(benchmarkFailures({ suiteCheck: FAST_SUITE, fullCachedRun: WARM_RUN })).toEqual([]);
  });

  test('a warm run over the 2s target FAILS, and says by how much', () => {
    const r = { suiteCheck: FAST_SUITE, fullCachedRun: { ...WARM_RUN, elapsed: 2001 } };
    const f = benchmarkFailures(r);
    expect(f.length).toBeGreaterThan(0);
    expect(f.join(' ')).toContain('2001ms');
    expect(f.join(' ')).toContain('warm');
  });

  test('a run WITH cache misses is judged against the targeted-source target, not the warm one', () => {
    // 21,790ms is a real measurement from this repository: far over the 2s warm target and far
    // under the 60s targeted one. Which target applies is the whole distinction, so it is asserted
    // in both directions rather than assumed.
    const missed = { ...WARM_RUN, elapsed: 21790, cacheHits: 130, cacheMisses: 11 };
    expect(benchmarkFailures({ suiteCheck: FAST_SUITE, fullCachedRun: missed })).toEqual([]);

    const tooSlow = { ...missed, elapsed: 92849 };
    expect(benchmarkFailures({ suiteCheck: FAST_SUITE, fullCachedRun: tooSlow }).join(' ')).toContain(
      'targeted-source',
    );
  });

  test('THE ORIGINAL DEFECT: the old key names are not silently accepted', () => {
    // This is the regression. `fullRun`/`misses` is exactly the shape the scorer used to look for,
    // and a result carrying ONLY those must not be read as a pass — it means nothing measured the
    // thing under the name the scorer reads.
    const old = { suiteCheck: FAST_SUITE, fullRun: { elapsed: 92849, misses: 14, targetWarm: 2000, targetTargeted: 60000 } };
    expect(benchmarkFailures(old).length).toBeGreaterThan(0);
  });

  test('an ABSENT measurement fails rather than skipping', () => {
    // "We did not measure it" and "it met the target" must never produce the same exit code. A
    // skipped branch was the original failure; a skip that passes would reproduce it exactly.
    expect(benchmarkFailures({ suiteCheck: FAST_SUITE }).join(' ')).toContain('no full cached run measurement');
    expect(benchmarkFailures({ fullCachedRun: WARM_RUN }).join(' ')).toContain('no suite cache-check measurement');
    expect(benchmarkFailures({}).length).toBeGreaterThan(1);
  });

  test('a malformed measurement fails rather than being coerced', () => {
    for (const bad of [null, undefined, 'fast', {}, { elapsed: 'quick' }]) {
      expect(benchmarkFailures({ suiteCheck: FAST_SUITE, fullCachedRun: bad }).length).toBeGreaterThan(0);
    }
  });

  test('a slow suite cache check fails on its own', () => {
    const f = benchmarkFailures({ suiteCheck: { elapsed: 2500, target: 2000 }, fullCachedRun: WARM_RUN });
    expect(f.join(' ')).toContain('suite cache check took 2500ms');
  });

  test('every failure is reported, not merely the first', () => {
    const f = benchmarkFailures({
      suiteCheck: { elapsed: 9999, target: 2000 },
      fullCachedRun: { ...WARM_RUN, elapsed: 5000 },
    });
    expect(f.length).toBe(2);
  });
});
