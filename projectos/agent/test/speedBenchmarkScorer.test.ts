/**
 * THE BENCHMARK'S VERDICT, TESTED — because it has now been wrong twice, in two different ways.
 *
 * `benchmarkFailures` is what turns a measurement into a governed check: the loop runs
 * `speed-benchmark` and reads its exit code, and the plan's acceptance criteria are TIMINGS, so this
 * function is the only thing standing between "we measured it" and "it met the target".
 *
 * DEFECT ONE — it read `result.fullRun.misses` while the benchmark returned
 * `result.fullCachedRun.cacheMisses`. Both lookups were undefined, the branch never ran, and the
 * process exited 0 reporting "every target met" on a run whose own summary printed FAIL at 92,849ms
 * against a 60,000ms target.
 *
 * DEFECT TWO — repaired, it still judged TWO of the five standards the plan approves. Proof/data-only
 * validation, Doctor and gatekeeper replay had no automated check at all; they were measured by hand,
 * once. That is why the readiness verdict was NOT READY, and it is what this file now closes.
 *
 * THE ORGANISING RULE HERE IS INDEPENDENCE. Every standard gets a test in which it is the ONLY thing
 * wrong and the scorer must produce exactly one failure naming it. Delete any single rule from the
 * scorer and at least one of these goes red — which is the property the owner asked for: a broken or
 * removed scorer rule cannot leave the suite green.
 *
 * Pure function, no benchmark executed: these are shaped results, so the suite stays fast and
 * deterministic and does not depend on the machine it runs on.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const benchmark = require_('../../speed/benchmark.cjs') as {
  benchmarkFailures: (r: unknown) => readonly string[];
  TARGETS: Record<string, number>;
  REQUIRED_STANDARDS: readonly string[];
  EXCUSABLE: Record<string, readonly string[]>;
};
const { benchmarkFailures, TARGETS, REQUIRED_STANDARDS, EXCUSABLE } = benchmark;

/**
 * One standard, measured comfortably inside its target.
 *
 * `measuredMs` is always the median of `samplesMs` unless a test deliberately breaks that, because
 * the scorer checks the relationship — a judged number that is not the median of the samples shown
 * is a number from nowhere.
 */
function ok(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const ms = (extra['measuredMs'] as number | undefined) ?? Math.floor(TARGETS[id]! / 10);
  return {
    id,
    targetMs: TARGETS[id],
    measuredMs: ms,
    samplesMs: [ms, ms, ms],
    measured: true,
    unmeasurableBecause: null,
    method: 'fixture',
    ...extra,
  };
}

/** A whole result in which nothing is wrong. Every test below spoils exactly one thing in it. */
function cleanResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    git: { head: 'a'.repeat(40), clean: true },
    standards: {
      warmUnchanged: ok('warmUnchanged'),
      dataOnly: ok('dataOnly'),
      targetedSource: ok('targetedSource'),
      doctor: ok('doctor'),
      gatekeeperReplay: ok('gatekeeperReplay', { spendFree: true }),
      ...(over['standards'] as Record<string, unknown> | undefined),
    },
    ...over,
  };
}

function withStandard(id: string, s: unknown): Record<string, unknown> {
  const r = cleanResult();
  (r['standards'] as Record<string, unknown>)[id] = s;
  return r;
}

describe('the approved standards are the ones the scorer judges', () => {
  test('all five, by name — a sixth standard added to the plan must be wired, not assumed', () => {
    expect([...REQUIRED_STANDARDS].sort()).toEqual(
      ['dataOnly', 'doctor', 'gatekeeperReplay', 'targetedSource', 'warmUnchanged'].sort(),
    );
  });

  test('the targets are the approved numbers, not softer ones', () => {
    expect(TARGETS).toEqual({
      warmUnchanged: 2000,
      dataOnly: 5000,
      targetedSource: 60000,
      doctor: 10000,
      gatekeeperReplay: 2000,
    });
  });

  test('a fully measured, in-target run passes', () => {
    expect(benchmarkFailures(cleanResult())).toEqual([]);
  });
});

describe('EVERY standard can fail on its own', () => {
  /**
   * THE INDEPENDENCE PROOF, and the reason it asserts a failure COUNT of one.
   *
   * A scorer that judged only the first standard and copied its verdict onto the rest would pass a
   * test that merely asked "did anything fail". Requiring exactly one failure, naming exactly the
   * standard that was spoiled, is what makes each of the five rules load-bearing: remove any of
   * them and its row here goes red while the other four stay green.
   */
  test.each(REQUIRED_STANDARDS)('%s over its target is one failure, naming it', (id) => {
    const f = benchmarkFailures(withStandard(id, ok(id, { measuredMs: TARGETS[id] + 1, spendFree: true })));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(id);
    expect(f[0]).toContain(String(TARGETS[id] + 1));
  });

  test.each(REQUIRED_STANDARDS)('%s absent is one failure, naming it', (id) => {
    const r = cleanResult();
    delete (r['standards'] as Record<string, unknown>)[id];
    const f = benchmarkFailures(r);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(id);
  });

  test.each(REQUIRED_STANDARDS)('%s measured with no usable timing is one failure', (id) => {
    const f = benchmarkFailures(withStandard(id, ok(id, { measuredMs: 'quick', spendFree: true })));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(id);
  });

  test.each(REQUIRED_STANDARDS)('%s carrying a softer target of its own is one failure', (id) => {
    // A result that restates the standard it is measured against would otherwise pass its own exam.
    const f = benchmarkFailures(
      withStandard(id, ok(id, { targetMs: TARGETS[id] * 10, measuredMs: TARGETS[id] * 5, spendFree: true })),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(String(TARGETS[id]));
  });

  test.each(REQUIRED_STANDARDS)('%s malformed is a failure rather than a coercion', (id) => {
    for (const bad of [null, undefined, 'fast', 42, []]) {
      expect(benchmarkFailures(withStandard(id, bad)).length).toBeGreaterThan(0);
    }
  });
});

describe('the judged number must be the median of the samples shown', () => {
  /**
   * WHY THIS RULE EXISTS. The same scenario measured 3,913 ms and 87,801 ms on this machine within
   * one session — a 22x spread from thermal throttling. Judging one sample is noise with a verdict
   * attached, so the benchmark takes three and judges the median. That is only a real property if
   * the scorer checks it: "median of three" written in a method string is prose, and a best-of-N —
   * or a number from nowhere — would read identically.
   */
  test.each(REQUIRED_STANDARDS)('%s judging something other than its own median FAILS', (id) => {
    const f = benchmarkFailures(
      withStandard(id, ok(id, { measuredMs: 1, samplesMs: [1, TARGETS[id]! * 9, TARGETS[id]! * 9], spendFree: true })),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('not the median');
  });

  test.each(REQUIRED_STANDARDS)('%s showing no samples at all FAILS', (id) => {
    for (const bad of [undefined, [], 'three', [1, 'two', 3]]) {
      const f = benchmarkFailures(withStandard(id, ok(id, { samplesMs: bad, spendFree: true })));
      expect(f).toHaveLength(1);
      expect(f[0]).toContain('samples');
    }
  });

  test('a genuine median over the target still FAILS — two slow samples cannot be outvoted by one fast one', () => {
    const slow = TARGETS['dataOnly']! + 1;
    const f = benchmarkFailures(
      withStandard('dataOnly', ok('dataOnly', { measuredMs: slow, samplesMs: [1, slow, slow + 100] })),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain(String(slow));
  });
});

describe('an unmeasured standard is not a pass', () => {
  test.each(REQUIRED_STANDARDS.filter((id) => EXCUSABLE[id].length === 0))(
    '%s has no excuse at all — not measured is not measured',
    (id) => {
      for (const why of ['working-tree-not-clean', 'it was slow', 'skipped', '']) {
        const f = benchmarkFailures(
          withStandard(id, { id, targetMs: TARGETS[id], measuredMs: null, measured: false, unmeasurableBecause: why, spendFree: true }),
        );
        expect(f.length).toBeGreaterThan(0);
      }
    },
  );

  test('warm-unchanged may be excused ONLY by a dirty tree', () => {
    const unmeasured = {
      id: 'warmUnchanged',
      targetMs: TARGETS['warmUnchanged'],
      measuredMs: null,
      measured: false,
      unmeasurableBecause: 'working-tree-not-clean',
    };
    const dirty = withStandard('warmUnchanged', unmeasured);
    dirty['git'] = { head: 'a'.repeat(40), clean: false };
    expect(benchmarkFailures(dirty)).toEqual([]);
  });

  test('THE EXCUSE IS CORROBORATED — claiming a dirty tree while recording a clean one FAILS', () => {
    // Without this, the one permitted excuse is a string a future edit could write unconditionally,
    // and the harness would be able to wave itself through on every run.
    const lying = withStandard('warmUnchanged', {
      id: 'warmUnchanged',
      targetMs: TARGETS['warmUnchanged'],
      measuredMs: null,
      measured: false,
      unmeasurableBecause: 'working-tree-not-clean',
    });
    const f = benchmarkFailures(lying);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('git.clean=true');
  });

  test('a clean tree with no suite entry is a harness failure, not an excuse', () => {
    const f = benchmarkFailures(
      withStandard('warmUnchanged', {
        id: 'warmUnchanged',
        targetMs: TARGETS['warmUnchanged'],
        measuredMs: null,
        measured: false,
        unmeasurableBecause: 'suite-cache-not-established',
      }),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('suite-cache-not-established');
  });
});

describe('replay must also prove it spent nothing', () => {
  test('a fast replay that moved the provider ledger FAILS', () => {
    const f = benchmarkFailures(withStandard('gatekeeperReplay', ok('gatekeeperReplay', { spendFree: false })));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('zero provider spend');
  });

  test('a replay that never fingerprinted the ledger FAILS', () => {
    const f = benchmarkFailures(withStandard('gatekeeperReplay', ok('gatekeeperReplay')));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('never fingerprinted');
  });
});

describe('the shapes that must never be read as a pass', () => {
  test('DEFECT ONE REGRESSION: the pre-fix result shape is refused', () => {
    // `suiteCheck` + `fullCachedRun` is exactly what the benchmark used to return, and `fullRun`
    // /`misses` is exactly what the broken scorer used to look for. Neither carries `standards`, so
    // neither may be read as five standards proven.
    const preFix = {
      suiteCheck: { elapsed: 10, target: 2000 },
      fullCachedRun: { elapsed: 1500, cacheHits: 141, cacheMisses: 0, targetWarm: 2000, targetTargeted: 60000 },
    };
    expect(benchmarkFailures(preFix).length).toBeGreaterThan(0);
    const older = { suiteCheck: { elapsed: 10, target: 2000 }, fullRun: { elapsed: 92849, misses: 14 } };
    expect(benchmarkFailures(older).length).toBeGreaterThan(0);
  });

  test('an empty result, a null and a non-object are all refused', () => {
    for (const bad of [{}, null, undefined, 'ok', 7, []]) {
      expect(benchmarkFailures(bad).length).toBeGreaterThan(0);
    }
  });

  test('a result with an empty standards section fails once per standard', () => {
    expect(benchmarkFailures({ git: { clean: true }, standards: {} })).toHaveLength(REQUIRED_STANDARDS.length);
  });

  test('every failure is reported, not merely the first', () => {
    const r = cleanResult();
    const s = r['standards'] as Record<string, Record<string, unknown>>;
    s['warmUnchanged'] = ok('warmUnchanged', { measuredMs: 9999 });
    s['doctor'] = ok('doctor', { measuredMs: 99999 });
    s['gatekeeperReplay'] = ok('gatekeeperReplay', { measuredMs: 9999, spendFree: false });
    // Two over-target, one over-target, and the spend rule — four distinct complaints.
    expect(benchmarkFailures(r)).toHaveLength(4);
  });
});
