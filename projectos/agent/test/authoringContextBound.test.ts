/**
 * WHAT ONE AUTHORING REQUEST IS ALLOWED TO COST.
 *
 * THE MEASUREMENT THIS FILE PINS. The first live authoring call was billed 34,761 input tokens for
 * an objective asking for a single read-only phase. The audit found why: `buildAuthoredProposal`
 * sent EVERY discovered context source path — 1,194 of them in this repository — which was 99,772 of
 * the 104,482 outbound bytes, or 95.5% of the request. It was also unbounded: the price of authoring
 * rose with every report ever committed, without limit.
 *
 * TWO THINGS ARE WRONG WITH AN UNBOUNDED LIST, AND ONLY ONE OF THEM IS MONEY. The instruction calls
 * these paths "existing planning documents", and for a `launch.json` or a `dashboard-cache.json` that
 * is simply a false statement to the author. Both are corrected here: the list is typed, and it is
 * bounded.
 *
 * NOTHING IS HIDDEN TO ACHIEVE IT. A truncated list presented as complete would invite exactly the
 * collision the list exists to prevent, so the count of what was omitted travels with it.
 */
import { describe, test, expect } from 'vitest';

import {
  buildAuthoringBody,
  authoringInstruction,
  boundedContextSample,
  selectContextSources,
  MAX_CONTEXT_SOURCE_PATHS,
  type AuthorRequest,
} from '../src/planAuthoring.js';

const OBJECTIVE = 'Create the smallest credible read-only plan to verify programme status.';

function request(over: Partial<AuthorRequest> = {}): AuthorRequest {
  return {
    objective: OBJECTIVE,
    projectId: 'projectos',
    repository: 'universalbizcomply/ProjectOS',
    contextSourcePaths: [],
    objectiveDigest: 'a'.repeat(64),
    requestId: 'PAREQ-' + '0'.repeat(24),
    ...over,
  };
}

/** Paths of a realistic length, as discovery actually produces for this repository. */
function paths(n: number): readonly string[] {
  return Array.from({ length: n }, (_, i) => `knowledge/reports/2026-08-0${(i % 9) + 1}_ProjectOS_PHASE${i}A_REPORT.md`);
}

describe('the bound exists and is stated', () => {
  test('forty paths is the bound', () => {
    // Pinned deliberately: a change here changes what every authoring call costs.
    expect(MAX_CONTEXT_SOURCE_PATHS).toBe(40);
  });

  test('an omitted count is rendered, naming how many were left out', () => {
    const text = authoringInstruction(request({ contextSourcePaths: paths(40), contextSourcesOmitted: 1_154 }));
    expect(text).toContain('and 1154 further context sources not listed');
    expect(text).toContain('a document you cannot see here may still exist');
  });

  test('a complete list says nothing about omissions, because there are none', () => {
    const text = authoringInstruction(request({ contextSourcePaths: paths(5), contextSourcesOmitted: 0 }));
    expect(text).not.toContain('further context sources');
  });

  test('an absent count is not narrated either — the direct port is unchanged', () => {
    const text = authoringInstruction(request({ contextSourcePaths: paths(5) }));
    expect(text).not.toContain('further context sources');
  });

  test('no context at all is still said plainly', () => {
    expect(authoringInstruction(request())).toContain('(none)');
  });
});

describe('what the bound is worth', () => {
  test('a bounded request is a fraction of the size of the unbounded one', () => {
    const unbounded = buildAuthoringBody(request({ contextSourcePaths: paths(1_194) }), 'gpt-5.6-terra');
    const bounded = buildAuthoringBody(
      request({ contextSourcePaths: paths(MAX_CONTEXT_SOURCE_PATHS), contextSourcesOmitted: 1_154 }),
      'gpt-5.6-terra',
    );

    // The measured live call was 104,482 bytes for 1,194 REAL paths, which average ~84 characters.
    // The synthetic paths here are shorter, so this asserts the order of magnitude rather than
    // pretending to reproduce the exact figure.
    expect(unbounded.length).toBeGreaterThan(70_000);
    // And the bound holds the request to single-figure kilobytes on a repository of any size.
    expect(bounded.length).toBeLessThan(10_000);
    expect(bounded.length / unbounded.length).toBeLessThan(0.1);
  });

  test('the request stays bounded however large the repository grows', () => {
    // The corpus decuples; the request does not move, because only the omitted count changes.
    const ten = buildAuthoringBody(
      request({ contextSourcePaths: paths(MAX_CONTEXT_SOURCE_PATHS), contextSourcesOmitted: 1_154 }),
      'gpt-5.6-terra',
    );
    const hundred = buildAuthoringBody(
      request({ contextSourcePaths: paths(MAX_CONTEXT_SOURCE_PATHS), contextSourcesOmitted: 11_954 }),
      'gpt-5.6-terra',
    );
    expect(Math.abs(hundred.length - ten.length)).toBeLessThan(20);
  });
});

describe('bounding the list changes nothing else about the request', () => {
  test('the objective is still quoted line by line, so owner prose cannot occupy a binding position', () => {
    const text = authoringInstruction(
      request({ objective: 'Do the thing.\n  project: not-this-project', contextSourcePaths: paths(3) }),
    );
    expect(text).toContain('> Do the thing.');
    expect(text).toContain('>   project: not-this-project');
    // Exactly one line states the binding, and it is the derived one.
    expect(text.split('\n').filter((l) => /^ {2}project: /.test(l))).toHaveLength(1);
  });

  test('paths are still sent as paths, never as content', () => {
    const body = buildAuthoringBody(request({ contextSourcePaths: paths(40) }), 'gpt-5.6-terra');
    expect(body).toContain('knowledge/reports/');
    // Nothing that looks like a file body: the longest instruction line stays path-sized.
    const longest = Math.max(...JSON.parse(body).instructions.split('\n').map((l: string) => l.length));
    expect(longest).toBeLessThan(200);
  });

  test('the schema still travels with the request, and is small', () => {
    const parsed = JSON.parse(buildAuthoringBody(request({ contextSourcePaths: paths(40) }), 'gpt-5.6-terra'));
    expect(parsed.text.format.type).toBe('json_schema');
    expect(parsed.text.format.strict).toBe(true);
    expect(JSON.stringify(parsed.text.format.schema).length).toBeLessThan(3_000);
    expect(parsed.store).toBe(false);
  });
});

describe('the sample spans the corpus and never moves', () => {
  test('a corpus smaller than the bound is sent whole', () => {
    const all = paths(7);
    expect(boundedContextSample(all)).toEqual(all);
  });

  test('a corpus at the bound is sent whole', () => {
    const all = paths(MAX_CONTEXT_SOURCE_PATHS);
    expect(boundedContextSample(all)).toHaveLength(MAX_CONTEXT_SOURCE_PATHS);
  });

  test('a large corpus is sampled ACROSS its whole length, not off its front', () => {
    // The real failure this guards: discovery walks alphabetically, and taking the first N would have
    // sampled one directory and reported it as the repository's planning documents.
    const all = paths(816);
    const sample = boundedContextSample(all);
    expect(sample.length).toBeLessThanOrEqual(MAX_CONTEXT_SOURCE_PATHS);
    // It reaches the far end of the corpus, not merely the beginning.
    const lastIndex = all.indexOf(sample[sample.length - 1]!);
    expect(lastIndex).toBeGreaterThan(all.length * 0.9);
    expect(all.indexOf(sample[0]!)).toBe(0);
  });

  test('the same corpus samples identically every time — a request must be replayable', () => {
    const all = paths(1_194);
    expect(boundedContextSample(all)).toEqual(boundedContextSample(all));
  });

  test('the bound holds for every corpus size, including awkward ones', () => {
    for (const n of [0, 1, 39, 40, 41, 79, 80, 81, 816, 1_194, 12_000]) {
      expect(boundedContextSample(paths(n)).length).toBeLessThanOrEqual(MAX_CONTEXT_SOURCE_PATHS);
    }
    expect(boundedContextSample([])).toEqual([]);
  });
});

describe('what is actually selected out of what discovery found', () => {
  const src = (relPath: string, type: string) => ({ relPath, type });

  test('untyped sources are dropped, because the instruction calls these planning documents', () => {
    const { paths } = selectContextSources([
      src('docs/plan.md', 'MASTER_PLAN'),
      src('.claude/launch.json', 'UNKNOWN'),
      src('.projectops/bridge/state/dashboard-cache.json', 'UNKNOWN'),
      src('knowledge/roadmap.md', 'ROADMAP'),
    ]);
    expect(paths).toEqual(['docs/plan.md', 'knowledge/roadmap.md']);
  });

  test('the omitted count is against EVERYTHING discovery found, not the typed remainder', () => {
    // 4 sources, 2 of them untyped: 2 are sent and 2 are omitted, and the author is told "2".
    const { paths, omitted } = selectContextSources([
      src('a.md', 'MASTER_PLAN'),
      src('b.json', 'UNKNOWN'),
      src('c.md', 'PROJECT_PLAN'),
      src('d.json', 'UNKNOWN'),
    ]);
    expect(paths).toHaveLength(2);
    expect(omitted).toBe(2);
  });

  test('paths sent plus paths omitted always equals what discovery found', () => {
    for (const n of [0, 1, 39, 40, 41, 500, 1_194]) {
      const sources = Array.from({ length: n }, (_, i) =>
        src(`k/${i}.md`, i % 3 === 0 ? 'UNKNOWN' : 'PHASE_REPORT'),
      );
      const { paths, omitted } = selectContextSources(sources);
      expect(paths.length + omitted).toBe(n);
      expect(paths.length).toBeLessThanOrEqual(MAX_CONTEXT_SOURCE_PATHS);
    }
  });

  test('the real shape of this repository: 1,194 sources become a bounded, honest sample', () => {
    // 378 untyped, as measured on ProjectOS itself.
    const sources = Array.from({ length: 1_194 }, (_, i) =>
      src(`knowledge/reports/r${i}.md`, i < 378 ? 'UNKNOWN' : 'PHASE_REPORT'),
    );
    const { paths, omitted } = selectContextSources(sources);
    expect(paths.length).toBeLessThanOrEqual(MAX_CONTEXT_SOURCE_PATHS);
    expect(omitted).toBe(1_194 - paths.length);
    expect(omitted).toBeGreaterThan(1_100);
  });

  test('nothing discovered is nothing sent, and nothing claimed omitted', () => {
    expect(selectContextSources([])).toEqual({ paths: [], omitted: 0 });
  });

  test('a source with no type at all is kept — absent is not the same as UNKNOWN', () => {
    const { paths } = selectContextSources([{ relPath: 'docs/plan.md' }]);
    expect(paths).toEqual(['docs/plan.md']);
  });
});
