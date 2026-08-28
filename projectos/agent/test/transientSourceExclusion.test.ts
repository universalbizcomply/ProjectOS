/**
 * A TRANSIENT TREE MUST NOT DESCRIBE THE PROJECT TO AN AUTHOR.
 *
 * WHAT WENT WRONG. `SKIP_DIRS` in the discovery engine already carried `temp` and `tmp`. It did not
 * carry `.temp`, and that one missing spelling was enough: a nested git worktree checked out under
 * `C:\dev\ProjectOS\.temp\phase5-recut-cab71a5` put a second copy of the repository's whole planning
 * corpus inside the scanned tree. Discovery went from 507 typed sources to 815.
 *
 * WHY THAT IS NOT MERELY A COST PROBLEM. The bounded sample spreads across the corpus by a step
 * derived from its size, so doubling the corpus re-sampled every position: of the 39 paths a clean
 * checkout offers the author, only FOUR survived. Fourteen of the 39 came from `.temp` — thirteen of
 * them the same documents already named under their canonical paths, and one a stale state snapshot
 * that no longer matched the live one. The list exists so an author can say "this programme exists,
 * leave it alone"; a list that is a third duplicates, from a scratch checkout, cannot do that job.
 *
 * The engine skips by directory BASENAME, before recursing, so one entry excludes the whole subtree
 * and no path special-casing is needed. These tests pin that, and pin that nothing else moved.
 *
 * Created in PROJECTOS-FINAL-PAID-AUTHORING-CONTEXT-INTEGRITY1A.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const engine = require_('../../validators/plan-discovery-engine.cjs');

const created: string[] = [];
afterEach(() => {
  // Validators have leaked tens of gigabytes of %TEMP% scratch before. Every tree made here dies here.
  while (created.length > 0) {
    const dir = created.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a locked file must not fail the suite; the next run's mkdtemp is unique anyway */
    }
  }
});

/** A planning document the engine will classify, rather than an arbitrary file. */
const PLAN_DOC = [
  '# Master Plan',
  '',
  '## Phases',
  '',
  '- Phase 1: do the smallest credible thing.',
  '- Phase 2: prove it.',
  '',
].join('\n');

function write(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

/**
 * A corpus shaped like the real defect: canonical documents, and the same documents again inside
 * transient directories — the dotted one included.
 */
function corpus(): string {
  const root = mkdtempSync(join(tmpdir(), 'projectos-transient-')).replace(/\\/g, '/');
  created.push(root);
  write(root, 'docs/architecture/master-plan.md', PLAN_DOC);
  write(root, 'knowledge/reports/2026-08-01_report_CLOSED.md', PLAN_DOC);
  write(root, '.projectops/phases/PHASE1A.json', JSON.stringify({ phaseId: 'PHASE1A', purpose: 'x' }));
  // The transient trees. `.temp` mirrors the nested-worktree layout that caused this.
  write(root, '.temp/phase5-recut-cab71a5/docs/architecture/master-plan.md', PLAN_DOC);
  write(root, '.temp/phase5-recut-cab71a5/knowledge/reports/2026-08-01_report_CLOSED.md', PLAN_DOC);
  write(root, '.temp/phase5-recut-cab71a5/projectos/state/recovery.current-state.json', JSON.stringify({ stale: true }));
  write(root, 'temp/docs/master-plan.md', PLAN_DOC);
  write(root, 'tmp/docs/master-plan.md', PLAN_DOC);
  return root;
}

const discover = (root: string) => engine.discoverPlanSources(root, { repoEvidence: {} });
const rels = (root: string): string[] =>
  discover(root).sources.map((s: { relPath: string }) => s.relPath.replace(/\\/g, '/'));

describe('a directory named .temp is excluded, recursively', () => {
  test('nothing under .temp becomes a discovered source', () => {
    const found = rels(corpus()).filter((p) => p.startsWith('.temp'));
    expect(found).toEqual([]);
  });

  test('the exclusion reaches arbitrarily deep, not just the first level', () => {
    // The deepest fixture path is four levels below `.temp`. If the engine only skipped the top
    // entry and recursed anyway, this is the assertion that would catch it.
    const found = rels(corpus()).filter((p) => /^\.temp[\\/]/.test(p));
    expect(found).toEqual([]);
  });

  test('the stale scratch state snapshot specifically cannot be discovered', () => {
    expect(rels(corpus()).some((p) => p.endsWith('recovery.current-state.json'))).toBe(false);
  });

  test('.temp is skipped by basename, so it needs no path special-casing', () => {
    expect(engine.SKIP_DIRS.has('.temp')).toBe(true);
  });
});

describe('the directories that already worked still work', () => {
  test.each(['temp', 'tmp'])('%s remains excluded', (name) => {
    expect(engine.SKIP_DIRS.has(name)).toBe(true);
    expect(rels(corpus()).some((p) => p.startsWith(name + '/'))).toBe(false);
  });

  test('every previously skipped directory is still skipped', () => {
    for (const d of ['.git', 'node_modules', 'dist', 'build', 'target', 'coverage', '.vscode-test',
      'tmp', 'temp', '.cache', 'out', '.next', '.turbo', 'vendor', '__pycache__']) {
      expect(engine.SKIP_DIRS.has(d)).toBe(true);
    }
  });
});

describe('the canonical corpus is untouched', () => {
  test('canonical copies of the duplicated documents remain discoverable', () => {
    const found = rels(corpus());
    expect(found).toContain('docs/architecture/master-plan.md');
    expect(found).toContain('knowledge/reports/2026-08-01_report_CLOSED.md');
  });

  test('.projectops, docs and knowledge are not collateral damage', () => {
    const found = rels(corpus());
    for (const prefix of ['.projectops/', 'docs/', 'knowledge/']) {
      expect(found.some((p) => p.startsWith(prefix))).toBe(true);
    }
  });

  test('excluding .temp does not empty the corpus', () => {
    // A skip rule that matched too much would show up here as a corpus of nothing.
    expect(rels(corpus()).length).toBeGreaterThanOrEqual(3);
  });

  test('a document present canonically and under .temp is offered exactly once', () => {
    const found = rels(corpus()).filter((p) => p.endsWith('master-plan.md'));
    expect(found).toEqual(['docs/architecture/master-plan.md']);
  });
});
